"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/useApi";
import { RequestState } from "@/components/RequestState";

export default function CarePlansPage() {
  const [tab, setTab] = useState<"catalogue" | "enrollments">("catalogue");
  const { data: plans, error: plansErr, reload: reloadPlans } = useApi<any[]>("/care-plans");
  const { data: enrollments, error: enrErr, reload: reloadEnr } = useApi<any[]>("/care-plans/enrollments");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Health Hub Care Plans</h1>
          <p className="mt-1 text-sm text-slate-500">Plan catalogue, enrolment tracking, and printable A5 flyers.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTab("catalogue")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${tab === "catalogue" ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
          >
            Plan Catalogue ({plans?.length || 0})
          </button>
          <button
            onClick={() => setTab("enrollments")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${tab === "enrollments" ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
          >
            Enrolments ({enrollments?.length || 0})
          </button>
        </div>
      </div>

      {tab === "catalogue" && (
        <>
          <RequestState loading={!plans} error={plansErr} retry={reloadPlans} />
          {plans && (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {plans.map((p) => (
                <div key={p.code} className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">Plan #{p.number}</span>
                      <span className="text-xs font-medium text-teal-700">{p.line}</span>
                    </div>
                    <h3 className="mt-3 text-lg font-bold text-slate-900">{p.name_en}</h3>
                    <div className="text-sm font-semibold text-slate-600">{p.name_hi}</div>
                    <p className="mt-2 text-xs text-slate-500 line-clamp-2">{p.for_text}</p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {p.tracked_measures?.map((m: string) => (
                        <span key={m} className="rounded-md bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700">{m}</span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-6 border-t border-slate-100 pt-4">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Tiers: {p.tiers?.length}</span>
                      <Link
                        href={`/care-plans/${p.code}/flyer`}
                        target="_blank"
                        className="font-semibold text-teal-600 hover:underline"
                      >
                        Printable Flyer →
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "enrollments" && (
        <>
          <RequestState loading={!enrollments} error={enrErr} retry={reloadEnr} />
          {enrollments && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-700">ID</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-700">Patient ID</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-700">Plan</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-700">Tier</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-700">Status</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-700">Period End</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-700">Price (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {enrollments.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-medium text-slate-900">#{e.id}</td>
                      <td className="px-6 py-4 text-slate-600">{e.patient_id}</td>
                      <td className="px-6 py-4 font-semibold text-slate-800">{e.plan_name}</td>
                      <td className="px-6 py-4"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">{e.tier}</span></td>
                      <td className="px-6 py-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${e.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : e.status === "NOT_ELIGIBLE" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}>
                          {e.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600">{e.period_end || "–"}</td>
                      <td className="px-6 py-4 text-right font-semibold text-slate-900">₹{e.price_inr}</td>
                    </tr>
                  ))}
                  {enrollments.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-slate-400">No plan enrolments found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
