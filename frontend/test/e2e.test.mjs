/**
 * E2E Test Suite for CRTracker Cloudflare Worker Edge Mode
 * 
 * 4-Tier Opaque-Box Architecture:
 * - Tier 1: Feature Coverage (F1 to F15)
 * - Tier 2: Boundary & Corner Cases (B1 to B10)
 * - Tier 3: Cross-Feature Interactions (X1 to X6)
 * - Tier 4: Real-World Application Scenarios (S1 to S5)
 *
 * Runner: Node.js built-in test runner (`node --test`), zero external dependencies.
 */

import { test, describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
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
  DEFAULT_ALIASES,
  DEFAULT_REFERENCE_RANGES,
  DEFAULT_SEVERITY,
} from "../lib/extract.js";

// ============================================================================
// Test Harness & Mock Environment Helpers
// ============================================================================

const RULES = {
  reference_ranges: DEFAULT_REFERENCE_RANGES,
  severity: DEFAULT_SEVERITY,
  aliases: DEFAULT_ALIASES,
};

function createSeedStore() {
  return {
    demo_purged: true,
    batches: [],
    orders: [
      {
        id: 41,
        order_id: "ORD-041",
        patient_id: 1,
        status: "READY",
        error: "",
        attempts: 1,
        report_kind: "labtrace",
        updated_at: "2026-05-10T10:00:00Z",
      },
      {
        id: 101,
        order_id: "ORD-101",
        patient_id: 1,
        status: "READY",
        error: "",
        attempts: 1,
        report_kind: "labtrace",
        updated_at: "2026-01-15T10:00:00Z",
      },
      {
        id: 102,
        order_id: "ORD-102",
        patient_id: 1,
        status: "READY",
        error: "",
        attempts: 1,
        report_kind: "labtrace",
        updated_at: "2026-06-20T10:00:00Z",
      },
      {
        id: 201,
        order_id: "ORD-201",
        patient_id: 2,
        status: "NEEDS_REVIEW",
        error: "",
        attempts: 1,
        report_kind: "labtrace",
        updated_at: "2026-07-01T10:00:00Z",
      },
    ],
    reports: [
      {
        id: 41,
        order_id: "ORD-041",
        order_pk: 41,
        patient_id: 1,
        patient_name: "John Doe",
        mobile: "9876500001",
        age: 45,
        gender: "M",
        collected_on: "2026-05-10T08:00:00Z",
        status: "READY",
        source: "labtrace",
        confidence: null,
        needs_review: false,
        review_reasons: [],
        classification: null,
        abnormal_count: null,
        parameters: [],
      },
      {
        id: 101,
        order_id: "ORD-101",
        order_pk: 101,
        patient_id: 1,
        patient_name: "John Doe",
        mobile: "9876500001",
        age: 45,
        gender: "M",
        collected_on: "2026-01-15T08:00:00Z",
        status: "READY",
        source: "labtrace",
        confidence: 90,
        needs_review: false,
        review_reasons: [],
        classification: "ABNORMAL",
        abnormal_count: 1,
        parameters: [],
      },
      {
        id: 102,
        order_id: "ORD-102",
        order_pk: 102,
        patient_id: 1,
        patient_name: "John Doe",
        mobile: "9876500001",
        age: 45,
        gender: "M",
        collected_on: "2026-06-20T08:00:00Z",
        status: "READY",
        source: "labtrace",
        confidence: 95,
        needs_review: false,
        review_reasons: [],
        classification: "NORMAL",
        abnormal_count: 0,
        parameters: [],
      },
      {
        id: 201,
        order_id: "ORD-201",
        order_pk: 201,
        patient_id: 2,
        patient_name: "Jane Doe",
        mobile: "9876500001",
        age: 42,
        gender: "F",
        collected_on: "2026-07-01T08:00:00Z",
        status: "NEEDS_REVIEW",
        source: "labtrace",
        confidence: 65,
        needs_review: true,
        review_reasons: ["Discrepancy detected in HbA1c value"],
        classification: "ABNORMAL",
        abnormal_count: 1,
        parameters: [],
      },
    ],
    patients: [
      {
        id: 1,
        name: "John Doe",
        gender: "M",
        age: 45,
        mobile: "9876500001",
        household_tag: "HH-001",
        language: "en",
        do_not_call: false,
      },
      {
        id: 2,
        name: "Jane Doe",
        gender: "F",
        age: 42,
        mobile: "9876500001",
        household_tag: "HH-001",
        language: "en",
        do_not_call: false,
      },
      {
        id: 3,
        name: "Bob Smith",
        gender: "M",
        age: 60,
        mobile: "9876500002",
        household_tag: "",
        language: "hi",
        do_not_call: true,
      },
    ],
    followups: [
      {
        id: 1,
        order_id: 101,
        report_id: 101,
        patient_id: 1,
        patient_name: "John Doe",
        mobile: "9876500001",
        priority: "ROUTINE",
        stage: "QUEUED",
        created_at: "2026-01-15T12:00:00Z",
      },
      {
        id: 2,
        order_id: 201,
        report_id: 201,
        patient_id: 2,
        patient_name: "Jane Doe",
        mobile: "9876500001",
        priority: "ROUTINE",
        stage: "QUEUED",
        created_at: "2026-07-01T12:00:00Z",
      },
    ],
    users: [],
    doctors: [],
    notifications: { unread: 0, items: [] },
    settings: {
      caller_can_view_results: false,
      company_name: "SecondMedic",
      default_language: "en",
      session_minutes: 30,
    },
    identityReviews: [],
    audit: [],
    comments: {},
    workflows: {},
  };
}

const DEFAULT_PARAMS_101 = [
  {
    id: 1,
    param_code: "HBA1C",
    param_name_raw: "HbA1c (Glycosylated Hemoglobin)",
    value_num: 7.2,
    value_text: "7.2",
    unit: "%",
    ref_low: null,
    ref_high: 5.7,
    ref_text: "<5.7",
    system_flag: "HIGH",
    severity: "mild",
    deviation_pct: 26.3,
    ref_source: "report",
  },
  {
    id: 2,
    param_code: "GLUCOSE_FASTING",
    param_name_raw: "Fasting Blood Sugar",
    value_num: 95,
    value_text: "95",
    unit: "mg/dL",
    ref_low: 70,
    ref_high: 100,
    ref_text: "70 - 100",
    system_flag: "NORMAL",
    severity: "mild",
    deviation_pct: 0,
    ref_source: "report",
  },
];

const DEFAULT_PARAMS_102 = [
  {
    id: 1,
    param_code: "HBA1C",
    param_name_raw: "HbA1c (Glycosylated Hemoglobin)",
    value_num: 5.4,
    value_text: "5.4",
    unit: "%",
    ref_low: null,
    ref_high: 5.7,
    ref_text: "<5.7",
    system_flag: "NORMAL",
    severity: "mild",
    deviation_pct: 0,
    ref_source: "report",
  },
];

