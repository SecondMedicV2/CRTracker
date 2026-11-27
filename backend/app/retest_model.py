"""Clinically approved 7-step retesting model, protocol bundles, patient explanations, and KPIs (Page 12)."""
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import assign, compare as compare_svc, relationship as rel, status as ord_status, storage
from .analysis import load_rules
from .models import (CareTouchpoint, Followup, HealthHub, Order, Patient, PatientMedication, Report, ReportParameter,
                     RetestRecommendation, RuleSet)
from .seed_data import PROTOCOL_BUNDLES, RETEST_PROTOCOLS, TEST_CATALOGUE
from .timeutil import IST, to_ist_date, today_ist

COLLECTION_MODES = {"HOME", "HEALTH_HUB"}
BOOKING_STATUSES = {"NOT_BOOKED", "BOOKED", "COLLECTED", "CANCELLED", "NO_SHOW"}

TEST_TO_PARAMS: dict[str, set[str]] = {
    "HBA1C": {"HBA1C"},
    "FBS": {"GLUCOSE_FASTING", "GLU_F"},
    "PPBS": {"GLUCOSE_PP", "GLU_PP"},
    "LIPID": {"CHOL_TOTAL", "CHOL", "LDL", "HDL", "TRIGLYCERIDES", "TG", "NON_HDL", "VLDL"},
    "THYROID": {"TSH", "FT3", "FT4", "T3", "T4"},
    "TSH": {"TSH"},
    "FT4": {"FT4"},
    "CBC": {"HEMOGLOBIN", "HB", "RBC", "WBC", "PLT", "PCV", "MCV"},
    "RETIC": {"RETIC"},
    "IRON": {"FERRITIN", "IRON", "TIBC", "TSAT"},
    "VITD": {"VITAMIN_D", "VITD"},
    "CALCIUM": {"CALCIUM"},
    "B12": {"B12"},
    "KFT": {"CREATININE", "CREAT", "UREA", "BUN", "EGFR", "URIC_ACID", "URIC", "UACR"},
    "EGFR": {"EGFR"},
    "UACR": {"UACR"},
    "LFT": {"SGOT", "AST", "SGPT", "ALT", "ALP", "GGT", "BILIRUBIN", "BILI_T", "ALBUMIN", "ALB"},
}

BUNDLE_BY_FINDING = {b["retest_protocol_code"]: b["code"] for b in PROTOCOL_BUNDLES}


def _cat_map(rules: dict) -> dict[str, dict]:
    items = rules.get("test_catalogue") or TEST_CATALOGUE
    return {t["code"]: t for t in items if isinstance(t, dict) and t.get("code")}


def _bundles_map(rules: dict) -> dict[str, dict]:
    items = rules.get("protocol_bundles") or PROTOCOL_BUNDLES
    return {b["code"]: b for b in items if isinstance(b, dict) and b.get("code")}


def is_plan_approved(db: Session, plan: RetestRecommendation) -> bool:
    if plan.approved_by_doctor_id is not None:
        return True
    if plan.protocol_code and plan.protocol_version is not None:
        rs = db.scalar(
            select(RuleSet).where(RuleSet.key == "retest_protocols", RuleSet.version == plan.protocol_version)
        )
        return bool(rs and rs.signed_off_at is not None)
    return False


