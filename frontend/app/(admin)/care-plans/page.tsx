"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { RequestState } from "@/components/RequestState";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700", RENEWAL_DUE: "bg-amber-50 text-amber-800", DOCTOR_ASSESSED: "bg-sky-50 text-sky-800",
  SUGGESTED: "bg-slate-100 text-slate-700", NOT_ELIGIBLE: "bg-red-50 text-red-700", ENDED: "bg-slate-100 text-slate-500",
};

export default function CarePlansPage() {
  const [tab, setTab] = useState<"catalogue" | "enrollments">("catalogue");
  const me = useApi<any>("/auth/me");
  const role = me.data?.role;
  const { data: plans, error: plansErr, reload: reloadPlans } = useApi<any[]>("/care-plans");
  const { data: enrollments, error: enrErr, reload: reloadEnr } = useApi<any[]>("/care-plans/enrollments");
  const confirms = useApi<any>(role === "ADMIN" ? "/care-plans/confirms" : null);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ patient_id: "", plan_code: "", tier: "PLUS" });

  const run = async (fn: () => Promise<unknown>, ok = "") => {
    setMsg("");
    try { await fn(); setMsg(ok); reloadEnr(); reloadPlans(); } catch (e: any) { setMsg(e.message); }
  };

  const editPlan = (p: any) => {
    const tiers = p.tiers.map((t: any) => {
      const v = window.prompt(`${p.name_en}: ${t.tier} price (₹ per ${t.period.toLowerCase()})`, String(t.price_inr));
      return v !== null && /^\d+$/.test(v.trim()) ? { ...t, price_inr: Number(v) } : t;
    });
    const qr = window.prompt("QR code link (https://…), blank for none", p.qr_url || "");
    run(() => api(`/care-plans/${p.code}`, { method: "PATCH", body: { tiers, ...(qr !== null ? { qr_url: qr.trim() } : {}) } }), "Plan saved.");
  };

  const suggest = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => api("/care-plans/enroll", { method: "POST", body: { patient_id: Number(form.patient_id), plan_code: form.plan_code, tier: form.tier } }),
      "Plan suggested. A doctor must assess the patient before it can be paid for.");
  };
  const selected = plans?.find((p) => p.code === form.plan_code);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Health Hub care plans</h1>
          <p className="mt-1 text-sm text-slate-500">Suggested → assessed by a doctor → paid at the counter → active. Printable A5 flyers.</p>
        </div>
        <div className="flex gap-2">
          {(["catalogue", "enrollments"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === t ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              {t === "catalogue" ? `Plan catalogue (${plans?.length || 0})` : `Enrolments (${enrollments?.length || 0})`}
            </button>
          ))}
        </div>
      </div>
      {msg && <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-800">{msg}</p>}

      {tab === "catalogue" && (
        <>
          <RequestState loading={!plans} error={plansErr} retry={reloadPlans} />
          {role === "ADMIN" && confirms.data?.missing_confirms?.length > 0 && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <h2 className="font-semibold">Still to confirm with the business</h2>
              <ul className="mt-1 list-disc pl-5">
                {confirms.data.missing_confirms.map((c: any) => <li key={c.plan_code + c.field}><b>{c.plan_code}</b>: {c.note}</li>)}
              </ul>
            </section>
          )}
          {plans && (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {plans.map((p) => (
                <div key={p.code} className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">Plan #{p.number}</span>
                      <span className="text-xs font-medium text-teal-700">{p.line}</span>
                    </div>
                    <h3 className="mt-3 text-lg font-bold text-slate-900">{p.name_en}</h3>
                    <div className="text-sm font-semibold text-slate-600">{p.name_hi}</div>
                    <p className="mt-2 line-clamp-2 text-xs text-slate-500">{p.for_text}</p>
                    <div className="mt-3 text-sm text-slate-800">
                      {p.tiers?.map((t: any) => <div key={t.tier}>{t.tier.toLowerCase()}: ₹{t.price_inr} / {t.period.replace("BLOCK_8W", "8-week block").toLowerCase()}</div>)}
                    </div>
                  </div>
                  <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-xs">
                    {role === "ADMIN" ? <button onClick={() => editPlan(p)} className="font-semibold text-slate-700 hover:underline">Edit prices / QR</button> : <span />}
                    <Link href={`/care-plans/${p.code}/flyer`} target="_blank" className="font-semibold text-teal-600 hover:underline">Printable flyer →</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "enrollments" && (
        <>
          {role !== "CALLER" && plans && (
            <form onSubmit={suggest} className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <label className="block"><span className="text-xs text-slate-600">Patient ID</span>
                <input required inputMode="numeric" pattern="\d+" className="mt-1 block w-28 rounded-lg border border-slate-200 p-2"
                  value={form.patient_id} onChange={(e) => setForm({ ...form, patient_id: e.target.value })} /></label>
              <label className="block"><span className="text-xs text-slate-600">Plan</span>
                <select required className="mt-1 block rounded-lg border border-slate-200 p-2" value={form.plan_code}
                  onChange={(e) => setForm({ ...form, plan_code: e.target.value, tier: plans.find((p) => p.code === e.target.value)?.tiers?.at(-1)?.tier || "PLUS" })}>
                  <option value="">Choose…</option>
                  {plans.map((p) => <option key={p.code} value={p.code}>{p.number} · {p.name_en}</option>)}
                </select></label>
              <label className="block"><span className="text-xs text-slate-600">Tier</span>
                <select className="mt-1 block rounded-lg border border-slate-200 p-2" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                  {(selected?.tiers || []).map((t: any) => <option key={t.tier} value={t.tier}>{t.tier.toLowerCase()} · ₹{t.price_inr}</option>)}
                </select></label>
              <button className="rounded-lg bg-teal-600 px-4 py-2 font-semibold text-white">Suggest plan</button>
            </form>
          )}
          <RequestState loading={!enrollments} error={enrErr} retry={reloadEnr} />
          {enrollments && (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-slate-700">
                  <tr><th className="px-4 py-3">Patient</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Period ends</th><th className="px-4 py-3">Used / included</th><th className="px-4 py-3">Next step</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {enrollments.map((e) => (
                    <tr key={e.id}>
                      <td className="px-4 py-3">#{e.patient_id}</td>
                      <td className="px-4 py-3 font-semibold text-slate-800">{e.plan_name} <span className="text-xs font-normal text-slate-500">{e.tier.toLowerCase()} · ₹{e.price_inr}</span></td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[e.status] || "bg-slate-100"}`}>{e.status.replace(/_/g, " ").toLowerCase()}</span></td>
                      <td className="px-4 py-3">{e.period_end || "–"}</td>
                      <td className="px-4 py-3 text-xs">
                        {(e.entitlements || []).map((x: any) => (
                          <div key={x.code} className={x.overuse ? "font-semibold text-red-700" : ""}>{x.code.replace(/_/g, " ").toLowerCase()}: {x.used}/{x.included}</div>
                        ))}
                      </td>
                      <td className="space-x-2 px-4 py-3 text-xs">
                        {["SUGGESTED", "NOT_ELIGIBLE"].includes(e.status) && role === "DOCTOR" && (<>
                          <button className="font-semibold text-sky-700 underline" onClick={() => run(() => api(`/care-plans/enrollments/${e.id}/assess`, { method: "POST", body: { eligible: true } }))}>Assessed: suitable</button>
                          {e.status === "SUGGESTED" && <button className="text-red-700 underline" onClick={() => run(() => api(`/care-plans/enrollments/${e.id}/assess`, { method: "POST", body: { eligible: false } }))}>Not suitable</button>}
                        </>)}
                        {e.status === "SUGGESTED" && role !== "DOCTOR" && <span className="text-slate-500">Waiting for doctor assessment</span>}
                        {["DOCTOR_ASSESSED", "ACTIVE", "RENEWAL_DUE", "ENDED"].includes(e.status) && (
                          <button className="font-semibold text-teal-700 underline"
                            onClick={() => run(() => api(`/care-plans/enrollments/${e.id}/pay`, { method: "POST", body: { method: "COUNTER_CASH" } }), "Payment recorded.")}>
                            {e.status === "DOCTOR_ASSESSED" ? `Record payment ₹${e.price_inr}` : "Record renewal payment"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {enrollments.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No plan enrolments yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
