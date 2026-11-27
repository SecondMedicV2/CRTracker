"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import TierBadge from "@/components/TierBadge";

const fmtDate = (d?: string | null) =>
  d && !isNaN(Date.parse(d))
    ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "\u2014";

const TIER_BADGE: Record<string, { label: string; colour: string }> = {
  URGENT: { label: "Urgent", colour: "red" },
  EARLY: { label: "Early follow-up", colour: "teal" },
  TREATMENT_RESPONSE: { label: "Treatment response", colour: "navy blue" },
  METABOLIC: { label: "Metabolic follow-up", colour: "amber" },
  LONG_TERM: { label: "Long-term monitoring", colour: "green" },
};

const FAMILY_SWITCH_OPTIONS: Record<string, { code: string; label: string }[]> = {
  PREDIABETES: [
    { code: "PREDIABETES", label: "Prediabetes" },
    { code: "DIABETES_STABLE", label: "Diabetes — Stable at goal" },
    { code: "DIABETES_UNCONTROLLED", label: "Diabetes — Uncontrolled" },
  ],
  DIABETES_STABLE: [
    { code: "PREDIABETES", label: "Prediabetes" },
    { code: "DIABETES_STABLE", label: "Diabetes — Stable at goal" },
    { code: "DIABETES_UNCONTROLLED", label: "Diabetes — Uncontrolled" },
  ],
  DIABETES_UNCONTROLLED: [
    { code: "PREDIABETES", label: "Prediabetes" },
    { code: "DIABETES_STABLE", label: "Diabetes — Stable at goal" },
    { code: "DIABETES_UNCONTROLLED", label: "Diabetes — Uncontrolled" },
  ],
  DYSLIPIDEMIA_NEW_MED: [
    { code: "DYSLIPIDEMIA_NEW_MED", label: "New medication (4–12w)" },
    { code: "DYSLIPIDEMIA_STABLE", label: "Stable dyslipidemia" },
  ],
  DYSLIPIDEMIA_STABLE: [
    { code: "DYSLIPIDEMIA_NEW_MED", label: "New medication (4–12w)" },
    { code: "DYSLIPIDEMIA_STABLE", label: "Stable dyslipidemia" },
  ],
};

function ConditionIcon({ icon, label }: { icon?: string; label?: string }) {
  const title = label || icon || "Condition";
  switch (icon) {
    case "red_cell_tick":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-label={title}>
          <circle cx="10" cy="12" r="7" fill="#fee2e2" stroke="#dc2626" strokeWidth="1.8" />
          <circle cx="10" cy="12" r="3" fill="#fca5a5" />
          <circle cx="18" cy="17" r="4.5" fill="#0f766e" />
          <path d="M16 17l1.3 1.3L20 15.5" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "blood_tube_fe":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-label={title}>
          <rect x="8" y="3" width="8" height="3" rx="1" fill="#dc2626" />
          <rect x="9" y="6" width="6" height="14" rx="3" fill="#fef2f2" stroke="#991b1b" strokeWidth="1.6" />
          <text x="12" y="15.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="#991b1b">Fe</text>
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-label={title}>
          <rect x="3" y="5" width="18" height="16" rx="2.5" fill="#f0fdfa" stroke="#0f766e" strokeWidth="1.7" />
          <path d="M3 10h18M8 3v4M16 3v4" stroke="#0f766e" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "clock_6_hba1c":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-label={title}>
          <circle cx="12" cy="12" r="9" fill="#ecfdf5" stroke="#047857" strokeWidth="1.8" />
          <text x="12" y="15" textAnchor="middle" fontSize="9" fontWeight="700" fill="#065f46">6</text>
        </svg>
      );
    case "clock_3_hba1c_alert":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-label={title}>
          <circle cx="11" cy="13" r="8" fill="#fffbeb" stroke="#d97706" strokeWidth="1.8" />
          <text x="11" y="16" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#92400e">3</text>
          <path d="M19 3l3 5h-6l3-5z" fill="#dc2626" />
        </svg>
      );
    case "thyroid":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-label={title}>
          <path d="M12 10c-2-4-7-3-7 2 0 4 4 6 7 3 3 3 7 1 7-3 0-5-5-6-7-2z" fill="#e0f2fe" stroke="#0369a1" strokeWidth="1.7" />
          <path d="M12 6v13" stroke="#0369a1" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "bp_monitor":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-label={title}>
          <rect x="4" y="4" width="16" height="12" rx="2" fill="#eff6ff" stroke="#1d4ed8" strokeWidth="1.7" />
          <path d="M7 10h2.5l1.5-2.5 2 5 1.5-2.5H17" fill="none" stroke="#dc2626" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 16v4h6v-4" fill="none" stroke="#1d4ed8" strokeWidth="1.6" />
        </svg>
      );
    case "kidney":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-label={title}>
          <path d="M9 5C6 5 4 7.5 4 11s2 8 5 8c2 0 3-1.5 3-3.5 0-1.5-1-2-1-3.5s1-2 1-3.5C12 6.5 11 5 9 5zm6 0c3 0 5 2.5 5 6s-2 8-5 8c-2 0-3-1.5-3-3.5 0-1.5 1-2 1-3.5s-1-2-1-3.5C12 6.5 13 5 15 5z" fill="#fce7f3" stroke="#be185d" strokeWidth="1.5" />
        </svg>
      );
    case "three_tubes":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-label={title}>
          <rect x="4" y="5" width="4" height="14" rx="2" fill="#e0e7ff" stroke="#3730a3" strokeWidth="1.5" />
          <rect x="10" y="5" width="4" height="14" rx="2" fill="#fef3c7" stroke="#92400e" strokeWidth="1.5" />
          <rect x="16" y="5" width="4" height="14" rx="2" fill="#dcfce7" stroke="#166534" strokeWidth="1.5" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-label={title}>
          <circle cx="12" cy="12" r="8.5" fill="#f1f5f9" stroke="#0f766e" strokeWidth="1.7" />
          <path d="M12 8v4l2.5 2" fill="none" stroke="#0f766e" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
  }
}

