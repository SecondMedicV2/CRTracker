"""Condition-specific patient journeys, starting with HBA1C_90 (Page 10)."""
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import assign, compare as compare_svc, followup as fu_svc, messaging, programs as prog_svc, relationship as rel, retest as retest_svc, status as ord_status, trends as trends_svc
from .analysis import load_rules
from .models import (Appointment, CallLog, CareJourney, CareTouchpoint, ClinicalTask, Followup, HomeReading, JourneyStep,
                     Order, OutboundMessage, Patient, ProgramRecommendation, RefillSchedule, Report, ReportParameter,
                     RetestRecommendation, RuleSet, User)
from .seed_data import JOURNEY_TEMPLATES, RETEST_PROTOCOLS
from .timeutil import IST, to_ist_date, today_ist

ADHERENCE_CODES = {"TAKING", "MISSED", "STOPPED"}
SYMPTOM_CODES = {"BETTER", "SAME", "WORSE"}

CLINICAL_DISCLAIMER = "Medication changes remain the responsibility of the treating clinician."


def select_journey_template(rules: dict | None, detected: list[str], retest_plan: dict | None = None) -> str:
    """Evaluate selection_rules from journey_templates RuleSet."""
    jt = (rules or {}).get("journey_templates") or JOURNEY_TEMPLATES
    sel_rules = jt.get("selection_rules") or JOURNEY_TEMPLATES["selection_rules"]
    pf = (retest_plan or {}).get("primary_finding") or {}
    main_finding = pf.get("finding_code") or (detected[0] if detected else None)
    for r in sel_rules:
        when = r.get("when")
        if isinstance(when, dict) and when.get("main_finding") and when["main_finding"] == main_finding:
            return str(r.get("template") or "STANDARD_92")
        if when == "default":
            return str(r.get("template") or "STANDARD_92")
    return "HBA1C_90" if main_finding == "HIGH_HBA1C" else "STANDARD_92"


def _glucose_trend(readings: list[HomeReading]) -> dict[str, Any]:
    if not readings:
        return {"source": "none", "points_count": 0, "direction": None, "latest": None, "previous": None, "readings": []}
    home_dev = [r for r in readings if r.source != "MANUAL_STAFF"]
    used_source = "home_readings" if home_dev else "staff_entered"
    pts = []
    for r in reversed(readings):  # oldest first
        v = (r.values or {}).get("value")
        if v is None:
            continue
        try:
            fval = float(v)
        except (TypeError, ValueError):
            continue
        dt_str = to_ist_date(r.taken_at).isoformat() if r.taken_at else ""
        pts.append(trends_svc.TrendPoint(
            date=dt_str, value=fval, value_text=str(fval), unit="mg/dL", status="IN_RANGE", report_id=r.id
        ))
    t = trends_svc.compute_marker_trend("GLUCOSE_HOME", "Home glucose", pts) if pts else None
    latest = readings[0]
    latest_v = (latest.values or {}).get("value")
    return {
        "source": used_source,
        "points_count": len(pts),
        "direction": t.direction if t else None,
        "delta": t.delta if t else None,
        "latest": {
            "value": latest_v,
            "unit": "mg/dL",
            "kind": latest.kind,
            "source": latest.source,
            "taken_at": to_ist_date(latest.taken_at).isoformat() if latest.taken_at else None,
        },
        "previous": {"value": t.previous.value, "date": t.previous.date} if t and t.previous else None,
    }


def _adherence_summary(db: Session, root_pid: int, followup_id: int | None) -> dict[str, Any]:
    call_rows = list(db.scalars(
        select(CallLog).where(CallLog.followup_id == followup_id, CallLog.outcome != "DOCTOR_DONE")
        .order_by(CallLog.started_at.desc())
    )) if followup_id else []
    call_outcomes = [c.outcome for c in call_rows]
    refill_tps = list(db.scalars(
        select(CareTouchpoint).where(
            CareTouchpoint.patient_id == root_pid, CareTouchpoint.service_code == "PHARMACY_REFILL"
        )
    ))
    refills = list(db.scalars(select(RefillSchedule).where(RefillSchedule.patient_id == root_pid)))
    done_refills = len(refill_tps) + sum(1 for r in refills if r.task_status == "DONE" and not refill_tps)
    active_refills = sum(1 for r in refills if r.status == "ACTIVE")
    if done_refills > 0 or any(o in ("BOOKED", "DOCTOR_DONE", "CONTACTED") for o in call_outcomes):
        status = "ON_TRACK"
    elif call_outcomes or active_refills:
        status = "PENDING_CONFIRMATION"
    else:
        status = "NO_DATA"
    return {
        "status": status,
        "calls_logged": len(call_outcomes),
        "call_outcomes": call_outcomes[:10],
        "refill_confirmations": done_refills,
        "active_refills": active_refills,
    }


