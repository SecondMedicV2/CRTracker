"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

function Summary({ b }: { b: any }) {
  return (
    <div role="status" className="rounded border bg-white p-3 text-sm shadow">
      <div className="font-medium">Batch #{b.id} · {b.source}</div>
      <div>Total {b.total} · New {b.new} · Already imported {b.duplicate} · Failed {b.failed}</div>
      {b.failures?.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-red-700">
          {b.failures.slice(0, 20).map((f: any, i: number) => <li key={i}>{f.value}: {f.reason}</li>)}
        </ul>
      )}
      <Link className="mt-1 inline-block underline" href={`/orders?batch_id=${b.id}`}>See these orders</Link>
    </div>
  );
}

export default function Import() {
  const history = useApi<any[]>("/imports");
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [column, setColumn] = useState("");
  const [range, setRange] = useState({ start: "", end: "" });

  const done = (b: any) => { setSummary(b); setError(""); history.reload(); };
  const fail = (e: any) => setError(e.message);

  async function upload(path: string, extra?: Record<string, string>) {
    const fd = new FormData();
    fd.append("file", file!);
    Object.entries(extra ?? {}).forEach(([k, v]) => fd.append(k, v));
    const r = await fetch(`/api/v1${path}`, { method: "POST", body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Upload failed");
    return data;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Import orders</h1>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {summary && <Summary b={summary} />}

      <section className="space-y-2 rounded bg-white p-4 shadow">
        <h2 className="font-medium">1. Type or paste order IDs</h2>
        <textarea aria-label="Order IDs" className="h-28 w-full rounded border p-2 font-mono text-sm" placeholder="One per line, or comma separated" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="rounded bg-slate-900 px-3 py-1 text-white" disabled={!text.trim()}
          onClick={() => api("/imports/manual", { method: "POST", body: { text } }).then((b) => { done(b); setText(""); }).catch(fail)}>Import</button>
      </section>

      <section className="space-y-2 rounded bg-white p-4 shadow">
        <h2 className="font-medium">2. CSV or XLSX file</h2>
        <input type="file" aria-label="Order ID file (CSV or XLSX)" accept=".csv,.xlsx" onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f); setPreview(null); setColumn("");
          if (f) { const fd = new FormData(); fd.append("file", f);
            fetch("/api/v1/imports/file/preview", { method: "POST", body: fd }).then(async (r) => {
              const d = await r.json(); if (!r.ok) throw new Error(d.detail); setPreview(d); setColumn(d.columns[0] ?? "");
            }).catch(fail); }
        }} />
        {preview && (
          <div className="space-y-2 text-sm">
            <label>Order ID column{" "}
              <select className="rounded border p-1" value={column} onChange={(e) => setColumn(e.target.value)}>
                {preview.columns.map((c: string) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <div className="text-slate-600">{preview.rows} rows. First rows: {preview.sample.map((r: string[]) => r.join(" | ")).join(" ; ")}</div>
            <button className="rounded bg-slate-900 px-3 py-1 text-white" onClick={() => upload("/imports/file", { column }).then(done).catch(fail)}>Import file</button>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded bg-white p-4 shadow">
        <h2 className="font-medium">3. Pull serviced orders from the lab</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input type="date" aria-label="From date" className="rounded border p-1" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
          <span>to</span>
          <input type="date" aria-label="To date" className="rounded border p-1" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
          <button className="rounded bg-slate-900 px-3 py-1 text-white" disabled={!range.start || !range.end}
            onClick={() => api("/imports/pull", { method: "POST", body: range }).then(done).catch(fail)}>Pull now</button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Recent batches</h2>
        <table className="w-full bg-white text-left text-sm shadow">
          <thead><tr><th className="p-2">#</th><th>Source</th><th>Total</th><th>New</th><th>Dup</th><th>Failed</th><th>When</th></tr></thead>
          <tbody>{history.data?.map((b) => (
            <tr key={b.id} className="border-t"><td className="p-2"><Link className="underline" href={`/orders?batch_id=${b.id}`}>{b.id}</Link></td>
              <td>{b.source}</td><td>{b.total}</td><td>{b.new}</td><td>{b.duplicate}</td><td>{b.failed}</td>
              <td>{new Date(b.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}
