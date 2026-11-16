"""Trend graphs, dashboard and CSV exports (Parts 13.4, 13.6). Read-only."""
import csv
import io
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import and_, distinct, func, select
from sqlalchemy.orm import Session

from .. import status
from ..analysis import NORMAL_LABELS, load_rules
from ..db import get_db
from ..models import (Appointment, CallLog, Consent, CriticalRule, Doctor, Followup, IdentityReview, Order, Patient, PatientBucket,
                      Report, ReportInsight, ReportParameter, RetestRecommendation, User)
from ..security import audit, current_user, require
from .. import ai_insights, biomarkers, units
from ..timeutil import IST, today_ist
from .followups import DONE, conditions, list_followups
from .patients import mobile_out

router = APIRouter(tags=["insights"])
staff = require("ADMIN", "DOCTOR")
admin = require("ADMIN")
RANGES = {"1y": 365, "5y": 365 * 5, "all": None}


# ---------------- trends ----------------
def _patient(db: Session, pid: int) -> Patient:
    p = db.get(Patient, pid)
    if not p or p.merged_into_id:
        raise HTTPException(404, "No such patient")
    return p


def _fallback_bounds(code: str, gender: str, ranges: dict):
    """Numeric normal band from the admin table, for tests whose report printed no range."""
    spec = ranges.get(code) or {}
    if "low_below" in spec:
        thr = spec["low_below"].get(gender)
        return (thr, None) if thr is not None else None
    normal = next((b for b in spec.get("bands", []) if b[0] in NORMAL_LABELS), None)
    return (normal[1], normal[2]) if normal else None


def _ready_params(patient_id: int):
    # Held reports (PENDING_IDENTITY) are never used for trends (Part 9.3).
    return (select(ReportParameter, Report, Order).join(Report, Report.id == ReportParameter.report_id)
            .join(Order, Order.id == Report.order_id)
            .where(Order.patient_id == patient_id, Order.status == status.READY, ReportParameter.param_code != "",
                   ReportParameter.value_num.is_not(None)))


@router.get("/trends/{pid}/parameters")
def trend_parameters(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(staff)):
    _patient(db, pid)
    rows = db.execute(_ready_params(pid).order_by(Report.collected_on)).all()
    out: dict[str, dict] = {}
    for p, r, o in rows:
        e = out.setdefault(p.param_code, {"code": p.param_code, "name": p.param_name_raw, "unit": p.unit, "count": 0, "abnormal": 0})
        e["count"] += 1
        e["abnormal"] += p.system_flag in ("LOW", "HIGH")
        e["name"], e["unit"] = p.param_name_raw, p.unit
    return sorted(out.values(), key=lambda e: (-e["abnormal"], e["name"]))


def build_trend(db: Session, pid: int, codes: list[str], rng: str) -> dict:
    if rng not in RANGES:
        raise HTTPException(422, "range must be 1y, 5y or all")
    if not codes or len(codes) > 4:
        raise HTTPException(422, "Pick between 1 and 4 tests")
    patient = _patient(db, pid)
    q = _ready_params(pid).where(ReportParameter.param_code.in_(codes))
    if RANGES[rng]:
        q = q.where(Report.collected_on >= datetime.now(timezone.utc) - timedelta(days=RANGES[rng]))
    rows = db.execute(q.order_by(Report.collected_on, Report.id)).all()
    first = db.scalar(select(func.min(Report.collected_on)).join(Order, Order.id == Report.order_id)
                      .where(Order.patient_id == pid, Order.status == status.READY))
    ranges = load_rules(db).get("reference_ranges", {})
    series = {c: {"code": c, "name": c, "unit": "", "points": [], "band": None, "band_source": ""} for c in codes}
    for p, r, o in rows:
        s = series[p.param_code]
        s["name"], s["unit"] = p.param_name_raw, p.unit
        s["points"].append({"date": (r.collected_on or o.collected_on).date().isoformat() if (r.collected_on or o.collected_on) else None,
                            "value": p.value_num, "flag": p.system_flag, "severity": p.severity, "order_id": o.order_id_external,
                            "report_id": r.id, "ref_text": p.ref_text})
        if p.ref_low is not None or p.ref_high is not None:  # the latest printed range wins
            s["band"], s["band_source"] = {"low": p.ref_low, "high": p.ref_high}, "report"
        elif not s["band_source"]:
            b = _fallback_bounds(p.param_code, r.gender, ranges)
            if b:
                s["band"], s["band_source"] = {"low": b[0], "high": b[1]}, "admin_table"
    return {"patient_id": pid, "range": rng, "series": [series[c] for c in codes],
            # the lab's full past order history is not available (Q2): the graph only knows reports imported here
            "history_starts": first.date().isoformat() if first else None}


