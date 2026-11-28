// Backend parity helper for Worker and tests

// Generated from backend/app/care_plans.py STARTER_CARE_PLANS. Keep in step with the backend seed.
export const STARTER_CARE_PLANS = [
  {
    "id": 1,
    "active": true,
    "number": "02",
    "code": "CP02_PREDIABETES",
    "line": "SM SUGAR CARE",
    "name_en": "Prediabetes Care",
    "name_hi": "प्री-डायबिटीज़ केयर",
    "for_text": "If your sugar or HbA1c is borderline, act before it becomes diabetes",
    "colour": "amber",
    "icon": "sugar",
    "tiers": [
      {
        "tier": "ESSENTIAL",
        "price_inr": 1499,
        "period": "QUARTER",
        "annual_price_inr": null
      },
      {
        "tier": "PLUS",
        "price_inr": 2499,
        "period": "QUARTER",
        "annual_price_inr": 7999
      }
    ],
    "inclusions_plus": [
      "Doctor consultation and a personal risk-reduction plan",
      "3 dietitian sessions with simple, local food swaps",
      "Activity coaching that fits your day",
      "HbA1c test at the start; repeat at month 6 on the annual plan",
      "Regular check-ins on WhatsApp"
    ],
    "essential_covers": "Doctor review and care-coordinator support",
    "entitlements": {
      "DOCTOR_REVIEW": 2,
      "DIETITIAN_SESSION": 3,
      "HBA1C_TEST": 1
    },
    "tracked_measures": [
      "HBA1C",
      "WEIGHT",
      "WAIST"
    ],
    "charged_separately": [
      "Tests beyond the plan are charged separately. Plan advised by our doctor after assessment. T&C apply."
    ],
    "footnote": "Essential covers doctor review and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
    "qr_url": "",
    "linked_programs": [
      "DIABETES_MGMT"
    ]
  },
  {
    "id": 2,
    "active": true,
    "number": "03",
    "code": "CP03_HYPERTENSION",
    "line": "SM HEART CARE",
    "name_en": "Blood Pressure Care",
    "name_hi": "ब्लड प्रेशर (बीपी) केयर",
    "for_text": "For adults with high blood pressure (hypertension)",
    "colour": "red",
    "icon": "heart",
    "tiers": [
      {
        "tier": "ESSENTIAL",
        "price_inr": 1499,
        "period": "QUARTER",
        "annual_price_inr": null
      },
      {
        "tier": "PLUS",
        "price_inr": 2499,
        "period": "QUARTER",
        "annual_price_inr": 7999
      }
    ],
    "inclusions_plus": [
      "2 doctor reviews and medicine review",
      "Dietitian session on salt and everyday food",
      "Baseline blood tests and ECG",
      "Home BP log on WhatsApp, reviewed by our team",
      "Medicine refill reminders and home delivery"
    ],
    "essential_covers": "Doctor reviews and care-coordinator support",
    "entitlements": {
      "DOCTOR_REVIEW": 2,
      "DIETITIAN_SESSION": 1,
      "ECG": 1
    },
    "tracked_measures": [
      "HOME_BP",
      "CLINIC_BP",
      "MED_ADHERENCE"
    ],
    "charged_separately": [
      "Medicines, BP monitor, echocardiogram charged separately."
    ],
    "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
    "qr_url": "",
    "linked_programs": [
      "HYPERTENSION_MGMT"
    ]
  },
  {
    "id": 3,
    "active": true,
    "number": "04",
    "code": "CP04_CHOLESTEROL",
    "line": "SM HEART CARE",
    "name_en": "Cholesterol & Heart Care",
    "name_hi": "कोलेस्ट्रॉल और हृदय केयर",
    "for_text": "For high cholesterol or triglycerides, and anyone who wants to lower their heart risk",
    "colour": "red",
    "icon": "heart",
    "tiers": [
      {
        "tier": "ESSENTIAL",
        "price_inr": 1499,
        "period": "QUARTER",
        "annual_price_inr": null
      },
      {
        "tier": "PLUS",
        "price_inr": 2499,
        "period": "QUARTER",
        "annual_price_inr": 7999
      }
    ],
    "inclusions_plus": [
      "2 doctor reviews and medicine review",
      "Dietitian session for heart-healthy eating",
      "Lipid profile at the start and at follow-up",
      "Heart-risk assessment and ECG",
      "Cardiologist referral when needed"
    ],
    "essential_covers": "Doctor reviews and care-coordinator support",
    "entitlements": {
      "DOCTOR_REVIEW": 2,
      "DIETITIAN_SESSION": 1,
      "LIPID_PROFILE": 2,
      "ECG": 1
    },
    "tracked_measures": [
      "LIPIDS",
      "HEART_RISK",
      "BP"
    ],
    "charged_separately": [
      "Medicines, TMT, echocardiogram, specialist consultations charged separately."
    ],
    "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
    "qr_url": "",
    "linked_programs": [
      "CARDIAC_RISK_MGMT"
    ]
  },
  {
    "id": 4,
    "active": true,
    "number": "05",
    "code": "CP05_LIFESTYLE_WEIGHT",
    "line": "SM WEIGHT CARE",
    "name_en": "Lifestyle Weight Care",
    "name_hi": "वज़न नियंत्रण केयर",
    "for_text": "For healthy, lasting weight loss through food, activity and support",
    "colour": "emerald",
    "icon": "weight",
    "tiers": [
      {
        "tier": "ESSENTIAL",
        "price_inr": 2499,
        "period": "QUARTER",
        "annual_price_inr": null
      },
      {
        "tier": "PLUS",
        "price_inr": 3999,
        "period": "QUARTER",
        "annual_price_inr": 12999
      }
    ],
    "inclusions_plus": [
      "2 doctor reviews",
      "4 dietitian sessions with a meal plan you can follow at home",
      "A personal activity plan",
      "Metabolic blood tests at the start",
      "Monthly weigh-ins and progress check"
    ],
    "essential_covers": "Doctor reviews and care-coordinator support",
    "entitlements": {
      "DOCTOR_REVIEW": 2,
      "DIETITIAN_SESSION": 4
    },
    "tracked_measures": [
      "WEIGHT",
      "WAIST",
      "BP"
    ],
    "charged_separately": [
      "Tests beyond the plan are charged separately."
    ],
    "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
    "qr_url": "",
    "linked_programs": [
      "WEIGHT_PLAN"
    ]
  },
  {
    "id": 5,
    "active": true,
    "number": "06",
    "code": "CP06_MEDICAL_WEIGHT",
    "line": "SM WEIGHT CARE",
    "name_en": "Medical Weight Management",
    "name_hi": "मेडिकल वज़न प्रबंधन",
    "for_text": "A doctor-supervised programme. Eligibility is assessed in person by our doctor.",
    "colour": "emerald",
    "icon": "weight",
    "tiers": [
      {
        "tier": "PROGRAMME",
        "price_inr": 5999,
        "period": "QUARTER",
        "annual_price_inr": 19999
      }
    ],
    "inclusions_plus": [
      "In-person medical assessment and eligibility check",
      "Monthly doctor reviews, with treatment only if suitable for you",
      "4 dietitian sessions, with protein and nutrition support",
      "Strength and activity guidance",
      "A maintenance plan to keep your progress"
    ],
    "essential_covers": "None (Programme tier only)",
    "entitlements": {
      "DOCTOR_REVIEW": 3,
      "DIETITIAN_SESSION": 4
    },
    "tracked_measures": [
      "WEIGHT",
      "WAIST",
      "HBA1C",
      "SIDE_EFFECTS"
    ],
    "charged_separately": [
      "Medicine, if prescribed, is charged separately. Not every patient is eligible."
    ],
    "footnote": "Programme fee ₹5,999 / quarter. Medical assessment required. T&C apply.",
    "qr_url": "",
    "linked_programs": [
      "GLP1_WEIGHT_ASSESSMENT"
    ]
  },
  {
    "id": 6,
    "active": true,
    "number": "07",
    "code": "CP07_DIET_NUTRITION",
    "line": "SM WEIGHT CARE",
    "name_en": "Diet & Nutrition Plan",
    "name_hi": "डाइट और पोषण प्लान",
    "for_text": "For anyone who wants a personal diet plan from a qualified dietitian",
    "colour": "emerald",
    "icon": "apple",
    "tiers": [
      {
        "tier": "ESSENTIAL",
        "price_inr": 999,
        "period": "QUARTER",
        "annual_price_inr": null
      },
      {
        "tier": "PLUS",
        "price_inr": 1999,
        "period": "QUARTER",
        "annual_price_inr": 6499
      }
    ],
    "inclusions_plus": [
      "4 one-to-one dietitian sessions",
      "Body composition analysis",
      "A meal plan that suits your food, budget and routine",
      "Weekly check-ins on WhatsApp",
      "Doctor input when your health needs it"
    ],
    "essential_covers": "Dietitian consultations",
    "entitlements": {
      "DIETITIAN_SESSION": 4
    },
    "tracked_measures": [
      "WEIGHT",
      "WAIST",
      "DIET_GOALS"
    ],
    "charged_separately": [
      "Additional consultations charged separately."
    ],
    "footnote": "Essential covers dietitian consultations. T&C apply.",
    "qr_url": "",
    "linked_programs": [
      "DIET_PLAN"
    ]
  },
  {
    "id": 7,
    "active": true,
    "number": "08",
    "code": "CP08_THYROID",
    "line": "SM THYROID & HER CARE",
    "name_en": "Thyroid Care",
    "name_hi": "थायरॉइड केयर",
    "for_text": "For underactive thyroid (hypothyroidism)",
    "colour": "purple",
    "icon": "shield",
    "tiers": [
      {
        "tier": "ESSENTIAL",
        "price_inr": 999,
        "period": "QUARTER",
        "annual_price_inr": null
      },
      {
        "tier": "PLUS",
        "price_inr": 1799,
        "period": "QUARTER",
        "annual_price_inr": 5999
      }
    ],
    "inclusions_plus": [
      "2 doctor reviews and medicine dose review",
      "Thyroid tests at the start and after any dose change",
      "Home sample collection",
      "Symptom review: energy, weight, sleep, mood",
      "Endocrinologist referral when needed"
    ],
    "essential_covers": "Doctor reviews and care-coordinator support",
    "entitlements": {
      "DOCTOR_REVIEW": 2,
      "THYROID_TEST": 2
    },
    "tracked_measures": [
      "THYROID_LEVELS",
      "SYMPTOMS",
      "WEIGHT"
    ],
    "charged_separately": [
      "Medicines, thyroid ultrasound charged separately."
    ],
    "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
    "qr_url": "",
    "linked_programs": [
      "THYROID_MGMT"
    ]
  },
  {
    "id": 8,
    "active": true,
    "number": "09",
    "code": "CP09_PCOS",
    "line": "SM THYROID & HER CARE",
    "name_en": "PCOS Care",
    "name_hi": "पीसीओएस केयर",
    "for_text": "For women with PCOS: periods, weight and long-term metabolic health",
    "colour": "purple",
    "icon": "shield",
    "tiers": [
      {
        "tier": "ESSENTIAL",
        "price_inr": 2499,
        "period": "QUARTER",
        "annual_price_inr": null
      },
      {
        "tier": "PLUS",
        "price_inr": 3999,
        "period": "QUARTER",
        "annual_price_inr": 12999
      }
    ],
    "inclusions_plus": [
      "Consultation with our partner gynaecologist or endocrinologist",
      "2 doctor follow-up reviews",
      "4 dietitian sessions for PCOS-friendly eating",
      "Blood tests as advised by your doctor",
      "Cycle tracking and private WhatsApp support"
    ],
    "essential_covers": "Doctor reviews and care-coordinator support",
    "entitlements": {
      "DOCTOR_REVIEW": 3,
      "DIETITIAN_SESSION": 4
    },
    "tracked_measures": [
      "CYCLE_REGULARITY",
      "WEIGHT",
      "METABOLIC_MARKERS"
    ],
    "charged_separately": [
      "Pelvic ultrasound, additional hormone tests, fertility care charged separately."
    ],
    "footnote": "Essential covers doctor reviews and care-coordinator support. T&C apply.",
    "qr_url": "",
    "linked_programs": [
      "PCOS_MGMT"
    ]
  },
  {
    "id": 9,
    "active": true,
    "number": "10",
    "code": "CP10_LIVER",
    "line": "SM LIVER CARE",
    "name_en": "Fatty Liver Care",
    "name_hi": "फैटी लिवर केयर",
    "for_text": "For fatty liver seen on ultrasound, or raised liver enzymes",
    "colour": "amber",
    "icon": "liver",
    "tiers": [
      {
        "tier": "ESSENTIAL",
        "price_inr": 1999,
        "period": "QUARTER",
        "annual_price_inr": null
      },
      {
        "tier": "PLUS",
        "price_inr": 2999,
        "period": "QUARTER",
        "annual_price_inr": 9999
      }
    ],
    "inclusions_plus": [
      "2 doctor reviews",
      "3 dietitian sessions for a liver-friendly diet",
      "Liver and metabolic blood tests",
      "Liver scarring (fibrosis) risk score",
      "Gastroenterologist referral when needed"
    ],
    "essential_covers": "Doctor reviews and care-coordinator support",
    "entitlements": {
      "DOCTOR_REVIEW": 2,
      "DIETITIAN_SESSION": 3
    },
    "tracked_measures": [
      "WEIGHT",
      "LIVER_ENZYMES",
      "FIBROSIS_RISK"
    ],
    "charged_separately": [
      "Ultrasound, liver elastography (FibroScan) charged separately."
    ],
    "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
    "qr_url": "",
    "linked_programs": [
      "LIVER_HEALTH"
    ]
  },
  {
    "id": 10,
    "active": true,
    "number": "11",
    "code": "CP11_SENIOR",
    "line": "SM SENIOR CARE",
    "name_en": "Senior Care",
    "name_hi": "वरिष्ठ नागरिक केयर",
    "for_text": "For adults 60+ managing several conditions, and families caring for them from near or far",
    "colour": "blue",
    "icon": "user",
    "tiers": [
      {
        "tier": "ESSENTIAL",
        "price_inr": 1999,
        "period": "MONTH",
        "annual_price_inr": null
      },
      {
        "tier": "PLUS",
        "price_inr": 3499,
        "period": "MONTH",
        "annual_price_inr": 34999
      }
    ],
    "inclusions_plus": [
      "Complete health and daily-function assessment",
      "Monthly doctor review, by video or at home",
      "Full medicine review and refill management",
      "Falls-risk and home-safety check",
      "Monthly health update for the family"
    ],
    "essential_covers": "Doctor reviews and care-coordinator support",
    "entitlements": {
      "DOCTOR_REVIEW": 1
    },
    "tracked_measures": [
      "MEDICINES",
      "FALLS",
      "HOSPITAL_VISITS",
      "DAILY_FUNCTION"
    ],
    "charged_separately": [
      "Home nursing, medical devices, specialist consultations charged separately."
    ],
    "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
    "qr_url": "",
    "linked_programs": [
      "SENIOR_CARE"
    ]
  },
  {
    "id": 11,
    "active": true,
    "number": "12",
    "code": "CP12_MOVE",
    "line": "SM MOVE",
    "name_en": "Joint, Back & Mobility",
    "name_hi": "जोड़ और कमर दर्द केयर",
    "for_text": "For long-standing knee, hip, back or neck pain",
    "colour": "indigo",
    "icon": "activity",
    "tiers": [
      {
        "tier": "ESSENTIAL",
        "price_inr": 3999,
        "period": "BLOCK_8W",
        "annual_price_inr": null
      },
      {
        "tier": "PLUS",
        "price_inr": 5999,
        "period": "BLOCK_8W",
        "annual_price_inr": null
      }
    ],
    "inclusions_plus": [
      "Doctor assessment of your pain and movement",
      "8 physiotherapy sessions, at the hub or at home",
      "A home exercise programme you can keep doing",
      "Weight and diet support where it helps your joints",
      "Orthopaedic referral when needed"
    ],
    "essential_covers": "Fewer physiotherapy sessions; ask our team.",
    "entitlements": {
      "PHYSIO_SESSION": 8,
      "DOCTOR_REVIEW": 1
    },
    "tracked_measures": [
      "PAIN_SCORE",
      "MOVEMENT_FUNCTION"
    ],
    "charged_separately": [
      "X-ray and scans, injections, braces and supports charged separately."
    ],
    "footnote": "Essential covers fewer physiotherapy sessions. Plan advised by our doctor after assessment. T&C apply.",
    "qr_url": "",
    "linked_programs": [
      "FITNESS_PLAN"
    ]
  }
];

