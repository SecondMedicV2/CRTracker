import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
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

const RULES = {
  reference_ranges: DEFAULT_REFERENCE_RANGES,
  severity: DEFAULT_SEVERITY,
  aliases: DEFAULT_ALIASES,
};

function P(code = "HBA1C", v = null, ref = "", flag = "") {
  return {
    param_code: code,
    param_name_raw: code,
    value_num: v,
    value_text: v !== null ? String(v) : "",
    ref_text: ref,
    ref_low: null,
    ref_high: null,
    lab_flag: flag,
    system_flag: "",
    severity: "",
    ref_source: "",
  };
}

function run(p, gender = "M") {
  flagParameter(p, gender, RULES);
  return [p.system_flag, p.severity, p.ref_source];
}

describe("Milestone 1: Golden Extraction & Validation Suite", () => {
  it("test_parse_range_forms", () => {
    assert.deepStrictEqual(parseRange("<5.7"), [null, 5.7, false, true]);
    assert.deepStrictEqual(parseRange("<= 5.7"), [null, 5.7, false, false]);
    assert.deepStrictEqual(parseRange("≤ 5.7"), [null, 5.7, false, false]);
    assert.deepStrictEqual(parseRange(">= 150"), [150.0, null, false, false]);
    assert.deepStrictEqual(parseRange("≥ 150"), [150.0, null, false, false]);
    assert.deepStrictEqual(parseRange("> 150"), [150.0, null, true, false]);
    assert.deepStrictEqual(parseRange("10 - 20"), [10.0, 20.0, false, false]);
    assert.deepStrictEqual(parseRange("0.4–4.2"), [0.4, 4.2, false, false]); // en dash
    assert.deepStrictEqual(parseRange("1,000 to 2,000"), [1000.0, 2000.0, false, false]);
    assert.strictEqual(parseRange("Absent"), null);
    assert.strictEqual(parseRange(""), null);
  });

  it("test_parse_value_and_alias_mapping", () => {
    assert.deepStrictEqual(parseValue("1,234.5").slice(0, 2), [1234.5, "1,234.5"]);
    assert.strictEqual(parseValue("<0.5")[0], 0.5);
    assert.strictEqual(parseValue("Not detected")[0], null);
    assert.strictEqual(parseValue("Not detected")[1], "Not detected");

    for (const raw of ["Glycosylated  Hemoglobin", "HbA1c", " A1C "]) {
      assert.strictEqual(canonicalCode(raw, DEFAULT_ALIASES), "HBA1C");
    }
    assert.strictEqual(canonicalCode("Mystery Test", DEFAULT_ALIASES), "");
  });

  it("test_report_range_wins_and_exclusive_bound", () => {
    const res = run(P("HBA1C", 6.0, "<5.7"));
    assert.strictEqual(res[0], "HIGH");
    assert.strictEqual(res[2], "report");

    assert.strictEqual(run(P("HBA1C", 5.7, "<5.7"))[0], "HIGH"); // '<5.7' excludes 5.7
    assert.strictEqual(run(P("HBA1C", 5.7, "<=5.7"))[0], "NORMAL");
    assert.strictEqual(run(P("X", 5.0, "10 - 20"))[0], "LOW");

    // The lab's wide range beats the stricter fallback table
    assert.strictEqual(run(P("HBA1C", 6.0, "<7"))[0], "NORMAL");
  });

  it("test_fallback_table_when_no_report_range", () => {
    assert.deepStrictEqual(run(P("HBA1C", 6.0)), ["HIGH", "mild", "fallback"]); // 5.0% over 5.7 limit -> mild
    assert.strictEqual(run(P("HBA1C", 5.0))[0], "NORMAL");
    assert.strictEqual(run(P("VITAMIN_D", 25))[0], "LOW"); // insufficient band is below normal
    assert.strictEqual(run(P("EGFR", 50))[0], "LOW");
    assert.strictEqual(run(P("GLUCOSE_FASTING", 60))[0], "LOW");
  });

  it("test_sex_specific_fallback_and_unknown_sex_is_not_guessed", () => {
    const hdl = (g) => run(P("HDL", 45), g)[0];
    assert.strictEqual(hdl("M"), "NORMAL");
    assert.strictEqual(hdl("F"), "LOW");
    assert.strictEqual(hdl(""), ""); // no sex, no flag

    const hb = (g) => run(P("HEMOGLOBIN", 12.5), g)[0];
    assert.strictEqual(hb("M"), "LOW");
    assert.strictEqual(hb("F"), "NORMAL");
    assert.strictEqual(hb(""), "");
  });

  it("test_flag_parameter_dual_signature_with_null_gender", () => {
    const p = P("HBA1C", 6.0);
    flagParameter(p, null, RULES);
    assert.strictEqual(p.system_flag, "HIGH");
    assert.strictEqual(p.ref_source, "fallback");
    assert.strictEqual(p.severity, "mild");
  });

  it("test_no_range_no_fallback_uses_lab_flag_else_nothing", () => {
    const flagged = run(P("UNKNOWN", 9, "", "H"));
    assert.strictEqual(flagged[0], "HIGH");
    assert.strictEqual(flagged[2], "lab_flag");

    assert.strictEqual(run(P("UNKNOWN", 9))[0], "");
    assert.strictEqual(run(P("UNKNOWN", null, "<5"))[0], ""); // non-numeric value is not flagged
  });

  it("test_severity_bands", () => {
    const severities = [5, 10, 24.9, 25, 80].map((d) => severityFor(d, DEFAULT_SEVERITY));
    assert.deepStrictEqual(severities, ["mild", "moderate", "moderate", "severe", "severe"]);
  });

  it("test_classification", () => {
    const r1 = { gender: "M" };
    assert.strictEqual(analyse(r1, [P("HBA1C", 5.0), P("EGFR", 90)], RULES), "NORMAL");
    assert.strictEqual(r1.classification, "NORMAL");
    assert.strictEqual(r1.abnormal_count, 0);

    const r2 = { gender: "M" };
    assert.strictEqual(analyse(r2, [P("HBA1C", 5.0), P("EGFR", 50)], RULES), "ABNORMAL");
    assert.strictEqual(r2.classification, "ABNORMAL");
    assert.strictEqual(r2.abnormal_count, 1);
  });

  it("test_confidence_scoring", () => {
    // Perfect report
    const clean = calculateConfidence(
      { gender: "Male", age: 45, collected_on: "2026-11-01T10:00:00Z" },
      [P("HBA1C", 5.5, "<5.7")]
    );
    assert.strictEqual(Number(clean), 100);
    assert.strictEqual(clean.needs_review, false);
    assert.deepStrictEqual(clean.reasons, []);

    // Missing gender (-30)
    const noGender = calculateConfidence(
      { gender: "", age: 45, collected_on: "2026-11-01T10:00:00Z" },
      [P("HBA1C", 5.5, "<5.7")]
    );
    assert.strictEqual(Number(noGender), 70);
    assert.strictEqual(noGender.needs_review, true);
    assert.ok(noGender.reasons.includes("Gender missing"));

    // Missing age (-30)
    const noAge = calculateConfidence(
      { gender: "F", age: null, collected_on: "2026-11-01T10:00:00Z" },
      [P("HBA1C", 5.5, "<5.7")]
    );
    assert.strictEqual(Number(noAge), 70);
    assert.ok(noAge.reasons.includes("Age missing or invalid"));

    // Missing collection date (-10)
    const noDate = calculateConfidence(
      { gender: "F", age: 30, collected_on: "" },
      [P("HBA1C", 5.5, "<5.7")]
    );
    assert.strictEqual(Number(noDate), 90);
    assert.ok(noDate.reasons.includes("Collection date missing"));

    // Inverted reference range (-20)
    const invertedParam = { ...P("HBA1C", 5.5), ref_low: 10, ref_high: 5, param_name_raw: "HbA1c" };
    const inverted = calculateConfidence(
      { gender: "M", age: 30, collected_on: "2026-11-01" },
      [invertedParam]
    );
    assert.strictEqual(Number(inverted), 80);
    assert.ok(inverted.reasons.some((r) => r.includes("Reference range looks wrong for HbA1c")));

    // Unmapped aliases and non-numeric values
    const unmapped = calculateConfidence(
      { gender: "M", age: 30, collected_on: "2026-11-01" },
      [P("", 5.5), P("HBA1C", null)]
    );
    // 1 unmapped (-10), 1 non-numeric (-5) => 85
    assert.strictEqual(Number(unmapped), 85);
    assert.ok(unmapped.reasons.some((r) => r.includes("1 test name(s) not recognised")));
    assert.ok(unmapped.reasons.some((r) => r.includes("1 value(s) are not numbers")));
  });

  it("test_redact_pii", () => {
    const rawReport = `
LABORATORY REPORT
Patient Name: Rajesh Sharma
Mobile Number: +91 9876543210
Address: 123 MG Road, Bangalore 560001
Email: rajesh.sharma@example.com
Barcode: BAR123456
HbA1c (Glycosylated Hemoglobin) HPLC 6.8 % <5.7
Fasting Blood Sugar PHOTOMETRY 110 mg/dL 70-100
Report Printed: 2026-11-19
    `.trim();

    const patient = { name: "Rajesh Sharma", mobile: "9876543210" };
    const redacted = redactPII(rawReport, patient);

    // Identifying lines are dropped completely
    assert.ok(!redacted.includes("Patient Name:"));
    assert.ok(!redacted.includes("Mobile Number:"));
    assert.ok(!redacted.includes("Address:"));
    assert.ok(!redacted.includes("rajesh.sharma@example.com"));
    assert.ok(!redacted.includes("9876543210"));
    assert.ok(!redacted.includes("BAR123456"));

    // Clinical test lines remain intact
    assert.ok(redacted.includes("HbA1c"));
    assert.ok(redacted.includes("6.8"));
    assert.ok(redacted.includes("Fasting Blood Sugar"));
    assert.ok(redacted.includes("110"));
  });

  it("test_extract_parameters_regex_and_markdown_tables", () => {
    const textReport = `
Thyrocare Lab Report
HbA1c (Glycosylated Hemoglobin) HPLC 6.8 % <5.7
Fasting Blood Sugar PHOTOMETRY 115 mg/dl 70-100
Vitamin D C.L.I.A 18.5 ng/ml 30-100
Total Cholesterol 220 mg/dl <200
Invalid Row With No Unit Or Range 55
Patient Age: 45
    `.trim();

    const params = extractParameters(textReport, DEFAULT_ALIASES);
    assert.strictEqual(params.length, 4);

    assert.strictEqual(params[0].param_code, "HBA1C");
    assert.strictEqual(params[0].value_num, 6.8);
    assert.strictEqual(params[0].unit, "%");
    assert.strictEqual(params[0].ref_high, 5.7);

    assert.strictEqual(params[1].param_code, "GLUCOSE_FASTING");
    assert.strictEqual(params[1].value_num, 115);
    assert.strictEqual(params[1].unit, "mg/dL"); // normalized

    assert.strictEqual(params[2].param_code, "VITAMIN_D");
    assert.strictEqual(params[2].value_num, 18.5);
    assert.strictEqual(params[2].unit, "ng/mL"); // normalized

    assert.strictEqual(params[3].param_code, "CHOL_TOTAL");
    assert.strictEqual(params[3].value_num, 220);

    // Also verify markdown table extraction
    const markdownTable = `
| Test Name | Method | Value | Unit | Reference Range |
| :--- | :--- | :--- | :--- | :--- |
| HbA1c | HPLC | 7.2 | % | <5.7 |
| Serum Creatinine | ENZYMATIC | 1.1 | mg/dl | 0.7-1.3 |
    `.trim();

    const tableParams = extractParameters(markdownTable, DEFAULT_ALIASES);
    assert.strictEqual(tableParams.length, 2);
    assert.strictEqual(tableParams[0].param_code, "HBA1C");
    assert.strictEqual(tableParams[0].value_num, 7.2);
    assert.strictEqual(tableParams[1].param_code, "CREATININE");
    assert.strictEqual(tableParams[1].value_num, 1.1);
  });

  it("test_cross_check_and_source_text_verification", () => {
    const sourceMarkdown = "Patient test shows HbA1c value 6.8 % and Glucose 105 mg/dL.";
    const ruleParams = [
      { param_code: "HBA1C", param_name_raw: "HbA1c", value_num: 6.8, value_text: "6.8", unit: "%" },
      { param_code: "GLUCOSE_FASTING", param_name_raw: "Glucose Fasting", value_num: 105, value_text: "105", unit: "mg/dL" },
    ];

    // Perfect cross-check: values match source and secondary AI matches
    const geminiParams = [
      { param_code: "HBA1C", value: 6.8, unit: "%" },
      { param_code: "GLUCOSE_FASTING", value: 105, unit: "mg/dL" },
    ];
    const check1 = crossCheckExtraction(ruleParams, geminiParams, sourceMarkdown);
    assert.strictEqual(check1.needs_review, false);
    assert.strictEqual(check1.discrepancies.length, 0);

    // Source discrepancy: accepted numeric value does NOT appear in source text
    const missingValueParams = [
      { param_code: "VITAMIN_D", param_name_raw: "Vitamin D", value_num: 99.5, value_text: "99.5", unit: "ng/mL" },
    ];
    const check2 = crossCheckExtraction(missingValueParams, [], sourceMarkdown);
    assert.strictEqual(check2.needs_review, true);
    assert.ok(check2.discrepancies.some((d) => d.includes("not found in source text")));

    // AI value mismatch
    const mismatchAi = [
      { param_code: "HBA1C", value: 8.5, unit: "%" },
      { param_code: "GLUCOSE_FASTING", value: 105, unit: "mg/dL" },
    ];
    const check3 = crossCheckExtraction(ruleParams, mismatchAi, sourceMarkdown);
    assert.strictEqual(check3.needs_review, true);
    assert.ok(check3.discrepancies.some((d) => d.includes("rule-based 6.8 vs AI 8.5")));

    // AI unit mismatch
    const mismatchUnit = [
      { param_code: "HBA1C", value: 6.8, unit: "mg/dL" },
      { param_code: "GLUCOSE_FASTING", value: 105, unit: "mg/dL" },
    ];
    const check4 = crossCheckExtraction(ruleParams, mismatchUnit, sourceMarkdown);
    assert.strictEqual(check4.needs_review, true);
    assert.ok(check4.discrepancies.some((d) => d.includes("Unit mismatch")));
  });
});

