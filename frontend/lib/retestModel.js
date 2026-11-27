// Page 12: AMI Clinically Approved Retesting Model (Worker parity with backend/app/retest_model.py)
import { addDaysIso, todayIstStr } from "./programs.js";
import { DEFAULT_RETEST_PROTOCOLS, DEFAULT_TEST_CATALOGUE_P7, toIstDateStr } from "./retest.js";
import { compareInStore } from "./compare.js";

export const COLLECTION_MODES = new Set(["HOME", "HEALTH_HUB"]);
export const BOOKING_STATUSES = new Set(["NOT_BOOKED", "BOOKED", "COLLECTED", "CANCELLED", "NO_SHOW"]);

export const HEALTH_HUBS_STARTER = [
  { id: 1, name: "SecondMedic Health Hub — Andheri West", city: "Mumbai", address: "Link Road, Andheri West, Mumbai", active: true, opening_hours: "07:00-19:00" },
  { id: 2, name: "SecondMedic Health Hub — Koramangala", city: "Bengaluru", address: "80 Feet Road, Koramangala, Bengaluru", active: true, opening_hours: "07:00-19:00" },
];

export const DEFAULT_PROTOCOL_BUNDLES = [
  {
    code: "DIABETES",
    name: "Diabetes",
    caller_label: "Follow-up care package",
    window_text: "90 days",
    retest_protocol_code: "HIGH_HBA1C",
    window_min_days: 90,
    window_max_days: 90,
    tests: ["HBA1C", "FBS"],
    note: "starter value, clinician and business to confirm",
    services: [
      { type: "DIAGNOSTICS", label: "Diagnostics", loop_stage: "DIAGNOSTICS", service_code: "HOME_COLLECTION", tests: ["HBA1C", "FBS"], price_inr: 520 },
      { type: "PHYSICIAN_CONSULT", label: "Physician Consult", loop_stage: "CONSULTATIONS", service_code: "TELECONSULT", price_inr: 499 },
      { type: "PHARMACY", label: "Pharmacy", loop_stage: "MEDICATIONS", service_code: "PHARMACY_REFILL", only_if_active_medicine: true, price_inr: 500 },
      { type: "NUTRITION", label: "Nutrition", loop_stage: "EATING_WELL", service_code: "DIETITIAN_PLAN", price_inr: 999 },
    ],
  },
  {
    code: "THYROID",
    name: "Thyroid",
    caller_label: "Follow-up care package",
    window_text: "6\u20138 weeks after treatment changes",
    retest_protocol_code: "HIGH_TSH",
    window_min_days: 42,
    window_max_days: 56,
    tests: ["TSH", "FT4"],
    note: "starter value, clinician and business to confirm",
    services: [
      { type: "DIAGNOSTICS", label: "Diagnostics", loop_stage: "DIAGNOSTICS", service_code: "HOME_COLLECTION", tests: ["TSH", "FT4"], price_inr: 650 },
      { type: "PHYSICIAN_CONSULT", label: "Physician Consult", loop_stage: "CONSULTATIONS", service_code: "TELECONSULT", price_inr: 499 },
      { type: "PHARMACY", label: "Pharmacy", loop_stage: "MEDICATIONS", service_code: "PHARMACY_REFILL", only_if_active_medicine: true, price_inr: 500 },
      { type: "NUTRITION", label: "Nutrition", loop_stage: "EATING_WELL", service_code: "DIETITIAN_PLAN", price_inr: 999 },
    ],
  },
  {
    code: "LIPIDS",
    name: "Lipids",
    caller_label: "Follow-up care package",
    window_text: "4\u201312 weeks after treatment changes",
    retest_protocol_code: "HIGH_CHOLESTEROL",
    window_min_days: 28,
    window_max_days: 84,
    tests: ["LIPID"],
    note: "starter value, clinician and business to confirm",
    services: [
      { type: "DIAGNOSTICS", label: "Diagnostics", loop_stage: "DIAGNOSTICS", service_code: "HOME_COLLECTION", tests: ["LIPID"], price_inr: 600 },
      { type: "PHYSICIAN_CONSULT", label: "Physician Consult", loop_stage: "CONSULTATIONS", service_code: "TELECONSULT", price_inr: 499 },
      { type: "PHARMACY", label: "Pharmacy", loop_stage: "MEDICATIONS", service_code: "PHARMACY_REFILL", only_if_active_medicine: true, price_inr: 500 },
      { type: "NUTRITION", label: "Nutrition", loop_stage: "EATING_WELL", service_code: "DIETITIAN_PLAN", price_inr: 999 },
    ],
  },
  {
    code: "IRON_DEFICIENCY_ANEMIA",
    name: "Iron-deficiency anemia",
    caller_label: "Follow-up care package",
    window_text: "2\u20134 weeks",
    retest_protocol_code: "LOW_HB",
    window_min_days: 14,
    window_max_days: 28,
    tests: ["CBC", "IRON"],
    note: "starter value, clinician and business to confirm",
    services: [
      { type: "DIAGNOSTICS", label: "Diagnostics", loop_stage: "DIAGNOSTICS", service_code: "HOME_COLLECTION", tests: ["CBC", "IRON"], price_inr: 950 },
      { type: "PHYSICIAN_CONSULT", label: "Physician Consult", loop_stage: "CONSULTATIONS", service_code: "TELECONSULT", price_inr: 499 },
      { type: "PHARMACY", label: "Pharmacy", loop_stage: "MEDICATIONS", service_code: "PHARMACY_REFILL", only_if_active_medicine: true, price_inr: 500 },
      { type: "NUTRITION", label: "Nutrition", loop_stage: "EATING_WELL", service_code: "DIETITIAN_PLAN", price_inr: 999 },
    ],
  },
  {
    code: "VITAMIN_D",
    name: "Vitamin D",
    caller_label: "Follow-up care package",
    window_text: "8\u201312 weeks when indicated",
    retest_protocol_code: "LOW_VITD",
    window_min_days: 56,
    window_max_days: 84,
    tests: ["VITD", "CALCIUM"],
    note: "starter value, clinician and business to confirm",
    services: [
      { type: "DIAGNOSTICS", label: "Diagnostics", loop_stage: "DIAGNOSTICS", service_code: "HOME_COLLECTION", tests: ["VITD", "CALCIUM"], price_inr: 1150 },
      { type: "PHYSICIAN_CONSULT", label: "Physician Consult", loop_stage: "CONSULTATIONS", service_code: "TELECONSULT", price_inr: 499 },
      { type: "PHARMACY", label: "Pharmacy", loop_stage: "MEDICATIONS", service_code: "PHARMACY_REFILL", only_if_active_medicine: true, price_inr: 500 },
      { type: "NUTRITION", label: "Nutrition", loop_stage: "EATING_WELL", service_code: "DIETITIAN_PLAN", price_inr: 999 },
    ],
  },
];

