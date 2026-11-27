/**
 * Holistic Health Loop, Health Profiles & Programme Recommendation Engine (Pages 1-4)
 * Pure ES Module shared by Cloudflare Worker (worker.js) and unit/parity tests.
 */

export const STAGES = [
  "PREVENTION",
  "EATING_WELL",
  "DIAGNOSTICS",
  "CONSULTATIONS",
  "MEDICATIONS",
  "CHRONIC_CONDITIONS",
  "ONGOING_MONITORING",
];

export const DONE_STAGES = new Set(["DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED", "DECLINED", "WRONG_NUMBER"]);

export const DEFAULT_CARE_SERVICES = [
  { code: "DIETITIAN_PLAN", name: "Dietitian nutrition plan", stage: "EATING_WELL", default_amount_inr: 999 },
  { code: "PREVENTIVE_SCREEN", name: "Preventive screening plan", stage: "PREVENTION", default_amount_inr: 1499 },
  { code: "PHARMACY_REFILL", name: "Pharmacy refill", stage: "MEDICATIONS", default_amount_inr: 500 },
  { code: "HOME_COLLECTION", name: "Home sample collection", stage: "DIAGNOSTICS", default_amount_inr: 250 },
  { code: "TELECONSULT", name: "Doctor teleconsultation", stage: "CONSULTATIONS", default_amount_inr: 499 },
];

export const DEFAULT_RELATIONSHIP_THRESHOLDS = { new_days: 30, active_days: 90, at_risk_days: 180 };

export const DEFAULT_RELATIONSHIP_NEXT_STEPS = [
  { code: "SCHEDULE_RETEST", rule: "chronic_without_monitoring", clinical_label: "Schedule retest", caller_label: "Routine check-in call" },
  { code: "DOCTOR_CONSULTATION", rule: "abnormal_diagnostics_without_consultation", clinical_label: "Doctor consultation", caller_label: "Doctor consultation follow-up" },
  { code: "DIET_PLAN", rule: "chronic_without_eating_well", clinical_label: "Diet plan", caller_label: "Wellness plan follow-up" },
  { code: "REENGAGEMENT_CALL", rule: "lapsed_or_at_risk", clinical_label: "Re-engagement call", caller_label: "Care check-in call" },
  { code: "PREVENTIVE_SCREENING", rule: "normal_diagnostics_only", clinical_label: "Preventive screening plan", caller_label: "Preventive health check-in" },
];

export const DEFAULT_PROFILE_CODES = {
  family_history: ["DIABETES", "HEART_DISEASE", "HYPERTENSION", "THYROID", "KIDNEY", "CANCER", "OSTEOPOROSIS"],
  symptoms: [
    "FATIGUE", "POOR_SLEEP", "SNORING", "DAYTIME_SLEEPINESS", "HIGH_STRESS", "LOW_MOOD",
    "ANXIETY", "JOINT_PAIN", "BREATHLESSNESS", "IRREGULAR_PERIODS", "HAIR_LOSS", "WEIGHT_GAIN",
  ],
  activity_levels: ["SEDENTARY", "LIGHT", "MODERATE", "ACTIVE"],
  physical_limitations: ["NONE", "JOINT_PROBLEM", "BACK_PROBLEM", "HEART_CONDITION", "BALANCE_PROBLEM", "OTHER"],
  functional_statuses: ["INDEPENDENT", "NEEDS_SOME_HELP", "DEPENDENT"],
  imaging_findings: ["OSTEOPENIA", "OSTEOPOROSIS", "FATTY_LIVER_USG", "THYROID_NODULE"],
  menstrual_patterns: ["REGULAR", "IRREGULAR", "ABSENT"],
  decline_reasons: ["CLINICALLY_NOT_INDICATED", "PATIENT_DECLINED", "ALREADY_MANAGED", "CONTRAINDICATED", "OTHER"],
  specialties: ["Gynecology", "Endocrinology", "Andrology/Urology", "Fertility specialist", "Geriatrics", "Obesity medicine"],
  conditions: [
    "B12_DEFICIENCY",
    "IRON_DEFICIENCY",
    "PREDIABETES",
    "DIABETES_STABLE",
    "DIABETES_UNCONTROLLED",
    "HYPOTHYROID_STABLE_TREATED",
    "HYPERTENSION",
    "CKD",
    "DYSLIPIDEMIA_NEW_MED",
    "DYSLIPIDEMIA_STABLE",
  ],
};

