"""Condition register, deterministic suggestions, stage management, and hypertension monitoring (Page 11)."""
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import assign, followup as fu_svc, programs as prog_svc, relationship as rel, status as ord_status
from .analysis import load_rules
from .models import (ClinicalTask, Followup, MonitoringSchedule, Order, Patient, PatientMedication, Report,
                     ReportParameter, RetestRecommendation)
from .security import audit
from .seed_data import CLINICAL_TARGETS, CONDITION_PROTOCOLS, TEST_CATALOGUE
from .seed_programs import PROFILE_CODES
from .timeutil import to_ist_date, today_ist

CONDITION_FAMILIES: dict[str, tuple[str, ...]] = {
    "PREDIABETES": ("PREDIABETES", "DIABETES_STABLE", "DIABETES_UNCONTROLLED"),
    "DIABETES_STABLE": ("PREDIABETES", "DIABETES_STABLE", "DIABETES_UNCONTROLLED"),
    "DIABETES_UNCONTROLLED": ("PREDIABETES", "DIABETES_STABLE", "DIABETES_UNCONTROLLED"),
    "DYSLIPIDEMIA_NEW_MED": ("DYSLIPIDEMIA_NEW_MED", "DYSLIPIDEMIA_STABLE"),
    "DYSLIPIDEMIA_STABLE": ("DYSLIPIDEMIA_NEW_MED", "DYSLIPIDEMIA_STABLE"),
}

STAGE_OPTIONS: dict[str, list[dict[str, str]]] = {
    "PREDIABETES": [
        {"value": "STANDARD", "label": "Standard (annual)"},
        {"value": "HIGHER_RISK", "label": "Higher risk (earlier)"},
    ],
    "DIABETES_STABLE": [{"value": "AT_GOAL", "label": "Stable at goal"}],
    "DIABETES_UNCONTROLLED": [{"value": "UNCONTROLLED", "label": "Uncontrolled"}],
    "HYPOTHYROID_STABLE_TREATED": [
        {"value": "STABLE", "label": "Stable on treatment"},
        {"value": "ABNORMAL_ON_TREATMENT", "label": "Needs adjustment (TSH abnormal)"},
    ],
    "B12_DEFICIENCY": [
        {"value": "ACTIVE", "label": "Active / On replacement"},
        {"value": "INDICATED", "label": "CBC response indicated"},
    ],
    "IRON_DEFICIENCY": [
        {"value": "ON_TREATMENT", "label": "On iron therapy (Hb/CBC 2–4w)"},
        {"value": "IRON_STORES_FOLLOWUP", "label": "Iron stores follow-up"},
    ],
    "HYPERTENSION": [
        {"value": "MONITORING", "label": "Home BP monitoring"},
        {"value": "ON_TREATMENT", "label": "On treatment"},
    ],
    "CKD": [
        {"value": "STANDARD", "label": "Standard risk (annual)"},
        {"value": "HIGHER_RISK", "label": "Higher risk (more frequent)"},
    ],
    "DYSLIPIDEMIA_NEW_MED": [{"value": "NEW_MED", "label": "Medication initiated (4–12w)"}],
    "DYSLIPIDEMIA_STABLE": [
        {"value": "STABLE", "label": "Stable (when indicated)"},
        {"value": "INDICATED", "label": "Monitoring indicated"},
    ],
}

DIABETES_DRUG_CLASSES = {"BIGUANIDE", "SULFONYLUREA", "INSULIN"}
LIPID_DRUG_CLASSES = {"STATIN", "FIBRATE", "EZETIMIBE", "LIPID_LOWERING"}
LIPID_KEYWORDS = ("statin", "atorvastatin", "rosuvastatin", "simvastatin", "pravastatin", "ezetimibe", "fenofibrate")
THYROID_KEYWORDS = ("levothyroxine", "thyroxine", "eltroxin", "thyronorm")


def condition_proto_map(rules: dict | None = None) -> dict[str, dict]:
    raw = (rules or {}).get("retest_protocols") or []
    out = {p["condition_code"]: p for p in CONDITION_PROTOCOLS}
    for p in raw:
        if isinstance(p, dict) and p.get("condition_code"):
            out[p["condition_code"]] = p
    return out


def valid_condition_codes(rules: dict | None = None) -> set[str]:
    codes = set((rules or {}).get("profile_codes", {}).get("conditions") or PROFILE_CODES["conditions"])
    codes.update(condition_proto_map(rules).keys())
    return codes


