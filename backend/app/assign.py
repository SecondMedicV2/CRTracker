"""Doctor assignment, cascade and in-app notifications (Part 13.3, 13.7).
Default reading of "cascade" (Q9 still open): a case nobody accepts in time moves to the next doctor."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from .models import Doctor, Followup, Notification, Patient, User
from .security import audit
from .settings_store import get_setting

DONE = ("DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED", "DECLINED", "WRONG_NUMBER")


def notify(db: Session, user_ids, text: str, link: str = "", urgent: bool = False) -> None:
    for uid in set(user_ids):
        db.add(Notification(user_id=uid, text=text[:200], link=link, urgent=urgent))


def doctor_users(db: Session, doctor_id: int | None = None) -> list[int]:
    """Who to notify: the doctor, else every active doctor, else the admins (never nobody)."""
    q = select(Doctor.user_id).where(Doctor.active, Doctor.user_id.is_not(None))
    ids = [u for (u,) in db.execute(q.where(Doctor.id == doctor_id) if doctor_id else q)]
    return ids or [u for (u,) in db.execute(select(User.id).where(User.role == "ADMIN", User.active))]


def eligible(db: Session) -> list[Doctor]:
    q = select(Doctor).where(Doctor.active)
    if get_setting(db, "pilot_mode"):  # pilot: only selected doctors receive cases
        q = q.where(Doctor.in_pilot)
    return list(db.scalars(q.order_by(Doctor.priority_order, Doctor.id)))


def _loads(db: Session) -> dict[int, int]:
    """Open cases per doctor in one query."""
    return dict(db.execute(select(Followup.assigned_doctor_id, func.count()).where(
        Followup.assigned_doctor_id.is_not(None), Followup.suppressed_reason == "", Followup.stage.notin_(DONE))
        .group_by(Followup.assigned_doctor_id)).all())


def pick(db: Session, lang: str, exclude=()) -> Doctor | None:
    lang = lang or "en"
    docs = [d for d in eligible(db) if d.id not in exclude]
    loads = _loads(db)
    # language match first, then the admin's priority order, then the lightest load
    docs.sort(key=lambda d: (lang not in (d.languages or []), d.priority_order, loads.get(d.id, 0), d.id))
    return docs[0] if docs else None


def assign(db: Session, fu: Followup) -> Doctor | None:
    if fu.assigned_doctor_id:
        return None
    lang = db.get(Patient, fu.patient_id).language or get_setting(db, "default_language")
    d = pick(db, lang)
    if d:
        fu.assigned_doctor_id, fu.assigned_at, fu.tried_doctor_ids = d.id, datetime.now(timezone.utc), []
        notify(db, doctor_users(db, d.id), "New follow-up assigned to you", f"/followups/{fu.id}",
               urgent=fu.priority == "ESCALATION")
    return d


def needs_doctor(fu: Followup) -> bool:
    return fu.stage in ("BOOKED", "CONSENT_GIVEN") or fu.priority == "ESCALATION"


def reassign(db: Session, fu: Followup, now: datetime) -> bool:
    old = fu.assigned_doctor_id
    tried = set(fu.tried_doctor_ids or []) | {old}
    lang = db.get(Patient, fu.patient_id).language or get_setting(db, "default_language")
    nxt = pick(db, lang, exclude=tried)
    if not nxt:  # everyone has had a go: start another round (never back to the same doctor)
        tried = {old}
        nxt = pick(db, lang, exclude=tried)
    if not nxt:
        return False  # only one eligible doctor
    fu.tried_doctor_ids, fu.assigned_doctor_id, fu.assigned_at, fu.accepted_at = sorted(tried), nxt.id, now, None
    notify(db, doctor_users(db, nxt.id), "A follow-up was reassigned to you", f"/followups/{fu.id}",
           urgent=fu.priority == "ESCALATION")
    audit(db, None, None, "reassign", "followup", f"{fu.id}:{old}->{nxt.id}")
    return True


def cascade_tick(db: Session, now: datetime | None = None) -> int:
    """Escalations time out after 4h, routine cases after 24h (settings); accepted cases are left alone."""
    now = now or datetime.now(timezone.utc)
    esc, routine = get_setting(db, "timeout_escalation_hours"), get_setting(db, "timeout_routine_hours")
    timed_out = or_(and_(Followup.priority == "ESCALATION", Followup.assigned_at <= now - timedelta(hours=esc)),
                    and_(Followup.priority != "ESCALATION", Followup.assigned_at <= now - timedelta(hours=routine)))
    live = db.scalars(select(Followup).where(Followup.suppressed_reason == "", Followup.stage.notin_(DONE),
                                             Followup.assigned_doctor_id.is_not(None), Followup.accepted_at.is_(None),
                                             timed_out)).all()
    n = 0
    for fu in live:
        if needs_doctor(fu):
            n += reassign(db, fu, now)
    db.commit()
    return n
