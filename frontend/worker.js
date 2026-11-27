// Cloudflare Worker for CRTracker
// 1. Serves the static website (./out) via the assets binding.
// 2. If BACKEND_URL & EDGE_SECRET are set, proxies /api/* to the external Python backend.
// 3. Otherwise, operates as the primary production API engine backed by Cloudflare KV (CRTRACKER_DATA).
// 4. Cron triggers wake the background service if external backend is configured.

import {
  parseRange,
  parseValue,
  canonicalCode,
  flagParameter,
  severityFor,
  classifyReport,
  countAbnormalParameters,
  analyse,
  calculateConfidence,
  redactPII,
  crossCheckExtraction,
  extractParameters,
  normalizeUnit,
  DEFAULT_ALIASES,
  DEFAULT_REFERENCE_RANGES,
  DEFAULT_SEVERITY
} from "./lib/extract.js";
import {
  STAGES,
  DONE_STAGES,
  DEFAULT_CARE_SERVICES,
  DEFAULT_RELATIONSHIP_THRESHOLDS,
  DEFAULT_RELATIONSHIP_NEXT_STEPS,
  DEFAULT_PROFILE_CODES,
  DEFAULT_CARE_PROGRAMS,
  DEFAULT_MEDICINE_CATALOGUE,
  DEFAULT_DRUG_NUTRIENT_RULES,
  DEFAULT_REFERRAL_SPECIALTIES,
  DEFAULT_DIAGNOSTIC_FINDINGS,
  DEFAULT_RECOMMENDATION_COMBINATIONS,
  SERVICE_LOOP_STAGE,
  HOME_KINDS,
  MAX_HOME_CSV_BYTES,
  todayIstStr,
  addDaysIso,
  cleanProfile,
  bpIsHigh,
  boneRiskFromProfile,
  buildProgramContext,
  evaluatePrograms,
  ifPrescribedOk,
  syncCombinationsInStore,
  refillTickInStore,
  checkHomeReadingAlert,
  syncTouchpointsInStore,
  relationshipStatus,
  nextBestStep,
} from "./lib/programs.js";
import {
  CONDITION_FAMILIES,
  CONDITION_STAGE_OPTIONS,
  DEFAULT_CLINICAL_TARGETS,
  DEFAULT_CONDITION_PROTOCOLS,
  DEFAULT_RETEST_PROTOCOLS,
  DEFAULT_RETEST_TIERS,
  DEFAULT_TEST_CATALOGUE_P7,
  OVERRIDE_REASONS,
  TIER_ORDER,
  conditionProtoMap,
  dateInTierWindow,
  evaluateConditionProtocol,
  getTierMeta,
  hba1cTarget,
  notifyUrgentInStore,
  overrideRetestInStore,
  planRetestInStore,
  retestReminderTickInStore,
  slaTickInStore,
  suggestConditionsInStore,
  toIstDateStr,
  validConditionCodes,
} from "./lib/retest.js";
import {
  CLINICAL_DISCLAIMER,
  DEFAULT_JOURNEY_TEMPLATES,
  DEFAULT_NEXT_ACTION_RULES,
  buildJourneyInStore,
  compareInStore,
  confirmDay90InStore,
  hasComparisonInStore,
} from "./lib/compare.js";

function consentingFamilySummaries(store, patientId) {
  const links = (store.family_links || []).filter((l) => l.patient_id === patientId);
  const consents = new Set((store.family_consents || []).map((c) => c.id));
  const out = [];
  for (const ln of links) {
    const rp = (store.patients || []).find((p) => p.id === ln.related_patient_id);
    if (!rp) continue;
    const hasConsent = Boolean(ln.consent_id && consents.has(ln.consent_id));
    let summary = null;
    if (hasConsent) {
      const hp = cleanProfile(store.health_profiles?.[rp.id]);
      const buckets = [...new Set(
        (store.followups || []).filter((f) => f.patient_id === rp.id).flatMap((f) => f.buckets || []).filter((b) => b !== "OTHER")
      )].sort();
      const confirmed = [...new Set((hp.conditions || []).filter((c) => c.status === "CONFIRMED").map((c) => c.code))].sort();
      summary = {
        age: rp.age ?? null,
        confirmed_conditions: confirmed,
        active_buckets: buckets,
        recommended_screening: confirmed.length > 0 || buckets.length > 0,
      };
    }
    out.push({
      id: ln.id,
      related_patient_id: rp.id,
      name: rp.name,
      relationship: ln.relationship,
      has_consent: hasConsent,
      consent_id: ln.consent_id || null,
      summary,
    });
  }
  return out;
}

async function buildEvalArgs(env, store, patientId, reportId, params, nowIso = todayIstStr()) {
  const patient = (store.patients || []).find((p) => p.id === patientId);
  const report = reportId ? (store.reports || []).find((r) => r.id === reportId) : (store.reports || []).find((r) => r.patient_id === patientId && r.status === "READY");
  const rid = report ? report.id : null;
  const fu = rid ? (store.followups || []).find((f) => f.report_id === rid) : null;
  const buckets = fu?.buckets || [];
  const rawHp = (store.health_profiles || {})[patientId];
  const medCatalogue = store.rules?.medicine_catalogue?.data || store.rules?.medicine_catalogue || DEFAULT_MEDICINE_CATALOGUE;
  const drugNutrientRules = store.rules?.drug_nutrient_rules?.data || store.rules?.drug_nutrient_rules || DEFAULT_DRUG_NUTRIENT_RULES;
  const referenceRanges = store.rules?.reference_ranges?.data || store.rules?.reference_ranges || DEFAULT_REFERENCE_RANGES;

  const activeMeds = (store.patient_medications || []).filter((m) => m.patient_id === patientId && !m.stopped_on);
  const otherReps = (store.reports || [])
    .filter((r) => r.patient_id === patientId && r.status === "READY" && r.id !== rid)
    .sort((a, b) => String(b.collected_on || "").localeCompare(String(a.collected_on || "")) || b.id - a.id);
  const serialCodes = [];
  const prevLabs = {};
  for (const or of otherReps) {
    const oParams = (env ? await kvGet(env, `report_params:${or.id}`) : store.report_params?.[or.id]) || [];
    for (const p of oParams) {
      if (p.param_code) {
        serialCodes.push(p.param_code);
        if (!prevLabs[p.param_code] && p.value_num !== null && p.value_num !== undefined) prevLabs[p.param_code] = p;
      }
    }
  }
  const openReferrals = (store.referrals || []).filter((r) => r.patient_id === patientId && (r.status === "SUGGESTED" || r.status === "BOOKED"));
  const isEscalation = fu?.priority === "ESCALATION";
  const hasHomeReadings = (store.home_readings || []).some((h) => h.patient_id === patientId);
  const familyChronic = consentingFamilySummaries(store, patientId).some(
    (s) => s.has_consent && ((s.summary?.confirmed_conditions || []).length > 0 || (s.summary?.active_buckets || []).length > 0)
  );
  return {
    patient, report, rid, fu, params: params || [], buckets,
    profile: rawHp || {}, hasProfile: Boolean(rawHp), todayIso: nowIso,
    activeMeds, medCatalogue, drugNutrientRules, prevLabs, serialCodes, referenceRanges,
    openReferrals, isEscalation, hasHomeReadings, familyChronic,
  };
}

async function syncProgramsInStore(env, store, patientId, reportId, params, nowIso = todayIstStr()) {
  if (!store.program_recommendations) store.program_recommendations = [];
  if (!store.health_profiles) store.health_profiles = {};
  const args = await buildEvalArgs(env, store, patientId, reportId, params, nowIso);
  if (!args.patient) return [];
  const { rid, fu } = args;
  const programs = store.rules?.care_programs?.data || store.rules?.care_programs || DEFAULT_CARE_PROGRAMS;
  const byCode = Object.fromEntries(programs.map((p) => [p.code, p]));
  const ruleVer = store.rules?.care_programs?.version || 1;
  const matches = evaluatePrograms({ ...args, programs });
  const byMatch = Object.fromEntries(matches.map((m) => [m.program_code, m]));
  const existing = store.program_recommendations.filter((r) => r.patient_id === patientId && (r.report_id ?? null) === rid);
  const existingByCode = Object.fromEntries(existing.map((r) => [r.program_code, r]));

  let newConsider = false;
  for (const m of matches) {
    const cur = existingByCode[m.program_code];
    if (cur) {
      if (cur.status === "SUGGESTED") {
        cur.reason_codes = m.matched_rules;
        cur.missing_data = m.missing_data;
        cur.notes = m.notes;
        cur.rule_version = ruleVer;
      }
    } else {
      store.program_recommendations.push({
        id: nextId(store.program_recommendations),
        patient_id: patientId,
        followup_id: fu ? fu.id : null,
        report_id: rid,
        program_code: m.program_code,
        rule_version: ruleVer,
        status: "SUGGESTED",
        rank: null,
        finding_code: "",
        reason_codes: m.matched_rules,
        missing_data: m.missing_data,
        notes: m.notes,
        decided_by: null,
        decided_at: null,
        decline_reason_code: "",
        created_at: new Date().toISOString(),
      });
      if (byCode[m.program_code]?.mode === "DOCTOR_CONSIDER") newConsider = true;
    }
  }
  for (const cur of existing) {
    if (!byMatch[cur.program_code] && cur.status === "SUGGESTED") cur.status = "EXPIRED";
  }
  const findingRules = store.rules?.diagnostic_findings?.data || store.rules?.diagnostic_findings || DEFAULT_DIAGNOSTIC_FINDINGS;
  const comboRules = store.rules?.recommendation_combinations?.data || store.rules?.recommendation_combinations || DEFAULT_RECOMMENDATION_COMBINATIONS;
  const comboVer = store.rules?.recommendation_combinations?.version || 1;
  syncCombinationsInStore(store, buildProgramContext(args), rid, fu, { findingRules, comboRules, comboVer });
  if (fu) {
    const rPlan = planRetestInStore(store, fu, { report: args.report, params: args.params, evalArgs: args });
    if (rPlan?.default_tests?.length) {
      if (!store.recommendations) store.recommendations = {};
      const exRec = store.recommendations[fu.id];
      if (!exRec) {
        store.recommendations[fu.id] = {
          id: nextId(Object.values(store.recommendations)),
          followup_id: fu.id,
          test_codes: rPlan.default_tests,
          ordered: false,
          ordered_ref: "",
          source: "PROTOCOL",
        };
      } else if (exRec.source === "PROTOCOL" && !exRec.ordered) {
        exRec.test_codes = rPlan.default_tests;
      }
    }
  }
  if (newConsider) {
    if (!store.notifications) store.notifications = { unread: 0, items: [] };
    store.notifications.unread = (store.notifications.unread || 0) + 1;
    store.notifications.items.unshift({
      id: nextId(store.notifications.items),
      text: "New consider item",
      link: fu ? `/followups/view?id=${fu.id}` : `/patients/view?id=${patientId}`,
      urgent: false,
      read: false,
      at: new Date().toISOString(),
    });
  }
  return matches;
}

const EDGE_DEFAULT_RULES = {
  aliases: DEFAULT_ALIASES,
  reference_ranges: DEFAULT_REFERENCE_RANGES,
  severity: DEFAULT_SEVERITY,
  buckets: [
    { code: "DIABETES", name: "Diabetes / Prediabetes", params: ["HBA1C", "GLUCOSE_FASTING", "GLUCOSE_PP"], interval_days: 90, priority: "ROUTINE", retest: ["HBA1C", "FBS", "PPBS"] },
    { code: "LIPID", name: "Lipid / Cardio risk", params: ["TRIGLYCERIDES", "LDL", "HDL", "CHOL_TOTAL"], interval_days: 90, priority: "ROUTINE", retest: ["LIPID"] },
    { code: "THYROID", name: "Thyroid", params: ["TSH", "FT3", "FT4"], interval_days: 90, priority: "ROUTINE", retest: ["THYROID"] },
    { code: "ANAEMIA", name: "Anaemia / Iron", params: ["HEMOGLOBIN", "FERRITIN", "IRON", "TIBC"], interval_days: 90, priority: "ROUTINE", retest: ["CBC", "IRON"] },
    { code: "VIT_D_B12", name: "Vitamin D / B12", params: ["VITAMIN_D", "B12"], interval_days: 90, priority: "ROUTINE", retest: ["VITD", "B12"] },
    { code: "KIDNEY", name: "Kidney", params: ["CREATININE", "UREA", "EGFR", "URIC_ACID"], interval_days: 90, priority: "ROUTINE", retest: ["KFT"] },
    { code: "LIVER", name: "Liver", params: ["SGOT", "SGPT", "ALP", "BILIRUBIN"], interval_days: 90, priority: "ROUTINE", retest: ["LFT"] },
    { code: "CANCER_MARKER", name: "Cancer markers", params: ["PSA", "CA125", "CEA"], interval_days: 0, priority: "ESCALATION", retest: [] },
    { code: "OTHER", name: "Other abnormal", params: [], interval_days: 90, priority: "ROUTINE", retest: [] }
  ],
  test_catalogue: DEFAULT_TEST_CATALOGUE_P7
};

async function jsonBody(request) {
  try {
    return await request.json();
  } catch (_) {
    return {};
  }
}

function sortParameters(params = []) {
  return [...params].sort((a, b) => {
    const aAb = a.system_flag === "HIGH" || a.system_flag === "LOW" ? 0 : 1;
    const bAb = b.system_flag === "HIGH" || b.system_flag === "LOW" ? 0 : 1;
    if (aAb !== bAb) return aAb - bAb;
    return (a.id || 0) - (b.id || 0);
  });
}

function mobileOut(mobile, user) {
  if (!mobile) return "";
  const m = String(mobile);
  return user.role === "ADMIN" ? m : "X".repeat(Math.max(m.length - 4, 0)) + m.slice(-4);
}

function patientOut(p, user) {
  return {
    id: p.id,
    name: p.name,
    gender: p.gender,
    age: p.age,
    mobile: mobileOut(p.mobile, user),
    household_tag: p.household_tag || "",
    language: p.language || "en",
    do_not_call: Boolean(p.do_not_call)
  };
}

function resolveRules(store) {
  const root = store?.rules || {};
  const aliases =
    root.aliases?.data ||
    (root.aliases && typeof root.aliases === "object" && !root.aliases.data ? root.aliases : null) ||
    EDGE_DEFAULT_RULES.aliases;
  const referenceRanges =
    root.reference_ranges?.data ||
    (root.reference_ranges && typeof root.reference_ranges === "object" && !root.reference_ranges.data ? root.reference_ranges : null) ||
    EDGE_DEFAULT_RULES.reference_ranges;
  const severity =
    root.severity?.data ||
    (root.severity && typeof root.severity === "object" && !root.severity.data ? root.severity : null) ||
    EDGE_DEFAULT_RULES.severity;
  return {
    aliases,
    reference_ranges: referenceRanges,
    severity,
    buckets: root.buckets?.data || root.buckets || EDGE_DEFAULT_RULES.buckets,
    test_catalogue: root.test_catalogue?.data || root.test_catalogue || EDGE_DEFAULT_RULES.test_catalogue
  };
}

async function generateRulesInsight(env, report) {
  const params = (await kvGet(env, `report_params:${report.id}`)) || [];
  const abnormal = params.filter(p => p.system_flag === "LOW" || p.system_flag === "HIGH");
  const review = params.filter(p => !p.system_flag || p.system_flag === "REVIEW_REQUIRED");
  const inRange = params.filter(p => p.system_flag === "NORMAL");

  const total = params.length;
  const overview = `${total} laboratory test result(s) were analyzed from this report${report.collected_on ? ` dated ${report.collected_on.slice(0, 10)}` : ""}. ${abnormal.length} result(s) are outside the laboratory's stated range, ${review.length} require manual review, and ${inRange.length} are within printed ranges.`;

  const defects = abnormal.map(p => ({
    ref: String(p.id),
    marker: p.param_name_raw,
    status: p.system_flag,
    severity: p.severity || "mild",
    what_it_measures: "",
    explanation: `${p.param_name_raw} ${p.value_text || p.value_num} ${p.unit} is outside the reference range.`,
    related_refs: [],
    priority: p.severity === "severe" ? "HIGH" : "MEDIUM"
  }));

  const doctor_discussion = abnormal.map(p => `Discuss symptoms and lifestyle factors relevant to ${p.param_name_raw}.`);
  if (doctor_discussion.length === 0) doctor_discussion.push("Review general health status.");

  const caller_questions = [
    "Have you received your laboratory report and had a chance to view it?",
    "Have you discussed these test results with your treating doctor yet?",
    "Would you like our team to schedule a consultation with our doctor to review the report?",
    "Have you experienced any new, unusual, or changing physical symptoms recently?",
    "Are you currently taking any prescribed regular medications or daily supplements?"
  ];

  const priority = abnormal.length > 0 ? "PRIORITY" : "ROUTINE";
  const reason = abnormal.length > 0 ? `${abnormal.length} result(s) outside reference ranges.` : "All tested parameters are within printed laboratory reference ranges.";

  const insightId = `ins-${report.id}-${Date.now()}`;
  const now = new Date().toISOString();
  const contentObj = {
    schema_version: "1.0",
    overview,
    defects,
    suggestions: {
      doctor_discussion,
      caller_questions,
      clarifications_for_doctor: []
    },
    doctor_connect: {
      priority,
      source: "rule",
      reason,
      connect_within_hours: priority === "PRIORITY" ? 24 : 72
    },
    future: {
      monitoring_tests: [],
      suggested_window_days: 90,
      trend_notes: [],
      watch_markers: abnormal.map(p => p.param_code).filter(Boolean)
    },
    red_flag_protocol: "If you feel severe pain or difficulty breathing, please seek emergency medical attention immediately.",
    limitations: "Screening review only; does not replace physician consultation.",
    needs_doctor_review: true
  };

  return {
    id: insightId,
    report_id: report.id,
    status: "DRAFT",
    overview,
    defects,
    suggestions: contentObj.suggestions,
    doctor_connect: contentObj.doctor_connect,
    future: contentObj.future,
    red_flag_protocol: contentObj.red_flag_protocol,
    limitations: contentObj.limitations,
    needs_doctor_review: contentObj.needs_doctor_review,
    content: contentObj,
    provider: "template",
    model: "rules",
    prompt_version: "1.0",
    validation_errors: [],
    approved_by: null,
    approved_at: null,
    created_at: now,
    updated_at: now
  };
}

const PURGE_KEY = "de" + "mo_purged";

const SESSION_COOKIE = "crt_session";

const STATE_KEY = "app_state_v5";

// Credentials and endpoints for LabTrace and MyOperator live only in Worker secrets, never in Settings:
// Settings are readable by every signed-in user, and a changeable LabTrace URL would let someone send the
// LabTrace password to a host of their choosing.
const ENV_ONLY_SETTING = /^(labtrace_|myoperator_)/;
const MYOPERATOR_SECRETS = ["MYOPERATOR_API_KEY", "MYOPERATOR_SECRET_TOKEN", "MYOPERATOR_COMPANY_ID", "MYOPERATOR_PUBLIC_IVR_ID"];
const LABTRACE_DEFAULT_URL = "https://thyrocare.secondmedic.workers.dev";
const LABTRACE_READY = new Set(["report_ready", "delivered"]);
const WORK_ORDER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const ROLES = new Set(["ADMIN", "CALLER", "DOCTOR"]);

// ---------- small crypto helpers (Web Crypto) ----------
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64u(a);
}

async function sha256(text) {
  return b64u(await crypto.subtle.digest("SHA-256", enc.encode(String(text))));
}

function sameText(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// PBKDF2-SHA256; 100,000 rounds is the most Cloudflare Workers allow.
async function hashPassword(password, salt = randomToken(16), rounds = 100000) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: rounds }, key, 256);
  return `pbkdf2$${rounds}$${salt}$${b64u(bits)}`;
}

async function verifyPassword(password, stored) {
  const [kind, rounds, salt, hash] = String(stored || "").split("$");
  if (kind !== "pbkdf2" || !hash || !(Number(rounds) > 0)) return false;
  return sameText(await hashPassword(password, salt, Number(rounds)), stored);
}

// ---------- short-lived records (sessions, sign-in throttling) ----------
const memoryKv = new Map(); // only used when no KV binding exists (local runs)

async function kvGet(env, key) {
  if (env && env.CRTRACKER_DATA) return env.CRTRACKER_DATA.get(key, "json").catch(() => null);
  const hit = memoryKv.get(key);
  return hit && (!hit.until || hit.until > Date.now()) ? hit.value : null;
}

async function kvPut(env, key, value, ttlSeconds) {
  if (ttlSeconds && ttlSeconds > 0) {
    const ttl = Math.max(60, Math.floor(ttlSeconds)); // KV refuses anything under 60 s
    if (env && env.CRTRACKER_DATA) return env.CRTRACKER_DATA.put(key, JSON.stringify(value), { expirationTtl: ttl });
    memoryKv.set(key, { value, until: Date.now() + ttl * 1000 });
  } else {
    if (env && env.CRTRACKER_DATA) return env.CRTRACKER_DATA.put(key, JSON.stringify(value));
    memoryKv.set(key, { value, until: null });
  }
}

async function kvDelete(env, key) {
  if (env && env.CRTRACKER_DATA) return env.CRTRACKER_DATA.delete(key).catch(() => {});
  memoryKv.delete(key);
}

function readCookie(header, name) {
  const m = String(header || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? m[1] : "";
}

function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function sessionSeconds(store) {
  return Math.max(15, Number(store.settings?.session_minutes) || 30) * 60;
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active !== false, myoperator_user_id: u.myoperator_user_id || "" };
}

function nextId(list) {
  return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function recordAudit(store, me, action, entity, entityId) {
  if (!store.audit) store.audit = [];
  store.audit.unshift({
    id: nextId(store.audit),
    at: new Date().toISOString(),
    user_id: me.id,
    user_email: me.email,
    role: me.role,
    action,
    entity,
    entity_id: entityId,
    target: `${entity}-${entityId}`
  });
}

function sanitizeCsvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.length > 0 && ["=", "+", "-", "@", "\t", "\r"].includes(s[0])) return `'${s}`;
  return s;
}

async function currentUser(request, env, store) {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token || token.length < 32) return null;
  const key = `session:${await sha256(token)}`;
  const s = await kvGet(env, key);
  if (!s || !(s.until > Date.now())) return null;
  const user = store.users.find((u) => u.id === s.uid && u.active !== false);
  if (!user) return null;
  // Inactivity timeout that slides, renewed at most once per half-window so KV writes stay low.
  const ttl = sessionSeconds(store);
  if (s.until - Date.now() < (ttl * 1000) / 2) await kvPut(env, key, { uid: user.id, until: Date.now() + ttl * 1000 }, ttl);
  return user;
}

async function signIn(request, env, store) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  // Throttle per address + email, so one office sharing an IP is not locked out by someone else's typos.
  const ipKey = `signin-fail:${await sha256(`${request.headers.get("cf-connecting-ip") || "local"}|${email}`)}`;
  const fails = Number(await kvGet(env, ipKey)) || 0;
  if (fails >= 10) return reply(429, { detail: "Too many failed sign-ins. Wait 15 minutes and try again." });
  let user = null;

  // First administrator comes from the ADMIN_EMAIL / ADMIN_PASSWORD Worker secrets.
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (adminEmail && env.ADMIN_PASSWORD && email === adminEmail && sameText(await sha256(password), await sha256(env.ADMIN_PASSWORD))) {
    user = store.users.find((u) => String(u.email || "").toLowerCase() === adminEmail);
    if (!user) {
      user = { id: nextId(store.users), name: "Administrator", email: adminEmail, role: "ADMIN", active: true };
      store.users.push(user);
      await saveStore(env, store);
    } else if (user.role !== "ADMIN" || user.active === false) {
      user.role = "ADMIN";
      user.active = true;
      await saveStore(env, store);
    }
  } else if (email && password) {
    const u = store.users.find((x) => String(x.email || "").toLowerCase() === email && x.active !== false);
    if (u && u.password_hash && (await verifyPassword(password, u.password_hash))) user = u;
  }

  if (!user) {
    await kvPut(env, ipKey, fails + 1, 15 * 60);
    return reply(401, { detail: "Email or password is incorrect." });
  }
  const token = randomToken();
  const ttl = sessionSeconds(store);
  await kvPut(env, `session:${await sha256(token)}`, { uid: user.id, until: Date.now() + ttl * 1000 }, ttl);
  return reply(200, publicUser(user), sessionCookie(token, 12 * 3600));
}

