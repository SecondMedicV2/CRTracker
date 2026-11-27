"use client";
import Link from "next/link";
import { RequestState } from "@/components/RequestState";
import JourneyTimeline from "@/components/JourneyTimeline";
import TierBadge from "@/components/TierBadge";
import { useSearchParams } from "next/navigation";
import { Suspense, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { RoleContext } from "@/lib/navigation";
import Actions from "./Actions";

const STEPS = [
  ["opening", "Introduce SecondMedic"], ["identity_check", "Confirm identity"], ["free_followup_pitch", "Explain the follow-up"],
  ["consent_request", "Ask for consent"], ["slot_offer", "Offer a time"], ["closing", "Close the call"],
] as const;

type CallerCardData = {
  patient_id?: number | null;
  patient_name: string;
  mobile: string;
  language: string;
  priority: string;
  protocol_tier_colour?: string;
  protocol_tier_label?: string;
  monitoring_due?: string | null;
  comparison_notice?: string | null;
  comparison_date?: string | null;
  journey_caller_label?: string | null;
  notice?: string;
  report_age_days: number | null;
  reason_for_call: string;
  program_followups?: string[];
  next_steps?: string[];
  refill_reminder?: string | null;
  specialist_bookings?: { id: number; label: string; scheduled_for?: string | null; status: string }[];
  script: Record<(typeof STEPS)[number][0] | "urgent_symptom_protocol", string> & {
    objection_handling: { objection: string; reply: string }[];
  };
  do_not_say: string[];
};

function FollowupBookingCard({ fid }: { fid: string }) {
  const [plan, setPlan] = useState<any>(null);
  const [hubs, setHubs] = useState<any[]>([]);
  const [mode, setMode] = useState<"HOME" | "HEALTH_HUB">("HOME");
  const [address, setAddress] = useState("");
  const [hubId, setHubId] = useState("");
  const [slot, setSlot] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<any>(`/followups/${fid}/retest-plan`).then((d) => {
      setPlan(d);
      if (d.collection_mode) setMode(d.collection_mode);
      if (d.health_hub_id) setHubId(String(d.health_hub_id));
    }).catch(() => {});
    api<any[]>("/health-hubs").then(setHubs).catch(() => {});
  }, [fid]);

  if (!plan) return null;

  async function submitBook(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      const updated = await api<any>(`/retest-recommendations/${plan.id}/book`, {
        method: "POST",
        body: {
          collection_mode: mode,
          ...(mode === "HEALTH_HUB" ? { health_hub_id: Number(hubId) } : { address }),
          ...(slot ? { slot_start: new Date(slot).toISOString() } : {}),
        },
      });
      setPlan(updated);
      setMsg("Follow-up test booking saved.");
    } catch (err: any) {
      setMsg(err.message || "Could not save booking");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="caller-booking-heading" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 id="caller-booking-heading" className="text-sm font-semibold text-slate-900">{plan.label || "Follow-up test"}</h3>
        <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{plan.booking_status || "NOT_BOOKED"}</span>
      </div>
      {plan.window_start && (
        <p className="text-slate-600">Window: {plan.window_start}{plan.window_end && plan.window_end !== plan.window_start ? ` to ${plan.window_end}` : ""}</p>
      )}
      {!plan.approved && <p className="font-medium text-amber-800">Waiting for clinician approval before booking.</p>}
      <form onSubmit={submitBook} className="space-y-2">
        <div className="flex gap-3">
          <label className="flex items-center gap-1"><input type="radio" name={`caller-mode-${fid}`} checked={mode === "HOME"} onChange={() => setMode("HOME")} /> Home pickup</label>
          <label className="flex items-center gap-1"><input type="radio" name={`caller-mode-${fid}`} checked={mode === "HEALTH_HUB"} onChange={() => setMode("HEALTH_HUB")} /> Health Hub</label>
        </div>
        {mode === "HOME" ? (
          <input type="text" placeholder="Patient address for home visit" className="w-full rounded border border-slate-300 px-2 py-1" value={address} onChange={(e) => setAddress(e.target.value)} />
        ) : (
          <select className="w-full rounded border border-slate-300 px-2 py-1" value={hubId} onChange={(e) => setHubId(e.target.value)}>
            <option value="">Select Health Hub…</option>
            {hubs.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.city})</option>)}
          </select>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input type="datetime-local" className="rounded border border-slate-300 px-2 py-1" value={slot} onChange={(e) => setSlot(e.target.value)} />
          <button type="submit" disabled={saving || !plan.approved || (mode === "HOME" ? !address.trim() : !hubId)} className="rounded bg-teal-800 px-3 py-1 font-semibold text-white disabled:opacity-40">
            Book follow-up test
          </button>
        </div>
      </form>
      {msg && <p role="status" className="font-medium text-teal-900">{msg}</p>}
    </section>
  );
}


