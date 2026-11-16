"use client";
import { useState, useContext, useEffect } from "react";
import { RoleContext } from "@/lib/navigation";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Defect = {
  param_id: number | null;
  param_code: string | null;
  param_name: string;
  status: "LOW" | "HIGH" | "REVIEW_REQUIRED" | "IN_RANGE";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NORMAL";
  value: string;
  unit: string;
  reference: string;
  what_it_measures: string;
  explanation: string;
  related_param_ids: number[];
};

type MonitoringTest = {
  code: string;
  name: string;
  reason: string;
};

type InsightContent = {
  overview: string;
  defects: Defect[];
  suggestions: {
    doctor_discussion_points: string[];
    caller_questions: string[];
    clarifications_for_doctor: string[];
  };
  priority_to_connect_doctor: {
    priority: "URGENT" | "PRIORITY" | "ROUTINE";
    source: "rule" | "ai";
    reason: string;
    connect_within_hours: number;
  };
  future_suggestions: {
    monitoring_tests: MonitoringTest[];
    suggested_followup_window_days: number;
    trend_notes: string[];
    watch_markers: string[];
  };
  red_flag_protocol: string[];
  limitations: string[];
};

type InsightData = {
  id: number;
  report_id: number;
  status: "DRAFT" | "APPROVED" | "REJECTED";
  content_version: string;
  provider: string;
  model: string;
  prompt_version: string;
  input_hash: string;
  created_at: string | null;
  reviewed_at: string | null;
  reviewed_by_user_id: number | null;
  review_notes: string | null;
  content: InsightContent;
};

