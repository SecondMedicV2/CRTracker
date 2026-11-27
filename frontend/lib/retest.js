/**
 * Retesting Schedule & 5 Urgency Tiers Engine (Pages 7 & 9).
 * Shared pure ES module used by Cloudflare Worker (worker.js) and parity tests.
 */
import {
  DEFAULT_DIAGNOSTIC_FINDINGS,
  DEFAULT_MEDICINE_CATALOGUE,
  DEFAULT_PROFILE_CODES,
  DONE_STAGES,
  addDaysIso,
  bpIsHigh,
  buildProgramContext,
  cleanProfile,
  detectFindingsInCtx,
  todayIstStr,
} from "./programs.js";

export const NON_AUTO_MODES = new Set([
  "REQUIRES_INDICATION",
  "RISK_BASED",
  "PERSONALIZED",
  "INDIVIDUALIZED",
  "DOCTOR_DECIDES",
]);

export const OVERRIDE_REASONS = [
  "CLINICAL_JUDGMENT",
  "TREATMENT_CHANGE",
  "PATIENT_PREFERENCE",
  "SYMPTOM_URGENCY",
  "OTHER",
];

export const TIER_ORDER = { URGENT: 1, EARLY: 2, TREATMENT_RESPONSE: 3, METABOLIC: 4, LONG_TERM: 5 };

export const DEFAULT_RETEST_TIERS = [
  {
    order: 1,
    code: "URGENT",
    label: "Urgent",
    window_text: "Same day to 48 hours, as clinically directed",
    window_min_days: 0,
    window_max_days: 2,
    details_text: "Critical abnormalities, suspected acute kidney injury",
    colour_token: "red",
    sla_hours: 24,
    caller_label: "Priority call today",
  },
  {
    order: 2,
    code: "EARLY",
    label: "Early follow-up",
    window_text: "1\u20134 weeks",
    window_min_days: 7,
    window_max_days: 28,
    details_text: "Selected anemia and liver conditions",
    colour_token: "teal",
    sla_hours: null,
    caller_label: "Follow-up call",
  },
  {
    order: 3,
    code: "TREATMENT_RESPONSE",
    label: "Treatment response",
    window_text: "4\u20138 weeks",
    window_min_days: 28,
    window_max_days: 56,
    details_text: "Lipid treatment, thyroid medication adjustments",
    colour_token: "navy blue",
    sla_hours: null,
    caller_label: "Follow-up call",
  },
  {
    order: 4,
    code: "METABOLIC",
    label: "Metabolic follow-up",
    window_text: "8\u201312 weeks",
    window_min_days: 56,
    window_max_days: 84,
    details_text: "HbA1c, selected vitamin deficiencies",
    colour_token: "amber",
    sla_hours: null,
    caller_label: "Follow-up call",
  },
  {
    order: 5,
    code: "LONG_TERM",
    label: "Long-term monitoring",
    window_text: "3\u201312 months or longer",
    window_min_days: 90,
    window_max_days: null,
    details_text: "Stable chronic disease and preventive screening",
    colour_token: "green",
    sla_hours: null,
    caller_label: "Follow-up call",
  },
];

const FINDING_DRUG_CLASSES = {
  HIGH_HBA1C: new Set(["BIGUANIDE", "SULFONYLUREA", "INSULIN"]),
  HIGH_CHOLESTEROL: new Set(["STATIN"]),
  HIGH_TSH: new Set(["THYROID_HORMONE"]),
  LOW_HB: new Set(["IRON_SUPPLEMENT"]),
  LOW_VITD: new Set(["VITAMIN_D_SUPPLEMENT"]),
};

const TREATMENT_FINDINGS = new Set(["HIGH_HBA1C", "HIGH_CHOLESTEROL", "HIGH_TSH", "LOW_HB"]);
const LFT_CODES = new Set(["SGOT", "AST", "SGPT", "ALT", "ALP", "GGT", "BILIRUBIN", "BILI_T"]);

const MED_KEYWORDS = {
  HIGH_HBA1C: ["metformin", "glimepiride", "gliclazide", "sitagliptin", "vildagliptin", "empagliflozin", "dapagliflozin", "insulin", "diabetes", "glycemic", "hba1c"],
  HIGH_CHOLESTEROL: ["statin", "atorvastatin", "rosuvastatin", "simvastatin", "pravastatin", "ezetimibe", "fenofibrate", "lipid", "cholesterol"],
  HIGH_TSH: ["levothyroxine", "thyroxine", "eltroxin", "thyronorm", "thyroid", "tsh"],
  LOW_HB: ["iron", "ferrous", "folic", "anemia", "anaemia", "orofert", "autrin", "hemoglobin"],
  LOW_VITD: ["vitamin d", "cholecalciferol", "ergocalciferol", "calcitriol", "vitd", "d3"],
};

export const DEFAULT_TEST_CATALOGUE_P7 = [
  { code: "HBA1C", name: "HbA1c" },
  { code: "FBS", name: "Fasting Blood Sugar" },
  { code: "PPBS", name: "Post-Prandial Blood Sugar" },
  { code: "LIPID", name: "Lipid Profile" },
  { code: "THYROID", name: "Thyroid Profile" },
  { code: "TSH", name: "TSH" },
  { code: "FT4", name: "Free T4" },
  { code: "CBC", name: "Complete Blood Count" },
  { code: "RETIC", name: "Reticulocytes" },
  { code: "IRON", name: "Iron Studies" },
  { code: "VITD", name: "Vitamin D" },
  { code: "CALCIUM", name: "Calcium" },
  { code: "B12", name: "Vitamin B12" },
  { code: "KFT", name: "Kidney Function Test" },
  { code: "EGFR", name: "eGFR" },
  { code: "ELECTROLYTES", name: "Electrolytes" },
  { code: "URINE_ROUTINE", name: "Urine Routine" },
  { code: "UACR", name: "Urine Albumin-to-Creatinine Ratio" },
  { code: "LFT", name: "Liver Function Test" },
];