const TEST_TO_PARAMS = {
  HBA1C: new Set(["HBA1C"]),
  FBS: new Set(["GLUCOSE_FASTING", "FBS"]),
  PPBS: new Set(["GLUCOSE_PP", "PPBS"]),
  LIPID: new Set(["CHOL_TOTAL", "LDL", "HDL", "TRIGLYCERIDES", "VLDL"]),
  THYROID: new Set(["TSH", "FT3", "FT4", "T3", "T4"]),
  TSH: new Set(["TSH"]),
  FT4: new Set(["FT4"]),
  CBC: new Set(["HEMOGLOBIN", "HB", "WBC", "PLATELETS", "MCV"]),
  RETIC: new Set(["RETIC"]),
  IRON: new Set(["FERRITIN", "IRON", "TIBC", "TSAT"]),
  VITD: new Set(["VITAMIN_D", "VIT_D"]),
  CALCIUM: new Set(["CALCIUM"]),
  B12: new Set(["B12", "VITAMIN_B12"]),
  KFT: new Set(["CREATININE", "UREA", "EGFR", "URIC_ACID", "BUN"]),
  EGFR: new Set(["EGFR"]),
  ELECTROLYTES: new Set(["SODIUM", "POTASSIUM", "CHLORIDE"]),
  URINE_ROUTINE: new Set(["URINE_ROUTINE", "URINE_PROTEIN", "URINE_PUS"]),
  UACR: new Set(["UACR", "MICROALBUMIN"]),
  LFT: new Set(["SGOT", "SGPT", "AST", "ALT", "ALP", "BILIRUBIN"]),
};

const BUNDLE_BY_FINDING = {
  HIGH_HBA1C: "DIABETES",
  PREDIABETES: "DIABETES",
  DIABETES_STABLE: "DIABETES",
  DIABETES_UNCONTROLLED: "DIABETES",
  HIGH_TSH: "THYROID",
  HYPOTHYROID_STABLE_TREATED: "THYROID",
  HIGH_CHOLESTEROL: "LIPIDS",
  DYSLIPIDEMIA: "LIPIDS",
  LOW_HB: "IRON_DEFICIENCY_ANEMIA",
  ANEMIA_IRON_DEFICIENCY: "IRON_DEFICIENCY_ANEMIA",
  LOW_VITD: "VITAMIN_D",
  VITAMIN_D_DEFICIENCY: "VITAMIN_D",
};

function _keyStream(seedBytes, len) {
  const out = new Uint8Array(len);
  let state = 0x811c9dc5;
  for (let i = 0; i < seedBytes.length; i++) state = Math.imul(state ^ seedBytes[i], 0x01000193) >>> 0;
  for (let i = 0; i < len; i++) {
    state = (Math.imul(state ^ (i + 1), 0x45d9f3b) + 0x9e3779b9) >>> 0;
    out[i] = (state >>> 16) & 0xff;
  }
  return out;
}

