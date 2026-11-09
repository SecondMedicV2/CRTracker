"use client";

import { useState } from "react";
import { RequestState } from "@/components/RequestState";
import { api } from "@/lib/api";
import { callStageLabel } from "@/lib/callWorkflow";
import { useApi } from "@/lib/useApi";

const formatTime = (date: string) => new Date(date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const callable = ["NOT_CALLED", "CALLED", "CONSENT_GIVEN", "NOT_REACHABLE", "CALL_LATER"];
const outcomes = ["NOT_REACHABLE", "DECLINED", "WRONG_NUMBER"];
const panel = "space-y-3 rounded-xl border border-slate-200 bg-white p-4";
const primary = "rounded-lg bg-teal-800 px-3 py-2 font-semibold text-white";
const secondary = "rounded-lg border border-slate-300 px-3 py-2 font-medium";

type Workflow = {
  stage: string;
  attempts: number;
  suppressed_reason: string;
  call_later_at: string | null;
  consent: { given_at: string } | null;
  appointment: { slot_start: string } | null;
};

type Comment = { id: number; by: string; at: string; text: string; urgent: boolean };
type Doctor = { id: number; name: string; active: boolean };
type DoctorContact = { doctor: string; dial: { number?: string } };

export default function Actions({ fid }: { fid: string }) {
  const wf = useApi<Workflow>(`/followups/${fid}/workflow`);
  const comments = useApi<Comment[]>(`/followups/${fid}/comments`);
  const doctors = useApi<Doctor[]>("/doctors");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [slot, setSlot] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [later, setLater] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [doctorNote, setDoctorNote] = useState("");
  const [contact, setContact] = useState<DoctorContact | null>(null);
  const w = wf.data;
  const closed = !!w && (!callable.includes(w.stage) || !!w.suppressed_reason);

  async function run(action: () => Promise<unknown>, success: string) {
    if (pending) return;
    setPending(true);
    setError("");
    setFeedback("");
    try {
      await action();
      setFeedback(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this action. Try again.");
    } finally {
      setPending(false);
    }
  }

  function logOutcome(outcome: string, details: object = {}) {
    void run(async () => {
      await api(`/followups/${fid}/calls`, { method: "POST", body: { outcome, notes: outcomeNote, ...details } });
      setOutcomeNote("");
      setContact(null);
      wf.reload();
    }, `Call outcome saved. ${callStageLabel(outcome)}.`);
  }

  function sendDoctorNote(escalation: boolean) {
    void run(async () => {
      await api(`/followups/${fid}/comments`, { method: "POST", body: { text: doctorNote, request_escalation: escalation } });
      setDoctorNote("");
      comments.reload();
    }, escalation ? "Urgent escalation requested." : "Note sent to the doctor.");
  }

  return (
    <section id="call-actions" aria-labelledby="call-actions-heading" className="min-w-0 space-y-4">
      <h2 id="call-actions-heading" className="text-lg font-semibold">Status and actions</h2>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
      {feedback && <p role="status" className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-teal-950">{feedback}</p>}
      {pending && <p role="status" className="text-slate-600">Saving…</p>}
      <RequestState loading={!w} error={wf.error} retry={wf.reload} />

      {w && !wf.error && (
        <>
          <div className={panel}>
            <p><strong>{callStageLabel(w.stage)}</strong> <span className="text-slate-600">· {w.attempts} {w.attempts === 1 ? "attempt" : "attempts"}</span></p>
            {w.suppressed_reason && <p className="text-red-800">{w.suppressed_reason}</p>}
            {w.stage === "CALL_LATER" && w.call_later_at && <p>Callback scheduled for {formatTime(w.call_later_at)} IST</p>}
            {w.appointment && <p>Doctor call booked for {formatTime(w.appointment.slot_start)} IST</p>}
            {closed && <p className="text-slate-600">Calling actions are closed for this follow-up.</p>}
          </div>

          {!closed && (
            <>
              <section className={panel}>
                <h3 className="font-semibold">Doctor handoff</h3>
                {w.consent ? <p className="text-teal-800">Consent recorded {formatTime(w.consent.given_at)} IST</p> : (
                  <div className="space-y-2">
                    <p>Confirm the customer agrees to the doctor call and to sharing their report.</p>
                    <button type="button" className={primary} disabled={pending} onClick={() => run(async () => {
                      await api(`/followups/${fid}/consent`, { method: "POST" });
                      wf.reload();
                    }, "Consent recorded.")}>Record consent</button>
                  </div>
                )}
                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <h4 className="font-medium">Connect now</h4>
                  <p className="text-slate-600">Request the doctor’s contact details and send a handoff alert.</p>
                  <button type="button" className={secondary} disabled={pending} onClick={() => run(async () => {
                    setContact(await api<DoctorContact>(`/followups/${fid}/connect-doctor`, { method: "POST" }));
                  }, "Doctor handoff requested.")}>Request doctor handoff</button>
                  {contact && <p className="rounded-lg bg-slate-100 p-2">{contact.doctor}{contact.dial.number ? ` · Dial ${contact.dial.number} to connect.` : " · No dial number is available."}</p>}
                </div>
                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <h4 className="font-medium">Schedule a doctor call</h4>
                  <label className="block">Appointment date and time (IST)
                    <input type="datetime-local" className="mt-1 block rounded border p-2" value={slot} onChange={(e) => setSlot(e.target.value)} />
                  </label>
                  <label className="block">Doctor
                    <select className="mt-1 block rounded border p-2" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                      <option value="">Assigned doctor</option>{doctors.data?.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </label>
                  {doctors.error && <RequestState loading={false} error={doctors.error} retry={doctors.reload} />}
                  <button type="button" className={primary} disabled={pending || !slot || !w.consent}
                    onClick={() => logOutcome("BOOKED", { slot_start: slot, ...(doctorId && { doctor_id: Number(doctorId) }) })}>Book doctor call</button>
                  {!w.consent && <p className="text-slate-600">Record consent before booking.</p>}
                </div>
              </section>

              <section className={panel}>
                <h3 className="font-semibold">Record call outcome</h3>
                <label className="block">Call note (optional)
                  <input className="mt-1 block w-full rounded border p-2" maxLength={500} disabled={pending} value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} />
                </label>
                <div className="flex flex-wrap gap-2">
                  {outcomes.map((outcome) => <button key={outcome} type="button" className={secondary} disabled={pending} onClick={() => logOutcome(outcome)}>{callStageLabel(outcome)}</button>)}
                  <button type="button" className="rounded-lg border border-red-300 px-3 py-2 font-medium text-red-800" disabled={pending} onClick={() => {
                    if (confirm("Never call this patient again?")) logOutcome("DO_NOT_CALL");
                  }}>Do not call again</button>
                </div>
                <label className="block">Callback date and time (IST)
                  <input type="datetime-local" className="mt-1 block rounded border p-2" value={later} onChange={(e) => setLater(e.target.value)} />
                </label>
                <button type="button" className={secondary} disabled={pending || !later} onClick={() => logOutcome("CALL_LATER", { call_later_at: later })}>Schedule callback</button>
              </section>
            </>
          )}
        </>
      )}

      <section className={panel}>
        <h3 className="font-semibold">Notes for the doctor</h3>
        <RequestState loading={!comments.data} error={comments.error} retry={comments.reload} />
        <ul className="space-y-2">{comments.data?.map((comment) => <li key={comment.id} className={comment.urgent ? "text-red-800" : ""}>
          <p className="text-xs font-semibold">{comment.by} · {formatTime(comment.at)} IST</p><p>{comment.text}</p>
        </li>)}</ul>
        <label className="block">Questions or concerns to pass on
          <textarea className="mt-1 block min-h-20 w-full rounded border p-2" maxLength={1000} disabled={pending} value={doctorNote} onChange={(e) => setDoctorNote(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondary} disabled={pending || !doctorNote.trim()} onClick={() => sendDoctorNote(false)}>Send doctor note</button>
          <button type="button" className="rounded-lg border border-red-300 px-3 py-2 font-medium text-red-800" disabled={pending || !doctorNote.trim()} onClick={() => sendDoctorNote(true)}>Request urgent escalation</button>
        </div>
      </section>
    </section>
  );
}