def hba1c_target(rules: dict | None, profile: dict | None) -> tuple[str, float]:
    p_tgt = ((profile or {}).get("targets") or {}).get("HBA1C")
    if isinstance(p_tgt, dict) and p_tgt.get("target_value") is not None:
        return str(p_tgt.get("target_op") or "<"), float(p_tgt["target_value"])
    r_tgt = ((rules or {}).get("clinical_targets") or CLINICAL_TARGETS).get("HBA1C") or {}
    return str(r_tgt.get("target_op") or "<"), float(r_tgt.get("target_value") or 7.0)


def is_at_target(val: float, op: str, target: float) -> bool:
    return prog_svc._cmp(val, op, target)


def _parse_iso(val: Any) -> date | None:
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


def _active_med_matches(active_meds: list, med_cat: dict[str, dict], classes: set[str], keywords: tuple[str, ...]) -> list:
    out = []
    for m in active_meds or []:
        if getattr(m, "stopped_on", None) is not None:
            continue
        code = getattr(m, "medicine_code", "")
        meta = med_cat.get(code, {})
        dclass = meta.get("drug_class", "")
        hay = f"{code} {meta.get('generic_name', '')} {dclass}".lower()
        if (dclass and dclass in classes) or any(kw in hay for kw in keywords):
            out.append(m)
    return out


def _ready_reports_series(db: Session, pids: list[int]) -> list[tuple[Report, dict[str, list[ReportParameter]], date]]:
    reps = list(db.scalars(
        select(Report).join(Order, Order.id == Report.order_id)
        .where(Order.patient_id.in_(pids), Order.status == ord_status.READY)
        .order_by(Report.collected_on.asc(), Report.id.asc())
    ))
    if not reps:
        return []
    rids = [r.id for r in reps]
    by_rep: dict[int, dict[str, list[ReportParameter]]] = {rid: {} for rid in rids}
    for p in db.scalars(select(ReportParameter).where(ReportParameter.report_id.in_(rids))):
        if p.param_code:
            by_rep[p.report_id].setdefault(p.param_code, []).append(p)
    out = []
    for r in reps:
        d = to_ist_date(r.collected_on or r.reported_on)
        out.append((r, by_rep[r.id], d))
    return out


