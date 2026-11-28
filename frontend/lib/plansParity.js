// Edge (Cloudflare Worker) mirror of the Python routes for Health Hub care plans (page 17), Health360 memberships
// (page 15) and the report-to-outcome safety gate. Same roles, same states, same caller masking as the backend.
import { STARTER_CARE_PLANS, STARTER_MEMBERSHIP_PLANS } from "./backendParity.js";

const LIVE = ["ACTIVE", "RENEWAL_DUE"];
const PERIOD_DAYS = { MONTH: 30, QUARTER: 90, BLOCK_8W: 56, YEAR: 365 };
const LINE_STAGE = { "SM WEIGHT CARE": "EATING_WELL", "SM SENIOR CARE": "ONGOING_MONITORING", "SM MOVE": "PREVENTION" };
const SIGNOFF_PLANS = ["H360_CHRONIC"];
const CONFIRMS = [
  { plan_code: "CP01", field: "whole_plan", note: "Plan 01 is not in the document (the flyers run 02-12). Probably Diabetes Care; needs a flyer." },
  { plan_code: "ALL", field: "qr_url", note: "The flyers only show a [QR CODE] placeholder; the QR target page is not defined." },
  { plan_code: "CP12_MOVE", field: "essential_physio_session_count", note: "Essential covers 'fewer physiotherapy sessions'; the number is not given." },
];

const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const nextId = (list) => list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;

export function triageColour(fu) {
  if (fu.priority === "ESCALATION" || fu.protocol_tier === "URGENT") return "RED";
  if ((fu.abnormal_codes || []).length || (fu.bucket_codes || []).length || (fu.finding_codes || []).length) return "AMBER";
  return "GREEN";
}

function triageOut(fu) {
  const colour = triageColour(fu);
  return {
    colour, cleared: !!fu.doctor_cleared_at, cleared_at: fu.doctor_cleared_at || null,
    plan_sale_blocked: colour === "RED" && !fu.doctor_cleared_at,
    rule: { RED: "Doctor call within 60 minutes; no plan is sold until a doctor clears it.",
      AMBER: "Doctor review within 24 hours and the matching condition plan.", GREEN: "Preventive plan; no extra tests pushed." }[colour],
  };
}

function saleBlocked(store, patientId) {
  return (store.followups || []).some((f) => f.patient_id === patientId && triageColour(f) === "RED" && !f.doctor_cleared_at);
}
const BLOCKED = "A doctor must clear this patient's critical result before any plan is sold.";

function carePlans(store) {
  if (!store.care_plans) store.care_plans = [];
  for (const seed of STARTER_CARE_PLANS) { // insert missing plans only, so admin edits survive
    if (!store.care_plans.some((p) => p.code === seed.code)) store.care_plans.push({ ...JSON.parse(JSON.stringify(seed)), id: nextId(store.care_plans) });
  }
  for (const p of store.care_plans) { // the old edge seed invented QR links; the brief does not define one
    if (/^https:\/\/secondmedic\.com\/plans\/cp\d+$/.test(p.qr_url || "")) p.qr_url = "";
  }
  store.care_plans.sort((a, b) => String(a.number).localeCompare(String(b.number)));
  return store.care_plans;
}
function memberPlans(store) {
  if (!store.membership_plans || store.membership_plans.some((p) => p.code === "H360_GOLD")) {
    store.membership_plans = JSON.parse(JSON.stringify(STARTER_MEMBERSHIP_PLANS)); // replace the old placeholder catalogue
  }
  return store.membership_plans;
}

function planOut(p, role) {
  const caller = role === "CALLER";
  if (!caller) return p;
  return { ...p, code: `CP${p.number}`, line: "", name_en: `Health Hub care plan ${p.number}`, name_hi: `हेल्थ हब केयर प्लान ${p.number}`,
    for_text: "Health Hub care plan", icon: "", inclusions_plus: [], essential_covers: "", entitlements: {}, tracked_measures: [],
    charged_separately: [], footnote: "", linked_programs: [] };
}