export const DEFAULT_RETEST_PROTOCOLS_BASE = [
  {
    finding_code: "LOW_VITD",
    finding_name: "Low Vitamin D",
    timeframe_text: "8\u201312 weeks if retesting is indicated",
    tests_text: "25-OH Vitamin D; calcium when appropriate",
    considerations_text: "Routine retesting is not necessary for every patient. Consider after treatment in selected patients, particularly those at higher risk.",
    ami_reminder_text: "Day 60\u201390",
    requires_indication: true,
    variants: [
      { when: "indicated", window_min_days: 56, window_max_days: 84, anchor: "TREATMENT_START", tier: "METABOLIC" },
      { when: "default", window_min_days: null, window_max_days: null, anchor: "REPORT_DATE", mode: "REQUIRES_INDICATION", tier: "METABOLIC" },
    ],
    tests: [{ code: "VITD", optional: false }, { code: "CALCIUM", optional: true }],
    reminder: { mode: "FIXED", day_min: 60, day_max: 90 },
  },
  {
    finding_code: "HIGH_HBA1C",
    finding_name: "Elevated HbA1c",
    timeframe_text: "3 months if treatment changes or glucose targets are unmet; 6 months if stable and at goal",
    tests_text: "HbA1c; glucose as indicated",
    considerations_text: "HbA1c reflects approximately 2\u20133 months of glycemic exposure.",
    ami_reminder_text: "Day 90",
    variants: [
      { when: "treatment_changed", window_min_days: 90, window_max_days: 90, anchor: "TREATMENT_CHANGE", tier: "METABOLIC" },
      { when: "targets_unmet", window_min_days: 90, window_max_days: 90, anchor: "REPORT_DATE", tier: "METABOLIC" },
      { when: "stable_at_goal", window_min_days: 180, window_max_days: 180, anchor: "REPORT_DATE", tier: "LONG_TERM" },
      { when: "default", window_min_days: 90, window_max_days: 90, anchor: "REPORT_DATE", tier: "METABOLIC" },
    ],
    tests: [{ code: "HBA1C", optional: false }, { code: "FBS", optional: true }],
    reminder: { mode: "FIXED", day_min: 90, day_max: 90 },
  },
  {
    finding_code: "HIGH_CHOLESTEROL",
    finding_name: "Elevated cholesterol",
    timeframe_text: "4\u201312 weeks after starting/changing lipid-lowering treatment; otherwise individualized",
    tests_text: "Lipid profile",
    considerations_text: "Stable patients on treatment generally require monitoring every 3\u201312 months.",
    ami_reminder_text: "Day 30\u201390",
    signoff_note: "Clinical team check: timeframe says 4\u201312 weeks (28\u201384 days) while AMI reminder says Day 30\u201390. Both preserved as written; confirm alignment during sign-off.",
    variants: [
      { when: "treatment_changed", window_min_days: 28, window_max_days: 84, anchor: "TREATMENT_CHANGE", tier: "TREATMENT_RESPONSE" },
      { when: "default", window_min_days: null, window_max_days: null, anchor: "REPORT_DATE", mode: "INDIVIDUALIZED", tier: "LONG_TERM" },
    ],
    tests: [{ code: "LIPID", optional: false }],
    reminder: { mode: "FIXED", day_min: 30, day_max: 90 },
  },
  {
    finding_code: "HIGH_TSH",
    finding_name: "Elevated TSH",
    timeframe_text: "6\u20138 weeks after starting/changing levothyroxine; otherwise individualized",
    tests_text: "TSH; free T4 when indicated",
    considerations_text: "Mild untreated abnormalities may need confirmation before treatment.",
    ami_reminder_text: "Day 45\u201360",
    variants: [
      { when: "treatment_changed", window_min_days: 42, window_max_days: 56, anchor: "TREATMENT_CHANGE", tier: "TREATMENT_RESPONSE" },
      { when: "default", window_min_days: null, window_max_days: null, anchor: "REPORT_DATE", mode: "INDIVIDUALIZED", tier: "TREATMENT_RESPONSE" },
    ],
    tests: [{ code: "TSH", optional: false }, { code: "FT4", optional: true }],
    reminder: { mode: "FIXED", day_min: 45, day_max: 60 },
  },
  {
    finding_code: "LOW_HB",
    finding_name: "Low hemoglobin",
    timeframe_text: "2\u20134 weeks after initiating treatment for confirmed iron-deficiency anemia",
    tests_text: "CBC/Hb; reticulocytes when indicated",
    considerations_text: "Investigate the cause of anemia. Severe anemia or concerning symptoms require earlier evaluation.",
    ami_reminder_text: "Day 14\u201328",
    variants: [
      { when: "on_treatment", window_min_days: 14, window_max_days: 28, anchor: "TREATMENT_START", tier: "EARLY" },
      { when: "default", window_min_days: null, window_max_days: null, anchor: "REPORT_DATE", mode: "DOCTOR_DECIDES", tier: "EARLY" },
    ],
    tests: [{ code: "CBC", optional: false }, { code: "RETIC", optional: true }],
    reminder: { mode: "FIXED", day_min: 14, day_max: 28 },
  },
  {
    finding_code: "HIGH_CREATININE",
    finding_name: "Elevated creatinine",
    timeframe_text: "Within 48 hours to 2 weeks, depending on severity and context",
    tests_text: "Creatinine, eGFR, electrolytes; urine tests as indicated",
    considerations_text: "Possible acute kidney injury requires prompt evaluation and sometimes repeat testing within 24\u201348 hours or sooner.",
    ami_reminder_text: "Risk-based",
    variants: [
      { when: "default", window_min_days: 0, window_max_days: 14, anchor: "REPORT_DATE", risk_based: true, mode: "RISK_BASED", tier: "URGENT" },
    ],
    tests: [{ code: "KFT", optional: false }, { code: "ELECTROLYTES", optional: false }, { code: "URINE_ROUTINE", optional: true }, { code: "UACR", optional: true }],
    reminder: { mode: "RISK_BASED" },
  },
  {
    finding_code: "ABNORMAL_LFT",
    finding_name: "Abnormal liver enzymes",
    timeframe_text: "2\u20134 weeks for selected mild, stable abnormalities; sooner when clinically indicated",
    tests_text: "Liver panel and cause-specific investigations",
    considerations_text: "Do not delay investigation of significant abnormalities, jaundice or concerning symptoms merely to repeat the test.",
    ami_reminder_text: "Day 14\u201328, if appropriate",
    variants: [
      { when: "mild_stable", window_min_days: 14, window_max_days: 28, anchor: "REPORT_DATE", tier: "EARLY" },
      { when: "default", window_min_days: null, window_max_days: null, anchor: "REPORT_DATE", mode: "DOCTOR_DECIDES", tier: "EARLY" },
    ],
    tests: [{ code: "LFT", optional: false }],
    reminder: { mode: "IF_APPROPRIATE", day_min: 14, day_max: 28 },
  },
  {
    finding_code: "OBESITY_METABOLIC",
    finding_name: "Obesity with metabolic abnormalities",
    timeframe_text: "3 months for HbA1c when indicated; lipid follow-up based on treatment",
    tests_text: "HbA1c, glucose, lipid profile as appropriate",
    considerations_text: "Weight and BP can be monitored more frequently.",
    ami_reminder_text: "Day 90",
    variants: [
      { when: "default", window_min_days: 90, window_max_days: 90, anchor: "REPORT_DATE", tier: "METABOLIC" },
    ],
    tests: [{ code: "HBA1C", optional: true }, { code: "FBS", optional: true }, { code: "LIPID", optional: true }],
    reminder: { mode: "FIXED", day_min: 90, day_max: 90 },
  },
  {
    finding_code: "MULTI_CHRONIC",
    finding_name: "Multiple chronic conditions",
    timeframe_text: "1\u20133 months, depending on conditions and treatment",
    tests_text: "Disease-specific tests",
    considerations_text: "Each condition requires its own monitoring schedule.",
    ami_reminder_text: "Personalized",
    variants: [
      { when: "default", window_min_days: 30, window_max_days: 90, anchor: "REPORT_DATE", personalized: true, mode: "PERSONALIZED", tier: "LONG_TERM" },
    ],
    tests: [],
    reminder: { mode: "PERSONALIZED" },
  },
  {
    finding_code: "NORMAL_WITH_RISK",
    finding_name: "Normal report with risk factors",
    timeframe_text: "6\u201312 months or longer, based on risk and screening guidelines",
    tests_text: "Risk-appropriate preventive tests",
    considerations_text: "Normal results do not automatically justify repeat testing at six months.",
    ami_reminder_text: "Risk-based",
    variants: [
      { when: "default", window_min_days: 180, window_max_days: 365, anchor: "REPORT_DATE", risk_based: true, mode: "RISK_BASED", tier: "LONG_TERM" },
    ],
    tests: [],
    reminder: { mode: "RISK_BASED" },
  },
];

export const DEFAULT_CLINICAL_TARGETS = {
  HBA1C: {
    target_op: "<",
    target_value: 7.0,
    unit: "%",
    direction: "LOWER_IS_BETTER",
    min_meaningful_change: 0.5,
    note: "starter value, clinician to confirm",
  },
};

