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
            <thead><tr><th className="p-2">Patient</th><th>Priority</th><th>Potential</th><th>Stage</th><th>Booked slot</th><th>Comments</th><th>Accepted</th><th>Action</th></tr></thead>
            <tbody>{data?.map((f) => (
              <tr key={f.id} className={`border-t ${f.priority === "ESCALATION" ? "bg-red-50" : ""}`}>
                <td className="p-2"><Link className="underline" href={`/followups/view?id=${f.id}`}>{f.patient_name}</Link></td>
                <td className={f.priority === "ESCALATION" ? "font-medium text-red-700" : ""}>{f.priority}</td>
                <td>{f.retest_tier} ({f.retest_score})</td><td>{f.stage}</td>
                <td>{f.slot_start ? new Date(f.slot_start).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : ""}</td>
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
