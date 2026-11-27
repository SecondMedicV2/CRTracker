// Page 8: AMI Automated Follow-up Journey (Day 0 -> Day 92), Scheduler & Messaging Layer (Worker Parity)
import { DONE_STAGES, addDaysIso, todayIstStr } from "./programs.js";
import { toIstDateStr } from "./retest.js";
import { DEFAULT_JOURNEY_TEMPLATES, hasComparisonInStore } from "./compare.js";

export const ADHERENCE_CODES = new Set(["TAKING", "MISSED", "STOPPED"]);
export const SYMPTOM_CODES = new Set(["BETTER", "SAME", "WORSE"]);

export const DEFAULT_MESSAGE_TEMPLATES = {
  note: "starter value, clinician to confirm",
  templates: {
    D75_RETEST_NOTICE: {
      en: "Hello from SecondMedic. Your scheduled follow-up test window is coming up. Please reach us at {callback_number} to arrange your visit.",
      hi: "सेकंडमेडिक की ओर से नमस्कार। आपकी अनुवर्ती जांच का समय निकट है। अपॉइंटमेंट के लिए कृपया {callback_number} पर संपर्क करें।",
    },
    D30_CHECKIN: {
      en: "Hello from SecondMedic. A routine follow-up check-in is due for your care plan. Please call {callback_number} if you need support.",
      hi: "सेकंडमेडिक की ओर से नमस्कार। आपकी देखभाल योजना के लिए नियमित फॉलो-अप कॉल देय है। सहायता के लिए {callback_number} पर कॉल करें।",
    },
    D60_CHECKIN: {
      en: "Hello from SecondMedic. Your scheduled progress check-in is due. Our care team can assist you at {callback_number}.",
      hi: "सेकंडमेडिक की ओर से नमस्कार। आपकी नियमित प्रगति समीक्षा देय है। हमारी टीम {callback_number} पर आपकी सहायता के लिए उपलब्ध है।",
    },
    D92_FOLLOWUP: {
      en: "Hello from SecondMedic. Your clinician follow-up plan check-in is ready. Reach us at {callback_number} to schedule.",
      hi: "सेकंडमेडिक की ओर से नमस्कार। आपकी अनुवर्ती योजना समीक्षा तैयार है। समय तय करने के लिए {callback_number} पर संपर्क करें।",
    },
  },
};

const TEST_PARAM_GROUPS = {
  HBA1C: new Set(["HBA1C"]),
  FBS: new Set(["GLUCOSE_FASTING", "FBS"]),
  PPBS: new Set(["GLUCOSE_PP", "PPBS"]),
  LIPID: new Set(["CHOL_TOTAL", "LDL", "HDL", "TRIGLYCERIDES"]),
  THYROID: new Set(["TSH", "FT3", "FT4"]),
  TSH: new Set(["TSH"]),
  FT4: new Set(["FT4"]),
  CBC: new Set(["HEMOGLOBIN", "HB", "WBC", "PLATELETS"]),
  IRON: new Set(["FERRITIN", "IRON", "TIBC"]),
  VITD: new Set(["VITAMIN_D", "VIT_D"]),
  CALCIUM: new Set(["CALCIUM"]),
  B12: new Set(["B12", "VITAMIN_B12"]),
  KFT: new Set(["CREATININE", "UREA", "EGFR", "URIC_ACID"]),
  EGFR: new Set(["EGFR"]),
  LFT: new Set(["SGOT", "SGPT", "ALP", "BILIRUBIN"]),
};

function _nid(list) {
  return (list || []).reduce((m, x) => Math.max(m, Number(x?.id) || 0), 0) + 1;
}

function _istHour(nowIso) {
  const ms = nowIso ? Date.parse(nowIso) : Date.now();
  const istMs = (Number.isFinite(ms) ? ms : Date.now()) + 19800000;
  return new Date(istMs).getUTCHours();
}

function _today(nowIso) {
  return nowIso ? toIstDateStr(nowIso) : todayIstStr();
}

