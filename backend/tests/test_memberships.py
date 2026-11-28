from datetime import date
from sqlalchemy import select
from app import db as dbmod
from app.models import Patient, MembershipPlan, Membership, CorporateClient, PatientBucket
from app.memberships import seed_memberships, assign_free_membership, suggest_memberships, enroll_membership, consume_membership_entitlement, mask_plan_name

def test_memberships_seed_and_free():
    with dbmod.SessionLocal() as db:
        seed_memberships(db)
        p = Patient(name="Free Member", name_norm="free member", gender="M", age=30)
        db.add(p)
        db.flush()
        assign_free_membership(db, p.id)
        m = db.scalar(select(Membership).where(Membership.patient_id == p.id))
        assert m is not None
        assert m.plan_code == "H360_FREE"

def test_eligibility_suggestions():
    with dbmod.SessionLocal() as db:
        seed_memberships(db)
        # Senior patient (age 65)
        p_sen = Patient(name="Senior Pat", name_norm="senior pat", gender="F", age=65)
        db.add(p_sen)
        db.flush()
        sug_sen = suggest_memberships(db, p_sen.id)
        assert "H360_SENIOR" in sug_sen

        # Chronic patient (Diabetes bucket)
        p_chr = Patient(name="Chronic Pat", name_norm="chronic pat", gender="M", age=45)
        db.add(p_chr)
        db.flush()
        db.add(PatientBucket(patient_id=p_chr.id, report_id=1, bucket_code="DIABETES"))
        db.commit()
        sug_chr = suggest_memberships(db, p_chr.id)
        assert "H360_CHRONIC" in sug_chr

def test_caller_privacy_masking():
    assert mask_plan_name("CALLER", "H360_CHRONIC", "Health360 Chronic") == "Health360 Care"
    assert mask_plan_name("DOCTOR", "H360_CHRONIC", "Health360 Chronic") == "Health360 Chronic"
    assert mask_plan_name("CALLER", "H360_PLUS", "Health360 Plus") == "Health360 Plus"

def test_entitlement_consumption(admin):
    with dbmod.SessionLocal() as db:
        seed_memberships(db)
        p = Patient(name="Plus Member", name_norm="plus member", gender="M", age=40)
        db.add(p)
        db.flush()
        m = enroll_membership(db, p.id, "H360_PLUS", payer="SELF", payment_details={"amount_inr": 499})
        mid = m.id

    with dbmod.SessionLocal() as db:
        consume_membership_entitlement(db, mid, "TELECONSULT")
        m_updated = db.get(Membership, mid)
        assert m_updated.entitlements_used["TELECONSULT"] == 1

def test_corporate_statements(admin, doctor, caller):
    with dbmod.SessionLocal() as db:
        seed_memberships(db)
        corp = CorporateClient(name="Corp Health", code="CORPH", pepm_inr=150, covered_members=50)
        db.add(corp)
        db.flush()
        p = Patient(name="Emp 1", name_norm="emp 1", corporate_client_id=corp.id)
        db.add(p)
        db.flush()
        m = Membership(patient_id=p.id, plan_code="H360_CORPORATE", payer="CORPORATE", corporate_client_id=corp.id, start_on=date.today(), current_period_end=date.today(), status="ACTIVE")
        db.add(m)
        db.commit()

    res = admin.get("/api/v1/corporate-billing/statements")
    assert res.status_code == 200
    data = res.json()
    assert len(data["statements"]) >= 1
    st = next(s for s in data["statements"] if s["code"] == "CORPH")
    assert st["active_members"] == 1
    assert st["monthly_total_inr"] == 150

    # RBAC checks
    assert doctor.get("/api/v1/corporate-billing/statements").status_code == 403
    assert caller.get("/api/v1/corporate-billing/statements").status_code == 403
