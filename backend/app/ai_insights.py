"""AI Report Insights generation, grounded validation, and doctor approval workflow.
Architecture rules:
1. Deterministic first, AI second.
2. The AI can NEVER set URGENT. URGENT comes only from doctor-approved critical rules.
   Final priority = max(rule-based priority, AI suggestion capped at PRIORITY).
3. De-identified input only (no name, mobile, address, or lab reference).
4. Grounded output: results referred to ONLY by `ref` (report_parameters.id).
   Validator rejects invented numbers, unknown test codes, or forbidden words in caller scripts.
   Falls back to TemplateProvider on validation rejection.
5. No diagnosis, no prescription.
6. Works with no AI key (LLM_PROVIDER=template produces complete, valid insight).
7. Every run is auditable."""
import copy
from datetime import datetime, timezone
import hashlib
import json
import re
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .analysis import load_rules, severity_for
from .biomarkers import marker_category, marker_code, marker_info, marker_label
from .classify import Demographics, classify
from .config import env
from .llm import LLMError, TemplateProvider, get_llm
from .models import (
    CriticalRule,
    Followup,
    Order,
    Patient,
    Report,
    ReportInsight,
    ReportParameter,
    User,
)
from .security import audit
from .units import same_unit

# Standard panel groupings for finding related concordant defects
PANEL_GROUPS: dict[str, list[str]] = {
    "ANEMIA": ["HB", "MCV", "MCH", "MCHC", "RBC", "PCV", "RDW_CV", "RDW_SD", "IRON", "FERRITIN"],
    "LIVER": ["ALT", "AST", "ALP", "GGT", "BILI_T", "BILI_D", "BILI_I", "ALB", "PROT"],
    "KIDNEY": ["CREAT", "UREA", "BUN", "EGFR", "URIC"],
    "LIPID": ["CHOL", "TG", "HDL", "LDL", "VLDL", "NON_HDL", "CHOL_TC_HDL", "CHOL_LDL_HDL", "TG_HDL"],
    "THYROID": ["TSH", "FT3", "FT4", "T3", "T4"],
    "GLUCOSE": ["HBA1C", "GLU_F", "GLU_PP", "GLU_R", "EAG"],
    "VITAMIN": ["VITD", "B12", "FOLATE"],
    "ELECTROLYTE": ["SODIUM", "POTASSIUM", "CHLORIDE", "CALCIUM"],
    "INFLAMMATION": ["CRP", "HSCRP", "ESR"],
}


# --- Pydantic Schemas for Insight JSON (Schema 1.0) ---

class DefectItem(BaseModel):
    ref: str
    marker: str
    status: str
    severity: str = ""
    what_it_measures: str = ""
    explanation: str
    related_refs: list[str] = Field(default_factory=list)
    priority: str = "MEDIUM"  # HIGH | MEDIUM | LOW


class Suggestions(BaseModel):
    doctor_discussion: list[str] = Field(default_factory=list)
    caller_questions: list[str] = Field(default_factory=list)
    clarifications_for_doctor: list[str] = Field(default_factory=list)


class DoctorConnect(BaseModel):
    priority: str = "ROUTINE"  # URGENT | PRIORITY | ROUTINE
    source: str = "rule"  # rule | ai
    reason: str
    connect_within_hours: int = 72


class FutureSuggestions(BaseModel):
    monitoring_tests: list[str] = Field(default_factory=list)
    suggested_window_days: int | None = None
    trend_notes: list[str] = Field(default_factory=list)
    watch_markers: list[str] = Field(default_factory=list)


class ReportInsightSchema(BaseModel):
    schema_version: str = "1.0"
    overview: str
    defects: list[DefectItem] = Field(default_factory=list)
    suggestions: Suggestions
    doctor_connect: DoctorConnect
    future: FutureSuggestions
    red_flag_protocol: str
    limitations: str
    needs_doctor_review: bool = True


# --- Building De-Identified Input ---

