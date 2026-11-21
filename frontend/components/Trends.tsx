"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import TrendChart from "./TrendChart";

const RANGES: [string, string][] = [["1y", "1 year"], ["5y", "5 years"], ["all", "All"]];

export default function Trends({ patientId }: { patientId: number | string }) {
  const params = useApi<any[]>(`/trends/${patientId}/parameters`);
  const [codes, setCodes] = useState<string[]>([]);
  const [range, setRange] = useState("all");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  // start with the (up to four) tests that are out of range
  useEffect(() => {
    if (params.data && codes.length === 0) setCodes((params.data ?? []).filter((p) => p.abnormal > 0).slice(0, 4).map((p) => p.code));
  }, [params.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (codes.length === 0) { setData(null); return; }
    api(`/trends/${patientId}?codes=${codes.join(",")}&range=${range}`).then((d) => { setData(d); setError(""); }).catch((e) => setError(e.message));
  }, [codes, range, patientId]);

  if (params.error) return <p role="alert" className="text-sm">{params.error}</p>;
  if (!params.data) return null;
  const toggle = (c: string) => setCodes(codes.includes(c) ? codes.filter((x) => x !== c) : codes.length < 4 ? [...codes, c] : codes);

  return (
    <section className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Trends</h2>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {RANGES.map(([v, label]) => (
            <button key={v} onClick={() => setRange(v)} className={`rounded border px-2 py-0.5 ${range === v ? "bg-slate-900 text-white" : "bg-white"}`}>{label}</button>
          ))}
          {codes.length > 0 && <a className="underline" href={`/api/v1/exports/trends/${patientId}.csv?codes=${codes.join(",")}&range=${range}`}>CSV</a>}
          <button className="underline" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 print:hidden">
        {(params.data ?? []).map((p) => (
          <label key={p.code} className={`flex items-center gap-1 ${p.abnormal ? "font-medium" : ""}`}>
            <input type="checkbox" checked={codes.includes(p.code)} disabled={!codes.includes(p.code) && codes.length >= 4} onChange={() => toggle(p.code)} />
            {p.name} ({p.count}){p.abnormal > 0 && <span className="text-red-700"> ●</span>}
          </label>
        ))}
        <span className="text-slate-500">Up to 4 tests at a time.</span>
      </div>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {data?.history_starts && <p className="text-slate-600">History starts from {new Date(data.history_starts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}: earlier reports are not in the system.</p>}
      {codes.length === 0 && <p className="text-slate-600">Pick a test to see its history.</p>}
      <div className="grid gap-3 md:grid-cols-2">{(data?.series ?? []).map((s: any) => <TrendChart key={s.code} s={s} />)}</div>
      <p className="text-xs text-slate-500">Red dots are outside the normal range; the green band is the normal range. Click a dot to open that report.</p>
    </section>
  );
}
