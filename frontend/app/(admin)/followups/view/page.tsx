"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import FollowupCombinationsTable from "@/components/FollowupCombinationsTable";
import ProgramsPanel from "@/components/ProgramsPanel";
import Trends from "@/components/Trends";
import CallCard from "./CallCard";
import DoctorActions from "./DoctorActions";

function FollowupViewInner({ id }: { id: string }) {
  const { data: f, error, reload } = useApi<any>(`/followups/${id}`);
  const doctors = useApi<any[]>("/doctors");
  const me = useApi<any>("/auth/me");
  const [msg, setMsg] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  if (error || !f) return <RequestState loading={!f} error={error} retry={reload} />;
  const patch = (body: object) => api(`/followups/${id}`, { method: "PATCH", body }).then(() => { setMsg(""); reload(); }).catch((e) => setMsg(e.message));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{f.patient_name}</h1>
      <div className="text-sm">
        Due {f.due_on && !isNaN(Date.parse(f.due_on)) ? new Date(f.due_on).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-"} · report {f.report_age_days} days old ·
        stage {f.stage}{f.report_id && <> · <Link className="underline" href={`/reports/view?id=${f.report_id}`}>see report</Link></>}
      </div>
      {f.parked && <div className="rounded border border-slate-300 bg-slate-100 p-2 text-sm">Parked: low retest potential. Not in the callers' queue.</div>}
      {f.suppressed_reason && <div className="rounded border border-amber-400 bg-amber-50 p-2 text-sm">Not needed: {f.suppressed_reason}</div>}
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label>Priority{" "}
          <select className="rounded border p-1" value={f.priority} onChange={(e) => patch({ priority: e.target.value })}>
            <option>ROUTINE</option><option>ESCALATION</option>
          </select>
        </label>
        <label>Doctor{" "}
          <select className="rounded border p-1" value={f.assigned_doctor_id ?? ""} onChange={(e) => e.target.value && patch({ assigned_doctor_id: Number(e.target.value) })}>
            <option value="">Not assigned</option>{(doctors.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>
      {me.data && <CallCard fid={id} role={me.data.role} />}
      {f.patient_id && <Trends patientId={f.patient_id} />}
      <DoctorActions fid={id} />
      <FollowupCombinationsTable fid={id} onChanged={() => setRefreshKey((n) => n + 1)} />
      {f.patient_id && <ProgramsPanel patientId={String(f.patient_id)} mode="followup" refreshKey={refreshKey} onChanged={() => setRefreshKey((n) => n + 1)} />}
      <section>
        <h2 className="mb-1 font-medium">Why this patient is in these buckets</h2>
        <ul className="list-disc pl-5 text-sm">{(f.buckets_detail ?? []).map((b: any) => <li key={b.code}><b>{b.code}</b> ({b.severity || "n/a"}): {b.reason}</li>)}</ul>
      </section>
      <section>
        <h2 className="mb-1 font-medium">Why this score: {f.retest_score ?? "N/A"} ({f.retest_tier ?? "N/A"})</h2>
        <TableFrame label="Retest score breakdown">
          <table className="w-full bg-white text-left text-sm shadow">
            <thead><tr><th className="p-2">Factor</th><th>Detail</th><th>Points</th></tr></thead>
            <tbody>{(f.score_breakdown ?? []).map((s: any) => <tr key={s.factor} className="border-t"><td className="p-2">{s.factor}</td><td>{s.detail}</td><td>{s.points}</td></tr>)}</tbody>
          </table>
        </TableFrame>
      </section>
    </div>
  );
}


function Detail() {
  const id = useSearchParams().get("id");
  return (
    <div className="space-y-4">
      <Link className="inline-block text-sm font-medium text-teal-800 underline" href="/followups">Back to Follow-ups</Link>
      {id && /^\d+$/.test(id) ? <FollowupViewInner key={id} id={id} /> : <p role="alert">Open a record from Follow-ups.</p>}
    </div>
  );
}

export default function FollowupView() {
  return <Suspense fallback={<p role="status">Loading…</p>}><Detail /></Suspense>;
}
