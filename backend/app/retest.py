"""Retesting schedule & 5 urgency tiers engine (Pages 7 & 9)."""
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import assign, conditions as cond_svc, findings, programs as prog_svc
from .analysis import load_rules
from .models import Followup, MonitoringSchedule, Order, Patient, PatientMedication, Report, ReportParameter, RetestRecommendation, User
from .security import audit
from .seed_data import CONDITION_PROTOCOLS, RETEST_PROTOCOLS, RETEST_TIERS, TEST_CATALOGUE
from .timeutil import IST, to_ist_date, today_ist

NON_AUTO_MODES = {"REQUIRES_INDICATION", "RISK_BASED", "PERSONALIZED", "INDIVIDUALIZED", "DOCTOR_DECIDES"}
OVERRIDE_REASONS = ("CLINICAL_JUDGMENT", "TREATMENT_CHANGE", "PATIENT_PREFERENCE", "SYMPTOM_URGENCY", "OTHER")
DONE_STAGES = {"DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED", "DECLINED", "WRONG_NUMBER"}
TIER_ORDER = {"URGENT": 1, "EARLY": 2, "TREATMENT_RESPONSE": 3, "METABOLIC": 4, "LONG_TERM": 5}

FINDING_DRUG_CLASSES: dict[str, set[str]] = {
    "HIGH_HBA1C": {"BIGUANIDE", "SULFONYLUREA", "INSULIN"},
    "HIGH_CHOLESTEROL": {"STATIN"},
    "HIGH_TSH": {"THYROID_HORMONE"},
    "LOW_HB": {"IRON_SUPPLEMENT"},
    "LOW_VITD": {"VITAMIN_D_SUPPLEMENT"},
}
TREATMENT_FINDINGS = {"HIGH_HBA1C", "HIGH_CHOLESTEROL", "HIGH_TSH", "LOW_HB"}
LFT_CODES = {"SGOT", "AST", "SGPT", "ALT", "ALP", "GGT", "BILIRUBIN", "BILI_T"}

MED_KEYWORDS: dict[str, tuple[str, ...]] = {
    "HIGH_HBA1C": ("metformin", "glimepiride", "gliclazide", "sitagliptin", "vildagliptin", "empagliflozin", "dapagliflozin", "insulin", "diabetes", "glycemic", "hba1c"),
    "HIGH_CHOLESTEROL": ("statin", "atorvastatin", "rosuvastatin", "simvastatin", "pravastatin", "ezetimibe", "fenofibrate", "lipid", "cholesterol"),
    "HIGH_TSH": ("levothyroxine", "thyroxine", "eltroxin", "thyronorm", "thyroid", "tsh"),
    "LOW_HB": ("iron", "ferrous", "folic", "anemia", "anaemia", "orofert", "autrin", "hemoglobin"),
    "LOW_VITD": ("vitamin d", "cholecalciferol", "ergocalciferol", "calcitriol", "vitd", "d3"),
}


def tier_map(rules: dict | None = None) -> dict[str, dict]:
    tiers = (rules or {}).get("retest_tiers") or RETEST_TIERS
    return {t["code"]: t for t in tiers if isinstance(t, dict) and t.get("code")}


def tier_meta(db_or_rules: Session | dict | None, code: str | None) -> dict:
    rules = load_rules(db_or_rules) if isinstance(db_or_rules, Session) else (db_or_rules or {})
    tmap = tier_map(rules)
    return tmap.get(code or "LONG_TERM") or tmap.get("LONG_TERM") or RETEST_TIERS[-1]


def date_in_tier_window(rules: dict, tier_code: str, target_date: date, anchor_date: date) -> tuple[bool, date, date | None]:
    meta = tier_meta(rules, tier_code)
    min_d = int(meta.get("window_min_days") or 0)
    max_d = meta.get("window_max_days")
    lo = anchor_date + timedelta(days=min_d)
    hi = anchor_date + timedelta(days=int(max_d)) if max_d is not None else None
    ok = target_date >= lo and (hi is None or target_date <= hi)
    return ok, lo, hi


def _parse_iso_date(val: Any) -> date | None:
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return to_ist_date(val)
    if not isinstance(val, str) or not val.strip():
        return None
    try:
        return date.fromisoformat(val.strip()[:10])
    except ValueError:
        return None