def _codes(codes: str) -> list[str]:
    return [c.strip().upper() for c in codes.split(",") if c.strip()]


@router.get("/trends/{pid}")
def trend(pid: int, request: Request, codes: str = "", range: str = "all", db: Session = Depends(get_db), me: User = Depends(staff)):
    out = build_trend(db, pid, _codes(codes), range)
    audit(db, request, me.id, "view", "trend", pid)
    return out


# ---------------- dashboard ----------------
def _bounds(frm: date | None, to: date | None):
    to = to or today_ist()
    frm = frm or to - timedelta(days=29)
    if frm > to:
        raise HTTPException(422, "'from' is after 'to'")
    start = datetime.combine(frm, datetime.min.time(), IST).astimezone(timezone.utc)
    end = datetime.combine(to + timedelta(days=1), datetime.min.time(), IST).astimezone(timezone.utc)
    return frm, to, start, end


@router.get("/dashboard")
def dashboard(frm: date | None = Query(None, alias="from"), to: date | None = None, db: Session = Depends(get_db), me: User = Depends(admin)):
    frm, to, start, end = _bounds(frm, to)
    n = lambda q: db.scalar(q) or 0
    in_range = lambda col: and_(col >= start, col < end)
    today, now = today_ist(), datetime.now(timezone.utc)

    by_status = dict(db.execute(select(Order.status, func.count()).where(in_range(Order.created_at)).group_by(Order.status)).all())
    classes = dict(db.execute(select(Report.classification, func.count()).join(Order, Order.id == Report.order_id)
                              .where(in_range(Order.created_at), Report.classification != "").group_by(Report.classification)).all())
    calls = dict(db.execute(select(CallLog.outcome, func.count()).where(in_range(CallLog.started_at), CallLog.outcome != "DOCTOR_DONE")
                            .group_by(CallLog.outcome)).all())
    attempted = select(CallLog.followup_id).where(in_range(CallLog.started_at), CallLog.outcome != "DOCTOR_DONE").distinct()
    n_attempted = n(select(func.count()).select_from(attempted.subquery()))
    n_consented = n(select(func.count(distinct(Consent.followup_id))).where(Consent.followup_id.in_(attempted)))

    cohort = and_(Followup.created_at >= start, Followup.created_at < end)

    def step(model, *conds):
        return n(select(func.count(distinct(model.followup_id))).select_from(model).join(Followup, Followup.id == model.followup_id)
                 .where(cohort, *conds))

    funnel = [("Follow-ups created", n(select(func.count()).select_from(Followup).where(cohort))),
              ("Called", step(CallLog, CallLog.outcome != "DOCTOR_DONE")), ("Consent given", step(Consent)),
              ("Booked", step(CallLog, CallLog.outcome == "BOOKED")), ("Doctor call done", step(CallLog, CallLog.outcome == "DOCTOR_DONE")),
              ("Retest recommended", step(RetestRecommendation)), ("Retest ordered", step(RetestRecommendation, RetestRecommendation.ordered))]

    doctors = []
    live = and_(Followup.suppressed_reason == "", Followup.stage.notin_(DONE))
    for d in db.scalars(select(Doctor).where(Doctor.active).order_by(Doctor.priority_order, Doctor.id)):
        mine = Followup.assigned_doctor_id == d.id
        doctors.append({
            "id": d.id, "name": d.name, "in_pilot": d.in_pilot,
            "open_cases": n(select(func.count()).select_from(Followup).where(mine, live)),
            "escalations": n(select(func.count()).select_from(Followup).where(mine, live, Followup.priority == "ESCALATION")),
            "not_accepted": n(select(func.count()).select_from(Followup).where(mine, live, Followup.accepted_at.is_(None))),
            "upcoming_bookings": n(select(func.count()).select_from(Appointment).where(Appointment.doctor_id == d.id, Appointment.status == "BOOKED", Appointment.slot_start >= now)),
            "calls_done": n(select(func.count()).select_from(CallLog).where(CallLog.user_id == d.user_id, CallLog.outcome == "DOCTOR_DONE", in_range(CallLog.started_at))) if d.user_id else 0})

    return {
        "from": frm.isoformat(), "to": to.isoformat(),
        "orders": {"imported": sum(by_status.values()), "by_status": by_status, "reports_ready": by_status.get(status.READY, 0),
                   "failed": by_status.get(status.FAILED_FETCH, 0) + by_status.get(status.FAILED_EXTRACT, 0)},
        "results": {"normal": classes.get("NORMAL", 0), "abnormal": classes.get("ABNORMAL", 0)},
        "patients_per_bucket": dict(db.execute(select(PatientBucket.bucket_code, func.count(distinct(PatientBucket.patient_id)))
                                               .where(PatientBucket.active).group_by(PatientBucket.bucket_code)).all()),
        "followups_due": {"today": n(select(func.count()).select_from(Followup).where(conditions("queue"), Followup.due_on == today)),
                          "this_week": n(select(func.count()).select_from(Followup).where(conditions("due_this_week"))),
                          "overdue": n(select(func.count()).select_from(Followup).where(conditions("overdue"))),
                          "parked": n(select(func.count()).select_from(Followup).where(conditions("low_potential")))},
        "calls": {"made": sum(calls.values()), "by_outcome": calls, "bookings": calls.get("BOOKED", 0),
                  "consent_rate_pct": round(100 * n_consented / n_attempted) if n_attempted else None,
                  "doctor_calls_done": n(select(func.count()).select_from(CallLog).where(in_range(CallLog.started_at), CallLog.outcome == "DOCTOR_DONE"))},
        "retests": {"recommended": n(select(func.count()).select_from(RetestRecommendation).where(in_range(RetestRecommendation.created_at))),
                    "ordered": n(select(func.count()).select_from(RetestRecommendation).where(in_range(RetestRecommendation.created_at), RetestRecommendation.ordered))},
        "funnel": [{"step": s, "count": c} for s, c in funnel],
        "doctors": doctors,
        "needs_attention": {"failed_fetch": n(select(func.count()).select_from(Order).where(Order.status == status.FAILED_FETCH)),
                            "failed_extract": n(select(func.count()).select_from(Order).where(Order.status == status.FAILED_EXTRACT)),
                            "needs_review": n(select(func.count()).select_from(Order).where(Order.status == status.NEEDS_REVIEW)),
                            "pending_identity": n(select(func.count()).select_from(IdentityReview).where(IdentityReview.status == "PENDING"))},
    }


