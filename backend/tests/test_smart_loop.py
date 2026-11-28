"""Smart Diagnostics loop: migrations, privacy, Health360 memberships (page 15), Health Hub care plans (page 17),
and the report-to-outcome safety gate and metrics."""
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select

from app import db as dbmod
from app import privacy, storage
from app.care_plans import care_plan_renewal_tick, seed_care_plans
from app.identity import mobile_hash
from app.memberships import membership_renewal_tick, seed_memberships
from app.models import (CarePlan, CareTouchpoint, CorporateClient, Followup, Membership, MembershipPlan, Notification, Patient,
                        Payment, PlanEnrollment)
from app.timeutil import today_ist

API = "/api/v1"


def new_patient(name="Pat", age=45, mobile="") -> int:
    with dbmod.SessionLocal() as db:
        p = Patient(name=name, name_norm=name.lower(), gender="F", age=age,
                    mobile_enc=storage.encrypt_str(mobile) if mobile else "", mobile_hash=mobile_hash(mobile) if mobile else "")
        db.add(p)
        db.commit()
        return p.id


def red_followup(pid: int, report_id: int = 9001) -> int:
    with dbmod.SessionLocal() as db:
        fu = Followup(patient_id=pid, report_id=report_id, due_on=today_ist(), priority="ESCALATION", protocol_tier="URGENT",
                      abnormal_codes=["HBA1C"])
        db.add(fu)
        db.commit()
        return fu.id


# ---------------- migrations ----------------
def test_migrations_build_every_model_table_and_column(tmp_path, monkeypatch):
    from alembic import command
    from alembic.autogenerate import compare_metadata
    from alembic.config import Config
    from alembic.migration import MigrationContext
    from sqlalchemy import create_engine

    from app.models import Base

    eng = create_engine(f"sqlite:///{tmp_path / 'mig.db'}")
    monkeypatch.setattr(dbmod, "engine", eng)
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    with eng.connect() as c:
        diffs = [d for d in compare_metadata(MigrationContext.configure(c), Base.metadata)
                 if not isinstance(d, list) and d[0] in ("add_table", "add_column", "remove_table")]
    assert diffs == []


# ---------------- Health360 memberships ----------------
def test_chronic_needs_a_doctor_signoff_before_it_starts(caller, doctor, admin):
    pid = new_patient()
    r = caller.post(f"{API}/memberships/enroll", json={"patient_id": pid, "plan_code": "H360_CHRONIC", "amount_inr": 799})
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["status"] == "PENDING_SIGNOFF" and m["plan_name"] == "Health360 Care"  # caller sees the neutral name
    assert admin.post(f"{API}/memberships/{m['id']}/signoff").status_code == 403
    assert caller.post(f"{API}/memberships/{m['id']}/signoff").status_code == 403
    r = doctor.post(f"{API}/memberships/{m['id']}/signoff")
    assert r.status_code == 200 and r.json()["status"] == "ACTIVE" and r.json()["signed_off"]

    # a doctor enrolling signs off at once; with no payment yet it waits for payment
    r = doctor.post(f"{API}/memberships/enroll", json={"patient_id": new_patient("B"), "plan_code": "H360_CHRONIC"})
    assert r.json()["status"] == "PENDING_PAYMENT"


def test_paid_plan_waits_for_payment_and_payment_is_audited(caller, admin):
    pid = new_patient()
    m = caller.post(f"{API}/memberships/enroll", json={"patient_id": pid, "plan_code": "H360_PLUS"}).json()
    assert m["status"] == "PENDING_PAYMENT" and m["payments"] == []
    r = caller.post(f"{API}/memberships/{m['id']}/payments", json={"amount_inr": 499, "method": "COUNTER_UPI"})
    assert r.status_code == 200 and r.json()["status"] == "ACTIVE"
    assert [p["amount_inr"] for p in r.json()["payments"]] == [499]
    audit = admin.get(f"{API}/audit").json()
    rows = audit["items"] if isinstance(audit, dict) else audit
    assert any(a["action"] == "payment" and a["entity"] == "membership" for a in rows)