def _medicine_anchor(active_meds: list, med_cat: dict[str, dict], profile_meds: list, finding_code: str, anchor_kind: str) -> date | None:
    req_classes = FINDING_DRUG_CLASSES.get(finding_code, set())
    kws = MED_KEYWORDS.get(finding_code, ())
    dates: list[date] = []
    for m in active_meds or []:
        if getattr(m, "stopped_on", None) is not None:
            continue
        meta = med_cat.get(getattr(m, "medicine_code", ""), {})
        dclass = meta.get("drug_class", "")
        hay = f"{getattr(m, 'medicine_code', '')} {meta.get('generic_name', '')} {dclass}".lower()
        if (dclass and dclass in req_classes) or (kws and any(kw in hay for kw in kws)):
            primary = getattr(m, "last_changed_on", None) if anchor_kind == "TREATMENT_CHANGE" else getattr(m, "started_on", None)
            secondary = getattr(m, "started_on", None) if anchor_kind == "TREATMENT_CHANGE" else getattr(m, "last_changed_on", None)
            if (d := _parse_iso_date(primary) or _parse_iso_date(secondary)):
                dates.append(d)
    for m in profile_meds or []:
        if not isinstance(m, dict) or m.get("active") is False:
            continue
        fc = str(m.get("finding_code") or "").upper()
        hay = " ".join(str(m.get(k) or "") for k in ("name", "class", "category", "condition", "indication", "medicine_code")).lower()
        if fc == finding_code or (kws and any(kw in hay for kw in kws)):
            primary = m.get("last_changed_on") if anchor_kind == "TREATMENT_CHANGE" else m.get("started_on")
            secondary = m.get("started_on") if anchor_kind == "TREATMENT_CHANGE" else m.get("last_changed_on")
            if (d := _parse_iso_date(primary) or _parse_iso_date(secondary)):
                dates.append(d)
    return max(dates) if dates else None


def _condition_state(finding_code: str, ctx: dict[str, Any], med_cat: dict[str, dict], followup: Followup, params: list, trends: dict[str, str], detected_codes: list[str], explicit_state: dict[str, Any]) -> dict[str, Any]:
    profile = ctx.get("profile") or {}
    active_meds = ctx.get("active_meds") or []
    dict_meds = explicit_state.get("medicines") if "medicines" in explicit_state else (profile.get("medicines") or profile.get("medications") or [])
    med_change_date = _medicine_anchor(active_meds, med_cat, dict_meds, finding_code, "TREATMENT_CHANGE")
    med_start_date = _medicine_anchor(active_meds, med_cat, dict_meds, finding_code, "TREATMENT_START")
    manual_anchor = _parse_iso_date(explicit_state.get("treatment_anchor_on") or getattr(followup, "treatment_anchor_on", None))

    treatment_changed = bool(explicit_state.get("treatment_changed") or med_change_date is not None or (manual_anchor is not None and finding_code in ("HIGH_HBA1C", "HIGH_CHOLESTEROL", "HIGH_TSH")))
    on_treatment = bool(explicit_state.get("on_treatment") or med_start_date is not None or (manual_anchor is not None and finding_code == "LOW_HB"))
    indicated = bool(explicit_state.get("indicated") or profile.get("vitd_retest_indicated") or med_start_date is not None or (manual_anchor is not None and finding_code == "LOW_VITD" and not (TREATMENT_FINDINGS & set(detected_codes))))
    stable_flag = bool(explicit_state.get("stable_at_goal") or profile.get("glycemic_at_goal"))
    explicit_unmet = explicit_state.get("targets_unmet")
    lab_unmet = finding_code == "HIGH_HBA1C" and any(getattr(p, "param_code", "") == "HBA1C" and getattr(p, "system_flag", "") == "HIGH" for p in params)
    targets_unmet = bool(explicit_unmet) if explicit_unmet is not None else (bool(lab_unmet) and not stable_flag)
    stable_at_goal = bool(stable_flag and not treatment_changed and not targets_unmet)
    lft_params = [p for p in params if getattr(p, "param_code", "") in LFT_CODES and getattr(p, "system_flag", "") == "HIGH"]
    mild_stable = bool(explicit_state.get("mild_stable") or (finding_code == "ABNORMAL_LFT" and lft_params and all(getattr(p, "severity", "") == "mild" for p in lft_params) and any(trends.get(getattr(p, "param_code", "")) == "stable_abnormal" for p in lft_params)))
    return {
        "med_change_date": med_change_date, "med_start_date": med_start_date, "manual_anchor": manual_anchor,
        "explicit_anchor": _parse_iso_date(explicit_state.get("anchor_date")), "treatment_changed": treatment_changed,
        "on_treatment": on_treatment, "indicated": indicated, "stable_at_goal": stable_at_goal,
        "targets_unmet": targets_unmet, "mild_stable": mild_stable,
    }


