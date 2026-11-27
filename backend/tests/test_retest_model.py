"""Tests for Page 12: 7-step approved retest model, encrypted booking, bundles, auto-close, explain, KPIs, and caller safety."""
import re
from datetime import timedelta

from sqlalchemy import select

from app import callcard as cc_svc, db as dbmod, privacy
from app.analysis import load_rules
from app.models import AuditLog, CareTouchpoint, Followup, RetestRecommendation
from app.seed_data import PROTOCOL_BUNDLES, TEST_CATALOGUE
from app.timeutil import today_ist
from tests.test_followups import fu_of
from tests.test_retest import _make_report

API = "/api/v1"


def test_unapproved_plan_cannot_be_booked_then_approved_and_encrypted_home_booking(admin, caller, doctor):
    # Pending sign-off retest_protocols creates a PROTOCOL plan that is NOT clinically approved yet
    _, pid, o1 = _make_report([("HBA1C", "HbA1c", 8.2, "HIGH", "moderate", 26.0)], days_ago=95, name="Asha R", mobile="9720000001")
    fid = fu_of(o1).id

    plan = doctor.get(f"{API}/followups/{fid}/retest-plan").json()
    assert plan["approved"] is False
    assert len(plan["steps"]) == 7
    rid = plan["id"]

    # Unapproved plans cannot be booked (409) by anyone
    hubs = caller.get(f"{API}/health-hubs").json()
    assert len(hubs) >= 1
    assert caller.post(f"{API}/retest-recommendations/{rid}/book", json={"collection_mode": "HEALTH_HUB", "health_hub_id": hubs[0]["id"]}).status_code == 409

    # Only DOCTOR can approve (admin=403, caller=403)
    assert admin.post(f"{API}/retest-recommendations/{rid}/approve").status_code == 403
    assert caller.post(f"{API}/retest-recommendations/{rid}/approve").status_code == 403
    app_res = doctor.post(f"{API}/retest-recommendations/{rid}/approve")
    assert app_res.status_code == 200 and app_res.json()["approved"] is True
    assert "price_inr" not in str(app_res.json())  # price_inr is admin-only

    # Caller checks plan: sees ONLY neutral "Follow-up test", no values, no test names, no reason_text
    cal_plan = caller.get(f"{API}/followups/{fid}/retest-plan").json()
    assert cal_plan["label"] == "Follow-up test"
    assert cal_plan["approved"] is True
    cal_str = str(cal_plan).lower()
    for secret in ("8.2", "hba1c", "diabetes", "high_hba1c", "reason_text", "previous_results"):
        assert secret not in cal_str

    # Caller books HOME collection -> address is encrypted at rest and hidden from caller
    secret_addr = "42 MG Road, Indiranagar, Bengaluru"
    slot = (today_ist() + timedelta(days=2)).isoformat() + "T09:00:00+05:30"
    bk = caller.post(
        f"{API}/retest-recommendations/{rid}/book",
        json={"collection_mode": "HOME", "slot_start": slot, "address": secret_addr},
    )
    assert bk.status_code == 200
    bk_json = bk.json()
    assert bk_json["booking_status"] == "BOOKED" and bk_json["has_address"] is True
    assert "MG Road" not in str(bk_json)

    # DB holds encrypted address; privacy export decrypts it cleanly; audit never stores address
    with dbmod.SessionLocal() as db:
        row = db.get(RetestRecommendation, rid)
        assert row.address_enc and row.address_enc != secret_addr
        assert "MG Road" not in row.address_enc
        exp = privacy.export_patient(db, pid)
        assert exp["retest_recommendations"][0]["address"] == secret_addr
        audits = list(db.scalars(select(AuditLog).where(AuditLog.entity == "retest_plan")))
        assert audits and all("MG Road" not in a.entity_id for a in audits)

    # Signing off retest_protocols approves open PROTOCOL plans automatically too
    _, _, o2 = _make_report([("HBA1C", "HbA1c", 7.8, "HIGH", "moderate", 20.0)], days_ago=92, name="Bala S", mobile="9720000002")
    fid2 = fu_of(o2).id
    p2 = doctor.get(f"{API}/followups/{fid2}/retest-plan").json()
    assert p2["approved"] is False
    assert doctor.post(f"{API}/rules/retest_protocols/signoff").status_code == 200
    p2_after = doctor.get(f"{API}/followups/{fid2}/retest-plan").json()
    assert p2_after["approved"] is True
    assert doctor.post(f"{API}/retest-recommendations/{p2['id']}/book", json={"collection_mode": "HEALTH_HUB", "health_hub_id": hubs[0]["id"]}).status_code == 200


