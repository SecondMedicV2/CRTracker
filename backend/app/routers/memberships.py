from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import MembershipPlan, Membership, Payment, Patient, CorporateClient, User
from ..security import audit, current_user, require
from ..memberships import seed_memberships, assign_free_membership, mask_plan_name, suggest_memberships, enroll_membership, consume_membership_entitlement

router = APIRouter(tags=["memberships"])
clinical = require("ADMIN", "DOCTOR", "CALLER")
doctor_only = require("ADMIN", "DOCTOR")
admin_only = require("ADMIN")


@router.get("/membership-plans")
def list_membership_plans(request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    seed_memberships(db)
    plans = db.scalars(select(MembershipPlan).where(MembershipPlan.active.is_(True))).all()
    audit(db, request, me.id, "view", "membership_plans_list")
    out = []
    for p in plans:
        name = mask_plan_name(me.role, p.code, p.name)
        out.append({
            "id": p.id,
            "code": p.code,
            "name": name,
            "target_text": p.target_text if me.role != "CALLER" else "Member care plan",
            "price_inr_monthly": p.price_inr_monthly,
            "benefits_text": p.benefits_text,
            "includes_plan": p.includes_plan,
            "entitlements": p.entitlements if me.role != "CALLER" else []
        })
    return out


@router.get("/patients/{pid}/memberships")
def get_patient_memberships(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    patient = db.get(Patient, pid)
    if not patient:
        raise HTTPException(404, "Patient not found")
    assign_free_membership(db, patient.id)
    memberships = db.scalars(select(Membership).where(Membership.patient_id == patient.id)).all()
    suggestions = suggest_memberships(db, patient.id) if me.role != "CALLER" else []
    audit(db, request, me.id, "view", "patient_memberships", patient.id)

    out = []
    for m in memberships:
        plan = db.scalar(select(MembershipPlan).where(MembershipPlan.code == m.plan_code))
        name = mask_plan_name(me.role, m.plan_code, plan.name if plan else m.plan_code)
        out.append({
            "id": m.id,
            "plan_code": m.plan_code,
            "plan_name": name,
            "status": m.status,
            "payer": m.payer,
            "start_on": m.start_on,
            "current_period_end": m.current_period_end,
            "entitlements_used": m.entitlements_used,
        })
    return {"memberships": out, "suggestions": suggestions}


class EnrollMembershipIn(BaseModel):
    patient_id: int
    plan_code: str
    payer: str = Field("SELF", max_length=20)
    corporate_client_id: int | None = None
    health_hub_id: int | None = None
    payment_method: str = Field("COUNTER_CASH", max_length=30)
    amount_inr: int = 0
    reference: str = Field("", max_length=60)


@router.post("/memberships/enroll")
def post_enroll_membership(body: EnrollMembershipIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    patient = db.get(Patient, body.patient_id)
    if not patient:
        raise HTTPException(404, "Patient not found")
    try:
        m = enroll_membership(
            db,
            patient_id=body.patient_id,
            plan_code=body.plan_code,
            payer=body.payer,
            corporate_client_id=body.corporate_client_id,
            enrolled_by=me.id,
            health_hub_id=body.health_hub_id,
            payment_details={"amount_inr": body.amount_inr, "method": body.payment_method, "reference": body.reference}
        )
    except ValueError as err:
        raise HTTPException(422, str(err))
    audit(db, request, me.id, "enroll", "membership", m.id)
    return {"id": m.id, "status": m.status, "current_period_end": m.current_period_end}


@router.get("/corporate-billing/statements")
def get_corporate_statements(request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    clients = db.scalars(select(CorporateClient).where(CorporateClient.active.is_(True))).all()
    audit(db, request, me.id, "view", "corporate_statements")
    statements = []
    for c in clients:
        active_members = db.scalar(
            select(func.count(Membership.id))
            .where(Membership.corporate_client_id == c.id, Membership.status == "ACTIVE")
        ) or 0
        monthly_total = active_members * c.pepm_inr
        statements.append({
            "client_id": c.id,
            "client_name": c.name,
            "code": c.code,
            "pepm_inr": c.pepm_inr,
            "active_members": active_members,
            "monthly_total_inr": monthly_total
        })
    return {"statements": statements}