export const DEFAULT_CARE_PROGRAMS = [
  // Page 2 (1-8)
  {
    code: "VITAMIN_PLAN", doc_number: "1", group: "Wellness",
    clinical_label: "Vitamin Plan", caller_label: "Wellness plan follow-up",
    trigger_text: "Low Vitamin D, B12 or other confirmed deficiencies.",
    offering_text: "Clinician-approved supplementation, reminders and retesting.",
    loop_stage: "PREVENTION", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { any: [
      { lab: "VITD", flag: "LOW" }, { lab: "B12", flag: "LOW" }, { lab: "FOLATE", flag: "LOW" },
      { lab: "FERRITIN", flag: "LOW" }, { lab: "CALCIUM", flag: "LOW" },
    ] },
  },
  {
    code: "DIET_PLAN", doc_number: "2", group: "Wellness",
    clinical_label: "Personalized Diet Plan", caller_label: "Wellness plan follow-up",
    trigger_text: "HbA1c, lipid abnormalities, obesity-related findings.",
    offering_text: "Dietitian-designed nutrition plan.",
    loop_stage: "EATING_WELL", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { any: [
      { lab: "HBA1C", flag: "HIGH" },
      { lab_any: ["CHOL", "LDL", "TG", "NON_HDL"], flag: "ABNORMAL" },
      { lab: "HDL", flag: "LOW" },
      { profile: "vitals.bmi", op: ">=", value: 25 },
    ] },
  },
  {
    code: "PREVENTIVE_PLAN", doc_number: "3", group: "Wellness",
    clinical_label: "Preventive Health Plan", caller_label: "Wellness plan follow-up",
    trigger_text: "Age, family history, risk factors and screening history.",
    offering_text: "Personalized annual screening schedule.",
    loop_stage: "PREVENTION", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { any: [
      { age: ">=", value: 30 },
      { profile: "family_history", any_present: true },
      { no_recent_screening_months: 12 },
    ] },
  },
  {
    code: "WEIGHT_PLAN", doc_number: "4", group: "Wellness",
    clinical_label: "Weight Management Plan", caller_label: "Wellness plan follow-up",
    trigger_text: "BMI, HbA1c, lipids and metabolic risk.",
    offering_text: "Diet, exercise, doctor review and progress tracking.",
    loop_stage: "EATING_WELL", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { any: [
      { profile: "vitals.bmi", op: ">=", value: 25 },
      { all: [
        { profile: "vitals.bmi", op: ">=", value: 23 },
        { any: [
          { lab: "HBA1C", flag: "HIGH" },
          { lab_any: ["CHOL", "LDL", "TG", "NON_HDL"], flag: "ABNORMAL" },
          { lab: "HDL", flag: "LOW" },
        ] },
      ] },
    ] },
  },
  {
    code: "FITNESS_PLAN", doc_number: "5", group: "Wellness",
    clinical_label: "Fitness & Exercise Plan", caller_label: "Wellness plan follow-up",
    trigger_text: "Metabolic risk, physical limitations and clinical history.",
    offering_text: "Personalized activity and fitness guidance.",
    loop_stage: "PREVENTION", mode: "AUTO_SUGGEST", clearance_if_limitations: true, note: "starter value, clinician to confirm",
    trigger: { all: [
      { any: [
        { lab: "HBA1C", flag: "HIGH" },
        { lab_any: ["CHOL", "LDL", "TG", "NON_HDL"], flag: "ABNORMAL" },
        { lab: "HDL", flag: "LOW" },
        { profile: "vitals.bmi", op: ">=", value: 23 },
      ] },
      { profile: "lifestyle.activity_level", in: ["SEDENTARY", "LIGHT"] },
    ] },
  },
  {
    code: "SLEEP_PLAN", doc_number: "6", group: "Wellness",
    clinical_label: "Sleep Improvement Plan", caller_label: "Wellness plan follow-up",
    trigger_text: "Relevant symptoms, obesity and metabolic risk.",
    offering_text: "Sleep assessment, sleep hygiene and referral where indicated.",
    loop_stage: "PREVENTION", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { any: [
      { profile: "symptoms", contains_any: ["POOR_SLEEP", "SNORING", "DAYTIME_SLEEPINESS"] },
      { all: [{ profile: "vitals.bmi", op: ">=", value: 30 }, { metabolic_abnormal: true }] },
    ] },
  },
  {
    code: "STRESS_PLAN", doc_number: "7", group: "Wellness",
    clinical_label: "Stress & Mental Wellness Plan", caller_label: "Wellness consultation follow-up",
    trigger_text: "Patient-reported stress, symptoms and relevant history.",
    offering_text: "Mental wellness screening and professional support.",
    loop_stage: "PREVENTION", mode: "DOCTOR_CONSIDER", note: "starter value, clinician to confirm",
    trigger: { profile: "symptoms", contains_any: ["HIGH_STRESS", "LOW_MOOD", "ANXIETY"] },
  },
  {
    code: "HEALTHY_AGING_PLAN", doc_number: "8", group: "Wellness",
    clinical_label: "Healthy Aging Plan", caller_label: "Wellness plan follow-up",
    trigger_text: "Age, functional status, nutritional and metabolic findings.",
    offering_text: "Age-appropriate preventive and functional health program.",
    loop_stage: "PREVENTION", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { all: [
      { age: ">=", value: 60 },
      { any: [
        { profile: "functional_status", in: ["NEEDS_SOME_HELP", "DEPENDENT"] },
        { lab_any: ["VITD", "B12", "ALB", "HB"], flag: "LOW" },
        { metabolic_abnormal: true },
      ] },
    ] },
  },
  // Page 3 (9-17)
  {
    code: "DIABETES_MGMT", doc_number: "9", group: "Disease-specific management",
    clinical_label: "Diabetes Management Plan", caller_label: "Doctor follow-up plan",
    trigger_text: "Elevated HbA1c or glucose.",
    offering_text: "Doctor, dietitian, glucose monitoring and medication adherence.",
    loop_stage: "CHRONIC_CONDITIONS", mode: "AUTO_SUGGEST", linked_bucket: "DIABETES", note: "starter value, clinician to confirm",
    trigger: { any: [{ lab_any: ["HBA1C", "GLU_F", "GLU_PP", "GLU_R"], flag: "HIGH" }, { bucket: "DIABETES" }] },
  },
  {
    code: "CARDIAC_RISK_MGMT", doc_number: "10", group: "Disease-specific management",
    clinical_label: "Cardiac Risk Management", caller_label: "Doctor follow-up plan",
    trigger_text: "Lipid abnormalities and cardiovascular risk factors.",
    offering_text: "Cardiovascular assessment, lifestyle and follow-up.",
    loop_stage: "CHRONIC_CONDITIONS", mode: "AUTO_SUGGEST", linked_bucket: "LIPID", note: "starter value, clinician to confirm",
    trigger: { any: [
      { lab_any: ["CHOL", "LDL", "TG", "NON_HDL"], flag: "HIGH" },
      { lab: "HDL", flag: "LOW" },
      { bucket: "LIPID" },
    ] },
  },
  {
    code: "HYPERTENSION_MGMT", doc_number: "11", group: "Disease-specific management",
    clinical_label: "Hypertension Management", caller_label: "Doctor follow-up plan",
    trigger_text: "Elevated BP readings and relevant clinical history.",
    offering_text: "BP monitoring, consultation and medication refill support.",
    loop_stage: "CHRONIC_CONDITIONS", mode: "AUTO_SUGGEST", linked_bucket: "HYPERTENSION", note: "starter value, clinician to confirm",
    trigger: { any: [{ bp_high: true }, { condition: "HYPERTENSION", status: "CONFIRMED" }] },
  },
  {
    code: "THYROID_MGMT", doc_number: "12", group: "Disease-specific management",
    clinical_label: "Thyroid Management", caller_label: "Doctor follow-up plan",
    trigger_text: "Abnormal TSH, T3 or T4.",
    offering_text: "Physician consultation, medication tracking and appropriate retesting.",
    loop_stage: "CHRONIC_CONDITIONS", mode: "AUTO_SUGGEST", linked_bucket: "THYROID", note: "starter value, clinician to confirm",
    trigger: { any: [{ lab_any: ["TSH", "T3", "T4", "FT3", "FT4"], flag: "ABNORMAL" }, { bucket: "THYROID" }] },
  },
  {
    code: "KIDNEY_HEALTH", doc_number: "13/14", group: "Disease-specific management",
    clinical_label: "Kidney Health Plan", caller_label: "Doctor follow-up plan",
    trigger_text: "Abnormal creatinine, eGFR or urine albumin.",
    offering_text: "Kidney risk assessment, clinician review and monitoring.",
    loop_stage: "CHRONIC_CONDITIONS", mode: "AUTO_SUGGEST", linked_bucket: "KIDNEY", note: "starter value, clinician to confirm",
    trigger: { any: [
      { lab: "CREAT", flag: "HIGH" }, { lab: "EGFR", flag: "LOW" },
      { lab: "UACR", flag: "HIGH" }, { bucket: "KIDNEY" },
    ] },
  },
  {
    code: "LIVER_HEALTH", doc_number: "15", group: "Disease-specific management",
    clinical_label: "Liver Health Plan", caller_label: "Doctor follow-up plan",
    trigger_text: "Abnormal liver enzymes or other liver-related findings.",
    offering_text: "Physician evaluation, metabolic assessment and follow-up.",
    loop_stage: "CHRONIC_CONDITIONS", mode: "AUTO_SUGGEST", linked_bucket: "LIVER", note: "starter value, clinician to confirm",
    trigger: { any: [
      { lab_any: ["ALT", "AST", "ALP", "GGT", "BILI_T"], flag: "HIGH" },
      { lab: "ALB", flag: "LOW" },
      { condition: "FATTY_LIVER", status: "CONFIRMED" },
      { imaging: "FATTY_LIVER_USG" },
      { bucket: "LIVER" },
    ] },
  },
  {
    code: "ANEMIA_MGMT", doc_number: "16", group: "Disease-specific management",
    clinical_label: "Anemia Management", caller_label: "Doctor follow-up plan",
    trigger_text: "Low hemoglobin, ferritin or abnormal blood indices.",
    offering_text: "Investigation of cause, nutritional/medical management and retesting.",
    loop_stage: "CHRONIC_CONDITIONS", mode: "AUTO_SUGGEST", linked_bucket: "ANAEMIA", note: "starter value, clinician to confirm",
    trigger: { any: [
      { lab: "HB", flag: "LOW" }, { lab: "FERRITIN", flag: "LOW" },
      { lab_any: ["MCV", "MCH", "MCHC", "RDW_CV"], flag: "ABNORMAL" },
      { bucket: "ANAEMIA" },
    ] },
  },
  {
    code: "BONE_HEALTH", doc_number: "17", group: "Disease-specific management",
    clinical_label: "Bone Health Plan", caller_label: "Doctor follow-up plan",
    trigger_text: "Vitamin D deficiency, osteoporosis risk or relevant imaging.",
    offering_text: "Bone health assessment and clinician-directed management.",
    loop_stage: "CHRONIC_CONDITIONS", mode: "AUTO_SUGGEST", linked_bucket: "BONE", note: "starter value, clinician to confirm",
    trigger: { any: [
      { all: [
        { lab: "VITD", flag: "LOW" },
        { any: [
          { age: ">=", value: 50 },
          { all: [{ gender: "F" }, { age: ">=", value: 45 }] },
          { profile: "family_history", contains: "OSTEOPOROSIS" },
        ] },
      ] },
      { condition: "OSTEOPOROSIS", status: "CONFIRMED" },
      { condition: "OSTEOPENIA", status: "CONFIRMED" },
      { imaging: "OSTEOPOROSIS" },
      { imaging: "OSTEOPENIA" },
    ] },
  },
  // Page 4 (17-22)
  {
    code: "WOMENS_HEALTH", doc_number: "17", group: "Specialized clinical programs",
    clinical_label: "Women's Health Plan", caller_label: "Doctor consultation follow-up",
    trigger_text: "Anemia, thyroid abnormalities, age and relevant symptoms.",
    offering_text: "Gynecology, nutrition and preventive screening.",
    loop_stage: "CONSULTATIONS", mode: "DOCTOR_CONSIDER", specialty: "Gynecology", note: "starter value, clinician to confirm",
    trigger: { all: [
      { gender: "F" },
      { any: [
        { age: ">=", value: 40 },
        { all: [
          { any: [{ lab: "HB", flag: "LOW" }, { lab_any: ["TSH", "T3", "T4", "FT3", "FT4"], flag: "ABNORMAL" }] },
          { profile: "symptoms", contains_any: ["FATIGUE", "IRREGULAR_PERIODS", "HAIR_LOSS", "WEIGHT_GAIN"] },
        ] },
      ] },
    ] },
  },
  {
    code: "PCOS_MGMT", doc_number: "18", group: "Specialized clinical programs",
    clinical_label: "PCOS Management Plan", caller_label: "Doctor consultation follow-up",
    trigger_text: "Relevant metabolic findings plus clinical symptoms.",
    offering_text: "Gynecology/endocrinology review, diet and lifestyle program.",
    loop_stage: "CONSULTATIONS", mode: "DOCTOR_CONSIDER", specialty: "Endocrinology", note: "starter value, clinician to confirm",
    trigger: { all: [
      { gender: "F" },
      { age: "between", min: 15, max: 45 },
      { any: [
        { profile: "symptoms", contains: "IRREGULAR_PERIODS" },
        { profile: "reproductive.menstrual_pattern", op: "==", value: "IRREGULAR" },
      ] },
      { any: [
        { lab_any: ["HBA1C", "GLU_F", "GLU_PP", "GLU_R", "TG"], flag: "HIGH" },
        { lab: "HDL", flag: "LOW" },
        { profile: "vitals.bmi", op: ">=", value: 23 },
        { lab: "TESTOSTERONE", flag: "HIGH" },
        { lab_ratio: ["LH", "FSH"], op: ">=", value: 2.0 },
      ] },
    ] },
  },
  {
    code: "MENS_HEALTH", doc_number: "19", group: "Specialized clinical programs",
    clinical_label: "Men's Health Plan", caller_label: "Doctor consultation follow-up",
    trigger_text: "Age, metabolic markers and clinical history.",
    offering_text: "Cardiometabolic, sexual and preventive health assessment.",
    loop_stage: "CONSULTATIONS", mode: "DOCTOR_CONSIDER", specialty: "Andrology/Urology", note: "starter value, clinician to confirm",
    trigger: { all: [
      { gender: "M" },
      { age: ">=", value: 40 },
      { any: [
        { metabolic_abnormal: true },
        { profile: "family_history", any_present: true },
        { profile: "conditions", any_present: true },
      ] },
    ] },
  },
  {
    code: "FERTILITY_PRECONCEPTION", doc_number: "20", group: "Specialized clinical programs",
    clinical_label: "Fertility & Preconception Plan", caller_label: "Doctor consultation follow-up",
    trigger_text: "Relevant reproductive investigations and medical history.",
    offering_text: "Specialist consultation, nutritional assessment and follow-up.",
    loop_stage: "CONSULTATIONS", mode: "DOCTOR_CONSIDER", specialty: "Fertility specialist", note: "starter value, clinician to confirm",
    trigger: { any: [
      { profile: "reproductive.planning_pregnancy", op: "==", value: true },
      { profile: "reproductive.trying_to_conceive_months", op: ">=", value: 12 },
      { lab_any: ["AMH", "LH", "FSH", "PROLACTIN", "TESTOSTERONE", "BETA_HCG"], flag: "ABNORMAL" },
    ] },
  },
  {
    code: "SENIOR_CARE", doc_number: "21", group: "Specialized clinical programs",
    clinical_label: "Senior Citizen Care Plan", caller_label: "Doctor consultation follow-up",
    trigger_text: "Age, comorbidities, medication burden and functional needs.",
    offering_text: "Elder care, home visits and caregiver support.",
    loop_stage: "CHRONIC_CONDITIONS", mode: "DOCTOR_CONSIDER", specialty: "Geriatrics", note: "starter value, clinician to confirm",
    trigger: { all: [
      { age: ">=", value: 60 },
      { any: [
        { chronic_count: ">=", value: 2 },
        { profile: "medicine_count", op: ">=", value: 5 },
        { profile: "functional_status", in: ["NEEDS_SOME_HELP", "DEPENDENT"] },
      ] },
    ] },
  },
  {
    code: "GLP1_WEIGHT_ASSESSMENT", doc_number: "22", group: "Specialized clinical programs",
    clinical_label: "GLP-1 / Medical Weight-Loss Assessment", caller_label: "Doctor consultation follow-up",
    trigger_text: "Obesity-related clinical criteria and metabolic risk.",
    offering_text: "Physician-led eligibility assessment (eligibility is decided by a physician in person), treatment monitoring and nutrition support.",
    loop_stage: "CONSULTATIONS", mode: "DOCTOR_CONSIDER", specialty: "Obesity medicine", note: "starter value, clinician to confirm (Asian BMI cut-offs)",
    trigger: { any: [
      { profile: "vitals.bmi", op: ">=", value: 32.5 },
      { all: [{ profile: "vitals.bmi", op: ">=", value: 27.5 }, { metabolic_abnormal: true }] },
    ] },
  },
  // Page 5 (23-30)
  {
    code: "MED_REVIEW", doc_number: "23", group: "Medication & treatment support",
    clinical_label: "Medication Review Plan", caller_label: "Care review follow-up",
    trigger_text: "Existing prescriptions, relevant lab abnormalities.",
    offering_text: "Pharmacist/doctor review of medication safety.",
    loop_stage: "MEDICATIONS", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { all: [{ has_active_meds: true }, { any_lab_abnormal: true }] },
  },
  {
    code: "PHARMACY_REFILL", doc_number: "24", group: "Medication & treatment support",
    clinical_label: "Monthly Pharmacy Refill Plan", caller_label: "Pharmacy refill reminder call",
    trigger_text: "Active chronic medication prescriptions.",
    offering_text: "Automated refill reminders and home delivery.",
    loop_stage: "MEDICATIONS", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { has_chronic_meds: true },
  },
  {
    code: "DRUG_NUTRIENT_REVIEW", doc_number: "25", group: "Medication & treatment support",
    clinical_label: "Drug-Nutrient Interaction Review", caller_label: "Care plan review call",
    trigger_text: "Medication list plus nutritional findings.",
    offering_text: "Clinician/pharmacist assessment of potential interactions.",
    loop_stage: "MEDICATIONS", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { drug_nutrient_match: true },
  },
  {
    code: "TREATMENT_RESPONSE", doc_number: "26", group: "Medication & treatment support",
    clinical_label: "Treatment Response Monitoring", caller_label: "Follow-up care check-in",
    trigger_text: "Serial reports and active treatment plan.",
    offering_text: "Biomarker trend analysis and scheduled clinical follow-up.",
    loop_stage: "ONGOING_MONITORING", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { treatment_response: true },
  },
  {
    code: "FOLLOWUP_DIAGNOSTIC", doc_number: "27", group: "Diagnostic & specialist",
    clinical_label: "Follow-up Diagnostic Plan", caller_label: "Diagnostic follow-up call",
    trigger_text: "Abnormal, borderline or changing results.",
    offering_text: "Appropriate confirmatory tests and retesting.",
    loop_stage: "DIAGNOSTICS", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { any: [{ any_lab_abnormal: true }, { borderline_pct: 5 }, { delta_pct: 10 }] },
  },
  {
    code: "SPECIALIST_CONSULT", doc_number: "28", group: "Diagnostic & specialist",
    clinical_label: "Specialist Consultation Plan", caller_label: "Specialist appointment to book",
    trigger_text: "Findings requiring further clinical evaluation.",
    offering_text: "Relevant specialist appointment.",
    loop_stage: "CONSULTATIONS", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { any: [{ has_open_referral: true }, { any_lab_severe: true }, { is_escalation: true }] },
  },
  {
    code: "HOME_MONITORING", doc_number: "29", group: "Diagnostic & specialist",
    clinical_label: "Home Health Monitoring Plan", caller_label: "Home check-in plan",
    trigger_text: "Diabetes, hypertension or other monitoring needs.",
    offering_text: "Connected devices, home visits and digital tracking.",
    loop_stage: "ONGOING_MONITORING", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { any: [
      { bucket: "DIABETES" }, { bucket: "HYPERTENSION" },
      { condition: "DIABETES", status: "CONFIRMED" }, { condition: "HYPERTENSION", status: "CONFIRMED" },
      { profile: "monitoring_requested", op: "==", value: true }, { has_home_readings: true },
    ] },
  },
  {
    code: "FAMILY_PREVENTIVE", doc_number: "30", group: "Family & longitudinal",
    clinical_label: "Family Preventive Health Plan", caller_label: "Family preventive check-in",
    trigger_text: "Family history, age and individual risk factors.",
    offering_text: "Consent-based family screening and prevention plans.",
    loop_stage: "PREVENTION", mode: "AUTO_SUGGEST", note: "starter value, clinician to confirm",
    trigger: { all: [
      { any: [{ profile: "family_history", any_present: true }, { family_member_chronic: true }] },
      { any: [{ age: ">=", value: 25 }, { profile: "vitals.bmi", op: ">=", value: 23 }, { profile: "lifestyle.smoking", op: "==", value: true }, { any_lab_abnormal: true }] },
    ] },
  },
];

