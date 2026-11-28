"""Page 13: the 12-dimension Relationship Model scorecard. Every number is computed from stored records;
a dimension with nothing to measure is NOT_AVAILABLE rather than a placeholder figure."""
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import (CareTouchpoint, CorporateClient, ExpressNode, Followup, HealthHub, Membership, Order, Patient, PlanEnrollment,
                     RefillSchedule)
from .relationship_metrics import ami_coordination, pct, revenue_split, show_pct
from .timeutil import today_ist

SMALL_CELL = 10


def _dim(name, current_model, proposed_model, current, proposed, status=None):
    has_data = proposed.get("value") not in (None, "—")
    return {"dimension": name, "current_model": current_model, "proposed_model": proposed_model, "current_metric": current,
            "proposed_metric": proposed, "trend": None, "data_status": status or ("OK" if has_data else "NOT_AVAILABLE")}


def _na(label):
    return {"label": label, "value": "—"}


def compute_relationship_scorecard(db: Session, from_date: date | None = None, to_date: date | None = None,
                                   hub_id: int | None = None, node_id: int | None = None, corporate_id: int | None = None) -> dict:
    end_d = to_date or today_ist()
    start_d = from_date or (end_d - timedelta(days=365))

    pq = select(Patient).where(Patient.merged_into_id.is_(None))
    if corporate_id is not None:
        pq = pq.where(Patient.corporate_client_id == corporate_id)
    patients = db.scalars(pq).all()
    pids = {p.id for p in patients}
    total_patients = len(pids)
    suppress = corporate_id is not None and total_patients < SMALL_CELL

    tq = select(CareTouchpoint).where(CareTouchpoint.occurred_on >= start_d, CareTouchpoint.occurred_on <= end_d)
    if hub_id:
        tq = tq.where(CareTouchpoint.health_hub_id == hub_id)
    if node_id:
        tq = tq.where(CareTouchpoint.express_node_id == node_id)
    tps = [t for t in db.scalars(tq) if t.patient_id in pids]
    dates, stages, counts = {}, {}, {}
    for t in tps:
        dates.setdefault(t.patient_id, set()).add(t.occurred_on)
        stages.setdefault(t.patient_id, set()).add(t.stage)
        counts[t.patient_id] = counts.get(t.patient_id, 0) + 1
    active = len(dates)

    # 1. Customer relationship
    multi = sum(1 for d in dates.values() if len(d) >= 2)
    one_time = active - multi
    # 2. Revenue
    rev = revenue_split(db, start_d, end_d, hub_id, pids)
    tx_share, sub_share, corp_share = (pct(rev[k], rev["total"]) for k in ("transactions", "subscriptions", "corporate"))
    # 3. Acquisition: reactivated = came back after 180+ quiet days; cross-sold = 2+ loop stages
    all_dates = {}
    for pid, occ in db.execute(select(CareTouchpoint.patient_id, CareTouchpoint.occurred_on).where(CareTouchpoint.occurred_on <= end_d)):
        if pid in dates:
            all_dates.setdefault(pid, []).append(occ)
    reactivated = 0
    for pid, ds in all_dates.items():
        ds = sorted(set(ds))
        if any(b >= start_d and (b - a).days > 180 for a, b in zip(ds, ds[1:])):
            reactivated += 1
    cross = sum(1 for s in stages.values() if len(s) >= 2)
    # 4. Diagnostics: tested patients who went on to a paid care plan or membership
    tested = {p for (p,) in db.execute(select(Order.patient_id).where(Order.patient_id.is_not(None)).distinct()) if p in pids}
    in_care = {p for (p,) in db.execute(select(PlanEnrollment.patient_id).where(PlanEnrollment.activated_at.is_not(None)).distinct())}
    in_care |= {p for (p,) in db.execute(select(Membership.patient_id).where(Membership.plan_code != "H360_FREE",
                                                                             Membership.status.in_(("ACTIVE", "RENEWAL_DUE"))).distinct())}
    entered = len(tested & in_care)
    # 5. Pharmacy: active refill schedules that are not overdue
    refills = [r for r in db.scalars(select(RefillSchedule).where(RefillSchedule.status == "ACTIVE")) if r.patient_id in pids]
    on_time = sum(1 for r in refills if r.next_refill_on >= today_ist())
    # 6. Doctors: patients followed up 2+ times by the same doctor
    pairs = {}
    for doc, pid in db.execute(select(Followup.assigned_doctor_id, Followup.patient_id).where(Followup.assigned_doctor_id.is_not(None))):
        if pid in pids:
            pairs[(doc, pid)] = pairs.get((doc, pid), 0) + 1
    doc_patients = {pid for _, pid in pairs}
    longitudinal = {pid for (_, pid), n in pairs.items() if n >= 2}
    # 7. AMI
    ami = ami_coordination(db, start_d, end_d)
    # 8. Health Hubs
    hubs = db.scalar(select(func.count(HealthHub.id)).where(HealthHub.active.is_(True))) or 0
    hub_visits = sum(1 for t in tps if t.health_hub_id)
    hub_enr = db.scalar(select(func.count(PlanEnrollment.id)).where(PlanEnrollment.activated_at.is_not(None),
                                                                     PlanEnrollment.health_hub_id.is_not(None))) or 0
    # 9. Express Nodes
    nodes = db.scalar(select(func.count(ExpressNode.id)).where(ExpressNode.active.is_(True))) or 0
    node_visits = sum(1 for t in tps if t.express_node_id)
    node_patients = sum(1 for p in patients if p.source_channel == "EXPRESS_NODE")
    # 10. Corporate clients
    corps = db.scalars(select(CorporateClient).where(CorporateClient.active.is_(True))).all()
    corp_members = db.scalar(select(func.count(Membership.id)).where(
        Membership.payer == "CORPORATE", Membership.status.in_(("ACTIVE", "RENEWAL_DUE")),
        *( [Membership.corporate_client_id == corporate_id] if corporate_id is not None else []))) or 0
    # 11. Money
    avg_tx = round(rev["transactions"] / rev["transaction_count"]) if rev["transaction_count"] else None
    per_patient = round(rev["total"] / active) if active else None
    # 12. Strategic asset
    long_rel = sum(1 for n in counts.values() if n >= 3)

    def cnt(n):
        return "< 10" if suppress and isinstance(n, int) and 0 < n < SMALL_CELL else n

    dims = [
        _dim("Customer relationship", "Individual service purchase", "Continuous healthcare engagement",
             {"label": "One-time patients %", "value": show_pct(pct(one_time, active))},
             {"label": "≥ 2 touchpoints in the period %", "value": show_pct(pct(multi, active)), "numerator": cnt(multi), "denominator": active}),
        _dim("Revenue", "Per transaction", "Subscription + transactions + enterprise contracts",
             {"label": "Transaction revenue share", "value": show_pct(tx_share)},
             {"label": "Subscription / transaction / enterprise", "value": "—" if not rev["total"] else f"{sub_share}% sub / {tx_share}% tx / {corp_share}% corp",
              "numerator": rev["subscriptions"] + rev["corporate"], "denominator": rev["total"]}),
        _dim("Patient acquisition", "Repeated acquisition and reactivation", "Acquisition followed by retention and cross-selling",
             {"label": "Reactivated after 180+ quiet days %", "value": show_pct(pct(reactivated, active))},
             {"label": "Cross-sold (≥ 2 loop stages) %", "value": show_pct(pct(cross, active)), "numerator": cnt(cross), "denominator": active}),
        _dim("Diagnostics", "Revenue-generating test", "Entry point into ongoing care",
             {"label": "Tested patients with no ongoing care %", "value": show_pct(pct(len(tested) - entered, len(tested)))},
             {"label": "Tested patients who entered ongoing care %", "value": show_pct(pct(entered, len(tested))), "numerator": cnt(entered), "denominator": len(tested)}),
        _dim("Pharmacy", "Medicine purchase", "Prescription management and refill continuity",
             _na("One-off medicine orders (no pharmacy order data)"),
             {"label": "Active refills not overdue %", "value": show_pct(pct(on_time, len(refills))), "numerator": on_time, "denominator": len(refills)}),
        _dim("Doctors", "Individual consultation", "Longitudinal clinical relationship",
             {"label": "Patients seen once by their doctor %", "value": show_pct(pct(len(doc_patients) - len(longitudinal), len(doc_patients)))},
             {"label": "Seen ≥ 2 times by the same doctor %", "value": show_pct(pct(len(longitudinal), len(doc_patients))),
              "numerator": cnt(len(longitudinal)), "denominator": len(doc_patients)}),
        _dim("AMI", "Workflow automation", "Continuous care coordination",
             _na("Tasks automated (not tracked)"),
             {"label": "Journey steps done on time %", "value": show_pct(ami["steps_on_time_pct"]), "numerator": ami["steps_on_time"], "denominator": ami["steps_due"]}),
        _dim("Health Hubs", "Service delivery locations", "Patient enrollment and care-management centers",
             {"label": "Services delivered per hub", "value": "—" if not hubs else f"{round(hub_visits / hubs, 1)} / hub"},
             {"label": "Paid care-plan enrolments per hub", "value": "—" if not hubs else f"{round(hub_enr / hubs, 1)} / hub", "numerator": hub_enr, "denominator": hubs}),
        _dim("Express Nodes", "Distribution and referral points", "Local patient acquisition and engagement network",
             {"label": "Services delivered per node", "value": "—" if not nodes else f"{round(node_visits / nodes, 1)} / node"},
             {"label": "Patients acquired per node", "value": "—" if not nodes else f"{round(node_patients / nodes, 1)} / node", "numerator": node_patients, "denominator": nodes}),
        _dim("Corporate clients", "Healthcare service buyers", "Long-term population-health partners",
             _na("One-off corporate camps (not tracked)"),
             {"label": "Active employer-paid members", "value": "< 10" if suppress else (str(corp_members) if corps else "—"),
              "numerator": 0 if suppress else corp_members, "denominator": len(corps)},
             "PARTIAL" if suppress else None),
        _dim("Core financial metric", "Revenue per transaction", "Annual contribution per active patient",
             {"label": "Average transaction value", "value": "—" if avg_tx is None else f"₹{avg_tx:,}"},
             {"label": "Period revenue / active patient", "value": "—" if per_patient is None else f"₹{per_patient:,}", "numerator": rev["total"], "denominator": active}),
        _dim("Strategic asset", "Healthcare network", "Healthcare network + longitudinal patient relationships",
             {"label": "Active hubs and nodes", "value": f"{hubs + nodes} locations"},
             {"label": "Patients with ≥ 3 touchpoints", "value": "—" if not active else f"{cnt(long_rel)} patients", "numerator": cnt(long_rel), "denominator": active}),
    ]
    return {"period": {"from": start_d.isoformat(), "to": end_d.isoformat()},
            "filters": {"hub_id": hub_id, "node_id": node_id, "corporate_id": corporate_id}, "dimensions": dims}