def test_entitlements_have_limits_and_include_lower_plans():
    with dbmod.SessionLocal() as db:
        seed_memberships(db)
    from app.memberships import consume_membership_entitlement, enroll_membership
    pid = new_patient()
    with dbmod.SessionLocal() as db:
        m = enroll_membership(db, pid, "H360_PLUS", payment_details={"amount_inr": 499})
        consume_membership_entitlement(db, m.id, "TELECONSULT")
        with pytest.raises(ValueError, match="used up"):
            consume_membership_entitlement(db, m.id, "TELECONSULT")
        consume_membership_entitlement(db, m.id, "CARE_NAVIGATION")  # inherited from Essential
        with pytest.raises(ValueError, match="not included"):
            consume_membership_entitlement(db, m.id, "HOME_VISIT")


def test_membership_renewal_job_reminds_once_expires_and_rolls_free_on(caller):
    pid = new_patient()
    with dbmod.SessionLocal() as db:
        seed_memberships(db)
        t = today_ist()
        db.add_all([Membership(patient_id=pid, plan_code="H360_PLUS", status="ACTIVE", start_on=t - timedelta(days=25),
                               current_period_end=t + timedelta(days=5), entitlements_used={}),
                    Membership(patient_id=pid, plan_code="H360_ESSENTIAL", status="ACTIVE", start_on=t - timedelta(days=60),
                               current_period_end=t - timedelta(days=10), entitlements_used={}),
                    Membership(patient_id=pid, plan_code="H360_FREE", status="ACTIVE", start_on=t - timedelta(days=400),
                               current_period_end=t - timedelta(days=1), entitlements_used={})])
        db.commit()
        membership_renewal_tick(db)
        membership_renewal_tick(db)  # a second run the same day must not repeat the task
        rows = {m.plan_code: m for m in db.scalars(select(Membership).where(Membership.patient_id == pid))}
        assert rows["H360_PLUS"].status == "RENEWAL_DUE"
        assert rows["H360_ESSENTIAL"].status == "EXPIRED"
        assert rows["H360_FREE"].status == "ACTIVE" and rows["H360_FREE"].current_period_end > t
        notes = db.scalars(select(Notification).where(Notification.text.like("Membership renewal%"))).all()
        assert len(notes) == 1


