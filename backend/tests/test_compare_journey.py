"""Tests for Page 10: AMI Parameter Display comparison, clinical targets, HBA1C_90 journey, and caller privacy."""
import re
from datetime import timedelta

from sqlalchemy import select

from app import callcard as cc_svc, compare as compare_svc, db as dbmod, journeys as journey_svc
from app.analysis import load_rules
from app.models import AuditLog, CallCard, Followup, ReportParameter, RetestRecommendation
from app.seed_data import JOURNEY_TEMPLATES, NEXT_ACTION_RULES
from app.timeutil import today_ist
from tests.test_followups import fu_of
from tests.test_retest import _make_report as _base_make_report

API = "/api/v1"
MED_OR_DOSE_TERMS = (
    "metformin", "glimepiride", "gliclazide", "insulin", "atorvastatin", "rosuvastatin",
    "levothyroxine", "increase dose", "decrease dose", "start medication", "mg once daily", "mg twice daily",
)


def _make_report(params, **kwargs):
    unit_map = {p[0]: p[6] for p in params if len(p) > 6}
    clean = [p[:6] for p in params]
    rid, pid, oid = _base_make_report(clean, **kwargs)
    if unit_map:
        with dbmod.SessionLocal() as db:
            for row in db.scalars(select(ReportParameter).where(ReportParameter.report_id == rid)):
                if row.param_code in unit_map:
                    row.unit = unit_map[row.param_code]
            db.commit()
    return rid, pid, oid


def test_hba1c_slide_example_targets_and_next_actions(admin, doctor):
    # First report: HbA1c 8.2 %
    r1, pid, _ = _make_report([("HBA1C", "HbA1c", 8.2, "HIGH", "moderate", 26.0, "%")], days_ago=95, name="Meera K", mobile="9710000001")
    # Second report (Day 90): HbA1c 7.1 %
    r2, _, _ = _make_report([("HBA1C", "HbA1c", 7.1, "HIGH", "mild", 9.2, "%")], days_ago=5, name="Meera K", mobile="9710000001")

    with dbmod.SessionLocal() as db:
        rows = compare_svc.compare(db, pid, r2)
    a1c = next(x for x in rows if x["param_code"] == "HBA1C")
    assert a1c["previous"] == 8.2
    assert a1c["current"] == 7.1
    assert a1c["change_display"] == "\u22121.1 percentage points"
    assert a1c["target_status"] == "Above target"
    assert a1c["change_status"] == "Improved"
    assert a1c["next_action"] == "Continue clinical follow-up"
    assert a1c["trend"] is None  # only 2 points so far

    # Endpoint check + third report: worsening back to 8.3 % -> Trend + Doctor review
    res_api = doctor.get(f"{API}/reports/{r2}/compare").json()
    assert res_api["rows"][0]["change_display"] == "\u22121.1 percentage points"
    assert doctor.get(f"{API}/patients/{pid}/compare").json()["report_id"] == r2

    r3, _, _ = _make_report([("HBA1C", "HbA1c", 8.9, "HIGH", "moderate", 36.9, "%")], days_ago=1, name="Meera K", mobile="9710000001")
    res3 = doctor.get(f"{API}/reports/{r3}/compare").json()["rows"][0]
    assert res3["target_status"] == "Above target"
    assert res3["change_status"] == "Worsened"
    assert res3["next_action"] == "Doctor review"
    assert res3["trend"] == "Negative trend"

    # At target (< 7.0 %) -> "Continue current plan; routine monitoring" and positive 3-point trend from [8.3, ...] -> [8.2, 7.1, 6.6]?
    # Test 3-point positive trend cleanly on another patient: 9.0 -> 8.2 -> 6.6
    _make_report([("HBA1C", "HbA1c", 9.0, "HIGH", "severe", 38.0, "%")], days_ago=180, name="Ravi T", mobile="9710000002")
    _make_report([("HBA1C", "HbA1c", 8.2, "HIGH", "moderate", 26.0, "%")], days_ago=90, name="Ravi T", mobile="9710000002")
    r_goal, p_goal, _ = _make_report([("HBA1C", "HbA1c", 6.6, "HIGH", "mild", 1.5, "%")], days_ago=2, name="Ravi T", mobile="9710000002")
    row_goal = doctor.get(f"{API}/reports/{r_goal}/compare").json()["rows"][0]
    assert row_goal["target_status"] == "At target"
    assert row_goal["change_status"] == "Improved"
    assert row_goal["trend"] == "Positive trend"
    assert row_goal["next_action"] == "Continue current plan; routine monitoring"

    # Per-patient target override set by Doctor (< 6.5) flips 6.6 from At target -> Above target; Admin rejected (403)
    assert admin.put(f"{API}/patients/{p_goal}/health-profile", json={"targets": {"HBA1C": {"target_op": "<", "target_value": 6.5}}}).status_code == 403
    assert doctor.put(f"{API}/patients/{p_goal}/health-profile", json={"targets": {"HBA1C": {"target_op": "<", "target_value": 6.5}}}).status_code == 200
    row_strict = doctor.get(f"{API}/reports/{r_goal}/compare").json()["rows"][0]
    assert row_strict["target_status"] == "Above target"
    assert row_strict["next_action"] == "Continue clinical follow-up"


