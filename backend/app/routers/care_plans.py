from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..care_plans import (CONFIRMS, assess_enrollment, consume_entitlement, create_plan, mask_plan_name, pay_enrollment, plan_out,
                          suggest_enrollment, update_plan)
from ..db import get_db
from ..models import CarePlan, CareTouchpoint, Patient, PlanEnrollment, User
from ..outcomes import PlanSaleBlocked
from ..security import audit, require

router = APIRouter(tags=["care_plans"])
clinical = require("ADMIN", "DOCTOR", "CALLER")
doctor_admin = require("ADMIN", "DOCTOR")
doctor_assess = require("DOCTOR")
admin_only = require("ADMIN")


def _err(err: Exception):
    if isinstance(err, PlanSaleBlocked):
        raise HTTPException(409, str(err))
    if isinstance(err, LookupError):
        raise HTTPException(404, str(err))
    raise HTTPException(422, str(err))


@router.get("/care-plans")
def list_care_plans(request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    plans = db.scalars(select(CarePlan).where(CarePlan.active.is_(True)).order_by(CarePlan.number)).all()
    audit(db, request, me.id, "view", "care_plans_list")
    return [plan_out(p, me.role) for p in plans]


class TierIn(BaseModel):
    tier: str = Field(max_length=20)
    price_inr: int = Field(ge=0, le=1_000_000)
    period: str = Field(max_length=20)
    annual_price_inr: int | None = Field(None, ge=0, le=10_000_000)


class PlanEditIn(BaseModel):
    line: str | None = Field(None, max_length=80)
    name_en: str | None = Field(None, max_length=150)
    name_hi: str | None = Field(None, max_length=150)
    for_text: str | None = Field(None, max_length=500)
    colour: str | None = Field(None, max_length=30)
    icon: str | None = Field(None, max_length=50)
    tiers: list[TierIn] | None = None
    inclusions_plus: list[str] | None = None
    essential_covers: str | None = Field(None, max_length=500)
    entitlements: dict[str, int] | None = None
    tracked_measures: list[str] | None = None
    charged_separately: list[str] | None = None
    footnote: str | None = Field(None, max_length=1000)
    qr_url: str | None = Field(None, max_length=200)
    linked_programs: list[str] | None = None
    active: bool | None = None


class PlanCreateIn(PlanEditIn):
    code: str = Field(min_length=3, max_length=60, pattern="^[A-Z0-9_]+$")
    number: str = Field(min_length=1, max_length=10)
    name_en: str = Field(min_length=1, max_length=150)


@router.post("/care-plans", status_code=201)
def post_care_plan(body: PlanCreateIn, request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    try:
        p = create_plan(db, body.model_dump(exclude_none=True))
    except ValueError as err:
        _err(err)
    audit(db, request, me.id, "create", "care_plan", p.code)
    return plan_out(p, me.role)


@router.patch("/care-plans/{code}")
def patch_care_plan(code: str, body: PlanEditIn, request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    changes = body.model_dump(exclude_none=True)
    try:
        p = update_plan(db, code, changes)
    except (ValueError, LookupError) as err:
        _err(err)
    audit(db, request, me.id, "edit", "care_plan", f"{p.code}:{','.join(sorted(changes))}")
    return plan_out(p, me.role)


def _enr_out(db: Session, e: PlanEnrollment, role: str) -> dict:
    plan = db.scalar(select(CarePlan).where(CarePlan.code == e.plan_code))
    number = plan.number if plan else "00"
    out = {"id": e.id, "patient_id": e.patient_id, "plan_code": e.plan_code if role != "CALLER" else f"CP{number}",
           "plan_number": number, "plan_name": mask_plan_name(role, number, plan.name_en if plan else e.plan_code), "tier": e.tier,
           "status": e.status, "health_hub_id": e.health_hub_id, "period_start": e.period_start, "period_end": e.period_end,
           "price_inr": e.price_inr, "renewal_count": e.renewal_count, "doctor_assessed": e.assessed_on is not None}
    if role != "CALLER":  # entitlement names (HbA1c test, physio...) reveal the condition
        included = (plan.entitlements if plan else {}) or {}
        used = e.entitlements_used or {}
        out["eligibility_note_code"] = e.eligibility_note_code
        out["entitlements"] = [{"code": k, "included": v, "used": int(used.get(k, 0)), "overuse": int(used.get(k, 0)) > v}
                               for k, v in included.items()]
        out["tracked_measures"] = plan.tracked_measures if plan else []
    return out


class EnrollIn(BaseModel):
    patient_id: int
    plan_code: str = Field(max_length=60)
    tier: str = Field("PLUS", max_length=30)
    health_hub_id: int | None = None


@router.post("/care-plans/enroll")
def post_enroll(body: EnrollIn, request: Request, db: Session = Depends(get_db), me: User = Depends(doctor_admin)):
    """Suggests a plan. Selling it needs a doctor's assessment and then a counter payment."""
    if not db.get(Patient, body.patient_id):
        raise HTTPException(404, "Patient not found")
    try:
        enr = suggest_enrollment(db, body.patient_id, body.plan_code, body.tier, body.health_hub_id, me.id)
    except ValueError as err:
        _err(err)
    audit(db, request, me.id, "suggest", "plan_enrollment", enr.id)
    return _enr_out(db, enr, me.role)


@router.get("/care-plans/enrollments")
def list_enrollments(health_hub_id: int | None = None, plan_code: str | None = None, status: str | None = None,
                     patient_id: int | None = None, request: Request = None, db: Session = Depends(get_db), me: User = Depends(clinical)):
    stmt = select(PlanEnrollment)
    if health_hub_id is not None:
        stmt = stmt.where(PlanEnrollment.health_hub_id == health_hub_id)
    if plan_code and me.role != "CALLER":
        stmt = stmt.where(PlanEnrollment.plan_code == plan_code)
    if status:
        stmt = stmt.where(PlanEnrollment.status == status.upper())
    if patient_id is not None:
        stmt = stmt.where(PlanEnrollment.patient_id == patient_id)
    rows = db.scalars(stmt.order_by(PlanEnrollment.id.desc()).limit(500)).all()
    audit(db, request, me.id, "view", "plan_enrollments_list")
    return [_enr_out(db, e, me.role) for e in rows]


@router.get("/care-plans/analytics/revenue")
def get_care_plans_revenue(request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    """Paid revenue (first payments and renewals), not suggested prices."""
    paid = (CareTouchpoint.ref_entity == "payments") & CareTouchpoint.service_code.in_(select(CarePlan.code))
    by_plan = db.execute(select(CareTouchpoint.service_code, func.sum(CareTouchpoint.amount_inr), func.count(CareTouchpoint.id))
                         .where(paid).group_by(CareTouchpoint.service_code)).all()
    by_hub = db.execute(select(CareTouchpoint.health_hub_id, func.sum(CareTouchpoint.amount_inr), func.count(CareTouchpoint.id))
                        .where(paid).group_by(CareTouchpoint.health_hub_id)).all()
    audit(db, request, me.id, "view", "care_plans_revenue")
    return {"by_plan": [{"plan_code": r[0], "total_revenue": r[1] or 0, "payments": r[2]} for r in by_plan],
            "by_hub": [{"health_hub_id": r[0], "total_revenue": r[1] or 0, "payments": r[2]} for r in by_hub]}


@router.get("/care-plans/confirms")
def list_confirm_fields(request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    audit(db, request, me.id, "view", "care_plans_confirms")
    return {"missing_confirms": CONFIRMS}


@router.get("/care-plans/{code}")
def get_care_plan(code: str, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = db.scalar(select(CarePlan).where(CarePlan.code == code))
    if not p and code.startswith("CP") and code[2:].isdigit():  # callers only know the neutral "CP<number>" code
        p = db.scalar(select(CarePlan).where(CarePlan.number == code[2:]))
    if not p:
        raise HTTPException(404, "Care plan not found")
    audit(db, request, me.id, "view", "care_plan", p.id)
    return plan_out(p, me.role)


class AssessIn(BaseModel):
    eligible: bool = True
    note_code: str = Field("", max_length=60)


@router.post("/care-plans/enrollments/{enrollment_id}/assess")
def post_assess(enrollment_id: int, body: AssessIn, request: Request, db: Session = Depends(get_db), me: User = Depends(doctor_assess)):
    try:
        enr = assess_enrollment(db, enrollment_id, doctor_id=me.id, eligible=body.eligible, note_code=body.note_code)
    except ValueError as err:
        _err(err)
    audit(db, request, me.id, "assess", "plan_enrollment", enr.id)
    return _enr_out(db, enr, me.role)


class PayIn(BaseModel):
    method: str = Field("COUNTER_CASH", pattern="^(COUNTER_CASH|COUNTER_UPI|COUNTER_CARD)$")
    reference: str = Field("", max_length=60)


@router.post("/care-plans/enrollments/{enrollment_id}/pay")
def post_pay(enrollment_id: int, body: PayIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    try:
        enr = pay_enrollment(db, enrollment_id, {"method": body.method, "reference": body.reference}, me.id)
    except (ValueError, PlanSaleBlocked) as err:
        _err(err)
    audit(db, request, me.id, "payment", "plan_enrollment", enr.id)
    return _enr_out(db, enr, me.role)


class ConsumeIn(BaseModel):
    entitlement_key: str = Field(max_length=50)
    units: int = Field(1, ge=1, le=50)


@router.post("/care-plans/enrollments/{enrollment_id}/consume")
def post_consume(enrollment_id: int, body: ConsumeIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    try:
        enr, overuse = consume_entitlement(db, enrollment_id, body.entitlement_key.strip().upper(), body.units)
    except ValueError as err:
        _err(err)
    audit(db, request, me.id, "consume", "plan_enrollment", enr.id)
    out = _enr_out(db, enr, me.role)
    out["entitlements_used"] = enr.entitlements_used if me.role != "CALLER" else {}
    out["warning"] = "More than the plan includes has now been used." if overuse else ""
    return out