function CallerCardInner({ id }: { id: string }) {
  const { data: c, error, reload } = useApi<CallerCardData>(`/followups/${id}/caller-card`);
  const [rel, setRel] = useState<{ status: string; next_step?: { caller_label: string } | null } | null>(null);
  useEffect(() => {
    if (c?.patient_id) {
      api<any>(`/patients/${c.patient_id}/relationship`).then(setRel).catch(() => {});
    }
  }, [c?.patient_id]);
  if (error || !c) return <RequestState loading={!c} error={error} retry={reload} />;
  const languages: Record<string, string> = { en: "English", hi: "Hindi", hinglish: "Hinglish" };

  return (
    <div className="space-y-5 text-sm">
      <header className="space-y-4 rounded-2xl bg-gradient-to-r from-sky-800 to-sky-950 p-5 text-white shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h1 className="font-semibold">Call workspace</h1><p className="mt-1 text-slate-300">SecondMedic report follow-up</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge label={c.protocol_tier_label} colour={c.protocol_tier_colour} />
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${c.priority === "ESCALATION" ? "bg-amber-200 text-amber-950" : "bg-slate-700 text-slate-100"}`}>
              {c.priority === "ESCALATION" ? "Escalation" : "Routine"}
            </span>
          </div>
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
        {rel && (
          <p className="mt-2 text-xs font-medium text-teal-900">
            Relationship status: <span className="rounded bg-white px-2 py-0.5 font-semibold">{rel.status}</span>
            {rel.next_step?.caller_label && <> · Next step: {rel.next_step.caller_label}</>}
          </p>
        )}
        {c.monitoring_due && (
          <p className="mt-2 text-xs font-semibold text-teal-900">{c.monitoring_due}</p>
        )}
        {c.comparison_notice && (
          <p className="mt-1 text-xs font-semibold text-teal-900">
            {c.comparison_notice}{c.comparison_date ? ` (${c.comparison_date})` : ""}
          </p>
        )}
        {c.journey_caller_label && (
          <p className="mt-1 text-xs font-medium text-teal-900">Journey step: {c.journey_caller_label}</p>
        )}
        {c.program_followups && c.program_followups.length > 0 && (
          <p className="mt-1 text-xs font-medium text-teal-900">Care follow-up: {c.program_followups.join(", ")}</p>
        )}
        {c.next_steps && c.next_steps.length > 0 && (
          <p className="mt-1 text-xs font-medium text-teal-900">
            Recommended next steps: {c.next_steps.length} ({c.next_steps.join(", ")})
          </p>
        )}
        {c.refill_reminder && (
          <p className="mt-1 text-xs font-medium text-teal-900">Refill reminder: {c.refill_reminder}</p>
        )}
        {c.specialist_bookings && c.specialist_bookings.length > 0 && (
          <div className="mt-2 space-y-1 text-xs text-teal-950">
            <p className="font-semibold">Specialist appointment booking:</p>
            {c.specialist_bookings.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-2">
                <span>{b.label}{b.scheduled_for ? ` (${b.scheduled_for})` : ""} — {b.status}</span>
                {b.status === "SUGGESTED" && (
                  <button
                    type="button"
                    className="rounded border border-teal-800 bg-white px-2 py-0.5 font-medium text-teal-800"
                    onClick={() => api(`/referrals/${b.id}`, { method: "PATCH", body: { status: "BOOKED" } }).then(reload)}
                  >
                    Mark booked
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
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
        <div className="space-y-4">
          <Actions fid={id} />
          <FollowupBookingCard fid={id} />
        </div>
      </div>
      <JourneyTimeline followupId={id} role="CALLER" />
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
