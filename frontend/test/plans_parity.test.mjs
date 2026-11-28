import { test } from "node:test";
import assert from "node:assert/strict";
import { handlePlansRoute, renewalTickInStore } from "../lib/plansParity.js";

const reply = (status, body) => ({ status, body });
const audits = [];
function call(store, role, method, path, body = {}, query = "") {
  const url = new URL(`https://x.test/api/v1${path}${query}`);
  const request = new Request(url, method === "GET" ? { method } : { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  return handlePlansRoute({ path, method, request, url, env: {}, store, me: { id: role === "DOCTOR" ? 3 : 1, role }, reply,
    recordAudit: (...a) => audits.push(a), saveStore: async () => {}, sanitizeCsvCell: (v) => String(v ?? ""), indianMobile: (v) => String(v || "").replace(/\D/g, "").slice(-10) });
}
const freshStore = () => ({ patients: [{ id: 1, name: "P", age: 40 }], followups: [] });

test("care plan: suggested, assessed by a doctor, then paid; callers see no plan names", async () => {
  const s = freshStore();
  assert.equal((await call(s, "CALLER", "POST", "/care-plans/enroll", { patient_id: 1, plan_code: "CP09_PCOS" })).status, 403);
  const e = (await call(s, "DOCTOR", "POST", "/care-plans/enroll", { patient_id: 1, plan_code: "CP09_PCOS", tier: "PLUS" })).body;
  assert.equal(e.status, "SUGGESTED");
  assert.equal((await call(s, "CALLER", "POST", `/care-plans/enrollments/${e.id}/pay`, {})).status, 422);
  assert.equal((await call(s, "ADMIN", "POST", `/care-plans/enrollments/${e.id}/assess`, { eligible: true })).status, 403);
  assert.equal((await call(s, "DOCTOR", "POST", `/care-plans/enrollments/${e.id}/assess`, { eligible: true })).body.status, "DOCTOR_ASSESSED");
  const paid = await call(s, "CALLER", "POST", `/care-plans/enrollments/${e.id}/pay`, { method: "COUNTER_UPI" });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.status, "ACTIVE");
  assert.ok(!JSON.stringify(paid.body).includes("PCOS"));
  assert.ok(!JSON.stringify((await call(s, "CALLER", "GET", "/care-plans")).body).includes("PCOS"));
  assert.equal((await call(s, "CALLER", "GET", "/care-plans/CP09")).body.name_en, "Health Hub care plan 09");
  assert.equal(s.care_plans.length, 11);
});

test("a RED result blocks plan sales until a doctor clears it", async () => {
  const s = freshStore();
  s.followups.push({ id: 7, patient_id: 1, priority: "ESCALATION", created_at: new Date().toISOString() });
  assert.equal((await call(s, "CALLER", "POST", "/memberships/enroll", { patient_id: 1, plan_code: "H360_PLUS", amount_inr: 499 })).status, 409);
  assert.equal((await call(s, "ADMIN", "POST", "/followups/7/clear")).status, 403);
  assert.equal((await call(s, "DOCTOR", "POST", "/followups/7/clear")).body.plan_sale_blocked, false);
  assert.equal((await call(s, "CALLER", "POST", "/memberships/enroll", { patient_id: 1, plan_code: "H360_PLUS", amount_inr: 499 })).body.status, "ACTIVE");
});

test("Chronic waits for a doctor's sign-off; entitlements have limits; renewals remind once", async () => {
  const s = freshStore();
  const m = (await call(s, "CALLER", "POST", "/memberships/enroll", { patient_id: 1, plan_code: "H360_CHRONIC", amount_inr: 799 })).body;
  assert.equal(m.status, "PENDING_SIGNOFF");
  assert.equal(m.plan_name, "Health360 Care");
  assert.equal((await call(s, "DOCTOR", "POST", `/memberships/${m.id}/signoff`)).body.status, "ACTIVE");
  assert.equal((await call(s, "DOCTOR", "POST", `/memberships/${m.id}/consume`, { entitlement_code: "DOCTOR_REVIEW" })).status, 200);
  assert.equal((await call(s, "DOCTOR", "POST", `/memberships/${m.id}/consume`, { entitlement_code: "DOCTOR_REVIEW" })).status, 422);
  assert.equal((await call(s, "CALLER", "POST", `/memberships/${m.id}/online-order`)).status, 409);
  s.memberships[0].current_period_end = new Date(Date.now() + 330 * 60000 + 3 * 864e5).toISOString().slice(0, 10);
  renewalTickInStore(s);
  renewalTickInStore(s);
  assert.equal(s.memberships[0].status, "RENEWAL_DUE");
  assert.equal(s.notifications.items.length, 1);
});

test("edge scorecard and loop are computed from the store, with a dash when there is no data", async () => {
  const { computeScorecard, computeLoop } = await import("../lib/backendParity.js");
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const s = { patients: [{ id: 1 }], care_touchpoints: [
    { patient_id: 1, stage: "PREVENTION", occurred_on: today, amount_inr: 500 },
    { patient_id: 1, stage: "DIAGNOSTICS", occurred_on: today, amount_inr: 1200 }] };
  const loop = computeLoop(s, {});
  assert.equal(loop.revenue_ring.transactions_inr, 1700);
  assert.equal(loop.transaction_cohort.revenue_per_transaction_inr, 850);
  assert.equal(loop.retention_rate, "—");
  assert.equal(loop.ami_coordination.steps_on_time_pct, "—");
  const dims = Object.fromEntries(computeScorecard(s, {}).dimensions.map((d) => [d.dimension, d]));
  assert.equal(dims.AMI.data_status, "NOT_AVAILABLE");
  assert.equal(dims["Core financial metric"].current_metric.value, "₹850");
  assert.equal(computeLoop(s, { from: "2020-01-01", to: "2020-01-31" }).revenue_ring.transactions_inr, 0);
});
