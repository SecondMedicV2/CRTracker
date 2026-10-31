from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import identity, storage
from ..db import get_db
from ..models import IdentityReview, Order, Patient, Report, User
from ..security import audit, require

router = APIRouter(tags=["patients"])
clinical = require("ADMIN", "DOCTOR")
reviewer = require("ADMIN", "CALLER")  # caller resolves on the call, admin from the queue (Part 9.5)


def mobile_out(p: Patient, user: User) -> str:
    if not p.mobile_enc:
        return ""
    m = storage.decrypt_str(p.mobile_enc)
    return m if user.role == "ADMIN" else "X" * max(len(m) - 4, 0) + m[-4:]  # Part 3.4: masked for non-admins


def patient_out(p: Patient, user: User) -> dict:
    return {"id": p.id, "name": p.name, "gender": p.gender, "age": p.age, "mobile": mobile_out(p, user),
            "household_tag": p.household_tag, "language": p.language, "do_not_call": p.do_not_call}


@router.get("/patients")
def search_patients(q: str = "", db: Session = Depends(get_db), me: User = Depends(clinical)):
    query = select(Patient).where(Patient.merged_into_id.is_(None)).order_by(Patient.id.desc()).limit(50)
    if q.strip():
        mob = identity.norm_mobile(q)
        if mob:
            query = query.where(Patient.mobile_hash == identity.mobile_hash(mob))
        else:
            query = query.where(Patient.name_norm.contains(identity.norm_name(q)))
    return [patient_out(p, me) for p in db.scalars(query)]


@router.get("/patients/{pid}")
def get_patient(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = db.get(Patient, pid)
    if not p or p.merged_into_id:
        raise HTTPException(404, "No such patient")
    audit(db, request, me.id, "view", "patient", pid)
    rows = db.execute(select(Order, Report).outerjoin(Report, Report.order_id == Order.id)
                      .where(Order.patient_id == pid).order_by(Order.collected_on.desc())).all()
    house = db.scalars(select(Patient).where(Patient.household_tag == p.household_tag, Patient.id != pid,
                                             Patient.merged_into_id.is_(None))).all() if p.household_tag else []
    return {**patient_out(p, me),
            "household": [{"id": h.id, "name": h.name} for h in house],
            "reports": [{"order_id": o.order_id_external, "status": o.status, "collected_on": o.collected_on,
                         "report_id": r.id if r else None, "classification": r.classification if r else ""} for o, r in rows]}


class PatientPatch(BaseModel):
    language: str | None = Field(None, max_length=20)
    do_not_call: bool | None = None


@router.patch("/patients/{pid}")
def patch_patient(pid: int, body: PatientPatch, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = db.get(Patient, pid)
    if not p or p.merged_into_id:
        raise HTTPException(404, "No such patient")
    for f in ("language", "do_not_call"):
        if getattr(body, f) is not None:
            setattr(p, f, getattr(body, f))
    db.commit()
    audit(db, request, me.id, "update", "patient", pid)
    return patient_out(p, me)


# ---- identity reviews (demographics only, never results) ----
def side(db: Session, p: Patient, user: User) -> dict:
    rows = db.execute(select(Order.order_id_external, Report.collected_on).outerjoin(Report, Report.order_id == Order.id)
                      .where(Order.patient_id == p.id)).all()
    return {**patient_out(p, user), "orders": [{"order_id": o, "report_date": d} for o, d in rows]}


def review_out(db: Session, r: IdentityReview, user: User) -> dict:
    return {"id": r.id, "reason": r.reason, "status": r.status, "decided_at": r.decided_at,
            "existing": side(db, db.get(Patient, r.patient_a_id), user), "new": side(db, db.get(Patient, r.patient_b_id), user)}


@router.get("/identity-reviews")
def list_reviews(status_: str = "PENDING", db: Session = Depends(get_db), me: User = Depends(reviewer)):
    rows = db.scalars(select(IdentityReview).where(IdentityReview.status == status_).order_by(IdentityReview.id).limit(100))
    return [review_out(db, r, me) for r in rows]


class Decision(BaseModel):
    decision: str  # SAME | DIFFERENT


@router.post("/identity-reviews/{rid}/decide")
def decide(rid: int, body: Decision, request: Request, db: Session = Depends(get_db), me: User = Depends(reviewer)):
    r = db.get(IdentityReview, rid)
    if not r:
        raise HTTPException(404, "No such review")
    if body.decision not in ("SAME", "DIFFERENT"):
        raise HTTPException(422, "Decision must be SAME or DIFFERENT")
    if r.status != "PENDING":
        raise HTTPException(409, "Already decided")
    identity.decide(db, r, body.decision, me.id)
    audit(db, request, me.id, f"identity_{body.decision.lower()}", "identity_review", rid)
    return review_out(db, r, me)


@router.post("/identity-reviews/{rid}/unmerge")
def unmerge(rid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(require("ADMIN"))):
    r = db.get(IdentityReview, rid)
    if not r:
        raise HTTPException(404, "No such review")
    if r.status != "SAME":
        raise HTTPException(409, "Only a merge can be undone")
    identity.unmerge(db, r, me.id)
    audit(db, request, me.id, "identity_unmerge", "identity_review", rid)
    return review_out(db, r, me)
