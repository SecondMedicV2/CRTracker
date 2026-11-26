import { describe, it } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import {
  DEFAULT_CARE_PROGRAMS,
  evaluatePrograms,
  refillTickInStore,
  relationshipStatus,
} from "../lib/programs.js";

function createTestEnv() {
  const kv = new Map();
  const store = {
    demo_purged: true,
    batches: [],
    orders: [],
    reports: [
      {
        id: 10,
        order_id: "ORD-10",
        patient_id: 1,
        patient_name: "Meera Nair",
        mobile: "9876500010",
        age: 29,
        gender: "F",
        collected_on: "2026-11-10T08:00:00Z",
        status: "READY",
        classification: "ABNORMAL",
      },
    ],
    patients: [
      { id: 1, name: "Meera Nair", gender: "F", age: 29, mobile: "9876500010", household_tag: "HH-1", language: "en", do_not_call: false },
      { id: 2, name: "Rohan Nair", gender: "M", age: 58, mobile: "9876500010", household_tag: "HH-1", language: "en", do_not_call: false },
    ],
    followups: [
      { id: 1, order_id: 10, report_id: 10, patient_id: 1, patient_name: "Meera Nair", mobile: "9876500010", priority: "ROUTINE", stage: "QUEUED", buckets: ["ANAEMIA"], due_on: "2026-12-01" },
      { id: 2, order_id: 11, report_id: 11, patient_id: 2, patient_name: "Rohan Nair", mobile: "9876500010", priority: "ROUTINE", stage: "QUEUED", buckets: ["DIABETES"], due_on: "2026-12-01" },
    ],
    users: [],
    doctors: [],
    notifications: { unread: 0, items: [] },
    settings: { caller_can_view_results: false, company_name: "SecondMedic", default_language: "en", session_minutes: 30 },
    identityReviews: [],
    audit: [],
    comments: {},
    workflows: {},
  };
  kv.set("app_state_v5", JSON.stringify(store));
  kv.set("report_params:10", JSON.stringify([
    { id: 1, param_code: "HEMOGLOBIN", value_num: 10.2, system_flag: "LOW" },
    { id: 2, param_code: "LH", value_num: 14.0, system_flag: "NORMAL" },
    { id: 3, param_code: "FSH", value_num: 5.0, system_flag: "NORMAL" },
  ]));
  const CRTRACKER_DATA = {
    async get(k, type) {
      const v = kv.get(k);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) { kv.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    async delete(k) { kv.delete(k); },
  };
  return { CRTRACKER_DATA, ADMIN_EMAIL: "admin@sm.com", ADMIN_PASSWORD: "AdminPassword123!" };
}

async function req(env, method, path, cookie, body) {
  const headers = { Origin: "http://localhost" };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }), env);
}

