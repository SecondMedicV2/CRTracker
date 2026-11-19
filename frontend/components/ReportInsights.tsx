"use client";
import { useState, useContext, useEffect } from "react";
import { RoleContext } from "@/lib/navigation";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Defect = {
  ref?: string;
  marker: string;
  status: string;
  severity?: string;
  what_it_measures?: string;
  explanation?: string;
  related_refs?: string[];
  priority?: "HIGH" | "MEDIUM" | "LOW" | string;
};

type DoctorConnect = {
  priority: "URGENT" | "PRIORITY" | "ROUTINE" | string;
  source: "rule" | "ai" | string;
  reason: string;
  connect_within_hours: number;
};

type Suggestions = {
  doctor_discussion?: string[];
  caller_questions?: string[];
  clarifications_for_doctor?: string[];
};

type FutureSuggestions = {
  monitoring_tests?: string[];
  suggested_window_days?: number | null;
  trend_notes?: string[];
  watch_markers?: string[];
};

type InsightContent = {
  schema_version?: string;
  overview?: string;
  defects?: Defect[];
  suggestions?: Suggestions;
  doctor_connect?: DoctorConnect;
  future?: FutureSuggestions;
  red_flag_protocol?: string;
  limitations?: string;
  needs_doctor_review?: boolean;
  // Role CALLER safe content fields when returned directly:
  caller_questions?: string[];
  suggested_window_days?: number | null;
};

type InsightData = {
  id: number;
  report_id: number;
  status: "DRAFT" | "APPROVED" | "REJECTED" | string;
  content?: InsightContent;
  provider?: string;
  model?: string;
  prompt_version?: string;
  validation_errors?: any;
  approved_by?: number | null;
  approved_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  caller_safe?: boolean;
};

