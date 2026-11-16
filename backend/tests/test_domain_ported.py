"""Ported domain test cases from SM-Report-Analyzer (domain.test.ts).
Verifies:
- Printed-range classification against laboratory reference text
- Sex/age bands
- < / > and qualitative results
- Unit mismatch -> REVIEW_REQUIRED
- Missing range is never treated as normal
- Canonical marker codes and categories
- Trend direction, units_differ, and delta/% change
"""
import pytest

from app.biomarkers import marker_category, marker_code, marker_info, marker_label
from app.classify import (
    Demographics,
    age_years,
    classify,
    parse_bands,
    parse_value,
    sex_of,
)
from app.trends import TrendPoint, compute_marker_trend
from app.units import norm_unit, same_unit, unit_tokens

NONE = Demographics(sex=None, age_years=None)
MAN42 = Demographics(sex="M", age_years=42.0)
WOMAN70 = Demographics(sex="F", age_years=70.0)


@pytest.mark.parametrize(
    "value, ref, unit, demo, expected_status",
    [
        # single printed ranges
        ("11.0", "13.0 - 17.0", "g/dL", NONE, "LOW"),
        ("11.0", "13-17 g/dL", "g/dL", NONE, "LOW"),
        ("15.5", "11.6 – 14.0", "%", NONE, "HIGH"),
        ("155", "150 - 410", "10^3/µL", NONE, "IN_RANGE"),
        ("155000", "150,000 - 410,000", None, NONE, "IN_RANGE"),
        ("1,55,000", "150000 - 410000", None, NONE, "REVIEW_REQUIRED"),  # Indian grouping not guessed
        ("210", "< 200", "mg/dL", NONE, "HIGH"),
        ("200", "< 200", "mg/dL", NONE, "HIGH"),
        ("199", "Up to 200", "mg/dL", NONE, "IN_RANGE"),
        ("35", "> 40", "mg/dL", NONE, "LOW"),
        ("45", ">40", "mg/dL", NONE, "IN_RANGE"),
        # less-than / greater-than results
        ("<0.5", "0.27 - 4.20", "µIU/mL", NONE, "REVIEW_REQUIRED"),
        ("<0.1", "0.27 - 4.20", "µIU/mL", NONE, "LOW"),
        ("<5", "< 10", None, NONE, "IN_RANGE"),
        (">500", "150 - 410", None, NONE, "HIGH"),
        ("11.0 L", "13 - 17", None, NONE, "LOW"),
        # absent ranges are never "normal"
        ("12", "", None, NONE, "REVIEW_REQUIRED"),
        ("12", None, None, NONE, "REVIEW_REQUIRED"),
        # sex / age-specific ranges
        ("14", "Male: 13-17, Female: 12-15", "g/dL", NONE, "REVIEW_REQUIRED"),
        ("14", "Male: 13-17, Female: 12-15", "g/dL", MAN42, "IN_RANGE"),
        ("12.5", "Male: 13-17, Female: 12-15", "g/dL", MAN42, "LOW"),
        ("12.5", "M 13.0-17.0 F 12.0-15.5", "g/dL", WOMAN70, "IN_RANGE"),
        ("12.5", "13.0-17.0 Male, 12.0-15.5 Female", "g/dL", WOMAN70, "IN_RANGE"),
        ("6.0", "18-60 years: 0.5-4.5; >60 years: 0.5-8.9", "µIU/mL", WOMAN70, "IN_RANGE"),
        ("6.0", "18-60 years: 0.5-4.5; >60 years: 0.5-8.9", "µIU/mL", MAN42, "HIGH"),
        ("6.0", "18-60 years: 0.5-4.5; >60 years: 0.5-8.9", "µIU/mL", NONE, "REVIEW_REQUIRED"),
        ("2.0", "Adults: 0.27-4.2", "µIU/mL", MAN42, "IN_RANGE"),
        # category bands
        ("5.8", "Non-diabetic: < 5.7; Prediabetes: 5.7 - 6.4; Diabetes: >= 6.5", "%", NONE, "HIGH"),
        ("5.5", "Normal <5.7 %, Prediabetes 5.7-6.4 %, Diabetes >=6.5 %", "%", NONE, "IN_RANGE"),
        ("190", "Desirable: <200; Borderline high: 200-239; High: >=240", "mg/dL", NONE, "IN_RANGE"),
        ("110", "Optimal <100; Near optimal 100-129; Borderline high 130-159; High 160-189; Very high >=190", "mg/dL", NONE, "HIGH"),
        ("25", "Deficiency: <20, Insufficiency: 20-30, Sufficiency: 30-100, Toxicity: >100", "ng/mL", NONE, "LOW"),
        ("25", "Deficient <20; Insufficient 20-30; Toxic >100", "ng/mL", NONE, "REVIEW_REQUIRED"),
        # qualitative results
        ("Negative", "Negative", None, NONE, "IN_RANGE"),
        ("Non Reactive", "Non-Reactive", None, NONE, "IN_RANGE"),
        ("Positive", "Negative", None, NONE, "REVIEW_REQUIRED"),
        ("++", "Absent", None, NONE, "REVIEW_REQUIRED"),
        ("Pale yellow", "Pale yellow", None, NONE, "IN_RANGE"),
        ("Turbid", "Clear", None, NONE, "REVIEW_REQUIRED"),
        ("5", "Negative", None, NONE, "REVIEW_REQUIRED"),
        ("Negative", "0 - 5", None, NONE, "REVIEW_REQUIRED"),
        # units must agree before comparing
        ("130", "13.0 - 17.0 g/dL", "g/L", NONE, "REVIEW_REQUIRED"),
        ("4.28", "4.5 - 5.5 10^6/µL", "mill/cumm", NONE, "LOW"),
        ("2.1", "0.27 - 4.20 mIU/L", "µIU/mL", NONE, "IN_RANGE"),
        ("5.8", "< 5.7 %", None, NONE, "HIGH"),
    ],
)
def test_classification_against_printed_range(value, ref, unit, demo, expected_status):
    cls = classify(value, ref, unit, demo)
    assert cls.status == expected_status


