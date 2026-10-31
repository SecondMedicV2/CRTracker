"""Call Card: builds the de-identified input, asks the generator, and enforces the guardrails in
code (Part 12.4-12.5): schema, every number grounded in the input, tests only from the catalogue,
and a caller script free of diagnosis, values, digits and drug names."""
import copy
import hashlib
import json
import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import followup as fu_svc
from .analysis import load_rules
from .llm import LLMError, get_llm
from .models import CallCard, Followup, Order, Patient, Report, ReportParameter
from .settings_store import get_setting
from .timeutil import today_ist

CALLER_REQUIRED = ["opening", "identity_check", "free_followup_pitch", "consent_request", "slot_offer",
                   "urgent_symptom_protocol", "closing"]
LIST_FIELDS = {"doctor_script": ["discussion_points", "scientific_talking_points", "questions_to_ask", "counselling_points",
                                 "tests_to_suggest", "red_flags"]}
PLACEHOLDER = re.compile(r"\{[a-z_]+\}")


def _band_text(code: str, gender: str, ranges: dict) -> str:
    """Printable normal range from the admin table, for values the report printed no range for."""
    spec = ranges.get(code) or {}
    if "low_below" in spec:
        thr = spec["low_below"].get(gender)
        return f">={thr:g}" if thr is not None else ""
    normal = next((b for b in spec.get("bands", []) if b[0] in ("normal", "desirable", "optimal", "sufficient")), None)
    if not normal:
        return ""
    _, lo, hi = normal
    return f"{lo:g}-{hi:g}" if lo is not None and hi is not None else f"<{hi:g}" if hi is not None else f">={lo:g}"


def _age_text(days: int, units: dict) -> str:
    m, d = divmod(max(days, 0), 30)
    return f"{m} {units['months']} {d} {units['days']}" if m else f"{d} {units['days']}"


def build_input(db: Session, fu: Followup) -> dict:
    """Structured and de-identified: age and gender only, never name or mobile (Part 12.3)."""
    rules = load_rules(db)
    report, order = db.get(Report, fu.report_id), None
    order = db.get(Order, report.order_id)
    patient = db.get(Patient, fu.patient_id)
    params = db.scalars(select(ReportParameter).where(ReportParameter.report_id == report.id).order_by(ReportParameter.id)).all()
    abn = fu_svc.abnormal_params(params)
    buckets = fu_svc.assign_buckets(abn, rules["buckets"])
    templates = rules["script_templates"]
    lang = patient.language or get_setting(db, "default_language")
    fallback_from = "" if lang in templates else lang
    lang = lang if lang in templates else "en"
    today, collected = today_ist(), fu_svc.collected_date(report, order)
    days = max((today - collected).days, 0)
    interval = fu_svc.interval_for(buckets, get_setting(db, "default_interval_days"))
    start = max(fu.due_on, today)
    trends = fu_svc.param_trends(db, fu.patient_id, report, abn)
    catalogue = {t["code"]: t["name"] for t in rules["test_catalogue"]}
    recommended, seen = [], set()
    for e in buckets.values():
        for code in e["bucket"].get("retest", []):
            if code in catalogue and code not in seen:
                seen.add(code)
                recommended.append({"code": code, "name": catalogue[code], "bucket": e["bucket"]["name"]})
    prior = db.execute(
        select(ReportParameter.param_code, Report.collected_on, ReportParameter.value_num, ReportParameter.system_flag)
        .join(Report, Report.id == ReportParameter.report_id).join(Order, Order.id == Report.order_id)
        .where(Order.patient_id == fu.patient_id, Report.id != report.id, Report.collected_on < report.collected_on,
               ReportParameter.param_code.in_([p.param_code for p in abn if p.param_code]))
        .order_by(Report.collected_on.desc())).all() if report.collected_on else []
    history: dict[str, list] = {}
    for code, when, val, flag in prior:
        if len(history.setdefault(code, [])) < 3:
            history[code].append({"date": when.date().isoformat(), "value": val, "flag": flag})
    data = {
        "age": report.age, "gender": report.gender, "language": lang, "language_fallback_from": fallback_from,
        "lab": report.lab_name or order.lab, "report_date": collected.isoformat(), "report_age_days": days,
        "report_age_text": _age_text(days, templates[lang]["units"]),
        "followup": {"due_on": fu.due_on.isoformat(), "interval_days": interval, "priority": fu.priority},
        "buckets": [{"code": c, "name": e["bucket"]["name"], "severity": e["severity"], "reasons": e["reasons"]} for c, e in buckets.items()],
        "abnormal": [{"param_code": p.param_code, "name": p.param_name_raw, "value": p.value_num, "unit": p.unit,
                      "ref_range": p.ref_text or _band_text(p.param_code, report.gender, rules.get("reference_ranges", {})) or "not printed",
                      "direction": p.system_flag.lower(), "severity": p.severity or "mild",
                      "trend_vs_previous": trends.get(p.param_code, "none")} for p in abn],
        "history": history,
        "score": {"tier": fu.retest_tier, "score": fu.retest_score, "breakdown": fu.score_breakdown},
        "recommended": recommended,
        "ideal_window": {"from": start.isoformat(), "to": (start + timedelta(days=30)).isoformat()},
        "catalogue": [{"code": c, "name": n} for c, n in catalogue.items()],
    }
    return data


