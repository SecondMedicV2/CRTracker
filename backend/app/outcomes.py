"""Report-to-outcome loop: safety triage, the plan-sale gate, and the outcome metrics.

From the Smart Diagnostics brief:
- RED (critical value) -> a doctor calls within 60 minutes, and no plan is sold until a doctor clears the patient.
- AMBER (abnormal) -> a doctor reviews within 24 hours and the matching condition plan is offered.
- GREEN (normal) -> a preventive plan, with no extra tests pushed.
- North Star: verified health deltas = members with at least one biomarker improved at a clinically timed retest.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import (CallCard, CallLog, CareTouchpoint, Followup, Membership, Patient, Payment, PlanEnrollment,
                     ProgramRecommendation, Report)
from .timeutil import IST, today_ist

RED, AMBER, GREEN = "RED", "AMBER", "GREEN"
RED_CALL_MINUTES = 60
AMBER_REVIEW_HOURS = 24
PLAN_SIGNED_HOURS = 24
PLAN_ACTIVE_HOURS = 48


class PlanSaleBlocked(Exception):
    """Raised when a plan would be sold to a patient whose critical result no doctor has cleared."""


def triage_colour(fu: Followup) -> str:
    if fu.priority == "ESCALATION" or fu.protocol_tier == "URGENT":
        return RED
    if fu.abnormal_codes or fu.bucket_codes or fu.finding_codes:
        return AMBER
    return GREEN


def _patient_ids(db: Session, patient_id: int) -> list[int]:
    return [patient_id, *db.scalars(select(Patient.id).where(Patient.merged_into_id == patient_id))]


def uncleared_red_followups(db: Session, patient_id: int) -> list[Followup]:
    rows = db.scalars(select(Followup).where(Followup.patient_id.in_(_patient_ids(db, patient_id)),
                                             Followup.doctor_cleared_at.is_(None)))
    return [f for f in rows if triage_colour(f) == RED]


def assert_plan_sale_allowed(db: Session, patient_id: int) -> None:
    if uncleared_red_followups(db, patient_id):
        raise PlanSaleBlocked("A doctor must clear this patient's critical result before any plan is sold.")


def clear_followup(db: Session, fu: Followup, doctor_user_id: int) -> Followup:
    if fu.doctor_cleared_at is None:
        fu.doctor_cleared_at = datetime.now(timezone.utc)
        fu.doctor_cleared_by = doctor_user_id
        db.commit()
    return fu


def triage_out(fu: Followup) -> dict:
    colour = triage_colour(fu)
    return {"colour": colour,
            "cleared": fu.doctor_cleared_at is not None,
            "cleared_at": fu.doctor_cleared_at,
            "plan_sale_blocked": colour == RED and fu.doctor_cleared_at is None,
            "rule": {RED: f"Doctor call within {RED_CALL_MINUTES} minutes; no plan is sold until a doctor clears it.",
                     AMBER: f"Doctor review within {AMBER_REVIEW_HOURS} hours and the matching condition plan.",
                     GREEN: "Preventive plan; no extra tests pushed."}[colour]}


# ---------------- metrics ----------------
def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _within(start: datetime | None, end: datetime | None, limit: timedelta) -> bool:
    s, e = _aware(start), _aware(end)
    return bool(s and e and timedelta(0) <= e - s <= limit)


def _rate(num: int, den: int) -> dict:
    return {"numerator": num, "denominator": den, "value": round(100.0 * num / den, 1) if den else None}


def _range(frm: date, to: date) -> tuple[datetime, datetime]:
    start = datetime(frm.year, frm.month, frm.day, tzinfo=IST).astimezone(timezone.utc)
    end = datetime(to.year, to.month, to.day, tzinfo=IST).astimezone(timezone.utc) + timedelta(days=1)
    return start, end


def _first_doctor_action(db: Session, fu: Followup) -> datetime | None:
    times = [fu.doctor_cleared_at]
    times.append(db.scalar(select(func.min(CallLog.started_at)).where(CallLog.followup_id == fu.id, CallLog.role == "DOCTOR")))
    times.append(db.scalar(select(func.min(ProgramRecommendation.decided_at)).where(ProgramRecommendation.followup_id == fu.id,
                                                                                    ProgramRecommendation.decided_at.is_not(None))))
    times.append(db.scalar(select(func.min(CallCard.doctor_approved_at)).where(CallCard.followup_id == fu.id)))
    times = [_aware(t) for t in times if t is not None]
    return min(times) if times else None


def verified_health_deltas(db: Session, frm: date, to: date) -> dict:
    """Members whose retest in the period shows at least one marker 'Improved' against their previous result."""
    from . import compare as compare_svc  # local import: compare pulls in the rules engine

    start, end = _range(frm, to)
    reports = list(db.scalars(select(Report).where(Report.created_at >= start, Report.created_at < end)))
    improved, retested = set(), set()
    for r in reports:
        fu = db.scalar(select(Followup).where(Followup.report_id == r.id))
        if not fu:
            continue
        rows = compare_svc.compare(db, fu.patient_id, r.id)
        compared = [x for x in rows if x.get("change_status")]
        if not compared:
            continue
        retested.add(fu.patient_id)
        if any(x["change_status"] == "Improved" for x in compared):
            improved.add(fu.patient_id)
    return {"key": "verified_health_deltas", "name": "Verified health deltas (North Star)",
            "definition": "Members with at least one biomarker improved at a retest in the period",
            "value": len(improved), "retested_members": len(retested),
            "improved_share": _rate(len(improved), len(retested))["value"]}


def outcome_metrics(db: Session, frm: date | None = None, to: date | None = None) -> dict:
    to = to or today_ist()
    frm = frm or (to - timedelta(days=89))
    start, end = _range(frm, to)
    fus = list(db.scalars(select(Followup).where(Followup.created_at >= start, Followup.created_at < end)))

    signed = [0, 0]
    active = [0, 0]
    red = [0, 0]
    amber = [0, 0]
    for fu in fus:
        colour = triage_colour(fu)
        first = _first_doctor_action(db, fu)
        if colour == RED:
            red[1] += 1
            red[0] += _within(fu.created_at, first, timedelta(minutes=RED_CALL_MINUTES))
        elif colour == AMBER:
            amber[1] += 1
            amber[0] += _within(fu.created_at, first, timedelta(hours=AMBER_REVIEW_HOURS))
        if db.scalar(select(func.count(ProgramRecommendation.id)).where(ProgramRecommendation.followup_id == fu.id)):
            signed[1] += 1
            decided = db.scalar(select(func.min(ProgramRecommendation.decided_at)).where(
                ProgramRecommendation.followup_id == fu.id, ProgramRecommendation.status.in_(("ACCEPTED", "ENROLLED"))))
            signed[0] += _within(fu.created_at, decided, timedelta(hours=PLAN_SIGNED_HOURS))
            act = db.scalar(select(func.min(PlanEnrollment.activated_at)).where(
                PlanEnrollment.patient_id == fu.patient_id, PlanEnrollment.activated_at.is_not(None)))
            active[1] += 1
            active[0] += _within(fu.created_at, act, timedelta(hours=PLAN_ACTIVE_HOURS))

    # renewals: plan periods / memberships that ended in the window and were renewed
    ended_enr = list(db.scalars(select(PlanEnrollment).where(PlanEnrollment.period_end >= frm, PlanEnrollment.period_end <= to)))
    renew_num = sum(1 for e in ended_enr if e.renewal_count > 0)

    # revenue per report: touchpoint revenue (care-plan sales are recorded there) + membership payments
    reports_n = db.scalar(select(func.count(Report.id)).where(Report.created_at >= start, Report.created_at < end)) or 0
    tp_rev = db.scalar(select(func.coalesce(func.sum(CareTouchpoint.amount_inr), 0)).where(
        CareTouchpoint.occurred_on >= frm, CareTouchpoint.occurred_on <= to)) or 0
    mem_rev = db.scalar(select(func.coalesce(func.sum(Payment.amount_inr), 0)).where(
        Payment.membership_id.is_not(None), Payment.status == "PAID", Payment.created_at >= start, Payment.created_at < end)) or 0

    # how often doctors change AMI's drafts: follow-ups with an approved card where a later version was a doctor edit
    approved_fids = list(db.scalars(select(CallCard.followup_id).where(
        CallCard.doctor_approved_at.is_not(None), CallCard.created_at >= start, CallCard.created_at < end).distinct()))
    edited = 0
    for fid in approved_fids:
        if db.scalar(select(func.count(CallCard.id)).where(CallCard.followup_id == fid, CallCard.version > 1)):
            edited += 1

    from .retest_model import compute_kpis
    kpis = {k["key"]: k for k in compute_kpis(db, frm=frm, to=to).get("kpis", [])}
    completion = kpis.get("completion_rate", {})

    metrics = [
        {"key": "plan_signed_24h", "name": "Doctor-signed plan within 24 hours", **_rate(*signed), "unit": "%"},
        {"key": "plan_active_48h", "name": "Active plan within 48 hours", **_rate(*active), "unit": "%"},
        {"key": "red_doctor_call_60m", "name": f"Doctor call on every RED result within {RED_CALL_MINUTES} minutes", **_rate(*red), "unit": "%"},
        {"key": "amber_review_24h", "name": f"Doctor review of AMBER results within {AMBER_REVIEW_HOURS} hours", **_rate(*amber), "unit": "%"},
        {"key": "retest_completion", "name": "Retest completion in the clinical window",
         "numerator": completion.get("numerator"), "denominator": completion.get("denominator"), "value": completion.get("value"), "unit": "%"},
        {"key": "renewal_rate", "name": "Care-plan renewal", **_rate(renew_num, len(ended_enr)), "unit": "%"},
        {"key": "revenue_per_report", "name": "Revenue per report", "numerator": int(tp_rev + mem_rev), "denominator": reports_n,
         "value": round((tp_rev + mem_rev) / reports_n) if reports_n else None, "unit": "INR"},
        {"key": "doctor_edit_rate", "name": "Doctor edits to AMI drafts", **_rate(edited, len(approved_fids)), "unit": "%"},
    ]
    colours = {RED: 0, AMBER: 0, GREEN: 0}
    for fu in fus:
        colours[triage_colour(fu)] += 1
    return {"from": frm.isoformat(), "to": to.isoformat(), "north_star": verified_health_deltas(db, frm, to),
            "metrics": metrics, "triage": colours,
            "uncleared_red": sum(1 for fu in fus if triage_colour(fu) == RED and fu.doctor_cleared_at is None)}