def build_journey(
    db: Session,
    patient_id: int,
    report_id: int | None = None,
    followup: Followup | None = None,
    *,
    rules: dict | None = None,
) -> dict[str, Any] | None:
    """Build condition-specific journey (HBA1C_90 when main finding is HIGH_HBA1C)."""
    rules = rules or load_rules(db)
    root_pid = rel.canonical_patient_id(db, patient_id)
    pids = [root_pid, *db.scalars(select(Patient.id).where(Patient.merged_into_id == root_pid))]

    if followup is None and report_id is not None:
        followup = db.scalar(select(Followup).where(Followup.report_id == report_id))
    report = db.get(Report, report_id or (followup.report_id if followup else 0)) if (report_id or followup) else None
    if not report:
        return None
    if followup is None:
        followup = db.scalar(select(Followup).where(Followup.report_id == report.id))
    order = db.get(Order, report.order_id)

    detected = list((followup.finding_codes or []) if followup else [])
    if not detected:
        from . import findings
        detected = findings.detect(db, root_pid, report.id)
    if not detected and not any(
        p.param_code == "HBA1C" and p.system_flag == "HIGH"
        for p in db.scalars(select(ReportParameter).where(ReportParameter.report_id == report.id))
    ):
        return None

    plan = (followup.retest_plan or {}) if followup else {}
    template_code = select_journey_template(rules, detected, plan)
    jt = rules.get("journey_templates") or JOURNEY_TEMPLATES
    t_def = (jt.get("templates") or JOURNEY_TEMPLATES["templates"]).get(template_code)
    if not t_def:
        return None

    anchor = to_ist_date(report.collected_on or (order.collected_on if order else None) or report.reported_on)
    today = today_ist()
    days_elapsed = max((today - anchor).days, 0)

    a1c_cur = db.scalar(select(ReportParameter).where(ReportParameter.report_id == report.id, ReportParameter.param_code == "HBA1C"))
    initial_hba1c = float(a1c_cur.value_num) if a1c_cur and a1c_cur.value_num is not None else None

    # Day 1-7 status & doctor confirmation
    doc_done = bool(followup and (
        followup.stage in ("DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED")
        or db.scalar(select(Appointment.id).where(Appointment.followup_id == followup.id, Appointment.status == "DONE").limit(1))
        or db.scalar(select(CallLog.id).where(CallLog.followup_id == followup.id, CallLog.outcome == "DOCTOR_DONE").limit(1))
    ))
    hba1c_proto = next((p for p in (rules.get("retest_protocols") or RETEST_PROTOCOLS) if isinstance(p, dict) and p.get("finding_code") == "HIGH_HBA1C"), {})
    proto_requires_ind = bool(hba1c_proto.get("requires_indication"))
    raw_conf = plan.get("day90_clinically_appropriate")
    clinically_appropriate = bool(raw_conf) if raw_conf is not None else (not proto_requires_ind)

    # Day 7-30 glucose monitoring (home_readings GLUCOSE_* preferred, else MANUAL_STAFF)
    glucose_rows = list(db.scalars(
        select(HomeReading).where(HomeReading.patient_id.in_(pids), HomeReading.kind.like("GLUCOSE%"))
        .order_by(HomeReading.taken_at.desc(), HomeReading.id.desc()).limit(50)
    ))
    glu_info = _glucose_trend(glucose_rows)

    # Day 30-60 adherence & glucose trend
    adherence = _adherence_summary(db, root_pid, followup.id if followup else None)

    # Day 90 retest recommendation & repeat HbA1c
    recs = list(db.scalars(select(RetestRecommendation).where(RetestRecommendation.followup_id == followup.id))) if followup else []
    has_retest_rec = any("HBA1C" in (r.test_codes or []) or not r.test_codes for r in recs)
    ordered_retest = any(r.ordered for r in recs)
    later_a1c_row = db.execute(
        select(ReportParameter, Report).join(Report, Report.id == ReportParameter.report_id).join(Order, Order.id == Report.order_id)
        .where(Order.patient_id.in_(pids), Order.status == ord_status.READY, Report.id != report.id,
               ReportParameter.param_code == "HBA1C", ReportParameter.value_num.is_not(None),
               Report.collected_on >= report.collected_on if report.collected_on else Report.id > report.id)
        .order_by(Report.collected_on.asc(), Report.id.asc())
    ).first()
    new_hba1c = float(later_a1c_row[0].value_num) if later_a1c_row else None
    new_hba1c_date = to_ist_date(later_a1c_row[1].collected_on).isoformat() if later_a1c_row and later_a1c_row[1].collected_on else None

    steps_out = []
    for s in t_def.get("steps", []):
        d_from = int(s.get("day_from") or 0)
        d_to = int(s.get("day_to") or d_from)
        dt_from = (anchor + timedelta(days=d_from)).isoformat()
        dt_to = (anchor + timedelta(days=d_to)).isoformat()
        code = s["code"]

        if template_code == "HBA1C_90":
            if code == "HBA1C_D0":
                st = "DONE"
            elif code == "HBA1C_D1_7":
                st = "DONE" if (doc_done or raw_conf is True) else ("DUE" if days_elapsed >= 1 else "PENDING")
            elif code == "HBA1C_D7_30":
                st = "DONE" if glu_info["points_count"] > 0 else ("DUE" if days_elapsed >= 7 else "PENDING")
            elif code == "HBA1C_D30_60":
                st = "DONE" if (adherence["calls_logged"] > 0 or adherence["refill_confirmations"] > 0) and days_elapsed > 60 else ("DUE" if days_elapsed >= 30 else "PENDING")
            elif code == "HBA1C_D90":
                if new_hba1c is not None:
                    st = "DONE"
                elif raw_conf is False or (proto_requires_ind and raw_conf is not True):
                    st = "AWAITING_CONFIRMATION"
                elif ordered_retest or (has_retest_rec and days_elapsed >= 90):
                    st = "DUE"
                else:
                    st = "PENDING"
            else:
                st = "PENDING"
        else:
            st = "DONE" if d_from == 0 else ("DUE" if days_elapsed >= d_from else "PENDING")

        entry = {
            "code": code,
            "window_label": s.get("window_label", f"Day {d_from}" if d_from == d_to else f"Day {d_from}\u2013{d_to}"),
            "day_from": d_from,
            "day_to": d_to,
            "date_from": dt_from,
            "date_to": dt_to,
            "what_happens": s.get("what_happens", ""),
            "owner": s.get("owner", ""),
            "caller_label": s.get("caller_label", "Follow-up call"),
            "status": st,
        }
        if s.get("disclaimer"):
            entry["disclaimer"] = s["disclaimer"]
        steps_out.append(entry)

    return {
        "template_code": template_code,
        "name": t_def.get("name", template_code),
        "patient_id": root_pid,
        "report_id": report.id,
        "followup_id": followup.id if followup else None,
        "anchor_date": anchor.isoformat(),
        "initial_hba1c": initial_hba1c,
        "new_hba1c": new_hba1c,
        "new_hba1c_date": new_hba1c_date,
        "day90_clinically_appropriate": raw_conf if raw_conf is not None else (not proto_requires_ind),
        "day90_doctor_confirmed": raw_conf,
        "day90_retest_created": bool(has_retest_rec),
        "glucose_monitoring": glu_info,
        "adherence": adherence,
        "disclaimer": CLINICAL_DISCLAIMER,
        "steps": steps_out,
    }


