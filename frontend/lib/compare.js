/**
 * AMI Parameter Display comparison & Condition Journeys (Page 10).
 * Parity port of backend/app/compare.py and backend/app/journeys.py for Cloudflare Worker edge mode.
 */
import {
  DEFAULT_DIAGNOSTIC_FINDINGS,
  SYNONYMS,
  addDaysIso,
  buildProgramContext,
  cleanProfile,
  detectFindingsInCtx,
  todayIstStr,
} from "./programs.js";
import { DEFAULT_CLINICAL_TARGETS, DEFAULT_RETEST_PROTOCOLS, planRetestInStore, toIstDateStr } from "./retest.js";
import { DEFAULT_REFERENCE_RANGES, canonicalCode, parseRange } from "./extract.js";

export const CLINICAL_DISCLAIMER = "Medication changes remain the responsibility of the treating clinician.";

export const DEFAULT_NEXT_ACTION_RULES = [
  { target_status: "Above target", change_status: "Improved", next_action: "Continue clinical follow-up" },
  { target_status: "Above target", change_status: "Worsened", next_action: "Doctor review" },
  { target_status: "At target", change_status: null, next_action: "Continue current plan; routine monitoring" },
  { target_status: null, change_status: null, next_action: "Individualized" },
];

export const DEFAULT_JOURNEY_TEMPLATES = {
  selection_rules: [
    { when: { main_finding: "HIGH_HBA1C" }, template: "HBA1C_90" },
    { when: "default", template: "STANDARD_92" },
  ],
  templates: {
    HBA1C_90: {
      code: "HBA1C_90",
      name: "HbA1c Follow-up Journey (Day 0 to Day 90)",
      main_finding: "HIGH_HBA1C",
      note: "starter value, clinician to confirm",
      steps: [
        { code: "HBA1C_D0", window_label: "Day 0", day_from: 0, day_to: 0, what_happens: "AMI flags elevated HbA1c and recommends clinical review", owner: "SYSTEM", caller_label: "Report reviewed" },
        { code: "HBA1C_D1_7", window_label: "Day 1\u20137", day_from: 1, day_to: 7, what_happens: "Doctor evaluates the patient and establishes a diabetes management plan", owner: "DOCTOR", caller_label: "Doctor review scheduled" },
        { code: "HBA1C_D7_30", window_label: "Day 7\u201330", day_from: 7, day_to: 30, what_happens: "Diet plan, prescribed medication adherence, and glucose monitoring", owner: "DIETITIAN/COORDINATOR", caller_label: "Care plan follow-up" },
        { code: "HBA1C_D30_60", window_label: "Day 30\u201360", day_from: 30, day_to: 60, what_happens: "AMI checks adherence and glucose trends. Medication changes remain the responsibility of the treating clinician.", owner: "SYSTEM+CALLER", caller_label: "Follow-up check-in", disclaimer: CLINICAL_DISCLAIMER },
        { code: "HBA1C_D90", window_label: "Day 90", day_from: 90, day_to: 90, what_happens: "Repeat HbA1c if clinically appropriate", owner: "LAB", caller_label: "Scheduled check-in", requires_clinically_appropriate: true },
      ],
    },
    STANDARD_92: {
      code: "STANDARD_92",
      name: "Standard AMI Follow-up Journey (Day 0 to Day 92)",
      main_finding: null,
      note: "starter value, clinician to confirm",
      steps: [
        { code: "D0_ANALYSED", day_offset: 0, window_label: "Day 0", day_from: 0, day_to: 0, ami_action: "Diagnostic report uploaded and analyzed", service: "Report interpretation", what_happens: "Diagnostic report uploaded and analyzed", clinical_label: "Diagnostic report analysed", owner: "SYSTEM", channel: "AUTO", caller_label: "Follow-up summary ready", completes_when: "report_ready_analysed", skip_if: null },
        { code: "D1_RECOMMEND", day_offset: 1, window_label: "Day 1", day_from: 1, day_to: 1, ami_action: "Personalized health recommendations", service: "Doctor/dietitian consultation", what_happens: "Personalized health recommendations", clinical_label: "Clinical consultation and care plan", owner: "DOCTOR", channel: "TASK", caller_label: "Follow-up consultation scheduled", completes_when: "consultation_and_recommendations_done", skip_if: null },
        { code: "D7_ACTIVATION", day_offset: 7, window_label: "Day 7", day_from: 7, day_to: 7, ami_action: "Check care-plan activation", service: "Pharmacy, nutrition or chronic care", what_happens: "Check care-plan activation", clinical_label: "Care-plan activation review", owner: "COORDINATOR", channel: "CALL", caller_label: "Care plan check-in", completes_when: "program_activated", skip_if: "nothing_accepted" },
        { code: "D30_ADHERENCE", day_offset: 30, window_label: "Day 30", day_from: 30, day_to: 30, ami_action: "Adherence and symptom follow-up", service: "Care management", what_happens: "Adherence and symptom follow-up", clinical_label: "Adherence and symptom review", owner: "CALLER", channel: "CALL", caller_label: "Routine follow-up call", completes_when: "checkin_logged_d30", skip_if: null },
        { code: "D60_PROGRESS", day_offset: 60, window_label: "Day 60", day_from: 60, day_to: 60, ami_action: "Review progress and upcoming monitoring", service: "Care coordinator", what_happens: "Review progress and upcoming monitoring", clinical_label: "Progress and monitoring check-in", owner: "COORDINATOR", channel: "CALL", caller_label: "Progress check-in call", completes_when: "checkin_logged_d60", skip_if: null },
        { code: "D75_RETEST_NOTICE", day_offset: 75, window_label: "Day 75", day_from: 75, day_to: 75, ami_action: "Notify patient of clinician-approved retest", service: "Diagnostics booking", what_happens: "Notify patient of clinician-approved retest", clinical_label: "Retest notice and diagnostics booking", owner: "CALLER", channel: "PATIENT_MESSAGE", caller_label: "Follow-up booking reminder", completes_when: "retest_reminder_delivered", skip_if: null },
        { code: "D90_RETEST", day_offset: 90, window_label: "Day 90", day_from: 90, day_to: 90, ami_action: "Perform scheduled retesting", service: "Perform collection: Home collection or Health Hub", what_happens: "Perform scheduled retesting", clinical_label: "Scheduled repeat collection", owner: "CALLER", channel: "CALL", caller_label: "Scheduled follow-up visit", completes_when: "retest_booked_or_completed", skip_if: null },
        { code: "D91_COMPARE", day_offset: 91, window_label: "Day 91", day_from: 91, day_to: 91, ami_action: "Compare old and new results", service: "AMI longitudinal analysis", what_happens: "Compare old and new results", clinical_label: "AMI longitudinal comparison", owner: "SYSTEM", channel: "AUTO", caller_label: "Follow-up summary ready for doctor review", completes_when: "longitudinal_comparison_ready", skip_if: null },
        { code: "D92_UPDATE_PLAN", day_offset: 92, window_label: "Day 92", day_from: 92, day_to: 92, ami_action: "Update care plan following clinical review", service: "Relevant SecondMedic services", what_happens: "Update care plan following clinical review", clinical_label: "Doctor care-plan update", owner: "DOCTOR", channel: "TASK", caller_label: "Follow-up plan update scheduled", completes_when: "care_plan_updated", skip_if: null },
      ],
    },
  },
};