export const DEFAULT_CONDITION_PROTOCOLS = [
  {
    entry_type: "condition",
    condition_code: "B12_DEFICIENCY",
    condition_name: "Vitamin B12 deficiency",
    timeframe_text: "CBC response may be checked within 1\u20132 weeks when indicated; repeat B12 is not routinely necessary after treatment",
    icon: "red_cell_tick",
    icon_label: "red cell + tick",
    note: "",
    overrides_findings: [],
    is_lab_protocol: true,
    requires_indication: true,
    repeat_b12_routine: false,
    variants: [
      { when: "indicated", window_min_days: 7, window_max_days: 14, anchor: "TREATMENT_START", tier: "EARLY" },
      { when: "default", window_min_days: null, window_max_days: null, anchor: "TREATMENT_START", mode: "REQUIRES_INDICATION", tier: "EARLY" },
    ],
    tests: [{ code: "CBC", optional: true }, { code: "B12", optional: true, routine: false }],
    tier: "EARLY",
    reminder: { mode: "IF_APPROPRIATE", day_min: 7, day_max: 14 },
  },
  {
    entry_type: "condition",
    condition_code: "IRON_DEFICIENCY",
    condition_name: "Iron deficiency",
    timeframe_text: "Hb/CBC in 2\u20134 weeks; iron stores assessed later when appropriate",
    icon: "blood_tube_fe",
    icon_label: "blood tube \"Fe\"",
    note: "",
    overrides_findings: ["LOW_HB"],
    is_lab_protocol: true,
    iron_stores_doctor_decides: true,
    variants: [{ when: "default", window_min_days: 14, window_max_days: 28, anchor: "TREATMENT_START", tier: "EARLY" }],
    tests: [{ code: "CBC", optional: false }, { code: "IRON", optional: true, doctor_decides: true }],
    tier: "EARLY",
    reminder: { mode: "FIXED", day_min: 14, day_max: 28 },
  },
  {
    entry_type: "condition",
    condition_code: "PREDIABETES",
    condition_name: "Prediabetes",
    timeframe_text: "Usually annual glycemic testing; earlier based on risk",
    icon: "calendar",
    icon_label: "calendar",
    note: "",
    overrides_findings: ["HIGH_HBA1C"],
    is_lab_protocol: true,
    earlier_by_risk: true,
    variants: [
      { when: "higher_risk", window_min_days: 180, window_max_days: 180, anchor: "REPORT_DATE", tier: "LONG_TERM" },
      { when: "default", window_min_days: 365, window_max_days: 365, anchor: "REPORT_DATE", tier: "LONG_TERM" },
    ],
    tests: [{ code: "HBA1C", optional: false }, { code: "FBS", optional: true }],
    tier: "LONG_TERM",
    reminder: { mode: "FIXED", day_min: 365, day_max: 365 },
  },
  {
    entry_type: "condition",
    condition_code: "DIABETES_STABLE",
    condition_name: "Stable diabetes",
    timeframe_text: "HbA1c approximately every 6 months when at goal",
    icon: "clock_6_hba1c",
    icon_label: "\"6\" clock HbA1c",
    note: "",
    overrides_findings: ["HIGH_HBA1C"],
    is_lab_protocol: true,
    variants: [{ when: "default", window_min_days: 180, window_max_days: 180, anchor: "REPORT_DATE", tier: "LONG_TERM" }],
    tests: [{ code: "HBA1C", optional: false }],
    tier: "LONG_TERM",
    reminder: { mode: "FIXED", day_min: 180, day_max: 180 },
  },
  {
    entry_type: "condition",
    condition_code: "DIABETES_UNCONTROLLED",
    condition_name: "Uncontrolled diabetes",
    timeframe_text: "HbA1c approximately every 3 months",
    icon: "clock_3_hba1c_alert",
    icon_label: "\"3\" clock HbA1c with alert",
    note: "",
    overrides_findings: ["HIGH_HBA1C"],
    is_lab_protocol: true,
    variants: [{ when: "default", window_min_days: 90, window_max_days: 90, anchor: "REPORT_DATE", tier: "METABOLIC" }],
    tests: [{ code: "HBA1C", optional: false }],
    tier: "METABOLIC",
    reminder: { mode: "FIXED", day_min: 90, day_max: 90 },
  },
  {
    entry_type: "condition",
    condition_code: "HYPOTHYROID_STABLE_TREATED",
    condition_name: "Stable hypothyroidism on treatment",
    timeframe_text: "TSH generally every 6\u201312 months",
    icon: "thyroid",
    icon_label: "thyroid",
    note: "",
    overrides_findings: ["HIGH_TSH"],
    is_lab_protocol: true,
    variants: [{ when: "default", window_min_days: 180, window_max_days: 365, anchor: "REPORT_DATE", tier: "LONG_TERM" }],
    tests: [{ code: "TSH", optional: false }],
    tier: "LONG_TERM",
    reminder: { mode: "FIXED", day_min: 180, day_max: 365 },
  },
  {
    entry_type: "condition",
    condition_code: "HYPERTENSION",
    condition_name: "Hypertension",
    timeframe_text: "Home BP monitoring over days to weeks; laboratory testing depends on medications and comorbidities",
    icon: "bp_monitor",
    icon_label: "BP monitor",
    note: "",
    overrides_findings: [],
    is_lab_protocol: false,
    home_bp_schedule: { kind: "BP", frequency_per_day: 2, duration_days: 7, slots: ["MORNING", "EVENING"], note: "starter value, clinician to confirm" },
    creates_doctor_task: true,
    variants: [{ when: "default", window_min_days: null, window_max_days: null, anchor: "REPORT_DATE", mode: "DOCTOR_DECIDES", tier: "LONG_TERM" }],
    tests: [],
    tier: "LONG_TERM",
    reminder: { mode: "RISK_BASED" },
  },
  {
    entry_type: "condition",
    condition_code: "CKD",
    condition_name: "Chronic kidney disease",
    timeframe_text: "eGFR and urine albumin monitoring at least annually, more frequently with higher risk",
    icon: "kidney",
    icon_label: "kidney",
    note: "",
    overrides_findings: ["HIGH_CREATININE"],
    is_lab_protocol: true,
    risk_adjusted: true,
    variants: [
      { when: "higher_risk", window_min_days: 90, window_max_days: 180, anchor: "REPORT_DATE", risk_adjusted: true, tier: "LONG_TERM" },
      { when: "default", window_min_days: 180, window_max_days: 365, anchor: "REPORT_DATE", risk_adjusted: true, tier: "LONG_TERM" },
    ],
    tests: [{ code: "EGFR", optional: false }, { code: "UACR", optional: false }],
    tier: "LONG_TERM",
    reminder: { mode: "FIXED", day_min: 180, day_max: 365 },
  },
  {
    entry_type: "condition",
    condition_code: "DYSLIPIDEMIA_NEW_MED",
    condition_name: "Dyslipidemia after medication initiation",
    timeframe_text: "Lipid profile in 4\u201312 weeks",
    icon: "three_tubes",
    icon_label: "3 tubes",
    note: "",
    overrides_findings: ["HIGH_CHOLESTEROL"],
    is_lab_protocol: true,
    variants: [{ when: "default", window_min_days: 28, window_max_days: 84, anchor: "TREATMENT_START", tier: "TREATMENT_RESPONSE" }],
    tests: [{ code: "LIPID", optional: false }],
    tier: "TREATMENT_RESPONSE",
    reminder: { mode: "FIXED", day_min: 28, day_max: 84 },
  },
  {
    entry_type: "condition",
    condition_code: "DYSLIPIDEMIA_STABLE",
    condition_name: "Stable dyslipidemia",
    timeframe_text: "Lipid monitoring approximately every 3\u201312 months when indicated",
    icon: "lipid_cycle_clock",
    icon_label: "lipid cycle + clock",
    note: "",
    overrides_findings: ["HIGH_CHOLESTEROL"],
    is_lab_protocol: true,
    requires_indication: true,
    variants: [
      { when: "indicated", window_min_days: 90, window_max_days: 365, anchor: "REPORT_DATE", tier: "LONG_TERM" },
      { when: "default", window_min_days: null, window_max_days: null, anchor: "REPORT_DATE", mode: "REQUIRES_INDICATION", tier: "LONG_TERM" },
    ],
    tests: [{ code: "LIPID", optional: true }],
    tier: "LONG_TERM",
    reminder: { mode: "IF_APPROPRIATE", day_min: 90, day_max: 365 },
  },
];

export const DEFAULT_RETEST_PROTOCOLS = [...DEFAULT_RETEST_PROTOCOLS_BASE, ...DEFAULT_CONDITION_PROTOCOLS];

