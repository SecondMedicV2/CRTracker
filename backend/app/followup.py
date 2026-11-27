"""Buckets, timeline, priority and retest score (Parts 7.3-7.5, 8, 11.3-11.5).
All deterministic and auditable; the numbers come from editable rule sets."""
from datetime import date, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from . import assign, status
from .analysis import load_rules
from .models import Followup, Order, Patient, PatientBucket, Report, ReportParameter
from .settings_store import get_setting
from .timeutil import to_ist_date, today_ist

DONE_STAGES = {"DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED", "DECLINED", "WRONG_NUMBER"}
SEV_RANK = {"": 0, "mild": 1, "moderate": 2, "severe": 3}
OTHER = {"code": "OTHER", "name": "Other abnormal", "params": [], "interval_days": None, "priority": "ROUTINE", "retest": []}


def abnormal_params(params):
    return [p for p in params if p.system_flag in ("LOW", "HIGH")]


def assign_buckets(abn: list, buckets: list[dict]) -> dict[str, dict]:
    """{bucket_code: {"bucket": rule, "severity": worst, "reasons": [...]}}. A patient can be in several."""
    by_param = {code: b for b in buckets for code in b.get("params", [])}
    other = next((b for b in buckets if b["code"] == "OTHER"), OTHER)
    out: dict[str, dict] = {}
    for p in abn:
        b = by_param.get(p.param_code, other)
        if b.get("only_direction") and p.system_flag != b["only_direction"]:
            continue  # e.g. a LOW tumour marker is not a concern
        e = out.setdefault(b["code"], {"bucket": b, "severity": "", "reasons": []})
        e["reasons"].append(f"{p.param_name_raw} {p.system_flag.lower()} ({p.severity or 'flagged by lab'})")
        if SEV_RANK[p.severity] > SEV_RANK[e["severity"]]:
            e["severity"] = p.severity
    return out


def is_critical(params, critical_values: list[dict]) -> bool:
    for cv in critical_values:
        for p in params:
            if p.param_code == cv.get("param_code") and p.value_num is not None:
                if (cv.get("below") is not None and p.value_num < cv["below"]) or (cv.get("above") is not None and p.value_num > cv["above"]):
                    return True
    return False


def interval_for(bucket_entries: dict, default_days: int) -> int:
    days = [e["bucket"]["interval_days"] if e["bucket"].get("interval_days") is not None else default_days for e in bucket_entries.values()]
    return min(days) if days else default_days


def score(worst_sev: str, days_since: int, interval: int, trend: str, n_buckets: int, engaged: bool, w: dict):
    """Returns (score, breakdown, tier). Part 11.4."""
    ratio = float("inf") if interval <= 0 else days_since / interval
    time_pts = next(pts for bound, pts in w["time_ratio"] if bound is None or ratio < bound)
    bucket_pts = w["buckets"]["1"] if n_buckets <= 1 else w["buckets"]["2"] if n_buckets == 2 else w["buckets"]["3+"]
    parts = [
        ("Severity of worst abnormal value", worst_sev or "none", w["severity"].get(worst_sev, 0)),
        ("Time since test vs follow-up interval", f"{days_since} of {interval} days", time_pts),
        ("Trend vs previous report", trend, w["trend"][trend]),
        ("Number of abnormal buckets", str(n_buckets), bucket_pts),
        ("Has ordered retests before", "yes" if engaged else "no", w["engagement_bonus"] if engaged else 0),
    ]
    total = min(100, sum(p for _, _, p in parts))
    tier = "HIGH" if total >= w["tiers"]["HIGH"] else "MEDIUM" if total >= w["tiers"]["MEDIUM"] else "LOW"
    return total, [{"factor": f, "detail": d, "points": p} for f, d, p in parts], tier


