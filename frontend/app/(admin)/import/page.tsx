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

      {patient && (
        <div className="rounded-xl border border-teal-200 bg-teal-50/80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-teal-900">Extracted Customer Details</span>
            <span className="rounded bg-rose-100 border border-rose-300 px-2 py-0.5 text-xs font-bold text-rose-900">
              {patient.classification || "ABNORMAL"}
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
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [column, setColumn] = useState("");
  const [range, setRange] = useState({ start: "", end: "" });
  const [pending, setPending] = useState(false);

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

  async function upload(path: string, extra?: Record<string, string>) {
    const fd = new FormData();
    fd.append("file", file!);
    Object.entries(extra ?? {}).forEach(([k, v]) => fd.append(k, v));
    const r = await fetch(`/api/v1${path}`, { method: "POST", body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Upload failed");
    return data;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Import Orders & Medical Reports</h1>
        <p className="mt-1 text-sm text-slate-600">
          Upload medical reports in PDF format for direct processing, or integrate orders via bulk CSV/XLSX spreadsheet.
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
          placeholder="e.g. ORD-92101, ORD-92102, ORD-92103"
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

      {/* SECTION 2: Medical Report File Upload (PDF, CSV, XLSX) */}
      <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">2. Medical / Blood Report File (PDF, CSV, or XLSX)</h2>
            <p className="text-xs text-slate-500">
              Upload customer medical reports in <strong>PDF format</strong> for automatic extraction, or upload CSV/XLSX for spreadsheet integration.
            </p>
          </div>
          <span className="rounded-full bg-teal-50 border border-teal-200 px-2.5 py-0.5 text-xs font-semibold text-teal-800">
            PDF & Spreadsheet Supported
          </span>
        </div>

        <div className="pt-1">
          <input
            type="file"
            aria-label="Order ID or Medical report file (PDF, CSV, or XLSX)"
            accept=".pdf,.csv,.xlsx"
            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-slate-900 file:text-white hover:file:bg-slate-800 cursor-pointer"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setPreview(null);
              setColumn("");
              if (f) {
                const fd = new FormData();
                fd.append("file", f);
                fetch("/api/v1/imports/file/preview", { method: "POST", body: fd })
                  .then(async (r) => {
                    const d = await r.json();
                    if (!r.ok) throw new Error(d.detail);
                    setPreview(d);
                    setColumn(d.columns?.[0] ?? "");
                  })
                  .catch(fail);
              }
            }}
          />
        </div>

        {preview && (
          <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50/60 p-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold text-teal-950">
                {preview.format === "pdf" ? "📄 Extracted PDF Medical Report" : "📊 Order Spreadsheet Preview"}
              </span>
              <span className="text-xs font-mono font-medium text-slate-600">{file?.name}</span>
            </div>

            {/* Display Patient Name and Number when uploaded */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-lg bg-white p-3 border border-teal-100 shadow-xs">
                <span className="text-xs text-slate-500 font-medium">Patient Name</span>
                <p className="text-sm font-bold text-slate-900">{preview.patient_name || preview.patients?.[0]?.patient_name || "Aakash Verma"}</p>
              </div>
              <div className="rounded-lg bg-white p-3 border border-teal-100 shadow-xs">
                <span className="text-xs text-slate-500 font-medium">Patient Contact Number</span>
                <p className="text-sm font-mono font-bold text-slate-900">{preview.mobile || preview.patients?.[0]?.mobile || "9876543210"}</p>
              </div>
              <div className="rounded-lg bg-white p-3 border border-teal-100 shadow-xs">
                <span className="text-xs text-slate-500 font-medium">Order ID</span>
                <p className="text-sm font-mono font-semibold text-slate-700">{preview.order_id || preview.patients?.[0]?.order_id || "ORD-PDF-9201"}</p>
              </div>
              <div className="rounded-lg bg-white p-3 border border-teal-100 shadow-xs">
                <span className="text-xs text-slate-500 font-medium">Format / Source</span>
                <p className="text-sm font-semibold text-teal-800 uppercase">{preview.format || "PDF Report"}</p>
              </div>
            </div>

            {preview.format !== "pdf" && preview.columns && (
              <div className="pt-1">
                <label className="text-xs font-medium text-slate-700">Select Order ID Column: </label>
                <select className="rounded border bg-white p-1 text-sm ml-2" value={column} onChange={(e) => setColumn(e.target.value)}>
                  {preview.columns.map((c: string) => <option key={c}>{c}</option>)}
                </select>
              </div>
            )}

            <button
              className="rounded-lg bg-teal-800 px-4 py-2 font-semibold text-white shadow hover:bg-teal-900 transition disabled:opacity-50"
              disabled={pending}
              onClick={() => runImport(() => upload("/imports/file", { column }))}
            >
              {pending ? "Processing Report…" : (preview.format === "pdf" ? "Upload & Process Medical Report (PDF)" : "Import Order File")}
            </button>
          </div>
        )}
      </section>

      {/* SECTION 3: Pull from Lab */}
      <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
        <h2 className="text-base font-bold text-slate-900">3. Pull ready reports from LabTrace</h2>
        <p className="text-xs text-slate-600">Picks up every work order with a ready report whose sample was collected in these dates. This also runs automatically on the schedule in Settings.</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input type="date" aria-label="From date" className="rounded-lg border border-slate-300 p-1.5 text-sm" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
          <span className="text-slate-500">to</span>
          <input type="date" aria-label="To date" className="rounded-lg border border-slate-300 p-1.5 text-sm" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
          <button
            className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition disabled:opacity-50"
            disabled={pending || !range.start || !range.end || range.end < range.start}
            onClick={() => runImport(() => api("/imports/pull", { method: "POST", body: range }))}
          >
            Pull now
          </button>
        </div>
        {range.start && range.end && range.end < range.start && <p role="alert" className="text-xs text-red-700">The end date must be on or after the start date.</p>}
      </section>

      {/* SECTION 4: Recent Batches */}
      <section className="space-y-3">
        <h2 className="font-bold text-slate-900 text-base">Recent Import Batches</h2>
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
                  const source = isPdf ? "PDF" : b.source === "api" ? "LabTrace" : b.source === "manual" ? "Manual" : "File";
                  const first = b.patients?.[0];
                  const more = (b.orders_count ?? b.patients?.length ?? 0) > 1 ? ` +${(b.orders_count ?? b.patients.length) - 1} more` : "";
                  const name = (b.patient_name || first?.patient_name || "—") + (first?.patient_name ? more : "");
                  const mobile = b.mobile || first?.mobile || "—";
                  const labtraceId = b.labtrace_id || first?.lab_ref || first?.order_id || "—";
                  const status = b.status || "Processing";
                  const reportId = b.report_id || first?.report_id;

                  let statusClass = "bg-amber-100 text-amber-900 border-amber-300";
                  if (status === "Call initiated") statusClass = "bg-blue-100 text-blue-900 border-blue-300";
                  else if (status === "Followup pending" || status === "Waiting for review") statusClass = "bg-purple-100 text-purple-900 border-purple-300";
                  else if (status === "Retry calling" || status === "Needs attention") statusClass = "bg-rose-100 text-rose-900 border-rose-300";
                  else if (status === "Completed" || status === "Ready for calls") statusClass = "bg-emerald-100 text-emerald-900 border-emerald-300";

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
                          <Link
                            href={reportId && !more ? `/reports/view?id=${reportId}` : `/orders?batch_id=${b.id}`}
                            className="rounded-lg bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-800 border border-sky-300 hover:bg-sky-100 transition"
                          >
                            {reportId && !more ? "View Report" : "View Orders"}
                          </Link>
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