const SAME_UNIT_GROUPS = [
  ["10^6/ul", "mill/cumm", "million/cumm", "millions/cumm", "mil/cumm", "10^6/cumm", "10^12/l", "million/ul", "mill/ul", "m/ul"],
  ["10^3/ul", "thou/cumm", "thousand/cumm", "10^3/cumm", "10^9/l", "k/ul", "thou/ul", "1000/ul"],
  ["/cumm", "/ul", "cells/cumm", "cells/ul"],
  ["g/dl", "g%"],
  ["uiu/ml", "miu/l", "uu/ml"],
  ["u/l", "iu/l"],
  ["ng/ml", "ug/l"],
  ["pg/ml", "ng/l"],
  ["ug/dl", "mcg/dl"],
  ["fl", "femtolitre", "femtoliter"],
];

export function normUnitJs(u) {
  if (!u) return null;
  let s = String(u).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/[µμ]/g, "u").replace(/\bmc(?=g\b|g\/|mol)/g, "u").replace(/\s+/g, "");
  s = s.replace(/[×x*]10/g, "10").replace(/³/g, "^3").replace(/⁶/g, "^6").replace(/⁹/g, "^9");
  s = s.replace(/10(\d)(?=\/)/g, "10^$1").replace(/cu\.?mm|cmm|mm3/g, "cumm");
  s = s.replace(/^gms?(?=\/|%|$)/g, "g").replace(/^gm%$/g, "g%");
  return s;
}