def check_critical_hits(params: list[ReportParameter], db: Session) -> list[dict]:
    """Check parameters against doctor-approved active critical rules."""
    active_rules = db.scalars(select(CriticalRule).where(CriticalRule.active)).all()
    hits = []
    for r in active_rules:
        for p in params:
            code = p.param_code or marker_code(p.param_name_raw)
            if code == r.marker_code and p.value_num is not None:
                if not same_unit(p.unit, r.unit):
                    continue
                v = p.value_num
                is_hit = (
                    (r.comparator == "<" and v < r.threshold)
                    or (r.comparator == "<=" and v <= r.threshold)
                    or (r.comparator == ">" and v > r.threshold)
                    or (r.comparator == ">=" and v >= r.threshold)
                )
                if is_hit:
                    hits.append({
                        "rule_id": r.id,
                        "marker_code": r.marker_code,
                        "label": r.label,
                        "param_id": p.id,
                        "value": p.value_num,
                        "unit": p.unit,
                        "threshold": r.threshold,
                        "comparator": r.comparator,
                    })
    return hits


def build_insight_input(db: Session, report: Report) -> dict:
    """Build strictly de-identified input data for insight generation."""
    order = db.get(Order, report.order_id)
    rules = load_rules(db)
    catalogue = {t["code"]: t["name"] for t in rules.get("test_catalogue", [])}

    params = db.scalars(
        select(ReportParameter).where(ReportParameter.report_id == report.id).order_by(ReportParameter.id)
    ).all()

    demo = Demographics(sex=report.gender if report.gender in ("M", "F") else None, age_years=float(report.age) if report.age is not None else None)

    results_data = []
    abnormal_count = 0
    review_count = 0

    for p in params:
        cls = classify(p.value_num if p.value_num is not None else p.value_text, p.ref_text, p.unit, demo)
        status_val = p.system_flag if p.system_flag in ("LOW", "HIGH") else (cls.status if cls.status in ("LOW", "HIGH", "REVIEW_REQUIRED") else ("IN_RANGE" if p.system_flag == "NORMAL" else cls.status))
        if status_val in ("LOW", "HIGH"):
            abnormal_count += 1
        elif status_val == "REVIEW_REQUIRED":
            review_count += 1

        code = p.param_code or marker_code(p.param_name_raw)
        results_data.append({
            "ref": str(p.id),
            "param_code": code,
            "name": p.param_name_raw,
            "value": str(p.value_num) if p.value_num is not None else p.value_text,
            "value_num": p.value_num,
            "unit": p.unit or "",
            "ref_text": p.ref_text or "",
            "ref_low": p.ref_low,
            "ref_high": p.ref_high,
            "status": status_val,
            "severity": p.severity or "",
            "deviation_pct": p.deviation_pct,
            "what_it_measures": marker_info(code) or "",
            "category": marker_category(p.param_name_raw),
            "reasons": cls.reasons,
        })

    # Historical trends comparison with earlier reports for this patient
    patient_id = order.patient_id if order else None
    history_trends: list[dict] = []
    if patient_id and report.collected_on:
        earlier_params = db.execute(
            select(ReportParameter, Report.collected_on)
            .join(Report, Report.id == ReportParameter.report_id)
            .join(Order, Order.id == Report.order_id)
            .where(
                Order.patient_id == patient_id,
                Report.id != report.id,
                Report.collected_on < report.collected_on,
            )
            .order_by(Report.collected_on.desc())
        ).all()
        by_code: dict[str, list] = {}
        for ep, coll_on in earlier_params:
            c = ep.param_code or marker_code(ep.param_name_raw)
            if c not in by_code:
                by_code[c] = []
            if len(by_code[c]) < 3:
                by_code[c].append({
                    "date": coll_on.date().isoformat() if coll_on else None,
                    "value": ep.value_num,
                    "value_text": str(ep.value_num) if ep.value_num is not None else ep.value_text,
                    "unit": ep.unit,
                    "status": ep.system_flag,
                })
        for r in results_data:
            c = r["param_code"]
            if c in by_code and by_code[c]:
                prev = by_code[c][0]
                comparable = r["value_num"] is not None and prev["value"] is not None and same_unit(r["unit"], prev["unit"])
                direction = "NOT_COMPARABLE"
                delta = None
                pct = None
                if comparable:
                    delta = round((r["value_num"] - prev["value"]) * 1000) / 1000
                    direction = "STABLE" if abs(delta) < 0.001 else ("UP" if delta > 0 else "DOWN")
                    if prev["value"] != 0:
                        pct = round(((r["value_num"] - prev["value"]) / abs(prev["value"])) * 1000) / 10
                history_trends.append({
                    "ref": r["ref"],
                    "marker_code": c,
                    "marker_name": r["name"],
                    "current": {"value": r["value_num"], "unit": r["unit"]},
                    "previous": {"date": prev["date"], "value": prev["value"], "unit": prev["unit"]},
                    "direction": direction,
                    "delta": delta,
                    "percent_change": pct,
                })

    critical_hits = check_critical_hits(params, db)
    rule_priority = "URGENT" if critical_hits else ("PRIORITY" if (abnormal_count > 0 or review_count > 0) else "ROUTINE")

    # Buckets from rule sets
    abn_params = [p for p in params if p.system_flag in ("LOW", "HIGH")]
    recommended_tests = []
    bucket_list = []
    from . import followup as fu_svc
    buckets_dict = fu_svc.assign_buckets(abn_params, rules.get("buckets", []))
    for b_code, b_entry in buckets_dict.items():
        bucket_list.append({
            "code": b_code,
            "name": b_entry["bucket"]["name"],
            "severity": b_entry["severity"],
            "reasons": b_entry["reasons"],
        })
        for c_code in b_entry["bucket"].get("retest", []):
            if c_code in catalogue and c_code not in recommended_tests:
                recommended_tests.append(c_code)

    interval_days = fu_svc.interval_for(buckets_dict, 90) if buckets_dict else 90

    # Ensure strictly de-identified dict
    data = {
        "age": report.age,
        "gender": report.gender or "unknown",
        "report_date": report.collected_on.date().isoformat() if report.collected_on else None,
        "is_interim": report.needs_review,
        "results": results_data,
        "buckets": bucket_list,
        "trends": history_trends,
        "recommended_monitoring": recommended_tests,
        "interval_days": interval_days,
        "critical_hits": critical_hits,
        "rule_priority": rule_priority,
        "catalogue": [{"code": c, "name": n} for c, n in catalogue.items()],
    }

    # Strict privacy assertion: ensure no identifying fields
    forbidden_keys = {"patient_name", "name_norm", "mobile", "mobile_enc", "mobile_hash", "address", "order_id_external"}
    assert not any(k in data for k in forbidden_keys), f"PII detected in insight input: {forbidden_keys & data.keys()}"

    return data


