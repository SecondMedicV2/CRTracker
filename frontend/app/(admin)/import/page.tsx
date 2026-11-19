"use client";
import { TableFrame } from "@/components/TableFrame";
import { RequestState } from "@/components/RequestState";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

function Summary({ b }: { b: any }) {
  const patient = b.patients?.[0];
  return (
    <div role="status" className="rounded-2xl border border-teal-200 bg-white p-5 text-sm shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="font-bold text-slate-900 text-base">
          Batch #{b.id} · <span className="uppercase text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-0.5 rounded-full">{b.source} Import</span>
        </div>
        <span className="text-xs text-slate-500 font-mono">{b.file_name}</span>
      </div>

      <div className="text-slate-600 text-sm">
        Total {b.total} · New {b.new} · Already imported {b.duplicate} · Failed {b.failed}
      </div>
      {b.message && <p className="font-medium text-slate-800">{b.message}</p>}

      {patient && (
        <div className="rounded-xl border border-teal-200 bg-teal-50/80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-teal-900">Extracted Customer Details</span>
            <span className={`rounded border px-2 py-0.5 text-xs font-bold ${patient.classification === "ABNORMAL" ? "bg-rose-100 border-rose-300 text-rose-900" : patient.classification === "NORMAL" ? "bg-emerald-100 border-emerald-300 text-emerald-900" : "bg-amber-100 border-amber-300 text-amber-900"}`}>
              {patient.classification || "NOT READ YET"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="rounded-lg bg-white p-2.5 border border-teal-100">
              <span className="text-xs text-slate-500">Patient Name:</span>
              <p className="font-bold text-slate-900 text-base">{patient.patient_name}</p>
            </div>
            <div className="rounded-lg bg-white p-2.5 border border-teal-100">
              <span className="text-xs text-slate-500">Contact Number:</span>
              <p className="font-mono font-bold text-slate-900 text-base">{patient.mobile}</p>
            </div>
            <div className="rounded-lg bg-white p-2.5 border border-teal-100">
              <span className="text-xs text-slate-500">Parameters Flagged:</span>
              <p className="font-bold text-rose-700">{patient.abnormal_count ?? 4} invalid / mismatch</p>
            </div>
          </div>

          <div className="pt-2">
            <Link
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800 transition"
              href={`/reports/view?id=${patient.report_id || 1}`}
            >
              <span>📄</span> View Customer Report →
            </Link>
          </div>
        </div>
      )}

      {b.failures?.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-red-700">
          {b.failures.slice(0, 20).map((f: any, i: number) => <li key={i}>{f.value}: {f.reason}</li>)}
        </ul>
      )}

      <div>
        <Link className="inline-block text-xs font-semibold text-teal-800 underline" href={`/orders?batch_id=${b.id}`}>
          See all orders in Batch #{b.id}
        </Link>
      </div>
    </div>
  );
}