def sync_plan_fields(
    db: Session,
    plan: RetestRecommendation,
    followup: Followup,
    *,
    rules: dict | None = None,
    doctor_id: int | None = None,
    bundle_code: str | None = None,
) -> RetestRecommendation:
    """Populate 7-step RetestRecommendation fields from Followup + Rules."""
    rules = rules or load_rules(db)
    cat = _cat_map(rules)
    rp = followup.retest_plan or {}
    pf = rp.get("primary_finding") or {}
    findings = list(rp.get("findings") or [])

    win_start = followup.retest_window_start or followup.next_followup_on or followup.due_on
    win_end = followup.retest_window_end or win_start
    plan.window_start = plan.window_start or win_start
    plan.window_end = plan.window_end or win_end
    if followup.retest_window_start:
        plan.window_start = followup.retest_window_start
        plan.window_end = followup.retest_window_end or followup.retest_window_start
    plan.next_test_date = plan.window_start or followup.next_followup_on or followup.due_on

    proto_code = pf.get("condition_code") or pf.get("finding_code") or (followup.finding_codes[0] if followup.finding_codes else "")
    if bundle_code:
        plan.bundle_code = bundle_code
    elif not plan.bundle_code and proto_code in BUNDLE_BY_FINDING:
        plan.bundle_code = BUNDLE_BY_FINDING[proto_code]

    if not plan.reason_code:
        plan.reason_code = proto_code or plan.bundle_code or "FOLLOWUP"
    if not plan.reason_text_clinical:
        parts = [pf.get("considerations_text") or "", pf.get("timeframe_text") or ""]
        text = " ".join(x.strip() for x in parts if x and str(x).strip())
        plan.reason_text_clinical = text or "Repeat diagnostic monitoring recommended per clinical protocol."

    if doctor_id is not None:
        plan.approved_by_doctor_id = doctor_id
        plan.doctor_id = plan.doctor_id or doctor_id
    elif plan.source == "DOCTOR" and plan.doctor_id and plan.approved_by_doctor_id is None:
        plan.approved_by_doctor_id = plan.doctor_id

    if proto_code:
        plan.protocol_code = proto_code
    if plan.source == "PROTOCOL":
        rs = db.scalar(select(RuleSet).where(RuleSet.key == "retest_protocols", RuleSet.active).order_by(RuleSet.version.desc()))
        if rs and rs.signed_off_at is not None:
            plan.protocol_version = rs.version

    opt_map: dict[str, bool] = {}
    for item in [pf, *findings]:
        for t in (item.get("tests") or []):
            if isinstance(t, dict) and t.get("code") and t["code"] not in opt_map:
                opt_map[t["code"]] = bool(t.get("optional"))

    codes = list(plan.test_codes or [])
    plan.tests = [
        {
            "code": c,
            "name": cat[c]["name"] if c in cat else c,
            "optional": opt_map.get(c, False),
            "price_inr": cat[c].get("price_inr") if c in cat else None,
        }
        for c in codes
    ]

    if not plan.previous_results_snapshot and followup.report_id:
        expected_params = {pm for c in codes for pm in TEST_TO_PARAMS.get(c, {c})}
        snap: list[dict] = []
        seen: set[str] = set()
        for p in db.scalars(select(ReportParameter).where(ReportParameter.report_id == followup.report_id).order_by(ReportParameter.id)):
            if not p.param_code or p.param_code in seen:
                continue
            if p.param_code in expected_params or p.system_flag in ("LOW", "HIGH"):
                seen.add(p.param_code)
                snap.append({"code": p.param_code, "report_id": followup.report_id})
        plan.previous_results_snapshot = snap

    return plan


def approve_plan(db: Session, plan: RetestRecommendation, doctor_id: int) -> RetestRecommendation:
    plan.approved_by_doctor_id = doctor_id
    plan.doctor_id = plan.doctor_id or doctor_id
    fu = db.get(Followup, plan.followup_id)
    if fu:
        sync_plan_fields(db, plan, fu, doctor_id=doctor_id)
        if fu.stage in ("NOT_CALLED", "CALLED", "CONSENT_GIVEN", "BOOKED", "DOCTOR_DONE"):
            fu.stage = "RETEST_RECOMMENDED"
    db.flush()
    return plan


def sync_signed_off_protocol_plans(db: Session, version: int) -> None:
    """Stamp active signed-off protocol_version onto open PROTOCOL plans."""
    for p in db.scalars(select(RetestRecommendation).where(
        RetestRecommendation.source == "PROTOCOL", RetestRecommendation.comparison_report_id.is_(None)
    )):
        if p.protocol_code and p.protocol_version is None:
            p.protocol_version = version


