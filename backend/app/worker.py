"""Background worker: fetches reports for QUEUED orders and runs the daily pull.
Run with `python -m app.worker`. DB-polling queue: fine for ~500 orders/day (Part 15.5)."""
import json
import logging
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from . import assign, callcard, pipeline, status, storage
from .db import SessionLocal
from .intake import pull_now
from .labs import get_lab
from .labs.base import LabError
from .llm import LLMError
from .models import CallCard, Followup, Order, Setting
from .security import audit
from .settings_store import get_setting
from .timeutil import IST, today_ist

log = logging.getLogger("worker")
STUCK_AFTER = timedelta(minutes=10)


def recover_stuck(db: Session) -> None:
    cutoff = datetime.now(timezone.utc) - STUCK_AFTER
    db.execute(update(Order).where(Order.status == status.FETCHING, Order.updated_at < cutoff).values(status=status.QUEUED))
    db.commit()


def fetch_one(db: Session, order: Order) -> None:
    status.move(order, status.FETCHING)
    db.commit()
    try:
        lab = get_lab()
        res = lab.fetch_report(order.order_id_external)
        if res.data is not None:
            order.report_path, order.report_kind = storage.save(json.dumps(res.data).encode(), "json"), "json"
        elif res.pdf is not None:
            order.report_path, order.report_kind = storage.save(res.pdf, "pdf"), "pdf"
        else:
            raise LabError("Lab returned no report")
        order.collected_on, order.reported_on, order.lab, order.error = res.collected_on, res.reported_on, lab.name, ""
        order.lab_ref = res.ref[:64]
        order.patient_hint_enc = storage.encrypt_str(json.dumps(res.patient)) if res.patient else ""
        status.move(order, status.FETCHED)
    except Exception as e:  # one bad order must never stop the batch
        order.attempts += 1
        # only LabError text is safe to show; anything else may carry patient data
        order.error = (str(e) if isinstance(e, LabError) else f"Unexpected error ({type(e).__name__})")[:400]
        if order.attempts >= get_setting(db, "fetch_max_attempts"):
            status.move(order, status.FAILED_FETCH)
        else:
            order.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=60 * 4 ** (order.attempts - 1))
            status.move(order, status.QUEUED)
    db.commit()


def tick(db: Session, limit: int = 20) -> int:
    recover_stuck(db)
    orders = db.scalars(select(Order).where(Order.status == status.QUEUED, Order.next_attempt_at <= datetime.now(timezone.utc))
                        .order_by(Order.id).limit(limit)).all()
    for o in orders:
        fetch_one(db, o)
    return len(orders)


def extract_tick(db: Session, limit: int = 20) -> int:
    orders = db.scalars(select(Order).where(Order.status == status.FETCHED).order_by(Order.id).limit(limit)).all()
    for o in orders:
        pipeline.extract_order(db, o)
    return len(orders)


def callcard_tick(db: Session, limit: int = 20) -> int:
    """Pre-generate cards for active (not parked, not suppressed) follow-ups due soon."""
    horizon = today_ist() + timedelta(days=get_setting(db, "callcard_lead_days"))
    todo = db.scalars(select(Followup).outerjoin(CallCard, CallCard.followup_id == Followup.id).where(
        CallCard.id.is_(None), Followup.suppressed_reason == "", Followup.due_on <= horizon,
        Followup.stage.notin_(("DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED", "DECLINED", "WRONG_NUMBER")),
        ~((Followup.priority == "ROUTINE") & (Followup.retest_tier == "LOW"))).order_by(Followup.due_on).limit(limit)).all()
    made = 0
    for f in todo:
        try:
            callcard.generate(db, f)
            made += 1
        except LLMError:
            db.rollback()
            log.warning("call card generation failed for follow-up %s", f.id)
    return made


def maybe_scheduled_pull(db: Session, now: datetime | None = None) -> bool:
    """Daily at pull_time_ist; with pull_every_minutes > 0, again every that many minutes for the rest of the day."""
    ist = (now or datetime.now(timezone.utc)).astimezone(IST)
    if ist.strftime("%H:%M") < get_setting(db, "pull_time_ist"):
        return False
    marker, last = db.get(Setting, "_last_pull_date"), db.get(Setting, "_last_pull_at")
    if marker and marker.value == ist.date().isoformat():
        every = get_setting(db, "pull_every_minutes")
        if every <= 0 or (last and ist - datetime.fromisoformat(last.value) < timedelta(minutes=every)):
            return False
    db.merge(Setting(key="_last_pull_date", value=ist.date().isoformat()))  # mark first: no retry storm on failure
    db.merge(Setting(key="_last_pull_at", value=ist.isoformat()))
    db.commit()
    try:
        b = pull_now(db, ist.date() - timedelta(days=max(1, get_setting(db, "pull_lookback_days"))), ist.date(), None)
        if b.new == 0 and b.failed == 0:  # nothing new since the last pull: keep the import list readable
            db.delete(b)
            db.commit()
            return True
        audit(db, None, None, "scheduled_pull", "import_batch", b.id)
    except LabError as e:
        audit(db, None, None, "scheduled_pull_failed", "import_batch", str(e)[:60])
    return True


def run_once(budget: float = 20.0) -> dict:
    """One round of everything the loop does, repeated until idle or out of time. Called by the Cloudflare cron
    through /api/internal/tick, so a free host that sleeps between requests still gets its background work done."""
    start, total = time.monotonic(), {"fetched": 0, "extracted": 0, "cards": 0, "reassigned": 0, "rounds": 0}
    while True:
        with SessionLocal() as db:
            maybe_scheduled_pull(db)
            n = (tick(db), extract_tick(db), callcard_tick(db), assign.cascade_tick(db))
        for key, v in zip(("fetched", "extracted", "cards", "reassigned"), n):
            total[key] += v
        total["rounds"] += 1
        if sum(n[:3]) == 0 or time.monotonic() - start > budget:
            return total


def main():
    logging.basicConfig(level=logging.INFO)
    while True:
        with SessionLocal() as db:
            try:
                maybe_scheduled_pull(db)
                if tick(db) + extract_tick(db) + callcard_tick(db) + assign.cascade_tick(db) == 0:
                    time.sleep(5)
            except Exception:
                log.exception("worker loop error")
                db.rollback()
                time.sleep(5)


if __name__ == "__main__":
    main()