def test_higher_is_better_units_differ_min_change_and_trend(doctor):
    # 1. HIGHER_IS_BETTER (HDL & HEMOGLOBIN/HB) + change below min_meaningful_change + 3-point trend
    _make_report([
        ("HDL", "HDL Cholesterol", 32.0, "LOW", "moderate", 20.0, "mg/dL"),
        ("HEMOGLOBIN", "Haemoglobin", 10.5, "LOW", "moderate", 19.2, "g/dL"),
        ("HBA1C", "HbA1c", 8.2, "HIGH", "moderate", 26.0, "%"),
    ], days_ago=180, name="Anil P", mobile="9710000003")
    r2, _, _ = _make_report([
        ("HDL", "HDL Cholesterol", 43.0, "NORMAL", "", 0.0, "mg/dL"),
        ("HB", "Hemoglobin", 10.7, "LOW", "mild", 17.7, "g/dL"),  # synonym + delta +0.2 < min_mc 0.5 -> No meaningful change
        ("HBA1C", "HbA1c", 7.9, "HIGH", "moderate", 21.5, "%"),   # delta -0.3 < min_mc 0.5 -> No meaningful change
    ], days_ago=90, name="Anil P", mobile="9710000003")

    rows2 = {r["param_code"]: r for r in doctor.get(f"{API}/reports/{r2}/compare").json()["rows"]}
    assert rows2["HDL"]["direction"] == "HIGHER_IS_BETTER"
    assert rows2["HDL"]["target_status"] == "At target"
    assert rows2["HDL"]["change_status"] == "Improved"
    assert rows2["HDL"]["change_display"] == "+11 mg/dL"
    assert rows2["HDL"]["trend"] is None  # < 3 points

    assert rows2["HB"]["previous"] == 10.5
    assert rows2["HB"]["change_status"] == "No meaningful change"
    assert rows2["HB"]["target_status"] == "Below target"

    assert rows2["HBA1C"]["change_status"] == "No meaningful change"
    assert rows2["HBA1C"]["next_action"] == "Individualized"  # above target & no meaningful change

    # 3rd report -> HBA1C 8.0 -> net over 3 points [8.2, 7.9, 8.0] = -0.2 (< 0.5 min_mc) -> "Stable"; HDL [32, 43, 48] -> "Positive trend"
    r3, _, _ = _make_report([
        ("HDL", "HDL Cholesterol", 48.0, "NORMAL", "", 0.0, "mg/dL"),
        ("HBA1C", "HbA1c", 8.0, "HIGH", "moderate", 23.0, "%"),
    ], days_ago=2, name="Anil P", mobile="9710000003")
    rows3 = {r["param_code"]: r for r in doctor.get(f"{API}/reports/{r3}/compare").json()["rows"]}
    assert rows3["HDL"]["trend"] == "Positive trend"
    assert rows3["HBA1C"]["trend"] == "Stable"

    # 2. Units differ -> not compared
    _make_report([("HBA1C", "HbA1c", 66.0, "HIGH", "moderate", 30.0, "mmol/mol")], days_ago=40, name="Unit Pat", mobile="9710000004")
    ru, _, _ = _make_report([("HBA1C", "HbA1c", 7.8, "HIGH", "moderate", 20.0, "%")], days_ago=1, name="Unit Pat", mobile="9710000004")
    ru_row = doctor.get(f"{API}/reports/{ru}/compare").json()["rows"][0]
    assert ru_row["units_differ"] is True
    assert ru_row["change_abs"] is None
    assert ru_row["change_display"] == "Units differ \u2014 not compared"
    assert ru_row["change_status"] == "Units differ \u2014 not compared"
    assert ru_row["trend"] is None