def _pick_variant(proto: dict, cond: dict[str, Any]) -> dict:
    variants = proto.get("variants") or []
    for v in variants:
        when = v.get("when", "default")
        if when != "default" and cond.get(when):
            return v
    return next((v for v in variants if v.get("when") == "default"), variants[0] if variants else {"when": "default", "anchor": "REPORT_DATE"})


def _resolve_anchor_date(anchor_kind: str, report_date: date, cond: dict[str, Any]) -> date:
    if cond["explicit_anchor"]:
        return cond["explicit_anchor"]
    if anchor_kind == "TREATMENT_CHANGE":
        return cond["med_change_date"] or cond["manual_anchor"] or report_date
    if anchor_kind == "TREATMENT_START":
        return cond["med_start_date"] or cond["manual_anchor"] or report_date
    return report_date


COND_DRUG_CLASSES: dict[str, set[str]] = {
    "PREDIABETES": {"BIGUANIDE", "SULFONYLUREA", "INSULIN"},
    "DIABETES_STABLE": {"BIGUANIDE", "SULFONYLUREA", "INSULIN"},
    "DIABETES_UNCONTROLLED": {"BIGUANIDE", "SULFONYLUREA", "INSULIN"},
    "DYSLIPIDEMIA_NEW_MED": {"STATIN", "FIBRATE", "EZETIMIBE", "LIPID_LOWERING"},
    "DYSLIPIDEMIA_STABLE": {"STATIN", "FIBRATE", "EZETIMIBE", "LIPID_LOWERING"},
    "HYPOTHYROID_STABLE_TREATED": {"THYROID_HORMONE"},
    "IRON_DEFICIENCY": {"IRON_SUPPLEMENT"},
    "B12_DEFICIENCY": {"B12_SUPPLEMENT"},
}
COND_MED_KEYWORDS: dict[str, tuple[str, ...]] = {
    "DYSLIPIDEMIA_NEW_MED": MED_KEYWORDS["HIGH_CHOLESTEROL"],
    "DYSLIPIDEMIA_STABLE": MED_KEYWORDS["HIGH_CHOLESTEROL"],
    "HYPOTHYROID_STABLE_TREATED": MED_KEYWORDS["HIGH_TSH"],
    "IRON_DEFICIENCY": MED_KEYWORDS["LOW_HB"],
    "B12_DEFICIENCY": ("b12", "methylcobalamin", "cyanocobalamin"),
}