# --- Deterministic Rules-Based Insight Generation ---

def find_related_refs(target_code: str, target_status: str, all_results: list[dict]) -> list[str]:
    """Find other results in the input that point in the same clinical direction."""
    related: list[str] = []
    # Identify target panel
    target_panels = [p_name for p_name, markers in PANEL_GROUPS.items() if target_code in markers]
    for r in all_results:
        if r["param_code"] == target_code:
            continue
        # Check if in same panel
        r_panels = [p_name for p_name, markers in PANEL_GROUPS.items() if r["param_code"] in markers]
        if set(target_panels) & set(r_panels):
            # Same direction or clinically concordant
            if r["status"] in ("LOW", "HIGH"):
                # Concordant direction for anemia (low HB + low MCV/MCH) or same flag
                if target_status == r["status"] or ("ANEMIA" in target_panels and r["param_code"] in ("MCV", "MCH", "MCHC")):
                    related.append(r["ref"])
    return related[:4]


def generate_rules_insight(data: dict) -> dict:
    """Produces a complete, deterministic, valid insight from rules and templates.
    Used when LLM_PROVIDER=template, or as fallback on LLM validation error."""
    results = data.get("results", [])
    abnormal = [r for r in results if r["status"] in ("LOW", "HIGH")]
    review = [r for r in results if r["status"] == "REVIEW_REQUIRED"]
    in_range = [r for r in results if r["status"] == "IN_RANGE"]
    critical_hits = data.get("critical_hits", [])

    total = len(results)
    dt_str = f" dated {data['report_date']}" if data.get("report_date") else ""
    overview_sentences = [
        f"{total} laboratory test result(s) were analyzed from this report{dt_str}.",
        f"{len(abnormal)} result(s) are outside the laboratory's stated range, {len(review)} require manual review, and {len(in_range)} are within printed ranges.",
    ]
    if data.get("is_interim"):
        overview_sentences.append("This is an interim or partial report; final confirmation should be checked upon receipt of complete testing.")
    overview_sentences.append("Results within the printed reference ranges do not by themselves indicate complete clinical wellness; the doctor reviews every report.")
    overview = " ".join(overview_sentences)

    defects: list[dict] = []
    flagged = abnormal + review
    for r in flagged:
        what = r["what_it_measures"] or "General information for this test is not in the standard list; the doctor will explain it."
        val_str = f"{r['value']}{' ' + r['unit'] if r['unit'] else ''}"
        if r["status"] == "REVIEW_REQUIRED":
            expl = f"{r['name']} {val_str} needs manual review: {r['reasons'][0] if r['reasons'] else 'reference range missing or ambiguous'}."
            prio = "MEDIUM"
        else:
            word = "above" if r["status"] == "HIGH" else "below"
            rng_str = f" ({r['ref_text']})" if r["ref_text"] else ""
            expl = f"{r['name']} {val_str} is {word} the laboratory's printed reference range{rng_str}. A result outside the range does not by itself confirm a condition; the doctor will review it."
            is_crit = any(h["param_id"] == int(r["ref"]) for h in critical_hits if "param_id" in h)
            prio = "HIGH" if (is_crit or r["severity"] == "severe") else ("MEDIUM" if r["severity"] == "moderate" else "LOW")

        related = find_related_refs(r["param_code"], r["status"], results)
        defects.append({
            "ref": r["ref"],
            "marker": r["name"],
            "status": r["status"],
            "severity": r["severity"] or "",
            "what_it_measures": what,
            "explanation": expl,
            "related_refs": related,
            "priority": prio,
        })

    # Suggestions
    doctor_disc = []
    clarifs = []
    for r in abnormal:
        doctor_disc.append(f"Discuss symptoms, dietary factors, lifestyle habits, or prior treatments relevant to {r['name']}.")
    for r in review:
        clarifs.append(f"Clarify reference range and clinical correlation for {r['name']} ({r['reasons'][0] if r['reasons'] else 'manual review required'}).")
    if data.get("is_interim"):
        clarifs.append("Confirm whether pending test results have been released by the laboratory.")
    if not doctor_disc:
        doctor_disc.append("Review general health status and any new or changing symptoms with the patient.")

    caller_q = [
        "Have you received your laboratory report and had a chance to view it?",
        "Have you discussed these test results with your treating doctor yet?",
        "Would you like our team to schedule a consultation with our doctor to review the report?",
        "Have you experienced any new, unusual, or changing physical symptoms recently?",
        "Are you currently taking any prescribed regular medications or daily supplements?",
    ]

    # Doctor connect priority: URGENT if critical hits, else PRIORITY if defects, else ROUTINE
    if critical_hits:
        dc_priority = "URGENT"
        dc_source = "rule"
        dc_reason = f"{len(critical_hits)} result(s) meet doctor-approved critical urgent criteria ({critical_hits[0]['label']})."
        dc_hours = 4
    elif defects:
        dc_priority = "PRIORITY"
        dc_source = "rule"
        dc_reason = f"{len(defects)} result(s) outside reference ranges or requiring clinical review."
        dc_hours = 24
    else:
        dc_priority = "ROUTINE"
        dc_source = "rule"
        dc_reason = "All tested parameters are within printed laboratory reference ranges."
        dc_hours = 72

    # Future suggestions
    recs = data.get("recommended_monitoring", [])
    catalogue_codes = {t["code"] for t in data.get("catalogue", [])}
    monitoring = [c for c in recs if c in catalogue_codes]
    trend_notes = []
    for t in data.get("trends", []):
        if t["direction"] in ("UP", "DOWN", "STABLE"):
            dir_str = "increased" if t["direction"] == "UP" else ("decreased" if t["direction"] == "DOWN" else "remained stable")
            trend_notes.append(f"{t['marker_name']} {dir_str} compared to previous measurement on {t['previous']['date']}.")
        elif t["direction"] == "NOT_COMPARABLE":
            trend_notes.append(f"{t['marker_name']} has historical measurements but units or reporting methods differ.")

    watch_markers = list(dict.fromkeys(r["param_code"] for r in abnormal if r["param_code"]))

    return {
        "schema_version": "1.0",
        "overview": overview,
        "defects": defects,
        "suggestions": {
            "doctor_discussion": doctor_disc[:6],
            "caller_questions": caller_q,
            "clarifications_for_doctor": clarifs[:6],
        },
        "doctor_connect": {
            "priority": dc_priority,
            "source": dc_source,
            "reason": dc_reason,
            "connect_within_hours": dc_hours,
        },
        "future": {
            "monitoring_tests": monitoring,
            "suggested_window_days": data.get("interval_days", 90),
            "trend_notes": trend_notes[:6],
            "watch_markers": watch_markers[:6],
        },
        "red_flag_protocol": (
            "If the patient reports warning symptoms (chest pain, breathlessness at rest, fainting, "
            "black or bloody stools, heavy bleeding, or acute confusion), advise immediate emergency medical care "
            "and escalate to the doctor on call without delay."
        ),
        "limitations": (
            "Laboratory reference ranges represent population statistics. Individual findings must be clinically "
            "correlated with patient history, physical examination, and clinical judgment."
        ),
        "needs_doctor_review": True,
    }


