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

type DeficitItem = {
  param_code?: string;
  name: string;
  value: number | string;
  unit?: string;
  ref_range?: string;
  direction?: "low" | "high" | string;
  severity?: "mild" | "moderate" | "severe" | string;
  status_label?: string;
  guidance?: string;
};

type CallerCardData = {
  patient_name: string;
  mobile: string;
  language: string;
  priority: string;
  notice?: string;
  report_age_days: number | null;
  reason_for_call: string;
  deficits?: DeficitItem[];
  abnormal_findings?: DeficitItem[];
  script: Record<(typeof STEPS)[number][0] | "urgent_symptom_protocol", string> & {
    objection_handling: { objection: string; reply: string }[];
  };
  do_not_say: string[];
};

function CallerCardInner({ id }: { id: string }) {
  const { data: c, error, reload } = useApi<CallerCardData>(`/followups/${id}/caller-card`);
  if (error || !c) return <RequestState loading={!c} error={error} retry={reload} />;
  const languages: Record<string, string> = { en: "English", hi: "Hindi", hinglish: "Hinglish" };
  const deficitsList = c.deficits || c.abnormal_findings || [];

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

      {/* Patient Lab Deficits & Health Highlights */}
      {deficitsList.length > 0 && (
        <section aria-labelledby="deficits-heading" className="rounded-2xl border border-rose-200 bg-rose-50/70 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-7 items-center justify-center rounded-lg bg-rose-600 text-xs font-bold text-white shadow-sm">!</span>
              <div>
                <h2 id="deficits-heading" className="text-base font-bold text-rose-950">Patient Report Deficits & Key Findings</h2>
                <p className="text-xs text-rose-800">Highlighted for caller context — emphasize the importance of the doctor consultation without diagnosing or prescribing.</p>
              </div>
            </div>
            <span className="rounded-full bg-rose-200/80 px-3 py-1 text-xs font-bold text-rose-950">
              {deficitsList.length} Deficit{deficitsList.length > 1 ? "s" : ""} Identified
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {deficitsList.map((d, idx) => {
              const isLow = d.direction?.toLowerCase() === "low" || d.status_label?.toLowerCase().includes("low") || d.status_label?.toLowerCase().includes("deficit");
              const isSevere = d.severity?.toLowerCase() === "severe";
              return (
                <div key={idx} className="flex flex-col justify-between rounded-xl border border-rose-200/80 bg-white p-4 shadow-sm transition hover:shadow-md">
                  <div>
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="font-semibold text-slate-900">{d.name}</span>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                        isLow ? "bg-amber-100 text-amber-900 border border-amber-300" : "bg-rose-100 text-rose-900 border border-rose-300"
                      }`}>
                        {d.status_label || (isLow ? "Deficit (Low)" : "Elevated (High)")}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-baseline gap-2">
                      <span className={`text-xl font-bold tracking-tight ${isSevere ? "text-rose-700 font-extrabold" : "text-slate-900"}`}>
                        {d.value} <span className="text-xs font-normal text-slate-500">{d.unit}</span>
                      </span>
                      {d.ref_range && (
                        <span className="text-xs text-slate-500">
                          (Normal: <span className="font-medium text-slate-700">{d.ref_range}</span>)
                        </span>
                      )}
                    </div>
                    {d.severity && (
                      <div className="mt-1 text-xs text-slate-600">
                        Severity: <span className="font-medium capitalize">{d.severity}</span>
                      </div>
                    )}
                  </div>
                  {d.guidance && (
                    <div className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-700 border border-slate-100">
                      <span className="font-semibold text-slate-900">Caller tip: </span>
                      {d.guidance}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

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
