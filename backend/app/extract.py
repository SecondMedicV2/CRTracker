"""Turns a lab report (structured JSON, or a PDF via an LLM/OCR adapter) into our canonical
shape, normalises names/units, validates, and scores confidence (Part 6.4-6.6).

Canonical input:
{"patient": {"name","age","gender","mobile"}, "collected_on", "reported_on", "lab",
 "parameters": [{"name","value","unit","ref_range" | "ref_low"/"ref_high","flag"}]}"""
import io
import re
from datetime import datetime, timezone

from . import storage
from .analysis import NUM, parse_range
from .config import env
from .models import Report, ReportParameter

UNITS = {"mg/dl": "mg/dL", "g/dl": "g/dL", "ng/ml": "ng/mL", "pg/ml": "pg/mL", "miu/l": "mIU/L",
         "uiu/ml": "µIU/mL", "µiu/ml": "µIU/mL", "u/l": "U/L", "iu/l": "IU/L", "%": "%"}
# shortcut: units are only spelled consistently, never converted (mmol/L etc.); add conversions when a lab sends them.


class ExtractError(Exception):
    """Message is shown to admins; must not contain patient data."""


# Thyrocare prints a "technology" column between the test name and the value; it is not part of the name.
METHODS = (r"(?:C\.?L\.?I\.?A|E\.?C\.?L\.?I\.?A|C\.?M\.?I\.?A|H\.?P\.?L\.?C|E\.?L\.?I\.?S\.?A|I\.?S\.?E|PHOTOMETRY|"
           r"SPECTROPHOTOMETRY|IMMUNOTURBIDIMETRY|CALCULATED|CALCULATION|DERIVED|FLOW CYTOMETRY|MICROSCOPY|"
           r"LC-?MS/?MS|ICP-?MS|NEPHELOMETRY|TURBIDIMETRY|ENZYMATIC|COLORIMETRY|POTENTIOMETRY)")
ROW = re.compile(rf"^(?P<name>[A-Za-z0-9(].*?[A-Za-z0-9)\]])(?:\s+{METHODS})?\s+(?P<value>[<>]?\s?{NUM})"
                 r"(?:\s+(?P<unit>[^\s\d<>\-][^\s]*))?\s*(?P<range>.*)$", re.I)
NOT_A_TEST = re.compile(r"\b(age|sex|gender|date|page|barcode|collected|received|reported|printed|mobile|phone|"
                        r"pin|ref|patient|sample|lab code|order|years?|tel|fax)\b|:", re.I)
PRIVATE_LINE = re.compile(r"\b(name|patient|address|mobile|phone|e-?mail|ref\.? ?by|referred|barcode|client|"
                          r"booked|aadhaar|pin ?code)\b", re.I)
KNOWN_UNITS = {u.lower() for u in UNITS} | {
    "mmol/l", "µmol/l", "umol/l", "fl", "pg", "10^3/µl", "10^6/µl", "x10^3/ul", "x10^6/ul", "thou/µl", "mill/µl",
    "cells/µl", "meq/l", "mg/l", "µg/dl", "ug/dl", "miu/ml", "ng/dl", "mm/hr", "sec", "gm/dl", "µg/l", "ug/l"}


def pdf_text(pdf: bytes) -> str:
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(pdf))
        if len(reader.pages) > 60:
            raise ExtractError("The PDF has more than 60 pages")
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except ExtractError:
        raise
    except Exception:
        raise ExtractError("Could not read this PDF")
    if len(text.strip()) < 20:
        raise ExtractError("The PDF has no readable text (it may be a scanned image)")
    return text


def parse_report_text(text: str) -> dict:
    """Rule-based reader for text PDFs laid out as  NAME [TECHNOLOGY] VALUE UNIT RANGE  (Thyrocare's layout).
    Unrecognised names or values lower the confidence score, which sends the report to a human reviewer."""
    params, seen = [], set()
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        m = ROW.match(line)
        if not m or NOT_A_TEST.search(m["name"]) or len(re.findall(r"[A-Za-z]", m["name"])) < 2:
            continue
        unit, rng = (m["unit"] or "").strip(), m["range"].strip()
        if not (unit.lower() in KNOWN_UNITS or parse_range(rng)):
            continue  # a sentence that merely contains a number
        name = m["name"].strip()
        if name.lower() not in seen:
            seen.add(name.lower())
            params.append({"name": name, "value": m["value"].replace(" ", ""), "unit": unit, "ref_range": rng[:60]})
    return {"parameters": params}


def redact(text: str, patient: dict) -> str:
    """Drops lines that identify the person and masks their name, phone numbers and e-mail anywhere else."""
    out = "\n".join(ln for ln in text.splitlines() if not PRIVATE_LINE.search(ln))
    for part in str(patient.get("name") or "").split():
        if len(part) >= 3:
            out = re.sub(rf"\b{re.escape(part)}\b", "[name]", out, flags=re.I)
    out = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "[email]", out)
    return re.sub(r"(?<![\d.])(?:\+?91[\s-]?)?\d(?:[\s-]?\d){9}(?![\d.])", "[number]", out)


def pdf_to_data(pdf: bytes, patient: dict | None = None) -> dict:
    """Text PDF -> canonical shape, with the built-in rule-based reader. With AI_PDF_EXTRACTION=true and an AI
    provider set, the model reads it instead; it only sees the text with identifying lines removed."""
    text = pdf_text(pdf)
    if env.ai_pdf_extraction and env.llm_provider != "template" and env.ai_patient_data != "none":
        from .llm import LLMError, get_llm

        try:
            data = get_llm().extract_results(redact(text, patient or {}))
            if isinstance(data, dict) and data.get("parameters"):
                return {k: data.get(k) for k in ("parameters", "collected_on", "reported_on")}
        except LLMError:
            pass  # fall back to the rule-based reader
    return parse_report_text(text)


def merge_patient(found: dict, booked: dict) -> dict:
    """The lab booking (name, age, gender, mobile) wins over what the report itself says, field by field."""
    return {k: booked.get(k) if booked.get(k) not in (None, "") else found.get(k) for k in ("name", "age", "gender", "mobile")}


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