function enrOut(store, e, role) {
  const plan = carePlans(store).find((p) => p.code === e.plan_code);
  const number = plan?.number || "00";
  const out = { ...e, plan_code: role === "CALLER" ? `CP${number}` : e.plan_code, plan_number: number,
    plan_name: role === "CALLER" ? `Health Hub care plan ${number}` : (plan?.name_en || e.plan_code), doctor_assessed: !!e.assessed_on };
  delete out.entitlements_used;
  if (role !== "CALLER") {
    const used = e.entitlements_used || {};
    out.entitlements = Object.entries(plan?.entitlements || {}).map(([code, included]) => ({ code, included, used: used[code] || 0, overuse: (used[code] || 0) > included }));
    out.tracked_measures = plan?.tracked_measures || [];
  } else {
    delete out.eligibility_note_code;
  }
  return out;
}

function effectiveEntitlements(store, code) {
  const out = {};
  const seen = new Set();
  while (code && !seen.has(code)) {
    seen.add(code);
    const p = memberPlans(store).find((x) => x.code === code);
    if (!p) break;
    for (const e of p.entitlements || []) out[e.code] = (out[e.code] || 0) + (Number(e.quantity) || 0);
    code = p.includes_plan;
  }
  return out;
}

function memOut(store, m, role) {
  const plan = memberPlans(store).find((p) => p.code === m.plan_code);
  const out = { ...m, plan_name: role === "CALLER" && m.plan_code === "H360_CHRONIC" ? "Health360 Care" : (plan?.name || m.plan_code),
    signed_off: !!m.signed_off_at, payments: (store.payments || []).filter((p) => p.membership_id === m.id) };
  delete out.entitlements_used;
  if (role !== "CALLER") {
    out.entitlements_included = effectiveEntitlements(store, m.plan_code);
    out.entitlements_used = m.entitlements_used || {};
  }
  return out;
}

function nextMemStatus(m, paid) {
  if (SIGNOFF_PLANS.includes(m.plan_code) && !m.signed_off_at) return "PENDING_SIGNOFF";
  return paid ? "ACTIVE" : "PENDING_PAYMENT";
}

function addPayment(store, me, fields) {
  if (!store.payments) store.payments = [];
  const pay = { id: nextId(store.payments), status: "PAID", received_by: me.id, received_at: new Date().toISOString(), ...fields };
  store.payments.push(pay);
  return pay;
}

function notifyCallers(store, text, link) {
  if (!store.notifications) store.notifications = { unread: 0, items: [] };
  store.notifications.unread = (store.notifications.unread || 0) + 1;
  store.notifications.items.unshift({ id: nextId(store.notifications.items), text, link, urgent: false, read: false, at: new Date().toISOString() });
}

/** Daily renewal job for memberships and care plans (called from the Worker cron). */
export function renewalTickInStore(store) {
  const today = istToday();
  let n = 0;
  for (const m of store.memberships || []) {
    if (!LIVE.includes(m.status)) continue;
    if (m.plan_code === "H360_FREE" || m.payer === "CORPORATE") {
      if (m.current_period_end <= today) { m.current_period_end = addDays(today, m.plan_code === "H360_FREE" ? 365 : 30); n++; }
    } else if (m.current_period_end < addDays(today, -7)) { m.status = "EXPIRED"; n++; }
    else if (m.current_period_end <= addDays(today, 7) && !m.last_reminded_on) {
      notifyCallers(store, `Membership renewal call due for patient #${m.patient_id}`, `/patients/view?id=${m.patient_id}`);
      m.last_reminded_on = today; m.status = "RENEWAL_DUE"; n++;
    }
  }
  for (const e of store.plan_enrollments || []) {
    if (!LIVE.includes(e.status) || !e.period_end) continue;
    if (e.period_end < addDays(today, -7)) { e.status = "ENDED"; n++; }
    else if (e.period_end <= addDays(today, 7) && !e.last_reminded_on) {
      notifyCallers(store, `Health Hub care plan renewal call due for patient #${e.patient_id}`, `/patients/view?id=${e.patient_id}`);
      e.last_reminded_on = today; e.status = "RENEWAL_DUE"; n++;
    }
  }
  return n;
}