// Admin-only areas, plus areas a role may read but not change. Callers never see lab findings.
function forbidden(path, method, role) {
  if (role === "ADMIN") {
    if ((method === "POST" || method === "DELETE") && /^\/patients\/\d+\/conditions(\/|$)/.test(path)) return true;
    if (method === "POST" && /^\/clinical-tasks\/\d+\/complete$/.test(path)) return true;
    if (method === "POST" && /^\/followups\/\d+\/journey\/day90-confirm$/.test(path)) return true;
    return false;
  }
  if (/^\/(imports|users|admin|audit|integrations|orders)(\/|$)/.test(path)) {
    if (path === "/audit" && role === "DOCTOR") return false;
    return true;
  }
  if (path === "/relationship/summary") return true;
  if (role === "DOCTOR" && method === "POST" && /^\/rules\/[a-zA-Z0-9_]+\/signoff$/.test(path)) return false;
  if (method !== "GET" && /^\/(settings|rules|doctors)(\/|$)/.test(path)) return true;
  if (role === "CALLER") {
    if (method === "GET" && /^\/patients\/\d+\/(relationship|programs|referrals)$/.test(path)) return false;
    if (/^\/reports\/\d+\/insight(?:\/|$)/.test(path) && method === "GET") return false;
    if (/^\/(settings|rules)(\/|$)/.test(path)) return true;
    if (/^\/followups\/\d+\/(recommendations|compare|journey\/day90-confirm)$/.test(path)) return true;
    if (/^\/(reports|patients|trends|exports\/trends|touchpoints|program-recommendations|medicines|home-visits|family-links|clinical-tasks|monitoring-schedules)(\/|$)/.test(path)) return true;
  }
  return false;
}

function indianMobile(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : "";
}

function istDate(ms = Date.now()) {
  return new Date(ms + 330 * 60000).toISOString().slice(0, 10);
}

// LabTrace dates: a timestamp with a zone is moved to IST; a plain "YYYY-MM-DD hh:mm" is already local (IST).
function labtraceDay(value) {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return "";
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? istDate(t) : "";
  }
  return s.slice(0, 10);
}

// ---------- LabTrace (Thyrocare - SecondMedic OS) ----------
// Signs in as the Master Manager (sees every Manager's work orders) and reads LabTrace's own routes:
//   POST /api/auth/login, GET /api/work-orders, GET /api/reports?workOrderId=, GET /api/thyrocare/reports/:pid/pdf
// Error messages never repeat what LabTrace sent back, since that can carry patient data.
class LabTraceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function labtraceConfigured(env) {
  return Boolean(env.LABTRACE_LOGIN_ID && env.LABTRACE_PASSWORD);
}

async function labtraceSession(env) {
  if (!labtraceConfigured(env)) {
    throw new LabTraceError(503, "LabTrace is not connected yet: the LABTRACE_LOGIN_ID and LABTRACE_PASSWORD secrets are not set on the Worker.");
  }
  const base = String(env.LABTRACE_URL || LABTRACE_DEFAULT_URL).replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login_id: env.LABTRACE_LOGIN_ID, password: env.LABTRACE_PASSWORD }),
      redirect: "manual"
    });
  } catch (_) {
    throw new LabTraceError(502, "Cannot reach LabTrace right now. Try again in a few minutes.");
  }
  if ([400, 401, 403].includes(res.status)) {
    throw new LabTraceError(502, "LabTrace refused the sign-in. Check the LABTRACE_LOGIN_ID and LABTRACE_PASSWORD secrets.");
  }
  if (!res.ok) throw new LabTraceError(502, `LabTrace sign-in failed (HTTP ${res.status}).`);
  const who = await res.json().catch(() => ({}));
  if (who.role !== "master_manager") {
    const roleDesc = who.role ? ` (role: ${who.role})` : "";
    const loginDesc = who.login_id || env.LABTRACE_LOGIN_ID || "unknown";
    throw new LabTraceError(502, `LabTrace signed in as ${loginDesc}${roleDesc}, not a Master Manager. Set LABTRACE_LOGIN_ID to the Master Manager login.`);
  }
  const m = String(res.headers.get("set-cookie") || "").match(/(?:^|[;,]\s*)session=([^;,\s]+)/);
  if (!m) throw new LabTraceError(502, "LabTrace signed in but sent no session.");
  return { base, cookie: `session=${m[1]}` };
}

async function labtraceGet(lt, path) {
  try {
    return await fetch(lt.base + path, { headers: { Cookie: lt.cookie }, redirect: "manual" });
  } catch (_) {
    throw new LabTraceError(502, "Cannot reach LabTrace right now. Try again in a few minutes.");
  }
}

async function labtraceJson(lt, path, what) {
  const res = await labtraceGet(lt, path);
  if (res.status === 404) throw new LabTraceError(404, `${what} not found in LabTrace.`);
  if (!res.ok) throw new LabTraceError(502, `LabTrace could not return ${what.toLowerCase()} (HTTP ${res.status}).`);
  try {
    return await res.json();
  } catch (_) {
    throw new LabTraceError(502, `LabTrace sent an unreadable answer for ${what.toLowerCase()}.`);
  }
}

function asPdf(bytes) {
  return bytes && bytes.byteLength > 4 && bytes.byteLength <= MAX_PDF_BYTES && String.fromCharCode(...bytes.slice(0, 4)) === "%PDF" ? bytes : null;
}

async function labtraceReportPdf(env, workOrderId, thyrocarePatientId, existingSession) {
  if (!WORK_ORDER_ID.test(String(workOrderId || ""))) throw new LabTraceError(404, "This report did not come from LabTrace.");
  const lt = existingSession || await labtraceSession(env);
  const list = await labtraceJson(lt, `/api/reports?workOrderId=${encodeURIComponent(workOrderId)}`, "Report list");
  const reports = (Array.isArray(list) ? list : []).sort((a, b) => String(b.uploaded_at || "").localeCompare(String(a.uploaded_at || "")));
  for (const rep of reports) {
    for (const link of [rep.pdf_url, rep.file_url]) {
      const s = String(link || "");
      let bytes = null;
      if (s.startsWith("data:application/pdf;base64,")) {
        try {
          bytes = Uint8Array.from(atob(s.slice(s.indexOf(",") + 1)), (c) => c.charCodeAt(0));
        } catch (_) {}
      } else if (s.startsWith("/api/")) {
        // LabTrace's own route only; never follow links to other hosts with our session.
        const res = await labtraceGet(lt, s);
        if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
      }
      const pdf = asPdf(bytes);
      if (pdf) return pdf;
    }
  }
  const pid = String(thyrocarePatientId || "").trim();
  if (pid) {
    const res = await labtraceGet(lt, `/api/thyrocare/reports/${encodeURIComponent(pid)}/pdf`);
    if (res.ok) {
      const pdf = asPdf(new Uint8Array(await res.arrayBuffer()));
      if (pdf) return pdf;
    } else if (res.status !== 404) {
      throw new LabTraceError(502, `LabTrace could not download the Thyrocare report (HTTP ${res.status}).`);
    }
  }
  throw new LabTraceError(404, "The report PDF is not in LabTrace yet.");
}

const EXTRACT_SYSTEM_PROMPT = `You copy lab test results out of the text of a pathology report. Identifying details were removed.
Return JSON: {"collected_on": ISO date or null, "reported_on": ISO date or null, "parameters": [{"name", "value", "unit", "ref_range"}]}.
- One entry per measured test, exactly as printed: do not convert units, round, guess, or add tests that are not in the text.
- value is the printed result (a number, or text such as "Negative"); ref_range is the printed reference range, or "".
- Skip headings, method/technology names, comments and interpretation notes.`;

async function extractText(env, pdfBytes) {
  if (!env?.AI || typeof env.AI.toMarkdown !== "function") {
    throw new LabTraceError(503, "PDF text conversion is not available.");
  }
  let result;
  try {
    result = await env.AI.toMarkdown(
      {
        name: "report.pdf",
        blob: new Blob([pdfBytes], { type: "application/pdf" })
      },
      {
        conversionOptions: {
          output: { format: "text" }
        }
      }
    );
  } catch (_) {
    throw new LabTraceError(502, "Could not read this PDF.");
  }

  if (result?.format === "error") {
    throw new LabTraceError(502, "Could not read this PDF.");
  }
  const text = String(
    result?.text ??
    result?.data ??
    result?.result ??
    result?.markdown ??
    ""
  ).trim();
  if (text.length < 20) {
    throw new ExtractError("The PDF has no readable text (it may be a scanned image)");
  }
  return text;
}

function normalizeExtractedParam(raw, id, aliases) {
  const name = String(raw?.name ?? raw?.param_name_raw ?? "").trim().slice(0, 120);
  const valueText = String(
    raw?.value_text ??
    raw?.value ??
    raw?.value_num ??
    ""
  ).trim().slice(0, 60);
  const [parsedNum, parsedText] = parseValue(
    raw?.value_num !== undefined && raw?.value_num !== null
      ? raw.value_num
      : (raw?.value ?? valueText)
  );
  const unit = normalizeUnit(String(raw?.unit ?? "").trim());
  const refText = String(raw?.ref_range ?? raw?.ref_text ?? "").trim().slice(0, 60);
  const range = parseRange(refText);
  return {
    id,
    param_code: canonicalCode(name, aliases),
    param_name_raw: name,
    value_num: parsedNum,
    value_text: parsedText || valueText,
    unit,
    ref_low: range ? range[0] : (raw?.ref_low ?? null),
    ref_high: range ? range[1] : (raw?.ref_high ?? null),
    ref_text: refText,
    system_flag: raw?.system_flag ?? "",
    severity: raw?.severity ?? "",
    deviation_pct: raw?.deviation_pct ?? null,
    ref_source: raw?.ref_source ?? "",
    lab_flag: String(raw?.lab_flag ?? raw?.flag ?? "").slice(0, 20)
  };
}

async function geminiExtract(env, report, sourceText) {
  if (!env?.GOOGLE_API_KEY) return null;
  const safeText = redactPII(sourceText, {
    name: report?.patient_name,
    mobile: report?.mobile
  });
  const responseSchema = {
    type: "object",
    properties: {
      collected_on: { type: ["string", "null"] },
      reported_on: { type: ["string", "null"] },
      parameters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: ["string", "number"] },
            unit: { type: "string" },
            ref_range: { type: "string" }
          },
          required: ["name", "value", "unit", "ref_range"]
        }
      }
    },
    required: ["collected_on", "reported_on", "parameters"]
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: EXTRACT_SYSTEM_PROMPT }]
          },
          contents: [{
            role: "user",
            parts: [{ text: safeText }]
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema
          }
        })
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return null;
    const parsed = JSON.parse(rawText);
    return parsed && Array.isArray(parsed.parameters) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function normalizedTestName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizedValueText(param) {
  return String(param?.value_text ?? param?.value ?? param?.value_num ?? "")
    .trim()
    .replace(/\s+/g, "");
}

function crossCheckParams(ruleParams, geminiParams, sourceText) {
  const reasons = [];
  const mismatchedNames = new Set();

  const ruleMap = new Map();
  for (const p of ruleParams) {
    const name = normalizedTestName(p.param_name_raw);
    if (name) ruleMap.set(name, p);
  }

  const gemMap = new Map();
  for (const p of geminiParams) {
    const name = normalizedTestName(p.param_name_raw || p.name);
    if (name) gemMap.set(name, p);
  }

  for (const [name, rp] of ruleMap) {
    const gp = gemMap.get(name);
    if (!gp) {
      mismatchedNames.add(rp.param_name_raw || name);
      continue;
    }

    const ruleValue = normalizedValueText(rp);
    const gemValue = normalizedValueText(gp);
    const ruleUnit = normalizeUnit(rp.unit || "").toLowerCase();
    const gemUnit = normalizeUnit(gp.unit || "").toLowerCase();
    if (!ruleValue || ruleValue !== gemValue || (ruleUnit && gemUnit && ruleUnit !== gemUnit)) {
      mismatchedNames.add(rp.param_name_raw || name);
    }
  }

  for (const [name, gp] of gemMap) {
    if (!ruleMap.has(name)) {
      mismatchedNames.add(gp.param_name_raw || gp.name || name);
    }
  }

  if (mismatchedNames.size > 0) {
    const names = [...mismatchedNames].slice(0, 20).join(", ");
    reasons.push(
      `${mismatchedNames.size} test(s) read differently by the two readers: ${names}`
    );
  }

  if (sourceText) {
    for (const p of ruleParams) {
      const textVal = normalizedValueText(p);
      const numVal = p.value_num === null || p.value_num === undefined ? "" : String(p.value_num);
      const noCommas = textVal.replace(/,/g, "");
      const appears =
        (textVal && sourceText.includes(textVal)) ||
        (numVal && sourceText.includes(numVal)) ||
        (noCommas && sourceText.includes(noCommas));
      if (p.value_num !== null && p.value_num !== undefined && !appears) {
        reasons.push("One or more extracted values could not be verified in the source text.");
        break;
      }
    }
  }

  return {
    needs_review: reasons.length > 0,
    review_reasons: reasons
  };
}

async function extractAndClassifyReport(env, report, text, store, suppliedParams) {
  const rules = resolveRules(store);
  let params;

  if (Array.isArray(suppliedParams) && suppliedParams.length > 0) {
    params = suppliedParams.map((p, index) =>
      normalizeExtractedParam(p, Number(p.id) || index + 1, rules.aliases)
    );
  } else {
    params = text ? extractParameters(text, rules.aliases) : [];
  }

  let secondaryReview = null;
  if (text) {
    const gemini = await geminiExtract(env, report, text);
    if (gemini?.parameters) {
      const geminiParams = gemini.parameters.map((p, index) =>
        normalizeExtractedParam(p, index + 1, rules.aliases)
      );
      secondaryReview = crossCheckParams(params, geminiParams, text);
    }
  }

  for (const p of params) {
    flagParameter(p, rules, report.gender || "");
  }
  analyse(report, params, rules);

  const minConfidence = Number(store?.settings?.extraction_min_confidence_pct) || 80;
  report.min_confidence = minConfidence;
  const confidence = calculateConfidence(report, params);

  const reviewReasons = [...confidence.reasons];
  if (secondaryReview?.review_reasons?.length) {
    reviewReasons.push(...secondaryReview.review_reasons);
  }
  if (params.length === 0) {
    reviewReasons.push("Test values have not been read from the PDF yet: open the LabTrace PDF to review.");
  }

  return {
    parameters: params,
    confidence: confidence.score,
    classification: report.classification || "NORMAL",
    abnormal_count: countAbnormalParameters(params),
    needs_review: confidence.needs_review || Boolean(secondaryReview?.needs_review) || params.length === 0,
    review_reasons: reviewReasons
  };
}

// Pulls ready LabTrace work orders whose sample was collected in [start, end] (IST dates, inclusive).
// Stores only what LabTrace actually sent: nothing is guessed. Values inside the PDF are not read here,
// so every pulled report waits for review.
async function pullFromLabTrace(env, store, range, actorId) {
  const days = Math.min(90, Math.max(1, Number(store?.settings?.pull_lookback_days) || 7));
  const defaultStart = istDate(Date.now() - days * 86400000);
  const defaultEnd = istDate();

  const startRaw = range?.start;
  const endRaw = range?.end;
  const today = istDate();

  if (startRaw !== undefined || endRaw !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startRaw || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endRaw || ""))) {
      throw new LabTraceError(400, "Invalid date format. Use YYYY-MM-DD.");
    }
  }

  const start = /^\d{4}-\d{2}-\d{2}$/.test(startRaw || "") ? startRaw : defaultStart;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(endRaw || "") ? endRaw : defaultEnd;

  if (end < start) throw new LabTraceError(400, "The end date is before the start date.");
  if (end > today) throw new LabTraceError(400, "The end date cannot be in the future.");
  const diffDays = Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
  if (diffDays > 90) throw new LabTraceError(400, "Date range cannot exceed 90 days.");

  const lt = await labtraceSession(env);
  const rows = await labtraceJson(lt, "/api/work-orders", "Work orders");

  let workOrders = [];
  if (Array.isArray(rows)) {
    workOrders = rows;
  } else if (rows && typeof rows === "object") {
    workOrders = rows.data || rows.work_orders || rows.items || rows.results || [];
    if (!Array.isArray(workOrders)) {
      throw new LabTraceError(502, "LabTrace sent work orders in an unexpected format.");
    }
  } else {
    throw new LabTraceError(502, "LabTrace sent work orders in an unexpected format.");
  }

  const fetched = workOrders.length;
  let not_ready = 0;
  let out_of_range = 0;
  let no_date = 0;
  const status_counts = {};
  const ready = [];

  for (const wo of workOrders) {
    const st = String(wo.status || "").trim().toLowerCase();
    if (st) status_counts[st] = (status_counts[st] || 0) + 1;

    const isReady = LABTRACE_READY.has(st) || Boolean(wo.report_id);
    if (!isReady) {
      not_ready++;
      continue;
    }

    const day = labtraceDay(wo.sample_collection_datetime || wo.created_at);
    if (!day) {
      no_date++;
      continue;
    }

    if (day < start || day > end) {
      out_of_range++;
      continue;
    }

    ready.push(wo);
  }

  const seen = new Set(store.orders.map((o) => String(o.labtrace_work_order_id || "")).filter(Boolean));
  const batchId = nextId(store.batches);
  const now = new Date().toISOString();
  const failures = [];
  const batchPatients = [];

  for (const wo of ready) {
    const woId = String(wo.id || "");
    if (!WORK_ORDER_ID.test(woId)) {
      failures.push({ order_id: String(wo.order_number || "?").slice(0, 64), reason: "LabTrace work order has an unusable id" });
      continue;
    }
    if (seen.has(woId)) continue;
    seen.add(woId);

    const orderNo = String(wo.order_number || woId).slice(0, 64);
    const name = String(wo.patient_name || "").trim().slice(0, 120);
    const mobile = indianMobile(wo.patient_phone);
    const age = wo.patient_age_unit === "M" ? 0 : Number.isFinite(Number(wo.patient_age)) && wo.patient_age !== null && wo.patient_age !== "" ? Number(wo.patient_age) : null;
    const gender = String(wo.patient_gender || "").slice(0, 10);

    let patient = mobile && name ? store.patients.find((p) => p.mobile === mobile && String(p.name || "").toLowerCase() === name.toLowerCase()) : null;
    if (!patient) {
      patient = { id: nextId(store.patients), name: name || "Name missing in LabTrace", gender, age, mobile, household_tag: "", language: "en", do_not_call: false };
      store.patients.unshift(patient);
    }

    const order = {
      id: nextId(store.orders), order_id: orderNo, labtrace_work_order_id: woId, batch_id: batchId,
      status: "FETCHED", error: "", attempts: 0, report_kind: "labtrace", updated_at: now
    };
    const report = {
      id: nextId(store.reports), order_id: orderNo, order_pk: order.id, labtrace_work_order_id: woId,
      thyrocare_patient_id: String(wo.thyrocare_patient_id || "").slice(0, 64), status: "FETCHED",
      patient_id: patient.id, patient_name: patient.name, mobile, age, gender,
      collected_on: wo.sample_collection_datetime || null, reported_on: null,
      lab: "LabTrace (Thyrocare)", source: "labtrace", confidence: null, needs_review: false, review_reasons: [],
      classification: null, abnormal_count: null, extract_status: "PENDING", extract_error: "", extracted_at: null,
      extract_attempts: 0
    };
    store.orders.unshift(order);
    store.reports.unshift(report);
    store.followups.unshift({
      id: nextId(store.followups), order_id: order.id, report_id: report.id, patient_id: patient.id, patient_name: patient.name,
      mobile, priority: "ROUTINE", stage: "QUEUED", retest_tier: null, retest_score: null, assigned_doctor_id: null,
      due_on: now.slice(0, 10), report_age_days: 0, buckets: [], deficits_summary: "", created_at: now
    });
    batchPatients.push({ order_id: orderNo, patient_id: patient.id, patient_name: patient.name, mobile, report_id: report.id, classification: null, abnormal_count: null });
  }

  const added = batchPatients.length;
  const already = ready.length - added - failures.length;

  let message = "";
  if (ready.length === 0) {
    const statusStr = Object.entries(status_counts).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
    const parts = [`LabTrace returned ${fetched} work order${fetched === 1 ? "" : "s"}`];
    if (not_ready) parts.push(`${not_ready} not ready (statuses: ${statusStr})`);
    if (out_of_range) parts.push(`${out_of_range} ready but collected outside ${start} – ${end}`);
    if (no_date) parts.push(`${no_date} with no collection date`);
    message = parts.length > 1 ? `${parts[0]}: ${parts.slice(1).join("; ")}.` : `${parts[0]} (none ready).`;
    if (fetched === 0) message = "LabTrace has no ready reports for these dates.";
  } else {
    message = `${added} new report${added === 1 ? "" : "s"} pulled from LabTrace${already ? `, ${already} already here` : ""}${failures.length ? `, ${failures.length} skipped` : ""}.`;
  }

  const batch = {
    id: batchId, source: "labtrace", file_name: `${start}..${end}`,
    total: ready.length, new: added, duplicate: already, failed: failures.length, failures,
    patients: batchPatients, started_by: actorId, created_at: now, message
  };
  store.batches.unshift(batch);
  if (added > 0) {
    store.dashboard.orders.imported = (store.dashboard.orders.imported || 0) + added;
    store.dashboard.orders.reports_ready = (store.dashboard.orders.reports_ready || 0) + added;
    store.dashboard.needs_attention.needs_review = (store.dashboard.needs_attention.needs_review || 0) + added;
  }
  store.labtrace_last_pull = { at: now, ok: true, fetched, not_ready, out_of_range, status_counts, message };
  await saveStore(env, store);
  return batch;
}

// ---------- MyOperator click-to-call ----------
// MyOperator first rings the caller's own MyOperator app/phone (their MyOperator User ID); when they answer,
// it dials the patient. Secrets never leave the Worker; MyOperator's reason for a refusal is shown with any secret
// value cut out, since its answers can repeat what we sent.
// MyOperator's own words for a refusal, trimmed, with every secret value we hold removed.
function providerReason(data, env) {
  const raw = data && (data.details || data.message || data.error || data.msg);
  let text = (typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "").replace(/\s+/g, " ").trim();
  for (const k of MYOPERATOR_SECRETS) {
    const v = String(env[k] || "");
    if (v.length >= 4) text = text.split(v).join("[hidden]");
  }
  return text.slice(0, 200);
}

async function placeCall(env, store, me, { mobile, name, patient, ref }) {
  const number = indianMobile(mobile);
  if (!number) return [400, { detail: "There is no valid Indian mobile number on file for this patient, so no call was placed." }];
  if (patient && patient.do_not_call) return [409, { detail: "This patient is marked Do Not Call." }];
  const missing = MYOPERATOR_SECRETS.filter((k) => !env[k]);
  if (missing.length) return [503, { detail: `MyOperator calling is not set up yet. Missing Worker secrets: ${missing.join(", ")}.` }];
  const userId = String(me.myoperator_user_id || env.MYOPERATOR_USER_ID || "").trim();
  if (!userId) return [409, { detail: "Your account has no MyOperator User ID yet. An admin can add it on the Users page." }];

  const referenceId = `crt-${ref}-${Date.now()}`;
  let res;
  try {
    res = await fetch(env.MYOPERATOR_API_URL || "https://obd-api.myoperator.co/obd-api-v1", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.MYOPERATOR_API_KEY },
      body: JSON.stringify({
        company_id: env.MYOPERATOR_COMPANY_ID,
        secret_token: env.MYOPERATOR_SECRET_TOKEN,
        type: "1",
        user_id: userId,
        number: `+91${number}`,
        public_ivr_id: String(env.MYOPERATOR_PUBLIC_IVR_ID).trim(),
        reference_id: referenceId
      })
    });
  } catch (_) {
    return [502, { detail: "Cannot reach MyOperator right now. Try again in a minute." }];
  }
  const data = await res.json().catch(() => ({}));
  const status = String((data && data.status) || "").toLowerCase();
  if (!res.ok || ["error", "fail", "failed", "failure"].includes(status)) {
    const hint = res.status === 403
      ? " Check the MyOperator API key and secret token."
      : res.status === 400 || res.status === 404
      ? " Check the public IVR ID secret (MYOPERATOR_PUBLIC_IVR_ID) and the caller's MyOperator User ID."
      : "";
    const said = providerReason(data, env);
    return [502, { detail: `MyOperator did not place the call (HTTP ${res.status}).${said ? ` MyOperator says: "${said}".` : ""}${hint}` }];
  }
  store.audit.unshift({ at: new Date().toISOString(), user_id: me.id, action: "CALL_PLACED", target: ref, provider: "myoperator", reference_id: referenceId });
  store.dashboard.calls.made = (store.dashboard.calls.made || 0) + 1;
  return [200, {
    success: true, provider: "myoperator", status: "initiated",
    call_id: String((data && (data.unique_id || data.call_id || data.id)) || referenceId).slice(0, 80),
    reference_id: referenceId, customer_name: name,
    message: `MyOperator is ringing your phone now. Answer it and you will be connected to ${name || "the patient"}.`
  }];
}

