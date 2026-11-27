"""Tests for Page 11 condition register, suggestion rules, precedence, Page 10 targets, HTN monitoring, and audit safety."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app import db as dbmod, privacy, retest
from app.models import AuditLog, ClinicalTask, Followup, MonitoringSchedule, RuleSet
from app.seed_data import CLINICAL_TARGETS, CONDITION_PROTOCOLS, RETEST_PROTOCOLS
from app.seed_programs import PROFILE_CODES
from app.timeutil import today_ist
from tests.test_followups import A1C_SEV, fu_of
from tests.test_retest import _make_report
from tests.test_workflow import doctor as make_doctor

API = "/api/v1"


def test_condition_seed_protocols_and_profile_codes(admin):
    expected_codes = {
        "B12_DEFICIENCY", "IRON_DEFICIENCY", "PREDIABETES", "DIABETES_STABLE",
        "DIABETES_UNCONTROLLED", "HYPOTHYROID_STABLE_TREATED", "HYPERTENSION",
        "CKD", "DYSLIPIDEMIA_NEW_MED", "DYSLIPIDEMIA_STABLE",
    }
    assert set(PROFILE_CODES["conditions"]) == expected_codes
    assert {p["condition_code"] for p in CONDITION_PROTOCOLS} == expected_codes
    assert len(RETEST_PROTOCOLS) == 20
    b12 = next(p for p in CONDITION_PROTOCOLS if p["condition_code"] == "B12_DEFICIENCY")
    assert b12["repeat_b12_routine"] is False
    assert b12["timeframe_text"] == "CBC response may be checked within 1\u20132 weeks when indicated; repeat B12 is not routinely necessary after treatment"
    ckd = next(p for p in CONDITION_PROTOCOLS if p["condition_code"] == "CKD")
    assert ckd["risk_adjusted"] is True
    assert CLINICAL_TARGETS["HBA1C"]["target_value"] == 7.0
    assert admin.get(f"{API}/rules/clinical_targets").status_code == 200
    assert admin.get(f"{API}/rules/profile_codes").status_code == 200


def test_every_suggestion_rule_positive_and_negative(admin, doctor):
    today = today_ist()

    # 1. PREDIABETES: HbA1c 5.7-6.4% positive vs 5.4% negative
    _, p_pre, _ = _make_report([("HBA1C", "HbA1c", 6.0, "HIGH", "mild", 5.0)], mobile="9700000001")
    _, p_norm, _ = _make_report([("HBA1C", "HbA1c", 5.4, "NORMAL", "", 0.0)], classification="NORMAL", mobile="9700000002")
    assert "PREDIABETES" in [s["code"] for s in doctor.get(f"{API}/patients/{p_pre}/conditions").json()["suggested"]]
    assert "PREDIABETES" not in [s["code"] for s in doctor.get(f"{API}/patients/{p_norm}/conditions").json()["suggested"]]

    # 2. DIABETES_STABLE vs DIABETES_UNCONTROLLED (2 consecutive above target)
    _, p_diab, _ = _make_report([("HBA1C", "HbA1c", 6.8, "HIGH", "moderate", 19.0)], days_ago=90, name="Dia Pat", mobile="9700000003")
    s_diab = [s["code"] for s in doctor.get(f"{API}/patients/{p_diab}/conditions").json()["suggested"]]
    assert "DIABETES_STABLE" in s_diab and "DIABETES_UNCONTROLLED" not in s_diab

    # Confirm stable, add 1 result above target -> does NOT switch to uncontrolled on single result
    doctor.post(f"{API}/patients/{p_diab}/conditions", json={"code": "DIABETES_STABLE"})
    _make_report([("HBA1C", "HbA1c", 7.3, "HIGH", "moderate", 28.0)], days_ago=30, name="Dia Pat", mobile="9700000003")
    assert "DIABETES_UNCONTROLLED" not in [s["code"] for s in doctor.get(f"{API}/patients/{p_diab}/conditions").json()["suggested"]]

    # Add 2nd consecutive result above target -> now suggests DIABETES_UNCONTROLLED
    _make_report([("HBA1C", "HbA1c", 7.5, "HIGH", "severe", 31.0)], days_ago=1, name="Dia Pat", mobile="9700000003")
    s_diab2 = doctor.get(f"{API}/patients/{p_diab}/conditions").json()["suggested"]
    assert any(s["code"] == "DIABETES_UNCONTROLLED" and s["replaces_code"] == "DIABETES_STABLE" for s in s_diab2)

    # 3. HYPOTHYROID on levothyroxine (abnormal vs in-range; negative without levothyroxine)
    _, p_tsh_nomed, _ = _make_report([("TSH", "TSH", 9.0, "HIGH", "moderate", 50.0)], mobile="9700000004")
    assert "HYPOTHYROID_STABLE_TREATED" not in [s["code"] for s in doctor.get(f"{API}/patients/{p_tsh_nomed}/conditions").json()["suggested"]]

    _, p_thy, _ = _make_report([("TSH", "TSH", 9.0, "HIGH", "moderate", 50.0)], days_ago=40, name="Thy Pat", mobile="9700000005")
    doctor.post(f"{API}/patients/{p_thy}/medicines", json={"medicine_code": "LEVOTHYROXINE", "started_on": (today - timedelta(days=50)).isoformat()})
    s_thy_abn = [s for s in doctor.get(f"{API}/patients/{p_thy}/conditions").json()["suggested"] if s["code"] == "HYPOTHYROID_STABLE_TREATED"]
    assert s_thy_abn and s_thy_abn[0]["stage"] == "ABNORMAL_ON_TREATMENT"

    _make_report([("TSH", "TSH", 2.4, "NORMAL", "", 0.0)], days_ago=2, name="Thy Pat", mobile="9700000005", classification="NORMAL")
    s_thy_ok = [s for s in doctor.get(f"{API}/patients/{p_thy}/conditions").json()["suggested"] if s["code"] == "HYPOTHYROID_STABLE_TREATED"]
    assert s_thy_ok and s_thy_ok[0]["stage"] == "STABLE"

    # 4. CKD: eGFR < 60 or UACR high on 2 results >= 90 days apart (negative: 1 result or < 90 days apart)
    _, p_ckd_short, _ = _make_report([("EGFR", "eGFR", 52.0, "LOW", "moderate", 13.0)], days_ago=40, name="Ckd Short", mobile="9700000006")
    assert "CKD" not in [s["code"] for s in doctor.get(f"{API}/patients/{p_ckd_short}/conditions").json()["suggested"]]
    _make_report([("UACR", "UACR", 95.0, "HIGH", "moderate", 200.0)], days_ago=10, name="Ckd Short", mobile="9700000006")  # only 30 days apart
    assert "CKD" not in [s["code"] for s in doctor.get(f"{API}/patients/{p_ckd_short}/conditions").json()["suggested"]]

    _, p_ckd_ok, _ = _make_report([("EGFR", "eGFR", 52.0, "LOW", "moderate", 13.0)], days_ago=120, name="Ckd Long", mobile="9700000007")
    _make_report([("UACR", "UACR", 95.0, "HIGH", "moderate", 200.0)], days_ago=5, name="Ckd Long", mobile="9700000007")  # 115 days apart >= 90
    assert "CKD" in [s["code"] for s in doctor.get(f"{API}/patients/{p_ckd_ok}/conditions").json()["suggested"]]

    # 5. Dyslipidemia: new lipid med <= 12w -> NEW_MED, > 12w -> STABLE, no med -> negative
    _, p_lip_none, _ = _make_report([("LDL", "LDL", 170.0, "HIGH", "moderate", 30.0)], mobile="9700000008")
    s_lip_none = [s["code"] for s in doctor.get(f"{API}/patients/{p_lip_none}/conditions").json()["suggested"]]
    assert "DYSLIPIDEMIA_NEW_MED" not in s_lip_none and "DYSLIPIDEMIA_STABLE" not in s_lip_none

    doctor.post(f"{API}/patients/{p_lip_none}/medicines", json={"medicine_code": "ATORVASTATIN", "started_on": (today - timedelta(days=20)).isoformat()})
    s_lip_new = [s["code"] for s in doctor.get(f"{API}/patients/{p_lip_none}/conditions").json()["suggested"]]
    assert "DYSLIPIDEMIA_NEW_MED" in s_lip_new and "DYSLIPIDEMIA_STABLE" not in s_lip_new

    _, p_lip_old, _ = _make_report([("LDL", "LDL", 110.0, "NORMAL", "", 0.0)], classification="NORMAL", mobile="9700000009")
    doctor.post(f"{API}/patients/{p_lip_old}/medicines", json={"medicine_code": "ATORVASTATIN", "started_on": (today - timedelta(days=120)).isoformat()})
    s_lip_old = [s["code"] for s in doctor.get(f"{API}/patients/{p_lip_old}/conditions").json()["suggested"]]
    assert "DYSLIPIDEMIA_STABLE" in s_lip_old and "DYSLIPIDEMIA_NEW_MED" not in s_lip_old

    # 6. B12_DEFICIENCY: low B12 positive vs normal B12 negative
    _, p_b12, _ = _make_report([("B12", "Vitamin B12", 140.0, "LOW", "moderate", 30.0)], mobile="9700000010")
    assert "B12_DEFICIENCY" in [s["code"] for s in doctor.get(f"{API}/patients/{p_b12}/conditions").json()["suggested"]]
    assert "B12_DEFICIENCY" not in [s["code"] for s in doctor.get(f"{API}/patients/{p_norm}/conditions").json()["suggested"]]

    # 7. IRON_DEFICIENCY: low ferritin or (low iron + low Hb); negative: low Hb alone or low iron alone
    _, p_ferr, _ = _make_report([("FERRITIN", "Ferritin", 8.0, "LOW", "moderate", 40.0)], mobile="9700000011")
    assert "IRON_DEFICIENCY" in [s["code"] for s in doctor.get(f"{API}/patients/{p_ferr}/conditions").json()["suggested"]]
    _, p_ir_hb, _ = _make_report([("IRON", "Serum Iron", 30.0, "LOW", "moderate", 35.0), ("HEMOGLOBIN", "Hb", 9.8, "LOW", "moderate", 20.0)], mobile="9700000012")
    assert "IRON_DEFICIENCY" in [s["code"] for s in doctor.get(f"{API}/patients/{p_ir_hb}/conditions").json()["suggested"]]
    _, p_hb_only, _ = _make_report([("HEMOGLOBIN", "Hb", 9.8, "LOW", "moderate", 20.0)], mobile="9700000013")
    assert "IRON_DEFICIENCY" not in [s["code"] for s in doctor.get(f"{API}/patients/{p_hb_only}/conditions").json()["suggested"]]
    _, p_iron_only, _ = _make_report([("IRON", "Serum Iron", 30.0, "LOW", "moderate", 35.0)], mobile="9700000014")
    assert "IRON_DEFICIENCY" not in [s["code"] for s in doctor.get(f"{API}/patients/{p_iron_only}/conditions").json()["suggested"]]

    # 8. HYPERTENSION: BP >= 140/90 positive vs 120/80 negative
    doctor.put(f"{API}/patients/{p_norm}/health-profile", json={"vitals": {"bp_readings": [{"systolic": 120, "diastolic": 80, "where": "CLINIC"}]}})
    assert "HYPERTENSION" not in [s["code"] for s in doctor.get(f"{API}/patients/{p_norm}/conditions").json()["suggested"]]
    doctor.put(f"{API}/patients/{p_norm}/health-profile", json={"vitals": {"bp_readings": [{"systolic": 146, "diastolic": 94, "where": "CLINIC"}]}})
    assert "HYPERTENSION" in [s["code"] for s in doctor.get(f"{API}/patients/{p_norm}/conditions").json()["suggested"]]


def test_doctor_only_condition_management_and_audit_safety(admin, caller, doctor):
    _, pid, _ = _make_report([("HBA1C", "HbA1c", 6.1, "HIGH", "mild", 7.0)], name="Rani Verma", mobile="9711100001")

    # Caller gets 403 on GET/POST/DELETE; Admin gets 200 on GET, 403 on POST/DELETE and condition mutation via health-profile
    assert caller.get(f"{API}/patients/{pid}/conditions").status_code == 403
    assert caller.post(f"{API}/patients/{pid}/conditions", json={"code": "PREDIABETES"}).status_code == 403
    assert caller.delete(f"{API}/patients/{pid}/conditions/PREDIABETES").status_code == 403

    assert admin.get(f"{API}/patients/{pid}/conditions").status_code == 200
    assert admin.post(f"{API}/patients/{pid}/conditions", json={"code": "PREDIABETES"}).status_code == 403
    assert admin.delete(f"{API}/patients/{pid}/conditions/PREDIABETES").status_code == 403
    assert admin.put(f"{API}/patients/{pid}/health-profile", json={"conditions": [{"code": "PREDIABETES", "status": "CONFIRMED"}]}).status_code == 403

    # Admin updating unrelated health profile fields keeps working cleanly
    assert admin.put(f"{API}/patients/{pid}/health-profile", json={"vitals": {"height_cm": 165, "weight_kg": 66}}).status_code == 200

    # Doctor confirms, switches stage, and removes -> audited with codes only (no PII or numeric values)
    r1 = doctor.post(f"{API}/patients/{pid}/conditions", json={"code": "PREDIABETES"})
    assert r1.status_code == 200 and r1.json()["confirmed"][0]["confirmed_by"] is not None
    r2 = doctor.post(f"{API}/patients/{pid}/conditions", json={"code": "DIABETES_STABLE"})
    assert r2.status_code == 200 and [c["code"] for c in r2.json()["confirmed"]] == ["DIABETES_STABLE"]
    r3 = doctor.delete(f"{API}/patients/{pid}/conditions/DIABETES_STABLE")
    assert r3.status_code == 200 and r3.json()["confirmed"] == []

    with dbmod.SessionLocal() as db:
        logs = db.scalars(select(AuditLog).where(AuditLog.entity == "patient_condition")).all()
        actions = {l.action: l.entity_id for l in logs}
        assert actions["condition_confirm"] == f"{pid}:PREDIABETES"
        assert actions["condition_stage_change"] == f"{pid}:PREDIABETES->DIABETES_STABLE"
        assert actions["condition_remove"] == f"{pid}:DIABETES_STABLE"
        blob = " ".join(f"{l.action} {l.entity} {l.entity_id}" for l in logs)
        assert "Rani" not in blob and "9711100001" not in blob and "6.1" not in blob


def test_condition_protocol_precedence_and_diabetes_target_switch(admin, caller, doctor):
    today = today_ist()
    # 1. Patient with HIGH_CREATININE: Page 7 gives URGENT DOCTOR_TO_SET; confirming CKD overrides to LONG_TERM <= 365d
    oid_cr, pid_cr, _ = _make_report([("CREATININE", "Creatinine", 1.8, "HIGH", "moderate", 35.0), ("EGFR", "eGFR", 50.0, "LOW", "moderate", 16.0)], days_ago=10, mobile="9722200001")
    f_cr = fu_of(oid_cr)
    assert f_cr.protocol_tier == "URGENT" and f_cr.retest_status == "DOCTOR_TO_SET"

    doctor.post(f"{API}/patients/{pid_cr}/conditions", json={"code": "CKD"})
    fu_after = admin.get(f"{API}/followups/{f_cr.id}").json()
    assert fu_after["protocol_tier"] == "LONG_TERM"
    assert fu_after["retest_status"] == "AUTO_SCHEDULED"
    assert fu_after["retest_plan"]["primary_finding"]["condition_code"] == "CKD"
    assert "HIGH_CREATININE" in fu_after["retest_plan"]["overridden_findings"]
    collected_cr = today - timedelta(days=10)
    assert (datetime.fromisoformat(fu_after["retest_window_end"]).date() - collected_cr).days <= 365

    # Removing CKD restores Page 7 HIGH_CREATININE finding protocol
    doctor.delete(f"{API}/patients/{pid_cr}/conditions/CKD")
    fu_rev = admin.get(f"{API}/followups/{f_cr.id}").json()
    assert fu_rev["protocol_tier"] == "URGENT" and fu_rev["retest_status"] == "DOCTOR_TO_SET"

    # 2. Diabetes target switch follows Page 10 targets (default < 7.0 vs per-patient override < 6.5)
    oid_d, pid_d, _ = _make_report([("HBA1C", "HbA1c", 6.6, "HIGH", "moderate", 16.0)], days_ago=95, name="Target Pat", mobile="9722200002")
    oid_d2, _, _ = _make_report([("HBA1C", "HbA1c", 6.8, "HIGH", "moderate", 19.0)], days_ago=5, name="Target Pat", mobile="9722200002")
    # With default < 7.0, 6.8 is at target -> DIABETES_STABLE suggested (and confirming overrides HIGH_HBA1C 90d -> 180d)
    assert "DIABETES_STABLE" in [s["code"] for s in doctor.get(f"{API}/patients/{pid_d}/conditions").json()["suggested"]]
    doctor.post(f"{API}/patients/{pid_d}/conditions", json={"code": "DIABETES_STABLE"})
    f_d = admin.get(f"{API}/followups/{fu_of(oid_d2).id}").json()
    # Confirming DIABETES_STABLE sets 180-day window & caller sees "Monitoring due on <date>"
    assert f_d["retest_plan"]["primary_finding"]["condition_code"] == "DIABETES_STABLE"
    assert f_d["retest_window_start"] == (today - timedelta(days=5) + timedelta(days=180)).isoformat()

    cal_row = next(x for x in caller.get(f"{API}/followups").json() if x["id"] == f_d["id"])
    assert cal_row["retest_label"] == f"Monitoring due on {f_d['retest_window_start']}"
    assert "DIABETES" not in str(cal_row).upper()
    admin.post(f"{API}/followups/{f_d['id']}/call-card/generate")
    card = caller.get(f"{API}/followups/{f_d['id']}/caller-card").json()
    assert card["monitoring_due"] == f"Monitoring due on {f_d['retest_window_start']}"

    # Lower per-patient target to < 6.5% -> both 6.6 and 6.8 are above target -> switches suggestion to DIABETES_UNCONTROLLED
    doctor.put(f"{API}/patients/{pid_d}/health-profile", json={"targets": {"HBA1C": {"target_op": "<", "target_value": 6.5}}})
    sug_override = doctor.get(f"{API}/patients/{pid_d}/conditions").json()["suggested"]
    assert any(s["code"] == "DIABETES_UNCONTROLLED" and s["replaces_code"] == "DIABETES_STABLE" for s in sug_override)

    # Confirming DIABETES_UNCONTROLLED switches protocol to 90d METABOLIC
    doctor.post(f"{API}/patients/{pid_d}/conditions", json={"code": "DIABETES_UNCONTROLLED"})
    f_d2 = admin.get(f"{API}/followups/{f_d['id']}").json()
    assert f_d2["protocol_tier"] == "METABOLIC"
    assert f_d2["retest_window_start"] == (today - timedelta(days=5) + timedelta(days=90)).isoformat()


def test_hypertension_bp_schedule_doctor_task_and_privacy_erase(admin, caller, doctor):
    make_doctor(admin, "Dr HTN")
    oid, pid, _ = _make_report([A1C_SEV], days_ago=5, name="BP Pat", mobile="9733300001")
    doctor.put(f"{API}/patients/{pid}/health-profile", json={"vitals": {"bp_readings": [{"systolic": 152, "diastolic": 96, "where": "CLINIC"}]}})

    res = doctor.post(f"{API}/patients/{pid}/conditions", json={"code": "HYPERTENSION"})
    assert res.status_code == 200
    body = res.json()
    assert len(body["monitoring_schedules"]) == 1
    ms = body["monitoring_schedules"][0]
    assert ms["kind"] == "BP" and ms["frequency_per_day"] == 2 and ms["duration_days"] == 7 and ms["status"] == "ACTIVE"
    assert len(body["clinical_tasks"]) == 1
    task = body["clinical_tasks"][0]
    assert task["task_type"] == "CHOOSE_LAB_TESTS" and task["status"] == "OPEN"

    # Reminder tick sends home BP / check-in reminder once per day
    with dbmod.SessionLocal() as db:
        assert retest.reminder_tick(db) >= 1
        assert retest.reminder_tick(db) == 0

    # Admin & caller cannot complete doctor task; doctor selects tests and completes it
    assert caller.post(f"{API}/clinical-tasks/{task['id']}/complete", json={"test_codes": ["KFT", "UACR"]}).status_code == 403
    assert admin.post(f"{API}/clinical-tasks/{task['id']}/complete", json={"test_codes": ["KFT", "UACR"]}).status_code == 403
    done = doctor.post(f"{API}/clinical-tasks/{task['id']}/complete", json={"test_codes": ["KFT", "UACR"]})
    assert done.status_code == 200 and done.json()["selected_tests"] == ["KFT", "UACR"] and done.json()["status"] == "DONE"

    # Privacy export & erase covers monitoring_schedules and clinical_tasks
    with dbmod.SessionLocal() as db:
        exp = privacy.export_patient(db, pid)
        assert len(exp["monitoring_schedules"]) == 1 and len(exp["clinical_tasks"]) == 1
        privacy.erase_patient(db, pid)
        assert db.scalar(select(func.count()).select_from(MonitoringSchedule).where(MonitoringSchedule.patient_id == pid)) == 0
        assert db.scalar(select(func.count()).select_from(ClinicalTask).where(ClinicalTask.patient_id == pid)) == 0