export function sameUnitJs(a, b) {
  const xa = String(a || "").trim();
  const xb = String(b || "").trim();
  if (!xa && !xb) return true;
  const x = normUnitJs(xa);
  const y = normUnitJs(xb);
  if (!x || !y) return false;
  if (x === y) return true;
  return SAME_UNIT_GROUPS.some((g) => g.includes(x) && g.includes(y));
}

function synKeys(code) {
  const u = String(code || "").trim().toUpperCase();
  if (!u) return [];
  const grp = SYNONYMS[u];
  return grp ? [u, ...[...grp].filter((x) => x !== u).sort()] : [u];
}

function groupKey(code, rawName) {
  let u = String(code || "").trim().toUpperCase();
  if (!u && rawName) u = canonicalCode(rawName);
  if (SYNONYMS[u]) return [...SYNONYMS[u]].sort()[0];
  return u || String(rawName || "").trim().toUpperCase();
}

function fmtNum(val) {
  const r = Math.round(Number(val) * 1000) / 1000;
  if (Math.abs(r) < 1e-9) return "0";
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return String(Number(r.toFixed(3)));
}

function fmtSignedAbs(delta, unit) {
  const u = String(unit || "").trim();
  if (Math.abs(delta) < 1e-9) return u === "%" ? "0 percentage points" : (u ? `0 ${u}` : "0");
  const sign = delta < 0 ? "\u2212" : "+";
  const mag = fmtNum(Math.abs(delta));
  return u === "%" ? `${sign}${mag} percentage points` : `${sign}${mag}${u ? ` ${u}` : ""}`;
}

function fmtSignedPct(pct) {
  if (pct === null || pct === undefined) return "";
  if (Math.abs(pct) < 1e-9) return "0%";
  return `${pct < 0 ? "\u2212" : "+"}${fmtNum(Math.abs(pct))}%`;
}

function cmpVal(val, op, target) {
  if (op === "<") return val < target;
  if (op === "<=") return val <= target;
  if (op === ">") return val > target;
  if (op === ">=") return val >= target;
  if (op === "==") return val === target;
  return false;
}

function resolveTarget(code, gender, rules, profile, param) {
  const keys = synKeys(code);
  const pTargets = profile?.targets || {};
  const rTargets = rules?.clinical_targets?.data || rules?.clinical_targets || DEFAULT_CLINICAL_TARGETS;
  let spec = null;
  let source = "";
  for (const k of keys) {
    if (pTargets[k] && typeof pTargets[k] === "object") {
      spec = { ...pTargets[k] };
      source = "patient_override";
      break;
    }
  }
  if (!spec) {
    for (const k of keys) {
      if (rTargets[k] && typeof rTargets[k] === "object") {
        spec = { ...rTargets[k] };
        source = "rule_set";
        break;
      }
    }
  }
  if (spec) {
    let dir = String(spec.direction || "").toUpperCase();
    let op = String(spec.target_op || "").trim().toUpperCase();
    let tv = spec.target_value;
    if (gender === "F" && spec.target_value_f !== undefined && spec.target_value_f !== null) tv = spec.target_value_f;
    const tl = spec.target_low;
    const th = spec.target_high;
    if (!dir) dir = (op === "RANGE" || (tl != null && th != null)) ? "RANGE" : ([">", ">="].includes(op) ? "HIGHER_IS_BETTER" : "LOWER_IS_BETTER");
    if (!op) op = dir === "RANGE" ? "RANGE" : (dir === "HIGHER_IS_BETTER" ? ">=" : "<");
    let minMc = Number(spec.min_meaningful_change || 0);
    if (source === "patient_override" && spec.min_meaningful_change === undefined) {
      for (const k of keys) {
        if (rTargets[k]?.min_meaningful_change !== undefined) {
          minMc = Number(rTargets[k].min_meaningful_change);
          break;
        }
      }
    }
    return {
      source, direction: dir, target_op: op,
      target_value: tv != null ? Number(tv) : null,
      target_low: tl != null ? Number(tl) : null,
      target_high: th != null ? Number(th) : null,
      min_meaningful_change: minMc,
      unit: String(spec.unit || param.unit || ""),
    };
  }

  let lo = param.ref_low ?? null;
  let hi = param.ref_high ?? null;
  if (lo == null && hi == null && param.ref_text) {
    const rng = parseRange(param.ref_text);
    if (rng) { lo = rng[0]; hi = rng[1]; }
  }
  if (lo == null && hi == null) {
    const ranges = rules?.reference_ranges?.data || rules?.reference_ranges || DEFAULT_REFERENCE_RANGES;
    const rs = keys.map((k) => ranges[k]).find(Boolean);
    if (rs) {
      if (rs.low_below && rs.low_below[gender] != null) lo = Number(rs.low_below[gender]);
      else {
        const norm = (rs.bands || []).find((b) => ["normal", "desirable", "optimal", "sufficient"].includes(b[0]));
        if (norm) { lo = norm[1]; hi = norm[2]; }
      }
    }
  }
  if (lo != null && hi != null) return { source: "reference_range", direction: "RANGE", target_op: "RANGE", target_value: null, target_low: Number(lo), target_high: Number(hi), min_meaningful_change: 0, unit: param.unit || "" };
  if (hi != null) return { source: "reference_range", direction: "LOWER_IS_BETTER", target_op: "<=", target_value: Number(hi), target_low: null, target_high: null, min_meaningful_change: 0, unit: param.unit || "" };
  if (lo != null) return { source: "reference_range", direction: "HIGHER_IS_BETTER", target_op: ">=", target_value: Number(lo), target_low: null, target_high: null, min_meaningful_change: 0, unit: param.unit || "" };
  return { source: "none", direction: "LOWER_IS_BETTER", target_op: "", target_value: null, target_low: null, target_high: null, min_meaningful_change: 0, unit: param.unit || "" };
}

