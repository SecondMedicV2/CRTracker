"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const fmt = (d?: string) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");

export default function Actions({ fid }: { fid: string }) {
  const wf = useApi<any>(`/followups/${fid}/workflow`);
  const comments = useApi<any[]>(`/followups/${fid}/comments`);
  const doctors = useApi<any[]>("/doctors");
  const [msg, setMsg] = useState("");
  const [slot, setSlot] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [later, setLater] = useState("");
  const [note, setNote] = useState("");
  const [dial, setDial] = useState<any>(null);
  const w = wf.data;
  const run = (p: Promise<any>) => p.then(() => { setMsg(""); wf.reload(); comments.reload(); }).catch((e) => setMsg(e.message));
  const call = (body: object) => run(api(`/followups/${fid}/calls`, { method: "POST", body }));
  if (!w) return null;
  const closed = !["NOT_CALLED", "CALLED", "CONSENT_GIVEN", "NOT_REACHABLE", "CALL_LATER"].includes(w.stage) || !!w.suppressed_reason;

  return (
    <div className="space-y-4 text-sm">
      <h2 className="text-lg font-semibold">After the call</h2>
      {msg && <p role="alert" className="text-red-600">{msg}</p>}
      <div className="rounded bg-white p-3 shadow">
        Stage <b>{w.stage}</b> · attempts {w.attempts}{w.suppressed_reason && <> · <span className="text-red-700">{w.suppressed_reason}</span></>}
        {w.appointment && <div>Booked with doctor for {fmt(w.appointment.slot_start)}</div>}
      </div>

      {!closed && (
        <>
          <section className="space-y-2 rounded bg-white p-3 shadow">
            <div className="font-medium">Consent</div>
            {w.consent
              ? <div className="text-green-700">Consent recorded {fmt(w.consent.given_at)}</div>
              : <button className="rounded bg-slate-900 px-3 py-1 text-white" onClick={() => run(api(`/followups/${fid}/consent`, { method: "POST" }))}>
                  The patient agreed to the free doctor call and to sharing their report
                </button>}
          </section>

          <section className="space-y-2 rounded bg-white p-3 shadow">
            <div className="font-medium">Book a doctor slot</div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="datetime-local" aria-label="Appointment date and time" className="rounded border p-1" value={slot} onChange={(e) => setSlot(e.target.value)} />
              <select aria-label="Doctor for the booking" className="rounded border p-1" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">Assigned doctor</option>{doctors.data?.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40" disabled={!slot || !w.consent}
                onClick={() => call({ outcome: "BOOKED", slot_start: slot, ...(doctorId && { doctor_id: Number(doctorId) }) })}>Book</button>
            </div>
            {!w.consent && <div className="text-slate-500">Record consent first.</div>}
            <button className="underline" onClick={() => api(`/followups/${fid}/connect-doctor`, { method: "POST" }).then(setDial).catch((e) => setMsg(e.message))}>Connect doctor now</button>
            {dial && <div className="rounded bg-slate-100 p-2">Dial {dial.dial.number || "(no number saved)"} to reach {dial.doctor}. The doctor has been notified.</div>}
          </section>

          <section className="space-y-2 rounded bg-white p-3 shadow">
            <div className="font-medium">Other outcomes</div>
            <input className="w-full rounded border p-1" placeholder="Short note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              <button className="rounded border px-3 py-1" onClick={() => call({ outcome: "NOT_REACHABLE", notes: note })}>Not reachable</button>
              <button className="rounded border px-3 py-1" onClick={() => call({ outcome: "DECLINED", notes: note })}>Declined</button>
              <button className="rounded border px-3 py-1" onClick={() => call({ outcome: "WRONG_NUMBER", notes: note })}>Wrong number</button>
              <button className="rounded border border-red-400 px-3 py-1 text-red-700" onClick={() => confirm("Never call this patient again?") && call({ outcome: "DO_NOT_CALL", notes: note })}>Do not call again</button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="datetime-local" aria-label="Call back date and time" className="rounded border p-1" value={later} onChange={(e) => setLater(e.target.value)} />
              <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={!later} onClick={() => call({ outcome: "CALL_LATER", call_later_at: later, notes: note })}>Call later</button>
            </div>
          </section>
        </>
      )}

      <section className="space-y-2 rounded bg-white p-3 shadow">
        <div className="font-medium">Comments for the doctor</div>
        <ul className="space-y-1">{comments.data?.map((c) => <li key={c.id} className={c.urgent ? "text-red-700" : ""}>{c.by} ({fmt(c.at)}): {c.text}</li>)}</ul>
        <textarea className="h-16 w-full rounded border p-1" placeholder="Write a comment" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-2">
          <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={!note.trim()} onClick={() => run(api(`/followups/${fid}/comments`, { method: "POST", body: { text: note } }).then(() => setNote("")))}>Send comment</button>
          <button className="rounded border border-red-400 px-3 py-1 text-red-700 disabled:opacity-40" disabled={!note.trim()}
            onClick={() => run(api(`/followups/${fid}/comments`, { method: "POST", body: { text: note, request_escalation: true } }).then(() => setNote("")))}>Request escalation (urgent symptoms)</button>
        </div>
      </section>
    </div>
  );
}
