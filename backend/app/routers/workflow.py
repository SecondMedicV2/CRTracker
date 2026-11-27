from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from .. import assign, callcard as cc, relationship as rel
from ..analysis import load_rules
from ..db import get_db
from ..models import (Appointment, CallLog, Comment, Consent, Doctor, Followup, Notification, Patient,
                      ProgramRecommendation, Report, RetestRecommendation, User)
from ..security import audit, current_user, require
from ..settings_store import get_setting
from ..telephony import get_dialer
from ..timeutil import IST
from .followups import DONE, row
from .patients import mobile_out

router = APIRouter(tags=["workflow"])
staff3 = require("ADMIN", "CALLER", "DOCTOR")
callers = require("ADMIN", "CALLER")
doctors = require("ADMIN", "DOCTOR")
CALLABLE = {"NOT_CALLED", "CALLED", "CONSENT_GIVEN", "NOT_REACHABLE", "CALL_LATER"}
OUTCOMES = {"BOOKED", "CALL_LATER", "NOT_REACHABLE", "DECLINED", "WRONG_NUMBER", "DO_NOT_CALL"}


def utc(dt: datetime) -> datetime:
    """Naive times from the browser are IST; everything is stored in UTC."""
    return (dt if dt.tzinfo else dt.replace(tzinfo=IST)).astimezone(timezone.utc)


def get_fu(db: Session, fid: int) -> Followup:
    f = db.get(Followup, fid)
    if not f:
        raise HTTPException(404, "No such follow-up")
    return f


def callable_or_409(db: Session, f: Followup) -> Patient:
    p = db.get(Patient, f.patient_id)
    if p.do_not_call:
        raise HTTPException(409, "This patient asked not to be called")
    if f.suppressed_reason or f.stage not in CALLABLE:
        raise HTTPException(409, "This follow-up can no longer be called")
    return p


def has_consent(db: Session, fid: int) -> bool:
    return db.scalar(select(Consent.id).where(Consent.followup_id == fid).limit(1)) is not None


def my_doctor(db: Session, user: User) -> Doctor | None:
    return db.scalar(select(Doctor).where(Doctor.user_id == user.id))


# ---- consent (AC13) ----
@router.post("/followups/{fid}/consent", status_code=201)
def give_consent(fid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(staff3)):
    f = get_fu(db, fid)
    p = db.get(Patient, f.patient_id)
    if p.do_not_call or f.suppressed_reason or f.stage in DONE:
        raise HTTPException(409, "Consent cannot be taken for this follow-up")
    existing = db.scalar(select(Consent).where(Consent.followup_id == fid))
    if not existing:
        card = cc.latest(db, fid)
        existing = Consent(patient_id=p.id, followup_id=fid, given_by_user=me.id, script_version=f"card:{card.id}" if card else "",
                           channel="doctor_call" if me.role == "DOCTOR" else "caller_call")
        db.add(existing)
        if f.stage in ("NOT_CALLED", "CALLED", "NOT_REACHABLE", "CALL_LATER"):
            f.stage = "CONSENT_GIVEN"
        db.commit()
        audit(db, request, me.id, "consent", "followup", fid)
    return {"given_at": existing.given_at, "channel": existing.channel, "script_version": existing.script_version}


# ---- call outcome ----
class CallIn(BaseModel):
    outcome: str
    notes: str = ""
    call_later_at: datetime | None = None
    slot_start: datetime | None = None
    slot_minutes: int = 15
    doctor_id: int | None = None
    adherence_code: str = ""
    symptom_code: str = ""