export const HOME_KINDS = new Set(["BP", "GLUCOSE_FASTING", "GLUCOSE_RANDOM", "WEIGHT", "SPO2"]);
export const MAX_HOME_CSV_BYTES = 5 * 1024 * 1024;

export const DEFAULT_MEDICINE_CATALOGUE = [
  { code: "METFORMIN", generic_name: "Metformin", drug_class: "BIGUANIDE", is_chronic: true, default_refill_days: 30, linked_markers: ["HBA1C", "GLU_F", "GLU_PP", "GLU_R"], note: "clinician to confirm" },
  { code: "GLIMEPIRIDE", generic_name: "Glimepiride", drug_class: "SULFONYLUREA", is_chronic: true, default_refill_days: 30, linked_markers: ["HBA1C", "GLU_F", "GLU_PP", "GLU_R"], note: "clinician to confirm" },
  { code: "INSULIN", generic_name: "Insulin", drug_class: "INSULIN", is_chronic: true, default_refill_days: 30, linked_markers: ["HBA1C", "GLU_F", "GLU_PP", "GLU_R"], note: "clinician to confirm" },
  { code: "ATORVASTATIN", generic_name: "Atorvastatin", drug_class: "STATIN", is_chronic: true, default_refill_days: 30, linked_markers: ["CHOL", "LDL", "TG", "NON_HDL"], note: "clinician to confirm" },
  { code: "LEVOTHYROXINE", generic_name: "Levothyroxine", drug_class: "THYROID_HORMONE", is_chronic: true, default_refill_days: 30, linked_markers: ["TSH", "FT4", "T4"], note: "clinician to confirm" },
  { code: "AMLODIPINE", generic_name: "Amlodipine", drug_class: "CCB_ANTIHYPERTENSIVE", is_chronic: true, default_refill_days: 30, linked_markers: ["BP"], note: "clinician to confirm" },
  { code: "TELMISARTAN", generic_name: "Telmisartan", drug_class: "ARB_ANTIHYPERTENSIVE", is_chronic: true, default_refill_days: 30, linked_markers: ["BP", "CREAT", "POTASSIUM"], note: "clinician to confirm" },
  { code: "OMEPRAZOLE", generic_name: "Omeprazole", drug_class: "PPI", is_chronic: false, default_refill_days: 30, linked_markers: [], note: "clinician to confirm" },
  { code: "FERROUS_SULFATE", generic_name: "Elemental Iron", drug_class: "IRON_SUPPLEMENT", is_chronic: false, default_refill_days: 30, linked_markers: ["HB", "FERRITIN"], note: "clinician to confirm" },
  { code: "CHOLECALCIFEROL", generic_name: "Vitamin D3", drug_class: "VITAMIN_D_SUPPLEMENT", is_chronic: false, default_refill_days: 30, linked_markers: ["VITD"], note: "clinician to confirm" },
  { code: "METHYLCOBALAMIN", generic_name: "Vitamin B12", drug_class: "B12_SUPPLEMENT", is_chronic: false, default_refill_days: 30, linked_markers: ["B12"], note: "clinician to confirm" },
];