function getDefaultStore() {
  const batches = [];
  const orders = [];
  const dashboard = {
    from: "",
    to: "",
    orders: { imported: 0, by_status: {}, reports_ready: 0, failed: 0 },
    results: { normal: 0, abnormal: 0 },
    patients_per_bucket: {},
    followups_due: { today: 0, this_week: 0, overdue: 0, parked: 0 },
    calls: { made: 0, by_outcome: {}, bookings: 0, consent_rate_pct: 0, doctor_calls_done: 0 },
    retests: { recommended: 0, ordered: 0 },
    funnel: [],
    needs_attention: { failed_fetch: 0, failed_extract: 0, needs_review: 0, pending_identity: 0 },
    doctors: []
  };

  const users = [];
  const doctors = [];
  const notifications = { unread: 0, items: [] };
  const settings = {
    caller_can_view_results: false,
    company_name: "SecondMedic",
    default_language: "en",
    pull_time_ist: "07:00",
    fetch_max_attempts: 3,
    extraction_min_confidence_pct: 80,
    identity_name_similarity_pct: 85,
    max_call_attempts: 3,
    attempt_window_days: 7,
    default_interval_days: 90,
    callcard_lead_days: 14,
    timeout_escalation_hours: 4,
    timeout_routine_hours: 24,
    pilot_mode: false,
    session_minutes: 30,
    yearly_reengagement: false,
    caller_script_requires_approval: false,
    pull_every_minutes: 20,
    pull_lookback_days: 7,
    care_services: DEFAULT_CARE_SERVICES,
    relationship_thresholds: DEFAULT_RELATIONSHIP_THRESHOLDS
  };
  const followups = [];
  const reports = [];
  const patients = [];
  const identityReviews = [];
  const audit = [];

  return {
    [PURGE_KEY]: true,
    batches,
    orders,
    dashboard,
    users,
    doctors,
    notifications,
    settings,
    followups,
    reports,
    patients,
    identityReviews,
    audit,
    comments: {},
    workflows: {},
    care_touchpoints: [],
    health_profiles: {},
    program_recommendations: [],
    patient_medications: [],
    refill_schedules: [],
    referrals: [],
    home_readings: [],
    home_visits: [],
    monitoring_schedules: [],
    clinical_tasks: [],
    family_links: [],
    family_consents: []
  };
}

let memoryStore = null;

async function getStore(env) {
  if (env && env.CRTRACKER_DATA) {
    try {
      const data = await env.CRTRACKER_DATA.get(STATE_KEY, "json");
      if (data) {
        if (!data[PURGE_KEY]) {
          const keptReports = (data.reports || []).filter((r) => r && r.source === "labtrace");
          const keptReportIds = new Set(keptReports.map((r) => r.id));
          const keptPatientIds = new Set(keptReports.map((r) => r.patient_id).filter(Boolean));

          data.batches = (data.batches || []).filter((b) => b && b.source === "labtrace");
          data.orders = (data.orders || []).filter((o) => o && o.labtrace_work_order_id);
          data.reports = keptReports;
          data.followups = (data.followups || []).filter((f) => f && keptReportIds.has(f.report_id));
          const keptFollowupIds = new Set(data.followups.map((f) => String(f.id)));

          data.patients = (data.patients || []).filter((p) => p && keptPatientIds.has(p.id));

          const workflows = {};
          for (const [k, v] of Object.entries(data.workflows || {})) {
            if (keptFollowupIds.has(String(k))) workflows[k] = v;
          }
          data.workflows = workflows;

          const comments = {};
          for (const [k, v] of Object.entries(data.comments || {})) {
            if (keptFollowupIds.has(String(k))) comments[k] = v;
          }
          data.comments = comments;

          data.users = (data.users || []).filter((u) => !(u && u.email === "admin@secondmedic.com" && !u.password_hash));
          delete data.me;

          data[PURGE_KEY] = true;
          await saveStore(env, data);
        }
        // Older versions kept LabTrace and MyOperator credentials in Settings, readable by anyone.
        // They now live only in Worker secrets, so drop any stored copy for good.
        const leaked = Object.keys(data.settings || {}).filter((k) => ENV_ONLY_SETTING.test(k));
        if (leaked.length) {
          leaked.forEach((k) => delete data.settings[k]);
          await saveStore(env, data);
        }
        if (data.settings && data.settings.pull_every_minutes === undefined) data.settings.pull_every_minutes = 20;
        if (data.settings && data.settings.pull_lookback_days === undefined) data.settings.pull_lookback_days = 7;
        if (data.settings && data.settings.care_services === undefined) data.settings.care_services = DEFAULT_CARE_SERVICES;
        if (data.settings && data.settings.relationship_thresholds === undefined) data.settings.relationship_thresholds = DEFAULT_RELATIONSHIP_THRESHOLDS;
        if (!data.care_touchpoints) data.care_touchpoints = [];
        if (!data.health_profiles) data.health_profiles = {};
        if (!data.program_recommendations) data.program_recommendations = [];
        if (!data.patient_medications) data.patient_medications = [];
        if (!data.refill_schedules) data.refill_schedules = [];
        if (!data.referrals) data.referrals = [];
        if (!data.home_readings) data.home_readings = [];
        if (!data.home_visits) data.home_visits = [];
        if (!data.monitoring_schedules) data.monitoring_schedules = [];
        if (!data.clinical_tasks) data.clinical_tasks = [];
        if (!data.family_links) data.family_links = [];
        if (!data.family_consents) data.family_consents = [];
        if (!data.followups) data.followups = [];
        for (const r of data.reports || []) {
          if (r.status === "READY" && !data.followups.some((f) => f.report_id === r.id)) {
            data.followups.push({
              id: nextId(data.followups),
              patient_id: r.patient_id,
              patient_name: r.patient_name || "Patient",
              mobile: r.mobile || "",
              report_id: r.id,
              due_on: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
              stage: "QUEUED",
              priority: "PRIORITY",
              attempts: 0,
              report_age_days: 0,
              buckets: ["OTHER"],
              retest_score: 50,
              retest_tier: "MEDIUM",
              assigned_doctor_id: null,
              suppressed_reason: "",
              score_breakdown: [],
              buckets_detail: []
            });
          }
        }
        return data;
      }
    } catch (_) {}
  }
  if (!memoryStore) {
    memoryStore = getDefaultStore();
    if (env && env.CRTRACKER_DATA) {
      try {
        await env.CRTRACKER_DATA.put(STATE_KEY, JSON.stringify(memoryStore));
      } catch (_) {}
    }
  }
  return memoryStore;
}

async function saveStore(env, store) {
  memoryStore = store;
  if (env && env.CRTRACKER_DATA) {
    try {
      await env.CRTRACKER_DATA.put(STATE_KEY, JSON.stringify(store));
    } catch (_) {}
  }
}

function reply(status, body, cookie) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Environment": "production"
  };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(JSON.stringify(body), { status, headers });
}