function _stdSteps(store) {
  const jt = store?.rules?.journey_templates?.data || store?.rules?.journey_templates || DEFAULT_JOURNEY_TEMPLATES;
  const tpl = (jt.templates || DEFAULT_JOURNEY_TEMPLATES.templates).STANDARD_92 || DEFAULT_JOURNEY_TEMPLATES.templates.STANDARD_92;
  return tpl.steps || [];
}

function _condGroup(fu) {
  const buckets = [...new Set((fu.buckets || []).filter((b) => b && b !== "OTHER"))].sort();
  return buckets.length ? buckets[0] : "GENERAL";
}

function _notifyRole(store, role, text, link, urgent = false) {
  if (!store.notifications) store.notifications = { unread: 0, items: [] };
  store.notifications.unread = (store.notifications.unread || 0) + 1;
  store.notifications.items.unshift({
    id: _nid(store.notifications.items),
    text: String(text || "").slice(0, 200),
    link,
    target_role: role,
    urgent: Boolean(urgent),
    read: false,
    at: new Date().toISOString(),
  });
}

function _stepDueDates(store, fu, startedOn) {
  const stepDefs = _stdSteps(store);
  const rec = store.recommendations?.[fu.id] || null;
  const hasProgs = (store.program_recommendations || []).some((p) => p.followup_id === fu.id);
  const hasRecs = Boolean(hasProgs || rec);
  const winStart = (rec?.window_start ? String(rec.window_start).slice(0, 10) : null) || (fu.retest_window_start ? String(fu.retest_window_start).slice(0, 10) : null);
  const reminderOn = fu.reminder_on ? String(fu.reminder_on).slice(0, 10) : null;

  const waiting = new Set();
  if (!hasRecs) {
    waiting.add("D1_RECOMMEND");
    waiting.add("D7_ACTIVATION");
  }
  if (!winStart) {
    waiting.add("D75_RETEST_NOTICE");
    waiting.add("D90_RETEST");
  }

  const d90Due = winStart || (fu.due_on ? String(fu.due_on).slice(0, 10) : addDaysIso(startedOn, 90));
  const candD75 = winStart ? addDaysIso(winStart, -15) : addDaysIso(d90Due, -15);
  const d75Due = reminderOn || (candD75 < startedOn ? startedOn : candD75);

  const dueMap = {};
  for (const s of stepDefs) {
    const code = s.code;
    const offset = Number(s.day_offset ?? s.day_from ?? 0);
    if (code === "D75_RETEST_NOTICE") dueMap[code] = d75Due;
    else if (code === "D90_RETEST") dueMap[code] = d90Due;
    else if (code === "D91_COMPARE") dueMap[code] = winStart ? addDaysIso(d90Due, 1) : addDaysIso(startedOn, offset);
    else if (code === "D92_UPDATE_PLAN") dueMap[code] = winStart ? addDaysIso(d90Due, 2) : addDaysIso(startedOn, offset);
    else dueMap[code] = addDaysIso(startedOn, offset);
  }
  return { dueMap, waiting };
}

