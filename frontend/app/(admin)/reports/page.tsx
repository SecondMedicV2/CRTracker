"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

function Reports() {
  const router = useRouter();
  const filter = useSearchParams().get("status_");
  const status = filter === "READY" || filter === "NEEDS_REVIEW" ? filter : "";
  const { data, error, reload } = useApi<any[]>(`/reports${status ? `?status_=${status}` : ""}`);
  const [callingId, setCallingId] = useState<number | null>(null);
  const [callStatus, setCallStatus] = useState<string>("");
  const [search, setSearch] = useState("");

  async function handleCall(report: any) {
    const mobile = report.mobile || "9876543210";
    const name = report.patient_name || "Customer";
    if (!window.confirm(`Initiate outbound call to ${name} (${mobile}) via SecondMedic MyOperator dialer?`)) return;

    setCallingId(report.id);
    setCallStatus("");
    try {
      const res = await api<any>(`/reports/${report.id}/call`, { method: "POST" });
      setCallStatus(res.message || `Outgoing call initiated to ${name} (${mobile}) via MyOperator.`);
    } catch (err: any) {
      setCallStatus(err.message || "Failed to initiate outbound call.");
    } finally {
      setCallingId(null);
    }
  }

  const reports = (data || []).filter((r) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      (r.order_id && r.order_id.toLowerCase().includes(term)) ||
      (r.patient_name && r.patient_name.toLowerCase().includes(term)) ||
      (r.mobile && r.mobile.includes(term))
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Medical & Lab Reports</h1>
          <p className="text-xs text-slate-500">All customer reports extracted from LabTrace and lab uploads.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search patient, order, mobile…"
            aria-label="Search reports"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-teal-600 focus:outline-none"
          />
          <select
            aria-label="Filter by status"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
            value={status}
            onChange={(e) => router.replace(e.target.value ? `/reports?status_=${e.target.value}` : "/reports", { scroll: false })}
          >
            <option value="">All statuses</option>
            <option value="NEEDS_REVIEW">Needs review</option>
            <option value="READY">Ready</option>
          </select>
        </div>
      </div>

      {callStatus && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950">
          <div className="flex items-center gap-2">
            <span className="text-base">📞</span>
            <span>{callStatus}</span>
          </div>
          <button onClick={() => setCallStatus("")} className="text-xs font-bold text-teal-800 hover:underline">Dismiss</button>
        </div>
      )}

      <RequestState
        loading={!data}
        error={error}
        retry={reload}
        empty={data?.length === 0 ? (status ? "No reports match this status." : "No reports found.") : undefined}
      />

      {!error && !!reports.length && (
        <TableFrame label="Lab reports">
          <table className="w-full bg-white text-left text-sm shadow rounded-xl overflow-hidden">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="p-3">Order ID</th>
                <th>Patient Details</th>
                <th>Result</th>
                <th>Abnormal values</th>
                <th>Confidence</th>
                <th>Status</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const isAbnormal = r.classification === "ABNORMAL";
                const mobile = r.mobile || "9876543210";
                return (
                  <tr key={r.id} className="border-t hover:bg-slate-50/60 transition">
                    <td className="p-3">
                      <Link className="font-mono font-bold text-slate-900 underline hover:text-teal-700" href={`/reports/view?id=${r.id}`}>
                        {r.order_id}
                      </Link>
                    </td>
                    <td>
                      <div className="font-semibold text-slate-900">{r.patient_name || "Unknown Patient"}</div>
                      <div className="font-mono text-xs text-slate-500">{mobile}</div>
                    </td>
                    <td>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                          isAbnormal
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}
                      >
                        {r.classification || "NORMAL"}
                      </span>
                    </td>
                    <td className="font-medium text-slate-800">{r.abnormal_count}</td>
                    <td className="text-slate-600">{r.confidence}%</td>
                    <td>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                          r.needs_review
                            ? "bg-amber-100 text-amber-900 border border-amber-300"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {r.needs_review ? "Needs review" : r.status}
                      </span>
                    </td>
                    <td className="text-right p-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={callingId === r.id}
                          onClick={() => handleCall(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-2.5 py-1 text-xs font-bold text-white shadow-xs hover:bg-teal-800 transition disabled:opacity-50"
                          title="Place call via MyOperator"
                        >
                          <span>📞</span>
                          <span>{callingId === r.id ? "Calling…" : "Call"}</span>
                        </button>
                        <Link
                          href={`/reports/view?id=${r.id}`}
                          className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-200 transition"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading reports…</p>}>
      <Reports />
    </Suspense>
  );
}
