"use client";
import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { RequestState } from "@/components/RequestState";

const istDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const TRIAGE: Record<string, string> = { RED: "bg-red-50 text-red-900 border-red-200", AMBER: "bg-amber-50 text-amber-900 border-amber-200",
  GREEN: "bg-emerald-50 text-emerald-900 border-emerald-200" };

function show(m: any) {
  if (m.value === null || m.value === undefined) return "—";
  return m.unit === "INR" ? `₹${m.value.toLocaleString("en-IN")}` : `${m.value}%`;
}

export default function OutcomesPage() {
  const [from, setFrom] = useState(() => istDate.format(Date.now() - 89 * 864e5));
  const [to, setTo] = useState(() => istDate.format(Date.now()));
  const { data, error, reload } = useApi<any>(`/outcomes/metrics?from=${from}&to=${to}`);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Report-to-outcome loop</h1>
        <p className="mt-1 text-sm text-slate-500">AMI drafts, the doctor decides, the network delivers, and the Day 90 retest proves it.</p>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <label className="flex items-center gap-2"><span className="text-slate-500">From</span>
          <input type="date" className="rounded-lg border border-slate-200 px-3 py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-2"><span className="text-slate-500">To</span>
          <input type="date" className="rounded-lg border border-slate-200 px-3 py-1.5" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>

      <RequestState loading={!data} error={error} retry={reload} />

      {data && (
        <>
          <section className="rounded-2xl border border-teal-200 bg-teal-50 p-6 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-teal-800">North Star</div>
            <div className="mt-1 text-4xl font-bold text-teal-950">{data.north_star.value}</div>
            <div className="mt-1 text-sm text-teal-900">{data.north_star.definition}</div>
            <div className="mt-2 text-xs text-teal-800">
              {data.north_star.retested_members} members retested
              {data.north_star.improved_share !== null && ` · ${data.north_star.improved_share}% of them improved`}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Operating metrics</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.metrics.map((m: any) => (
                <div key={m.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-xs font-semibold text-slate-600">{m.name}</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{show(m)}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {m.unit === "INR" ? `₹${(m.numerator ?? 0).toLocaleString("en-IN")} over ${m.denominator ?? 0} reports` : `${m.numerator ?? 0} of ${m.denominator ?? 0}`}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Safety triage of new results</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {(["RED", "AMBER", "GREEN"] as const).map((c) => (
                <div key={c} className={`rounded-2xl border p-5 ${TRIAGE[c]}`}>
                  <div className="text-xs font-bold">{c}</div>
                  <div className="mt-1 text-2xl font-bold">{data.triage[c]}</div>
                  <div className="mt-1 text-xs">
                    {c === "RED" ? "Doctor call within 60 minutes; no plan sold until cleared." : c === "AMBER" ? "Doctor review within 24 hours." : "Preventive plan; no extra tests pushed."}
                  </div>
                </div>
              ))}
            </div>
            {data.uncleared_red > 0 && (
              <p role="alert" className="mt-3 rounded-lg bg-red-100 p-3 text-sm font-semibold text-red-900">
                {data.uncleared_red} RED result{data.uncleared_red === 1 ? " is" : "s are"} still waiting for a doctor to clear.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