export function sendPatientMessageInStore(store, patientId, templateCode, { followupId = null, journeyStepId = null, now = null } = {}) {
  if (!store.outbound_messages) store.outbound_messages = [];
  const pat = (store.patients || []).find((p) => p.id === patientId);
  if (!pat) return null;
  const tsIso = now || new Date().toISOString();
  const today = _today(tsIso);

  if (journeyStepId != null) {
    const sentPrev = store.outbound_messages.find((m) => m.journey_step_id === journeyStepId && (m.status === "SENT" || m.status === "CALL_TASK_CREATED"));
    if (sentPrev) return sentPrev;
  }

  const waEnabled = Boolean(store.settings?.whatsapp_enabled);
  const channel = waEnabled ? "WHATSAPP" : "CALL_TASK";
  const lang = String(pat.language || store.settings?.default_language || "en").toLowerCase().startsWith("hi") ? "hi" : "en";

  const blocked = (statusCode, errorMsg) => {
    if (journeyStepId != null) {
      const ex = store.outbound_messages.find(
        (m) => m.journey_step_id === journeyStepId && m.status === statusCode && toIstDateStr(m.created_at) === today
      );
      if (ex) return ex;
    }
    const msg = {
      id: _nid(store.outbound_messages),
      patient_id: pat.id,
      patient_name: pat.name || "Patient",
      followup_id: followupId,
      journey_step_id: journeyStepId,
      template_code: templateCode,
      language: lang,
      channel,
      status: statusCode,
      sent_at: null,
      provider_ref: "",
      error: errorMsg,
      created_at: tsIso,
    };
    store.outbound_messages.unshift(msg);
    return msg;
  };

  if (pat.do_not_call) return blocked("BLOCKED_DNC", "Patient requested do not call");

  const hasConsent = Boolean(
    (followupId != null && store.consents?.[followupId])
    || Object.values(store.consents || {}).some((c) => c && (c.patient_id === pat.id || c.followup_id === followupId))
    || (store.followups || []).some((f) => f.patient_id === pat.id && store.consents?.[f.id])
  );
  if (!hasConsent) return blocked("BLOCKED_NO_CONSENT", "No recorded consent for messaging");

  const hr = _istHour(tsIso);
  if (hr < 9 || hr >= 20) return blocked("BLOCKED_QUIET_HOURS", "Outside 09:00-20:00 IST messaging window");

  const msg = {
    id: _nid(store.outbound_messages),
    patient_id: pat.id,
    patient_name: pat.name || "Patient",
    followup_id: followupId,
    journey_step_id: journeyStepId,
    template_code: templateCode,
    language: lang,
    channel,
    status: waEnabled ? "SENT" : "CALL_TASK_CREATED",
    sent_at: tsIso,
    provider_ref: waEnabled ? `wa-stub:${pat.id}:${journeyStepId || templateCode}` : `call_task:${pat.id}:${journeyStepId || templateCode}`,
    error: "",
    created_at: tsIso,
  };
  store.outbound_messages.unshift(msg);
  if (!waEnabled) {
    _notifyRole(store, "CALLER", "Follow-up reminder call due", followupId ? `/caller-card/view?id=${followupId}` : "/followups", false);
  }
  return msg;
}

export function startOrSyncJourneyInStore(store, fu, { paramsByReport = {}, now = null } = {}) {
  if (!fu || !fu.patient_id) return null;
  if (!store.care_journeys) store.care_journeys = [];
  const rep = (store.reports || []).find((r) => r.id === fu.report_id);
  if (!rep || rep.classification !== "ABNORMAL") return null;
  if (fu.suppressed_reason) return store.care_journeys.find((j) => j.followup_id === fu.id) || null;

  const startedOn = toIstDateStr(rep.collected_on || rep.reported_on || todayIstStr());
  const cgroup = _condGroup(fu);
  const stepDefs = _stdSteps(store);
  const { dueMap, waiting } = _stepDueDates(store, fu, startedOn);
  const tplVer = store.rules?.journey_templates?.version || 1;
  let j = store.care_journeys.find((x) => x.followup_id === fu.id);

  if (!j) {
    j = {
      id: _nid(store.care_journeys),
      patient_id: fu.patient_id,
      followup_id: fu.id,
      condition_group: cgroup,
      template_code: "STANDARD_92",
      template_version: tplVer,
      started_on: startedOn,
      status: "ACTIVE",
      stop_reason: "",
      steps: stepDefs.map((s, idx) => ({
        id: idx + 1,
        step_order: idx,
        step_code: s.code,
        due_on: dueMap[s.code],
        status: "PENDING",
        completed_on: null,
        completed_by: null,
        completion_event: "",
        task_ref: "",
        waiting_for_data: waiting.has(s.code),
      })),
    };
    store.care_journeys.push(j);

    for (const old of store.care_journeys) {
      if (old.id !== j.id && old.patient_id === fu.patient_id && old.condition_group === cgroup && old.status === "ACTIVE") {
        old.status = "STOPPED";
        old.stop_reason = "superseded";
        for (const st of old.steps || []) {
          if (st.status !== "DONE" && st.status !== "SKIPPED") {
            st.status = "SKIPPED";
            st.completion_event = "superseded";
          }
        }
      }
    }
  } else {
    for (const s of stepDefs) {
      const st = (j.steps || []).find((x) => x.step_code === s.code);
      if (st && st.status !== "DONE" && st.status !== "SKIPPED") {
        st.due_on = dueMap[s.code];
        st.waiting_for_data = waiting.has(s.code);
      }
    }
  }
  syncJourneyEventsInStore(store, { followupId: fu.id, paramsByReport, now });
  return j;
}

