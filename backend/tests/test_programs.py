from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app import callcard as cc, db as dbmod, pipeline, privacy, status, storage
from app.analysis import load_rules
from app.models import (AuditLog, CareTouchpoint, HealthProfile, ImportBatch, Notification, Order, Patient,
                        PatientBucket, ProgramRecommendation, Report, ReportParameter)
from app.timeutil import today_ist
from tests.test_followups import A1C_SEV, HB_OK, fu_of, make
from tests.test_workflow import doctor as make_doctor

API = "/api/v1"
_seq = [0]


def make_patient_report(params, *, age=35, gender="M", name="Test Patient", mobile="9876509000", days_ago=1):
    _seq[0] += 1
    with dbmod.SessionLocal() as db:
        b = db.scalar(select(ImportBatch)) or ImportBatch(source="manual")
        db.add(b)
        db.flush()
        o = Order(order_id_external=f"P{_seq[0]}", batch_id=b.id, status=status.EXTRACTING)
        db.add(o)
        db.flush()
        collected = datetime.now(timezone.utc) - timedelta(days=days_ago)
        rep = Report(
            order_id=o.id, patient_name=name, age=age, gender=gender, collected_on=collected,
            mobile_enc=storage.encrypt_str(mobile),
            classification="ABNORMAL" if any(p[2] in ("LOW", "HIGH") for p in params) else "NORMAL",
        )
        db.add(rep)
        db.flush()
        for code, val, flag in params:
            db.add(ReportParameter(
                report_id=rep.id, param_code=code, param_name_raw=code, value_num=val,
                value_text=str(val), system_flag=flag, severity="mild" if flag in ("LOW", "HIGH") else "",
            ))
        db.flush()
        pipeline.conclude(db, o, rep)
        db.commit()
        return o.patient_id, rep.id


def codes_for(doctor, pid):
    r = doctor.get(f"{API}/patients/{pid}/programs")
    assert r.status_code == 200
    return {x["program_code"]: x for x in r.json() if x["status"] != "EXPIRED"}


def set_profile(doctor, pid, data):
    r = doctor.put(f"{API}/patients/{pid}/health-profile", json=data)
    assert r.status_code == 200
    return r.json()


def test_page2_wellness_programmes_positive_negative_and_missing_data(doctor):
    # Negative baseline: young patient, normal labs, recent screening, normal BMI, active lifestyle, no symptoms
    p_neg, _ = make_patient_report([("HEMOGLOBIN", 14.0, "NORMAL")], age=25, gender="M")
    # Missing profile data produces missing_data on BMI/activity without crashing
    m_initial = codes_for(doctor, p_neg)
    assert "VITAMIN_PLAN" not in m_initial and "STRESS_PLAN" not in m_initial

    recent = today_ist().isoformat()
    set_profile(doctor, p_neg, {
        "vitals": {"height_cm": 175, "weight_kg": 64},  # BMI 20.9
        "lifestyle": {"activity_level": "ACTIVE"},
        "functional_status": "INDEPENDENT",
        "screening_history": [{"screen_code": "ANNUAL", "done_on": recent}],
    })
    assert codes_for(doctor, p_neg) == {}

    # Positive cases for 1..8
    p_pos, _ = make_patient_report([
        ("VITAMIN_D", 14.0, "LOW"), ("HBA1C", 7.1, "HIGH"), ("LDL", 170.0, "HIGH")
    ], age=62, gender="F")
    prof = set_profile(doctor, p_pos, {
        "vitals": {"height_cm": 160, "weight_kg": 78},  # BMI 30.5 computed server-side
        "lifestyle": {"activity_level": "SEDENTARY"},
        "physical_limitations": ["JOINT_PROBLEM"],
        "functional_status": "NEEDS_SOME_HELP",
        "family_history": ["DIABETES"],
        "symptoms": ["POOR_SLEEP", "HIGH_STRESS"],
    })
    assert prof["vitals"]["bmi"] == 30.5
    got = codes_for(doctor, p_pos)
    for code in ("VITAMIN_PLAN", "DIET_PLAN", "PREVENTIVE_PLAN", "WEIGHT_PLAN",
                 "FITNESS_PLAN", "SLEEP_PLAN", "STRESS_PLAN", "HEALTHY_AGING_PLAN"):
        assert code in got, f"Expected {code} to trigger"
    assert "doctor clearance needed" in got["FITNESS_PLAN"]["notes"]


