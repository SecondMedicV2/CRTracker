"use client";
import Link from "next/link";
import { RequestState } from "@/components/RequestState";
import { useSearchParams } from "next/navigation";
import { Suspense, useContext } from "react";
import { useApi } from "@/lib/useApi";
import { RoleContext } from "@/lib/navigation";
import Actions from "./Actions";

const STEPS = [
  ["opening", "Introduce SecondMedic"], ["identity_check", "Confirm identity"], ["free_followup_pitch", "Explain the follow-up"],
  ["consent_request", "Ask for consent"], ["slot_offer", "Offer a time"], ["closing", "Close the call"],
] as const;

type CallerCardData = {
  patient_name: string;
  mobile: string;
  language: string;
  priority: string;
  notice?: string;
  report_age_days: number | null;
  reason_for_call: string;
  script: Record<(typeof STEPS)[number][0] | "urgent_symptom_protocol", string> & {
    objection_handling: { objection: string; reply: string }[];
  };
  do_not_say: string[];
};

function CallerCardInner({ id }: { id: string }) {
  const { data: c, error, reload } = useApi<CallerCardData>(`/followups/${id}/caller-card`);
  if (error || !c) return <RequestState loading={!c} error={error} retry={reload} />;
  const languages: Record<string, string> = { en: "English", hi: "Hindi", hinglish: "Hinglish" };
  return (
    <div className="space-y-5 text-sm">
      <header className="space-y-4 rounded-2xl bg-slate-900 p-5 text-white sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h1 className="font-semibold">Call workspace</h1><p className="mt-1 text-slate-300">SecondMedic report follow-up</p></div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${c.priority === "ESCALATION" ? "bg-amber-200 text-amber-950" : "bg-slate-700 text-slate-100"}`}>
            {c.priority === "ESCALATION" ? "Escalation" : "Routine"}
          </span>
        </div>
        <dl className="grid gap-3 border-t border-white/20 pt-4 sm:grid-cols-3">
          <div><dt className="text-slate-300">Customer</dt><dd className="font-semibold">{c.patient_name}</dd></div>
          <div>
            <dt className="text-slate-300">Mobile</dt>
            <dd className="font-mono">{c.mobile || "Unavailable"}</dd>
            {c.mobile?.startsWith("X") && <dd className="mt-1 text-xs text-slate-300">Use the CRM contact record for the full number.</dd>}
          </div>
          <div><dt className="text-slate-300">Language and report age</dt><dd>{(languages[c.language] ?? c.language) || "Language unavailable"}{c.report_age_days != null && ` · ${c.report_age_days} days`}</dd></div>
        </dl>
      </header>
      {c.notice && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">{c.notice}</p>}
      <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-teal-950">
        <p className="font-semibold">Reason for call</p>
        <p className="mt-1">{c.reason_for_call}</p>
        <p className="mt-2">Arrange a doctor follow-up for questions about report values, which parameters to watch, or precautions to take.</p>
      </div>
      <nav aria-label="Call workspace sections" className="flex flex-wrap gap-4 lg:hidden">
        <a href="#call-script" className="font-semibold text-teal-800 underline">Call guide</a>
        <a href="#call-actions" className="font-semibold text-teal-800 underline">Status and actions</a>
      </nav>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section id="call-script" aria-labelledby="call-script-heading" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div>
            <h2 id="call-script-heading" className="text-lg font-semibold">Call guide</h2>
            <p className="mt-1 text-slate-600">Place the call through your CRM or phone. Confirm the customer’s identity, then explain the follow-up and offer a doctor call.</p>
          </div>
          <ol className="list-decimal space-y-3 pl-5 marker:font-semibold marker:text-teal-800">
            {STEPS.map(([key, label]) => <li key={key} className="pl-1"><h3 className="font-semibold">{label}</h3><p className="mt-1 text-slate-700">{c.script[key]}</p></li>)}
          </ol>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-950">
            <h3 className="font-semibold">Urgent symptoms</h3><p className="mt-1">{c.script.urgent_symptom_protocol}</p>
          </div>
          <details className="rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer font-semibold">Common questions</summary>
            <ul className="mt-2 space-y-2">{c.script.objection_handling.map((o, i) => <li key={i}><p className="font-medium">{o.objection}</p><p>{o.reply}</p></li>)}</ul>
          </details>
          <details className="rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer font-semibold">What to avoid saying</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">{c.do_not_say.map((text, i) => <li key={i}>{text}</li>)}</ul>
          </details>
        </section>
        <Actions fid={id} />
      </div>
    </div>
  );
}


function Detail() {
  const id = useSearchParams().get("id");
  const isCaller = useContext(RoleContext) === "CALLER";
  const queue = isCaller ? "Calling queue" : "Follow-ups";
  return (
    <div className="space-y-4">
      <Link className="inline-block text-sm font-medium text-teal-800 underline" href="/followups">Back to {queue}</Link>
      {id && /^\d+$/.test(id) ? <CallerCardInner key={id} id={id} /> : <p role="alert">Open a record from the {queue.toLowerCase()} page.</p>}
    </div>
  );
}

export default function CallerCard() {
  return <Suspense fallback={<p role="status">Loading…</p>}><Detail /></Suspense>;
}
