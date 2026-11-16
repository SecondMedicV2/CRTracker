"""Unit handling ported from SM-Report-Analyzer.
Values are compared with a range only when the units agree.
No silent conversions are done: a unit that differs from the range's unit
sends the result to manual review."""
import re

SAME: list[list[str]] = [
    ["10^6/ul", "mill/cumm", "million/cumm", "millions/cumm", "mil/cumm", "10^6/cumm", "10^12/l", "million/ul", "mill/ul", "m/ul"],
    ["10^3/ul", "thou/cumm", "thousand/cumm", "10^3/cumm", "10^9/l", "k/ul", "thou/ul", "1000/ul"],
    ["/cumm", "/ul", "cells/cumm", "cells/ul"],
    ["g/dl", "g%"],
    ["uiu/ml", "miu/l", "uu/ml"],
    ["u/l", "iu/l"],
    ["ng/ml", "ug/l"],
    ["pg/ml", "ng/l"],
    ["ug/dl", "mcg/dl"],
    ["fl", "femtolitre", "femtoliter"],
]

DENOM = r"(?:dl|l|ml|ul|µl|μl|cumm|cu\.?\s?mm|cmm|mm3|hpf|lpf|min|hr|h|kg|g|mol|mmol|1\.73\s?m2|m2|24\s?hrs?)"
UNIT_RE = re.compile(
    rf"(?:[x×*]\s*)?10\s*\^?\s*\d+\s*/\s*{DENOM}\b|[a-zµμ%][a-zµμ0-9%]*(?:\s*/\s*{DENOM}\b)+|%|\b(?:fl|pg|gm%|g%|lakhs?/cumm)(?![a-z])",
    re.IGNORECASE,
)


def norm_unit(u: str | None) -> str | None:
    """Lower-case, unify micro signs / powers / 'cu mm' spellings, drop spaces."""
    if not u:
        return None
    s = u.strip().lower()
    if not s:
        return None
    s = re.sub(r"[µμ]", "u", s)
    s = re.sub(r"\bmc(?=g\b|g/|mol)", "u", s)  # mcg -> ug
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[×x*]10", "10", s)
    s = s.replace("³", "^3").replace("⁶", "^6").replace("⁹", "^9")
    s = re.sub(r"10(\d)(?=/)", r"10^\1", s)  # 103/ul -> 10^3/ul
    s = re.sub(r"cu\.?mm|cmm|mm3", "cumm", s)
    s = re.sub(r"^gms?(?=/|%|$)", "g", s)
    s = re.sub(r"^gm%$", "g%", s)
    return s


def same_unit(a: str | None, b: str | None) -> bool:
    """Check if two unit spellings mean the exact same unit."""
    x = norm_unit(a)
    y = norm_unit(b)
    if not x or not y:
        return False
    if x == y:
        return True
    return any(x in group and y in group for group in SAME)


def unit_tokens(text: str) -> list[str]:
    """Unit tokens printed inside a reference-range text."""
    if not text:
        return []
    return [m.group(0) for m in UNIT_RE.finditer(text)]


def strip_unit_tokens(text: str) -> str:
    """Replace unit tokens inside text with single spaces."""
    if not text:
        return ""
    return UNIT_RE.sub(" ", text)