def test_no_gateway_call_while_online_payments_are_off(caller, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("gateway called")
    monkeypatch.setattr(httpx, "post", boom)
    m = caller.post(f"{API}/memberships/enroll", json={"patient_id": new_patient(), "plan_code": "H360_PLUS"}).json()
    r = caller.post(f"{API}/memberships/{m['id']}/online-order")
    assert r.status_code == 409 and "switched off" in r.json()["detail"]


def test_corporate_statement_csv_is_formula_safe(admin):
    with dbmod.SessionLocal() as db:
        db.add(CorporateClient(name="=HYPERLINK(1)", code="EVIL", pepm_inr=150))
        db.commit()
    r = admin.get(f"{API}/corporate-billing/statements?format=csv")
    assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
    assert "'=HYPERLINK(1)" in r.text


def test_roster_import_matches_by_mobile_creates_the_rest_and_enrols(admin):
    existing = new_patient("Known Person", mobile="9876500001")
    with dbmod.SessionLocal() as db:
        c = CorporateClient(name="Acme", code="ACME", pepm_inr=199)
        db.add(c)
        db.commit()
        cid = c.id
    csv_body = "Employee ID,Name,Mobile\nE1,Known Person,+91 98765 00001\nE2,New Person,9876500002\nE3,No Phone,\n"
    r = admin.post(f"{API}/corporate-clients/{cid}/roster", files={"file": ("roster.csv", csv_body, "text/csv")})
    assert r.status_code == 200, r.text
    assert r.json() | {} == {"rows": 3, "matched": 1, "created": 1, "enrolled": 2, "already_member": 0, "skipped": 1}
    with dbmod.SessionLocal() as db:
        ms = db.scalars(select(Membership).where(Membership.corporate_client_id == cid)).all()
        assert {m.status for m in ms} == {"ACTIVE"} and {m.payer for m in ms} == {"CORPORATE"}
        assert any(m.patient_id == existing and m.member_ref == "E1" for m in ms)
        new = db.scalar(select(Patient).where(Patient.name == "New Person"))
        assert new.source_channel == "CORPORATE" and "9876500002" not in new.mobile_enc
    again = admin.post(f"{API}/corporate-clients/{cid}/roster", files={"file": ("roster.csv", csv_body, "text/csv")}).json()
    assert again["already_member"] == 2 and again["enrolled"] == 0
    assert admin.get(f"{API}/corporate-billing/statements").json()["statements"][0]["monthly_total_inr"] == 398


def test_plan_editor_survives_a_reseed(admin):
    r = admin.patch(f"{API}/membership-plans/H360_PLUS", json={"price_inr_monthly": 549})
    assert r.status_code == 200 and r.json()["price_inr_monthly"] == 549
    with dbmod.SessionLocal() as db:
        seed_memberships(db)
        assert db.scalar(select(MembershipPlan).where(MembershipPlan.code == "H360_PLUS")).price_inr_monthly == 549


# ---------------- Health Hub care plans ----------------
def test_care_plan_seed_matches_the_flyers():
    with dbmod.SessionLocal() as db:
        seed_care_plans(db)
        cp05 = db.scalar(select(CarePlan).where(CarePlan.code == "CP05_LIFESTYLE_WEIGHT"))
        assert [(t["tier"], t["price_inr"]) for t in cp05.tiers] == [("ESSENTIAL", 2499), ("PLUS", 3999)]
        assert cp05.entitlements["DIETITIAN_SESSION"] == 4
        assert all(not p.qr_url for p in db.scalars(select(CarePlan)))  # QR target not defined yet: no invented URLs


def test_care_plan_is_sold_only_after_a_doctor_assessment(admin, doctor, caller):
    pid = new_patient()
    assert caller.post(f"{API}/care-plans/enroll", json={"patient_id": pid, "plan_code": "CP07_DIET_NUTRITION"}).status_code == 403
    enr = doctor.post(f"{API}/care-plans/enroll", json={"patient_id": pid, "plan_code": "CP07_DIET_NUTRITION", "tier": "PLUS"}).json()
    assert enr["status"] == "SUGGESTED"
    r = caller.post(f"{API}/care-plans/enrollments/{enr['id']}/pay", json={"method": "COUNTER_CASH"})
    assert r.status_code == 422 and "doctor must assess" in r.json()["detail"]
    assert admin.post(f"{API}/care-plans/enrollments/{enr['id']}/assess", json={"eligible": True}).status_code == 403
    assert doctor.post(f"{API}/care-plans/enrollments/{enr['id']}/assess", json={"eligible": True}).json()["status"] == "DOCTOR_ASSESSED"
    r = caller.post(f"{API}/care-plans/enrollments/{enr['id']}/pay", json={"method": "COUNTER_UPI", "reference": "U1"})
    assert r.status_code == 200, r.text
    paid = r.json()
    assert paid["status"] == "ACTIVE" and paid["plan_name"] == "Health Hub care plan 07" and "entitlements" not in paid
    assert date.fromisoformat(paid["period_end"]) == today_ist() + timedelta(days=90)
    with dbmod.SessionLocal() as db:
        e = db.get(PlanEnrollment, enr["id"])
        assert e.activated_at is not None and e.payment_id
        tp = db.scalar(select(CareTouchpoint).where(CareTouchpoint.ref_entity == "payments", CareTouchpoint.patient_id == pid))
        assert tp.stage == "EATING_WELL" and tp.amount_inr == 1999
    # included-use beyond the plan is allowed but flagged
    for _ in range(4):
        out = doctor.post(f"{API}/care-plans/enrollments/{enr['id']}/consume", json={"entitlement_key": "DIETITIAN_SESSION"}).json()
    assert out["warning"] == ""
    out = doctor.post(f"{API}/care-plans/enrollments/{enr['id']}/consume", json={"entitlement_key": "DIETITIAN_SESSION"}).json()
    assert out["warning"]
    assert admin.get(f"{API}/care-plans/analytics/revenue").json()["by_plan"] == [
        {"plan_code": "CP07_DIET_NUTRITION", "total_revenue": 1999, "payments": 1}]


def test_medical_weight_management_can_be_refused_by_the_doctor(doctor):
    enr = doctor.post(f"{API}/care-plans/enroll", json={"patient_id": new_patient(), "plan_code": "CP06_MEDICAL_WEIGHT",
                                                         "tier": "PROGRAMME"}).json()
    r = doctor.post(f"{API}/care-plans/enrollments/{enr['id']}/assess", json={"eligible": False})
    assert r.json()["status"] == "NOT_ELIGIBLE" and r.json()["eligibility_note_code"] == "NOT_ELIGIBLE_FOR_MEDICAL_TREATMENT"


def test_caller_never_sees_what_a_plan_treats(caller):
    body = caller.get(f"{API}/care-plans/CP09_PCOS").text
    assert "PCOS" not in body and "women" not in body.lower() and "Health Hub care plan 09" in body
    assert "PCOS" not in caller.get(f"{API}/care-plans").text


def test_care_plan_renewal_task_has_no_plan_name():
    pid = new_patient()
    with dbmod.SessionLocal() as db:
        seed_care_plans(db)
        db.add(PlanEnrollment(patient_id=pid, plan_code="CP09_PCOS", tier="PLUS", status="ACTIVE", period_start=today_ist() - timedelta(days=85),
                              period_end=today_ist() + timedelta(days=5), price_inr=3999, entitlements_used={}))
        db.commit()
        care_plan_renewal_tick(db)
        care_plan_renewal_tick(db)
        notes = db.scalars(select(Notification).where(Notification.text.like("%renewal call due%"))).all()
        assert len(notes) == 1 and "PCOS" not in notes[0].text


def test_recorded_service_uses_up_an_included_session(doctor):
    pid = new_patient()
    enr = doctor.post(f"{API}/care-plans/enroll", json={"patient_id": pid, "plan_code": "CP07_DIET_NUTRITION"}).json()
    doctor.post(f"{API}/care-plans/enrollments/{enr['id']}/assess", json={"eligible": True})
    doctor.post(f"{API}/care-plans/enrollments/{enr['id']}/pay", json={})
    r = doctor.post(f"{API}/patients/{pid}/touchpoints", json={"service_code": "DIETITIAN_PLAN"})
    assert r.status_code == 201, r.text
    assert r.json()["entitlement_used"] == {"source": "care_plan", "id": enr["id"], "entitlement": "DIETITIAN_SESSION"}


# ---------------- safety gate and outcomes ----------------
def test_red_result_blocks_every_plan_sale_until_a_doctor_clears_it(caller, doctor, admin):
    pid = new_patient()
    fid = red_followup(pid)
    assert doctor.get(f"{API}/followups/{fid}/triage").json()["colour"] == "RED"
    assert caller.get(f"{API}/followups/{fid}/triage").status_code == 403
    r = caller.post(f"{API}/memberships/enroll", json={"patient_id": pid, "plan_code": "H360_PLUS", "amount_inr": 499})
    assert r.status_code == 409
    enr = doctor.post(f"{API}/care-plans/enroll", json={"patient_id": pid, "plan_code": "CP02_PREDIABETES"}).json()
    doctor.post(f"{API}/care-plans/enrollments/{enr['id']}/assess", json={"eligible": True})
    assert caller.post(f"{API}/care-plans/enrollments/{enr['id']}/pay", json={}).status_code == 409
    # the free plan is never blocked
    assert caller.get(f"{API}/patients/{pid}/memberships").status_code == 200
    assert admin.post(f"{API}/followups/{fid}/clear").status_code == 403
    cleared = doctor.post(f"{API}/followups/{fid}/clear").json()
    assert cleared["cleared"] and not cleared["plan_sale_blocked"]
    assert caller.post(f"{API}/care-plans/enrollments/{enr['id']}/pay", json={}).status_code == 200


def test_outcome_metrics_report_the_operating_metrics(admin, doctor):
    pid = new_patient()
    fid = red_followup(pid)
    doctor.post(f"{API}/followups/{fid}/clear")  # cleared straight away: inside the 60-minute target
    r = admin.get(f"{API}/outcomes/metrics")
    assert r.status_code == 200, r.text
    data = r.json()
    m = {x["key"]: x for x in data["metrics"]}
    assert set(m) == {"plan_signed_24h", "plan_active_48h", "red_doctor_call_60m", "amber_review_24h", "retest_completion",
                      "renewal_rate", "revenue_per_report", "doctor_edit_rate"}
    assert m["red_doctor_call_60m"]["numerator"] == 1 and m["red_doctor_call_60m"]["denominator"] == 1
    assert data["triage"]["RED"] == 1 and data["uncleared_red"] == 0
    assert "value" in data["north_star"]
    assert doctor.get(f"{API}/outcomes/metrics").status_code == 403


# ---------------- privacy ----------------
def test_export_and_erase_cover_memberships_enrolments_and_payments(caller, doctor):
    pid = new_patient()
    m = caller.post(f"{API}/memberships/enroll", json={"patient_id": pid, "plan_code": "H360_PLUS", "amount_inr": 499}).json()
    enr = doctor.post(f"{API}/care-plans/enroll", json={"patient_id": pid, "plan_code": "CP08_THYROID"}).json()
    doctor.post(f"{API}/care-plans/enrollments/{enr['id']}/assess", json={"eligible": True})
    doctor.post(f"{API}/care-plans/enrollments/{enr['id']}/pay", json={})
    with dbmod.SessionLocal() as db:
        out = privacy.export_patient(db, pid)
        assert [x["id"] for x in out["memberships"]] == [m["id"]]
        assert [x["id"] for x in out["plan_enrollments"]] == [enr["id"]]
        assert len(out["payments"]) == 2
        counts = privacy.erase_patient(db, pid)
        assert counts["memberships"] == 1 and counts["plan_enrollments"] == 1 and counts["payments"] == 2
        for model in (Membership, PlanEnrollment, Payment):
            assert db.scalars(select(model).where(model.patient_id == pid)).all() == []


# ---------------- scorecard and loop use real data only ----------------
def test_loop_and_scorecard_show_measured_values_or_a_dash(admin):
    pid = new_patient()
    t = today_ist()
    with dbmod.SessionLocal() as db:
        db.add_all([CareTouchpoint(patient_id=pid, stage="PREVENTION", service_code="PREVENTIVE_SCREEN", occurred_on=t, amount_inr=500),
                    CareTouchpoint(patient_id=pid, stage="DIAGNOSTICS", service_code="HOME_COLLECTION", occurred_on=t - timedelta(days=3), amount_inr=1200)])
        db.commit()
    loop = admin.get(f"{API}/relationship/loop").json()
    assert loop["revenue_ring"]["transactions_inr"] == 1700 and loop["revenue_ring"]["subscriptions_inr"] == 0
    assert loop["transaction_cohort"]["revenue_per_transaction_inr"] == 850
    assert loop["retention_rate"] == "—"  # nobody was active in the previous period
    assert loop["ami_coordination"]["steps_on_time_pct"] == "—"  # no journey steps fell due
    dims = {d["dimension"]: d for d in admin.get(f"{API}/relationship/scorecard").json()["dimensions"]}
    assert dims["AMI"]["proposed_metric"]["value"] == "—" and dims["AMI"]["data_status"] == "NOT_AVAILABLE"
    assert dims["Customer relationship"]["proposed_metric"]["value"] == "100.0%"
    assert dims["Core financial metric"]["current_metric"]["value"] == "₹850"
    assert all(d["trend"] is None for d in dims.values())


def test_loop_and_scorecard_honour_the_pages_from_to_filter(admin):
    pid = new_patient()
    with dbmod.SessionLocal() as db:
        db.add(CareTouchpoint(patient_id=pid, stage="PREVENTION", service_code="PREVENTIVE_SCREEN", occurred_on=date(2026, 1, 10), amount_inr=500))
        db.commit()
    inside = admin.get(f"{API}/relationship/loop?from=2026-01-01&to=2026-01-31").json()
    outside = admin.get(f"{API}/relationship/loop?from=2026-03-01&to=2026-03-31").json()
    assert inside["period"] == {"from": "2026-01-01", "to": "2026-01-31"} and inside["revenue_ring"]["transactions_inr"] == 500
    assert outside["revenue_ring"]["transactions_inr"] == 0
    assert admin.get(f"{API}/relationship/scorecard?from=2026-01-01&to=2026-01-31").json()["period"]["from"] == "2026-01-01"
