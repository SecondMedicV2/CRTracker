"use client";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/useApi";
import Actions from "./Actions";

const STEPS: [string, string][] = [
  ["opening", "1. Say hello"], ["identity_check", "2. Check identity"], ["free_followup_pitch", "3. Offer the free doctor call"],
  ["consent_request", "4. Ask for consent"], ["slot_offer", "5. Offer a time"], ["closing", "6. Close"],
];

export default function CallerCard() {
  const { id } = useParams<{ id: string }>();
  const { data: c, error } = useApi<any>(`/followups/${id}/caller-card`);
  if (error) return <p role="alert" className="text-sm">{error}</p>;
  if (!c) return null;
  return (
    <div className="space-y-4 text-sm">
      <h1 className="text-xl font-semibold">{c.patient_name}</h1>
      <div>Mobile <span className="font-mono">{c.mobile}</span> · report {c.report_age_days} days old · language {c.language}</div>
      <div className="rounded bg-white p-3 shadow"><b>Reason for call:</b> {c.reason_for_call}</div>
      {c.notice && <div role="alert" className="rounded border border-amber-400 bg-amber-50 p-2">{c.notice}</div>}
      <div className="rounded border border-red-300 bg-red-50 p-2">Do not explain or comment on any result. Only a doctor can do that.</div>
      {STEPS.map(([k, label]) => (
        <section key={k} className="rounded bg-white p-3 shadow"><div className="font-medium">{label}</div><p>{c.script[k]}</p></section>
      ))}
      <section className="rounded bg-white p-3 shadow">
        <div className="font-medium">If the patient says…</div>
        <ul className="mt-1 space-y-1">{c.script.objection_handling.map((o: any, i: number) => <li key={i}><i>{o.objection}</i> → {o.reply}</li>)}</ul>
      </section>
      <section className="rounded border border-red-400 bg-red-50 p-3"><div className="font-medium">Urgent symptoms</div><p>{c.script.urgent_symptom_protocol}</p></section>
      <section className="rounded bg-white p-3 shadow"><div className="font-medium">Never say</div><ul className="list-disc pl-5">{c.do_not_say.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></section>
      <Actions fid={id} />
    </div>
  );
}