def evaluate_condition_protocol(proto: dict, report_date: date, followup: Followup | None, ctx: dict[str, Any],
                                med_cat: dict[str, dict], params: list, catalogue_names: dict[str, str],
                                explicit_state: dict[str, Any] | None = None, *, c_stage: str = "") -> dict[str, Any]:
    explicit_state = explicit_state or {}
    cc = proto["condition_code"]
    profile = ctx.get("profile") or {}
    active_meds = ctx.get("active_meds") or []
    dict_meds = explicit_state.get("medicines") if "medicines" in explicit_state else (profile.get("medicines") or profile.get("medications") or [])

    # Reuse _medicine_anchor logic for condition drug classes & keywords
    req_classes = COND_DRUG_CLASSES.get(cc, set())
    kws = COND_MED_KEYWORDS.get(cc, ())
    start_dates: list[date] = []
    for m in active_meds:
        if getattr(m, "stopped_on", None) is not None:
            continue
        meta = med_cat.get(getattr(m, "medicine_code", ""), {})
        dclass = meta.get("drug_class", "")
        hay = f"{getattr(m, 'medicine_code', '')} {meta.get('generic_name', '')} {dclass}".lower()
        if (dclass and dclass in req_classes) or (kws and any(kw in hay for kw in kws)):
            if (d := _parse_iso_date(getattr(m, "started_on", None)) or _parse_iso_date(getattr(m, "last_changed_on", None))):
                start_dates.append(d)
    for m in dict_meds or []:
        if not isinstance(m, dict) or m.get("active") is False:
            continue
        hay = " ".join(str(m.get(k) or "") for k in ("name", "class", "category", "medicine_code")).lower()
        if kws and any(kw in hay for kw in kws):
            if (d := _parse_iso_date(m.get("started_on")) or _parse_iso_date(m.get("last_changed_on"))):
                start_dates.append(d)
    med_start_date = max(start_dates) if start_dates else None
    manual_anchor = _parse_iso_date(explicit_state.get("treatment_anchor_on") or (getattr(followup, "treatment_anchor_on", None) if followup else None))

    stage_u = (c_stage or "").strip().upper()
    indicated = bool(
        explicit_state.get("indicated")
        or stage_u == "INDICATED"
        or (cc == "B12_DEFICIENCY" and profile.get("b12_cbc_indicated"))
        or (cc == "DYSLIPIDEMIA_STABLE" and profile.get("lipid_retest_indicated"))
    )
    egfr_very_low = any(getattr(p, "param_code", "") == "EGFR" and getattr(p, "value_num", None) is not None and p.value_num < 45 for p in params)
    uacr_very_high = any(getattr(p, "param_code", "") == "UACR" and getattr(p, "value_num", None) is not None and p.value_num >= 300 for p in params)
    higher_risk = bool(
        explicit_state.get("higher_risk")
        or stage_u == "HIGHER_RISK"
        or (cc == "CKD" and (egfr_very_low or uacr_very_high))
    )

    cond = {
        "explicit_anchor": _parse_iso_date(explicit_state.get("anchor_date")),
        "med_change_date": med_start_date,
        "med_start_date": med_start_date,
        "manual_anchor": manual_anchor,
        "indicated": indicated,
        "higher_risk": higher_risk,
    }
    variant = _pick_variant(proto, cond)
    mode = variant.get("mode") or ("AUTO" if variant.get("window_min_days") is not None else "DOCTOR_DECIDES")
    if proto.get("requires_indication") and variant.get("when") == "default":
        mode = "REQUIRES_INDICATION"

    is_lab = proto.get("is_lab_protocol", True)
    auto_scheduled = bool(is_lab and mode not in NON_AUTO_MODES and variant.get("window_min_days") is not None)
    anchor_kind = variant.get("anchor", "REPORT_DATE")
    anchor_date = _resolve_anchor_date(anchor_kind, report_date, cond)
    min_days, max_days = variant.get("window_min_days"), variant.get("window_max_days")
    win_start = anchor_date + timedelta(days=int(min_days)) if (auto_scheduled and min_days is not None) else None
    win_end = anchor_date + timedelta(days=int(max_days if max_days is not None else min_days)) if (auto_scheduled and min_days is not None) else None
    rem_cfg = proto.get("reminder") or {}
    rem_mode = rem_cfg.get("mode", "FIXED")
    reminder_on = anchor_date + timedelta(days=int(rem_cfg["day_min"])) if (auto_scheduled and rem_mode in ("FIXED", "IF_APPROPRIATE") and rem_cfg.get("day_min") is not None) else None
    tests = [
        {"code": t["code"], "name": catalogue_names.get(t["code"], t["code"]), "optional": bool(t.get("optional")),
         **({"routine": t["routine"]} if "routine" in t else {}),
         **({"doctor_decides": t["doctor_decides"]} if "doctor_decides" in t else {})}
        for t in (proto.get("tests") or []) if isinstance(t, dict) and t.get("code")
    ]
    tier_code = variant.get("tier") or proto.get("tier") or "LONG_TERM"
    return {
        "source": "CONDITION",
        "condition_code": cc,
        "condition_name": proto.get("condition_name", cc),
        "finding_code": cc,
        "finding_name": proto.get("condition_name", cc),
        "stage": c_stage,
        "icon": proto.get("icon", ""),
        "icon_label": proto.get("icon_label", ""),
        "note": proto.get("note", ""),
        "is_lab_protocol": is_lab,
        "overrides_findings": list(proto.get("overrides_findings") or []),
        "variant_when": variant.get("when", "default"),
        "tier": tier_code,
        "mode": mode,
        "auto_scheduled": auto_scheduled,
        "anchor": anchor_kind,
        "anchor_date": anchor_date.isoformat(),
        "window_min_days": min_days,
        "window_max_days": max_days,
        "window_start": win_start.isoformat() if win_start else None,
        "window_end": win_end.isoformat() if win_end else None,
        "reminder_mode": rem_mode,
        "reminder_on": reminder_on.isoformat() if reminder_on else None,
        "timeframe_text": proto.get("timeframe_text", ""),
        "tests_text": ", ".join(t["name"] for t in tests) if tests else "Clinician-selected based on medicines & comorbidities",
        "considerations_text": proto.get("note") or proto.get("timeframe_text", ""),
        "ami_reminder_text": f"Day {rem_cfg['day_min']}" if rem_cfg.get("day_min") is not None else "Doctor-directed",
        "tests": tests,
    }


