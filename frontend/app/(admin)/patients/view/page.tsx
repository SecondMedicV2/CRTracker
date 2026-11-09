"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/lib/api";
import Trends from "@/components/Trends";
import { useApi } from "@/lib/useApi";

function PatientInner({ id }: { id: string }) {
  const { data: p, error, reload } = useApi<any>(`/patients/${id}`);
  if (error || !p) return <RequestState loading={!p} error={error} retry={reload} />;
  const patch = (body: object) => api(`/patients/${id}`, { method: "PATCH", body }).then(reload);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{p.name}</h1>
      <div className="text-sm">{p.age} · {p.gender} · <span className="font-mono">{p.mobile}</span></div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label>Language{" "}
          <select className="rounded border p-1" value={p.language} onChange={(e) => patch({ language: e.target.value })}>
            <option value="">Default</option><option value="en">English</option><option value="hi">Hindi</option><option value="hinglish">Hinglish</option>
          </select>
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={p.do_not_call} onChange={(e) => patch({ do_not_call: e.target.checked })} /> Do not call</label>
      </div>
      {p.household.length > 0 && (
        <div className="text-sm">Same household (shared mobile): {p.household.map((h: any) => (
          <Link key={h.id} className="mr-2 underline" href={`/patients/view?id=${h.id}`}>{h.name}</Link>
        ))}</div>
      )}
      <TableFrame label="Patient reports">
        <table className="w-full bg-white text-left text-sm shadow">
          <thead><tr><th className="p-2">Order</th><th>Collected</th><th>Status</th><th>Result</th></tr></thead>
          <tbody>{p.reports.map((r: any) => (
            <tr key={r.order_id} className="border-t">
              <td className="p-2 font-mono">{r.report_id ? <Link className="underline" href={`/reports/view?id=${r.report_id}`}>{r.order_id}</Link> : r.order_id}</td>
              <td>{r.collected_on ? new Date(r.collected_on).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}</td>
              <td>{r.status}</td><td className={r.classification === "ABNORMAL" ? "text-red-700" : ""}>{r.classification}</td>
            </tr>
          ))}</tbody>
        </table>
      </TableFrame>
      <Trends patientId={id} />
    </div>
  );
}


function Detail() {
  const id = useSearchParams().get("id");
  return (
    <div className="space-y-4">
      <Link className="inline-block text-sm font-medium text-teal-800 underline" href="/patients">Back to Patients</Link>
      {id && /^\d+$/.test(id) ? <PatientInner key={id} id={id} /> : <p role="alert">Open a record from Patients.</p>}
    </div>
  );
}

export default function Patient() {
  return <Suspense fallback={<p role="status">Loading…</p>}><Detail /></Suspense>;
}