# ---------------- CSV exports ----------------
def _cell(v) -> str:
    """Stop spreadsheet formula injection from patient-entered text."""
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def _csv(name: str, header: list[str], rows: list[list]) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows([[_cell(c) for c in r] for r in rows])
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/exports/followups.csv")
def export_followups(request: Request, view: str = "queue", bucket: str | None = None, priority: str | None = None,
                     tier: str | None = None, db: Session = Depends(get_db), me: User = Depends(staff)):
    rows = list_followups(view=view, bucket=bucket, priority=priority, tier=tier, doctor_id=None, language=None, stage=None,
                          due_from=None, due_to=None, limit=2000, db=db, me=me)
    audit(db, request, me.id, "export", "followups", f"{view}:{len(rows)}")
    return _csv(f"followups-{view}.csv", ["Follow-up", "Patient", "Mobile", "Due", "Report age (days)", "Priority", "Stage", "Buckets", "Potential", "Score"],
                [[r["id"], r["patient_name"], r["mobile"], r["due_on"], r["report_age_days"], r["priority"], r["stage"],
                  " ".join(r["buckets"]), r["retest_tier"], r["retest_score"]] for r in rows])


@router.get("/exports/trends/{pid}.csv")
def export_trend(pid: int, request: Request, codes: str = "", range: str = "all", db: Session = Depends(get_db), me: User = Depends(staff)):
    t = build_trend(db, pid, _codes(codes), range)
    audit(db, request, me.id, "export", "trend", pid)
    return _csv(f"trend-{pid}.csv", ["Test", "Date", "Value", "Unit", "Flag", "Order"],
                [[s["name"], p["date"], p["value"], s["unit"], p["flag"], p["order_id"]] for s in t["series"] for p in s["points"]])


# ---------------- AI report insights ----------------
def _insight_out(ins: ReportInsight) -> dict:
    return {
        "id": ins.id,
        "report_id": ins.report_id,
        "status": ins.status,
        "content": ins.content,
        "provider": ins.provider,
        "model": ins.model,
        "prompt_version": ins.prompt_version,
        "validation_errors": ins.validation_errors,
        "approved_by": ins.approved_by,
        "approved_at": ins.approved_at,
        "created_at": ins.created_at,
        "updated_at": ins.updated_at,
    }


@router.get("/reports/{rid}/insight")
def get_report_insight(rid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(current_user)):
    insight = db.scalar(select(ReportInsight).where(ReportInsight.report_id == rid))
    if me.role == "CALLER":
        if not insight or insight.status != "APPROVED":
            raise HTTPException(403, "Report insights are only visible to callers once approved by a doctor")
        safe_content = {
            "overview": insight.content.get("overview", ""),
            "caller_questions": insight.content.get("suggestions", {}).get("caller_questions", []),
            "doctor_connect": insight.content.get("doctor_connect", {}),
            "red_flag_protocol": insight.content.get("red_flag_protocol", ""),
            "limitations": insight.content.get("limitations", ""),
            "suggested_window_days": insight.content.get("future", {}).get("suggested_window_days"),
        }
        return {
            "id": insight.id,
            "report_id": insight.report_id,
            "status": insight.status,
            "caller_safe": True,
            "content": safe_content,
        }

    report = db.get(Report, rid)
    if not report:
        raise HTTPException(404, "No such report")

    if not insight:
        insight = ai_insights.generate_insight_for_report(db, report)

    audit(db, request, me.id, "view", "report_insight", rid)
    return _insight_out(insight)