const DEFAULT_PARAMS_201 = [
  {
    id: 1,
    param_code: "HBA1C",
    param_name_raw: "HbA1c",
    value_num: 8.1,
    value_text: "8.1",
    unit: "%",
    ref_low: null,
    ref_high: 5.7,
    ref_text: "<5.7",
    system_flag: "HIGH",
    severity: "moderate",
    deviation_pct: 42.1,
    ref_source: "report",
  },
];

const DEFAULT_INSIGHT_101 = {
  id: 1,
  report_id: 101,
  version: 1,
  status: "APPROVED",
  overview: "HbA1c is elevated at 7.2%, indicating diabetic range glycaemia.",
  defects: [
    { code: "HBA1C", name: "HbA1c", value: 7.2, unit: "%", flag: "HIGH", severity: "mild" },
  ],
  suggestions: {
    doctor_discussion: ["Discuss dietary modification and glycemic control"],
    caller_questions: ["Have you noticed increased thirst or tiredness?"],
  },
  doctor_connect: {
    priority: "PRIORITY",
    source: "rules",
    reason: "Elevated HbA1c",
    connect_within_hours: 24,
  },
  red_flag_protocol: "If severe symptoms appear, advise immediate hospital visit.",
  limitations: "Based on single point lab evaluation.",
  needs_doctor_review: false,
  generated_at: "2026-01-15T12:00:00Z",
};

const DEFAULT_INSIGHT_201 = {
  id: 2,
  report_id: 201,
  version: 1,
  status: "DRAFT",
  overview: "Preliminary analysis pending clinical signoff.",
  defects: [
    { code: "HBA1C", name: "HbA1c", value: 8.1, unit: "%", flag: "HIGH", severity: "moderate" },
  ],
  suggestions: {
    doctor_discussion: ["Review marked glucose discrepancy"],
    caller_questions: ["How are you feeling lately?"],
  },
  doctor_connect: {
    priority: "PRIORITY",
    source: "rules",
    reason: "Marked elevation",
    connect_within_hours: 24,
  },
  red_flag_protocol: "Standard emergency advisory.",
  limitations: "Unapproved draft.",
  needs_doctor_review: true,
  generated_at: "2026-07-01T12:00:00Z",
};

function createMockEnv(seedStore = createSeedStore(), extraKv = {}) {
  const kv = new Map();

  // Seed app state
  kv.set("app_state_v5", JSON.stringify(seedStore));

  // Seed default params and insights
  kv.set("report_params:101", JSON.stringify(DEFAULT_PARAMS_101));
  kv.set("report_params:102", JSON.stringify(DEFAULT_PARAMS_102));
  kv.set("report_params:201", JSON.stringify(DEFAULT_PARAMS_201));
  kv.set("insight:101", JSON.stringify(DEFAULT_INSIGHT_101));
  kv.set("insight:201", JSON.stringify(DEFAULT_INSIGHT_201));

  // Seed any additional KV keys
  for (const [k, v] of Object.entries(extraKv)) {
    kv.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }

  const crtrackerData = {
    async get(key, type) {
      const val = kv.get(key);
      if (val === undefined || val === null) return null;
      if (type === "json") {
        try {
          return JSON.parse(val);
        } catch {
          return null;
        }
      }
      return val;
    },
    async put(key, value, opts) {
      kv.set(key, typeof value === "string" ? value : JSON.stringify(value));
    },
    async delete(key) {
      kv.delete(key);
    },
    async list(opts = {}) {
      const prefix = opts.prefix || "";
      const keys = [];
      for (const k of kv.keys()) {
        if (k.startsWith(prefix)) keys.push({ name: k });
      }
      return { keys };
    },
    _map: kv,
  };

  return {
    CRTRACKER_DATA: crtrackerData,
    AI: {
      async toMarkdown(files, opts) {
        return [
          {
            name: files?.[0]?.name || "report.pdf",
            data: `THYROCARE REPORT
Patient Name: John Doe
Age: 45 Y / Male
Sample Collected: 2026-05-10
HbA1c (Glycosylated Hemoglobin) H.P.L.C 7.2 % <5.7
Fasting Blood Sugar PHOTOMETRY 115 mg/dL 70-100
Total Cholesterol PHOTOMETRY 210 mg/dL <200`,
          },
        ];
      },
    },
    ASSETS: {
      async fetch(req) {
        return new Response("Static asset", { status: 200 });
      },
    },
    ADMIN_EMAIL: "admin@secondmedic.com",
    ADMIN_PASSWORD: "AdminPassword123!",
    GOOGLE_API_KEY: "test-google-api-key",
  };
}

async function fetchRoute(workerInstance, env, method, path, { cookie, body, headers = {} } = {}) {
  const reqHeaders = {
    Origin: "http://localhost",
    ...headers,
  };
  if (cookie) reqHeaders["Cookie"] = cookie;
  let reqBody = undefined;
  if (body !== undefined) {
    if (typeof body === "string") {
      reqBody = body;
    } else {
      reqHeaders["Content-Type"] = "application/json";
      reqBody = JSON.stringify(body);
    }
  }

  const req = new Request(`http://localhost${path}`, {
    method,
    headers: reqHeaders,
    body: reqBody,
  });

  return await workerInstance.fetch(req, env);
}

async function getAuthCookies(workerInstance, env) {
  // 1. Admin login
  const adminRes = await fetchRoute(workerInstance, env, "POST", "/api/v1/auth/login", {
    body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  });
  const adminCookie = adminRes.headers.get("set-cookie")?.split(";")[0] || "";

  // 2. Create Doctor user
  await fetchRoute(workerInstance, env, "POST", "/api/v1/users", {
    cookie: adminCookie,
    body: {
      name: "Dr. Smith",
      email: "doctor@secondmedic.com",
      password: "DoctorPassword123!",
      role: "DOCTOR",
    },
  });
  const doctorRes = await fetchRoute(workerInstance, env, "POST", "/api/v1/auth/login", {
    body: { email: "doctor@secondmedic.com", password: "DoctorPassword123!" },
  });
  const doctorCookie = doctorRes.headers.get("set-cookie")?.split(";")[0] || "";

  // 3. Create Caller user
  await fetchRoute(workerInstance, env, "POST", "/api/v1/users", {
    cookie: adminCookie,
    body: {
      name: "Caller Alice",
      email: "caller@secondmedic.com",
      password: "CallerPassword123!",
      role: "CALLER",
    },
  });
  const callerRes = await fetchRoute(workerInstance, env, "POST", "/api/v1/auth/login", {
    body: { email: "caller@secondmedic.com", password: "CallerPassword123!" },
  });
  const callerCookie = callerRes.headers.get("set-cookie")?.split(";")[0] || "";

  return { adminCookie, doctorCookie, callerCookie };
}

