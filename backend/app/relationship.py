"""Holistic Health Loop: longitudinal care touchpoints, relationship status and next best step (Page 1)."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import status as ord_status
from .analysis import load_rules
from .models import (Appointment, CareTouchpoint, Followup, Order, Patient, PatientBucket, Report,
                     RetestRecommendation)
from .settings_store import get_setting
from .timeutil import IST, today_ist

STAGES = (
    "PREVENTION",
    "EATING_WELL",
    "DIAGNOSTICS",
    "CONSULTATIONS",
    "MEDICATIONS",
    "CHRONIC_CONDITIONS",
    "ONGOING_MONITORING",
)
DONE_STAGES = {"DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED", "DECLINED", "WRONG_NUMBER"}


def canonical_patient_id(db: Session, patient_id: int) -> int:
    seen = set()
    cur = patient_id
    while cur not in seen:
        seen.add(cur)
        p = db.get(Patient, cur)
        if not p or not p.merged_into_id:
            return cur
        cur = p.merged_into_id
    return patient_id


def patient_family_ids(db: Session, patient_id: int) -> tuple[int, list[int]]:
    root = canonical_patient_id(db, patient_id)
    merged = list(db.scalars(select(Patient.id).where(Patient.merged_into_id == root)))
    return root, [root, *merged]


def _ist_date(dt: datetime | None, fallback: date | None = None) -> date:
    if dt is None:
        return fallback or today_ist()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST).date()


def sync_touchpoints(db: Session, patient_id: int, commit: bool = True) -> int:
    """Idempotently derives automatic touchpoints for a patient (including merged duplicates)."""
    root, pids = patient_family_ids(db, patient_id)
    existing = {
        (t.ref_entity, t.ref_id, t.stage): t
        for t in db.scalars(select(CareTouchpoint).where(CareTouchpoint.patient_id == root, CareTouchpoint.source == "AUTO"))
    }
    # Consolidate any touchpoints that were created on duplicate records prior to merging.
    merged_pids = [p for p in pids if p != root]
    if merged_pids:
        for t in list(db.scalars(select(CareTouchpoint).where(CareTouchpoint.patient_id.in_(merged_pids)))):
            key = (t.ref_entity, t.ref_id, t.stage)
            if t.source == "AUTO" and key in existing:
                db.delete(t)
            else:
                t.patient_id = root
                if t.source == "AUTO":
                    existing[key] = t
        db.flush()
    added = 0

    def ensure(stage: str, ref_entity: str, ref_id: int, occurred_on: date, service_code: str = "", update_date: bool = False):
        nonlocal added
        key = (ref_entity, ref_id, stage)
        if key in existing:
            if update_date and existing[key].occurred_on != occurred_on:
                existing[key].occurred_on = occurred_on
            return
        tp = CareTouchpoint(
            patient_id=root, stage=stage, service_code=service_code[:60], occurred_on=occurred_on,
            source="AUTO", ref_entity=ref_entity, ref_id=ref_id,
        )
        db.add(tp)
        existing[key] = tp
        added += 1

    # 1. Reports -> DIAGNOSTICS
    reports = db.execute(
        select(Report, Order).join(Order, Order.id == Report.order_id)
        .where(Order.patient_id.in_(pids), Order.status != ord_status.PENDING_IDENTITY)
    ).all()
    rep_dates: dict[int, date] = {}
    for r, o in reports:
        d = _ist_date(r.collected_on or o.collected_on or r.reported_on or o.reported_on or r.created_at)
        rep_dates[r.id] = d
        ensure("DIAGNOSTICS", "report", r.id, d, service_code="LAB_REPORT")

    # 2. Appointments DONE or Followups reaching DOCTOR_DONE -> CONSULTATIONS
    fus = list(db.scalars(select(Followup).where(Followup.patient_id.in_(pids))))
    fids = [f.id for f in fus]
    done_appt_fids = set()
    if fids:
        for a in db.scalars(select(Appointment).where(Appointment.followup_id.in_(fids), Appointment.status == "DONE")):
            done_appt_fids.add(a.followup_id)
            ensure("CONSULTATIONS", "appointment", a.id, _ist_date(a.slot_start), service_code="DOCTOR_CONSULT")
    for f in fus:
        if f.stage in ("DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED") and f.id not in done_appt_fids:
            ensure("CONSULTATIONS", "followup", f.id, _ist_date(f.updated_at), service_code="DOCTOR_CONSULT")

    # 3. Active PatientBucket -> CHRONIC_CONDITIONS
    for b in db.scalars(select(PatientBucket).where(PatientBucket.patient_id.in_(pids), PatientBucket.active.is_(True))):
        ensure("CHRONIC_CONDITIONS", "patient_bucket", b.id, rep_dates.get(b.report_id, today_ist()), service_code=b.bucket_code)

    # 4. Ordered RetestRecommendation or doctor-set next_followup_on -> ONGOING_MONITORING
    if fids:
        for rec in db.scalars(select(RetestRecommendation).where(RetestRecommendation.followup_id.in_(fids), RetestRecommendation.ordered.is_(True))):
            ensure("ONGOING_MONITORING", "retest_recommendation", rec.id, _ist_date(rec.created_at), service_code="RETEST_ORDERED")
    for f in fus:
        if f.next_followup_on:
            ensure("ONGOING_MONITORING", "followup_next", f.id, f.next_followup_on, service_code="NEXT_FOLLOWUP", update_date=True)

    if commit:
        db.commit()
    else:
        db.flush()
    return added


def relationship_status(touchpoints: list[CareTouchpoint], has_overdue: bool, today: date, thresholds: dict) -> str:
    new_days = int(thresholds.get("new_days", 30))
    active_days = int(thresholds.get("active_days", 90))
    at_risk_days = int(thresholds.get("at_risk_days", 180))
    if not touchpoints:
        return "AT_RISK" if has_overdue else "LAPSED"
    first_on = min(t.occurred_on for t in touchpoints)
    last_on = max(t.occurred_on for t in touchpoints)
    since_last = (today - last_on).days
    since_first = (today - first_on).days
    if since_last > at_risk_days:
        return "LAPSED"
    if since_last > active_days or has_overdue:
        return "AT_RISK"
    if since_first <= new_days:
        return "NEW"
    return "ACTIVE"


def next_best_step(touchpoints: list[CareTouchpoint], reports: list[Report], active_buckets: list[PatientBucket],
                   status_str: str, rules: list[dict], today: date) -> dict | None:
    by_code = {r["code"]: r for r in rules if "code" in r}
    has_chronic = bool(active_buckets) or any(t.stage == "CHRONIC_CONDITIONS" for t in touchpoints)
    win_lo, win_hi = today - timedelta(days=120), today + timedelta(days=120)
    has_monitoring = any(t.stage == "ONGOING_MONITORING" and win_lo <= t.occurred_on <= win_hi for t in touchpoints)
    has_eating = any(t.stage == "EATING_WELL" for t in touchpoints)
    consult_dates = [t.occurred_on for t in touchpoints if t.stage == "CONSULTATIONS"]
    latest_consult = max(consult_dates) if consult_dates else None
    abnormal_dates = [_ist_date(r.collected_on or r.reported_on or r.created_at) for r in reports if r.classification == "ABNORMAL"]
    abnormal_unconsulted = bool(abnormal_dates) and (latest_consult is None or max(abnormal_dates) > latest_consult)
    stages_present = {t.stage for t in touchpoints}
    only_normal_diag = stages_present == {"DIAGNOSTICS"} and reports and all(r.classification == "NORMAL" for r in reports)

    checks = [
        ("SCHEDULE_RETEST", has_chronic and not has_monitoring),
        ("DOCTOR_CONSULTATION", abnormal_unconsulted),
        ("DIET_PLAN", has_chronic and not has_eating),
        ("REENGAGEMENT_CALL", status_str in ("LAPSED", "AT_RISK")),
        ("PREVENTIVE_SCREENING", bool(only_normal_diag)),
    ]
    for code, hit in checks:
        if hit and code in by_code:
            r = by_code[code]
            return {"code": r["code"], "clinical_label": r["clinical_label"], "caller_label": r["caller_label"]}
    return None


def build_patient_relationship(db: Session, patient_id: int) -> dict:
    root, pids = patient_family_ids(db, patient_id)
    today = today_ist()
    thresholds = get_setting(db, "relationship_thresholds")
    rules = load_rules(db).get("relationship_next_steps", [])
    tps = list(db.scalars(select(CareTouchpoint).where(CareTouchpoint.patient_id == root)
                          .order_by(CareTouchpoint.occurred_on.desc(), CareTouchpoint.id.desc())))
    fus = list(db.scalars(select(Followup).where(Followup.patient_id.in_(pids))))
    has_overdue = any(f.suppressed_reason == "" and f.stage not in DONE_STAGES and f.due_on < today for f in fus)
    reports = list(db.scalars(select(Report).join(Order, Order.id == Report.order_id)
                              .where(Order.patient_id.in_(pids), Order.status != ord_status.PENDING_IDENTITY)))
    active_buckets = list(db.scalars(select(PatientBucket).where(PatientBucket.patient_id.in_(pids), PatientBucket.active.is_(True))))

    status_str = relationship_status(tps, has_overdue, today, thresholds)
    step = next_best_step(tps, reports, active_buckets, status_str, rules, today)
    last_on = max((t.occurred_on for t in tps), default=None)

    stages = []
    for s in STAGES:
        matching = [t for t in tps if t.stage == s]
        stages.append({
            "stage": s,
            "count": len(matching),
            "last_occurred_on": max((t.occurred_on for t in matching), default=None),
        })
    return {
        "patient_id": root,
        "status": status_str,
        "last_touchpoint_on": last_on,
        "next_step": step,
        "stages": stages,
        "touchpoints": tps,
    }


def relationship_summary(db: Session) -> dict:
    today = today_ist()
    thresholds = get_setting(db, "relationship_thresholds")
    patients = list(db.scalars(select(Patient).where(Patient.merged_into_id.is_(None))))
    tps_all = list(db.scalars(select(CareTouchpoint)))
    fus_all = list(db.scalars(select(Followup)))

    tps_by_pat: dict[int, list[CareTouchpoint]] = {}
    for t in tps_all:
        tps_by_pat.setdefault(t.patient_id, []).append(t)
    overdue_pids = {
        canonical_patient_id(db, f.patient_id)
        for f in fus_all if f.suppressed_reason == "" and f.stage not in DONE_STAGES and f.due_on < today
    }

    counts = {"NEW": 0, "ACTIVE": 0, "AT_RISK": 0, "LAPSED": 0}
    active_stage_counts = []
    stage_patients: dict[str, set[int]] = {s: set() for s in STAGES}
    year_ago = today - timedelta(days=365)
    two_years_ago = today - timedelta(days=730)
    prior_year_pids: set[int] = set()
    recent_year_pids: set[int] = set()
    annual_inr = 0

    for p in patients:
        tps = tps_by_pat.get(p.id, [])
        st = relationship_status(tps, p.id in overdue_pids, today, thresholds)
        counts[st] += 1
        distinct_stages = {t.stage for t in tps}
        for s in distinct_stages:
            if s in stage_patients:
                stage_patients[s].add(p.id)
        if st in ("NEW", "ACTIVE"):
            active_stage_counts.append(len(distinct_stages))
        for t in tps:
            if two_years_ago <= t.occurred_on < year_ago:
                prior_year_pids.add(p.id)
            if t.occurred_on >= year_ago:
                recent_year_pids.add(p.id)
                if st in ("NEW", "ACTIVE") and t.amount_inr:
                    annual_inr += t.amount_inr

    total_p = len(patients)
    active_n = counts["NEW"] + counts["ACTIVE"]
    retained = len(prior_year_pids & recent_year_pids)
    retention_pct = round(100.0 * retained / len(prior_year_pids), 1) if prior_year_pids else (
        round(100.0 * sum(1 for pid in recent_year_pids if len(tps_by_pat.get(pid, [])) >= 2) / len(recent_year_pids), 1)
        if recent_year_pids else None
    )
    return {
        "total_patients": total_p,
        "counts": counts,
        "retention_12m_pct": retention_pct,
        "avg_stages_per_active": round(sum(active_stage_counts) / active_n, 2) if active_n else 0.0,
        "annual_contribution_inr": round(annual_inr / active_n, 2) if active_n else 0.0,
        "stage_coverage_pct": {
            s: round(100.0 * len(stage_patients[s]) / total_p, 1) if total_p else 0.0 for s in STAGES
        },
    }
