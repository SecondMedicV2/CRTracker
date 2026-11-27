"""Tests for Page 7 retesting protocols, variants, anchors, IST boundaries, and caller safety."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app import db as dbmod
from app import pipeline, retest, status, storage
from app.models import AuditLog, Followup, ImportBatch, Notification, Order, Report, ReportParameter
from app.seed_data import CONDITION_PROTOCOLS, RETEST_PROTOCOLS, TEST_CATALOGUE
from app.timeutil import today_ist
from tests.test_followups import A1C_SEV, PSA, fu_of, make
from tests.test_workflow import doctor as make_doctor


API = "/api/v1"
_DISTINCT_NAMES = [
    "Asha Rao", "Bimal Das", "Chitra Menon", "Dev Patel", "Esha Gupta", "Farhan Khan",
    "Gita Iyer", "Hari Nair", "Indu Shah", "Jaya Kapoor", "Kabir Joshi", "Lata Mishra",
    "Manoj Verma", "Neha Kulkarni", "Omkar Joshi", "Pooja Shetty", "Qasim Ali", "Ritu Saxena",
]
_SEQ = [0]


def _make_report(params, *, days_ago=10, collected_utc=None, name=None, mobile="9555512345",
                 age=45, gender="M", classification="ABNORMAL"):
    _SEQ[0] += 1
    distinct_name = name or _DISTINCT_NAMES[(_SEQ[0] - 1) % len(_DISTINCT_NAMES)]
    with dbmod.SessionLocal() as db:
        b = db.scalar(select(ImportBatch)) or ImportBatch(source="manual")
        db.add(b)
        db.flush()
        o = Order(order_id_external=f"RT-{_SEQ[0]}-{mobile}",
                  batch_id=b.id, status=status.EXTRACTING)
        db.add(o)
        db.flush()
        collected = collected_utc or (datetime.now(timezone.utc) - timedelta(days=days_ago))
        rep = Report(order_id=o.id, patient_name=distinct_name, age=age, gender=gender, collected_on=collected,
                     mobile_enc=storage.encrypt_str(mobile), classification=classification)
        db.add(rep)
        db.flush()
        for code, raw, val, flag, sev, dev in params:
            db.add(ReportParameter(report_id=rep.id, param_code=code, param_name_raw=raw, value_num=val,
                                   value_text=str(val), system_flag=flag, severity=sev, deviation_pct=dev))
        db.flush()
        pipeline.conclude(db, o, rep)
        db.commit()
        return o.id, o.patient_id, rep.id


def test_retest_catalogue_and_protocol_seed(admin):
    cat_codes = {t["code"] for t in TEST_CATALOGUE}
    assert {"VITD", "CALCIUM", "HBA1C", "FBS", "LIPID", "TSH", "FT4", "CBC", "RETIC",
            "KFT", "ELECTROLYTES", "URINE_ROUTINE", "UACR", "LFT"} <= cat_codes
    assert len([p for p in RETEST_PROTOCOLS if p.get("finding_code")]) == 10
    assert len(CONDITION_PROTOCOLS) == 10
    assert len(RETEST_PROTOCOLS) == 20
    chol = next(p for p in RETEST_PROTOCOLS if p["finding_code"] == "HIGH_CHOLESTEROL")
    assert "28\u201384 days" in chol["signoff_note"] and "Day 30\u201390" in chol["signoff_note"]
    assert admin.get(f"{API}/rules/retest_protocols").status_code == 200


def test_all_10_findings_windows_and_variants():
    today = today_ist()
    # 1. LOW_VITD default -> DOCTOR_TO_SET; indicated -> 56-84d, reminder Day 60
    oid, _, _ = _make_report([("VITAMIN_D", "Vitamin D", 12.0, "LOW", "moderate", 40.0)], mobile="9500000001")
    f = fu_of(oid)
    assert f.retest_status == "DOCTOR_TO_SET" and f.retest_window_start is None
    with dbmod.SessionLocal() as db:
        fu = db.get(Followup, f.id)
        anchor = today - timedelta(days=5)
        p_ind = retest.plan_retest(db, fu, state={"indicated": True, "treatment_anchor_on": anchor})
        assert p_ind["status"] == "AUTO_SCHEDULED"
        assert fu.retest_window_start == anchor + timedelta(days=56)
        assert fu.retest_window_end == anchor + timedelta(days=84)
        assert fu.reminder_on == anchor + timedelta(days=60)

    # 2. HIGH_HBA1C: targets_unmet (90d), stable_at_goal (180d), treatment_changed (90d from change)
    oid2, _, _ = _make_report([A1C_SEV], days_ago=10, mobile="9500000002")
    f2 = fu_of(oid2)
    collected2 = today - timedelta(days=10)
    assert f2.retest_status == "AUTO_SCHEDULED" and f2.retest_window_start == collected2 + timedelta(days=90)
    assert f2.reminder_on == collected2 + timedelta(days=90)
    with dbmod.SessionLocal() as db:
        fu = db.get(Followup, f2.id)
        p_goal = retest.plan_retest(db, fu, state={"stable_at_goal": True})
        assert p_goal["primary_finding"]["variant_when"] == "stable_at_goal"
        assert fu.retest_window_start == collected2 + timedelta(days=180)
        chg = today - timedelta(days=2)
        p_chg = retest.plan_retest(db, fu, state={"treatment_changed": True, "treatment_anchor_on": chg})
        assert p_chg["primary_finding"]["variant_when"] == "treatment_changed"
        assert fu.retest_window_start == chg + timedelta(days=90)

    # 3. HIGH_CHOLESTEROL: individualized -> DOCTOR_TO_SET; statin/change -> 28-84d, reminder Day 30
    oid3, _, _ = _make_report([("LDL", "LDL", 190.0, "HIGH", "moderate", 25.0)], mobile="9500000003")
    f3 = fu_of(oid3)
    assert f3.retest_status == "DOCTOR_TO_SET"
    with dbmod.SessionLocal() as db:
        fu = db.get(Followup, f3.id)
        anchor = today - timedelta(days=3)
        retest.plan_retest(db, fu, state={"medicines": [{"name": "Atorvastatin 20mg", "last_changed_on": anchor.isoformat()}]})
        assert fu.retest_status == "AUTO_SCHEDULED"
        assert fu.retest_window_start == anchor + timedelta(days=28)
        assert fu.retest_window_end == anchor + timedelta(days=84)
        assert fu.reminder_on == anchor + timedelta(days=30)

    # 4. HIGH_TSH: individualized -> DOCTOR_TO_SET; levothyroxine change -> 42-56d, reminder Day 45
    oid4, _, _ = _make_report([("TSH", "TSH", 12.0, "HIGH", "moderate", 50.0)], mobile="9500000004")
    f4 = fu_of(oid4)
    assert f4.retest_status == "DOCTOR_TO_SET"
    with dbmod.SessionLocal() as db:
        fu = db.get(Followup, f4.id)
        anchor = today - timedelta(days=1)
        retest.plan_retest(db, fu, state={"treatment_anchor_on": anchor})
        assert fu.retest_window_start == anchor + timedelta(days=42)
        assert fu.retest_window_end == anchor + timedelta(days=56)
        assert fu.reminder_on == anchor + timedelta(days=45)

    # 5. LOW_HB: doctor decides -> DOCTOR_TO_SET; on iron -> 14-28d, reminder Day 14
    oid5, _, _ = _make_report([("HEMOGLOBIN", "Hb", 9.5, "LOW", "moderate", 20.0)], mobile="9500000005")
    assert fu_of(oid5).retest_status == "DOCTOR_TO_SET"
    with dbmod.SessionLocal() as db:
        fu = db.get(Followup, fu_of(oid5).id)
        anchor = today - timedelta(days=2)
        retest.plan_retest(db, fu, state={"medicines": [{"name": "Ferrous sulfate", "started_on": anchor.isoformat()}]})
        assert fu.retest_window_start == anchor + timedelta(days=14)
        assert fu.retest_window_end == anchor + timedelta(days=28)
        assert fu.reminder_on == anchor + timedelta(days=14)

    # 6. HIGH_CREATININE: always RISK_BASED -> DOCTOR_TO_SET even when diabetes present
    oid6, _, _ = _make_report([("CREATININE", "Creatinine", 2.4, "HIGH", "severe", 80.0), A1C_SEV], mobile="9500000006")
    assert fu_of(oid6).retest_status == "DOCTOR_TO_SET"

    # 7. ABNORMAL_LFT: first report -> DOCTOR_DECIDES; mild + stable_abnormal -> 14-28d
    oid7, _, _ = _make_report([("SGPT", "SGPT", 58.0, "HIGH", "mild", 5.0)], days_ago=40, name="Lata Lft", mobile="9500000007")
    assert fu_of(oid7).retest_status == "DOCTOR_TO_SET"
    oid7b, _, _ = _make_report([("SGPT", "SGPT", 58.0, "HIGH", "mild", 5.0)], days_ago=10, name="Lata Lft", mobile="9500000007")
    f7b = fu_of(oid7b)
    assert f7b.retest_status == "AUTO_SCHEDULED"
    assert f7b.retest_window_start == (today - timedelta(days=10)) + timedelta(days=14)
    assert f7b.retest_window_end == (today - timedelta(days=10)) + timedelta(days=28)

    # 8. OBESITY_METABOLIC (with high TG + high BMI) -> Day 90
    oid8, _, _ = _make_report([("TRIGLYCERIDES", "TG", 220.0, "HIGH", "moderate", 20.0)], mobile="9500000008")
    with dbmod.SessionLocal() as db:
        fu = db.get(Followup, fu_of(oid8).id)
        p8 = retest.plan_retest(db, fu, detected=["OBESITY_METABOLIC"])
        assert p8["status"] == "AUTO_SCHEDULED" and fu.retest_window_start == (today - timedelta(days=10)) + timedelta(days=90)

    # 9. MULTI_CHRONIC alone -> DOCTOR_TO_SET; MULTI_CHRONIC + HIGH_HBA1C + LOW_HB -> earliest (LOW_HB 14-28d) & lists all
    with dbmod.SessionLocal() as db:
        fu = db.get(Followup, f2.id)
        p_mc = retest.plan_retest(db, fu, detected=["MULTI_CHRONIC"])
        assert p_mc["status"] == "DOCTOR_TO_SET"
        p_combo = retest.plan_retest(db, fu, detected=["HIGH_HBA1C", "MULTI_CHRONIC", "NORMAL_WITH_RISK"])
        assert p_combo["status"] == "AUTO_SCHEDULED" and len(p_combo["findings"]) == 3


def test_medicine_and_manual_anchors_doctor_queue_override_and_fallback(admin, doctor):
    make_doctor(admin, "Dr One")
    today = today_ist()
    oid, pid, _ = _make_report([("LDL", "LDL", 185.0, "HIGH", "moderate", 20.0)], mobile="9511100001")
    fid = fu_of(oid).id
    q = doctor.get(f"{API}/doctor/queue").json()
    q_item = next(x for x in q if x["id"] == fid)
    assert q_item["retest_status"] == "DOCTOR_TO_SET" and q_item["retest_label"] == "Doctor to set retest date"

    # Adding Page 5 statin auto-computes 28-84d window from started_on
    anchor = today - timedelta(days=4)
    r = doctor.post(f"{API}/patients/{pid}/medicines", json={"medicine_code": "ATORVASTATIN", "started_on": anchor.isoformat()})
    assert r.status_code == 201
    fu_row = admin.get(f"{API}/followups/{fid}").json()
    assert fu_row["retest_status"] == "AUTO_SCHEDULED"
    assert fu_row["retest_window_start"] == (anchor + timedelta(days=28)).isoformat()
    assert fu_row["retest_window_end"] == (anchor + timedelta(days=84)).isoformat()

    # Manual anchor via PATCH /followups/{fid}
    oid_hb, _, _ = _make_report([("HEMOGLOBIN", "Hb", 9.0, "LOW", "moderate", 25.0)], mobile="9511100002")
    fid_hb = fu_of(oid_hb).id
    hb_anchor = today - timedelta(days=2)
    r_patch = doctor.patch(f"{API}/followups/{fid_hb}", json={"treatment_anchor_on": hb_anchor.isoformat()}).json()
    assert r_patch["retest_status"] == "AUTO_SCHEDULED"
    assert r_patch["retest_window_start"] == (hb_anchor + timedelta(days=14)).isoformat()

    # Override date requires valid reason_code and logs audit without PII
    assert doctor.post(f"{API}/followups/{fid}/retest-override", json={"window_start": (today + timedelta(days=5)).isoformat(), "reason_code": ""}).status_code == 422
    ov = doctor.post(f"{API}/followups/{fid}/retest-override", json={
        "window_start": (today + timedelta(days=5)).isoformat(),
        "window_end": (today + timedelta(days=10)).isoformat(),
        "reason_code": "CLINICAL_JUDGMENT",
        "notes": "Monitor sooner",
    })
    assert ov.status_code == 200 and ov.json()["retest_status"] == "OVERRIDDEN"
    with dbmod.SessionLocal() as db:
        assert db.scalar(select(AuditLog).where(AuditLog.action == "retest_override", AuditLog.entity_id == f"{fid}:CLINICAL_JUDGMENT")) is not None

    # Fallback: PSA cancer marker (no diagnostic finding match) uses bucket interval_days=0
    oid_psa, _, _ = _make_report([PSA], days_ago=0, mobile="9511100003")
    f_psa = fu_of(oid_psa)
    assert f_psa.retest_status == "FALLBACK" and f_psa.due_on == today


def test_ist_boundary_caller_isolation_and_reminder_tick(admin, caller, doctor):
    # 2026-01-10T20:00:00Z is 2026-01-11 01:30 IST
    utc_dt = datetime(2026, 1, 10, 20, 0, 0, tzinfo=timezone.utc)
    oid, _, _ = _make_report([A1C_SEV], collected_utc=utc_dt, mobile="9522200001")
    f = fu_of(oid)
    expected_ist_collected = date(2026, 1, 11)
    assert f.retest_window_start == expected_ist_collected + timedelta(days=90)
    assert f.reminder_on == expected_ist_collected + timedelta(days=90)

    # Caller sees only neutral "Retest due" and window dates, zero clinical fields
    rows = caller.get(f"{API}/followups").json()
    row = next(x for x in rows if x["id"] == f.id)
    assert row["retest_label"] == "Retest due" and row["retest_window_start"] == f.retest_window_start.isoformat()
    assert "retest_plan" not in row and "finding_codes" not in row and "reminder_on" not in row
    assert caller.post(f"{API}/followups/{f.id}/retest-override", json={
        "window_start": date.today().isoformat(), "reason_code": "CLINICAL_JUDGMENT"}).status_code == 403

    # Reminder tick sends caller-safe reminder once and stays idempotent
    with dbmod.SessionLocal() as db:
        n1 = retest.reminder_tick(db, now=datetime.now(timezone.utc))
        n2 = retest.reminder_tick(db, now=datetime.now(timezone.utc))
        assert n1 == 1 and n2 == 0
        notifs = caller.get(f"{API}/notifications").json()["items"]
        assert any(n["text"] == "Retest reminder due" for n in notifs)