def suggest_conditions(db: Session, patient_id: int, *, today: date | None = None) -> list[dict[str, Any]]:
    """Evaluate all Page 11 starter condition rules deterministically. Suggests only; never confirms."""
    root, pids = rel.patient_family_ids(db, patient_id)
    patient = db.get(Patient, root)
    if not patient:
        return []
    rules = load_rules(db)
    profile, _, _ = prog_svc.get_profile(db, root)
    med_cat = {m["code"]: m for m in rules.get("medicine_catalogue", [])}
    active_meds = list(db.scalars(
        select(PatientMedication).where(PatientMedication.patient_id.in_(pids), PatientMedication.stopped_on.is_(None))
    ))
    series = _ready_reports_series(db, pids)
    latest_labs = series[-1][1] if series else {}
    now_d = today or today_ist()
    confirmed = {c["code"]: c for c in profile.get("conditions", []) if c.get("status") == "CONFIRMED"}
    c_protos = condition_proto_map(rules)

    suggestions: list[dict[str, Any]] = []

    def add_sug(code: str, stage: str, reasons: list[str], replaces: str | None = None) -> None:
        if code in confirmed and not replaces:
            cur_stage = confirmed[code].get("stage", "")
            # Only re-suggest same code if stage materially changed (e.g. hypothyroid stable vs abnormal)
            if not (code == "HYPOTHYROID_STABLE_TREATED" and cur_stage and cur_stage != stage):
                return
        meta = c_protos.get(code, {})
        suggestions.append({
            "code": code,
            "condition_name": meta.get("condition_name", code),
            "icon": meta.get("icon", ""),
            "status": "SUSPECTED",
            "stage": stage,
            "reason_codes": reasons,
            "replaces_code": replaces,
        })

    # 1 & 2. Glycemic rules: Prediabetes vs Diabetes (Stable at target vs Uncontrolled on 2 consecutive above target)
    a1c_vals = [
        (d, p.value_num)
        for _, labs, d in series
        for p in prog_svc._matching_labs(labs, "HBA1C")
        if p.value_num is not None
    ]
    diab_meds = _active_med_matches(active_meds, med_cat, DIABETES_DRUG_CLASSES, ("metformin", "glimepiride", "insulin"))
    confirmed_diab = next((c for c in ("DIABETES_STABLE", "DIABETES_UNCONTROLLED", "DIABETES") if c in confirmed), None)
    known_diabetic = bool(confirmed_diab or diab_meds or any(v >= 6.5 for _, v in a1c_vals))
    tgt_op, tgt_val = hba1c_target(rules, profile)

    if known_diabetic:
        replaces_pre = "PREDIABETES" if "PREDIABETES" in confirmed else None
        if a1c_vals:
            latest_v = a1c_vals[-1][1]
            at_goal = is_at_target(latest_v, tgt_op, tgt_val)
            two_above = len(a1c_vals) >= 2 and (not is_at_target(a1c_vals[-1][1], tgt_op, tgt_val)) and (not is_at_target(a1c_vals[-2][1], tgt_op, tgt_val))
            if at_goal:
                rep_code = "DIABETES_UNCONTROLLED" if "DIABETES_UNCONTROLLED" in confirmed else replaces_pre
                add_sug("DIABETES_STABLE", "AT_GOAL", ["hba1c_at_target"], replaces=rep_code)
            elif two_above:
                rep_code = "DIABETES_STABLE" if "DIABETES_STABLE" in confirmed else replaces_pre
                add_sug("DIABETES_UNCONTROLLED", "UNCONTROLLED", ["hba1c_above_target_2_consecutive"], replaces=rep_code)
            elif len(a1c_vals) == 1 and "DIABETES_STABLE" not in confirmed:
                add_sug("DIABETES_UNCONTROLLED", "UNCONTROLLED", ["hba1c_above_target"], replaces=replaces_pre)
        else:
            if not confirmed_diab:
                add_sug("DIABETES_STABLE", "AT_GOAL", ["known_diabetic_on_therapy"])
    elif a1c_vals:
        latest_v = a1c_vals[-1][1]
        if 5.7 <= latest_v < 6.5:
            add_sug("PREDIABETES", "STANDARD", ["hba1c_prediabetes_range"])

    # 3. Hypothyroid on levothyroxine
    thyroid_meds = _active_med_matches(active_meds, med_cat, {"THYROID_HORMONE"}, THYROID_KEYWORDS)
    tsh_labs = prog_svc._matching_labs(latest_labs, "TSH")
    if thyroid_meds and tsh_labs:
        if any(p.system_flag in ("LOW", "HIGH") for p in tsh_labs):
            add_sug("HYPOTHYROID_STABLE_TREATED", "ABNORMAL_ON_TREATMENT", ["tsh_abnormal_on_levothyroxine"],
                    replaces="HYPOTHYROID_STABLE_TREATED" if confirmed.get("HYPOTHYROID_STABLE_TREATED", {}).get("stage") == "STABLE" else None)
        elif any(p.system_flag == "NORMAL" for p in tsh_labs):
            add_sug("HYPOTHYROID_STABLE_TREATED", "STABLE", ["tsh_in_range_on_levothyroxine"],
                    replaces="HYPOTHYROID_STABLE_TREATED" if confirmed.get("HYPOTHYROID_STABLE_TREATED", {}).get("stage") == "ABNORMAL_ON_TREATMENT" else None)

    # 4. CKD: eGFR < 60 or UACR high on 2 results >= 90 days apart
    ckd_dates = []
    for _, labs, d in series:
        egfr_low = any(p.value_num is not None and p.value_num < 60 for p in prog_svc._matching_labs(labs, "EGFR"))
        uacr_high = any(p.system_flag == "HIGH" for p in prog_svc._matching_labs(labs, "UACR"))
        if egfr_low or uacr_high:
            ckd_dates.append(d)
    if len(ckd_dates) >= 2 and (ckd_dates[-1] - ckd_dates[0]).days >= 90:
        add_sug("CKD", "STANDARD", ["ckd_persistent_90d"])

    # 5. Dyslipidemia: lipid medicine started within last 12 weeks (<= 84 days) -> NEW_MED, else STABLE
    lipid_meds = _active_med_matches(active_meds, med_cat, LIPID_DRUG_CLASSES, LIPID_KEYWORDS)
    if lipid_meds:
        start_dates = [_parse_iso(getattr(m, "started_on", None)) for m in lipid_meds]
        start_dates = [d for d in start_dates if d is not None]
        is_new = any(0 <= (now_d - sd).days <= 84 for sd in start_dates)
        if is_new:
            rep = "DYSLIPIDEMIA_STABLE" if "DYSLIPIDEMIA_STABLE" in confirmed else None
            add_sug("DYSLIPIDEMIA_NEW_MED", "NEW_MED", ["lipid_med_within_12_weeks"], replaces=rep)
        elif start_dates or "DYSLIPIDEMIA_NEW_MED" in confirmed:
            rep = "DYSLIPIDEMIA_NEW_MED" if "DYSLIPIDEMIA_NEW_MED" in confirmed else None
            add_sug("DYSLIPIDEMIA_STABLE", "STABLE", ["lipid_med_maintenance"], replaces=rep)

    # 6. Low B12 -> B12_DEFICIENCY
    if any(p.system_flag == "LOW" for p in prog_svc._matching_labs(latest_labs, "B12")):
        add_sug("B12_DEFICIENCY", "ACTIVE", ["b12_low"])

    # 7. Low ferritin or (low iron with low Hb) -> IRON_DEFICIENCY
    ferr_low = any(p.system_flag == "LOW" for p in prog_svc._matching_labs(latest_labs, "FERRITIN"))
    iron_low = any(p.system_flag == "LOW" for p in prog_svc._matching_labs(latest_labs, "IRON"))
    hb_low = any(p.system_flag == "LOW" for p in prog_svc._matching_labs(latest_labs, "HB"))
    if ferr_low or (iron_low and hb_low):
        add_sug("IRON_DEFICIENCY", "ON_TREATMENT", ["iron_stores_or_iron_with_hb_low"])

    # 8. BP from health profile >= 140/90 -> HYPERTENSION
    bp_high, _ = prog_svc.bp_is_high(profile)
    if bp_high:
        add_sug("HYPERTENSION", "MONITORING", ["bp_elevated"])

    return suggestions


