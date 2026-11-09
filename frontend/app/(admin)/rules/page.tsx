"use client";
import { useState } from "react";
import { RequestState } from "@/components/RequestState";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

function Rule({ k, onChange }: { k: string; onChange: () => void }) {
  const { data, error, reload } = useApi<any>(`/rules/${k}`);
  const [text, setText] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  if (error || !data) return <RequestState loading={!data} error={error} retry={reload} />;
  const shown = text ?? JSON.stringify(data.data, null, 2);

  async function save() {
    try {
      await api(`/rules/${k}`, { method: "PUT", body: { data: JSON.parse(shown) } });
      setText(null); setMsg(""); reload(); onChange();
    } catch (e: any) { setMsg(e.message); }
  }
  async function signoff() {
    try { await api(`/rules/${k}/signoff`, { method: "POST" }); reload(); onChange(); } catch (e: any) { setMsg(e.message); }
  }

  return (
    <details className="rounded bg-white p-3 shadow">
      <summary className="cursor-pointer text-sm font-medium">
        {k} · v{data.version} · {data.pending_signoff ? <span className="text-amber-800">pending sign-off</span> : <span className="text-green-700">signed off</span>}
      </summary>
      <textarea aria-label={`${k} (JSON)`} className="mt-2 h-64 w-full rounded border p-2 font-mono text-xs" value={shown} onChange={(e) => setText(e.target.value)} />
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <button className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40" disabled={text === null} onClick={save}>Save as new version</button>
        <button className="rounded border px-3 py-1" onClick={signoff}>Record doctor sign-off</button>
      </div>
    </details>
  );
}

export default function Rules() {
  const { data, error, reload } = useApi<any[]>("/rules");
  const pending = data?.some((r) => r.pending_signoff);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Rules</h1>
      <RequestState loading={!data} error={error} retry={reload} empty={data?.length === 0 ? "No rule sets found." : undefined} />
      {pending && <div role="alert" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm">Starter content, pending clinical sign-off. Do not use in production until a doctor approves each rule set.</div>}
      {data?.map((r) => <Rule key={r.key} k={r.key} onChange={reload} />)}
    </div>
  );
}
