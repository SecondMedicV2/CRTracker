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
  test_catalogue: [
    { code: "HBA1C", name: "HbA1c" },
    { code: "FBS", name: "Fasting Blood Sugar" },
    { code: "PPBS", name: "Post-Prandial Blood Sugar" },
    { code: "LIPID", name: "Lipid Profile" },
    { code: "THYROID", name: "Thyroid Profile" },
    { code: "CBC", name: "Complete Blood Count" },
    { code: "IRON", name: "Iron Studies" },
    { code: "VITD", name: "Vitamin D" },
    { code: "B12", name: "Vitamin B12" },
    { code: "KFT", name: "Kidney Function Test" },
    { code: "LFT", name: "Liver Function Test" }
  ]
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
  if (role === "ADMIN") return false;
  if (/^\/(imports|users|admin|audit|integrations|orders)(\/|$)/.test(path)) {
    if (path === "/audit" && role === "DOCTOR") return false;
    return true;
  }
  if (method !== "GET" && /^\/(settings|rules|doctors)(\/|$)/.test(path)) return true;
  if (role === "CALLER" && /^\/(reports|patients|trends|exports\/trends)(\/|$)/.test(path)) {
    if (/^\/reports\/\d+\/insight(?:\/|$)/.test(path) && method === "GET") return false;
    return true;
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
  const start = /^\d{4}-\d{2}-\d{2}$/.test(range?.start || "") ? range.start : defaultStart;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(range?.end || "") ? range.end : defaultEnd;
  if (start && end && end < start) throw new LabTraceError(400, "The end date is before the start date.");

  const lt = await labtraceSession(env);
  const rows = await labtraceJson(lt, "/api/work-orders", "Work orders");
  const workOrders = Array.isArray(rows) ? rows : [];

  const ready = workOrders.filter((wo) => {
    if (!LABTRACE_READY.has(String(wo.status || "").toLowerCase()) && !wo.report_id) return false;
    const day = labtraceDay(wo.sample_collection_datetime || wo.created_at);
    if (!day) return !start && !end;
    return (!start || day >= start) && (!end || day <= end);
  });

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
  const message = ready.length === 0
    ? "LabTrace has no ready reports for these dates."
    : `${added} new report${added === 1 ? "" : "s"} pulled from LabTrace${already ? `, ${already} already here` : ""}${failures.length ? `, ${failures.length} skipped` : ""}.`;

  const batch = {
    id: batchId, source: "labtrace", file_name: start || end ? `${start}..${end}` : "labtrace_sync",
    total: ready.length, new: added, duplicate: already, failed: failures.length, failures,
    patients: batchPatients, started_by: actorId, created_at: now, message
  };
  if (added || failures.length) {
    store.batches.unshift(batch);
    store.dashboard.orders.imported = (store.dashboard.orders.imported || 0) + added;
    store.dashboard.orders.reports_ready = (store.dashboard.orders.reports_ready || 0) + added;
    store.dashboard.needs_attention.needs_review = (store.dashboard.needs_attention.needs_review || 0) + added;
  }
  store.labtrace_last_pull = { at: now, ok: true, message };
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
    pull_lookback_days: 7
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
    workflows: {}
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
    const orders = store.orders || [];
    const reports = store.reports || [];
    const audit = store.audit || [];
    return reply(200, {
      from: url.searchParams.get("from") || "",
      to: url.searchParams.get("to") || "",
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
      followups_due: { today: 0, this_week: 0, overdue: 0, parked: 0 },
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
      doctors: []
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
  if (path === "/followups" && method === "GET") {
    const list = store.followups.map((f) => ({
      id: f.id,
      patient_id: f.patient_id || 1,
      patient_name: f.patient_name || "Patient",
      mobile: f.mobile || "",
      due_on: f.due_on || f.created_at || new Date().toISOString().slice(0, 10),
      stage: f.stage || "QUEUED",
      priority: f.priority || "ROUTINE",
      attempts: f.attempts || 0,
      report_age_days: f.report_age_days || 0,
      buckets: f.buckets || [],
      retest_score: f.retest_score || 50,
      retest_tier: f.retest_tier || "MEDIUM",
      assigned_doctor_id: f.assigned_doctor_id || null,
      deficits_summary: f.deficits_summary || ""
    }));
    return reply(200, list);
  }
  if (path === "/followups/summary" && method === "GET") {
    const queue = store.followups.filter((f) => f.stage !== "DOCTOR_DONE").length;
    const done = store.followups.filter((f) => f.stage === "DOCTOR_DONE").length;
    const escalations = store.followups.filter((f) => f.priority === "ESCALATION").length;
    const _buckets = {};
    for (const f of store.followups) {
      for (const b of (f.buckets || [])) {
        _buckets[b] = (_buckets[b] || 0) + 1;
      }
    }
    return reply(200, {
      queue,
      due_tomorrow: 0,
      due_this_week: queue,
      next_30_days: queue,
      overdue: 0,
      escalations,
      low_potential: 0,
      done,
      _buckets
    });
  }
  if ((path === "/doctor/queue" || path === "/doctor-queue") && method === "GET") {
    const list = me.role === "DOCTOR"
      ? store.followups.filter((f) => f.assigned_doctor_id === me.id)
      : store.followups;
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

  if (path === "/patients" && method === "GET") return reply(200, store.patients);
  const patMatch = path.match(/^\/patients\/(\d+)$/);
  if (patMatch && method === "GET") {
    const pid = parseInt(patMatch[1], 10);
    const p = store.patients.find((item) => item.id === pid) || { id: pid, name: "Patient", gender: "", age: null, mobile: "" };
    return reply(200, { ...p, household: [], reports: [] });
  }
  if (patMatch && method === "DELETE") {
    if (me.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to delete entries" });
    const pid = parseInt(patMatch[1], 10);
    store.patients = store.patients.filter((p) => p.id !== pid);
    await saveStore(env, store);
    return reply(200, { ok: true, deleted: pid });
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
    if (!sub && method === "GET") {
      const fu = store.followups.find((f) => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found." });
      return reply(200, {
        id: fu.id,
        patient_id: fu.patient_id ?? null,
        patient_name: fu.patient_name || "Patient",
        mobile: fu.mobile || "",
        due_on: fu.due_on || fu.created_at || new Date().toISOString().slice(0, 10),
        stage: fu.stage || "QUEUED",
        priority: fu.priority || "ROUTINE",
        attempts: fu.attempts || 0,
        report_age_days: fu.report_age_days || 0,
        buckets: fu.buckets || [],
        retest_score: fu.retest_score ?? null,
        retest_tier: fu.retest_tier ?? null,
        assigned_doctor_id: fu.assigned_doctor_id || null,
        report_id: fu.report_id ?? null,
        score_breakdown: fu.score_breakdown || [],
        suppressed_reason: fu.suppressed_reason || "",
        buckets_detail: fu.buckets_detail || [],
        parked: fu.parked || false
      });
    }
    if (!sub && method === "PATCH") {
      const fu = store.followups.find((f) => f.id === fid);
      if (!fu) return reply(404, { detail: "Follow-up not found." });
      const body = await request.json().catch(() => ({}));
      if (body.priority !== undefined) fu.priority = body.priority;
      if (body.assigned_doctor_id !== undefined) fu.assigned_doctor_id = body.assigned_doctor_id;
      await saveStore(env, store);
      return reply(200, fu);
    }
    if (sub === "/call-card" && method === "GET") {
      if (!fuExists) return reply(404, { detail: "Follow-up not found." });
      const card = store.callcards?.[fid] || store.call_cards?.[fid];
      if (!card) return reply(404, { detail: "No call card yet" });
      return reply(200, card);
    }
    if (sub === "/call-card/generate" && method === "POST") {
      if (!fuExists) return reply(404, { detail: "Follow-up not found." });
      return reply(501, { detail: "Call card generation needs the Python backend (BACKEND_URL)." });
    }
    if (sub === "/caller-card" && method === "GET") {
      if (!fuExists) return reply(404, { detail: "Follow-up not found." });
      const card = store.callcards?.[fid] || store.call_cards?.[fid];
      if (!card) return reply(404, { detail: "No call card yet" });
      return reply(200, card);
    }
    if (sub === "/comments") {
      if (method === "GET") return reply(200, store.comments[fid] || []);
      if (method === "POST") {
        const c = await request.json().catch(() => ({}));
        if (!store.comments[fid]) store.comments[fid] = [];
        const nc = { id: store.comments[fid].length + 1, created_at: new Date().toISOString(), ...c };
        store.comments[fid].push(nc);
        await saveStore(env, store);
        return reply(201, nc);
      }
    }
    if (sub === "/workflow") {
      if (method === "GET") return reply(200, store.workflows[fid] || { calls: [] });
      if (method === "POST") {
        const w = await request.json().catch(() => ({}));
        store.workflows[fid] = { ...(store.workflows[fid] || {}), ...w };
        await saveStore(env, store);
        return reply(200, store.workflows[fid]);
      }
    }
    if (sub === "/approve" && method === "POST") return reply(200, { ok: true, approved: true });
  }

  // --- RULES ---
  const DEFAULT_RULES = {
    aliases: {
      "glycosylated hemoglobin": "HBA1C", "hba1c": "HBA1C", "a1c": "HBA1C",
      "fasting blood sugar": "GLUCOSE_FASTING", "fbs": "GLUCOSE_FASTING", "glucose fasting": "GLUCOSE_FASTING",
      "post prandial glucose": "GLUCOSE_PP", "ppbs": "GLUCOSE_PP",
      "total cholesterol": "CHOL_TOTAL", "cholesterol total": "CHOL_TOTAL",
      "ldl cholesterol": "LDL", "ldl": "LDL", "hdl cholesterol": "HDL", "hdl": "HDL",
      "triglycerides": "TRIGLYCERIDES", "tg": "TRIGLYCERIDES",
      "haemoglobin": "HEMOGLOBIN", "hemoglobin": "HEMOGLOBIN", "hb": "HEMOGLOBIN",
      "tsh": "TSH", "ft3": "FT3", "free t3": "FT3", "ft4": "FT4", "free t4": "FT4",
      "creatinine": "CREATININE", "sgot": "SGOT", "ast": "SGOT", "sgpt": "SGPT", "alt": "SGPT",
      "vitamin d": "VITAMIN_D", "25-oh vitamin d": "VITAMIN_D", "egfr": "EGFR"
    },
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
    test_catalogue: [
      { code: "HBA1C", name: "HbA1c" },
      { code: "FBS", name: "Fasting Blood Sugar" },
      { code: "PPBS", name: "Post-Prandial Blood Sugar" },
      { code: "LIPID", name: "Lipid Profile" },
      { code: "THYROID", name: "Thyroid Profile" },
      { code: "CBC", name: "Complete Blood Count" },
      { code: "IRON", name: "Iron Studies" },
      { code: "VITD", name: "Vitamin D" },
      { code: "B12", name: "Vitamin B12" },
      { code: "KFT", name: "Kidney Function Test" },
      { code: "LFT", name: "Liver Function Test" }
    ],
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
    }
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
      // Background LabTrace sync. The cron fires every 2 minutes; this only pulls when the
      // "Repeat Lab Sync Every (minutes)" setting says it is time (0 = once a day at the IST sync time).
      ctx.waitUntil((async () => {
        if (!labtraceConfigured(env)) return;
        const store = await getStore(env);
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
