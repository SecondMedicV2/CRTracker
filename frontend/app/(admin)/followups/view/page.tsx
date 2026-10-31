"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import Trends from "@/components/Trends";
import CallCard from "./CallCard";
import DoctorActions from "./DoctorActions";

function FollowupViewInner() {
  const id = useSearchParams().get("id") ?? "";
  const { data: f, error, reload } = useApi<any>(`/followups/${id}`);
  const doctors = useApi<any[]>("/doctors");
  const me = useApi<any>("/auth/me");
  const [msg, setMsg] = useState("");
  if (error) return <p role="alert">{error}</p>;
  if (!f) return null;
  const patch = (body: object) => api(`/followups/${id}`, { method: "PATCH", body }).then(() => { setMsg(""); reload(); }).catch((e) => setMsg(e.message));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{f.patient_name}</h1>
      <div className="text-sm">
        Due {new Date(f.due_on).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} · report {f.report_age_days} days old ·
        stage {f.stage} · <Link className="underline" href={`/reports/view?id=${f.report_id}`}>see report</Link>
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
            <option value="">Not assigned</option>{doctors.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>
      {me.data && <CallCard fid={id} role={me.data.role} />}
      <Trends patientId={f.patient_id} />
      <DoctorActions fid={id} />
      <section>
        <h2 className="mb-1 font-medium">Why this patient is in these buckets</h2>
        <ul className="list-disc pl-5 text-sm">{f.buckets_detail.map((b: any) => <li key={b.code}><b>{b.code}</b> ({b.severity || "n/a"}): {b.reason}</li>)}</ul>
      </section>
      <section>
        <h2 className="mb-1 font-medium">Why this score: {f.retest_score} ({f.retest_tier})</h2>
        <table className="w-full bg-white text-left text-sm shadow">
          <thead><tr><th className="p-2">Factor</th><th>Detail</th><th>Points</th></tr></thead>
          <tbody>{f.score_breakdown.map((s: any) => <tr key={s.factor} className="border-t"><td className="p-2">{s.factor}</td><td>{s.detail}</td><td>{s.points}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}


export default function FollowupView() {
  return <Suspense><FollowupViewInner /></Suspense>;
}