@router.post("/reports/{rid}/insight/regenerate")
def regenerate_insight_endpoint(rid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(staff)):
    report = db.get(Report, rid)
    if not report:
        raise HTTPException(404, "No such report")
    ins = ai_insights.regenerate_insight(db, rid, me.id)
    audit(db, request, me.id, "regenerate", "report_insight", rid)
    return _insight_out(ins)


from pydantic import BaseModel


@router.patch("/reports/{rid}/insight")
def patch_insight_endpoint(rid: int, body: dict, request: Request, db: Session = Depends(get_db), me: User = Depends(staff)):
    report = db.get(Report, rid)
    if not report:
        raise HTTPException(404, "No such report")
    ins = ai_insights.patch_insight_content(db, rid, body, me.id)
    audit(db, request, me.id, "edit", "report_insight", rid)
    return _insight_out(ins)


@router.post("/reports/{rid}/insight/approve")
def approve_insight_endpoint(rid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(staff)):
    report = db.get(Report, rid)
    if not report:
        raise HTTPException(404, "No such report")
    ins = ai_insights.approve_insight(db, rid, me.id)
    audit(db, request, me.id, "approve", "report_insight", rid)
    return _insight_out(ins)


@router.post("/reports/{rid}/insight/reject")
def reject_insight_endpoint(rid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(staff)):
    report = db.get(Report, rid)
    if not report:
        raise HTTPException(404, "No such report")
    ins = ai_insights.reject_insight(db, rid, me.id)
    audit(db, request, me.id, "reject", "report_insight", rid)
    return _insight_out(ins)


# ---------------- Doctor-approved critical rules ----------------

class CriticalRuleIn(BaseModel):
    marker: str
    comparator: str
    threshold: float
    unit: str
    note: str = ""


class CriticalRulePatch(BaseModel):
    active: bool | None = None
    note: str | None = None


@router.get("/critical-rules")
def list_critical_rules(db: Session = Depends(get_db), me: User = Depends(staff)):
    rules = db.scalars(select(CriticalRule).order_by(CriticalRule.active.desc(), CriticalRule.marker_code)).all()
    return [
        {
            "id": r.id,
            "marker_code": r.marker_code,
            "marker": biomarkers.marker_label(r.marker_code),
            "label": r.label,
            "comparator": r.comparator,
            "threshold": r.threshold,
            "unit": r.unit,
            "note": r.note,
            "active": r.active,
            "approved_by": r.approved_by,
            "approved_at": r.approved_at,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
        }
        for r in rules
    ]


@router.post("/critical-rules", status_code=201)
def create_critical_rule(body: CriticalRuleIn, request: Request, db: Session = Depends(get_db), me: User = Depends(staff)):
    import uuid

    if body.comparator not in ("<", "<=", ">", ">="):
        raise HTTPException(422, "Comparator must be <, <=, >, or >=")
    if not units.norm_unit(body.unit):
        raise HTTPException(422, "A valid measurement unit is required for the threshold")

    code = biomarkers.marker_code(body.marker)
    lbl = f"{biomarkers.marker_label(code)} {body.comparator} {body.threshold} {body.unit}"
    rule_id = str(uuid.uuid4())
    now_dt = datetime.now(timezone.utc)

    rule = CriticalRule(
        id=rule_id,
        marker_code=code,
        label=lbl,
        comparator=body.comparator,
        threshold=body.threshold,
        unit=body.unit,
        note=body.note.strip()[:300],
        active=True,
        approved_by=me.id,
        approved_at=now_dt,
        created_at=now_dt,
        updated_at=now_dt,
    )
    db.add(rule)
    db.commit()
    audit(db, request, me.id, "CRITICAL_RULE_APPROVED", "critical_rule", rule_id)
    return {"id": rule_id, "marker_code": code, "label": lbl}


@router.patch("/critical-rules/{rule_id}")
def update_critical_rule(rule_id: str, body: CriticalRulePatch, request: Request, db: Session = Depends(get_db), me: User = Depends(staff)):
    rule = db.get(CriticalRule, rule_id)
    if not rule:
        raise HTTPException(404, "Rule not found")

    if body.active is not None:
        rule.active = body.active
    if body.note is not None:
        rule.note = body.note.strip()[:300]
    rule.updated_at = datetime.now(timezone.utc)
    db.commit()
    audit(db, request, me.id, "CRITICAL_RULE_UPDATED", "critical_rule", rule_id)
    return {"ok": True, "active": rule.active}
