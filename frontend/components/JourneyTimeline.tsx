"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

const STEP_ICONS: Record<string, string> = {
  D0_ANALYSED: "📋",
  D1_RECOMMEND: "🩺",
  D7_ACTIVATION: "💊",
  D30_ADHERENCE: "📞",
  D60_PROGRESS: "📈",
  D75_RETEST_NOTICE: "🔔",
  D90_RETEST: "🧪",
  D91_COMPARE: "📊",
  D92_UPDATE_PLAN: "✅",
};

const STATUS_CLS: Record<string, string> = {
  DONE: "border-emerald-300 bg-emerald-50/70 text-emerald-950",
  DUE: "border-amber-300 bg-amber-50/80 text-amber-950",
  OVERDUE: "border-rose-300 bg-rose-50/80 text-rose-950",
  SKIPPED: "border-slate-200 bg-slate-100/80 text-slate-600",
  PENDING: "border-slate-200 bg-white text-slate-800",
};

const fmtDate = (d?: string | null) =>
  d && !isNaN(Date.parse(d))
    ? new Date(`${String(d).slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
      })
    : "—";

function TimelineStrip({
  journey,
  isCaller,
  onCheckinSaved,
}: {
  journey: any;
  isCaller: boolean;
  onCheckinSaved?: () => void;
}) {
  const [stepCode, setStepCode] = useState("D30_ADHERENCE");
  const [adherence, setAdherence] = useState("");
  const [symptom, setSymptom] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function submitCheckin(e: React.FormEvent) {
    e.preventDefault();
    if (!journey.followup_id || (!adherence && !symptom)) return;
    setSaving(true);
    setMsg("");
    try {
      const res = await api<any>(`/followups/${journey.followup_id}/journey/checkin`, {
        method: "POST",
        body: {
          step_code: stepCode,
          adherence_code: adherence,
          symptom_code: symptom,
        },
      });
      setAdherence("");
      setSymptom("");
      setMsg(res.clinical_task_id ? "Check-in saved; doctor review task created." : "Check-in recorded.");
      onCheckinSaved?.();
    } catch (err: any) {
      setMsg(err.message || "Could not save check-in");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <h3 className="text-sm font-bold text-slate-900">
            {isCaller ? journey.label || "Follow-up journey" : `AMI Follow-up Journey (${journey.template_code || "STANDARD_92"})`}
          </h3>
          {!isCaller && journey.condition_group && (
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
              {journey.condition_group}
            </span>
          )}
          <span
            className={`rounded-full border px-2 py-0.5 font-semibold ${
              journey.status === "COMPLETED"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : journey.status === "STOPPED"
                  ? "border-slate-300 bg-slate-100 text-slate-700"
                  : "border-teal-300 bg-teal-50 text-teal-900"
            }`}
          >
            {journey.status}
            {journey.stop_reason ? ` (${journey.stop_reason})` : ""}
          </span>
        </div>
        <div className="text-xs text-slate-500">Started {fmtDate(journey.started_on)}</div>
      </div>

      <ol
        aria-label="Care journey timeline Day 0 to Day 92"
        className="flex flex-col gap-2 md:grid md:grid-cols-3 lg:grid-cols-9"
      >
        {(journey.steps || []).map((st: any) => {
          const cls = STATUS_CLS[st.status] || STATUS_CLS.PENDING;
          const hover = `Due: ${fmtDate(st.due_on)}${st.completed_on ? ` · Completed: ${fmtDate(st.completed_on)}` : ""}`;
          return (
            <li key={st.step_code} title={hover} className={`flex flex-col justify-between rounded-xl border p-2.5 text-xs ${cls}`}>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-bold text-slate-900">
                    {STEP_ICONS[st.step_code] || "•"} {st.window_label}
                  </span>
                  <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                    {st.status}
                  </span>
                </div>
                <div className="text-[11px] text-slate-600">
                  Due {fmtDate(st.due_on)}
                  {st.completed_on && <> · Done {fmtDate(st.completed_on)}</>}
                </div>
                {st.waiting_for_data && (
                  <div className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                    Waiting for data
                  </div>
                )}
              </div>

              {isCaller ? (
                <div className="mt-2 font-medium text-slate-900">{st.caller_label}</div>
              ) : (
                <div className="mt-2 space-y-1.5 border-t border-black/10 pt-1.5">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">AMI action</div>
                    <div className="leading-snug text-slate-900">{st.ami_action}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">SecondMedic service</div>
                    <div className="leading-snug font-medium text-teal-900">{st.service}</div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {journey.status === "ACTIVE" && journey.followup_id && (
        <form onSubmit={submitCheckin} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 text-xs">
          <label className="font-medium text-slate-700">
            Check-in step
            <select className="ml-1 rounded border border-slate-300 px-2 py-1" value={stepCode} onChange={(e) => setStepCode(e.target.value)}>
              <option value="D30_ADHERENCE">Day 30 Adherence</option>
              <option value="D60_PROGRESS">Day 60 Progress</option>
            </select>
          </label>
          <label className="font-medium text-slate-700">
            Adherence
            <select aria-label="Adherence code" className="ml-1 rounded border border-slate-300 px-2 py-1" value={adherence} onChange={(e) => setAdherence(e.target.value)}>
              <option value="">Select…</option>
              <option value="TAKING">TAKING</option>
              <option value="MISSED">MISSED</option>
              <option value="STOPPED">STOPPED</option>
            </select>
          </label>
          <label className="font-medium text-slate-700">
            Symptoms
            <select aria-label="Symptom code" className="ml-1 rounded border border-slate-300 px-2 py-1" value={symptom} onChange={(e) => setSymptom(e.target.value)}>
              <option value="">Select…</option>
              <option value="BETTER">BETTER</option>
              <option value="SAME">SAME</option>
              <option value="WORSE">WORSE</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={saving || (!adherence && !symptom)}
            className="rounded-lg bg-teal-800 px-3 py-1 font-semibold text-white hover:bg-teal-900 disabled:opacity-40"
          >
            Save check-in
          </button>
          {msg && <span role="status" className="font-medium text-teal-900">{msg}</span>}
        </form>
      )}
    </div>
  );
}

export default function JourneyTimeline({
  followupId,
  patientId,
  role,
  refreshKey = 0,
  onChanged,
}: {
  followupId?: string | number;
  patientId?: string | number;
  role?: string | null;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const [journeys, setJourneys] = useState<any[]>([]);
  const isCaller = role === "CALLER";

  const load = useCallback(() => {
    if (followupId) {
      api<any>(`/followups/${followupId}/journey`)
        .then((d) => setJourneys(d && d.id ? [d] : []))
        .catch(() => {});
    } else if (patientId && !isCaller) {
      api<any>(`/patients/${patientId}/journeys`)
        .then((d) => setJourneys(d?.journeys || []))
        .catch(() => {});
    }
  }, [followupId, patientId, isCaller]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!journeys.length) return null;

  return (
    <section aria-label="Patient follow-up journey" className="space-y-3">
      {journeys.map((j) => (
        <TimelineStrip
          key={j.id}
          journey={j}
          isCaller={isCaller}
          onCheckinSaved={() => {
            load();
            onChanged?.();
          }}
        />
      ))}
    </section>
  );
}
