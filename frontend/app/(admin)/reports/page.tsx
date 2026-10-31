"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/useApi";

export default function Reports() {
  const [status, setStatus] = useState("");
  const { data, error } = useApi<any[]>(`/reports${status ? `?status_=${status}` : ""}`);
  if (error) return <p role="alert">{error}</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Reports</h1>
      <select aria-label="Filter by status" className="rounded border p-1 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All</option><option value="NEEDS_REVIEW">Needs review</option><option value="READY">Ready</option>
      </select>
      <table className="w-full bg-white text-left text-sm shadow">
        <thead><tr><th className="p-2">Order</th><th>Patient</th><th>Result</th><th>Abnormal values</th><th>Confidence</th><th>Status</th></tr></thead>
        <tbody>{data?.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="p-2"><Link className="font-mono underline" href={`/reports/${r.id}`}>{r.order_id}</Link></td>
            <td>{r.patient_name}</td>
            <td className={r.classification === "ABNORMAL" ? "font-medium text-red-700" : ""}>{r.classification}</td>
            <td>{r.abnormal_count}</td><td>{r.confidence}%</td><td>{r.needs_review ? "Needs review" : r.status}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