def test_auto_close_in_window_vs_late_and_explain(admin, caller, doctor):
    # Sign off protocol so protocol plans start approved
    doctor.post(f"{API}/rules/retest_protocols/signoff")
    today = today_ist()

    # Patient 1: HbA1c 95 days ago -> window is today-5 .. today-5 (or set window days_ago=95 + 90 = -5)
    # Use days_ago=90 so Day 90 window == today!
    _, pid1, o1 = _make_report([("HBA1C", "HbA1c", 8.2, "HIGH", "moderate", 26.0)], days_ago=90, name="InWin Pat", mobile="9720000003")
    fid1 = fu_of(o1).id
    hub_id = admin.get(f"{API}/health-hubs").json()[0]["id"]
    plan1 = doctor.get(f"{API}/followups/{fid1}/retest-plan").json()
    doctor.post(f"{API}/retest-recommendations/{plan1['id']}/book", json={"collection_mode": "HEALTH_HUB", "health_hub_id": hub_id})

    # Repeat report arrives today (exact in-window!) -> closes COMPLETED_IN_WINDOW & COLLECTED & triggers comparison
    r1_new, _, _ = _make_report([("HBA1C", "HbA1c", 7.1, "HIGH", "mild", 9.2)], days_ago=0, name="InWin Pat", mobile="9720000003")
    plan1_after = doctor.get(f"{API}/followups/{fid1}/retest-plan").json()
    assert plan1_after["comparison_report_id"] == r1_new
    assert plan1_after["plan_status"] == "COMPLETED_IN_WINDOW"
    assert plan1_after["booking_status"] == "COLLECTED"
    assert any(r["param_code"] == "HBA1C" and r["previous"] == 8.2 and r["current"] == 7.1 for r in plan1_after["comparison_rows"])

    # Explain sheet in EN & HI; caller refused (403); patient_message free of clinical terms
    assert caller.get(f"{API}/retest-recommendations/{plan1['id']}/explain?lang=en").status_code == 403
    exp_en = doctor.get(f"{API}/retest-recommendations/{plan1['id']}/explain?lang=en").json()
    exp_hi = doctor.get(f"{API}/retest-recommendations/{plan1['id']}/explain?lang=hi").json()
    assert exp_en["why"] and exp_en["when"] and exp_en["how_lines"]
    assert exp_hi["language"] == "hi" and exp_hi["why"]
    with dbmod.SessionLocal() as db:
        rules = load_rules(db)
        msg_en = exp_en["patient_message"]
        # Strip dates for caller-safety digit check: patient message must have no diagnosis/drug words
        assert cc_svc.check_caller_safety({"caller_script": {"opening": re.sub(r"\d{4}-\d{2}-\d{2}", "DATE", msg_en), "objection_handling": []}}, rules["caller_script_forbidden"], []) == []

    # Patient 2: HbA1c 105 days ago -> window ended 15 days ago -> report today is COMPLETED_LATE (<= 30 days after window)
    _, pid2, o2 = _make_report([("HBA1C", "HbA1c", 8.5, "HIGH", "severe", 31.0)], days_ago=105, name="Late Pat", mobile="9720000004")
    fid2 = fu_of(o2).id
    r2_new, _, _ = _make_report([("HBA1C", "HbA1c", 7.4, "HIGH", "mild", 13.8)], days_ago=0, name="Late Pat", mobile="9720000004")
    plan2_after = doctor.get(f"{API}/followups/{fid2}/retest-plan").json()
    assert plan2_after["comparison_report_id"] == r2_new
    assert plan2_after["plan_status"] == "COMPLETED_LATE"

    # Patient 3: > 30 days after window_end -> stays PLANNED
    _, pid3, o3 = _make_report([("HBA1C", "HbA1c", 8.8, "HIGH", "severe", 35.0)], days_ago=135, name="TooLate Pat", mobile="9720000005")
    fid3 = fu_of(o3).id
    _make_report([("HBA1C", "HbA1c", 7.9, "HIGH", "moderate", 21.0)], days_ago=0, name="TooLate Pat", mobile="9720000005")
    plan3_after = doctor.get(f"{API}/followups/{fid3}/retest-plan").json()
    assert plan3_after["plan_status"] == "PLANNED"
    assert plan3_after["comparison_report_id"] is None