def evaluate_finding(proto: dict, report_date: date, followup: Followup, ctx: dict[str, Any], med_cat: dict[str, dict], params: list, trends: dict[str, str], catalogue_names: dict[str, str], detected_codes: list[str], explicit_state: dict[str, Any]) -> dict[str, Any]:
    fc = proto["finding_code"]
    cond = _condition_state(fc, ctx, med_cat, followup, params, trends, detected_codes, explicit_state)
    variant = _pick_variant(proto, cond)
    mode = variant.get("mode") or ("AUTO" if variant.get("window_min_days") is not None else "DOCTOR_DECIDES")
    if variant.get("risk_based"):
        mode = "RISK_BASED"
    elif variant.get("personalized"):
        mode = "PERSONALIZED"
    elif proto.get("requires_indication") and variant.get("when") == "default":
        mode = "REQUIRES_INDICATION"

    auto_scheduled = mode not in NON_AUTO_MODES and variant.get("window_min_days") is not None
    anchor_kind = variant.get("anchor", "REPORT_DATE")
    anchor_date = _resolve_anchor_date(anchor_kind, report_date, cond)
    min_days, max_days = variant.get("window_min_days"), variant.get("window_max_days")
    win_start = anchor_date + timedelta(days=int(min_days)) if (auto_scheduled and min_days is not None) else None
    win_end = anchor_date + timedelta(days=int(max_days if max_days is not None else min_days)) if (auto_scheduled and min_days is not None) else None
    rem_cfg = proto.get("reminder") or {}
    rem_mode = rem_cfg.get("mode", "FIXED")
    reminder_on = anchor_date + timedelta(days=int(rem_cfg["day_min"])) if (auto_scheduled and rem_mode in ("FIXED", "IF_APPROPRIATE") and rem_cfg.get("day_min") is not None) else None
    tests = [{"code": t["code"], "name": catalogue_names.get(t["code"], t["code"]), "optional": bool(t.get("optional"))} for t in (proto.get("tests") or []) if isinstance(t, dict) and t.get("code")]
    tier_code = variant.get("tier") or proto.get("tier") or ("URGENT" if fc == "HIGH_CREATININE" else "LONG_TERM")
    return {
        "finding_code": fc, "finding_name": proto.get("finding_name", fc), "variant_when": variant.get("when", "default"),
        "tier": tier_code, "mode": mode, "auto_scheduled": auto_scheduled, "anchor": anchor_kind, "anchor_date": anchor_date.isoformat(),
        "window_min_days": min_days, "window_max_days": max_days,
        "window_start": win_start.isoformat() if win_start else None, "window_end": win_end.isoformat() if win_end else None,
        "reminder_mode": rem_mode, "reminder_on": reminder_on.isoformat() if reminder_on else None,
        "timeframe_text": proto.get("timeframe_text", ""), "tests_text": proto.get("tests_text", ""),
        "considerations_text": proto.get("considerations_text", ""), "ami_reminder_text": proto.get("ami_reminder_text", ""), "tests": tests,
    }


def _sync_default_recommendation(db: Session, followup: Followup, test_codes: list[str]) -> None:
    if not test_codes:
        return
    clean_codes = sorted(set(test_codes))
    existing = db.scalar(select(RetestRecommendation).where(RetestRecommendation.followup_id == followup.id, RetestRecommendation.source == "PROTOCOL"))
    if existing:
        if not existing.ordered:
            existing.test_codes = clean_codes
    elif not db.scalar(select(RetestRecommendation.id).where(RetestRecommendation.followup_id == followup.id).limit(1)):
        db.add(RetestRecommendation(followup_id=followup.id, doctor_id=None, test_codes=clean_codes, source="PROTOCOL"))


def notify_urgent(db: Session, followup: Followup) -> None:
    if followup.protocol_tier != "URGENT" or followup.suppressed_reason:
        return
    plan = dict(followup.retest_plan or {})
    if plan.get("urgent_notified"):
        return
    recipients = set(assign.doctor_users(db, followup.assigned_doctor_id))
    recipients.update(u for (u,) in db.execute(select(User.id).where(User.role == "ADMIN", User.active)))
    if recipients:
        assign.notify(db, recipients, "Urgent retest needed (action within 24h)", f"/followups/view?id={followup.id}", urgent=True)
        plan["urgent_notified"] = True
        followup.retest_plan = plan
        db.flush()


