from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select

from app import callcard as cc, db as dbmod, privacy, relationship as rel
from app.analysis import load_rules
from app.models import (Appointment, AuditLog, CareTouchpoint, Followup, Order, Patient, PatientBucket, Report,
                        RetestRecommendation)
from app.timeutil import today_ist
from tests.test_followups import A1C_SEV, HB_OK, LDL, fu_of, make
from tests.test_workflow import doctor as make_doctor

API = "/api/v1"


def test_sync_touchpoints_idempotent_and_merges_patients(admin, doctor):
    doc_id = make_doctor(admin, "Dr Rel")
    o1 = make([A1C_SEV], days_ago=40, name="Meera Nair", mobile="9876501111")
    fu = fu_of(o1)
    pid = fu.patient_id
    admin.post(f"{API}/followups/{fu.id}/consent")
    admin.post(f"{API}/followups/{fu.id}/calls", json={
        "outcome": "BOOKED", "doctor_id": doc_id,
        "slot_start": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(), "slot_minutes": 15,
    })
    admin.post(f"{API}/followups/{fu.id}/doctor-outcome", json={
        "outcome": "DOCTOR_DONE", "retest_codes": ["HBA1C"],
        "next_followup_on": (today_ist() + timedelta(days=60)).isoformat(),
    })
    with dbmod.SessionLocal() as db:
        rec = db.scalar(select(RetestRecommendation).where(RetestRecommendation.followup_id == fu.id))
    admin.post(f"{API}/retest-recommendations/{rec.id}/ordered", json={"ordered_ref": "ORD-99"})

    # Add a duplicate patient merged into pid with a normal report
    o2 = make([HB_OK], days_ago=10, name="Meera N", mobile="9876501112")
    with dbmod.SessionLocal() as db:
        dup_pid = db.get(Order, o2).patient_id
        db.get(Patient, dup_pid).merged_into_id = pid
        db.commit()
        first = rel.sync_touchpoints(db, pid)
        second = rel.sync_touchpoints(db, pid)
        assert second == 0  # idempotent!
        stages = {t.stage for t in db.scalars(select(CareTouchpoint).where(CareTouchpoint.patient_id == pid))}
        assert {"DIAGNOSTICS", "CONSULTATIONS", "CHRONIC_CONDITIONS", "ONGOING_MONITORING"} <= stages
        assert db.scalar(select(func.count()).select_from(CareTouchpoint).where(CareTouchpoint.patient_id == dup_pid)) == 0


def test_relationship_status_boundaries():
    today = date(2026, 11, 26)
    th = {"new_days": 30, "active_days": 90, "at_risk_days": 180}
    tp = lambda d: CareTouchpoint(patient_id=1, stage="DIAGNOSTICS", occurred_on=today - timedelta(days=d))

    assert rel.relationship_status([tp(0)], False, today, th) == "NEW"
    assert rel.relationship_status([tp(30)], False, today, th) == "NEW"
    assert rel.relationship_status([tp(31)], False, today, th) == "ACTIVE"
    assert rel.relationship_status([tp(90), tp(40)], False, today, th) == "ACTIVE"
    assert rel.relationship_status([tp(91)], False, today, th) == "AT_RISK"
    assert rel.relationship_status([tp(180)], False, today, th) == "AT_RISK"
    assert rel.relationship_status([tp(181)], False, today, th) == "LAPSED"
    assert rel.relationship_status([tp(10)], True, today, th) == "AT_RISK"