export default function ReportInsights({ reportId }: { reportId: number | string }) {
  const role = useContext(RoleContext);
  const { data: ins, error, reload } = useApi<InsightData>(`/reports/${reportId}/insight`);
  const [editing, setEditing] = useState(false);
  const [overviewDraft, setOverviewDraft] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const isClinician = (role === "ADMIN" || role === "DOCTOR") && !ins?.caller_safe;

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

  if (!ins || !ins.content) {
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

  const c = ins.content;
  const p = c?.doctor_connect;
  const isDraft = ins.status === "DRAFT";
  const isApproved = ins.status === "APPROVED";
  const isRejected = ins.status === "REJECTED";

  async function handleApprove() {
    setBusy(true);
    setMsg("");
    try {
      await api(`/reports/${reportId}/insight/approve`, {
        method: "POST",
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
          overview: overviewDraft,
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

  const priorityStyles: Record<string, string> = {
    URGENT: "bg-red-600 text-white border-red-700",
    PRIORITY: "bg-amber-500 text-white border-amber-600",
    ROUTINE: "bg-slate-700 text-white border-slate-800",
  };
  const priorityStyle = (p?.priority && priorityStyles[p.priority]) || "bg-slate-700 text-white border-slate-800";

  const callerQuestions = c?.caller_questions ?? c?.suggestions?.caller_questions ?? [];
  const doctorDiscussion = isClinician ? (c?.suggestions?.doctor_discussion ?? []) : [];
  const clarifications = isClinician ? (c?.suggestions?.clarifications_for_doctor ?? []) : [];
  const hasSuggestions = callerQuestions.length > 0 || doctorDiscussion.length > 0 || clarifications.length > 0;

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
          {isRejected && (
            <span className="rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-900">
              Rejected
            </span>
          )}
        </div>

        {p && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${priorityStyle}`}>
              {p.priority} · {p.connect_within_hours ?? 72}h
            </span>
            <span className="text-xs text-slate-500">
              Source: <strong className="font-semibold text-slate-700">{p.source === "rule" ? "Doctor critical rule" : "AI assessment"}</strong>
            </span>
          </div>
        )}
      </div>

      {/* Priority Reason Banner */}
      {p && p.reason && (
        <div className={`rounded-lg border p-3 text-sm ${p.priority === "URGENT" ? "border-red-300 bg-red-50 text-red-950" : p.priority === "PRIORITY" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-50 text-slate-800"}`}>
          <p className="font-medium">
            Priority assessment: <span className="font-normal">{p.reason}</span>
          </p>
        </div>
      )}

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
      {c?.overview && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-900">Clinical Overview</h3>
          {editing && isClinician ? (
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
                    setOverviewDraft(c?.overview || "");
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
      )}

      {/* Defects & Deviations (Hidden for CALLER) */}
      {isClinician && c?.defects && c.defects.length > 0 && (
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
                        {d.marker}
                      </strong>
                      <div className="flex items-center gap-1">
                        {d.status && (
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusPills[d.status] || "bg-slate-100 text-slate-800 border-slate-200"}`}>
                            {d.status}
                          </span>
                        )}
                        {d.severity && (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${severityPills[d.severity] || "bg-slate-600 text-white"}`}>
                            {d.severity}
                          </span>
                        )}
                      </div>
                    </div>
                    {d.what_it_measures && (
                      <p className="text-slate-700">
                        <span className="font-medium text-slate-900">What it measures: </span>
                        {d.what_it_measures}
                      </p>
                    )}
                    {d.explanation && (
                      <p className="text-slate-700">
                        <span className="font-medium text-slate-900">Clinical context: </span>
                        {d.explanation}
                      </p>
                    )}
                  </div>
                  {d.related_refs && d.related_refs.length > 0 && (
                    <div className="mt-2 border-t border-slate-200 pt-1.5 text-[11px] text-slate-500">
                      <span>Related findings: </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {d.related_refs.map((relRef, idx) => (
                          <span
                            key={idx}
                            className="inline-block rounded bg-teal-100 px-1.5 py-0.5 font-medium text-teal-800"
                          >
                            #{relRef}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Suggestions Section */}
      {hasSuggestions && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Actionable Suggestions</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Doctor Discussion Points (Clinicians only) */}
            {doctorDiscussion.length > 0 && (
              <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3 text-xs text-teal-950">
                <h4 className="font-semibold text-teal-900">Doctor Discussion Points</h4>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  {doctorDiscussion.map((pt, i) => (
                    <li key={i}>{pt}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Caller-Safe Questions (Both clinicians and callers) */}
            {callerQuestions.length > 0 && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 text-xs text-indigo-950">
                <h4 className="font-semibold text-indigo-900">
                  Caller Questions (Symptoms, Lifestyle, Diet, Meds)
                </h4>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  {callerQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Clarifications for Doctor (Clinicians only) */}
            {clarifications.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 sm:col-span-2">
                <h4 className="font-semibold text-slate-900">Clinical Clarifications</h4>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  {clarifications.map((cl, i) => (
                    <li key={i}>{cl}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Future Suggestions & Monitoring (Clinicians only) */}
      {isClinician && c?.future && (
        <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold text-slate-900">Future Monitoring &amp; Follow-up</h4>
            <span className="font-medium text-teal-800">
              Suggested review window: {c.future.suggested_window_days ?? c.suggested_window_days ?? 90} days
            </span>
          </div>
          {c.future.monitoring_tests && c.future.monitoring_tests.length > 0 && (
            <div className="space-y-1 pt-1">
              <span className="text-slate-600">Catalogue monitoring tests:</span>
              <div className="flex flex-wrap gap-1.5">
                {c.future.monitoring_tests.map((code, i) => (
                  <span
                    key={i}
                    className="rounded border border-teal-200 bg-white px-2 py-0.5 text-xs font-medium text-teal-900 shadow-sm"
                  >
                    {code}
                  </span>
                ))}
              </div>
            </div>
          )}
          {c.future.watch_markers && c.future.watch_markers.length > 0 && (
            <p className="text-slate-600">
              <span className="font-medium text-slate-800">Watch markers: </span>
              {c.future.watch_markers.join(", ")}
            </p>
          )}
          {c.future.trend_notes && c.future.trend_notes.length > 0 && (
            <ul className="list-disc pl-4 text-slate-600">
              {c.future.trend_notes.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Red Flag Warning Protocol */}
      {Boolean(c?.red_flag_protocol && c.red_flag_protocol.trim()) && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-950">
          <h4 className="font-bold uppercase tracking-wide text-red-900">
            Red Flag Warning Protocol
          </h4>
          <p className="mt-1.5 font-medium leading-relaxed">
            {c.red_flag_protocol}
          </p>
        </div>
      )}

      {/* Footer / Limitations & Audit trail */}
      <div className="space-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
        {Boolean(c?.limitations && c.limitations.trim()) && (
          <p className="italic text-slate-600">
            {c.limitations}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-slate-400">
          <span>
            {ins.provider ? `Engine: ${ins.provider} (${ins.model || "default"})${ins.prompt_version ? ` · prompt v${ins.prompt_version}` : ""}` : ""}
          </span>
          {ins.approved_at && (
            <span>
              Approved {new Date(ins.approved_at).toLocaleString("en-IN")} by user #{ins.approved_by}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
