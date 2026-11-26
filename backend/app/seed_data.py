"""STARTER medical content (Part 11). Not clinically approved: every rule set is seeded
as pending sign-off and is editable by an admin. A doctor must review before production."""

# Fallback ranges, used only when the report prints no range. Lab range always wins.
# Bands are [label, lo, hi] with hi exclusive; None = open ended. sex-specific where noted.
REFERENCE_RANGES = {
    "HBA1C": {"unit": "%", "bands": [["normal", None, 5.7], ["prediabetes", 5.7, 6.5], ["diabetes_range", 6.5, None]]},
    "GLUCOSE_FASTING": {"unit": "mg/dL", "bands": [["normal", 70, 100], ["prediabetes", 100, 126], ["diabetes_range", 126, None]]},
    "GLUCOSE_PP": {"unit": "mg/dL", "bands": [["normal", None, 140], ["prediabetes", 140, 200], ["diabetes_range", 200, None]]},
    "CHOL_TOTAL": {"unit": "mg/dL", "bands": [["desirable", None, 200], ["high", 200, None]]},
    "LDL": {"unit": "mg/dL", "bands": [["optimal", None, 100], ["near_optimal", 100, 130], ["borderline", 130, 160], ["high", 160, None]]},
    "HDL": {"unit": "mg/dL", "low_below": {"M": 40, "F": 50}},
    "TRIGLYCERIDES": {"unit": "mg/dL", "bands": [["normal", None, 150], ["borderline", 150, 200], ["high", 200, 500], ["very_high", 500, None]]},
    "HEMOGLOBIN": {"unit": "g/dL", "low_below": {"M": 13, "F": 12}},
    "VITAMIN_D": {"unit": "ng/mL", "bands": [["deficient", None, 20], ["insufficient", 20, 30], ["sufficient", 30, None]]},
    "EGFR": {"unit": "mL/min/1.73m2", "bands": [["abnormal", None, 60], ["normal", 60, None]]},
}

# Test catalogue: our own codes. Thyrocare product codes and prices are TBD (Q13).
TEST_CATALOGUE = [
    {"code": "HBA1C", "name": "HbA1c"},
    {"code": "FBS", "name": "Fasting Blood Sugar"},
    {"code": "PPBS", "name": "Post-Prandial Blood Sugar"},
    {"code": "LIPID", "name": "Lipid Profile"},
    {"code": "THYROID", "name": "Thyroid Profile"},
    {"code": "TSH", "name": "TSH"},
    {"code": "FT4", "name": "Free T4"},
    {"code": "CBC", "name": "Complete Blood Count"},
    {"code": "RETIC", "name": "Reticulocytes"},
    {"code": "IRON", "name": "Iron Studies"},
    {"code": "VITD", "name": "Vitamin D"},
    {"code": "CALCIUM", "name": "Calcium"},
    {"code": "B12", "name": "Vitamin B12"},
    {"code": "KFT", "name": "Kidney Function Test"},
    {"code": "ELECTROLYTES", "name": "Electrolytes"},
    {"code": "URINE_ROUTINE", "name": "Urine Routine"},
    {"code": "UACR", "name": "Urine Albumin-to-Creatinine Ratio"},
    {"code": "LFT", "name": "Liver Function Test"},
]

