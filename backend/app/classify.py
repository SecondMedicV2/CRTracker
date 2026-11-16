"""Deterministic classification of a lab result against the reference range PRINTED ON THE REPORT.
Ported from SM-Report-Analyzer (classify.ts).
LOW / HIGH / IN_RANGE / REVIEW_REQUIRED.
An absent range is never treated as normal."""
from dataclasses import dataclass, field
import math
import re
from typing import Literal

from .units import norm_unit, same_unit, strip_unit_tokens, unit_tokens

Status = Literal["LOW", "HIGH", "IN_RANGE", "REVIEW_REQUIRED"]
STATUSES: list[Status] = ["LOW", "HIGH", "IN_RANGE", "REVIEW_REQUIRED"]
STATUS_LABEL: dict[Status, str] = {
    "LOW": "LOW",
    "HIGH": "HIGH",
    "IN_RANGE": "IN RANGE",
    "REVIEW_REQUIRED": "REVIEW REQUIRED",
}

Sex = Literal["M", "F"]


@dataclass
class Demographics:
    sex: str | None = None  # 'M' | 'F' | None
    age_years: float | None = None


@dataclass
class ParsedRange:
    low: float | None
    high: float | None
    low_strict: bool  # ">5": value must be above 5
    high_strict: bool  # "<5": value must be below 5


@dataclass
class Classification:
    status: Status
    value_type: str  # NUMERIC | QUALITATIVE | TEXT
    value_num: float | None
    qualifier: str | None
    ref_low: float | None
    ref_high: float | None
    applicable_range: str | None
    range_basis: str | None
    matched_band: str | None
    unit_used: str | None
    unit_check: str  # MATCH | NOT_STATED | ADOPTED_FROM_RANGE | MISSING | MISMATCH
    reasons: list[str] = field(default_factory=list)


NEG = [
    "negative", "neg", "non reactive", "nonreactive", "non-reactive",
    "not detected", "absent", "nil", "none", "not seen", "none seen",
]
POS = [
    "positive", "pos", "reactive", "detected", "present", "seen", "trace",
]


def qual_group(s: str) -> str | None:
    t = re.sub(r"[.\s]+$", "", s.lower())
    t = re.sub(r"\s+", " ", t).strip()
    if t in NEG:
        return "NEG"
    if t in POS or re.fullmatch(r"\++", t) or re.fullmatch(r"[1-4]\s*\+", t):
        return "POS"
    return None


