"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import TierBadge from "@/components/TierBadge";

const BUNDLE_OPTIONS = [
  ["DIABETES", "Diabetes"],
  ["THYROID", "Thyroid"],
  ["LIPIDS", "Lipids"],
  ["IRON_DEFICIENCY_ANEMIA", "Iron-deficiency anemia"],
  ["VITAMIN_D", "Vitamin D"],
] as const;

const REASON_CODES = [
  ["CLINICAL_JUDGMENT", "Clinical judgment"],
  ["TREATMENT_CHANGE", "Treatment started / changed"],
  ["PATIENT_PREFERENCE", "Patient preference / availability"],
  ["SYMPTOM_URGENCY", "Symptom urgency"],
  ["OTHER", "Other clinical reason"],
] as const;

const fmtDate = (d?: string | null) =>
  d && !isNaN(Date.parse(d))
    ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "\u2014";

const statusBadge = (status: string) => {
  switch (status) {
    case "DOCTOR_TO_SET":
      return { label: "Doctor to set retest date", cls: "bg-amber-100 text-amber-900 border-amber-300" };
    case "OVERRIDDEN":
      return { label: "Overridden by doctor", cls: "bg-purple-100 text-purple-900 border-purple-300" };
    case "DOCTOR_SET":
      return { label: "Date set by doctor", cls: "bg-teal-100 text-teal-900 border-teal-300" };
    case "FALLBACK":
      return { label: "Fallback interval", cls: "bg-slate-100 text-slate-800 border-slate-300" };
    default:
      return { label: "Protocol scheduled", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" };
  }
};

function WindowBar({ start, end, status }: { start?: string | null; end?: string | null; status: string }) {
  if (!start) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900">
        {status === "DOCTOR_TO_SET" ? "Doctor to set retest date" : "Not scheduled"}
      </div>
    );
  }
  const same = !end || start === end;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-900">
        <span>{fmtDate(start)}</span>
        {!same && (
          <>
            <span aria-hidden="true">{"\u2192"}</span>
            <span>{fmtDate(end)}</span>
          </>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
        <div className="h-full w-full rounded-full bg-gradient-to-r from-teal-600 to-sky-600" />
      </div>
    </div>
  );
}

