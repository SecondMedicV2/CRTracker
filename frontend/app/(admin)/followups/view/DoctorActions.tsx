"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const fmt = (d?: string) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");

export default function DoctorActions({ fid }: { fid: string }) {
  const wf = useApi<any>(`/followups/${fid}/workflow`);
  const comments = useApi<any[]>(`/followups/${fid}/comments`);
  const rules = useApi<any>("/rules/test_catalogue");
  const [msg, setMsg] = useState("");
  const [notes, setNotes] = useState("");
  const [tests, setTests] = useState<string[]>([]);
  const [next, setNext] = useState("");
  const [comment, setComment] = useState("");
  const [shared, setShared] = useState(false);
  const w = wf.data;
  const run = (p: Promise<any>) => p.then(() => { setMsg(""); wf.reload(); comments.reload(); }).catch((e) => setMsg(e.message));
  if (!w) return null;
  const open = !["DOCTOR_DONE", "RETEST_RECOMMENDED", "RETEST_ORDERED", "DECLINED", "WRONG_NUMBER"].includes(w.stage);

  return (
    <section className="space-y-3 rounded bg-white p-4 text-sm shadow">
      <h2 className="text-lg font-semibold">Call and outcome</h2>
      {msg && <p role="alert" className="text-red-600">{msg}</p>}
      <div>
        Stage <b>{w.stage}</b> · consent {w.consent ? `recorded ${fmt(w.consent.given_at)}` : "not recorded"}
        {w.appointment && <> · booked {fmt(w.appointment.slot_start)}</>}
        {w.accepted_at ? <> · accepted</> : <> · <button className="underline" onClick={() => run(api(`/followups/${fid}/accept`, { method: "POST" }))}>Accept this case</button></>}
      </div>
      {!w.consent && open && (
        <button className="rounded border px-3 py-1" onClick={() => run(api(`/followups/${fid}/consent`, { method: "POST" }))}>Record consent taken on my call</button>
      )}
      {open && (
        <div className="space-y-2 rounded border p-3">
          <textarea className="h-16 w-full rounded border p-1" placeholder="Notes from the call" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div>Recommend tests:
            <div className="flex flex-wrap gap-3">{(rules.data?.data ?? []).map((t: any) => (
              <label key={t.code} className="flex items-center gap-1">
                <input type="checkbox" checked={tests.includes(t.code)} onChange={(e) => setTests(e.target.checked ? [...tests, t.code] : tests.filter((x) => x !== t.code))} />{t.name}
              </label>))}</div>
          </div>
          <label>Next follow-up on <input type="date" className="rounded border p-1" value={next} onChange={(e) => setNext(e.target.value)} /></label>
          <div className="flex gap-2">
            <button className="rounded bg-slate-900 px-3 py-1 text-white"
              onClick={() => run(api(`/followups/${fid}/doctor-outcome`, { method: "POST", body: { outcome: "DOCTOR_DONE", notes, retest_codes: tests, ...(next && { next_followup_on: next }) } }))}>Mark call done</button>
            <button className="rounded border px-3 py-1" onClick={() => run(api(`/followups/${fid}/doctor-outcome`, { method: "POST", body: { outcome: "RECALL_CALLER", notes } }))}>Ask the caller to re-contact</button>
          </div>
        </div>
      )}
      {(w.recommendations ?? []).map((r: any) => (
        <div key={r.id}>Recommended: {r.test_codes.join(", ")} · {r.ordered ? `ordered (${r.ordered_ref || "no reference"})` : (
          <button className="underline" onClick={() => { const ref = prompt("Order reference (optional)") ?? ""; run(api(`/retest-recommendations/${r.id}/ordered`, { method: "POST", body: { ordered_ref: ref } })); }}>Mark as ordered</button>)}</div>
      ))}
      <div>
        <div className="font-medium">Comments</div>
        <ul className="space-y-1">{(comments.data ?? []).map((c) => <li key={c.id} className={c.urgent ? "font-medium text-red-700" : ""}>{c.by} ({c.role}, {fmt(c.at)}): {c.text}</li>)}</ul>
        <textarea className="mt-1 h-14 w-full rounded border p-1" placeholder="Add a note" value={comment} onChange={(e) => setComment(e.target.value)} />
        <label className="mr-3"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Caller can read this</label>
        <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={!comment.trim()}
          onClick={() => run(api(`/followups/${fid}/comments`, { method: "POST", body: { text: comment, for_caller: shared } }).then(() => setComment("")))}>Add note</button>
      </div>
    </section>
  );
}
