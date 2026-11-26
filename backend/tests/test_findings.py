"""Page 6: 10 shared diagnostic findings & ranked Primary->Secondary->Third combinations tests."""
from sqlalchemy import select

from app import callcard as cc, db as dbmod, findings, pipeline, status, storage
from app.analysis import load_rules
from app.models import Followup, ImportBatch, Order, ProgramRecommendation, Report, ReportParameter
from tests.test_extended_programs import _seed
from tests.test_workflow import doctor as make_doctor

API = "/api/v1"


def test_all_10_findings_positive_negative_and_severity_order(doctor):
    # 1. Patient with 9 findings (LOW_VITD, HIGH_HBA1C severe, HIGH_CHOLESTEROL, HIGH_TSH, LOW_HB, HIGH_CREATININE, ABNORMAL_LFT, OBESITY_METABOLIC, MULTI_CHRONIC)
    p_all = [
        {"code": "VITD", "name": "Vitamin D", "value": 12, "flag": "LOW", "severity": "mild"},
        {"code": "HBA1C", "name": "HbA1c", "value": 9.8, "flag": "HIGH", "severity": "severe"},
        {"code": "LDL", "name": "LDL", "value": 180, "flag": "HIGH", "severity": "moderate"},
        {"code": "TSH", "name": "TSH", "value": 7.5, "flag": "HIGH", "severity": "mild"},
        {"code": "HB", "name": "Haemoglobin", "value": 10.5, "flag": "LOW", "severity": "mild"},
        {"code": "CREAT", "name": "Creatinine", "value": 1.8, "flag": "HIGH", "severity": "moderate"},
        {"code": "ALT", "name": "SGPT", "value": 78, "flag": "HIGH", "severity": "mild"},
    ]
    pid, rid, fid = _seed(p_all, name="Multi Finding", mobile="9876590001", age=48, gender="M")
    assert doctor.put(f"{API}/patients/{pid}/health-profile", json={"vitals": {"height_cm": 170, "weight_kg": 81}}).status_code == 200

    with dbmod.SessionLocal() as db:
        codes = findings.detect(db, pid, rid)
        db.commit()
    assert set(codes) == {
        "LOW_VITD", "HIGH_HBA1C", "HIGH_CHOLESTEROL", "HIGH_TSH", "LOW_HB",
        "HIGH_CREATININE", "ABNORMAL_LFT", "OBESITY_METABOLIC", "MULTI_CHRONIC",
    }
    assert "NORMAL_WITH_RISK" not in codes
    # Severe finding HIGH_HBA1C must come before mild findings like LOW_VITD / HIGH_TSH
    assert codes[0] == "HIGH_HBA1C"

    # 2. Normal report with risk (age >= 40) vs normal report without risk
    pid_nr, rid_nr, _ = _seed([{"code": "GLU_F", "name": "FBS", "value": 88, "flag": "NORMAL"}],
                              name="Risk Normal", mobile="9876590002", age=45, gender="M")
    pid_clean, rid_clean, _ = _seed([{"code": "GLU_F", "name": "FBS", "value": 88, "flag": "NORMAL"}],
                                    name="Clean Young", mobile="9876590003", age=25, gender="F")
    assert doctor.put(f"{API}/patients/{pid_clean}/health-profile", json={
        "vitals": {"height_cm": 165, "weight_kg": 56}, "lifestyle": {"activity_level": "ACTIVE"}
    }).status_code == 200
    with dbmod.SessionLocal() as db:
        assert findings.detect(db, pid_nr, rid_nr) == ["NORMAL_WITH_RISK"]
        assert findings.detect(db, pid_clean, rid_clean) == []