export const CONDITION_FAMILIES = {
  PREDIABETES: ["PREDIABETES", "DIABETES_STABLE", "DIABETES_UNCONTROLLED"],
  DIABETES_STABLE: ["PREDIABETES", "DIABETES_STABLE", "DIABETES_UNCONTROLLED"],
  DIABETES_UNCONTROLLED: ["PREDIABETES", "DIABETES_STABLE", "DIABETES_UNCONTROLLED"],
  DYSLIPIDEMIA_NEW_MED: ["DYSLIPIDEMIA_NEW_MED", "DYSLIPIDEMIA_STABLE"],
  DYSLIPIDEMIA_STABLE: ["DYSLIPIDEMIA_NEW_MED", "DYSLIPIDEMIA_STABLE"],
};

export const CONDITION_STAGE_OPTIONS = {
  PREDIABETES: [
    { value: "STANDARD", label: "Standard (annual)" },
    { value: "HIGHER_RISK", label: "Higher risk (earlier)" },
  ],
  DIABETES_STABLE: [{ value: "AT_GOAL", label: "Stable at goal" }],
  DIABETES_UNCONTROLLED: [{ value: "UNCONTROLLED", label: "Uncontrolled" }],
  HYPOTHYROID_STABLE_TREATED: [
    { value: "STABLE", label: "Stable on treatment" },
    { value: "ABNORMAL_ON_TREATMENT", label: "Needs adjustment (TSH abnormal)" },
  ],
  B12_DEFICIENCY: [
    { value: "ACTIVE", label: "Active / On replacement" },
    { value: "INDICATED", label: "CBC response indicated" },
  ],
  IRON_DEFICIENCY: [
    { value: "ON_TREATMENT", label: "On iron therapy (Hb/CBC 2–4w)" },
    { value: "IRON_STORES_FOLLOWUP", label: "Iron stores follow-up" },
  ],
  HYPERTENSION: [
    { value: "MONITORING", label: "Home BP monitoring" },
    { value: "ON_TREATMENT", label: "On treatment" },
  ],
  CKD: [
    { value: "STANDARD", label: "Standard risk (annual)" },
    { value: "HIGHER_RISK", label: "Higher risk (more frequent)" },
  ],
  DYSLIPIDEMIA_NEW_MED: [{ value: "NEW_MED", label: "Medication initiated (4–12w)" }],
  DYSLIPIDEMIA_STABLE: [
    { value: "STABLE", label: "Stable (when indicated)" },
    { value: "INDICATED", label: "Monitoring indicated" },
  ],
};

const COND_DRUG_CLASSES = {
  PREDIABETES: new Set(["BIGUANIDE", "SULFONYLUREA", "INSULIN"]),
  DIABETES_STABLE: new Set(["BIGUANIDE", "SULFONYLUREA", "INSULIN"]),
  DIABETES_UNCONTROLLED: new Set(["BIGUANIDE", "SULFONYLUREA", "INSULIN"]),
  DYSLIPIDEMIA_NEW_MED: new Set(["STATIN", "FIBRATE", "EZETIMIBE", "LIPID_LOWERING"]),
  DYSLIPIDEMIA_STABLE: new Set(["STATIN", "FIBRATE", "EZETIMIBE", "LIPID_LOWERING"]),
  HYPOTHYROID_STABLE_TREATED: new Set(["THYROID_HORMONE"]),
  IRON_DEFICIENCY: new Set(["IRON_SUPPLEMENT"]),
  B12_DEFICIENCY: new Set(["B12_SUPPLEMENT"]),
};

const COND_MED_KEYWORDS = {
  DYSLIPIDEMIA_NEW_MED: MED_KEYWORDS.HIGH_CHOLESTEROL,
  DYSLIPIDEMIA_STABLE: MED_KEYWORDS.HIGH_CHOLESTEROL,
  HYPOTHYROID_STABLE_TREATED: MED_KEYWORDS.HIGH_TSH,
  IRON_DEFICIENCY: MED_KEYWORDS.LOW_HB,
  B12_DEFICIENCY: ["b12", "methylcobalamin", "cyanocobalamin"],
};

export function conditionProtoMap(rules) {
  const map = Object.fromEntries(DEFAULT_CONDITION_PROTOCOLS.map((p) => [p.condition_code, p]));
  for (const p of rules?.retest_protocols?.data || rules?.retest_protocols || []) {
    if (p?.condition_code) map[p.condition_code] = p;
  }
  return map;
}

export function validConditionCodes(rules) {
  const codes = new Set(rules?.profile_codes?.data?.conditions || rules?.profile_codes?.conditions || DEFAULT_PROFILE_CODES.conditions || []);
  for (const k of Object.keys(conditionProtoMap(rules))) codes.add(k);
  return codes;
}

export function hba1cTarget(rules, profile) {
  const pt = profile?.targets?.HBA1C;
  if (pt && pt.target_value !== undefined && pt.target_value !== null) {
    return [String(pt.target_op || "<"), Number(pt.target_value)];
  }
  const rt = (rules?.clinical_targets?.data || rules?.clinical_targets || DEFAULT_CLINICAL_TARGETS)?.HBA1C || {};
  return [String(rt.target_op || "<"), Number(rt.target_value ?? 7.0)];
}

function cmpVal(val, op, target) {
  if (op === "<") return val < target;
  if (op === "<=") return val <= target;
  if (op === ">") return val > target;
  if (op === ">=") return val >= target;
  if (op === "==") return val === target;
  return false;
}