def book_plan(
    db: Session,
    plan: RetestRecommendation,
    *,
    collection_mode: str,
    health_hub_id: int | None = None,
    slot_start: datetime | None = None,
    address: str = "",
    booking_status: str = "BOOKED",
    lab_order_ref: str = "",
) -> RetestRecommendation:
    if not is_plan_approved(db, plan):
        raise PermissionError("Unapproved retest plan cannot be booked")
    mode = collection_mode.strip().upper()
    if mode not in COLLECTION_MODES:
        raise ValueError("collection_mode must be HOME or HEALTH_HUB")
    st = booking_status.strip().upper()
    if st not in BOOKING_STATUSES or st == "NOT_BOOKED":
        raise ValueError("booking_status must be BOOKED, COLLECTED, CANCELLED, or NO_SHOW")

    if mode == "HOME":
        addr = address.strip()
        if not addr and not plan.address_enc:
            raise ValueError("Home collection requires a patient address")
        if addr:
            plan.address_enc = storage.encrypt_str(addr[:300])
        plan.health_hub_id = None
    else:
        if not health_hub_id:
            raise ValueError("Health Hub booking requires health_hub_id")
        hub = db.get(HealthHub, health_hub_id)
        if not hub or not hub.active:
            raise LookupError("No active Health Hub found with that ID")
        plan.health_hub_id = hub.id
        plan.address_enc = ""

    plan.collection_mode = mode
    if slot_start is not None:
        plan.slot_start = (slot_start if slot_start.tzinfo else slot_start.replace(tzinfo=IST)).astimezone(timezone.utc)
    plan.booking_status = st
    if lab_order_ref.strip():
        plan.lab_order_ref = lab_order_ref.strip()[:64]
        plan.ordered_ref = plan.lab_order_ref
    if st in ("BOOKED", "COLLECTED"):
        plan.ordered = True

    fu = db.get(Followup, plan.followup_id)
    if fu and st == "BOOKED":
        fu.stage = "RETEST_ORDERED"
    if fu and st in ("BOOKED", "COLLECTED"):
        diag_amt = sum(int(t.get("price_inr") or 0) for t in (plan.tests or []) if isinstance(t, dict) and not t.get("optional"))
        svc_code = "HOME_COLLECTION" if mode == "HOME" else "HEALTH_HUB_VISIT"
        existing_tp = db.scalar(select(CareTouchpoint).where(
            CareTouchpoint.patient_id == fu.patient_id, CareTouchpoint.ref_entity == "retest_booking",
            CareTouchpoint.ref_id == plan.id, CareTouchpoint.stage == "DIAGNOSTICS",
        ))
        if not existing_tp:
            db.add(CareTouchpoint(
                patient_id=fu.patient_id, stage="DIAGNOSTICS", service_code=svc_code,
                occurred_on=to_ist_date(plan.slot_start) if plan.slot_start else today_ist(),
                source="AUTO", ref_entity="retest_booking", ref_id=plan.id,
                amount_inr=diag_amt or None, health_hub_id=plan.health_hub_id,
            ))
        else:
            existing_tp.service_code = svc_code
            existing_tp.health_hub_id = plan.health_hub_id
    db.flush()
    from . import journeys as journey_svc
    journey_svc.sync_journey_events(db, followup_id=plan.followup_id)
    return plan