export function encryptAddress(text, secret = "crtracker-edge-key") {
  const clean = String(text || "").trim().slice(0, 300);
  if (!clean) return "";
  const raw = new TextEncoder().encode(clean);
  const nonce = new Uint8Array(8);
  crypto.getRandomValues(nonce);
  const keyBytes = new TextEncoder().encode(`${secret}:`);
  const seed = new Uint8Array(keyBytes.length + nonce.length);
  seed.set(keyBytes);
  seed.set(nonce, keyBytes.length);
  const stream = _keyStream(seed, raw.length);
  const cipher = raw.map((b, i) => b ^ stream[i]);
  const toB64 = (u8) => btoa(String.fromCharCode(...u8));
  return `v1:${toB64(nonce)}:${toB64(cipher)}`;
}

export function decryptAddress(enc, secret = "crtracker-edge-key") {
  if (!enc) return "";
  const s = String(enc);
  if (!s.startsWith("v1:")) return s;
  const parts = s.split(":");
  if (parts.length !== 3) return "";
  try {
    const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const nonce = fromB64(parts[1]);
    const cipher = fromB64(parts[2]);
    const keyBytes = new TextEncoder().encode(`${secret}:`);
    const seed = new Uint8Array(keyBytes.length + nonce.length);
    seed.set(keyBytes);
    seed.set(nonce, keyBytes.length);
    const stream = _keyStream(seed, cipher.length);
    const plain = cipher.map((b, i) => b ^ stream[i]);
    return new TextDecoder().decode(plain);
  } catch {
    return "";
  }
}

export function ensureHubs(store) {
  if (!Array.isArray(store.health_hubs) || store.health_hubs.length === 0) {
    store.health_hubs = HEALTH_HUBS_STARTER.map((h) => ({ ...h }));
  }
  return store.health_hubs;
}

function _bundlesMap(store) {
  const list = store?.rules?.protocol_bundles?.data || store?.rules?.protocol_bundles || DEFAULT_PROTOCOL_BUNDLES;
  return Object.fromEntries(list.map((b) => [b.code, b]));
}

function _catalogueMap(store) {
  const raw = store?.rules?.test_catalogue?.data || store?.rules?.test_catalogue || DEFAULT_TEST_CATALOGUE_P7;
  const defPrices = Object.fromEntries(DEFAULT_TEST_CATALOGUE_P7.map((t) => [t.code, t.price_inr]));
  return Object.fromEntries(raw.map((t) => [t.code, { ...t, price_inr: t.price_inr ?? defPrices[t.code] ?? null }]));
}

function _protocolsMap(store) {
  const raw = store?.rules?.retest_protocols?.data || store?.rules?.retest_protocols || DEFAULT_RETEST_PROTOCOLS;
  return Object.fromEntries(raw.map((p) => [p.finding_code || p.condition_code, p]).filter(([k]) => Boolean(k)));
}

export function isPlanApprovedInStore(store, plan) {
  if (!plan) return false;
  if (plan.approved_by_doctor_id != null) return true;
  if (plan.source === "PROTOCOL" && plan.protocol_version != null) {
    const rs = store?.rules?.retest_protocols;
    if (rs && rs.signed_off_at && rs.version === plan.protocol_version) return true;
  }
  return false;
}

export function ensurePlanForFollowupInStore(store, fu, { report = null, params = [] } = {}) {
  if (!store.recommendations) store.recommendations = {};
  let plan = store.recommendations[fu.id] || null;
  const rp = fu.retest_plan || {};
  const protoCode = rp.primary_finding?.finding_code || rp.primary_finding?.condition_code || "";
  const defaultTests = (rp.default_tests || []).length ? rp.default_tests : [];
  if (!plan) {
    const existingIds = Object.values(store.recommendations).map((x) => Number(x.id) || 0);
    const nextRecId = existingIds.length ? Math.max(...existingIds) + 1 : 1;
    const isDoc = fu.retest_status === "OVERRIDDEN" || fu.retest_status === "DOCTOR_SET";
    plan = {
      id: nextRecId,
      followup_id: fu.id,
      doctor_id: isDoc ? (fu.assigned_doctor_id || 1) : null,
      test_codes: defaultTests,
      ordered: false,
      ordered_ref: "",
      source: isDoc ? "DOCTOR" : "PROTOCOL",
      booking_status: "NOT_BOOKED",
      plan_status: "PLANNED",
      created_at: new Date().toISOString(),
    };
    store.recommendations[fu.id] = plan;
  }
  return syncPlanFieldsInStore(store, plan, fu, { report, params, protoCode });
}