# --- Grounded Output Validator ---

def validate_insight(content: Any, data: dict, rules: dict) -> list[str]:
    """Validates structure, grounding, safety constraints, and priority rules."""
    errors = []
    if not isinstance(content, dict):
        return ["Insight content is not a dictionary"]

    # Schema validation via Pydantic
    try:
        ReportInsightSchema.model_validate(content)
    except Exception as e:
        errors.append(f"Schema validation error: {str(e)[:200]}")

    valid_refs = {r["ref"] for r in data.get("results", [])}
    catalogue_codes = {t["code"] for t in data.get("catalogue", [])}

    # Grounding check 1: defects must point to known refs
    for i, d in enumerate(content.get("defects", [])):
        if isinstance(d, dict):
            ref = str(d.get("ref", ""))
            if ref not in valid_refs:
                errors.append(f"defects[{i}].ref '{ref}' does not exist in input results")
            for rref in d.get("related_refs", []):
                if str(rref) not in valid_refs:
                    errors.append(f"defects[{i}].related_refs contains unknown ref '{rref}'")

    # Grounding check 2: monitoring tests must exist in test catalogue
    for code in content.get("future", {}).get("monitoring_tests", []):
        if code not in catalogue_codes:
            errors.append(f"future.monitoring_tests contains unknown catalogue code '{code}'")

    # Priority rule: AI can NEVER output URGENT directly
    dc = content.get("doctor_connect", {})
    if dc.get("source") == "ai" and dc.get("priority") == "URGENT":
        errors.append("AI is not permitted to set URGENT priority; URGENT requires doctor-approved critical rules.")

    # Caller safety check: caller_questions must not contain digits, disease names, or drug names
    forbidden = rules.get("caller_script_forbidden", {})
    terms = forbidden.get("diagnosis_terms", []) + forbidden.get("drug_terms", [])
    terms_re = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(t) for t in terms) + r")(?!\w)", re.I) if terms else None

    caller_qs = content.get("suggestions", {}).get("caller_questions", [])
    for q_text in caller_qs:
        if not isinstance(q_text, str):
            continue
        if re.search(r"\d", q_text):
            errors.append(f"Caller question contains a number: '{q_text[:40]}'")
        if terms_re:
            for word in {m.group(0).lower() for m in terms_re.finditer(q_text)}:
                errors.append(f"Caller question contains forbidden word '{word}'")

    # Grounding check 3: no invented numbers in the general output
    # Strip known non-clinical numeric fields
    clean_check = copy.deepcopy(content)
    clean_check.pop("schema_version", None)
    clean_check.get("doctor_connect", {}).pop("connect_within_hours", None)
    clean_check.get("future", {}).pop("suggested_window_days", None)

    allowed_numbers = {float(n) for n in re.findall(r"\d+(?:\.\d+)?", json.dumps(data, ensure_ascii=False))}
    # add common integers 1 to 10
    allowed_numbers |= {float(x) for x in range(1, 11)}

    output_numbers = re.findall(r"\d+(?:\.\d+)?", json.dumps(clean_check, ensure_ascii=False))
    ungrounded = [n for n in output_numbers if float(n) not in allowed_numbers]
    if ungrounded:
        errors.append(f"Numbers not present in source data: {', '.join(sorted(set(ungrounded))[:5])}")

    return errors


