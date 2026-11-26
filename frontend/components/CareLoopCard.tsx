"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const STAGE_LABELS: Record<string, string> = {
  PREVENTION: "1. Prevention",
  EATING_WELL: "2. Eating well",
  DIAGNOSTICS: "3. Diagnostics",
  CONSULTATIONS: "4. Consultations",
  MEDICATIONS: "5. Medications",
  CHRONIC_CONDITIONS: "6. Chronic conditions",
  ONGOING_MONITORING: "7. Ongoing monitoring",
};

const STATUS_STYLE: Record<string, string> = {
  NEW: "bg-sky-100 text-sky-900 border-sky-300",
  ACTIVE: "bg-emerald-100 text-emerald-900 border-emerald-300",
  AT_RISK: "bg-amber-100 text-amber-900 border-amber-300",
  LAPSED: "bg-rose-100 text-rose-900 border-rose-300",
};

export default function CareLoopCard({ patientId, role, refreshKey = 0 }: { patientId: string; role: string | null; refreshKey?: number }) {
  const { data, error, reload } = useApi<any>(`/patients/${patientId}/relationship?r=${refreshKey}`);
  const [serviceCode, setServiceCode] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function addService(e: React.FormEvent) {
    e.preventDefault();
    if (!serviceCode) return;
    setSaving(true);
    setMsg("");
    try {
      await api(`/patients/${patientId}/touchpoints`, {
        method: "POST",
        body: {
          service_code: serviceCode,
          ...(occurredOn && { occurred_on: occurredOn }),
          ...(role === "ADMIN" && amount !== "" && { amount_inr: Number(amount) }),
        },
      });
      setServiceCode("");
      setOccurredOn("");
      setAmount("");
      reload();
    } catch (err: any) {
      setMsg(err.message || "Could not add service");
    } finally {
      setSaving(false);
    }
  }

  async function removeTouchpoint(id: number) {
    setMsg("");
    try {
      await api(`/touchpoints/${id}`, { method: "DELETE" });
      reload();
    } catch (err: any) {
      setMsg(err.message || "Could not remove touchpoint");
    }
  }

  if (error) return <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>;
  if (!data) return <p role="status" className="text-sm text-slate-500">Loading care loop…</p>;

  const services: any[] = data.services || [];

  return (
    <section aria-labelledby="care-loop-heading" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="care-loop-heading" className="text-lg font-semibold text-slate-900">Care loop</h2>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[data.status] || "bg-slate-100 text-slate-800"}`}>
            {data.status}
          </span>
        </div>
        {data.next_step && (
          <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-900">
            Next step: {data.next_step.clinical_label || data.next_step.caller_label}
          </div>
        )}
      </div>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {(data.stages || []).map((s: any) => (
          <li key={s.stage} className={`rounded-lg border p-2 text-xs ${s.count > 0 ? "border-teal-300 bg-teal-50/70" : "border-slate-200 bg-slate-50"}`}>
            <div className="font-semibold text-slate-900">{STAGE_LABELS[s.stage] || s.stage}</div>
            <div className="mt-1 text-slate-700">{s.count} {s.count === 1 ? "visit" : "visits"}</div>
            <div className="text-[11px] text-slate-500">{s.last_occurred_on || "None yet"}</div>
          </li>
        ))}
      </ol>

      <form onSubmit={addService} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <label className="flex-1 min-w-44">
          <span className="block text-xs font-medium text-slate-700">Add service</span>
          <select aria-label="Service" className="mt-1 w-full rounded border border-slate-300 bg-white p-1.5" value={serviceCode} onChange={(e) => setServiceCode(e.target.value)}>
            <option value="">Select service…</option>
            {services.map((s) => <option key={s.code} value={s.code}>{s.name} ({STAGE_LABELS[s.stage] || s.stage})</option>)}
          </select>
        </label>
        <label>
          <span className="block text-xs font-medium text-slate-700">Date</span>
          <input type="date" aria-label="Service date" className="mt-1 rounded border border-slate-300 bg-white p-1.5" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        </label>
        {role === "ADMIN" && (
          <label className="w-28">
            <span className="block text-xs font-medium text-slate-700">Amount (INR)</span>
            <input type="number" min={0} aria-label="Amount INR" placeholder="Default" className="mt-1 w-full rounded border border-slate-300 bg-white p-1.5" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        )}
        <button type="submit" disabled={saving || !serviceCode} className="rounded-lg bg-teal-800 px-3 py-1.5 font-medium text-white disabled:opacity-50">
          {saving ? "Adding…" : "Add service"}
        </button>
      </form>

      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Touchpoint timeline</h3>
        {!(data.touchpoints || []).length ? (
          <p className="text-xs text-slate-500">No touchpoints recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-xs">
            {data.touchpoints.map((t: any) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-semibold text-slate-900">{STAGE_LABELS[t.stage] || t.stage}</span>
                  {" · "}
                  <span className="font-mono text-slate-700">{t.service_code || t.source}</span>
                  {" · "}
                  <span className="text-slate-600">{t.occurred_on}</span>
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{t.source}</span>
                </div>
                <div className="flex items-center gap-3">
                  {role === "ADMIN" && t.amount_inr != null && <span className="font-medium text-slate-700">₹{t.amount_inr}</span>}
                  {t.source === "MANUAL" && (
                    <button type="button" className="text-red-700 underline" onClick={() => removeTouchpoint(t.id)}>Delete</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