def _ensure_hypertension_actions(db: Session, patient_id: int, doctor_id: int, today: date) -> None:
    """Create starter home BP schedule (2x/day for 7 days) and doctor lab-selection task."""
    active_sched = db.scalar(select(MonitoringSchedule).where(
        MonitoringSchedule.patient_id == patient_id,
        MonitoringSchedule.condition_code == "HYPERTENSION",
        MonitoringSchedule.status == "ACTIVE",
    ))
    if not active_sched:
        db.add(MonitoringSchedule(
            patient_id=patient_id,
            condition_code="HYPERTENSION",
            kind="BP",
            frequency_per_day=2,
            duration_days=7,
            start_on=today,
            end_on=today + timedelta(days=6),
            slots=["MORNING", "EVENING"],
            status="ACTIVE",
            note="starter value, clinician to confirm",
            created_by=doctor_id,
        ))

    open_task = db.scalar(select(ClinicalTask).where(
        ClinicalTask.patient_id == patient_id,
        ClinicalTask.condition_code == "HYPERTENSION",
        ClinicalTask.task_type == "CHOOSE_LAB_TESTS",
        ClinicalTask.status == "OPEN",
    ))
    if not open_task:
        fu = db.scalar(
            select(Followup).where(
                Followup.patient_id == patient_id, Followup.suppressed_reason == "", Followup.stage.notin_(fu_svc.DONE_STAGES)
            ).order_by(Followup.id.desc()).limit(1)
        )
        db.add(ClinicalTask(
            patient_id=patient_id,
            followup_id=fu.id if fu else None,
            condition_code="HYPERTENSION",
            task_type="CHOOSE_LAB_TESTS",
            title="Choose lab tests for hypertension",
            details="Select laboratory tests based on current medicines and comorbidities.",
            selected_tests=[],
            status="OPEN",
            assigned_doctor_id=fu.assigned_doctor_id if fu else None,
        ))
        recips = assign.doctor_users(db, fu.assigned_doctor_id if fu else None)
        if recips:
            assign.notify(db, recips, "Choose lab tests for confirmed condition", f"/patients/view?id={patient_id}")


def _reeval_patient_plans(db: Session, patient_id: int) -> None:
    from . import findings, retest as retest_svc
    fu_svc.sync_profile_buckets(db, patient_id, commit=False)
    rel.sync_touchpoints(db, patient_id, commit=False)
    prog_svc.evaluate(db, patient_id, commit=False)
    findings.sync_combinations(db, patient_id, commit=False)
    for fu in db.scalars(select(Followup).where(
        Followup.patient_id == patient_id, Followup.suppressed_reason == "", Followup.stage.notin_(fu_svc.DONE_STAGES)
    )):
        if fu.retest_status != "OVERRIDDEN":
            retest_svc.plan_retest(db, fu, notify_urgent=False)