@router.post("/followups/{fid}/calls", status_code=201)
def log_call(fid: int, body: CallIn, request: Request, db: Session = Depends(get_db), me: User = Depends(callers)):
    f = get_fu(db, fid)
    p = callable_or_409(db, f)
    if body.outcome not in OUTCOMES:
        raise HTTPException(422, f"Outcome must be one of {sorted(OUTCOMES)}")
    now, maxn = datetime.now(timezone.utc), get_setting(db, "max_call_attempts")
    window = now - timedelta(days=get_setting(db, "attempt_window_days"))
    tries = db.scalar(select(func.count()).select_from(CallLog).where(CallLog.followup_id == fid, CallLog.started_at >= window))
    if tries >= maxn:
        raise HTTPException(409, "Maximum call attempts reached")
    appt = None
    if body.outcome == "BOOKED":
        if not has_consent(db, fid):  # AC13: no booking without recorded consent
            raise HTTPException(409, "Record the patient's consent before booking")
        if not body.slot_start or not 5 <= body.slot_minutes <= 120:
            raise HTTPException(422, "A slot start and a length of 5-120 minutes are required")
        start = utc(body.slot_start)
        if start <= now:
            raise HTTPException(422, "The slot must be in the future")
        doc = db.get(Doctor, body.doctor_id or f.assigned_doctor_id) if (body.doctor_id or f.assigned_doctor_id) else assign.pick(db, p.language or "en")
        if not doc or not doc.active:
            raise HTTPException(409, "No doctor available for this slot")
        end = start + timedelta(minutes=body.slot_minutes)
        # shortcut: only checks double-booking; doctors' working hours are unknown (Q14)
        if db.scalar(select(Appointment.id).where(Appointment.doctor_id == doc.id, Appointment.status == "BOOKED",
                                                  Appointment.slot_start < end, Appointment.slot_end > start).limit(1)):
            raise HTTPException(409, "That doctor already has a booking at this time")
        appt = Appointment(followup_id=fid, doctor_id=doc.id, slot_start=start, slot_end=end)
        db.add(appt)
        if f.assigned_doctor_id != doc.id:
            f.assigned_doctor_id, f.assigned_at, f.accepted_at, f.tried_doctor_ids = doc.id, now, None, []
        f.stage = "BOOKED"
        assign.notify(db, assign.doctor_users(db, doc.id), "New booking for you", f"/followups/view?id={fid}")
    elif body.outcome == "CALL_LATER":
        if not body.call_later_at or utc(body.call_later_at) <= now:
            raise HTTPException(422, "Pick a time in the future to call back")
        f.stage, f.call_later_at = "CALL_LATER", utc(body.call_later_at)
    elif body.outcome == "NOT_REACHABLE":
        f.stage = "NOT_REACHABLE"
    elif body.outcome in ("DECLINED", "WRONG_NUMBER"):
        f.stage = body.outcome
    else:  # DO_NOT_CALL
        p.do_not_call, f.stage = True, "DECLINED"
    adh = body.adherence_code.strip().upper()
    sym = body.symptom_code.strip().upper()
    from .. import journeys as jsvc
    if adh and adh not in jsvc.ADHERENCE_CODES:
        raise HTTPException(422, f"adherence_code must be one of {sorted(jsvc.ADHERENCE_CODES)}")
    if sym and sym not in jsvc.SYMPTOM_CODES:
        raise HTTPException(422, f"symptom_code must be one of {sorted(jsvc.SYMPTOM_CODES)}")
    db.add(CallLog(followup_id=fid, user_id=me.id, role=me.role, outcome=body.outcome, adherence_code=adh, symptom_code=sym, notes=body.notes.strip()[:500]))
    f.attempts, f.last_attempt_at = f.attempts + 1, now
    if body.outcome in ("NOT_REACHABLE", "CALL_LATER") and tries + 1 >= maxn:
        f.suppressed_reason = "Maximum call attempts reached"  # stop chasing (Part 8.5)
    db.flush()
    if adh or sym:
        jsvc.record_checkin(db, f, adherence_code=adh, symptom_code=sym, user_id=me.id, role=me.role)
    else:
        jsvc.sync_journey_events(db, followup_id=fid)
    db.commit()
    audit(db, request, me.id, "call", "followup", f"{fid}:{body.outcome}")
    return {"stage": f.stage, "attempts": f.attempts, "suppressed_reason": f.suppressed_reason,
            "appointment": {"id": appt.id, "doctor_id": appt.doctor_id, "slot_start": appt.slot_start} if appt else None}


# ---- comments + escalation request ----
class CommentIn(BaseModel):
    text: str
    urgent: bool = False
    request_escalation: bool = False
    for_caller: bool = False  # doctors: tick to let the caller read this note


