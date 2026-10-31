"""Turns a lab report (structured JSON, or a PDF via an LLM/OCR adapter) into our canonical
shape, normalises names/units, validates, and scores confidence (Part 6.4-6.6).

Canonical input:
{"patient": {"name","age","gender","mobile"}, "collected_on", "reported_on", "lab",
 "parameters": [{"name","value","unit","ref_range" | "ref_low"/"ref_high","flag"}]}"""
import re
from datetime import datetime, timezone

from . import storage
from .analysis import NUM, parse_range
from .models import Report, ReportParameter

UNITS = {"mg/dl": "mg/dL", "g/dl": "g/dL", "ng/ml": "ng/mL", "pg/ml": "pg/mL", "miu/l": "mIU/L",
         "uiu/ml": "µIU/mL", "µiu/ml": "µIU/mL", "u/l": "U/L", "iu/l": "IU/L", "%": "%"}
# shortcut: units are only spelled consistently, never converted (mmol/L etc.); add conversions when a lab sends them.


class ExtractError(Exception):
    """Message is shown to admins; must not contain patient data."""


def pdf_to_data(pdf: bytes) -> dict:
    # Real implementation arrives with the LLMProvider (Phase 6; vendor is open question Q3).
    raise ExtractError("PDF extraction needs an LLM/OCR provider, which is not configured yet")


def canonical_code(name: str, aliases: dict) -> str:
    return aliases.get(re.sub(r"\s+", " ", name.strip().lower()), "")


def parse_value(raw) -> tuple[float | None, str]:
    text = str(raw).strip()
    m = re.fullmatch(rf"[<>]?\s*({NUM})", text.replace(",", ""))
    return (float(m.group(1)) if m else None), text[:60]


def _date(s):
    try:
        d = datetime.fromisoformat(str(s))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _gender(g) -> str:
    g = str(g or "").strip().lower()
    return "M" if g in ("m", "male") else "F" if g in ("f", "female") else ""


def build_report(order, data: dict, rules: dict, min_confidence: int) -> tuple[Report, list[ReportParameter]]:
    raw_params = data.get("parameters") or []
    if not raw_params:
        raise ExtractError("No test results found in the report")
    pat = data.get("patient") or {}
    aliases = rules.get("aliases", {})
    reasons, score = [], 100

    gender = _gender(pat.get("gender"))
    if not gender:
        score -= 30
        reasons.append("Gender missing")
    try:
        age = int(pat["age"])
        if not 0 <= age <= 120:
            raise ValueError
    except (KeyError, ValueError, TypeError):
        age = None
        score -= 30
        reasons.append("Age missing or invalid")
    collected, reported = _date(data.get("collected_on")), _date(data.get("reported_on"))
    if not collected:
        score -= 10
        reasons.append("Collection date missing")

    params, unmapped, nonnumeric = [], 0, 0
    for rp in raw_params:
        name = str(rp.get("name", "")).strip()[:120]
        num, text = parse_value(rp.get("value", ""))
        code = canonical_code(name, aliases)
        ref_text = str(rp.get("ref_range") or "")[:60]
        low, high = rp.get("ref_low"), rp.get("ref_high")
        if ref_text and (r := parse_range(ref_text)):
            low, high = r[0], r[1]
        if low is not None and high is not None and low > high:
            score -= 20
            reasons.append(f"Reference range looks wrong for {name}")
        unmapped += not code
        nonnumeric += num is None
        unit = str(rp.get("unit") or "").strip()
        params.append(ReportParameter(param_code=code, param_name_raw=name, value_num=num, value_text=text,
                                      unit=UNITS.get(unit.lower(), unit)[:30], ref_low=low, ref_high=high,
                                      ref_text=ref_text, lab_flag=str(rp.get("flag") or "")[:20]))
    if unmapped:
        score -= min(40, 10 * unmapped)
        reasons.append(f"{unmapped} test name(s) not recognised")
    if nonnumeric:
        score -= min(20, 5 * nonnumeric)
        reasons.append(f"{nonnumeric} value(s) are not numbers")

    score = max(score, 0)
    mobile = str(pat.get("mobile") or "")
    report = Report(order_id=order.id, patient_name=str(pat.get("name") or "")[:120], age=age, gender=gender,
                    mobile_enc=storage.encrypt_str(mobile) if mobile else "", collected_on=collected or order.collected_on,
                    reported_on=reported or order.reported_on, lab_name=str(data.get("lab") or order.lab)[:60],
                    extraction_confidence=score, needs_review=score < min_confidence, review_reasons=reasons)
    return report, params