def test_hba1c90_journey_glucose_adherence_day90_and_safety(admin, caller, doctor):
    # Non-HbA1c finding selects STANDARD_92
    r_chol, _, _ = _make_report([("LDL", "LDL Cholesterol", 190.0, "HIGH", "moderate", 46.0, "mg/dL")], days_ago=10, name="Chol Pat", mobile="9710000005")
    j_chol = doctor.get(f"{API}/reports/{r_chol}/compare").json()["journey"]
    assert j_chol["template_code"] == "STANDARD_92"

    # HIGH_HBA1C selects HBA1C_90 with 5 chevrons
    r_d0, pid, o_d0 = _make_report([("HBA1C", "HbA1c", 8.2, "HIGH", "moderate", 26.0, "%")], days_ago=95, name="Sita D", mobile="9710000006")
    fid = fu_of(o_d0).id

    comp_fu = doctor.get(f"{API}/followups/{fid}/compare").json()
    j = comp_fu["journey"]
    assert j["template_code"] == "HBA1C_90"
    assert [s["code"] for s in j["steps"]] == ["HBA1C_D0", "HBA1C_D1_7", "HBA1C_D7_30", "HBA1C_D30_60", "HBA1C_D90"]
    assert j["steps"][0]["status"] == "DONE"
    assert j["initial_hba1c"] == 8.2
    d30 = next(s for s in j["steps"] if s["code"] == "HBA1C_D30_60")
    assert d30["what_happens"].endswith(journey_svc.CLINICAL_DISCLAIMER)
    assert j["disclaimer"] == journey_svc.CLINICAL_DISCLAIMER

    # Day 7-30: staff-entered reading vs home reading; Day 30-60: call + refill adherence
    doctor.post(f"{API}/patients/{pid}/home-readings", json={"kind": "GLUCOSE_FASTING", "values": {"value": 152}})
    j_staff = doctor.get(f"{API}/followups/{fid}/compare").json()["journey"]
    assert j_staff["glucose_monitoring"]["source"] == "staff_entered"

    # Add a home CSV reading (source=CSV_IMPORT) -> prefers home_readings and computes glucose trend
    csv_bytes = f"date,kind,value\n{(today_ist() - timedelta(days=20)).isoformat()},GLUCOSE_FASTING,134\n".encode()
    assert doctor.post(f"{API}/patients/{pid}/home-readings/import", files={"file": ("glu.csv", csv_bytes, "text/csv")}).status_code == 201
    med_res = doctor.post(f"{API}/patients/{pid}/medicines", json={"medicine_code": "METFORMIN", "refill_every_days": 30})
    assert med_res.status_code == 201
    refill_id = med_res.json()["refill"]["id"]
    assert caller.post(f"{API}/refill-schedules/{refill_id}/confirm", json={"delivery_ref": "REF-1"}).status_code == 200
    assert admin.post(f"{API}/doctors", json={"name": "Dr A", "languages": ["en"]}).status_code == 201
    assert caller.post(f"{API}/followups/{fid}/consent").status_code == 201
    slot = (today_ist() + timedelta(days=2)).isoformat() + "T10:00:00+05:30"
    assert caller.post(f"{API}/followups/{fid}/calls", json={"outcome": "BOOKED", "slot_start": slot, "notes": "called"}).status_code == 201
    j_adh = doctor.get(f"{API}/followups/{fid}/compare").json()["journey"]
    assert j_adh["glucose_monitoring"]["source"] == "home_readings"
    assert j_adh["glucose_monitoring"]["direction"] is not None
    assert j_adh["adherence"]["status"] == "ON_TRACK"
    assert j_adh["adherence"]["calls_logged"] >= 1
    assert j_adh["adherence"]["refill_confirmations"] >= 1

    # Day 90 clinically appropriate gate: only DOCTOR allowed (admin=403, caller=403)
    assert admin.post(f"{API}/followups/{fid}/journey/day90-confirm", json={"clinically_appropriate": False}).status_code == 403
    assert caller.post(f"{API}/followups/{fid}/journey/day90-confirm", json={"clinically_appropriate": False}).status_code == 403

    res_false = doctor.post(f"{API}/followups/{fid}/journey/day90-confirm", json={"clinically_appropriate": False})
    assert res_false.status_code == 200 and res_false.json()["journey"]["day90_clinically_appropriate"] is False
    assert res_false.json()["journey"]["day90_retest_created"] is False

    res_true = doctor.post(f"{API}/followups/{fid}/journey/day90-confirm", json={"clinically_appropriate": True})
    assert res_true.status_code == 200 and res_true.json()["journey"]["day90_clinically_appropriate"] is True
    assert res_true.json()["journey"]["day90_retest_created"] is True

    # Repeat HbA1c arrives (7.1 %) -> Day 0 journey completes Day 90 with new_hba1c == 7.1, and new report compares 8.2 -> 7.1
    r_d90, _, _ = _make_report([("HBA1C", "HbA1c", 7.1, "HIGH", "mild", 9.2, "%")], days_ago=1, name="Sita D", mobile="9710000006")
    fu0_after = doctor.get(f"{API}/followups/{fid}/compare").json()
    assert fu0_after["journey"]["new_hba1c"] == 7.1
    assert any(s["code"] == "HBA1C_D90" and s["status"] == "DONE" for s in fu0_after["journey"]["steps"])
    final_comp = doctor.get(f"{API}/reports/{r_d90}/compare").json()
    assert final_comp["rows"][0]["change_display"] == "\u22121.1 percentage points"

    # No medicine or dose suggestion anywhere in compare/journey/printable output
    blob = (str(final_comp) + str(fu0_after) + str(JOURNEY_TEMPLATES) + str(NEXT_ACTION_RULES)).lower()
    for banned in MED_OR_DOSE_TERMS:
        assert banned not in blob