# Triggers name canonical params; trigger rules are evaluated in Phase 5.
BUCKETS = [
    {"code": "DIABETES", "name": "Diabetes / Prediabetes", "params": ["HBA1C", "GLUCOSE_FASTING", "GLUCOSE_PP"], "interval_days": 90, "priority": "ROUTINE", "retest": ["HBA1C", "FBS", "PPBS"]},
    {"code": "LIPID", "name": "Lipid / Cardio risk", "params": ["TRIGLYCERIDES", "LDL", "HDL", "CHOL_TOTAL"], "interval_days": 90, "priority": "ROUTINE", "retest": ["LIPID"]},
    {"code": "THYROID", "name": "Thyroid", "params": ["TSH", "FT3", "FT4"], "interval_days": 90, "priority": "ROUTINE", "retest": ["THYROID"]},
    {"code": "ANAEMIA", "name": "Anaemia / Iron", "params": ["HEMOGLOBIN", "FERRITIN", "IRON", "TIBC"], "interval_days": 90, "priority": "ROUTINE", "retest": ["CBC", "IRON"]},
    {"code": "VIT_D_B12", "name": "Vitamin D / B12", "params": ["VITAMIN_D", "B12"], "interval_days": 90, "priority": "ROUTINE", "retest": ["VITD", "B12"]},
    {"code": "KIDNEY", "name": "Kidney", "params": ["CREATININE", "UREA", "EGFR", "URIC_ACID", "UACR"], "interval_days": 90, "priority": "ROUTINE", "retest": ["KFT"]},
    {"code": "LIVER", "name": "Liver", "params": ["SGOT", "SGPT", "ALP", "BILIRUBIN"], "interval_days": 90, "priority": "ROUTINE", "retest": ["LFT"]},
    {"code": "CANCER_MARKER", "name": "Cancer markers", "params": ["PSA", "CA125", "CEA"], "interval_days": 0, "priority": "ESCALATION", "only_direction": "HIGH", "retest": []},
    {"code": "HYPERTENSION", "name": "Hypertension", "params": [], "interval_days": 90, "priority": "ROUTINE", "retest": [], "source": "health_profile", "note": "starter value, clinician to confirm"},
    {"code": "BONE", "name": "Bone health", "params": [], "interval_days": 90, "priority": "ROUTINE", "retest": ["VITD"], "source": "health_profile", "note": "starter value, clinician to confirm"},
    {"code": "OTHER", "name": "Other abnormal", "params": [], "interval_days": 90, "priority": "ROUTINE", "retest": []},
]

# Alias -> canonical code. Admin extends this as new lab spellings appear.
ALIASES = {
    "glycosylated hemoglobin": "HBA1C", "hba1c": "HBA1C", "a1c": "HBA1C",
    "fasting blood sugar": "GLUCOSE_FASTING", "fbs": "GLUCOSE_FASTING", "glucose fasting": "GLUCOSE_FASTING",
    "post prandial glucose": "GLUCOSE_PP", "ppbs": "GLUCOSE_PP",
    "random blood sugar": "GLUCOSE_RANDOM", "rbs": "GLUCOSE_RANDOM", "random glucose": "GLUCOSE_RANDOM",
    "total cholesterol": "CHOL_TOTAL", "cholesterol total": "CHOL_TOTAL",
    "ldl cholesterol": "LDL", "ldl": "LDL", "hdl cholesterol": "HDL", "hdl": "HDL",
    "non-hdl": "NON_HDL", "non hdl": "NON_HDL", "non-hdl cholesterol": "NON_HDL",
    "triglycerides": "TRIGLYCERIDES", "tg": "TRIGLYCERIDES",
    "haemoglobin": "HEMOGLOBIN", "hemoglobin": "HEMOGLOBIN", "hb": "HEMOGLOBIN",
    "tsh": "TSH", "t3": "T3", "total t3": "T3", "t4": "T4", "total t4": "T4",
    "ft3": "FT3", "free t3": "FT3", "ft4": "FT4", "free t4": "FT4",
    "creatinine": "CREATININE", "urea": "UREA", "uric acid": "URIC_ACID",
    "uacr": "UACR", "urine albumin": "UACR", "microalbumin": "UACR",
    "urine microalbumin": "UACR", "urine albumin creatinine ratio": "UACR",
    "sgot": "SGOT", "ast": "SGOT", "sgpt": "SGPT", "alt": "SGPT",
    "alp": "ALP", "alkaline phosphatase": "ALP", "ggt": "GGT",
    "bilirubin": "BILIRUBIN", "total bilirubin": "BILIRUBIN", "albumin": "ALBUMIN", "serum albumin": "ALBUMIN",
    "vitamin d": "VITAMIN_D", "25-oh vitamin d": "VITAMIN_D", "egfr": "EGFR",
    "vitamin b12": "B12", "b12": "B12", "folate": "FOLATE", "folic acid": "FOLATE",
    "ferritin": "FERRITIN", "calcium": "CALCIUM", "magnesium": "MAGNESIUM", "serum magnesium": "MAGNESIUM",
    "iron": "IRON", "serum iron": "IRON", "tibc": "TIBC",
    "mcv": "MCV", "mch": "MCH", "mchc": "MCHC", "rdw": "RDW_CV", "rdw-cv": "RDW_CV",
    "amh": "AMH", "anti mullerian hormone": "AMH",
    "lh": "LH", "luteinizing hormone": "LH",
    "fsh": "FSH", "follicle stimulating hormone": "FSH",
    "prolactin": "PROLACTIN", "prl": "PROLACTIN",
    "testosterone": "TESTOSTERONE", "total testosterone": "TESTOSTERONE",
    "beta hcg": "BETA_HCG", "beta-hcg": "BETA_HCG", "hcg": "BETA_HCG",
}

