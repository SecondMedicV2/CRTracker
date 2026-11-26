/**
 * Retesting Schedule & 5 Urgency Tiers Engine (Pages 7 & 9).
 * Shared pure ES module used by Cloudflare Worker (worker.js) and parity tests.
 */
import {
  DEFAULT_DIAGNOSTIC_FINDINGS,
  DEFAULT_MEDICINE_CATALOGUE,
  DONE_STAGES,
  addDaysIso,
  buildProgramContext,
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
  { code: "ELECTROLYTES", name: "Electrolytes" },
  { code: "URINE_ROUTINE", name: "Urine Routine" },
  { code: "UACR", name: "Urine Albumin-to-Creatinine Ratio" },
  { code: "LFT", name: "Liver Function Test" },
];

export const DEFAULT_RETEST_PROTOCOLS = [
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
  const protos = Object.fromEntries((rules.retest_protocols?.data || rules.retest_protocols || DEFAULT_RETEST_PROTOCOLS).map((p) => [p.finding_code, p]));
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
  const schedules = detected.filter((fc) => protos[fc]).map((fc) =>
    evaluateRetestFinding({ proto: protos[fc], reportDateIst: collected, followup, ctx, medCat, params, trends, catNames, detectedCodes: detected, state })
  );

  const protocolTier = resolveProtocolTierInStore(followup, params, rules, schedules, detected, fallbackDays);
  const tmeta = getTierMeta(rules, protocolTier);
  followup.protocol_tier = protocolTier;
  const prevManual = followup.retest_plan?.manual_tier;
  const prevNotified = Boolean(followup.retest_plan?.urgent_notified);

  if (!schedules.length) {
    const due = fallbackDays <= 0 ? today : addDaysIso(collected, fallbackDays);
    followup.retest_window_start = due;
    followup.retest_window_end = due;
    followup.reminder_on = null;
    followup.due_on = due;
    followup.retest_status = "FALLBACK";
    followup.retest_plan = {
      status: "FALLBACK", label: "Retest due", primary_finding: null, findings: [], default_tests: [],
      protocol_tier: protocolTier, tier_meta: tmeta, ...(prevManual ? { manual_tier: prevManual } : {}), ...(prevNotified ? { urgent_notified: true } : {}),
    };
    notifyUrgentInStore(store, followup);
    return followup.retest_plan;
  }

  const autoItems = schedules.filter((s) => s.auto_scheduled && s.window_start);
  const top = schedules[0];
  if (top.finding_code === "HIGH_CREATININE" || !autoItems.length) {
    const defaultCodes = [...new Set(top.tests.filter((t) => !t.optional && catNames[t.code]).map((t) => t.code))].sort();
    followup.retest_window_start = null;
    followup.retest_window_end = null;
    followup.reminder_on = null;
    followup.due_on = today;
    followup.retest_status = "DOCTOR_TO_SET";
    followup.retest_plan = {
      status: "DOCTOR_TO_SET", label: "Doctor to set retest date", primary_finding: top, findings: schedules, default_tests: defaultCodes,
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
    status: "AUTO_SCHEDULED", label: "Retest due", primary_finding: chosen, findings: schedules, default_tests: defaultCodes,
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