/** Returns a Response for the routes it owns, or null. */
export async function handlePlansRoute(ctx) {
  const { path, method, request, url, env, store, me, reply, recordAudit, saveStore, sanitizeCsvCell, indianMobile } = ctx;
  const role = me.role;
  const body = async () => (method === "GET" ? {} : await request.clone().json().catch(() => ({})));
  const save = async (action, entity, id, status, out) => { recordAudit(store, me, action, entity, id); await saveStore(env, store); return reply(status, out); };
  const only = (...roles) => (roles.includes(role) ? null : reply(403, { detail: "Your role cannot do this." }));
  let m;

  // ---- safety triage ----
  if ((m = path.match(/^\/followups\/(\d+)\/(triage|clear)$/))) {
    const fu = (store.followups || []).find((f) => f.id === Number(m[1]));
    if (m[2] === "triage" && method === "GET") {
      const no = only("ADMIN", "DOCTOR"); if (no) return no;
      if (!fu) return reply(404, { detail: "Follow-up not found" });
      return reply(200, triageOut(fu));
    }
    if (m[2] === "clear" && method === "POST") {
      const no = only("DOCTOR"); if (no) return no;
      if (!fu) return reply(404, { detail: "Follow-up not found" });
      if (!fu.doctor_cleared_at) { fu.doctor_cleared_at = new Date().toISOString(); fu.doctor_cleared_by = me.id; }
      return save("clear", "followup", fu.id, 200, triageOut(fu));
    }
  }

  if (path === "/outcomes/metrics" && method === "GET") {
    const no = only("ADMIN"); if (no) return no;
    const fus = store.followups || [];
    const counts = { RED: 0, AMBER: 0, GREEN: 0 };
    let red = 0, redOk = 0;
    for (const f of fus) {
      const c = triageColour(f); counts[c]++;
      if (c === "RED") { red++; const t0 = Date.parse(f.created_at || ""), t1 = Date.parse(f.doctor_cleared_at || ""); if (t1 && t0 && t1 - t0 <= 3600e3) redOk++; }
    }
    const rate = (a, b) => ({ numerator: a, denominator: b, value: b ? Math.round((1000 * a) / b) / 10 : null, unit: "%" });
    const na = (key, name) => ({ key, name, numerator: null, denominator: null, value: null, unit: "%" });
    return reply(200, {
      from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || istToday(),
      north_star: { key: "verified_health_deltas", name: "Verified health deltas (North Star)", definition: "Members with at least one biomarker improved at a retest in the period",
        value: 0, retested_members: 0, improved_share: null, note: "Computed by the Python backend" },
      metrics: [na("plan_signed_24h", "Doctor-signed plan within 24 hours"), na("plan_active_48h", "Active plan within 48 hours"),
        { key: "red_doctor_call_60m", name: "Doctor call on every RED result within 60 minutes", ...rate(redOk, red) },
        na("amber_review_24h", "Doctor review of AMBER results within 24 hours"), na("retest_completion", "Retest completion in the clinical window"),
        na("renewal_rate", "Care-plan renewal"), { key: "revenue_per_report", name: "Revenue per report", numerator: null, denominator: null, value: null, unit: "INR" },
        na("doctor_edit_rate", "Doctor edits to AMI drafts")],
      triage: counts, uncleared_red: fus.filter((f) => triageColour(f) === "RED" && !f.doctor_cleared_at).length,
    });
  }

  // ---- care plans ----
  if (path === "/care-plans" && method === "GET") return reply(200, carePlans(store).filter((p) => p.active !== false).map((p) => planOut(p, role)));
  if (path === "/care-plans" && method === "POST") {
    const no = only("ADMIN"); if (no) return no;
    const b = await body();
    if (!/^[A-Z0-9_]{3,60}$/.test(b.code || "") || !b.number || !b.name_en) return reply(422, { detail: "code, number and name_en are required" });
    if (carePlans(store).some((p) => p.code === b.code)) return reply(422, { detail: "A plan with this code already exists" });
    const p = { id: nextId(store.care_plans), tiers: [], entitlements: {}, tracked_measures: [], active: true, qr_url: "", ...b };
    store.care_plans.push(p);
    return save("create", "care_plan", p.code, 201, p);
  }
  if (path === "/care-plans/confirms" && method === "GET") {
    const no = only("ADMIN"); if (no) return no;
    return reply(200, { missing_confirms: CONFIRMS });
  }
  if (path === "/care-plans/analytics/revenue" && method === "GET") {
    const no = only("ADMIN"); if (no) return no;
    const byPlan = {}, byHub = {};
    for (const t of store.care_touchpoints || []) {
      if (t.ref_entity !== "payments" || !carePlans(store).some((p) => p.code === t.service_code)) continue;
      byPlan[t.service_code] = byPlan[t.service_code] || { total_revenue: 0, payments: 0 };
      byPlan[t.service_code].total_revenue += t.amount_inr || 0; byPlan[t.service_code].payments++;
      const h = t.health_hub_id ?? null;
      byHub[h] = byHub[h] || { total_revenue: 0, payments: 0 };
      byHub[h].total_revenue += t.amount_inr || 0; byHub[h].payments++;
    }
    return reply(200, { by_plan: Object.entries(byPlan).map(([plan_code, d]) => ({ plan_code, ...d })),
      by_hub: Object.entries(byHub).map(([k, d]) => ({ health_hub_id: k === "null" ? null : Number(k), ...d })) });
  }
  if (path === "/care-plans/enroll" && method === "POST") {
    const no = only("ADMIN", "DOCTOR"); if (no) return no;
    const b = await body();
    const pid = Number(b.patient_id);
    if (!(store.patients || []).some((p) => p.id === pid)) return reply(404, { detail: "Patient not found" });
    const plan = carePlans(store).find((p) => p.code === b.plan_code && p.active !== false);
    if (!plan) return reply(422, { detail: "Plan not found" });
    const tier = (plan.tiers || []).find((t) => t.tier === (b.tier || "PLUS"));
    if (!tier) return reply(422, { detail: "Invalid tier for plan" });
    if (!store.plan_enrollments) store.plan_enrollments = [];
    if (store.plan_enrollments.some((e) => e.patient_id === pid && e.plan_code === plan.code && ["SUGGESTED", "DOCTOR_ASSESSED", ...LIVE].includes(e.status))) {
      return reply(422, { detail: "This patient already has an open enrolment for this plan" });
    }
    const e = { id: nextId(store.plan_enrollments), patient_id: pid, plan_code: plan.code, tier: tier.tier, status: "SUGGESTED",
      health_hub_id: b.health_hub_id || null, price_inr: tier.price_inr, entitlements_used: {}, renewal_count: 0, created_by: me.id,
      created_at: new Date().toISOString() };
    store.plan_enrollments.push(e);
    return save("suggest", "plan_enrollment", e.id, 200, enrOut(store, e, role));
  }
  if (path === "/care-plans/enrollments" && method === "GET") {
    const q = url.searchParams;
    let rows = store.plan_enrollments || [];
    for (const [k, f] of [["health_hub_id", Number], ["patient_id", Number], ["status", String], ["plan_code", String]]) {
      if (q.get(k) && !(k === "plan_code" && role === "CALLER")) rows = rows.filter((e) => e[k] === f(q.get(k)));
    }
    return reply(200, [...rows].reverse().map((e) => enrOut(store, e, role)));
  }
  if ((m = path.match(/^\/care-plans\/enrollments\/(\d+)\/(assess|pay|consume)$/)) && method === "POST") {
    const e = (store.plan_enrollments || []).find((x) => x.id === Number(m[1]));
    const action = m[2];
    if (action === "assess") { const no = only("DOCTOR"); if (no) return no; }
    if (!e) return reply(422, { detail: "Enrollment not found" });
    const b = await body();
    const plan = carePlans(store).find((p) => p.code === e.plan_code);
    if (action === "assess") {
      if (!["SUGGESTED", "DOCTOR_ASSESSED", "NOT_ELIGIBLE"].includes(e.status)) return reply(422, { detail: `Cannot assess a ${e.status.toLowerCase()} enrolment` });
      e.assessed_on = new Date().toISOString(); e.assessed_by = me.id;
      if (b.eligible === false) {
        e.status = "NOT_ELIGIBLE";
        e.eligibility_note_code = b.note_code || (e.plan_code === "CP06_MEDICAL_WEIGHT" ? "NOT_ELIGIBLE_FOR_MEDICAL_TREATMENT" : "NOT_ELIGIBLE");
      } else { e.status = "DOCTOR_ASSESSED"; e.eligibility_note_code = b.note_code || ""; }
      return save("assess", "plan_enrollment", e.id, 200, enrOut(store, e, role));
    }
    if (action === "pay") {
      const renewal = [...LIVE, "ENDED"].includes(e.status);
      if (e.status !== "DOCTOR_ASSESSED" && !renewal) return reply(422, { detail: "A doctor must assess the patient before this plan can be paid for" });
      if (saleBlocked(store, e.patient_id)) return reply(409, { detail: BLOCKED });
      const tier = (plan?.tiers || []).find((t) => t.tier === e.tier);
      if (!tier) return reply(422, { detail: "Invalid tier for plan" });
      const pay = addPayment(store, me, { patient_id: e.patient_id, amount_inr: tier.price_inr, method: b.method || "COUNTER_CASH", reference: String(b.reference || "").slice(0, 60), health_hub_id: e.health_hub_id });
      const today = istToday();
      let start = today;
      if (renewal) {
        if (LIVE.includes(e.status) && e.period_end > today) start = e.period_end;
        e.renewal_count = (e.renewal_count || 0) + 1; e.entitlements_used = {}; e.last_reminded_on = null;
      } else { e.period_start = today; e.activated_at = new Date().toISOString(); }
      e.period_end = addDays(start, PERIOD_DAYS[tier.period] || 90);
      Object.assign(e, { status: "ACTIVE", price_inr: tier.price_inr, payment_id: pay.id });
      if (!store.care_touchpoints) store.care_touchpoints = [];
      store.care_touchpoints.push({ id: nextId(store.care_touchpoints), patient_id: e.patient_id, stage: LINE_STAGE[plan?.line] || "CHRONIC_CONDITIONS",
        service_code: e.plan_code, occurred_on: today, source: "AUTO", ref_entity: "payments", ref_id: pay.id, amount_inr: tier.price_inr,
        health_hub_id: e.health_hub_id, created_by: me.id, created_at: new Date().toISOString() });
      return save("payment", "plan_enrollment", e.id, 200, enrOut(store, e, role));
    }
    if (!LIVE.includes(e.status)) return reply(422, { detail: "Only an active plan has entitlements to use" });
    const key = String(b.entitlement_key || "").trim().toUpperCase();
    const units = Math.max(1, Number(b.units) || 1);
    const allowed = (plan?.entitlements || {})[key];
    if (allowed === undefined) return reply(422, { detail: "Entitlement not included in plan" });
    const used = ((e.entitlements_used || {})[key] || 0) + units;
    e.entitlements_used = { ...(e.entitlements_used || {}), [key]: used };
    const out = enrOut(store, e, role);
    out.entitlements_used = role === "CALLER" ? {} : e.entitlements_used;
    out.warning = used > allowed ? "More than the plan includes has now been used." : "";
    return save("consume", "plan_enrollment", e.id, 200, out);
  }
  if ((m = path.match(/^\/care-plans\/([^/]+)$/))) {
    const code = decodeURIComponent(m[1]);
    const p = carePlans(store).find((x) => x.code === code) || (/^CP\d+$/.test(code) ? store.care_plans.find((x) => x.number === code.slice(2)) : null);
    if (method === "GET") return p ? reply(200, planOut(p, role)) : reply(404, { detail: "Care plan not found" });
    if (method === "PATCH") {
      const no = only("ADMIN"); if (no) return no;
      if (!p) return reply(404, { detail: "Care plan not found" });
      const b = await body();
      if (b.qr_url && !String(b.qr_url).startsWith("https://")) return reply(422, { detail: "qr_url must be an https:// address" });
      for (const k of ["line", "name_en", "name_hi", "for_text", "colour", "icon", "tiers", "inclusions_plus", "essential_covers", "entitlements",
        "tracked_measures", "charged_separately", "footnote", "qr_url", "linked_programs", "active"]) if (b[k] !== undefined) p[k] = b[k];
      return save("edit", "care_plan", p.code, 200, planOut(p, role));
    }
  }

  // ---- Health360 memberships ----
  if (path === "/membership-plans" && method === "GET") {
    return reply(200, memberPlans(store).filter((p) => p.active !== false).map((p) => ({ ...p,
      name: role === "CALLER" && p.code === "H360_CHRONIC" ? "Health360 Care" : p.name,
      target_text: role === "CALLER" ? "Member care plan" : p.target_text, entitlements: role === "CALLER" ? [] : p.entitlements })));
  }
  if ((m = path.match(/^\/membership-plans\/([^/]+)$/)) && method === "PATCH") {
    const no = only("ADMIN"); if (no) return no;
    const p = memberPlans(store).find((x) => x.code === m[1]);
    if (!p) return reply(404, { detail: "Plan not found" });
    const b = await body();
    for (const k of ["name", "target_text", "price_inr_monthly", "benefits_text", "includes_plan", "entitlements", "active"]) if (b[k] !== undefined) p[k] = b[k];
    return save("edit", "membership_plan", p.code, 200, p);
  }
  if ((m = path.match(/^\/patients\/(\d+)\/memberships$/)) && method === "GET") {
    const pid = Number(m[1]);
    if (!(store.patients || []).some((p) => p.id === pid)) return reply(404, { detail: "Patient not found" });
    if (!store.memberships) store.memberships = [];
    if (!store.memberships.some((x) => x.patient_id === pid && x.plan_code === "H360_FREE")) {
      store.memberships.push({ id: nextId(store.memberships), patient_id: pid, plan_code: "H360_FREE", status: "ACTIVE", payer: "SELF",
        start_on: istToday(), current_period_end: addDays(istToday(), 365), entitlements_used: {}, renewal_count: 0 });
      await saveStore(env, store);
    }
    const pat = store.patients.find((p) => p.id === pid);
    const sugg = [];
    if (role !== "CALLER") {
      if ((pat.age || 0) >= 60) sugg.push("H360_SENIOR");
      if ((store.followups || []).some((f) => f.patient_id === pid && (f.bucket_codes || []).some((b) => ["DIABETES", "HYPERTENSION", "THYROID"].includes(b)))) sugg.push("H360_CHRONIC");
    }
    return reply(200, { memberships: store.memberships.filter((x) => x.patient_id === pid).map((x) => memOut(store, x, role)), suggestions: sugg });
  }
  if (path === "/memberships" && method === "GET") {
    const no = only("ADMIN"); if (no) return no;
    const q = url.searchParams;
    let rows = store.memberships || [];
    if (q.get("plan_code")) rows = rows.filter((x) => x.plan_code === q.get("plan_code"));
    if (q.get("status")) rows = rows.filter((x) => x.status === q.get("status").toUpperCase());
    if (q.get("corporate_client_id")) rows = rows.filter((x) => x.corporate_client_id === Number(q.get("corporate_client_id")));
    const mrr = {};
    for (const x of store.memberships || []) {
      if (!LIVE.includes(x.status) || x.payer !== "SELF") continue;
      mrr[x.plan_code] = (mrr[x.plan_code] || 0) + (memberPlans(store).find((p) => p.code === x.plan_code)?.price_inr_monthly || 0);
    }
    return reply(200, { memberships: [...rows].reverse().slice(0, 500).map((x) => memOut(store, x, role)), mrr_by_plan: mrr,
      mrr_total: Object.values(mrr).reduce((a, b) => a + b, 0) });
  }
  if (path === "/memberships/enroll" && method === "POST") {
    const b = await body();
    const pid = Number(b.patient_id);
    if (!(store.patients || []).some((p) => p.id === pid)) return reply(404, { detail: "Patient not found" });
    const plan = memberPlans(store).find((p) => p.code === b.plan_code);
    if (!plan) return reply(422, { detail: "Plan not found" });
    const payer = String(b.payer || "SELF").toUpperCase();
    if (payer === "CORPORATE" && !b.corporate_client_id) return reply(422, { detail: "A corporate membership needs a corporate client" });
    if (plan.price_inr_monthly > 0 && saleBlocked(store, pid)) return reply(409, { detail: BLOCKED });
    if (!store.memberships) store.memberships = [];
    const x = { id: nextId(store.memberships), patient_id: pid, plan_code: plan.code, payer, corporate_client_id: b.corporate_client_id || null,
      health_hub_id: b.health_hub_id || null, start_on: istToday(), current_period_end: addDays(istToday(), 30), entitlements_used: {},
      renewal_count: 0, enrolled_by: me.id };
    if (SIGNOFF_PLANS.includes(plan.code) && role === "DOCTOR") { x.signed_off_at = new Date().toISOString(); x.signed_off_by = me.id; }
    store.memberships.push(x);
    let paid = plan.price_inr_monthly === 0 || payer === "CORPORATE";
    if (!paid && Number(b.amount_inr) > 0) {
      addPayment(store, me, { patient_id: pid, membership_id: x.id, amount_inr: Number(b.amount_inr), method: b.payment_method || "COUNTER_CASH", reference: String(b.reference || "").slice(0, 60) });
      paid = true;
    }
    x.status = nextMemStatus(x, paid);
    return save("enroll", "membership", x.id, 200, memOut(store, x, role));
  }
  if ((m = path.match(/^\/memberships\/(\d+)\/(signoff|payments|status|consume|online-order|online-confirm)$/)) && method === "POST") {
    const x = (store.memberships || []).find((y) => y.id === Number(m[1]));
    const action = m[2];
    if (action === "signoff") { const no = only("DOCTOR"); if (no) return no; }
    if (action === "status") { const no = only("ADMIN"); if (no) return no; }
    if (action === "online-order" || action === "online-confirm") {
      return reply(409, { detail: "Online payments are switched off. Record a counter payment instead." });
    }
    if (!x) return reply(422, { detail: "Membership not found" });
    const b = await body();
    const paid = () => (store.payments || []).some((p) => p.membership_id === x.id && p.status === "PAID");
    if (action === "signoff") {
      if (!SIGNOFF_PLANS.includes(x.plan_code)) return reply(422, { detail: "This plan does not need a doctor's sign-off" });
      if (!x.signed_off_at) { x.signed_off_at = new Date().toISOString(); x.signed_off_by = me.id; }
      if (x.status === "PENDING_SIGNOFF") x.status = nextMemStatus(x, paid() || x.payer === "CORPORATE");
      return save("signoff", "membership", x.id, 200, memOut(store, x, role));
    }
    if (action === "payments") {
      const amount = Number(b.amount_inr);
      if (!(amount >= 1)) return reply(422, { detail: "amount_inr must be positive" });
      if (x.status === "CANCELLED") return reply(422, { detail: "Cannot take a payment on a cancelled membership" });
      if (saleBlocked(store, x.patient_id)) return reply(409, { detail: BLOCKED });
      addPayment(store, me, { patient_id: x.patient_id, membership_id: x.id, amount_inr: amount, method: b.method || "COUNTER_CASH", reference: String(b.reference || "").slice(0, 60) });
      if ([...LIVE, "EXPIRED"].includes(x.status)) {
        const today = istToday();
        const base = x.status === "EXPIRED" || x.current_period_end < today ? today : x.current_period_end;
        x.current_period_end = addDays(base, 30); x.renewal_count = (x.renewal_count || 0) + 1; x.last_reminded_on = null; x.entitlements_used = {};
      }
      x.status = nextMemStatus(x, true);
      return save("payment", "membership", x.id, 200, memOut(store, x, role));
    }
    if (action === "status") {
      const to = String(b.status || "").toUpperCase();
      const allowed = { PAUSED: ["ACTIVE", "RENEWAL_DUE"], ACTIVE: ["PAUSED"], CANCELLED: ["ACTIVE", "RENEWAL_DUE", "PAUSED", "PENDING_PAYMENT", "PENDING_SIGNOFF"] };
      if (!allowed[to] || !allowed[to].includes(x.status) || (x.plan_code === "H360_FREE" && to === "CANCELLED")) {
        return reply(422, { detail: `Cannot change a ${String(x.status).toLowerCase()} membership to ${to.toLowerCase() || "nothing"}` });
      }
      x.status = to;
      return save(`status_${to.toLowerCase()}`, "membership", x.id, 200, memOut(store, x, role));
    }
    if (!LIVE.includes(x.status)) return reply(422, { detail: "Only an active membership has entitlements to use" });
    const code = String(b.entitlement_code || "").trim().toUpperCase();
    const allowedQty = effectiveEntitlements(store, x.plan_code)[code];
    if (allowedQty === undefined) return reply(422, { detail: "Entitlement not included in plan" });
    const used = (x.entitlements_used || {})[code] || 0;
    if (used >= allowedQty) return reply(422, { detail: `${code} allowance used up (${used} of ${allowedQty})` });
    x.entitlements_used = { ...(x.entitlements_used || {}), [code]: used + 1 };
    return save("consume", "membership", x.id, 200, memOut(store, x, role));
  }
  if (path === "/corporate-billing/statements" && method === "GET") {
    const no = only("ADMIN"); if (no) return no;
    const rows = (store.corporate_clients || []).filter((c) => c.active !== false).map((c) => {
      const n = (store.memberships || []).filter((x) => x.corporate_client_id === c.id && LIVE.includes(x.status)).length;
      return { client_id: c.id, client_name: c.name, code: c.code, pepm_inr: c.pepm_inr || 0, active_members: n, monthly_total_inr: n * (c.pepm_inr || 0) };
    });
    if (url.searchParams.get("format") === "csv") {
      const q = (v) => `"${sanitizeCsvCell(v).replace(/"/g, '""')}"`;
      const csv = ["Client,Code,PEPM (INR),Active members,Monthly total (INR)",
        ...rows.map((r) => [q(r.client_name), q(r.code), r.pepm_inr, r.active_members, r.monthly_total_inr].join(","))].join("\n");
      recordAudit(store, me, "export", "corporate_statements", "csv");
      await saveStore(env, store);
      return new Response(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="corporate-statements.csv"', "Cache-Control": "no-store" } });
    }
    return reply(200, { statements: rows });
  }
  if ((m = path.match(/^\/corporate-clients\/(\d+)\/roster$/)) && method === "POST") {
    const no = only("ADMIN"); if (no) return no;
    const client = (store.corporate_clients || []).find((c) => c.id === Number(m[1]));
    if (!client) return reply(404, { detail: "Corporate client not found" });
    const form = await request.formData().catch(() => null);
    const file = form && form.get("file");
    if (!file || typeof file === "string") return reply(422, { detail: "Upload a CSV roster" });
    if (file.size > 5 * 1024 * 1024) return reply(413, { detail: "File is larger than 5 MB" });
    if (!/\.csv$/i.test(file.name || "")) return reply(422, { detail: "The Worker accepts CSV rosters; XLSX needs the Python backend" });
    const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
    const head = (lines.shift() || "").split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const col = (...n) => n.map((x) => head.indexOf(x)).find((i) => i >= 0);
    const iEmp = col("employee_id", "emp_id", "employee"), iName = col("name", "employee_name"), iMob = col("mobile", "phone", "mobile_number");
    if (iName === undefined || iMob === undefined) return reply(422, { detail: "The roster needs Name and Mobile columns (Employee ID is optional)" });
    const counts = { rows: lines.length, matched: 0, created: 0, enrolled: 0, already_member: 0, skipped: 0 };
    if (!store.patients) store.patients = [];
    if (!store.memberships) store.memberships = [];
    for (const line of lines) {
      const cells = line.split(",").map((c) => c.trim());
      const mobile = indianMobile(cells[iMob]), name = String(cells[iName] || "").slice(0, 120);
      if (!mobile || !name) { counts.skipped++; continue; }
      let p = store.patients.find((x) => x.mobile === mobile && !x.merged_into_id);
      if (p) { counts.matched++; if (!p.corporate_client_id) p.corporate_client_id = client.id; }
      else {
        p = { id: nextId(store.patients), name, mobile, source_channel: "CORPORATE", corporate_client_id: client.id, created_at: new Date().toISOString() };
        store.patients.push(p); counts.created++;
      }
      if (store.memberships.some((x) => x.patient_id === p.id && x.corporate_client_id === client.id && [...LIVE, "PAUSED"].includes(x.status))) { counts.already_member++; continue; }
      store.memberships.push({ id: nextId(store.memberships), patient_id: p.id, plan_code: "H360_CORPORATE", status: "ACTIVE", payer: "CORPORATE",
        corporate_client_id: client.id, member_ref: String(iEmp !== undefined ? cells[iEmp] || "" : "").slice(0, 60), start_on: istToday(),
        current_period_end: addDays(istToday(), 30), entitlements_used: {}, renewal_count: 0, enrolled_by: me.id });
      counts.enrolled++;
    }
    return save("import_roster", "corporate_client", `${client.id}:${counts.enrolled} enrolled`, 200, counts);
  }
  return null;
}
