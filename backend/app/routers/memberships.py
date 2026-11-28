import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import identity, intake, storage
from ..db import get_db
from ..memberships import (assign_free_membership, consume_membership_entitlement, editable_plan_fields, effective_entitlements,
                           enroll_membership, mask_plan_name, record_membership_payment, seed_memberships, set_membership_status,
                           sign_off_membership, suggest_memberships)
from ..models import CorporateClient, Membership, MembershipPlan, Patient, Payment, User
from ..outcomes import PlanSaleBlocked
from ..payment_gateway import PaymentError, get_provider
from ..security import audit, require

router = APIRouter(tags=["memberships"])
clinical = require("ADMIN", "DOCTOR", "CALLER")
doctor_signoff = require("DOCTOR")
admin_only = require("ADMIN")


def _err(err: Exception):
    if isinstance(err, PlanSaleBlocked):
        raise HTTPException(409, str(err))
    raise HTTPException(422, str(err))


def _plan_out(p: MembershipPlan, role: str) -> dict:
    caller = role == "CALLER"
    return {"id": p.id, "code": p.code, "name": mask_plan_name(role, p.code, p.name),
            "target_text": "Member care plan" if caller else p.target_text, "price_inr_monthly": p.price_inr_monthly,
            "benefits_text": "" if caller and p.code == "H360_CHRONIC" else p.benefits_text, "includes_plan": p.includes_plan,
            "entitlements": [] if caller else p.entitlements, "active": p.active}