# ---- validation ----
def validate_schema(c: dict) -> list[str]:
    err = []

    def need(obj, key, typ, where):
        if not isinstance(obj, dict) or key not in obj:
            err.append(f"{where}.{key} missing")
            return None
        if not isinstance(obj[key], typ) or isinstance(obj[key], bool) and typ is not bool:
            err.append(f"{where}.{key} has the wrong type")
            return None
        return obj[key]

    if not isinstance(c, dict):
        return ["Card is not an object"]
    need(c, "schema_version", str, "card")
    need(c, "language", str, "card")
    need(c, "needs_doctor_review", bool, "card")
    s = need(c, "summary", dict, "card")
    for k, t in (("headline", str), ("report_date", str), ("report_age_days", int), ("lab", str)):
        need(s, k, t, "summary")
    for i, a in enumerate(need(c, "abnormal_findings", list, "card") or []):
        for k, t in (("param_code", str), ("name", str), ("value", (int, float)), ("unit", str), ("ref_range", str)):
            need(a, k, t, f"abnormal_findings[{i}]")
        for k, allowed in (("direction", ("low", "high")), ("severity", ("mild", "moderate", "severe")),
                           ("trend_vs_previous", ("worsening", "stable", "improving", "none"))):
            if isinstance(a, dict) and a.get(k) not in allowed:
                err.append(f"abnormal_findings[{i}].{k} must be one of {allowed}")
    r = need(c, "retest", dict, "card")
    need(r, "tier", str, "retest")
    need(r, "score", int, "retest")
    for k in ("score_breakdown", "reasons", "recommended_tests", "not_needed"):
        need(r, k, list, "retest")
    for i, t in enumerate((r or {}).get("recommended_tests") or []):
        for k, typ in (("test_code", str), ("name", str), ("rationale", str), ("priority", int)):
            need(t, k, typ, f"recommended_tests[{i}]")
    w = need(r, "ideal_window", dict, "retest")
    need(w, "from", str, "ideal_window")
    need(w, "to", str, "ideal_window")
    if isinstance(r, dict) and r.get("confidence") not in ("high", "medium", "low"):
        err.append("retest.confidence must be high, medium or low")
    d = need(c, "doctor_script", dict, "card")
    for k in ("opening", "closing", "next_followup_suggestion"):
        need(d, k, str, "doctor_script")
    for k in LIST_FIELDS["doctor_script"]:
        need(d, k, list, "doctor_script")
    cs = need(c, "caller_script", dict, "card")
    for k in CALLER_REQUIRED:
        if need(cs, k, str, "caller_script") is not None and not cs[k].strip():
            err.append(f"caller_script.{k} is empty")
    need(cs, "do_not_say", list, "caller_script")
    for i, o in enumerate(need(cs, "objection_handling", list, "caller_script") or []):
        need(o, "objection", str, f"objection_handling[{i}]")
        need(o, "reply", str, f"objection_handling[{i}]")
    return err


def check_grounding(c: dict, data: dict) -> list[str]:
    """Every number must exist in the input; recommended tests must be catalogue tests with their catalogue name."""
    err = []
    stripped = copy.deepcopy(c)
    stripped.pop("schema_version", None)
    for t in stripped.get("retest", {}).get("recommended_tests", []):
        t.pop("priority", None)  # a rank, not a clinical number
    allowed = {float(n) for n in re.findall(r"\d+(?:\.\d+)?", json.dumps(data, ensure_ascii=False))}
    bad = sorted({n for n in re.findall(r"\d+(?:\.\d+)?", json.dumps(stripped, ensure_ascii=False)) if float(n) not in allowed})
    if bad:
        err.append(f"Numbers not present in the source data: {', '.join(bad[:5])}")
    names = {t["code"]: t["name"] for t in data["catalogue"]}
    for t in c.get("retest", {}).get("recommended_tests", []):
        if names.get(t.get("test_code")) != t.get("name"):
            err.append(f"Test '{t.get('test_code')}' is not in the test catalogue")
    return err