def test_page3_disease_management_and_kidney_once(doctor):
    with dbmod.SessionLocal() as db:
        progs = load_rules(db)["care_programs"]
        assert sum(1 for p in progs if p["code"] == "KIDNEY_HEALTH") == 1

    # Negative baseline
    p_neg, _ = make_patient_report([("HBA1C", 5.2, "NORMAL"), ("TSH", 2.0, "NORMAL"), ("UACR", 10.0, "NORMAL")], age=32, gender="M")
    set_profile(doctor, p_neg, {"vitals": {"bp_readings": [{"systolic": 120, "diastolic": 78, "where": "CLINIC"}]}})
    neg_codes = set(codes_for(doctor, p_neg))
    for code in ("DIABETES_MGMT", "CARDIAC_RISK_MGMT", "HYPERTENSION_MGMT", "THYROID_MGMT",
                 "KIDNEY_HEALTH", "LIVER_HEALTH", "ANEMIA_MGMT", "BONE_HEALTH"):
        assert code not in neg_codes

    # Positive disease cases + UACR alias + BP-only HYPERTENSION_MGMT + Bone age/gender branch
    p_dis, _ = make_patient_report([
        ("HBA1C", 7.4, "HIGH"), ("TRIGLYCERIDES", 220.0, "HIGH"), ("TSH", 8.5, "HIGH"),
        ("UACR", 45.0, "HIGH"), ("SGPT", 80.0, "HIGH"), ("HEMOGLOBIN", 10.5, "LOW"), ("VITAMIN_D", 15.0, "LOW"),
    ], age=46, gender="F")
    set_profile(doctor, p_dis, {
        "vitals": {"bp_readings": [
            {"systolic": 138, "diastolic": 88, "where": "HOME"},
            {"systolic": 136, "diastolic": 86, "where": "HOME"},
        ]},
    })
    got = codes_for(doctor, p_dis)
    for code in ("DIABETES_MGMT", "CARDIAC_RISK_MGMT", "HYPERTENSION_MGMT", "THYROID_MGMT",
                 "KIDNEY_HEALTH", "LIVER_HEALTH", "ANEMIA_MGMT", "BONE_HEALTH"):
        assert code in got, f"Expected {code}"
    assert got["DIABETES_MGMT"]["is_primary_for_bucket"] is True

    # Regression check: existing VIT_D_B12 bucket assignment unchanged alongside HYPERTENSION bucket
    with dbmod.SessionLocal() as db:
        buckets = {b.bucket_code for b in db.scalars(select(PatientBucket).where(PatientBucket.patient_id == p_dis, PatientBucket.active))}
        assert {"VIT_D_B12", "DIABETES", "LIPID", "THYROID", "KIDNEY", "LIVER", "ANAEMIA", "HYPERTENSION", "BONE"} <= buckets


def test_page4_specialized_programs_guards_and_glp1(doctor):
    with dbmod.SessionLocal() as db:
        glp1 = next(p for p in load_rules(db)["care_programs"] if p["code"] == "GLP1_WEIGHT_ASSESSMENT")
        txt = glp1["offering_text"].lower()
        assert "eligibility is decided by a physician in person" in txt
        for drug in ("semaglutide", "liraglutide", "tirzepatide", "ozempic", "wegovy", "mounjaro"):
            assert drug not in txt

    # Male patient 35y: never gets WOMENS_HEALTH, PCOS_MGMT, MENS_HEALTH (<40), or SENIOR_CARE (<60)
    p_m35, _ = make_patient_report([("HEMOGLOBIN", 10.0, "LOW"), ("TG", 220.0, "HIGH")], age=35, gender="M")
    set_profile(doctor, p_m35, {
        "symptoms": ["IRREGULAR_PERIODS", "FATIGUE"],
        "vitals": {"height_cm": 170, "weight_kg": 82},  # BMI 28.4 + TG HIGH -> GLP1_WEIGHT_ASSESSMENT
    })
    m35 = codes_for(doctor, p_m35)
    assert "WOMENS_HEALTH" not in m35 and "PCOS_MGMT" not in m35 and "MENS_HEALTH" not in m35 and "SENIOR_CARE" not in m35
    assert "GLP1_WEIGHT_ASSESSMENT" in m35

    # Female 28y with irregular periods + LH:FSH >= 2.0 -> PCOS_MGMT + WOMENS_HEALTH (via HB LOW + symptom)
    p_f28, _ = make_patient_report([("HEMOGLOBIN", 10.5, "LOW"), ("LH", 14.0, "NORMAL"), ("FSH", 5.0, "NORMAL")], age=28, gender="F")
    set_profile(doctor, p_f28, {
        "reproductive": {"menstrual_pattern": "IRREGULAR", "planning_pregnancy": True},
        "symptoms": ["FATIGUE"],
    })
    f28 = codes_for(doctor, p_f28)
    assert {"WOMENS_HEALTH", "PCOS_MGMT", "FERTILITY_PRECONCEPTION"} <= set(f28)

    # Male 45y + Senior 65y with medicine_count >= 5
    p_m65, _ = make_patient_report([("HBA1C", 7.5, "HIGH")], age=65, gender="M")
    set_profile(doctor, p_m65, {"medicine_count": 6})
    m65 = codes_for(doctor, p_m65)
    assert {"MENS_HEALTH", "SENIOR_CARE"} <= set(m65)
    assert "WOMENS_HEALTH" not in m65 and "PCOS_MGMT" not in m65