function _doneStep(st, event, today, { userId = null, status = "DONE" } = {}) {
  if (!st || st.status === "DONE" || st.status === "SKIPPED") return;
  st.status = status;
  st.completed_on = today;
  st.completed_by = userId;
  st.completion_event = event;
  st.waiting_for_data = false;
}

export function syncJourneyEventsInStore(store, { patientId = null, followupId = null, paramsByReport = {}, now = null } = {}) {
  if (!store.care_journeys) return 0;
  const today = _today(now);
  let updated = 0;

  for (const j of store.care_journeys) {
    if (j.status !== "ACTIVE") continue;
    if (followupId != null && j.followup_id !== followupId) continue;
    if (followupId == null && patientId != null && j.patient_id !== patientId) continue;

    const fu = (store.followups || []).find((f) => f.id === j.followup_id);
    if (!fu) continue;
    const rep = (store.reports || []).find((r) => r.id === fu.report_id);
    const steps = Object.fromEntries((j.steps || []).map((s) => [s.step_code, s]));
    const rec = store.recommendations?.[fu.id] || null;
    const progs = (store.program_recommendations || []).filter((p) => p.followup_id === fu.id);
    const calls = (store.workflows?.[fu.id]?.calls || []).slice().reverse();

    if (rep && rep.status === "READY" && rep.classification) {
      _doneStep(steps.D0_ANALYSED, "report_ready_analysed", j.started_on);
      updated += 1;
    }
    const recsGenerated = Boolean(progs.length || rec || (fu.finding_codes || []).length);
    const consultDone = ["DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED"].includes(fu.stage) || calls.some((c) => c.outcome === "DOCTOR_DONE");
    if (recsGenerated && consultDone) {
      _doneStep(steps.D1_RECOMMEND, "consultation_and_recommendations_done", today);
      updated += 1;
    }
    if (steps.D7_ACTIVATION) {
      if (progs.some((p) => p.status === "ACCEPTED" || p.status === "ENROLLED") || rec?.bundle_code) {
        _doneStep(steps.D7_ACTIVATION, "program_activated", today);
        updated += 1;
      } else if (progs.length > 0 && progs.every((p) => p.status === "DECLINED" || p.status === "EXPIRED")) {
        _doneStep(steps.D7_ACTIVATION, "nothing_accepted", today, { status: "SKIPPED" });
        updated += 1;
      }
    }

    const coded = calls.filter((c) => c.adherence_code || c.symptom_code);
    if (steps.D30_ADHERENCE && coded.length) {
      const m30 = coded.find((c) => (c.notes || "").includes("step:D30_ADHERENCE") || toIstDateStr(c.started_at || c.at) >= steps.D30_ADHERENCE.due_on) || coded[0];
      _doneStep(steps.D30_ADHERENCE, `checkin:${m30.adherence_code || "-"}:${m30.symptom_code || "-"}`, toIstDateStr(m30.started_at || m30.at) || today);
      updated += 1;
    }
    if (steps.D60_PROGRESS && coded.length) {
      const m60 = coded.find((c) => (c.notes || "").includes("step:D60_PROGRESS")) || coded.find((c) => toIstDateStr(c.started_at || c.at) >= steps.D60_PROGRESS.due_on) || (coded.length >= 2 ? coded[coded.length - 1] : null);
      if (m60) {
        _doneStep(steps.D60_PROGRESS, `checkin:${m60.adherence_code || "-"}:${m60.symptom_code || "-"}`, toIstDateStr(m60.started_at || m60.at) || today);
        updated += 1;
      }
    }

    if (steps.D75_RETEST_NOTICE) {
      const sentMsg = (store.outbound_messages || []).some(
        (m) => m.journey_step_id === steps.D75_RETEST_NOTICE.id && (m.status === "SENT" || m.status === "CALL_TASK_CREATED")
      );
      if (
        sentMsg
        || fu.reminder_sent_at
        || calls.some(
          (c) =>
            c.outcome !== "DOCTOR_DONE"
            && !(c.notes || "").startsWith("step:D30")
            && !(c.notes || "").startsWith("step:D60")
            && toIstDateStr(c.started_at || c.at) >= steps.D75_RETEST_NOTICE.due_on
        )
      ) {
        _doneStep(steps.D75_RETEST_NOTICE, "retest_reminder_delivered", today);
        updated += 1;
      }
    }

    const retestCodes = rec?.test_codes || [];
    const expectedParams = new Set(retestCodes.flatMap((c) => [...(TEST_PARAM_GROUPS[c] || [c])]));
    const laterReports = (store.reports || [])
      .filter((r) => r.patient_id === j.patient_id && r.status === "READY" && r.id !== fu.report_id && toIstDateStr(r.collected_on || r.reported_on) > j.started_on)
      .sort((a, b) => String(a.collected_on || "").localeCompare(String(b.collected_on || "")) || a.id - b.id);
    const matchingLater = laterReports.find((r) => {
      const plist = paramsByReport[r.id] || [];
      if (!expectedParams.size) return plist.length > 0;
      return plist.some((p) => expectedParams.has(p.param_code));
    }) || null;

    if (steps.D90_RETEST) {
      if (rec?.booking_status === "BOOKED" || rec?.booking_status === "COLLECTED" || rec?.ordered || rec?.comparison_report_id != null || matchingLater) {
        _doneStep(steps.D90_RETEST, "retest_booked_or_completed", today);
        updated += 1;
      }
    }
    const compRepId = rec?.comparison_report_id ?? (matchingLater && hasComparisonInStore(store, j.patient_id, matchingLater.id, paramsByReport) ? matchingLater.id : null);
    if (steps.D91_COMPARE && compRepId != null) {
      _doneStep(steps.D91_COMPARE, "longitudinal_comparison_ready", today);
      updated += 1;
    }
    if (steps.D92_UPDATE_PLAN && steps.D91_COMPARE?.status === "DONE") {
      const compOn = steps.D91_COMPARE.completed_on || today;
      const updatedPlan = Boolean(
        (fu.next_followup_on && fu.next_followup_on > compOn)
        || calls.some((c) => c.outcome === "DOCTOR_DONE" && toIstDateStr(c.started_at || c.at) >= compOn)
      );
      if (updatedPlan) {
        _doneStep(steps.D92_UPDATE_PLAN, "care_plan_updated", today);
        j.status = "COMPLETED";
        updated += 1;
      }
    }
  }
  return updated;
}