function diffDaysIso(aIso, bIso) {
  const a = Date.parse(`${String(aIso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(bIso).slice(0, 10)}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

export function suggestConditionsInStore(store, patientId, paramsByReport = {}, today = todayIstStr()) {
  const rules = store.rules || {};
  const profile = cleanProfile((store.health_profiles || {})[patientId]);
  const medList = rules.medicine_catalogue?.data || rules.medicine_catalogue || DEFAULT_MEDICINE_CATALOGUE;
  const medCat = Object.fromEntries(medList.map((m) => [m.code, m]));
  const activeMeds = (store.patient_medications || []).filter((m) => m.patient_id === patientId && !m.stopped_on);
  const cProtos = conditionProtoMap(rules);

  const reps = (store.reports || [])
    .filter((r) => r.patient_id === patientId && r.status === "READY")
    .sort((a, b) => String(a.collected_on || "").localeCompare(String(b.collected_on || "")) || a.id - b.id);
  const latestRep = reps[reps.length - 1];
  const latestParams = latestRep ? (paramsByReport[latestRep.id] || []) : [];

  const confirmed = Object.fromEntries((profile.conditions || []).filter((c) => c.status === "CONFIRMED").map((c) => [c.code, c]));
  const suggestions = [];
  const addSug = (code, stage, reasons, replaces = null) => {
    if (confirmed[code] && !replaces) {
      const curStage = confirmed[code].stage || "";
      if (!(code === "HYPOTHYROID_STABLE_TREATED" && curStage && curStage !== stage)) return;
    }
    const meta = cProtos[code] || {};
    suggestions.push({
      code,
      condition_name: meta.condition_name || code,
      icon: meta.icon || "",
      status: "SUSPECTED",
      stage,
      reason_codes: reasons,
      replaces_code: replaces,
    });
  };

  const matchMeds = (classes, kws) => activeMeds.filter((m) => {
    const meta = medCat[m.medicine_code] || {};
    const dc = meta.drug_class || "";
    const hay = `${m.medicine_code || ""} ${meta.generic_name || ""} ${dc}`.toLowerCase();
    return (dc && classes.has(dc)) || kws.some((kw) => hay.includes(kw));
  });

  // 1 & 2. Glycemic
  const a1cVals = [];
  for (const r of reps) {
    for (const p of (paramsByReport[r.id] || [])) {
      if (p.param_code === "HBA1C" && p.value_num !== null && p.value_num !== undefined) {
        a1cVals.push([toIstDateStr(r.collected_on || r.reported_on), Number(p.value_num)]);
      }
    }
  }
  const diabMeds = matchMeds(new Set(["BIGUANIDE", "SULFONYLUREA", "INSULIN"]), ["metformin", "glimepiride", "insulin"]);
  const confDiab = ["DIABETES_STABLE", "DIABETES_UNCONTROLLED", "DIABETES"].find((c) => Boolean(confirmed[c]));
  const knownDiab = Boolean(confDiab || diabMeds.length || a1cVals.some(([, v]) => v >= 6.5));
  const [tgtOp, tgtVal] = hba1cTarget(rules, profile);

  if (knownDiab) {
    const replacesPre = confirmed.PREDIABETES ? "PREDIABETES" : null;
    if (a1cVals.length) {
      const latestV = a1cVals[a1cVals.length - 1][1];
      const atGoal = cmpVal(latestV, tgtOp, tgtVal);
      const twoAbove = a1cVals.length >= 2 && !cmpVal(a1cVals[a1cVals.length - 1][1], tgtOp, tgtVal) && !cmpVal(a1cVals[a1cVals.length - 2][1], tgtOp, tgtVal);
      if (atGoal) {
        addSug("DIABETES_STABLE", "AT_GOAL", ["hba1c_at_target"], confirmed.DIABETES_UNCONTROLLED ? "DIABETES_UNCONTROLLED" : replacesPre);
      } else if (twoAbove) {
        addSug("DIABETES_UNCONTROLLED", "UNCONTROLLED", ["hba1c_above_target_2_consecutive"], confirmed.DIABETES_STABLE ? "DIABETES_STABLE" : replacesPre);
      } else if (a1cVals.length === 1 && !confirmed.DIABETES_STABLE) {
        addSug("DIABETES_UNCONTROLLED", "UNCONTROLLED", ["hba1c_above_target"], replacesPre);
      }
    } else if (!confDiab) {
      addSug("DIABETES_STABLE", "AT_GOAL", ["known_diabetic_on_therapy"]);
    }
  } else if (a1cVals.length) {
    const latestV = a1cVals[a1cVals.length - 1][1];
    if (latestV >= 5.7 && latestV < 6.5) addSug("PREDIABETES", "STANDARD", ["hba1c_prediabetes_range"]);
  }

  // 3. Hypothyroid on levothyroxine
  const thyMeds = matchMeds(new Set(["THYROID_HORMONE"]), ["levothyroxine", "thyroxine", "eltroxin", "thyronorm"]);
  const tshLabs = latestParams.filter((p) => p.param_code === "TSH");
  if (thyMeds.length && tshLabs.length) {
    if (tshLabs.some((p) => p.system_flag === "LOW" || p.system_flag === "HIGH")) {
      addSug("HYPOTHYROID_STABLE_TREATED", "ABNORMAL_ON_TREATMENT", ["tsh_abnormal_on_levothyroxine"],
        confirmed.HYPOTHYROID_STABLE_TREATED?.stage === "STABLE" ? "HYPOTHYROID_STABLE_TREATED" : null);
    } else if (tshLabs.some((p) => p.system_flag === "NORMAL")) {
      addSug("HYPOTHYROID_STABLE_TREATED", "STABLE", ["tsh_in_range_on_levothyroxine"],
        confirmed.HYPOTHYROID_STABLE_TREATED?.stage === "ABNORMAL_ON_TREATMENT" ? "HYPOTHYROID_STABLE_TREATED" : null);
    }
  }

  // 4. CKD
  const ckdDates = [];
  for (const r of reps) {
    const pList = paramsByReport[r.id] || [];
    const egfrLow = pList.some((p) => p.param_code === "EGFR" && p.value_num !== null && p.value_num !== undefined && Number(p.value_num) < 60);
    const uacrHigh = pList.some((p) => p.param_code === "UACR" && p.system_flag === "HIGH");
    if (egfrLow || uacrHigh) ckdDates.push(toIstDateStr(r.collected_on || r.reported_on));
  }
  if (ckdDates.length >= 2 && diffDaysIso(ckdDates[ckdDates.length - 1], ckdDates[0]) >= 90) {
    addSug("CKD", "STANDARD", ["ckd_persistent_90d"]);
  }

  // 5. Dyslipidemia
  const lipidMeds = matchMeds(COND_DRUG_CLASSES.DYSLIPIDEMIA_NEW_MED, COND_MED_KEYWORDS.DYSLIPIDEMIA_NEW_MED);
  if (lipidMeds.length) {
    const starts = lipidMeds.map((m) => (m.started_on ? String(m.started_on).slice(0, 10) : null)).filter(Boolean);
    const isNew = starts.some((sd) => {
      const d = diffDaysIso(today, sd);
      return d >= 0 && d <= 84;
    });
    if (isNew) {
      addSug("DYSLIPIDEMIA_NEW_MED", "NEW_MED", ["lipid_med_within_12_weeks"], confirmed.DYSLIPIDEMIA_STABLE ? "DYSLIPIDEMIA_STABLE" : null);
    } else if (starts.length || confirmed.DYSLIPIDEMIA_NEW_MED) {
      addSug("DYSLIPIDEMIA_STABLE", "STABLE", ["lipid_med_maintenance"], confirmed.DYSLIPIDEMIA_NEW_MED ? "DYSLIPIDEMIA_NEW_MED" : null);
    }
  }

  // 6. B12
  if (latestParams.some((p) => p.param_code === "B12" && p.system_flag === "LOW")) {
    addSug("B12_DEFICIENCY", "ACTIVE", ["b12_low"]);
  }

  // 7. Iron deficiency
  const ferrLow = latestParams.some((p) => p.param_code === "FERRITIN" && p.system_flag === "LOW");
  const ironLow = latestParams.some((p) => p.param_code === "IRON" && p.system_flag === "LOW");
  const hbLow = latestParams.some((p) => (p.param_code === "HB" || p.param_code === "HEMOGLOBIN") && p.system_flag === "LOW");
  if (ferrLow || (ironLow && hbLow)) {
    addSug("IRON_DEFICIENCY", "ON_TREATMENT", ["iron_stores_or_iron_with_hb_low"]);
  }

  // 8. Hypertension
  if (bpIsHigh(profile)[0]) {
    addSug("HYPERTENSION", "MONITORING", ["bp_elevated"]);
  }

  return suggestions;
}

export function evaluateConditionProtocol({ proto, reportDateIst, followup, ctx, medCat, params = [], catNames = {}, state = {}, cStage = "" }) {
  const cc = proto.condition_code;
  const activeMeds = [...(ctx.activeMeds || []), ...(state.medicines || [])];
  const reqClasses = COND_DRUG_CLASSES[cc] || new Set();
  const kws = COND_MED_KEYWORDS[cc] || [];
  const startDates = [];
  for (const m of activeMeds) {
    if (!m || m.stopped_on || m.active === false) continue;
    const meta = medCat[m.medicine_code] || {};
    const dc = meta.drug_class || "";
    const hay = `${m.medicine_code || ""} ${meta.generic_name || ""} ${dc} ${m.name || ""}`.toLowerCase();
    if ((dc && reqClasses.has(dc)) || kws.some((kw) => hay.includes(kw))) {
      const raw = m.started_on || m.last_changed_on;
      if (raw) startDates.push(String(raw).slice(0, 10));
    }
  }
  const medStartDate = startDates.length ? startDates.sort().slice(-1)[0] : null;
  const manualAnchor = state.treatment_anchor_on || followup?.treatment_anchor_on || null;
  const stageU = String(cStage || "").trim().toUpperCase();
  const indicated = Boolean(
    state.indicated ||
    stageU === "INDICATED" ||
    (cc === "B12_DEFICIENCY" && ctx.profile?.b12_cbc_indicated) ||
    (cc === "DYSLIPIDEMIA_STABLE" && ctx.profile?.lipid_retest_indicated)
  );
  const egfrVeryLow = params.some((p) => p.param_code === "EGFR" && p.value_num !== null && p.value_num !== undefined && Number(p.value_num) < 45);
  const uacrVeryHigh = params.some((p) => p.param_code === "UACR" && p.value_num !== null && p.value_num !== undefined && Number(p.value_num) >= 300);
  const higherRisk = Boolean(state.higher_risk || stageU === "HIGHER_RISK" || (cc === "CKD" && (egfrVeryLow || uacrVeryHigh)));

  const condFlags = { indicated, higher_risk: higherRisk };
  const variants = proto.variants || [];
  let variant = variants.find((v) => v.when && v.when !== "default" && condFlags[v.when]);
  if (!variant) variant = variants.find((v) => v.when === "default") || variants[0] || { when: "default", anchor: "REPORT_DATE" };

  let mode = variant.mode || (variant.window_min_days != null ? "AUTO" : "DOCTOR_DECIDES");
  if (proto.requires_indication && variant.when === "default") mode = "REQUIRES_INDICATION";

  const isLab = proto.is_lab_protocol !== false;
  const autoScheduled = Boolean(isLab && !NON_AUTO_MODES.has(mode) && variant.window_min_days != null);
  const anchorKind = variant.anchor || "REPORT_DATE";
  let anchorDate = state.anchor_date || reportDateIst;
  if (!state.anchor_date && (anchorKind === "TREATMENT_START" || anchorKind === "TREATMENT_CHANGE")) {
    anchorDate = medStartDate || manualAnchor || reportDateIst;
  }
  const winStart = autoScheduled ? addDaysIso(anchorDate, Number(variant.window_min_days)) : null;
  const winEnd = autoScheduled ? addDaysIso(anchorDate, Number(variant.window_max_days ?? variant.window_min_days)) : null;
  const remCfg = proto.reminder || {};
  const remMode = remCfg.mode || "FIXED";
  const reminderOn = autoScheduled && (remMode === "FIXED" || remMode === "IF_APPROPRIATE") && remCfg.day_min != null
    ? addDaysIso(anchorDate, Number(remCfg.day_min))
    : null;
  const tests = (proto.tests || []).filter((t) => t?.code).map((t) => ({
    code: t.code,
    name: catNames[t.code] || t.code,
    optional: Boolean(t.optional),
    ...(t.routine !== undefined ? { routine: t.routine } : {}),
    ...(t.doctor_decides !== undefined ? { doctor_decides: t.doctor_decides } : {}),
  }));
  const tierCode = variant.tier || proto.tier || "LONG_TERM";

  return {
    source: "CONDITION",
    condition_code: cc,
    condition_name: proto.condition_name || cc,
    finding_code: cc,
    finding_name: proto.condition_name || cc,
    stage: cStage,
    icon: proto.icon || "",
    icon_label: proto.icon_label || "",
    note: proto.note || "",
    is_lab_protocol: isLab,
    overrides_findings: [...(proto.overrides_findings || [])],
    variant_when: variant.when || "default",
    tier: tierCode,
    mode,
    auto_scheduled: autoScheduled,
    anchor: anchorKind,
    anchor_date: anchorDate,
    window_min_days: variant.window_min_days ?? null,
    window_max_days: variant.window_max_days ?? null,
    window_start: winStart,
    window_end: winEnd,
    reminder_mode: remMode,
    reminder_on: reminderOn,
    timeframe_text: proto.timeframe_text || "",
    tests_text: tests.length ? tests.map((t) => t.name).join(", ") : "Clinician-selected based on medicines & comorbidities",
    considerations_text: proto.note || proto.timeframe_text || "",
    ami_reminder_text: remCfg.day_min != null ? `Day ${remCfg.day_min}` : "Doctor-directed",
    tests,
  };
}

export function tierMapFromRules(rules) {
  const list = rules?.retest_tiers?.data || rules?.retest_tiers || DEFAULT_RETEST_TIERS;
  return Object.fromEntries(list.filter((t) => t?.code).map((t) => [t.code, t]));
}

export function getTierMeta(rules, code) {
  const map = tierMapFromRules(rules);
  return map[code || "LONG_TERM"] || map.LONG_TERM || DEFAULT_RETEST_TIERS[4];
}

export function dateInTierWindow(rules, tierCode, targetIso, anchorIso) {
  const meta = getTierMeta(rules, tierCode);
  const lo = addDaysIso(anchorIso, Number(meta.window_min_days || 0));
  const hi = meta.window_max_days !== null && meta.window_max_days !== undefined ? addDaysIso(anchorIso, Number(meta.window_max_days)) : null;
  const ok = targetIso >= lo && (hi === null || targetIso <= hi);
  return { ok, lo, hi };
}

export function toIstDateStr(val) {
  if (!val) return todayIstStr();
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return todayIstStr();
  return new Date(ms + 330 * 60000).toISOString().slice(0, 10);
}

function medAnchor(activeMeds, medCat, findingCode, anchorKind) {
  const reqClasses = FINDING_DRUG_CLASSES[findingCode] || new Set();
  const kws = MED_KEYWORDS[findingCode] || [];
  const dates = [];
  for (const m of activeMeds || []) {
    if (!m || m.stopped_on || m.active === false) continue;
    const meta = medCat[m.medicine_code] || {};
    const dclass = meta.drug_class || "";
    const hay = `${m.medicine_code || ""} ${meta.generic_name || ""} ${dclass} ${m.name || ""} ${m.class || ""}`.toLowerCase();
    if ((dclass && reqClasses.has(dclass)) || (m.finding_code && String(m.finding_code).toUpperCase() === findingCode) || kws.some((kw) => hay.includes(kw))) {
      const primary = anchorKind === "TREATMENT_CHANGE" ? m.last_changed_on : m.started_on;
      const secondary = anchorKind === "TREATMENT_CHANGE" ? m.started_on : m.last_changed_on;
      const raw = primary || secondary;
      if (raw) dates.push(String(raw).slice(0, 10));
    }
  }
  return dates.length ? dates.sort().slice(-1)[0] : null;
}

export function evaluateRetestFinding({ proto, reportDateIst, followup, ctx, medCat, params = [], trends = {}, catNames = {}, detectedCodes = [], state = {} }) {
  const fc = proto.finding_code;
  const activeMeds = [...(ctx.activeMeds || []), ...(state.medicines || [])];
  const medChangeDate = medAnchor(activeMeds, medCat, fc, "TREATMENT_CHANGE");
  const medStartDate = medAnchor(activeMeds, medCat, fc, "TREATMENT_START");
  const manualAnchor = state.treatment_anchor_on || followup?.treatment_anchor_on || null;

  const treatmentChanged = Boolean(state.treatment_changed || medChangeDate || (manualAnchor && ["HIGH_HBA1C", "HIGH_CHOLESTEROL", "HIGH_TSH"].includes(fc)));
  const onTreatment = Boolean(state.on_treatment || medStartDate || (manualAnchor && fc === "LOW_HB"));
  const onlyNonTreatment = !detectedCodes.some((c) => TREATMENT_FINDINGS.has(c));
  const indicated = Boolean(state.indicated || ctx.profile?.vitd_retest_indicated || medStartDate || (manualAnchor && fc === "LOW_VITD" && onlyNonTreatment));
  const stableFlag = Boolean(state.stable_at_goal || ctx.profile?.glycemic_at_goal);
  const labUnmet = fc === "HIGH_HBA1C" && params.some((p) => p.param_code === "HBA1C" && p.system_flag === "HIGH");
  const targetsUnmet = state.targets_unmet !== undefined ? Boolean(state.targets_unmet) : (Boolean(labUnmet) && !stableFlag);
  const stableAtGoal = Boolean(stableFlag && !treatmentChanged && !targetsUnmet);

  const lftParams = params.filter((p) => LFT_CODES.has(p.param_code) && p.system_flag === "HIGH");
  const mildStable = Boolean(
    state.mild_stable ||
      (fc === "ABNORMAL_LFT" && lftParams.length > 0 && lftParams.every((p) => p.severity === "mild") && lftParams.some((p) => trends[p.param_code] === "stable_abnormal"))
  );

  const condFlags = { treatment_changed: treatmentChanged, on_treatment: onTreatment, indicated, stable_at_goal: stableAtGoal, targets_unmet: targetsUnmet, mild_stable: mildStable };
  const variants = proto.variants || [];
  let variant = variants.find((v) => v.when && v.when !== "default" && condFlags[v.when]);
  if (!variant) variant = variants.find((v) => v.when === "default") || variants[0] || { when: "default", anchor: "REPORT_DATE" };

  let mode = variant.mode || (variant.window_min_days != null ? "AUTO" : "DOCTOR_DECIDES");
  if (variant.risk_based) mode = "RISK_BASED";
  else if (variant.personalized) mode = "PERSONALIZED";
  else if (proto.requires_indication && variant.when === "default") mode = "REQUIRES_INDICATION";

  const autoScheduled = !NON_AUTO_MODES.has(mode) && variant.window_min_days != null;
  const anchorKind = variant.anchor || "REPORT_DATE";
  let anchorDate = state.anchor_date || reportDateIst;
  if (!state.anchor_date) {
    if (anchorKind === "TREATMENT_CHANGE") anchorDate = medChangeDate || manualAnchor || reportDateIst;
    else if (anchorKind === "TREATMENT_START") anchorDate = medStartDate || manualAnchor || reportDateIst;
  }

  const winStart = autoScheduled ? addDaysIso(anchorDate, Number(variant.window_min_days)) : null;
  const winEnd = autoScheduled ? addDaysIso(anchorDate, Number(variant.window_max_days ?? variant.window_min_days)) : null;
  const remCfg = proto.reminder || {};
  const remMode = remCfg.mode || "FIXED";
  const reminderOn = autoScheduled && (remMode === "FIXED" || remMode === "IF_APPROPRIATE") && remCfg.day_min != null
    ? addDaysIso(anchorDate, Number(remCfg.day_min))
    : null;
  const tierCode = variant.tier || proto.tier || (fc === "HIGH_CREATININE" ? "URGENT" : "LONG_TERM");

  return {
    finding_code: fc,
    finding_name: proto.finding_name || fc,
    variant_when: variant.when || "default",
    tier: tierCode,
    mode,
    auto_scheduled: autoScheduled,
    anchor: anchorKind,
    anchor_date: anchorDate,
    window_min_days: variant.window_min_days ?? null,
    window_max_days: variant.window_max_days ?? null,
    window_start: winStart,
    window_end: winEnd,
    reminder_mode: remMode,
    reminder_on: reminderOn,
    timeframe_text: proto.timeframe_text || "",
    tests_text: proto.tests_text || "",
    considerations_text: proto.considerations_text || "",
    ami_reminder_text: proto.ami_reminder_text || "",
    tests: (proto.tests || []).filter((t) => t?.code).map((t) => ({ code: t.code, name: catNames[t.code] || t.code, optional: Boolean(t.optional) })),
  };
}

function isCriticalInStore(params, criticalValues) {
  for (const cv of criticalValues || []) {
    for (const p of params || []) {
      if (p.param_code === cv.param_code && p.value_num !== null && p.value_num !== undefined) {
        if ((cv.below !== null && cv.below !== undefined && p.value_num < cv.below) ||
            (cv.above !== null && cv.above !== undefined && p.value_num > cv.above)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function resolveProtocolTierInStore(followup, params, rules, schedules, detected, fallbackDays) {
  const critRules = rules?.critical_values?.data || rules?.critical_values || [];
  if (isCriticalInStore(params, critRules)) return "URGENT";
  const manual = followup?.retest_plan?.manual_tier;
  if (manual && TIER_ORDER[manual]) return manual;
  if (detected.includes("HIGH_CREATININE")) return "URGENT";
  if (schedules.length) {
    return [...schedules].map((s) => s.tier || "LONG_TERM").sort((a, b) => (TIER_ORDER[a] || 99) - (TIER_ORDER[b] || 99))[0];
  }
  if (followup.priority === "ESCALATION") return "URGENT";
  if (fallbackDays <= 28) return "EARLY";
  if (fallbackDays <= 56) return "TREATMENT_RESPONSE";
  if (fallbackDays <= 84) return "METABOLIC";
  return "LONG_TERM";
}

export function notifyUrgentInStore(store, fu) {
  if (fu.protocol_tier !== "URGENT" || fu.suppressed_reason) return false;
  if (fu.retest_plan?.urgent_notified) return false;
  if (!store.notifications) store.notifications = { unread: 0, items: [] };
  store.notifications.unread = (store.notifications.unread || 0) + 1;
  store.notifications.items.unshift({
    id: store.notifications.items.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1,
    text: "Urgent retest needed (action within 24h)",
    link: `/followups/view?id=${fu.id}`,
    urgent: true,
    read: false,
    at: new Date().toISOString(),
  });
  fu.retest_plan = { ...(fu.retest_plan || {}), urgent_notified: true };
  return true;
}

export function planRetestInStore(store, followup, { report = null, params = [], evalArgs = null, state = {}, fallbackDays = 90, force = false } = {}) {
  if (followup.retest_status === "OVERRIDDEN" && !force) return followup.retest_plan || {};
  const rules = store.rules || {};
  const rawProtos = rules.retest_protocols?.data || rules.retest_protocols || DEFAULT_RETEST_PROTOCOLS;
  const protos = Object.fromEntries(rawProtos.filter((p) => p?.finding_code).map((p) => [p.finding_code, p]));
  const condProtos = conditionProtoMap(rules);
  const catNames = Object.fromEntries((rules.test_catalogue?.data || rules.test_catalogue || DEFAULT_TEST_CATALOGUE_P7).map((t) => [t.code, t.name]));
  const medList = rules.medicine_catalogue?.data || rules.medicine_catalogue || DEFAULT_MEDICINE_CATALOGUE;
  const medCat = Object.fromEntries(medList.map((m) => [m.code, m]));
  const findingRules = rules.diagnostic_findings?.data || rules.diagnostic_findings || DEFAULT_DIAGNOSTIC_FINDINGS;

  const args = evalArgs || {
    patient: (store.patients || []).find((p) => p.id === followup.patient_id),
    report,
    params,
    buckets: followup.buckets || [],
    profile: (store.health_profiles || {})[followup.patient_id] || {},
    activeMeds: (store.patient_medications || []).filter((m) => m.patient_id === followup.patient_id && !m.stopped_on),
    medCatalogue: medList,
  };
  const ctx = buildProgramContext(args);
  const detected = state.detected || detectFindingsInCtx(ctx, findingRules);
  followup.finding_codes = detected;

  const collected = toIstDateStr(report?.collected_on || report?.reported_on);
  const today = todayIstStr();
  const trends = state.trends || {};

  const confirmedConds = (ctx.profile?.conditions || []).filter((c) => c && c.status === "CONFIRMED");
  const condAll = [];
  for (const c of confirmedConds) {
    const cc = c.code;
    if (!condProtos[cc]) continue;
    if (cc === "HYPOTHYROID_STABLE_TREATED" && String(c.stage || "").toUpperCase() === "ABNORMAL_ON_TREATMENT") continue;
    condAll.push(evaluateConditionProtocol({ proto: condProtos[cc], reportDateIst: collected, followup, ctx, medCat, params, catNames, state, cStage: c.stage || "" }));
  }
  const condLabSchedules = condAll.filter((s) => s.is_lab_protocol);
  const nonLabProtocols = condAll.filter((s) => !s.is_lab_protocol);
  const overriddenFindings = new Set(condLabSchedules.flatMap((s) => s.overrides_findings || []));

  const findingSchedules = detected.filter((fc) => protos[fc] && !overriddenFindings.has(fc)).map((fc) =>
    evaluateRetestFinding({ proto: protos[fc], reportDateIst: collected, followup, ctx, medCat, params, trends, catNames, detectedCodes: detected, state })
  );
  const schedules = [...condLabSchedules, ...findingSchedules];
  const activeDetected = detected.filter((fc) => !overriddenFindings.has(fc));

  const protocolTier = resolveProtocolTierInStore(followup, params, rules, schedules, activeDetected, fallbackDays);
  const tmeta = getTierMeta(rules, protocolTier);
  followup.protocol_tier = protocolTier;
  const prevManual = followup.retest_plan?.manual_tier;
  const prevNotified = Boolean(followup.retest_plan?.urgent_notified);

  if (!schedules.length) {
    if (nonLabProtocols.length) {
      followup.retest_window_start = null;
      followup.retest_window_end = null;
      followup.reminder_on = null;
      followup.due_on = today;
      followup.retest_status = "DOCTOR_TO_SET";
      followup.retest_plan = {
        status: "DOCTOR_TO_SET", label: "Doctor to set retest date", source: "CONDITION",
        primary_finding: nonLabProtocols[0], findings: [], non_lab_protocols: nonLabProtocols,
        overridden_findings: [...overriddenFindings].sort(), default_tests: [],
        protocol_tier: protocolTier, tier_meta: tmeta, ...(prevManual ? { manual_tier: prevManual } : {}), ...(prevNotified ? { urgent_notified: true } : {}),
      };
    } else {
      const due = fallbackDays <= 0 ? today : addDaysIso(collected, fallbackDays);
      followup.retest_window_start = due;
      followup.retest_window_end = due;
      followup.reminder_on = null;
      followup.due_on = due;
      followup.retest_status = "FALLBACK";
      followup.retest_plan = {
        status: "FALLBACK", label: "Retest due", source: "FALLBACK", primary_finding: null, findings: [],
        non_lab_protocols: [], overridden_findings: [], default_tests: [],
        protocol_tier: protocolTier, tier_meta: tmeta, ...(prevManual ? { manual_tier: prevManual } : {}), ...(prevNotified ? { urgent_notified: true } : {}),
      };
    }
    notifyUrgentInStore(store, followup);
    return followup.retest_plan;
  }

  const autoItems = schedules.filter((s) => s.auto_scheduled && s.window_start);
  const akiSched = schedules.find((s) => s.finding_code === "HIGH_CREATININE");
  const top = akiSched || schedules[0];
  if (akiSched || !autoItems.length) {
    const defaultCodes = [...new Set(top.tests.filter((t) => !t.optional && catNames[t.code]).map((t) => t.code))].sort();
    followup.retest_window_start = null;
    followup.retest_window_end = null;
    followup.reminder_on = null;
    followup.due_on = today;
    followup.retest_status = "DOCTOR_TO_SET";
    followup.retest_plan = {
      status: "DOCTOR_TO_SET", label: "Doctor to set retest date", source: top.source || "FINDING",
      primary_finding: top, findings: schedules, non_lab_protocols: nonLabProtocols,
      overridden_findings: [...overriddenFindings].sort(), default_tests: defaultCodes,
      protocol_tier: protocolTier, tier_meta: tmeta, ...(prevManual ? { manual_tier: prevManual } : {}), ...(prevNotified ? { urgent_notified: true } : {}),
    };
    notifyUrgentInStore(store, followup);
    return followup.retest_plan;
  }

  const chosen = [...autoItems].sort((a, b) => a.window_start.localeCompare(b.window_start))[0];
  const defaultCodes = [...new Set(autoItems.flatMap((s) => s.tests).filter((t) => !t.optional && catNames[t.code]).map((t) => t.code))].sort();
  followup.retest_window_start = chosen.window_start;
  followup.retest_window_end = chosen.window_end;
  followup.reminder_on = chosen.reminder_on;
  followup.due_on = chosen.window_start;
  followup.retest_status = "AUTO_SCHEDULED";
  followup.retest_plan = {
    status: "AUTO_SCHEDULED", label: "Retest due", source: chosen.source || "FINDING",
    primary_finding: chosen, findings: schedules, non_lab_protocols: nonLabProtocols,
    overridden_findings: [...overriddenFindings].sort(), default_tests: defaultCodes,
    protocol_tier: protocolTier, tier_meta: tmeta, ...(prevManual ? { manual_tier: prevManual } : {}), ...(prevNotified ? { urgent_notified: true } : {}),
  };
  notifyUrgentInStore(store, followup);
  return followup.retest_plan;
}

export function overrideRetestInStore(followup, { window_start, window_end, reason_code, notes = "", user_id = null, rules = null }) {
  const winEnd = window_end || window_start;
  const plan = { ...(followup.retest_plan || {}) };
  if (plan.primary_finding) {
    plan.primary_finding = { ...plan.primary_finding, window_start, window_end: winEnd };
  }
  plan.status = "OVERRIDDEN";
  plan.label = "Retest due";
  plan.protocol_tier = followup.protocol_tier || "LONG_TERM";
  plan.tier_meta = getTierMeta(rules, plan.protocol_tier);
  plan.override = { reason_code, notes: String(notes || "").trim().slice(0, 300), by_user_id: user_id, at: new Date().toISOString() };
  followup.retest_window_start = window_start;
  followup.retest_window_end = winEnd;
  followup.due_on = window_start;
  followup.next_followup_on = window_start;
  followup.retest_status = "OVERRIDDEN";
  followup.retest_plan = plan;
  return plan;
}

export function retestReminderTickInStore(store, nowMs = Date.now()) {
  const today = todayIstStr(nowMs);
  let sent = 0;
  for (const fu of store.followups || []) {
    if (fu.suppressed_reason || DONE_STAGES.has(fu.stage)) continue;
    if (!["AUTO_SCHEDULED", "OVERRIDDEN", "DOCTOR_SET"].includes(fu.retest_status)) continue;
    if (!fu.reminder_on || fu.reminder_on > today || fu.reminder_sent_at) continue;
    fu.reminder_sent_at = new Date(nowMs).toISOString();
    if (!store.notifications) store.notifications = { unread: 0, items: [] };
    store.notifications.unread = (store.notifications.unread || 0) + 1;
    store.notifications.items.unshift({
      id: store.notifications.items.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1,
      text: "Retest reminder due",
      link: `/caller-card/view?id=${fu.id}`,
      urgent: false,
      read: false,
      at: new Date(nowMs).toISOString(),
    });
    sent += 1;
  }
  for (const ms of store.monitoring_schedules || []) {
    if (ms.status !== "ACTIVE" || !ms.start_on || !ms.end_on) continue;
    if (ms.start_on > today || ms.end_on < today || ms.last_reminded_on === today) continue;
    ms.last_reminded_on = today;
    if (!store.notifications) store.notifications = { unread: 0, items: [] };
    store.notifications.unread = (store.notifications.unread || 0) + 1;
    store.notifications.items.unshift({
      id: store.notifications.items.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1,
      text: "Home check-in reminder due",
      link: `/patients/view?id=${ms.patient_id}`,
      urgent: false,
      read: false,
      at: new Date(nowMs).toISOString(),
    });
    sent += 1;
  }
  return sent;
}

export function slaTickInStore(store, nowMs = Date.now()) {
  const meta = getTierMeta(store.rules, "URGENT");
  const slaHours = Number(meta.sla_hours || 24);
  const cutoffMs = nowMs - slaHours * 3600 * 1000;
  let escalated = 0;
  for (const fu of store.followups || []) {
    if (fu.suppressed_reason || DONE_STAGES.has(fu.stage)) continue;
    if (fu.protocol_tier !== "URGENT" || fu.sla_escalated_at) continue;
    if (fu.accepted_at || Number(fu.attempts || 0) > 0) continue;
    const createdMs = Date.parse(fu.created_at || "");
    if (Number.isNaN(createdMs) || createdMs > cutoffMs) continue;
    fu.sla_escalated_at = new Date(nowMs).toISOString();
    if (!store.notifications) store.notifications = { unread: 0, items: [] };
    store.notifications.unread = (store.notifications.unread || 0) + 1;
    store.notifications.items.unshift({
      id: store.notifications.items.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1,
      text: `SLA overdue: urgent follow-up unattended (>${slaHours}h)`,
      link: `/followups/view?id=${fu.id}`,
      urgent: true,
      read: false,
      at: new Date(nowMs).toISOString(),
    });
    if (!store.audit) store.audit = [];
    store.audit.unshift({
      id: store.audit.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1,
      user_id: null,
      action: "sla_escalate",
      entity: "followup",
      entity_id: String(fu.id),
      at: new Date(nowMs).toISOString(),
    });
    escalated += 1;
  }
  return escalated;
}
