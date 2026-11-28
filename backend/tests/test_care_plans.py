from datetime import date, datetime, timezone
from sqlalchemy import select
from app import db as dbmod
from app.models import CarePlan, PlanEnrollment, Patient, HealthHub, User
from app.care_plans import seed_care_plans, assess_enrollment, enroll_patient, consume_entitlement, mask_plan_name

def test_care_plans_seed():
    with dbmod.SessionLocal() as db:
        seed_care_plans(db)
        plans = db.scalars(select(CarePlan)).all()
        assert len(plans) >= 11
        cp02 = db.scalar(select(CarePlan).where(CarePlan.code == "CP02_PREDIABETES"))
        assert cp02 is not None
        assert cp02.number == "02"
        assert cp02.name_en == "Prediabetes Care"
        assert cp02.entitlements["DIETITIAN_SESSION"] == 3

def test_caller_privacy_masking():
    assert mask_plan_name("CALLER", "02", "Prediabetes Care") == "Health Hub care plan 02"
    assert mask_plan_name("DOCTOR", "02", "Prediabetes Care") == "Prediabetes Care"
    assert mask_plan_name("ADMIN", "03", "Blood Pressure Care") == "Blood Pressure Care"

def test_enrollment_and_state_machine(doctor, caller):
    with dbmod.SessionLocal() as db:
        seed_care_plans(db)
        hub = HealthHub(name="Main Hub", city="Delhi")
        patient = Patient(name="Test User", name_norm="test user", gender="M", age=40)
        db.add_all([hub, patient])
        db.commit()
        pat_id, hub_id = patient.id, hub.id

    # suggested -> doctor assessed -> paid at the counter -> active
    res = doctor.post("/api/v1/care-plans/enroll", json={"patient_id": pat_id, "plan_code": "CP02_PREDIABETES", "tier": "PLUS",
                                                         "health_hub_id": hub_id})
    assert res.status_code == 200, res.text
    enr_id = res.json()["id"]
    assert res.json()["status"] == "SUGGESTED"
    assert doctor.post(f"/api/v1/care-plans/enrollments/{enr_id}/assess", json={"eligible": True}).json()["status"] == "DOCTOR_ASSESSED"
    paid = caller.post(f"/api/v1/care-plans/enrollments/{enr_id}/pay", json={"method": "COUNTER_CASH", "reference": "CASH123"})
    assert paid.status_code == 200 and paid.json()["status"] == "ACTIVE" and paid.json()["price_inr"] == 2499

    # Medical Weight Management (CP06) can be refused after assessment
    enr06_id = doctor.post("/api/v1/care-plans/enroll", json={"patient_id": pat_id, "plan_code": "CP06_MEDICAL_WEIGHT",
                                                              "tier": "PROGRAMME", "health_hub_id": hub_id}).json()["id"]
    assess_res = doctor.post(f"/api/v1/care-plans/enrollments/{enr06_id}/assess", json={"eligible": False, "note_code": "CONTRAINDICATION_PRESENT"})
    assert assess_res.status_code == 200
    assert assess_res.json()["status"] == "NOT_ELIGIBLE"
    assert caller.post(f"/api/v1/care-plans/enrollments/{enr06_id}/pay", json={}).status_code == 422

    consume_res = doctor.post(f"/api/v1/care-plans/enrollments/{enr_id}/consume", json={"entitlement_key": "DIETITIAN_SESSION", "units": 1})
    assert consume_res.status_code == 200
    assert consume_res.json()["entitlements_used"]["DIETITIAN_SESSION"] == 1
