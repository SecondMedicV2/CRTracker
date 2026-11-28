"use client";
import { use } from "react";
import { useApi } from "@/lib/useApi";
import { RequestState } from "@/components/RequestState";

export default function FlyerClient({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { data: p, error, reload } = useApi<any>(`/care-plans/${code}`);

  return (
    <div className="min-h-screen bg-slate-100 p-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-xl print:max-w-none">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700"
          >
            Print / Save as PDF (A5 Portrait)
          </button>
          <a href="/care-plans" className="text-sm font-medium text-slate-600 hover:underline">
            ← Back to Catalogue
          </a>
        </div>

        <RequestState loading={!p} error={error} retry={reload} />

        {p && (
          <div className="relative overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-lg print:border-none print:shadow-none">
            {/* Header banner */}
            <div className="bg-teal-800 p-6 text-white">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-teal-200">SecondMedic Health Hub Care Plan #{p.number}</span>
                <span className="text-xs font-semibold uppercase tracking-wider text-teal-200">{p.line}</span>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight">{p.name_en}</h1>
              <div className="text-lg font-semibold text-teal-100">{p.name_hi}</div>
              <p className="mt-2 text-sm text-teal-50">{p.for_text}</p>
            </div>

            <div className="p-6 space-y-6">
              {/* We track */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">We Track / हम ट्रैक करते हैं</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.tracked_measures?.map((m: string) => (
                    <span key={m} className="rounded-lg bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800 border border-teal-100">
                      {m}
                    </span>
                  ))}
                </div>
              </div>

              {/* What's included (Plus) */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">What&apos;s Included · Plus / शामिल है (प्लस)</h2>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {p.inclusions_plus?.map((inc: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-teal-600 font-bold">✓</span>
                      <span>{inc}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Essential & Plus pricing boxes */}
              <div className="grid grid-cols-2 gap-4">
                {p.tiers?.map((t: any) => (
                  <div key={t.tier} className={`rounded-xl p-4 border ${t.tier === 'PLUS' ? 'border-teal-500 bg-teal-50/50' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="text-xs font-bold uppercase text-slate-500">{t.tier} ({t.period})</div>
                    <div className="mt-1 text-xl font-bold text-slate-900">₹{t.price_inr}</div>
                    {t.annual_price_inr && (
                      <div className="mt-0.5 text-xs text-teal-700 font-semibold">or ₹{t.annual_price_inr} / year</div>
                    )}
                  </div>
                ))}
              </div>

              {/* QR Code & Counter prompt */}
              <div className="flex items-center justify-between rounded-xl border border-dashed border-slate-300 p-4 bg-slate-50/50">
                <div>
                  <div className="text-sm font-bold text-slate-900">Ask at the counter today</div>
                  <div className="text-xs text-slate-500">काउंटर पर पूछें · Plan advised by doctor after assessment</div>
                </div>
                <div className="h-16 w-16 bg-slate-200 rounded flex items-center justify-center text-[10px] text-slate-600 font-bold border border-slate-300">
                  QR CODE
                </div>
              </div>

              {/* Footnote */}
              <div className="border-t border-slate-100 pt-4 text-[11px] text-slate-400 leading-relaxed">
                {p.footnote}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
