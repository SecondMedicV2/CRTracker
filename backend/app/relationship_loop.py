"""Page 14: the live Holistic Health Loop. Aggregates only, with small-cell suppression when filtered to one employer.
Every figure is computed from stored records; where there is nothing to measure the value is None ("—")."""
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CareTouchpoint, Patient
from .relationship import STAGES
from .relationship_metrics import ami_coordination, pct, revenue_split, show_pct
from .timeutil import today_ist

SMALL_CELL = 10


def compute_health_loop(db: Session, from_date: date | None = None, to_date: date | None = None,
                        hub_id: int | None = None, corporate_id: int | None = None) -> dict:
    end_d = to_date or today_ist()
    start_d = from_date or (end_d - timedelta(days=365))
    pq = select(Patient.id).where(Patient.merged_into_id.is_(None))
    if corporate_id is not None:
        pq = pq.where(Patient.corporate_client_id == corporate_id)
    pids = set(db.scalars(pq))
    total_patients = len(pids)

    def cell(n: int):
        return "< 10" if corporate_id is not None and 0 < n < SMALL_CELL else n

    tq = select(CareTouchpoint).where(CareTouchpoint.occurred_on >= start_d, CareTouchpoint.occurred_on <= end_d)
    if hub_id:
        tq = tq.where(CareTouchpoint.health_hub_id == hub_id)
    tps = [t for t in db.scalars(tq) if t.patient_id in pids]

    stage_data = {st: {"patients": set(), "revenue": 0} for st in STAGES}
    patient_tps: dict[int, list] = {}
    for t in tps:
        st = t.stage if t.stage in stage_data else "ONGOING_MONITORING"
        stage_data[st]["patients"].add(t.patient_id)
        stage_data[st]["revenue"] += t.amount_inr or 0
        patient_tps.setdefault(t.patient_id, []).append((t.occurred_on, st))

    stages = [{"stage": st, "patient_count": cell(len(stage_data[st]["patients"])), "revenue_inr": stage_data[st]["revenue"],
               "patient_pct": show_pct(pct(len(stage_data[st]["patients"]), total_patients))} for st in STAGES]

    # where patients go next: stage A -> stage B within 120 days
    transitions = {a: {b: 0 for b in STAGES} for a in STAGES}
    for rows in patient_tps.values():
        rows.sort(key=lambda x: x[0])
        for (d1, s1), (d2, s2) in zip(rows, rows[1:]):
            if (d2 - d1).days <= 120:
                transitions[s1][s2] += 1

    # retention: active in the previous period of the same length and still active now
    span = (end_d - start_d).days + 1
    prev_start = start_d - timedelta(days=span)
    prev_active = {p for (p,) in db.execute(select(CareTouchpoint.patient_id).where(
        CareTouchpoint.occurred_on >= prev_start, CareTouchpoint.occurred_on < start_d)) if p in pids}
    curr_active = set(patient_tps)
    retention = pct(len(prev_active & curr_active), len(prev_active))

    rev = revenue_split(db, start_d, end_d, hub_id, pids)
    ami = ami_coordination(db, start_d, end_d)

    one_time = sum(1 for rows in patient_tps.values() if len({d for d, _ in rows}) == 1)
    reactivated = 0
    for pid in curr_active:
        ds = sorted({d for (d,) in db.execute(select(CareTouchpoint.occurred_on).where(CareTouchpoint.patient_id == pid,
                                                                                         CareTouchpoint.occurred_on <= end_d))})
        if any(b >= start_d and (b - a).days > 180 for a, b in zip(ds, ds[1:])):
            reactivated += 1

    return {
        "period": {"from": start_d.isoformat(), "to": end_d.isoformat()},
        "stages": stages,
        "transitions": transitions,
        "retention_rate": show_pct(retention),
        "ami_coordination": {"active_journeys": ami["active_journeys"], "steps_on_time_pct": show_pct(ami["steps_on_time_pct"]),
                             "retest_completion_pct": show_pct(ami["retest_completion_pct"])},
        "revenue_ring": {"transactions_inr": rev["transactions"], "subscriptions_inr": rev["subscriptions"], "corporate_inr": rev["corporate"],
                         "total_holistic_revenue_inr": rev["total"],
                         "annual_contribution_per_patient_inr": round(rev["total"] / len(curr_active)) if curr_active else None},
        "transaction_cohort": {"one_time_patients": cell(one_time), "reactivated_patients": cell(reactivated),
                               "revenue_per_transaction_inr": round(rev["transactions"] / rev["transaction_count"]) if rev["transaction_count"] else None},
    }
