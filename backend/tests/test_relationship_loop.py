from datetime import date
from sqlalchemy import select
from app import db as dbmod
from app.models import Patient, CareTouchpoint, CorporateClient
from app.relationship_loop import compute_health_loop

def test_relationship_loop_computation(admin):
    with dbmod.SessionLocal() as db:
        p = Patient(name="Loop Pat", name_norm="loop pat", gender="M", age=50)
        db.add(p)
        db.flush()
        db.add(CareTouchpoint(patient_id=p.id, stage="PREVENTION", service_code="PREV_CHECK", occurred_on=date.today(), amount_inr=500))
        db.add(CareTouchpoint(patient_id=p.id, stage="DIAGNOSTICS", service_code="LAB_TEST", occurred_on=date.today(), amount_inr=1200))
        db.commit()

    res = admin.get("/api/v1/relationship/loop")
    assert res.status_code == 200, res.text
    data = res.json()
    assert "stages" in data
    assert len(data["stages"]) == 7
    assert "revenue_ring" in data
    assert "transaction_cohort" in data
    assert "ami_coordination" in data

def test_loop_rbac(admin, doctor, caller):
    assert doctor.get("/api/v1/relationship/loop").status_code == 403
    assert caller.get("/api/v1/relationship/loop").status_code == 403