def test_caller_privacy_and_audit_on_compare_and_journey(admin, caller, doctor):
    r1, pid, _ = _make_report([("HBA1C", "HbA1c", 8.2, "HIGH", "moderate", 26.0, "%")], days_ago=95, name="Kavita M", mobile="9710000007")
    r2, _, o2 = _make_report([("HBA1C", "HbA1c", 7.1, "HIGH", "severe", 26.0, "%")], days_ago=3, name="Kavita M", mobile="9710000007")
    fid2 = fu_of(o2).id

    # Caller gets 403 on all clinical compare/journey endpoints & Page 10 RuleSets
    for ep in (f"/reports/{r2}/compare", f"/followups/{fid2}/compare", f"/patients/{pid}/compare",
               "/rules/next_action_rules", "/rules/journey_templates"):
        assert caller.get(f"{API}{ep}").status_code == 403

    # Seed approved call card & check caller views see ONLY neutral comparison notice + date, no values/drugs/markers
    with dbmod.SessionLocal() as db:
        rules = load_rules(db)
        f2 = db.get(Followup, fid2)
        c = cc_svc.generate(db, f2, 3)
        c.validation_status = "VALID"
        c.doctor_approved_by = 3
        from datetime import datetime, timezone
        c.doctor_approved_at = datetime.now(timezone.utc)
        db.commit()
        for step in JOURNEY_TEMPLATES["templates"]["HBA1C_90"]["steps"]:
            errs = cc_svc.check_caller_safety(
                {"caller_script": {"opening": step["caller_label"], "objection_handling": []}},
                rules["caller_script_forbidden"],
                [],
            )
            assert errs == []

    fus_caller = caller.get(f"{API}/followups").json()
    mine = next(x for x in fus_caller if x["id"] == fid2)
    assert mine["comparison_notice"] == "Results compared \u2014 doctor review scheduled"
    assert mine["comparison_date"]
    assert "retest_plan" not in mine and "finding_codes" not in mine

    cc_res = caller.get(f"{API}/followups/{fid2}/caller-card")
    assert cc_res.status_code == 200
    cc_data = cc_res.json()
    assert cc_data["comparison_notice"] == "Results compared \u2014 doctor review scheduled"
    assert not re.search(r"\d", cc_data["comparison_notice"])
    assert cc_data["comparison_date"]
    assert cc_data["journey_caller_label"]
    cc_str = str(cc_data).lower()
    for secret in ("8.2", "7.1", "above target", "improved", "hba1c_90", "diabetes", "metformin", "insulin"):
        assert secret not in cc_str

    # Audit log has entries without any PII or lab values
    doctor.get(f"{API}/reports/{r2}/compare")
    with dbmod.SessionLocal() as db:
        audits = list(db.scalars(select(AuditLog).where(AuditLog.entity.in_(("report_compare", "followup_compare", "patient_compare")))))
        assert audits
        for a in audits:
            assert "Kavita" not in a.entity_id and "8.2" not in a.entity_id and "7.1" not in a.entity_id
