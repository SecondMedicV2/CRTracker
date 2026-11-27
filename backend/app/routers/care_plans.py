from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import CarePlan, PlanEnrollment, Payment, HealthHub, Patient, User
from ..security import audit, current_user, require
from ..care_plans import mask_plan_name, assess_enrollment, enroll_patient, consume_entitlement

router = APIRouter(tags=["care_plans"])
clinical = require("ADMIN", "DOCTOR", "CALLER")
doctor_only = require("ADMIN", "DOCTOR")
admin_only = require("ADMIN")


@router.get("/care-plans")
def list_care_plans(request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    plans = db.scalars(select(CarePlan).where(CarePlan.active.is_(True)).order_by(CarePlan.number)).all()
    audit(db, request, me.id, "view", "care_plans_list")
    out = []
    for p in plans:
        name_en = mask_plan_name(me.role, p.number, p.name_en)
        name_hi = mask_plan_name(me.role, p.number, p.name_hi) if me.role != "CALLER" else f"????????? ?????? ???? ????? {p.number}"
        out.append({
            "id": p.id,
            "number": p.number,
            "code": p.code,
            "line": p.line,
            "name_en": name_en,
            "name_hi": name_hi,
            "for_text": p.for_text if me.role != "CALLER" else "Health Hub care plan",
            "colour": p.colour,
            "icon": p.icon,
            "tiers": p.tiers,
            "inclusions_plus": p.inclusions_plus if me.role != "CALLER" else [],
            "essential_covers": p.essential_covers,
            "entitlements": p.entitlements if me.role != "CALLER" else {},
            "tracked_measures": p.tracked_measures,
            "charged_separately": p.charged_separately if me.role != "CALLER" else [],
            "footnote": p.footnote,
            "qr_url": p.qr_url,
            "linked_programs": p.linked_programs,
        })
    return out


class EnrollIn(BaseModel):
    patient_id: int
    plan_code: str
    tier: str = Field("PLUS", max_length=30)
    health_hub_id: int | None = None
    payment_method: str = Field("COUNTER", max_length=20)
    payment_reference: str = Field("", max_length=60)


@router.post("/care-plans/enroll")
def post_enroll(body: EnrollIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    patient = db.get(Patient, body.patient_id)
    if not patient:
        raise HTTPException(404, "Patient not found")
    try:
        enr = enroll_patient(
            db,
            patient_id=body.patient_id,
            plan_code=body.plan_code,
            tier=body.tier,
            health_hub_id=body.health_hub_id,
            payment_details={"method": body.payment_method, "reference": body.payment_reference}
        )
    except ValueError as err:
        raise HTTPException(422, str(err))
    audit(db, request, me.id, "enroll", "plan_enrollment", enr.id)
    return {"id": enr.id, "status": enr.status, "period_start": enr.period_start, "period_end": enr.period_end, "price_inr": enr.price_inr}


@router.get("/care-plans/enrollments")
def list_enrollments(health_hub_id: int | None = None, plan_code: str | None = None, status: str | None = None,
                     request: Request = None, db: Session = Depends(get_db), me: User = Depends(clinical)):
    stmt = select(PlanEnrollment)
    if health_hub_id is not None:
        stmt = stmt.where(PlanEnrollment.health_hub_id == health_hub_id)
    if plan_code:
        stmt = stmt.where(PlanEnrollment.plan_code == plan_code)
    if status:
        stmt = stmt.where(PlanEnrollment.status == status)
    enrollments = db.scalars(stmt.order_by(PlanEnrollment.id.desc())).all()
    audit(db, request, me.id, "view", "plan_enrollments_list")
    out = []
    for e in enrollments:
        plan = db.scalar(select(CarePlan).where(CarePlan.code == e.plan_code))
        plan_number = plan.number if plan else "00"
        plan_name = mask_plan_name(me.role, plan_number, plan.name_en if plan else e.plan_code)
        out.append({
            "id": e.id,
            "patient_id": e.patient_id,
            "plan_code": e.plan_code,
            "plan_name": plan_name,
            "tier": e.tier,
            "status": e.status,
            "health_hub_id": e.health_hub_id,
            "period_start": e.period_start,
            "period_end": e.period_end,
            "price_inr": e.price_inr,
            "entitlements_used": e.entitlements_used,
        })
    return out


@router.get("/care-plans/analytics/revenue")
def get_care_plans_revenue(request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    rev_by_plan = db.execute(
        select(PlanEnrollment.plan_code, func.sum(PlanEnrollment.price_inr), func.count(PlanEnrollment.id))
        .group_by(PlanEnrollment.plan_code)
    ).all()
    rev_by_hub = db.execute(
        select(PlanEnrollment.health_hub_id, func.sum(PlanEnrollment.price_inr), func.count(PlanEnrollment.id))
        .group_by(PlanEnrollment.health_hub_id)
    ).all()
    audit(db, request, me.id, "view", "care_plans_revenue")
    return {
        "by_plan": [{"plan_code": r[0], "total_revenue": r[1] or 0, "enrollments": r[2]} for r in rev_by_plan],
        "by_hub": [{"health_hub_id": r[0], "total_revenue": r[1] or 0, "enrollments": r[2]} for r in rev_by_hub]
    }


@router.get("/care-plans/confirms")
def list_confirm_fields(request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    audit(db, request, me.id, "view", "care_plans_confirms")
    return {
        "missing_confirms": [
            {"plan_code": "CP05_LIFESTYLE_WEIGHT", "field": "hindi_name_and_essential_price", "note": "Plan 05 is not fully visible in source document"},
            {"plan_code": "CP12_MOVE", "field": "essential_physio_session_count", "note": "Essential covers fewer physio sessions (exact count not specified)"}
        ]
    }


@router.get("/care-plans/{code}")
def get_care_plan(code: str, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = db.scalar(select(CarePlan).where(CarePlan.code == code))
    if not p:
        raise HTTPException(404, "Care plan not found")
    audit(db, request, me.id, "view", "care_plan", p.id)
    return {
        "id": p.id,
        "number": p.number,
        "code": p.code,
        "line": p.line,
        "name_en": mask_plan_name(me.role, p.number, p.name_en),
        "name_hi": mask_plan_name(me.role, p.number, p.name_hi),
        "for_text": p.for_text,
        "colour": p.colour,
        "icon": p.icon,
        "tiers": p.tiers,
        "inclusions_plus": p.inclusions_plus,
        "essential_covers": p.essential_covers,
        "entitlements": p.entitlements,
        "tracked_measures": p.tracked_measures,
        "charged_separately": p.charged_separately,
        "footnote": p.footnote,
        "qr_url": p.qr_url,
        "linked_programs": p.linked_programs,
    }


class AssessIn(BaseModel):
    eligible: bool = True
    note_code: str = Field("", max_length=60)


@router.post("/care-plans/enrollments/{enrollment_id}/assess")
def post_assess(enrollment_id: int, body: AssessIn, request: Request, db: Session = Depends(get_db), me: User = Depends(doctor_only)):
    try:
        enr = assess_enrollment(db, enrollment_id, doctor_id=me.id, eligible=body.eligible, note_code=body.note_code)
    except ValueError as err:
        raise HTTPException(422, str(err))
    audit(db, request, me.id, "assess", "plan_enrollment", enr.id)
    return {"id": enr.id, "status": enr.status, "eligibility_note_code": enr.eligibility_note_code}


class ConsumeIn(BaseModel):
    entitlement_key: str = Field(max_length=50)
    units: int = 1


@router.post("/care-plans/enrollments/{enrollment_id}/consume")
def post_consume(enrollment_id: int, body: ConsumeIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    try:
        enr = consume_entitlement(db, enrollment_id, body.entitlement_key, body.units)
    except ValueError as err:
        raise HTTPException(422, str(err))
    audit(db, request, me.id, "consume", "plan_enrollment", enr.id)
    return {"id": enr.id, "entitlements_used": enr.entitlements_used}