def check_caller_safety(c: dict, forbidden: dict, catalogue_names: list[str]) -> list[str]:
    """The caller is not medically trained: no diagnosis, values, digits or drug names (AC11)."""
    err, cs = [], c.get("caller_script", {})
    spoken = [v for k, v in cs.items() if k != "do_not_say" and isinstance(v, str)]
    spoken += [x for o in cs.get("objection_handling", []) if isinstance(o, dict) for x in (o.get("objection", ""), o.get("reply", ""))]
    terms = forbidden.get("diagnosis_terms", []) + forbidden.get("drug_terms", [])
    names_re = re.compile("|".join(re.escape(n) for n in sorted(catalogue_names, key=len, reverse=True)) or "(?!)", re.I)
    terms_re = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(t) for t in terms) + r")(?!\w)", re.I) if terms else None
    for text in spoken:
        text = PLACEHOLDER.sub(" ", names_re.sub(" ", text))  # test names are allowed ("due for Lipid Profile")
        if re.search(r"\d", text):
            err.append("Caller script contains a number")
        if terms_re:
            for word in {m.group(0).lower() for m in terms_re.finditer(text)}:
                err.append(f"Caller script contains forbidden word '{word}'")
    return sorted(set(err))


def validate_all(c: dict, data: dict, rules: dict) -> list[str]:
    err = validate_schema(c)
    if err:
        return err
    names = [t["name"] for t in rules["test_catalogue"]]
    return check_grounding(c, data) + check_caller_safety(c, rules["caller_script_forbidden"], names)


# ---- lifecycle ----
def latest(db: Session, fid: int) -> CallCard | None:
    return db.scalar(select(CallCard).where(CallCard.followup_id == fid).order_by(CallCard.version.desc()))


def _save(db: Session, fu: Followup, content: dict, base: dict, errors: list, **kw) -> CallCard:
    prev = latest(db, fu.id)
    card = CallCard(followup_id=fu.id, version=(prev.version + 1) if prev else 1, content=content,
                    language=str(content.get("language", base["language"]))[:12], validation_status="NEEDS_REVIEW" if errors else "VALID",
                    validation_errors=errors, **kw)
    db.add(card)
    db.commit()
    return card


def generate(db: Session, fu: Followup, user_id: int | None = None) -> CallCard:
    """Up to 3 tries (1 + 2 retries); if it never validates the card is kept as NEEDS_REVIEW with the reasons."""
    rules, data = load_rules(db), build_input(db, fu)
    provider = get_llm()
    content, errors = None, []
    for _ in range(3):
        try:
            content = provider.generate(data, rules["script_templates"])
        except LLMError as e:
            errors = [str(e)]
            continue
        errors = validate_all(content, data, rules)
        if not errors:
            break
    if content is None:
        raise LLMError(errors[0] if errors else "No output")
    notice = f"Script not available in '{data['language_fallback_from']}'. Showing English." if data["language_fallback_from"] else ""
    return _save(db, fu, content, data, errors, model=provider.model, prompt_version=provider.prompt_version, notice=notice,
                 input_hash=hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest(), edited_by=user_id)


def edit(db: Session, card: CallCard, content: dict, user_id: int) -> CallCard:
    """A doctor's edit becomes a new version. Schema and caller-safety rules still apply to it."""
    rules = load_rules(db)
    errors = validate_schema(content)
    if not errors:
        errors = check_caller_safety(content, rules["caller_script_forbidden"], [t["name"] for t in rules["test_catalogue"]])
    if errors:
        raise ValueError(errors)
    fu = db.get(Followup, card.followup_id)
    return _save(db, fu, content, {"language": card.language}, [], model=card.model, prompt_version=card.prompt_version,
                 notice=card.notice, input_hash=card.input_hash, edited_by=user_id)


def render_caller_script(script: dict, patient_name: str, caller_name: str, company: str) -> dict:
    def fill(v):
        if isinstance(v, str):
            return v.replace("{patient_name}", patient_name).replace("{caller_name}", caller_name).replace("{company}", company)
        if isinstance(v, list):
            return [fill(x) for x in v]
        if isinstance(v, dict):
            return {k: fill(x) for k, x in v.items()}
        return v

    return fill(script)


def reason_for_call(card: CallCard) -> str:
    names = [t["name"] for t in card.content["retest"]["recommended_tests"]]
    return f"Due for a follow-up on your {', '.join(names)}" if names else "Due for a routine follow-up"
