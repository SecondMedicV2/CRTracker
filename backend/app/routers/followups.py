from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from .. import assign, compare as compare_svc, followup as fu_svc, journeys, retest as retest_svc
from .. import status
from ..analysis import load_rules
from ..db import get_db
from ..models import Doctor, Followup, MonitoringSchedule, Order, Patient, PatientBucket, Report, User
from ..security import audit, current_user, require
from ..settings_store import get_setting
from ..timeutil import to_ist_date, today_ist
from .patients import mobile_out

router = APIRouter(tags=["followups"])
staff = require("ADMIN", "DOCTOR")
admin = require("ADMIN")
DONE = fu_svc.DONE_STAGES
VIEWS = ["queue", "due_tomorrow", "due_this_week", "next_30_days", "overdue", "escalations", "low_potential", "done"]


def conditions(view: str):
    today = today_ist()
    parked = and_(Followup.priority == "ROUTINE", Followup.retest_tier == "LOW", Followup.protocol_tier != "URGENT")
    live = and_(Followup.suppressed_reason == "", Followup.stage.notin_(DONE))
    active = and_(live, ~parked)
    return {
        "queue": active,
        "due_tomorrow": and_(active, Followup.due_on == today + timedelta(days=1)),
        "due_this_week": and_(active, Followup.due_on >= today, Followup.due_on <= today + timedelta(days=7)),
        "next_30_days": and_(active, Followup.due_on >= today, Followup.due_on <= today + timedelta(days=30)),
        "overdue": and_(active, Followup.due_on < today),
        "escalations": and_(active, or_(Followup.priority.in_(("ESCALATION", "URGENT")), Followup.protocol_tier == "URGENT")),
        "low_potential": and_(live, parked),  # parked, not deleted (Part 11.4)
        "done": and_(Followup.suppressed_reason == "", Followup.stage.in_(DONE)),
    }[view]


def can_see_results(user: User, db: Session) -> bool:
    return user.role in ("ADMIN", "DOCTOR") or get_setting(db, "caller_can_view_results")


def row(f: Followup, p: Patient, r: Report, user: User, full: bool, tmap: dict | None = None, has_monitoring: bool = False, has_comparison: bool = False) -> dict:
    plan = f.retest_plan or {}
    if not full:
        if plan.get("source") == "CONDITION" or has_monitoring:
            d = f.retest_window_start or f.due_on
            label = f"Monitoring due on {d.isoformat()}" if d else "Monitoring due"
        else:
            label = "Retest due"
    else:
        label = plan.get("label") or ("Doctor to set retest date" if f.retest_status == "DOCTOR_TO_SET" else "Retest due")
    tier_code = f.protocol_tier or "LONG_TERM"
    meta = (tmap or retest_svc.tier_map()).get(tier_code) or retest_svc.tier_meta(None, tier_code)
    out = {"id": f.id, "patient_id": p.id, "patient_name": p.name, "mobile": mobile_out(p, user), "language": p.language,
           "due_on": f.due_on, "stage": f.stage, "priority": f.priority, "attempts": f.attempts,
           "report_age_days": (today_ist() - to_ist_date(r.collected_on)).days if r.collected_on else None,
           "retest_status": f.retest_status, "retest_label": label,
           "retest_window_start": f.retest_window_start, "retest_window_end": f.retest_window_end,
           "protocol_tier_colour": meta["colour_token"],
           "protocol_tier_label": meta["caller_label"] if not full else meta["label"]}
    if not full and has_comparison:
        comp_d = f.due_on or today_ist()
        out["comparison_notice"] = "Results compared \u2014 doctor review scheduled"
        out["comparison_date"] = comp_d.isoformat()
    if full:  # callers get no clinical content by default (Part 3.2)
        out |= {"buckets": f.bucket_codes, "retest_score": f.retest_score, "retest_tier": f.retest_tier,
                "protocol_tier": tier_code, "sla_escalated_at": f.sla_escalated_at,
                "assigned_doctor_id": f.assigned_doctor_id, "treatment_anchor_on": f.treatment_anchor_on,
                "reminder_on": f.reminder_on, "retest_plan": f.retest_plan}
    return out