export function syncPlanFieldsInStore(store, plan, fu, { report = null, params = [], doctorId = null, bundleCode = null, protoCode = null } = {}) {
  const rp = fu.retest_plan || {};
  const pf = rp.primary_finding || {};
  const resolvedProto = protoCode || plan.protocol_code || pf.finding_code || pf.condition_code || "";
  const wStart = fu.retest_window_start ? String(fu.retest_window_start).slice(0, 10) : (fu.due_on ? String(fu.due_on).slice(0, 10) : null);
  const wEnd = fu.retest_window_end ? String(fu.retest_window_end).slice(0, 10) : wStart;
  if (!plan.window_start && wStart) plan.window_start = wStart;
  if (!plan.window_end && wEnd) plan.window_end = wEnd;
  if (!plan.next_test_date && (plan.window_start || wStart)) plan.next_test_date = plan.window_start || wStart;

  if (bundleCode) plan.bundle_code = bundleCode;
  else if (!plan.bundle_code && resolvedProto && BUNDLE_BY_FINDING[resolvedProto]) {
    plan.bundle_code = BUNDLE_BY_FINDING[resolvedProto];
  }

  if (!plan.reason_code) plan.reason_code = resolvedProto || plan.bundle_code || "FOLLOWUP";
  if (!plan.reason_text_clinical) {
    const pDef = _protocolsMap(store)[resolvedProto] || {};
    const parts = [pf.considerations_text || pDef.considerations_text || "", pf.timeframe_text || pDef.timeframe_text || ""];
    plan.reason_text_clinical = parts.filter((s) => String(s || "").trim()).join(" ") || "Repeat diagnostic monitoring recommended per clinical protocol.";
  }

  if (doctorId != null) {
    plan.approved_by_doctor_id = doctorId;
    plan.doctor_id = plan.doctor_id || doctorId;
  } else if (plan.source === "DOCTOR" && plan.doctor_id != null && plan.approved_by_doctor_id == null) {
    plan.approved_by_doctor_id = plan.doctor_id;
  }

  if (resolvedProto) plan.protocol_code = resolvedProto;
  if (plan.source === "PROTOCOL") {
    const rs = store?.rules?.retest_protocols;
    if (rs && rs.signed_off_at && plan.protocol_version == null) plan.protocol_version = rs.version || 1;
  }

  const optMap = {};
  for (const item of [pf, ...(rp.findings || [])]) {
    for (const t of (item?.tests || [])) {
      if (t?.code && optMap[t.code] === undefined) optMap[t.code] = Boolean(t.optional);
    }
  }
  const cat = _catalogueMap(store);
  const codes = Array.isArray(plan.test_codes) ? plan.test_codes : [];
  plan.tests = codes.map((c) => ({
    code: c,
    name: cat[c]?.name || c,
    optional: optMap[c] || false,
    price_inr: cat[c]?.price_inr ?? null,
  }));

  if ((!Array.isArray(plan.previous_results_snapshot) || plan.previous_results_snapshot.length === 0) && fu.report_id) {
    const expParams = new Set(codes.flatMap((c) => [...(TEST_TO_PARAMS[c] || [c])]));
    const snap = [];
    const seen = new Set();
    for (const p of params || []) {
      if (!p.param_code || seen.has(p.param_code)) continue;
      if (expParams.has(p.param_code) || p.system_flag === "LOW" || p.system_flag === "HIGH") {
        seen.add(p.param_code);
        snap.push({ code: p.param_code, report_id: fu.report_id });
      }
    }
    plan.previous_results_snapshot = snap;
  }
  if (!plan.booking_status) plan.booking_status = plan.ordered ? "BOOKED" : "NOT_BOOKED";
  if (!plan.plan_status) plan.plan_status = "PLANNED";
  return plan;
}

export function approvePlanInStore(store, plan, doctorId, { params = [] } = {}) {
  plan.approved_by_doctor_id = doctorId;
  plan.doctor_id = plan.doctor_id || doctorId;
  const fu = (store.followups || []).find((f) => f.id === plan.followup_id);
  if (fu) {
    syncPlanFieldsInStore(store, plan, fu, { params, doctorId });
    if (["NOT_CALLED", "CALLED", "CONSENT_GIVEN", "BOOKED", "DOCTOR_DONE"].includes(fu.stage)) {
      fu.stage = "RETEST_RECOMMENDED";
    }
  }
  return plan;
}

export function syncSignedOffProtocolPlansInStore(store, version) {
  for (const plan of Object.values(store.recommendations || {})) {
    if (plan.source === "PROTOCOL" && !plan.comparison_report_id && plan.protocol_code && plan.protocol_version == null) {
      plan.protocol_version = version;
    }
  }
}

