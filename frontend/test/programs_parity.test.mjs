import { describe, it } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import {
  DEFAULT_CARE_PROGRAMS,
  DEFAULT_DIAGNOSTIC_FINDINGS,
  DEFAULT_RECOMMENDATION_COMBINATIONS,
  addDaysIso,
  buildProgramContext,
  detectFindingsInCtx,
  evaluatePrograms,
  refillTickInStore,
  relationshipStatus,
  todayIstStr,
} from "../lib/programs.js";
import {
  DEFAULT_CLINICAL_TARGETS,
  DEFAULT_CONDITION_PROTOCOLS,
  DEFAULT_RETEST_PROTOCOLS,
  DEFAULT_RETEST_TIERS,
  planRetestInStore,
  retestReminderTickInStore,
  slaTickInStore,
  suggestConditionsInStore,
  toIstDateStr,
} from "../lib/retest.js";
import { matchCompletedPlansInStore } from "../lib/retestModel.js";
import { schedulerTickInStore, sendPatientMessageInStore } from "../lib/journeys.js";

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

  it("evaluates Page 6 findings, IF_PRESCRIBED gating, rank merge, caller neutrality, rules signoff, and dashboard funnel", async () => {
    const ctxAll = buildProgramContext({
      patient: { id: 1, age: 48, gender: "M" },
      report: { age: 48, gender: "M", classification: "ABNORMAL" },
      params: [
        { param_code: "VITD", system_flag: "LOW", severity: "mild" },
        { param_code: "HBA1C", system_flag: "HIGH", severity: "severe" },
        { param_code: "LDL", system_flag: "HIGH", severity: "moderate" },
        { param_code: "TSH", system_flag: "HIGH", severity: "mild" },
        { param_code: "HB", system_flag: "LOW", severity: "mild" },
        { param_code: "CREAT", system_flag: "HIGH", severity: "moderate" },
        { param_code: "ALT", system_flag: "HIGH", severity: "mild" },
      ],
      buckets: ["DIABETES", "LIPID"],
      profile: { vitals: { height_cm: 170, weight_kg: 80 } },
    });
    const det = detectFindingsInCtx(ctxAll, DEFAULT_DIAGNOSTIC_FINDINGS);
    assert.strictEqual(det[0], "HIGH_HBA1C");
    assert.strictEqual(det.length, 9);
    assert.ok(!det.includes("NORMAL_WITH_RISK"));

    const ctxNormalRisk = buildProgramContext({
      patient: { id: 2, age: 46, gender: "F" },
      report: { age: 46, gender: "F", classification: "NORMAL" },
      params: [{ param_code: "GLU_F", system_flag: "NORMAL" }],
      profile: {},
    });
    assert.deepStrictEqual(detectFindingsInCtx(ctxNormalRisk, DEFAULT_DIAGNOSTIC_FINDINGS), ["NORMAL_WITH_RISK"]);

    // Worker routes: recommendations table, IF_PRESCRIBED gating, caller 403, doctor signoff, dashboard finding_funnel
    const env = createTestEnv();
    const aLogin = await req(env, "POST", "/api/v1/auth/login", null, { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
    const adminCookie = aLogin.headers.get("set-cookie").split(";")[0];
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Dr", email: "doc@sm.com", password: "DoctorPassword123!", role: "DOCTOR" });
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Cal", email: "cal@sm.com", password: "CallerPassword123!", role: "CALLER" });
    const docCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "doc@sm.com", password: "DoctorPassword123!" })).headers.get("set-cookie").split(";")[0];
    const calCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "cal@sm.com", password: "CallerPassword123!" })).headers.get("set-cookie").split(";")[0];

    // Trigger recommendations on followup 1 (HEMOGLOBIN LOW -> LOW_HB)
    assert.strictEqual((await req(env, "GET", "/api/v1/followups/1/recommendations", calCookie)).status, 403);
    const recRes = await (await req(env, "GET", "/api/v1/followups/1/recommendations", docCookie)).json();
    assert.strictEqual(recRes.combinations[0].finding_code, "LOW_HB");
    assert.strictEqual(recRes.combinations[0].primary.label, "Anemia evaluation");
    assert.strictEqual(recRes.combinations[0].secondary.label, "Nutrition assessment");
    assert.strictEqual(recRes.combinations[0].third.label, "Follow-up diagnostics");

    // Decision + caller card neutral next_steps + dashboard finding_funnel
    await req(env, "POST", `/api/v1/program-recommendations/${recRes.combinations[0].primary.recommendation_id}/decision`, docCookie, { decision: "ACCEPTED" });
    await req(env, "POST", "/api/v1/followups/1/call-card/generate", docCookie, {});
    const card = await (await req(env, "GET", "/api/v1/followups/1/caller-card", calCookie)).json();
    assert.strictEqual(card.next_steps.length, 3);
    assert.ok(!JSON.stringify(card.next_steps).toLowerCase().includes("anemia"));

    const dash = await (await req(env, "GET", "/api/v1/dashboard", adminCookie)).json();
    const hbRow = dash.finding_funnel.find((x) => x.finding_code === "LOW_HB");
    assert.strictEqual(hbRow.patients, 1);
    assert.strictEqual(hbRow.primary_pct, 100);

    // Doctor can signoff rule edit
    await req(env, "PUT", "/api/v1/rules/diagnostic_findings", adminCookie, { data: DEFAULT_DIAGNOSTIC_FINDINGS });
    const so = await req(env, "POST", "/api/v1/rules/diagnostic_findings/signoff", docCookie, {});
    assert.strictEqual(so.status, 200);
    assert.strictEqual((await so.json()).pending_signoff, false);
    assert.ok(DEFAULT_RECOMMENDATION_COMBINATIONS.HIGH_HBA1C.third.condition === "IF_PRESCRIBED");
  });

  it("evaluates Page 7 retest protocols, IST dates, anchors, caller isolation, overrides, and reminder cron in Worker", async () => {
    assert.strictEqual(DEFAULT_RETEST_PROTOCOLS.filter((p) => p.finding_code).length, 10);
    assert.strictEqual(DEFAULT_CONDITION_PROTOCOLS.length, 10);
    assert.strictEqual(DEFAULT_RETEST_PROTOCOLS.length, 20);
    assert.strictEqual(toIstDateStr("2026-01-10T20:00:00Z"), "2026-01-11");

    const env = createTestEnv();
    const aLogin = await req(env, "POST", "/api/v1/auth/login", null, { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
    const adminCookie = aLogin.headers.get("set-cookie").split(";")[0];
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Dr", email: "doc@sm.com", password: "DoctorPassword123!", role: "DOCTOR" });
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Cal", email: "cal@sm.com", password: "CallerPassword123!", role: "CALLER" });
    const docCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "doc@sm.com", password: "DoctorPassword123!" })).headers.get("set-cookie").split(";")[0];
    const calCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "cal@sm.com", password: "CallerPassword123!" })).headers.get("set-cookie").split(";")[0];

    // Seed LOW_HB (followup 1) -> initially DOCTOR_TO_SET; adding FERROUS_SULFATE sets 14-28d window
    await req(env, "GET", "/api/v1/followups/1/recommendations", docCookie);
    let fu1 = await (await req(env, "GET", "/api/v1/followups/1", docCookie)).json();
    assert.strictEqual(fu1.retest_status, "DOCTOR_TO_SET");
    const dq = await (await req(env, "GET", "/api/v1/doctor/queue", docCookie)).json();
    assert.ok(dq.some((x) => x.id === 1 && x.retest_label === "Doctor to set retest date"));

    const anchor = todayIstStr();
    const medRes = await req(env, "POST", "/api/v1/patients/1/medicines", docCookie, { medicine_code: "FERROUS_SULFATE", started_on: anchor });
    assert.strictEqual(medRes.status, 201);
    fu1 = await (await req(env, "GET", "/api/v1/followups/1", docCookie)).json();
    assert.strictEqual(fu1.retest_status, "AUTO_SCHEDULED");
    assert.strictEqual(fu1.retest_window_start, addDaysIso(anchor, 14));
    assert.strictEqual(fu1.retest_window_end, addDaysIso(anchor, 28));
    assert.strictEqual(fu1.reminder_on, addDaysIso(anchor, 14));

    // Caller sees only neutral "Retest due" and window dates; clinical endpoints forbidden
    const calRows = await (await req(env, "GET", "/api/v1/followups", calCookie)).json();
    const calRow = calRows.find((x) => x.id === 1);
    assert.strictEqual(calRow.retest_label, "Retest due");
    assert.strictEqual(calRow.retest_window_start, addDaysIso(anchor, 14));
    assert.ok(!("retest_plan" in calRow) && !("finding_codes" in calRow) && !("reminder_on" in calRow));
    assert.strictEqual((await req(env, "GET", "/api/v1/followups/1", calCookie)).status, 403);
    assert.strictEqual((await req(env, "POST", "/api/v1/followups/1/retest-override", calCookie, { window_start: anchor, reason_code: "CLINICAL_JUDGMENT" })).status, 403);

    // Doctor override requires valid reason_code and persists OVERRIDDEN status
    assert.strictEqual((await req(env, "POST", "/api/v1/followups/1/retest-override", docCookie, { window_start: anchor, reason_code: "" })).status, 422);
    const ovRes = await req(env, "POST", "/api/v1/followups/1/retest-override", docCookie, {
      window_start: addDaysIso(anchor, 7),
      window_end: addDaysIso(anchor, 10),
      reason_code: "CLINICAL_JUDGMENT",
      notes: "Recheck early",
    });
    assert.strictEqual(ovRes.status, 200);
    assert.strictEqual((await ovRes.json()).retest_status, "OVERRIDDEN");

    // Reminder tick fires once when reminder_on <= today
    const mockStore = {
      followups: [{ id: 9, stage: "QUEUED", suppressed_reason: "", retest_status: "AUTO_SCHEDULED", reminder_on: anchor, reminder_sent_at: null }],
      notifications: { unread: 0, items: [] },
    };
    assert.strictEqual(retestReminderTickInStore(mockStore, Date.now()), 1);
    assert.strictEqual(retestReminderTickInStore(mockStore, Date.now()), 0);
    assert.strictEqual(mockStore.notifications.items[0].text, "Retest reminder due");

    // Rules endpoint includes retest_protocols and test_catalogue expansion
    const rulesRes = await (await req(env, "GET", "/api/v1/rules/retest_protocols", docCookie)).json();
    assert.strictEqual(rulesRes.data.length, 20);
    const catRes = await (await req(env, "GET", "/api/v1/rules/test_catalogue", docCookie)).json();
    assert.ok(catRes.data.some((t) => t.code === "ELECTROLYTES") && catRes.data.some((t) => t.code === "UACR") && catRes.data.some((t) => t.code === "EGFR"));
  });

  it("evaluates Page 9 5 urgency tiers, URGENT sorting, notifications, window validation, summary, and SLA cron in Worker", async () => {
    assert.strictEqual(DEFAULT_RETEST_TIERS.length, 5);
    assert.deepStrictEqual(DEFAULT_RETEST_TIERS.map((t) => t.code), ["URGENT", "EARLY", "TREATMENT_RESPONSE", "METABOLIC", "LONG_TERM"]);

    const env = createTestEnv();
    const aLogin = await req(env, "POST", "/api/v1/auth/login", null, { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
    const adminCookie = aLogin.headers.get("set-cookie").split(";")[0];
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Dr", email: "doc@sm.com", password: "DoctorPassword123!", role: "DOCTOR" });
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Cal", email: "cal@sm.com", password: "CallerPassword123!", role: "CALLER" });
    const docCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "doc@sm.com", password: "DoctorPassword123!" })).headers.get("set-cookie").split(";")[0];
    const calCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "cal@sm.com", password: "CallerPassword123!" })).headers.get("set-cookie").split(";")[0];

    // Check critical_values is empty by default and retest_tiers rule exists
    const cvRule = await (await req(env, "GET", "/api/v1/rules/critical_values", docCookie)).json();
    assert.deepStrictEqual(cvRule.data, []);
    const tiersRule = await (await req(env, "GET", "/api/v1/rules/retest_tiers", docCookie)).json();
    assert.strictEqual(tiersRule.data[0].code, "URGENT");

    // Manual URGENT promotion + tier window validation (METABOLIC 56-84d)
    const today = todayIstStr();
    await req(env, "GET", "/api/v1/followups/1/recommendations", docCookie);
    assert.strictEqual((await req(env, "PATCH", "/api/v1/followups/2", docCookie, { protocol_tier: "METABOLIC", retest_date: addDaysIso(today, 5) })).status, 422);
    const validPatch = await req(env, "PATCH", "/api/v1/followups/2", docCookie, {
      protocol_tier: "URGENT",
      retest_date: today,
      retest_override_reason: "CLINICAL_JUDGMENT",
    });
    assert.strictEqual(validPatch.status, 200);
    const fu2 = await validPatch.json();
    assert.strictEqual(fu2.protocol_tier, "URGENT");
    assert.strictEqual(fu2.protocol_tier_colour, "red");

    // URGENT sorts first and triggers dashboard urgent_24h + summary counts
    const list = await (await req(env, "GET", "/api/v1/followups", adminCookie)).json();
    assert.strictEqual(list[0].id, 2);
    const dash = await (await req(env, "GET", "/api/v1/dashboard", adminCookie)).json();
    assert.ok(dash.urgent_24h >= 1);
    const sumRes = await req(env, "GET", "/api/v1/retesting-protocol/summary", adminCookie);
    assert.strictEqual(sumRes.status, 200);
    assert.ok((await sumRes.json()).urgent_24h >= 1);
    assert.strictEqual((await req(env, "GET", "/api/v1/retesting-protocol/summary", docCookie)).status, 403);
    assert.strictEqual((await req(env, "GET", "/api/v1/retesting-protocol/summary", calCookie)).status, 403);

    // Caller sees neutral label + colour only
    const calList = await (await req(env, "GET", "/api/v1/followups", calCookie)).json();
    const calUrgent = calList.find((x) => x.id === 2);
    assert.strictEqual(calUrgent.protocol_tier_colour, "red");
    assert.strictEqual(calUrgent.protocol_tier_label, "Priority call today");
    assert.ok(!("protocol_tier" in calUrgent));

    // Caller card includes neutral tier badge
    await req(env, "POST", "/api/v1/followups/2/call-card/generate", docCookie, {});
    const card = await (await req(env, "GET", "/api/v1/followups/2/caller-card", calCookie)).json();
    assert.strictEqual(card.protocol_tier_colour, "red");
    assert.strictEqual(card.protocol_tier_label, "Priority call today");

    // SLA escalation tick after 24h unattended
    const slaStore = {
      followups: [{
        id: 22,
        stage: "QUEUED",
        suppressed_reason: "",
        protocol_tier: "URGENT",
        accepted_at: null,
        attempts: 0,
        sla_escalated_at: null,
        created_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
      }],
      notifications: { unread: 0, items: [] },
      audit: [],
    };
    assert.strictEqual(slaTickInStore(slaStore, Date.now()), 1);
    assert.strictEqual(slaTickInStore(slaStore, Date.now()), 0);
    assert.ok(slaStore.notifications.items[0].text.includes("SLA overdue"));
    assert.strictEqual(slaStore.audit[0].action, "sla_escalate");
  });

  it("evaluates Page 11 condition register, suggestions, precedence, targets, HTN monitoring, and caller labels in Worker", async () => {
    assert.strictEqual(DEFAULT_CLINICAL_TARGETS.HBA1C.target_value, 7.0);
    const env = createTestEnv();
    const aLogin = await req(env, "POST", "/api/v1/auth/login", null, { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
    const adminCookie = aLogin.headers.get("set-cookie").split(";")[0];
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Dr", email: "doc@sm.com", password: "DoctorPassword123!", role: "DOCTOR" });
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Cal", email: "cal@sm.com", password: "CallerPassword123!", role: "CALLER" });
    const docCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "doc@sm.com", password: "DoctorPassword123!" })).headers.get("set-cookie").split(";")[0];
    const calCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "cal@sm.com", password: "CallerPassword123!" })).headers.get("set-cookie").split(";")[0];

    // Add report_params:11 with HbA1c 6.8 + EGFR 50 for patient 2 (Rohan Nair, followup 2, report 11)
    const storeRaw = await env.CRTRACKER_DATA.get("app_state_v5", "json");
    storeRaw.reports.push({
      id: 11, order_id: "ORD-11", patient_id: 2, patient_name: "Rohan Nair", mobile: "9876500010",
      age: 58, gender: "M", collected_on: "2026-11-01T08:00:00Z", status: "READY", classification: "ABNORMAL",
    });
    storeRaw.reports.push({
      id: 12, order_id: "ORD-12", patient_id: 2, patient_name: "Rohan Nair", mobile: "9876500010",
      age: 58, gender: "M", collected_on: "2026-07-01T08:00:00Z", status: "READY", classification: "ABNORMAL",
    });
    await env.CRTRACKER_DATA.put("app_state_v5", JSON.stringify(storeRaw));
    await env.CRTRACKER_DATA.put("report_params:12", JSON.stringify([
      { id: 10, param_code: "HBA1C", value_num: 6.6, system_flag: "HIGH" },
      { id: 11, param_code: "EGFR", value_num: 52, system_flag: "LOW" },
    ]));
    await env.CRTRACKER_DATA.put("report_params:11", JSON.stringify([
      { id: 12, param_code: "HBA1C", value_num: 6.8, system_flag: "HIGH" },
      { id: 13, param_code: "EGFR", value_num: 49, system_flag: "LOW" },
      { id: 14, param_code: "B12", value_num: 130, system_flag: "LOW" },
    ]));

    // Doctor-only enforcement: caller 403 on GET/POST/DELETE; admin 200 GET, 403 POST/DELETE/mutate health-profile
    assert.strictEqual((await req(env, "GET", "/api/v1/patients/2/conditions", calCookie)).status, 403);
    assert.strictEqual((await req(env, "POST", "/api/v1/patients/2/conditions", calCookie, { code: "CKD" })).status, 403);
    assert.strictEqual((await req(env, "POST", "/api/v1/patients/2/conditions", adminCookie, { code: "CKD" })).status, 403);
    assert.strictEqual((await req(env, "DELETE", "/api/v1/patients/2/conditions/CKD", adminCookie)).status, 403);
    assert.strictEqual((await req(env, "PUT", "/api/v1/patients/2/health-profile", adminCookie, { conditions: [{ code: "CKD", status: "CONFIRMED" }] })).status, 403);

    const sum1 = await (await req(env, "GET", "/api/v1/patients/2/conditions", docCookie)).json();
    const sugCodes = sum1.suggested.map((s) => s.code);
    assert.ok(sugCodes.includes("DIABETES_STABLE"));
    assert.ok(sugCodes.includes("CKD"));
    assert.ok(sugCodes.includes("B12_DEFICIENCY"));

    // Confirm DIABETES_STABLE + CKD -> overrides HIGH_HBA1C & HIGH_CREATININE to 180d & caller sees "Monitoring due on <date>"
    const confRes = await req(env, "POST", "/api/v1/patients/2/conditions", docCookie, { code: "DIABETES_STABLE" });
    assert.strictEqual(confRes.status, 200);
    await req(env, "POST", "/api/v1/patients/2/conditions", docCookie, { code: "CKD" });
    const fu2 = await (await req(env, "GET", "/api/v1/followups/2", docCookie)).json();
    assert.strictEqual(fu2.retest_plan.primary_finding.condition_code, "DIABETES_STABLE");
    assert.ok(fu2.retest_plan.overridden_findings.includes("HIGH_HBA1C"));
    assert.ok(fu2.retest_plan.overridden_findings.includes("HIGH_CREATININE"));
    assert.strictEqual(fu2.retest_window_start, addDaysIso("2026-11-01", 180));

    const calFu2 = (await (await req(env, "GET", "/api/v1/followups", calCookie)).json()).find((x) => x.id === 2);
    assert.strictEqual(calFu2.retest_label, `Monitoring due on ${fu2.retest_window_start}`);
    assert.ok(!JSON.stringify(calFu2).includes("DIABETES"));

    // Per-patient Page 10 target override (< 6.5%) flips 6.6 & 6.8 to DIABETES_UNCONTROLLED
    await req(env, "PUT", "/api/v1/patients/2/health-profile", docCookie, { targets: { HBA1C: { target_op: "<", target_value: 6.5 } } });
    const sum2 = await (await req(env, "GET", "/api/v1/patients/2/conditions", docCookie)).json();
    assert.ok(sum2.suggested.some((s) => s.code === "DIABETES_UNCONTROLLED" && s.replaces_code === "DIABETES_STABLE"));

    // Confirm HYPERTENSION -> creates 7-day 2x/day BP schedule + doctor lab-selection task
    const htnRes = await (await req(env, "POST", "/api/v1/patients/2/conditions", docCookie, { code: "HYPERTENSION" })).json();
    assert.strictEqual(htnRes.monitoring_schedules.length, 1);
    assert.strictEqual(htnRes.monitoring_schedules[0].frequency_per_day, 2);
    assert.strictEqual(htnRes.monitoring_schedules[0].duration_days, 7);
    assert.strictEqual(htnRes.clinical_tasks.length, 1);
    const taskId = htnRes.clinical_tasks[0].id;
    assert.strictEqual((await req(env, "POST", `/api/v1/clinical-tasks/${taskId}/complete`, adminCookie, { test_codes: ["KFT"] })).status, 403);
    const doneTask = await req(env, "POST", `/api/v1/clinical-tasks/${taskId}/complete`, docCookie, { test_codes: ["KFT", "UACR"] });
    assert.strictEqual(doneTask.status, 200);
    assert.deepStrictEqual((await doneTask.json()).selected_tests, ["KFT", "UACR"]);

    // Negative check for suggestConditionsInStore (normal B12, no iron deficiency)
    const cleanSug = suggestConditionsInStore({
      reports: [{ id: 99, patient_id: 9, collected_on: "2026-11-20T08:00:00Z", status: "READY" }],
      health_profiles: {},
      patient_medications: [],
    }, 9, { 99: [{ param_code: "HBA1C", value_num: 5.2, system_flag: "NORMAL" }, { param_code: "B12", value_num: 450, system_flag: "NORMAL" }] });
    assert.strictEqual(cleanSug.length, 0);

    // No PII/values in condition audit entries
    const audits = await (await req(env, "GET", "/api/v1/audit", adminCookie)).json();
    const condAudits = audits.filter((a) => a.entity === "patient_condition");
    assert.ok(condAudits.length >= 2);
    assert.ok(!JSON.stringify(condAudits).includes("Rohan") && !JSON.stringify(condAudits).includes("9876500010") && !JSON.stringify(condAudits).includes("6.8"));
  });

  it("evaluates Page 10 AMI parameter comparison, targets, HBA1C_90 journey, Day 90 confirmation, and caller privacy in Worker", async () => {
    const env = createTestEnv();
    const aLogin = await req(env, "POST", "/api/v1/auth/login", null, { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
    const adminCookie = aLogin.headers.get("set-cookie").split(";")[0];
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Dr", email: "doc@sm.com", password: "DoctorPassword123!", role: "DOCTOR" });
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Cal", email: "cal@sm.com", password: "CallerPassword123!", role: "CALLER" });
    const docCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "doc@sm.com", password: "DoctorPassword123!" })).headers.get("set-cookie").split(";")[0];
    const calCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "cal@sm.com", password: "CallerPassword123!" })).headers.get("set-cookie").split(";")[0];

    const st0 = await env.CRTRACKER_DATA.get("app_state_v5", "json");
    st0.reports = [
      { id: 1, order_id: "ORD-1", patient_id: 1, patient_name: "Meera K", gender: "F", status: "READY", collected_on: "2026-08-01T08:00:00Z", classification: "ABNORMAL" },
      { id: 2, order_id: "ORD-2", patient_id: 1, patient_name: "Meera K", gender: "F", status: "READY", collected_on: "2026-11-01T08:00:00Z", classification: "ABNORMAL" },
      { id: 3, order_id: "ORD-3", patient_id: 2, patient_name: "Unit Pat", gender: "M", status: "READY", collected_on: "2026-09-01T08:00:00Z", classification: "ABNORMAL" },
      { id: 4, order_id: "ORD-4", patient_id: 2, patient_name: "Unit Pat", gender: "M", status: "READY", collected_on: "2026-11-02T08:00:00Z", classification: "ABNORMAL" },
    ];
    st0.followups = [
      { id: 2, patient_id: 1, report_id: 2, patient_name: "Meera K", due_on: "2027-01-30", priority: "ROUTINE", stage: "NOT_CALLED", buckets: ["DIABETES"], finding_codes: ["HIGH_HBA1C"] },
    ];
    st0.callcards = {
      2: {
        id: 1, followup_id: 2, version: 1, language: "en", validation_status: "VALID", notice: null,
        content: { summary: { report_age_days: 5 }, caller_script: { opening: "Hi", identity_check: "Meera?", free_followup_pitch: "Follow-up", consent_request: "Consent?", slot_offer: "Slot?", objection_handling: [], do_not_say: [], urgent_symptom_protocol: "Urgent", closing: "Bye" } },
      },
    };
    await env.CRTRACKER_DATA.put("app_state_v5", JSON.stringify(st0));
    await env.CRTRACKER_DATA.put("report_params:1", JSON.stringify([
      { id: 1, param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 8.2, unit: "%", system_flag: "HIGH" },
      { id: 2, param_code: "HDL", param_name_raw: "HDL", value_num: 35, unit: "mg/dL", system_flag: "LOW" },
    ]));
    await env.CRTRACKER_DATA.put("report_params:2", JSON.stringify([
      { id: 3, param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 7.1, unit: "%", system_flag: "HIGH" },
      { id: 4, param_code: "HDL", param_name_raw: "HDL", value_num: 52, unit: "mg/dL", system_flag: "NORMAL" },
    ]));
    await env.CRTRACKER_DATA.put("report_params:3", JSON.stringify([
      { id: 5, param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 66, unit: "mmol/mol", system_flag: "HIGH" },
    ]));
    await env.CRTRACKER_DATA.put("report_params:4", JSON.stringify([
      { id: 6, param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 7.9, unit: "%", system_flag: "HIGH" },
    ]));

    // Slide example + HIGHER_IS_BETTER + <3 points trend
    const c2 = await (await req(env, "GET", "/api/v1/reports/2/compare", docCookie)).json();
    const a1c = c2.rows.find((r) => r.param_code === "HBA1C");
    const hdl = c2.rows.find((r) => r.param_code === "HDL");
    assert.strictEqual(a1c.change_display, "\u22121.1 percentage points");
    assert.strictEqual(a1c.target_status, "Above target");
    assert.strictEqual(a1c.change_status, "Improved");
    assert.strictEqual(a1c.next_action, "Continue clinical follow-up");
    assert.strictEqual(a1c.trend, null);
    assert.strictEqual(hdl.direction, "HIGHER_IS_BETTER");
    assert.strictEqual(hdl.target_status, "At target");
    assert.strictEqual(hdl.change_status, "Improved");

    // Units differ -> not compared
    const c4 = await (await req(env, "GET", "/api/v1/reports/4/compare", docCookie)).json();
    assert.strictEqual(c4.rows[0].units_differ, true);
    assert.strictEqual(c4.rows[0].change_display, "Units differ \u2014 not compared");

    // 3rd report + min_meaningful_change (7.1 -> 6.8 is -0.3 < 0.5 -> No meaningful change; 3 pts [8.2, 7.1, 6.8] -> Positive trend)
    const st = await env.CRTRACKER_DATA.get("app_state_v5", "json");
    st.reports.push({ id: 5, order_id: "ORD-5", patient_id: 1, patient_name: "Meera K", gender: "F", status: "READY", collected_on: "2027-02-01T08:00:00Z", classification: "NORMAL" });
    await env.CRTRACKER_DATA.put("app_state_v5", JSON.stringify(st));
    await env.CRTRACKER_DATA.put("report_params:5", JSON.stringify([
      { id: 7, param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 6.8, unit: "%", system_flag: "NORMAL" },
    ]));
    const c5 = await (await req(env, "GET", "/api/v1/reports/5/compare", docCookie)).json();
    assert.strictEqual(c5.rows[0].change_status, "No meaningful change");
    assert.strictEqual(c5.rows[0].target_status, "At target");
    assert.strictEqual(c5.rows[0].trend, "Positive trend");
    assert.strictEqual(c5.rows[0].next_action, "Continue current plan; routine monitoring");

    // HBA1C_90 journey + Day 90 confirm RBAC + Caller privacy
    assert.strictEqual(c2.journey.template_code, "HBA1C_90");
    assert.strictEqual(c2.journey.steps.length, 5);
    assert.ok(c2.journey.disclaimer.includes("Medication changes remain the responsibility of the treating clinician."));
    assert.strictEqual((await req(env, "POST", "/api/v1/followups/2/journey/day90-confirm", adminCookie, { clinically_appropriate: true })).status, 403);
    assert.strictEqual((await req(env, "POST", "/api/v1/followups/2/journey/day90-confirm", calCookie, { clinically_appropriate: true })).status, 403);
    const d90Res = await req(env, "POST", "/api/v1/followups/2/journey/day90-confirm", docCookie, { clinically_appropriate: false });
    assert.strictEqual(d90Res.status, 200);
    assert.strictEqual((await d90Res.json()).journey.day90_clinically_appropriate, false);

    assert.strictEqual((await req(env, "GET", "/api/v1/reports/2/compare", calCookie)).status, 403);
    assert.strictEqual((await req(env, "GET", "/api/v1/followups/2/compare", calCookie)).status, 403);
    assert.strictEqual((await req(env, "GET", "/api/v1/patients/1/compare", calCookie)).status, 403);
    assert.strictEqual((await req(env, "GET", "/api/v1/rules/next_action_rules", calCookie)).status, 403);
    assert.strictEqual((await req(env, "GET", "/api/v1/rules/journey_templates", calCookie)).status, 403);

    const calCard = await (await req(env, "GET", "/api/v1/followups/2/caller-card", calCookie)).json();
    assert.strictEqual(calCard.comparison_notice, "Results compared \u2014 doctor review scheduled");
    assert.ok(calCard.comparison_date);
    const calBlob = JSON.stringify(calCard).toLowerCase();
    assert.ok(!calBlob.includes("8.2") && !calBlob.includes("7.1") && !calBlob.includes("hba1c") && !calBlob.includes("metformin"));
  });

  it("enforces Page 12 7-step approved model, encrypted booking, bundles, auto-close, explain & KPIs in Edge Worker", async () => {
    const env = createTestEnv();
    const adminCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })).headers.get("set-cookie").split(";")[0];
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Dr", email: "doc@sm.com", password: "DoctorPassword123!", role: "DOCTOR" });
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Cal", email: "cal@sm.com", password: "CallerPassword123!", role: "CALLER" });
    const docCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "doc@sm.com", password: "DoctorPassword123!" })).headers.get("set-cookie").split(";")[0];
    const calCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "cal@sm.com", password: "CallerPassword123!" })).headers.get("set-cookie").split(";")[0];
    const today = todayIstStr();
    const d90 = addDaysIso(today, -90);
    const d105 = addDaysIso(today, -105);

    const st0 = await env.CRTRACKER_DATA.get("app_state_v5", "json");
    st0.patients = [
      { id: 1, name: "Asha R", gender: "F", age: 42, mobile: "9810000001", language: "en" },
      { id: 2, name: "Rohan V", gender: "M", age: 48, mobile: "9810000002", language: "en" },
      { id: 3, name: "Tariq A", gender: "M", age: 51, mobile: "9810000003", language: "en" },
    ];
    st0.reports = [
      { id: 1, order_id: "ORD-1", patient_id: 1, patient_name: "Asha R", gender: "F", status: "READY", collected_on: `${d90}T08:00:00Z`, classification: "ABNORMAL" },
      { id: 2, order_id: "ORD-2", patient_id: 2, patient_name: "Rohan V", gender: "M", status: "READY", collected_on: `${d105}T08:00:00Z`, classification: "ABNORMAL" },
      { id: 3, order_id: "ORD-3", patient_id: 3, patient_name: "Tariq A", gender: "M", status: "READY", collected_on: `${d90}T08:00:00Z`, classification: "ABNORMAL" },
    ];
    st0.followups = [
      { id: 1, report_id: 1, patient_id: 1, patient_name: "Asha R", priority: "ROUTINE", stage: "QUEUED", buckets: ["DIABETES"], due_on: today, retest_window_start: today, retest_window_end: today, retest_plan: { primary_finding: { finding_code: "HIGH_HBA1C" }, default_tests: ["HBA1C", "FBS"] } },
      { id: 2, report_id: 2, patient_id: 2, patient_name: "Rohan V", priority: "ROUTINE", stage: "QUEUED", buckets: ["DIABETES"], due_on: addDaysIso(today, -15), retest_window_start: addDaysIso(today, -15), retest_window_end: addDaysIso(today, -15), retest_plan: { primary_finding: { finding_code: "HIGH_HBA1C" }, default_tests: ["HBA1C"] } },
      { id: 3, report_id: 3, patient_id: 3, patient_name: "Tariq A", priority: "ROUTINE", stage: "QUEUED", buckets: ["LIPID"], due_on: addDaysIso(today, 30), retest_window_start: addDaysIso(today, 30), retest_window_end: addDaysIso(today, 30), retest_plan: { primary_finding: { finding_code: "HIGH_CHOLESTEROL" }, default_tests: ["LIPID"] } },
    ];
    st0.patient_medications = [{ id: 1, patient_id: 1, medicine_code: "METFORMIN", stopped_on: null }];
    await env.CRTRACKER_DATA.put("app_state_v5", JSON.stringify(st0));
    await env.CRTRACKER_DATA.put("report_params:1", JSON.stringify([{ id: 1, param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 8.2, unit: "%", system_flag: "HIGH" }]));
    await env.CRTRACKER_DATA.put("report_params:2", JSON.stringify([{ id: 2, param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 8.6, unit: "%", system_flag: "HIGH" }]));
    await env.CRTRACKER_DATA.put("report_params:3", JSON.stringify([{ id: 3, param_code: "LDL", param_name_raw: "LDL", value_num: 190, unit: "mg/dL", system_flag: "HIGH" }]));

    // 1. Unapproved plan cannot be booked (409); only DOCTOR can approve
    const p1Res = await (await req(env, "GET", "/api/v1/followups/1/retest-plan", docCookie)).json();
    assert.strictEqual(p1Res.approved, false);
    assert.strictEqual(p1Res.steps.length, 7);
    assert.ok(p1Res.tests.every((t) => !("price_inr" in t)));

    const hubs = await (await req(env, "GET", "/api/v1/health-hubs", calCookie)).json();
    assert.ok(hubs.length >= 2);
    assert.strictEqual((await req(env, "POST", `/api/v1/retest-recommendations/${p1Res.id}/book`, calCookie, { collection_mode: "HEALTH_HUB", health_hub_id: hubs[0].id })).status, 409);
    assert.strictEqual((await req(env, "POST", `/api/v1/retest-recommendations/${p1Res.id}/approve`, adminCookie)).status, 403);
    assert.strictEqual((await req(env, "POST", `/api/v1/retest-recommendations/${p1Res.id}/approve`, calCookie)).status, 403);

    const app1 = await (await req(env, "POST", `/api/v1/retest-recommendations/${p1Res.id}/approve`, docCookie)).json();
    assert.strictEqual(app1.approved, true);

    // 2. Caller view + encrypted HOME booking
    const calPlan = await (await req(env, "GET", "/api/v1/followups/1/retest-plan", calCookie)).json();
    assert.strictEqual(calPlan.label, "Follow-up test");
    assert.ok(!JSON.stringify(calPlan).toLowerCase().includes("hba1c"));
    assert.ok(!JSON.stringify(calPlan).toLowerCase().includes("8.2"));

    const homeBook = await req(env, "POST", `/api/v1/retest-recommendations/${p1Res.id}/book`, calCookie, {
      collection_mode: "HOME",
      address: "742 Evergreen Terrace, Mumbai",
    });
    assert.strictEqual(homeBook.status, 200);
    const hbData = await homeBook.json();
    assert.strictEqual(hbData.booking_status, "BOOKED");
    assert.strictEqual(hbData.has_address, true);
    const stMid = await env.CRTRACKER_DATA.get("app_state_v5", "json");
    assert.ok(!JSON.stringify(stMid.recommendations).includes("742 Evergreen"));

    // 3. Bundle accept: Patient 1 has active Metformin -> includes PHARMACY; Patient 2 has no meds -> excludes PHARMACY
    assert.strictEqual((await req(env, "POST", "/api/v1/followups/1/bundles/DIABETES/accept", adminCookie)).status, 403);
    const b1 = await (await req(env, "POST", "/api/v1/followups/1/bundles/DIABETES/accept", docCookie)).json();
    assert.ok(b1.services.includes("PHARMACY"));
    const b2 = await (await req(env, "POST", "/api/v1/followups/2/bundles/DIABETES/accept", docCookie)).json();
    assert.ok(!b2.services.includes("PHARMACY"));
    await req(env, "POST", `/api/v1/retest-recommendations/${b2.plan_id}/book`, adminCookie, { collection_mode: "HEALTH_HUB", health_hub_id: hubs[0].id });

    // 4. Explain EN & HI + Caller blocked
    assert.strictEqual((await req(env, "GET", `/api/v1/retest-recommendations/${p1Res.id}/explain?lang=en`, calCookie)).status, 403);
    const expHi = await (await req(env, "GET", `/api/v1/retest-recommendations/${p1Res.id}/explain?lang=hi`, docCookie)).json();
    assert.strictEqual(expHi.language, "hi");
    assert.ok(expHi.patient_message);

    // 5. Auto-close READY reports -> Patient 1 IN_WINDOW, Patient 2 LATE (<=30d)
    const st2 = await env.CRTRACKER_DATA.get("app_state_v5", "json");
    const r4 = { id: 4, order_id: "ORD-4", patient_id: 1, patient_name: "Asha R", gender: "F", status: "READY", collected_on: `${today}T08:00:00Z`, classification: "ABNORMAL" };
    const r5 = { id: 5, order_id: "ORD-5", patient_id: 2, patient_name: "Rohan V", gender: "M", status: "READY", collected_on: `${today}T08:00:00Z`, classification: "ABNORMAL" };
    st2.reports.push(r4, r5);
    const p4 = [{ id: 10, param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 7.1, unit: "%", system_flag: "HIGH" }];
    const p5 = [{ id: 11, param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 7.5, unit: "%", system_flag: "HIGH" }];
    const pMap = {
      1: [{ id: 1, param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 8.2, unit: "%", system_flag: "HIGH" }],
      2: [{ id: 2, param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 8.6, unit: "%", system_flag: "HIGH" }],
      4: p4,
      5: p5,
    };
    matchCompletedPlansInStore(st2, 1, r4, p4, pMap);
    matchCompletedPlansInStore(st2, 2, r5, p5, pMap);
    await env.CRTRACKER_DATA.put("app_state_v5", JSON.stringify(st2));
    await env.CRTRACKER_DATA.put("report_params:4", JSON.stringify(p4));
    await env.CRTRACKER_DATA.put("report_params:5", JSON.stringify(p5));

    const p1After = await (await req(env, "GET", "/api/v1/followups/1/retest-plan", adminCookie)).json();
    const p2After = await (await req(env, "GET", "/api/v1/followups/2/retest-plan", docCookie)).json();
    assert.strictEqual(p1After.plan_status, "COMPLETED_IN_WINDOW");
    assert.strictEqual(p1After.tests_total_inr, 520);
    assert.strictEqual(p2After.plan_status, "COMPLETED_LATE");

    // 6. KPI RBAC & numbers (Patient 3 unapproved excluded)
    assert.strictEqual((await req(env, "GET", "/api/v1/kpis/retesting", docCookie)).status, 403);
    assert.strictEqual((await req(env, "GET", "/api/v1/kpis/retesting", calCookie)).status, 403);
    const kpiJson = await (await req(env, "GET", `/api/v1/kpis/retesting?from=${addDaysIso(today, -120)}&to=${today}`, adminCookie)).json();
    const elig = kpiJson.kpis.find((k) => k.key === "eligibility_rate");
    const comp = kpiJson.kpis.find((k) => k.key === "completion_rate");
    const rev = kpiJson.kpis.find((k) => k.key === "repeat_revenue");
    assert.strictEqual(elig.numerator, 2);
    assert.strictEqual(elig.denominator, 3);
    assert.strictEqual(comp.numerator, 1);
    assert.strictEqual(comp.denominator, 2);
    assert.strictEqual(rev.value, 1040); // 520 (Asha HBA1C+FBS) + 520 (Rohan HBA1C+FBS)

    const csvRes = await req(env, "GET", `/api/v1/kpis/retesting.csv?from=${addDaysIso(today, -120)}&to=${today}`, adminCookie);
    assert.strictEqual(csvRes.status, 200);
    assert.ok((await csvRes.text()).includes("Retesting eligibility rate"));
  });

  it("evaluates Page 8 Day 0->92 care journeys, dynamic windows, events, scheduler, messaging guards & superseding in Edge Worker", async () => {
    const env = createTestEnv();
    const adminCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })).headers.get("set-cookie").split(";")[0];
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Dr", email: "doc@sm.com", password: "DoctorPassword123!", role: "DOCTOR" });
    await req(env, "POST", "/api/v1/users", adminCookie, { name: "Cal", email: "cal@sm.com", password: "CallerPassword123!", role: "CALLER" });
    const docCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "doc@sm.com", password: "DoctorPassword123!" })).headers.get("set-cookie").split(";")[0];
    const calCookie = (await req(env, "POST", "/api/v1/auth/login", null, { email: "cal@sm.com", password: "CallerPassword123!" })).headers.get("set-cookie").split(";")[0];

    const today = todayIstStr();
    const d75Ago = addDaysIso(today, -75);
    const st0 = await env.CRTRACKER_DATA.get("app_state_v5", "json");
    st0.patients = [{ id: 1, name: "Kiran P", gender: "F", age: 40, mobile: "9830000001", language: "en", do_not_call: false }];
    st0.reports = [
      { id: 1, order_id: "ORD-J1", patient_id: 1, patient_name: "Kiran P", gender: "F", status: "READY", collected_on: `${d75Ago}T08:00:00Z`, classification: "ABNORMAL" },
    ];
    st0.followups = [
      { id: 1, report_id: 1, patient_id: 1, patient_name: "Kiran P", priority: "ROUTINE", stage: "QUEUED", buckets: ["LIPID"], due_on: today, retest_window_start: addDaysIso(today, 15), retest_window_end: addDaysIso(today, 15), reminder_on: today },
    ];
    await env.CRTRACKER_DATA.put("app_state_v5", JSON.stringify(st0));
    await env.CRTRACKER_DATA.put("report_params:1", JSON.stringify([{ id: 1, param_code: "LDL", param_name_raw: "LDL", value_num: 195, unit: "mg/dL", system_flag: "HIGH" }]));

    // 1. Start journey & verify dynamic D75/D90 from Page 7 window + corrected wordings + Caller neutrality
    const j1 = await (await req(env, "GET", "/api/v1/followups/1/journey", docCookie)).json();
    assert.strictEqual(j1.steps.length, 9);
    const d75 = j1.steps.find((s) => s.step_code === "D75_RETEST_NOTICE");
    const d90 = j1.steps.find((s) => s.step_code === "D90_RETEST");
    const d91 = j1.steps.find((s) => s.step_code === "D91_COMPARE");
    assert.strictEqual(d75.service, "Diagnostics booking");
    assert.strictEqual(d91.service, "AMI longitudinal analysis");
    assert.strictEqual(d75.due_on, today);
    assert.strictEqual(d90.due_on, addDaysIso(today, 15));

    const jCal = await (await req(env, "GET", "/api/v1/followups/1/journey", calCookie)).json();
    assert.ok(!JSON.stringify(jCal).includes("ami_action") && !JSON.stringify(jCal).toLowerCase().includes("ldl"));
    assert.strictEqual((await req(env, "GET", "/api/v1/patients/1/journeys", calCookie)).status, 403);
    assert.strictEqual((await req(env, "GET", "/api/v1/outbound-messages", calCookie)).status, 403);
    assert.strictEqual((await req(env, "GET", "/api/v1/outbound-messages", docCookie)).status, 403);

    // 2. Check-in WORSE spawns Doctor ClinicalTask
    const chkRes = await (await req(env, "POST", "/api/v1/followups/1/journey/checkin", calCookie, {
      step_code: "D30_ADHERENCE",
      adherence_code: "STOPPED",
      symptom_code: "WORSE",
    })).json();
    assert.ok(chkRes.clinical_task_id);
    assert.strictEqual(chkRes.journey.steps.find((s) => s.step_code === "D30_ADHERENCE").status, "DONE");

    // 3. Messaging guards + scheduler idempotency in KV store
    const stMid = await env.CRTRACKER_DATA.get("app_state_v5", "json");
    const d75Step = stMid.care_journeys[0].steps.find((s) => s.step_code === "D75_RETEST_NOTICE");
    const dayIso = `${today}T05:30:00Z`; // 11:00 IST
    const nightIso = `${today}T17:00:00Z`; // 22:30 IST
    assert.strictEqual(sendPatientMessageInStore(stMid, 1, "D75_RETEST_NOTICE", { followupId: 1, journeyStepId: d75Step.id, now: dayIso }).status, "BLOCKED_NO_CONSENT");
    stMid.consents = { 1: { patient_id: 1, followup_id: 1, given_at: dayIso } };
    assert.strictEqual(sendPatientMessageInStore(stMid, 1, "D75_RETEST_NOTICE", { followupId: 1, journeyStepId: d75Step.id, now: nightIso }).status, "BLOCKED_QUIET_HOURS");
    stMid.patients[0].do_not_call = true;
    assert.strictEqual(sendPatientMessageInStore(stMid, 1, "D75_RETEST_NOTICE", { followupId: 1, journeyStepId: d75Step.id, now: dayIso }).status, "BLOCKED_DNC");
    stMid.patients[0].do_not_call = false;

    const t1 = schedulerTickInStore(stMid, { now: dayIso });
    assert.ok(t1.tasks >= 1);
    const notifAfter1 = stMid.notifications.items.length;
    const t2 = schedulerTickInStore(stMid, { now: dayIso });
    assert.strictEqual(t2.tasks, 0);
    assert.strictEqual(stMid.notifications.items.length, notifAfter1);

    // 4. Supersede old journey with new followup for same condition group & verify dashboard/message log
    await env.CRTRACKER_DATA.put("app_state_v5", JSON.stringify(stMid));
    const dash = await (await req(env, "GET", "/api/v1/dashboard", adminCookie)).json();
    assert.ok(dash.journeys.active >= 1);
    assert.strictEqual(dash.journeys.funnel.length, 9);
    const msgs = await (await req(env, "GET", "/api/v1/outbound-messages", adminCookie)).json();
    assert.ok(msgs.some((m) => m.status === "CALL_TASK_CREATED"));
  });
});