def accept_bundle(db: Session, followup: Followup, bundle_code: str, doctor_id: int) -> dict[str, Any]:
    rules = load_rules(db)
    bmap = _bundles_map(rules)
    bcode = bundle_code.strip().upper()
    if bcode not in bmap:
        raise LookupError(f"Unknown protocol bundle: {bundle_code}")
    bundle = bmap[bcode]
    root_pid = rel.canonical_patient_id(db, followup.patient_id)
    has_active_med = db.scalar(select(PatientMedication.id).where(
        PatientMedication.patient_id == root_pid, PatientMedication.stopped_on.is_(None)
    ).limit(1)) is not None

    plan = db.scalar(select(RetestRecommendation).where(RetestRecommendation.followup_id == followup.id).order_by(RetestRecommendation.id.desc()))
    if not plan:
        plan = RetestRecommendation(followup_id=followup.id, doctor_id=doctor_id, test_codes=[], source="DOCTOR")
        db.add(plan)
        db.flush()

    merged_codes = list(dict.fromkeys([*(plan.test_codes or []), *(bundle.get("tests") or [])]))
    plan.test_codes = merged_codes
    plan.bundle_code = bcode
    plan.source = "DOCTOR"
    plan.approved_by_doctor_id = doctor_id
    plan.doctor_id = doctor_id
    plan.reason_code = bundle.get("retest_protocol_code") or bcode
    plan.reason_text_clinical = f"{bundle['name']}: {bundle['window_text']}."

    rep = db.get(Report, followup.report_id)
    anchor = followup.treatment_anchor_on or (to_ist_date(rep.collected_on) if rep and rep.collected_on else today_ist())
    if not plan.window_start:
        plan.window_start = anchor + timedelta(days=int(bundle.get("window_min_days") or 90))
        plan.window_end = anchor + timedelta(days=int(bundle.get("window_max_days") or bundle.get("window_min_days") or 90))
        plan.next_test_date = plan.window_start
        if followup.retest_status not in ("OVERRIDDEN", "DOCTOR_SET"):
            followup.retest_window_start = plan.window_start
            followup.retest_window_end = plan.window_end
            followup.due_on = plan.window_start

    sync_plan_fields(db, plan, followup, rules=rules, doctor_id=doctor_id, bundle_code=bcode)
    if followup.stage in ("NOT_CALLED", "CALLED", "CONSENT_GIVEN", "BOOKED", "DOCTOR_DONE"):
        followup.stage = "RETEST_RECOMMENDED"
    db.flush()

    today = today_ist()
    included_services: list[dict] = []
    for srv in bundle.get("services") or []:
        if srv.get("only_if_active_medicine") and not has_active_med:
            continue
        included_services.append(srv)
        stage = srv.get("loop_stage") or "DIAGNOSTICS"
        exists = db.scalar(select(CareTouchpoint.id).where(
            CareTouchpoint.patient_id == root_pid, CareTouchpoint.ref_entity == "protocol_bundle",
            CareTouchpoint.ref_id == plan.id, CareTouchpoint.stage == stage,
        ))
        if not exists:
            db.add(CareTouchpoint(
                patient_id=root_pid, stage=stage, service_code=srv.get("service_code") or stage,
                occurred_on=today, source="AUTO", ref_entity="protocol_bundle", ref_id=plan.id,
                amount_inr=srv.get("price_inr"),
            ))
    db.flush()
    from . import journeys as journey_svc
    journey_svc.sync_journey_events(db, followup_id=followup.id)
    return {"plan_id": plan.id, "bundle_code": bcode, "services": [s["type"] for s in included_services]}