def test_classify_details_and_reasons():
    a = classify("5.8", "Non-diabetic: < 5.7; Prediabetes: 5.7 - 6.4; Diabetes: >= 6.5", "%")
    assert a.applicable_range == "non-diabetic: < 5.7"
    assert a.ref_high == 5.7
    assert a.matched_band == "prediabetes"

    b = classify("12.5", "Male: 13-17, Female: 12-15", "g/dL", MAN42)
    assert b.applicable_range == "male: 13-17"
    assert b.range_basis == "Male range"
    assert b.ref_low == 13.0
    assert b.ref_high == 17.0

    assert any("depends on sex" in r for r in classify("14", "Male: 13-17, Female: 12-15", "g/dL").reasons)
    assert classify("130", "13.0 - 17.0 g/dL", "g/L").unit_check == "MISMATCH"
    assert classify("5.8", "< 5.7 %", None).unit_check == "ADOPTED_FROM_RANGE"
    assert any("not assumed to be normal" in r for r in classify("12", None, None).reasons)
    assert any("differs from the expected" in r for r in classify("Positive", "Negative", None).reasons)


def test_units_normalization_and_equivalence():
    assert same_unit("mill/cumm", "10^6/µL") is True
    assert same_unit("µIU/mL", "mIU/L") is True
    assert same_unit("gm/dL", "g/dl") is True
    assert same_unit("mcg/dL", "µg/dL") is True
    assert same_unit("g/dL", "g/L") is False
    assert same_unit("mg/dL", "mmol/L") is False
    assert norm_unit(" 10³/µL ") == "10^3/ul"
    assert [t.strip() for t in unit_tokens("13.0 - 17.0 g/dL")] == ["g/dL"]
    assert unit_tokens("Male: 13-17, Female: 12-15") == []


def test_demographics_helpers():
    assert sex_of("M") == "M"
    assert sex_of("Female") == "F"
    assert sex_of("Unknown Name") is None
    assert age_years("42 Y") == 42.0
    assert age_years("42 Yrs 3 M") == 42.0
    assert age_years("6 Months") == 0.5
    assert age_years(None, "1984-06-01", "2026-04-15") == 41.0
    assert age_years(None) is None


@pytest.mark.parametrize(
    "name, expected_code",
    [
        ("HbA1c", "HBA1C"),
        ("Glycosylated Haemoglobin (HbA1c)", "HBA1C"),
        ("Haemoglobin", "HB"),
        ("Hemoglobin (Hb)", "HB"),
        ("MCHC", "MCHC"),
        ("MCH", "MCH"),
        ("Free T3", "FT3"),
        ("T3 Total", "T3"),
        ("TSH - Ultrasensitive", "TSH"),
        ("25-OH Vitamin D", "VITD"),
        ("Absolute Eosinophil Count", "EOS_ABS"),
        ("LDL/HDL Ratio", "CHOL_LDL_HDL"),
        ("LDL Cholesterol - Direct", "LDL"),
        ("Urine Glucose", "U_GLUCOSE"),
        ("Vitamin K", "X:VITAMIN_K"),
    ],
)
def test_marker_canonical_codes(name, expected_code):
    assert marker_code(name) == expected_code


def test_marker_categories_and_info():
    assert marker_category("Amylase", "Pancreatic Profile") == "OTHER"
    assert marker_category("Apolipoprotein B", "Lipid Profile") == "LIPID"
    assert "thyroid" in (marker_info("TSH") or "").lower()


def test_trends_computation():
    p1 = TrendPoint(date="2026-01-01", value=12.0, value_text="12.0", unit="g/dL", status="LOW")
    p2 = TrendPoint(date="2026-03-01", value=13.5, value_text="13.5", unit="g/dL", status="IN_RANGE")
    t = compute_marker_trend("HB", "Haemoglobin", [p1, p2])
    assert t.direction == "UP"
    assert t.delta == 1.5
    assert t.percent_change == 12.5
    assert t.units_differ is False

    # Units differ -> NOT_COMPARABLE
    p3 = TrendPoint(date="2026-05-01", value=130.0, value_text="130.0", unit="g/L", status="IN_RANGE")
    t_diff = compute_marker_trend("HB", "Haemoglobin", [p1, p3])
    assert t_diff.units_differ is True
    assert t_diff.direction == "NOT_COMPARABLE"
    assert "units or formats differ" in t_diff.summary