def confirm_day90(db: Session, followup: Followup, clinically_appropriate: bool, doctor_id: int) -> dict[str, Any]:
    """Doctor confirmation tick box on the Day 1-7 plan gating the Day 90 HbA1c retest."""
    plan = dict(followup.retest_plan or {})
    plan["day90_clinically_appropriate"] = clinically_appropriate
    plan["day90_confirmed_by"] = doctor_id
    plan["day90_confirmed_at"] = datetime.now(timezone.utc).isoformat()
    followup.retest_plan = plan
    db.flush()

    proto_recs = list(db.scalars(
        select(RetestRecommendation).where(
            RetestRecommendation.followup_id == followup.id, RetestRecommendation.source == "PROTOCOL"
        )
    ))
    if clinically_appropriate:
        if not db.scalar(select(RetestRecommendation.id).where(RetestRecommendation.followup_id == followup.id).limit(1)):
            db.add(RetestRecommendation(followup_id=followup.id, doctor_id=doctor_id, test_codes=["HBA1C"], source="DOCTOR"))
    else:
        for r in proto_recs:
            if not r.ordered:
                remaining = [c for c in (r.test_codes or []) if c != "HBA1C"]
                if remaining:
                    r.test_codes = remaining
                else:
                    db.execute(delete(RetestRecommendation).where(RetestRecommendation.id == r.id))
    db.flush()
    retest_svc.plan_retest(db, followup, force=False, notify_urgent=False)
    sync_journey_events(db, followup_id=followup.id)
    db.commit()
    return build_journey(db, followup.patient_id, followup.report_id, followup) or {}


# ==============================================================================
# Page 8: Persisted Care Journeys (Day 0 -> Day 92), Events & Daily Scheduler
# ==============================================================================

TEST_PARAM_GROUPS = {
    "HBA1C": {"HBA1C"},
    "FBS": {"GLUCOSE_FASTING", "FBS"},
    "PPBS": {"GLUCOSE_PP", "PPBS"},
    "LIPID": {"CHOL_TOTAL", "LDL", "HDL", "TRIGLYCERIDES"},
    "THYROID": {"TSH", "FT3", "FT4"},
    "TSH": {"TSH"},
    "FT4": {"FT4"},
    "CBC": {"HEMOGLOBIN", "HB", "WBC", "PLATELETS"},
    "IRON": {"FERRITIN", "IRON", "TIBC"},
    "VITD": {"VITAMIN_D", "VIT_D"},
    "CALCIUM": {"CALCIUM"},
    "B12": {"B12", "VITAMIN_B12"},
    "KFT": {"CREATININE", "UREA", "EGFR", "URIC_ACID"},
    "EGFR": {"EGFR"},
    "LFT": {"SGOT", "SGPT", "ALP", "BILIRUBIN"},
}


