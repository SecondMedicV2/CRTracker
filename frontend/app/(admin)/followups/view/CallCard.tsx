"use client";
import { TableFrame } from "@/components/TableFrame";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const List = ({ title, items }: { title: string; items: string[] }) => items.length > 0 ? (
  <div><div className="font-medium">{title}</div><ul className="list-disc pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
) : null;

export default function CallCard({ fid, role }: { fid: string; role: string }) {
  const { data: c, error, reload } = useApi<any>(`/followups/${fid}/call-card`);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const run = (p: Promise<any>) => p.then(() => { setMsg(""); setEditing(null); reload(); }).catch((e) => setMsg(e.message));
  const generate = () => run(api(`/followups/${fid}/call-card/generate`, { method: "POST" }));

  if (error && !c) return (
    <section className="space-y-2"><h2 className="font-medium">Call Card</h2>
      <p className="text-sm text-slate-600">No call card yet.</p>
      <button className="rounded bg-slate-900 px-3 py-1 text-sm text-white" onClick={generate}>Generate call card</button>
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
    </section>
  );
  if (!c) return null;
  const b = c.content;
  const s = b.doctor_script;

  return (
    <section className="space-y-4 rounded bg-white p-4 text-sm shadow print:shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Call Card · v{c.version}</h2>
        <div className="flex gap-2 print:hidden">
          <button className="underline" onClick={generate}>Regenerate</button>
          <button className="underline" onClick={() => window.print()}>Print</button>
          {role === "DOCTOR" && !c.approved && c.validation_status === "VALID" && (
            <button className="rounded bg-slate-900 px-3 py-1 text-white" onClick={() => run(api(`/call-cards/${c.id}/approve`, { method: "POST" }))}>Approve</button>
          )}
        </div>
      </div>
      <div className={c.approved ? "text-green-700" : "text-amber-700"}>{c.label} · {c.language} · {c.model}</div>
      {c.notice && <div role="alert" className="rounded border border-amber-400 bg-amber-50 p-2">{c.notice}</div>}
      {c.validation_status !== "VALID" && (
        <div role="alert" className="rounded border border-red-400 bg-red-50 p-2">Needs review: {c.validation_errors.join("; ")}</div>
      )}
      {msg && <p role="alert" className="text-red-600">{msg}</p>}

      <div><b>{b.summary.headline}</b> · report {b.summary.report_age_days} days old · {b.summary.lab}</div>

      <div>
        <h3 className="font-medium">Retest scope · {b.retest.tier} ({b.retest.score}) · confidence {b.retest.confidence}</h3>
        <TableFrame label="Call card results">
          <table className="mt-1 w-full text-left">
            <thead><tr><th className="p-1">Test</th><th>Why</th></tr></thead>
            <tbody>{b.retest.recommended_tests.map((t: any) => <tr key={t.test_code} className="border-t"><td className="p-1">{t.name}</td><td>{t.rationale}</td></tr>)}</tbody>
          </table>
        </TableFrame>
        <div className="mt-1 text-slate-600">Ideal window: {b.retest.ideal_window.from} to {b.retest.ideal_window.to}</div>
      </div>

      <details open>
        <summary className="cursor-pointer font-medium">Doctor script</summary>
        <div className="mt-2 space-y-2">
          <p>{s.opening}</p>
          <List title="Findings" items={s.scientific_talking_points} />
          <List title="Discussion points" items={s.discussion_points} />
          <List title="Questions to ask" items={s.questions_to_ask} />
          <List title="Counselling" items={s.counselling_points} />
          <List title="Tests to suggest" items={s.tests_to_suggest} />
          <List title="Red flags" items={s.red_flags} />
          <p>{s.closing} {s.next_followup_suggestion}</p>
        </div>
      </details>

      <details>
        <summary className="cursor-pointer font-medium">Caller script (what the caller will read)</summary>
        <div className="mt-2 space-y-1">
          {["opening", "identity_check", "free_followup_pitch", "consent_request", "slot_offer", "urgent_symptom_protocol", "closing"].map((k) => (
            <p key={k}><span className="text-slate-500">{k.replaceAll("_", " ")}:</span> {b.caller_script[k]}</p>
          ))}
        </div>
      </details>

      <div className="print:hidden">
        {editing === null
          ? <button className="underline" onClick={() => setEditing(JSON.stringify(b, null, 2))}>Edit card</button>
          : <div className="space-y-2">
              <textarea aria-label="Call card (JSON)" className="h-80 w-full rounded border p-2 font-mono text-xs" value={editing} onChange={(e) => setEditing(e.target.value)} />
              <div className="flex gap-2">
                <button className="rounded bg-slate-900 px-3 py-1 text-white" onClick={() => { try { run(api(`/call-cards/${c.id}`, { method: "PUT", body: { content: JSON.parse(editing) } })); } catch { setMsg("That is not valid JSON"); } }}>Save as new version</button>
                <button className="underline" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>}
      </div>
    </section>
  );
}
