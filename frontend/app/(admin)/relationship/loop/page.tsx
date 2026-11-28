"use client";
import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { RequestState } from "@/components/RequestState";

const istDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

export default function HealthLoopDashboardPage() {
  const [from, setFrom] = useState(() => istDate.format(Date.now() - 365 * 864e5));
  const [to, setTo] = useState(() => istDate.format(Date.now()));
  const [hubId, setHubId] = useState("");
  const [corpId, setCorpId] = useState("");

  const queryParams = new URLSearchParams({
    from,
    to,
    ...(hubId ? { hub_id: hubId } : {}),
    ...(corpId ? { corporate_id: corpId } : {}),
  });

  const { data: loop, error, reload } = useApi<any>(`/relationship/loop?${queryParams}`);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Holistic Health Loop vs Transaction Cycle (Page 14)</h1>
          <p className="mt-1 text-sm text-slate-500">Live operational dashboard comparing the legacy transaction model with the recurring relationship loop.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-sm">
        <label className="flex items-center gap-2">
          <span className="text-slate-500">From</span>
          <input type="date" className="rounded-lg border border-slate-200 px-3 py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-500">To</span>
          <input type="date" className="rounded-lg border border-slate-200 px-3 py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-500">Hub ID</span>
          <input type="number" placeholder="All Hubs" className="w-24 rounded-lg border border-slate-200 px-3 py-1.5" value={hubId} onChange={(e) => setHubId(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-500">Corporate ID</span>
          <input type="number" placeholder="All Corps" className="w-24 rounded-lg border border-slate-200 px-3 py-1.5" value={corpId} onChange={(e) => setCorpId(e.target.value)} />
        </label>
      </div>

      <RequestState loading={!loop} error={error} retry={reload} />

      {loop && (
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Left Panel: Transaction Cycle */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-amber-900">Current Model: Transaction-Driven Cycle</h2>
            <p className="mt-1 text-xs text-amber-700">One-off service purchases, reactive engagement, and disconnected episodes.</p>
            
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold text-amber-800">One-time Patients</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{loop.transaction_cohort.one_time_patients}</div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold text-amber-800">Reactivated Patients</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{loop.transaction_cohort.reactivated_patients}</div>
              </div>
              <div className="col-span-2 rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold text-amber-800">Revenue per Transaction</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">₹{loop.transaction_cohort.revenue_per_transaction_inr}</div>
              </div>
            </div>
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-100/60 p-4 text-xs font-semibold text-amber-900">
              Strategic Asset: Healthcare Network (Hubs &amp; Nodes)
            </div>
          </div>

          {/* Right Panel: Holistic Health Loop */}
          <div className="rounded-2xl border border-teal-200 bg-teal-50/40 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-teal-900">Future Model: Relationship Platform Loop</h2>
            <p className="mt-1 text-xs text-teal-700">7-stage continuous care loop powered by AMI coordination and recurring revenue.</p>

            <div className="mt-6 space-y-3">
              {loop.stages.map((st: any) => (
                <div key={st.stage} className="flex items-center justify-between rounded-xl border border-teal-200 bg-white p-3 text-sm shadow-sm">
                  <div className="font-semibold text-slate-900">{st.stage.replace(/_/g, " ")}</div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="font-bold text-teal-800">{st.patient_count} patients ({st.patient_pct})</span>
                    <span className="font-medium text-slate-500">₹{st.revenue_inr}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-teal-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold text-teal-800">Retention Rate</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{loop.retention_rate}</div>
              </div>
              <div className="rounded-xl border border-teal-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold text-teal-800">AMI Steps on Time</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{loop.ami_coordination.steps_on_time_pct}</div>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-teal-200 bg-teal-100/60 p-4 text-xs font-semibold text-teal-900">
              Strategic Asset: Healthcare Network + Longitudinal Patient Relationships
            </div>
          </div>
        </div>
      )}

      {loop && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Holistic Revenue Ring</h3>
          <p className="mt-1 text-sm text-slate-500">Breakdown of recurring and transactional revenue streams.</p>
          <div className="mt-6 grid gap-6 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-xs font-medium text-slate-500">Transactions</div>
              <div className="mt-1 text-xl font-bold text-slate-900">₹{loop.revenue_ring.transactions_inr}</div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-xs font-medium text-slate-500">Subscriptions</div>
              <div className="mt-1 text-xl font-bold text-slate-900">₹{loop.revenue_ring.subscriptions_inr}</div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-xs font-medium text-slate-500">Corporate Partnerships</div>
              <div className="mt-1 text-xl font-bold text-slate-900">₹{loop.revenue_ring.corporate_inr}</div>
            </div>
            <div className="rounded-xl border border-teal-100 bg-teal-50 p-4">
              <div className="text-xs font-medium text-teal-700">Total Holistic Revenue</div>
              <div className="mt-1 text-xl font-bold text-teal-900">₹{loop.revenue_ring.total_holistic_revenue_inr}</div>
            </div>
            <div className="rounded-xl border border-teal-100 bg-teal-50 p-4">
              <div className="text-xs font-medium text-teal-700">Annual Contribution / Patient</div>
              <div className="mt-1 text-xl font-bold text-teal-900">₹{loop.revenue_ring.annual_contribution_per_patient_inr}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
