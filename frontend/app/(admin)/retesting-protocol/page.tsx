"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RequestState } from "@/components/RequestState";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const CHEVRON_STYLES: Record<string, { bg: string; border: string; badge: string }> = {
  red: { bg: "from-red-600 to-rose-700 text-white", border: "border-red-200", badge: "bg-white/20 text-white" },
  teal: { bg: "from-teal-600 to-teal-800 text-white", border: "border-teal-200", badge: "bg-white/20 text-white" },
  "navy blue": { bg: "from-blue-800 to-indigo-950 text-white", border: "border-blue-200", badge: "bg-white/20 text-white" },
  amber: { bg: "from-amber-500 to-orange-600 text-white", border: "border-amber-200", badge: "bg-white/20 text-white" },
  green: { bg: "from-emerald-600 to-green-700 text-white", border: "border-emerald-200", badge: "bg-white/20 text-white" },
};

const SERVICE_ICONS: Record<string, string> = {
  DIAGNOSTICS: "🧪",
  PHYSICIAN_CONSULT: "🩺",
  PHARMACY: "💊",
  NUTRITION: "🥗",
};

export default function RetestingProtocolPage() {
  const { data, error, reload } = useApi<any>("/retesting-protocol/summary");
  const { data: bundlesRule } = useApi<any>("/rules/protocol_bundles");
  const { data: hubs } = useApi<any[]>("/health-hubs");

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [hubFilter, setHubFilter] = useState("");
  const [protoFilter, setProtoFilter] = useState("");
  const [kpiData, setKpiData] = useState<any>(null);

  const queryStr = new URLSearchParams({
    ...(fromDate ? { from: fromDate } : {}),
    ...(toDate ? { to: toDate } : {}),
    ...(hubFilter ? { hub: hubFilter } : {}),
    ...(protoFilter ? { protocol: protoFilter } : {}),
  }).toString();

  useEffect(() => {
    api<any>(`/kpis/retesting${queryStr ? `?${queryStr}` : ""}`)
      .then(setKpiData)
      .catch(() => {});
  }, [queryStr]);

  const bundles: any[] = bundlesRule?.data || (Array.isArray(bundlesRule) ? bundlesRule : []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Recommended SecondMedic Retesting Protocol
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            5-tier urgency scheme, AMI 7-step approved model, integrated bundles, and retesting KPIs.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/followups" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
            All follow-ups ({data?.total_open ?? 0})
          </Link>
          <Link href="/rules" className="rounded-lg bg-teal-800 px-3 py-1.5 font-medium text-white hover:bg-teal-900">
            Edit tiers in Rules
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-sm text-teal-950">
        <span className="font-semibold">AMI Key Differentiator: </span>
        Labs stop at values; clinicians see snapshots. AMI delivers clinically approved retesting—protocol + approval + trend comparison.
      </div>

      <RequestState loading={!data} error={error} retry={reload} />

      {data && !error && (
        <>
          {data.urgent_24h > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-950">
              <div className="font-semibold">
                Urgent — action within 24 h: {data.urgent_24h} open case{data.urgent_24h === 1 ? "" : "s"}
              </div>
              <Link href="/followups?protocol_tier=URGENT" className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800">
                View urgent cases
              </Link>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-5">
            {(data.tiers || []).map((t: any) => {
              const st = CHEVRON_STYLES[(t.colour_token || "").toLowerCase()] || CHEVRON_STYLES.teal;
              return (
                <Link
                  key={t.code}
                  href={`/followups?protocol_tier=${encodeURIComponent(t.code)}`}
                  className={`group flex flex-col justify-between overflow-hidden rounded-2xl border ${st.border} bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}
                >
                  <div>
                    <div
                      className={`bg-gradient-to-br ${st.bg} px-4 py-4`}
                      style={{ clipPath: "polygon(0 0, 100% 0, 100% 84%, 50% 100%, 0 84%)" }}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide opacity-90">
                        <span>Tier {t.order}</span>
                        {t.sla_hours && (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.badge}`}>
                            {t.sla_hours}h SLA
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 text-lg font-bold leading-tight">{t.label}</div>
                      <div className="mt-2 pb-2 text-xs font-medium opacity-95">{t.window_text}</div>
                    </div>
                    <div className="px-4 py-3 text-xs leading-relaxed text-slate-700">
                      {t.details_text}
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs">
                    <span className="font-medium text-slate-600">Open follow-ups</span>
                    <span className="text-lg font-bold text-slate-900">{t.open_count ?? 0}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          {bundles.length > 0 && (
            <section aria-labelledby="bundles-heading" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="bundles-heading" className="text-lg font-semibold text-slate-900">Integrated Retesting Protocol Bundles</h2>
                <span className="text-xs text-slate-500">Starter schedules & service pricing — clinician and business to confirm</span>
              </div>
              <div className="grid gap-4 md:grid-cols-5">
                {bundles.map((b: any) => (
                  <div key={b.code} className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="space-y-2">
                      <div className="text-sm font-bold text-slate-900">{b.name}</div>
                      <div className="text-xs font-medium text-teal-800">Window: {b.window_text}</div>
                      <div className="text-xs text-slate-600">Tests: {(b.tests || []).join(", ")}</div>
                    </div>
                    <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-700">
                      {(b.services || []).map((s: any) => (
                        <li key={s.type} className="flex items-center justify-between gap-1">
                          <span>{SERVICE_ICONS[s.type] || "•"} {s.label}{s.only_if_active_medicine ? " *" : ""}</span>
                          {s.price_inr != null && <span className="font-semibold text-slate-900">₹{s.price_inr}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {kpiData && (
            <section aria-labelledby="kpi-heading" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="kpi-heading" className="text-lg font-semibold text-slate-900">Retesting KPIs & Revenue</h2>
                  <p className="text-xs text-slate-600">Measured strictly on clinically approved retest plans.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label>From <input type="date" aria-label="KPI from date" className="rounded border px-2 py-1" value={fromDate || kpiData.from || ""} onChange={(e) => setFromDate(e.target.value)} /></label>
                  <label>To <input type="date" aria-label="KPI to date" className="rounded border px-2 py-1" value={toDate || kpiData.to || ""} onChange={(e) => setToDate(e.target.value)} /></label>
                  <select aria-label="Filter KPIs by Health Hub" className="rounded border px-2 py-1" value={hubFilter} onChange={(e) => setHubFilter(e.target.value)}>
                    <option value="">All hubs</option>
                    {(hubs || []).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                  <select aria-label="Filter KPIs by Protocol" className="rounded border px-2 py-1" value={protoFilter} onChange={(e) => setProtoFilter(e.target.value)}>
                    <option value="">All protocols</option>
                    {bundles.map((b: any) => <option key={b.code} value={b.code}>{b.name}</option>)}
                  </select>
                  <a
                    href={`/api/v1/kpis/retesting.csv${queryStr ? `?${queryStr}` : ""}`}
                    className="rounded-lg border border-teal-800 bg-teal-50 px-3 py-1 font-semibold text-teal-900 hover:bg-teal-100"
                  >
                    Export CSV
                  </a>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600">
                      <th className="py-2 pr-3">KPI</th>
                      <th className="py-2 pr-3">Value</th>
                      <th className="py-2 pr-3">Breakdown</th>
                      <th className="py-2 pr-3">Trend vs prev</th>
                      <th className="py-2 pr-3">Definition</th>
                      <th className="py-2">Business significance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(kpiData.kpis || []).map((k: any) => (
                      <tr key={k.key} className="border-b border-slate-100">
                        <td className="py-2 pr-3 font-semibold text-slate-900">{k.name}</td>
                        <td className="py-2 pr-3 text-sm font-bold text-teal-900">{k.display}</td>
                        <td className="py-2 pr-3 font-mono text-slate-600">{k.numerator} / {k.denominator}</td>
                        <td className="py-2 pr-3 font-semibold text-slate-800">{k.trend}</td>
                        <td className="py-2 pr-3 text-slate-600">{k.definition}</td>
                        <td className="py-2 text-slate-600">{k.business_significance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