function targetDisplay(tgt) {
  const u = tgt.unit === "%" ? "%" : (tgt.unit ? ` ${tgt.unit}` : "");
  if (tgt.direction === "RANGE" && tgt.target_low != null && tgt.target_high != null) return `${fmtNum(tgt.target_low)}\u2013${fmtNum(tgt.target_high)}${u}`;
  if (tgt.target_value != null && tgt.target_op) return `${tgt.target_op} ${fmtNum(tgt.target_value)}${u}`;
  return "\u2014";
}

function evalTargetStatus(val, tgt, flag = "") {
  if (val == null) return null;
  if (tgt.direction === "RANGE") {
    if (tgt.target_low != null && val < tgt.target_low) return "Below target";
    if (tgt.target_high != null && val > tgt.target_high) return "Above target";
    if (tgt.target_low != null || tgt.target_high != null) return "At target";
  } else if (tgt.direction === "HIGHER_IS_BETTER" && tgt.target_value != null) {
    if (tgt.target_high != null && val > tgt.target_high) return "Above target";
    return cmpVal(val, tgt.target_op, tgt.target_value) ? "At target" : "Below target";
  } else if (tgt.direction === "LOWER_IS_BETTER" && tgt.target_value != null) {
    if (!cmpVal(val, tgt.target_op, tgt.target_value)) return "Above target";
    if (tgt.target_low != null && val < tgt.target_low) return "Below target";
    return "At target";
  }
  if (flag === "HIGH") return "Above target";
  if (flag === "LOW") return "Below target";
  if (flag === "NORMAL") return "At target";
  return null;
}

function rangeDist(val, lo, hi) {
  if (lo != null && val < lo) return lo - val;
  if (hi != null && val > hi) return val - hi;
  return 0;
}

function evalChangeStatus(prevVal, currVal, tgt) {
  const delta = Math.round((currVal - prevVal) * 1000) / 1000;
  const minMc = Number(tgt.min_meaningful_change || 0);
  if (Math.abs(delta) < (minMc > 0 ? minMc : 0.001)) return "No meaningful change";
  if (tgt.direction === "HIGHER_IS_BETTER") return delta > 0 ? "Improved" : "Worsened";
  if (tgt.direction === "RANGE") {
    const dp = rangeDist(prevVal, tgt.target_low, tgt.target_high);
    const dc = rangeDist(currVal, tgt.target_low, tgt.target_high);
    if (Math.abs(dc - dp) < 1e-6) return "No meaningful change";
    return dc < dp ? "Improved" : "Worsened";
  }
  return delta < 0 ? "Improved" : "Worsened";
}