@router.post("/followups/{fid}/comments", status_code=201)
def add_comment(fid: int, body: CommentIn, request: Request, db: Session = Depends(get_db), me: User = Depends(staff3)):
    f = get_fu(db, fid)
    text = body.text.strip()
    if not text or len(text) > 1000:
        raise HTTPException(422, "Write a comment of up to 1000 characters")
    urgent = body.urgent or body.request_escalation
    if body.request_escalation:
        # Urgent symptoms / caller request make the case an ESCALATION at once; only a doctor or admin can lower it (Part 11.5)
        f.priority = "ESCALATION"
    c = Comment(followup_id=fid, user_id=me.id, role=me.role, text=text, urgent=urgent,
                for_caller=True if me.role != "DOCTOR" else body.for_caller)
    db.add(c)
    if me.role != "DOCTOR":
        assign.notify(db, assign.doctor_users(db, f.assigned_doctor_id), "Urgent: escalation requested" if urgent else "New comment from caller",
                      f"/followups/view?id={fid}", urgent=urgent)
    db.commit()
    audit(db, request, me.id, "escalation_request" if body.request_escalation else "comment", "followup", fid)
    return {"id": c.id, "priority": f.priority}


@router.get("/followups/{fid}/comments")
def list_comments(fid: int, db: Session = Depends(get_db), me: User = Depends(staff3)):
    get_fu(db, fid)
    q = select(Comment, User.name).join(User, User.id == Comment.user_id).where(Comment.followup_id == fid).order_by(Comment.id)
    if me.role == "CALLER":
        q = q.where(Comment.for_caller)
    rows = db.execute(q).all()
    if me.role == "DOCTOR":  # reading marks the callers' comments as read
        for c, _ in rows:
            if c.role != "DOCTOR" and c.read_at is None:
                c.read_at = datetime.now(timezone.utc)
        db.commit()
    return [{"id": c.id, "by": name, "role": c.role, "text": c.text, "urgent": c.urgent, "at": c.created_at} for c, name in rows]


# ---- connect doctor now (stub) ----
@router.post("/followups/{fid}/connect-doctor")
def connect_doctor(fid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(callers)):
    f = get_fu(db, fid)
    p = callable_or_409(db, f)
    doc = db.get(Doctor, f.assigned_doctor_id) if f.assigned_doctor_id else assign.pick(db, p.language or "en")
    if not doc:
        raise HTTPException(409, "No doctor available right now")
    assign.notify(db, assign.doctor_users(db, doc.id), f"{me.name} wants to connect you with {p.name} now", f"/followups/view?id={fid}", urgent=True)
    db.commit()
    audit(db, request, me.id, "connect_doctor", "followup", fid)
    return {"doctor": doc.name, "dial": get_dialer().dial_info(doc)}


# ---- status for the follow-up screens ----
@router.get("/followups/{fid}/workflow")
def workflow(fid: int, db: Session = Depends(get_db), me: User = Depends(staff3)):
    f = get_fu(db, fid)
    consent = db.scalar(select(Consent).where(Consent.followup_id == fid))
    appt = db.scalar(select(Appointment).where(Appointment.followup_id == fid, Appointment.status != "CANCELLED").order_by(Appointment.id.desc()))
    logs = db.scalars(select(CallLog).where(CallLog.followup_id == fid).order_by(CallLog.id.desc())).all()
    out = {"stage": f.stage, "attempts": f.attempts, "suppressed_reason": f.suppressed_reason, "call_later_at": f.call_later_at,
           "consent": {"given_at": consent.given_at, "channel": consent.channel} if consent else None,
           "appointment": {"slot_start": appt.slot_start, "slot_end": appt.slot_end, "doctor_id": appt.doctor_id, "status": appt.status} if appt else None,
           "calls": [{"outcome": c.outcome, "role": c.role, "notes": c.notes, "at": c.started_at} for c in logs]}
    if me.role != "CALLER":
        recs = db.scalars(select(RetestRecommendation).where(RetestRecommendation.followup_id == fid)).all()
        out |= {"accepted_at": f.accepted_at, "next_followup_on": f.next_followup_on,
                "recommendations": [{"id": r.id, "test_codes": r.test_codes, "ordered": r.ordered, "ordered_ref": r.ordered_ref} for r in recs]}
    return out