def match_completed_plans(db: Session, patient_id: int, report: Report) -> list[int]:
    """Step 7: Auto-match new READY report against open retest plans and trigger Page 10 comparison."""
    order = db.get(Order, report.order_id)
    if not order or order.status != ord_status.READY:
        return []
    rep_params = {p.param_code for p in db.scalars(select(ReportParameter).where(ReportParameter.report_id == report.id)) if p.param_code}
    if not rep_params:
        return []
    rep_date = to_ist_date(report.collected_on or order.collected_on or report.reported_on or order.reported_on)
    root_pid = rel.canonical_patient_id(db, patient_id)
    pids = [root_pid, *db.scalars(select(Patient.id).where(Patient.merged_into_id == root_pid))]

    candidates = db.execute(
        select(RetestRecommendation, Followup)
        .join(Followup, Followup.id == RetestRecommendation.followup_id)
        .where(
            Followup.patient_id.in_(pids),
            Followup.report_id != report.id,
            RetestRecommendation.comparison_report_id.is_(None),
        )
        .order_by(RetestRecommendation.id)
    ).all()

    matched_ids: list[int] = []
    for plan, fu in candidates:
        codes = list(plan.test_codes or [])
        expected = {pm for c in codes for pm in TEST_TO_PARAMS.get(c, {c})}
        if not expected or not (expected & rep_params):
            continue
        w_start = plan.window_start or fu.retest_window_start or plan.next_test_date
        w_end = plan.window_end or fu.retest_window_end or w_start
        if not w_start or not w_end:
            continue
        if rep_date < w_start or rep_date > (w_end + timedelta(days=30)):
            continue
        plan.comparison_report_id = report.id
        plan.completed_on = rep_date
        plan.plan_status = "COMPLETED_IN_WINDOW" if rep_date <= w_end else "COMPLETED_LATE"
        if plan.booking_status == "BOOKED":
            plan.booking_status = "COLLECTED"
        matched_ids.append(plan.id)

    if matched_ids:
        db.flush()
        compare_svc.compare(db, root_pid, report.id)
        from . import journeys as journey_svc
        journey_svc.sync_journey_events(db, patient_id=root_pid)
    return matched_ids


def _live_previous_values(db: Session, followup: Followup, snap: list) -> list[dict]:
    if not snap or not followup.report_id:
        return []
    codes = {s.get("code") for s in snap if isinstance(s, dict) and s.get("code")}
    rep_id = snap[0].get("report_id") if isinstance(snap[0], dict) else followup.report_id
    out = []
    for p in db.scalars(select(ReportParameter).where(ReportParameter.report_id == (rep_id or followup.report_id), ReportParameter.param_code.in_(codes))):
        out.append({"code": p.param_code, "name": p.param_name_raw, "value": p.value_num, "unit": p.unit, "flag": p.system_flag, "report_id": p.report_id})
    return out