export function recordCheckinInStore(store, fu, { stepCode = "", adherenceCode = "", symptomCode = "", userId, role, now = null } = {}) {
  const adh = String(adherenceCode || "").trim().toUpperCase();
  const sym = String(symptomCode || "").trim().toUpperCase();
  if (adh && !ADHERENCE_CODES.has(adh)) {
    const e = new Error("Invalid adherence_code");
    e.status = 422;
    throw e;
  }
  if (sym && !SYMPTOM_CODES.has(sym)) {
    const e = new Error("Invalid symptom_code");
    e.status = 422;
    throw e;
  }
  if (!adh && !sym) {
    const e = new Error("adherence_code or symptom_code is required");
    e.status = 422;
    throw e;
  }
  const sc = String(stepCode || "").trim().toUpperCase();
  if (sc && sc !== "D30_ADHERENCE" && sc !== "D60_PROGRESS") {
    const e = new Error("step_code must be D30_ADHERENCE or D60_PROGRESS");
    e.status = 422;
    throw e;
  }
  const tsIso = now || new Date().toISOString();
  if (!store.workflows) store.workflows = {};
  if (!store.workflows[fu.id]) store.workflows[fu.id] = { calls: [] };
  if (!store.workflows[fu.id].calls) store.workflows[fu.id].calls = [];
  store.workflows[fu.id].calls.unshift({
    outcome: DONE_STAGES.has(fu.stage) ? fu.stage : "CALL_LATER",
    role,
    user_id: userId,
    adherence_code: adh,
    symptom_code: sym,
    notes: sc ? `step:${sc}` : "",
    started_at: tsIso,
  });

  let taskId = null;
  if (adh === "STOPPED" || sym === "WORSE") {
    if (!store.clinical_tasks) store.clinical_tasks = [];
    let ex = store.clinical_tasks.find((t) => t.patient_id === fu.patient_id && t.followup_id === fu.id && t.task_type === "JOURNEY_ESCALATION" && t.status === "OPEN");
    if (!ex) {
      ex = {
        id: _nid(store.clinical_tasks),
        patient_id: fu.patient_id,
        followup_id: fu.id,
        condition_code: _condGroup(fu),
        task_type: "JOURNEY_ESCALATION",
        title: "Doctor review requested after patient check-in",
        details: `Codes: ${adh || "-"} / ${sym || "-"}`,
        selected_tests: [],
        status: "OPEN",
        assigned_doctor_id: fu.assigned_doctor_id || null,
        created_at: tsIso,
      };
      store.clinical_tasks.push(ex);
      _notifyRole(store, "DOCTOR", "Patient check-in flagged clinical review", `/followups/view?id=${fu.id}`, true);
    }
    taskId = ex.id;
  }
  const j = startOrSyncJourneyInStore(store, fu, { now: tsIso });
  return {
    followup_id: fu.id,
    adherence_code: adh,
    symptom_code: sym,
    clinical_task_id: taskId,
    journey: j ? journeyOutInStore(store, j, { role }) : null,
  };
}