@router.get("/membership-plans")
def list_membership_plans(request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    seed_memberships(db)
    plans = db.scalars(select(MembershipPlan).where(MembershipPlan.active.is_(True)).order_by(MembershipPlan.price_inr_monthly)).all()
    audit(db, request, me.id, "view", "membership_plans_list")
    return [_plan_out(p, me.role) for p in plans]


class PlanEditIn(BaseModel):
    name: str | None = Field(None, max_length=120)
    target_text: str | None = Field(None, max_length=500)
    price_inr_monthly: int | None = Field(None, ge=0, le=1_000_000)
    benefits_text: str | None = Field(None, max_length=1000)
    includes_plan: str | None = Field(None, max_length=60)
    entitlements: list[dict] | None = None
    active: bool | None = None


@router.patch("/membership-plans/{code}")
def edit_membership_plan(code: str, body: PlanEditIn, request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    p = db.scalar(select(MembershipPlan).where(MembershipPlan.code == code))
    if not p:
        raise HTTPException(404, "Plan not found")
    changes = body.model_dump(exclude_none=True)
    for e in changes.get("entitlements", []):
        if not isinstance(e.get("code"), str) or not isinstance(e.get("quantity"), int) or e["quantity"] < 0:
            raise HTTPException(422, "Each entitlement needs a code and a non-negative whole quantity")
    for k in editable_plan_fields():
        if k in changes:
            setattr(p, k, changes[k])
    db.commit()
    audit(db, request, me.id, "edit", "membership_plan", f"{p.code}:{','.join(sorted(changes))}")
    return _plan_out(p, me.role)


def _membership_out(db: Session, m: Membership, role: str) -> dict:
    plan = db.scalar(select(MembershipPlan).where(MembershipPlan.code == m.plan_code))
    out = {"id": m.id, "patient_id": m.patient_id, "plan_code": m.plan_code,
           "plan_name": mask_plan_name(role, m.plan_code, plan.name if plan else m.plan_code), "status": m.status,
           "payer": m.payer, "start_on": m.start_on, "current_period_end": m.current_period_end,
           "renewal_count": m.renewal_count, "signed_off": m.signed_off_at is not None,
           "payments": [{"id": p.id, "amount_inr": p.amount_inr, "method": p.method, "status": p.status, "received_at": p.received_at}
                        for p in db.scalars(select(Payment).where(Payment.membership_id == m.id).order_by(Payment.id))]}
    if role != "CALLER":  # entitlements can reveal the care programme (e.g. chronic doctor reviews)
        out["entitlements_included"] = effective_entitlements(db, m.plan_code)
        out["entitlements_used"] = m.entitlements_used or {}
    return out


@router.get("/patients/{pid}/memberships")
def get_patient_memberships(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    patient = db.get(Patient, pid)
    if not patient:
        raise HTTPException(404, "Patient not found")
    assign_free_membership(db, patient.id)
    memberships = db.scalars(select(Membership).where(Membership.patient_id == patient.id).order_by(Membership.id)).all()
    suggestions = suggest_memberships(db, patient.id) if me.role != "CALLER" else []
    audit(db, request, me.id, "view", "patient_memberships", patient.id)
    return {"memberships": [_membership_out(db, m, me.role) for m in memberships], "suggestions": suggestions}


@router.get("/memberships")
def list_memberships(plan_code: str | None = None, status: str | None = None, corporate_client_id: int | None = None,
                     request: Request = None, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    stmt = select(Membership)
    if plan_code:
        stmt = stmt.where(Membership.plan_code == plan_code)
    if status:
        stmt = stmt.where(Membership.status == status.upper())
    if corporate_client_id is not None:
        stmt = stmt.where(Membership.corporate_client_id == corporate_client_id)
    rows = db.scalars(stmt.order_by(Membership.id.desc()).limit(500)).all()
    prices = {p.code: p.price_inr_monthly for p in db.scalars(select(MembershipPlan))}
    mrr: dict[str, int] = {}
    for code, n in db.execute(select(Membership.plan_code, func.count(Membership.id))
                              .where(Membership.status.in_(("ACTIVE", "RENEWAL_DUE")), Membership.payer == "SELF")
                              .group_by(Membership.plan_code)):
        mrr[code] = n * prices.get(code, 0)
    audit(db, request, me.id, "view", "memberships_list")
    return {"memberships": [_membership_out(db, m, me.role) for m in rows], "mrr_by_plan": mrr, "mrr_total": sum(mrr.values())}


class EnrollMembershipIn(BaseModel):
    patient_id: int
    plan_code: str = Field(max_length=60)
    payer: str = Field("SELF", max_length=20)
    corporate_client_id: int | None = None
    health_hub_id: int | None = None
    payment_method: str = Field("COUNTER_CASH", max_length=30)
    amount_inr: int = Field(0, ge=0, le=1_000_000)
    reference: str = Field("", max_length=60)


@router.post("/memberships/enroll")
def post_enroll_membership(body: EnrollMembershipIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    if not db.get(Patient, body.patient_id):
        raise HTTPException(404, "Patient not found")
    try:
        m = enroll_membership(db, patient_id=body.patient_id, plan_code=body.plan_code, payer=body.payer,
                              corporate_client_id=body.corporate_client_id, enrolled_by=me.id, health_hub_id=body.health_hub_id,
                              payment_details={"amount_inr": body.amount_inr, "method": body.payment_method, "reference": body.reference},
                              enrolled_by_role=me.role)
    except (ValueError, PlanSaleBlocked) as err:
        _err(err)
    audit(db, request, me.id, "enroll", "membership", m.id)
    return _membership_out(db, m, me.role)


@router.post("/memberships/{mid}/signoff")
def post_signoff(mid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(doctor_signoff)):
    try:
        m = sign_off_membership(db, mid, me.id)
    except ValueError as err:
        _err(err)
    audit(db, request, me.id, "signoff", "membership", m.id)
    return _membership_out(db, m, me.role)


class PaymentIn(BaseModel):
    amount_inr: int = Field(ge=1, le=1_000_000)
    method: str = Field("COUNTER_CASH", pattern="^(COUNTER_CASH|COUNTER_UPI|COUNTER_CARD)$")
    reference: str = Field("", max_length=60)


@router.post("/memberships/{mid}/payments")
def post_membership_payment(mid: int, body: PaymentIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    try:
        m = record_membership_payment(db, mid, body.amount_inr, {"method": body.method, "reference": body.reference}, me.id)
    except (ValueError, PlanSaleBlocked) as err:
        _err(err)
    audit(db, request, me.id, "payment", "membership", m.id)
    return _membership_out(db, m, me.role)


class StatusIn(BaseModel):
    status: str = Field(max_length=20)


@router.post("/memberships/{mid}/status")
def post_membership_status(mid: int, body: StatusIn, request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    try:
        m = set_membership_status(db, mid, body.status)
    except ValueError as err:
        _err(err)
    audit(db, request, me.id, f"status_{m.status.lower()}", "membership", m.id)
    return _membership_out(db, m, me.role)


class ConsumeIn(BaseModel):
    entitlement_code: str = Field(max_length=50)


@router.post("/memberships/{mid}/consume")
def post_membership_consume(mid: int, body: ConsumeIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    try:
        m = consume_membership_entitlement(db, mid, body.entitlement_code.strip().upper())
    except ValueError as err:
        _err(err)
    audit(db, request, me.id, "consume", "membership", m.id)
    return _membership_out(db, m, me.role)


@router.post("/memberships/{mid}/online-order")
def post_online_order(mid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    m = db.get(Membership, mid)
    if not m:
        raise HTTPException(404, "Membership not found")
    try:
        provider = get_provider(db)
    except PaymentError as err:
        raise HTTPException(409, str(err))
    if provider is None:
        raise HTTPException(409, "Online payments are switched off. Record a counter payment instead.")
    plan = db.scalar(select(MembershipPlan).where(MembershipPlan.code == m.plan_code))
    try:
        order = provider.create_order(plan.price_inr_monthly if plan else 0, f"mem-{m.id}")
    except PaymentError as err:
        raise HTTPException(502, str(err))
    audit(db, request, me.id, "online_order", "membership", m.id)
    return order


class OnlineConfirmIn(BaseModel):
    order_id: str = Field(max_length=60)
    payment_id: str = Field(max_length=60)
    signature: str = Field(max_length=128)
    amount_inr: int = Field(ge=1, le=1_000_000)


@router.post("/memberships/{mid}/online-confirm")
def post_online_confirm(mid: int, body: OnlineConfirmIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    try:
        provider = get_provider(db)
    except PaymentError as err:
        raise HTTPException(409, str(err))
    if provider is None:
        raise HTTPException(409, "Online payments are switched off.")
    if not provider.verify(body.order_id, body.payment_id, body.signature):
        raise HTTPException(422, "Payment signature does not match")
    try:
        m = record_membership_payment(db, mid, body.amount_inr, {"method": "ONLINE", "reference": body.payment_id}, me.id)
    except (ValueError, PlanSaleBlocked) as err:
        _err(err)
    audit(db, request, me.id, "payment_online", "membership", m.id)
    return _membership_out(db, m, me.role)


def _statements(db: Session) -> list[dict]:
    out = []
    for c in db.scalars(select(CorporateClient).where(CorporateClient.active.is_(True)).order_by(CorporateClient.name)):
        active = db.scalar(select(func.count(Membership.id)).where(
            Membership.corporate_client_id == c.id, Membership.status.in_(("ACTIVE", "RENEWAL_DUE")))) or 0
        out.append({"client_id": c.id, "client_name": c.name, "code": c.code, "pepm_inr": c.pepm_inr,
                    "active_members": active, "monthly_total_inr": active * c.pepm_inr})
    return out


def _cell(v) -> str:
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


@router.get("/corporate-billing/statements")
def get_corporate_statements(format: str = "json", request: Request = None, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    rows = _statements(db)
    audit(db, request, me.id, "export" if format == "csv" else "view", "corporate_statements")
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Client", "Code", "PEPM (INR)", "Active members", "Monthly total (INR)"])
        for r in rows:
            w.writerow([_cell(r["client_name"]), _cell(r["code"]), r["pepm_inr"], r["active_members"], r["monthly_total_inr"]])
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="corporate-statements-{month}.csv"'})
    return {"statements": rows}


def _col(headers: list[str], *names: str) -> int | None:
    low = [h.strip().lower().replace(" ", "_") for h in headers]
    for n in names:
        if n in low:
            return low.index(n)
    return None


@router.post("/corporate-clients/{client_id}/roster")
async def import_roster(client_id: int, request: Request, file: UploadFile = File(...), db: Session = Depends(get_db),
                        me: User = Depends(admin_only)):
    """Employer member roster (CSV/XLSX, 5 MB): employee id, name, mobile. Matched to patients by the keyed mobile hash;
    unknown people are created. Every listed member gets an active H360_CORPORATE membership billed to the employer."""
    client = db.get(CorporateClient, client_id)
    if not client:
        raise HTTPException(404, "Corporate client not found")
    try:
        headers, rows = intake.read_file(file.filename or "", await file.read(intake.MAX_BYTES + 1))
    except ValueError as err:
        raise HTTPException(422, str(err))
    i_emp, i_name, i_mob = _col(headers, "employee_id", "emp_id", "employee"), _col(headers, "name", "employee_name"), _col(headers, "mobile", "phone", "mobile_number")
    if i_name is None or i_mob is None:
        raise HTTPException(422, "The roster needs Name and Mobile columns (Employee ID is optional)")
    seed_memberships(db)
    counts = {"rows": len(rows), "matched": 0, "created": 0, "enrolled": 0, "already_member": 0, "skipped": 0}
    for row in rows:
        cell = lambda i: (row[i] if i is not None and i < len(row) else "") or ""
        mobile, name = identity.norm_mobile(str(cell(i_mob))), str(cell(i_name)).strip()[:120]
        if not mobile or not name:
            counts["skipped"] += 1
            continue
        h = identity.mobile_hash(mobile)
        p = db.scalar(select(Patient).where(Patient.mobile_hash == h, Patient.merged_into_id.is_(None)).limit(1))
        if p:
            counts["matched"] += 1
            if p.corporate_client_id is None:
                p.corporate_client_id = client.id
        else:
            p = Patient(name=name, name_norm=identity.norm_name(name), mobile_enc=storage.encrypt_str(mobile), mobile_hash=h,
                        source_channel="CORPORATE", source_ref_id=client.id, corporate_client_id=client.id)
            db.add(p)
            db.flush()
            counts["created"] += 1
        existing = db.scalar(select(Membership).where(Membership.patient_id == p.id, Membership.corporate_client_id == client.id,
                                                      Membership.status.in_(("ACTIVE", "RENEWAL_DUE", "PAUSED"))))
        if existing:
            counts["already_member"] += 1
            continue
        enroll_membership(db, p.id, "H360_CORPORATE", payer="CORPORATE", corporate_client_id=client.id, enrolled_by=me.id,
                          member_ref=str(cell(i_emp)).strip())
        counts["enrolled"] += 1
    db.commit()
    audit(db, request, me.id, "import_roster", "corporate_client", f"{client.id}:{counts['enrolled']} enrolled")
    return counts