// Generated from backend/app/memberships.py HEALTH360_PLANS.
export const STARTER_MEMBERSHIP_PLANS = [
  {
    "id": 1,
    "active": true,
    "code": "H360_FREE",
    "name": "Health360 Free",
    "target_text": "Every registered patient",
    "price_inr_monthly": 0,
    "benefits_text": "Digital health record, reports, reminders, health alerts",
    "includes_plan": "",
    "entitlements": []
  },
  {
    "id": 2,
    "active": true,
    "code": "H360_ESSENTIAL",
    "name": "Health360 Essential",
    "target_text": "Individuals and families",
    "price_inr_monthly": 199,
    "benefits_text": "Care navigation, medicine reminders, preventive screening calendar, member service benefits",
    "includes_plan": "H360_FREE",
    "entitlements": [
      {
        "code": "CARE_NAVIGATION",
        "quantity": 2,
        "period": "MONTH",
        "description": "Care navigation support"
      },
      {
        "code": "MEDICINE_REMINDERS",
        "quantity": 30,
        "period": "MONTH",
        "description": "Automated medicine reminders"
      }
    ]
  },
  {
    "id": 3,
    "active": true,
    "code": "H360_PLUS",
    "name": "Health360 Plus",
    "target_text": "Preventive healthcare users",
    "price_inr_monthly": 499,
    "benefits_text": "Essential benefits plus defined teleconsultation and preventive-care entitlements",
    "includes_plan": "H360_ESSENTIAL",
    "entitlements": [
      {
        "code": "TELECONSULT",
        "quantity": 1,
        "period": "QUARTER",
        "description": "Defined teleconsultation"
      },
      {
        "code": "PREVENTIVE_SCREEN",
        "quantity": 1,
        "period": "YEAR",
        "description": "Preventive screening calendar/check"
      }
    ]
  },
  {
    "id": 4,
    "active": true,
    "code": "H360_CHRONIC",
    "name": "Health360 Chronic",
    "target_text": "Diabetes, hypertension and thyroid patients",
    "price_inr_monthly": 799,
    "benefits_text": "Clinician-supervised chronic-care program, monitoring and follow-up",
    "includes_plan": "H360_PLUS",
    "entitlements": [
      {
        "code": "DOCTOR_REVIEW",
        "quantity": 1,
        "period": "MONTH",
        "description": "Clinician supervision and review"
      },
      {
        "code": "DIETITIAN_SESSION",
        "quantity": 1,
        "period": "MONTH",
        "description": "Chronic care dietitian session"
      }
    ]
  },
  {
    "id": 5,
    "active": true,
    "code": "H360_SENIOR",
    "name": "Health360 Senior",
    "target_text": "Elderly patients",
    "price_inr_monthly": 1499,
    "benefits_text": "Care coordination, caregiver updates, scheduled clinical reviews and homecare coordination",
    "includes_plan": "H360_ESSENTIAL",
    "entitlements": [
      {
        "code": "CAREGIVER_UPDATE",
        "quantity": 4,
        "period": "MONTH",
        "description": "Monthly family caregiver updates"
      },
      {
        "code": "HOME_VISIT",
        "quantity": 1,
        "period": "QUARTER",
        "description": "Homecare coordination / visit"
      }
    ]
  },
  {
    "id": 6,
    "active": true,
    "code": "H360_CORPORATE",
    "name": "Health360 Corporate",
    "target_text": "Employer-sponsored members",
    "price_inr_monthly": 199,
    "benefits_text": "Preventive care, OPD access, care navigation and selected chronic-care benefits",
    "includes_plan": "H360_ESSENTIAL",
    "entitlements": [
      {
        "code": "OPD_VISIT",
        "quantity": 1,
        "period": "MONTH",
        "description": "OPD consultation access"
      },
      {
        "code": "CARE_NAVIGATION",
        "quantity": 2,
        "period": "MONTH",
        "description": "Priority care navigation"
      }
    ]
  }
];