function evalTrend(pts, currUnit, tgt) {
  const same = pts.filter((p) => p.value != null && sameUnitJs(p.unit, currUnit));
  if (same.length < 3) return null;
  const win = same.slice(-3);
  const net = Math.round((win[win.length - 1].value - win[0].value) * 1000) / 1000;
  const minMc = Number(tgt.min_meaningful_change || 0);
  if (Math.abs(net) < (minMc > 0 ? minMc : 0.001)) return "Stable";
  if (tgt.direction === "HIGHER_IS_BETTER") return net > 0 ? "Positive trend" : "Negative trend";
  if (tgt.direction === "RANGE") {
    const d0 = rangeDist(win[0].value, tgt.target_low, tgt.target_high);
    const d1 = rangeDist(win[win.length - 1].value, tgt.target_low, tgt.target_high);
    if (Math.abs(d1 - d0) < 1e-6) return "Stable";
    return d1 < d0 ? "Positive trend" : "Negative trend";
  }
  return net < 0 ? "Positive trend" : "Negative trend";
}

function evalNextAction(rules, targetStatus, changeStatus) {
  const actionRules = rules?.next_action_rules?.data || rules?.next_action_rules || DEFAULT_NEXT_ACTION_RULES;
  for (const r of actionRules) {
    const rt = r.target_status;
    const rc = r.change_status;
    if ((rt === null || rt === undefined || rt === targetStatus) && (rc === null || rc === undefined || rc === changeStatus)) {
      return String(r.next_action || "Individualized");
    }
  }
  return "Individualized";
}

function reportsUpTo(store, patientId, report) {
  const list = (store.reports || []).filter((r) => r.patient_id === patientId && (r.status === "READY" || r.id === report.id))
    .sort((a, b) => String(a.collected_on || "").localeCompare(String(b.collected_on || "")) || a.id - b.id);
  const cutoff = report.collected_on || "";
  return list.filter((r) => r.id === report.id || (r.collected_on && cutoff ? (r.collected_on < cutoff || (r.collected_on === cutoff && r.id <= report.id)) : r.id <= report.id));
}

export function hasComparisonInStore(store, patientId, reportId, paramsByReport) {
  const rep = (store.reports || []).find((r) => r.id === reportId);
  if (!rep) return false;
  const curKeys = new Set((paramsByReport[reportId] || []).filter((p) => p.value_num != null).map((p) => groupKey(p.param_code, p.param_name_raw)));
  if (!curKeys.size) return false;
  for (const r of reportsUpTo(store, patientId, rep)) {
    if (r.id === reportId) continue;
    if ((paramsByReport[r.id] || []).some((p) => p.value_num != null && curKeys.has(groupKey(p.param_code, p.param_name_raw)))) return true;
  }
  return false;
}