def plan_out(db: Session, plan: RetestRecommendation, followup: Followup, *, role: str, rules: dict | None = None) -> dict[str, Any]:
    rules = rules or load_rules(db)
    sync_plan_fields(db, plan, followup, rules=rules)
    approved = is_plan_approved(db, plan)
    hub = db.get(HealthHub, plan.health_hub_id) if plan.health_hub_id else None

    if role == "CALLER":
        # Zero clinical data: no tests, no reason, no snapshot, no values, no decrypted address
        steps = [
            {"step": 1, "title": "Next Recommended Date", "done": plan.next_test_date is not None},
            {"step": 2, "title": "Follow-up Review", "done": True},
            {"step": 3, "title": "Doctor Approval", "done": approved},
            {"step": 4, "title": "Previous Check", "done": bool(plan.previous_results_snapshot)},
            {"step": 5, "title": "Follow-up Test", "done": bool(plan.test_codes)},
            {"step": 6, "title": "Collection Booking", "done": plan.booking_status in ("BOOKED", "COLLECTED")},
            {"step": 7, "title": "Follow-up Comparison", "done": plan.comparison_report_id is not None},
        ]
        return {
            "id": plan.id,
            "followup_id": plan.followup_id,
            "label": "Follow-up test",
            "approved": approved,
            "next_test_date": plan.next_test_date,
            "window_start": plan.window_start,
            "window_end": plan.window_end,
            "booking_status": plan.booking_status,
            "collection_mode": plan.collection_mode,
            "health_hub_id": plan.health_hub_id,
            "health_hub_name": hub.name if hub else None,
            "slot_start": plan.slot_start,
            "has_address": bool(plan.address_enc),
            "plan_status": plan.plan_status,
            "steps": steps,
        }

    is_admin = role == "ADMIN"
    tests_out = [
        {k: v for k, v in t.items() if is_admin or k != "price_inr"}
        for t in (plan.tests or []) if isinstance(t, dict)
    ]
    comp_rows = compare_svc.compare(db, followup.patient_id, plan.comparison_report_id) if plan.comparison_report_id else []
    prev_live = _live_previous_values(db, followup, plan.previous_results_snapshot or [])
    addr = storage.decrypt_str(plan.address_enc) if plan.address_enc else ""

    steps = [
        {"step": 1, "title": "Next Recommended Test Date", "done": plan.next_test_date is not None,
         "detail": f"{plan.window_start.isoformat() if plan.window_start else ''}" + (f" to {plan.window_end.isoformat()}" if plan.window_end and plan.window_end != plan.window_start else "")},
        {"step": 2, "title": "Reason for Retesting", "done": bool(plan.reason_code), "detail": plan.reason_code},
        {"step": 3, "title": "Treating Clinician or Approved Protocol", "done": approved,
         "detail": f"Approved by doctor #{plan.approved_by_doctor_id}" if plan.approved_by_doctor_id else (f"{plan.protocol_code} v{plan.protocol_version}" if approved else "Pending approval")},
        {"step": 4, "title": "Previous Diagnostic Results", "done": bool(prev_live),
         "detail": f"{len(prev_live)} indicator(s) linked"},
        {"step": 5, "title": "Recommended Tests", "done": bool(tests_out),
         "detail": ", ".join(t["name"] for t in tests_out)},
        {"step": 6, "title": "Home Collection or Health Hub Booking Option", "done": plan.booking_status in ("BOOKED", "COLLECTED"),
         "detail": f"{plan.booking_status}" + (f" ({plan.collection_mode})" if plan.collection_mode else "")},
        {"step": 7, "title": "Automated Report Comparison", "done": plan.comparison_report_id is not None,
         "detail": plan.plan_status if plan.comparison_report_id else "Waiting for follow-up report"},
    ]

    out = {
        "id": plan.id,
        "followup_id": plan.followup_id,
        "approved": approved,
        "approved_by_doctor_id": plan.approved_by_doctor_id,
        "protocol_code": plan.protocol_code,
        "protocol_version": plan.protocol_version,
        "next_test_date": plan.next_test_date,
        "window_start": plan.window_start,
        "window_end": plan.window_end,
        "reason_code": plan.reason_code,
        "reason_text_clinical": plan.reason_text_clinical,
        "previous_results_snapshot": plan.previous_results_snapshot or [],
        "previous_results_live": prev_live,
        "tests": tests_out,
        "test_codes": plan.test_codes or [],
        "bundle_code": plan.bundle_code,
        "collection_mode": plan.collection_mode,
        "health_hub_id": plan.health_hub_id,
        "health_hub_name": hub.name if hub else None,
        "slot_start": plan.slot_start,
        "address": addr,
        "booking_status": plan.booking_status,
        "lab_order_ref": plan.lab_order_ref,
        "comparison_report_id": plan.comparison_report_id,
        "comparison_rows": comp_rows,
        "plan_status": plan.plan_status,
        "completed_on": plan.completed_on,
        "steps": steps,
    }
    if is_admin:
        out["tests_total_inr"] = sum(int(t.get("price_inr") or 0) for t in (plan.tests or []) if isinstance(t, dict) and not t.get("optional"))
    return out


