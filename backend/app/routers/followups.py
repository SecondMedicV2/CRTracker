from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from .. import followup as fu_svc
from .. import status
from ..db import get_db
from ..models import Doctor, Followup, Order, Patient, PatientBucket, Report, User
from ..security import audit, current_user, require
from ..settings_store import get_setting
from ..timeutil import today_ist
from .patients import mobile_out

router = APIRouter(tags=["followups"])
staff = require("ADMIN", "DOCTOR")
DONE = fu_svc.DONE_STAGES
VIEWS = ["queue", "due_tomorrow", "due_this_week", "next_30_days", "overdue", "escalations", "low_potential", "done"]


def conditions(view: str):
    today = today_ist()
    parked = and_(Followup.priority == "ROUTINE", Followup.retest_tier == "LOW")
    live = and_(Followup.suppressed_reason == "", Followup.stage.notin_(DONE))
    active = and_(live, ~parked)
    return {
        "queue": active,
        "due_tomorrow": and_(active, Followup.due_on == today + timedelta(days=1)),
        "due_this_week": and_(active, Followup.due_on >= today, Followup.due_on <= today + timedelta(days=7)),
        "next_30_days": and_(active, Followup.due_on >= today, Followup.due_on <= today + timedelta(days=30)),
        "overdue": and_(active, Followup.due_on < today),
        "escalations": and_(active, Followup.priority.in_(("ESCALATION", "URGENT"))),
        "low_potential": and_(live, parked),  # parked, not deleted (Part 11.4)
        "done": and_(Followup.suppressed_reason == "", Followup.stage.in_(DONE)),
    }[view]


def can_see_results(user: User, db: Session) -> bool:
    return user.role in ("ADMIN", "DOCTOR") or get_setting(db, "caller_can_view_results")


def row(f: Followup, p: Patient, r: Report, user: User, full: bool) -> dict:
    out = {"id": f.id, "patient_id": p.id, "patient_name": p.name, "mobile": mobile_out(p, user), "language": p.language,
           "due_on": f.due_on, "stage": f.stage, "priority": f.priority, "attempts": f.attempts,
           "report_age_days": (today_ist() - r.collected_on.date()).days if r.collected_on else None}
    if full:  # callers get no clinical content by default (Part 3.2)
        out |= {"buckets": f.bucket_codes, "retest_score": f.retest_score, "retest_tier": f.retest_tier,
                "assigned_doctor_id": f.assigned_doctor_id}
    return out


@router.get("/followups")
def list_followups(view: str = "queue", bucket: str | None = None, priority: str | None = None, tier: str | None = None,
                   doctor_id: int | None = None, language: str | None = None, stage: str | None = None,
                   due_from: str | None = None, due_to: str | None = None, limit: int = 300,
                   db: Session = Depends(get_db), me: User = Depends(current_user)):
    if view not in VIEWS:
        raise HTTPException(422, "Unknown view")
    full = can_see_results(me, db)
    if me.role == "CALLER" and view == "low_potential" and not full:
        raise HTTPException(403, "Not allowed")
    q = (select(Followup, Patient, Report).join(Patient, Patient.id == Followup.patient_id)
         .join(Report, Report.id == Followup.report_id).where(conditions(view)))
    for col, val in ((Followup.priority, priority), (Followup.retest_tier, tier), (Followup.assigned_doctor_id, doctor_id),
                     (Patient.language, language), (Followup.stage, stage)):
        if val not in (None, ""):
            q = q.where(col == val)
    if due_from:
        q = q.where(Followup.due_on >= due_from)
    if due_to:
        q = q.where(Followup.due_on <= due_to)
    # escalations first, then HIGH, MEDIUM, LOW, then earliest due (Part 13.2)
    q = q.order_by(case((Followup.priority.in_(("URGENT", "ESCALATION")), 0), (Followup.priority == "PRIORITY", 1), else_=2),
                   Followup.retest_score.desc(),
                   case((Followup.retest_tier == "HIGH", 0), (Followup.retest_tier == "MEDIUM", 1), else_=2),
                   Followup.due_on, Followup.id).limit(min(limit, 2000))
    rows = [row(f, p, r, me, full) for f, p, r in db.execute(q)]
    if bucket:
        if not full:
            raise HTTPException(403, "Not allowed")
        rows = [x for x in rows if bucket in x["buckets"]]
    return rows


@router.get("/followups/summary")
def summary(db: Session = Depends(get_db), me: User = Depends(current_user)):
    full = can_see_results(me, db)
    out = {v: db.scalar(select(func.count()).select_from(Followup).where(conditions(v))) for v in VIEWS
           if full or v != "low_potential"}
    if full:
        out["_buckets"] = dict(db.execute(select(PatientBucket.bucket_code, func.count(func.distinct(PatientBucket.patient_id)))
                                          .where(PatientBucket.active).group_by(PatientBucket.bucket_code)).all())
    return out


@router.get("/followups/{fid}")
def get_followup(fid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(current_user)):
    if not can_see_results(me, db):
        raise HTTPException(403, "Not allowed")
    f = db.get(Followup, fid)
    if not f:
        raise HTTPException(404, "No such follow-up")
    p, r = db.get(Patient, f.patient_id), db.get(Report, f.report_id)
    audit(db, request, me.id, "view", "followup", fid)
    why = db.scalars(select(PatientBucket).where(PatientBucket.report_id == r.id)).all()
    return {**row(f, p, r, me, True), "report_id": r.id, "score_breakdown": f.score_breakdown, "suppressed_reason": f.suppressed_reason,
            "buckets_detail": [{"code": b.bucket_code, "severity": b.severity, "reason": b.reason} for b in why],
            "parked": f.priority == "ROUTINE" and f.retest_tier == "LOW"}


class FollowupPatch(BaseModel):
    priority: str | None = None
    assigned_doctor_id: int | None = None


@router.patch("/followups/{fid}")
def patch_followup(fid: int, body: FollowupPatch, request: Request, db: Session = Depends(get_db), me: User = Depends(staff)):
    f = db.get(Followup, fid)
    if not f:
        raise HTTPException(404, "No such follow-up")
    if body.priority is not None:  # only a doctor or admin may change priority (Part 11.5)
        if body.priority not in ("ROUTINE", "ESCALATION"):
            raise HTTPException(422, "Priority must be ROUTINE or ESCALATION")
        f.priority = body.priority
    if body.assigned_doctor_id is not None:
        if not db.get(Doctor, body.assigned_doctor_id):
            raise HTTPException(422, "No such doctor")
        f.assigned_doctor_id = body.assigned_doctor_id
    db.commit()
    audit(db, request, me.id, "update", "followup", fid)
    return row(f, db.get(Patient, f.patient_id), db.get(Report, f.report_id), me, True)


@router.post("/followups/recompute")
def recompute(request: Request, db: Session = Depends(get_db), me: User = Depends(require("ADMIN"))):
    """Re-apply the current rules to every follow-up that has not been started (rules are admin-editable)."""
    n = 0
    for o in db.scalars(select(Order).where(Order.status == status.READY, Order.patient_id.is_not(None))):
        n += fu_svc.build(db, o) is not None
    audit(db, request, me.id, "recompute", "followup", n)
    return {"recomputed": n}