def test_protocol_bundles_kpis_revenue_and_csv_escaping(admin, caller, doctor):
    assert {b["code"] for b in PROTOCOL_BUNDLES} == {"DIABETES", "THYROID", "LIPIDS", "IRON_DEFICIENCY_ANEMIA", "VITAMIN_D"}
    assert all("price_inr" in t for t in TEST_CATALOGUE)

    # Patient A: NO active medicines -> accepting DIABETES skips PHARMACY (3 touchpoints)
    _, pid_a, o_a = _make_report([("HBA1C", "HbA1c", 8.0, "HIGH", "moderate", 23.0)], days_ago=90, name="Kavya Menon", mobile="9720000006")
    fid_a = fu_of(o_a).id
    assert admin.post(f"{API}/followups/{fid_a}/bundles/DIABETES/accept").status_code == 403
    b_res = doctor.post(f"{API}/followups/{fid_a}/bundles/DIABETES/accept")
    assert b_res.status_code == 200
    assert b_res.json()["services"] == ["DIAGNOSTICS", "PHYSICIAN_CONSULT", "NUTRITION"]

    # Patient B: HAS active metformin (started 90d ago) -> accepting DIABETES includes PHARMACY (4 touchpoints)
    _, pid_b, o_b = _make_report([("HBA1C", "HbA1c", 8.2, "HIGH", "moderate", 26.0)], days_ago=90, name="Rohan Verma", mobile="9720000007")
    fid_b = fu_of(o_b).id
    doctor.post(f"{API}/patients/{pid_b}/medicines", json={"medicine_code": "METFORMIN", "started_on": (today_ist() - timedelta(days=90)).isoformat()})
    b_res_b = doctor.post(f"{API}/followups/{fid_b}/bundles/DIABETES/accept")
    assert b_res_b.status_code == 200 and "PHARMACY" in b_res_b.json()["services"]
    hub_id = admin.get(f"{API}/health-hubs").json()[0]["id"]
    admin.post(f"{API}/retest-recommendations/{b_res_b.json()['plan_id']}/book", json={"collection_mode": "HEALTH_HUB", "health_hub_id": hub_id})

    # Complete Patient B in window
    _make_report([("HBA1C", "HbA1c", 7.1, "HIGH", "mild", 9.2)], days_ago=0, name="Rohan Verma", mobile="9720000007")

    # Patient C: Unapproved completed-like report -> must NOT count toward approved eligibility or revenue
    _, pid_c, o_c = _make_report([("LDL", "LDL", 210.0, "HIGH", "moderate", 50.0)], days_ago=40, name="Tariq Ali", mobile="9720000008")
    fid_c = fu_of(o_c).id
    with dbmod.SessionLocal() as db:
        rec_c = db.scalar(select(RetestRecommendation).where(RetestRecommendation.followup_id == fid_c))
        if not rec_c:
            rec_c = RetestRecommendation(followup_id=fid_c, test_codes=["LIPID"], source="PROTOCOL", tests=[{"code": "LIPID", "name": "Lipid Profile", "price_inr": 600}])
            db.add(rec_c)
        rec_c.plan_status = "COMPLETED_IN_WINDOW"
        rec_c.completed_on = today_ist()
        db.commit()

    # Check KPI endpoint: ADMIN only (doctor=403, caller=403)
    assert doctor.get(f"{API}/kpis/retesting").status_code == 403
    assert caller.get(f"{API}/kpis/retesting").status_code == 403

    from_s = (today_ist() - timedelta(days=120)).isoformat()
    to_s = today_ist().isoformat()
    kpis = admin.get(f"{API}/kpis/retesting?from={from_s}&to={to_s}").json()["kpis"]
    elig = next(k for k in kpis if k["key"] == "eligibility_rate")
    comp = next(k for k in kpis if k["key"] == "completion_rate")
    rev = next(k for k in kpis if k["key"] == "repeat_revenue")

    # 3 distinct assessed patients (BundleA, BundleB, Unappr C); 2 eligible/approved (BundleA, BundleB) -> 2/3
    assert elig["numerator"] == 2 and elig["denominator"] == 3 and elig["value"] == 66.7
    # Patient B completed in window (window_end today) out of 2 approved due -> 1/2 = 50%
    assert comp["numerator"] == 1 and comp["denominator"] == 2 and comp["value"] == 50.0
    # Revenue counts ONLY Patient B (HBA1C 400 + FBS 120 = 520), EXCLUDES Patient C's unapproved 600
    assert rev["value"] == 520 and rev["denominator"] == 1

    # Filter by hub=hub_id isolates Patient B only
    k_hub = admin.get(f"{API}/kpis/retesting?from={from_s}&to={to_s}&hub={hub_id}").json()["kpis"]
    assert next(k for k in k_hub if k["key"] == "eligibility_rate")["numerator"] == 1
    assert next(k for k in k_hub if k["key"] == "repeat_revenue")["value"] == 520

    # Admin sees price_inr on plan; Doctor does not
    assert "tests_total_inr" in admin.get(f"{API}/followups/{fid_b}/retest-plan").json()
    assert "tests_total_inr" not in doctor.get(f"{API}/followups/{fid_b}/retest-plan").json()

    # CSV export + formula injection guard
    csv_res = admin.get(f"{API}/kpis/retesting.csv?from={from_s}&to={to_s}")
    assert csv_res.status_code == 200 and "Retesting eligibility rate" in csv_res.text
    from app.routers.insights import _cell
    assert _cell("=SUM(A1:A2)") == "'=SUM(A1:A2)"
    assert _cell("+cmd") == "'+cmd" and _cell("-1") == "'-1" and _cell("@evil") == "'@evil"