export const DEFAULT_DRUG_NUTRIENT_RULES = [
  { drug_class: "BIGUANIDE", nutrient_marker: "B12", direction: "LOW", note: "Metformin use is associated with lower Vitamin B12 levels; pharmacist/clinician to confirm." },
  { drug_class: "PPI", nutrient_marker: "B12", direction: "LOW", note: "Long-term PPI use is associated with reduced Vitamin B12; pharmacist/clinician to confirm." },
  { drug_class: "PPI", nutrient_marker: "MAGNESIUM", direction: "LOW", note: "Long-term PPI use is associated with low magnesium; pharmacist/clinician to confirm." },
  { drug_class: "ARB_ANTIHYPERTENSIVE", nutrient_marker: "POTASSIUM", direction: "HIGH", note: "ARB therapy may elevate serum potassium; pharmacist/clinician to confirm." },
];

export const DEFAULT_REFERRAL_SPECIALTIES = {
  Cardiology: "Specialist appointment to book",
  Endocrinology: "Specialist appointment to book",
  Nephrology: "Specialist appointment to book",
  "Gastroenterology/Hepatology": "Specialist appointment to book",
  Gynecology: "Specialist appointment to book",
  Orthopaedics: "Specialist appointment to book",
  Neurology: "Specialist appointment to book",
  "Psychiatry/Psychology": "Specialist appointment to book",
  Geriatrics: "Specialist appointment to book",
  Urology: "Specialist appointment to book",
  "Andrology/Urology": "Specialist appointment to book",
  "Fertility specialist": "Specialist appointment to book",
  "Obesity medicine": "Specialist appointment to book",
};

const SYNONYM_PAIRS = [
  ["HB", "HEMOGLOBIN"], ["TG", "TRIGLYCERIDES"], ["CHOL", "CHOL_TOTAL"], ["VITD", "VITAMIN_D"],
  ["CREAT", "CREATININE"], ["ALT", "SGPT"], ["AST", "SGOT"], ["ALB", "ALBUMIN"],
  ["BILI_T", "BILIRUBIN"], ["GLU_F", "GLUCOSE_FASTING"], ["GLU_PP", "GLUCOSE_PP"], ["GLU_R", "GLUCOSE_RANDOM"],
];
export const SYNONYMS = {};
for (const [a, b] of SYNONYM_PAIRS) {
  const s = new Set([a, b]);
  SYNONYMS[a] = s;
  SYNONYMS[b] = s;
}

const MISSING_LABELS = {
  "vitals.bmi": "BMI not recorded",
  "lifestyle.activity_level": "Activity level not recorded",
  "functional_status": "Functional status not recorded",
  "reproductive.planning_pregnancy": "Reproductive history not recorded",
  "reproductive.trying_to_conceive_months": "Reproductive history not recorded",
  "reproductive.menstrual_pattern": "Menstrual pattern not recorded",
  "medicine_count": "Medicine count not recorded",
};

export function todayIstStr(nowMs = Date.now()) {
  return new Date(nowMs + 330 * 60000).toISOString().slice(0, 10);
}