def _resolve_protocol_tier(followup: Followup, params: list, rules: dict, schedules: list[dict], detected: list[str], fallback_interval: int | None) -> str:
    from . import followup as fu_svc
    if fu_svc.is_critical(params, rules.get("critical_values", [])):
        return "URGENT"
    manual_tier = (followup.retest_plan or {}).get("manual_tier")
    if manual_tier in TIER_ORDER:
        return manual_tier
    if "HIGH_CREATININE" in detected:
        return "URGENT"
    if schedules:
        return min((s.get("tier") or "LONG_TERM" for s in schedules), key=lambda t: TIER_ORDER.get(t, 99))
    if followup.priority == "ESCALATION":
        return "URGENT"
    if fallback_interval is not None:
        if fallback_interval <= 28:
            return "EARLY"
        if fallback_interval <= 56:
            return "TREATMENT_RESPONSE"
        if fallback_interval <= 84:
            return "METABOLIC"
    return "LONG_TERM"


def plan_retest(db: Session, followup: Followup, *, state: dict[str, Any] | None = None, fallback_interval_days: int | None = None, detected: list[str] | None = None, trends: dict[str, str] | None = None, force: bool = False, notify_urgent: bool = True) -> dict[str, Any]:
    """Select matching retest protocol(s), compute IST windows, reminders & urgency tier, and update Followup."""
    if followup.retest_status == "OVERRIDDEN" and not force:
        return followup.retest_plan or {}

    from . import followup as fu_svc
    state = state or {}
    rules = load_rules(db)
    report = db.get(Report, followup.report_id)
    order = db.get(Order, report.order_id) if report else None
    patient = db.get(Patient, followup.patient_id)
    params = list(db.scalars(select(ReportParameter).where(ReportParameter.report_id == followup.report_id))) if report else []
    ctx = prog_svc._build_context(db, patient, report) if patient else {"profile": {}, "active_meds": [], "labs": {}, "buckets": set()}
    if "profile" in state:
        ctx["profile"] = state["profile"]
    if detected is None:
        detected = findings.detect(db, followup.patient_id, followup.report_id, _ctx=ctx) if report else []
    followup.finding_codes = detected

    if trends is None and report:
        trends = fu_svc.param_trends(db, followup.patient_id, report, fu_svc.abnormal_params(params))
    trends = trends or {}

    collected = to_ist_date(
        (report.collected_on if report else None) or (order.collected_on if order else None)
        or (report.reported_on if report else None) or (order.reported_on if order else None)
    )
    today = today_ist()
    protos = {p["finding_code"]: p for p in (rules.get("retest_protocols") or RETEST_PROTOCOLS) if isinstance(p, dict) and p.get("finding_code")}
    cond_protos = cond_svc.condition_proto_map(rules)
    cat_names = {t["code"]: t["name"] for t in (rules.get("test_catalogue") or TEST_CATALOGUE) if isinstance(t, dict) and t.get("code")}
    med_cat = {m["code"]: m for m in rules.get("medicine_catalogue", []) if isinstance(m, dict) and m.get("code")}

    confirmed_conds = [c for c in (ctx.get("profile") or {}).get("conditions", []) if isinstance(c, dict) and c.get("status") == "CONFIRMED"]
    cond_schedules_all = []
    for c in confirmed_conds:
        cc = c.get("code")
        if cc not in cond_protos:
            continue
        if cc == "HYPOTHYROID_STABLE_TREATED" and str(c.get("stage") or "").upper() == "ABNORMAL_ON_TREATMENT":
            continue
        cond_schedules_all.append(
            evaluate_condition_protocol(cond_protos[cc], collected, followup, ctx, med_cat, params, cat_names, state, c_stage=c.get("stage", ""))
        )
    cond_lab_schedules = [s for s in cond_schedules_all if s["is_lab_protocol"]]
    non_lab_protocols = [s for s in cond_schedules_all if not s["is_lab_protocol"]]
    overridden_findings = {fc for s in cond_lab_schedules for fc in s.get("overrides_findings", [])}

    finding_schedules = [
        evaluate_finding(protos[fc], collected, followup, ctx, med_cat, params, trends, cat_names, detected, state)
        for fc in detected if fc in protos and fc not in overridden_findings
    ]
    schedules = cond_lab_schedules + finding_schedules
    if fallback_interval_days is None and not schedules:
        from .settings_store import get_setting
        buckets = fu_svc.assign_buckets(fu_svc.abnormal_params(params), rules.get("buckets", []))
        fallback_interval_days = fu_svc.interval_for(buckets, get_setting(db, "default_interval_days"))

    active_detected = [fc for fc in detected if fc not in overridden_findings]
    protocol_tier = _resolve_protocol_tier(followup, params, rules, schedules, active_detected, fallback_interval_days)
    tmeta = tier_meta(rules, protocol_tier)
    followup.protocol_tier = protocol_tier
    prev_manual = (followup.retest_plan or {}).get("manual_tier")
    prev_notified = bool((followup.retest_plan or {}).get("urgent_notified"))

    if not schedules:
        if non_lab_protocols:
            followup.retest_window_start, followup.retest_window_end, followup.reminder_on = None, None, None
            followup.due_on, followup.retest_status = today, "DOCTOR_TO_SET"
            plan = {
                "status": "DOCTOR_TO_SET", "label": "Doctor to set retest date", "source": "CONDITION",
                "primary_finding": non_lab_protocols[0], "findings": [], "non_lab_protocols": non_lab_protocols,
                "overridden_findings": sorted(overridden_findings), "default_tests": [],
                "protocol_tier": protocol_tier, "tier_meta": tmeta,
            }
        else:
            due = today if (fallback_interval_days or 0) <= 0 else collected + timedelta(days=fallback_interval_days or 90)
            followup.retest_window_start, followup.retest_window_end, followup.reminder_on = due, due, None
            followup.due_on, followup.retest_status = due, "FALLBACK"
            plan = {"status": "FALLBACK", "label": "Retest due", "source": "FALLBACK", "primary_finding": None, "findings": [],
                    "non_lab_protocols": [], "overridden_findings": [], "default_tests": [],
                    "protocol_tier": protocol_tier, "tier_meta": tmeta}
        if prev_manual:
            plan["manual_tier"] = prev_manual
        if prev_notified:
            plan["urgent_notified"] = True
        followup.retest_plan = plan
        db.flush()
        if notify_urgent and protocol_tier == "URGENT":
            globals()["notify_urgent"](db, followup)
        return plan

    auto_items = [s for s in schedules if s["auto_scheduled"] and s["window_start"]]
    aki_sched = next((s for s in schedules if s["finding_code"] == "HIGH_CREATININE"), None)
    primary_top = aki_sched or schedules[0]
    if aki_sched or not auto_items:
        followup.retest_window_start = None
        followup.retest_window_end = None
        followup.reminder_on = None
        followup.due_on = today
        followup.retest_status = "DOCTOR_TO_SET"
        default_codes = sorted({t["code"] for t in primary_top["tests"] if not t["optional"] and t["code"] in cat_names})
        _sync_default_recommendation(db, followup, default_codes)
        plan = {
            "status": "DOCTOR_TO_SET", "label": "Doctor to set retest date",
            "source": primary_top.get("source", "FINDING"),
            "primary_finding": primary_top, "findings": schedules, "non_lab_protocols": non_lab_protocols,
            "overridden_findings": sorted(overridden_findings), "default_tests": default_codes,
            "protocol_tier": protocol_tier, "tier_meta": tmeta,
        }
    else:
        chosen = min(auto_items, key=lambda s: s["window_start"])
        win_start, win_end = date.fromisoformat(chosen["window_start"]), date.fromisoformat(chosen["window_end"])
        rem_on = date.fromisoformat(chosen["reminder_on"]) if chosen["reminder_on"] else None
        followup.retest_window_start, followup.retest_window_end, followup.reminder_on = win_start, win_end, rem_on
        followup.due_on, followup.retest_status = win_start, "AUTO_SCHEDULED"
        default_codes = sorted({t["code"] for s in auto_items for t in s["tests"] if not t["optional"] and t["code"] in cat_names}) or sorted({t["code"] for t in chosen["tests"] if not t["optional"] and t["code"] in cat_names})
        _sync_default_recommendation(db, followup, default_codes)
        plan = {
            "status": "AUTO_SCHEDULED", "label": "Retest due",
            "source": chosen.get("source", "FINDING"),
            "primary_finding": chosen, "findings": schedules, "non_lab_protocols": non_lab_protocols,
            "overridden_findings": sorted(overridden_findings), "default_tests": default_codes,
            "protocol_tier": protocol_tier, "tier_meta": tmeta,
        }

    if prev_manual:
        plan["manual_tier"] = prev_manual
    if prev_notified:
        plan["urgent_notified"] = True
    followup.retest_plan = plan
    db.flush()
    if notify_urgent and protocol_tier == "URGENT":
        globals()["notify_urgent"](db, followup)
    return plan


