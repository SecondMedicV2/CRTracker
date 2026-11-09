"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/useApi";

const TABS: [string, string][] = [
  ["queue", "All due"], ["due_tomorrow", "Tomorrow"], ["due_this_week", "This week"], ["next_30_days", "Next 30 days"],
  ["overdue", "Overdue"], ["escalations", "Escalations"], ["low_potential", "Low potential (parked)"], ["done", "Done"],
];

export default function Followups() {
  const [view, setView] = useState("queue");
  const [priority, setPriority] = useState("");
  const [tier, setTier] = useState("");
  const [bucket, setBucket] = useState("");
  const counts = useApi<Record<string, any>>("/followups/summary");
  const qs = new URLSearchParams({ view, ...(priority && { priority }), ...(tier && { tier }), ...(bucket && { bucket }) }).toString();
  const { data, error, reload } = useApi<any[]>(`/followups?${qs}`);
  const full = data?.[0] ? "retest_tier" in data[0] : counts.data ? "low_potential" in counts.data : false; // callers get no clinical columns
  const buckets = Object.keys(counts.data?._buckets ?? {});

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Follow-ups</h1>
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
            <thead><tr><th className="p-2">Patient</th><th>Due</th><th>Report age</th><th>Priority</th><th>Stage</th>{full && <><th>Buckets</th><th>Potential</th></>}</tr></thead>
            <tbody>{data?.map((f) => (
              <tr key={f.id} className="border-t">
                <td className="p-2"><Link className="underline" href={full ? `/followups/view?id=${f.id}` : `/caller-card/view?id=${f.id}`}>{f.patient_name}</Link></td>
                <td>{new Date(f.due_on).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{f.report_age_days != null ? `${f.report_age_days} days` : ""}</td>
                <td className={f.priority === "ESCALATION" ? "font-medium text-red-700" : ""}>{f.priority}</td><td>{f.stage}</td>
                {full && <><td>{f.buckets.join(", ")}</td><td>{f.retest_tier} ({f.retest_score})</td></>}
              </tr>
            ))}</tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
