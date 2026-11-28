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

def test_enrollment_and_state_machine(doctor):
    with dbmod.SessionLocal() as db:
        seed_care_plans(db)
        hub = db.scalar(select(HealthHub))
        if not hub:
            hub = HealthHub(name="Main Hub", city="Delhi")
            db.add(hub)
            db.flush()
        patient = db.scalar(select(Patient))
        if not patient:
            patient = Patient(name="Test User", name_norm="test user", gender="M", age=40)
            db.add(patient)
            db.flush()
        db.commit()
        pat_id = patient.id
        hub_id = hub.id

    # Enroll in Sugar Care (CP02)
    res = doctor.post("/api/v1/care-plans/enroll", json={
        "patient_id": pat_id,
        "plan_code": "CP02_PREDIABETES",
        "tier": "PLUS",
        "health_hub_id": hub_id,
        "payment_method": "COUNTER",
        "payment_reference": "CASH123"
    })
    assert res.status_code == 200, res.text
    data = res.json()
    enr_id = data["id"]
    assert data["status"] == "ACTIVE"

    # Assess Medical Weight Management (CP06) for eligibility failure
    with dbmod.SessionLocal() as db:
        doc = db.scalar(select(User).where(User.role == "DOCTOR"))
        doc_id = doc.id if doc else 1

    # Enroll in CP06
    res2 = doctor.post("/api/v1/care-plans/enroll", json={
        "patient_id": pat_id,
        "plan_code": "CP06_MEDICAL_WEIGHT",
        "tier": "PROGRAMME",
        "health_hub_id": hub_id,
        "payment_method": "UPI",
        "payment_reference": "UPI456"
    })
    assert res2.status_code == 200
    enr06_id = res2.json()["id"]

    # Assess as not eligible
    assess_res = doctor.post(f"/api/v1/care-plans/enrollments/{enr06_id}/assess", json={
        "eligible": False,
        "note_code": "CONTRAINDICATION_PRESENT"
    })
    assert assess_res.status_code == 200
    assert assess_res.json()["status"] == "NOT_ELIGIBLE"

    # Consume entitlement
    consume_res = doctor.post(f"/api/v1/care-plans/enrollments/{enr_id}/consume", json={
        "entitlement_key": "DIETITIAN_SESSION",
        "units": 1
    })
    assert consume_res.status_code == 200
    assert consume_res.json()["entitlements_used"]["DIETITIAN_SESSION"] == 1
