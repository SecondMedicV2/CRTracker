"use client";
import Link from "next/link";
import { RequestState } from "@/components/RequestState";
import { useApi } from "@/lib/useApi";

const CHEVRON_STYLES: Record<string, { bg: string; border: string; badge: string }> = {
  red: { bg: "from-red-600 to-rose-700 text-white", border: "border-red-200", badge: "bg-white/20 text-white" },
  teal: { bg: "from-teal-600 to-teal-800 text-white", border: "border-teal-200", badge: "bg-white/20 text-white" },
  "navy blue": { bg: "from-blue-800 to-indigo-950 text-white", border: "border-blue-200", badge: "bg-white/20 text-white" },
  amber: { bg: "from-amber-500 to-orange-600 text-white", border: "border-amber-200", badge: "bg-white/20 text-white" },
  green: { bg: "from-emerald-600 to-green-700 text-white", border: "border-emerald-200", badge: "bg-white/20 text-white" },
};

export default function RetestingProtocolPage() {
  const { data, error, reload } = useApi<any>("/retesting-protocol/summary");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Recommended SecondMedic Retesting Protocol
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            5-tier urgency scheme (AMI Engine): windows, SLAs, colours, and open follow-ups per tier.
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
        </>
      )}
    </div>
  );
}