export function maskPlanName(role, planNumber, nameEn) {
  if (role && role.toUpperCase() === "CALLER") {
    return `Health Hub care plan ${planNumber}`;
  }
  return nameEn;
}

// ---- Pages 13/14 on the edge: the same data-backed figures as backend/app/relationship_{scorecard,loop}.py.
// Nothing is a placeholder: when there is nothing to measure the value is "—" and the status NOT_AVAILABLE.
const STAGES = ["PREVENTION", "EATING_WELL", "DIAGNOSTICS", "CONSULTATIONS", "MEDICATIONS", "CHRONIC_CONDITIONS", "ONGOING_MONITORING"];
const LIVE = ["ACTIVE", "RENEWAL_DUE"];
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const shift = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
const showPct = (v) => (v === null ? "—" : `${Number.isInteger(v) ? v.toFixed(1) : v}%`);
const day = (v) => String(v || "").slice(0, 10);

function scope(store, query) {
  const to = query.to || todayIst();
  const from = query.from || shift(to, -365);
  const corp = query.corporate_id ? Number(query.corporate_id) : null;
  const pids = new Set((store.patients || []).filter((p) => !p.merged_into_id && (corp === null || p.corporate_client_id === corp)).map((p) => p.id));
  const hub = query.hub_id ? Number(query.hub_id) : null;
  const node = query.node_id ? Number(query.node_id) : null;
  const tps = (store.care_touchpoints || []).filter((t) => pids.has(t.patient_id) && day(t.occurred_on) >= from && day(t.occurred_on) <= to
    && (!hub || t.health_hub_id === hub) && (!node || t.express_node_id === node));
  return { from, to, corp, pids, hub, node, tps };
}