// ============================================================================
// Tier 1: Feature Coverage (Isolated Happy Path)
// ============================================================================

describe("Tier 1: Feature Coverage (F1 to F15)", () => {
  it("F1: Extraction rule engine output structure", () => {
    const text = `
    Thyrocare Technologies Limited
    Patient: John Doe, 45 Y / Male
    HbA1c (Glycosylated Hemoglobin) H.P.L.C 7.2 % <5.7
    Fasting Blood Sugar PHOTOMETRY 115 mg/dL 70 - 100
    Total Cholesterol PHOTOMETRY 210 mg/dL <200
    `;
    const params = extractParameters(text, RULES);
    assert.ok(Array.isArray(params), "Parameters must be an array");
    assert.ok(params.length >= 3, "Extracted at least 3 parameters");

    const requiredKeys = [
      "param_code",
      "param_name_raw",
      "value_num",
      "value_text",
      "unit",
      "ref_low",
      "ref_high",
      "ref_text",
      "system_flag",
      "severity",
      "deviation_pct",
      "ref_source",
    ];

    for (const p of params) {
      for (const k of requiredKeys) {
        assert.ok(k in p, `Parameter must contain '${k}'`);
      }
      assert.ok(typeof p.value_num === "number" || p.value_num === null);
      assert.ok(["LOW", "HIGH", "NORMAL", ""].includes(p.system_flag));
      assert.ok(["mild", "moderate", "severe", ""].includes(p.severity));
    }
  });

  it("F2: Normal range parsing forms (<, <=, >, >=, -, to)", () => {
    assert.deepStrictEqual(parseRange("<5.7"), [null, 5.7, false, true]);
    assert.deepStrictEqual(parseRange("<= 5.7"), [null, 5.7, false, false]);
    assert.deepStrictEqual(parseRange("≤ 5.7"), [null, 5.7, false, false]);
    assert.deepStrictEqual(parseRange(">= 150"), [150.0, null, false, false]);
    assert.deepStrictEqual(parseRange("≥ 150"), [150.0, null, false, false]);
    assert.deepStrictEqual(parseRange("> 150"), [150.0, null, true, false]);
    assert.deepStrictEqual(parseRange("10 - 20"), [10.0, 20.0, false, false]);
    assert.deepStrictEqual(parseRange("10 to 20"), [10.0, 20.0, false, false]);
    assert.deepStrictEqual(parseRange("0.4–4.2"), [0.4, 4.2, false, false]);
    assert.deepStrictEqual(parseRange("1,000 to 2,000"), [1000.0, 2000.0, false, false]);
    assert.strictEqual(parseRange("Absent"), null);
    assert.strictEqual(parseRange(""), null);
  });

  it("F3: Parameter flagging (LOW, HIGH, NORMAL) and classification with severity", () => {
    const normalParam = {
      param_code: "GLUCOSE_FASTING",
      value_num: 85,
      value_text: "85",
      ref_text: "70 - 100",
      ref_low: 70,
      ref_high: 100,
    };
    flagParameter(normalParam, "M", RULES);
    assert.strictEqual(normalParam.system_flag, "NORMAL");

    const highParam = {
      param_code: "HBA1C",
      value_num: 7.2,
      value_text: "7.2",
      ref_text: "<5.7",
      ref_low: null,
      ref_high: 5.7,
    };
    flagParameter(highParam, "M", RULES);
    assert.strictEqual(highParam.system_flag, "HIGH");
    assert.strictEqual(highParam.severity, "severe"); // (7.2 - 5.7)/5.7 = 26.3% >= 25%

    const lowParam = {
      param_code: "GLUCOSE_FASTING",
      value_num: 60,
      value_text: "60",
      ref_text: "70 - 100",
      ref_low: 70,
      ref_high: 100,
    };
    flagParameter(lowParam, "M", RULES);
    assert.strictEqual(lowParam.system_flag, "LOW");

    // Severity bands
    assert.strictEqual(severityFor(5.0), "mild");
    assert.strictEqual(severityFor(15.0), "moderate");
    assert.strictEqual(severityFor(30.0), "severe");

    // Classification
    assert.strictEqual(classifyReport([normalParam]), "NORMAL");
    assert.strictEqual(classifyReport([normalParam, highParam]), "ABNORMAL");
    assert.strictEqual(countAbnormalParameters([normalParam, highParam, lowParam]), 2);
  });

  it("F4: Parameter KV storage & GET /reports/:id returning sorted parameters + pdf_url", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    const res = await fetchRoute(worker, env, "GET", "/api/v1/reports/101", { cookie: doctorCookie });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.id, 101);
    assert.ok(body.pdf_url?.includes("/reports/101/pdf"));
    assert.ok(Array.isArray(body.parameters));
    assert.strictEqual(body.parameters.length, 2);

    // Abnormal parameters sorted first
    assert.strictEqual(body.parameters[0].system_flag, "HIGH");
    assert.strictEqual(body.parameters[1].system_flag, "NORMAL");

    // Verify KV persistence
    const kvStored = await env.CRTRACKER_DATA.get("report_params:101", "json");
    assert.ok(Array.isArray(kvStored));
    assert.strictEqual(kvStored.length, 2);
  });

  it("F5: Report review & parameter correction via PATCH /reports/:id/parameters/:pid and POST /reports/:id/approve", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    // Patch parameter 1 on report 201 (which is in NEEDS_REVIEW)
    const patchRes = await fetchRoute(worker, env, "PATCH", "/api/v1/reports/201/parameters/1", {
      cookie: doctorCookie,
      body: {
        value_num: 5.5,
        value_text: "5.5",
        param_code: "HBA1C",
        ref_text: "<5.7",
      },
    });
    assert.ok([200, 204].includes(patchRes.status), "Parameter patch should return 200 or 204");

    // Approve report
    const approveRes = await fetchRoute(worker, env, "POST", "/api/v1/reports/201/approve", {
      cookie: doctorCookie,
    });
    assert.strictEqual(approveRes.status, 200);

    // Verify report transitioned to READY
    const repRes = await fetchRoute(worker, env, "GET", "/api/v1/reports/201", { cookie: doctorCookie });
    assert.strictEqual(repRes.status, 200);
    const rep = await repRes.json();
    assert.strictEqual(rep.status, "READY");
    assert.strictEqual(rep.needs_review, false);
  });

  it("F6: Patient profile & history GET /patients/:id returning reports & household arrays", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    const res = await fetchRoute(worker, env, "GET", "/api/v1/patients/1", { cookie: doctorCookie });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.id, 1);
    assert.strictEqual(body.name, "John Doe");
    assert.ok(Array.isArray(body.reports), "Should include reports array");
    assert.ok(body.reports.length >= 2, "Should include multiple reports");
    assert.ok(Array.isArray(body.household), "Should include household array");

    // Household contains Jane Doe (sharing mobile 9876500001)
    const hhMember = body.household.find((h) => h.id === 2);
    assert.ok(hhMember, "Household should link Patient 2");
    assert.strictEqual(body.household.some((h) => h.id === 1), false, "Self should not be in household list");
  });

  it("F7: Patient update PATCH /patients/:id (language, do_not_call)", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    const res = await fetchRoute(worker, env, "PATCH", "/api/v1/patients/1", {
      cookie: doctorCookie,
      body: { language: "hi", do_not_call: true },
    });
    assert.strictEqual(res.status, 200);
    const updated = await res.json();
    assert.strictEqual(updated.language, "hi");
    assert.strictEqual(updated.do_not_call, true);

    // Verify field-only audit logging
    const auditRes = await fetchRoute(worker, env, "GET", "/api/v1/audit", { cookie: doctorCookie });
    assert.strictEqual(auditRes.status, 200, "Audit log endpoint must return HTTP 200");
    const logs = await auditRes.json();
    assert.ok(Array.isArray(logs), "Audit log response must be an array");
    const patientLog = logs.find((l) => l.target === "patient-1" || l.entity_id === 1);
    assert.ok(patientLog, "Audit log entry for patient update must exist");
    assert.ok(!JSON.stringify(patientLog).includes("John Doe"), "Audit log must not contain patient name");
    assert.ok(!JSON.stringify(patientLog).includes("9876500001"), "Audit log must not contain phone number");
  });

  it("F8: Trend parameters GET /trends/:pid/parameters", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    const res = await fetchRoute(worker, env, "GET", "/api/v1/trends/1/parameters", { cookie: doctorCookie });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body), "Must return array of parameters");

    const hba1c = body.find((p) => p.code === "HBA1C");
    assert.ok(hba1c, "HbA1c should be available in trends");
    assert.ok(hba1c.count >= 2, "HbA1c should have at least 2 readings");
    assert.ok(hba1c.abnormal >= 1, "HbA1c should record at least 1 abnormal reading");
  });

  it("F9: Longitudinal trend series GET /trends/:pid?codes=...&range=...", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    const res = await fetchRoute(worker, env, "GET", "/api/v1/trends/1?codes=HBA1C&range=1y", {
      cookie: doctorCookie,
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.patient_id, 1);
    assert.strictEqual(body.range, "1y");
    assert.ok(Array.isArray(body.series), "Must return series array");

    const s = body.series[0];
    assert.strictEqual(s.code, "HBA1C");
    assert.ok(Array.isArray(s.points), "Series must contain points array");
    assert.ok(s.points.length >= 2, "Series should contain points from ready reports");

    // Check chronological order ascending
    const d1 = new Date(s.points[0].date).getTime();
    const d2 = new Date(s.points[1].date).getTime();
    assert.ok(d1 <= d2, "Points must be sorted chronologically ascending");

    // Reference band
    assert.ok(s.band, "Must include reference band");
    assert.strictEqual(s.band.high, 5.7);
  });

  it("F10: Trend CSV export GET /exports/trends/:pid.csv with proper headers and data", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    const res = await fetchRoute(worker, env, "GET", "/api/v1/exports/trends/1.csv?codes=HBA1C&range=1y", {
      cookie: doctorCookie,
    });
    assert.strictEqual(res.status, 200);

    const contentType = res.headers.get("content-type") || "";
    assert.ok(contentType.includes("text/csv"), "Content-Type must be text/csv");

    const disposition = res.headers.get("content-disposition") || "";
    assert.ok(disposition.includes("trend-1.csv"), "Content-Disposition filename should be trend-1.csv");

    const csvText = await res.text();
    const lines = csvText.trim().split(/\r?\n/);
    assert.strictEqual(lines[0], "Test,Date,Value,Unit,Flag,Order", "CSV header must match standard");
    assert.ok(lines.length >= 3, "CSV should contain data rows");
  });

  it("F11: AI Insight draft generation with overview, defects, suggestions, doctor_connect", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    const res = await fetchRoute(worker, env, "GET", "/api/v1/reports/101/insight", { cookie: doctorCookie });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.ok(typeof body.overview === "string" && body.overview.length > 0);
    assert.ok(Array.isArray(body.defects), "Must include defects array");
    assert.ok(body.suggestions, "Must include suggestions");
    assert.ok(Array.isArray(body.suggestions.doctor_discussion));
    assert.ok(Array.isArray(body.suggestions.caller_questions));
    assert.ok(body.doctor_connect, "Must include doctor_connect");
    assert.ok(["ROUTINE", "PRIORITY", "URGENT"].includes(body.doctor_connect.priority));
  });

  it("F12: Insight lifecycle: PATCH /reports/:id/insight, POST /reports/:id/insight/approve, POST /reports/:id/insight/reject", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    // 1. Patch insight draft
    const patchRes = await fetchRoute(worker, env, "PATCH", "/api/v1/reports/201/insight", {
      cookie: doctorCookie,
      body: { overview: "Clinician corrected draft overview text." },
    });
    assert.ok([200, 204].includes(patchRes.status));

    // 2. Reject insight
    const rejectRes = await fetchRoute(worker, env, "POST", "/api/v1/reports/201/insight/reject", {
      cookie: doctorCookie,
    });
    assert.strictEqual(rejectRes.status, 200);

    const rejInsight = await env.CRTRACKER_DATA.get("insight:201", "json");
    assert.strictEqual(rejInsight.status, "REJECTED");

    // 3. Approve insight for report 101
    const approveRes = await fetchRoute(worker, env, "POST", "/api/v1/reports/101/insight/approve", {
      cookie: doctorCookie,
    });
    assert.strictEqual(approveRes.status, 200);

    const appInsight = await env.CRTRACKER_DATA.get("insight:101", "json");
    assert.strictEqual(appInsight.status, "APPROVED");
  });

  it("F13: Caller-safe insight projection: CALLER accessing approved insight receives caller_safe: true without clinical defects/numbers", async () => {
    const env = createMockEnv();
    const { callerCookie } = await getAuthCookies(worker, env);

    // Report 101 has approved insight
    const res = await fetchRoute(worker, env, "GET", "/api/v1/reports/101/insight", { cookie: callerCookie });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.caller_safe, true);
    assert.strictEqual(body.defects, undefined, "Defects array must be omitted for caller");

    // Caller questions must not leak numeric test values or diagnosis digits
    const questions = body.suggestions?.caller_questions || [];
    for (const q of questions) {
      assert.ok(!/\d+\.?\d*/.test(q), `Caller question must not contain numbers: '${q}'`);
    }
  });

  it("F14: RBAC route blocking: CALLER receiving 403 on /reports, /patients, /trends, /exports/trends", async () => {
    const env = createMockEnv();
    const { callerCookie } = await getAuthCookies(worker, env);

    const blockedPaths = [
      "/api/v1/reports",
      "/api/v1/reports/101",
      "/api/v1/patients",
      "/api/v1/patients/1",
      "/api/v1/trends/1/parameters",
      "/api/v1/trends/1?codes=HBA1C",
      "/api/v1/exports/trends/1.csv",
    ];

    for (const p of blockedPaths) {
      const res = await fetchRoute(worker, env, "GET", p, { cookie: callerCookie });
      assert.strictEqual(res.status, 403, `CALLER must receive 403 on ${p}, received ${res.status}`);
    }
  });

  it("F15: Honest UI data contract: absence of dummy '9876543210', null classification produces grey NOT ANALYSED, null confidence produces '—'", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    // Unanalyzed report 41
    const res = await fetchRoute(worker, env, "GET", "/api/v1/reports/41", { cookie: doctorCookie });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    // Classification should be null, not fake fallback "NORMAL"
    assert.strictEqual(body.classification, null);
    // Confidence should be null, not fake 0 or 100
    assert.strictEqual(body.confidence, null);
    // Mobile must never be dummy "9876543210"
    assert.notStrictEqual(body.mobile, "9876543210");
  });
});