describe("Worker Edge API: Review, Extraction & KV Storage", () => {
  let worker;
  const env = {
    ADMIN_EMAIL: "admin@secondmedic.com",
    ADMIN_PASSWORD: "adminpassword123",
  };
  let adminCookie = "";
  let callerCookie = "";

  it("can load worker module and sign in", async () => {
    const mod = await import("../worker.js");
    worker = mod.default;

    const resAdmin = await worker.fetch(
      new Request("http://localhost:3000/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@secondmedic.com", password: "adminpassword123" }),
      }),
      env
    );
    assert.strictEqual(resAdmin.status, 200);
    const setCookie = resAdmin.headers.get("Set-Cookie");
    assert.ok(setCookie);
    adminCookie = setCookie.split(";")[0];

    // Create caller user for RBAC test
    const resCreate = await worker.fetch(
      new Request("http://localhost:3000/api/v1/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({
          name: "Test Caller",
          email: "caller@secondmedic.com",
          role: "CALLER",
          password: "callerpassword123",
        }),
      }),
      env
    );
    assert.ok(resCreate.status === 201 || resCreate.status === 409);

    const resCaller = await worker.fetch(
      new Request("http://localhost:3000/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "caller@secondmedic.com", password: "callerpassword123" }),
      }),
      env
    );
    assert.strictEqual(resCaller.status, 200);
    callerCookie = resCaller.headers.get("Set-Cookie").split(";")[0];
  });

  it("test_missing_gender_goes_to_review_then_approve", async () => {
    // 1. Create a test report in NEEDS_REVIEW with missing gender and age
    const resCreate = await worker.fetch(
      new Request("http://localhost:3000/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({
          order_id: "ORD-REVIEW1",
          patient_name: "Anita Verma",
          mobile: "9876543210",
          gender: "",
          age: null,
          status: "NEEDS_REVIEW",
          needs_review: true,
          review_reasons: ["Gender missing", "Age missing or invalid"],
        }),
      }),
      env
    );
    assert.strictEqual(resCreate.status, 201);
    const rep = await resCreate.json();
    const rid = rep.id;

    // Set initial parameter in KV
    await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({
          parameters: [
            {
              id: 1,
              param_code: "HBA1C",
              param_name_raw: "HbA1c",
              value_num: 6.0,
              value_text: "6.0",
              unit: "%",
              ref_text: "<5.7",
              ref_low: null,
              ref_high: 5.7,
              system_flag: "HIGH",
              severity: "mild",
              ref_source: "report",
            },
          ],
        }),
      }),
      env
    );
    rep.status = "NEEDS_REVIEW";

    // 1. Approve without gender -> 422
    const resApprove1 = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}/approve`, {
        method: "POST",
        headers: { Cookie: adminCookie },
      }),
      env
    );
    assert.strictEqual(resApprove1.status, 422);

    // 1b. Patch valid gender but leave age null -> Approve must return 422
    const resPatchGenderOnly = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ gender: "M" }),
      }),
      env
    );
    assert.strictEqual(resPatchGenderOnly.status, 200);

    const resApproveMissingAge = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}/approve`, {
        method: "POST",
        headers: { Cookie: adminCookie },
      }),
      env
    );
    assert.strictEqual(resApproveMissingAge.status, 422);

    // 1c. Patch age with null or empty string -> 422
    const resPatchNullAge = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ age: null }),
      }),
      env
    );
    assert.strictEqual(resPatchNullAge.status, 422);

    // 2. Patch invalid gender "X" -> 422
    const resPatchX = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ gender: "X" }),
      }),
      env
    );
    assert.strictEqual(resPatchX.status, 422);

    // 3. Patch valid gender "f" -> 200, normalized to "F"
    const resPatchF = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ gender: "f", age: 40 }),
      }),
      env
    );
    assert.strictEqual(resPatchF.status, 200);
    const patchedRep = await resPatchF.json();
    assert.strictEqual(patchedRep.gender, "F");
    assert.strictEqual(patchedRep.age, 40);

    // 4. Patch parameter value to "5.0"
    const resParam = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}/parameters/1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ value: "5.0" }),
      }),
      env
    );
    assert.strictEqual(resParam.status, 200);
    const patchedParam = await resParam.json();
    assert.strictEqual(patchedParam.value_num, 5.0);

    // 5. Approve report -> 200, status READY, classification NORMAL
    const resApprove2 = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}/approve`, {
        method: "POST",
        headers: { Cookie: adminCookie },
      }),
      env
    );
    assert.strictEqual(resApprove2.status, 200);
    const approvedRep = await resApprove2.json();
    assert.strictEqual(approvedRep.status, "READY");
    assert.strictEqual(approvedRep.classification, "NORMAL");

    // 6. Already approved -> 409 Conflict
    const resApprove3 = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}/approve`, {
        method: "POST",
        headers: { Cookie: adminCookie },
      }),
      env
    );
    assert.strictEqual(resApprove3.status, 409);

    // 7. Patch after approval -> 409 Conflict
    const resPatchAfter = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ age: 41 }),
      }),
      env
    );
    assert.strictEqual(resPatchAfter.status, 409);

    // 8. Audit logging check: field names logged, no patient clinical value logged
    const resAudit = await worker.fetch(
      new Request("http://localhost:3000/api/v1/audit", {
        method: "GET",
        headers: { Cookie: adminCookie },
      }),
      env
    );
    assert.strictEqual(resAudit.status, 200);
    const auditLogs = await resAudit.json();
    const entityIds = auditLogs.map((a) => a.entity_id);
    assert.ok(entityIds.some((id) => id.includes(`${rid}:gender`)));
    assert.ok(entityIds.some((id) => id.includes(`${rid}:age`)));
    assert.ok(entityIds.some((id) => id.includes(`${rid}:value`)));
    // Confirm no clinical values leaked into audit entity_id
    assert.ok(!entityIds.some((id) => id.includes("5.0")));
  });

  it("test_caller_role_blocked_from_reports_patients_trends", async () => {
    // Caller cannot access /reports
    const resReports = await worker.fetch(
      new Request("http://localhost:3000/api/v1/reports", {
        method: "GET",
        headers: { Cookie: callerCookie },
      }),
      env
    );
    assert.strictEqual(resReports.status, 403);

    // Caller cannot access /reports/:id
    const resReport1 = await worker.fetch(
      new Request("http://localhost:3000/api/v1/reports/1", {
        method: "GET",
        headers: { Cookie: callerCookie },
      }),
      env
    );
    assert.strictEqual(resReport1.status, 403);

    // Caller cannot access /patients
    const resPatients = await worker.fetch(
      new Request("http://localhost:3000/api/v1/patients", {
        method: "GET",
        headers: { Cookie: callerCookie },
      }),
      env
    );
    assert.strictEqual(resPatients.status, 403);

    // Caller cannot access /trends
    const resTrends = await worker.fetch(
      new Request("http://localhost:3000/api/v1/trends/1", {
        method: "GET",
        headers: { Cookie: callerCookie },
      }),
      env
    );
    assert.strictEqual(resTrends.status, 403);

    // Caller cannot access /exports/trends
    const resExportTrends = await worker.fetch(
      new Request("http://localhost:3000/api/v1/exports/trends/1.csv", {
        method: "GET",
        headers: { Cookie: callerCookie },
      }),
      env
    );
    assert.strictEqual(resExportTrends.status, 403);
  });

  it("test_on_demand_extract_endpoint_and_kv_isolation", async () => {
    // 1. Create a labtrace report
    const resCreate = await worker.fetch(
      new Request("http://localhost:3000/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({
          order_id: "ORD-LABTRACE-41",
          labtrace_work_order_id: "WO-41",
          thyrocare_patient_id: "THY-41",
          patient_name: "Ramesh Gupta",
          mobile: "9876543210",
          gender: "M",
          age: 52,
          source: "labtrace",
          status: "NEEDS_REVIEW",
          needs_review: true,
        }),
      }),
      env
    );
    assert.strictEqual(resCreate.status, 201);
    const rep = await resCreate.json();
    const rid = rep.id;

    // 2. Trigger on-demand extraction with raw report text
    const sampleText = `
Thyrocare Diagnostic Report
HbA1c (Glycosylated Hemoglobin) HPLC 7.5 % <5.7
Fasting Blood Sugar PHOTOMETRY 90 mg/dL 70-100
Total Cholesterol 240 mg/dL <200
    `.trim();

    const resExtract = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ text: sampleText }),
      }),
      env
    );
    assert.strictEqual(resExtract.status, 200);
    const extractBody = await resExtract.json();
    assert.strictEqual(extractBody.success, true);
    assert.strictEqual(extractBody.report.classification, "ABNORMAL");
    assert.strictEqual(extractBody.report.abnormal_count, 2); // HbA1c (7.5 > 5.7) and Total Cholesterol (240 > 200)

    // 3. Fetch report via GET /reports/:id and verify parameters are sorted abnormal first
    const resGet = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${rid}`, {
        method: "GET",
        headers: { Cookie: adminCookie },
      }),
      env
    );
    assert.strictEqual(resGet.status, 200);
    const fetchedRep = await resGet.json();
    assert.strictEqual(fetchedRep.pdf_url, `/api/v1/reports/${rid}/pdf`);
    assert.strictEqual(fetchedRep.parameters.length, 3);

    // Verify abnormal parameters come before normal ones
    assert.strictEqual(fetchedRep.parameters[0].system_flag, "HIGH");
    assert.strictEqual(fetchedRep.parameters[1].system_flag, "HIGH");
    assert.strictEqual(fetchedRep.parameters[2].system_flag, "NORMAL");

    // 4. Verify KV isolation: store.reports array in app_state_v5 does NOT hold parameter arrays
    const resAllReports = await worker.fetch(
      new Request("http://localhost:3000/api/v1/reports", {
        method: "GET",
        headers: { Cookie: adminCookie },
      }),
      env
    );
    const allReports = await resAllReports.json();
    const inStoreRep = allReports.find((r) => r.id === rid);
    assert.ok(inStoreRep);
    // In store.reports, parameters property is absent or empty (only populated on GET /reports/:id via KV)
    assert.ok(!inStoreRep.parameters || inStoreRep.parameters.length === 0);
  });

  it("test_extract_status_transitions_from_fetched", async () => {
    // 1. Report starting in FETCHED with defects (e.g. missing gender, age) -> transitions to NEEDS_REVIEW
    const resDefective = await worker.fetch(
      new Request("http://localhost:3000/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({
          order_id: "ORD-FETCHED-DEFECTIVE",
          patient_name: "Defective Patient",
          mobile: "9876543210",
          gender: "",
          age: null,
          status: "FETCHED",
          needs_review: false,
        }),
      }),
      env
    );
    assert.strictEqual(resDefective.status, 201);
    const repDefective = await resDefective.json();

    const resExtractDefective = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${repDefective.id}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({
          text: "Total Cholesterol 240 mg/dL <200",
        }),
      }),
      env
    );
    assert.strictEqual(resExtractDefective.status, 200);
    const bodyDefective = await resExtractDefective.json();
    assert.strictEqual(bodyDefective.report.status, "NEEDS_REVIEW");
    assert.strictEqual(bodyDefective.report.needs_review, true);

    // 2. Report starting in FETCHED clean (valid gender, age, name, date, normal params) -> transitions to READY
    const resClean = await worker.fetch(
      new Request("http://localhost:3000/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({
          order_id: "ORD-FETCHED-CLEAN",
          patient_name: "Pooja Sharma",
          mobile: "9876543210",
          gender: "F",
          age: 32,
          collected_on: "2026-02-15",
          lab_name: "Thyrocare",
          status: "FETCHED",
          needs_review: false,
        }),
      }),
      env
    );
    assert.strictEqual(resClean.status, 201);
    const repClean = await resClean.json();

    const resExtractClean = await worker.fetch(
      new Request(`http://localhost:3000/api/v1/reports/${repClean.id}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({
          text: "Fasting Blood Sugar PHOTOMETRY 85 mg/dL 70-100",
        }),
      }),
      env
    );
    assert.strictEqual(resExtractClean.status, 200);
    const bodyClean = await resExtractClean.json();
    assert.strictEqual(bodyClean.report.status, "READY");
    assert.strictEqual(bodyClean.report.needs_review, false);
  });
});