export default function ReportInsights({ reportId }: { reportId: number | string }) {
  const role = useContext(RoleContext);
  const isClinician = role === "ADMIN" || role === "DOCTOR";
  const { data: ins, error, reload } = useApi<InsightData>(`/reports/${reportId}/insight`);
  const [editing, setEditing] = useState(false);
  const [overviewDraft, setOverviewDraft] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ins?.content?.overview) {
      setOverviewDraft(ins.content.overview);
    }
  }, [ins?.content?.overview]);

  if (error) {
    if (role === "CALLER") {
      return (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p className="font-medium text-slate-800">Report insights</p>
          <p className="mt-1">Insights for this report are pending doctor review and approval.</p>
        </section>
      );
    }
    return (
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
        <p className="font-semibold text-amber-900">No AI insight available yet</p>
        <p className="mt-1 text-amber-800">{error}</p>
        {isClinician && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg("");
              try {
                await api(`/reports/${reportId}/insight/regenerate`, { method: "POST" });
                reload();
              } catch (e: any) {
                setMsg(e.message);
              } finally {
                setBusy(false);
              }
            }}
            className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Generating…" : "Generate AI Insight"}
          </button>
        )}
        {msg && <p className="mt-2 text-xs text-red-600">{msg}</p>}
      </section>
    );
  }

  if (!ins) return null;

  const c = ins.content;
  const p = c.priority_to_connect_doctor;
  const isDraft = ins.status === "DRAFT";
  const isApproved = ins.status === "APPROVED";

  async function handleApprove() {
    setBusy(true);
    setMsg("");
    try {
      await api(`/reports/${reportId}/insight/approve`, {
        method: "POST",
        body: { review_notes: reviewNotes || undefined },
      });
      setReviewNotes("");
      reload();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    setMsg("");
    try {
      await api(`/reports/${reportId}/insight/reject`, {
        method: "POST",
        body: { review_notes: reviewNotes || undefined },
      });
      setReviewNotes("");
      reload();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit() {
    setBusy(true);
    setMsg("");
    try {
      await api(`/reports/${reportId}/insight`, {
        method: "PATCH",
        body: {
          content: { ...c, overview: overviewDraft },
          review_notes: reviewNotes || undefined,
        },
      });
      setEditing(false);
      reload();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    setBusy(true);
    setMsg("");
    try {
      await api(`/reports/${reportId}/insight/regenerate`, { method: "POST" });
      setEditing(false);
      reload();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const priorityStyles = {
    URGENT: "bg-red-600 text-white border-red-700",
    PRIORITY: "bg-amber-500 text-white border-amber-600",
    ROUTINE: "bg-slate-700 text-white border-slate-800",
  }[p.priority] ?? "bg-slate-700 text-white";

  return (
    <section aria-labelledby="insights-heading" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="insights-heading" className="text-lg font-semibold text-slate-900">
            AI Report Insights
          </h2>
          {isDraft && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
              AI draft – doctor review required
            </span>
          )}
          {isApproved && (
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
              Doctor approved
            </span>
          )}
          {ins.status === "REJECTED" && (
            <span className="rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-900">
              Rejected
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${priorityStyles}`}>
            {p.priority} · {p.connect_within_hours}h
          </span>
          <span className="text-xs text-slate-500">
            Source: <strong className="font-semibold text-slate-700">{p.source === "rule" ? "Doctor critical rule" : "AI assessment"}</strong>
          </span>
        </div>
      </div>

      {/* Priority Reason Banner */}
      <div className={`rounded-lg border p-3 text-sm ${p.priority === "URGENT" ? "border-red-300 bg-red-50 text-red-950" : p.priority === "PRIORITY" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-50 text-slate-800"}`}>
        <p className="font-medium">
          Priority assessment: <span className="font-normal">{p.reason}</span>
        </p>
      </div>

      {/* Clinician Action Toolbar */}
      {isClinician && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {isDraft && (
              <>
                <button
                  disabled={busy}
                  onClick={handleApprove}
                  className="rounded bg-emerald-700 px-3 py-1.5 font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50"
                >
                  Approve insight
                </button>
                <button
                  disabled={busy}
                  onClick={handleReject}
                  className="rounded bg-rose-700 px-3 py-1.5 font-semibold text-white shadow-sm hover:bg-rose-800 disabled:opacity-50"
                >
                  Reject insight
                </button>
                <button
                  disabled={busy}
                  onClick={() => setEditing(!editing)}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  {editing ? "Cancel edit" : "Edit overview"}
                </button>
              </>
            )}
            <button
              disabled={busy}
              onClick={handleRegenerate}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {busy ? "Working…" : "Regenerate"}
            </button>
          </div>
          {isDraft && (
            <input
              type="text"
              placeholder="Doctor review note (optional)"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              className="w-64 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            />
          )}
        </div>
      )}

      {msg && <p role="alert" className="text-xs text-red-600">{msg}</p>}

      {/* Clinical Overview */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">Clinical Overview</h3>
        {editing ? (
          <div className="space-y-2">
            <textarea
              className="w-full rounded border border-slate-300 p-2 text-sm text-slate-900"
              rows={4}
              value={overviewDraft}
              onChange={(e) => setOverviewDraft(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={handleSaveEdit}
                className="rounded bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
              >
                Save overview
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setOverviewDraft(c.overview);
                }}
                className="rounded border px-3 py-1 text-xs text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-slate-700">{c.overview}</p>
        )}
      </div>

      {/* Defects & Deviations (Hidden for CALLER) */}
      {c.defects && c.defects.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Detected Deviations &amp; Abnormalities ({c.defects.length})
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {c.defects.map((d, i) => {
              const statusPills: Record<string, string> = {
                LOW: "bg-blue-100 text-blue-900 border-blue-300",
                HIGH: "bg-red-100 text-red-900 border-red-300",
                REVIEW_REQUIRED: "bg-amber-100 text-amber-900 border-amber-300",
                IN_RANGE: "bg-slate-100 text-slate-800 border-slate-200",
              };
              const severityPills: Record<string, string> = {
                CRITICAL: "bg-red-700 text-white",
                HIGH: "bg-rose-600 text-white",
                MEDIUM: "bg-amber-600 text-white",
                LOW: "bg-slate-600 text-white",
                NORMAL: "bg-slate-400 text-white",
              };
              return (
                <div key={i} className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <strong className="text-sm font-semibold text-slate-900">
                        {d.param_name}
                      </strong>
                      <div className="flex items-center gap-1">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusPills[d.status] || ""}`}>
                          {d.status}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${severityPills[d.severity] || ""}`}>
                          {d.severity}
                        </span>
                      </div>
                    </div>
                    <div className="text-slate-600">
                      Value: <strong className="text-slate-900">{d.value} {d.unit}</strong> (Ref: {d.reference})
                    </div>
                    <p className="text-slate-700">
                      <span className="font-medium text-slate-900">What it measures: </span>
                      {d.what_it_measures}
                    </p>
                    <p className="text-slate-700">
                      <span className="font-medium text-slate-900">Clinical context: </span>
                      {d.explanation}
                    </p>
                  </div>
                  {d.related_param_ids && d.related_param_ids.length > 0 && (
                    <div className="mt-2 border-t border-slate-200 pt-1.5 text-[11px] text-slate-500">
                      <span>Related findings: </span>
                      {d.related_param_ids.map((relId) => (
                        <a
                          key={relId}
                          href={`#param-${relId}`}
                          className="mr-1 inline-block rounded bg-teal-100 px-1 py-0.2 font-medium text-teal-800 underline hover:bg-teal-200"
                        >
                          #test-{relId}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Suggestions Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Actionable Suggestions</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Doctor Discussion Points (Clinicians only) */}
          {isClinician && c.suggestions?.doctor_discussion_points?.length > 0 && (
            <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3 text-xs text-teal-950">
              <h4 className="font-semibold text-teal-900">Doctor Discussion Points</h4>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                {c.suggestions.doctor_discussion_points.map((pt, i) => (
                  <li key={i}>{pt}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Caller-Safe Questions (Both clinicians and callers) */}
          {c.suggestions?.caller_questions?.length > 0 && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 text-xs text-indigo-950">
              <h4 className="font-semibold text-indigo-900">
                Caller Questions (Symptoms, Lifestyle, Diet, Meds)
              </h4>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                {c.suggestions.caller_questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Clarifications for Doctor (Clinicians only) */}
          {isClinician && c.suggestions?.clarifications_for_doctor?.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 sm:col-span-2">
              <h4 className="font-semibold text-slate-900">Clinical Clarifications</h4>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                {c.suggestions.clarifications_for_doctor.map((cl, i) => (
                  <li key={i}>{cl}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Future Suggestions & Monitoring */}
      <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-semibold text-slate-900">Future Monitoring &amp; Follow-up</h4>
          <span className="font-medium text-teal-800">
            Suggested review window: {c.future_suggestions?.suggested_followup_window_days ?? 90} days
          </span>
        </div>
        {c.future_suggestions?.monitoring_tests?.length > 0 && (
          <div className="space-y-1 pt-1">
            <span className="text-slate-600">Catalogue monitoring tests:</span>
            <div className="flex flex-wrap gap-1.5">
              {c.future_suggestions.monitoring_tests.map((m, i) => (
                <span
                  key={i}
                  title={m.reason}
                  className="rounded border border-teal-200 bg-white px-2 py-0.5 text-xs text-teal-900 shadow-sm"
                >
                  <strong className="font-medium">{m.name}</strong> ({m.code}): {m.reason}
                </span>
              ))}
            </div>
          </div>
        )}
        {c.future_suggestions?.watch_markers?.length > 0 && (
          <p className="text-slate-600">
            <span className="font-medium text-slate-800">Watch markers: </span>
            {c.future_suggestions.watch_markers.join(", ")}
          </p>
        )}
        {c.future_suggestions?.trend_notes?.length > 0 && (
          <ul className="list-disc pl-4 text-slate-600">
            {c.future_suggestions.trend_notes.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Red Flag Warning Protocol */}
      {c.red_flag_protocol?.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-950">
          <h4 className="font-bold uppercase tracking-wide text-red-900">
            Red Flag Warning Protocol
          </h4>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 font-medium">
            {c.red_flag_protocol.map((rf, i) => (
              <li key={i}>{rf}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer / Limitations & Audit trail */}
      <div className="space-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
        {c.limitations?.length > 0 && (
          <p className="italic text-slate-600">
            {c.limitations.join(" ")}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-slate-400">
          <span>
            Engine: {ins.provider} ({ins.model}) · prompt v{ins.prompt_version} · hash {ins.input_hash.slice(0, 10)}…
          </span>
          {ins.reviewed_at && (
            <span>
              Reviewed: {new Date(ins.reviewed_at).toLocaleString("en-IN")} by user #{ins.reviewed_by_user_id}
              {ins.review_notes && ` ("${ins.review_notes}")`}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