# ---- doctor side ----
@router.get("/doctor/queue")
def doctor_queue(doctor_id: int | None = None, protocol_tier: str | None = None, db: Session = Depends(get_db), me: User = Depends(doctors)):
    """URGENT tier and escalations first, then HIGH/MEDIUM/LOW potential, then earliest due."""
    mine = my_doctor(db, me) if me.role == "DOCTOR" else (db.get(Doctor, doctor_id) if doctor_id else None)
    if me.role == "DOCTOR" and not mine:
        return []
    q = (select(Followup, Patient, Report).join(Patient, Patient.id == Followup.patient_id).join(Report, Report.id == Followup.report_id)
         .where(Followup.suppressed_reason == "", Followup.stage.notin_(DONE),
                or_(Followup.stage.in_(("BOOKED", "CONSENT_GIVEN")), Followup.priority.in_(("ESCALATION", "URGENT")),
                    Followup.retest_status == "DOCTOR_TO_SET", Followup.protocol_tier == "URGENT"))
         .order_by(case((Followup.protocol_tier == "URGENT", 0), else_=1),
                   case((Followup.priority.in_(("URGENT", "ESCALATION")), 0), (Followup.priority == "PRIORITY", 1), else_=2),
                   Followup.retest_score.desc(),
                   case((Followup.retest_tier == "HIGH", 0), (Followup.retest_tier == "MEDIUM", 1), else_=2), Followup.due_on, Followup.id))
    if protocol_tier:
        q = q.where(Followup.protocol_tier == protocol_tier)
    if mine:
        q = q.where(Followup.assigned_doctor_id == mine.id)
    rules = load_rules(db)
    from .. import retest as retest_svc
    tmap = retest_svc.tier_map(rules)
    consider_codes = {p["code"] for p in rules.get("care_programs", []) if p.get("mode") == "DOCTOR_CONSIDER"}
    rows_q = db.execute(q.limit(200)).all()
    pids = {f.patient_id for f, _, _ in rows_q}
    prog_counts: dict[int, list[int]] = {}
    if pids:
        for pid, code in db.execute(select(ProgramRecommendation.patient_id, ProgramRecommendation.program_code).where(
            ProgramRecommendation.patient_id.in_(pids), ProgramRecommendation.status == "SUGGESTED"
        )):
            c = prog_counts.setdefault(pid, [0, 0])
            c[1 if code in consider_codes else 0] += 1
    out = []
    for f, p, r in rows_q:
        unread = db.scalar(select(func.count()).select_from(Comment).where(Comment.followup_id == f.id, Comment.role != "DOCTOR", Comment.read_at.is_(None)))
        appt = db.scalar(select(Appointment).where(Appointment.followup_id == f.id, Appointment.status == "BOOKED"))
        plans_n, consider_n = prog_counts.get(f.patient_id, [0, 0])
        out.append({**row(f, p, r, me, True, tmap), "unread_comments": unread, "accepted": f.accepted_at is not None,
                    "slot_start": appt.slot_start if appt else None,
                    "pending_plans": plans_n, "pending_consider": consider_n})
    return out


@router.post("/followups/{fid}/accept")
def accept(fid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(doctors)):
    f = get_fu(db, fid)
    mine = my_doctor(db, me)
    if me.role == "DOCTOR" and (not mine or f.assigned_doctor_id != mine.id):
        raise HTTPException(403, "This case is assigned to another doctor")
    f.accepted_at = f.accepted_at or datetime.now(timezone.utc)
    db.commit()
    audit(db, request, me.id, "accept", "followup", fid)
    return {"accepted_at": f.accepted_at}


class DoctorOutcome(BaseModel):
    outcome: str  # DOCTOR_DONE | RECALL_CALLER
    notes: str = ""
    retest_codes: list[str] = []
    next_followup_on: date | None = None
    recall_at: datetime | None = None


