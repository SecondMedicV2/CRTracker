"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import Link from "next/link";
import { useApi } from "@/lib/useApi";

export default function DoctorQueue() {
  const { data, error, reload } = useApi<any[]>("/doctor/queue");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My queue</h1>
      <p className="text-sm text-slate-600">Escalations first, then higher retest potential, then earliest due.</p>
      <RequestState loading={!data} error={error} retry={reload} empty={data?.length === 0 ? ("Nothing assigned to you right now.") : undefined} />
      {!error && !!data?.length && (
        <TableFrame label="Assigned cases">
          <table className="w-full bg-white text-left text-sm shadow">
            <thead><tr><th className="p-2">Patient</th><th>Priority</th><th>Potential</th><th>Stage</th><th>Retest schedule</th><th>Booked slot</th><th>Plans / Consider</th><th>Comments</th><th>Accepted</th><th>Action</th></tr></thead>
            <tbody>{data?.map((f) => (
              <tr key={f.id} className={`border-t ${f.priority === "ESCALATION" ? "bg-red-50" : ""}`}>
                <td className="p-2"><Link className="underline" href={`/followups/view?id=${f.id}`}>{f.patient_name}</Link></td>
                <td className={f.priority === "ESCALATION" ? "font-medium text-red-700" : ""}>{f.priority}</td>
                <td>{f.retest_tier} ({f.retest_score})</td><td>{f.stage}</td>
                <td className="text-xs">
                  {f.retest_status === "DOCTOR_TO_SET" ? (
                    <span className="inline-block rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">Doctor to set retest date</span>
                  ) : f.retest_window_start ? (
                    <span>{f.retest_window_start}{f.retest_window_end && f.retest_window_end !== f.retest_window_start ? ` \u2192 ${f.retest_window_end}` : ""}</span>
                  ) : "\u2014"}
                </td>
                <td>{f.slot_start ? new Date(f.slot_start).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : ""}</td>
                <td className="space-x-1">
                  {f.pending_plans > 0 && <Link href={`/followups/view?id=${f.id}`} className="rounded bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-900">{f.pending_plans} plan{f.pending_plans === 1 ? "" : "s"}</Link>}
                  {f.pending_consider > 0 && <Link href={`/followups/view?id=${f.id}`} className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{f.pending_consider} consider</Link>}
                </td>
                <td>{f.unread_comments > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">{f.unread_comments} new</span>}</td>
                <td>{f.accepted ? "Yes" : "No"}</td>
                <td className="p-2">
                  <Link href={`/caller-card/view?id=${f.id}`} className="rounded bg-sky-600 px-3 py-1 text-white hover:bg-sky-700">📞 Take Follow-up</Link>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
