"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { downloadFromApi, uploadToApi } from "@/lib/files";
import { useApi } from "@/lib/useApi";
import { RequestState } from "@/components/RequestState";

export default function MembershipsAdminPage() {
  const [status, setStatus] = useState("");
  const { data: plans, error: plansError, reload: reloadPlans } = useApi<any[]>("/membership-plans");
  const { data: statements, error: stmtError, reload: reloadStmt } = useApi<any>("/corporate-billing/statements");
  const { data: list, error: listError, reload: reloadList } = useApi<any>(`/memberships${status ? `?status=${status}` : ""}`);
  const [msg, setMsg] = useState("");

  const reloadAll = () => { reloadPlans(); reloadStmt(); reloadList(); };
  const run = async (fn: () => Promise<unknown>, ok = "") => {
    setMsg("");
    try { await fn(); if (ok) setMsg(ok); reloadAll(); } catch (e: any) { setMsg(e.message); }
  };

  const editPrice = (p: any) => {
    const v = window.prompt(`Monthly price for ${p.name} (₹)`, String(p.price_inr_monthly));
    if (v === null || !/^\d+$/.test(v.trim())) return;
    run(() => api(`/membership-plans/${p.code}`, { method: "PATCH", body: { price_inr_monthly: Number(v) } }), "Price saved.");
  };

  const uploadRoster = (clientId: number, file?: File) => {
    if (!file) return;
    run(async () => {
      const r = await uploadToApi(`/corporate-clients/${clientId}/roster`, file);
      setMsg(`Roster: ${r.enrolled} enrolled, ${r.matched} matched to existing patients, ${r.created} new, ${r.already_member} already members, ${r.skipped} skipped.`);
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Health360 memberships</h1>
        <p className="mt-1 text-sm text-slate-500">Plans, members, monthly recurring revenue and corporate billing.</p>
      </div>
      {msg && <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-800">{msg}</p>}
      <RequestState loading={!plans || !statements || !list} error={plansError || stmtError || listError} retry={reloadAll} />

      {plans && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Plans</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {plans.map((p: any) => (
              <div key={p.code} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{p.name}</span>
                  <span className="text-xs text-slate-500">MRR ₹{list?.mrr_by_plan?.[p.code] ?? 0}</span>
                </div>
                <div className="text-2xl font-bold text-slate-900">₹{p.price_inr_monthly}<span className="text-xs font-normal text-slate-500">/month</span></div>
                <p className="text-xs text-slate-600">{p.target_text}</p>
                <button onClick={() => editPrice(p)} className="text-xs font-semibold text-teal-700 hover:underline">Edit price</button>
              </div>
            ))}
          </div>
          {list && <p className="text-sm text-slate-700">Total self-paid MRR: <span className="font-semibold">₹{list.mrr_total}</span></p>}
        </section>
      )}

      {list && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Members</h2>
            <select className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {["ACTIVE", "RENEWAL_DUE", "PENDING_SIGNOFF", "PENDING_PAYMENT", "PAUSED", "EXPIRED", "CANCELLED"].map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr><th className="px-4 py-3">Patient</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Payer</th><th className="px-4 py-3">Period ends</th><th className="px-4 py-3">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.memberships.map((m: any) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3"><a className="underline" href={`/patients/view?id=${m.patient_id}`}>#{m.patient_id}</a></td>
                    <td className="px-4 py-3">{m.plan_name}</td>
                    <td className="px-4 py-3">{m.status.replace(/_/g, " ").toLowerCase()}</td>
                    <td className="px-4 py-3">{m.payer.toLowerCase()}</td>
                    <td className="px-4 py-3">{m.current_period_end}</td>
                    <td className="space-x-2 px-4 py-3 text-xs">
                      {["ACTIVE", "RENEWAL_DUE"].includes(m.status) && (
                        <button className="text-slate-700 underline" onClick={() => run(() => api(`/memberships/${m.id}/status`, { method: "POST", body: { status: "PAUSED" } }))}>Pause</button>
                      )}
                      {m.status === "PAUSED" && (
                        <button className="text-slate-700 underline" onClick={() => run(() => api(`/memberships/${m.id}/status`, { method: "POST", body: { status: "ACTIVE" } }))}>Resume</button>
                      )}
                      {m.plan_code !== "H360_FREE" && !["CANCELLED", "EXPIRED"].includes(m.status) && (
                        <button className="text-red-700 underline" onClick={() => window.confirm("Cancel this membership?") && run(() => api(`/memberships/${m.id}/status`, { method: "POST", body: { status: "CANCELLED" } }))}>Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
                {list.memberships.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No memberships.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {statements && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Corporate billing (this month)</h2>
            <button onClick={() => run(() => downloadFromApi("/corporate-billing/statements?format=csv", "corporate-statements.csv"))}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700">Download CSV</button>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr><th className="px-4 py-3">Client</th><th className="px-4 py-3">PEPM</th><th className="px-4 py-3">Active members</th>
                  <th className="px-4 py-3">Monthly total</th><th className="px-4 py-3">Member roster (CSV/XLSX, 5 MB)</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statements.statements.map((s: any) => (
                  <tr key={s.client_id}>
                    <td className="px-4 py-3 font-medium text-slate-900">{s.client_name} <span className="font-mono text-xs text-slate-500">{s.code}</span></td>
                    <td className="px-4 py-3">₹{s.pepm_inr}</td>
                    <td className="px-4 py-3">{s.active_members}</td>
                    <td className="px-4 py-3 font-semibold">₹{s.monthly_total_inr}</td>
                    <td className="px-4 py-3">
                      <input type="file" accept=".csv,.xlsx" aria-label={`Upload roster for ${s.client_name}`} className="text-xs"
                        onChange={(e) => { uploadRoster(s.client_id, e.target.files?.[0]); e.target.value = ""; }} />
                    </td>
                  </tr>
                ))}
                {statements.statements.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No corporate clients yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Roster columns: Employee ID, Name, Mobile. People are matched by mobile number; each gets a Health360 Corporate membership billed to the employer.</p>
        </section>
      )}
    </div>
  );
}
