"use client";

import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { RequestState } from "@/components/RequestState";

export default function MembershipsAdminPage() {
  const { data: plans, error: plansError, reload: reloadPlans } = useApi<any[]>("/membership-plans");
  const { data: statements, error: stmtError, reload: reloadStmt } = useApi<any>("/corporate-billing/statements");
  const [filterPlan, setFilterPlan] = useState("");

  const exportCSV = () => {
    if (!statements?.statements) return;
    const headers = ["Client ID", "Client Name", "Code", "PEPM (INR)", "Active Members", "Monthly Total (INR)"];
    const rows = statements.statements.map((s: any) => [
      s.client_id,
      s.client_name,
      s.code,
      s.pepm_inr,
      s.active_members,
      s.monthly_total_inr
    ]);

    const sanitize = (val: any) => {
      let str = String(val ?? "");
      if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
      return `"${str.replace(/"/g, '""')}"`;
    };

    const csvContent = [headers.map(sanitize).join(","), ...rows.map((r: any[]) => r.map(sanitize).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "corporate_billing_statements.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Health360 Memberships & Corporate Billing (Page 15)</h1>
        <p className="mt-1 text-sm text-slate-500">Manage membership plans, corporate billing statements, and MRR analytics.</p>
      </div>

      <RequestState loading={!plans || !statements} error={plansError || stmtError} retry={() => { reloadPlans(); reloadStmt(); }} />

      {plans && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Membership Plans & MRR</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map((p: any) => (
              <div key={p.code} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{p.name}</span>
                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">{p.code}</span>
                </div>
                <div className="text-2xl font-bold text-slate-900">₹{p.price_inr_monthly}<span className="text-xs font-normal text-slate-500">/mo</span></div>
                <p className="text-xs text-slate-600">{p.target_text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {statements && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Corporate Billing Statements</h2>
            <button
              onClick={exportCSV}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700"
            >
              Export CSV (Formula-Safe)
            </button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3.5 text-left font-semibold text-slate-700">Client Name</th>
                  <th className="px-6 py-3.5 text-left font-semibold text-slate-700">Code</th>
                  <th className="px-6 py-3.5 text-left font-semibold text-slate-700">PEPM (INR)</th>
                  <th className="px-6 py-3.5 text-left font-semibold text-slate-700">Active Members</th>
                  <th className="px-6 py-3.5 text-left font-semibold text-slate-700">Monthly Total (INR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {statements.statements.map((s: any) => (
                  <tr key={s.client_id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 font-medium text-slate-900">{s.client_name}</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-600">{s.code}</td>
                    <td className="px-6 py-4 text-slate-600">₹{s.pepm_inr}</td>
                    <td className="px-6 py-4 text-slate-600">{s.active_members}</td>
                    <td className="px-6 py-4 font-semibold text-slate-900">₹{s.monthly_total_inr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