def _standard_steps(rules: dict | None = None) -> tuple[int, list[dict]]:
    jt = (rules or {}).get("journey_templates") or JOURNEY_TEMPLATES
    tpl = (jt.get("templates") or JOURNEY_TEMPLATES["templates"]).get("STANDARD_92") or JOURNEY_TEMPLATES["templates"]["STANDARD_92"]
    return 1, list(tpl.get("steps") or [])


def _condition_group(followup: Followup) -> str:
    buckets = sorted({b for b in (followup.bucket_codes or []) if b and b != "OTHER"})
    return buckets[0] if buckets else "GENERAL"


def _step_due_dates(db: Session, followup: Followup, started_on: date, rules: dict) -> tuple[dict[str, date], set[str]]:
    """Compute due_on per STANDARD_92 step using Page 7/12 retest window if present, else fallback."""
    _, step_defs = _standard_steps(rules)
    rec = db.scalar(select(RetestRecommendation).where(RetestRecommendation.followup_id == followup.id).order_by(RetestRecommendation.id.desc()))
    has_recs = (
        db.scalar(select(ProgramRecommendation.id).where(ProgramRecommendation.followup_id == followup.id).limit(1)) is not None
        or rec is not None
    )
    win_start = (rec.window_start if rec and rec.window_start else None) or followup.retest_window_start
    reminder_on = followup.reminder_on

    waiting: set[str] = set()
    if not has_recs:
        waiting.update({"D1_RECOMMEND", "D7_ACTIVATION"})
    if win_start is None:
        waiting.update({"D75_RETEST_NOTICE", "D90_RETEST"})

    d90_due = win_start or followup.due_on or (started_on + timedelta(days=90))
    d75_due = reminder_on or (win_start - timedelta(days=15) if win_start else max(started_on, d90_due - timedelta(days=15)))

    due_map: dict[str, date] = {}
    for s in step_defs:
        code = s["code"]
        offset = int(s.get("day_offset") if s.get("day_offset") is not None else (s.get("day_from") or 0))
        if code == "D75_RETEST_NOTICE":
            due_map[code] = d75_due
        elif code == "D90_RETEST":
            due_map[code] = d90_due
        elif code == "D91_COMPARE":
            due_map[code] = d90_due + timedelta(days=1) if win_start else (started_on + timedelta(days=offset))
        elif code == "D92_UPDATE_PLAN":
            due_map[code] = d90_due + timedelta(days=2) if win_start else (started_on + timedelta(days=offset))
        else:
            due_map[code] = started_on + timedelta(days=offset)
    return due_map, waiting


def start_or_sync_journey(
    db: Session,
    followup: Followup,
    *,
    rules: dict | None = None,
    now: datetime | None = None,
) -> CareJourney | None:
    """Create or update the persistent STANDARD_92 journey for an abnormal follow-up."""
    if not followup or not followup.patient_id:
        return None
    rep = db.get(Report, followup.report_id) if followup.report_id else None
    if not rep or rep.classification != "ABNORMAL":
        return None
    if followup.suppressed_reason:
        return db.scalar(select(CareJourney).where(CareJourney.followup_id == followup.id).order_by(CareJourney.id.desc()))

    rules = rules or load_rules(db)
    rs = db.scalar(select(RuleSet).where(RuleSet.key == "journey_templates", RuleSet.active).order_by(RuleSet.version.desc()))
    tpl_ver = rs.version if rs else 1
    root_pid = rel.canonical_patient_id(db, followup.patient_id)
    pids = [root_pid, *db.scalars(select(Patient.id).where(Patient.merged_into_id == root_pid))]
    order = db.get(Order, rep.order_id) if rep.order_id else None
    started_on = to_ist_date(rep.collected_on or (order.collected_on if order else None) or rep.reported_on)
    cgroup = _condition_group(followup)

    j = db.scalar(select(CareJourney).where(CareJourney.followup_id == followup.id).order_by(CareJourney.id.desc()))
    _, step_defs = _standard_steps(rules)
    due_map, waiting_set = _step_due_dates(db, followup, started_on, rules)

    if not j:
        j = CareJourney(
            patient_id=root_pid,
            followup_id=followup.id,
            condition_group=cgroup,
            template_code="STANDARD_92",
            template_version=tpl_ver,
            started_on=started_on,
            status="ACTIVE",
        )
        db.add(j)
        db.flush()
        for idx, s in enumerate(step_defs):
            code = s["code"]
            db.add(JourneyStep(
                journey_id=j.id,
                step_order=idx,
                step_code=code,
                due_on=due_map[code],
                status="PENDING",
                waiting_for_data=code in waiting_set,
            ))
        db.flush()

        # Supersede any prior ACTIVE journey for same patient + condition group (or overlapping condition)
        prior_active = list(db.scalars(
            select(CareJourney).where(
                CareJourney.patient_id.in_(pids),
                CareJourney.id != j.id,
                CareJourney.status == "ACTIVE",
                CareJourney.condition_group == cgroup,
            )
        ))
        for old in prior_active:
            old.status = "STOPPED"
            old.stop_reason = "superseded"
            for st in db.scalars(select(JourneyStep).where(JourneyStep.journey_id == old.id)):
                if st.status not in ("DONE", "SKIPPED"):
                    st.status = "SKIPPED"
                    st.completion_event = "superseded"
    else:
        existing = {st.step_code: st for st in db.scalars(select(JourneyStep).where(JourneyStep.journey_id == j.id))}
        for idx, s in enumerate(step_defs):
            code = s["code"]
            st = existing.get(code)
            if not st:
                db.add(JourneyStep(
                    journey_id=j.id,
                    step_order=idx,
                    step_code=code,
                    due_on=due_map[code],
                    status="PENDING",
                    waiting_for_data=code in waiting_set,
                ))
            elif st.status not in ("DONE", "SKIPPED"):
                st.due_on = due_map[code]
                st.waiting_for_data = code in waiting_set

    db.flush()
    sync_journey_events(db, patient_id=root_pid, followup_id=followup.id, now=now)
    return j