def clean_text(s: str) -> str:
    t = s.replace("–", "-").replace("—", "-").replace("−", "-")
    t = t.replace("≤", "<=").replace("≥", ">=")
    t = t.replace("³", "^3").replace("⁶", "^6").replace("⁹", "^9")
    # 1,250 -> 1250 (Indian 1,55,000 stays and is not read as a single standard number)
    t = re.sub(r"(\d),(\d{3})(?!\d)", r"\1\2", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


NUM = r"-?\d+(?:\.\d+)?"


@dataclass
class ParsedValue:
    kind: str  # NUM | QUAL | TEXT
    num: float | None = None
    qualifier: str = ""
    group: str | None = None
    text: str = ""


def parse_value(raw: str | float | int | None) -> ParsedValue | None:
    if raw is None:
        return None
    text = clean_text(str(raw))
    if not text:
        return None
    # Strip trailing flags like * or H/L
    s = re.sub(r"\s*(\*+|\bH\b|\bL\b|\bHigh\b|\bLow\b)$", "", text, flags=re.I).strip()
    m = re.match(rf"^(<=|>=|<|>)?\s*({NUM})$", s)
    if m:
        try:
            val = float(m.group(2))
            if math.isfinite(val):
                return ParsedValue(kind="NUM", num=val, qualifier=m.group(1) or "", text=s)
        except ValueError:
            pass
    g = qual_group(s)
    if g:
        return ParsedValue(kind="QUAL", group=g, text=s)
    return ParsedValue(kind="TEXT", text=s)


CMP = r"(<=|>=|<|>|less than|more than|greater than|below|above|up ?to|upto|max(?:imum)?|min(?:imum)?)"


def cmp_range(cmp_str: str, n: float) -> ParsedRange:
    norm = re.sub(r"\s+", " ", cmp_str.lower())
    upper = norm in ("<=", "<", "less than", "below", "up to", "upto", "max", "maximum")
    if upper or norm.startswith("up"):
        return ParsedRange(
            low=None, high=n, low_strict=False,
            high_strict=norm in ("<", "less than", "below"),
        )
    return ParsedRange(
        low=n, high=None,
        low_strict=norm in (">", "more than", "greater than", "above"),
        high_strict=False,
    )


@dataclass
class Band:
    label: str
    text: str
    range: ParsedRange | None
    sex: str | None
    age_min: float | None
    age_max: float | None
    age_min_strict: bool
    age_max_strict: bool
    age_assumed: bool
    normal: bool


@dataclass
class AgeTok:
    min: float | None
    max: float | None
    min_strict: bool
    max_strict: bool
    text: str


AGE_UNIT = r"(?:years?|yrs?|y)\b\.?"
NORMAL_RE = re.compile(r"\b(normal|non[- ]?diabetic|desirable|optimal|sufficient|sufficiency|reference|healthy|euthyroid)\b", re.I)
NOT_NORMAL_RE = re.compile(r"\b(near|borderline|pre|ab|above|below)\b|insuffic", re.I)
MALE_RE = re.compile(r"\b(m|male|males|men|man)\b", re.I)
FEMALE_RE = re.compile(r"\b(f|female|females|women|woman)\b", re.I)


def _label_info(label: str, ages: list[AgeTok]):
    male = bool(MALE_RE.search(label))
    female = bool(FEMALE_RE.search(label))
    age_min, age_max = None, None
    age_min_strict, age_max_strict = False, False
    age_assumed = False

    m_age = re.search(r"__age([a-z])__", label)
    if m_age:
        idx = ord(m_age.group(1)) - 97
        if 0 <= idx < len(ages):
            a = ages[idx]
            age_min, age_max = a.min, a.max
            age_min_strict, age_max_strict = a.min_strict, a.max_strict
    elif re.search(r"\badults?\b", label, re.I):
        age_min = 18.0
        age_assumed = True
    elif re.search(r"\b(child|children|paediatric|pediatric|kids?)\b", label, re.I):
        age_max = 18.0
        age_max_strict = True
        age_assumed = True

    return {
        "sex": "M" if (male and not female) else "F" if (female and not male) else None,
        "age_min": age_min,
        "age_max": age_max,
        "age_min_strict": age_min_strict,
        "age_max_strict": age_max_strict,
        "age_assumed": age_assumed,
        "normal": bool(NORMAL_RE.search(label)) and not bool(NOT_NORMAL_RE.search(label)),
    }


def clean_label(s: str) -> str:
    t = re.sub(r"[:;,|()[\]=]", " ", s)
    t = re.sub(r"\b(and|or)\b", " ", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip()


def parse_bands(ref_text: str, unit: str | None = None) -> list[Band]:
    s = strip_unit_tokens(clean_text(ref_text).lower())
    u = unit.strip().lower() if unit else ""
    if u and len(u) >= 2:
        esc = re.escape(u)
        s = re.sub(rf"(^|[^a-z]){esc}(?=$|[^a-z])", r"\1 ", s)

    ages: list[AgeTok] = []

    def repl1(m):
        ages.append(AgeTok(min=float(m.group(1)), max=float(m.group(2)), min_strict=False, max_strict=False, text=m.group(0).strip()))
        return f" __age{chr(96 + len(ages))}__ "

    def repl2(m):
        op = m.group(1)
        ages.append(AgeTok(min=float(m.group(2)), max=None, min_strict=(op != ">="), max_strict=False, text=m.group(0).strip()))
        return f" __age{chr(96 + len(ages))}__ "

    def repl3(m):
        op = m.group(1)
        strict = op in ("<", "below", "under", "less than")
        ages.append(AgeTok(min=None, max=float(m.group(2)), min_strict=False, max_strict=strict, text=m.group(0).strip()))
        return f" __age{chr(96 + len(ages))}__ "

    s = re.sub(rf"(?:age\s*)?(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*{AGE_UNIT}", repl1, s, flags=re.I)
    s = re.sub(rf"(?:age\s*)?(>=|>|above|over|more than|greater than)\s*(\d+(?:\.\d+)?)\s*{AGE_UNIT}", repl2, s, flags=re.I)
    s = re.sub(rf"(?:age\s*)?(<=|<|below|under|less than|up ?to)\s*(\d+(?:\.\d+)?)\s*{AGE_UNIT}", repl3, s, flags=re.I)

    re_pat = re.compile(rf"{CMP}\s*:?\s*({NUM})|({NUM})\s*(?:-|to)\s*({NUM})|({NUM})", re.I)
    matches = list(re_pat.finditer(s))
    if not matches:
        return []

    def between(from_pos: int, to_pos: int) -> str:
        return clean_label(s[from_pos:to_pos])

    prefix = []
    for i, m in enumerate(matches):
        start = 0 if i == 0 else matches[i - 1].end()
        prefix.append(between(start, m.start()))

    trailing = between(matches[-1].end(), len(s))
    suffix_style = len(matches) > 1 and prefix[0] == "" and trailing != "" and all(p != "" for p in prefix[1:])
    labels = prefix[1:] + [trailing] if suffix_style else prefix

    bands = []
    for i, m in enumerate(matches):
        rng: ParsedRange | None = None
        if m.group(1) is not None and m.group(2) is not None:
            rng = cmp_range(m.group(1), float(m.group(2)))
        elif m.group(3) is not None and m.group(4) is not None:
            low = float(m.group(3))
            high = float(m.group(4))
            rng = ParsedRange(low=low, high=high, low_strict=False, high_strict=False) if low <= high else None
        lbl = labels[i] if i < len(labels) else ""
        resolved_lbl = re.sub(r"__age([a-z])__", lambda x: ages[ord(x.group(1)) - 97].text if ord(x.group(1)) - 97 < len(ages) else "", lbl)
        info = _label_info(lbl, ages)
        bands.append(Band(label=resolved_lbl, text=m.group(0).strip(), range=rng, **info))

    return bands


def within(v: float, r: ParsedRange) -> bool:
    if r.low is not None and (v <= r.low if r.low_strict else v < r.low):
        return False
    if r.high is not None and (v >= r.high if r.high_strict else v > r.high):
        return False
    return True


def age_fits(b: Band, age: float) -> bool:
    if b.age_min is not None and (age <= b.age_min if b.age_min_strict else age < b.age_min):
        return False
    if b.age_max is not None and (age >= b.age_max if b.age_max_strict else age > b.age_max):
        return False
    return True


def has_age(b: Band) -> bool:
    return b.age_min is not None or b.age_max is not None


def describe(b: Band) -> str:
    parts = []
    if b.sex:
        parts.append("Male" if b.sex == "M" else "Female")
    if has_age(b):
        parts.append("adult" if (b.age_assumed and b.age_min is not None) else "child" if b.age_assumed else f"age {re.sub(r'\b(m|male|f|female)\b', '', b.label, flags=re.I).strip() or 'band'}")
    if not parts:
        return f'"{b.label}" band' if b.label else "Printed range"
    return f"{', '.join(parts)} range"


def classify(
    value_text: str | float | int | None,
    ref_text: str | None,
    unit: str | None = None,
    demo: Demographics | None = None,
) -> Classification:
    if demo is None:
        demo = Demographics()
    v = parse_value(value_text)
    out = Classification(
        status="REVIEW_REQUIRED",
        value_type="NUMERIC" if v and v.kind == "NUM" else "QUALITATIVE" if v and v.kind == "QUAL" else "TEXT",
        value_num=v.num if v and v.kind == "NUM" else None,
        qualifier=v.qualifier if v and v.kind == "NUM" and v.qualifier else None,
        ref_low=None,
        ref_high=None,
        applicable_range=None,
        range_basis=None,
        matched_band=None,
        unit_used=unit.strip() if unit and unit.strip() else None,
        unit_check="NOT_STATED" if unit and unit.strip() else "MISSING",
        reasons=[],
    )

    def review(why: str) -> Classification:
        out.status = "REVIEW_REQUIRED"
        out.reasons.append(why)
        return out

    if not v:
        return review("No result value.")
    ref = clean_text(ref_text) if ref_text and ref_text.strip() else ""
    if not ref:
        return review("No reference range is printed for this result; it is not assumed to be normal.")

    bands = parse_bands(ref, unit)
    if not bands:
        out.applicable_range = ref
        out.range_basis = "Printed expected result"
        out.unit_check = "NOT_STATED"
        if v.kind == "NUM":
            return review(f'Numeric result but the printed reference "{ref}" is not numeric.')
        expected = qual_group(ref)
        if v.kind == "QUAL" and expected:
            if v.group == expected:
                out.status = "IN_RANGE"
                return out
            return review(f'Result "{v.text}" differs from the expected "{ref}" printed by the laboratory.')
        if v.text.lower() == ref.lower():
            out.status = "IN_RANGE"
            return out
        return review(f'Text result "{v.text}"; compare with the printed reference "{ref}".')

    # Unit checks
    tokens = unit_tokens(clean_text(ref_text or ""))
    distinct = list({norm_unit(t) for t in tokens if norm_unit(t)})
    if tokens:
        if not unit or not unit.strip():
            if len(distinct) > 1 and not all(same_unit(t, tokens[0]) for t in tokens):
                return review("No unit on the result and the range mentions several units.")
            out.unit_used = tokens[0].strip()
            out.unit_check = "ADOPTED_FROM_RANGE"
            out.reasons.append(f"No unit printed next to the result; the range's unit ({tokens[0].strip()}) was used.")
        elif not all(same_unit(t, unit) for t in tokens):
            out.unit_check = "MISMATCH"
            unique_toks = list(dict.fromkeys(tokens))
            return review(f'Unit "{unit}" differs from the unit in the printed range ({", ".join(unique_toks)}); values were not compared.')
        else:
            out.unit_check = "MATCH"
    elif not unit or not unit.strip():
        out.reasons.append("No unit printed for this result or its range.")

    val_num = v.num if v.kind == "NUM" else None
    demographic = any(b.sex or has_age(b) for b in bands)
    applicable: Band | None = None

    if len(bands) == 1 and not demographic:
        applicable = bands[0]
    elif demographic:
        if any(not b.sex and not has_age(b) for b in bands):
            return review(f'The printed ranges mix labelled and unlabelled bands: "{ref}".')
        if any(b.sex for b in bands) and not demo.sex:
            return review("The printed range depends on sex, which is not recorded for this patient.")
        if any(has_age(b) for b in bands) and demo.age_years is None:
            return review("The printed range depends on age, which is not recorded for this patient.")
        fits = [b for b in bands if (not b.sex or b.sex == demo.sex) and (not has_age(b) or age_fits(b, demo.age_years))]
        if len(fits) != 1:
            return review(f'No single printed range matches this patient ({demo.sex or "?"}, {demo.age_years if demo.age_years is not None else "?"} years): "{ref}".')
        applicable = fits[0]
        if applicable.age_assumed:
            out.reasons.append(f'"{applicable.label}" read as {"18 years and over" if applicable.age_min is not None else "under 18 years"}.')
    else:
        if val_num is not None:
            match = next((b for b in bands if b.range and within(val_num, b.range)), None)
            out.matched_band = match.label if match else None
        normals = [b for b in bands if b.normal]
        if len(normals) != 1:
            matched_msg = f' The value falls in the "{out.matched_band}" band as printed.' if out.matched_band else ""
            return review(f'Several category ranges are printed and none is marked as the normal band: "{ref}".{matched_msg}')
        applicable = normals[0]

    out.applicable_range = f"{applicable.label}: {applicable.text}" if applicable.label and len(bands) > 1 else applicable.text
    out.range_basis = (f'"{applicable.label}" range' if applicable.label else "Printed range") if len(bands) == 1 and not demographic else describe(applicable)

    if not applicable.range:
        return review(f'The printed range "{applicable.text}" cannot be read.')
    out.ref_low = applicable.range.low
    out.ref_high = applicable.range.high

    if v.kind != "NUM":
        return review(f'Text result "{v.text}" against a numeric range.')

    r = applicable.range
    if v.qualifier == "":
        out.status = "IN_RANGE" if within(v.num, r) else "LOW" if (r.low is not None and (v.num <= r.low if r.low_strict else v.num < r.low)) else "HIGH"
        return out

    if v.qualifier.startswith("<"):
        if r.low is not None and v.num <= r.low:
            out.status = "LOW"
        elif r.low is None and r.high is not None and v.num <= r.high:
            out.status = "IN_RANGE"
        else:
            return review(f'"{value_text}" may be inside or outside the range {applicable.text}.')
        return out

    if r.high is not None and v.num >= r.high:
        out.status = "HIGH"
    elif r.high is None and r.low is not None and v.num >= r.low:
        out.status = "IN_RANGE"
    else:
        return review(f'"{value_text}" may be inside or outside the range {applicable.text}.')
    return out


def explain(status: Status, marker: str, value: str, unit: str | None, applicable: str | None, reasons: list[str]) -> str:
    v = f"{value} {unit}" if unit else value
    if status == "LOW":
        return f"{marker} {v} is below the laboratory's stated range ({applicable}). A result outside the range does not by itself confirm a condition; the doctor will review it."
    if status == "HIGH":
        return f"{marker} {v} is above the laboratory's stated range ({applicable}). A result outside the range does not by itself confirm a condition; the doctor will review it."
    if status == "IN_RANGE":
        return f"{marker} {v} is within the laboratory's stated range ({applicable})."
    first = reasons[0] if reasons else "the result could not be compared reliably."
    return f"{marker} {v} needs manual review: {first}"


def age_years(age_text: str | None, dob: str | None = None, on_date: str | None = None) -> float | None:
    if age_text:
        t = age_text.lower()
        y = re.search(r"(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years)\b", t)
        if y:
            return float(y.group(1))
        mo = re.search(r"(\d+)\s*(?:m|mo|mon|month|months)\b", t)
        if mo:
            return math.floor((float(mo.group(1)) / 12) * 10) / 10
        d = re.search(r"(\d+)\s*(?:d|day|days)\b", t)
        if d:
            return 0.0
        bare = re.match(r"^\s*(\d{1,3})\s*$", t)
        if bare:
            return float(bare.group(1))
    if dob and on_date and re.match(r"^\d{4}-\d{2}-\d{2}$", dob) and re.match(r"^\d{4}-\d{2}-\d{2}$", on_date):
        a = int(on_date[:4]) - int(dob[:4])
        if on_date[5:] < dob[5:]:
            a -= 1
        return float(a) if a >= 0 else None
    return None


def sex_of(gender: str | None) -> str | None:
    g = (gender or "").strip().lower()
    if re.match(r"^(m|male|man)$", g):
        return "M"
    if re.match(r"^(f|female|woman)$", g):
        return "F"
    return None