export function compareInStore(store, patientId, reportId, paramsByReport) {
  const report = (store.reports || []).find((r) => r.id === reportId);
  const patient = (store.patients || []).find((p) => p.id === patientId);
  if (!report || !patient) return [];
  const reps = reportsUpTo(store, patientId, report);
  const repDates = Object.fromEntries(reps.map((r) => [r.id, toIstDateStr(r.collected_on || r.reported_on)]));
  const series = {};
  for (const r of reps) {
    const dt = repDates[r.id];
    for (const p of (paramsByReport[r.id] || [])) {
      if (p.value_num == null) continue;
      const gk = groupKey(p.param_code, p.param_name_raw);
      if (!series[gk]) series[gk] = [];
      series[gk].push({
        date: dt, value: Number(p.value_num), unit: p.unit || "", report_id: r.id,
        flag: p.system_flag === "HIGH" ? "HIGH" : p.system_flag === "LOW" ? "LOW" : "IN_RANGE",
      });
    }
  }
  const rules = store.rules || {};
  const profile = cleanProfile((store.health_profiles || {})[patientId]);
  const gender = report.gender || patient.gender || "";
  const rows = [];
  const seen = new Set();

  for (const p of (paramsByReport[reportId] || [])) {
    if (p.value_num == null) continue;
    const gk = groupKey(p.param_code, p.param_name_raw);
    if (seen.has(gk)) continue;
    seen.add(gk);
    const code = String(p.param_code || gk).toUpperCase();
    const pts = series[gk] || [];
    const prevPts = pts.filter((x) => x.report_id !== reportId);
    const prevPt = prevPts[prevPts.length - 1] || null;
    const tgt = resolveTarget(code, gender, rules, profile, p);
    const tgtStatus = evalTargetStatus(Number(p.value_num), tgt, p.system_flag || "");
    const unit = p.unit || "";
    const unitsDiffer = Boolean(prevPt && !sameUnitJs(prevPt.unit, unit));

    let changeAbs = null;
    let changePct = null;
    let changeDisplay = "\u2014";
    let changePctDisplay = "";
    let changeStatus = null;
    if (prevPt) {
      if (unitsDiffer) {
        changeDisplay = "Units differ \u2014 not compared";
        changeStatus = "Units differ \u2014 not compared";
      } else {
        const delta = Math.round((Number(p.value_num) - Number(prevPt.value)) * 1000) / 1000;
        const pct = prevPt.value ? Math.round((delta / Math.abs(prevPt.value)) * 1000) / 10 : null;
        changeAbs = delta;
        changePct = pct;
        changeDisplay = fmtSignedAbs(delta, unit);
        changePctDisplay = fmtSignedPct(pct);
        changeStatus = evalChangeStatus(Number(prevPt.value), Number(p.value_num), tgt);
      }
    }
    const trend = unitsDiffer ? null : evalTrend(pts, unit, tgt);
    const nextAction = evalNextAction(rules, tgtStatus, changeStatus);
    const sparkline = pts.filter((x) => x.value != null && sameUnitJs(x.unit, unit));
    const label = p.param_name_raw || code;
    const row = {
      param_code: code,
      label,
      previous: prevPt ? prevPt.value : null,
      previous_unit: prevPt ? prevPt.unit : "",
      previous_date: prevPt ? prevPt.date : null,
      previous_report_id: prevPt ? prevPt.report_id : null,
      current: Number(p.value_num),
      current_unit: unit,
      current_date: repDates[reportId],
      unit,
      units_differ: unitsDiffer,
      change_abs: changeAbs,
      change_pct: changePct,
      change_display: changeDisplay,
      change_pct_display: changePctDisplay,
      target_display: targetDisplay(tgt),
      target_op: tgt.target_op,
      target_value: tgt.target_value,
      target_low: tgt.target_low,
      target_high: tgt.target_high,
      direction: tgt.direction,
      min_meaningful_change: tgt.min_meaningful_change,
      target_source: tgt.source,
      target_status: tgtStatus,
      change_status: changeStatus,
      trend,
      points_count: sparkline.length,
      next_action: nextAction,
      system_flag: p.system_flag || "",
      is_abnormal: ["LOW", "HIGH"].includes(p.system_flag) || ["Above target", "Below target"].includes(tgtStatus),
      sparkline,
    };
    const uSfx = unit ? ` ${unit}` : "";
    row.patient_summary_line = unitsDiffer
      ? `Your ${label} was measured in different units across reports and was not compared directly. Discuss this with your doctor.`
      : prevPt == null
        ? `Your current ${label} is ${fmtNum(row.current)}${uSfx}${tgtStatus ? ` (${tgtStatus.toLowerCase()})` : ""}. Next step: ${nextAction.toLowerCase()}.`
        : `Your ${label} moved from ${fmtNum(row.previous)}${uSfx} to ${fmtNum(row.current)}${uSfx} (${changeDisplay}).${tgtStatus ? ` It is ${tgtStatus.toLowerCase()}` : ""}${row.target_display !== "\u2014" ? ` (target ${row.target_display})` : ""}${changeStatus ? ` and showed ${changeStatus.toLowerCase()}` : ""}. Next step: ${nextAction}.`;
    rows.push(row);
  }
  return rows;
}

export function selectJourneyTemplateInStore(rules, detected, retestPlan = null) {
  const jt = rules?.journey_templates?.data || rules?.journey_templates || DEFAULT_JOURNEY_TEMPLATES;
  const selRules = jt.selection_rules || DEFAULT_JOURNEY_TEMPLATES.selection_rules;
  const main = retestPlan?.primary_finding?.finding_code || detected?.[0] || null;
  for (const r of selRules) {
    if (r.when && typeof r.when === "object" && r.when.main_finding && r.when.main_finding === main) return r.template || "STANDARD_92";
    if (r.when === "default") return r.template || "STANDARD_92";
  }
  return main === "HIGH_HBA1C" ? "HBA1C_90" : "STANDARD_92";
}

