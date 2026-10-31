"use client";
import { useState } from "react";
import { useApi } from "@/lib/useApi";

const iso = (d: Date) => d.toISOString().slice(0, 10);

function Card({ label, value, sub, warn }: { label: string; value: any; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded bg-white p-3 shadow">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold ${warn && Number(value) > 0 ? "text-red-700" : ""}`}>{value ?? "–"}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const { data: d, error } = useApi<any>(`/dashboard?from=${from}&to=${to}`);
  if (error) return <p role="alert">{error}</p>;
  const top = d?.funnel?.[0]?.count || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" aria-label="From" className="rounded border p-1" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          <span>to</span>
          <input type="date" aria-label="To" className="rounded border p-1" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </div>
      </div>
      {!d ? null : (
        <>
          {Object.values(d.needs_attention).some((n: any) => n > 0) && (
            <div role="alert" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm">
              Needs attention now: {d.needs_attention.failed_fetch} failed downloads, {d.needs_attention.failed_extract} failed readings,{" "}
              {d.needs_attention.needs_review} reports to review, {d.needs_attention.pending_identity} duplicate checks waiting.
            </div>
          )}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="Orders imported" value={d.orders.imported} sub={`${d.orders.failed} failed`} warn />
            <Card label="Reports ready" value={d.orders.reports_ready} />
            <Card label="Normal / abnormal" value={`${d.results.normal} / ${d.results.abnormal}`} />
            <Card label="Retests recommended / ordered" value={`${d.retests.recommended} / ${d.retests.ordered}`} />
            <Card label="Follow-ups due today" value={d.followups_due.today} />
            <Card label="Due this week" value={d.followups_due.this_week} />
            <Card label="Overdue" value={d.followups_due.overdue} warn />
            <Card label="Parked (low potential)" value={d.followups_due.parked} />
            <Card label="Calls made" value={d.calls.made} />
            <Card label="Consent rate" value={d.calls.consent_rate_pct == null ? "–" : `${d.calls.consent_rate_pct}%`} sub="of patients called" />
            <Card label="Bookings" value={d.calls.bookings} />
            <Card label="Doctor calls done" value={d.calls.doctor_calls_done} />
          </section>

          <section>
            <h2 className="mb-1 font-medium">Conversion funnel</h2>
            <p className="mb-2 text-xs text-slate-500">Follow-ups created in the period, and how far each got.</p>
            <ul className="space-y-1 text-sm">{d.funnel.map((s: any) => (
              <li key={s.step} className="flex items-center gap-2">
                <span className="w-44 shrink-0">{s.step}</span>
                <div className="h-5 flex-1 rounded bg-slate-200"><div className="h-5 rounded bg-slate-700" style={{ width: `${top ? (s.count / top) * 100 : 0}%` }} /></div>
                <span className="w-10 text-right">{s.count}</span>
              </li>))}</ul>
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <section>
              <h2 className="mb-1 font-medium">Patients per bucket (now)</h2>
              <table className="w-full bg-white text-left text-sm shadow"><tbody>
                {Object.entries(d.patients_per_bucket).map(([k, v]: any) => <tr key={k} className="border-t"><td className="p-2">{k}</td><td>{v}</td></tr>)}
                {Object.keys(d.patients_per_bucket).length === 0 && <tr><td className="p-2 text-slate-500">None yet</td></tr>}
              </tbody></table>
            </section>
            <section>
              <h2 className="mb-1 font-medium">Calls by outcome</h2>
              <table className="w-full bg-white text-left text-sm shadow"><tbody>
                {Object.entries(d.calls.by_outcome).map(([k, v]: any) => <tr key={k} className="border-t"><td className="p-2">{k}</td><td>{v}</td></tr>)}
                {Object.keys(d.calls.by_outcome).length === 0 && <tr><td className="p-2 text-slate-500">No calls in this period</td></tr>}
              </tbody></table>
            </section>
          </div>

          <section>
            <h2 className="mb-1 font-medium">Doctor load</h2>
            <table className="w-full bg-white text-left text-sm shadow">
              <thead><tr><th className="p-2">Doctor</th><th>Open</th><th>Escalations</th><th>Not accepted</th><th>Upcoming bookings</th><th>Calls done</th></tr></thead>
              <tbody>{d.doctors.map((x: any) => (
                <tr key={x.id} className="border-t"><td className="p-2">{x.name}{x.in_pilot && " (pilot)"}</td><td>{x.open_cases}</td><td>{x.escalations}</td>
                  <td className={x.not_accepted > 0 ? "text-amber-700" : ""}>{x.not_accepted}</td><td>{x.upcoming_bookings}</td><td>{x.calls_done}</td></tr>))}</tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