def test_order_if_prescribed_gating_and_target_merge(doctor):
    # HIGH_HBA1C + HIGH_TSH without meds -> both IF_PRESCRIBED items hidden
    pid, rid, fid = _seed([
        {"code": "HBA1C", "name": "HbA1c", "value": 7.6, "flag": "HIGH", "severity": "moderate"},
        {"code": "TSH", "name": "TSH", "value": 7.2, "flag": "HIGH", "severity": "mild"},
    ], name="Gating Test", mobile="9876590004", age=42, gender="F")

    r1 = doctor.get(f"{API}/followups/{fid}/recommendations")
    assert r1.status_code == 200
    rows1 = {row["finding_code"]: row for row in r1.json()["combinations"]}
    assert rows1["HIGH_HBA1C"]["primary"]["label"] == "Diabetes plan"
    assert rows1["HIGH_HBA1C"]["secondary"]["label"] == "Personalized diet"
    assert rows1["HIGH_HBA1C"]["third"] is None
    assert rows1["HIGH_TSH"]["secondary"] is None

    # Add METFORMIN (BIGUANIDE -> matches HIGH_HBA1C, NOT HIGH_TSH THYROID_HORMONE)
    assert doctor.post(f"{API}/patients/{pid}/medicines", json={"medicine_code": "METFORMIN"}).status_code == 201
    rows2 = {row["finding_code"]: row for row in doctor.get(f"{API}/followups/{fid}/recommendations").json()["combinations"]}
    assert rows2["HIGH_HBA1C"]["third"]["label"] == "Medication review/refill if prescribed"
    assert rows2["HIGH_TSH"]["secondary"] is None

    # Merging test: HIGH_CREATININE (MED_REVIEW rank 2) + HIGH_HBA1C (MED_REVIEW rank 3) -> single row keeping higher rank (2)
    pid_m, rid_m, fid_m = _seed([
        {"code": "HBA1C", "name": "HbA1c", "value": 8.0, "flag": "HIGH", "severity": "moderate"},
        {"code": "CREAT", "name": "Creatinine", "value": 1.9, "flag": "HIGH", "severity": "moderate"},
    ], name="Merge Test", mobile="9876590005", age=55, gender="M")
    assert doctor.post(f"{API}/patients/{pid_m}/medicines", json={"medicine_code": "METFORMIN"}).status_code == 201
    with dbmod.SessionLocal() as db:
        recs = list(db.scalars(select(ProgramRecommendation).where(
            ProgramRecommendation.report_id == rid_m, ProgramRecommendation.program_code == "MED_REVIEW"
        )))
        assert len(recs) == 1 and recs[0].rank == 2


def test_caller_isolation_rule_signoff_and_dashboard_funnel(admin, doctor, caller):
    make_doctor(admin, "Dr Combo")
    pid, _, fid = _seed([
        {"code": "VITD", "name": "Vitamin D", "value": 14, "flag": "LOW", "severity": "moderate"},
    ], name="Funnel Pat", mobile="9876590006", age=34, gender="M")

    # Caller blocked from /followups/{fid}/recommendations; sees only neutral next_steps on caller-card
    assert caller.get(f"{API}/followups/{fid}/recommendations").status_code == 403
    assert admin.post(f"{API}/followups/{fid}/call-card/generate").status_code == 201
    assert doctor.post(f"{API}/call-cards/{fid}/approve").status_code == 200
    card = caller.get(f"{API}/followups/{fid}/caller-card").json()
    assert len(card["next_steps"]) == 3
    blob = " ".join(card["next_steps"]).lower()
    assert "vitamin" not in blob and "vitd" not in blob and "bone" not in blob

    # All combination caller_labels pass check_caller_safety
    with dbmod.SessionLocal() as db:
        rules = load_rules(db)
        for f_code, c_def in rules["recommendation_combinations"].items():
            for slot in ("primary", "secondary", "third"):
                lbl = c_def[slot]["caller_label"]
                assert cc.check_caller_safety(
                    {"caller_script": {"opening": lbl, "identity_check": "x", "free_followup_pitch": "x",
                                       "consent_request": "x", "slot_offer": "x", "urgent_symptom_protocol": "x", "closing": "x",
                                       "objection_handling": []}},
                    rules["caller_script_forbidden"],
                    [t["name"] for t in rules["test_catalogue"]],
                ) == [], f"Unsafe label {lbl} for {f_code}.{slot}"

    # Accept primary -> dashboard conversion funnel shows 100% primary acceptance
    recs = doctor.get(f"{API}/followups/{fid}/recommendations").json()["combinations"]
    prim_id = recs[0]["primary"]["recommendation_id"]
    assert doctor.post(f"{API}/program-recommendations/{prim_id}/decision", json={"decision": "ACCEPTED"}).status_code == 200
    dash = admin.get(f"{API}/dashboard").json()
    vit_row = next(x for x in dash["finding_funnel"] if x["finding_code"] == "LOW_VITD")
    assert vit_row["patients"] == 1 and vit_row["primary_pct"] == 100 and vit_row["secondary_pct"] == 0

    # RuleSet edits create pending_signoff version, doctor signoff clears it
    for key in ("diagnostic_findings", "recommendation_combinations"):
        cur = admin.get(f"{API}/rules/{key}").json()
        upd = admin.put(f"{API}/rules/{key}", json={"data": cur["data"]})
        assert upd.status_code == 200 and upd.json()["version"] == cur["version"] + 1 and upd.json()["pending_signoff"] is True
        so = doctor.post(f"{API}/rules/{key}/signoff")
        assert so.status_code == 200 and so.json()["pending_signoff"] is False