# --- Core Pipeline & Lifecycle Operations ---

def compute_input_hash(data: dict) -> str:
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def generate_insight_for_report(db: Session, report: Report) -> ReportInsight:
    """Generate or retrieve AI Report Insight for a report. Idempotent per input_hash."""
    data = build_insight_input(db, report)
    in_hash = compute_input_hash(data)

    existing = db.scalar(select(ReportInsight).where(ReportInsight.report_id == report.id))
    if existing and existing.input_hash == in_hash and existing.status != "REJECTED":
        return existing

    rules = load_rules(db)
    provider = get_llm()
    content = None
    validation_errors = []
    used_provider = provider.name
    used_model = provider.model

    if provider.name == "template":
        content = provider.generate_insight(data)
        validation_errors = validate_insight(content, data, rules)
    else:
        try:
            content = provider.generate_insight(data)
            validation_errors = validate_insight(content, data, rules)
            if validation_errors:
                # Fallback to TemplateProvider
                content = TemplateProvider().generate_insight(data)
                used_provider = "template"
                used_model = "template-v1"
        except LLMError as e:
            content = TemplateProvider().generate_insight(data)
            used_provider = "template"
            used_model = "template-v1"
            validation_errors = [f"LLM fallback triggered: {str(e)}"]

    # Final priority resolution: Critical rule hit -> URGENT
    critical_hits = data.get("critical_hits", [])
    if critical_hits:
        content["doctor_connect"]["priority"] = "URGENT"
        content["doctor_connect"]["source"] = "rule"
        content["doctor_connect"]["reason"] = f"{len(critical_hits)} result(s) meet doctor-approved critical urgent criteria ({critical_hits[0]['label']})."
        content["doctor_connect"]["connect_within_hours"] = 4
    else:
        # Cap AI priority at PRIORITY
        if content["doctor_connect"]["priority"] == "URGENT":
            content["doctor_connect"]["priority"] = "PRIORITY"

    insight = existing or ReportInsight(report_id=report.id)
    insight.content = content
    insight.status = "DRAFT"
    insight.provider = used_provider
    insight.model = used_model
    insight.prompt_version = "v1"
    insight.input_hash = in_hash
    insight.validation_errors = validation_errors
    insight.updated_at = datetime.now(timezone.utc)
    db.add(insight)
    db.flush()

    # Sync Followup priority if URGENT
    fu = db.scalar(select(Followup).where(Followup.report_id == report.id))
    if fu and content["doctor_connect"]["priority"] == "URGENT":
        fu.priority = "URGENT"

    db.commit()
    return insight