def override_retest(db: Session, followup: Followup, *, window_start: date, window_end: date | None, reason_code: str, notes: str = "", user_id: int | None = None) -> dict[str, Any]:
    win_end = window_end or window_start
    rules = load_rules(db)
    report = db.get(Report, followup.report_id) if followup.report_id else None
    anchor = followup.treatment_anchor_on or (to_ist_date(report.collected_on) if report and report.collected_on else today_ist())
    in_win, _, _ = date_in_tier_window(rules, followup.protocol_tier, window_start, anchor)
    plan = dict(followup.retest_plan or {})
    if plan.get("primary_finding"):
        pf = dict(plan["primary_finding"])
        pf["window_start"], pf["window_end"] = window_start.isoformat(), win_end.isoformat()
        plan["primary_finding"] = pf
    plan["status"] = "OVERRIDDEN"
    plan["label"] = "Retest due"
    plan["protocol_tier"] = followup.protocol_tier
    plan["tier_meta"] = tier_meta(rules, followup.protocol_tier)
    plan["override"] = {
        "reason_code": reason_code, "notes": notes.strip()[:300], "by_user_id": user_id,
        "at": datetime.now(timezone.utc).isoformat(), "outside_tier_window": not in_win,
    }
    followup.retest_window_start = window_start
    followup.retest_window_end = win_end
    followup.due_on = window_start
    followup.next_followup_on = window_start
    followup.retest_status = "OVERRIDDEN"
    followup.retest_plan = plan
    db.flush()
    return plan


