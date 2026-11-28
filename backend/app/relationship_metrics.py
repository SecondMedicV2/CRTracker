"""Shared, data-backed numbers for the page 13 scorecard and the page 14 Health Loop.

Every figure here comes from stored records. When there is nothing to measure, the value is None and the caller
marks it NOT_AVAILABLE; nothing is filled in with a placeholder.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import CareJourney, CareTouchpoint, CorporateClient, JourneyStep, Membership, Payment
from .timeutil import IST, today_ist


def pct(num: int | float, den: int | float) -> float | None:
    return round(100.0 * num / den, 1) if den else None


def show_pct(v: float | None) -> str:
    return "—" if v is None else f"{v}%"


def _utc_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    return (datetime.combine(start, time.min, IST), datetime.combine(end + timedelta(days=1), time.min, IST))


def revenue_split(db: Session, start: date, end: date, hub_id: int | None = None, patient_ids: set[int] | None = None) -> dict:
    """Transactions = one-off services; subscriptions = care-plan and Health360 payments; corporate = PEPM for the
    employer-paid members active now, for the months in the period."""
    tps = select(CareTouchpoint.ref_entity, CareTouchpoint.amount_inr, CareTouchpoint.patient_id).where(
        CareTouchpoint.occurred_on >= start, CareTouchpoint.occurred_on <= end, CareTouchpoint.amount_inr.is_not(None))
    if hub_id:
        tps = tps.where(CareTouchpoint.health_hub_id == hub_id)
    tx = sub = tx_count = 0
    for ref, amount, pid in db.execute(tps):
        if patient_ids is not None and pid not in patient_ids:
            continue
        if ref == "payments":  # care-plan payments are recorded as touchpoints
            sub += amount
        else:
            tx += amount
            tx_count += 1
    lo, hi = _utc_bounds(start, end)
    mp = select(Payment.amount_inr, Payment.patient_id).where(Payment.membership_id.is_not(None), Payment.status == "PAID",
                                                             Payment.received_at >= lo, Payment.received_at < hi)
    if hub_id:
        mp = mp.where(Payment.health_hub_id == hub_id)
    sub += sum(a for a, pid in db.execute(mp) if patient_ids is None or pid in patient_ids)

    months = max(1, round(((end - start).days + 1) / 30))
    corp = 0
    for c in db.scalars(select(CorporateClient).where(CorporateClient.active.is_(True))):
        members = db.scalar(select(func.count(Membership.id)).where(
            Membership.corporate_client_id == c.id, Membership.payer == "CORPORATE", Membership.status.in_(("ACTIVE", "RENEWAL_DUE")))) or 0
        corp += members * c.pepm_inr * months
    return {"transactions": tx, "transaction_count": tx_count, "subscriptions": sub, "corporate": corp, "total": tx + sub + corp}


def ami_coordination(db: Session, start: date, end: date) -> dict:
    """Journey steps done by their due date, among steps that fell due in the period (page 8 journeys)."""
    last = min(end, today_ist())
    due = list(db.execute(select(JourneyStep.status, JourneyStep.due_on, JourneyStep.completed_on).where(
        JourneyStep.due_on >= start, JourneyStep.due_on <= last, JourneyStep.status != "SKIPPED")))
    on_time = sum(1 for st, d, c in due if st == "DONE" and c is not None and c <= d)
    active = db.scalar(select(func.count(CareJourney.id)).where(CareJourney.status == "ACTIVE")) or 0
    from .retest_model import compute_kpis

    completion = next((k for k in compute_kpis(db, frm=start, to=end).get("kpis", []) if k["key"] == "completion_rate"), {})
    return {"active_journeys": active, "steps_due": len(due), "steps_on_time": on_time, "steps_on_time_pct": pct(on_time, len(due)),
            "retest_completion_pct": completion.get("value")}