def regenerate_insight(db: Session, report_id: int, user_id: int) -> ReportInsight:
    report = db.get(Report, report_id)
    if not report:
        raise ValueError("Report not found")
    data = build_insight_input(db, report)
    in_hash = compute_input_hash(data)
    rules = load_rules(db)
    provider = get_llm()

    try:
        content = provider.generate_insight(data)
        validation_errors = validate_insight(content, data, rules)
        if validation_errors:
            content = TemplateProvider().generate_insight(data)
    except LLMError:
        content = TemplateProvider().generate_insight(data)
        validation_errors = ["LLM error; generated with template."]

    critical_hits = data.get("critical_hits", [])
    if critical_hits:
        content["doctor_connect"]["priority"] = "URGENT"
        content["doctor_connect"]["source"] = "rule"
        content["doctor_connect"]["connect_within_hours"] = 4
    elif content["doctor_connect"]["priority"] == "URGENT":
        content["doctor_connect"]["priority"] = "PRIORITY"

    insight = db.scalar(select(ReportInsight).where(ReportInsight.report_id == report_id))
    if not insight:
        insight = ReportInsight(report_id=report_id)
    insight.content = content
    insight.status = "DRAFT"
    insight.provider = provider.name
    insight.model = provider.model
    insight.input_hash = in_hash
    insight.validation_errors = validation_errors
    insight.approved_by = None
    insight.approved_at = None
    insight.updated_at = datetime.now(timezone.utc)
    db.add(insight)
    db.commit()
    audit(db, None, user_id, "regenerate", "report_insight", report_id)
    return insight


