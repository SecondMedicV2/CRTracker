"""Longitudinal trend analytics ported from SM-Report-Analyzer (trends.ts).
Strict, non-diagnostic clinical summaries.
Direction UP / DOWN / STABLE / NOT_COMPARABLE.
units_differ blocks the comparison."""
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
import math

from .biomarkers import marker_category, marker_label
from .units import same_unit


@dataclass
class TrendPoint:
    date: str
    value: float | None
    value_text: str
    unit: str | None
    ref_text: str | None = None
    ref_low: float | None = None
    ref_high: float | None = None
    status: str = "IN_RANGE"  # IN_RANGE | LOW | HIGH | REVIEW_REQUIRED
    report_id: str | int | None = None
    lab: str | None = None
    lab_report_ref: str | None = None


@dataclass
class MarkerTrend:
    code: str
    label: str
    category: str
    units: list[str]
    units_differ: bool
    out_of_range: int
    latest: TrendPoint | None
    previous: TrendPoint | None
    direction: str | None  # UP | DOWN | STABLE | NOT_COMPARABLE | None
    delta: float | None
    percent_change: float | None
    summary: str
    points: list[TrendPoint] = field(default_factory=list)


STANDARD_PANELS = [
    {"id": "THYROID", "label": "Thyroid Profile", "category": "THYROID", "markers": ["TSH", "FT3", "FT4", "T3", "T4"]},
    {"id": "LIPID", "label": "Lipid Profile", "category": "LIPID", "markers": ["CHOL", "TG", "HDL", "LDL", "VLDL", "NON_HDL", "CHOL_TC_HDL", "CHOL_LDL_HDL", "TG_HDL"]},
    {"id": "GLUCOSE", "label": "Blood Glucose / HbA1c", "category": "GLUCOSE", "markers": ["HBA1C", "GLU_F", "GLU_PP", "GLU_R", "EAG"]},
    {"id": "BLOOD_COUNT", "label": "Complete Blood Count", "category": "BLOOD_COUNT", "markers": ["HB", "RBC", "WBC", "PLT", "PCV", "MCV", "MCH", "MCHC", "RDW_CV", "RDW_SD", "ESR"]},
    {"id": "LIVER", "label": "Liver Function (LFT)", "category": "LIVER", "markers": ["ALT", "AST", "ALP", "GGT", "BILI_T", "BILI_D", "BILI_I", "ALB", "PROT"]},
    {"id": "KIDNEY", "label": "Kidney Function (KFT)", "category": "KIDNEY", "markers": ["CREAT", "UREA", "BUN", "EGFR", "URIC"]},
    {"id": "VITAMIN", "label": "Vitamins", "category": "VITAMIN", "markers": ["VITD", "B12", "FOLATE"]},
    {"id": "IRON", "label": "Iron Studies", "category": "IRON", "markers": ["FERRITIN", "IRON", "TIBC", "TSAT"]},
    {"id": "ELECTROLYTE", "label": "Electrolytes", "category": "ELECTROLYTE", "markers": ["SODIUM", "POTASSIUM", "CHLORIDE", "CALCIUM"]},
    {"id": "INFLAMMATION", "label": "Inflammation Markers", "category": "INFLAMMATION", "markers": ["CRP", "HSCRP", "ESR"]},
]


def compute_marker_trend(code: str, raw_name: str, points: list[TrendPoint]) -> MarkerTrend:
    label = marker_label(code, raw_name)
    category = marker_category(raw_name)
    units = list(dict.fromkeys(p.unit for p in points if p.unit))

    units_differ = False
    if len(units) > 1:
        for i in range(len(units)):
            for j in range(i + 1, len(units)):
                if not same_unit(units[i], units[j]):
                    units_differ = True
                    break
            if units_differ:
                break

    out_of_range = sum(1 for p in points if p.status in ("LOW", "HIGH"))

    if not points:
        return MarkerTrend(
            code=code,
            label=label,
            category=category,
            units=units,
            units_differ=False,
            out_of_range=0,
            latest=None,
            previous=None,
            direction=None,
            delta=None,
            percent_change=None,
            summary=f"No historical measurements recorded for {label}.",
            points=[],
        )

    if len(points) == 1:
        single = points[0]
        status_text = (
            "above laboratory reference range" if single.status == "HIGH"
            else "below laboratory reference range" if single.status == "LOW"
            else "within laboratory reference range"
        )
        u_str = f" {single.unit}" if single.unit else ""
        return MarkerTrend(
            code=code,
            label=label,
            category=category,
            units=units,
            units_differ=False,
            out_of_range=out_of_range,
            latest=single,
            previous=None,
            direction=None,
            delta=None,
            percent_change=None,
            summary=f"{label} was recorded as {single.value_text}{u_str} on {single.date} ({status_text}). Historical trend comparison will become available upon subsequent report uploads.",
            points=points,
        )

    latest = points[-1]
    previous = points[-2]

    comparable = (
        not units_differ
        and latest.value is not None
        and previous.value is not None
        and same_unit(latest.unit, previous.unit)
    )

    direction = "NOT_COMPARABLE"
    delta = None
    percent_change = None

    if comparable and latest.value is not None and previous.value is not None:
        delta = round((latest.value - previous.value) * 1000) / 1000
        if abs(delta) < 0.001:
            direction = "STABLE"
        elif delta > 0:
            direction = "UP"
        else:
            direction = "DOWN"
        if previous.value != 0:
            percent_change = round(((latest.value - previous.value) / abs(previous.value)) * 1000) / 10

    if not comparable:
        summary = (
            f"{label} has {len(points)} measurements between {points[0].date} and {latest.date}, "
            f"but units or formats differ ({', '.join(units)}). These values cannot be combined directly "
            f"and should be reviewed by the treating clinician in the context of the patient's medical history "
            f"and laboratory reference ranges."
        )
    else:
        dir_word = "increased" if direction == "UP" else "decreased" if direction == "DOWN" else "remained stable"
        u_str = f" {latest.unit}" if latest.unit else ""
        if direction == "STABLE":
            change_detail = f"remained stable at {latest.value_text}{u_str}"
        else:
            change_detail = f"{dir_word} from {previous.value_text} ({previous.date}) to {latest.value_text}{u_str} ({latest.date})"
        status_note = (
            " (above laboratory reference range)" if latest.status == "HIGH"
            else " (below laboratory reference range)" if latest.status == "LOW"
            else " (within laboratory reference range)"
        )
        summary = f"{label} {change_detail}{status_note}. These values should be reviewed by the treating clinician in the context of the patient's medical history and laboratory reference ranges."

    return MarkerTrend(
        code=code,
        label=label,
        category=category,
        units=units,
        units_differ=units_differ,
        out_of_range=out_of_range,
        latest=latest,
        previous=previous,
        direction=direction,
        delta=delta,
        percent_change=percent_change,
        summary=summary,
        points=points,
    )