def test_next_best_step_rules_and_caller_safety():
    today = date(2026, 11, 26)
    with dbmod.SessionLocal() as db:
        rules = load_rules(db)
        steps = rules["relationship_next_steps"]
        for s in steps:
            assert cc.check_caller_safety(
                {"caller_script": {"opening": s["caller_label"], "identity_check": "x", "free_followup_pitch": "x",
                                   "consent_request": "x", "slot_offer": "x", "urgent_symptom_protocol": "x", "closing": "x",
                                   "objection_handling": []}},
                rules["caller_script_forbidden"],
                [t["name"] for t in rules["test_catalogue"]],
            ) == []

    tp = lambda st, d: CareTouchpoint(patient_id=1, stage=st, occurred_on=today - timedelta(days=d))
    abn_rep = Report(order_id=1, classification="ABNORMAL", collected_on=datetime(2026, 11, 20, tzinfo=timezone.utc))
    norm_rep = Report(order_id=2, classification="NORMAL", collected_on=datetime(2026, 11, 20, tzinfo=timezone.utc))
    b = PatientBucket(patient_id=1, report_id=1, bucket_code="DIABETES", active=True)

    assert rel.next_best_step([tp("CHRONIC_CONDITIONS", 10)], [], [b], "NEW", steps, today)["code"] == "SCHEDULE_RETEST"
    assert rel.next_best_step([tp("DIAGNOSTICS", 5)], [abn_rep], [], "NEW", steps, today)["code"] == "DOCTOR_CONSULTATION"
    assert rel.next_best_step([tp("CHRONIC_CONDITIONS", 10), tp("ONGOING_MONITORING", 10)], [], [b], "NEW", steps, today)["code"] == "DIET_PLAN"
    assert rel.next_best_step([tp("DIAGNOSTICS", 100)], [], [], "AT_RISK", steps, today)["code"] == "REENGAGEMENT_CALL"
    assert rel.next_best_step([tp("DIAGNOSTICS", 10)], [norm_rep], [], "NEW", steps, today)["code"] == "PREVENTIVE_SCREENING"


def test_role_filtering_manual_touchpoints_summary_and_audit(admin, doctor, caller):
    o = make([A1C_SEV], days_ago=10, name="Kavita Joshi", mobile="9876543210")
    pid = fu_of(o).patient_id

    # Manual touchpoint lifecycle
    r = doctor.post(f"{API}/patients/{pid}/touchpoints", json={"service_code": "DIETITIAN_PLAN", "amount_inr": 9999})
    assert r.status_code == 201 and "amount_inr" not in r.json()
    tp_id = r.json()["id"]
    assert caller.post(f"{API}/patients/{pid}/touchpoints", json={"service_code": "DIETITIAN_PLAN"}).status_code == 403

    # Role filtering on GET /relationship
    adm_view = admin.get(f"{API}/patients/{pid}/relationship").json()
    doc_view = doctor.get(f"{API}/patients/{pid}/relationship").json()
    cal_view = caller.get(f"{API}/patients/{pid}/relationship").json()
    assert "total_amount_inr" in adm_view and any("amount_inr" in t for t in adm_view["touchpoints"])
    assert "total_amount_inr" not in doc_view and all("amount_inr" not in t for t in doc_view["touchpoints"])
    assert set(cal_view) == {"patient_id", "patient_name", "mobile", "status", "last_touchpoint_on", "next_step"}
    assert cal_view["mobile"].startswith("X") and set(cal_view["next_step"]) == {"caller_label"}

    # Auto touchpoint cannot be deleted, manual can
    auto_id = next(t["id"] for t in adm_view["touchpoints"] if t["source"] == "AUTO")
    assert doctor.delete(f"{API}/touchpoints/{auto_id}").status_code == 409
    assert caller.delete(f"{API}/touchpoints/{tp_id}").status_code == 403
    assert doctor.delete(f"{API}/touchpoints/{tp_id}").status_code == 200

    # Summary access
    assert caller.get(f"{API}/relationship/summary").status_code == 403
    assert doctor.get(f"{API}/relationship/summary").status_code == 403
    summ = admin.get(f"{API}/relationship/summary").json()
    assert summ["total_patients"] >= 1 and "stage_coverage_pct" in summ

    # Audit log has no patient PII
    with dbmod.SessionLocal() as db:
        audits = db.scalars(select(AuditLog)).all()
        blob = " ".join(f"{a.action}:{a.entity}:{a.entity_id}" for a in audits)
        assert "Kavita" not in blob and "9876543210" not in blob
        # Privacy export/erase includes touchpoints
        exp = privacy.export_patient(db, pid)
        assert len(exp["care_touchpoints"]) >= 1
        counts = privacy.erase_patient(db, pid)
        assert counts["care_touchpoints"] >= 1
        assert db.scalar(select(func.count()).select_from(CareTouchpoint).where(CareTouchpoint.patient_id == pid)) == 0