export function buildJourneyInStore(store, patientId, reportId, followup, paramsByReport, today = todayIstStr()) {
  const report = (store.reports || []).find((r) => r.id === reportId);
  if (!report) return null;
  const fu = followup || (store.followups || []).find((f) => f.report_id === reportId) || null;
  const rules = store.rules || {};
  const patient = (store.patients || []).find((p) => p.id === patientId);
  const params = paramsByReport[reportId] || [];
  let detected = [...(fu?.finding_codes || [])];
  if (!detected.length && patient) {
    const ctx = buildProgramContext({
      patient, report, params, buckets: fu?.buckets || [],
      profile: (store.health_profiles || {})[patientId] || {},
      activeMeds: (store.patient_medications || []).filter((m) => m.patient_id === patientId && !m.stopped_on),
      medCatalogue: rules.medicine_catalogue?.data || rules.medicine_catalogue || [],
    });
    detected = detectFindingsInCtx(ctx, rules.diagnostic_findings?.data || rules.diagnostic_findings || DEFAULT_DIAGNOSTIC_FINDINGS);
  }
  if (!detected.length && !params.some((p) => p.param_code === "HBA1C" && p.system_flag === "HIGH")) return null;

  const plan = fu?.retest_plan || {};
  const templateCode = selectJourneyTemplateInStore(rules, detected, plan);
  const jt = rules?.journey_templates?.data || rules?.journey_templates || DEFAULT_JOURNEY_TEMPLATES;
  const tDef = (jt.templates || DEFAULT_JOURNEY_TEMPLATES.templates)[templateCode];
  if (!tDef) return null;

  const anchor = toIstDateStr(report.collected_on || report.reported_on);
  const daysElapsed = Math.max(Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86400000), 0);
  const a1cCur = params.find((p) => p.param_code === "HBA1C" && p.value_num != null);
  const initialHba1c = a1cCur ? Number(a1cCur.value_num) : null;

  const docDone = Boolean(fu && (
    ["DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED"].includes(fu.stage) ||
    (store.workflows?.[fu.id]?.calls || []).some((c) => c.outcome === "DOCTOR_DONE")
  ));
  const rawProtos = rules.retest_protocols?.data || rules.retest_protocols || DEFAULT_RETEST_PROTOCOLS;
  const hba1cProto = rawProtos.find((p) => p?.finding_code === "HIGH_HBA1C") || {};
  const protoReqInd = Boolean(hba1cProto.requires_indication);
  const rawConf = plan.day90_clinically_appropriate ?? null;

  const gluRows = (store.home_readings || [])
    .filter((r) => r.patient_id === patientId && String(r.kind || "").startsWith("GLUCOSE"))
    .sort((a, b) => String(b.taken_at || "").localeCompare(String(a.taken_at || "")) || b.id - a.id);
  const homeDev = gluRows.filter((r) => r.source !== "MANUAL_STAFF");
  const gluSource = !gluRows.length ? "none" : (homeDev.length ? "home_readings" : "staff_entered");
  const gluVals = [...gluRows].reverse().map((r) => Number(r.values?.value)).filter((v) => !Number.isNaN(v));
  const gluDir = gluVals.length < 2 ? null : (Math.abs(gluVals[gluVals.length - 1] - gluVals[gluVals.length - 2]) < 1 ? "STABLE" : gluVals[gluVals.length - 1] > gluVals[gluVals.length - 2] ? "UP" : "DOWN");
  const gluInfo = {
    source: gluSource, points_count: gluVals.length, direction: gluDir,
    latest: gluRows[0] ? { value: gluRows[0].values?.value, unit: "mg/dL", kind: gluRows[0].kind, source: gluRows[0].source, taken_at: String(gluRows[0].taken_at || "").slice(0, 10) } : null,
  };

  const calls = fu ? (store.workflows?.[fu.id]?.calls || []).filter((c) => c.outcome !== "DOCTOR_DONE") : [];
  const refillTps = (store.care_touchpoints || []).filter((t) => t.patient_id === patientId && t.service_code === "PHARMACY_REFILL");
  const refills = (store.refill_schedules || []).filter((r) => r.patient_id === patientId);
  const doneRefills = refillTps.length + (refillTps.length ? 0 : refills.filter((r) => r.task_status === "DONE").length);
  const adherence = {
    status: (doneRefills > 0 || calls.some((c) => ["BOOKED", "CONTACTED"].includes(c.outcome))) ? "ON_TRACK" : (calls.length || refills.some((r) => r.status === "ACTIVE") ? "PENDING_CONFIRMATION" : "NO_DATA"),
    calls_logged: calls.length, call_outcomes: calls.map((c) => c.outcome), refill_confirmations: doneRefills,
    active_refills: refills.filter((r) => r.status === "ACTIVE").length,
  };

  const recs = fu ? (store.retest_recommendations || []).filter((r) => r.followup_id === fu.id) : [];
  const hasRetestRec = recs.some((r) => !r.test_codes?.length || r.test_codes.includes("HBA1C"));
  const laterRep = (store.reports || [])
    .filter((r) => r.patient_id === patientId && r.status === "READY" && r.id !== reportId && ((r.collected_on || "") >= (report.collected_on || "")))
    .sort((a, b) => String(a.collected_on || "").localeCompare(String(b.collected_on || "")) || a.id - b.id)
    .find((r) => (paramsByReport[r.id] || []).some((p) => p.param_code === "HBA1C" && p.value_num != null));
  const laterA1c = laterRep ? (paramsByReport[laterRep.id] || []).find((p) => p.param_code === "HBA1C" && p.value_num != null) : null;

  const steps = (tDef.steps || []).map((s) => {
    const df = Number(s.day_from || 0);
    const dt = Number(s.day_to ?? df);
    let st = "PENDING";
    if (templateCode === "HBA1C_90") {
      if (s.code === "HBA1C_D0") st = "DONE";
      else if (s.code === "HBA1C_D1_7") st = (docDone || rawConf === true) ? "DONE" : (daysElapsed >= 1 ? "DUE" : "PENDING");
      else if (s.code === "HBA1C_D7_30") st = gluVals.length > 0 ? "DONE" : (daysElapsed >= 7 ? "DUE" : "PENDING");
      else if (s.code === "HBA1C_D30_60") st = ((adherence.calls_logged > 0 || doneRefills > 0) && daysElapsed > 60) ? "DONE" : (daysElapsed >= 30 ? "DUE" : "PENDING");
      else if (s.code === "HBA1C_D90") {
        if (laterA1c) st = "DONE";
        else if (rawConf === false || (protoReqInd && rawConf !== true)) st = "AWAITING_CONFIRMATION";
        else if (recs.some((r) => r.ordered) || (hasRetestRec && daysElapsed >= 90)) st = "DUE";
      }
    } else {
      st = df === 0 ? "DONE" : (daysElapsed >= df ? "DUE" : "PENDING");
    }
    return {
      code: s.code, window_label: s.window_label, day_from: df, day_to: dt,
      date_from: addDaysIso(anchor, df), date_to: addDaysIso(anchor, dt),
      what_happens: s.what_happens, owner: s.owner, caller_label: s.caller_label, status: st,
      ...(s.disclaimer ? { disclaimer: s.disclaimer } : {}),
    };
  });

  return {
    template_code: templateCode, name: tDef.name || templateCode, patient_id: patientId, report_id: reportId,
    followup_id: fu?.id ?? null, anchor_date: anchor, initial_hba1c: initialHba1c,
    new_hba1c: laterA1c ? Number(laterA1c.value_num) : null,
    new_hba1c_date: laterRep ? toIstDateStr(laterRep.collected_on || laterRep.reported_on) : null,
    day90_clinically_appropriate: rawConf !== null ? Boolean(rawConf) : !protoReqInd,
    day90_doctor_confirmed: rawConf, day90_retest_created: hasRetestRec,
    glucose_monitoring: gluInfo, adherence, disclaimer: CLINICAL_DISCLAIMER, steps,
  };
}

export function confirmDay90InStore(store, followup, clinicallyAppropriate, doctorId, paramsByReport) {
  followup.retest_plan = {
    ...(followup.retest_plan || {}),
    day90_clinically_appropriate: Boolean(clinicallyAppropriate),
    day90_confirmed_by: doctorId,
    day90_confirmed_at: new Date().toISOString(),
  };
  if (!store.retest_recommendations) store.retest_recommendations = [];
  if (clinicallyAppropriate) {
    if (!store.retest_recommendations.some((r) => r.followup_id === followup.id)) {
      const nextRecId = store.retest_recommendations.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
      store.retest_recommendations.push({ id: nextRecId, followup_id: followup.id, doctor_id: doctorId, test_codes: ["HBA1C"], ordered: false, source: "DOCTOR" });
    }
  } else {
    store.retest_recommendations = store.retest_recommendations.filter((r) => !(r.followup_id === followup.id && r.source === "PROTOCOL" && !r.ordered));
  }
  const rep = (store.reports || []).find((r) => r.id === followup.report_id) || null;
  planRetestInStore(store, followup, { report: rep, params: rep ? (paramsByReport[rep.id] || []) : [] });
  return buildJourneyInStore(store, followup.patient_id, followup.report_id, followup, paramsByReport);
}