# Business weights from Part 11.4; tiers HIGH>=65, MEDIUM 40-64, LOW<40.
SCORE_WEIGHTS = {
    "severity": {"mild": 10, "moderate": 20, "severe": 30},
    "time_ratio": [[0.8, 0], [1.0, 10], [1.5, 20], [None, 25]],  # [upper bound (exclusive), points]
    "trend": {"worsening": 20, "stable_abnormal": 10, "improving": 5, "none": 0},
    "buckets": {"1": 5, "2": 10, "3+": 15},
    "engagement_bonus": 10,
    "tiers": {"HIGH": 65, "MEDIUM": 40},
}

# Severity = distance outside the limit, as % of the limit. Starter values, clinician to confirm.
SEVERITY = {"mild_max_pct": 10, "moderate_max_pct": 25}

# Deliberately empty: never invent critical values (Q5 blocker).
# Entry format once a doctor supplies them: {"param_code": "...", "below": number or null, "above": number or null}
CRITICAL_VALUES: list = []

from .seed_programs import (CARE_PROGRAMS, DIAGNOSTIC_FINDINGS, DRUG_NUTRIENT_RULES, MEDICINE_CATALOGUE, PROFILE_CODES,  # noqa: E402
                            RECOMMENDATION_COMBINATIONS, REFERRAL_SPECIALTIES, RELATIONSHIP_NEXT_STEPS)
from .seed_scripts import CALLER_FORBIDDEN, SCRIPT_TEMPLATES  # noqa: E402