describe("extractParameters: table cells split across lines", () => {
  it("re-joins name / technology / value / unit / range printed on separate lines", () => {
    const text = [
      "TOTAL CHOLESTEROL", "PHOTOMETRY", "166", "mg/dL", "< 200",
      "HDL CHOLESTEROL - DIRECT", "PHOTOMETRY", "42", "mg/dL", "40-60",
      "HbA1c H.P.L.C 7.2 % <5.7",
      "Please correlate with clinical history.",
    ].join("\n");
    const params = extractParameters(text);
    assert.deepEqual(
      params.map((p) => [p.param_name_raw, p.value_num, p.unit, p.ref_low, p.ref_high]),
      [
        ["TOTAL CHOLESTEROL", 166, "mg/dL", null, 200],
        ["HDL CHOLESTEROL - DIRECT", 42, "mg/dL", 40, 60],
        ["HbA1c", 7.2, "%", null, 5.7],
      ]
    );
  });

  it("does not pull the next single-line result into a split row", () => {
    const text = ["Lipid Profile", "TRIGLYCERIDES PHOTOMETRY 120 mg/dL < 150"].join("\n");
    const params = extractParameters(text);
    assert.equal(params.length, 1);
    assert.equal(params[0].param_name_raw, "TRIGLYCERIDES");
  });
});

