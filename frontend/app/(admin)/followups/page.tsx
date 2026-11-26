"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import TierBadge from "@/components/TierBadge";
import Link from "next/link";
import { useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { callStageLabel } from "@/lib/callWorkflow";
import { RoleContext } from "@/lib/navigation";
import { useApi } from "@/lib/useApi";

const TABS: [string, string][] = [
  ["queue", "All due"], ["due_tomorrow", "Tomorrow"], ["due_this_week", "This week"], ["next_30_days", "Next 30 days"],
  ["overdue", "Overdue"], ["escalations", "Escalations"], ["low_potential", "Low potential (parked)"], ["done", "Done"],
];
const PROTOCOL_TIERS = [
  ["URGENT", "Urgent"], ["EARLY", "Early follow-up"], ["TREATMENT_RESPONSE", "Treatment response"],
  ["METABOLIC", "Metabolic follow-up"], ["LONG_TERM", "Long-term monitoring"],
];

export default function Followups() {
  const role = useContext(RoleContext);
  const isCaller = role === "CALLER";
  const canOpenCallWorkspace = role === "CALLER" || role === "ADMIN";
  const [view, setView] = useState("queue");
  const [priority, setPriority] = useState("");
  const [tier, setTier] = useState("");
  const [protocolTier, setProtocolTier] = useState("");
  const [bucket, setBucket] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") {
      const pt = new URLSearchParams(window.location.search).get("protocol_tier");
      if (pt) setProtocolTier(pt);
    }
  }, []);
  const counts = useApi<Record<string, any>>("/followups/summary");
  const refills = useApi<any[]>(canOpenCallWorkspace ? "/refill-tasks" : "/followups/summary");
  const qs = new URLSearchParams({
    view,
    ...(priority && { priority }),
    ...(tier && { tier }),
    ...(protocolTier && { protocol_tier: protocolTier }),
    ...(bucket && { bucket }),
  }).toString();
  const { data, error, reload } = useApi<any[]>(`/followups?${qs}`);
  const full = data?.[0] ? "retest_tier" in data[0] : counts.data ? "low_potential" in counts.data : false; // callers get no clinical columns
  const buckets = Object.keys(counts.data?._buckets ?? {});

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{isCaller ? "Calling queue" : "Follow-ups"}</h1>
        <p className="mt-1 text-sm text-slate-600">{isCaller
          ? "Contact customers after their lab reports, record call outcomes, and arrange a doctor follow-up."
          : "Review follow-up cases, monitor outreach, and see which customers need a doctor."}</p>
      </header>
      {counts.error && <RequestState loading={false} error={counts.error} retry={counts.reload} />}
      <div role="group" aria-label="Follow-up views" className="flex flex-wrap gap-2 text-sm">
        {TABS.filter(([v]) => counts.data && v in counts.data).map(([v, label]) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`rounded-lg border px-3 py-2 ${view === v ? "border-teal-800 bg-teal-800 text-white" : "border-slate-300 bg-white"}`}>
            {label} ({counts.data?.[v] ?? 0})
          </button>
        ))}
      </div>
      {full && (
        <div className="flex flex-wrap gap-2 text-sm">
          <select aria-label="Urgency tier" className="rounded border p-1" value={protocolTier} onChange={(e) => setProtocolTier(e.target.value)}>
            <option value="">Any urgency tier</option>
            {PROTOCOL_TIERS.map(([code, lbl]) => <option key={code} value={code}>{lbl}</option>)}
          </select>
          <select aria-label="Priority" className="rounded border p-1" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Any priority</option><option>ROUTINE</option><option>ESCALATION</option>
          </select>
          <select aria-label="Retest potential" className="rounded border p-1" value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">Any retest potential</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option>
          </select>
          <select aria-label="Bucket" className="rounded border p-1" value={bucket} onChange={(e) => setBucket(e.target.value)}>
            <option value="">Any bucket</option>{buckets.map((b) => <option key={b}>{b}</option>)}
          </select>
        </div>
      )}
      {full && <a className="inline-block text-sm underline" href={`/api/v1/exports/followups.csv?${qs}`}>Export this list (CSV)</a>}
      <RequestState loading={!data} error={error} retry={reload} empty={data?.length === 0 ? ("No follow-ups match this view and its filters.") : undefined} />
      {!error && !!data?.length && (
        <TableFrame label="Follow-up cases">
          <table className="w-full bg-white text-left text-sm shadow">
            <thead><tr><th className="p-2">{isCaller ? "Customer" : "Patient"}</th><th>Urgency</th><th>Due</th><th>Report age</th><th>Priority</th><th>Status</th><th>{full ? "Deficits / Findings" : "Retest"}</th>{canOpenCallWorkspace && <th>Call workspace</th>}{full && <><th>Retest window</th><th>Buckets</th><th>Potential</th></>}</tr></thead>
            <tbody>{data?.map((f) => {
              const winLabel = f.retest_status === "DOCTOR_TO_SET"
                ? (full ? "Doctor to set retest date" : "Retest due")
                : f.retest_window_start
                  ? `${new Date(`${String(f.retest_window_start).slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })}${f.retest_window_end && f.retest_window_end !== f.retest_window_start ? ` \u2192 ${new Date(`${String(f.retest_window_end).slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })}` : ""}`
                  : "";
              return (
              <tr key={f.id} className={`border-t ${full && f.protocol_tier === "URGENT" ? "bg-red-50/70" : ""}`}>
                <td className="p-2">{full ? <Link className="underline" href={`/followups/view?id=${f.id}`}>{f.patient_name}</Link> : f.patient_name}</td>
                <td><TierBadge label={f.protocol_tier_label} colour={f.protocol_tier_colour} /></td>
                <td>{new Date(f.due_on).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{f.report_age_days != null ? `${f.report_age_days} days` : ""}</td>
                <td className={f.priority === "ESCALATION" ? "font-medium text-red-700" : ""}>{f.priority === "ESCALATION" ? "Escalation" : "Routine"}</td>
                <td>{callStageLabel(f.stage)}</td>
                <td>
                  {!full ? (
                    <div className="space-y-0.5 text-xs">
                      <span className="inline-block rounded bg-teal-50 px-2 py-0.5 font-medium text-teal-900 border border-teal-200">
                        Retest due
                      </span>
                      {winLabel && <div className="text-slate-600">{winLabel}</div>}
                    </div>
                  ) : f.deficits_summary ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-800 border border-rose-200">
                      <span className="size-1.5 rounded-full bg-rose-600"></span>
                      {f.deficits_summary}
                    </span>
                  ) : f.buckets && f.buckets.length > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 border border-amber-200">
                      <span className="size-1.5 rounded-full bg-amber-600"></span>
                      {f.buckets.join(", ")}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">Normal</span>
                  )}
                </td>
                {canOpenCallWorkspace && <td><Link className="inline-block rounded-lg border border-teal-800 px-2 py-1 font-medium text-teal-800 hover:bg-teal-50" href={`/caller-card/view?id=${f.id}`} aria-label={`Open call workspace for ${f.patient_name}`}>Open workspace</Link></td>}
                {full && (
                  <>
                    <td className="text-xs">
                      {f.retest_status === "DOCTOR_TO_SET" ? (
                        <span className="inline-block rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900">Doctor to set retest date</span>
                      ) : (
                        <span>{winLabel || "\u2014"}</span>
                      )}
                    </td>
                    <td>{f.buckets.join(", ")}</td>
                    <td>{f.retest_tier} ({f.retest_score})</td>
                  </>
                )}
              </tr>
              );
            })}</tbody>
          </table>
        </TableFrame>
      )}
      {canOpenCallWorkspace && Array.isArray(refills.data) && refills.data.length > 0 && (
        <section className="space-y-2 rounded-xl border border-teal-200 bg-teal-50/50 p-3 text-xs">
          <h2 className="text-sm font-semibold text-teal-950">Pharmacy refill reminders ({refills.data.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead><tr className="border-b text-slate-600"><th className="p-1.5">Customer</th><th>Mobile</th><th>Next refill</th><th>Delivery mode</th><th /></tr></thead>
              <tbody>
                {refills.data.map((t: any) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-1.5 font-medium">{t.patient_name}</td>
                    <td className="font-mono">{t.mobile}</td>
                    <td>{t.next_refill_on}</td>
                    <td>{t.delivery_mode}</td>
                    <td className="p-1.5">
                      <button
                        type="button"
                        className="rounded bg-teal-800 px-2 py-1 font-medium text-white"
                        onClick={() => api(`/refill-schedules/${t.id}/confirm`, { method: "POST", body: {} }).then(refills.reload)}
                      >
                        Confirm refill
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
