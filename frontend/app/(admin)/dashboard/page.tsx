"use client";
import { TableFrame } from "@/components/TableFrame";
import { RequestState } from "@/components/RequestState";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/useApi";

const istDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

function Card({ label, value, sub, warn, href }: { label: string; value: any; sub?: string; warn?: boolean; href?: string }) {
  const content = (
    <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className={`mt-2 text-3xl font-bold tracking-tight ${warn && Number(value) > 0 ? "text-red-600" : "text-slate-900"}`}>{value ?? "–"}</div>
      {sub && <div className="mt-1 text-sm text-slate-400">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{content}</Link> : content;
}

export default function Dashboard() {
  const [from, setFrom] = useState(() => istDate.format(Date.now() - 29 * 864e5));
  const [to, setTo] = useState(() => istDate.format(Date.now()));
  const { data: d, error, reload } = useApi<any>(`/dashboard?from=${from}&to=${to}`);
  const rel = useApi<any>("/relationship/summary");
  const top = d?.funnel?.[0]?.count || 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Track lab orders and follow-up activity.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-slate-500">From</span>
            <input type="date" className="rounded-lg border border-slate-200 px-3 py-2" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-slate-500">To</span>
            <input type="date" className="rounded-lg border border-slate-200 px-3 py-2" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </label>
        </div>
      </div>
      <RequestState loading={!d} error={error} retry={reload} />
      {d && !error && (
        <>
          {Number(d.urgent_24h ?? d.followups_due?.urgent_24h ?? 0) > 0 && (
            <section aria-labelledby="urgent-24h-heading" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-300 bg-red-50 px-6 py-4 text-sm text-red-950">
              <div>
                <h2 id="urgent-24h-heading" className="font-bold text-red-900">
                  Urgent — action within 24 h ({d.urgent_24h ?? d.followups_due?.urgent_24h})
                </h2>
                <p className="mt-0.5 text-xs text-red-800">Immediate clinician review required for critical values or suspected acute kidney injury.</p>
              </div>
              <Link href="/followups?protocol_tier=URGENT" className="rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-800">
                Open urgent queue
              </Link>
            </section>
          )}
          {Object.values(d.needs_attention).some((n: any) => n > 0) && (
            <section aria-labelledby="attention-heading" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
              <h2 id="attention-heading" className="font-semibold text-amber-950">Needs attention</h2>
              <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
                {d.needs_attention.failed_fetch > 0 && <li><Link href="/orders?status_=FAILED_FETCH" className="font-medium underline hover:text-amber-700">Failed downloads ({d.needs_attention.failed_fetch})</Link></li>}
                {d.needs_attention.failed_extract > 0 && <li>Failed readings ({d.needs_attention.failed_extract})</li>}
                {d.needs_attention.needs_review > 0 && <li><Link href="/reports?status_=NEEDS_REVIEW" className="font-medium underline hover:text-amber-700">Reports to review ({d.needs_attention.needs_review})</Link></li>}
                {d.needs_attention.pending_identity > 0 && <li><Link href="/identity" className="font-medium underline hover:text-amber-700">Duplicate checks ({d.needs_attention.pending_identity})</Link></li>}
              </ul>
            </section>
          )}
          <section aria-label="Key metrics" className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            <Card label="Orders imported" value={d.orders.imported} sub={`${d.orders.failed} failed`} href="/orders" />
            <Card label="Reports ready" value={d.orders.reports_ready} href="/reports?status_=READY" />
            <Card label="Normal / abnormal" value={`${d.results.normal} / ${d.results.abnormal}`} href="/reports" />
            <Card label="Retests recommended / ordered" value={`${d.retests.recommended} / ${d.retests.ordered}`} href="/reports" />
            <Card label="Follow-ups due today" value={d.followups_due.today} href="/followups" />
            <Card label="Due this week" value={d.followups_due.this_week} href="/followups" />
            <Card label="Overdue" value={d.followups_due.overdue} warn href="/followups" />
            <Card label="Parked (low potential)" value={d.followups_due.parked} href="/followups" />
            <Card label="Calls made" value={d.calls.made} href="/followups?view=done" />
            <Card label="Consent rate" value={d.calls.consent_rate_pct == null ? "–" : `${d.calls.consent_rate_pct}%`} sub="of patients called" href="/followups?view=done" />
            <Card label="Bookings" value={d.calls.bookings} href="/followups?view=done" />
            <Card label="Doctor calls done" value={d.calls.doctor_calls_done} href="/followups?view=done" />
          </section>

          <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Conversion funnel</h2>
            <p className="mt-1 text-sm text-slate-500">Follow-ups created in the period, and how far each got.</p>
            <ul className="mt-4 space-y-3 text-sm">{d.funnel.map((s: any) => (
              <li key={s.step} className="flex items-center gap-4">
                <span className="w-32 shrink-0 font-medium text-slate-700 sm:w-48">{s.step}</span>
                <div className="h-3 flex-1 rounded-full bg-slate-100"><div className="h-3 rounded-full bg-teal-500" style={{ width: `${top ? (s.count / top) * 100 : 0}%` }} /></div>
                <span className="w-12 text-right font-semibold text-slate-900">{s.count}</span>
              </li>))}</ul>
          </section>

          <div className="grid gap-8 md:grid-cols-2">
            <section>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">Patients per bucket (now)</h2>
              <TableFrame label="Patients per bucket">
                <table className="w-full text-sm"><tbody>
                  {Object.entries(d.patients_per_bucket).map(([k, v]: any) => <tr key={k} className="border-t border-slate-100"><td className="px-4 py-3 font-medium text-slate-700">{k}</td><td className="px-4 py-3 text-slate-900">{v}</td></tr>)}
                  {Object.keys(d.patients_per_bucket).length === 0 && <tr><td className="px-4 py-3 text-slate-500">None yet</td></tr>}
                </tbody></table>
              </TableFrame>
            </section>
            <section>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">Calls by outcome</h2>
              <TableFrame label="Call outcomes">
                <table className="w-full text-sm"><tbody>
                  {Object.entries(d.calls.by_outcome).map(([k, v]: any) => <tr key={k} className="border-t border-slate-100"><td className="px-4 py-3 font-medium text-slate-700">{k}</td><td className="px-4 py-3 text-slate-900">{v}</td></tr>)}
                  {Object.keys(d.calls.by_outcome).length === 0 && <tr><td className="px-4 py-3 text-slate-500">No calls in this period</td></tr>}
                </tbody></table>
              </TableFrame>
            </section>
          </div>

          <section>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Doctor load</h2>
            <TableFrame label="Doctor load">
              <table className="w-full text-sm">
                <thead><tr><th className="px-4 py-3 text-left font-semibold text-slate-600">Doctor</th><th className="px-4 py-3 text-left font-semibold text-slate-600">Open</th><th className="px-4 py-3 text-left font-semibold text-slate-600">Escalations</th><th className="px-4 py-3 text-left font-semibold text-slate-600">Not accepted</th><th className="px-4 py-3 text-left font-semibold text-slate-600">Upcoming</th><th className="px-4 py-3 text-left font-semibold text-slate-600">Calls done</th></tr></thead>
                <tbody>{d.doctors.map((x: any) => (
                  <tr key={x.id} className="border-t border-slate-100"><td className="px-4 py-3 font-medium text-slate-900">{x.name}{x.in_pilot && " (pilot)"}</td><td className="px-4 py-3 text-slate-700">{x.open_cases}</td><td className="px-4 py-3 text-slate-700">{x.escalations}</td>
                    <td className={`px-4 py-3 ${x.not_accepted > 0 ? "text-amber-700 font-medium" : "text-slate-700"}`}>{x.not_accepted}</td><td className="px-4 py-3 text-slate-700">{x.upcoming_bookings}</td><td className="px-4 py-3 text-slate-700">{x.calls_done}</td></tr>))}</tbody>
              </table>
            </TableFrame>
          </section>

          {rel.data && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">Relationship</h2>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Card label="New (≤30d)" value={rel.data.counts?.NEW} />
                <Card label="Active" value={rel.data.counts?.ACTIVE} />
                <Card label="At risk" value={rel.data.counts?.AT_RISK} warn />
                <Card label="Lapsed" value={rel.data.counts?.LAPSED} warn />
                <Card label="12m retention" value={rel.data.retention_12m_pct == null ? "–" : `${rel.data.retention_12m_pct}%`} />
                <Card label="Avg stages / active" value={rel.data.avg_stages_per_active} />
                <Card label="Annual contribution / active" value={`₹${rel.data.annual_contribution_inr ?? 0}`} />
              </div>
              {rel.data.stage_coverage_pct && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {Object.entries(rel.data.stage_coverage_pct).map(([st, pct]: any) => (
                    <span key={st} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">{st}: {pct}%</span>
                  ))}
                </div>
              )}
            </section>
          )}

          {Array.isArray(d.programs) && (
            <section>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">Recommended programmes</h2>
              <TableFrame label="Recommended programmes">
                <table className="w-full text-sm">
                  <thead><tr><th className="px-4 py-3 text-left font-semibold text-slate-600">Programme</th><th className="px-4 py-3 text-left font-semibold text-slate-600">Suggested</th><th className="px-4 py-3 text-left font-semibold text-slate-600">Accepted</th><th className="px-4 py-3 text-left font-semibold text-slate-600">Declined</th></tr></thead>
                  <tbody>
                    {d.programs.map((p: any) => (
                      <tr key={p.code} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-medium text-slate-900">{p.clinical_label}</td>
                        <td className="px-4 py-3 text-slate-700">{p.suggested}</td>
                        <td className="px-4 py-3 text-emerald-700">{p.accepted}</td>
                        <td className="px-4 py-3 text-slate-600">{p.declined}</td>
                      </tr>
                    ))}
                    {d.programs.length === 0 && <tr><td colSpan={4} className="px-4 py-3 text-slate-500">No programme recommendations in this period</td></tr>}
                  </tbody>
                </table>
              </TableFrame>
            </section>
          )}

          {Array.isArray(d.finding_funnel) && (
            <section>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">Finding recommendation conversion funnel</h2>
              <TableFrame label="Finding recommendation conversion funnel">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Diagnostic finding</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Patients</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Primary accepted</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Secondary accepted</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Third accepted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.finding_funnel.map((f: any) => (
                      <tr key={f.finding_code} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-medium text-slate-900">{f.label}</td>
                        <td className="px-4 py-3 text-slate-700">{f.patients}</td>
                        <td className="px-4 py-3 text-emerald-700">{f.primary_pct}%</td>
                        <td className="px-4 py-3 text-teal-700">{f.secondary_pct}%</td>
                        <td className="px-4 py-3 text-slate-700">{f.third_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            </section>
          )}
        </>
      )}
    </div>
  );
}