def reminder_tick(db: Session, now: datetime | None = None) -> int:
    """Surfaces caller-safe in-app reminders on/after Followup.reminder_on (IST). Idempotent."""
    ts = now or datetime.now(timezone.utc)
    today = ts.astimezone(IST).date()
    due = list(db.scalars(
        select(Followup).where(
            Followup.suppressed_reason == "", Followup.stage.notin_(DONE_STAGES),
            Followup.retest_status.in_(("AUTO_SCHEDULED", "OVERRIDDEN", "DOCTOR_SET")),
            Followup.reminder_on.is_not(None), Followup.reminder_on <= today, Followup.reminder_sent_at.is_(None),
        )
    ))
    due_bp = list(db.scalars(
        select(MonitoringSchedule).where(
            MonitoringSchedule.status == "ACTIVE",
            MonitoringSchedule.start_on <= today,
            MonitoringSchedule.end_on >= today,
            (MonitoringSchedule.last_reminded_on.is_(None)) | (MonitoringSchedule.last_reminded_on < today),
        )
    ))
    if not due and not due_bp:
        return 0
    caller_ids = [u for (u,) in db.execute(select(User.id).where(User.role == "CALLER", User.active))]
    if not caller_ids:
        caller_ids = [u for (u,) in db.execute(select(User.id).where(User.role == "ADMIN", User.active))]
    sent = 0
    for fu in due:
        fu.reminder_sent_at = ts
        if caller_ids:
            assign.notify(db, caller_ids, "Retest reminder due", f"/caller-card/view?id={fu.id}")
        sent += 1
    doc_ids = assign.doctor_users(db)
    for ms in due_bp:
        ms.last_reminded_on = today
        if caller_ids:
            assign.notify(db, caller_ids, "Home check-in reminder due", "/followups")
        if doc_ids:
            assign.notify(db, doc_ids, "Home BP reading reminder due", f"/patients/view?id={ms.patient_id}")
        sent += 1
    db.commit()
    return sent


def sla_tick(db: Session, now: datetime | None = None) -> int:
    """Escalates unacted URGENT follow-ups to admins after tier sla_hours (default 24h)."""
    ts = now or datetime.now(timezone.utc)
    rules = load_rules(db)
    sla_hours = int(tier_meta(rules, "URGENT").get("sla_hours") or 24)
    cutoff = ts - timedelta(hours=sla_hours)
    overdue = list(db.scalars(
        select(Followup).where(
            Followup.suppressed_reason == "", Followup.stage.notin_(DONE_STAGES),
            Followup.protocol_tier == "URGENT", Followup.sla_escalated_at.is_(None),
            Followup.accepted_at.is_(None), Followup.attempts == 0, Followup.created_at <= cutoff,
        )
    ))
    if not overdue:
        return 0
    admin_ids = [u for (u,) in db.execute(select(User.id).where(User.role == "ADMIN", User.active))]
    escalated = 0
    for fu in overdue:
        fu.sla_escalated_at = ts
        if admin_ids:
            assign.notify(db, admin_ids, f"SLA overdue: urgent follow-up unattended (>{sla_hours}h)", f"/followups/view?id={fu.id}", urgent=True)
        audit(db, None, None, "sla_escalate", "followup", fu.id)
        escalated += 1
    db.commit()
    return escalated