def _complete_step(step: JourneyStep, event: str, today: date, *, user_id: int | None = None, status_code: str = "DONE") -> None:
    if step.status in ("DONE", "SKIPPED"):
        return
    step.status = status_code
    step.completed_on = today
    step.completed_by = user_id
    step.completion_event = event[:80]
    step.waiting_for_data = False


def sync_journey_events(
    db: Session,
    *,
    patient_id: int | None = None,
    followup_id: int | None = None,
    now: datetime | None = None,
) -> int:
    """Evaluate real events for ACTIVE care journeys and mark steps DONE/SKIPPED."""
    ts = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    today = ts.astimezone(IST).date()

    q = select(CareJourney).where(CareJourney.status == "ACTIVE")
    if followup_id is not None:
        q = q.where(CareJourney.followup_id == followup_id)
    elif patient_id is not None:
        root_pid = rel.canonical_patient_id(db, patient_id)
        pids = [root_pid, *db.scalars(select(Patient.id).where(Patient.merged_into_id == root_pid))]
        q = q.where(CareJourney.patient_id.in_(pids))

    updated = 0
    for j in db.scalars(q.order_by(CareJourney.id)):
        fu = db.get(Followup, j.followup_id) if j.followup_id else None
        if not fu:
            continue
        root_pid = rel.canonical_patient_id(db, j.patient_id)
        pids = [root_pid, *db.scalars(select(Patient.id).where(Patient.merged_into_id == root_pid))]
        rep = db.get(Report, fu.report_id) if fu.report_id else None
        order = db.get(Order, rep.order_id) if rep and rep.order_id else None
        steps = {s.step_code: s for s in db.scalars(select(JourneyStep).where(JourneyStep.journey_id == j.id).order_by(JourneyStep.step_order))}

        recs = list(db.scalars(select(RetestRecommendation).where(RetestRecommendation.followup_id == fu.id)))
        progs = list(db.scalars(select(ProgramRecommendation).where(ProgramRecommendation.followup_id == fu.id)))
        appts = list(db.scalars(select(Appointment).where(Appointment.followup_id == fu.id)))
        calls = list(db.scalars(select(CallLog).where(CallLog.followup_id == fu.id).order_by(CallLog.started_at.asc(), CallLog.id.asc())))

        # D0: READY + analysed
        if "D0_ANALYSED" in steps and order and order.status == ord_status.READY and rep and rep.classification:
            _complete_step(steps["D0_ANALYSED"], "report_ready_analysed", j.started_on)
            updated += 1

        # D1: recommendations generated AND doctor/dietitian consultation done
        recs_generated = bool(progs or recs or (fu.finding_codes or []))
        consult_done = (
            fu.stage in ("DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED")
            or any(a.status == "DONE" for a in appts)
            or any(c.outcome == "DOCTOR_DONE" for c in calls)
        )
        if "D1_RECOMMEND" in steps and recs_generated and consult_done:
            _complete_step(steps["D1_RECOMMEND"], "consultation_and_recommendations_done", today)
            updated += 1

        # D7: any program ACCEPTED/ENROLLED or protocol bundle accepted
        if "D7_ACTIVATION" in steps:
            if any(p.status in ("ACCEPTED", "ENROLLED") for p in progs) or any(getattr(r, "bundle_code", "") for r in recs):
                _complete_step(steps["D7_ACTIVATION"], "program_activated", today)
                updated += 1
            elif progs and all(p.status in ("DECLINED", "EXPIRED") for p in progs):
                _complete_step(steps["D7_ACTIVATION"], "nothing_accepted", today, status_code="SKIPPED")
                updated += 1

        # D30 / D60: call/checkin logs with adherence or symptoms codes
        coded_calls = [c for c in calls if (getattr(c, "adherence_code", "") or getattr(c, "symptom_code", ""))]
        if "D30_ADHERENCE" in steps:
            d30 = steps["D30_ADHERENCE"]
            match30 = next((c for c in coded_calls if "step:D30_ADHERENCE" in (c.notes or "") or to_ist_date(c.started_at) >= d30.due_on), None)
            if not match30 and coded_calls:
                match30 = coded_calls[0]
            if match30:
                _complete_step(d30, f"checkin:{match30.adherence_code or '-'}:{match30.symptom_code or '-'}", to_ist_date(match30.started_at), user_id=match30.user_id)
                updated += 1

        if "D60_PROGRESS" in steps:
            d60 = steps["D60_PROGRESS"]
            match60 = next((c for c in coded_calls if "step:D60_PROGRESS" in (c.notes or "")), None)
            if not match60:
                match60 = next((c for c in coded_calls if to_ist_date(c.started_at) >= d60.due_on), None)
            if not match60 and len(coded_calls) >= 2:
                match60 = coded_calls[-1]
            if match60:
                _complete_step(d60, f"checkin:{match60.adherence_code or '-'}:{match60.symptom_code or '-'}", to_ist_date(match60.started_at), user_id=match60.user_id)
                updated += 1

        # D75: retest reminder delivered (outbound message sent/tasked OR reminder_sent_at OR caller call on/after D75)
        if "D75_RETEST_NOTICE" in steps:
            d75 = steps["D75_RETEST_NOTICE"]
            sent_msg = db.scalar(
                select(OutboundMessage).where(
                    OutboundMessage.journey_step_id == d75.id,
                    OutboundMessage.status.in_(("SENT", "CALL_TASK_CREATED")),
                ).limit(1)
            )
            if sent_msg or fu.reminder_sent_at is not None or any(
                c.outcome != "DOCTOR_DONE"
                and not (c.notes or "").startswith(("step:D30", "step:D60"))
                and to_ist_date(c.started_at) >= d75.due_on
                for c in calls
            ):
                _complete_step(d75, "retest_reminder_delivered", today)
                updated += 1

        # Newer READY reports containing expected retest tests
        retest_codes = {c for r in recs for c in (r.test_codes or [])}
        expected_params = {pm for c in retest_codes for pm in TEST_PARAM_GROUPS.get(c, {c})}
        later_reports = list(
            db.execute(
                select(Report, Order)
                .join(Order, Order.id == Report.order_id)
                .where(Order.patient_id.in_(pids), Order.status == ord_status.READY, Report.id != fu.report_id)
                .order_by(Report.collected_on.asc(), Report.id.asc())
            ).all()
        )
        matching_later_rep = None
        for lr, lo in later_reports:
            ld = to_ist_date(lr.collected_on or lo.collected_on or lr.reported_on)
            if ld <= j.started_on:
                continue
            lr_params = {p.param_code for p in db.scalars(select(ReportParameter).where(ReportParameter.report_id == lr.id)) if p.param_code}
            if (not expected_params and lr_params) or (expected_params & lr_params):
                matching_later_rep = lr
                break

        # D90: Home/Health Hub booking recorded OR matching repeat READY report arrived
        if "D90_RETEST" in steps:
            booked_or_done = (
                any(getattr(r, "booking_status", "") in ("BOOKED", "COLLECTED") or r.ordered or r.comparison_report_id is not None for r in recs)
                or matching_later_rep is not None
            )
            if booked_or_done:
                _complete_step(steps["D90_RETEST"], "retest_booked_or_completed", today)
                updated += 1

        # D91: Automatic comparison exists
        comp_rep_id = next((r.comparison_report_id for r in recs if r.comparison_report_id is not None), None)
        if not comp_rep_id and matching_later_rep and compare_svc.has_comparison(db, root_pid, matching_later_rep.id):
            comp_rep_id = matching_later_rep.id
        if "D91_COMPARE" in steps and comp_rep_id is not None:
            _complete_step(steps["D91_COMPARE"], "longitudinal_comparison_ready", today)
            updated += 1

        # D92: Doctor reviews & updates plan after comparison/D90
        if "D92_UPDATE_PLAN" in steps and steps.get("D91_COMPARE") and steps["D91_COMPARE"].status == "DONE":
            comp_on = steps["D91_COMPARE"].completed_on or today
            plan_updated = (
                (fu.next_followup_on is not None and fu.next_followup_on > comp_on)
                or any(a.status == "DONE" and to_ist_date(a.slot_start) >= comp_on for a in appts)
                or any(c.outcome == "DOCTOR_DONE" and to_ist_date(c.started_at) >= comp_on for c in calls)
                or any(r.source == "DOCTOR" and r.created_at and to_ist_date(r.created_at) >= comp_on and r.comparison_report_id is None for r in recs)
            )
            if plan_updated:
                _complete_step(steps["D92_UPDATE_PLAN"], "care_plan_updated", today)
                j.status = "COMPLETED"
                updated += 1

    db.flush()
    return updated