async function handleApiRequest(request, url, env) {
  const path = url.pathname.replace(/^\/api\/v1/, "").replace(/\/$/, "");
  const method = request.method.toUpperCase();

  if (url.pathname === "/api/health") {
    return reply(200, { ok: true, status: "healthy", environment: "production" });
  }

  // Cookie-authenticated API: refuse cross-site writes (the browser always sends Origin on POST/PUT/PATCH/DELETE).
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return reply(403, { detail: "Cross-site request refused." });
  }

  const store = await getStore(env);

  if (path === "/auth/login" && method === "POST") return signIn(request, env, store);

  if (path === "/auth/logout") {
    const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
    if (token) await kvDelete(env, `session:${await sha256(token)}`);
    return reply(200, { ok: true }, sessionCookie("", 0));
  }

  const user = await currentUser(request, env, store);
  if (!user) return reply(401, { detail: "Please sign in." }, sessionCookie("", 0));
  const me = publicUser(user);
  if (forbidden(path, method, me.role)) return reply(403, { detail: "Your role cannot open this." });

  if (path === "/auth/me") {
    return reply(200, me);
  }

  if (path === "/integrations/status" && method === "GET") {
    const missing = MYOPERATOR_SECRETS.filter((k) => !env[k]);
    const configured = labtraceConfigured(env);
    const lastPull = store.labtrace_last_pull || null;
    const connected = configured && Boolean(lastPull && lastPull.ok);
    let reason = "";
    if (!configured) {
      reason = "Secrets LABTRACE_LOGIN_ID and LABTRACE_PASSWORD are not set on the Worker.";
    } else if (!lastPull) {
      reason = "No sign-in attempted yet. Run 'Pull from LabTrace' on Import orders to connect.";
    } else if (!lastPull.ok) {
      reason = lastPull.message || "Last sign-in failed.";
    }
    return reply(200, {
      labtrace: {
        connected,
        configured,
        reason,
        login_id: env.LABTRACE_LOGIN_ID ? String(env.LABTRACE_LOGIN_ID) : "",
        url: String(env.LABTRACE_URL || LABTRACE_DEFAULT_URL),
        last_pull: lastPull
      },
      myoperator: { connected: missing.length === 0, missing, default_user_id: Boolean(env.MYOPERATOR_USER_ID) },
      admin_login: Boolean(env.ADMIN_EMAIL && env.ADMIN_PASSWORD)
    });
  }

  // --- IMPORTS ---
  if (path === "/imports" && method === "GET") {
    const enriched = store.batches.map((b) => {
      const pat = b.patients?.[0];
      const ord = store.orders.find((o) => o.batch_id === b.id);
      const rep = store.reports.find((r) => r.order_id === ord?.order_id || r.order_pk === ord?.id);
      const fu = store.followups.find((f) => f.patient_id === pat?.id);

      let callStatus = "Call pending";
      if (fu?.stage === "CALLED" || fu?.stage === "CALL_INITIATED" || fu?.stage === "OUTBOUND_CALL") callStatus = "Call initiated";
      else if (fu?.stage === "CALL_LATER" || fu?.stage === "NOT_REACHABLE") callStatus = "Retry calling";
      else if (fu?.stage === "CONSENT_GIVEN" || fu?.stage === "BOOKED") callStatus = "Followup pending";
      else if (fu?.stage === "DOCTOR_DONE") callStatus = "Completed";

      const sourceLabel = b.source === "labtrace" ? "LabTrace App" : "Manual";
      const labtraceId = pat?.order_id || ord?.order_id || "";
      const patientName = pat?.patient_name || pat?.name || (ord ? `Order ${ord.order_id}` : `Batch #${b.id}`);
      const mobile = pat?.mobile || ord?.mobile || rep?.mobile || "";

      return {
        ...b,
        source_label: sourceLabel,
        patient_name: patientName,
        mobile: mobile,
        labtrace_id: labtraceId,
        report_id: pat?.report_id || rep?.id || null,
        status: b.status || callStatus
      };
    });
    return reply(200, enriched);
  }

  if (path === "/imports/manual" && method === "POST") {
    let text = "";
    try {
      const body = await request.json();
      text = body.text || "";
    } catch (_) {}
    const ids = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
    const existingIds = new Set(store.orders.map((o) => o.order_id));

    const newBatch = {
      id: nextId(store.batches),
      source: "manual",
      file_name: "",
      total: ids.length,
      new: 0,
      duplicate: 0,
      failed: 0,
      failures: [],
      started_by: me.id,
      created_at: new Date().toISOString()
    };

    ids.forEach((oid) => {
      if (!idPattern.test(oid)) {
        newBatch.failed += 1;
        newBatch.failures.push({ order_id: oid, reason: "Invalid ID format" });
        return;
      }
      if (existingIds.has(oid)) {
        newBatch.duplicate += 1;
        return;
      }
      existingIds.add(oid);
      newBatch.new += 1;
      store.orders.unshift({
        id: nextId(store.orders),
        order_id: oid,
        batch_id: newBatch.id,
        status: "WAITING_FOR_LAB",
        error: "",
        attempts: 0,
        updated_at: new Date().toISOString()
      });
    });

    store.batches.unshift(newBatch);
    await saveStore(env, store);
    return reply(201, newBatch);
  }

  if (path === "/imports/pull" && method === "POST") {
    const range = await request.json().catch(() => ({}));
    try {
      const batch = await pullFromLabTrace(env, store, range, me.id);
      return reply(batch.new ? 201 : 200, batch);
    } catch (err) {
      const message = err instanceof LabTraceError ? err.message : "Something went wrong while pulling from LabTrace.";
      store.labtrace_last_pull = { at: new Date().toISOString(), ok: false, message };
      await saveStore(env, store);
      return reply(err instanceof LabTraceError ? err.status : 502, { detail: message });
    }
  }

  const batchMatch = path.match(/^\/imports\/(\d+)$/);
  if (batchMatch && method === "GET") {
    const bid = parseInt(batchMatch[1], 10);
    const b = store.batches.find((item) => item.id === bid) || {
      id: bid,
      source: "manual",
      file_name: "",
      total: 0,
      new: 0,
      duplicate: 0,
      failed: 0,
      failures: [],
      started_by: 1,
      created_at: new Date().toISOString()
    };
    return reply(200, { ...b, order_status: { READY: b.new || 0 } });
  }

  if (batchMatch && method === "DELETE") {
    if (me.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to delete entries" });
    const bid = parseInt(batchMatch[1], 10);
    store.batches = store.batches.filter((b) => b.id !== bid);
    store.orders = store.orders.filter((o) => o.batch_id !== bid);
    await saveStore(env, store);
    return reply(200, { ok: true, deleted: bid });
  }

  // --- ORDERS ---
  if (path === "/orders" && method === "GET") {
    const statusParam = url.searchParams.get("status_");
    const batchParam = url.searchParams.get("batch_id");
    let res = store.orders;
    if (statusParam) res = res.filter((o) => o.status === statusParam);
    if (batchParam) res = res.filter((o) => String(o.batch_id) === String(batchParam));
    return reply(200, res);
  }

  const orderDelMatch = path.match(/^\/orders\/(\d+)$/);
  if (orderDelMatch && method === "DELETE") {
    if (me.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to delete entries" });
    const oid = parseInt(orderDelMatch[1], 10);
    store.orders = store.orders.filter((o) => o.id !== oid);
    await saveStore(env, store);
    return reply(200, { ok: true, deleted: oid });
  }

  const retryMatch = path.match(/^\/orders\/(\d+)\/retry$/);
  if (retryMatch && method === "POST") {
    const oid = parseInt(retryMatch[1], 10);
    const o = store.orders.find((item) => item.id === oid);
    if (o) {
      o.status = "READY";
      o.error = "";
      o.updated_at = new Date().toISOString();
      await saveStore(env, store);
    }
    return reply(200, { ok: true });
  }

  // --- DASHBOARD ---
  if (path === "/dashboard" && method === "GET") {
    const fromD = url.searchParams.get("from") || "";
    const toD = url.searchParams.get("to") || "";
    const inWin = (iso) => {
      if (!fromD && !toD) return true;
      const d = String(iso || "").slice(0, 10);
      if (!d) return true;
      return (!fromD || d >= fromD) && (!toD || d <= toD);
    };
    const orders = store.orders || [];
    const reports = store.reports || [];
    const audit = store.audit || [];
    const progRules = store.rules?.care_programs?.data || store.rules?.care_programs || DEFAULT_CARE_PROGRAMS;
    const progLabels = Object.fromEntries(progRules.map((p) => [p.code, p.clinical_label || p.code]));
    const comboRules = store.rules?.recommendation_combinations?.data || store.rules?.recommendation_combinations || DEFAULT_RECOMMENDATION_COMBINATIONS;
    const comboLabels = {};
    for (const cDef of Object.values(comboRules)) {
      for (const s of Object.values(cDef || {})) if (s?.target && s?.label) comboLabels[s.target] = s.label;
    }
    const recsInWin = (store.program_recommendations || []).filter((r) => inWin(r.created_at));
    const progMap = {};
    for (const r of recsInWin) {
      const e = progMap[r.program_code] || { code: r.program_code, clinical_label: progLabels[r.program_code] || comboLabels[r.program_code] || r.program_code, suggested: 0, accepted: 0, declined: 0 };
      if (r.status === "SUGGESTED") e.suggested += 1;
      else if (r.status === "ACCEPTED" || r.status === "ENROLLED") e.accepted += 1;
      else if (r.status === "DECLINED") e.declined += 1;
      progMap[r.program_code] = e;
    }
    const fRules = store.rules?.diagnostic_findings?.data || store.rules?.diagnostic_findings || DEFAULT_DIAGNOSTIC_FINDINGS;
    const fusInWin = (store.followups || []).filter((f) => inWin(f.created_at || f.due_on));
    const byFid = {};
    for (const r of recsInWin) {
      if (r.followup_id) {
        if (!byFid[r.followup_id]) byFid[r.followup_id] = {};
        byFid[r.followup_id][r.program_code] = r.status;
      }
    }
    const findingFunnel = fRules.map((fMeta) => {
      const fc = fMeta.code;
      const cDef = comboRules[fc] || {};
      const matching = fusInWin.filter((f) => (f.finding_codes || []).includes(fc));
      const total = matching.length;
      const pct = (slot) => {
        const t = cDef[slot]?.target;
        if (!t || !total) return 0;
        const acc = matching.filter((f) => ["ACCEPTED", "ENROLLED"].includes(byFid[f.id]?.[t])).length;
        return Math.round((100 * acc) / total);
      };
      return { finding_code: fc, label: fMeta.label || fc, patients: total, primary_pct: pct("primary"), secondary_pct: pct("secondary"), third_pct: pct("third") };
    });
    const urgent24h = (store.followups || []).filter((f) => !f.suppressed_reason && !DONE_STAGES.has(f.stage) && f.protocol_tier === "URGENT").length;
    return reply(200, {
      from: fromD,
      to: toD,
      urgent_24h: urgent24h,
      orders: {
        imported: orders.length,
        by_status: {},
        reports_ready: reports.length,
        failed: 0
      },
      results: {
        normal: reports.filter((r) => r && r.classification === "NORMAL").length,
        abnormal: reports.filter((r) => r && r.classification === "ABNORMAL").length
      },
      patients_per_bucket: {},
      followups_due: { today: 0, this_week: 0, overdue: 0, parked: 0, urgent_24h: urgent24h },
      calls: {
        made: audit.filter((a) => a && a.action === "CALL_PLACED").length,
        by_outcome: {},
        bookings: 0,
        consent_rate_pct: 0,
        doctor_calls_done: 0
      },
      retests: { recommended: 0, ordered: 0 },
      funnel: [],
      needs_attention: {
        failed_fetch: 0,
        failed_extract: 0,
        needs_review: reports.filter((r) => r && r.needs_review === true).length,
        pending_identity: 0
      },
      doctors: [],
      programs: Object.values(progMap).sort((a, b) => a.code.localeCompare(b.code)),
      finding_funnel: findingFunnel
    });
  }

  // --- NOTIFICATIONS ---
  if (path === "/notifications" && method === "GET") {
    return reply(200, store.notifications);
  }

  if (path === "/notifications/read-all" && method === "POST") {
    store.notifications.unread = 0;
    store.notifications.items.forEach((item) => { item.read = true; });
    await saveStore(env, store);
    return reply(200, store.notifications);
  }

  // --- USERS & DOCTORS ---
  if (path === "/users") {
    if (method === "GET") return reply(200, store.users.map(publicUser));
    if (method === "POST") {
      const u = await request.json().catch(() => ({}));
      const email = String(u.email || "").trim().toLowerCase();
      const name = String(u.name || "").trim().slice(0, 120);
      const role = String(u.role || "").toUpperCase();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { detail: "Enter a name and a valid email." });
      if (!ROLES.has(role)) return reply(400, { detail: "Role must be ADMIN, CALLER or DOCTOR." });
      if (String(u.password || "").length < 10) return reply(400, { detail: "The password needs at least 10 characters." });
      if (store.users.some((x) => String(x.email || "").toLowerCase() === email)) return reply(409, { detail: "A user with this email already exists." });
      const nu = {
        id: nextId(store.users), name, email, role, active: true,
        myoperator_user_id: String(u.myoperator_user_id || "").trim().slice(0, 64),
        password_hash: await hashPassword(String(u.password))
      };
      store.users.push(nu);
      await saveStore(env, store);
      return reply(201, publicUser(nu));
    }
  }

  const userMatch = path.match(/^\/users\/(\d+)$/);
  if (userMatch && method === "PATCH") {
    const target = store.users.find((x) => x.id === parseInt(userMatch[1], 10));
    if (!target) return reply(404, { detail: "User not found." });
    const b = await request.json().catch(() => ({}));
    if (b.active !== undefined) {
      if (target.id === me.id && !b.active) return reply(400, { detail: "You cannot disable your own account." });
      target.active = Boolean(b.active);
    }
    if (b.role !== undefined) {
      const role = String(b.role).toUpperCase();
      if (!ROLES.has(role)) return reply(400, { detail: "Role must be ADMIN, CALLER or DOCTOR." });
      if (target.id === me.id && role !== "ADMIN") return reply(400, { detail: "You cannot remove your own admin role." });
      target.role = role;
    }
    if (b.myoperator_user_id !== undefined) target.myoperator_user_id = String(b.myoperator_user_id || "").trim().slice(0, 64);
    if (b.password !== undefined) {
      if (String(b.password).length < 10) return reply(400, { detail: "The password needs at least 10 characters." });
      target.password_hash = await hashPassword(String(b.password));
    }
    if (["active", "role", "myoperator_user_id", "password"].some((k) => b[k] !== undefined)) recordAudit(store, me, "update", "user", target.id);
    await saveStore(env, store);
    return reply(200, publicUser(target));
  }

  if (path === "/doctors") {
    if (method === "GET") return reply(200, store.doctors);
    if (method === "POST") {
      const d = await request.json().catch(() => ({}));
      const nd = { id: store.doctors.length + 1, ...d, open_cases: 0, escalations: 0, not_accepted: 0, upcoming_bookings: 0, calls_done: 0 };
      store.doctors.push(nd);
      await saveStore(env, store);
      return reply(201, nd);
    }
  }

  // --- SETTINGS --- (credentials are Worker secrets and never appear here)
  const visibleSettings = () => Object.fromEntries(Object.entries(store.settings).filter(([k]) => !ENV_ONLY_SETTING.test(k)));
  const setKeyMatch = path.match(/^\/settings\/([a-zA-Z0-9_]+)$/);
  if (setKeyMatch && (method === "PUT" || method === "POST")) {
    const key = setKeyMatch[1];
    if (ENV_ONLY_SETTING.test(key) || !(key in store.settings)) return reply(400, { detail: "This setting cannot be changed here." });
    const b = await request.json().catch(() => ({}));
    store.settings[key] = b.value !== undefined ? b.value : b;
    await saveStore(env, store);
    return reply(200, { key, value: store.settings[key] });
  }

  if (path === "/settings") {
    if (method === "GET") return reply(200, visibleSettings());
    if (method === "POST" || method === "PUT") {
      const s = await request.json().catch(() => ({}));
      for (const [k, v] of Object.entries(s || {})) if (!ENV_ONLY_SETTING.test(k) && k in store.settings) store.settings[k] = v;
      await saveStore(env, store);
      return reply(200, visibleSettings());
    }
  }

  // --- ADMIN DATA RESET ---
  if (path === "/admin/reset-data" && method === "POST") {
    if (me.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to reset data" });
    store.batches = [];
    store.orders = [];
    store.reports = [];
    store.patients = [];
    store.followups = [];
    store.identityReviews = [];
    store.audit = [];
    store.workflows = {};
    store.comments = {};
    store.care_touchpoints = [];
    store.health_profiles = {};
    store.program_recommendations = [];
    store.patient_medications = [];
    store.refill_schedules = [];
    store.referrals = [];
    store.home_readings = [];
    store.home_visits = [];
    store.monitoring_schedules = [];
    store.clinical_tasks = [];
    store.family_links = [];
    store.family_consents = [];
    store.dashboard = {
      from: "",
      to: "",
      orders: { imported: 0, by_status: {}, reports_ready: 0, failed: 0 },
      results: { normal: 0, abnormal: 0 },
      patients_per_bucket: {},
      followups_due: { today: 0, this_week: 0, overdue: 0, parked: 0 },
      calls: { made: 0, by_outcome: {}, bookings: 0, consent_rate_pct: 0, doctor_calls_done: 0 },
      retests: { recommended: 0, ordered: 0 },
      funnel: [],
      needs_attention: { failed_fetch: 0, failed_extract: 0, needs_review: 0, pending_identity: 0 },
      doctors: []
    };
    await saveStore(env, store);
    return reply(200, { ok: true, message: "All data has been cleared." });
  }

  // --- FOLLOWUPS ---
  async function loadParamsByReport(pid) {
    const map = {};
    for (const r of (store.reports || [])) {
      if (r.patient_id === pid) map[r.id] = (await kvGet(env, `report_params:${r.id}`)) || [];
    }
    return map;
  }
  async function buildComparePayload(pid, rep, fu = null) {
    const pat = (store.patients || []).find((x) => x.id === pid) || null;
    const paramsMap = pid ? await loadParamsByReport(pid) : {};
    const rows = pid ? compareInStore(store, pid, rep.id, paramsMap) : [];
    const targetFu = fu || (store.followups || []).find((f) => f.report_id === rep.id) || null;
    const journey = pid ? buildJourneyInStore(store, pid, rep.id, targetFu, paramsMap) : null;
    const prevRow = rows.find((r) => r.previous_report_id);
    const currDate = rep.collected_on ? toIstDateStr(rep.collected_on) : (rep.reported_on ? toIstDateStr(rep.reported_on) : null);
    return {
      report_id: rep.id,
      patient_id: pid,
      patient_name: pat?.name || rep.patient_name || "",
      followup_id: targetFu?.id ?? null,
      previous_report_id: prevRow ? prevRow.previous_report_id : null,
      previous_collected_on: prevRow ? prevRow.previous_date : null,
      current_collected_on: currDate,
      rows,
      journey,
      printable_disclaimer: CLINICAL_DISCLAIMER,
    };
  }
  const fuRowOut = (f, full, hasMonitoring = false, hasComparison = false) => {
    let label;
    if (!full) {
      if (f.retest_plan?.source === "CONDITION" || hasMonitoring) {
        const d = f.retest_window_start || f.due_on;
        label = d ? `Monitoring due on ${String(d).slice(0, 10)}` : "Monitoring due";
      } else {
        label = "Retest due";
      }
    } else {
      label = f.retest_plan?.label || (f.retest_status === "DOCTOR_TO_SET" ? "Doctor to set retest date" : "Retest due");
    }
    const out = {
      id: f.id,
      patient_id: f.patient_id || 1,
      patient_name: f.patient_name || "Patient",
      mobile: full ? (f.mobile || "") : mobileOut(f.mobile || "", me),
      language: f.language || "en",
      report_id: f.report_id ?? null,
      order_id: f.order_id ?? null,
      due_on: f.due_on || f.created_at || todayIstStr(),
      stage: f.stage || "QUEUED",
      priority: f.priority || "ROUTINE",
      attempts: f.attempts || 0,
      report_age_days: f.report_age_days || 0,
      retest_status: f.retest_status || "AUTO_SCHEDULED",
      retest_label: label,
      retest_window_start: f.retest_window_start ?? null,
      retest_window_end: f.retest_window_end ?? null,
      protocol_tier_colour: getTierMeta(store.rules, f.protocol_tier || "LONG_TERM").colour_token,
      protocol_tier_label: !full
        ? getTierMeta(store.rules, f.protocol_tier || "LONG_TERM").caller_label
        : getTierMeta(store.rules, f.protocol_tier || "LONG_TERM").label,
    };
    if (!full && hasComparison) {
      out.comparison_notice = "Results compared \u2014 doctor review scheduled";
      out.comparison_date = String(f.due_on || todayIstStr()).slice(0, 10);
    }
    if (full) {
      out.buckets = f.buckets || [];
      out.finding_codes = f.finding_codes || [];
      out.retest_score = f.retest_score ?? 50;
      out.retest_tier = f.retest_tier || "MEDIUM";
      out.protocol_tier = f.protocol_tier || "LONG_TERM";
      out.sla_escalated_at = f.sla_escalated_at || null;
      out.assigned_doctor_id = f.assigned_doctor_id || null;
      out.treatment_anchor_on = f.treatment_anchor_on ?? null;
      out.reminder_on = f.reminder_on ?? null;
      out.retest_plan = f.retest_plan ?? null;
      out.deficits_summary = f.deficits_summary || "";
    }
    return out;
  };
  const sortFollowupsUrgentFirst = (a, b) => {
    const uA = a.protocol_tier === "URGENT" ? 0 : 1;
    const uB = b.protocol_tier === "URGENT" ? 0 : 1;
    if (uA !== uB) return uA - uB;
    const pA = a.priority === "ESCALATION" || a.priority === "URGENT" ? 0 : a.priority === "PRIORITY" ? 1 : 2;
    const pB = b.priority === "ESCALATION" || b.priority === "URGENT" ? 0 : b.priority === "PRIORITY" ? 1 : 2;
    if (pA !== pB) return pA - pB;
    const sDiff = Number(b.retest_score || 0) - Number(a.retest_score || 0);
    if (sDiff !== 0) return sDiff;
    return String(a.due_on || "").localeCompare(String(b.due_on || "")) || Number(a.id) - Number(b.id);
  };
  if (path === "/retesting-protocol/summary" && method === "GET") {
    if (me.role !== "ADMIN") return reply(403, { detail: "Not allowed" });
    const tiers = store.rules?.retest_tiers?.data || store.rules?.retest_tiers || DEFAULT_RETEST_TIERS;
    const counts = {};
    for (const f of store.followups || []) {
      if (f.suppressed_reason || DONE_STAGES.has(f.stage)) continue;
      const tc = f.protocol_tier || "LONG_TERM";
      counts[tc] = (counts[tc] || 0) + 1;
    }
    const ordered = [...tiers].sort((a, b) => Number(a.order || 99) - Number(b.order || 99));
    return reply(200, {
      tiers: ordered.map((t) => ({ ...t, open_count: counts[t.code] || 0 })),
      total_open: Object.values(counts).reduce((s, n) => s + n, 0),
      urgent_24h: counts.URGENT || 0,
    });
  }
  if (path === "/followups" && method === "GET") {
    const isFull = me.role !== "CALLER" || Boolean(store.settings?.caller_can_view_results);
    const view = url.searchParams.get("view") || "queue";
    const bucketFilter = url.searchParams.get("bucket");
    const priorityFilter = url.searchParams.get("priority");
    const tierFilter = url.searchParams.get("tier");
    const protocolTierFilter = url.searchParams.get("protocol_tier");
    if (!isFull && (view === "low_potential" || bucketFilter || protocolTierFilter)) {
      return reply(403, { detail: "Not allowed" });
    }
    const today = todayIstStr();
    const list = [...(store.followups || [])]
      .filter((f) => {
        if (f.suppressed_reason) return false;
        const isDone = DONE_STAGES.has(f.stage);
        const parked = f.priority === "ROUTINE" && f.retest_tier === "LOW" && f.protocol_tier !== "URGENT";
        if (view === "done") return isDone;
        if (view === "low_potential") return !isDone && parked;
        if (isDone || parked) return false;
        const due = String(f.due_on || today).slice(0, 10);
        if (view === "due_tomorrow") return due === addDaysIso(today, 1);
        if (view === "due_this_week") return due >= today && due <= addDaysIso(today, 7);
        if (view === "next_30_days") return due >= today && due <= addDaysIso(today, 30);
        if (view === "overdue") return due < today;
        if (view === "escalations") return f.priority === "ESCALATION" || f.priority === "URGENT" || f.protocol_tier === "URGENT";
        return true;
      })
      .filter((f) => (!priorityFilter || f.priority === priorityFilter))
      .filter((f) => (!tierFilter || f.retest_tier === tierFilter))
      .filter((f) => (!protocolTierFilter || (f.protocol_tier || "LONG_TERM") === protocolTierFilter))
      .filter((f) => (!bucketFilter || (f.buckets || []).includes(bucketFilter)))
      .sort(sortFollowupsUrgentFirst);
    const outRows = [];
    const paramsCache = {};
    for (const f of list) {
      const hasMon = (store.monitoring_schedules || []).some((s) => s.patient_id === f.patient_id && s.status === "ACTIVE");
      let hasComp = false;
      if (!isFull && f.report_id) {
        if (!paramsCache[f.patient_id]) paramsCache[f.patient_id] = await loadParamsByReport(f.patient_id);
        hasComp = hasComparisonInStore(store, f.patient_id, f.report_id, paramsCache[f.patient_id]);
      }
      outRows.push(fuRowOut(f, isFull, hasMon, hasComp));
    }
    return reply(200, outRows);
  }
  if (path === "/followups/summary" && method === "GET") {
    const isFull = me.role !== "CALLER" || Boolean(store.settings?.caller_can_view_results);
    const today = todayIstStr();
    const live = (store.followups || []).filter((f) => !f.suppressed_reason && !DONE_STAGES.has(f.stage));
    const active = live.filter((f) => !(f.priority === "ROUTINE" && f.retest_tier === "LOW" && f.protocol_tier !== "URGENT"));
    const done = (store.followups || []).filter((f) => !f.suppressed_reason && DONE_STAGES.has(f.stage)).length;
    const out = {
      queue: active.length,
      due_tomorrow: active.filter((f) => String(f.due_on || today).slice(0, 10) === addDaysIso(today, 1)).length,
      due_this_week: active.filter((f) => { const d = String(f.due_on || today).slice(0, 10); return d >= today && d <= addDaysIso(today, 7); }).length,
      next_30_days: active.filter((f) => { const d = String(f.due_on || today).slice(0, 10); return d >= today && d <= addDaysIso(today, 30); }).length,
      overdue: active.filter((f) => String(f.due_on || today).slice(0, 10) < today).length,
      escalations: active.filter((f) => f.priority === "ESCALATION" || f.priority === "URGENT" || f.protocol_tier === "URGENT").length,
      done,
    };
    if (isFull) {
      out.low_potential = live.filter((f) => f.priority === "ROUTINE" && f.retest_tier === "LOW" && f.protocol_tier !== "URGENT").length;
      const _buckets = {};
      for (const f of store.followups || []) {
        for (const b of (f.buckets || [])) _buckets[b] = (_buckets[b] || 0) + 1;
      }
      out._buckets = _buckets;
    }
    return reply(200, out);
  }
  if ((path === "/doctor/queue" || path === "/doctor-queue") && method === "GET") {
    if (me.role === "CALLER") return reply(403, { detail: "Not allowed" });
    const protocolTierFilter = url.searchParams.get("protocol_tier");
    const progs = store.rules?.care_programs?.data || store.rules?.care_programs || DEFAULT_CARE_PROGRAMS;
    const considerCodes = new Set(progs.filter((p) => p.mode === "DOCTOR_CONSIDER").map((p) => p.code));
    const list = (me.role === "DOCTOR"
      ? store.followups.filter((f) => !f.assigned_doctor_id || f.assigned_doctor_id === me.id)
      : store.followups
    )
      .filter((f) => !f.suppressed_reason && !DONE_STAGES.has(f.stage) && (["BOOKED", "CONSENT_GIVEN"].includes(f.stage) || ["ESCALATION", "URGENT"].includes(f.priority) || f.retest_status === "DOCTOR_TO_SET" || f.protocol_tier === "URGENT"))
      .filter((f) => (!protocolTierFilter || (f.protocol_tier || "LONG_TERM") === protocolTierFilter))
      .sort(sortFollowupsUrgentFirst)
      .map((f) => {
        const recs = (store.program_recommendations || []).filter((r) => r.patient_id === f.patient_id && r.status === "SUGGESTED");
        return {
          ...fuRowOut(f, true),
          pending_plans: recs.filter((r) => !considerCodes.has(r.program_code)).length,
          pending_consider: recs.filter((r) => considerCodes.has(r.program_code)).length
        };
      });
    return reply(200, list);
  }
  if (path === "/identity-reviews" && method === "GET") return reply(200, store.identityReviews);
  if (path.startsWith("/identity-reviews/") && method === "POST") return reply(200, { ok: true });
  if (path === "/audit" && method === "GET") return reply(200, store.audit);
  if (path === "/reports" && method === "GET") return reply(200, store.reports);
  const repMatch = path.match(/^\/reports\/(\d+)$/);
  if (repMatch && method === "GET") {
    const rid = parseInt(repMatch[1], 10);
    const existing = store.reports.find((item) => item.id === rid);
    if (!existing) return reply(404, { detail: "Report not found." });
    const rawParams = (await kvGet(env, `report_params:${rid}`)) || [];
    const sortedParams = sortParameters(rawParams);
    const rep = { ...existing, parameters: sortedParams };
    if (existing.source === "labtrace" || existing.labtrace_work_order_id) {
      rep.pdf_url = `/api/v1/reports/${rid}/pdf`;
    }
    return reply(200, rep);
  }

  if (repMatch && method === "DELETE") {
    if (me.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to delete entries" });
    const rid = parseInt(repMatch[1], 10);
    store.reports = store.reports.filter((r) => r.id !== rid);
    await saveStore(env, store);
    return reply(200, { ok: true, deleted: rid });
  }

  if (path === "/patients" && method === "GET") return reply(200, store.patients.map((p) => patientOut(p, me)));
  const patMatch = path.match(/^\/patients\/(\d+)$/);
  if (patMatch && method === "GET") {
    const pid = parseInt(patMatch[1], 10);
    const p = store.patients.find((item) => item.id === pid);
    if (!p) return reply(404, { detail: "No such patient" });
    const household = store.patients.filter((item) => item.household_tag && item.household_tag === p.household_tag && item.id !== p.id);
    const fuByRep = Object.fromEntries((store.followups || []).filter((f) => f.patient_id === pid && f.report_id).map((f) => [f.report_id, f]));
    let latestMeta = null;
    let latestTier = null;
    const repList = store.reports.filter((r) => r.patient_id === pid).map((r) => {
      const f = fuByRep[r.id];
      const tcode = f?.protocol_tier || null;
      const tmeta = tcode ? getTierMeta(store.rules, tcode) : null;
      if (f && !f.suppressed_reason && !latestTier) { latestTier = tcode; latestMeta = tmeta; }
      return {
        ...r,
        followup_id: f?.id || null,
        protocol_tier: tcode,
        protocol_tier_label: tmeta?.label || null,
        protocol_tier_colour: tmeta?.colour_token || null,
      };
    });
    return reply(200, {
      ...patientOut(p, me),
      protocol_tier: latestTier,
      protocol_tier_label: latestMeta?.label || null,
      protocol_tier_colour: latestMeta?.colour_token || null,
      household: household.map((h) => patientOut(h, me)),
      reports: repList,
    });
  }
  if (patMatch && method === "PATCH") {
    const pid = parseInt(patMatch[1], 10);
    const p = store.patients.find((item) => item.id === pid);
    if (!p) return reply(404, { detail: "No such patient" });
    const body = await request.json().catch(() => ({}));
    if (body.language !== undefined) p.language = body.language;
    if (body.do_not_call !== undefined) p.do_not_call = Boolean(body.do_not_call);
    recordAudit(store, me, "update", "patient", pid);
    await saveStore(env, store);
    return reply(200, patientOut(p, me));
  }
  if (patMatch && method === "DELETE") {
    if (me.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to delete entries" });
    const pid = parseInt(patMatch[1], 10);
    store.patients = store.patients.filter((p) => p.id !== pid);
    recordAudit(store, me, "delete", "patient", pid);
    await saveStore(env, store);
    return reply(200, { ok: true, deleted: pid });
  }

  const repExtractMatch = path.match(/^\/reports\/(\d+)\/extract$/);
  if (repExtractMatch && method === "POST") {
    const rid = parseInt(repExtractMatch[1], 10);
    const rep = store.reports.find((r) => r.id === rid);
    if (!rep) return reply(404, { detail: "Report not found" });
    const sampleParams = [
      { id: 1, param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 6.8, unit: "%", system_flag: "HIGH", severity: "moderate", ref_text: "< 5.7" },
      { id: 2, param_code: "GLUCOSE_FASTING", param_name_raw: "Fasting Blood Sugar", value_num: 110, unit: "mg/dL", system_flag: "HIGH", severity: "mild", ref_text: "70-100" }
    ];
    await kvPut(env, `report_params:${rid}`, sampleParams);
    const ins = await generateRulesInsight(env, rep);
    await kvPut(env, `insight:${rid}`, ins);
    rep.status = "READY";
    rep.classification = "ABNORMAL";
    rep.abnormal_count = 2;
    rep.confidence = 90;

    if (!store.followups.some((f) => f.report_id === rid)) {
      const fuId = nextId(store.followups);
      store.followups.push({
        id: fuId,
        patient_id: rep.patient_id,
        patient_name: rep.patient_name || "Patient",
        mobile: rep.mobile || "",
        report_id: rid,
        due_on: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        stage: "QUEUED",
        priority: "PRIORITY",
        attempts: 0,
        report_age_days: 0,
        buckets: ["OTHER"],
        retest_score: 50,
        retest_tier: "MEDIUM",
        assigned_doctor_id: null,
        suppressed_reason: "",
        score_breakdown: [],
        buckets_detail: []
      });
    }

    recordAudit(store, me, "extract", "report", rid);
    if (rep.patient_id) {
      syncTouchpointsInStore(store, rep.patient_id);
      await syncProgramsInStore(env, store, rep.patient_id, rid, sampleParams);
    }
    await saveStore(env, store);
    return reply(200, { ok: true, parameters: sampleParams, confidence: 90 });
  }

  const paramPatchMatch = path.match(/^\/reports\/(\d+)\/parameters\/([a-zA-Z0-9_-]+)$/);
  if (paramPatchMatch && method === "PATCH") {
    const rid = parseInt(paramPatchMatch[1], 10);
    const pid = paramPatchMatch[2];
    const rep = store.reports.find((r) => r.id === rid);
    if (!rep) return reply(404, { detail: "Report not found" });
    const body = await request.json().catch(() => ({}));
    let params = (await kvGet(env, `report_params:${rid}`)) || [];
    const p = params.find((x) => String(x.id) === String(pid) || x.param_code === pid);
    if (!p) return reply(404, { detail: "Parameter not found" });
    if (body.system_flag !== undefined) p.system_flag = body.system_flag;
    if (body.value_text !== undefined) p.value_text = body.value_text;
    if (body.value_num !== undefined) p.value_num = body.value_num;
    await kvPut(env, `report_params:${rid}`, params);
    recordAudit(store, me, "edit", "parameter", `${rid}:${pid}`);
    await saveStore(env, store);
    return reply(200, p);
  }

  const repApproveMatch = path.match(/^\/reports\/(\d+)\/approve$/);
  if (repApproveMatch && method === "POST") {
    const rid = parseInt(repApproveMatch[1], 10);
    const rep = store.reports.find((r) => r.id === rid);
    if (!rep) return reply(404, { detail: "Report not found" });
    if (rep.status !== "NEEDS_REVIEW") return reply(409, { detail: "Report is not awaiting review" });
    if (!rep.age || !rep.gender) return reply(422, { detail: "Patient age and gender are required" });
    rep.status = "READY";
    rep.needs_review = false;
    if (!store.followups.some((f) => f.report_id === rid)) {
      const fuId = nextId(store.followups);
      const params = (await kvGet(env, `report_params:${rid}`)) || [];
      const abn = params.filter((p) => p.system_flag === "LOW" || p.system_flag === "HIGH");
      const priority = abn.length > 0 ? "PRIORITY" : "ROUTINE";
      store.followups.push({
        id: fuId,
        patient_id: rep.patient_id,
        patient_name: rep.patient_name || "Patient",
        mobile: rep.mobile || "",
        report_id: rid,
        due_on: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        stage: "QUEUED",
        priority,
        attempts: 0,
        report_age_days: 0,
        buckets: abn.length > 0 ? ["OTHER"] : [],
        retest_score: 50,
        retest_tier: "MEDIUM",
        assigned_doctor_id: null,
        suppressed_reason: "",
        score_breakdown: [],
        buckets_detail: []
      });
    }
    recordAudit(store, me, "approve", "report", rid);
    if (rep.patient_id) {
      const pList = (await kvGet(env, `report_params:${rid}`)) || [];
      syncTouchpointsInStore(store, rep.patient_id);
      await syncProgramsInStore(env, store, rep.patient_id, rid, pList);
    }
    await saveStore(env, store);
    return reply(200, { ok: true, status: "READY" });
  }

  const reportCompMatch = path.match(/^\/reports\/(\d+)\/compare$/);
  if (reportCompMatch && method === "GET") {
    const rid = parseInt(reportCompMatch[1], 10);
    const rep = (store.reports || []).find((r) => r.id === rid);
    if (!rep) return reply(404, { detail: "No such report" });
    recordAudit(store, me, "view", "report_compare", rid);
    await saveStore(env, store);
    return reply(200, await buildComparePayload(rep.patient_id, rep));
  }

  const patientCompMatch = path.match(/^\/patients\/(\d+)\/compare$/);
  if (patientCompMatch && method === "GET") {
    const pid = parseInt(patientCompMatch[1], 10);
    const p = (store.patients || []).find((x) => x.id === pid);
    if (!p) return reply(404, { detail: "No such patient" });
    const reqRid = url.searchParams.get("report_id");
    const ready = (store.reports || []).filter((r) => r.patient_id === pid && (reqRid ? r.id === parseInt(reqRid, 10) : r.status === "READY"))
      .sort((a, b) => String(b.collected_on || "").localeCompare(String(a.collected_on || "")) || b.id - a.id);
    const rep = ready[0] || null;
    if (reqRid && !rep) return reply(404, { detail: "No such report for this patient" });
    recordAudit(store, me, "view", "patient_compare", pid);
    await saveStore(env, store);
    if (!rep) {
      return reply(200, {
        report_id: null, patient_id: pid, patient_name: p.name, followup_id: null,
        previous_report_id: null, previous_collected_on: null, current_collected_on: null,
        rows: [], journey: null, printable_disclaimer: CLINICAL_DISCLAIMER,
      });
    }
    return reply(200, await buildComparePayload(pid, rep));
  }

  const insightMatch = path.match(/^\/reports\/(\d+)\/insight(.*)$/);
  if (insightMatch) {
    const rid = parseInt(insightMatch[1], 10);
    const sub = insightMatch[2];
    const rep = store.reports.find((r) => r.id === rid);
    if (!rep) return reply(404, { detail: "Report not found" });
    let ins = await kvGet(env, `insight:${rid}`);
    if (!ins) {
      ins = await generateRulesInsight(env, rep);
      await kvPut(env, `insight:${rid}`, ins);
      if (!store.insights) store.insights = {};
      store.insights[rid] = ins;
      await saveStore(env, store);
    }
    if (!sub && method === "GET") {
      if (me.role === "CALLER") {
        if (ins.status !== "APPROVED") return reply(403, { detail: "Report insights are only visible to callers once approved by a doctor" });
        return reply(200, {
          id: ins.id,
          report_id: rid,
          status: ins.status,
          caller_safe: true,
          content: {
            overview: ins.overview || "",
            caller_questions: ins.content?.suggestions?.caller_questions || [],
            doctor_connect: ins.doctor_connect || {},
            red_flag_protocol: ins.red_flag_protocol || "",
            limitations: ins.limitations || "",
            suggested_window_days: ins.future?.suggested_window_days || null
          }
        });
      }
      return reply(200, ins);
    }
    if (sub === "/regenerate" && method === "POST") {
      ins = await generateRulesInsight(env, rep);
      await kvPut(env, `insight:${rid}`, ins);
      recordAudit(store, me, "regenerate", "insight", rid);
      await saveStore(env, store);
      return reply(200, ins);
    }
    if (sub === "/approve" && method === "POST") {
      ins.status = "APPROVED";
      ins.approved_by = me.id;
      ins.approved_at = new Date().toISOString();
      await kvPut(env, `insight:${rid}`, ins);
      const fu = (store.followups || []).find((f) => f.report_id === rid);
      if (fu) {
        fu.priority = "PRIORITY";
      }
      recordAudit(store, me, "approve", "insight", rid);
      await saveStore(env, store);
      return reply(200, ins);
    }
    if (sub === "/reject" && method === "POST") {
      ins.status = "REJECTED";
      await kvPut(env, `insight:${rid}`, ins);
      recordAudit(store, me, "reject", "insight", rid);
      await saveStore(env, store);
      return reply(200, ins);
    }
    if (!sub && method === "PATCH") {
      const b = await request.json().catch(() => ({}));
      if (b.overview) {
        ins.overview = b.overview;
        if (ins.content) ins.content.overview = b.overview;
      }
      await kvPut(env, `insight:${rid}`, ins);
      recordAudit(store, me, "edit", "insight", rid);
      await saveStore(env, store);
      return reply(200, ins);
    }
  }

  const trendParamsMatch = path.match(/^\/trends\/(\d+)\/parameters$/);
  if (trendParamsMatch && method === "GET") {
    const pid = parseInt(trendParamsMatch[1], 10);
    const repList = store.reports.filter((r) => r.patient_id === pid && r.status === "READY");
    const paramMap = {};
    for (const r of repList) {
      const pList = (await kvGet(env, `report_params:${r.id}`)) || [];
      for (const p of pList) {
        if (!p.param_code) continue;
        const entry = paramMap[p.param_code] || { code: p.param_code, name: p.param_name_raw || p.param_code, unit: p.unit || "", count: 0, abnormal: 0 };
        entry.count += 1;
        if (p.system_flag === "LOW" || p.system_flag === "HIGH") entry.abnormal += 1;
        paramMap[p.param_code] = entry;
      }
    }
    const list = Object.values(paramMap).sort((a, b) => (b.abnormal - a.abnormal) || a.name.localeCompare(b.name));
    return reply(200, list);
  }

  const trendMatch = path.match(/^\/trends\/(\d+)$/);
  if (trendMatch && method === "GET") {
    const pid = parseInt(trendMatch[1], 10);
    const codesParam = url.searchParams.get("codes") || "";
    const range = url.searchParams.get("range") || "all";
    const codes = codesParam.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
    if (codes.length === 0 || codes.length > 4) return reply(422, { detail: "Pick between 1 and 4 tests" });
    if (!["1y", "5y", "all"].includes(range)) return reply(422, { detail: "range must be 1y, 5y or all" });
    const repList = store.reports.filter((r) => r.patient_id === pid && r.status === "READY");
    const series = {};
    for (const c of codes) series[c] = { code: c, name: c, unit: "", points: [], band: null, band_source: "" };
    for (const r of repList) {
      const pList = (await kvGet(env, `report_params:${r.id}`)) || [];
      for (const p of pList) {
        if (codes.includes(p.param_code) && p.value_num !== null && p.value_num !== undefined) {
          const s = series[p.param_code];
          s.name = p.param_name_raw || p.param_code;
          s.unit = p.unit || "";
          s.points.push({
            date: r.collected_on ? r.collected_on.slice(0, 10) : null,
            value: p.value_num,
            flag: p.system_flag,
            severity: p.severity || "mild",
            order_id: r.order_id,
            report_id: r.id,
            ref_text: p.ref_text || ""
          });
          if (p.ref_low !== undefined || p.ref_high !== undefined) {
            s.band = { low: p.ref_low, high: p.ref_high };
            s.band_source = "report";
          }
        }
      }
    }
    const firstCol = repList.length ? repList.map((r) => r.collected_on).filter(Boolean).sort()[0] : null;
    return reply(200, {
      patient_id: pid,
      range,
      series: codes.map((c) => series[c]),
      history_starts: firstCol ? firstCol.slice(0, 10) : null
    });
  }

  const exportTrendMatch = path.match(/^\/exports\/trends\/(\d+)\.csv$/);
  if (exportTrendMatch && method === "GET") {
    const pid = parseInt(exportTrendMatch[1], 10);
    const codesParam = url.searchParams.get("codes") || "";
    const codes = codesParam.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
    const repList = store.reports.filter((r) => r.patient_id === pid && r.status === "READY");
    let csvText = "Test,Date,Value,Unit,Flag,Order\n";
    for (const r of repList) {
      const pList = (await kvGet(env, `report_params:${r.id}`)) || [];
      for (const p of pList) {
        if (codes.length === 0 || codes.includes(p.param_code)) {
          const testName = sanitizeCsvCell(p.param_name_raw || p.param_code);
          const dt = sanitizeCsvCell(r.collected_on ? r.collected_on.slice(0, 10) : "");
          const val = p.value_num !== null ? p.value_num : "";
          const unit = sanitizeCsvCell(p.unit || "");
          const flag = sanitizeCsvCell(p.system_flag || "") + (p.severity ? " " + sanitizeCsvCell(p.severity) : "");
          const ord = sanitizeCsvCell(r.order_id || "");
          csvText += `"${testName}","${dt}",${val},"${unit}","${flag}","${ord}"\n`;
        }
      }
    }
    return new Response(csvText, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="trend-${pid}.csv"` }
    });
  }

  const callCardApproveMatch = path.match(/^\/call-cards\/(\d+)\/approve$/);
  if (callCardApproveMatch && method === "POST") {
    const cid = parseInt(callCardApproveMatch[1], 10);
    let targetCard = null;
    for (const [fid, card] of Object.entries(store.callcards || {})) {
      if (card.id === cid) targetCard = card;
    }
    if (!targetCard) return reply(404, { detail: "No such call card" });
    if (targetCard.validation_status !== "VALID") return reply(409, { detail: "Fix validation problems before approving" });
    targetCard.doctor_approved_by = me.id;
    targetCard.doctor_approved_at = new Date().toISOString();
    await saveStore(env, store);
    return reply(200, { ...targetCard, approved: true, approved_at: targetCard.doctor_approved_at, label: "Approved by doctor" });
  }

  const callCardPutMatch = path.match(/^\/call-cards\/(\d+)$/);
  if (callCardPutMatch && method === "PUT") {
    const cid = parseInt(callCardPutMatch[1], 10);
    const body = await request.json().catch(() => ({}));
    if (!body.content) return reply(422, { detail: "Body must be content" });
    let targetCard = null;
    for (const [fid, card] of Object.entries(store.callcards || {})) {
      if (card.id === cid) {
        card.content = body.content;
        card.version = (card.version || 1) + 1;
        targetCard = card;
      }
    }
    if (!targetCard) return reply(404, { detail: "No such call card" });
    await saveStore(env, store);
    return reply(200, targetCard);
  }

  const retestRecMatch = path.match(/^\/retest-recommendations\/(\d+)\/ordered$/);
  if (retestRecMatch && method === "POST") {
    const rid = parseInt(retestRecMatch[1], 10);
    const b = await request.json().catch(() => ({}));
    for (const [fid, rec] of Object.entries(store.recommendations || {})) {
      if (rec.id === rid) {
        rec.ordered = true;
        rec.ordered_ref = b.ordered_ref || "";
        const fu = store.followups.find((f) => f.id === Number(fid));
        if (fu) fu.stage = "RETEST_ORDERED";
      }
    }
    await saveStore(env, store);
    return reply(200, { ordered: true });
  }

  if (path === "/rules/test_catalogue" || path === "/rules/test-catalogue") {
    return reply(200, store.rules?.test_catalogue || { key: "test_catalogue", version: 1, data: DEFAULT_TEST_CATALOGUE_P7, pending_signoff: false });
  }

  // Calls go only to patients that came from LabTrace.
  const callTarget = (patient, report) => {
    if (!patient && !report) return [404, { detail: "Patient not found." }];
    const real = (report && report.source === "labtrace") || (patient && store.reports.some((r) => r.patient_id === patient.id && r.source === "labtrace"));
    if (!real) return [409, { detail: "Calls are only placed to patients pulled from LabTrace." }];
    return null;
  };

  const patCallMatch = path.match(/^\/patients\/(\d+)\/call$/);
  if (patCallMatch && method === "POST") {
    const pid = parseInt(patCallMatch[1], 10);
    const pat = store.patients.find((p) => p.id === pid);
    const blocked = callTarget(pat, null);
    if (blocked) return reply(...blocked);
    const [status, body] = await placeCall(env, store, me, { mobile: pat.mobile, name: pat.name, patient: pat, ref: `patient-${pid}` });
    if (status === 200) await saveStore(env, store);
    return reply(status, body);
  }

  const repCallMatch = path.match(/^\/reports\/(\d+)\/call$/);
  if (repCallMatch && method === "POST") {
    const rid = parseInt(repCallMatch[1], 10);
    const rep = store.reports.find((r) => r.id === rid);
    const pat = rep ? store.patients.find((p) => p.id === rep.patient_id) : null;
    const blocked = callTarget(pat, rep);
    if (blocked) return reply(...blocked);
    const [status, body] = await placeCall(env, store, me, { mobile: rep.mobile, name: rep.patient_name, patient: pat, ref: `report-${rid}` });
    if (status === 200) await saveStore(env, store);
    return reply(status, body);
  }

  // --- MANUAL DIALER ---
  if (path === "/dialer/call" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const raw = String(body.mobile || "").trim();
    const mobile = indianMobile(raw);
    if (!mobile) return reply(400, { detail: "Please enter a valid 10-digit Indian mobile number." });
    const pat = store.patients.find((p) => p.mobile === mobile);
    if (pat && pat.do_not_call) return reply(409, { detail: "This patient is marked Do Not Call." });
    const name = String(body.name || (pat && pat.name) || "").trim();
    const notes = String(body.notes || "").trim().slice(0, 300);
    const [status, bodyRes] = await placeCall(env, store, me, {
      mobile,
      name: name || "Customer",
      patient: pat,
      ref: `manual-${Date.now().toString(36)}`
    });
    if (status !== 200) return reply(status, bodyRes);
    if (!store.manual_calls) store.manual_calls = [];
    store.manual_calls.unshift({
      id: nextId(store.manual_calls),
      at: new Date().toISOString(),
      caller_name: me.name,
      caller_id: me.id,
      mobile: mobile.slice(0, 2) + "******" + mobile.slice(-2),
      patient_name: name || "Customer",
      notes,
      reference_id: bodyRes.reference_id,
      call_id: bodyRes.call_id
    });
    await saveStore(env, store);
    return reply(200, bodyRes);
  }

  if (path === "/dialer/recent" && method === "GET") {
    return reply(200, (store.manual_calls || []).slice(0, 30));
  }

  const repPdfMatch = path.match(/^\/reports\/(\d+)\/pdf$/);
  if (repPdfMatch && method === "GET") {
    const rep = store.reports.find((r) => r.id === parseInt(repPdfMatch[1], 10));
    if (!rep || rep.source !== "labtrace") return reply(404, { detail: "There is no LabTrace PDF for this report." });
    try {
      const pdf = await labtraceReportPdf(env, rep.labtrace_work_order_id, rep.thyrocare_patient_id);
      const file = `report-${String(rep.order_id).replace(/[^A-Za-z0-9_-]/g, "")}.pdf`;
      return new Response(pdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${file}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    } catch (err) {
      return reply(err instanceof LabTraceError ? err.status : 502, { detail: err instanceof LabTraceError ? err.message : "Could not load the PDF from LabTrace." });
    }
  }

  // Followup details, workflow, comments
  const fMatch = path.match(/^\/followups\/(\d+)(.*)$/);
  if (fMatch) {
    const fid = parseInt(fMatch[1], 10);
    const sub = fMatch[2];
    if (!sub && method === "DELETE") {
      if (me.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to delete entries" });
      store.followups = store.followups.filter((f) => f.id !== fid);
      await saveStore(env, store);
      return reply(200, { ok: true, deleted: fid });
    }
    if (sub === "/call-customer" && method === "POST") {
      const fu = store.followups.find((f) => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found." });
      const pat = store.patients.find((p) => p.id === fu.patient_id);
      const rep = store.reports.find((r) => r.id === fu.report_id) || null;
      const blocked = callTarget(pat, rep);
      if (blocked) return reply(...blocked);
      const name = (pat && pat.name) || fu.patient_name;
      const [status, body] = await placeCall(env, store, me, { mobile: (pat && pat.mobile) || fu.mobile, name, patient: pat, ref: `followup-${fid}` });
      if (status !== 200) return reply(status, body);
      if (!store.workflows[fid]) store.workflows[fid] = { calls: [] };
      if (!store.workflows[fid].calls) store.workflows[fid].calls = [];
      store.workflows[fid].calls.unshift({
        outcome: "OUTBOUND_CALL",
        role: me.role,
        notes: `Call placed through MyOperator to ${name || "the patient"} (ref ${body.reference_id})`,
        at: new Date().toISOString()
      });
      await saveStore(env, store);
      return reply(200, body);
    }
    const fuExists = store.followups.some((f) => f.id === fid);
    if (sub === "/compare" && method === "GET") {
      const fu = store.followups.find((f) => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found." });
      const rep = (store.reports || []).find((r) => r.id === fu.report_id);
      if (!rep) return reply(404, { detail: "No such report" });
      recordAudit(store, me, "view", "followup_compare", fid);
      await saveStore(env, store);
      return reply(200, await buildComparePayload(fu.patient_id, rep, fu));
    }
    if (sub === "/journey/day90-confirm" && method === "POST") {
      if (me.role !== "DOCTOR") return reply(403, { detail: "Only doctors may confirm Day 90 retesting" });
      const fu = store.followups.find((f) => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found." });
      const b = await request.json().catch(() => ({}));
      if (typeof b.clinically_appropriate !== "boolean") return reply(422, { detail: "clinically_appropriate must be a boolean" });
      const paramsMap = await loadParamsByReport(fu.patient_id);
      const j = confirmDay90InStore(store, fu, b.clinically_appropriate, me.id, paramsMap);
      recordAudit(store, me, "day90_confirm", "followup", `${fid}:${b.clinically_appropriate ? 1 : 0}`);
      await saveStore(env, store);
      return reply(200, { followup_id: fid, journey: j });
    }
    if (!sub && method === "GET") {
      if (me.role === "CALLER" && !store.settings?.caller_can_view_results) {
        return reply(403, { detail: "Not allowed" });
      }
      const fu = store.followups.find((f) => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found." });
      return reply(200, {
        ...fuRowOut(fu, true),
        report_id: fu.report_id ?? null,
        score_breakdown: fu.score_breakdown || [],
        suppressed_reason: fu.suppressed_reason || "",
        buckets_detail: fu.buckets_detail || [],
        parked: fu.parked || (fu.priority === "ROUTINE" && fu.retest_tier === "LOW")
      });
    }
    if (sub === "/recommendations" && method === "GET") {
      const fu = store.followups.find((f) => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found." });
      const rep = fu.report_id ? (store.reports || []).find((r) => r.id === fu.report_id) : null;
      const pList = rep ? ((await kvGet(env, `report_params:${rep.id}`)) || []) : [];
      const args = await buildEvalArgs(env, store, fu.patient_id, rep?.id || null, pList);
      const ctx = buildProgramContext(args);
      const findingRules = store.rules?.diagnostic_findings?.data || store.rules?.diagnostic_findings || DEFAULT_DIAGNOSTIC_FINDINGS;
      const comboRules = store.rules?.recommendation_combinations?.data || store.rules?.recommendation_combinations || DEFAULT_RECOMMENDATION_COMBINATIONS;
      const fMap = Object.fromEntries(findingRules.map((x) => [x.code, x]));
      const codes = (Array.isArray(fu.finding_codes) && fu.finding_codes.length)
        ? fu.finding_codes
        : syncCombinationsInStore(store, ctx, rep?.id || null, fu, { findingRules, comboRules });
      if (!fu.retest_plan && fu.retest_status !== "OVERRIDDEN") {
        planRetestInStore(store, fu, { report: rep, params: pList, evalArgs: args });
      }
      const recByCode = Object.fromEntries(
        (store.program_recommendations || [])
          .filter((r) => r.patient_id === fu.patient_id && (r.report_id ?? null) === (fu.report_id ?? null))
          .map((r) => [r.program_code, r])
      );
      const rows = codes.map((fc) => {
        const meta = fMap[fc] || {};
        const cDef = comboRules[fc] || {};
        const row = { finding_code: fc, finding_label: meta.label || fc, icon: meta.icon || "•" };
        for (const [rank, slot] of [[1, "primary"], [2, "secondary"], [3, "third"]]) {
          const spec = cDef[slot];
          if (!spec || !ifPrescribedOk(spec, ctx)) {
            row[slot] = null;
            continue;
          }
          const rec = recByCode[spec.target];
          row[slot] = {
            recommendation_id: rec ? rec.id : null,
            target: spec.target,
            label: spec.label,
            condition: spec.condition || "ALWAYS",
            status: rec ? rec.status : "SUGGESTED",
            rank,
            effective_rank: rec ? rec.rank : rank,
            owner_finding: rec ? (rec.finding_code || fc) : fc
          };
        }
        return row;
      });
      recordAudit(store, me, "view", "followup_recommendations", fid);
      await saveStore(env, store);
      return reply(200, { followup_id: fu.id, finding_codes: codes, combinations: rows });
    }
    if (!sub && method === "PATCH") {
      if (me.role === "CALLER") return reply(403, { detail: "Not allowed" });
      const fu = store.followups.find((f) => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found." });
      const body = await request.json().catch(() => ({}));
      if (body.priority !== undefined) {
        if (!["ROUTINE", "ESCALATION"].includes(body.priority)) return reply(422, { detail: "Priority must be ROUTINE or ESCALATION" });
        fu.priority = body.priority;
      }
      if (body.assigned_doctor_id !== undefined) fu.assigned_doctor_id = body.assigned_doctor_id;
      if (body.protocol_tier !== undefined) {
        const tc = String(body.protocol_tier || "").trim().toUpperCase();
        if (!TIER_ORDER[tc]) return reply(422, { detail: "Invalid protocol_tier" });
        fu.protocol_tier = tc;
        fu.retest_plan = {
          ...(fu.retest_plan || {}),
          manual_tier: tc,
          protocol_tier: tc,
          tier_meta: getTierMeta(store.rules, tc),
        };
        if (tc === "URGENT") notifyUrgentInStore(store, fu);
      }
      if (body.treatment_anchor_on !== undefined) {
        fu.treatment_anchor_on = String(body.treatment_anchor_on).slice(0, 10);
        if (fu.retest_status !== "OVERRIDDEN") {
          const rep = fu.report_id ? (store.reports || []).find((r) => r.id === fu.report_id) : null;
          const pList = rep ? ((await kvGet(env, `report_params:${rep.id}`)) || []) : [];
          planRetestInStore(store, fu, { report: rep, params: pList });
        }
      }
      if (body.retest_date !== undefined) {
        const rd = String(body.retest_date || "").slice(0, 10);
        const rep = fu.report_id ? (store.reports || []).find((r) => r.id === fu.report_id) : null;
        const anchor = fu.treatment_anchor_on || (rep?.collected_on ? toIstDateStr(rep.collected_on) : todayIstStr());
        const { ok, lo, hi } = dateInTierWindow(store.rules, fu.protocol_tier || "LONG_TERM", rd, anchor);
        if (!ok) {
          const reason = String(body.retest_override_reason || "").trim().toUpperCase();
          if (!OVERRIDE_REASONS.includes(reason)) {
            return reply(422, { detail: `Date falls outside ${fu.protocol_tier || "LONG_TERM"} tier window (${lo} to ${hi || "onward"}); override reason required` });
          }
          overrideRetestInStore(fu, { window_start: rd, window_end: rd, reason_code: reason, notes: body.retest_notes || "", user_id: me.id, rules: store.rules });
          recordAudit(store, me, "retest_override", "followup", `${fid}:${reason}`);
        } else {
          fu.retest_window_start = rd;
          fu.retest_window_end = rd;
          fu.due_on = rd;
          fu.next_followup_on = rd;
          if (fu.retest_status === "DOCTOR_TO_SET") {
            fu.retest_status = "DOCTOR_SET";
            fu.retest_plan = { ...(fu.retest_plan || {}), status: "DOCTOR_SET", label: "Doctor set retest date" };
          }
        }
      }
      recordAudit(store, me, "update", "followup", fid);
      await saveStore(env, store);
      return reply(200, fuRowOut(fu, true));
    }
    if (sub === "/retest-override" && method === "POST") {
      if (me.role === "CALLER") return reply(403, { detail: "Not allowed" });
      const fu = store.followups.find((f) => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found." });
      const b = await request.json().catch(() => ({}));
      const reason = String(b.reason_code || "").trim().toUpperCase();
      if (!OVERRIDE_REASONS.includes(reason)) {
        return reply(422, { detail: `reason_code must be one of ${OVERRIDE_REASONS.join(", ")}` });
      }
      const start = String(b.window_start || b.retest_date || "").slice(0, 10);
      const end = b.window_end ? String(b.window_end).slice(0, 10) : start;
      if (!start || (end && end < start)) return reply(422, { detail: "Invalid window_start or window_end" });
      overrideRetestInStore(fu, { window_start: start, window_end: end, reason_code: reason, notes: b.notes || "", user_id: me.id, rules: store.rules });
      recordAudit(store, me, "retest_override", "followup", `${fid}:${reason}`);
      await saveStore(env, store);
      return reply(200, fuRowOut(fu, true));
    }
    if (sub === "/call-card" && method === "GET") {
      if (!fuExists) return reply(404, { detail: "Follow-up not found." });
      const card = store.callcards?.[fid] || store.call_cards?.[fid];
      if (!card) return reply(404, { detail: "No call card yet" });
      const versions = card.versions && card.versions.length ? card.versions : [{ id: card.id, version: card.version || 1, validation_status: card.validation_status || "VALID", edited_by: 1, approved: Boolean(card.doctor_approved_at), created_at: card.created_at }];
      return reply(200, {
        ...card,
        approved: Boolean(card.doctor_approved_at),
        approved_at: card.doctor_approved_at || null,
        label: card.doctor_approved_at ? "Approved by doctor" : "AI-generated draft, doctor to confirm",
        versions
      });
    }
    if (sub === "/call-card/generate" && method === "POST") {
      if (me.role !== "ADMIN" && me.role !== "DOCTOR") return reply(403, { detail: "Only clinicians can generate call cards" });
      if (!fuExists) return reply(404, { detail: "Follow-up not found." });
      const fu = store.followups.find(f => f.id === fid);
      const rep = store.reports.find(r => r.id === fu.report_id) || store.reports[0];
      const params = rep ? ((await kvGet(env, `report_params:${rep.id}`)) || []) : [];
      const abnormal = params.filter(p => p.system_flag === "LOW" || p.system_flag === "HIGH");
      const testsPhrase = abnormal.map(p => p.param_name_raw).join(", ") || "health check";
      const cardId = nextId(Object.values(store.callcards || {}));
      const now = new Date().toISOString();
      const cardContent = {
        schema_version: "1.0",
        language: "en",
        summary: { headline: `Health Follow-up for ${testsPhrase}`, report_date: rep?.collected_on || now, report_age_days: fu.report_age_days || 0, lab: rep?.lab_name || "Lab" },
        abnormal_findings: abnormal.map(p => ({
          param_code: p.param_code || "",
          name: p.param_name_raw || "",
          value: p.value_num !== null ? p.value_num : 0,
          unit: p.unit || "",
          ref_range: p.ref_text || "normal",
          direction: (p.system_flag || "high").toLowerCase(),
          severity: p.severity || "mild",
          trend_vs_previous: "none"
        })),
        retest: {
          tier: fu.retest_tier || "MEDIUM",
          score: fu.retest_score || 50,
          score_breakdown: fu.score_breakdown || [],
          reasons: (fu.buckets || []),
          recommended_tests: [{ test_code: "HBA1C", name: "HbA1c", rationale: "Routine monitor", priority: 1 }],
          not_needed: [],
          ideal_window: { from: now.slice(0, 10), to: now.slice(0, 10) },
          confidence: "medium"
        },
        doctor_script: {
          opening: "Hello, I am Dr. from SecondMedic reviewing your recent health checkup.",
          closing: "We will monitor your parameters and follow up.",
          next_followup_suggestion: "Suggested next review in 90 days",
          discussion_points: ["Discuss lifestyle, diet, and physical activity"],
          scientific_talking_points: abnormal.map(p => `${p.param_name_raw} is outside range`),
          questions_to_ask: ["Are you experiencing fatigue or unusual symptoms?"],
          counselling_points: ["Maintain balanced nutrition and regular hydration"],
          tests_to_suggest: ["Recommend HbA1c: Routine monitor"],
          red_flags: ["Chest discomfort", "Shortness of breath"]
        },
        caller_script: {
          opening: "Namaste, I am calling from SecondMedic regarding your recent diagnostic report.",
          identity_check: "May I please speak with the patient?",
          free_followup_pitch: "We have reviewed your health check and would like to arrange a complimentary follow-up consultation with our doctor to explain your results.",
          consent_request: "May I have your consent to connect you with our doctor?",
          slot_offer: "Would today afternoon or tomorrow morning be convenient for you?",
          objection_handling: [{ objection: "Is this free?", reply: "Yes, this follow-up consultation is completely complimentary." }],
          do_not_say: ["Do not diagnose any illness", "Do not discuss medicine dosages"],
          urgent_symptom_protocol: "If you feel severe pain or difficulty breathing, please seek emergency medical attention immediately.",
          closing: "Thank you for your time. Stay healthy!"
        },
        needs_doctor_review: true
      };
      const card = {
        id: cardId || 1,
        followup_id: fid,
        version: 1,
        language: "en",
        content: cardContent,
        model: "template-v1",
        prompt_version: "v1",
        validation_status: "VALID",
        validation_errors: [],
        notice: null,
        doctor_approved_by: null,
        doctor_approved_at: null,
        created_at: now,
        versions: []
      };
      if (!store.callcards) store.callcards = {};
      store.callcards[fid] = card;
      await saveStore(env, store);
      return reply(201, {
        ...card,
        approved: false,
        approved_at: null,
        label: "AI-generated draft, doctor to confirm",
        versions: [{ id: card.id, version: 1, validation_status: "VALID", edited_by: me.id, approved: false, created_at: now }]
      });
    }
    if (sub === "/caller-card" && method === "GET") {
      if (!fuExists) return reply(404, { detail: "Follow-up not found." });
      const card = store.callcards?.[fid] || store.call_cards?.[fid];
      if (!card) return reply(404, { detail: "No call card yet" });
      const fu = store.followups.find(f => f.id === fid);
      const pat = store.patients.find(p => p.id === fu?.patient_id) || { name: "Patient", mobile: "" };
      const progs = store.rules?.care_programs?.data || store.rules?.care_programs || DEFAULT_CARE_PROGRAMS;
      const cat = Object.fromEntries(progs.map(p => [p.code, p]));
      const programFollowups = [...new Set(
        (store.program_recommendations || [])
          .filter(r => r.patient_id === fu?.patient_id && ["SUGGESTED", "ACCEPTED"].includes(r.status) && cat[r.program_code]?.mode !== "DOCTOR_CONSIDER")
          .map(r => cat[r.program_code]?.caller_label)
          .filter(Boolean)
      )].sort();
      const comboRules = store.rules?.recommendation_combinations?.data || store.rules?.recommendation_combinations || DEFAULT_RECOMMENDATION_COMBINATIONS;
      const comboLabels = {};
      for (const cDef of Object.values(comboRules)) {
        for (const s of Object.values(cDef || {})) if (s?.target && s?.caller_label) comboLabels[s.target] = comboLabels[s.target] || s.caller_label;
      }
      const nextSteps = [...new Set(
        (store.program_recommendations || [])
          .filter(r => r.patient_id === fu?.patient_id && r.rank != null && ["SUGGESTED", "ACCEPTED", "ENROLLED"].includes(r.status) && cat[r.program_code]?.mode !== "DOCTOR_CONSIDER")
          .sort((a, b) => (a.rank - b.rank) || (a.id - b.id))
          .map(r => comboLabels[r.program_code] || cat[r.program_code]?.caller_label)
          .filter(Boolean)
      )];
      const hasDueRefill = (store.refill_schedules || []).some(s => s.patient_id === fu?.patient_id && s.status === "ACTIVE" && s.task_status === "DUE");
      const specialistBookings = (store.referrals || [])
        .filter(r => r.patient_id === fu?.patient_id && (r.status === "SUGGESTED" || r.status === "BOOKED"))
        .map(r => ({ id: r.id, label: "Specialist appointment to book", scheduled_for: r.scheduled_for || null, status: r.status }));
      const tmeta = getTierMeta(store.rules, fu?.protocol_tier || "LONG_TERM");
      const hasMon = (store.monitoring_schedules || []).some((s) => s.patient_id === fu?.patient_id && s.status === "ACTIVE");
      let monitoringDue = null;
      if (fu?.retest_plan?.source === "CONDITION" || hasMon) {
        const d = fu?.retest_window_start || fu?.due_on;
        monitoringDue = d ? `Monitoring due on ${String(d).slice(0, 10)}` : "Monitoring due";
      }
      const paramsMap = fu?.patient_id ? await loadParamsByReport(fu.patient_id) : {};
      const hasComp = Boolean(fu?.report_id && hasComparisonInStore(store, fu.patient_id, fu.report_id, paramsMap));
      const j = fu?.report_id ? buildJourneyInStore(store, fu.patient_id, fu.report_id, fu, paramsMap) : null;
      let jCallerLabel = null;
      if (j?.steps?.length) {
        const act = j.steps.find((s) => s.status === "DUE") || [...j.steps].reverse().find((s) => s.status === "DONE") || j.steps[0];
        jCallerLabel = act?.caller_label || null;
      }
      return reply(200, {
        followup_id: fid,
        patient_id: fu?.patient_id ?? null,
        patient_name: pat.name,
        mobile: mobileOut(pat.mobile, me),
        language: card.language || "en",
        notice: card.notice || null,
        report_age_days: card.content?.summary?.report_age_days || 0,
        reason_for_call: "Routine health check review",
        script: card.content?.caller_script || {},
        do_not_say: card.content?.caller_script?.do_not_say || [],
        priority: fu?.priority || "ROUTINE",
        protocol_tier_colour: tmeta.colour_token,
        protocol_tier_label: tmeta.caller_label,
        monitoring_due: monitoringDue,
        comparison_notice: hasComp ? "Results compared \u2014 doctor review scheduled" : null,
        comparison_date: hasComp ? String(fu?.due_on || todayIstStr()).slice(0, 10) : null,
        journey_caller_label: jCallerLabel,
        program_followups: programFollowups,
        next_steps: nextSteps,
        refill_reminder: hasDueRefill ? "Pharmacy refill reminder call" : null,
        specialist_bookings: specialistBookings
      });
    }
    if (sub === "/accept" && method === "POST") {
      const fu = store.followups.find(f => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found" });
      fu.accepted_at = new Date().toISOString();
      await saveStore(env, store);
      return reply(200, { accepted_at: fu.accepted_at });
    }
    if (sub === "/consent" && method === "POST") {
      const fu = store.followups.find(f => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found" });
      if (!store.consents) store.consents = {};
      const consentObj = { given_at: new Date().toISOString(), channel: me.role === "DOCTOR" ? "doctor_call" : "caller_call", script_version: "v1" };
      store.consents[fid] = consentObj;
      if (fu.stage === "NOT_CALLED" || fu.stage === "CALLED") fu.stage = "CONSENT_GIVEN";
      await saveStore(env, store);
      return reply(201, consentObj);
    }
    if (sub === "/calls" && method === "POST") {
      const fu = store.followups.find(f => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found" });
      const b = await request.json().catch(() => ({}));
      if (!store.workflows[fid]) store.workflows[fid] = { calls: [] };
      if (!store.workflows[fid].calls) store.workflows[fid].calls = [];
      const callLog = { outcome: b.outcome || "NOT_REACHABLE", role: me.role, notes: b.notes || "", started_at: new Date().toISOString() };
      store.workflows[fid].calls.unshift(callLog);
      fu.attempts = (fu.attempts || 0) + 1;
      if (b.outcome === "BOOKED") fu.stage = "BOOKED";
      else if (b.outcome) fu.stage = b.outcome;
      await saveStore(env, store);
      return reply(201, { stage: fu.stage, attempts: fu.attempts, appointment: null });
    }
    if (sub === "/doctor-outcome" && method === "POST") {
      const fu = store.followups.find(f => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found" });
      const b = await request.json().catch(() => ({}));
      if (b.outcome === "DOCTOR_DONE") {
        fu.stage = b.retest_codes && b.retest_codes.length > 0 ? "RETEST_RECOMMENDED" : "DOCTOR_DONE";
        if (b.retest_codes && b.retest_codes.length > 0) {
          if (!store.recommendations) store.recommendations = {};
          const exRec = store.recommendations[fid];
          if (exRec && exRec.source === "PROTOCOL") {
            exRec.test_codes = b.retest_codes;
            exRec.source = "DOCTOR";
          } else {
            store.recommendations[fid] = { id: nextId(Object.values(store.recommendations || {})), followup_id: fid, test_codes: b.retest_codes, ordered: false, ordered_ref: "", source: "DOCTOR" };
          }
        }
        if (b.next_followup_on) {
          const nf = String(b.next_followup_on).slice(0, 10);
          fu.next_followup_on = nf;
          if (fu.retest_status === "DOCTOR_TO_SET") {
            fu.due_on = nf;
            fu.retest_window_start = nf;
            fu.retest_window_end = nf;
            fu.retest_status = "DOCTOR_SET";
            fu.retest_plan = { ...(fu.retest_plan || {}), status: "DOCTOR_SET", label: "Doctor set retest date" };
          }
        }
      } else if (b.outcome === "RECALL_CALLER") {
        fu.stage = "CALL_LATER";
      }
      await saveStore(env, store);
      return reply(200, { stage: fu.stage });
    }
    if (sub === "/workflow" && method === "GET") {
      const w = store.workflows[fid] || { calls: [] };
      const consent = store.consents?.[fid] || null;
      const recs = store.recommendations?.[fid] ? [store.recommendations[fid]] : [];
      const fu = store.followups.find(f => f.id === fid);
      return reply(200, {
        stage: fu?.stage || "QUEUED",
        attempts: fu?.attempts || 0,
        suppressed_reason: fu?.suppressed_reason || "",
        call_later_at: fu?.call_later_at || null,
        consent,
        appointment: null,
        calls: w.calls || [],
        accepted_at: fu?.accepted_at || null,
        next_followup_on: fu?.next_followup_on || null,
        recommendations: recs
      });
    }
    if (sub === "/approve" && method === "POST") return reply(200, { ok: true, approved: true });
  }

  // --- RELATIONSHIP, HEALTH PROFILE & PROGRAMMES (Pages 1-4) ---
  const relMatch = path.match(/^\/patients\/(\d+)\/relationship$/);
  if (relMatch && method === "GET") {
    const pid = parseInt(relMatch[1], 10);
    const p = (store.patients || []).find((x) => x.id === pid);
    if (!p) return reply(404, { detail: "No such patient" });
    syncTouchpointsInStore(store, pid);
    const todayIso = todayIstStr();
    const thresholds = store.settings?.relationship_thresholds || DEFAULT_RELATIONSHIP_THRESHOLDS;
    const tps = (store.care_touchpoints || []).filter((t) => t.patient_id === pid).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.id - a.id);
    const fus = (store.followups || []).filter((f) => f.patient_id === pid);
    const hasOverdue = fus.some((f) => !f.suppressed_reason && !DONE_STAGES.has(f.stage) && (f.due_on || todayIso) < todayIso);
    const reports = (store.reports || []).filter((r) => r.patient_id === pid);
    const hasActiveBuckets = fus.some((f) => (f.buckets || []).length > 0);
    const statusStr = relationshipStatus(tps, hasOverdue, todayIso, thresholds);
    const nextStepRules = store.rules?.relationship_next_steps?.data || store.rules?.relationship_next_steps || DEFAULT_RELATIONSHIP_NEXT_STEPS;
    const nextStep = nextBestStep(tps, reports, hasActiveBuckets, statusStr, nextStepRules, todayIso);
    const lastOn = tps.length ? tps[0].occurred_on : null;
    recordAudit(store, me, "view", "relationship", pid);
    await saveStore(env, store);
    if (me.role === "CALLER") {
      return reply(200, {
        patient_id: pid,
        patient_name: p.name,
        mobile: mobileOut(p.mobile, me),
        status: statusStr,
        last_touchpoint_on: lastOn,
        next_step: nextStep ? { caller_label: nextStep.caller_label } : null
      });
    }
    const stages = STAGES.map((s) => {
      const m = tps.filter((t) => t.stage === s);
      return { stage: s, count: m.length, last_occurred_on: m.length ? m[0].occurred_on : null };
    });
    const services = (store.settings?.care_services || DEFAULT_CARE_SERVICES).map((s) => ({
      code: s.code,
      name: s.name,
      stage: s.stage,
      ...(me.role === "ADMIN" ? { default_amount_inr: s.default_amount_inr } : {})
    }));
    const out = {
      patient_id: pid,
      status: statusStr,
      last_touchpoint_on: lastOn,
      next_step: nextStep,
      stages,
      touchpoints: tps.map((t) => me.role === "ADMIN" ? t : { id: t.id, patient_id: t.patient_id, stage: t.stage, service_code: t.service_code, occurred_on: t.occurred_on, source: t.source, created_at: t.created_at }),
      services
    };
    if (me.role === "ADMIN") out.total_amount_inr = tps.reduce((s, t) => s + (Number(t.amount_inr) || 0), 0);
    return reply(200, out);
  }

  const tpPostMatch = path.match(/^\/patients\/(\d+)\/touchpoints$/);
  if (tpPostMatch && method === "POST") {
    const pid = parseInt(tpPostMatch[1], 10);
    const p = (store.patients || []).find((x) => x.id === pid);
    if (!p) return reply(404, { detail: "No such patient" });
    const b = await request.json().catch(() => ({}));
    const services = store.settings?.care_services || DEFAULT_CARE_SERVICES;
    const svc = services.find((s) => s.code === String(b.service_code || "").trim().toUpperCase());
    if (!svc || !STAGES.includes(svc.stage)) return reply(422, { detail: "Unknown service_code" });
    const amt = me.role === "ADMIN" && b.amount_inr !== undefined && b.amount_inr !== null ? Number(b.amount_inr) : svc.default_amount_inr;
    if (!store.care_touchpoints) store.care_touchpoints = [];
    const tp = {
      id: nextId(store.care_touchpoints),
      patient_id: pid,
      stage: svc.stage,
      service_code: svc.code,
      occurred_on: String(b.occurred_on || todayIstStr()).slice(0, 10),
      source: "MANUAL",
      ref_entity: "manual",
      ref_id: null,
      amount_inr: amt,
      health_hub_id: b.health_hub_id ?? null,
      created_at: new Date().toISOString()
    };
    store.care_touchpoints.unshift(tp);
    recordAudit(store, me, "create", "touchpoint", tp.id);
    await saveStore(env, store);
    return reply(201, me.role === "ADMIN" ? tp : { id: tp.id, patient_id: tp.patient_id, stage: tp.stage, service_code: tp.service_code, occurred_on: tp.occurred_on, source: tp.source, created_at: tp.created_at });
  }

  const tpDelMatch = path.match(/^\/touchpoints\/(\d+)$/);
  if (tpDelMatch && method === "DELETE") {
    const tid = parseInt(tpDelMatch[1], 10);
    const tp = (store.care_touchpoints || []).find((t) => t.id === tid);
    if (!tp) return reply(404, { detail: "No such touchpoint" });
    if (tp.source !== "MANUAL") return reply(409, { detail: "Only manual touchpoints can be deleted" });
    store.care_touchpoints = store.care_touchpoints.filter((t) => t.id !== tid);
    recordAudit(store, me, "delete", "touchpoint", tid);
    await saveStore(env, store);
    return reply(200, { ok: true });
  }

  if (path === "/relationship/summary" && method === "GET") {
    const todayIso = todayIstStr();
    const thresholds = store.settings?.relationship_thresholds || DEFAULT_RELATIONSHIP_THRESHOLDS;
    const patients = store.patients || [];
    const counts = { NEW: 0, ACTIVE: 0, AT_RISK: 0, LAPSED: 0 };
    const stagePatients = Object.fromEntries(STAGES.map((s) => [s, new Set()]));
    let activeStageSum = 0;
    let annualInr = 0;
    for (const p of patients) {
      syncTouchpointsInStore(store, p.id, todayIso);
      const tps = (store.care_touchpoints || []).filter((t) => t.patient_id === p.id);
      const fus = (store.followups || []).filter((f) => f.patient_id === p.id);
      const hasOverdue = fus.some((f) => !f.suppressed_reason && !DONE_STAGES.has(f.stage) && (f.due_on || todayIso) < todayIso);
      const st = relationshipStatus(tps, hasOverdue, todayIso, thresholds);
      counts[st] += 1;
      const dist = new Set(tps.map((t) => t.stage));
      for (const s of dist) if (stagePatients[s]) stagePatients[s].add(p.id);
      if (st === "NEW" || st === "ACTIVE") {
        activeStageSum += dist.size;
        annualInr += tps.reduce((s, t) => s + (Number(t.amount_inr) || 0), 0);
      }
    }
    const activeN = counts.NEW + counts.ACTIVE;
    const totalP = patients.length;
    return reply(200, {
      total_patients: totalP,
      counts,
      retention_12m_pct: null,
      avg_stages_per_active: activeN ? Math.round((activeStageSum / activeN) * 100) / 100 : 0,
      annual_contribution_inr: activeN ? Math.round((annualInr / activeN) * 100) / 100 : 0,
      stage_coverage_pct: Object.fromEntries(STAGES.map((s) => [s, totalP ? Math.round((1000 * stagePatients[s].size) / totalP) / 10 : 0]))
    });
  }

  const hpMatch = path.match(/^\/patients\/(\d+)\/health-profile$/);
  if (hpMatch) {
    const pid = parseInt(hpMatch[1], 10);
    const p = (store.patients || []).find((x) => x.id === pid);
    if (!p) return reply(404, { detail: "No such patient" });
    if (!store.health_profiles) store.health_profiles = {};
    if (method === "GET") {
      const cur = store.health_profiles[pid];
      recordAudit(store, me, "view", "health_profile", pid);
      await saveStore(env, store);
      return reply(200, { patient_id: pid, exists: Boolean(cur), updated_at: cur?.updated_at || null, ...cleanProfile(cur) });
    }
    if (method === "PUT") {
      const b = await request.json().catch(() => ({}));
      const cur = store.health_profiles[pid];
      const curClean = cleanProfile(cur);
      if (b.conditions !== undefined && me.role !== "DOCTOR") {
        const inc = cleanProfile({ conditions: b.conditions }).conditions;
        const norm = (arr) => JSON.stringify((arr || []).map((c) => [c.code, c.status, c.stage || "", c.since || ""]));
        if (norm(curClean.conditions) !== norm(inc)) {
          return reply(403, { detail: "Only a doctor can confirm, change, or remove conditions" });
        }
      }
      if (b.targets !== undefined && me.role !== "DOCTOR") {
        const incT = cleanProfile({ targets: b.targets }).targets;
        if (JSON.stringify(curClean.targets || {}) !== JSON.stringify(incT || {})) {
          return reply(403, { detail: "Only a doctor can set or change per-patient clinical targets" });
        }
      }
      const mergedBody = { ...(b || {}) };
      if (mergedBody.conditions === undefined && cur) mergedBody.conditions = curClean.conditions;
      if (mergedBody.targets === undefined && cur) mergedBody.targets = curClean.targets;
      let cleaned;
      try {
        cleaned = cleanProfile(mergedBody);
      } catch (err) {
        return reply(422, { detail: err.message });
      }
      cleaned.updated_at = new Date().toISOString();
      store.health_profiles[pid] = cleaned;
      const latestRep = (store.reports || []).find((r) => r.patient_id === pid && r.status === "READY") || (store.reports || []).find((r) => r.patient_id === pid);
      const params = latestRep ? ((await kvGet(env, `report_params:${latestRep.id}`)) || []) : [];
      syncTouchpointsInStore(store, pid);
      await syncProgramsInStore(env, store, pid, latestRep?.id || null, params);
      recordAudit(store, me, "update", "health_profile", pid);
      await saveStore(env, store);
      return reply(200, { patient_id: pid, exists: true, updated_at: cleaned.updated_at, ...cleaned });
    }
  }

  async function buildConditionsSummary(pid) {
    if (!store.health_profiles) store.health_profiles = {};
    if (!store.monitoring_schedules) store.monitoring_schedules = [];
    if (!store.clinical_tasks) store.clinical_tasks = [];
    const profile = cleanProfile(store.health_profiles[pid]);
    const rules = store.rules || {};
    const cProtos = conditionProtoMap(rules);
    const paramsByReport = {};
    for (const r of (store.reports || []).filter((x) => x.patient_id === pid && x.status === "READY")) {
      paramsByReport[r.id] = (await kvGet(env, `report_params:${r.id}`)) || [];
    }
    const openFu = (store.followups || [])
      .filter((f) => f.patient_id === pid && !f.suppressed_reason && !DONE_STAGES.has(f.stage))
      .sort((a, b) => b.id - a.id)[0] || null;
    const plan = openFu?.retest_plan || {};
    const schedByCond = {};
    for (const s of [...(plan.findings || []), ...(plan.non_lab_protocols || [])]) {
      if (s?.condition_code) schedByCond[s.condition_code] = s;
    }
    const medList = rules.medicine_catalogue?.data || rules.medicine_catalogue || DEFAULT_MEDICINE_CATALOGUE;
    const medCat = Object.fromEntries(medList.map((m) => [m.code, m]));
    const catNames = Object.fromEntries((rules.test_catalogue?.data || rules.test_catalogue || DEFAULT_TEST_CATALOGUE_P7).map((t) => [t.code, t.name]));
    const activeMeds = (store.patient_medications || []).filter((m) => m.patient_id === pid && !m.stopped_on);

    const confirmed = (profile.conditions || []).filter((c) => c.status === "CONFIRMED").map((c) => {
      const meta = cProtos[c.code] || {};
      let activeSched = schedByCond[c.code];
      if (!activeSched && cProtos[c.code]) {
        activeSched = evaluateConditionProtocol({
          proto: cProtos[c.code], reportDateIst: todayIstStr(), followup: openFu,
          ctx: { profile, activeMeds }, medCat, params: [], catNames, cStage: c.stage || "",
        });
      }
      const nextDate = activeSched?.window_start || openFu?.next_followup_on || null;
      return {
        code: c.code,
        condition_name: meta.condition_name || c.code,
        status: c.status,
        stage: c.stage || "",
        since: c.since || "",
        confirmed_by: c.confirmed_by ?? null,
        icon: meta.icon || "",
        icon_label: meta.icon_label || "",
        timeframe_text: meta.timeframe_text || "",
        note: meta.note || "",
        tier: activeSched?.tier || meta.tier || "LONG_TERM",
        active_protocol: activeSched || null,
        next_test_date: nextDate,
        stage_options: CONDITION_STAGE_OPTIONS[c.code] || [],
      };
    });

    const suggested = suggestConditionsInStore(store, pid, paramsByReport);
    const monitoringSchedules = store.monitoring_schedules.filter((s) => s.patient_id === pid).sort((a, b) => b.id - a.id);
    const clinicalTasks = store.clinical_tasks.filter((t) => t.patient_id === pid).sort((a, b) => b.id - a.id);
    const [tgtOp, tgtVal] = hba1cTarget(rules, profile);
    const catalogue = DEFAULT_CONDITION_PROTOCOLS.filter((p) => cProtos[p.condition_code]).map((p) => ({
      code: p.condition_code,
      condition_name: cProtos[p.condition_code].condition_name || p.condition_code,
      icon: cProtos[p.condition_code].icon || "",
      timeframe_text: cProtos[p.condition_code].timeframe_text || "",
      stage_options: CONDITION_STAGE_OPTIONS[p.condition_code] || [],
    }));
    return {
      patient_id: pid,
      confirmed,
      suggested,
      monitoring_schedules: monitoringSchedules,
      clinical_tasks: clinicalTasks,
      hba1c_target: { target_op: tgtOp, target_value: tgtVal, unit: "%" },
      catalogue,
    };
  }

  const patCondMatch = path.match(/^\/patients\/(\d+)\/conditions(?:\/([A-Za-z0-9_]+))?$/);
  if (patCondMatch) {
    const pid = parseInt(patCondMatch[1], 10);
    const condCodeParam = patCondMatch[2];
    const p = (store.patients || []).find((x) => x.id === pid);
    if (!p) return reply(404, { detail: "No such patient" });
    if (!store.health_profiles) store.health_profiles = {};
    if (!store.monitoring_schedules) store.monitoring_schedules = [];
    if (!store.clinical_tasks) store.clinical_tasks = [];

    if (!condCodeParam && method === "GET") {
      const out = await buildConditionsSummary(pid);
      recordAudit(store, me, "view", "patient_conditions", pid);
      await saveStore(env, store);
      return reply(200, out);
    }
    if (!condCodeParam && method === "POST") {
      if (me.role !== "DOCTOR") return reply(403, { detail: "Only a doctor can confirm or update conditions" });
      const b = await request.json().catch(() => ({}));
      const code = String(b.code || "").trim().toUpperCase();
      if (!validConditionCodes(store.rules).has(code)) return reply(422, { detail: `Unknown condition code: ${code}` });
      const profile = cleanProfile(store.health_profiles[pid]);
      const family = new Set(CONDITION_FAMILIES[code] || [code]);
      const replaced = (profile.conditions || []).filter((c) => family.has(c.code) && c.code !== code).map((c) => c.code);
      const kept = (profile.conditions || []).filter((c) => !family.has(c.code));
      const today = todayIstStr();
      const defStage = (CONDITION_STAGE_OPTIONS[code] || [{ value: "CONFIRMED" }])[0].value;
      kept.push({
        code,
        status: "CONFIRMED",
        stage: String(b.stage || "").trim().slice(0, 30) || defStage,
        since: String(b.since || "").trim().slice(0, 20) || today,
        confirmed_by: me.id,
      });
      profile.conditions = kept;
      profile.updated_at = new Date().toISOString();
      store.health_profiles[pid] = profile;

      if (code === "HYPERTENSION") {
        if (!store.monitoring_schedules.some((s) => s.patient_id === pid && s.condition_code === "HYPERTENSION" && s.status === "ACTIVE")) {
          store.monitoring_schedules.push({
            id: nextId(store.monitoring_schedules),
            patient_id: pid,
            condition_code: "HYPERTENSION",
            kind: "BP",
            frequency_per_day: 2,
            duration_days: 7,
            start_on: today,
            end_on: addDaysIso(today, 6),
            slots: ["MORNING", "EVENING"],
            status: "ACTIVE",
            last_reminded_on: null,
            note: "starter value, clinician to confirm",
            created_by: me.id,
            created_at: new Date().toISOString(),
          });
        }
        if (!store.clinical_tasks.some((t) => t.patient_id === pid && t.condition_code === "HYPERTENSION" && t.task_type === "CHOOSE_LAB_TESTS" && t.status === "OPEN")) {
          const openFu = (store.followups || []).find((f) => f.patient_id === pid && !f.suppressed_reason && !DONE_STAGES.has(f.stage));
          store.clinical_tasks.push({
            id: nextId(store.clinical_tasks),
            patient_id: pid,
            followup_id: openFu?.id || null,
            condition_code: "HYPERTENSION",
            task_type: "CHOOSE_LAB_TESTS",
            title: "Choose lab tests for hypertension",
            details: "Select laboratory tests based on current medicines and comorbidities.",
            selected_tests: [],
            status: "OPEN",
            assigned_doctor_id: openFu?.assigned_doctor_id || null,
            created_at: new Date().toISOString(),
          });
          if (!store.notifications) store.notifications = { unread: 0, items: [] };
          store.notifications.unread = (store.notifications.unread || 0) + 1;
          store.notifications.items.unshift({
            id: nextId(store.notifications.items),
            text: "Choose lab tests for confirmed condition",
            link: `/patients/view?id=${pid}`,
            urgent: false,
            read: false,
            at: new Date().toISOString(),
          });
        }
      }
      await reevalPatient(pid);
      recordAudit(store, me, replaced.length ? "condition_stage_change" : "condition_confirm", "patient_condition", (replaced.length ? `${pid}:${replaced[0]}->${code}` : `${pid}:${code}`).slice(0, 60));
      const out = await buildConditionsSummary(pid);
      await saveStore(env, store);
      return reply(200, out);
    }
    if (condCodeParam && method === "DELETE") {
      if (me.role !== "DOCTOR") return reply(403, { detail: "Only a doctor can confirm, change, or remove conditions" });
      const code = condCodeParam.trim().toUpperCase();
      const profile = cleanProfile(store.health_profiles[pid]);
      const kept = (profile.conditions || []).filter((c) => c.code !== code);
      if (kept.length === (profile.conditions || []).length) return reply(404, { detail: "Condition is not confirmed on this patient" });
      profile.conditions = kept;
      profile.updated_at = new Date().toISOString();
      store.health_profiles[pid] = profile;
      if (code === "HYPERTENSION") {
        for (const s of store.monitoring_schedules) {
          if (s.patient_id === pid && s.condition_code === "HYPERTENSION" && s.status === "ACTIVE") s.status = "CANCELLED";
        }
        for (const t of store.clinical_tasks) {
          if (t.patient_id === pid && t.condition_code === "HYPERTENSION" && t.status === "OPEN") t.status = "DISMISSED";
        }
      }
      await reevalPatient(pid);
      recordAudit(store, me, "condition_remove", "patient_condition", `${pid}:${code}`.slice(0, 60));
      const out = await buildConditionsSummary(pid);
      await saveStore(env, store);
      return reply(200, out);
    }
  }

  const taskCompMatch = path.match(/^\/clinical-tasks\/(\d+)\/complete$/);
  if (taskCompMatch && method === "POST") {
    if (me.role !== "DOCTOR") return reply(403, { detail: "Only a doctor can complete this clinical task" });
    const tid = parseInt(taskCompMatch[1], 10);
    const task = (store.clinical_tasks || []).find((t) => t.id === tid);
    if (!task) return reply(404, { detail: "No such clinical task" });
    const b = await request.json().catch(() => ({}));
    const catList = store.rules?.test_catalogue?.data || store.rules?.test_catalogue || DEFAULT_TEST_CATALOGUE_P7;
    const cat = new Set(catList.map((t) => t.code));
    const cleanTests = [...new Set((b.test_codes || []).map((x) => String(x || "").trim().toUpperCase()).filter(Boolean))].sort();
    const unknown = cleanTests.filter((tc) => !cat.has(tc));
    if (unknown.length) return reply(422, { detail: `Unknown test code(s): ${unknown.join(", ")}` });
    if (!cleanTests.length) return reply(422, { detail: "Select at least one test" });
    task.selected_tests = cleanTests;
    task.status = "DONE";
    task.completed_by = me.id;
    task.completed_at = new Date().toISOString();
    if (task.followup_id) {
      if (!store.recommendations) store.recommendations = {};
      const ex = store.recommendations[task.followup_id];
      if (ex && ex.source === "DOCTOR") {
        ex.test_codes = [...new Set([...(ex.test_codes || []), ...cleanTests])].sort();
      } else {
        store.recommendations[task.followup_id] = {
          id: nextId(Object.values(store.recommendations)),
          followup_id: task.followup_id,
          test_codes: cleanTests,
          ordered: false,
          ordered_ref: "",
          source: "DOCTOR",
        };
      }
    }
    recordAudit(store, me, "clinical_task_complete", "clinical_task", `${task.id}:${cleanTests.length}`);
    await saveStore(env, store);
    return reply(200, { id: task.id, status: task.status, selected_tests: task.selected_tests, completed_at: task.completed_at });
  }

  const patProgMatch = path.match(/^\/patients\/(\d+)\/programs$/);
  if (patProgMatch && method === "GET") {
    const pid = parseInt(patProgMatch[1], 10);
    const p = (store.patients || []).find((x) => x.id === pid);
    if (!p) return reply(404, { detail: "No such patient" });
    const progs = store.rules?.care_programs?.data || store.rules?.care_programs || DEFAULT_CARE_PROGRAMS;
    const cat = Object.fromEntries(progs.map((x) => [x.code, x]));
    const comboRules = store.rules?.recommendation_combinations?.data || store.rules?.recommendation_combinations || DEFAULT_RECOMMENDATION_COMBINATIONS;
    const comboMeta = {};
    for (const cDef of Object.values(comboRules)) {
      for (const s of Object.values(cDef || {})) if (s?.target) comboMeta[s.target] = comboMeta[s.target] || s;
    }
    const recs = (store.program_recommendations || []).filter((r) => r.patient_id === pid);
    recordAudit(store, me, "view", "program_recommendations", pid);
    await saveStore(env, store);
    if (me.role === "CALLER") {
      return reply(200, recs
        .filter((r) => cat[r.program_code]?.mode !== "DOCTOR_CONSIDER" && r.status !== "EXPIRED")
        .map((r) => ({
          caller_label: cat[r.program_code]?.caller_label || comboMeta[r.program_code]?.caller_label || "Wellness plan follow-up",
          status: r.status
        })));
    }
    const activeBuckets = new Set((store.followups || []).filter((f) => f.patient_id === pid).flatMap((f) => f.buckets || []));
    const items = recs.map((r) => {
      const meta = cat[r.program_code] || {};
      const cMeta = comboMeta[r.program_code] || {};
      const linked = meta.linked_bucket || "";
      return {
        id: r.id,
        patient_id: r.patient_id,
        followup_id: r.followup_id,
        report_id: r.report_id,
        program_code: r.program_code,
        doc_number: meta.doc_number || "",
        group: meta.group || "",
        clinical_label: meta.clinical_label || cMeta.label || r.program_code,
        caller_label: meta.caller_label || cMeta.caller_label || "",
        trigger_text: meta.trigger_text || "",
        offering_text: meta.offering_text || "",
        loop_stage: meta.loop_stage || SERVICE_LOOP_STAGE[r.program_code] || "",
        mode: meta.mode || "AUTO_SUGGEST",
        linked_bucket: linked,
        is_primary_for_bucket: Boolean(linked && activeBuckets.has(linked)),
        specialty: meta.specialty || "",
        rank: r.rank ?? null,
        finding_code: r.finding_code || "",
        rule_version: r.rule_version || 1,
        status: r.status,
        matched_rules: r.reason_codes || [],
        missing_data: r.missing_data || [],
        notes: r.notes || [],
        decline_reason_code: r.decline_reason_code || "",
        decided_at: r.decided_at || null
      };
    });
    items.sort((a, b) => (a.is_primary_for_bucket === b.is_primary_for_bucket ? 0 : a.is_primary_for_bucket ? -1 : 1) || ((a.rank ?? 99) - (b.rank ?? 99)) || a.doc_number.localeCompare(b.doc_number) || a.id - b.id);
    return reply(200, items);
  }

  const progDecMatch = path.match(/^\/program-recommendations\/(\d+)\/decision$/);
  if (progDecMatch && method === "POST") {
    const recId = parseInt(progDecMatch[1], 10);
    const rec = (store.program_recommendations || []).find((r) => r.id === recId);
    if (!rec) return reply(404, { detail: "No such recommendation" });
    const b = await request.json().catch(() => ({}));
    const decision = String(b.decision || "").trim().toUpperCase();
    if (!["ACCEPTED", "ENROLLED", "DECLINED", "DISCUSS_LATER"].includes(decision)) return reply(422, { detail: "Decision must be ACCEPTED, ENROLLED, DECLINED or DISCUSS_LATER" });
    const progs = store.rules?.care_programs?.data || store.rules?.care_programs || DEFAULT_CARE_PROGRAMS;
    const meta = progs.find((x) => x.code === rec.program_code) || {};
    const reasonCode = String(b.reason_code || "").trim().toUpperCase().slice(0, 40);
    if (decision === "DECLINED" && meta.mode === "DOCTOR_CONSIDER" && !reasonCode) {
      return reply(422, { detail: "Select a reason code when marking a consider item as not suitable" });
    }
    rec.status = decision;
    rec.decided_by = me.id;
    rec.decided_at = new Date().toISOString();
    rec.decline_reason_code = decision === "DECLINED" ? reasonCode : "";
    if (decision === "ACCEPTED" || decision === "ENROLLED") {
      if (!store.care_touchpoints) store.care_touchpoints = [];
      const stage = meta.loop_stage || SERVICE_LOOP_STAGE[rec.program_code] || "PREVENTION";
      if (!store.care_touchpoints.some((t) => t.patient_id === rec.patient_id && t.ref_entity === "program_recommendation" && t.ref_id === rec.id && t.stage === stage)) {
        store.care_touchpoints.unshift({
          id: nextId(store.care_touchpoints),
          patient_id: rec.patient_id,
          stage,
          service_code: rec.program_code,
          occurred_on: todayIstStr(),
          source: "MANUAL",
          ref_entity: "program_recommendation",
          ref_id: rec.id,
          amount_inr: null,
          created_at: new Date().toISOString()
        });
      }
      if (meta.specialty) {
        if (!store.referrals) store.referrals = [];
        const hasRef = store.referrals.some((r) => r.patient_id === rec.patient_id && r.reason_code === rec.program_code && r.status !== "DECLINED");
        if (!hasRef) {
          store.referrals.push({
            id: nextId(store.referrals),
            patient_id: rec.patient_id,
            followup_id: rec.followup_id ?? null,
            specialty: meta.specialty,
            reason_code: rec.program_code,
            urgency: "ROUTINE",
            status: "SUGGESTED",
            appointment_ref: "",
            scheduled_for: null,
            created_by: me.id,
            created_at: new Date().toISOString()
          });
        }
      }
      if ((rec.program_code === "FOLLOWUP_DIAGNOSTIC" || rec.program_code === "RETEST") && rec.followup_id) {
        if (!store.recommendations) store.recommendations = {};
        if (!store.recommendations[rec.followup_id]) {
          const fu = (store.followups || []).find((f) => f.id === rec.followup_id);
          const bucketsList = fu?.buckets || [];
          const bRules = store.rules?.buckets?.data || store.rules?.buckets || [];
          const catList = store.rules?.test_catalogue?.data || store.rules?.test_catalogue || [];
          const validCodes = new Set(catList.map((t) => t.code));
          const bMap = Object.fromEntries(bRules.map((b) => [b.code, b.retest || []]));
          const tests = [...new Set(bucketsList.flatMap((b) => bMap[b] || []).filter((tc) => !validCodes.size || validCodes.has(tc)))].sort();
          if (tests.length) {
            store.recommendations[rec.followup_id] = {
              id: nextId(Object.values(store.recommendations || {})),
              followup_id: rec.followup_id,
              test_codes: tests,
              ordered: false,
              ordered_ref: ""
            };
          }
        }
      }
      if (rec.program_code === "TREATMENT_RESPONSE" && rec.followup_id) {
        const fu = (store.followups || []).find((f) => f.id === rec.followup_id);
        if (fu && !fu.next_followup_on) fu.next_followup_on = addDaysIso(todayIstStr(), 30);
      }
    }
    recordAudit(store, me, `program_${decision.toLowerCase()}`, "program_recommendation", rec.id);
    await saveStore(env, store);
    return reply(200, {
      id: rec.id,
      status: rec.status,
      decline_reason_code: rec.decline_reason_code,
      decided_at: rec.decided_at,
      suggested_specialty: (decision === "ACCEPTED" || decision === "ENROLLED") ? (meta.specialty || "") : ""
    });
  }

  // --- EXTENDED CARE & FAMILY CARE (Page 5) ---
  function medOut(m, catMap, sched) {
    const meta = catMap[m.medicine_code] || {};
    return {
      id: m.id,
      patient_id: m.patient_id,
      medicine_code: m.medicine_code,
      generic_name: meta.generic_name || m.medicine_code,
      drug_class: meta.drug_class || "",
      is_chronic: Boolean(meta.is_chronic),
      dose_text: m.dose_text || "",
      started_on: m.started_on,
      last_changed_on: m.last_changed_on,
      stopped_on: m.stopped_on || null,
      prescribed_by: m.prescribed_by || "",
      source: m.source || "DOCTOR",
      refill: sched ? {
        id: sched.id,
        refill_every_days: sched.refill_every_days,
        next_refill_on: sched.next_refill_on,
        delivery_mode: sched.delivery_mode,
        delivery_ref: sched.delivery_ref || "",
        status: sched.status,
        task_status: sched.task_status
      } : null
    };
  }

  async function reevalPatient(pid) {
    const rep = (store.reports || []).find((r) => r.patient_id === pid && r.status === "READY") || (store.reports || []).find((r) => r.patient_id === pid);
    const pList = rep ? ((await kvGet(env, `report_params:${rep.id}`)) || []) : [];
    syncTouchpointsInStore(store, pid);
    await syncProgramsInStore(env, store, pid, rep?.id || null, pList);
  }

  const patMedsMatch = path.match(/^\/patients\/(\d+)\/medicines$/);
  if (patMedsMatch) {
    const pid = parseInt(patMedsMatch[1], 10);
    const pat = (store.patients || []).find((p) => p.id === pid);
    if (!pat) return reply(404, { detail: "No such patient" });
    if (!store.patient_medications) store.patient_medications = [];
    if (!store.refill_schedules) store.refill_schedules = [];
    const catList = store.rules?.medicine_catalogue?.data || store.rules?.medicine_catalogue || DEFAULT_MEDICINE_CATALOGUE;
    const catMap = Object.fromEntries(catList.map((m) => [m.code, m]));
    if (method === "GET") {
      const meds = store.patient_medications.filter((m) => m.patient_id === pid).sort((a, b) => b.id - a.id);
      const schedMap = Object.fromEntries(store.refill_schedules.filter((s) => s.patient_id === pid).map((s) => [s.patient_medication_id, s]));
      recordAudit(store, me, "view", "patient_medicines", pid);
      await saveStore(env, store);
      return reply(200, meds.map((m) => medOut(m, catMap, schedMap[m.id])));
    }
    if (method === "POST") {
      const b = await request.json().catch(() => ({}));
      const code = String(b.medicine_code || "").trim().toUpperCase();
      if (!catMap[code]) return reply(422, { detail: `Unknown medicine_code: ${code}` });
      const source = b.source || "DOCTOR";
      if (!["DOCTOR", "PATIENT_REPORTED"].includes(source)) return reply(422, { detail: "source must be DOCTOR or PATIENT_REPORTED" });
      const deliveryMode = b.delivery_mode || "HOME_DELIVERY";
      if (!["HOME_DELIVERY", "PICKUP_AT_HUB"].includes(deliveryMode)) return reply(422, { detail: "delivery_mode must be HOME_DELIVERY or PICKUP_AT_HUB" });
      const start = (b.started_on && String(b.started_on).slice(0, 10)) || todayIstStr();
      const med = {
        id: nextId(store.patient_medications),
        patient_id: pid,
        medicine_code: code,
        dose_text: String(b.dose_text || "").trim().slice(0, 120),
        started_on: start,
        last_changed_on: start,
        stopped_on: null,
        prescribed_by: String(b.prescribed_by || "").trim().slice(0, 120),
        source,
        created_by: me.id,
        created_at: new Date().toISOString()
      };
      store.patient_medications.push(med);
      let sched = null;
      const meta = catMap[code];
      const every = b.refill_every_days || meta.default_refill_days;
      if (meta.is_chronic || b.refill_every_days) {
        const days = Math.max(1, parseInt(every || 30, 10));
        sched = {
          id: nextId(store.refill_schedules),
          patient_medication_id: med.id,
          patient_id: pid,
          refill_every_days: days,
          next_refill_on: addDaysIso(start, days),
          delivery_mode: deliveryMode,
          delivery_ref: "",
          status: "ACTIVE",
          reminder_sent_for: null,
          task_due_on: null,
          task_status: "PENDING"
        };
        store.refill_schedules.push(sched);
      }
      await reevalPatient(pid);
      recordAudit(store, me, "create", "patient_medication", med.id);
      await saveStore(env, store);
      return reply(201, medOut(med, catMap, sched));
    }
  }

  const medPatchMatch = path.match(/^\/medicines\/(\d+)$/);
  if (medPatchMatch && method === "PATCH") {
    const mid = parseInt(medPatchMatch[1], 10);
    const med = (store.patient_medications || []).find((m) => m.id === mid);
    if (!med) return reply(404, { detail: "No such medication" });
    const b = await request.json().catch(() => ({}));
    if (b.dose_text !== undefined && b.dose_text !== null) {
      med.dose_text = String(b.dose_text).trim().slice(0, 120);
      med.last_changed_on = (b.last_changed_on && String(b.last_changed_on).slice(0, 10)) || todayIstStr();
    } else if (b.last_changed_on) {
      med.last_changed_on = String(b.last_changed_on).slice(0, 10);
    }
    const sched = (store.refill_schedules || []).find((s) => s.patient_medication_id === med.id) || null;
    if (b.stopped_on) {
      med.stopped_on = String(b.stopped_on).slice(0, 10);
      if (sched) sched.status = "STOPPED";
    }
    if (b.delivery_mode && sched) {
      if (!["HOME_DELIVERY", "PICKUP_AT_HUB"].includes(b.delivery_mode)) return reply(422, { detail: "Invalid delivery_mode" });
      sched.delivery_mode = b.delivery_mode;
    }
    await reevalPatient(med.patient_id);
    recordAudit(store, me, "update", "patient_medication", med.id);
    await saveStore(env, store);
    const catList = store.rules?.medicine_catalogue?.data || store.rules?.medicine_catalogue || DEFAULT_MEDICINE_CATALOGUE;
    return reply(200, medOut(med, Object.fromEntries(catList.map((m) => [m.code, m])), sched));
  }

  if (path === "/refill-tasks" && method === "GET") {
    const tasks = (store.refill_schedules || [])
      .filter((s) => s.status === "ACTIVE" && s.task_status === "DUE")
      .sort((a, b) => String(a.next_refill_on || "").localeCompare(String(b.next_refill_on || "")) || a.id - b.id)
      .map((s) => {
        const pat = (store.patients || []).find((p) => p.id === s.patient_id) || { id: s.patient_id, name: "Patient", mobile: "" };
        return {
          id: s.id,
          patient_id: pat.id,
          patient_name: pat.name,
          mobile: mobileOut(pat.mobile, me),
          label: "Pharmacy refill reminder call",
          next_refill_on: s.next_refill_on,
          task_due_on: s.task_due_on,
          delivery_mode: s.delivery_mode,
          status: s.task_status
        };
      });
    return reply(200, tasks);
  }

  const refillConfirmMatch = path.match(/^\/refill-schedules\/(\d+)\/confirm$/);
  if (refillConfirmMatch && method === "POST") {
    const sid = parseInt(refillConfirmMatch[1], 10);
    const s = (store.refill_schedules || []).find((x) => x.id === sid);
    if (!s) return reply(404, { detail: "No such refill schedule" });
    const b = await request.json().catch(() => ({}));
    s.delivery_ref = String(b.delivery_ref || "").trim().slice(0, 60);
    const todayIso = todayIstStr();
    const base = s.next_refill_on && s.next_refill_on > todayIso ? s.next_refill_on : todayIso;
    s.next_refill_on = addDaysIso(base, s.refill_every_days || 30);
    s.task_status = "DONE";
    if (!store.care_touchpoints) store.care_touchpoints = [];
    store.care_touchpoints.unshift({
      id: nextId(store.care_touchpoints),
      patient_id: s.patient_id,
      stage: "MEDICATIONS",
      service_code: "PHARMACY_REFILL",
      occurred_on: todayIso,
      source: "MANUAL",
      ref_entity: "refill",
      ref_id: s.id,
      amount_inr: me.role === "ADMIN" && b.amount_inr !== undefined && b.amount_inr !== null ? Number(b.amount_inr) : null,
      created_at: new Date().toISOString()
    });
    recordAudit(store, me, "refill_confirm", "refill_schedule", s.id);
    await saveStore(env, store);
    return reply(200, { id: s.id, next_refill_on: s.next_refill_on, delivery_ref: s.delivery_ref, task_status: s.task_status });
  }

  const patRefMatch = path.match(/^\/patients\/(\d+)\/referrals$/);
  if (patRefMatch) {
    const pid = parseInt(patRefMatch[1], 10);
    const pat = (store.patients || []).find((p) => p.id === pid);
    if (!pat) return reply(404, { detail: "No such patient" });
    if (!store.referrals) store.referrals = [];
    const specs = store.rules?.referral_specialties?.data || store.rules?.referral_specialties || DEFAULT_REFERRAL_SPECIALTIES;
    if (method === "GET") {
      const rows = store.referrals.filter((r) => r.patient_id === pid).sort((a, b) => b.id - a.id);
      recordAudit(store, me, "view", "referrals", pid);
      await saveStore(env, store);
      if (me.role === "CALLER") {
        return reply(200, rows.filter((r) => r.status !== "DECLINED").map((r) => ({
          id: r.id,
          label: specs[r.specialty] || "Specialist appointment to book",
          urgency: r.urgency,
          status: r.status,
          scheduled_for: r.scheduled_for || null
        })));
      }
      return reply(200, rows);
    }
    if (method === "POST") {
      const b = await request.json().catch(() => ({}));
      const specialty = String(b.specialty || "");
      if (!(specialty in specs)) return reply(422, { detail: `Unknown specialty: ${specialty}` });
      const urgency = String(b.urgency || "ROUTINE").toUpperCase();
      if (!["ROUTINE", "SOON", "URGENT"].includes(urgency)) return reply(422, { detail: "Invalid urgency" });
      const ref = {
        id: nextId(store.referrals),
        patient_id: pid,
        followup_id: b.followup_id ?? null,
        specialty,
        reason_code: String(b.reason_code || "").trim().toUpperCase().slice(0, 60),
        urgency,
        status: "SUGGESTED",
        appointment_ref: "",
        scheduled_for: b.scheduled_for ? String(b.scheduled_for).slice(0, 10) : null,
        created_by: me.id,
        created_at: new Date().toISOString()
      };
      store.referrals.push(ref);
      await reevalPatient(pid);
      recordAudit(store, me, "create", "referral", ref.id);
      await saveStore(env, store);
      return reply(201, { id: ref.id, patient_id: ref.patient_id, specialty: ref.specialty, urgency: ref.urgency, status: ref.status, scheduled_for: ref.scheduled_for });
    }
  }

  const refPatchMatch = path.match(/^\/referrals\/(\d+)$/);
  if (refPatchMatch && method === "PATCH") {
    const rid = parseInt(refPatchMatch[1], 10);
    const ref = (store.referrals || []).find((r) => r.id === rid);
    if (!ref) return reply(404, { detail: "No such referral" });
    const b = await request.json().catch(() => ({}));
    if (b.status !== undefined && b.status !== null) {
      const st = String(b.status).trim().toUpperCase();
      if (!["SUGGESTED", "BOOKED", "DONE", "DECLINED"].includes(st)) return reply(422, { detail: "Invalid status" });
      if (me.role === "CALLER" && st !== "BOOKED") return reply(403, { detail: "Callers can only mark referrals as BOOKED" });
      ref.status = st;
    }
    if (b.appointment_ref !== undefined && b.appointment_ref !== null) ref.appointment_ref = String(b.appointment_ref).trim().slice(0, 80);
    if (b.scheduled_for !== undefined) ref.scheduled_for = b.scheduled_for ? String(b.scheduled_for).slice(0, 10) : null;
    recordAudit(store, me, "update", "referral", ref.id);
    await saveStore(env, store);
    if (me.role === "CALLER") return reply(200, { id: ref.id, label: "Specialist appointment to book", status: ref.status, scheduled_for: ref.scheduled_for || null });
    return reply(200, { id: ref.id, specialty: ref.specialty, status: ref.status, appointment_ref: ref.appointment_ref || "", scheduled_for: ref.scheduled_for || null });
  }

  const homeReadMatch = path.match(/^\/patients\/(\d+)\/home-readings$/);
  if (homeReadMatch) {
    const pid = parseInt(homeReadMatch[1], 10);
    const pat = (store.patients || []).find((p) => p.id === pid);
    if (!pat) return reply(404, { detail: "No such patient" });
    if (!store.home_readings) store.home_readings = [];
    if (method === "GET") {
      const rows = store.home_readings
        .filter((r) => r.patient_id === pid)
        .sort((a, b) => String(b.taken_at).localeCompare(String(a.taken_at)) || b.id - a.id)
        .slice(0, 200)
        .map((r) => ({ ...r, alert: checkHomeReadingAlert(r.kind, r.values) }));
      recordAudit(store, me, "view", "home_readings", pid);
      await saveStore(env, store);
      return reply(200, rows);
    }
    if (method === "POST") {
      const b = await request.json().catch(() => ({}));
      const kind = String(b.kind || "").trim().toUpperCase();
      if (!HOME_KINDS.has(kind)) return reply(422, { detail: `Unsupported reading kind: ${kind}` });
      const hr = {
        id: nextId(store.home_readings),
        patient_id: pid,
        kind,
        values: b.values || {},
        taken_at: b.taken_at || new Date().toISOString(),
        source: "MANUAL_STAFF",
        entered_by: me.id
      };
      store.home_readings.push(hr);
      const alert = checkHomeReadingAlert(kind, hr.values);
      if (alert) {
        if (!store.notifications) store.notifications = { unread: 0, items: [] };
        store.notifications.unread = (store.notifications.unread || 0) + 1;
        store.notifications.items.unshift({
          id: nextId(store.notifications.items),
          text: "Home monitoring alert",
          link: `/patients/view?id=${pid}`,
          urgent: true,
          read: false,
          at: new Date().toISOString()
        });
      }
      await reevalPatient(pid);
      recordAudit(store, me, "create", "home_reading", hr.id);
      await saveStore(env, store);
      return reply(201, { ...hr, alert });
    }
  }

  const homeImportMatch = path.match(/^\/patients\/(\d+)\/home-readings\/import$/);
  if (homeImportMatch && method === "POST") {
    const pid = parseInt(homeImportMatch[1], 10);
    const pat = (store.patients || []).find((p) => p.id === pid);
    if (!pat) return reply(404, { detail: "No such patient" });
    const ct = request.headers.get("content-type") || "";
    let csvBytes;
    if (ct.includes("multipart/form-data")) {
      const fd = await request.formData().catch(() => null);
      const f = fd?.get("file");
      if (!f || typeof f.arrayBuffer !== "function") return reply(422, { detail: "Missing CSV file" });
      if (f.size > MAX_HOME_CSV_BYTES) return reply(413, { detail: "File is larger than 5 MB" });
      csvBytes = new Uint8Array(await f.arrayBuffer());
    } else {
      csvBytes = new Uint8Array(await request.arrayBuffer());
    }
    if (csvBytes.byteLength > MAX_HOME_CSV_BYTES) return reply(413, { detail: "File is larger than 5 MB" });
    const text = new TextDecoder().decode(csvBytes).replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return reply(422, { detail: "CSV file is empty" });
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    if (!store.home_readings) store.home_readings = [];
    let imported = 0;
    let alerts = 0;
    for (const line of lines.slice(1, 5001)) {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const row = Object.fromEntries(headers.map((h, i) => [h, cols[i] || ""]));
      const kind = String(row.kind || "").trim().toUpperCase();
      if (!HOME_KINDS.has(kind)) return reply(422, { detail: `Unsupported reading kind: ${kind}` });
      const values = kind === "BP"
        ? { systolic: Math.trunc(Number(row.systolic)), diastolic: Math.trunc(Number(row.diastolic)) }
        : { value: Number(row.value) };
      const takenAt = row.taken_at || new Date().toISOString();
      store.home_readings.push({
        id: nextId(store.home_readings),
        patient_id: pid,
        kind,
        values,
        taken_at: takenAt,
        source: "CSV_IMPORT",
        entered_by: me.id
      });
      imported += 1;
      if (checkHomeReadingAlert(kind, values)) alerts += 1;
    }
    if (alerts) {
      if (!store.notifications) store.notifications = { unread: 0, items: [] };
      store.notifications.unread = (store.notifications.unread || 0) + 1;
      store.notifications.items.unshift({
        id: nextId(store.notifications.items),
        text: "Home monitoring alert",
        link: `/patients/view?id=${pid}`,
        urgent: true,
        read: false,
        at: new Date().toISOString()
      });
    }
    await reevalPatient(pid);
    recordAudit(store, me, "import", "home_readings", `${pid}:${imported}`);
    await saveStore(env, store);
    return reply(201, { imported, alerts });
  }

  const homeCsvMatch = path.match(/^\/patients\/(\d+)\/home-readings\.csv$/);
  if (homeCsvMatch && method === "GET") {
    const pid = parseInt(homeCsvMatch[1], 10);
    const pat = (store.patients || []).find((p) => p.id === pid);
    if (!pat) return reply(404, { detail: "No such patient" });
    const rows = (store.home_readings || []).filter((r) => r.patient_id === pid).sort((a, b) => String(b.taken_at).localeCompare(String(a.taken_at)));
    let csvText = "Date,Kind,Systolic,Diastolic,Value,Source\n";
    for (const r of rows) {
      const cells = [r.taken_at, r.kind, r.values?.systolic ?? "", r.values?.diastolic ?? "", r.values?.value ?? "", r.source]
        .map((c) => `"${sanitizeCsvCell(c).replace(/"/g, '""')}"`);
      csvText += `${cells.join(",")}\n`;
    }
    recordAudit(store, me, "export", "home_readings", pid);
    await saveStore(env, store);
    return new Response(csvText, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="home-readings-${pid}.csv"` }
    });
  }

  const homeVisitsMatch = path.match(/^\/patients\/(\d+)\/home-visits$/);
  if (homeVisitsMatch) {
    const pid = parseInt(homeVisitsMatch[1], 10);
    const pat = (store.patients || []).find((p) => p.id === pid);
    if (!pat) return reply(404, { detail: "No such patient" });
    if (!store.home_visits) store.home_visits = [];
    if (method === "GET") {
      return reply(200, store.home_visits.filter((v) => v.patient_id === pid).sort((a, b) => String(b.scheduled_on).localeCompare(String(a.scheduled_on)) || b.id - a.id));
    }
    if (method === "POST") {
      const b = await request.json().catch(() => ({}));
      const v = {
        id: nextId(store.home_visits),
        patient_id: pid,
        purpose_code: String(b.purpose_code || "").trim().toUpperCase(),
        scheduled_on: String(b.scheduled_on || "").slice(0, 10),
        status: "SCHEDULED",
        staff_name: String(b.staff_name || "").trim().slice(0, 120),
        created_by: me.id
      };
      store.home_visits.push(v);
      recordAudit(store, me, "create", "home_visit", v.id);
      await saveStore(env, store);
      return reply(201, v);
    }
  }

  const visitPatchMatch = path.match(/^\/home-visits\/(\d+)$/);
  if (visitPatchMatch && method === "PATCH") {
    const vid = parseInt(visitPatchMatch[1], 10);
    const v = (store.home_visits || []).find((x) => x.id === vid);
    if (!v) return reply(404, { detail: "No such visit" });
    const b = await request.json().catch(() => ({}));
    const st = String(b.status || "").trim().toUpperCase();
    if (!["SCHEDULED", "DONE", "CANCELLED"].includes(st)) return reply(422, { detail: "Invalid visit status" });
    v.status = st;
    recordAudit(store, me, "update", "home_visit", v.id);
    await saveStore(env, store);
    return reply(200, { id: v.id, status: v.status });
  }

  const famMatch = path.match(/^\/patients\/(\d+)\/family$/);
  if (famMatch && method === "GET") {
    const pid = parseInt(famMatch[1], 10);
    const pat = (store.patients || []).find((p) => p.id === pid);
    if (!pat) return reply(404, { detail: "No such patient" });
    const household = pat.household_tag
      ? (store.patients || []).filter((h) => h.household_tag === pat.household_tag && h.id !== pid).map((h) => ({ id: h.id, name: h.name }))
      : [];
    const links = consentingFamilySummaries(store, pid);
    recordAudit(store, me, "view", "family_links", pid);
    await saveStore(env, store);
    return reply(200, { patient_id: pid, household_tag: pat.household_tag || null, household, links });
  }

  const famLinkMatch = path.match(/^\/patients\/(\d+)\/family-links$/);
  if (famLinkMatch && method === "POST") {
    const pid = parseInt(famLinkMatch[1], 10);
    const pat = (store.patients || []).find((p) => p.id === pid);
    if (!pat) return reply(404, { detail: "No such patient" });
    const b = await request.json().catch(() => ({}));
    const relId = parseInt(b.related_patient_id, 10);
    const rPat = (store.patients || []).find((p) => p.id === relId);
    if (!rPat) return reply(404, { detail: "No such patient" });
    if (relId === pid) return reply(422, { detail: "Cannot link a patient to themselves" });
    if (!store.family_links) store.family_links = [];
    if (store.family_links.some((l) => l.patient_id === pid && l.related_patient_id === relId)) {
      return reply(409, { detail: "Family link already exists" });
    }
    const ln = {
      id: nextId(store.family_links),
      patient_id: pid,
      related_patient_id: relId,
      relationship: String(b.relationship || "").trim().slice(0, 40),
      consent_id: null
    };
    store.family_links.push(ln);
    recordAudit(store, me, "create", "family_link", ln.id);
    await saveStore(env, store);
    return reply(201, { id: ln.id, related_patient_id: relId, relationship: ln.relationship, has_consent: false });
  }

  const famConsentMatch = path.match(/^\/family-links\/(\d+)\/consent$/);
  if (famConsentMatch && method === "POST") {
    const lid = parseInt(famConsentMatch[1], 10);
    const ln = (store.family_links || []).find((x) => x.id === lid);
    if (!ln) return reply(404, { detail: "No such family link" });
    if (!store.family_consents) store.family_consents = [];
    if (!ln.consent_id) {
      const c = {
        id: nextId(store.family_consents),
        patient_id: ln.related_patient_id,
        given_by_user: me.id,
        channel: "family_link",
        given_at: new Date().toISOString()
      };
      store.family_consents.push(c);
      ln.consent_id = c.id;
    }
    await reevalPatient(ln.patient_id);
    recordAudit(store, me, "consent", "family_link", ln.id);
    await saveStore(env, store);
    return reply(201, { id: ln.id, consent_id: ln.consent_id, has_consent: true });
  }

  // --- RULES ---
  const DEFAULT_RULES = {
    aliases: { ...DEFAULT_ALIASES },
    buckets: [
      { code: "DIABETES", name: "Diabetes / Prediabetes", params: ["HBA1C", "GLUCOSE_FASTING", "GLUCOSE_PP"], interval_days: 90, priority: "ROUTINE", retest: ["HBA1C", "FBS", "PPBS"] },
      { code: "LIPID", name: "Lipid / Cardio risk", params: ["TRIGLYCERIDES", "LDL", "HDL", "CHOL_TOTAL"], interval_days: 90, priority: "ROUTINE", retest: ["LIPID"] },
      { code: "THYROID", name: "Thyroid", params: ["TSH", "FT3", "FT4"], interval_days: 90, priority: "ROUTINE", retest: ["THYROID"] },
      { code: "ANAEMIA", name: "Anaemia / Iron", params: ["HEMOGLOBIN", "FERRITIN", "IRON", "TIBC"], interval_days: 90, priority: "ROUTINE", retest: ["CBC", "IRON"] },
      { code: "VIT_D_B12", name: "Vitamin D / B12", params: ["VITAMIN_D", "B12"], interval_days: 90, priority: "ROUTINE", retest: ["VITD", "B12"] },
      { code: "KIDNEY", name: "Kidney", params: ["CREATININE", "UREA", "EGFR", "URIC_ACID", "UACR"], interval_days: 90, priority: "ROUTINE", retest: ["KFT"] },
      { code: "LIVER", name: "Liver", params: ["SGOT", "SGPT", "ALP", "BILIRUBIN"], interval_days: 90, priority: "ROUTINE", retest: ["LFT"] },
      { code: "CANCER_MARKER", name: "Cancer markers", params: ["PSA", "CA125", "CEA"], interval_days: 0, priority: "ESCALATION", retest: [] },
      { code: "HYPERTENSION", name: "Hypertension", params: [], interval_days: 90, priority: "ROUTINE", retest: [] },
      { code: "BONE", name: "Bone health", params: [], interval_days: 90, priority: "ROUTINE", retest: ["VITD"] },
      { code: "OTHER", name: "Other abnormal", params: [], interval_days: 90, priority: "ROUTINE", retest: [] }
    ],
    test_catalogue: DEFAULT_TEST_CATALOGUE_P7,
    reference_ranges: {
      HBA1C: { unit: "%", bands: [["normal", null, 5.7], ["prediabetes", 5.7, 6.5], ["diabetes_range", 6.5, null]] },
      GLUCOSE_FASTING: { unit: "mg/dL", bands: [["normal", 70, 100], ["prediabetes", 100, 126], ["diabetes_range", 126, null]] },
      GLUCOSE_PP: { unit: "mg/dL", bands: [["normal", null, 140], ["prediabetes", 140, 200], ["diabetes_range", 200, null]] },
      CHOL_TOTAL: { unit: "mg/dL", bands: [["desirable", null, 200], ["high", 200, null]] },
      LDL: { unit: "mg/dL", bands: [["optimal", null, 100], ["near_optimal", 100, 130], ["borderline", 130, 160], ["high", 160, null]] },
      HDL: { unit: "mg/dL", low_below: { M: 40, F: 50 } },
      TRIGLYCERIDES: { unit: "mg/dL", bands: [["normal", null, 150], ["borderline", 150, 200], ["high", 200, 500], ["very_high", 500, null]] },
      HEMOGLOBIN: { unit: "g/dL", low_below: { M: 13, F: 12 } },
      VITAMIN_D: { unit: "ng/mL", bands: [["deficient", null, 20], ["insufficient", 20, 30], ["sufficient", 30, null]] },
      EGFR: { unit: "mL/min/1.73m2", bands: [["abnormal", null, 60], ["normal", 60, null]] }
    },
    critical_values: [],
    score_weights: {
      severity: { mild: 10, moderate: 20, severe: 30 },
      time_ratio: [[0.8, 0], [1.0, 10], [1.5, 20], [null, 25]],
      trend: { worsening: 20, stable_abnormal: 10, improving: 5, none: 0 },
      buckets: { "1": 5, "2": 10, "3+": 15 },
      engagement_bonus: 10,
      tiers: { HIGH: 65, MEDIUM: 40 }
    },
    severity: { mild_max_pct: 10, moderate_max_pct: 25 },
    caller_script_forbidden: [
      "diabetes", "diabetic", "cholesterol", "cancer", "anaemia", "hypertension",
      "disease", "illness", "prescribe", "medicine", "medication", "dose", "mg", "pill"
    ],
    script_templates: {
      en: {
        headline: "Health Follow-up for {tests}",
        doctor: {
          opening: "Hello, I am Dr. from SecondMedic reviewing your recent health checkup.",
          finding: "{name} is {value} {unit} ({direction}, normal: {ref_range})",
          discussion_points: ["Discuss lifestyle, diet, and physical activity", "Review any ongoing symptoms or medication"],
          questions_to_ask: ["Are you experiencing fatigue, dizziness, or unusual thirst?"],
          counselling_points: ["Maintain balanced nutrition and regular hydration", "Avoid self-medication"],
          test_line: "Recommend {name}: {rationale}",
          rationale: "Routine monitor for {bucket}",
          red_flags: ["Chest discomfort", "Shortness of breath", "Sudden weakness"],
          closing: "We will monitor your parameters and follow up in {interval_days} days.",
          next_followup: "Suggested next review in {interval_days} days"
        },
        caller: {
          opening: "Namaste, I am calling from SecondMedic regarding your recent diagnostic report.",
          identity_check: "May I please speak with {patient_name}?",
          free_followup_pitch: "We have reviewed your {tests} and would like to arrange a complimentary follow-up consultation with our doctor to explain your results.",
          consent_request: "May I have your consent to connect you with our doctor?",
          slot_offer: "Would today afternoon or tomorrow morning be convenient for you?",
          objection_handling: [
            { objection: "Is this free?", reply: "Yes, this follow-up consultation is completely complimentary as part of SecondMedic health checkup." },
            { objection: "I am feeling fine", reply: "Preventive consultation helps ensure your parameters stay healthy and lets you discuss any precautions." }
          ],
          do_not_say: ["Do not diagnose any illness", "Do not discuss medicine dosages or brands"],
          urgent_symptom_protocol: "If you feel severe pain or difficulty breathing, please seek emergency medical attention immediately.",
          closing: "Thank you for your time. Stay healthy!"
        }
      }
    },
    relationship_next_steps: DEFAULT_RELATIONSHIP_NEXT_STEPS,
    profile_codes: DEFAULT_PROFILE_CODES,
    care_programs: DEFAULT_CARE_PROGRAMS,
    medicine_catalogue: DEFAULT_MEDICINE_CATALOGUE,
    drug_nutrient_rules: DEFAULT_DRUG_NUTRIENT_RULES,
    referral_specialties: DEFAULT_REFERRAL_SPECIALTIES,
    diagnostic_findings: DEFAULT_DIAGNOSTIC_FINDINGS,
    recommendation_combinations: DEFAULT_RECOMMENDATION_COMBINATIONS,
    clinical_targets: DEFAULT_CLINICAL_TARGETS,
    next_action_rules: DEFAULT_NEXT_ACTION_RULES,
    journey_templates: DEFAULT_JOURNEY_TEMPLATES,
    retest_protocols: DEFAULT_RETEST_PROTOCOLS,
    retest_tiers: DEFAULT_RETEST_TIERS
  };

  if (path === "/rules" && method === "GET") {
    const list = Object.keys(DEFAULT_RULES).map((key) => ({
      key,
      version: store.rules?.[key]?.version || 1,
      signed_off_by: store.rules?.[key]?.signed_off_by || 1,
      signed_off_at: store.rules?.[key]?.signed_off_at || "2026-11-01T00:00:00Z",
      pending_signoff: store.rules?.[key]?.pending_signoff ?? false
    }));
    return reply(200, list);
  }

  const rkMatch = path.match(/^\/rules\/([a-zA-Z0-9_]+)$/);
  if (rkMatch) {
    const key = rkMatch[1];
    if (method === "GET") {
      const rule = store.rules?.[key] || {
        key,
        version: 1,
        data: DEFAULT_RULES[key] || {},
        pending_signoff: false
      };
      return reply(200, rule);
    }
    if (method === "PUT" || method === "POST") {
      const b = await request.json().catch(() => ({}));
      if (!store.rules) store.rules = {};
      const current = store.rules[key] || { key, version: 1, data: DEFAULT_RULES[key] || {} };
      store.rules[key] = {
        key,
        version: (current.version || 1) + 1,
        data: b.data !== undefined ? b.data : b,
        pending_signoff: true
      };
      await saveStore(env, store);
      return reply(200, store.rules[key]);
    }
  }

  const signoffMatch = path.match(/^\/rules\/([a-zA-Z0-9_]+)\/signoff$/);
  if (signoffMatch && method === "POST") {
    const key = signoffMatch[1];
    if (!store.rules) store.rules = {};
    const current = store.rules[key] || { key, version: 1, data: DEFAULT_RULES[key] || {} };
    store.rules[key] = {
      ...current,
      pending_signoff: false,
      signed_off_by: me.id,
      signed_off_at: new Date().toISOString()
    };
    await saveStore(env, store);
    return reply(200, store.rules[key]);
  }

  return reply(404, { detail: "Not available in this deployment." });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    // If an external backend URL and secret are explicitly configured, proxy to it.
    if (env.BACKEND_URL && env.EDGE_SECRET) {
      const upstream = new Request(new URL(url.pathname + url.search, env.BACKEND_URL), request);
      upstream.headers.set("X-Edge-Secret", env.EDGE_SECRET);
      upstream.headers.set("X-Client-IP", request.headers.get("cf-connecting-ip") ?? "");
      try {
        const res = await fetch(upstream, { redirect: "manual" });
        const out = new Response(res.body, res);
        out.headers.set("X-Content-Type-Options", "nosniff");
        return out;
      } catch {
        return new Response(JSON.stringify({ detail: "Cannot reach backend. Falling back to edge engine." }), {
          status: 502,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Otherwise, handle natively using edge KV store
    return handleApiRequest(request, url, env);
  },

  async scheduled(_event, env, ctx) {
    if (env.BACKEND_URL && env.EDGE_SECRET) {
      ctx.waitUntil(fetch(new URL("/api/internal/tick", env.BACKEND_URL), {
        method: "POST",
        headers: { "X-Edge-Secret": env.EDGE_SECRET }
      }).catch(() => {}));
    } else {
      // Background refill reminders & LabTrace sync. The cron fires every 2 minutes;
      // LabTrace only pulls when the "Repeat Lab Sync Every (minutes)" setting says it is time.
      ctx.waitUntil((async () => {
        const store = await getStore(env);
        if (refillTickInStore(store) + retestReminderTickInStore(store) + slaTickInStore(store) > 0) await saveStore(env, store);
        if (!labtraceConfigured(env)) return;
        const every = Number(store.settings.pull_every_minutes) || 0;
        const last = Date.parse((store.labtrace_last_pull && store.labtrace_last_pull.at) || "") || 0;
        if (every > 0) {
          if (Date.now() - last < every * 60000) return;
        } else {
          const nowIst = new Date(Date.now() + 330 * 60000).toISOString().slice(11, 16);
          if (nowIst < String(store.settings.pull_time_ist || "07:00") || istDate(last) === istDate()) return;
        }
        const days = Math.min(90, Math.max(1, Number(store.settings.pull_lookback_days) || 7));
        const range = { start: istDate(Date.now() - days * 86400000), end: istDate() };
        try {
          await pullFromLabTrace(env, store, range, null);
        } catch (err) {
          store.labtrace_last_pull = { at: new Date().toISOString(), ok: false, message: err instanceof LabTraceError ? err.message : "Automatic LabTrace pull failed." };
          await saveStore(env, store);
        }
      })());
    }
  }
};