def test_decisions_idempotency_and_privacy_isolation(admin, doctor, caller):
    make_doctor(admin, "Dr Prog")
    p_id, _ = make_patient_report([("HBA1C", 7.4, "HIGH"), ("AMH", 0.4, "LOW")], age=32, gender="F", name="Sita Devi", mobile="9876543219")
    set_profile(doctor, p_id, {"reproductive": {"planning_pregnancy": True}, "symptoms": ["HIGH_STRESS"]})

    # Caregiver phone requires consent
    r_bad = doctor.put(f"{API}/patients/{p_id}/health-profile", json={"caregiver": {"name": "Ram", "phone": "9999988888", "phone_consent": False}})
    assert r_bad.status_code == 422

    # Caller privacy: 403 on health-profile & decisions; DOCTOR_CONSIDER absent from caller /programs & caller-card
    assert caller.get(f"{API}/patients/{p_id}/health-profile").status_code == 403
    assert caller.put(f"{API}/patients/{p_id}/health-profile", json={}).status_code == 403
    cal_progs = caller.get(f"{API}/patients/{p_id}/programs")
    assert cal_progs.status_code == 200
    assert all(set(x) == {"caller_label", "status"} for x in cal_progs.json())
    assert not any("consultation" in x["caller_label"].lower() for x in cal_progs.json())

    # Caller card excludes DOCTOR_CONSIDER
    with dbmod.SessionLocal() as db:
        fid = db.scalar(select(fu_of_id := __import__("app.models", fromlist=["Followup"]).Followup.id).where(
            __import__("app.models", fromlist=["Followup"]).Followup.patient_id == p_id
        ))
    admin.post(f"{API}/followups/{fid}/call-card/generate")
    cc_json = caller.get(f"{API}/followups/{fid}/caller-card").json()
    assert "Doctor consultation follow-up" not in cc_json["program_followups"]
    assert "Doctor follow-up plan" in cc_json["program_followups"]

    # Notifications say only "New consider item"
    notes = doctor.get(f"{API}/notifications").json()["items"]
    assert any(n["text"] == "New consider item" for n in notes)
    assert not any("FERTILITY_PRECONCEPTION" in n["text"] or "STRESS_PLAN" in n["text"] or "Sita" in n["text"] for n in notes)

    # All caller_labels pass caller safety
    with dbmod.SessionLocal() as db:
        rules = load_rules(db)
        for p in rules["care_programs"]:
            assert cc.check_caller_safety(
                {"caller_script": {"opening": p["caller_label"], "identity_check": "x", "free_followup_pitch": "x",
                                   "consent_request": "x", "slot_offer": "x", "urgent_symptom_protocol": "x", "closing": "x",
                                   "objection_handling": []}},
                rules["caller_script_forbidden"],
                [t["name"] for t in rules["test_catalogue"]],
            ) == []

    # Doctor decisions: Not suitable requires reason_code on DOCTOR_CONSIDER; Accept creates care_touchpoint; idempotent re-eval keeps decision
    doc_progs = codes_for(doctor, p_id)
    fert = doc_progs["FERTILITY_PRECONCEPTION"]
    stress = doc_progs["STRESS_PLAN"]
    assert caller.post(f"{API}/program-recommendations/{fert['id']}/decision", json={"decision": "ACCEPTED"}).status_code == 403
    assert doctor.post(f"{API}/program-recommendations/{stress['id']}/decision", json={"decision": "DECLINED"}).status_code == 422
    assert doctor.post(f"{API}/program-recommendations/{stress['id']}/decision", json={"decision": "DECLINED", "reason_code": "PATIENT_DECLINED"}).status_code == 200
    acc = doctor.post(f"{API}/program-recommendations/{fert['id']}/decision", json={"decision": "ACCEPTED"})
    assert acc.status_code == 200 and acc.json()["suggested_specialty"] == "Fertility specialist"

    # Re-evaluating profile does not overwrite ACCEPTED or DECLINED
    set_profile(doctor, p_id, {"reproductive": {"planning_pregnancy": True}, "symptoms": ["HIGH_STRESS", "FATIGUE"]})
    after = codes_for(doctor, p_id)
    assert after["FERTILITY_PRECONCEPTION"]["status"] == "ACCEPTED"
    assert after["STRESS_PLAN"]["status"] == "DECLINED"

    # Audit log has no programme codes or patient PII; HealthProfile encrypted in DB
    with dbmod.SessionLocal() as db:
        hp = db.scalar(select(HealthProfile).where(HealthProfile.patient_id == p_id))
        assert "HIGH_STRESS" not in hp.payload_enc
        assert db.scalar(select(CareTouchpoint).where(
            CareTouchpoint.patient_id == p_id, CareTouchpoint.ref_entity == "program_recommendation",
            CareTouchpoint.ref_id == fert["id"], CareTouchpoint.stage == "CONSULTATIONS"
        )) is not None
        audits = " ".join(f"{a.action}:{a.entity}:{a.entity_id}" for a in db.scalars(select(AuditLog)))
        for secret in ("FERTILITY_PRECONCEPTION", "STRESS_PLAN", "Sita", "9876543219"):
            assert secret not in audits
        exp = privacy.export_patient(db, p_id)
        assert exp["health_profiles"] and exp["program_recommendations"]
        privacy.erase_patient(db, p_id)
        assert db.scalar(select(HealthProfile).where(HealthProfile.patient_id == p_id)) is None
        assert db.scalar(select(ProgramRecommendation).where(ProgramRecommendation.patient_id == p_id)) is None