function revenueSplit(store, s) {
  let tx = 0, sub = 0, txCount = 0;
  for (const t of s.tps) {
    if (t.amount_inr === null || t.amount_inr === undefined) continue;
    if (t.ref_entity === "payments") sub += t.amount_inr;
    else { tx += t.amount_inr; txCount++; }
  }
  for (const p of store.payments || []) {
    const d = day(p.received_at);
    if (p.membership_id && p.status === "PAID" && d >= s.from && d <= s.to && s.pids.has(p.patient_id) && (!s.hub || p.health_hub_id === s.hub)) sub += p.amount_inr || 0;
  }
  const months = Math.max(1, Math.round((days(s.from, s.to) + 1) / 30));
  let corp = 0;
  for (const c of (store.corporate_clients || []).filter((x) => x.active !== false)) {
    const members = (store.memberships || []).filter((m) => m.corporate_client_id === c.id && m.payer === "CORPORATE" && LIVE.includes(m.status)).length;
    corp += members * (c.pepm_inr || 0) * months;
  }
  return { transactions: tx, transaction_count: txCount, subscriptions: sub, corporate: corp, total: tx + sub + corp };
}

function ami(store, s) {
  const last = s.to < todayIst() ? s.to : todayIst();
  let due = 0, onTime = 0;
  for (const j of store.care_journeys || []) {
    for (const st of j.steps || []) {
      if (!st.due_on || st.due_on < s.from || st.due_on > last || st.status === "SKIPPED") continue;
      due++;
      if (st.status === "DONE" && st.completed_on && st.completed_on <= st.due_on) onTime++;
    }
  }
  return { active_journeys: (store.care_journeys || []).filter((j) => j.status === "ACTIVE").length, steps_due: due, steps_on_time: onTime, steps_on_time_pct: pct(onTime, due) };
}

