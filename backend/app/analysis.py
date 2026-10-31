"""Deterministic flagging (Part 7.1-7.2): the report's own range first, then the admin
fallback table. No LLM involved. All thresholds come from editable rule sets."""
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Report, ReportParameter, RuleSet

NORMAL_LABELS = {"normal", "desirable", "optimal", "sufficient"}
NUM = r"-?\d+(?:\.\d+)?"


def load_rules(db: Session) -> dict:
    # Cached on the session: one worker loop or one API request, so an admin edit is picked up on the next one.
    if "rules" not in db.info:
        db.info["rules"] = {r.key: r.data for r in db.scalars(select(RuleSet).where(RuleSet.active))}
    return db.info["rules"]


def parse_range(text: str):
    """'<5.7' | '<= 5.7' | '>= 150' | '10 - 20' | '10 to 20' -> (low, high, low_excl, high_excl) or None."""
    s = (text or "").strip().replace("–", "-").replace("—", "-").replace(",", "")
    m = re.fullmatch(rf"(<=?|≤|>=?|≥)\s*({NUM})", s)
    if m:
        op, v = m.group(1), float(m.group(2))
        if op in ("<", "<=", "≤"):
            return (None, v, False, op == "<")
        return (v, None, op == ">", False)
    m = re.fullmatch(rf"({NUM})\s*(?:-|to)\s*({NUM})", s)
    if m:
        return (float(m.group(1)), float(m.group(2)), False, False)
    return None


def _report_range_flag(v, low, high, low_ex, high_ex):
    if low is not None and (v < low or (low_ex and v == low)):
        return "LOW", low
    if high is not None and (v > high or (high_ex and v == high)):
        return "HIGH", high
    return "NORMAL", None


def _fallback_flag(code, v, gender, ranges):
    spec = ranges.get(code)
    if not spec:
        return None
    if "low_below" in spec:
        thr = spec["low_below"].get(gender)
        if thr is None:
            return None  # sex-specific range but sex unknown: do not guess
        return ("LOW", thr) if v < thr else ("NORMAL", None)
    normal = next((b for b in spec["bands"] if b[0] in NORMAL_LABELS), None)
    if not normal:
        return None
    _, lo, hi = normal
    if lo is not None and v < lo:
        return "LOW", lo
    if hi is not None and v >= hi:
        return "HIGH", hi
    return "NORMAL", None


def severity_for(dev_pct: float, sev: dict) -> str:
    if dev_pct < sev["mild_max_pct"]:
        return "mild"
    return "moderate" if dev_pct < sev["moderate_max_pct"] else "severe"


def flag_parameter(p: ReportParameter, gender: str, rules: dict) -> None:
    p.system_flag, p.severity, p.deviation_pct, p.ref_source = "", "", None, ""
    result, source = None, ""
    if p.value_num is not None:
        rng = parse_range(p.ref_text) if p.ref_text else None
        if rng is None and (p.ref_low is not None or p.ref_high is not None):
            rng = (p.ref_low, p.ref_high, False, False)
        if rng is not None:
            result, source = _report_range_flag(p.value_num, *rng), "report"
        else:
            result, source = _fallback_flag(p.param_code, p.value_num, gender, rules.get("reference_ranges", {})), "fallback"
    if result is None:
        lf = (p.lab_flag or "").strip().upper()
        if lf[:1] in ("H", "L"):  # last resort: trust the lab's printed flag
            p.system_flag, p.severity, p.ref_source = ("HIGH" if lf[0] == "H" else "LOW"), "mild", "lab_flag"
        return
    p.system_flag, p.ref_source = result[0], source
    if result[0] != "NORMAL":
        limit = result[1]
        p.deviation_pct = round(abs(p.value_num - limit) / abs(limit) * 100, 1) if limit else 100.0
        p.severity = severity_for(p.deviation_pct, rules["severity"])


def analyse(report: Report, params: list[ReportParameter], rules: dict) -> str:
    for p in params:
        flag_parameter(p, report.gender, rules)
    report.classification = "ABNORMAL" if any(p.system_flag in ("LOW", "HIGH") for p in params) else "NORMAL"
    return report.classification