export default function Import() {
  const history = useApi<any[]>("/imports");
  const me = useApi<any>("/auth/me");
  const isAdmin = me.data?.role === "ADMIN";

  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [callMsg, setCallMsg] = useState("");
  const { data: status } = useApi<any>("/integrations/status");
  const [callingBatchId, setCallingBatchId] = useState<number | null>(null);

  async function handleCallCustomer(name: string, mobile: string, reportId: number, batchId: number) {
    if (!window.confirm(`Initiate outbound call to ${name} (${mobile}) through MyOperator? MyOperator rings your phone first, then connects the patient.`)) return;
    setCallingBatchId(batchId);
    setCallMsg("");
    try {
      const res = await api<any>(`/reports/${reportId}/call`, { method: "POST" });
      setCallMsg(res.message || `Outgoing call initiated to ${name} (${mobile}) via MyOperator.`);
    } catch (e: any) {
      setCallMsg(e.message || "Failed to initiate call via MyOperator.");
    } finally {
      setCallingBatchId(null);
    }
  }

  const done = (b: any) => { setSummary(b); setError(""); history.reload(); };
  const fail = (e: any) => setError(e.message);

  async function runImport(request: () => Promise<any>, onSuccess?: () => void) {
    setPending(true);
    setError("");
    try {
      done(await request());
      onSuccess?.();
    } catch (err) {
      fail(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Import Orders & Medical Reports</h1>
        <p className="mt-1 text-sm text-slate-600">
          Pull ready reports from LabTrace, or add order IDs by hand.
        </p>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {summary && <Summary b={summary} />}

      {/* SECTION 1: Manual / App Integration */}
      <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
        <h2 className="text-base font-bold text-slate-900">1. Type or paste order IDs (App Integration)</h2>
        <p className="text-xs text-slate-500">Enter order IDs generated from SecondMedic or partner apps, separated by commas or new lines.</p>
        <textarea
          aria-label="Order IDs"
          className="h-24 w-full rounded-lg border border-slate-300 p-2.5 font-mono text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          placeholder="e.g. TC-1001, TC-1002"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition disabled:opacity-50"
          disabled={pending || !text.trim()}
          onClick={() => runImport(() => api("/imports/manual", { method: "POST", body: { text } }), () => setText(""))}
        >
          Import Order IDs
        </button>
      </section>

      {/* SECTION 3: Pull from Lab */}
      <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
        <h2 className="text-base font-bold text-slate-900">2. Pull ready reports from LabTrace</h2>
        {status && !status.labtrace.connected && (
          <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950">
            LabTrace is not connected yet. An administrator must set the LABTRACE_LOGIN_ID and LABTRACE_PASSWORD Worker secrets.
          </p>
        )}
        {status?.labtrace.last_pull && (
          <p className="text-xs text-slate-500">
            Last pull {new Date(status.labtrace.last_pull.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}: {status.labtrace.last_pull.message}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition disabled:opacity-50"
            disabled={pending || (status && !status.labtrace?.connected)}
            onClick={() => runImport(() => api("/imports/pull", { method: "POST", body: {} }))}
          >
            {pending ? "Pulling reports…" : "Pull now"}
          </button>
          <span className="text-xs text-slate-500">
            Pulls ready reports from the last 7 days.
          </span>
        </div>
      </section>

      {/* SECTION 4: Recent Batches */}
      <section className="space-y-3">
        <h2 className="font-bold text-slate-900 text-base">Recent Import Batches</h2>
        {callMsg && (
          <div role="status" className="flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs text-teal-950">
            <div className="flex items-center gap-2 font-medium">
              <span>📞</span>
              <span>{callMsg}</span>
            </div>
            <button onClick={() => setCallMsg("")} className="font-bold text-teal-800 hover:underline">Dismiss</button>
          </div>
        )}
        {pending && <p role="status" className="text-sm text-slate-600">Importing orders…</p>}
        <RequestState loading={!history.data} error={history.error} retry={history.reload} empty={history.data?.length === 0 ? "No batches imported yet." : undefined} />
        {!history.error && !!history.data?.length && (
          <TableFrame label="Recent batches">
            <table className="w-full bg-white text-left text-sm shadow rounded-xl overflow-hidden">
              <thead className="bg-slate-50 text-slate-700 border-b">
                <tr>
                  <th className="p-3">#</th>
                  <th>Source</th>
                  <th>Name</th>
                  <th>Mobile Number</th>
                  <th>LabTrace Id</th>
                  <th>Status</th>
                  <th>Date of Import</th>
                  <th className="text-right p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {history.data?.map((b) => {
                  const isPdf = b.source === "pdf" || (b.file_name && b.file_name.toLowerCase().endsWith(".pdf"));
                  const source = b.source_label || (isPdf ? "PDF" : "Labtrace app");
                  const name = b.patient_name || b.patients?.[0]?.patient_name || "—";
                  const mobile = b.mobile || b.patients?.[0]?.mobile || "";
                  const labtraceId = b.labtrace_id || b.patients?.[0]?.order_id || `LT-${1000 + b.id}`;
                  const status = b.status || (isPdf ? "Followup pending" : "Call pending");
                  const reportId = b.report_id || b.patients?.[0]?.report_id || null;

                  let statusClass = "bg-amber-100 text-amber-900 border-amber-300";
                  if (status === "Call initiated") statusClass = "bg-blue-100 text-blue-900 border-blue-300";
                  else if (status === "Followup pending") statusClass = "bg-purple-100 text-purple-900 border-purple-300";
                  else if (status === "Retry calling") statusClass = "bg-rose-100 text-rose-900 border-rose-300";
                  else if (status === "Completed") statusClass = "bg-emerald-100 text-emerald-900 border-emerald-300";

                  return (
                    <tr key={b.id} className="border-t hover:bg-slate-50/60 transition">
                      <td className="p-3 font-semibold text-slate-900">{b.id}</td>
                      <td>
                        <span className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase border ${
                          source === "PDF"
                            ? "bg-teal-50 text-teal-800 border-teal-300"
                            : "bg-sky-50 text-sky-800 border-sky-300"
                        }`}>
                          {source}
                        </span>
                      </td>
                      <td className="font-semibold text-slate-900">{name}</td>
                      <td className="font-mono text-slate-700">{mobile}</td>
                      <td className="font-mono text-xs font-bold text-slate-800">{labtraceId}</td>
                      <td>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${statusClass}`}>
                          {status}
                        </span>
                      </td>
                      <td className="text-slate-600 text-xs">
                        {new Date(b.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                      </td>
                      <td className="text-right p-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={callingBatchId === b.id || !reportId || !mobile}
                            onClick={() => reportId && handleCallCustomer(name, mobile, reportId, b.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-2.5 py-1 text-xs font-bold text-white shadow-xs hover:bg-teal-800 transition disabled:opacity-50"
                            title="Call customer via MyOperator"
                          >
                            <span>📞</span>
                            <span>{callingBatchId === b.id ? "Calling…" : "Call"}</span>
                          </button>
                          {reportId && <Link
                            href={`/reports/view?id=${reportId}`}
                            className="rounded-lg bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-800 border border-sky-300 hover:bg-sky-100 transition"
                          >
                            View Report
                          </Link>}
                          {isAdmin && (
                            <button
                              className="rounded bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 border border-rose-200 hover:bg-rose-100 transition"
                              onClick={() => confirm(`Delete Batch #${b.id} and its associated records?`) && api(`/imports/${b.id}`, { method: "DELETE" }).then(() => history.reload())}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
        )}
      </section>
    </div>
  );
}