export function bookPlanInStore(store, plan, body = {}, { secret = "crtracker-edge-key" } = {}) {
  if (!isPlanApprovedInStore(store, plan)) {
    const e = new Error("Unapproved retest plan cannot be booked");
    e.status = 409;
    throw e;
  }
  const mode = String(body.collection_mode || "").trim().toUpperCase();
  if (!COLLECTION_MODES.has(mode)) {
    const e = new Error("collection_mode must be HOME or HEALTH_HUB");
    e.status = 422;
    throw e;
  }
  const st = String(body.booking_status || "BOOKED").trim().toUpperCase();
  if (!BOOKING_STATUSES.has(st) || st === "NOT_BOOKED") {
    const e = new Error("booking_status must be BOOKED, COLLECTED, CANCELLED, or NO_SHOW");
    e.status = 422;
    throw e;
  }
  if (mode === "HOME") {
    const addr = String(body.address || "").trim();
    if (!addr && !plan.address_enc) {
      const e = new Error("Home collection requires a patient address");
      e.status = 422;
      throw e;
    }
    if (addr) plan.address_enc = encryptAddress(addr, secret);
    plan.health_hub_id = null;
  } else {
    const hid = Number(body.health_hub_id);
    const hubs = ensureHubs(store);
    const hub = hubs.find((h) => h.id === hid && h.active !== false);
    if (!hub) {
      const e = new Error("No active Health Hub found with that ID");
      e.status = 404;
      throw e;
    }
    plan.health_hub_id = hub.id;
    plan.address_enc = "";
  }
  plan.collection_mode = mode;
  if (body.slot_start) plan.slot_start = String(body.slot_start);
  plan.booking_status = st;
  if (body.lab_order_ref) {
    plan.lab_order_ref = String(body.lab_order_ref).trim().slice(0, 64);
    plan.ordered_ref = plan.lab_order_ref;
  }
  if (st === "BOOKED" || st === "COLLECTED") plan.ordered = true;

  const fu = (store.followups || []).find((f) => f.id === plan.followup_id);
  if (fu && st === "BOOKED") fu.stage = "RETEST_ORDERED";
  if (fu && (st === "BOOKED" || st === "COLLECTED")) {
    if (!store.care_touchpoints) store.care_touchpoints = [];
    const diagAmt = (plan.tests || []).reduce((s, t) => s + (!t?.optional ? Number(t?.price_inr || 0) : 0), 0);
    const svcCode = mode === "HOME" ? "HOME_COLLECTION" : "HEALTH_HUB_VISIT";
    const ex = store.care_touchpoints.find((t) => t.patient_id === fu.patient_id && t.ref_entity === "retest_booking" && t.ref_id === plan.id && t.stage === "DIAGNOSTICS");
    if (!ex) {
      const nextTp = (store.care_touchpoints.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0)) + 1;
      store.care_touchpoints.push({
        id: nextTp,
        patient_id: fu.patient_id,
        stage: "DIAGNOSTICS",
        service_code: svcCode,
        occurred_on: plan.slot_start ? toIstDateStr(plan.slot_start) : todayIstStr(),
        source: "AUTO",
        ref_entity: "retest_booking",
        ref_id: plan.id,
        amount_inr: diagAmt || null,
        health_hub_id: plan.health_hub_id,
        created_at: new Date().toISOString(),
      });
    } else {
      ex.service_code = svcCode;
      ex.health_hub_id = plan.health_hub_id;
    }
  }
  return plan;
}

export function acceptBundleInStore(store, fu, bundleCode, doctorId, { params = [] } = {}) {
  const bmap = _bundlesMap(store);
  const bcode = String(bundleCode || "").trim().toUpperCase();
  const bundle = bmap[bcode];
  if (!bundle) {
    const e = new Error(`Unknown protocol bundle: ${bundleCode}`);
    e.status = 404;
    throw e;
  }
  const hasActiveMed = (store.patient_medications || []).some((m) => m.patient_id === fu.patient_id && !m.stopped_on);
  const plan = ensurePlanForFollowupInStore(store, fu, { params });
  plan.test_codes = [...new Set([...(plan.test_codes || []), ...(bundle.tests || [])])];
  plan.bundle_code = bcode;
  plan.source = "DOCTOR";
  plan.approved_by_doctor_id = doctorId;
  plan.doctor_id = doctorId;
  plan.reason_code = bundle.retest_protocol_code || bcode;
  plan.reason_text_clinical = `${bundle.name}: ${bundle.window_text}.`;

  const rep = (store.reports || []).find((r) => r.id === fu.report_id);
  const anchor = fu.treatment_anchor_on || (rep?.collected_on ? toIstDateStr(rep.collected_on) : todayIstStr());
  if (!plan.window_start) {
    plan.window_start = addDaysIso(anchor, Number(bundle.window_min_days || 90));
    plan.window_end = addDaysIso(anchor, Number(bundle.window_max_days || bundle.window_min_days || 90));
    plan.next_test_date = plan.window_start;
    if (fu.retest_status !== "OVERRIDDEN" && fu.retest_status !== "DOCTOR_SET") {
      fu.retest_window_start = plan.window_start;
      fu.retest_window_end = plan.window_end;
      fu.due_on = plan.window_start;
    }
  }
  syncPlanFieldsInStore(store, plan, fu, { params, doctorId, bundleCode: bcode });
  if (["NOT_CALLED", "CALLED", "CONSENT_GIVEN", "BOOKED", "DOCTOR_DONE"].includes(fu.stage)) {
    fu.stage = "RETEST_RECOMMENDED";
  }

  if (!store.care_touchpoints) store.care_touchpoints = [];
  const today = todayIstStr();
  const included = [];
  for (const srv of bundle.services || []) {
    if (srv.only_if_active_medicine && !hasActiveMed) continue;
    included.push(srv);
    const stage = srv.loop_stage || "DIAGNOSTICS";
    const exists = store.care_touchpoints.some(
      (t) => t.patient_id === fu.patient_id && t.ref_entity === "protocol_bundle" && t.ref_id === plan.id && t.stage === stage
    );
    if (!exists) {
      const nextTp = (store.care_touchpoints.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0)) + 1;
      store.care_touchpoints.push({
        id: nextTp,
        patient_id: fu.patient_id,
        stage,
        service_code: srv.service_code || stage,
        occurred_on: today,
        source: "AUTO",
        ref_entity: "protocol_bundle",
        ref_id: plan.id,
        amount_inr: srv.price_inr ?? null,
        created_at: new Date().toISOString(),
      });
    }
  }
  return { plan_id: plan.id, bundle_code: bcode, services: included.map((s) => s.type), plan };
}