def param_trends(db: Session, patient_id: int, report: Report, abn: list) -> dict[str, str]:
    """Per abnormal test: worsening | stable_abnormal | improving, compared with the patient's
    previous value of the same test. Tests with no earlier value are left out."""
    codes = [p.param_code for p in abn if p.param_code]
    if not codes or report.collected_on is None:
        return {}
    rows = db.execute(
        select(ReportParameter, Report.collected_on).join(Report, Report.id == ReportParameter.report_id)
        .join(Order, Order.id == Report.order_id)
        .where(Order.patient_id == patient_id, Report.id != report.id, Report.collected_on < report.collected_on,
               ReportParameter.param_code.in_(codes), ReportParameter.system_flag.in_(("NORMAL", "LOW", "HIGH")))
        .order_by(Report.collected_on.desc())).all()
    prev: dict[str, float] = {}
    for p, _ in rows:  # newest first: keep the most recent earlier value per test
        prev.setdefault(p.param_code, p.deviation_pct or 0.0)
    out = {}
    for p in abn:
        if p.param_code in prev:
            diff = (p.deviation_pct or 0.0) - prev[p.param_code]
            out[p.param_code] = "worsening" if diff > 1 else "improving" if diff < -1 else "stable_abnormal"
    return out


def trend_vs_previous(db: Session, patient_id: int, report: Report, abn: list) -> str:
    verdicts = set(param_trends(db, patient_id, report, abn).values())
    return next((v for v in ("worsening", "stable_abnormal", "improving") if v in verdicts), "none")


def collected_date(report: Report, order: Order) -> date:
    d = report.collected_on or order.collected_on or report.reported_on or order.reported_on
    return to_ist_date(d)


def build(db: Session, order: Order) -> Followup | None:
    """Create or refresh the follow-up for a READY order. Idempotent; never disturbs a follow-up
    a caller or doctor has already started."""
    if order.status != status.READY or not order.patient_id:
        return None
    report = db.scalar(select(Report).where(Report.order_id == order.id))
    if not report:
        return None
    from . import retest_model
    retest_model.match_completed_plans(db, order.patient_id, report)
    if report.classification != "ABNORMAL":
        db.commit()
        return None  # normal patients get no call by default (Part 7.4)
    fu = db.scalar(select(Followup).where(Followup.report_id == report.id))
    if fu and fu.stage != "NOT_CALLED":
        return fu
    rules = load_rules(db)
    params = db.scalars(select(ReportParameter).where(ReportParameter.report_id == report.id)).all()
    abn = abnormal_params(params)
    buckets = assign_buckets(abn, rules.get("buckets", []))
    if not buckets:
        return None
    default_days = get_setting(db, "default_interval_days")
    interval = interval_for(buckets, default_days)
    collected = collected_date(report, order)
    today = today_ist()
    due = today if interval <= 0 else collected + timedelta(days=interval)
    escalate = any(e["bucket"].get("priority") == "ESCALATION" for e in buckets.values()) or is_critical(params, rules.get("critical_values", []))
    worst = max((e["severity"] for e in buckets.values()), key=SEV_RANK.get)
    trend = trend_vs_previous(db, order.patient_id, report, abn)
    engaged = db.scalar(select(Followup.id).where(Followup.patient_id == order.patient_id, Followup.stage == "RETEST_ORDERED").limit(1)) is not None
    total, breakdown, tier = score(worst, max((today - collected).days, 0), interval, trend, len(buckets), engaged, rules["score_weights"])

    fu = fu or Followup(report_id=report.id, patient_id=order.patient_id, created_by=None)
    fu.patient_id, fu.due_on = order.patient_id, due
    fu.bucket_codes, fu.abnormal_codes = sorted(buckets), sorted({p.param_code for p in abn if p.param_code})
    fu.priority, fu.retest_score, fu.retest_tier, fu.score_breakdown = ("ESCALATION" if escalate else "ROUTINE"), total, tier, breakdown
    fu.suppressed_reason = _covered_by_newer(db, order.patient_id, report, fu.abnormal_codes)
    db.add(fu)
    db.flush()
    _refresh_buckets(db, order.patient_id, report, buckets)
    _suppress_older(db, order.patient_id, report, fu.abnormal_codes)
    from . import retest as retest_svc
    retest_svc.plan_retest(db, fu, fallback_interval_days=interval, trends=param_trends(db, order.patient_id, report, abn), notify_urgent=False)
    if not fu.suppressed_reason and (not (fu.priority == "ROUTINE" and fu.retest_tier == "LOW") or fu.retest_status == "DOCTOR_TO_SET" or fu.protocol_tier == "URGENT"):
        assign.assign(db, fu)  # parked and suppressed cases need no doctor yet
    if fu.protocol_tier == "URGENT" and not fu.suppressed_reason:
        retest_svc.notify_urgent(db, fu)
    from . import journeys as journey_svc
    journey_svc.start_or_sync_journey(db, fu, rules=rules)
    db.commit()
    return fu