describe("Thyrocare glued layout (text converter output)", () => {
  const GLUED = [
    "Patient Name : TESTPERSON (40Y/F)",
    "Mobile : 9000000001",
    "TEST NAME TECHNOLOGY VALUE UNITS Bio. Ref. Interval.0.54-5.30μIU/mL4.61E.C.L.I.ATSH - ULTRASENSITIVEComments :",
    "The Biological Reference Ranges is specific to the age group.",
    "TEST NAME TECHNOLOGY VALUE UNITS Bio. Ref. Interval.<5.7%6.1H.P.L.CHbA1c70-100mg/dL115PHOTOMETRYFASTING BLOOD SUGAR(GLUCOSE)Comments :",
    "Trimester || T3 (ng/dl) || T4 (μg/dl) || TSH/USTSH (μIU/ml)",
    "1st || 81.2-244.2 || 6.6-12.4 || 0.1-2.5",
  ].join("\n");

  it("reads rows printed as RANGE UNIT VALUE TECHNOLOGY NAME with no spaces", () => {
    const params = extractParameters(GLUED);
    assert.deepEqual(
      params.map((p) => [p.param_name_raw, p.param_code, p.value_num, p.unit, p.ref_low, p.ref_high]),
      [
        ["TSH - ULTRASENSITIVE", "TSH", 4.61, "μIU/mL", 0.54, 5.3],
        ["HbA1c", "HBA1C", 6.1, "%", null, 5.7],
        ["FASTING BLOOD SUGAR(GLUCOSE)", canonicalCode("FASTING BLOOD SUGAR(GLUCOSE)"), 115, "mg/dL", 70, 100],
      ]
    );
  });

  it("redaction keeps the result line but drops name and mobile lines", () => {
    const out = redactPII(GLUED, { name: "TESTPERSON", mobile: "9000000001" });
    assert.ok(out.includes("4.61E.C.L.I.ATSH"));
    assert.ok(!out.includes("TESTPERSON"));
    assert.ok(!out.includes("9000000001"));
  });
});