def confirm_condition(db: Session, patient_id: int, code: str, *, doctor_id: int, stage: str = "",
                      since: str = "", request=None) -> dict:
    root = rel.canonical_patient_id(db, patient_id)
    rules = load_rules(db)
    c_code = code.strip().upper()
    if c_code not in valid_condition_codes(rules):
        raise ValueError(f"Unknown condition code: {c_code}")

    profile, _, _ = prog_svc.get_profile(db, root)
    existing = list(profile.get("conditions", []))
    family = set(CONDITION_FAMILIES.get(c_code, (c_code,)))
    replaced = [c["code"] for c in existing if c.get("code") in family and c.get("code") != c_code]
    kept = [c for c in existing if c.get("code") not in family]

    today = today_ist()
    default_stage = (STAGE_OPTIONS.get(c_code) or [{"value": "CONFIRMED"}])[0]["value"]
    final_stage = (stage or "").strip()[:30] or default_stage
    entry = {
        "code": c_code,
        "status": "CONFIRMED",
        "stage": final_stage,
        "since": (since or "").strip()[:20] or today.isoformat(),
        "confirmed_by": doctor_id,
    }
    kept.append(entry)
    profile["conditions"] = kept
    prog_svc.save_profile(db, root, profile, doctor_id)

    if c_code == "HYPERTENSION":
        _ensure_hypertension_actions(db, root, doctor_id, today)

    _reeval_patient_plans(db, root)
    db.commit()

    if replaced:
        audit(db, request, doctor_id, "condition_stage_change", "patient_condition", f"{root}:{replaced[0]}->{c_code}"[:60])
    else:
        audit(db, request, doctor_id, "condition_confirm", "patient_condition", f"{root}:{c_code}"[:60])
    return entry


def remove_condition(db: Session, patient_id: int, code: str, *, doctor_id: int, request=None) -> bool:
    root = rel.canonical_patient_id(db, patient_id)
    c_code = code.strip().upper()
    profile, _, _ = prog_svc.get_profile(db, root)
    existing = list(profile.get("conditions", []))
    kept = [c for c in existing if c.get("code") != c_code]
    if len(kept) == len(existing):
        return False
    profile["conditions"] = kept
    prog_svc.save_profile(db, root, profile, doctor_id)

    if c_code == "HYPERTENSION":
        for s in db.scalars(select(MonitoringSchedule).where(
            MonitoringSchedule.patient_id == root, MonitoringSchedule.condition_code == "HYPERTENSION", MonitoringSchedule.status == "ACTIVE"
        )):
            s.status = "CANCELLED"
        for t in db.scalars(select(ClinicalTask).where(
            ClinicalTask.patient_id == root, ClinicalTask.condition_code == "HYPERTENSION", ClinicalTask.status == "OPEN"
        )):
            t.status = "DISMISSED"

    _reeval_patient_plans(db, root)
    db.commit()
    audit(db, request, doctor_id, "condition_remove", "patient_condition", f"{root}:{c_code}"[:60])
    return True


def complete_clinical_task(db: Session, task_id: int, test_codes: list[str], *, doctor_id: int, request=None) -> ClinicalTask:
    task = db.get(ClinicalTask, task_id)
    if not task:
        raise LookupError("No such clinical task")
    rules = load_rules(db)
    cat = {t["code"] for t in (rules.get("test_catalogue") or TEST_CATALOGUE) if isinstance(t, dict) and t.get("code")}
    clean_tests = sorted({str(tc).strip().upper() for tc in test_codes if str(tc).strip()})
    unknown = [tc for tc in clean_tests if tc not in cat]
    if unknown:
        raise ValueError(f"Unknown test code(s): {', '.join(unknown)}")
    if not clean_tests:
        raise ValueError("Select at least one test")

    task.selected_tests = clean_tests
    task.status = "DONE"
    task.completed_by = doctor_id
    task.completed_at = datetime.now(timezone.utc)
    if task.followup_id:
        existing_rec = db.scalar(select(RetestRecommendation).where(
            RetestRecommendation.followup_id == task.followup_id, RetestRecommendation.source == "DOCTOR"
        ))
        if existing_rec:
            existing_rec.test_codes = sorted(set(existing_rec.test_codes or []) | set(clean_tests))
        else:
            db.add(RetestRecommendation(followup_id=task.followup_id, doctor_id=doctor_id, test_codes=clean_tests, source="DOCTOR"))
    db.commit()
    audit(db, request, doctor_id, "clinical_task_complete", "clinical_task", f"{task.id}:{len(clean_tests)}")
    return task