// ============================================================================
// Tier 2: Boundary & Corner Cases (Boundary Value Analysis)
// ============================================================================

describe("Tier 2: Boundary & Corner Cases (B1 to B10)", () => {
  it("B1: Missing patient returns 404 (never 200 with fallback patient)", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    const res = await fetchRoute(worker, env, "GET", "/api/v1/patients/99999", { cookie: doctorCookie });
    assert.strictEqual(res.status, 404, "Non-existent patient must return 404");
    const body = await res.json();
    assert.notStrictEqual(body.name, "Patient", "Must not return dummy fallback patient");
  });

  it("B2: Missing report returns 404", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    const res = await fetchRoute(worker, env, "GET", "/api/v1/reports/99999", { cookie: doctorCookie });
    assert.strictEqual(res.status, 404, "Non-existent report must return 404");
  });

  it("B3: Invalid report status transition returns 409 (approving a report that is not in NEEDS_REVIEW)", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    // Report 101 is already READY
    const res = await fetchRoute(worker, env, "POST", "/api/v1/reports/101/approve", { cookie: doctorCookie });
    assert.strictEqual(res.status, 409, "Approving an already-ready report must return 409");
  });

  it("B4: Approving report with missing age or gender returns 422", async () => {
    const store = createSeedStore();
    // Create report 301 in NEEDS_REVIEW with missing gender
    store.reports.push({
      id: 301,
      order_id: "ORD-301",
      order_pk: 301,
      patient_id: 1,
      patient_name: "Incomplete Patient",
      mobile: "9876500001",
      age: 30,
      gender: "", // MISSING
      status: "NEEDS_REVIEW",
      source: "labtrace",
      confidence: 50,
      needs_review: true,
      review_reasons: ["Gender missing"],
      classification: "ABNORMAL",
      abnormal_count: 1,
      parameters: [],
    });
    const env = createMockEnv(store);
    const { doctorCookie } = await getAuthCookies(worker, env);

    const res = await fetchRoute(worker, env, "POST", "/api/v1/reports/301/approve", { cookie: doctorCookie });
    assert.strictEqual(res.status, 422, "Approving report with missing gender must return 422");
  });

  it("B5: Trends invalid range or excessive codes (>4) returns 422", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    // Invalid range
    const res1 = await fetchRoute(worker, env, "GET", "/api/v1/trends/1?codes=HBA1C&range=10y", {
      cookie: doctorCookie,
    });
    assert.strictEqual(res1.status, 422, "Invalid range (10y) must return 422");

    // Empty codes
    const res2 = await fetchRoute(worker, env, "GET", "/api/v1/trends/1?codes=&range=1y", {
      cookie: doctorCookie,
    });
    assert.strictEqual(res2.status, 422, "Empty codes must return 422");

    // >4 codes
    const res3 = await fetchRoute(worker, env, "GET", "/api/v1/trends/1?codes=HBA1C,FBS,PPBS,LIPID,CBC&range=1y", {
      cookie: doctorCookie,
    });
    assert.strictEqual(res3.status, 422, "Excessive codes (>4) must return 422");
  });

  it("B6: CSV formula injection sanitization: values starting with =, +, -, @ prepended with '", async () => {
    const store = createSeedStore();
    // Insert parameter with formula injection prefixes across raw name, value_text, unit, flag, and severity
    const maliciousParams = [
      {
        id: 1,
        param_code: "HBA1C",
        param_name_raw: "=cmd|' /C calc'!A0",
        value_num: 7.2,
        value_text: "=1+1",
        unit: "@SUM",
        ref_low: null,
        ref_high: 5.7,
        ref_text: "<5.7",
        system_flag: "+HIGH",
        severity: "-mild",
        deviation_pct: 26.3,
        ref_source: "report",
      },
    ];
    const env = createMockEnv(store, { "report_params:101": maliciousParams });
    const { doctorCookie } = await getAuthCookies(worker, env);

    const res = await fetchRoute(worker, env, "GET", "/api/v1/exports/trends/1.csv?codes=HBA1C&range=1y", {
      cookie: doctorCookie,
    });
    assert.strictEqual(res.status, 200, "CSV export must return HTTP 200");
    const contentType = res.headers.get("content-type") || "";
    assert.ok(contentType.includes("text/csv"), "Content-Type must be text/csv");

    const csvText = await res.text();
    const lines = csvText.trim().split(/\r?\n/);
    assert.strictEqual(lines[0], "Test,Date,Value,Unit,Flag,Order", "CSV header must match standard");
    assert.ok(lines.length >= 2, "CSV export must contain at least header and one data row");

    // Positive verification: verify malicious cells are prepended with a single quote (')
    assert.ok(
      csvText.includes("'=1+1") || csvText.includes("'=cmd"),
      "Formula prefix '=' must be sanitized with leading single quote"
    );
    assert.ok(csvText.includes("'@SUM"), "Formula prefix '@' must be sanitized with leading single quote");
    assert.ok(csvText.includes("'+HIGH"), "Formula prefix '+' must be sanitized with leading single quote");
    assert.ok(csvText.includes("'-mild"), "Formula prefix '-' must be sanitized with leading single quote");

    // Negative verification: no cell starts with unsanitized =, +, -, @
    for (const prefix of ["=", "+", "-", "@"]) {
      const unsanitizedRegex = new RegExp(`(^|,)\\${prefix}`, "m");
      assert.strictEqual(
        unsanitizedRegex.test(csvText),
        false,
        `CSV cell must not start unsanitized with '${prefix}'`
      );
    }
  });

  it("B7: Extreme & inverted ranges: low > high triggers confidence deduction; non-numeric values handled safely", () => {
    // Inverted range
    const invertedParam = {
      param_code: "TEST_INV",
      param_name_raw: "Inverted Range Test",
      value_num: 15.0,
      value_text: "15.0",
      ref_text: "20 - 10",
      ref_low: 20.0,
      ref_high: 10.0,
    };
    const conf = calculateConfidence({ age: 30, gender: "M", collected_on: "2026-05-10" }, [invertedParam]);
    assert.ok(conf.score <= 80, "Inverted range must trigger confidence deduction");
    assert.ok(conf.reasons.some((r) => r.includes("Reference range looks wrong") || r.includes("range")));

    // Non-numeric value handled safely
    const [valNum, valText] = parseValue("Not detected");
    assert.strictEqual(valNum, null);
    assert.strictEqual(valText, "Not detected");
  });

  it("B8: Unmapped test name aliases apply scoring deduction", () => {
    const unmappedParam = {
      param_code: "",
      param_name_raw: "Unregistered Unknown Lab Test",
      value_num: 10.0,
      value_text: "10.0",
    };
    const conf = calculateConfidence({ age: 30, gender: "M", collected_on: "2026-05-10" }, [unmappedParam]);
    assert.ok(conf.score <= 90, "Unmapped test must deduct points from confidence");
    assert.ok(conf.reasons.some((r) => r.includes("not recognised") || r.includes("unmapped")));
  });

  it("B9: Unapproved insight accessed by CALLER returns 403", async () => {
    const env = createMockEnv();
    const { callerCookie } = await getAuthCookies(worker, env);

    // Report 201 has insight in DRAFT
    const res = await fetchRoute(worker, env, "GET", "/api/v1/reports/201/insight", { cookie: callerCookie });
    assert.strictEqual(res.status, 403, "Caller accessing draft insight must receive 403");
  });

  it("B10: AI Priority invariant: AI suggestions never set URGENT priority (capped at PRIORITY)", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    // 1. Generate/regenerate insight on report with abnormal findings but no critical rule hits
    // In seed store, Report 101 has abnormal HbA1c (7.2%) with no critical hits
    const regenRes = await fetchRoute(worker, env, "POST", "/api/v1/reports/101/insight/regenerate", {
      cookie: doctorCookie,
    });
    assert.strictEqual(regenRes.status, 200, "Insight regeneration must succeed with HTTP 200");
    const insight = await regenRes.json();
    assert.ok(insight.doctor_connect, "Insight must include doctor_connect object");
    assert.notStrictEqual(
      insight.doctor_connect.priority,
      "URGENT",
      "AI suggestions must never set URGENT priority without doctor-approved critical rule hits"
    );
    assert.strictEqual(
      insight.doctor_connect.priority,
      "PRIORITY",
      "Elevated abnormal findings without critical hits must be capped at PRIORITY"
    );

    // 2. Reject or cap manual PATCH attempting to inject AI source priority as URGENT
    const patchRes = await fetchRoute(worker, env, "PATCH", "/api/v1/reports/101/insight", {
      cookie: doctorCookie,
      body: {
        doctor_connect: {
          priority: "URGENT",
          source: "ai",
          reason: "Attempting unpermitted AI urgent escalation",
        },
      },
    });
    if (patchRes.status === 200) {
      const patched = await patchRes.json();
      assert.strictEqual(
        patched.doctor_connect?.priority,
        "PRIORITY",
        "AI priority URGENT must be automatically capped to PRIORITY upon update"
      );
    } else {
      assert.ok(
        [400, 422].includes(patchRes.status),
        "Setting AI source priority to URGENT must be rejected with HTTP 400 or 422"
      );
    }
  });
});

