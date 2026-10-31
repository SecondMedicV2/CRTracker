"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

export default function ReportView() {
  const { id } = useParams<{ id: string }>();
  const { data: r, error, reload } = useApi<any>(`/reports/${id}`);
  const [msg, setMsg] = useState("");
  if (error) return <p role="alert">{error}</p>;
  if (!r) return null;
  const review = r.status === "NEEDS_REVIEW";
  const run = (p: Promise<any>) => p.then(() => { setMsg(""); reload(); }).catch((e) => setMsg(e.message));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Report {r.order_id}</h1>
      <div className="text-sm">
        {r.patient_name} · {r.age ?? "age ?"} · {r.gender || "gender ?"} · {r.lab} ·{" "}
        <span className={r.classification === "ABNORMAL" ? "font-medium text-red-700" : ""}>{r.classification}</span> · {r.status}
      </div>
      {review && (
        <div role="alert" className="space-y-2 rounded border border-amber-400 bg-amber-50 p-3 text-sm">
          <div>Needs review ({r.confidence}% confidence): {r.review_reasons.join("; ")}</div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Gender" className="rounded border p-1" value={r.gender} onChange={(e) => run(api(`/reports/${id}`, { method: "PATCH", body: { gender: e.target.value } }))}>
              <option value="">Gender?</option><option value="M">Male</option><option value="F">Female</option>
            </select>
            <input aria-label="Age" className="w-20 rounded border p-1" type="number" placeholder="Age" defaultValue={r.age ?? ""}
              onBlur={(e) => e.target.value && run(api(`/reports/${id}`, { method: "PATCH", body: { age: Number(e.target.value) } }))} />
            <button className="rounded bg-slate-900 px-3 py-1 text-white" onClick={() => run(api(`/reports/${id}/approve`, { method: "POST" }))}>Approve and continue</button>
          </div>
        </div>
      )}
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <table className="w-full bg-white text-left text-sm shadow">
        <thead><tr><th className="p-2">Test</th><th>Value</th><th>Unit</th><th>Reference</th><th>Flag</th><th>How far out</th></tr></thead>
        <tbody>{r.parameters.map((p: any) => {
          const out = p.system_flag === "LOW" || p.system_flag === "HIGH";
          return (
            <tr key={p.id} className={`border-t ${out ? "bg-red-50" : ""}`}>
              <td className="p-2">{p.param_name_raw}{!p.param_code && <span className="ml-1 text-amber-700">(not recognised)</span>}</td>
              <td className={out ? "font-semibold text-red-700" : ""}>
                {review ? <input aria-label={`Value of ${p.param_name_raw}`} className="w-20 rounded border p-1" defaultValue={p.value_text} onBlur={(e) => e.target.value !== p.value_text && run(api(`/reports/${id}/parameters/${p.id}`, { method: "PATCH", body: { value: e.target.value } }))} /> : p.value_text}
              </td>
              <td>{p.unit}</td><td>{p.ref_text || (p.ref_source === "fallback" ? "admin table" : "")}</td>
              <td>{out ? `${p.system_flag} · ${p.severity}` : p.system_flag}</td>
              <td>{p.deviation_pct != null ? `${p.deviation_pct}%` : ""}</td>
            </tr>
          );
        })}</tbody>
      </table>
      <p className="text-xs text-slate-500">The original PDF viewer arrives once real Thyrocare PDFs are available.</p>
    </div>
  );
}