def conditions_summary(db: Session, patient_id: int) -> dict[str, Any]:
    from . import retest as retest_svc

    root = rel.canonical_patient_id(db, patient_id)
    rules = load_rules(db)
    profile, _, _ = prog_svc.get_profile(db, root)
    c_protos = condition_proto_map(rules)
    open_fu = db.scalar(
        select(Followup).where(
            Followup.patient_id == root, Followup.suppressed_reason == "", Followup.stage.notin_(fu_svc.DONE_STAGES)
        ).order_by(Followup.id.desc()).limit(1)
    )
    plan = (open_fu.retest_plan or {}) if open_fu else {}
    sched_by_cond = {
        s.get("condition_code"): s
        for s in (plan.get("findings") or []) + (plan.get("non_lab_protocols") or [])
        if isinstance(s, dict) and s.get("condition_code")
    }

    confirmed_out = []
    for c in profile.get("conditions", []):
        if c.get("status") != "CONFIRMED":
            continue
        code = c["code"]
        meta = c_protos.get(code, {})
        active_sched = sched_by_cond.get(code)
        if not active_sched and code in c_protos:
            active_meds = list(db.scalars(
                select(PatientMedication).where(PatientMedication.patient_id == root, PatientMedication.stopped_on.is_(None))
            ))
            med_cat = {m["code"]: m for m in rules.get("medicine_catalogue", [])}
            cat_names = {t["code"]: t["name"] for t in (rules.get("test_catalogue") or TEST_CATALOGUE) if isinstance(t, dict) and t.get("code")}
            active_sched = retest_svc.evaluate_condition_protocol(
                c_protos[code], today_ist(), open_fu, {"profile": profile, "active_meds": active_meds}, med_cat, [], cat_names, c_stage=c.get("stage", "")
            )
        next_date = (active_sched or {}).get("window_start") or (open_fu.next_followup_on.isoformat() if open_fu and open_fu.next_followup_on else None)
        confirmed_out.append({
            "code": code,
            "condition_name": meta.get("condition_name", code),
            "status": c.get("status", "CONFIRMED"),
            "stage": c.get("stage", ""),
            "since": c.get("since", ""),
            "confirmed_by": c.get("confirmed_by"),
            "icon": meta.get("icon", ""),
            "icon_label": meta.get("icon_label", ""),
            "timeframe_text": meta.get("timeframe_text", ""),
            "note": meta.get("note", ""),
            "tier": (active_sched or {}).get("tier") or meta.get("tier", "LONG_TERM"),
            "active_protocol": active_sched,
            "next_test_date": next_date,
            "stage_options": STAGE_OPTIONS.get(code, []),
        })

    schedules = list(db.scalars(
        select(MonitoringSchedule).where(MonitoringSchedule.patient_id == root).order_by(MonitoringSchedule.id.desc())
    ))
    tasks = list(db.scalars(
        select(ClinicalTask).where(ClinicalTask.patient_id == root).order_by(ClinicalTask.id.desc())
    ))
    tgt_op, tgt_val = hba1c_target(rules, profile)

    catalogue = [
        {
            "code": p["condition_code"],
            "condition_name": p.get("condition_name", p["condition_code"]),
            "icon": p.get("icon", ""),
            "timeframe_text": p.get("timeframe_text", ""),
            "stage_options": STAGE_OPTIONS.get(p["condition_code"], []),
        }
        for p in CONDITION_PROTOCOLS
        if p["condition_code"] in c_protos
    ]
    return {
        "patient_id": root,
        "confirmed": confirmed_out,
        "suggested": suggest_conditions(db, root),
        "monitoring_schedules": [
            {
                "id": s.id, "condition_code": s.condition_code, "kind": s.kind,
                "frequency_per_day": s.frequency_per_day, "duration_days": s.duration_days,
                "start_on": s.start_on, "end_on": s.end_on, "slots": s.slots,
                "status": s.status, "note": s.note,
            }
            for s in schedules
        ],
        "clinical_tasks": [
            {
                "id": t.id, "condition_code": t.condition_code, "task_type": t.task_type,
                "title": t.title, "details": t.details, "selected_tests": t.selected_tests,
                "status": t.status, "followup_id": t.followup_id,
            }
            for t in tasks
        ],
        "hba1c_target": {"target_op": tgt_op, "target_value": tgt_val, "unit": "%"},
        "catalogue": catalogue,
    }
