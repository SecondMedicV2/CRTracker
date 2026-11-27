"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

export default function MembershipCard({ patientId, role }: { patientId: string; role?: string | null }) {
  const [data, setData] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [payer, setPayer] = useState("SELF");
  const [amount, setAmount] = useState(0);

  const loadData = async () => {
    try {
      const res = await api(`/patients/${patientId}/memberships`);
      setData(res);
      const pl = await api("/membership-plans");
      setPlans(pl);
      if (pl.length > 0 && !selectedPlan) setSelectedPlan(pl[0].code);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [patientId]);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/memberships/enroll", {
        method: "POST",
        body: { patient_id: parseInt(patientId, 10), plan_code: selectedPlan, payer, amount_inr: Number(amount) }
      });
      setEnrolling(false);
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to enroll");
    }
  };

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">Loading memberships…</div>;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Health360 Memberships</h2>
        {role === "ADMIN" && (
          <button
            onClick={() => setEnrolling(!enrolling)}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
          >
            {enrolling ? "Cancel" : "Enrol Membership"}
          </button>
        )}
      </div>

      {enrolling && (
        <form onSubmit={handleEnroll} className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-3 text-sm">
          <h3 className="font-medium text-slate-800">New Membership Enrollment</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-slate-600 text-xs">Plan</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
                value={selectedPlan}
                onChange={(e) => {
                  setSelectedPlan(e.target.value);
                  const p = plans.find((x) => x.code === e.target.value);
                  if (p) setAmount(p.price_inr_monthly || 0);
                }}
              >
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>{p.name} (₹{p.price_inr_monthly}/mo)</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-slate-600 text-xs">Payer</span>
              <select className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" value={payer} onChange={(e) => setPayer(e.target.value)}>
                <option value="SELF">Self / Patient</option>
                <option value="CORPORATE">Corporate</option>
                <option value="HEALTH_HUB">Health Hub Counter</option>
              </select>
            </label>
            <label className="block">
              <span className="text-slate-600 text-xs">Amount (INR)</span>
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </label>
          </div>
          <button type="submit" className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700">
            Confirm Enrollment
          </button>
        </form>
      )}

      <div className="space-y-3">
        {data?.memberships?.length === 0 ? (
          <p className="text-sm text-slate-500">No active memberships.</p>
        ) : (
          data?.memberships?.map((m: any) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-4 text-sm">
              <div className="space-y-1">
                <div className="font-medium text-slate-900">{m.plan_name} <span className="text-xs font-normal text-slate-500">({m.plan_code})</span></div>
                <div className="text-xs text-slate-500">Payer: {m.payer} · Ends: {m.current_period_end || "N/A"}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${m.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                  {m.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {role !== "CALLER" && data?.suggestions?.length > 0 && (
        <div className="rounded-xl border border-teal-100 bg-teal-50/50 p-3 text-xs text-teal-900 space-y-1">
          <div className="font-semibold">AI Eligibility Suggestions:</div>
          <ul className="list-disc pl-4 space-y-0.5">
            {data.suggestions.map((s: any, i: number) => (
              <li key={i}>{s.reason} — Recommended plan: <span className="font-medium">{s.plan_code}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