@router.get("/followups")
def list_followups(view: str = "queue", bucket: str | None = None, priority: str | None = None, tier: str | None = None,
                   protocol_tier: str | None = None, doctor_id: int | None = None, language: str | None = None,
                   stage: str | None = None, due_from: str | None = None, due_to: str | None = None, limit: int = 300,
                   db: Session = Depends(get_db), me: User = Depends(current_user)):
    if view not in VIEWS:
        raise HTTPException(422, "Unknown view")
    full = can_see_results(me, db)
    if me.role == "CALLER" and not full and (view == "low_potential" or protocol_tier):
        raise HTTPException(403, "Not allowed")
    q = (select(Followup, Patient, Report).join(Patient, Patient.id == Followup.patient_id)
         .join(Report, Report.id == Followup.report_id).where(conditions(view)))
    for col, val in ((Followup.priority, priority), (Followup.retest_tier, tier), (Followup.protocol_tier, protocol_tier),
                     (Followup.assigned_doctor_id, doctor_id), (Patient.language, language), (Followup.stage, stage)):
        if val not in (None, ""):
            q = q.where(col == val)
    if due_from:
        q = q.where(Followup.due_on >= due_from)
    if due_to:
        q = q.where(Followup.due_on <= due_to)
    # URGENT protocol tier first, then escalations, then HIGH/MEDIUM/LOW, then earliest due
    q = q.order_by(case((Followup.protocol_tier == "URGENT", 0), else_=1),
                   case((Followup.priority.in_(("URGENT", "ESCALATION")), 0), (Followup.priority == "PRIORITY", 1), else_=2),
                   Followup.retest_score.desc(),
                   case((Followup.retest_tier == "HIGH", 0), (Followup.retest_tier == "MEDIUM", 1), else_=2),
                   Followup.due_on, Followup.id).limit(min(limit, 2000))
    tmap = retest_svc.tier_map(load_rules(db))
    mon_pids = set(db.scalars(select(MonitoringSchedule.patient_id).where(MonitoringSchedule.status == "ACTIVE")))
    raw_items = db.execute(q).all()
    comp_rids = {r.id for _, p, r in raw_items if not full and compare_svc.has_comparison(db, p.id, r.id)}
    rows = [row(f, p, r, me, full, tmap, p.id in mon_pids, r.id in comp_rids) for f, p, r in raw_items]
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
    tmap = retest_svc.tier_map(load_rules(db))
    return {**row(f, p, r, me, True, tmap), "report_id": r.id, "score_breakdown": f.score_breakdown, "suppressed_reason": f.suppressed_reason,
            "finding_codes": f.finding_codes or [],
            "buckets_detail": [{"code": b.bucket_code, "severity": b.severity, "reason": b.reason} for b in why],
            "parked": f.priority == "ROUTINE" and f.retest_tier == "LOW" and f.protocol_tier != "URGENT"}


class FollowupPatch(BaseModel):
    priority: str | None = None
    assigned_doctor_id: int | None = None
    treatment_anchor_on: date | None = None
    protocol_tier: str | None = None
    retest_date: date | None = None
    retest_override_reason: str | None = None
    retest_notes: str = ""


class RetestOverrideIn(BaseModel):
    window_start: date
    window_end: date | None = None
    reason_code: str = Field(max_length=40)
    notes: str = Field("", max_length=300)


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
    rules = load_rules(db)
    if body.protocol_tier is not None:
        tcode = body.protocol_tier.strip().upper()
        if tcode not in retest_svc.TIER_ORDER:
            raise HTTPException(422, "Invalid protocol_tier")
        f.protocol_tier = tcode
        plan = dict(f.retest_plan or {})
        plan["manual_tier"] = tcode
        plan["protocol_tier"] = tcode
        plan["tier_meta"] = retest_svc.tier_meta(rules, tcode)
        f.retest_plan = plan
        if tcode == "URGENT":
            assign.assign(db, f)
            retest_svc.notify_urgent(db, f)
    if body.treatment_anchor_on is not None:
        f.treatment_anchor_on = body.treatment_anchor_on
        if f.retest_status != "OVERRIDDEN":
            retest_svc.plan_retest(db, f)
            if f.retest_status == "DOCTOR_TO_SET" or f.protocol_tier == "URGENT":
                assign.assign(db, f)
            if f.protocol_tier == "URGENT":
                retest_svc.notify_urgent(db, f)
    if body.retest_date is not None:
        rep = db.get(Report, f.report_id)
        anchor = f.treatment_anchor_on or (to_ist_date(rep.collected_on) if rep and rep.collected_on else today_ist())
        ok, lo, hi = retest_svc.date_in_tier_window(rules, f.protocol_tier or "LONG_TERM", body.retest_date, anchor)
        if not ok:
            reason = (body.retest_override_reason or "").strip().upper()
            if reason not in retest_svc.OVERRIDE_REASONS:
                raise HTTPException(422, f"Date falls outside {f.protocol_tier} tier window ({lo} to {hi or 'onward'}); override reason required")
            retest_svc.override_retest(db, f, window_start=body.retest_date, window_end=body.retest_date,
                                       reason_code=reason, notes=body.retest_notes, user_id=me.id)
            audit(db, request, me.id, "retest_override", "followup", f"{fid}:{reason}")
        else:
            f.retest_window_start = body.retest_date
            f.retest_window_end = body.retest_date
            f.due_on = body.retest_date
            f.next_followup_on = body.retest_date
            if f.retest_status == "DOCTOR_TO_SET":
                f.retest_status = "DOCTOR_SET"
                plan = dict(f.retest_plan or {})
                plan["status"], plan["label"] = "DOCTOR_SET", "Doctor set retest date"
                f.retest_plan = plan
    db.commit()
    audit(db, request, me.id, "update", "followup", fid)
    return row(f, db.get(Patient, f.patient_id), db.get(Report, f.report_id), me, True, retest_svc.tier_map(rules))