export function matchCompletedPlansInStore(store, patientId, report, params = [], paramsByReport = {}) {
  const repParams = new Set((params || []).map((p) => p.param_code).filter(Boolean));
  if (repParams.size === 0 || !report) return [];
  const repDate = toIstDateStr(report.collected_on || report.reported_on || todayIstStr());
  const matchedIds = [];

  for (const plan of Object.values(store.recommendations || {})) {
    if (plan.comparison_report_id != null) continue;
    const fu = (store.followups || []).find((f) => f.id === plan.followup_id);
    if (!fu || fu.patient_id !== patientId || fu.report_id === report.id) continue;
    const expected = new Set((plan.test_codes || []).flatMap((c) => [...(TEST_TO_PARAMS[c] || [c])]));
    if (![...expected].some((pm) => repParams.has(pm))) continue;
    const wStart = plan.window_start || fu.retest_window_start || plan.next_test_date;
    const wEnd = plan.window_end || fu.retest_window_end || wStart;
    if (!wStart || !wEnd) continue;
    const graceEnd = addDaysIso(wEnd, 30);
    if (repDate < wStart || repDate > graceEnd) continue;
    plan.comparison_report_id = report.id;
    plan.completed_on = repDate;
    plan.plan_status = repDate <= wEnd ? "COMPLETED_IN_WINDOW" : "COMPLETED_LATE";
    if (plan.booking_status === "BOOKED") plan.booking_status = "COLLECTED";
    matchedIds.push(plan.id);
  }
  if (matchedIds.length) {
    compareInStore(store, patientId, report.id, paramsByReport);
  }
  return matchedIds;
}

export function planOutInStore(store, plan, fu, { role = "DOCTOR", params = [], paramsByReport = {}, secret = "crtracker-edge-key" } = {}) {
  syncPlanFieldsInStore(store, plan, fu, { params });
  const approved = isPlanApprovedInStore(store, plan);
  const hubs = ensureHubs(store);
  const hub = plan.health_hub_id ? hubs.find((h) => h.id === plan.health_hub_id) : null;

  if (role === "CALLER") {
    return {
      id: plan.id,
      followup_id: plan.followup_id,
      label: "Follow-up test",
      approved,
      next_test_date: plan.next_test_date || null,
      window_start: plan.window_start || null,
      window_end: plan.window_end || null,
      booking_status: plan.booking_status || "NOT_BOOKED",
      collection_mode: plan.collection_mode || null,
      health_hub_id: plan.health_hub_id || null,
      health_hub_name: hub?.name || null,
      slot_start: plan.slot_start || null,
      has_address: Boolean(plan.address_enc),
      plan_status: plan.plan_status || "PLANNED",
      steps: [
        { step: 1, title: "Next Recommended Date", done: Boolean(plan.next_test_date) },
        { step: 2, title: "Follow-up Review", done: true },
        { step: 3, title: "Doctor Approval", done: approved },
        { step: 4, title: "Previous Check", done: Boolean(plan.previous_results_snapshot?.length) },
        { step: 5, title: "Follow-up Test", done: Boolean(plan.test_codes?.length) },
        { step: 6, title: "Collection Booking", done: ["BOOKED", "COLLECTED"].includes(plan.booking_status) },
        { step: 7, title: "Follow-up Comparison", done: plan.comparison_report_id != null },
      ],
    };
  }

  const isAdmin = role === "ADMIN";
  const testsOut = (plan.tests || []).map((t) => {
    if (isAdmin) return { ...t };
    const { price_inr, ...rest } = t;
    return rest;
  });
  const snapCodes = new Set((plan.previous_results_snapshot || []).map((s) => s.code));
  const prevLive = (params || [])
    .filter((p) => snapCodes.has(p.param_code))
    .map((p) => ({ code: p.param_code, name: p.param_name_raw, value: p.value_num, unit: p.unit, flag: p.system_flag, report_id: fu.report_id }));
  const compRows = plan.comparison_report_id ? compareInStore(store, fu.patient_id, plan.comparison_report_id, paramsByReport) : [];
  const addr = plan.address_enc ? decryptAddress(plan.address_enc, secret) : "";

  const out = {
    id: plan.id,
    followup_id: plan.followup_id,
    approved,
    approved_by_doctor_id: plan.approved_by_doctor_id ?? null,
    protocol_code: plan.protocol_code || null,
    protocol_version: plan.protocol_version ?? null,
    next_test_date: plan.next_test_date || null,
    window_start: plan.window_start || null,
    window_end: plan.window_end || null,
    reason_code: plan.reason_code || "",
    reason_text_clinical: plan.reason_text_clinical || "",
    previous_results_snapshot: plan.previous_results_snapshot || [],
    previous_results_live: prevLive,
    tests: testsOut,
    test_codes: plan.test_codes || [],
    bundle_code: plan.bundle_code || null,
    collection_mode: plan.collection_mode || null,
    health_hub_id: plan.health_hub_id || null,
    health_hub_name: hub?.name || null,
    slot_start: plan.slot_start || null,
    address: addr,
    booking_status: plan.booking_status || "NOT_BOOKED",
    lab_order_ref: plan.lab_order_ref || "",
    comparison_report_id: plan.comparison_report_id ?? null,
    comparison_rows: compRows,
    plan_status: plan.plan_status || "PLANNED",
    completed_on: plan.completed_on || null,
    steps: [
      { step: 1, title: "Next Recommended Test Date", done: Boolean(plan.next_test_date), detail: plan.window_start && plan.window_end && plan.window_end !== plan.window_start ? `${plan.window_start} to ${plan.window_end}` : (plan.window_start || "") },
      { step: 2, title: "Reason for Retesting", done: Boolean(plan.reason_code), detail: plan.reason_code || "" },
      { step: 3, title: "Treating Clinician or Approved Protocol", done: approved, detail: plan.approved_by_doctor_id != null ? `Approved by doctor #${plan.approved_by_doctor_id}` : approved ? `${plan.protocol_code} v${plan.protocol_version}` : "Pending approval" },
      { step: 4, title: "Previous Diagnostic Results", done: prevLive.length > 0, detail: `${prevLive.length} indicator(s) linked` },
      { step: 5, title: "Recommended Tests", done: testsOut.length > 0, detail: testsOut.map((t) => t.name).join(", ") },
      { step: 6, title: "Home Collection or Health Hub Booking Option", done: ["BOOKED", "COLLECTED"].includes(plan.booking_status), detail: `${plan.booking_status || "NOT_BOOKED"}${plan.collection_mode ? ` (${plan.collection_mode})` : ""}` },
      { step: 7, title: "Automated Report Comparison", done: plan.comparison_report_id != null, detail: plan.comparison_report_id != null ? (plan.plan_status || "COMPLETED") : "Waiting for follow-up report" },
    ],
  };
  if (isAdmin) {
    out.tests_total_inr = (plan.tests || []).reduce((s, t) => s + (!t?.optional ? Number(t?.price_inr || 0) : 0), 0);
  }
  return out;
}