@router.post("/followups/{fid}/doctor-outcome")
def doctor_outcome(fid: int, body: DoctorOutcome, request: Request, db: Session = Depends(get_db), me: User = Depends(doctors)):
    f = get_fu(db, fid)
    mine = my_doctor(db, me)
    if me.role == "DOCTOR" and (not mine or f.assigned_doctor_id != mine.id):
        raise HTTPException(403, "This case is assigned to another doctor")
    if f.stage in DONE or f.suppressed_reason:
        raise HTTPException(409, "This follow-up is already closed")
    if not has_consent(db, fid):  # no call is complete without consent (Part 15.4)
        raise HTTPException(409, "Consent has not been recorded for this follow-up")
    now = datetime.now(timezone.utc)
    if body.outcome == "RECALL_CALLER":
        f.stage, f.call_later_at = "CALL_LATER", utc(body.recall_at) if body.recall_at else now
        if body.notes.strip():
            db.add(Comment(followup_id=fid, user_id=me.id, role=me.role, text=body.notes.strip()[:1000], for_caller=True))
    elif body.outcome == "DOCTOR_DONE":
        catalogue = {t["code"] for t in load_rules(db)["test_catalogue"]}
        bad = [c for c in body.retest_codes if c not in catalogue]
        if bad:
            raise HTTPException(422, f"Not in the test catalogue: {', '.join(bad)}")
        f.stage = "DOCTOR_DONE"
        if body.retest_codes:
            codes = sorted(set(body.retest_codes))
            proto_rec = db.scalar(select(RetestRecommendation).where(
                RetestRecommendation.followup_id == fid, RetestRecommendation.source == "PROTOCOL"))
            if proto_rec:
                proto_rec.test_codes, proto_rec.doctor_id, proto_rec.source = codes, (mine.id if mine else None), "DOCTOR"
                target_rec = proto_rec
            else:
                target_rec = RetestRecommendation(followup_id=fid, doctor_id=mine.id if mine else None, test_codes=codes)
                db.add(target_rec)
                db.flush()
            from .. import retest_model
            retest_model.sync_plan_fields(db, target_rec, f, doctor_id=me.id)
            f.stage = "RETEST_RECOMMENDED"
        f.next_followup_on = body.next_followup_on
        if body.next_followup_on and f.retest_status == "DOCTOR_TO_SET":
            f.due_on = body.next_followup_on
            f.retest_window_start = body.next_followup_on
            f.retest_window_end = body.next_followup_on
            f.retest_status = "DOCTOR_SET"
            plan = dict(f.retest_plan or {})
            plan["status"], plan["label"] = "DOCTOR_SET", "Doctor set retest date"
            f.retest_plan = plan
        for a in db.scalars(select(Appointment).where(Appointment.followup_id == fid, Appointment.status == "BOOKED")):
            a.status = "DONE"
        db.add(CallLog(followup_id=fid, user_id=me.id, role=me.role, outcome="DOCTOR_DONE", notes=body.notes.strip()[:500]))
    else:
        raise HTTPException(422, "Outcome must be DOCTOR_DONE or RECALL_CALLER")
    f.accepted_at = f.accepted_at or now
    rel.sync_touchpoints(db, f.patient_id, commit=False)
    from .. import journeys as jsvc
    jsvc.sync_journey_events(db, followup_id=fid)
    db.commit()
    audit(db, request, me.id, "doctor_outcome", "followup", f"{fid}:{body.outcome}")
    return {"stage": f.stage}


class Ordered(BaseModel):
    ordered_ref: str = ""


@router.post("/retest-recommendations/{rid}/ordered")
def mark_ordered(rid: int, body: Ordered, request: Request, db: Session = Depends(get_db), me: User = Depends(doctors)):
    r = db.get(RetestRecommendation, rid)
    if not r:
        raise HTTPException(404, "No such recommendation")
    r.ordered, r.ordered_ref = True, body.ordered_ref.strip()[:60]
    fu = db.get(Followup, r.followup_id)
    fu.stage = "RETEST_ORDERED"  # also earns the engagement bonus next time
    rel.sync_touchpoints(db, fu.patient_id, commit=False)
    db.commit()
    audit(db, request, me.id, "retest_ordered", "followup", r.followup_id)
    return {"ordered": True}


# ---- notifications (in-app only, Part 13.7) ----
@router.get("/notifications")
def notifications(db: Session = Depends(get_db), me: User = Depends(current_user)):
    rows = db.scalars(select(Notification).where(Notification.user_id == me.id).order_by(Notification.id.desc()).limit(50)).all()
    return {"unread": sum(n.read_at is None for n in rows),
            "items": [{"id": n.id, "text": n.text, "link": n.link, "urgent": n.urgent, "read": n.read_at is not None, "at": n.created_at} for n in rows]}


@router.post("/notifications/read-all")
def read_all(db: Session = Depends(get_db), me: User = Depends(current_user)):
    for n in db.scalars(select(Notification).where(Notification.user_id == me.id, Notification.read_at.is_(None))):
        n.read_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}
