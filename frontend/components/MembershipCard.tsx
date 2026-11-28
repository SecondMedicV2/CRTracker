"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  RENEWAL_DUE: "bg-amber-50 text-amber-800",
  PENDING_SIGNOFF: "bg-violet-50 text-violet-800",
  PENDING_PAYMENT: "bg-amber-50 text-amber-800",
  EXPIRED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-600",
  PAUSED: "bg-slate-100 text-slate-600",
};
const PAYABLE = ["PENDING_PAYMENT", "RENEWAL_DUE", "ACTIVE", "EXPIRED"];

export default function MembershipCard({ patientId, role }: { patientId: string; role?: string | null }) {
  const [data, setData] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("COUNTER_CASH");
  const [msg, setMsg] = useState("");

  const loadData = async () => {
    try {
      setData(await api(`/patients/${patientId}/memberships`));
      const pl = await api<any[]>("/membership-plans");
      setPlans(pl.filter((p) => p.code !== "H360_FREE" && p.code !== "H360_CORPORATE"));
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [patientId]);

  const act = async (fn: () => Promise<unknown>) => {
    setMsg("");
    try {
      await fn();
      await loadData();
    } catch (e: any) {
      setMsg(e.message || "Something went wrong");
    }
  };

  const enrol = (e: React.FormEvent) => {
    e.preventDefault();
    act(async () => {
      await api("/memberships/enroll", { method: "POST",
        body: { patient_id: Number(patientId), plan_code: selectedPlan, amount_inr: Number(amount) || 0, payment_method: method } });
      setEnrolling(false);
    });
  };

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">Loading memberships…</div>;

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Health360 membership</h2>
        <button onClick={() => setEnrolling(!enrolling)} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700">
          {enrolling ? "Cancel" : "Add membership"}
        </button>
      </div>
      {msg && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{msg}</p>}

      {enrolling && (
        <form onSubmit={enrol} className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs text-slate-600">Plan</span>
              <select className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" value={selectedPlan} required
                onChange={(e) => { setSelectedPlan(e.target.value); setAmount(plans.find((x) => x.code === e.target.value)?.price_inr_monthly || 0); }}>
                <option value="">Choose…</option>
                {plans.map((p) => <option key={p.code} value={p.code}>{p.name} (₹{p.price_inr_monthly}/month)</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Paid now (₹, 0 = pay later)</span>
              <input type="number" min={0} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" value={amount}
                onChange={(e) => setAmount(Number(e.target.value))} />
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Method</span>
              <select className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="COUNTER_CASH">Cash</option><option value="COUNTER_UPI">UPI</option><option value="COUNTER_CARD">Card</option>
              </select>
            </label>
          </div>
          {selectedPlan === "H360_CHRONIC" && role !== "DOCTOR" && (
            <p className="text-xs text-violet-800">This plan starts only after a doctor signs it off.</p>
          )}
          <button type="submit" className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700">Confirm</button>
        </form>
      )}

      <div className="space-y-3">
        {data?.memberships?.map((m: any) => (
          <div key={m.id} className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium text-slate-900">{m.plan_name}</div>
                <div className="text-xs text-slate-500">
                  {m.payer === "CORPORATE" ? "Paid by employer" : "Self-paid"} · period ends {m.current_period_end || "–"}
                  {m.renewal_count > 0 && ` · renewed ${m.renewal_count}×`}
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[m.status] || "bg-slate-100 text-slate-700"}`}>
                {m.status.replace(/_/g, " ")}
              </span>
            </div>
            {m.entitlements_included && Object.keys(m.entitlements_included).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(m.entitlements_included).map(([k, v]: any) => (
                  <span key={k} className="rounded-md bg-white px-2 py-0.5 text-[11px] text-slate-700 ring-1 ring-slate-200">
                    {k.replace(/_/g, " ").toLowerCase()}: {m.entitlements_used?.[k] || 0}/{v}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {m.status === "PENDING_SIGNOFF" && role === "DOCTOR" && (
                <button onClick={() => act(() => api(`/memberships/${m.id}/signoff`, { method: "POST" }))}
                  className="rounded-lg bg-violet-700 px-3 py-1 text-xs font-semibold text-white">Sign off</button>
              )}
              {m.payer !== "CORPORATE" && m.plan_code !== "H360_FREE" && PAYABLE.includes(m.status) && (
                <button
                  onClick={() => {
                    const p = plans.find((x) => x.code === m.plan_code);
                    act(() => api(`/memberships/${m.id}/payments`, { method: "POST", body: { amount_inr: p?.price_inr_monthly || 0, method } }));
                  }}
                  className="rounded-lg border border-teal-600 px-3 py-1 text-xs font-semibold text-teal-700">
                  {m.status === "PENDING_PAYMENT" ? "Record payment" : "Record renewal payment"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {role !== "CALLER" && data?.suggestions?.length > 0 && (
        <div className="rounded-xl border border-teal-100 bg-teal-50/50 p-3 text-xs text-teal-900">
          <span className="font-semibold">Suggested plans: </span>
          {data.suggestions.map((s: any) => (typeof s === "string" ? s : s.plan_code)).join(", ")}
        </div>
      )}
    </div>
  );
}