export function schedulerTickInStore(store, { now = null } = {}) {
  const tsIso = now || new Date().toISOString();
  const today = _today(tsIso);
  if (!store.care_journeys) store.care_journeys = [];
  for (const fu of store.followups || []) {
    if (!fu.suppressed_reason && !store.care_journeys.some((j) => j.followup_id === fu.id)) {
      startOrSyncJourneyInStore(store, fu, { now: tsIso });
    }
  }
  syncJourneyEventsInStore(store, { now: tsIso });

  const sMap = Object.fromEntries(_stdSteps(store).map((s) => [s.code, s]));
  let due = 0;
  let overdue = 0;
  let tasks = 0;
  let messages = 0;

  for (const j of store.care_journeys) {
    if (j.status !== "ACTIVE") continue;
    for (const st of j.steps || []) {
      if (st.status === "DONE" || st.status === "SKIPPED") continue;
      if (today > st.due_on) {
        if (st.status !== "OVERDUE") {
          st.status = "OVERDUE";
          overdue += 1;
        }
      } else if (today === st.due_on) {
        if (st.status !== "DUE") {
          st.status = "DUE";
          due += 1;
        }
      } else {
        continue;
      }

      const sd = sMap[st.step_code] || {};
      const owner = sd.owner || "SYSTEM";
      const channel = sd.channel || "AUTO";
      if (channel === "PATIENT_MESSAGE" && !st.task_ref) {
        const tplCode = st.step_code === "D75_RETEST_NOTICE" ? "D75_RETEST_NOTICE" : "D30_CHECKIN";
        const msg = sendPatientMessageInStore(store, j.patient_id, tplCode, { followupId: j.followup_id, journeyStepId: st.id, now: tsIso });
        messages += 1;
        if (msg && (msg.status === "SENT" || msg.status === "CALL_TASK_CREATED")) {
          st.task_ref = `msg:${msg.id}`;
          tasks += 1;
          syncJourneyEventsInStore(store, { followupId: j.followup_id, now: tsIso });
        }
      } else if (!st.task_ref && (channel === "CALL" || channel === "TASK")) {
        if (owner === "CALLER" || owner === "COORDINATOR") {
          _notifyRole(store, "CALLER", sd.caller_label || "Follow-up task due", j.followup_id ? `/caller-card/view?id=${j.followup_id}` : "/followups", false);
          st.task_ref = `caller_task:${j.id}:${st.step_code}`;
          tasks += 1;
        } else if (owner === "DOCTOR" || owner === "DIETITIAN") {
          _notifyRole(store, "DOCTOR", sd.clinical_label || st.step_code, j.followup_id ? `/followups/view?id=${j.followup_id}` : `/patients/view?id=${j.patient_id}`, false);
          st.task_ref = `doc_notif:${j.id}:${st.step_code}`;
          tasks += 1;
        }
      }
    }
  }
  return { due, overdue, tasks, messages };
}

