"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useApi } from "@/lib/useApi";

function Reports() {
  const router = useRouter();
  const filter = useSearchParams().get("status_");
  const status = filter === "READY" || filter === "NEEDS_REVIEW" ? filter : "";
  const { data, error, reload } = useApi<any[]>(`/reports${status ? `?status_=${status}` : ""}`);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Reports</h1>
      <select aria-label="Filter by status" className="rounded border p-1 text-sm" value={status}
        onChange={(e) => router.replace(e.target.value ? `/reports?status_=${e.target.value}` : "/reports", { scroll: false })}>
        <option value="">All</option><option value="NEEDS_REVIEW">Needs review</option><option value="READY">Ready</option>
      </select>
      <RequestState loading={!data} error={error} retry={reload} empty={data?.length === 0 ? (status ? "No reports match this status." : "No reports yet.") : undefined} />
      {!error && !!data?.length && (
        <TableFrame label="Lab reports">
          <table className="w-full bg-white text-left text-sm shadow">
            <thead><tr><th className="p-2">Order</th><th>Patient</th><th>Result</th><th>Abnormal values</th><th>Confidence</th><th>Status</th></tr></thead>
            <tbody>{data?.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2"><Link className="font-mono underline" href={`/reports/view?id=${r.id}`}>{r.order_id}</Link></td>
                <td>{r.patient_name}</td>
                <td className={r.classification === "ABNORMAL" ? "font-medium text-red-700" : ""}>{r.classification}</td>
                <td>{r.abnormal_count}</td><td>{r.confidence}%</td><td>{r.needs_review ? "Needs review" : r.status}</td>
              </tr>
            ))}</tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<p role="status">Loading reports…</p>}><Reports /></Suspense>;
}