def _refresh_buckets(db: Session, patient_id: int, report: Report, buckets: dict) -> None:
    db.execute(delete(PatientBucket).where(PatientBucket.report_id == report.id))
    newer = db.scalar(select(Report.id).join(Order, Order.id == Report.order_id).where(
        Order.patient_id == patient_id, Report.collected_on > report.collected_on).limit(1)) if report.collected_on else None
    if not newer:  # this is the patient's latest report: older bucket memberships become history
        db.execute(update(PatientBucket).where(PatientBucket.patient_id == patient_id).values(active=False))
    for code, e in buckets.items():
        db.add(PatientBucket(patient_id=patient_id, report_id=report.id, bucket_code=code, severity=e["severity"],
                             reason="; ".join(e["reasons"])[:300], active=not newer))


def _covered_by_newer(db: Session, patient_id: int, report: Report, codes: list) -> str:
    """Part 11.4: skip the call if a newer report already re-tested everything that was abnormal."""
    if not report.collected_on or not codes:
        return ""
    for r in db.scalars(select(Report).join(Order, Order.id == Report.order_id).where(
            Order.patient_id == patient_id, Report.collected_on > report.collected_on)):
        have = {c for (c,) in db.execute(select(ReportParameter.param_code).where(ReportParameter.report_id == r.id))}
        if set(codes) <= have:
            return "A newer report already covers these tests"
    return ""


def _suppress_older(db: Session, patient_id: int, report: Report, new_codes: list) -> None:
    have = {c for (c,) in db.execute(select(ReportParameter.param_code).where(ReportParameter.report_id == report.id))}
    older = db.scalars(select(Followup).join(Report, Report.id == Followup.report_id).where(
        Followup.patient_id == patient_id, Followup.stage == "NOT_CALLED", Followup.suppressed_reason == "",
        Followup.report_id != report.id, Report.collected_on < report.collected_on)) if report.collected_on else []
    for f in older:
        if set(f.abnormal_codes) <= have:
            f.suppressed_reason = "A newer report already covers these tests"


def sync_profile_buckets(db: Session, patient_id: int, commit: bool = True) -> None:
    """Assigns profile-driven HYPERTENSION and BONE buckets without altering lab bucket assignment."""
    from . import programs as prog_svc, relationship as rel

    root, pids = rel.patient_family_ids(db, patient_id)
    patient = db.get(Patient, root) if hasattr(Order, "patient_id") else None
    latest = db.scalar(
        select(Report).join(Order, Order.id == Report.order_id)
        .where(Order.patient_id.in_(pids), Order.status == status.READY)
        .order_by(Report.collected_on.desc(), Report.id.desc()).limit(1)
    )
    if not latest:
        return
    profile, _, _ = prog_svc.get_profile(db, root)
    labs: dict[str, list[ReportParameter]] = {}
    for p in db.scalars(select(ReportParameter).where(ReportParameter.report_id == latest.id)):
        if p.param_code:
            labs.setdefault(p.param_code, []).append(p)
    bp_high, _ = prog_svc.bp_is_high(profile)
    htn = bp_high or any(c.get("code") == "HYPERTENSION" and c.get("status") == "CONFIRMED" for c in profile.get("conditions", []))
    age = latest.age if latest.age is not None else (patient.age if patient else None)
    gender = latest.gender or (patient.gender if patient else "")
    bone = prog_svc.bone_risk_from_profile(age, gender, profile, labs)

    for code, should_have, reason in (
        ("HYPERTENSION", htn, "Elevated BP readings or confirmed hypertension"),
        ("BONE", bone, "Low Vitamin D with risk factors or bone imaging/condition"),
    ):
        db.execute(delete(PatientBucket).where(
            PatientBucket.patient_id.in_(pids), PatientBucket.report_id == latest.id, PatientBucket.bucket_code == code
        ))
        if should_have:
            db.add(PatientBucket(
                patient_id=root, report_id=latest.id, bucket_code=code, severity="mild", reason=reason, active=True
            ))
    if commit:
        db.commit()
    else:
        db.flush()