export default function RetestPlan({ followup, role, onUpdated }: { followup: any; role?: string; onUpdated: () => void }) {
  const plan = followup.retest_plan || {};
  const primary = plan.primary_finding;
  const findings: any[] = Array.isArray(plan.findings) ? plan.findings : [];
  const status = followup.retest_status || plan.status || "AUTO_SCHEDULED";
  const badge = statusBadge(status);

  const [anchorDate, setAnchorDate] = useState(followup.treatment_anchor_on || "");
  const [showOverride, setShowOverride] = useState(false);
  const [overrideDate, setOverrideDate] = useState(followup.retest_window_start || followup.next_followup_on || "");
  const [overrideEnd, setOverrideEnd] = useState(followup.retest_window_end || "");
  const [reasonCode, setReasonCode] = useState("");
  const [overrideNotes, setOverrideNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [modelPlan, setModelPlan] = useState<any>(null);
  const [hubs, setHubs] = useState<any[]>([]);
  const [bookMode, setBookMode] = useState<"HOME" | "HEALTH_HUB">("HOME");
  const [bookHubId, setBookHubId] = useState("");
  const [bookAddress, setBookAddress] = useState("");
  const [bookSlot, setBookSlot] = useState("");
  const [bundleCode, setBundleCode] = useState("");
  const [explainLang, setExplainLang] = useState<"en" | "hi">("en");
  const [explainData, setExplainData] = useState<any>(null);

  const loadModelPlan = useCallback(() => {
    api<any>(`/followups/${followup.id}/retest-plan`)
      .then((d) => {
        setModelPlan(d);
        if (d.collection_mode) setBookMode(d.collection_mode);
        if (d.health_hub_id) setBookHubId(String(d.health_hub_id));
        if (d.address) setBookAddress(d.address);
        if (d.bundle_code) setBundleCode(d.bundle_code);
      })
      .catch(() => {});
  }, [followup.id]);

  useEffect(() => {
    loadModelPlan();
    api<any[]>("/health-hubs").then(setHubs).catch(() => {});
  }, [loadModelPlan, followup.retest_status, followup.stage, followup.retest_window_start]);

  async function approvePlan() {
    if (!modelPlan?.id) return;
    setSaving(true);
    setMsg("");
    try {
      const updated = await api<any>(`/retest-recommendations/${modelPlan.id}/approve`, { method: "POST" });
      setModelPlan(updated);
      onUpdated();
    } catch (e: any) {
      setMsg(e.message || "Could not approve plan");
    } finally {
      setSaving(false);
    }
  }

  async function submitBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!modelPlan?.id) return;
    setSaving(true);
    setMsg("");
    try {
      const updated = await api<any>(`/retest-recommendations/${modelPlan.id}/book`, {
        method: "POST",
        body: {
          collection_mode: bookMode,
          ...(bookMode === "HEALTH_HUB" ? { health_hub_id: Number(bookHubId) } : { address: bookAddress }),
          ...(bookSlot ? { slot_start: new Date(bookSlot).toISOString() } : {}),
        },
      });
      setModelPlan(updated);
      onUpdated();
    } catch (err: any) {
      setMsg(err.message || "Could not book collection");
    } finally {
      setSaving(false);
    }
  }

  async function acceptBundle() {
    if (!bundleCode) return;
    setSaving(true);
    setMsg("");
    try {
      const res = await api<any>(`/followups/${followup.id}/bundles/${bundleCode}/accept`, { method: "POST" });
      if (res.plan) setModelPlan(res.plan);
      onUpdated();
    } catch (err: any) {
      setMsg(err.message || "Could not accept bundle");
    } finally {
      setSaving(false);
    }
  }

  async function loadExplain(lang: "en" | "hi") {
    if (!modelPlan?.id) return;
    setExplainLang(lang);
    try {
      const res = await api<any>(`/retest-recommendations/${modelPlan.id}/explain?lang=${lang}`);
      setExplainData(res);
    } catch (err: any) {
      setMsg(err.message || "Could not load explanation sheet");
    }
  }

  async function saveAnchor() {
    if (!anchorDate) return;
    setSaving(true);
    setMsg("");
    try {
      await api(`/followups/${followup.id}`, {
        method: "PATCH",
        body: { treatment_anchor_on: anchorDate },
      });
      onUpdated();
    } catch (e: any) {
      setMsg(e.message || "Could not update treatment date");
    } finally {
      setSaving(false);
    }
  }

  async function submitOverride(e: React.FormEvent) {
    e.preventDefault();
    if (!overrideDate || !reasonCode) {
      setMsg("Retest date and reason code are required.");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      await api(`/followups/${followup.id}/retest-override`, {
        method: "POST",
        body: {
          window_start: overrideDate,
          ...(overrideEnd ? { window_end: overrideEnd } : {}),
          reason_code: reasonCode,
          notes: overrideNotes,
        },
      });
      setShowOverride(false);
      onUpdated();
    } catch (err: any) {
      setMsg(err.message || "Could not override retest date");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="retest-plan-heading" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="retest-plan-heading" className="text-lg font-semibold text-slate-900">Retest plan</h2>
          <TierBadge label={followup.protocol_tier_label} colour={followup.protocol_tier_colour} />
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>{badge.label}</span>
          {plan.override?.reason_code && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700">
              Reason: {plan.override.reason_code}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {followup.protocol_tier !== "URGENT" && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                api(`/followups/${followup.id}`, { method: "PATCH", body: { protocol_tier: "URGENT" } })
                  .then(() => { setMsg(""); onUpdated(); })
                  .catch((e) => setMsg(e.message || "Could not mark urgent"))
                  .finally(() => setSaving(false));
              }}
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100"
            >
              Mark Urgent (24h)
            </button>
          )}
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            onClick={() => setShowOverride((v) => !v)}
          >
            {showOverride ? "Cancel override" : "Override date"}
          </button>
        </div>
      </div>

      {msg && <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">{msg}</p>}

      {primary ? (
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {primary.source === "CONDITION" ? "Condition protocol" : "Finding"}
            </div>
            <div className="mt-1 font-semibold text-slate-900">{primary.condition_name || primary.finding_name}</div>
            <div className="mt-0.5 text-xs font-mono text-slate-500">{primary.condition_code || primary.finding_code} · {primary.variant_when}</div>
            {Array.isArray(plan.overridden_findings) && plan.overridden_findings.length > 0 && (
              <div className="mt-1 text-[11px] text-teal-800">Overrides: {plan.overridden_findings.join(", ")}</div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended timeframe</div>
            <div className="mt-1">
              <WindowBar start={followup.retest_window_start} end={followup.retest_window_end} status={status} />
            </div>
            <p className="mt-1 text-xs text-slate-600">{primary.timeframe_text}</p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tests to repeat</div>
            <p className="mt-1 text-xs font-medium text-slate-800">{primary.tests_text}</p>
            {Array.isArray(primary.tests) && primary.tests.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {primary.tests.map((t: any) => (
                  <span key={t.code} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700">
                    {t.name}{t.optional ? " (if indicated)" : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Clinical considerations</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-700">{primary.considerations_text}</p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">AMI reminder</div>
            <div className="mt-1 font-semibold text-slate-900">{followup.reminder_on ? fmtDate(followup.reminder_on) : "\u2014"}</div>
            <div className="mt-0.5 text-xs text-slate-600">{primary.ami_reminder_text}</div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Schedule source</div>
            <div className="mt-1 font-medium text-slate-800">Bucket fallback interval</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Due window</div>
            <div className="mt-1"><WindowBar start={followup.retest_window_start || followup.due_on} end={followup.retest_window_end || followup.due_on} status={status} /></div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">AMI reminder</div>
            <div className="mt-1 text-xs text-slate-700">{followup.reminder_on ? fmtDate(followup.reminder_on) : "None"}</div>
          </div>
        </div>
      )}

      {findings.length > 1 && (
        <details className="rounded-lg border border-slate-200 p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-800">
            All detected findings ({findings.length}) — earliest auto-scheduled window is shown above
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="py-1.5 pr-2">Finding</th>
                  <th className="py-1.5 pr-2">Window</th>
                  <th className="py-1.5 pr-2">Tests</th>
                  <th className="py-1.5 pr-2">Clinical considerations</th>
                  <th className="py-1.5">AMI reminder</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((item: any) => (
                  <tr key={item.finding_code} className="border-b align-top last:border-0">
                    <td className="py-1.5 pr-2 font-medium">{item.condition_name || item.finding_name} <span className="text-slate-400">({item.variant_when})</span></td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {item.window_start ? `${fmtDate(item.window_start)}${item.window_end && item.window_end !== item.window_start ? ` \u2192 ${fmtDate(item.window_end)}` : ""}` : item.mode}
                    </td>
                    <td className="py-1.5 pr-2">{item.tests_text}</td>
                    <td className="py-1.5 pr-2">{item.considerations_text}</td>
                    <td className="py-1.5 whitespace-nowrap">{item.reminder_on ? fmtDate(item.reminder_on) : item.ami_reminder_text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3 text-xs">
        <label className="block font-medium text-slate-700">
          Treatment started/changed on
          <input
            type="date"
            aria-label="Treatment started/changed on"
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-xs"
            value={anchorDate}
            onChange={(e) => setAnchorDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={saving || !anchorDate}
          onClick={saveAnchor}
          className="rounded-lg border border-teal-800 px-3 py-1.5 font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-40"
        >
          Save treatment date
        </button>
      </div>

      {showOverride && (
        <form onSubmit={submitOverride} className="space-y-3 rounded-lg border border-purple-200 bg-purple-50/50 p-3 text-xs">
          <div className="font-semibold text-slate-900">Override retest date</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block font-medium">
              Retest date (start)
              <input
                type="date"
                required
                aria-label="Override retest date"
                className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1"
                value={overrideDate}
                onChange={(e) => setOverrideDate(e.target.value)}
              />
            </label>
            <label className="block font-medium">
              Window end date (optional)
              <input
                type="date"
                aria-label="Override window end date"
                className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1"
                value={overrideEnd}
                onChange={(e) => setOverrideEnd(e.target.value)}
              />
            </label>
            <label className="block font-medium">
              Reason code (required)
              <select
                required
                aria-label="Override reason code"
                className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
              >
                <option value="">Select reason…</option>
                {REASON_CODES.map(([code, label]) => (
                  <option key={code} value={code}>{label} ({code})</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block font-medium">
            Note (optional)
            <input
              type="text"
              maxLength={300}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1"
              value={overrideNotes}
              onChange={(e) => setOverrideNotes(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !overrideDate || !reasonCode}
              className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white disabled:opacity-40"
            >
              Confirm override
            </button>
          </div>
        </form>
      )}

      {modelPlan && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-900">AMI Approved Retest Checklist (7 steps)</span>
              <span className={`rounded-full border px-2 py-0.5 font-semibold ${modelPlan.approved ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
                {modelPlan.approved ? "Approved" : "Pending approval"}
              </span>
              {role === "ADMIN" && modelPlan.tests_total_inr != null && (
                <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-800">
                  Est. diagnostics: ₹{Number(modelPlan.tests_total_inr).toLocaleString("en-IN")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {!modelPlan.approved && role === "DOCTOR" && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={approvePlan}
                  className="rounded-lg bg-teal-800 px-3 py-1 font-semibold text-white hover:bg-teal-900 disabled:opacity-40"
                >
                  Approve plan
                </button>
              )}
              <button
                type="button"
                onClick={() => (explainData ? setExplainData(null) : loadExplain(explainLang))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50"
              >
                {explainData ? "Hide patient explanation" : "Explain to patient"}
              </button>
            </div>
          </div>

          <ol className="grid gap-1.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
            {(modelPlan.steps || []).map((st: any) => (
              <li key={st.step} className={`rounded-lg border p-2 ${st.done ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-slate-50"}`}>
                <div className="font-semibold text-slate-900">{st.step}. {st.title} {st.done ? "✓" : ""}</div>
                {st.detail && <div className="mt-0.5 text-slate-600">{st.detail}</div>}
              </li>
            ))}
          </ol>

          <div className="grid gap-3 md:grid-cols-2">
            <form onSubmit={submitBooking} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="flex items-center justify-between font-semibold text-slate-900">
                <span>Collection Booking ({modelPlan.booking_status || "NOT_BOOKED"})</span>
                {!modelPlan.approved && <span className="text-amber-800">Approve plan before booking</span>}
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-1">
                  <input type="radio" name={`mode-${followup.id}`} checked={bookMode === "HOME"} onChange={() => setBookMode("HOME")} />
                  Home collection
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name={`mode-${followup.id}`} checked={bookMode === "HEALTH_HUB"} onChange={() => setBookMode("HEALTH_HUB")} />
                  Health Hub visit
                </label>
              </div>
              {bookMode === "HOME" ? (
                <input
                  type="text"
                  placeholder="Patient collection address"
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1"
                  value={bookAddress}
                  onChange={(e) => setBookAddress(e.target.value)}
                />
              ) : (
                <select className="w-full rounded border border-slate-300 bg-white px-2 py-1" value={bookHubId} onChange={(e) => setBookHubId(e.target.value)}>
                  <option value="">Select Health Hub…</option>
                  {hubs.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.city})</option>)}
                </select>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input type="datetime-local" className="rounded border border-slate-300 bg-white px-2 py-1" value={bookSlot} onChange={(e) => setBookSlot(e.target.value)} />
                <button
                  type="submit"
                  disabled={saving || !modelPlan.approved || (bookMode === "HOME" ? !bookAddress.trim() : !bookHubId)}
                  className="rounded-lg bg-slate-900 px-3 py-1 font-semibold text-white disabled:opacity-40"
                >
                  Save booking
                </button>
              </div>
            </form>

            {role === "DOCTOR" && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="font-semibold text-slate-900">Integrated Care Bundle (AMI)</div>
                <p className="text-slate-600">Links Diagnostics + Physician Consult + Pharmacy (when on active medicines) + Nutrition.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <select aria-label="Protocol bundle" className="rounded border border-slate-300 bg-white px-2 py-1" value={bundleCode} onChange={(e) => setBundleCode(e.target.value)}>
                    <option value="">Select bundle…</option>
                    {BUNDLE_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={saving || !bundleCode}
                    onClick={acceptBundle}
                    className="rounded-lg border border-teal-800 bg-white px-3 py-1 font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-40"
                  >
                    Accept bundle
                  </button>
                </div>
              </div>
            )}
          </div>

          {explainData && (
            <div className="space-y-2 rounded-lg border border-teal-200 bg-teal-50/40 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm text-teal-950">{explainData.title}</strong>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => loadExplain("en")} className={`rounded px-2 py-0.5 font-semibold ${explainLang === "en" ? "bg-teal-800 text-white" : "border bg-white"}`}>EN</button>
                  <button type="button" onClick={() => loadExplain("hi")} className={`rounded px-2 py-0.5 font-semibold ${explainLang === "hi" ? "bg-teal-800 text-white" : "border bg-white"}`}>हिंदी</button>
                  <button type="button" onClick={() => typeof window !== "undefined" && window.print()} className="rounded border bg-white px-2 py-0.5 font-semibold text-slate-700">Print</button>
                </div>
              </div>
              <p><b>Tests:</b> {explainData.tests}</p>
              <p><b>Why:</b> {explainData.why}</p>
              <p><b>When:</b> {explainData.when}</p>
              <div><b>How results compare:</b><ul className="list-disc pl-5">{(explainData.how_lines || []).map((l: string, i: number) => <li key={i}>{l}</li>)}</ul></div>
              <p className="rounded border border-slate-200 bg-white p-2 font-mono text-[11px]">{explainData.patient_message}</p>
              <p className="text-slate-600">{explainData.disclaimer}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