def explain_plan(db: Session, plan: RetestRecommendation, followup: Followup, *, lang: str = "en", rules: dict | None = None) -> dict[str, Any]:
    """Deterministic template patient explanation sheet in English or Hindi (never AI)."""
    rules = rules or load_rules(db)
    sync_plan_fields(db, plan, followup, rules=rules)
    use_hi = lang.strip().lower().startswith("hi")
    w_s = plan.window_start.isoformat() if plan.window_start else (plan.next_test_date.isoformat() if plan.next_test_date else "—")
    w_e = plan.window_end.isoformat() if plan.window_end else w_s
    test_names = ", ".join(t["name"] for t in (plan.tests or []) if isinstance(t, dict)) or "Recommended tests"

    target_rep = plan.comparison_report_id or followup.report_id
    comp_rows = compare_svc.compare(db, followup.patient_id, target_rep) if target_rep else []
    how_lines = [r["patient_summary_line"] for r in comp_rows] if comp_rows else []

    if use_hi:
        why = f"डॉक्टर के परामर्श के अनुसार आपकी स्वास्थ्य प्रगति की जाँच के लिए अनुवर्ती जांच ({plan.reason_code}) आवश्यक है। {plan.reason_text_clinical}"
        when = f"अनुशंसित जांच विंडो: {w_s} से {w_e}।"
        patient_msg = f"आपकी अनुवर्ती जांच {w_s} से {w_e} के बीच देय है।"
        if not how_lines:
            how_lines = ["नियमित तुलनात्मक रिपोर्ट के आधार पर डॉक्टर आपके स्वास्थ्य संकेतकों की समीक्षा करेंगे।"]
        title = "रोगी जांच योजना सारांश (क्यों, कब और कैसे)"
    else:
        why = plan.reason_text_clinical or "Follow-up testing helps confirm how your body is responding over time."
        when = f"Recommended window: {w_s}" + (f" to {w_e}." if w_e != w_s else ".")
        patient_msg = f"Your follow-up test is due between {w_s} and {w_e}"
        if not how_lines:
            how_lines = ["Your previous and upcoming indicators will be compared automatically once your repeat test arrives."]
        title = "Patient Retesting Summary (Why, When & How)"

    return {
        "language": "hi" if use_hi else "en",
        "title": title,
        "tests": test_names,
        "why": why,
        "when": when,
        "how_lines": how_lines,
        "comparison_rows": comp_rows,
        "patient_message": patient_msg,
        "disclaimer": "Medication changes remain the responsibility of the treating clinician.",
    }


def _period_kpis(db: Session, frm: date, to: date, hub_id: int | None = None, protocol: str | None = None) -> dict[str, Any]:
    start_dt = datetime.combine(frm, datetime.min.time(), IST).astimezone(timezone.utc)
    end_dt = datetime.combine(to + timedelta(days=1), datetime.min.time(), IST).astimezone(timezone.utc)

    # Denominator 1: patients with READY analysed reports in [frm, to]
    assessed_rows = db.execute(
        select(Order.patient_id, Report.collected_on, Report.created_at)
        .join(Report, Report.order_id == Order.id)
        .where(Order.status == ord_status.READY, Order.patient_id.is_not(None))
    ).all()
    assessed_pids = set()
    for pid, r_col, r_created in assessed_rows:
        dt = r_col or r_created
        if dt is not None:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if start_dt <= dt < end_dt:
                assessed_pids.add(pid)

    # Resolve canonical root pids for assessed patients
    assessed_roots = {rel.canonical_patient_id(db, pid) for pid in assessed_pids if pid}

    all_recs = db.execute(
        select(RetestRecommendation, Followup, Report)
        .join(Followup, Followup.id == RetestRecommendation.followup_id)
        .join(Report, Report.id == Followup.report_id)
    ).all()

    elig_roots: set[int] = set()
    comp_due = 0
    comp_in_win = 0
    rev_inr = 0
    rev_plans = 0

    proto_q = protocol.strip().upper() if protocol else None
    for plan, fu, rep in all_recs:
        if hub_id is not None and plan.health_hub_id != hub_id:
            continue
        if proto_q and proto_q not in ((plan.bundle_code or "").upper(), (plan.protocol_code or "").upper(), (plan.reason_code or "").upper()):
            continue
        approved = is_plan_approved(db, plan)
        root_pid = rel.canonical_patient_id(db, fu.patient_id)

        # Eligibility: approved plans whose assessment/created timestamp is in [frm, to]
        ref_dt = rep.collected_on or plan.created_at
        if ref_dt.tzinfo is None:
            ref_dt = ref_dt.replace(tzinfo=timezone.utc)
        if approved and start_dt <= ref_dt < end_dt:
            elig_roots.add(root_pid)

        # Completion: approved plans whose window_end (or next_test_date) falls in [frm, to]
        due_win = plan.window_end or plan.window_start or plan.next_test_date
        if approved and due_win and frm <= due_win <= to:
            comp_due += 1
            if plan.plan_status == "COMPLETED_IN_WINDOW":
                comp_in_win += 1

        # Revenue: sum of price_inr of tests on APPROVED AND COMPLETED plans completed in [frm, to]
        if approved and plan.plan_status in ("COMPLETED_IN_WINDOW", "COMPLETED_LATE") and plan.completed_on and frm <= plan.completed_on <= to:
            rev_plans += 1
            rev_inr += sum(int(t.get("price_inr") or 0) for t in (plan.tests or []) if isinstance(t, dict))

    elig_num = len(elig_roots)
    elig_den = len(assessed_roots)
    elig_pct = round(100.0 * elig_num / elig_den, 1) if elig_den else None
    comp_pct = round(100.0 * comp_in_win / comp_due, 1) if comp_due else None
    return {
        "elig_num": elig_num, "elig_den": elig_den, "elig_pct": elig_pct,
        "comp_num": comp_in_win, "comp_den": comp_due, "comp_pct": comp_pct,
        "rev_inr": rev_inr, "rev_plans": rev_plans,
    }