export default function ConditionsMonitoringCard({
  patientId,
  role,
  refreshKey = 0,
  onChanged,
}: {
  patientId: string;
  role: string | null;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const { data, error, reload } = useApi<any>(`/patients/${patientId}/conditions?k=${refreshKey}`);
  const testCatRule = useApi<any>("/rules/test_catalogue");
  const isDoctor = role === "DOCTOR";

  const [addCode, setAddCode] = useState("DIABETES_STABLE");
  const [addStage, setAddStage] = useState("");
  const [taskTests, setTaskTests] = useState<Record<number, string[]>>({});
  const [targetVal, setTargetVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  if (role !== "DOCTOR" && role !== "ADMIN") return null;
  if (error) return <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>;
  if (!data) return <p role="status" className="text-sm text-slate-500">Loading conditions & monitoring…</p>;

  const confirmed: any[] = data.confirmed || [];
  const suggested: any[] = data.suggested || [];
  const schedules: any[] = data.monitoring_schedules || [];
  const tasks: any[] = data.clinical_tasks || [];
  const catalogue: any[] = data.catalogue || [];
  const testCat: any[] = testCatRule.data?.data || testCatRule.data || [];

  async function confirmOrUpdate(code: string, stage = "") {
    setSaving(true);
    setMsg("");
    try {
      await api(`/patients/${patientId}/conditions`, { method: "POST", body: { code, stage } });
      reload();
      onChanged?.();
    } catch (e: any) {
      setMsg(e.message || "Could not update condition");
    } finally {
      setSaving(false);
    }
  }

  async function removeCond(code: string) {
    setSaving(true);
    setMsg("");
    try {
      await api(`/patients/${patientId}/conditions/${code}`, { method: "DELETE" });
      reload();
      onChanged?.();
    } catch (e: any) {
      setMsg(e.message || "Could not remove condition");
    } finally {
      setSaving(false);
    }
  }

  async function saveTarget(e: React.FormEvent) {
    e.preventDefault();
    if (!targetVal) return;
    setSaving(true);
    setMsg("");
    try {
      await api(`/patients/${patientId}/health-profile`, {
        method: "PUT",
        body: { targets: { HBA1C: { target_op: "<", target_value: Number(targetVal), unit: "%" } } },
      });
      setTargetVal("");
      reload();
      onChanged?.();
    } catch (err: any) {
      setMsg(err.message || "Could not update target");
    } finally {
      setSaving(false);
    }
  }

  async function completeTask(tid: number) {
    const selected = taskTests[tid] || [];
    if (!selected.length) {
      setMsg("Select at least one test for the clinical task.");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      await api(`/clinical-tasks/${tid}/complete`, { method: "POST", body: { test_codes: selected } });
      reload();
      onChanged?.();
    } catch (err: any) {
      setMsg(err.message || "Could not complete task");
    } finally {
      setSaving(false);
    }
  }

  const toggleTaskTest = (tid: number, code: string) => {
    const cur = taskTests[tid] || [];
    setTaskTests({
      ...taskTests,
      [tid]: cur.includes(code) ? cur.filter((x) => x !== code) : [...cur, code],
    });
  };

  const selectedAddMeta = catalogue.find((c) => c.code === addCode);

  return (
    <section aria-labelledby="conditions-monitoring-heading" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="conditions-monitoring-heading" className="text-lg font-semibold text-slate-900">
            Conditions &amp; monitoring
          </h2>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
            {confirmed.length} confirmed
          </span>
          {suggested.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
              {suggested.length} to confirm
            </span>
          )}
        </div>
        <form onSubmit={saveTarget} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-600">
            HbA1c target: <b>{data.hba1c_target?.target_op || "<"} {data.hba1c_target?.target_value ?? 7.0}%</b>
          </span>
          <input
            type="number"
            step="0.1"
            placeholder="Override %"
            aria-label="HbA1c target override"
            className="w-24 rounded border border-slate-300 px-2 py-1"
            value={targetVal}
            onChange={(e) => setTargetVal(e.target.value)}
          />
          <button type="submit" disabled={saving || !targetVal} className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 disabled:opacity-40">
            Set target
          </button>
        </form>
      </div>

      {!isDoctor && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          View-only for admins: only a doctor can confirm, change stage, or remove conditions.
        </p>
      )}
      {msg && <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">{msg}</p>}

      {suggested.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">
            To confirm (suggested from labs &amp; profile)
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {suggested.map((s) => (
              <div key={`${s.code}-${s.stage}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white p-2.5 text-xs">
                <div className="flex items-start gap-2.5 min-w-0">
                  <ConditionIcon icon={s.icon} label={s.condition_name} />
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">{s.condition_name}</div>
                    <div className="text-[11px] text-slate-600">
                      Suggested stage: <span className="font-mono">{s.stage}</span>
                      {s.replaces_code && <> · switches from {s.replaces_code}</>}
                    </div>
                  </div>
                </div>
                {isDoctor && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => confirmOrUpdate(s.code, s.stage)}
                    className="rounded-lg bg-teal-800 px-3 py-1.5 font-semibold text-white hover:bg-teal-900 disabled:opacity-40"
                  >
                    Confirm
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmed.length === 0 ? (
        <p className="text-sm text-slate-500">No confirmed conditions recorded yet. Page 7 finding protocols apply until a condition is confirmed.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {confirmed.map((c) => {
            const tMeta = TIER_BADGE[c.tier] || TIER_BADGE.LONG_TERM;
            const familyOpts = FAMILY_SWITCH_OPTIONS[c.code];
            const stageOpts: any[] = c.stage_options || [];
            return (
              <div key={c.code} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <ConditionIcon icon={c.icon} label={c.icon_label || c.condition_name} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{c.condition_name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{c.code} · since {c.since || "—"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TierBadge label={tMeta.label} colour={tMeta.colour} />
                    {isDoctor && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => removeCond(c.code)}
                        aria-label={`Remove ${c.code}`}
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-600 hover:bg-red-50 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-2 space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Active protocol</div>
                  <p className="text-slate-800">{c.timeframe_text}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-600">
                    <span>
                      Next test date:{" "}
                      <b className="text-slate-900">
                        {c.next_test_date ? fmtDate(c.next_test_date) : (c.active_protocol?.mode === "REQUIRES_INDICATION" ? "When indicated" : "Doctor to set")}
                      </b>
                    </span>
                    {c.note && <span className="italic text-slate-500">Note: {c.note}</span>}
                  </div>
                </div>

                {isDoctor && (familyOpts || stageOpts.length > 0) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {familyOpts && (
                      <label className="flex items-center gap-1">
                        <span className="text-slate-600">Condition stage:</span>
                        <select
                          aria-label={`${c.code} condition switch`}
                          className="rounded border border-slate-300 bg-white px-2 py-1"
                          value={c.code}
                          onChange={(e) => confirmOrUpdate(e.target.value, "")}
                        >
                          {familyOpts.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                        </select>
                      </label>
                    )}
                    {stageOpts.length > 0 && (
                      <label className="flex items-center gap-1">
                        <span className="text-slate-600">Stage:</span>
                        <select
                          aria-label={`${c.code} stage`}
                          className="rounded border border-slate-300 bg-white px-2 py-1"
                          value={c.stage || stageOpts[0].value}
                          onChange={(e) => confirmOrUpdate(c.code, e.target.value)}
                        >
                          {stageOpts.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {schedules.length > 0 && (
        <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/50 p-3 text-xs">
          <div className="font-semibold text-sky-950">Home BP monitoring schedules</div>
          {schedules.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-sky-200 bg-white px-2.5 py-1.5">
              <span>
                <b>{s.kind}</b> · {s.frequency_per_day}× daily for {s.duration_days} days ({fmtDate(s.start_on)} → {fmtDate(s.end_on)})
                <span className="ml-2 text-slate-500">({s.note})</span>
              </span>
              <span className="rounded bg-sky-100 px-2 py-0.5 font-semibold text-sky-900">{s.status}</span>
            </div>
          ))}
        </div>
      )}

      {tasks.length > 0 && (
        <div className="space-y-2 rounded-lg border border-purple-200 bg-purple-50/50 p-3 text-xs">
          <div className="font-semibold text-purple-950">Doctor lab-selection tasks</div>
          {tasks.map((t) => (
            <div key={t.id} className="space-y-2 rounded border border-purple-200 bg-white p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900">{t.title}</div>
                  <div className="text-slate-600">{t.details}</div>
                </div>
                <span className={`rounded px-2 py-0.5 font-semibold ${t.status === "DONE" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                  {t.status}
                </span>
              </div>
              {t.status === "DONE" ? (
                <div className="text-slate-700">Selected tests: <b>{(t.selected_tests || []).join(", ")}</b></div>
              ) : isDoctor && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {testCat.map((tc) => (
                      <label key={tc.code} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={(taskTests[t.id] || []).includes(tc.code)}
                          onChange={() => toggleTaskTest(t.id, tc.code)}
                        />
                        {tc.name}
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => completeTask(t.id)}
                    className="rounded-lg bg-purple-800 px-3 py-1 font-semibold text-white disabled:opacity-40"
                  >
                    Save selected tests
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isDoctor && (
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 text-xs">
          <label className="block">
            <span className="block text-slate-600">Add / confirm condition</span>
            <select
              aria-label="Add condition code"
              className="mt-1 rounded border border-slate-300 bg-white px-2 py-1"
              value={addCode}
              onChange={(e) => { setAddCode(e.target.value); setAddStage(""); }}
            >
              {catalogue.map((c) => <option key={c.code} value={c.code}>{c.condition_name}</option>)}
            </select>
          </label>
          {selectedAddMeta?.stage_options?.length > 0 && (
            <label className="block">
              <span className="block text-slate-600">Stage</span>
              <select
                aria-label="Add condition stage"
                className="mt-1 rounded border border-slate-300 bg-white px-2 py-1"
                value={addStage || selectedAddMeta.stage_options[0].value}
                onChange={(e) => setAddStage(e.target.value)}
              >
                {selectedAddMeta.stage_options.map((s: any) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => confirmOrUpdate(addCode, addStage)}
            className="rounded-lg bg-teal-800 px-3 py-1.5 font-semibold text-white hover:bg-teal-900 disabled:opacity-40"
          >
            Confirm condition
          </button>
        </div>
      )}
    </section>
  );
}