describe("Smart Diagnostics Pages 1-4 Worker Parity", () => {
  it("evaluates programmes identically to backend rules and enforces gender/age guards", () => {
    const f28 = evaluatePrograms({
      patient: { id: 1, age: 28, gender: "F" },
      report: { age: 28, gender: "F" },
      params: [
        { param_code: "HEMOGLOBIN", value_num: 10.5, system_flag: "LOW" },
        { param_code: "LH", value_num: 14.0, system_flag: "NORMAL" },
        { param_code: "FSH", value_num: 5.0, system_flag: "NORMAL" },
      ],
      buckets: ["ANAEMIA"],
      profile: { reproductive: { menstrual_pattern: "IRREGULAR", planning_pregnancy: true }, symptoms: ["FATIGUE"] },
      hasProfile: true,
    }).map((m) => m.program_code);
    assert.ok(f28.includes("ANEMIA_MGMT"));
    assert.ok(f28.includes("WOMENS_HEALTH"));
    assert.ok(f28.includes("PCOS_MGMT"));
    assert.ok(f28.includes("FERTILITY_PRECONCEPTION"));
    assert.ok(!f28.includes("MENS_HEALTH"));

    assert.strictEqual(DEFAULT_CARE_PROGRAMS.filter((p) => p.code === "KIDNEY_HEALTH").length, 1);
    assert.strictEqual(relationshipStatus([{ occurred_on: "2026-10-27" }], false, "2026-11-26"), "NEW");
    assert.strictEqual(relationshipStatus([{ occurred_on: "2026-10-26" }], false, "2026-11-26"), "ACTIVE");
  });

  it("enforces role filters, caller isolation, notifications, and decisions in Worker API", async () => {
    const env = createTestEnv();
    const aLogin = await req(env, "POST", "/api/v1/auth/login", null, { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
    const adminCookie = aLogin.headers.get("set-cookie").split(";")[0];

    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Dr", email: "doc@sm.com", password: "DoctorPassword123!", role: "DOCTOR" });
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Cal", email: "cal@sm.com", password: "CallerPassword123!", role: "CALLER" });
    const docCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "doc@sm.com", password: "DoctorPassword123!" })).headers.get("set-cookie").split(";")[0];
    const calCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "cal@sm.com", password: "CallerPassword123!" })).headers.get("set-cookie").split(";")[0];

    // Caregiver consent check
    const badHp = await req(env, "PUT", "/api/v1/patients/1/health-profile", docCookie, { caregiver: { name: "X", phone: "9876543210", phone_consent: false } });
    assert.strictEqual(badHp.status, 422);

    // Save health profile -> triggers programmes & "New consider item" notification
    const okHp = await req(env, "PUT", "/api/v1/patients/1/health-profile", docCookie, {
      reproductive: { menstrual_pattern: "IRREGULAR", planning_pregnancy: true },
      symptoms: ["FATIGUE", "HIGH_STRESS"],
    });
    assert.strictEqual(okHp.status, 200);

    // Caller blocked from health-profile, touchpoints, summary, and decisions; DOCTOR_CONSIDER hidden from caller /programs
    assert.strictEqual((await req(env, "GET", "/api/v1/patients/1/health-profile", calCookie)).status, 403);
    assert.strictEqual((await req(env, "GET", "/api/v1/relationship/summary", docCookie)).status, 403);
    assert.strictEqual((await req(env, "GET", "/api/v1/relationship/summary", adminCookie)).status, 200);

    const calRel = await (await req(env, "GET", "/api/v1/patients/1/relationship", calCookie)).json();
    assert.deepStrictEqual(Object.keys(calRel).sort(), ["last_touchpoint_on", "mobile", "next_step", "patient_id", "patient_name", "status"]);

    const calProgs = await (await req(env, "GET", "/api/v1/patients/1/programs", calCookie)).json();
    assert.ok(calProgs.length >= 1);
    assert.ok(calProgs.every((x) => !x.caller_label.toLowerCase().includes("consultation")));

    const docProgs = await (await req(env, "GET", "/api/v1/patients/1/programs", docCookie)).json();
    const fert = docProgs.find((p) => p.program_code === "FERTILITY_PRECONCEPTION");
    assert.ok(fert);
    assert.strictEqual((await req(env, "POST", `/api/v1/program-recommendations/${fert.id}/decision`, calCookie, { decision: "ACCEPTED" })).status, 403);
    assert.strictEqual((await req(env, "POST", `/api/v1/program-recommendations/${fert.id}/decision`, docCookie, { decision: "DECLINED" })).status, 422);

    const acc = await req(env, "POST", `/api/v1/program-recommendations/${fert.id}/decision`, docCookie, { decision: "ACCEPTED" });
    assert.strictEqual(acc.status, 200);
    assert.strictEqual((await acc.json()).suggested_specialty, "Fertility specialist");

    const notes = await (await req(env, "GET", "/api/v1/notifications", docCookie)).json();
    assert.ok(notes.items.some((n) => n.text === "New consider item"));
    const audits = await (await req(env, "GET", "/api/v1/audit", adminCookie)).json();
    assert.ok(!JSON.stringify(audits).includes("FERTILITY_PREVENTIVE_BAD") && !JSON.stringify(audits).includes("FERTILITY_PRECONCEPTION"));
  });

  it("evaluates Page 5 programmes (23-30) and enforces refill, CSV cap/formula, referral, and family consent rules", async () => {
    const p5Codes = evaluatePrograms({
      patient: { id: 1, age: 45, gender: "F" },
      report: { age: 45, gender: "F" },
      params: [
        { param_code: "HBA1C", value_num: 7.2, system_flag: "HIGH" },
        { param_code: "B12", value_num: 140, system_flag: "LOW" },
        { param_code: "LDL", value_num: 240, system_flag: "HIGH", severity: "severe" },
      ],
      buckets: ["DIABETES"],
      profile: { monitoring_requested: true },
      hasProfile: true,
      activeMeds: [{ medicine_code: "METFORMIN" }],
      prevLabs: { HBA1C: { param_code: "HBA1C", value_num: 7.9 } },
      serialCodes: ["HBA1C"],
      openReferrals: [{ id: 1 }],
      isEscalation: true,
      hasHomeReadings: true,
      familyChronic: true,
    }).map((m) => m.program_code);

    for (const code of [
      "MED_REVIEW", "PHARMACY_REFILL", "DRUG_NUTRIENT_REVIEW", "TREATMENT_RESPONSE",
      "FOLLOWUP_DIAGNOSTIC", "SPECIALIST_CONSULT", "HOME_MONITORING", "FAMILY_PREVENTIVE",
    ]) {
      assert.ok(p5Codes.includes(code), `Missing Page 5 program ${code}`);
    }

    // IST boundary for refillTickInStore: 2026-11-26 18:40 UTC = 2026-11-27 00:10 IST
    const sObj = {
      users: [{ id: 3, role: "CALLER", active: true }],
      refill_schedules: [{ id: 1, patient_id: 1, status: "ACTIVE", next_refill_on: "2026-11-30", task_status: "PENDING", reminder_sent_for: null }],
      notifications: { unread: 0, items: [] },
    };
    assert.strictEqual(refillTickInStore(sObj, Date.parse("2026-11-26T18:20:00Z")), 0);
    assert.strictEqual(refillTickInStore(sObj, Date.parse("2026-11-26T18:40:00Z")), 1);
    assert.strictEqual(sObj.notifications.items[0].text, "Pharmacy refill reminder call");

    // Worker API checks for medicines, caller isolation, home CSV 5 MB cap, and family consent
    const env = createTestEnv();
    const aLogin = await req(env, "POST", "/api/v1/auth/login", null, { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
    const adminCookie = aLogin.headers.get("set-cookie").split(";")[0];
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Dr", email: "doc@sm.com", password: "DoctorPassword123!", role: "DOCTOR" });
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Cal", email: "cal@sm.com", password: "CallerPassword123!", role: "CALLER" });
    const docCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "doc@sm.com", password: "DoctorPassword123!" })).headers.get("set-cookie").split(";")[0];
    const calCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "cal@sm.com", password: "CallerPassword123!" })).headers.get("set-cookie").split(";")[0];

    const addMed = await req(env, "POST", "/api/v1/patients/1/medicines", docCookie, { medicine_code: "METFORMIN", started_on: "2026-11-01", refill_every_days: 1 });
    assert.strictEqual(addMed.status, 201);
    assert.strictEqual((await req(env, "GET", "/api/v1/patients/1/medicines", calCookie)).status, 403);

    let scheduledWork;
    await worker.scheduled({}, env, { waitUntil: (p) => { scheduledWork = p; } });
    await scheduledWork;
    const tasks = await (await req(env, "GET", "/api/v1/refill-tasks", calCookie)).json();
    assert.strictEqual(tasks.length, 1);
    assert.ok(!JSON.stringify(tasks).toLowerCase().includes("metformin"));

    const addRef = await req(env, "POST", "/api/v1/patients/1/referrals", docCookie, { specialty: "Endocrinology" });
    assert.strictEqual(addRef.status, 201);
    const refId = (await addRef.json()).id;
    const calRefs = await (await req(env, "GET", "/api/v1/patients/1/referrals", calCookie)).json();
    assert.ok(!JSON.stringify(calRefs).toLowerCase().includes("endocrinology"));
    assert.strictEqual((await req(env, "PATCH", `/api/v1/referrals/${refId}`, calCookie, { status: "DONE" })).status, 403);
    assert.strictEqual((await req(env, "PATCH", `/api/v1/referrals/${refId}`, calCookie, { status: "BOOKED" })).status, 200);

    // Home readings CSV > 5 MB -> 413; valid CSV + formula check
    const bigBody = "kind,value,taken_at\n" + "WEIGHT,70,2026-11-20T08:00:00Z\n".repeat(190000);
    const bigRes = await worker.fetch(new Request("http://localhost/api/v1/patients/1/home-readings/import", {
      method: "POST",
      headers: { Origin: "http://localhost", Cookie: docCookie, "Content-Type": "text/csv" },
      body: bigBody,
    }), env);
    assert.strictEqual(bigRes.status, 413);

    const okCsvRes = await worker.fetch(new Request("http://localhost/api/v1/patients/1/home-readings/import", {
      method: "POST",
      headers: { Origin: "http://localhost", Cookie: docCookie, "Content-Type": "text/csv" },
      body: "kind,systolic,diastolic,value,taken_at\nBP,150,95,,=1+1\n",
    }), env);
    assert.strictEqual(okCsvRes.status, 201);
    const csvOut = await (await req(env, "GET", "/api/v1/patients/1/home-readings.csv", docCookie)).text();
    assert.ok(csvOut.includes("'=1+1"), "CSV formula prefix was not neutralized");

    // Family consent gating
    const fl = await (await req(env, "POST", "/api/v1/patients/1/family-links", docCookie, { related_patient_id: 2, relationship: "father" })).json();
    assert.strictEqual(fl.has_consent, false);
    const famBefore = await (await req(env, "GET", "/api/v1/patients/1/family", docCookie)).json();
    assert.strictEqual(famBefore.links[0].summary, null);
    await req(env, "POST", `/api/v1/family-links/${fl.id}/consent`, docCookie, {});
    const famAfter = await (await req(env, "GET", "/api/v1/patients/1/family", docCookie)).json();
    assert.strictEqual(famAfter.links[0].has_consent, true);
    assert.ok(famAfter.links[0].summary.active_buckets.includes("DIABETES"));
  });
});