function reactivatedCount(store, s, activeIds) {
  let n = 0;
  for (const pid of activeIds) {
    const ds = [...new Set((store.care_touchpoints || []).filter((t) => t.patient_id === pid && day(t.occurred_on) <= s.to).map((t) => day(t.occurred_on)))].sort();
    if (ds.some((b, i) => i > 0 && b >= s.from && days(ds[i - 1], b) > 180)) n++;
  }
  return n;
}

export function computeScorecard(store, query = {}) {
  const s = scope(store, query);
  const suppress = s.corp !== null && s.pids.size < 10;
  const cnt = (n) => (suppress && n > 0 && n < 10 ? "< 10" : n);
  const dates = new Map(), stages = new Map(), counts = new Map();
  for (const t of s.tps) {
    if (!dates.has(t.patient_id)) { dates.set(t.patient_id, new Set()); stages.set(t.patient_id, new Set()); counts.set(t.patient_id, 0); }
    dates.get(t.patient_id).add(day(t.occurred_on));
    stages.get(t.patient_id).add(t.stage);
    counts.set(t.patient_id, counts.get(t.patient_id) + 1);
  }
  const active = dates.size;
  const multi = [...dates.values()].filter((d) => d.size >= 2).length;
  const rev = revenueSplit(store, s);
  const share = (k) => pct(rev[k], rev.total);
  const cross = [...stages.values()].filter((x) => x.size >= 2).length;
  const tested = new Set((store.orders || []).map((o) => o.patient_id).filter((p) => s.pids.has(p)));
  const inCare = new Set([...(store.plan_enrollments || []).filter((e) => e.activated_at).map((e) => e.patient_id),
    ...(store.memberships || []).filter((m) => m.plan_code !== "H360_FREE" && LIVE.includes(m.status)).map((m) => m.patient_id)]);
  const entered = [...tested].filter((p) => inCare.has(p)).length;
  const refills = (store.refill_schedules || []).filter((r) => r.status === "ACTIVE" && s.pids.has(r.patient_id));
  const refillsOk = refills.filter((r) => day(r.next_refill_on) >= todayIst()).length;
  const pairs = new Map();
  for (const f of store.followups || []) {
    if (f.assigned_doctor_id && s.pids.has(f.patient_id)) {
      const k = `${f.assigned_doctor_id}:${f.patient_id}`;
      pairs.set(k, (pairs.get(k) || 0) + 1);
    }
  }
  const docPatients = new Set([...pairs.keys()].map((k) => k.split(":")[1]));
  const longitudinal = new Set([...pairs.entries()].filter(([, n]) => n >= 2).map(([k]) => k.split(":")[1]));
  const a = ami(store, s);
  const hubs = (store.health_hubs || []).filter((h) => h.active !== false).length;
  const nodes = (store.express_nodes || []).filter((n) => n.active !== false).length;
  const hubEnr = (store.plan_enrollments || []).filter((e) => e.activated_at && e.health_hub_id).length;
  const nodePatients = (store.patients || []).filter((p) => s.pids.has(p.id) && p.source_channel === "EXPRESS_NODE").length;
  const corps = (store.corporate_clients || []).filter((c) => c.active !== false);
  const corpMembers = (store.memberships || []).filter((m) => m.payer === "CORPORATE" && LIVE.includes(m.status) && (s.corp === null || m.corporate_client_id === s.corp)).length;
  const longRel = [...counts.values()].filter((n) => n >= 3).length;
  const per = (n, d, unit) => (d ? `${Math.round((10 * n) / d) / 10} / ${unit}` : "—");
  const inr = (v) => (v === null ? "—" : `₹${v.toLocaleString("en-IN")}`);
  const dim = (dimension, current_model, proposed_model, current_metric, proposed_metric, status) => ({ dimension, current_model, proposed_model,
    current_metric, proposed_metric, trend: null, data_status: status || (proposed_metric.value === "—" ? "NOT_AVAILABLE" : "OK") });
  const na = (label) => ({ label, value: "—" });
  const dimensions = [
    dim("Customer relationship", "Individual service purchase", "Continuous healthcare engagement",
      { label: "One-time patients %", value: showPct(pct(active - multi, active)) },
      { label: "≥ 2 touchpoints in the period %", value: showPct(pct(multi, active)), numerator: cnt(multi), denominator: active }),
    dim("Revenue", "Per transaction", "Subscription + transactions + enterprise contracts",
      { label: "Transaction revenue share", value: showPct(share("transactions")) },
      { label: "Subscription / transaction / enterprise",
        value: rev.total ? `${share("subscriptions")}% sub / ${share("transactions")}% tx / ${share("corporate")}% corp` : "—",
        numerator: rev.subscriptions + rev.corporate, denominator: rev.total }),
    dim("Patient acquisition", "Repeated acquisition and reactivation", "Acquisition followed by retention and cross-selling",
      { label: "Reactivated after 180+ quiet days %", value: showPct(pct(reactivatedCount(store, s, dates.keys()), active)) },
      { label: "Cross-sold (≥ 2 loop stages) %", value: showPct(pct(cross, active)), numerator: cnt(cross), denominator: active }),
    dim("Diagnostics", "Revenue-generating test", "Entry point into ongoing care",
      { label: "Tested patients with no ongoing care %", value: showPct(pct(tested.size - entered, tested.size)) },
      { label: "Tested patients who entered ongoing care %", value: showPct(pct(entered, tested.size)), numerator: cnt(entered), denominator: tested.size }),
    dim("Pharmacy", "Medicine purchase", "Prescription management and refill continuity", na("One-off medicine orders (no pharmacy order data)"),
      { label: "Active refills not overdue %", value: showPct(pct(refillsOk, refills.length)), numerator: refillsOk, denominator: refills.length }),
    dim("Doctors", "Individual consultation", "Longitudinal clinical relationship",
      { label: "Patients seen once by their doctor %", value: showPct(pct(docPatients.size - longitudinal.size, docPatients.size)) },
      { label: "Seen ≥ 2 times by the same doctor %", value: showPct(pct(longitudinal.size, docPatients.size)),
        numerator: cnt(longitudinal.size), denominator: docPatients.size }),
    dim("AMI", "Workflow automation", "Continuous care coordination", na("Tasks automated (not tracked)"),
      { label: "Journey steps done on time %", value: showPct(a.steps_on_time_pct), numerator: a.steps_on_time, denominator: a.steps_due }),
    dim("Health Hubs", "Service delivery locations", "Patient enrollment and care-management centers",
      { label: "Services delivered per hub", value: per(s.tps.filter((t) => t.health_hub_id).length, hubs, "hub") },
      { label: "Paid care-plan enrolments per hub", value: per(hubEnr, hubs, "hub"), numerator: hubEnr, denominator: hubs }),
    dim("Express Nodes", "Distribution and referral points", "Local patient acquisition and engagement network",
      { label: "Services delivered per node", value: per(s.tps.filter((t) => t.express_node_id).length, nodes, "node") },
      { label: "Patients acquired per node", value: per(nodePatients, nodes, "node"), numerator: nodePatients, denominator: nodes }),
    dim("Corporate clients", "Healthcare service buyers", "Long-term population-health partners", na("One-off corporate camps (not tracked)"),
      { label: "Active employer-paid members", value: suppress ? "< 10" : (corps.length ? String(corpMembers) : "—"),
        numerator: suppress ? 0 : corpMembers, denominator: corps.length },
      suppress ? "PARTIAL" : null),
    dim("Core financial metric", "Revenue per transaction", "Annual contribution per active patient",
      { label: "Average transaction value", value: inr(rev.transaction_count ? Math.round(rev.transactions / rev.transaction_count) : null) },
      { label: "Period revenue / active patient", value: inr(active ? Math.round(rev.total / active) : null), numerator: rev.total, denominator: active }),
    dim("Strategic asset", "Healthcare network", "Healthcare network + longitudinal patient relationships",
      { label: "Active hubs and nodes", value: `${hubs + nodes} locations` },
      { label: "Patients with ≥ 3 touchpoints", value: active ? `${cnt(longRel)} patients` : "—", numerator: cnt(longRel), denominator: active }),
  ];
  return { period: { from: s.from, to: s.to }, filters: { hub_id: s.hub, node_id: s.node, corporate_id: s.corp }, dimensions };
}

