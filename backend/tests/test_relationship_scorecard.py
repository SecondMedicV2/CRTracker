from datetime import date
from sqlalchemy import select
from app import db as dbmod
from app.models import Patient, CareTouchpoint, CorporateClient, ExpressNode, HealthHub
from app.relationship_scorecard import compute_relationship_scorecard

def test_relationship_scorecard_computation(admin):
    with dbmod.SessionLocal() as db:
        # Create test patient and touchpoints
        p = Patient(name="Scorecard Test", name_norm="scorecard test", gender="M", age=45)
        db.add(p)
        db.flush()
        db.add(CareTouchpoint(patient_id=p.id, stage="AWARENESS", service_code="TEST_VISIT", occurred_on=date.today()))
        db.add(CareTouchpoint(patient_id=p.id, stage="ENGAGEMENT", service_code="FOLLOWUP", occurred_on=date.today()))
        db.commit()

    res = admin.get("/api/v1/relationship/scorecard")
    assert res.status_code == 200, res.text
    data = res.json()
    assert "dimensions" in data
    assert len(data["dimensions"]) == 12

    dim0 = data["dimensions"][0]
    assert dim0["dimension"] == "Customer relationship"
    assert "current_model" in dim0
    assert "proposed_model" in dim0
    assert "proposed_metric" in dim0

def test_small_cell_suppression(admin):
    with dbmod.SessionLocal() as db:
        corp = CorporateClient(name="Small Corp", code="SCorp", covered_members=3)
        db.add(corp)
        db.flush()
        p = Patient(name="Corp Pat", name_norm="corp pat", corporate_client_id=corp.id)
        db.add(p)
        db.commit()
        corp_id = corp.id

    res = admin.get(f"/api/v1/relationship/scorecard?corporate_id={corp_id}")
    assert res.status_code == 200
    data = res.json()
    corp_dim = next(d for d in data["dimensions"] if d["dimension"] == "Corporate clients")
    assert corp_dim["proposed_metric"]["value"] == "< 10"
    assert corp_dim["data_status"] == "PARTIAL"

def test_channel_crud_and_rbac(admin, doctor, caller):
    # Express nodes CRUD
    res = admin.post("/api/v1/express-nodes", json={"name": "Express Pharma", "code": "EP1", "node_type": "PHARMACY", "city": "Delhi"})
    assert res.status_code == 201
    node_id = res.json()["id"]

    res_list = admin.get("/api/v1/express-nodes")
    assert res_list.status_code == 200
    assert any(n["code"] == "EP1" for n in res_list.json())

    # Corporate clients CRUD
    res_corp = admin.post("/api/v1/corporate-clients", json={"name": "Tech Corp", "code": "TECH", "pepm_inr": 500, "covered_members": 150, "contact": "hr@tech.com"})
    assert res_corp.status_code == 201

    # RBAC: doctor and caller forbidden on scorecard and channel CRUD
    assert doctor.get("/api/v1/relationship/scorecard").status_code == 403
    assert caller.get("/api/v1/relationship/scorecard").status_code == 403
    assert doctor.get("/api/v1/express-nodes").status_code == 403
    assert caller.get("/api/v1/express-nodes").status_code == 403
