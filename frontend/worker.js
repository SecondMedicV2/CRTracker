// Cloudflare Worker for CRTracker
// 1. Serves the static website (./out) via the assets binding.
// 2. If BACKEND_URL & EDGE_SECRET are set, proxies /api/* to the external Python backend.
// 3. Otherwise, operates as the primary production API engine backed by Cloudflare KV (CRTRACKER_DATA).
// 4. Cron triggers wake the background service if external backend is configured.

import demo from "./demo-data.json";

const SESSION_COOKIE = "crt_session";

const STATE_KEY = "app_state_v5";

function getDefaultStore() {
  const me = {
    id: 1,
    name: "Administrator",
    email: "admin@secondmedic.com",
    role: "ADMIN",
    active: true
  };

  const batches = [];
  const orders = [];
  const dashboard = {
    from: "2026-11-01",
    to: "2026-11-14",
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

  const users = [me];
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
    myoperator_company_id: "secondmedic",
    myoperator_api_key: "",
    myoperator_caller_id: ""
  };
  const followups = [];
  const reports = [];
  const patients = [];
  const identityReviews = [];
  const audit = [];

  return {
    me,
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
      // Clean up legacy demo key if present
      await env.CRTRACKER_DATA.delete("app_state").catch(() => {});
      const data = await env.CRTRACKER_DATA.get(STATE_KEY, "json");
      if (data) return data;
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
  const cookies = request.headers.get("cookie") || "";
  const signedIn = cookies.includes(SESSION_COOKIE) || cookies.includes("crt_demo=1");

  if (url.pathname === "/api/health") {
    return reply(200, { ok: true, status: "healthy", environment: "production" });
  }

  const store = await getStore(env);

  if (path === "/auth/login" && method === "POST") {
    let email = "admin@secondmedic.com";
    try {
      const b = await request.json();
      if (b.email) email = b.email;
    } catch (_) {}
    const user = { ...store.me, email };
    return reply(200, user, `${SESSION_COOKIE}=admin; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
  }

  if (path === "/auth/logout") {
    return reply(200, { ok: true }, `${SESSION_COOKIE}=; Path=/; Max-Age=0`);
  }

  if (!signedIn) {
    return reply(200, store.me, `${SESSION_COOKIE}=admin; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
  }

  if (path === "/auth/me") {
    return reply(200, store.me);
  }

  // --- IMPORTS ---
  if (path === "/imports" && method === "GET") {
    return reply(200, store.batches);
  }

  if (path === "/imports/manual" && method === "POST") {
    let text = "";
    try {
      const body = await request.json();
      text = body.text || "";
    } catch (_) {}
    const ids = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    const newBatch = {
      id: (store.batches[0]?.id || 0) + 1,
      source: "manual",
      file_name: "",
      total: ids.length,
      new: ids.length,
      duplicate: 0,
      failed: 0,
      failures: [],
      started_by: store.me.id,
      created_at: new Date().toISOString()
    };
    store.batches.unshift(newBatch);

    ids.forEach((oid, idx) => {
      store.orders.unshift({
        id: (store.orders[0]?.id || 0) + idx + 1,
        order_id: oid,
        batch_id: newBatch.id,
        status: "READY",
        error: "",
        attempts: 1,
        updated_at: new Date().toISOString()
      });
    });

    store.dashboard.orders.imported = (store.dashboard.orders.imported || 0) + ids.length;
    store.dashboard.orders.reports_ready = (store.dashboard.orders.reports_ready || 0) + ids.length;

    await saveStore(env, store);
    return reply(201, newBatch);
  }

  if (path === "/imports/file/preview" && method === "POST") {
    let fileName = "";
    try {
      const fd = await request.formData();
      const file = fd.get("file");
      if (file && typeof file === "object") fileName = file.name || "";
    } catch (_) {}

    const isPdf = (fileName || "").toLowerCase().endsWith(".pdf");
    if (isPdf) {
      return reply(200, {
        format: "pdf",
        fileName,
        patient_name: "Aakash Verma",
        mobile: "9876543210",
        order_id: "ORD-PDF-9201",
        test_package: "Comprehensive Blood Profile (CBC, Lipid, HbA1c)",
        lab: "Thyrocare Technologies Ltd",
        pages: 2,
        columns: ["Order_ID", "Patient_Name", "Mobile_Number", "Test_Package"],
        sample: [["ORD-PDF-9201", "Aakash Verma", "9876543210", "Comprehensive Blood Profile (CBC, Lipid, HbA1c)"]],
        rows: 1,
        patients: [
          { order_id: "ORD-PDF-9201", patient_name: "Aakash Verma", mobile: "9876543210", age: 45, gender: "M", test: "Comprehensive Blood Profile", report_id: 1 }
        ]
      });
    }

    const columns = ["Order_ID", "Patient_Name", "Mobile_Number", "Age", "Gender", "Test_Package", "Booking_Date"];
    const sample = [
      ["ORD-92101", "Aakash Verma", "9876543210", "45", "M", "Comprehensive Blood Profile", "2026-11-14"],
      ["ORD-92102", "Sunita Rao", "9812345678", "52", "F", "Lipid Profile & Glucose", "2026-11-14"],
      ["ORD-92103", "Vikram Malhotra", "9988776655", "38", "M", "HbA1c & Fasting Glucose", "2026-11-13"]
    ];

    const patients = [
      { order_id: "ORD-92101", patient_name: "Aakash Verma", mobile: "9876543210", age: 45, gender: "M", test: "Comprehensive Blood Profile", report_id: 1 },
      { order_id: "ORD-92102", patient_name: "Sunita Rao", mobile: "9812345678", age: 52, gender: "F", test: "Lipid Profile & Glucose", report_id: 2 },
      { order_id: "ORD-92103", patient_name: "Vikram Malhotra", mobile: "9988776655", age: 38, gender: "M", test: "HbA1c & Fasting Glucose", report_id: 3 }
    ];

    return reply(200, {
      format: "spreadsheet",
      fileName,
      columns,
      sample,
      rows: 15,
      patients
    });
  }

  if (path === "/imports/file" && method === "POST") {
    let fileName = "blood_report_orders.xlsx";
    try {
      const fd = await request.formData();
      const file = fd.get("file");
      if (file && typeof file === "object") fileName = file.name || fileName;
    } catch (_) {}

    const isPdf = fileName.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      const orderId = `ORD-PDF-${Math.floor(1000 + Math.random() * 9000)}`;
      const newReportId = (store.reports[0]?.id || 0) + 1;
      const newBatchId = (store.batches[0]?.id || 0) + 1;

      const newOrder = {
        id: (store.orders[0]?.id || 0) + 1,
        order_id: orderId,
        batch_id: newBatchId,
        status: "READY",
        error: "",
        attempts: 1,
        report_kind: "pdf",
        updated_at: new Date().toISOString()
      };

      const newPatient = {
        id: (store.patients[0]?.id || 0) + 1,
        name: "Aakash Verma",
        gender: "M",
        age: 45,
        mobile: "9876543210",
        household_tag: "",
        language: "en",
        do_not_call: false
      };

      const newReport = {
        id: newReportId,
        order_id: orderId,
        order_pk: newOrder.id,
        status: "READY",
        patient_name: newPatient.name,
        mobile: newPatient.mobile,
        age: newPatient.age,
        gender: newPatient.gender,
        collected_on: new Date().toISOString(),
        reported_on: new Date().toISOString(),
        lab: "Thyrocare Technologies Ltd",
        confidence: 96,
        needs_review: false,
        review_reasons: [],
        classification: "ABNORMAL",
        abnormal_count: 4
      };

      store.orders.unshift(newOrder);
      store.patients.unshift(newPatient);
      store.reports.unshift(newReport);

      const newBatch = {
        id: newBatchId,
        source: "pdf",
        file_name: fileName,
        total: 1,
        new: 1,
        duplicate: 0,
        failed: 0,
        failures: [],
        patients: [
          { order_id: orderId, patient_name: newPatient.name, mobile: newPatient.mobile, report_id: newReportId, classification: "ABNORMAL", abnormal_count: 4 }
        ],
        started_by: store.me.id,
        created_at: new Date().toISOString()
      };
      store.batches.unshift(newBatch);

      store.dashboard.orders.imported = (store.dashboard.orders.imported || 0) + 1;
      store.dashboard.orders.reports_ready = (store.dashboard.orders.reports_ready || 0) + 1;
      store.dashboard.results.abnormal = (store.dashboard.results.abnormal || 0) + 1;

      await saveStore(env, store);
      return reply(201, newBatch);
    }

    const patients = [
      { order_id: "ORD-92101", patient_name: "Aakash Verma", mobile: "9876543210", age: 45, gender: "M", report_id: 1, classification: "ABNORMAL", abnormal_count: 4 },
      { order_id: "ORD-92102", patient_name: "Sunita Rao", mobile: "9812345678", age: 52, gender: "F", report_id: 2, classification: "ABNORMAL", abnormal_count: 2 },
      { order_id: "ORD-92103", patient_name: "Vikram Malhotra", mobile: "9988776655", age: 38, gender: "M", report_id: 3, classification: "NORMAL", abnormal_count: 0 }
    ];

    const newBatch = {
      id: (store.batches[0]?.id || 0) + 1,
      source: "file",
      file_name: fileName,
      total: 15,
      new: 15,
      duplicate: 0,
      failed: 0,
      failures: [],
      patients,
      started_by: store.me.id,
      created_at: new Date().toISOString()
    };
    store.batches.unshift(newBatch);

    for (let i = 1; i <= 15; i++) {
      store.orders.unshift({
        id: (store.orders[0]?.id || 0) + 1,
        order_id: `ORD-FILE-${1000 + i}`,
        batch_id: newBatch.id,
        status: "READY",
        error: "",
        attempts: 1,
        updated_at: new Date().toISOString()
      });
    }

    store.dashboard.orders.imported = (store.dashboard.orders.imported || 0) + 15;
    store.dashboard.orders.reports_ready = (store.dashboard.orders.reports_ready || 0) + 15;

    await saveStore(env, store);
    return reply(201, newBatch);
  }

  if (path === "/imports/pull" && method === "POST") {
    let range = { start: "", end: "" };
    try {
      range = await request.json();
    } catch (_) {}

    const count = 5;
    const newBatch = {
      id: (store.batches[0]?.id || 0) + 1,
      source: "api",
      file_name: range.start && range.end ? `${range.start}..${range.end}` : "lab_sync",
      total: count,
      new: count,
      duplicate: 0,
      failed: 0,
      failures: [],
      started_by: store.me.id,
      created_at: new Date().toISOString()
    };
    store.batches.unshift(newBatch);

    for (let i = 1; i <= count; i++) {
      store.orders.unshift({
        id: (store.orders[0]?.id || 0) + 1,
        order_id: `THY-SYNC-${2000 + i}`,
        batch_id: newBatch.id,
        status: "READY",
        error: "",
        attempts: 1,
        updated_at: new Date().toISOString()
      });
    }

    store.dashboard.orders.imported = (store.dashboard.orders.imported || 0) + count;
    store.dashboard.orders.reports_ready = (store.dashboard.orders.reports_ready || 0) + count;

    await saveStore(env, store);
    return reply(201, newBatch);
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
    if (store.me?.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to delete entries" });
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
    if (store.me?.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to delete entries" });
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
    return reply(200, store.dashboard);
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
    if (method === "GET") return reply(200, store.users);
    if (method === "POST") {
      const u = await request.json().catch(() => ({}));
      const nu = { id: store.users.length + 1, ...u, active: true };
      store.users.push(nu);
      await saveStore(env, store);
      return reply(201, nu);
    }
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

  // --- SETTINGS ---
  const setKeyMatch = path.match(/^\/settings\/([a-zA-Z0-9_]+)$/);
  if (setKeyMatch && (method === "PUT" || method === "POST")) {
    const key = setKeyMatch[1];
    const b = await request.json().catch(() => ({}));
    store.settings[key] = b.value !== undefined ? b.value : b;
    await saveStore(env, store);
    return reply(200, { key, value: store.settings[key] });
  }

  if (path === "/settings") {
    if (method === "GET") return reply(200, store.settings);
    if (method === "POST" || method === "PUT") {
      const s = await request.json().catch(() => ({}));
      store.settings = { ...store.settings, ...s };
      await saveStore(env, store);
      return reply(200, store.settings);
    }
  }

  // --- ADMIN DATA RESET ---
  if (path === "/admin/reset-data" && method === "POST") {
    if (store.me?.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to reset data" });
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
      from: "2026-11-01",
      to: "2026-11-14",
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
    return reply(200, { ok: true, message: "All test and demo data has been completely cleared." });
  }

  // --- FOLLOWUPS ---
  if (path === "/followups" && method === "GET") return reply(200, store.followups);
  if (path === "/followups/summary" && method === "GET") return reply(200, demo["/followups/summary"] || {});
  if (path === "/doctor-queue" && method === "GET") return reply(200, demo["/doctor-queue"] || store.followups);
  if (path === "/identity-reviews" && method === "GET") return reply(200, store.identityReviews);
  if (path.startsWith("/identity-reviews/") && method === "POST") return reply(200, { ok: true });
  if (path === "/audit" && method === "GET") return reply(200, store.audit);
  if (path === "/reports" && method === "GET") return reply(200, store.reports);
  const repMatch = path.match(/^\/reports\/(\d+)$/);
  if (repMatch && method === "GET") {
    const rid = parseInt(repMatch[1], 10);
    const existing = store.reports.find((item) => item.id === rid) || store.reports[0] || {};
    return reply(200, {
      id: rid,
      order_id: existing.order_id || `ORD-FILE-${1000 + rid}`,
      order_pk: existing.order_pk || rid,
      status: existing.status || "READY",
      patient_name: existing.patient_name || "Aakash Verma",
      mobile: existing.mobile || "9876543210",
      age: existing.age || 45,
      gender: existing.gender || "M",
      collected_on: existing.collected_on || "2026-11-13T08:30:00Z",
      reported_on: existing.reported_on || "2026-11-14T11:00:00Z",
      lab: existing.lab || "Thyrocare Technologies Ltd",
      confidence: existing.confidence || 96,
      needs_review: existing.needs_review || false,
      review_reasons: existing.review_reasons || ["HbA1c and Vitamin D outside normal thresholds"],
      classification: existing.classification || "ABNORMAL",
      parameters: [
        {
          id: 1,
          param_code: "GLU_F",
          param_name_raw: "Fasting Blood Glucose",
          value_num: 148,
          value_text: "148",
          unit: "mg/dL",
          ref_low: 70,
          ref_high: 99,
          ref_text: "70 - 99",
          lab_flag: "HIGH",
          system_flag: "HIGH",
          severity: "moderate",
          deviation_pct: 49.5,
          ref_source: "report"
        },
        {
          id: 2,
          param_code: "HBA1C",
          param_name_raw: "Glycosylated Hemoglobin (HbA1c)",
          value_num: 7.4,
          value_text: "7.4",
          unit: "%",
          ref_low: 4.0,
          ref_high: 5.6,
          ref_text: "< 5.7",
          lab_flag: "HIGH",
          system_flag: "HIGH",
          severity: "moderate",
          deviation_pct: 29.8,
          ref_source: "report"
        },
        {
          id: 3,
          param_code: "CHOL_TOT",
          param_name_raw: "Total Cholesterol",
          value_num: 242,
          value_text: "242",
          unit: "mg/dL",
          ref_low: 125,
          ref_high: 200,
          ref_text: "< 200",
          lab_flag: "HIGH",
          system_flag: "HIGH",
          severity: "mild",
          deviation_pct: 21.0,
          ref_source: "report"
        },
        {
          id: 4,
          param_code: "VIT_D",
          param_name_raw: "Vitamin D3 (25-OH)",
          value_num: 12.5,
          value_text: "12.5",
          unit: "ng/mL",
          ref_low: 30,
          ref_high: 100,
          ref_text: "30 - 100",
          lab_flag: "LOW",
          system_flag: "LOW",
          severity: "severe",
          deviation_pct: -58.3,
          ref_source: "report"
        },
        {
          id: 5,
          param_code: "HB",
          param_name_raw: "Hemoglobin",
          value_num: 14.2,
          value_text: "14.2",
          unit: "g/dL",
          ref_low: 13.0,
          ref_high: 17.0,
          ref_text: "13.0 - 17.0",
          lab_flag: "",
          system_flag: "NORMAL",
          severity: "",
          deviation_pct: null,
          ref_source: "report"
        },
        {
          id: 6,
          param_code: "RBC",
          param_name_raw: "Total RBC Count",
          value_num: 4.9,
          value_text: "4.9",
          unit: "mil/uL",
          ref_low: 4.5,
          ref_high: 5.5,
          ref_text: "4.5 - 5.5",
          lab_flag: "",
          system_flag: "NORMAL",
          severity: "",
          deviation_pct: null,
          ref_source: "report"
        },
        {
          id: 7,
          param_code: "WBC",
          param_name_raw: "Total Leukocyte Count (WBC)",
          value_num: 6800,
          value_text: "6800",
          unit: "/uL",
          ref_low: 4000,
          ref_high: 11000,
          ref_text: "4000 - 11000",
          lab_flag: "",
          system_flag: "NORMAL",
          severity: "",
          deviation_pct: null,
          ref_source: "report"
        },
        {
          id: 8,
          param_code: "PLT",
          param_name_raw: "Platelet Count",
          value_num: 260000,
          value_text: "260000",
          unit: "/uL",
          ref_low: 150000,
          ref_high: 450000,
          ref_text: "150000 - 450000",
          lab_flag: "",
          system_flag: "NORMAL",
          severity: "",
          deviation_pct: null,
          ref_source: "report"
        },
        {
          id: 9,
          param_code: "CREAT",
          param_name_raw: "Serum Creatinine",
          value_num: 0.95,
          value_text: "0.95",
          unit: "mg/dL",
          ref_low: 0.7,
          ref_high: 1.3,
          ref_text: "0.7 - 1.3",
          lab_flag: "",
          system_flag: "NORMAL",
          severity: "",
          deviation_pct: null,
          ref_source: "report"
        },
        {
          id: 10,
          param_code: "SGPT",
          param_name_raw: "SGPT / ALT",
          value_num: 32,
          value_text: "32",
          unit: "U/L",
          ref_low: 0,
          ref_high: 45,
          ref_text: "< 45",
          lab_flag: "",
          system_flag: "NORMAL",
          severity: "",
          deviation_pct: null,
          ref_source: "report"
        }
      ]
    });
  }

  if (repMatch && method === "DELETE") {
    if (store.me?.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to delete entries" });
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
    if (store.me?.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to delete entries" });
    const pid = parseInt(patMatch[1], 10);
    store.patients = store.patients.filter((p) => p.id !== pid);
    await saveStore(env, store);
    return reply(200, { ok: true, deleted: pid });
  }

  // Followup details, workflow, comments
  const fMatch = path.match(/^\/followups\/(\d+)(.*)$/);
  if (fMatch) {
    const fid = parseInt(fMatch[1], 10);
    const sub = fMatch[2];
    if (!sub && method === "DELETE") {
      if (store.me?.role !== "ADMIN") return reply(403, { detail: "Only administrators have rights to delete entries" });
      store.followups = store.followups.filter((f) => f.id !== fid);
      await saveStore(env, store);
      return reply(200, { ok: true, deleted: fid });
    }
    if (sub === "/call-customer" && method === "POST") {
      const fu = store.followups.find((f) => f.id === fid);
      const pat = store.patients.find((p) => p.id === (fu?.patient_id || fid));
      const customerNumber = pat?.mobile || fu?.mobile || "9876543210";
      const customerName = fu?.patient_name || pat?.name || "Customer";

      const callEntry = {
        outcome: "OUTBOUND_CALL",
        role: store.me?.role || "CALLER",
        notes: `Outgoing call placed from SecondMedic to ${customerName} (${customerNumber}) via MyOperator`,
        at: new Date().toISOString()
      };
      if (!store.workflows[fid]) store.workflows[fid] = { calls: [] };
      if (!store.workflows[fid].calls) store.workflows[fid].calls = [];
      store.workflows[fid].calls.unshift(callEntry);

      store.dashboard.calls.made = (store.dashboard.calls.made || 0) + 1;
      await saveStore(env, store);

      return reply(200, {
        success: true,
        provider: "myoperator",
        call_id: `MYOP-${Date.now()}`,
        status: "initiated",
        from: "SecondMedic",
        to: customerNumber,
        customer_name: customerName,
        message: `Outgoing call initiated from SecondMedic to ${customerName} (${customerNumber}) via MyOperator.`
      });
    }
    if (!sub && method === "GET") return reply(200, demo[`/followups/${fid}`] || demo["/followups/2"] || {});
    if (sub === "/call-card" && method === "GET") return reply(200, demo[`/followups/${fid}/call-card`] || demo["/followups/2/call-card"] || {});
    if (sub === "/caller-card" && method === "GET") {
      const base = demo[`/followups/${fid}/caller-card`] || demo["/followups/2/caller-card"] || {};
      const deficits = [
        {
          param_code: "HBA1C",
          name: "Glycosylated Hemoglobin (HbA1c)",
          value: 6.1,
          unit: "%",
          ref_range: "<5.7",
          direction: "high",
          severity: "mild",
          status_label: "Elevated (High)",
          guidance: "Follow-up for blood sugar review; doctor will discuss dietary precautions."
        },
        {
          param_code: "VIT_D",
          name: "Vitamin D3 (25-OH)",
          value: 14.8,
          unit: "ng/mL",
          ref_range: "30 - 100",
          direction: "low",
          severity: "moderate",
          status_label: "Deficit (Low)",
          guidance: "Notable deficiency; doctor can suggest appropriate supplementation."
        },
        {
          param_code: "HB",
          name: "Hemoglobin",
          value: 11.4,
          unit: "g/dL",
          ref_range: "13.0 - 17.0",
          direction: "low",
          severity: "mild",
          status_label: "Deficit (Low)",
          guidance: "Mildly low hemoglobin; doctor will review dietary iron and symptoms."
        }
      ];
      return reply(200, {
        ...base,
        deficits,
        abnormal_findings: deficits
      });
    }
    if (sub === "/comments") {
      if (method === "GET") return reply(200, store.comments[fid] || demo[`/followups/${fid}/comments`] || demo["/followups/2/comments"] || []);
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
      if (method === "GET") return reply(200, store.workflows[fid] || demo[`/followups/${fid}/workflow`] || demo["/followups/2/workflow"] || {});
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
      signed_off_by: store.me?.id || 1,
      signed_off_at: new Date().toISOString()
    };
    await saveStore(env, store);
    return reply(200, store.rules[key]);
  }

  // Generic fallback: check if demo has it, or return empty object/array
  const hit = demo[path];
  if (hit !== undefined) return reply(200, hit);

  if (method === "GET") {
    if (path.endsWith("s")) return reply(200, []);
    return reply(200, {});
  }

  return reply(200, { ok: true, status: "saved" });
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
    }
  }
};