// ============================================================================
// Tier 3: Cross-Feature Interactions (X1 to X6)
// ============================================================================

describe("Tier 3: Cross-Feature Interactions (X1 to X6)", () => {
  it("X1: Extraction -> KV Parameters -> Patient Report History", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    // 1. Trigger extraction on Report 41
    const extractRes = await fetchRoute(worker, env, "POST", "/api/v1/reports/41/extract", {
      cookie: doctorCookie,
    });
    assert.ok([200, 201].includes(extractRes.status), "Extraction should return 200 or 201");

    // 2. Verify KV report_params:41 is populated
    const params = await env.CRTRACKER_DATA.get("report_params:41", "json");
    assert.ok(Array.isArray(params), "KV report_params:41 must be created");
    assert.ok(params.length > 0, "Parameters must not be empty");

    // 3. Verify Patient 1 report history reflects updated classification
    const patRes = await fetchRoute(worker, env, "GET", "/api/v1/patients/1", { cookie: doctorCookie });
    assert.strictEqual(patRes.status, 200);
    const pat = await patRes.json();
    const rep41 = pat.reports?.find((r) => r.report_id === 41 || r.order_id === "ORD-041");
    assert.ok(rep41, "Report 41 must appear in patient history");
    assert.ok(["NORMAL", "ABNORMAL"].includes(rep41.classification));
  });

  it("X2: Multiple Extracted Reports -> Longitudinal Trends aggregation", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    const res = await fetchRoute(worker, env, "GET", "/api/v1/trends/1?codes=HBA1C&range=all", {
      cookie: doctorCookie,
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    const s = body.series?.find((s) => s.code === "HBA1C");
    assert.ok(s, "Should contain series for HBA1C");
    assert.ok(s.points.length >= 2, "Should aggregate readings from multiple reports");

    // Verify chronological order
    const dates = s.points.map((p) => new Date(p.date).getTime());
    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i] >= dates[i - 1], "Trend points must be in ascending chronological order");
    }
  });

  it("X3: Report READY -> Auto-Insight generation -> Doctor Approval -> Followup Priority Sync", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    // Doctor approves insight for report 101
    const approveRes = await fetchRoute(worker, env, "POST", "/api/v1/reports/101/insight/approve", {
      cookie: doctorCookie,
    });
    assert.strictEqual(approveRes.status, 200);

    // Followup priority should synchronize to PRIORITY
    const followupsRes = await fetchRoute(worker, env, "GET", "/api/v1/followups", { cookie: doctorCookie });
    assert.strictEqual(followupsRes.status, 200, "Followups endpoint must return HTTP 200");
    const followups = await followupsRes.json();
    assert.ok(Array.isArray(followups), "Followups response must be an array");
    const fu = followups.find((f) => f.report_id === 101);
    assert.ok(fu, "Followup entry for report 101 must exist");
    assert.strictEqual(fu.priority, "PRIORITY", "Followup priority must synchronize to PRIORITY");
  });

  it("X4: Insight Draft -> CALLER 403 -> Doctor Approval -> CALLER Safe Projection 200", async () => {
    const env = createMockEnv();
    const { doctorCookie, callerCookie } = await getAuthCookies(worker, env);

    // 1. Caller denied on Report 201 (draft insight)
    const res1 = await fetchRoute(worker, env, "GET", "/api/v1/reports/201/insight", { cookie: callerCookie });
    assert.strictEqual(res1.status, 403, "Caller must be denied when insight is draft");

    // 2. Doctor approves insight
    const approveRes = await fetchRoute(worker, env, "POST", "/api/v1/reports/201/insight/approve", {
      cookie: doctorCookie,
    });
    assert.strictEqual(approveRes.status, 200);

    // 3. Caller now receives safe projection
    const res2 = await fetchRoute(worker, env, "GET", "/api/v1/reports/201/insight", { cookie: callerCookie });
    assert.strictEqual(res2.status, 200, "Caller must receive 200 after approval");
    const body = await res2.json();
    assert.strictEqual(body.caller_safe, true);
    assert.strictEqual(body.defects, undefined);
  });

  it("X5: Extraction Needs Review -> Parameter Patch -> Report Approval -> READY transition & field-only audit logging", async () => {
    const env = createMockEnv();
    const { doctorCookie, adminCookie } = await getAuthCookies(worker, env);

    // 1. Doctor patches parameter
    await fetchRoute(worker, env, "PATCH", "/api/v1/reports/201/parameters/1", {
      cookie: doctorCookie,
      body: { value_num: 5.6, value_text: "5.6", param_code: "HBA1C", ref_text: "<5.7" },
    });

    // 2. Doctor approves report
    const approveRes = await fetchRoute(worker, env, "POST", "/api/v1/reports/201/approve", {
      cookie: doctorCookie,
    });
    assert.strictEqual(approveRes.status, 200);

    // 3. Check report is now READY
    const repRes = await fetchRoute(worker, env, "GET", "/api/v1/reports/201", { cookie: doctorCookie });
    const rep = await repRes.json();
    assert.strictEqual(rep.status, "READY");

    // 4. Verify audit log records field names only
    const auditRes = await fetchRoute(worker, env, "GET", "/api/v1/audit", { cookie: adminCookie });
    assert.strictEqual(auditRes.status, 200, "Audit log endpoint must return HTTP 200");
    const logs = await auditRes.json();
    assert.ok(Array.isArray(logs), "Audit logs response must be an array");
    assert.ok(logs.length > 0, "Audit logs must contain at least one entry");
    const lastAudit = logs[0];
    assert.ok(!JSON.stringify(lastAudit).includes("Jane Doe"), "Audit log must not contain patient name");
    assert.ok(!JSON.stringify(lastAudit).includes("5.6"), "Audit log must not contain clinical test values");
  });

  it("X6: Trends Parameter Filter -> CSV Export Consistency", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    // 1. Fetch JSON trend series
    const jsonRes = await fetchRoute(worker, env, "GET", "/api/v1/trends/1?codes=HBA1C&range=1y", {
      cookie: doctorCookie,
    });
    assert.strictEqual(jsonRes.status, 200, "JSON trend series endpoint must return 200");
    const jsonData = await jsonRes.json();
    assert.ok(Array.isArray(jsonData.series), "Trend response must contain series array");
    assert.ok(jsonData.series.length > 0, "Must contain at least one series for HBA1C");
    const points = jsonData.series[0]?.points;
    assert.ok(Array.isArray(points), "Series must contain points array");
    assert.ok(points.length >= 2, "Points array must contain at least 2 historical data points for HBA1C");

    // 2. Fetch CSV export
    const csvRes = await fetchRoute(worker, env, "GET", "/api/v1/exports/trends/1.csv?codes=HBA1C&range=1y", {
      cookie: doctorCookie,
    });
    assert.strictEqual(csvRes.status, 200, "CSV export endpoint must return 200");
    const contentType = csvRes.headers.get("content-type") || "";
    assert.ok(contentType.includes("text/csv"), "Content-Type must be text/csv");

    const csvText = await csvRes.text();
    const lines = csvText.trim().split(/\r?\n/);
    assert.strictEqual(lines[0], "Test,Date,Value,Unit,Flag,Order", "CSV header must match standard");
    const dataRows = lines.slice(1);
    assert.ok(dataRows.length >= 2, "CSV export must contain at least 2 data rows");

    // Consistency check: count and values of points in JSON must match data rows in CSV
    assert.strictEqual(dataRows.length, points.length, "CSV row count must match JSON trend series points count");
    for (let i = 0; i < points.length; i++) {
      const ptVal = String(points[i].value_num ?? points[i].value);
      assert.ok(
        dataRows[i].includes(ptVal),
        `CSV row ${i + 1} ('${dataRows[i]}') must contain matching JSON point value '${ptVal}'`
      );
    }
  });
});