def approve_insight(db: Session, report_id: int, user_id: int) -> ReportInsight:
    insight = db.scalar(select(ReportInsight).where(ReportInsight.report_id == report_id))
    if not insight:
        raise ValueError("Insight not found")
    now_dt = datetime.now(timezone.utc)
    insight.status = "APPROVED"
    insight.approved_by = user_id
    insight.approved_at = now_dt
    insight.content["needs_doctor_review"] = False

    # Wire priority to Followup
    fu = db.scalar(select(Followup).where(Followup.report_id == report_id))
    if fu:
        prio = insight.content.get("doctor_connect", {}).get("priority", "ROUTINE")
        fu.priority = prio  # URGENT | PRIORITY | ROUTINE

    db.commit()
    audit(db, None, user_id, "approve", "report_insight", report_id)
    return insight


def reject_insight(db: Session, report_id: int, user_id: int) -> ReportInsight:
    insight = db.scalar(select(ReportInsight).where(ReportInsight.report_id == report_id))
    if not insight:
        raise ValueError("Insight not found")
    insight.status = "REJECTED"
    db.commit()
    audit(db, None, user_id, "reject", "report_insight", report_id)
    return insight


def patch_insight_content(db: Session, report_id: int, patch: dict, user_id: int) -> ReportInsight:
    insight = db.scalar(select(ReportInsight).where(ReportInsight.report_id == report_id))
    if not insight:
        raise ValueError("Insight not found")
    content = copy.deepcopy(insight.content)
    for k, v in patch.items():
        if k in content and isinstance(content[k], dict) and isinstance(v, dict):
            content[k].update(v)
        else:
            content[k] = v

    insight.content = content
    insight.updated_at = datetime.now(timezone.utc)
    db.commit()
    audit(db, None, user_id, "edit", "report_insight", report_id)
    return insight
