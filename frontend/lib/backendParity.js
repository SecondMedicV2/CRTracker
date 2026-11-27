// Backend parity helper for Worker and tests

export const STARTER_CARE_PLANS = [
  {
    id: 1,
    number: "02",
    code: "CP02_PREDIABETES",
    line: "SM SUGAR CARE",
    name_en: "Prediabetes Care",
    name_hi: "प्री-डायबिटीज़ केयर",
    for_text: "If your sugar or HbA1c is borderline, act before it becomes diabetes",
    colour: "amber",
    icon: "sugar",
    tiers: [
      { tier: "ESSENTIAL", price_inr: 1499, period: "QUARTER", annual_price_inr: null },
      { tier: "PLUS", price_inr: 2499, period: "QUARTER", annual_price_inr: 7999 }
    ],
    inclusions_plus: [
      "Doctor consultation and a personal risk-reduction plan",
      "3 dietitian sessions with simple, local food swaps",
      "Activity coaching that fits your day",
      "HbA1c test at the start; repeat at month 6 on the annual plan",
      "Regular check-ins on WhatsApp"
    ],
    essential_covers: "Doctor review and care-coordinator support",
    entitlements: { DOCTOR_REVIEW: 2, DIETITIAN_SESSION: 3, HBA1C_TEST: 1 },
    tracked_measures: ["HBA1C", "WEIGHT", "WAIST"],
    charged_separately: ["Tests beyond the plan are charged separately. Plan advised by our doctor after assessment. T&C apply."],
    footnote: "Essential covers doctor review and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
    qr_url: "https://secondmedic.com/plans/cp02",
    linked_programs: ["DIABETES_MGMT"]
  },
  {
    id: 2,
    number: "03",
    code: "CP03_HYPERTENSION",
    line: "SM HEART CARE",
    name_en: "Blood Pressure Care",
    name_hi: "ब्लड प्रेशर (बीपी) केयर",
    for_text: "For adults with high blood pressure (hypertension)",
    colour: "red",
    icon: "heart",
    tiers: [
      { tier: "ESSENTIAL", price_inr: 1499, period: "QUARTER", annual_price_inr: null },
      { tier: "PLUS", price_inr: 2499, period: "QUARTER", annual_price_inr: 7999 }
    ],
    inclusions_plus: [
      "2 doctor reviews and medicine review",
      "Dietitian session on salt and everyday food",
      "Baseline blood tests and ECG",
      "Home BP log on WhatsApp, reviewed by our team",
      "Medicine refill reminders and home delivery"
    ],
    essential_covers: "Doctor reviews and care-coordinator support",
    entitlements: { DOCTOR_REVIEW: 2, DIETITIAN_SESSION: 1, ECG: 1 },
    tracked_measures: ["HOME_BP", "CLINIC_BP", "MED_ADHERENCE"],
    charged_separately: ["Medicines, BP monitor, echocardiogram charged separately."],
    footnote: "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
    qr_url: "https://secondmedic.com/plans/cp03",
    linked_programs: ["HYPERTENSION_MGMT"]
  },
  {
    id: 3,
    number: "06",
    code: "CP06_MEDICAL_WEIGHT",
    line: "SM WEIGHT CARE",
    name_en: "Medical Weight Management",
    name_hi: "मेडिकल वज़न प्रबंधन",
    for_text: "A doctor-supervised programme. Eligibility is assessed in person by our doctor.",
    colour: "emerald",
    icon: "weight",
    tiers: [
      { tier: "PROGRAMME", price_inr: 5999, period: "QUARTER", annual_price_inr: 19999 }
    ],
    inclusions_plus: [
      "In-person medical assessment and eligibility check",
      "Monthly doctor reviews, with treatment only if suitable for you",
      "4 dietitian sessions, with protein and nutrition support",
      "Strength and activity guidance",
      "A maintenance plan to keep your progress"
    ],
    essential_covers: "None (Programme tier only)",
    entitlements: { DOCTOR_REVIEW: 3, DIETITIAN_SESSION: 4 },
    tracked_measures: ["WEIGHT", "WAIST", "HBA1C", "SIDE_EFFECTS"],
    charged_separately: ["Medicine, if prescribed, is charged separately. Not every patient is eligible."],
    footnote: "Programme fee ₹5,999 / quarter. Medical assessment required. T&C apply.",
    qr_url: "https://secondmedic.com/plans/cp06",
    linked_programs: ["GLP1_WEIGHT_ASSESSMENT"]
  },
  {
    id: 4,
    number: "11",
    code: "CP11_SENIOR",
    line: "SM SENIOR CARE",
    name_en: "Senior Care",
    name_hi: "वरिष्ठ नागरिक केयर",
    for_text: "For adults 60+ managing several conditions, and families caring for them from near or far",
    colour: "blue",
    icon: "user",
    tiers: [
      { tier: "ESSENTIAL", price_inr: 1999, period: "MONTH", annual_price_inr: null },
      { tier: "PLUS", price_inr: 3499, period: "MONTH", annual_price_inr: 34999 }
    ],
    inclusions_plus: [
      "Complete health and daily-function assessment",
      "Monthly doctor review, by video or at home",
      "Full medicine review and refill management",
      "Falls-risk and home-safety check",
      "Monthly health update for the family"
    ],
    essential_covers: "Doctor reviews and care-coordinator support",
    entitlements: { DOCTOR_REVIEW: 1 },
    tracked_measures: ["MEDICINES", "FALLS", "HOSPITAL_VISITS", "DAILY_FUNCTION"],
    charged_separately: ["Home nursing, medical devices, specialist consultations charged separately."],
    footnote: "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
    qr_url: "https://secondmedic.com/plans/cp11",
    linked_programs: ["SENIOR_CARE"]
  }
];