def compute_kpis(db: Session, *, frm: date | None = None, to: date | None = None, hub_id: int | None = None, protocol: str | None = None) -> dict[str, Any]:
    to = to or today_ist()
    frm = frm or (to - timedelta(days=89))
    span = max((to - frm).days + 1, 1)
    prev_to = frm - timedelta(days=1)
    prev_frm = prev_to - timedelta(days=span - 1)

    cur = _period_kpis(db, frm, to, hub_id=hub_id, protocol=protocol)
    prev = _period_kpis(db, prev_frm, prev_to, hub_id=hub_id, protocol=protocol)

    def _trend(c_val, p_val, suffix="%"):
        if c_val is None or p_val is None:
            return "—"
        d = round(c_val - p_val, 1)
        if d == 0:
            return f"0{suffix}"
        sign = "+" if d > 0 else "\u2212"
        return f"{sign}{abs(d):g}{suffix}"

    kpis = [
        {
            "key": "eligibility_rate",
            "name": "Retesting eligibility rate",
            "definition": "Patients with a documented clinical indication for repeat testing \u00f7 patients assessed",
            "business_significance": "Measures the appropriate follow-up opportunity",
            "numerator": cur["elig_num"],
            "denominator": cur["elig_den"],
            "value": cur["elig_pct"],
            "unit": "%",
            "display": f"{cur['elig_pct']}%" if cur["elig_pct"] is not None else "—",
            "trend": _trend(cur["elig_pct"], prev["elig_pct"], "%"),
        },
        {
            "key": "completion_rate",
            "name": "Retesting completion rate",
            "definition": "Eligible patients completing retesting within the recommended window \u00f7 eligible patients due",
            "business_significance": "Measures follow-up effectiveness",
            "numerator": cur["comp_num"],
            "denominator": cur["comp_den"],
            "value": cur["comp_pct"],
            "unit": "%",
            "display": f"{cur['comp_pct']}%" if cur["comp_pct"] is not None else "—",
            "trend": _trend(cur["comp_pct"], prev["comp_pct"], "%"),
        },
        {
            "key": "repeat_revenue",
            "name": "Repeat diagnostics revenue",
            "definition": "Revenue generated from medically indicated repeat tests",
            "business_significance": "Measures recurring diagnostic revenue",
            "numerator": cur["rev_inr"],
            "denominator": cur["rev_plans"],
            "value": cur["rev_inr"],
            "unit": "INR",
            "display": f"\u20b9{cur['rev_inr']:,}",
            "trend": _trend(cur["rev_inr"], prev["rev_inr"], " INR"),
        },
    ]
    return {
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "hub_id": hub_id,
        "protocol": protocol or "",
        "kpis": kpis,
    }