RETEST_PROTOCOLS = [
    {
        "finding_code": "LOW_VITD",
        "finding_name": "Low Vitamin D",
        "timeframe_text": "8\u201312 weeks if retesting is indicated",
        "tests_text": "25-OH Vitamin D; calcium when appropriate",
        "considerations_text": "Routine retesting is not necessary for every patient. Consider after treatment in selected patients, particularly those at higher risk.",
        "ami_reminder_text": "Day 60\u201390",
        "requires_indication": True,
        "variants": [
            {"when": "indicated", "window_min_days": 56, "window_max_days": 84, "anchor": "TREATMENT_START"},
            {"when": "default", "window_min_days": None, "window_max_days": None, "anchor": "REPORT_DATE", "mode": "REQUIRES_INDICATION"},
        ],
        "tests": [{"code": "VITD", "optional": False}, {"code": "CALCIUM", "optional": True}],
        "reminder": {"mode": "FIXED", "day_min": 60, "day_max": 90},
    },
    {
        "finding_code": "HIGH_HBA1C",
        "finding_name": "Elevated HbA1c",
        "timeframe_text": "3 months if treatment changes or glucose targets are unmet; 6 months if stable and at goal",
        "tests_text": "HbA1c; glucose as indicated",
        "considerations_text": "HbA1c reflects approximately 2\u20133 months of glycemic exposure.",
        "ami_reminder_text": "Day 90",
        "variants": [
            {"when": "treatment_changed", "window_min_days": 90, "window_max_days": 90, "anchor": "TREATMENT_CHANGE"},
            {"when": "targets_unmet", "window_min_days": 90, "window_max_days": 90, "anchor": "REPORT_DATE"},
            {"when": "stable_at_goal", "window_min_days": 180, "window_max_days": 180, "anchor": "REPORT_DATE"},
            {"when": "default", "window_min_days": 90, "window_max_days": 90, "anchor": "REPORT_DATE"},
        ],
        "tests": [{"code": "HBA1C", "optional": False}, {"code": "FBS", "optional": True}],
        "reminder": {"mode": "FIXED", "day_min": 90, "day_max": 90},
    },
    {
        "finding_code": "HIGH_CHOLESTEROL",
        "finding_name": "Elevated cholesterol",
        "timeframe_text": "4\u201312 weeks after starting/changing lipid-lowering treatment; otherwise individualized",
        "tests_text": "Lipid profile",
        "considerations_text": "Stable patients on treatment generally require monitoring every 3\u201312 months.",
        "ami_reminder_text": "Day 30\u201390",
        "signoff_note": "Clinical team check: timeframe says 4\u201312 weeks (28\u201384 days) while AMI reminder says Day 30\u201390. Both preserved as written; confirm alignment during sign-off.",
        "variants": [
            {"when": "treatment_changed", "window_min_days": 28, "window_max_days": 84, "anchor": "TREATMENT_CHANGE"},
            {"when": "default", "window_min_days": None, "window_max_days": None, "anchor": "REPORT_DATE", "mode": "INDIVIDUALIZED"},
        ],
        "tests": [{"code": "LIPID", "optional": False}],
        "reminder": {"mode": "FIXED", "day_min": 30, "day_max": 90},
    },
    {
        "finding_code": "HIGH_TSH",
        "finding_name": "Elevated TSH",
        "timeframe_text": "6\u20138 weeks after starting/changing levothyroxine; otherwise individualized",
        "tests_text": "TSH; free T4 when indicated",
        "considerations_text": "Mild untreated abnormalities may need confirmation before treatment.",
        "ami_reminder_text": "Day 45\u201360",
        "variants": [
            {"when": "treatment_changed", "window_min_days": 42, "window_max_days": 56, "anchor": "TREATMENT_CHANGE"},
            {"when": "default", "window_min_days": None, "window_max_days": None, "anchor": "REPORT_DATE", "mode": "INDIVIDUALIZED"},
        ],
        "tests": [{"code": "TSH", "optional": False}, {"code": "FT4", "optional": True}],
        "reminder": {"mode": "FIXED", "day_min": 45, "day_max": 60},
    },
    {
        "finding_code": "LOW_HB",
        "finding_name": "Low hemoglobin",
        "timeframe_text": "2\u20134 weeks after initiating treatment for confirmed iron-deficiency anemia",
        "tests_text": "CBC/Hb; reticulocytes when indicated",
        "considerations_text": "Investigate the cause of anemia. Severe anemia or concerning symptoms require earlier evaluation.",
        "ami_reminder_text": "Day 14\u201328",
        "variants": [
            {"when": "on_treatment", "window_min_days": 14, "window_max_days": 28, "anchor": "TREATMENT_START"},
            {"when": "default", "window_min_days": None, "window_max_days": None, "anchor": "REPORT_DATE", "mode": "DOCTOR_DECIDES"},
        ],
        "tests": [{"code": "CBC", "optional": False}, {"code": "RETIC", "optional": True}],
        "reminder": {"mode": "FIXED", "day_min": 14, "day_max": 28},
    },
    {
        "finding_code": "HIGH_CREATININE",
        "finding_name": "Elevated creatinine",
        "timeframe_text": "Within 48 hours to 2 weeks, depending on severity and context",
        "tests_text": "Creatinine, eGFR, electrolytes; urine tests as indicated",
        "considerations_text": "Possible acute kidney injury requires prompt evaluation and sometimes repeat testing within 24\u201348 hours or sooner.",
        "ami_reminder_text": "Risk-based",
        "variants": [
            {"when": "default", "window_min_days": 0, "window_max_days": 14, "anchor": "REPORT_DATE", "risk_based": True, "mode": "RISK_BASED"},
        ],
        "tests": [{"code": "KFT", "optional": False}, {"code": "ELECTROLYTES", "optional": False}, {"code": "URINE_ROUTINE", "optional": True}, {"code": "UACR", "optional": True}],
        "reminder": {"mode": "RISK_BASED"},
    },
    {
        "finding_code": "ABNORMAL_LFT",
        "finding_name": "Abnormal liver enzymes",
        "timeframe_text": "2\u20134 weeks for selected mild, stable abnormalities; sooner when clinically indicated",
        "tests_text": "Liver panel and cause-specific investigations",
        "considerations_text": "Do not delay investigation of significant abnormalities, jaundice or concerning symptoms merely to repeat the test.",
        "ami_reminder_text": "Day 14\u201328, if appropriate",
        "variants": [
            {"when": "mild_stable", "window_min_days": 14, "window_max_days": 28, "anchor": "REPORT_DATE"},
            {"when": "default", "window_min_days": None, "window_max_days": None, "anchor": "REPORT_DATE", "mode": "DOCTOR_DECIDES"},
        ],
        "tests": [{"code": "LFT", "optional": False}],
        "reminder": {"mode": "IF_APPROPRIATE", "day_min": 14, "day_max": 28},
    },
    {
        "finding_code": "OBESITY_METABOLIC",
        "finding_name": "Obesity with metabolic abnormalities",
        "timeframe_text": "3 months for HbA1c when indicated; lipid follow-up based on treatment",
        "tests_text": "HbA1c, glucose, lipid profile as appropriate",
        "considerations_text": "Weight and BP can be monitored more frequently.",
        "ami_reminder_text": "Day 90",
        "variants": [
            {"when": "default", "window_min_days": 90, "window_max_days": 90, "anchor": "REPORT_DATE"},
        ],
        "tests": [{"code": "HBA1C", "optional": True}, {"code": "FBS", "optional": True}, {"code": "LIPID", "optional": True}],
        "reminder": {"mode": "FIXED", "day_min": 90, "day_max": 90},
    },
    {
        "finding_code": "MULTI_CHRONIC",
        "finding_name": "Multiple chronic conditions",
        "timeframe_text": "1\u20133 months, depending on conditions and treatment",
        "tests_text": "Disease-specific tests",
        "considerations_text": "Each condition requires its own monitoring schedule.",
        "ami_reminder_text": "Personalized",
        "variants": [
            {"when": "default", "window_min_days": 30, "window_max_days": 90, "anchor": "REPORT_DATE", "personalized": True, "mode": "PERSONALIZED"},
        ],
        "tests": [],
        "reminder": {"mode": "PERSONALIZED"},
    },
    {
        "finding_code": "NORMAL_WITH_RISK",
        "finding_name": "Normal report with risk factors",
        "timeframe_text": "6\u201312 months or longer, based on risk and screening guidelines",
        "tests_text": "Risk-appropriate preventive tests",
        "considerations_text": "Normal results do not automatically justify repeat testing at six months.",
        "ami_reminder_text": "Risk-based",
        "variants": [
            {"when": "default", "window_min_days": 180, "window_max_days": 365, "anchor": "REPORT_DATE", "risk_based": True, "mode": "RISK_BASED"},
        ],
        "tests": [],
        "reminder": {"mode": "RISK_BASED"},
    },
]


RULE_SETS = {
    "script_templates": SCRIPT_TEMPLATES,
    "caller_script_forbidden": CALLER_FORBIDDEN,
    "reference_ranges": REFERENCE_RANGES,
    "test_catalogue": TEST_CATALOGUE,
    "buckets": BUCKETS,
    "aliases": ALIASES,
    "score_weights": SCORE_WEIGHTS,
    "severity": SEVERITY,
    "critical_values": CRITICAL_VALUES,
    "relationship_next_steps": RELATIONSHIP_NEXT_STEPS,
    "profile_codes": PROFILE_CODES,
    "care_programs": CARE_PROGRAMS,
    "medicine_catalogue": MEDICINE_CATALOGUE,
    "drug_nutrient_rules": DRUG_NUTRIENT_RULES,
    "referral_specialties": REFERRAL_SPECIALTIES,
    "diagnostic_findings": DIAGNOSTIC_FINDINGS,
    "recommendation_combinations": RECOMMENDATION_COMBINATIONS,
    "retest_protocols": RETEST_PROTOCOLS,
}
