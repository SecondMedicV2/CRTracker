"""Condition-specific patient journeys, starting with HBA1C_90 (Page 10)."""
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import assign, followup as fu_svc, programs as prog_svc, relationship as rel, retest as retest_svc, status as ord_status, trends as trends_svc
from .analysis import load_rules
from .models import (Appointment, CallLog, CareTouchpoint, Followup, HomeReading, Order, Patient, ProgramRecommendation,
                     RefillSchedule, Report, ReportParameter, RetestRecommendation)
from .seed_data import JOURNEY_TEMPLATES, RETEST_PROTOCOLS
from .timeutil import to_ist_date, today_ist

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
    db.commit()
    return build_journey(db, followup.patient_id, followup.report_id, followup) or {}