export function explainPlanInStore(store, plan, fu, { lang = "en", params = [], paramsByReport = {} } = {}) {
  syncPlanFieldsInStore(store, plan, fu, { params });
  const useHi = String(lang || "en").trim().toLowerCase().startsWith("hi");
  const wS = plan.window_start || plan.next_test_date || "—";
  const wE = plan.window_end || wS;
  const testNames = (plan.tests || []).map((t) => t.name).join(", ") || "Recommended tests";
  const targetRep = plan.comparison_report_id || fu.report_id;
  const compRows = targetRep ? compareInStore(store, fu.patient_id, targetRep, paramsByReport) : [];
  let howLines = compRows.map((r) => r.patient_summary_line).filter(Boolean);

  let why;
  let when;
  let patientMsg;
  let title;
  if (useHi) {
    why = `डॉक्टर के परामर्श के अनुसार आपकी स्वास्थ्य प्रगति की जाँच के लिए अनुवर्ती जांच (${plan.reason_code}) आवश्यक है। ${plan.reason_text_clinical}`;
    when = `अनुशंसित जांच विंडो: ${wS} से ${wE}।`;
    patientMsg = `आपकी अनुवर्ती जांच ${wS} से ${wE} के बीच देय है।`;
    if (howLines.length === 0) howLines = ["नियमित तुलनात्मक रिपोर्ट के आधार पर डॉक्टर आपके स्वास्थ्य संकेतकों की समीक्षा करेंगे।"];
    title = "रोगी जांच योजना सारांश (क्यों, कब और कैसे)";
  } else {
    why = plan.reason_text_clinical || "Follow-up testing helps confirm how your body is responding over time.";
    when = `Recommended window: ${wS}${wE !== wS ? ` to ${wE}` : ""}.`;
    patientMsg = `Your follow-up test is due between ${wS} and ${wE}`;
    if (howLines.length === 0) howLines = ["Your previous and upcoming indicators will be compared automatically once your repeat test arrives."];
    title = "Patient Retesting Summary (Why, When & How)";
  }
  return {
    language: useHi ? "hi" : "en",
    title,
    tests: testNames,
    why,
    when,
    how_lines: howLines,
    comparison_rows: compRows,
    patient_message: patientMsg,
    disclaimer: "Medication changes remain the responsibility of the treating clinician.",
  };
}