// ============================================================================
// Tier 4: Real-World Application Scenarios (Comprehensive End-to-End)
// ============================================================================

describe("Tier 4: Real-World Application Scenarios (S1 to S5)", () => {
  it("S1: Report 41 Backfill & Immediate Triage", async () => {
    const env = createMockEnv();
    const { adminCookie } = await getAuthCookies(worker, env);

    // 1. Verify Report 41 starts unextracted
    const preRes = await fetchRoute(worker, env, "GET", "/api/v1/reports/41", { cookie: adminCookie });
    assert.strictEqual(preRes.status, 200);
    const preRep = await preRes.json();
    assert.strictEqual(preRep.parameters?.length || 0, 0);

    // 2. Trigger backfill / on-demand extract
    const extractRes = await fetchRoute(worker, env, "POST", "/api/v1/reports/41/extract", {
      cookie: adminCookie,
    });
    assert.ok([200, 201].includes(extractRes.status));

    // 3. Parameters saved in KV and report classification updated
    const postRes = await fetchRoute(worker, env, "GET", "/api/v1/reports/41", { cookie: adminCookie });
    assert.strictEqual(postRes.status, 200);
    const postRep = await postRes.json();

    assert.ok(postRep.parameters?.length > 0, "Parameters should now be extracted");
    assert.ok(["NORMAL", "ABNORMAL"].includes(postRep.classification));
    assert.ok(typeof postRep.confidence === "number");

    // 4. Draft insight created in KV
    const insight = await env.CRTRACKER_DATA.get("insight:41", "json");
    assert.ok(insight, "Draft insight must be created in KV under 'insight:41'");
    assert.strictEqual(insight.report_id, 41, "Draft insight report_id must match 41");
    assert.ok(["DRAFT", "APPROVED"].includes(insight.status), "Draft insight status must be DRAFT or APPROVED");
  });

  it("S2: Longitudinal Patient History & Chronic Trend Analysis over 1 year", async () => {
    const env = createMockEnv();
    const { doctorCookie } = await getAuthCookies(worker, env);

    // 1. Staff opens patient history
    const patRes = await fetchRoute(worker, env, "GET", "/api/v1/patients/1", { cookie: doctorCookie });
    assert.strictEqual(patRes.status, 200);
    const pat = await patRes.json();
    assert.ok(pat.reports.length >= 2);

    // 2. Inspects available parameters
    const paramsRes = await fetchRoute(worker, env, "GET", "/api/v1/trends/1/parameters", { cookie: doctorCookie });
    assert.strictEqual(paramsRes.status, 200);
    const params = await paramsRes.json();
    assert.ok(params.some((p) => p.code === "HBA1C"));

    // 3. Queries 1-year HbA1c trend
    const trendRes = await fetchRoute(worker, env, "GET", "/api/v1/trends/1?codes=HBA1C&range=1y", {
      cookie: doctorCookie,
    });
    assert.strictEqual(trendRes.status, 200);
    const trend = await trendRes.json();
    assert.strictEqual(trend.series[0].code, "HBA1C");

    // 4. Exports CSV
    const csvRes = await fetchRoute(worker, env, "GET", "/api/v1/exports/trends/1.csv?codes=HBA1C&range=1y", {
      cookie: doctorCookie,
    });
    assert.strictEqual(csvRes.status, 200);
  });

  it("S3: Household Linkage & PII Redaction Compliance (phone masking for non-admins)", async () => {
    const env = createMockEnv();
    const { doctorCookie, adminCookie } = await getAuthCookies(worker, env);

    // 1. Doctor views Patient 1 -> Phone is masked
    const docPatRes = await fetchRoute(worker, env, "GET", "/api/v1/patients/1", { cookie: doctorCookie });
    assert.strictEqual(docPatRes.status, 200);
    const docPat = await docPatRes.json();
    assert.strictEqual(docPat.mobile, "XXXXXX0001", "Non-admin must see masked mobile number");
    assert.ok(docPat.household.some((h) => h.id === 2), "Must link household member Jane Doe");

    // 2. Admin views Patient 1 -> Phone is unmasked
    const admPatRes = await fetchRoute(worker, env, "GET", "/api/v1/patients/1", { cookie: adminCookie });
    assert.strictEqual(admPatRes.status, 200);
    const admPat = await admPatRes.json();
    assert.strictEqual(admPat.mobile, "9876500001", "Admin must see unmasked mobile number");

    // 3. Doctor updates preferences -> Audit log contains field names only
    await fetchRoute(worker, env, "PATCH", "/api/v1/patients/1", {
      cookie: doctorCookie,
      body: { language: "hi" },
    });
    const auditRes = await fetchRoute(worker, env, "GET", "/api/v1/audit", { cookie: adminCookie });
    assert.strictEqual(auditRes.status, 200, "Audit log endpoint must return HTTP 200");
    const logs = await auditRes.json();
    assert.ok(Array.isArray(logs), "Audit log must return an array");
    assert.ok(!JSON.stringify(logs).includes("9876500001"), "Audit log must never store plain mobile numbers");
  });

  it("S4: Security Boundary & RBAC Isolation", async () => {
    const env = createMockEnv();
    const { callerCookie, adminCookie } = await getAuthCookies(worker, env);

    // Simulated rogue caller tries to probe sensitive endpoints
    const probes = [
      ["GET", "/api/v1/reports"],
      ["GET", "/api/v1/reports/101"],
      ["GET", "/api/v1/patients"],
      ["GET", "/api/v1/patients/1"],
      ["GET", "/api/v1/trends/1/parameters"],
      ["GET", "/api/v1/trends/1?codes=HBA1C"],
      ["GET", "/api/v1/exports/trends/1.csv"],
      ["GET", "/api/v1/reports/201/insight"], // unapproved insight
    ];

    for (const [method, path] of probes) {
      const res = await fetchRoute(worker, env, method, path, { cookie: callerCookie });
      assert.strictEqual(res.status, 403, `CALLER probing ${path} must receive 403 Forbidden`);
    }

    // Verify audit logs
    const auditRes = await fetchRoute(worker, env, "GET", "/api/v1/audit", { cookie: adminCookie });
    assert.strictEqual(auditRes.status, 200, "Audit log endpoint must return HTTP 200");
    const logs = await auditRes.json();
    assert.ok(Array.isArray(logs), "Audit logs must return an array");
    const rawLog = JSON.stringify(logs);
    assert.ok(!rawLog.includes("9876500001"), "Audit log must not contain unmasked phone numbers");
  });

  it("S5: Clinical Review, Correction, and Doctor Sign-Off full lifecycle", async () => {
    const env = createMockEnv();
    const { doctorCookie, callerCookie } = await getAuthCookies(worker, env);

    // Step 1: Doctor inspects report in NEEDS_REVIEW
    const r1 = await fetchRoute(worker, env, "GET", "/api/v1/reports/201", { cookie: doctorCookie });
    assert.strictEqual(r1.status, 200);

    // Step 2: Doctor corrects parameter value
    const r2 = await fetchRoute(worker, env, "PATCH", "/api/v1/reports/201/parameters/1", {
      cookie: doctorCookie,
      body: { value_num: 5.6, value_text: "5.6", param_code: "HBA1C", ref_text: "<5.7" },
    });
    assert.ok([200, 204].includes(r2.status));

    // Step 3: Doctor approves report
    const r3 = await fetchRoute(worker, env, "POST", "/api/v1/reports/201/approve", { cookie: doctorCookie });
    assert.strictEqual(r3.status, 200);

    // Step 4: Doctor reviews draft insight and edits advice
    const r4 = await fetchRoute(worker, env, "PATCH", "/api/v1/reports/201/insight", {
      cookie: doctorCookie,
      body: { overview: "Doctor finalized review: Glucose parameter normalised." },
    });
    assert.ok([200, 204].includes(r4.status));

    // Step 5: Doctor approves insight
    const r5 = await fetchRoute(worker, env, "POST", "/api/v1/reports/201/insight/approve", {
      cookie: doctorCookie,
    });
    assert.strictEqual(r5.status, 200);

    // Step 6: Caller retrieves approved insight
    const r6 = await fetchRoute(worker, env, "GET", "/api/v1/reports/201/insight", { cookie: callerCookie });
    assert.strictEqual(r6.status, 200);
    const callerPayload = await r6.json();
    assert.strictEqual(callerPayload.caller_safe, true);
    assert.strictEqual(callerPayload.defects, undefined);
  });
});