export function journeyOutInStore(store, j, { role = "DOCTOR" } = {}) {
  if (!j) return null;
  const sMap = Object.fromEntries(_stdSteps(store).map((s) => [s.code, s]));
  const isCaller = role === "CALLER";
  const steps = (j.steps || []).map((st) => {
    const sd = sMap[st.step_code] || {};
    if (isCaller) {
      return {
        id: st.id,
        step_code: st.step_code,
        window_label: sd.window_label || st.step_code,
        day_offset: sd.day_offset ?? 0,
        due_on: st.due_on,
        status: st.status,
        completed_on: st.completed_on || null,
        caller_label: sd.caller_label || "Follow-up step",
        waiting_for_data: Boolean(st.waiting_for_data),
      };
    }
    return {
      id: st.id,
      step_code: st.step_code,
      window_label: sd.window_label || st.step_code,
      day_offset: sd.day_offset ?? 0,
      ami_action: sd.ami_action || sd.what_happens || "",
      service: sd.service || "",
      clinical_label: sd.clinical_label || "",
      caller_label: sd.caller_label || "",
      owner: sd.owner || "",
      channel: sd.channel || "",
      due_on: st.due_on,
      status: st.status,
      completed_on: st.completed_on || null,
      completed_by: st.completed_by ?? null,
      completion_event: st.completion_event || "",
      task_ref: st.task_ref || "",
      waiting_for_data: Boolean(st.waiting_for_data),
    };
  });

  if (isCaller) {
    return { id: j.id, followup_id: j.followup_id, started_on: j.started_on, status: j.status, label: "Follow-up journey", steps };
  }
  return {
    id: j.id,
    patient_id: j.patient_id,
    followup_id: j.followup_id,
    condition_group: j.condition_group,
    template_code: j.template_code,
    template_version: j.template_version,
    started_on: j.started_on,
    status: j.status,
    stop_reason: j.stop_reason || "",
    steps,
  };
}

export function dashboardJourneysInStore(store) {
  const stepDefs = _stdSteps(store);
  const allJ = store.care_journeys || [];
  const activeIds = new Set(allJ.filter((j) => j.status === "ACTIVE").map((j) => j.id));
  const overdueByStep = [];
  const funnel = [];
  for (const sd of stepDefs) {
    let ov = 0;
    let doneN = 0;
    for (const j of allJ) {
      const st = (j.steps || []).find((x) => x.step_code === sd.code);
      if (st) {
        if (activeIds.has(j.id) && st.status === "OVERDUE") ov += 1;
        if (st.status === "DONE") doneN += 1;
      }
    }
    overdueByStep.push({ step_code: sd.code, window_label: sd.window_label || sd.code, count: ov });
    funnel.push({ step_code: sd.code, window_label: sd.window_label || sd.code, label: sd.ami_action || sd.code, count: doneN });
  }
  return {
    active: allJ.filter((j) => j.status === "ACTIVE").length,
    completed: allJ.filter((j) => j.status === "COMPLETED").length,
    stopped: allJ.filter((j) => j.status === "STOPPED").length,
    overdue_by_step: overdueByStep,
    funnel,
  };
}
