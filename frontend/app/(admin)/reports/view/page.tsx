"use client";
import Link from "next/link";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import { useSearchParams } from "next/navigation";
import { Suspense, useContext } from "react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { RoleContext } from "@/lib/navigation";
import ComparisonPanel from "@/components/ComparisonPanel";
import ReportInsights from "@/components/ReportInsights";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function ReportViewInner({ id }: { id: string }) {
  const role = useContext(RoleContext);
  const isClinician = role === "ADMIN" || role === "DOCTOR";
  const { data: r, error, reload } = useApi<any>(`/reports/${id}`);
  const [msg, setMsg] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [calling, setCalling] = useState(false);
  const [callMsg, setCallMsg] = useState("");
  const [filterMode, setFilterMode] = useState<"invalid_only" | "all">("invalid_only");

  if (error || !r) return <RequestState loading={!r} error={error} retry={reload} />;
  const review = r.status === "NEEDS_REVIEW" || r.needs_review;
  const run = (p: Promise<any>) => p.then(() => { setMsg(""); reload(); }).catch((e) => setMsg(e.message));

  async function handleExtract() {
    setExtracting(true);
    setMsg("");
    try {
      await api(`/reports/${id}/extract`, { method: "POST" });
      reload();
    } catch (err: any) {
      setMsg(err.message || "Failed to read values from PDF.");
    } finally {
      setExtracting(false);
    }
  }

  async function callCustomer() {
    const mobile = r.mobile || "9876543210";
    const name = r.patient_name || "Customer";
    if (!window.confirm(`Initiate outbound call to ${name} (${mobile}) via SecondMedic MyOperator dialer?`)) return;

    setCalling(true);
    setCallMsg("");
    try {
      const res = await api<any>(`/reports/${id}/call`, { method: "POST" });
      setCallMsg(res.message || `Outgoing call placed to ${name} (${mobile}) via MyOperator.`);
    } catch (err: any) {
      setCallMsg(err.message || "Failed to initiate call via MyOperator.");
    } finally {
      setCalling(false);
    }
  }

  const parameters = r.parameters || [];
  const isInvalid = (p: any) =>
    p.system_flag === "LOW" ||
    p.system_flag === "HIGH" ||
    p.lab_flag === "HIGH" ||
    p.lab_flag === "LOW" ||
    !p.param_code ||
    (p.deviation_pct != null && p.deviation_pct !== 0);

  const invalidParams = parameters.filter(isInvalid);
  const displayedParams = filterMode === "invalid_only" ? invalidParams : parameters;

  const badgeClass = !r.classification
    ? "bg-slate-100 text-slate-700 border border-slate-200"
    : r.needs_review
    ? "bg-amber-100 text-amber-800 border border-amber-200"
    : r.classification === "ABNORMAL"
    ? "bg-rose-100 text-rose-800 border border-rose-200"
    : "bg-emerald-100 text-emerald-800 border border-emerald-200";

  const badgeText = !r.classification
    ? "NOT READ YET"
    : r.needs_review
    ? "NEEDS REVIEW"
    : r.classification === "ABNORMAL"
    ? "ABNORMAL FINDINGS"
    : "NORMAL";

  return (
    <div className="space-y-6">
      {/* Customer Details Card */}
      <section aria-labelledby="customer-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-teal-700">Customer Report</span>
            <h1 id="customer-heading" className="mt-0.5 text-2xl font-bold text-slate-900">{r.patient_name || "Unknown Patient"}</h1>
            <p className="mt-1 font-mono text-sm text-slate-500">Order ID: <span className="font-semibold text-slate-800">{r.order_id}</span></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {r.pdf_url && (
              <a
                href={r.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-xl border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-900 hover:bg-teal-100 transition"
              >
                <span>📄</span> View PDF
              </a>
            )}
            {parameters.length === 0 && (
              <button
                type="button"
                disabled={extracting}
                onClick={handleExtract}
                className="inline-flex items-center gap-1.5 rounded-xl bg-teal-800 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-teal-900 transition disabled:opacity-50"
              >
                <span>⚡</span>
                <span>{extracting ? "Reading PDF…" : "Read values from PDF"}</span>
              </button>
            )}
            <button
              type="button"
              disabled={calling}
              onClick={callCustomer}
              className="inline-flex items-center gap-1.5 rounded-xl bg-teal-800 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-teal-900 transition disabled:opacity-50"
            >
              <span>📞</span>
              <span>{calling ? "Calling…" : "Call Patient (MyOperator)"}</span>
            </button>
            <a
              href={`tel:${r.mobile || "9876543210"}`}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              title="Direct device phone dial"
            >
              <span>📱</span> Dial
            </a>
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${badgeClass}`}>
              {badgeText}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {r.status}
            </span>
          </div>
        </div>

        {callMsg && (
          <div role="status" className="mt-3 flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs text-teal-950">
            <div className="flex items-center gap-2 font-medium">
              <span>📞</span>
              <span>{callMsg}</span>
            </div>
            <button onClick={() => setCallMsg("")} className="font-bold text-teal-800 hover:underline">Dismiss</button>
          </div>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 lg:grid-cols-5">
          <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
            <dt className="text-xs font-medium text-slate-500">Mobile Number</dt>
            <dd className="mt-1 font-mono font-semibold text-slate-900">{r.mobile || "9876543210"}</dd>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
            <dt className="text-xs font-medium text-slate-500">Age & Gender</dt>
            <dd className="mt-1 font-semibold text-slate-900">{r.age ? `${r.age} yrs` : "Age ?"} · {r.gender === "M" ? "Male" : r.gender === "F" ? "Female" : r.gender || "Gender ?"}</dd>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
            <dt className="text-xs font-medium text-slate-500">Laboratory</dt>
            <dd className="mt-1 font-medium text-slate-900 truncate" title={r.lab}>{r.lab || "Thyrocare"}</dd>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
            <dt className="text-xs font-medium text-slate-500">Collected Date</dt>
            <dd className="mt-1 font-medium text-slate-900">
              {r.collected_on ? new Date(r.collected_on).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "N/A"}
            </dd>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 border border-slate-100 col-span-2 sm:col-span-1">
            <dt className="text-xs font-medium text-slate-500">AI Confidence</dt>
            <dd className="mt-1 font-semibold text-teal-700">{r.confidence != null ? `${r.confidence}%` : "—"}</dd>
          </div>
        </dl>
      </section>

      {review && (
        <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">Needs review ({r.confidence != null ? `${r.confidence}%` : "—"} confidence): {r.review_reasons?.join("; ") || "Awaiting clinical review"}</div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <select aria-label="Gender" className="rounded border bg-white p-1 text-sm" value={r.gender || ""} onChange={(e) => run(api(`/reports/${id}`, { method: "PATCH", body: { gender: e.target.value } }))}>
              <option value="">Gender?</option><option value="M">Male</option><option value="F">Female</option>
            </select>
            <input aria-label="Age" className="w-20 rounded border bg-white p-1 text-sm" type="number" placeholder="Age" defaultValue={r.age ?? ""}
              onBlur={(e) => e.target.value && run(api(`/reports/${id}`, { method: "PATCH", body: { age: Number(e.target.value) } }))} />
            <button className="rounded bg-slate-900 px-3 py-1 text-white hover:bg-slate-800" onClick={() => run(api(`/reports/${id}/approve`, { method: "POST" }))}>Approve and continue</button>
          </div>
        </div>
      )}
      {msg && <p role="alert" className="text-sm font-medium text-red-600">{msg}</p>}

      <ComparisonPanel endpoint={`/reports/${id}/compare`} onUpdated={reload} />

      {/* Test Parameters / Blood Report Results */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Blood Report Results</h2>
            <p className="text-xs text-slate-500">
              {parameters.length === 0 ? (
                <span className="font-semibold text-amber-700">
                  {r.extract_status === "PENDING"
                    ? "Reading the PDF…"
                    : r.extract_status === "NO_TEXT"
                    ? "PDF has no readable text (scanned). Open the PDF and enter values."
                    : r.extract_status === "NO_PDF"
                    ? "PDF not in LabTrace yet — will retry automatically."
                    : r.extract_status === "FAILED"
                    ? "Could not read the PDF — retry."
                    : "No test results read from the PDF yet."}
                </span>
              ) : invalidParams.length > 0 ? (
                <span><span className="font-semibold text-rose-700">{invalidParams.length} parameter{invalidParams.length > 1 ? "s" : ""}</span> identified with invalid, out-of-range, or mismatched results.</span>
              ) : (
                <span>All parameters are within normal reference ranges.</span>
              )}
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-medium">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 transition ${
                filterMode === "invalid_only" ? "bg-white font-bold text-rose-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
              onClick={() => setFilterMode("invalid_only")}
            >
              Only Invalid / Mismatch ({invalidParams.length})
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 transition ${
                filterMode === "all" ? "bg-white font-bold text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
              onClick={() => setFilterMode("all")}
            >
              All Results ({parameters.length})
            </button>
          </div>
        </div>

        <TableFrame label="Report parameters">
          <table className="w-full bg-white text-left text-sm shadow rounded-xl overflow-hidden">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="p-3">Test Parameter</th>
                <th>Result Value</th>
                <th>Unit</th>
                <th>Reference Range</th>
                <th>Flag / Status</th>
                <th>Deviation</th>
              </tr>
            </thead>
            <tbody>
              {displayedParams.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-sm text-slate-500">
                    {parameters.length === 0
                      ? "No test parameters have been read from the PDF yet. Click 'Read values from PDF' above."
                      : "No invalid or mismatched parameters found in this report."}
                  </td>
                </tr>
              ) : (
                displayedParams.map((p: any) => {
                  const out = isInvalid(p);
                  return (
                    <tr
                      key={p.id}
                      className={`border-t transition ${
                        out
                          ? "bg-rose-50/90 font-medium text-rose-950 border-l-4 border-l-rose-600"
                          : "bg-white text-slate-800 hover:bg-slate-50/80 border-l-4 border-l-transparent"
                      }`}
                    >
                      <td className="p-3">
                        <span className={out ? "font-bold text-rose-950" : "font-normal"}>{p.param_name_raw}</span>
                        {!p.param_code && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">Mismatched Name</span>}
                      </td>
                      <td className={out ? "font-bold text-rose-700 text-base" : ""}>
                        {review ? (
                          <input
                            aria-label={`Value of ${p.param_name_raw}`}
                            className="w-24 rounded border p-1 text-sm bg-white"
                            defaultValue={p.value_text}
                            onBlur={(e) => e.target.value !== p.value_text && run(api(`/reports/${id}/parameters/${p.id}`, { method: "PATCH", body: { value: e.target.value } }))}
                          />
                        ) : (
                          p.value_text
                        )}
                      </td>
                      <td className="text-slate-600">{p.unit}</td>
                      <td className="text-slate-600">{p.ref_text || (p.ref_source === "fallback" ? "admin table" : "—")}</td>
                      <td>
                        {out ? (
                          <span className="inline-flex items-center rounded-md border border-rose-300 bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-900">
                            {p.system_flag || p.lab_flag || "DEFICIT"} {p.severity ? `· ${p.severity}` : ""}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            NORMAL
                          </span>
                        )}
                      </td>
                      <td className="font-mono text-xs">
                        {p.deviation_pct != null ? (
                          <span className={out ? "font-bold text-rose-700" : "text-slate-500"}>
                            {p.deviation_pct > 0 ? `+${p.deviation_pct}%` : `${p.deviation_pct}%`}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableFrame>
      </section>

      <ErrorBoundary fallback={<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Insights could not be loaded</div>}>
        <ReportInsights reportId={id} />
      </ErrorBoundary>
      <p className="text-xs text-slate-500">The original PDF viewer arrives once real Thyrocare PDFs are available.</p>
    </div>
  );
}


function Detail() {
  const id = useSearchParams().get("id");
  return (
    <div className="space-y-4">
      <Link className="inline-block text-sm font-medium text-teal-800 underline" href="/reports">Back to Reports</Link>
      {id && /^\d+$/.test(id) ? <ReportViewInner key={id} id={id} /> : <p role="alert">Open a record from Reports.</p>}
    </div>
  );
}

export default function ReportView() {
  return <Suspense fallback={<p role="status">Loading…</p>}><Detail /></Suspense>;
}