function diffDays(aIso, bIso) {
  const a = Date.parse(`${aIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${bIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

export function defaultProfile() {
  return {
    vitals: { height_cm: null, weight_kg: null, bmi: null, waist_cm: null, bp_readings: [] },
    family_history: [],
    symptoms: [],
    lifestyle: { activity_level: "", sleep_hours: null, smoking: false, alcohol: "", diet_type: "" },
    physical_limitations: [],
    functional_status: "",
    screening_history: [],
    conditions: [],
    targets: {},
    imaging_findings: [],
    reproductive: { planning_pregnancy: null, trying_to_conceive_months: null, menstrual_pattern: "", pregnancies: null },
    caregiver: { name: "", relationship: "", phone: "", phone_consent: false },
    medicine_count: null,
    monitoring_requested: false,
  };
}

export function cleanProfile(raw) {
  const base = defaultProfile();
  if (!raw || typeof raw !== "object") return base;
  for (const k of ["family_history", "physical_limitations"]) {
    if (Array.isArray(raw[k])) base[k] = raw[k].map((x) => String(x || "").trim().toUpperCase()).filter(Boolean);
  }
  if (Array.isArray(raw.symptoms)) {
    base.symptoms = raw.symptoms.map((s) => {
      if (s && typeof s === "object" && s.code) return { code: String(s.code).trim().toUpperCase(), date: String(s.date || "").slice(0, 20) };
      if (typeof s === "string" && s.trim()) return { code: s.trim().toUpperCase(), date: "" };
      return null;
    }).filter(Boolean);
  }
  if (raw.vitals && typeof raw.vitals === "object") {
    const v = raw.vitals;
    const h = v.height_cm !== null && v.height_cm !== undefined && v.height_cm !== "" ? Number(v.height_cm) : null;
    const w = v.weight_kg !== null && v.weight_kg !== undefined && v.weight_kg !== "" ? Number(v.weight_kg) : null;
    const waist = v.waist_cm !== null && v.waist_cm !== undefined && v.waist_cm !== "" ? Number(v.waist_cm) : null;
    const bmi = h && w && h > 0 && w > 0 ? Math.round((w / ((h / 100) ** 2)) * 10) / 10 : null;
    const bps = (v.bp_readings || []).filter((r) => r && r.systolic && r.diastolic).map((r) => ({
      systolic: Number(r.systolic),
      diastolic: Number(r.diastolic),
      taken_on: String(r.taken_on || "").slice(0, 20),
      where: ["CLINIC", "HOME"].includes(String(r.where || "CLINIC").toUpperCase()) ? String(r.where || "CLINIC").toUpperCase() : "CLINIC",
    }));
    base.vitals = { height_cm: h, weight_kg: w, bmi, waist_cm: waist, bp_readings: bps };
  }
  if (raw.lifestyle && typeof raw.lifestyle === "object") {
    const ls = raw.lifestyle;
    base.lifestyle = {
      activity_level: String(ls.activity_level || "").trim().toUpperCase(),
      sleep_hours: ls.sleep_hours !== null && ls.sleep_hours !== undefined && ls.sleep_hours !== "" ? Number(ls.sleep_hours) : null,
      smoking: Boolean(ls.smoking),
      alcohol: String(ls.alcohol || "").slice(0, 40),
      diet_type: String(ls.diet_type || "").slice(0, 40),
    };
  }
  base.functional_status = String(raw.functional_status || "").trim().toUpperCase();
  if (Array.isArray(raw.screening_history)) {
    base.screening_history = raw.screening_history
      .filter((x) => x && typeof x === "object" && x.screen_code)
      .map((x) => ({ screen_code: String(x.screen_code).trim().toUpperCase(), done_on: String(x.done_on || "").slice(0, 20) }));
  }
  if (Array.isArray(raw.conditions)) {
    base.conditions = raw.conditions
      .filter((x) => x && typeof x === "object" && x.code)
      .map((x) => ({
        code: String(x.code).trim().toUpperCase(),
        status: String(x.status || "CONFIRMED").trim().toUpperCase(),
        stage: String(x.stage || "").slice(0, 30),
        since: String(x.since || "").slice(0, 20),
        confirmed_by: x.confirmed_by !== null && x.confirmed_by !== undefined && x.confirmed_by !== "" ? Number(x.confirmed_by) : null,
      }));
  }
  if (raw.targets && typeof raw.targets === "object" && !Array.isArray(raw.targets)) {
    const cleanT = {};
    for (const [k, v] of Object.entries(raw.targets)) {
      const code = String(k || "").trim().toUpperCase();
      if (!code) continue;
      if (typeof v === "number") {
        cleanT[code] = { target_op: "<", target_value: Number(v), unit: code === "HBA1C" ? "%" : "" };
      } else if (v && typeof v === "object") {
        const rawOp = String(v.target_op || (v.target_low !== undefined || v.target_high !== undefined ? "RANGE" : "<")).trim().toUpperCase();
        const op = ["<", "<=", ">", ">=", "==", "RANGE"].includes(rawOp) ? rawOp : "<";
        const dir = String(v.direction || "").trim().toUpperCase();
        const entry = { target_op: op, unit: String(v.unit || (code === "HBA1C" ? "%" : "")).slice(0, 20) };
        if (v.target_value !== null && v.target_value !== undefined && v.target_value !== "") entry.target_value = Number(v.target_value);
        if (v.target_low !== null && v.target_low !== undefined && v.target_low !== "") entry.target_low = Number(v.target_low);
        if (v.target_high !== null && v.target_high !== undefined && v.target_high !== "") entry.target_high = Number(v.target_high);
        if (["LOWER_IS_BETTER", "HIGHER_IS_BETTER", "RANGE"].includes(dir)) entry.direction = dir;
        if (v.min_meaningful_change !== null && v.min_meaningful_change !== undefined && v.min_meaningful_change !== "") {
          entry.min_meaningful_change = Number(v.min_meaningful_change);
        }
        if ("target_value" in entry || "target_low" in entry || "target_high" in entry) cleanT[code] = entry;
      }
    }
    base.targets = cleanT;
  }
  if (Array.isArray(raw.imaging_findings)) {
    base.imaging_findings = raw.imaging_findings
      .filter((x) => x && typeof x === "object" && x.code)
      .map((x) => ({ code: String(x.code).trim().toUpperCase(), done_on: String(x.done_on || "").slice(0, 20) }));
  }
  if (raw.reproductive && typeof raw.reproductive === "object") {
    const rep = raw.reproductive;
    base.reproductive = {
      planning_pregnancy: rep.planning_pregnancy !== null && rep.planning_pregnancy !== undefined ? Boolean(rep.planning_pregnancy) : null,
      trying_to_conceive_months: rep.trying_to_conceive_months !== null && rep.trying_to_conceive_months !== undefined && rep.trying_to_conceive_months !== "" ? Number(rep.trying_to_conceive_months) : null,
      menstrual_pattern: String(rep.menstrual_pattern || "").trim().toUpperCase(),
      pregnancies: rep.pregnancies !== null && rep.pregnancies !== undefined && rep.pregnancies !== "" ? Number(rep.pregnancies) : null,
    };
  }
  if (raw.caregiver && typeof raw.caregiver === "object") {
    const cg = raw.caregiver;
    const phone = String(cg.phone || "").trim().slice(0, 30);
    const consent = Boolean(cg.phone_consent);
    if (phone && !consent) throw new Error("Caregiver phone consent is required before saving phone number");
    base.caregiver = {
      name: String(cg.name || "").trim().slice(0, 120),
      relationship: String(cg.relationship || "").trim().slice(0, 60),
      phone: consent ? phone : "",
      phone_consent: consent,
    };
  }
  base.medicine_count = raw.medicine_count !== null && raw.medicine_count !== undefined && raw.medicine_count !== "" ? Number(raw.medicine_count) : null;
  base.monitoring_requested = Boolean(raw.monitoring_requested);
  return base;
}

function getField(obj, path) {
  let cur = obj;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function matchingLabs(labs, code) {
  const codes = SYNONYMS[code] || new Set([code]);
  const out = [];
  for (const c of codes) {
    if (labs[c]) out.push(...labs[c]);
  }
  return out;
}

function cmp(val, op, target) {
  if (op === ">=") return val >= target;
  if (op === "<=") return val <= target;
  if (op === ">") return val > target;
  if (op === "<") return val < target;
  if (op === "==") return val === target;
  if (op === "!=") return val !== target;
  return false;
}

export function bpIsHigh(profile) {
  const readings = getField(profile, "vitals.bp_readings") || [];
  if (!readings.length) return [false, false];
  const last = readings.slice(-2);
  const avgS = last.reduce((s, r) => s + Number(r.systolic || 0), 0) / last.length;
  const avgD = last.reduce((s, r) => s + Number(r.diastolic || 0), 0) / last.length;
  const home = last.every((r) => r.where === "HOME");
  const [sLim, dLim] = home ? [135, 85] : [140, 90];
  return [avgS >= sLim || avgD >= dLim, true];
}

export function boneRiskFromProfile(age, gender, profile, labs) {
  const hasCond = (profile.conditions || []).some((c) => ["OSTEOPOROSIS", "OSTEOPENIA"].includes(c.code) && c.status === "CONFIRMED");
  const hasImg = (profile.imaging_findings || []).some((i) => ["OSTEOPOROSIS", "OSTEOPENIA"].includes(i.code));
  const vitdLow = matchingLabs(labs, "VITD").some((p) => p.system_flag === "LOW");
  const riskPerson = (age !== null && age !== undefined && age >= 50)
    || (gender === "F" && age !== null && age !== undefined && age >= 45)
    || (profile.family_history || []).includes("OSTEOPOROSIS");
  return hasCond || hasImg || (vitdLow && riskPerson);
}

function evalNode(node, ctx) {
  if (!node || typeof node !== "object") return [false, [], []];
  if (Array.isArray(node.any)) {
    const hits = [];
    const missing = [];
    for (const sub of node.any) {
      const [ok, mRules, mMiss] = evalNode(sub, ctx);
      missing.push(...mMiss);
      if (ok) hits.push(...mRules);
    }
    return [hits.length > 0, hits, missing];
  }
  if (Array.isArray(node.all)) {
    const hits = [];
    const missing = [];
    for (const sub of node.all) {
      const [ok, mRules, mMiss] = evalNode(sub, ctx);
      missing.push(...mMiss);
      if (!ok) return [false, [], missing];
      hits.push(...mRules);
    }
    return [true, hits, missing];
  }

  const { labs, profile } = ctx;
  if (node.lab || node.lab_any) {
    const codes = node.lab ? [node.lab] : node.lab_any;
    const hits = [];
    for (const code of codes) {
      for (const p of matchingLabs(labs, code)) {
        if (node.flag === "ABNORMAL" && (p.system_flag === "LOW" || p.system_flag === "HIGH")) hits.push(`lab:${code}:${p.system_flag}`);
        else if ((node.flag === "LOW" || node.flag === "HIGH") && p.system_flag === node.flag) hits.push(`lab:${code}:${node.flag}`);
        else if (node.op && p.value_num !== null && p.value_num !== undefined && cmp(Number(p.value_num), node.op, Number(node.value))) hits.push(`lab:${code}:${node.op}`);
      }
    }
    return [hits.length > 0, hits, []];
  }
  if (node.lab_ratio) {
    const [numC, denC] = node.lab_ratio;
    const nums = matchingLabs(labs, numC).map((p) => p.value_num).filter((v) => v !== null && v !== undefined);
    const dens = matchingLabs(labs, denC).map((p) => p.value_num).filter((v) => v !== null && v !== undefined && Number(v) > 0);
    if (nums.length && dens.length && cmp(Number(nums[0]) / Number(dens[0]), node.op || ">=", Number(node.value))) {
      return [true, [`lab_ratio:${numC}_${denC}`], []];
    }
    return [false, [], []];
  }
  if (node.bucket) {
    return ctx.buckets.has(node.bucket) ? [true, [`bucket:${node.bucket}`], []] : [false, [], []];
  }
  if (node.condition) {
    const st = node.status || "CONFIRMED";
    const ok = (profile.conditions || []).some((c) => c.code === node.condition && c.status === st);
    return ok ? [true, [`condition:${node.condition}`], []] : [false, [], []];
  }
  if (node.imaging) {
    const ok = (profile.imaging_findings || []).some((i) => i.code === node.imaging);
    return ok ? [true, [`imaging:${node.imaging}`], []] : [false, [], []];
  }
  if (node.bp_high) {
    const [high, hasBp] = bpIsHigh(profile);
    if (!hasBp) return [false, [], ["Blood pressure not recorded"]];
    return [high, high ? ["profile:bp_high"] : [], []];
  }
  if (node.metabolic_abnormal) {
    const hits = [];
    for (const c of ["HBA1C", "GLU_F", "GLU_PP", "GLU_R", "CHOL", "LDL", "TG", "NON_HDL"]) {
      if (matchingLabs(labs, c).some((p) => p.system_flag === "HIGH")) hits.push(`lab:${c}:HIGH`);
    }
    if (matchingLabs(labs, "HDL").some((p) => p.system_flag === "LOW")) hits.push("lab:HDL:LOW");
    if (bpIsHigh(profile)[0]) hits.push("profile:bp_high");
    for (const b of ["DIABETES", "LIPID", "HYPERTENSION"]) {
      if (ctx.buckets.has(b)) hits.push(`bucket:${b}`);
    }
    return [hits.length > 0, hits, []];
  }
  if (node.age) {
    if (ctx.age === null || ctx.age === undefined) return [false, [], ["Age not recorded"]];
    if (node.age === "between") {
      const ok = Number(ctx.age) >= Number(node.min) && Number(ctx.age) <= Number(node.max);
      return [ok, ok ? [`age:${node.min}-${node.max}`] : [], []];
    }
    const ok = cmp(Number(ctx.age), node.age, Number(node.value));
    return [ok, ok ? [`age${node.age}${node.value}`] : [], []];
  }
  if (node.gender) {
    if (!ctx.gender) return [false, [], ["Gender not recorded"]];
    const ok = ctx.gender === node.gender;
    return [ok, ok ? [`gender:${ctx.gender}`] : [], []];
  }
  if (node.no_recent_screening_months) {
    if (!ctx.hasProfile) return [false, [], ["Screening history not recorded"]];
    const cutoff = 30 * Number(node.no_recent_screening_months);
    const recent = (profile.screening_history || []).some((s) => s.done_on && diffDays(ctx.todayIso, s.done_on) <= cutoff);
    return [!recent, !recent ? ["profile:screening_overdue"] : [], []];
  }
  if (node.chronic_count) {
    const chronic = new Set([...ctx.buckets].filter((b) => b !== "OTHER"));
    for (const c of profile.conditions || []) {
      if (c.status === "CONFIRMED") chronic.add(c.code);
    }
    const ok = cmp(chronic.size, node.chronic_count, Number(node.value));
    return [ok, ok ? [`chronic_count>=${node.value}`] : [], []];
  }
  if (node.has_active_meds) {
    const ok = (ctx.activeMeds || []).length > 0;
    return [ok, ok ? ["meds:active"] : [], []];
  }
  if (node.has_chronic_meds) {
    const ok = (ctx.chronicMeds || []).length > 0;
    return [ok, ok ? ["meds:chronic"] : [], []];
  }
  if (node.drug_nutrient_match) {
    const hits = ctx.drugNutrientHits || [];
    return [hits.length > 0, hits.map((h) => `drug_nutrient:${h.nutrient_marker}`), []];
  }
  if (node.treatment_response) {
    const hits = ctx.treatmentResponseHits || [];
    return [hits.length > 0, hits, []];
  }
  if (node.any_lab_abnormal) {
    const hits = Object.values(labs).flat().filter((p) => p.system_flag === "LOW" || p.system_flag === "HIGH").map((p) => `lab:${p.param_code}:${p.system_flag}`);
    return [hits.length > 0, hits, []];
  }
  if (node.any_lab_severe) {
    const hits = Object.values(labs).flat().filter((p) => p.severity === "severe").map((p) => `lab:${p.param_code}:SEVERE`);
    return [hits.length > 0, hits, []];
  }
  if (node.borderline_pct !== undefined) {
    const pct = Number(node.borderline_pct) / 100.0;
    const hits = [];
    for (const p of Object.values(labs).flat()) {
      if (p.value_num === null || p.value_num === undefined || p.system_flag !== "NORMAL") continue;
      let lo = p.ref_low;
      let hi = p.ref_high;
      if ((lo === null || lo === undefined) && (hi === null || hi === undefined) && ctx.referenceRanges?.[p.param_code]) {
        const spec = ctx.referenceRanges[p.param_code];
        if (spec.low_below) lo = spec.low_below[ctx.gender];
        else {
          const norm = (spec.bands || []).find((b) => ["normal", "desirable", "optimal", "sufficient"].includes(b[0]));
          if (norm) [lo, hi] = [norm[1], norm[2]];
        }
      }
      if ((lo && Math.abs(p.value_num - lo) / Math.abs(lo) <= pct) || (hi && Math.abs(hi - p.value_num) / Math.abs(hi) <= pct)) {
        hits.push(`borderline:${p.param_code}`);
      }
    }
    return [hits.length > 0, hits, []];
  }
  if (node.delta_pct !== undefined) {
    const pct = Number(node.delta_pct);
    const hits = [];
    for (const [code, prevVal] of Object.entries(ctx.prevLabs || {})) {
      if (!prevVal) continue;
      for (const p of labs[code] || []) {
        if (p.value_num !== null && p.value_num !== undefined && (Math.abs(p.value_num - prevVal) / Math.abs(prevVal)) * 100 > pct) {
          hits.push(`delta:${code}`);
        }
      }
    }
    return [hits.length > 0, hits, []];
  }
  if (node.has_open_referral) {
    const ok = (ctx.openReferrals || []).length > 0;
    return [ok, ok ? ["referral:open"] : [], []];
  }
  if (node.is_escalation) {
    return [Boolean(ctx.isEscalation), ctx.isEscalation ? ["followup:escalation"] : [], []];
  }
  if (node.has_home_readings) {
    return [Boolean(ctx.hasHomeReadings), ctx.hasHomeReadings ? ["home:readings"] : [], []];
  }
  if (node.family_member_chronic) {
    return [Boolean(ctx.familyChronic), ctx.familyChronic ? ["family:chronic_member"] : [], []];
  }
  if (node.report_classification) {
    const cls = String(ctx.report?.classification || "").toUpperCase();
    const ok = cls === String(node.report_classification).toUpperCase();
    return [ok, ok ? [`report:${cls}`] : [], []];
  }
  if (node.profile) {
    const path = node.profile;
    const val = getField(profile, path);
    if (path === "symptoms" && Array.isArray(val)) {
      const codes = new Set(val.map((s) => s.code).filter(Boolean));
      if (node.contains) return [codes.has(node.contains), codes.has(node.contains) ? [`symptom:${node.contains}`] : [], []];
      if (node.contains_any) {
        const hits = node.contains_any.filter((c) => codes.has(c)).map((c) => `symptom:${c}`);
        return [hits.length > 0, hits, []];
      }
    }
    if (Array.isArray(val)) {
      if (node.contains) return [val.includes(node.contains), val.includes(node.contains) ? [`profile:${path}:${node.contains}`] : [], []];
      if (node.contains_any) {
        const hits = node.contains_any.filter((c) => val.includes(c)).map((c) => `profile:${path}:${c}`);
        return [hits.length > 0, hits, []];
      }
      if (node.any_present) return [val.length > 0, val.length > 0 ? [`profile:${path}:present`] : [], []];
      return [false, [], []];
    }
    if (val === null || val === undefined || val === "") {
      const miss = MISSING_LABELS[path];
      return [false, [], miss ? [miss] : []];
    }
    if (node.in) return [node.in.includes(val), node.in.includes(val) ? [`profile:${path}:${val}`] : [], []];
    if (node.op) {
      const ok = typeof node.value === "boolean"
        ? (node.op === "==" ? Boolean(val) === node.value : Boolean(val) !== node.value)
        : typeof node.value === "number"
        ? cmp(Number(val), node.op, Number(node.value))
        : (node.op === "==" ? val === node.value : val !== node.value);
      return [ok, ok ? [`profile:${path}`] : [], []];
    }
  }
  return [false, [], []];
}

export function buildProgramContext({
  patient, report, params = [], buckets = [], profile, hasProfile = false, todayIso = todayIstStr(),
  activeMeds = [], medCatalogue = DEFAULT_MEDICINE_CATALOGUE, drugNutrientRules = DEFAULT_DRUG_NUTRIENT_RULES,
  prevLabs = {}, serialCodes = [], referenceRanges = {}, openReferrals = [], isEscalation = false, hasHomeReadings = false, familyChronic = false,
}) {
  const labs = {};
  for (const p of params || []) {
    if (p.param_code) {
      if (!labs[p.param_code]) labs[p.param_code] = [];
      labs[p.param_code].push(p);
    }
  }
  const bSet = new Set(buckets || []);
  const clean = cleanProfile(profile);
  if (bpIsHigh(clean)[0] || (clean.conditions || []).some((c) => c.code === "HYPERTENSION" && c.status === "CONFIRMED")) {
    bSet.add("HYPERTENSION");
  }
  const age = report?.age ?? patient?.age ?? null;
  const gender = String(report?.gender || patient?.gender || "").slice(0, 1).toUpperCase();
  if (boneRiskFromProfile(age, gender, clean, labs)) bSet.add("BONE");

  const catMap = Object.fromEntries((medCatalogue || []).map((m) => [m.code, m]));
  const chronicMeds = (activeMeds || []).filter((m) => catMap[m.medicine_code]?.is_chronic);
  const activeClasses = new Set((activeMeds || []).map((m) => catMap[m.medicine_code]?.drug_class).filter(Boolean));
  const drugNutrientHits = [];
  for (const r of drugNutrientRules || []) {
    if (activeClasses.has(r.drug_class) && matchingLabs(labs, r.nutrient_marker).some((p) => p.system_flag === r.direction)) {
      drugNutrientHits.push(r);
    }
  }
  const serialSet = new Set(serialCodes || Object.keys(prevLabs || {}));
  const linkedMarkers = new Set((activeMeds || []).flatMap((m) => (catMap[m.medicine_code]?.linked_markers || []).flatMap((lm) => [...(SYNONYMS[lm] || [lm])])));
  const treatmentResponseHits = report
    ? Object.keys(labs).filter((c) => serialSet.has(c) && linkedMarkers.has(c)).sort().map((c) => `treatment_response:${c}`)
    : [];

  return {
    patient, report, profile: clean, hasProfile, labs, buckets: bSet, age, gender, todayIso,
    activeMeds, chronicMeds, drugNutrientHits, prevLabs, treatmentResponseHits, referenceRanges,
    openReferrals, isEscalation, hasHomeReadings, familyChronic, catMap,
  };
}

export function evaluatePrograms(opts) {
  const programs = opts.programs || DEFAULT_CARE_PROGRAMS;
  const ctx = buildProgramContext(opts);
  const out = [];
  for (const prog of programs) {
    const [ok, matched, missing] = evalNode(prog.trigger, ctx);
    if (!ok) continue;
    const notes = [];
    if (prog.clearance_if_limitations && (ctx.profile.physical_limitations || []).some((x) => x !== "NONE")) {
      notes.push("doctor clearance needed");
    }
    if (prog.code === "DRUG_NUTRIENT_REVIEW") {
      for (const h of ctx.drugNutrientHits) if (h.note) notes.push(h.note);
    }
    out.push({
      program_code: prog.code,
      matched_rules: [...new Set(matched)].sort(),
      missing_data: [...new Set(missing)].sort(),
      notes,
    });
  }
  return out;
}

export const SERVICE_LOOP_STAGE = {
  RETEST: "DIAGNOSTICS",
  LIFESTYLE_MONITORING: "ONGOING_MONITORING",
  DIETITIAN_CONSULT: "EATING_WELL",
  INTEGRATED_CHRONIC_CARE: "CHRONIC_CONDITIONS",
  SCREENING_SCHEDULE: "PREVENTION",
};

export const DEFAULT_DIAGNOSTIC_FINDINGS = [
  { code: "LOW_VITD", label: "Low Vitamin D", icon: "☀️", severity_markers: ["VITD"], note: "starter value, clinician to confirm", trigger: { lab: "VITD", flag: "LOW" } },
  { code: "HIGH_HBA1C", label: "Elevated HbA1c", icon: "🩸", severity_markers: ["HBA1C"], note: "starter value, clinician to confirm", trigger: { lab: "HBA1C", flag: "HIGH" } },
  { code: "HIGH_CHOLESTEROL", label: "Elevated cholesterol", icon: "❤️", severity_markers: ["CHOL", "LDL", "NON_HDL"], note: "starter value, clinician to confirm", trigger: { lab_any: ["CHOL", "LDL", "NON_HDL"], flag: "HIGH" } },
  { code: "HIGH_TSH", label: "Elevated TSH", icon: "🦋", severity_markers: ["TSH"], note: "starter value, clinician to confirm", trigger: { lab: "TSH", flag: "HIGH" } },
  { code: "LOW_HB", label: "Low hemoglobin", icon: "🧬", severity_markers: ["HB"], note: "starter value, clinician to confirm", trigger: { lab: "HB", flag: "LOW" } },
  { code: "HIGH_CREATININE", label: "Elevated creatinine", icon: "🫘", severity_markers: ["CREAT", "EGFR"], note: "starter value, clinician to confirm", trigger: { any: [{ lab: "CREAT", flag: "HIGH" }, { lab: "EGFR", flag: "LOW" }] } },
  { code: "ABNORMAL_LFT", label: "Abnormal liver enzymes", icon: "🫀", severity_markers: ["ALT", "AST", "ALP", "GGT", "BILI_T"], note: "starter value, clinician to confirm", trigger: { lab_any: ["ALT", "AST", "ALP", "GGT", "BILI_T"], flag: "HIGH" } },
  {
    code: "OBESITY_METABOLIC", label: "Obesity with metabolic abnormalities", icon: "⚖️",
    severity_markers: ["HBA1C", "CHOL", "LDL", "NON_HDL", "TG", "HDL"], note: "starter value, clinician to confirm",
    trigger: { all: [{ profile: "vitals.bmi", op: ">=", value: 25 }, { any: [{ lab_any: ["HBA1C", "CHOL", "LDL", "NON_HDL", "TG"], flag: "HIGH" }, { lab: "HDL", flag: "LOW" }] }] },
  },
  { code: "MULTI_CHRONIC", label: "Multiple chronic conditions", icon: "🩺", severity_markers: [], note: "starter value, clinician to confirm", trigger: { chronic_count: ">=", value: 2 } },
  {
    code: "NORMAL_WITH_RISK", label: "Normal report with risk factors", icon: "🛡️", severity_markers: [], note: "starter value, clinician to confirm",
    trigger: { all: [{ report_classification: "NORMAL" }, { any: [{ age: ">=", value: 40 }, { profile: "family_history", any_present: true }, { profile: "vitals.bmi", op: ">=", value: 23 }, { profile: "lifestyle.smoking", op: "==", value: true }, { profile: "lifestyle.activity_level", op: "==", value: "SEDENTARY" }] }] },
  },
];

export const DEFAULT_RECOMMENDATION_COMBINATIONS = {
  LOW_VITD: {
    primary: { label: "Vitamin plan", caller_label: "Wellness supplement plan", target: "VITAMIN_PLAN", condition: "ALWAYS" },
    secondary: { label: "Bone health assessment", caller_label: "Doctor follow-up plan", target: "BONE_HEALTH", condition: "ALWAYS" },
    third: { label: "Appropriate retesting", caller_label: "Repeat test reminder", target: "RETEST", condition: "ALWAYS" },
  },
  HIGH_HBA1C: {
    primary: { label: "Diabetes plan", caller_label: "Doctor follow-up plan", target: "DIABETES_MGMT", condition: "ALWAYS" },
    secondary: { label: "Personalized diet", caller_label: "Nutrition follow-up", target: "DIET_PLAN", condition: "ALWAYS" },
    third: { label: "Medication review/refill if prescribed", caller_label: "Care plan follow-up", target: "MED_REVIEW", condition: "IF_PRESCRIBED", drug_classes: ["BIGUANIDE", "SULFONYLUREA", "INSULIN"] },
  },
  HIGH_CHOLESTEROL: {
    primary: { label: "Cardiac risk assessment", caller_label: "Doctor follow-up plan", target: "CARDIAC_RISK_MGMT", condition: "ALWAYS" },
    secondary: { label: "Diet plan", caller_label: "Nutrition follow-up", target: "DIET_PLAN", condition: "ALWAYS" },
    third: { label: "Lifestyle monitoring", caller_label: "Wellness follow-up", target: "LIFESTYLE_MONITORING", condition: "ALWAYS" },
  },
  HIGH_TSH: {
    primary: { label: "Thyroid consultation", caller_label: "Doctor follow-up plan", target: "THYROID_MGMT", condition: "ALWAYS" },
    secondary: { label: "Medication management if prescribed", caller_label: "Care plan follow-up", target: "MED_REVIEW", condition: "IF_PRESCRIBED", drug_classes: ["THYROID_HORMONE"] },
    third: { label: "Thyroid follow-up", caller_label: "Follow-up diagnostic call", target: "FOLLOWUP_DIAGNOSTIC", condition: "ALWAYS" },
  },
  LOW_HB: {
    primary: { label: "Anemia evaluation", caller_label: "Doctor follow-up plan", target: "ANEMIA_MGMT", condition: "ALWAYS" },
    secondary: { label: "Nutrition assessment", caller_label: "Nutrition follow-up", target: "DIET_PLAN", condition: "ALWAYS" },
    third: { label: "Follow-up diagnostics", caller_label: "Repeat test reminder", target: "FOLLOWUP_DIAGNOSTIC", condition: "ALWAYS" },
  },
  HIGH_CREATININE: {
    primary: { label: "Kidney health consultation", caller_label: "Doctor follow-up plan", target: "KIDNEY_HEALTH", condition: "ALWAYS" },
    secondary: { label: "Medication safety review", caller_label: "Care review follow-up", target: "MED_REVIEW", condition: "ALWAYS" },
    third: { label: "Renal monitoring", caller_label: "Ongoing check-in plan", target: "RETEST", condition: "ALWAYS" },
  },
  ABNORMAL_LFT: {
    primary: { label: "Liver health evaluation", caller_label: "Doctor follow-up plan", target: "LIVER_HEALTH", condition: "ALWAYS" },
    secondary: { label: "Diet/lifestyle assessment", caller_label: "Nutrition follow-up", target: "DIET_PLAN", condition: "ALWAYS" },
    third: { label: "Clinician-directed investigation", caller_label: "Diagnostic follow-up call", target: "FOLLOWUP_DIAGNOSTIC", condition: "ALWAYS" },
  },
  OBESITY_METABOLIC: {
    primary: { label: "Weight management", caller_label: "Wellness plan follow-up", target: "WEIGHT_PLAN", condition: "ALWAYS" },
    secondary: { label: "Dietitian consultation", caller_label: "Nutrition follow-up", target: "DIETITIAN_CONSULT", condition: "ALWAYS" },
    third: { label: "Medical weight-loss eligibility assessment", caller_label: "Doctor consultation follow-up", target: "GLP1_WEIGHT_ASSESSMENT", condition: "IF_APPROPRIATE" },
  },
  MULTI_CHRONIC: {
    primary: { label: "Integrated chronic care", caller_label: "Doctor follow-up plan", target: "INTEGRATED_CHRONIC_CARE", condition: "ALWAYS" },
    secondary: { label: "Pharmacy refill management", caller_label: "Pharmacy refill reminder call", target: "PHARMACY_REFILL", condition: "ALWAYS" },
    third: { label: "Home monitoring", caller_label: "Home check-in plan", target: "HOME_MONITORING", condition: "ALWAYS" },
  },
  NORMAL_WITH_RISK: {
    primary: { label: "Preventive health plan", caller_label: "Preventive health check-in", target: "PREVENTIVE_PLAN", condition: "ALWAYS" },
    secondary: { label: "Lifestyle guidance", caller_label: "Wellness plan follow-up", target: "FITNESS_PLAN", condition: "ALWAYS" },
    third: { label: "Future screening schedule", caller_label: "Preventive health check-in", target: "SCREENING_SCHEDULE", condition: "ALWAYS" },
  },
};

const SEV_WEIGHT = { severe: 3, moderate: 2, mild: 1 };

export function detectFindingsInCtx(ctx, findingRules = DEFAULT_DIAGNOSTIC_FINDINGS) {
  const hits = [];
  for (let idx = 0; idx < findingRules.length; idx += 1) {
    const f = findingRules[idx];
    const [ok] = evalNode(f.trigger || {}, ctx);
    if (!ok) continue;
    let sev = 0;
    let dev = 0;
    if (f.code === "MULTI_CHRONIC") {
      const ch = new Set([...[...ctx.buckets].filter((b) => b !== "OTHER"), ...(ctx.profile?.conditions || []).filter((c) => c.status === "CONFIRMED").map((c) => c.code)]);
      sev = 1;
      dev = ch.size;
    } else {
      for (const m of f.severity_markers || []) {
        for (const p of matchingLabs(ctx.labs, m)) {
          if (p.system_flag === "LOW" || p.system_flag === "HIGH") {
            sev = Math.max(sev, SEV_WEIGHT[p.severity] || 0);
            dev = Math.max(dev, Number(p.deviation_pct || 0));
          }
        }
      }
    }
    hits.push({ code: f.code, sev, dev, idx });
  }
  hits.sort((a, b) => (b.sev - a.sev) || (b.dev - a.dev) || (a.idx - b.idx));
  return hits.map((h) => h.code);
}

export function ifPrescribedOk(spec, ctx) {
  if (spec?.condition !== "IF_PRESCRIBED") return true;
  const active = ctx.activeMeds || [];
  const req = spec.drug_classes || [];
  if (!req.length) return active.length > 0;
  return active.some((m) => req.includes(ctx.catMap?.[m.medicine_code]?.drug_class));
}

export function syncCombinationsInStore(store, ctx, reportId, followup, opts = {}) {
  const findingRules = opts.findingRules || DEFAULT_DIAGNOSTIC_FINDINGS;
  const comboRules = opts.comboRules || DEFAULT_RECOMMENDATION_COMBINATIONS;
  const comboVer = opts.comboVer || 1;
  const codes = detectFindingsInCtx(ctx, findingRules);
  if (followup) followup.finding_codes = codes;

  const merged = {};
  for (const fc of codes) {
    const cDef = comboRules[fc] || {};
    for (const [rank, slot] of [[1, "primary"], [2, "secondary"], [3, "third"]]) {
      const spec = cDef[slot];
      if (!spec || !ifPrescribedOk(spec, ctx)) continue;
      const cur = merged[spec.target];
      if (!cur || rank < cur.rank) merged[spec.target] = { rank, finding_code: fc };
    }
  }
  if (!store.program_recommendations) store.program_recommendations = [];
  const existing = Object.fromEntries(
    store.program_recommendations
      .filter((r) => r.patient_id === ctx.patient.id && (r.report_id ?? null) === reportId)
      .map((r) => [r.program_code, r])
  );
  let nextNum = store.program_recommendations.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
  for (const [target, info] of Object.entries(merged)) {
    const cur = existing[target];
    if (cur) {
      if (cur.rank === null || cur.rank === undefined || info.rank < cur.rank || !cur.finding_code) {
        cur.rank = cur.rank == null ? info.rank : Math.min(cur.rank, info.rank);
        cur.finding_code = info.finding_code;
      }
      if (followup && !cur.followup_id) cur.followup_id = followup.id;
    } else {
      store.program_recommendations.push({
        id: nextNum++,
        patient_id: ctx.patient.id,
        followup_id: followup ? followup.id : null,
        report_id: reportId,
        program_code: target,
        rule_version: comboVer,
        status: "SUGGESTED",
        rank: info.rank,
        finding_code: info.finding_code,
        reason_codes: [`finding:${info.finding_code}`],
        missing_data: [],
        notes: [],
        decided_by: null,
        decided_at: null,
        decline_reason_code: "",
        created_at: new Date().toISOString(),
      });
    }
  }
  return codes;
}

export function addDaysIso(isoDate, days) {
  const dt = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function refillTickInStore(store, nowMs = Date.now()) {
  const todayIso = todayIstStr(nowMs);
  const dueCutoff = addDaysIso(todayIso, 3);
  const callers = (store.users || []).filter((u) => u.role === "CALLER" && u.active !== false);
  let created = 0;
  for (const s of store.refill_schedules || []) {
    if (s.status !== "ACTIVE" || !s.next_refill_on || s.next_refill_on > dueCutoff) continue;
    if (s.reminder_sent_for === s.next_refill_on) continue;
    s.reminder_sent_for = s.next_refill_on;
    s.task_status = "DUE";
    s.task_due_on = addDaysIso(s.next_refill_on, -3);
    if (!store.notifications) store.notifications = { unread: 0, items: [] };
    if (callers.length) {
      store.notifications.unread = (store.notifications.unread || 0) + 1;
      store.notifications.items.unshift({
        id: (store.notifications.items.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0)) + 1,
        text: "Pharmacy refill reminder call",
        link: "/followups",
        urgent: false,
        read: false,
        at: new Date().toISOString(),
      });
    }
    created += 1;
  }
  return created;
}

export function checkHomeReadingAlert(kind, values) {
  if (kind === "BP") {
    const s = Number(values?.systolic || 0);
    const d = Number(values?.diastolic || 0);
    if (s >= 140 || d >= 90 || (s > 0 && s < 90)) return "BP threshold crossed";
  } else if (kind === "GLUCOSE_FASTING") {
    const v = Number(values?.value || 0);
    if (v >= 126 || (v > 0 && v < 70)) return "Fasting glucose threshold crossed";
  } else if (kind === "GLUCOSE_RANDOM") {
    const v = Number(values?.value || 0);
    if (v >= 200 || (v > 0 && v < 70)) return "Random glucose threshold crossed";
  } else if (kind === "SPO2") {
    const v = Number(values?.value || 100);
    if (v > 0 && v < 94) return "Low SpO2 threshold crossed";
  }
  return "";
}

export function syncTouchpointsInStore(store, patientId, todayIso = todayIstStr()) {
  if (!store.care_touchpoints) store.care_touchpoints = [];
  const existing = new Set(
    store.care_touchpoints
      .filter((t) => t.patient_id === patientId && t.source === "AUTO")
      .map((t) => `${t.ref_entity}:${t.ref_id}:${t.stage}`)
  );
  let nextIdNum = store.care_touchpoints.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0) + 1;
  const add = (stage, refEntity, refId, occurredOn, serviceCode) => {
    const key = `${refEntity}:${refId}:${stage}`;
    if (existing.has(key)) return;
    existing.add(key);
    store.care_touchpoints.push({
      id: nextIdNum++, patient_id: patientId, stage, service_code: serviceCode,
      occurred_on: (occurredOn || todayIso).slice(0, 10), source: "AUTO",
      ref_entity: refEntity, ref_id: refId, amount_inr: null, created_at: new Date().toISOString(),
    });
  };
  for (const r of (store.reports || []).filter((r) => r.patient_id === patientId)) {
    add("DIAGNOSTICS", "report", r.id, r.collected_on || todayIso, "LAB_REPORT");
  }
  for (const f of (store.followups || []).filter((f) => f.patient_id === patientId)) {
    if (["DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED"].includes(f.stage)) {
      add("CONSULTATIONS", "followup", f.id, (f.created_at || todayIso).slice(0, 10), "DOCTOR_CONSULT");
    }
    for (const b of f.buckets || []) {
      add("CHRONIC_CONDITIONS", "patient_bucket", `${f.report_id}-${b}`, (f.created_at || todayIso).slice(0, 10), b);
    }
    if (f.next_followup_on) {
      add("ONGOING_MONITORING", "followup_next", f.id, f.next_followup_on, "NEXT_FOLLOWUP");
    }
  }
}

export function relationshipStatus(touchpoints, hasOverdue, todayIso = todayIstStr(), thresholds = DEFAULT_RELATIONSHIP_THRESHOLDS) {
  const newDays = Number(thresholds?.new_days ?? 30);
  const activeDays = Number(thresholds?.active_days ?? 90);
  const atRiskDays = Number(thresholds?.at_risk_days ?? 180);
  if (!touchpoints.length) return hasOverdue ? "AT_RISK" : "LAPSED";
  const dates = touchpoints.map((t) => t.occurred_on.slice(0, 10)).sort();
  const sinceLast = diffDays(todayIso, dates[dates.length - 1]);
  const sinceFirst = diffDays(todayIso, dates[0]);
  if (sinceLast > atRiskDays) return "LAPSED";
  if (sinceLast > activeDays || hasOverdue) return "AT_RISK";
  if (sinceFirst <= newDays) return "NEW";
  return "ACTIVE";
}

export function nextBestStep(touchpoints, reports, hasActiveBuckets, statusStr, rules = DEFAULT_RELATIONSHIP_NEXT_STEPS, todayIso = todayIstStr()) {
  const byCode = Object.fromEntries((rules || []).map((r) => [r.code, r]));
  const hasChronic = hasActiveBuckets || touchpoints.some((t) => t.stage === "CHRONIC_CONDITIONS");
  const hasMonitoring = touchpoints.some((t) => t.stage === "ONGOING_MONITORING" && Math.abs(diffDays(todayIso, t.occurred_on)) <= 120);
  const hasEating = touchpoints.some((t) => t.stage === "EATING_WELL");
  const consultDates = touchpoints.filter((t) => t.stage === "CONSULTATIONS").map((t) => t.occurred_on.slice(0, 10)).sort();
  const latestConsult = consultDates[consultDates.length - 1] || null;
  const abnDates = reports.filter((r) => r.classification === "ABNORMAL").map((r) => (r.collected_on || todayIso).slice(0, 10)).sort();
  const abnUnconsulted = abnDates.length > 0 && (!latestConsult || abnDates[abnDates.length - 1] > latestConsult);
  const stages = new Set(touchpoints.map((t) => t.stage));
  const onlyNormalDiag = stages.size === 1 && stages.has("DIAGNOSTICS") && reports.length > 0 && reports.every((r) => r.classification === "NORMAL");

  const checks = [
    ["SCHEDULE_RETEST", hasChronic && !hasMonitoring],
    ["DOCTOR_CONSULTATION", abnUnconsulted],
    ["DIET_PLAN", hasChronic && !hasEating],
    ["REENGAGEMENT_CALL", statusStr === "LAPSED" || statusStr === "AT_RISK"],
    ["PREVENTIVE_SCREENING", onlyNormalDiag],
  ];
  for (const [code, hit] of checks) {
    if (hit && byCode[code]) {
      const r = byCode[code];
      return { code: r.code, clinical_label: r.clinical_label, caller_label: r.caller_label };
    }
  }
  return null;
}