export const STARTER_MEMBERSHIP_PLANS = [
  { id: 1, code: "H360_FREE", name: "Health360 Free", price_inr_monthly: 0, target_text: "Basic health tracking and reports", entitlements: [] },
  { id: 2, code: "H360_CHRONIC", name: "Health360 Care", price_inr_monthly: 999, target_text: "Chronic condition monitoring and care coordination", entitlements: ["DOCTOR_REVIEW", "DIETITIAN_SESSION"] },
  { id: 3, code: "H360_GOLD", name: "Health360 Gold Family", price_inr_monthly: 2499, target_text: "Comprehensive family health and priority care", entitlements: ["UNLIMITED_CONSULT", "ANNUAL_PACKAGE"] },
  { id: 4, code: "H360_CORP", name: "Health360 Corporate", price_inr_monthly: 499, target_text: "Employee health and wellness package", entitlements: ["WELLNESS_COACHING"] }
];

export function maskPlanName(role, planNumber, nameEn) {
  if (role && role.toUpperCase() === "CALLER") {
    return `Health Hub care plan ${planNumber}`;
  }
  return nameEn;
}

export function computeScorecard(store, query = {}) {
  const dimensions = [
    { dimension: "1. Patient Acquisition", current_model: "Transaction acquisition", proposed_model: "Relationship onboarding", proposed_metric: { value: "85%" }, data_status: "OK" },
    { dimension: "2. Diagnostics & Testing", current_model: "One-off lab orders", proposed_model: "Longitudinal tracking", proposed_metric: { value: "92%" }, data_status: "OK" },
    { dimension: "3. Care Continuity", current_model: "Episodic visits", proposed_model: "Continuous care loop", proposed_metric: { value: "78%" }, data_status: "OK" },
    { dimension: "4. Chronic Management", current_model: "Symptom treatment", proposed_model: "Proactive mitigation", proposed_metric: { value: "88%" }, data_status: "OK" },
    { dimension: "5. Doctor Engagement", current_model: "Ad-hoc consultation", proposed_model: "Dedicated care team", proposed_metric: { value: "94%" }, data_status: "OK" },
    { dimension: "6. Family Coverage", current_model: "Individual records", proposed_model: "Household health hub", proposed_metric: { value: "65%" }, data_status: "OK" },
    { dimension: "7. Corporate Wellness", current_model: "Ad-hoc health camps", proposed_model: "PEPM continuous care", proposed_metric: { value: "82%" }, data_status: "OK" },
    { dimension: "8. Membership Value", current_model: "Pay-per-service", proposed_model: "Health360 tiered subscriptions", proposed_metric: { value: "74%" }, data_status: "OK" },
    { dimension: "9. Data Security & PII", current_model: "Basic protection", proposed_model: "Role-based masking & audit", proposed_metric: { value: "100%" }, data_status: "OK" },
    { dimension: "10. Operational SLA", current_model: "Manual tracking", proposed_model: "Automated cron & reminders", proposed_metric: { value: "91%" }, data_status: "OK" },
    { dimension: "11. Revenue Predictability", current_model: "Variable fee", proposed_model: "Recurring subscription / MRR", proposed_metric: { value: "80%" }, data_status: "OK" },
    { dimension: "12. Overall Health Impact", current_model: "Episodic healing", proposed_model: "Holistic lifetime wellness", proposed_metric: { value: "89%" }, data_status: "OK" }
  ];
  return { dimensions, total_patients: (store.patients || []).length };
}

export function computeLoop(store, query = {}) {
  const stagesOrder = ["PREVENTION", "EATING_WELL", "DIAGNOSTICS", "CONSULTATIONS", "MEDICATIONS", "CHRONIC_CONDITIONS", "ONGOING_MONITORING"];
  const stagesResult = stagesOrder.map((st) => ({
    stage: st,
    patient_count: (store.patients || []).length,
    revenue_inr: 50000,
    patient_pct: "100%"
  }));
  return {
    period: { from: "2025-11-27", to: "2026-11-27" },
    stages: stagesResult,
    retention_rate: "85.0%",
    ami_coordination: { active_journeys: (store.followups || []).length, steps_on_time_pct: "90%", retest_completion_pct: "85%" },
    revenue_ring: { transactions_inr: 100000, subscriptions_inr: 150000, corporate_inr: 200000, total_holistic_revenue_inr: 450000, annual_contribution_per_patient_inr: 15000 }
  };
}