export function computeLoop(store, query = {}) {
  const s = scope(store, query);
  const cell = (n) => (s.corp !== null && n > 0 && n < 10 ? "< 10" : n);
  const data = Object.fromEntries(STAGES.map((st) => [st, { patients: new Set(), revenue: 0 }]));
  const byPatient = new Map();
  for (const t of s.tps) {
    const st = data[t.stage] ? t.stage : "ONGOING_MONITORING";
    data[st].patients.add(t.patient_id);
    data[st].revenue += t.amount_inr || 0;
    if (!byPatient.has(t.patient_id)) byPatient.set(t.patient_id, []);
    byPatient.get(t.patient_id).push([day(t.occurred_on), st]);
  }
  const transitions = Object.fromEntries(STAGES.map((a) => [a, Object.fromEntries(STAGES.map((b) => [b, 0]))]));
  for (const rows of byPatient.values()) {
    rows.sort((x, y) => x[0].localeCompare(y[0]));
    for (let i = 1; i < rows.length; i++) if (days(rows[i - 1][0], rows[i][0]) <= 120) transitions[rows[i - 1][1]][rows[i][1]]++;
  }
  const span = days(s.from, s.to) + 1;
  const prevFrom = shift(s.from, -span);
  const prevActive = new Set((store.care_touchpoints || [])
    .filter((t) => s.pids.has(t.patient_id) && day(t.occurred_on) >= prevFrom && day(t.occurred_on) < s.from).map((t) => t.patient_id));
  const retained = [...prevActive].filter((p) => byPatient.has(p)).length;
  const rev = revenueSplit(store, s);
  const a = ami(store, s);
  const oneTime = [...byPatient.values()].filter((rows) => new Set(rows.map((r) => r[0])).size === 1).length;
  return {
    period: { from: s.from, to: s.to },
    stages: STAGES.map((st) => ({ stage: st, patient_count: cell(data[st].patients.size), revenue_inr: data[st].revenue,
      patient_pct: showPct(pct(data[st].patients.size, s.pids.size)) })),
    transitions,
    retention_rate: showPct(pct(retained, prevActive.size)),
    ami_coordination: { active_journeys: a.active_journeys, steps_on_time_pct: showPct(a.steps_on_time_pct), retest_completion_pct: "—" },
    revenue_ring: { transactions_inr: rev.transactions, subscriptions_inr: rev.subscriptions, corporate_inr: rev.corporate,
      total_holistic_revenue_inr: rev.total, annual_contribution_per_patient_inr: byPatient.size ? Math.round(rev.total / byPatient.size) : null },
    transaction_cohort: { one_time_patients: cell(oneTime), reactivated_patients: cell(reactivatedCount(store, s, byPatient.keys())),
      revenue_per_transaction_inr: rev.transaction_count ? Math.round(rev.transactions / rev.transaction_count) : null },
  };
}