function _periodKpisInStore(store, frm, to, { hubId = null, protocol = "" } = {}) {
  const assessedPids = new Set();
  for (const r of store.reports || []) {
    if (r.status !== "READY" || !r.patient_id) continue;
    const d = toIstDateStr(r.collected_on || r.created_at || todayIstStr());
    if (d >= frm && d <= to) assessedPids.add(r.patient_id);
  }

  const eligPids = new Set();
  let compDue = 0;
  let compInWin = 0;
  let revInr = 0;
  let revPlans = 0;
  const protoQ = String(protocol || "").trim().toUpperCase();

  for (const plan of Object.values(store.recommendations || {})) {
    const fu = (store.followups || []).find((f) => f.id === plan.followup_id);
    if (!fu) continue;
    const rep = (store.reports || []).find((r) => r.id === fu.report_id);
    if (hubId != null && plan.health_hub_id !== hubId) continue;
    if (protoQ && ![plan.bundle_code, plan.protocol_code, plan.reason_code].map((x) => String(x || "").toUpperCase()).includes(protoQ)) continue;

    const approved = isPlanApprovedInStore(store, plan);
    const refDay = toIstDateStr(rep?.collected_on || plan.created_at || todayIstStr());
    if (approved && refDay >= frm && refDay <= to) eligPids.add(fu.patient_id);

    const dueWin = plan.window_end || plan.window_start || plan.next_test_date;
    if (approved && dueWin && dueWin >= frm && dueWin <= to) {
      compDue += 1;
      if (plan.plan_status === "COMPLETED_IN_WINDOW") compInWin += 1;
    }
    if (approved && ["COMPLETED_IN_WINDOW", "COMPLETED_LATE"].includes(plan.plan_status) && plan.completed_on && plan.completed_on >= frm && plan.completed_on <= to) {
      revPlans += 1;
      revInr += (plan.tests || []).reduce((s, t) => s + Number(t?.price_inr || 0), 0);
    }
  }

  const eligNum = eligPids.size;
  const eligDen = assessedPids.size;
  return {
    elig_num: eligNum,
    elig_den: eligDen,
    elig_pct: eligDen ? Math.round((1000 * eligNum) / eligDen) / 10 : null,
    comp_num: compInWin,
    comp_den: compDue,
    comp_pct: compDue ? Math.round((1000 * compInWin) / compDue) / 10 : null,
    rev_inr: revInr,
    rev_plans: revPlans,
  };
}

export function computeKpisInStore(store, { from = "", to = "", hubId = null, protocol = "" } = {}) {
  const toD = to || todayIstStr();
  const frmD = from || addDaysIso(toD, -89);
  const msDay = 86400000;
  const span = Math.max(Math.round((Date.parse(toD) - Date.parse(frmD)) / msDay) + 1, 1);
  const prevTo = addDaysIso(frmD, -1);
  const prevFrm = addDaysIso(prevTo, -(span - 1));

  const cur = _periodKpisInStore(store, frmD, toD, { hubId, protocol });
  const prev = _periodKpisInStore(store, prevFrm, prevTo, { hubId, protocol });
  const trend = (cVal, pVal, suffix) => {
    if (cVal == null || pVal == null) return "—";
    const d = Math.round((cVal - pVal) * 10) / 10;
    if (d === 0) return `0${suffix}`;
    return `${d > 0 ? "+" : "\u2212"}${Math.abs(d)}${suffix}`;
  };

  return {
    from: frmD,
    to: toD,
    hub_id: hubId,
    protocol: protocol || "",
    kpis: [
      {
        key: "eligibility_rate",
        name: "Retesting eligibility rate",
        definition: "Patients with a documented clinical indication for repeat testing \u00f7 patients assessed",
        business_significance: "Measures the appropriate follow-up opportunity",
        numerator: cur.elig_num,
        denominator: cur.elig_den,
        value: cur.elig_pct,
        unit: "%",
        display: cur.elig_pct != null ? `${cur.elig_pct}%` : "—",
        trend: trend(cur.elig_pct, prev.elig_pct, "%"),
      },
      {
        key: "completion_rate",
        name: "Retesting completion rate",
        definition: "Eligible patients completing retesting within the recommended window \u00f7 eligible patients due",
        business_significance: "Measures follow-up effectiveness",
        numerator: cur.comp_num,
        denominator: cur.comp_den,
        value: cur.comp_pct,
        unit: "%",
        display: cur.comp_pct != null ? `${cur.comp_pct}%` : "—",
        trend: trend(cur.comp_pct, prev.comp_pct, "%"),
      },
      {
        key: "repeat_revenue",
        name: "Repeat diagnostics revenue",
        definition: "Revenue generated from medically indicated repeat tests",
        business_significance: "Measures recurring diagnostic revenue",
        numerator: cur.rev_inr,
        denominator: cur.rev_plans,
        value: cur.rev_inr,
        unit: "INR",
        display: `\u20b9${cur.rev_inr.toLocaleString("en-IN")}`,
        trend: trend(cur.rev_inr, prev.rev_inr, " INR"),
      },
    ],
  };
}