def record_checkin(
    db: Session,
    followup: Followup,
    *,
    step_code: str | None = None,
    adherence_code: str = "",
    symptom_code: str = "",
    user_id: int,
    role: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Record D30/D60 coded adherence & symptom check-in; creates Doctor ClinicalTask if WORSE or STOPPED."""
    adh = adherence_code.strip().upper()
    sym = symptom_code.strip().upper()
    if adh and adh not in ADHERENCE_CODES:
        raise ValueError(f"adherence_code must be one of {sorted(ADHERENCE_CODES)}")
    if sym and sym not in SYMPTOM_CODES:
        raise ValueError(f"symptom_code must be one of {sorted(SYMPTOM_CODES)}")
    if not adh and not sym:
        raise ValueError("adherence_code or symptom_code is required")

    ts = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    sc = (step_code or "").strip().upper()
    if sc and sc not in ("D30_ADHERENCE", "D60_PROGRESS"):
        raise ValueError("step_code must be D30_ADHERENCE or D60_PROGRESS")

    tag = f"step:{sc}" if sc else ""
    db.add(CallLog(
        followup_id=followup.id,
        user_id=user_id,
        role=role,
        outcome="CALL_LATER" if followup.stage not in fu_svc.DONE_STAGES else followup.stage,
        adherence_code=adh,
        symptom_code=sym,
        notes=tag,  # codes/step identifier only; never free-text PII
        started_at=ts,
    ))

    task = None
    if adh == "STOPPED" or sym == "WORSE":
        root_pid = rel.canonical_patient_id(db, followup.patient_id)
        code_lbl = f"{adh or '-'} / {sym or '-'}"
        existing_task = db.scalar(
            select(ClinicalTask).where(
                ClinicalTask.patient_id == root_pid,
                ClinicalTask.followup_id == followup.id,
                ClinicalTask.task_type == "JOURNEY_ESCALATION",
                ClinicalTask.status == "OPEN",
            ).limit(1)
        )
        if not existing_task:
            task = ClinicalTask(
                patient_id=root_pid,
                followup_id=followup.id,
                condition_code=_condition_group(followup),
                task_type="JOURNEY_ESCALATION",
                title="Doctor review requested after patient check-in",
                details=f"Codes: {code_lbl}",
                selected_tests=[],
                status="OPEN",
                assigned_doctor_id=followup.assigned_doctor_id,
            )
            db.add(task)
            db.flush()
            doc_ids = assign.doctor_users(db, followup.assigned_doctor_id) if followup.assigned_doctor_id else assign.doctor_users(db)
            if doc_ids:
                assign.notify(db, doc_ids, "Patient check-in flagged clinical review", f"/followups/view?id={followup.id}", urgent=True)
        else:
            task = existing_task

    j = start_or_sync_journey(db, followup, now=ts)
    return {
        "followup_id": followup.id,
        "adherence_code": adh,
        "symptom_code": sym,
        "clinical_task_id": task.id if task else None,
        "journey": journey_out(db, j, role=role) if j else None,
    }


def scheduler_tick(db: Session, now: datetime | None = None) -> dict[str, int]:
    """Daily idempotent job (IST): marks DUE/OVERDUE steps, spawns staff tasks/notifications, sends guarded patient messages."""
    ts = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    today = ts.astimezone(IST).date()

    # Ensure every live abnormal followup has an active journey before evaluating
    for fu in db.scalars(
        select(Followup).where(Followup.suppressed_reason == "").order_by(Followup.id)
    ):
        if not db.scalar(select(CareJourney.id).where(CareJourney.followup_id == fu.id).limit(1)):
            start_or_sync_journey(db, fu, now=ts)

    sync_journey_events(db, now=ts)

    rules = load_rules(db)
    _, step_defs = _standard_steps(rules)
    s_map = {s["code"]: s for s in step_defs}

    marked_due = 0
    marked_overdue = 0
    tasks_created = 0
    messages_processed = 0

    caller_ids = [u for (u,) in db.execute(select(User.id).where(User.role == "CALLER", User.active))]
    if not caller_ids:
        caller_ids = [u for (u,) in db.execute(select(User.id).where(User.role == "ADMIN", User.active))]

    for j in db.scalars(select(CareJourney).where(CareJourney.status == "ACTIVE").order_by(CareJourney.id)):
        fu = db.get(Followup, j.followup_id) if j.followup_id else None
        for step in db.scalars(select(JourneyStep).where(JourneyStep.journey_id == j.id).order_by(JourneyStep.step_order)):
            if step.status in ("DONE", "SKIPPED"):
                continue
            s_def = s_map.get(step.step_code, {})
            if today > step.due_on:
                if step.status != "OVERDUE":
                    step.status = "OVERDUE"
                    marked_overdue += 1
            elif today == step.due_on:
                if step.status != "DUE":
                    step.status = "DUE"
                    marked_due += 1
            else:
                continue

            owner = s_def.get("owner", "SYSTEM")
            channel = s_def.get("channel", "AUTO")
            caller_label = s_def.get("caller_label") or "Follow-up task due"

            if channel == "PATIENT_MESSAGE" and not step.task_ref:
                tpl_code = "D75_RETEST_NOTICE" if step.step_code == "D75_RETEST_NOTICE" else "D30_CHECKIN"
                msg = messaging.send_patient_message(
                    db, j.patient_id, tpl_code, followup_id=j.followup_id, journey_step_id=step.id, now=ts
                )
                messages_processed += 1
                if msg and msg.status in ("SENT", "CALL_TASK_CREATED"):
                    step.task_ref = f"msg:{msg.id}"
                    tasks_created += 1
                    sync_journey_events(db, followup_id=j.followup_id, now=ts)
            elif not step.task_ref and channel in ("CALL", "TASK"):
                if owner in ("CALLER", "COORDINATOR") and caller_ids:
                    link = f"/caller-card/view?id={j.followup_id}" if j.followup_id else "/followups"
                    assign.notify(db, caller_ids, caller_label[:180], link)
                    step.task_ref = f"caller_task:{j.id}:{step.step_code}"
                    tasks_created += 1
                elif owner in ("DOCTOR", "DIETITIAN"):
                    doc_ids = assign.doctor_users(db, fu.assigned_doctor_id if fu else None)
                    if doc_ids:
                        link = f"/followups/view?id={j.followup_id}" if j.followup_id else f"/patients/view?id={j.patient_id}"
                        assign.notify(db, doc_ids, s_def.get("clinical_label", step.step_code)[:180], link)
                        step.task_ref = f"doc_notif:{j.id}:{step.step_code}"
                        tasks_created += 1

    db.commit()
    return {
        "due": marked_due,
        "overdue": marked_overdue,
        "tasks": tasks_created,
        "messages": messages_processed,
    }


def journey_out(db: Session, j: CareJourney | None, *, role: str, rules: dict | None = None) -> dict[str, Any] | None:
    if not j:
        return None
    rules = rules or load_rules(db)
    _, step_defs = _standard_steps(rules)
    s_map = {s["code"]: s for s in step_defs}
    is_caller = role == "CALLER"
    steps_rows = list(db.scalars(select(JourneyStep).where(JourneyStep.journey_id == j.id).order_by(JourneyStep.step_order, JourneyStep.id)))

    steps = []
    for st in steps_rows:
        sd = s_map.get(st.step_code, {})
        if is_caller:
            steps.append({
                "id": st.id,
                "step_code": st.step_code,
                "window_label": sd.get("window_label", st.step_code),
                "day_offset": sd.get("day_offset", 0),
                "due_on": st.due_on.isoformat(),
                "status": st.status,
                "completed_on": st.completed_on.isoformat() if st.completed_on else None,
                "caller_label": sd.get("caller_label", "Follow-up step"),
                "waiting_for_data": bool(st.waiting_for_data),
            })
        else:
            steps.append({
                "id": st.id,
                "step_code": st.step_code,
                "window_label": sd.get("window_label", st.step_code),
                "day_offset": sd.get("day_offset", 0),
                "ami_action": sd.get("ami_action", sd.get("what_happens", "")),
                "service": sd.get("service", ""),
                "clinical_label": sd.get("clinical_label", ""),
                "caller_label": sd.get("caller_label", ""),
                "owner": sd.get("owner", ""),
                "channel": sd.get("channel", ""),
                "due_on": st.due_on.isoformat(),
                "status": st.status,
                "completed_on": st.completed_on.isoformat() if st.completed_on else None,
                "completed_by": st.completed_by,
                "completion_event": st.completion_event,
                "task_ref": st.task_ref,
                "waiting_for_data": bool(st.waiting_for_data),
            })

    if is_caller:
        return {
            "id": j.id,
            "followup_id": j.followup_id,
            "started_on": j.started_on.isoformat(),
            "status": j.status,
            "label": "Follow-up journey",
            "steps": steps,
        }
    return {
        "id": j.id,
        "patient_id": j.patient_id,
        "followup_id": j.followup_id,
        "condition_group": j.condition_group,
        "template_code": j.template_code,
        "template_version": j.template_version,
        "started_on": j.started_on.isoformat(),
        "status": j.status,
        "stop_reason": j.stop_reason,
        "steps": steps,
    }


def dashboard_journeys(db: Session) -> dict[str, Any]:
    """Summary counts, overdue counts per step, and D0->D92 drop-off funnel for Admin Dashboard."""
    rules = load_rules(db)
    _, step_defs = _standard_steps(rules)
    all_j = list(db.scalars(select(CareJourney)))
    active_ids = {j.id for j in all_j if j.status == "ACTIVE"}
    all_steps = list(db.scalars(select(JourneyStep)))

    overdue_by_step = []
    funnel = []
    for s_def in step_defs:
        code = s_def["code"]
        ov = sum(1 for st in all_steps if st.journey_id in active_ids and st.step_code == code and st.status == "OVERDUE")
        done_n = sum(1 for st in all_steps if st.step_code == code and st.status == "DONE")
        overdue_by_step.append({"step_code": code, "window_label": s_def.get("window_label", code), "count": ov})
        funnel.append({"step_code": code, "window_label": s_def.get("window_label", code), "label": s_def.get("ami_action", code), "count": done_n})

    return {
        "active": sum(1 for j in all_j if j.status == "ACTIVE"),
        "completed": sum(1 for j in all_j if j.status == "COMPLETED"),
        "stopped": sum(1 for j in all_j if j.status == "STOPPED"),
        "overdue_by_step": overdue_by_step,
        "funnel": funnel,
    }