@router.post("/followups/{fid}/retest-override")
def override_retest(fid: int, body: RetestOverrideIn, request: Request, db: Session = Depends(get_db), me: User = Depends(staff)):
    f = db.get(Followup, fid)
    if not f:
        raise HTTPException(404, "No such follow-up")
    reason = body.reason_code.strip().upper()
    if reason not in retest_svc.OVERRIDE_REASONS:
        raise HTTPException(422, f"reason_code must be one of {', '.join(retest_svc.OVERRIDE_REASONS)}")
    if body.window_end and body.window_end < body.window_start:
        raise HTTPException(422, "window_end cannot be before window_start")
    retest_svc.override_retest(db, f, window_start=body.window_start, window_end=body.window_end,
                               reason_code=reason, notes=body.notes, user_id=me.id)
    db.commit()
    audit(db, request, me.id, "retest_override", "followup", f"{fid}:{reason}")
    return row(f, db.get(Patient, f.patient_id), db.get(Report, f.report_id), me, True, retest_svc.tier_map(load_rules(db)))


class Day90ConfirmIn(BaseModel):
    clinically_appropriate: bool


@router.post("/followups/{fid}/journey/day90-confirm")
def confirm_day90_retest(fid: int, body: Day90ConfirmIn, request: Request, db: Session = Depends(get_db),
                         me: User = Depends(require("DOCTOR"))):
    f = db.get(Followup, fid)
    if not f:
        raise HTTPException(404, "No such follow-up")
    j = journeys.confirm_day90(db, f, body.clinically_appropriate, me.id)
    audit(db, request, me.id, "day90_confirm", "followup", f"{fid}:{int(body.clinically_appropriate)}")
    return {"followup_id": fid, "journey": j}


@router.get("/retesting-protocol/summary")
def retesting_protocol_summary(db: Session = Depends(get_db), me: User = Depends(admin)):
    rules = load_rules(db)
    tiers = rules.get("retest_tiers") or retest_svc.RETEST_TIERS
    rows = db.execute(
        select(Followup.protocol_tier, func.count())
        .where(Followup.suppressed_reason == "", Followup.stage.notin_(DONE))
        .group_by(Followup.protocol_tier)
    ).all()
    counts = {tier_code: cnt for tier_code, cnt in rows}
    ordered = sorted(tiers, key=lambda t: int(t.get("order") or 99))
    return {
        "tiers": [{**t, "open_count": counts.get(t["code"], 0)} for t in ordered],
        "total_open": sum(counts.values()),
        "urgent_24h": counts.get("URGENT", 0),
    }


@router.post("/followups/recompute")
def recompute(request: Request, db: Session = Depends(get_db), me: User = Depends(require("ADMIN"))):
    """Re-apply the current rules to every follow-up that has not been started (rules are admin-editable)."""
    n = 0
    for o in db.scalars(select(Order).where(Order.status == status.READY, Order.patient_id.is_not(None))):
        n += fu_svc.build(db, o) is not None
    audit(db, request, me.id, "recompute", "followup", n)
    return {"recomputed": n}
