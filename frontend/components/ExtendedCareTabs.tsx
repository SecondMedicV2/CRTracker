"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const TABS = [
  ["medicines", "Medicines"],
  ["refills", "Refills"],
  ["referrals", "Referrals"],
  ["home", "Home readings"],
  ["family", "Family"],
] as const;

const HOME_KIND_LIST = ["BP", "GLUCOSE_FASTING", "GLUCOSE_RANDOM", "WEIGHT", "SPO2"] as const;

function Sparkline({ rows, kind }: { rows: any[]; kind: string }) {
  const pts = rows
    .filter((r) => r.kind === kind)
    .slice(0, 12)
    .reverse()
    .map((r) => (kind === "BP" ? Number(r.values?.systolic || 0) : Number(r.values?.value || 0)))
    .filter((v) => v > 0);
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const poly = pts
    .map((v, i) => `${Math.round((i / (pts.length - 1)) * 116 + 2)},${Math.round(28 - ((v - min) / span) * 24)}`)
    .join(" ");
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px]">
      <div className="flex items-center justify-between text-slate-600">
        <span>{kind}</span>
        <span className="font-mono">{pts[pts.length - 1]}</span>
      </div>
      <svg width="120" height="32" viewBox="0 0 120 32" aria-label={`${kind} trend`}>
        <polyline fill="none" stroke="#0f766e" strokeWidth="2" points={poly} />
      </svg>
    </div>
  );
}

export default function ExtendedCareTabs({
  patientId,
  role,
  onChanged,
}: {
  patientId: string;
  role: string | null;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("medicines");
  const [msg, setMsg] = useState("");
  const meds = useApi<any[]>(`/patients/${patientId}/medicines`);
  const refs = useApi<any[]>(`/patients/${patientId}/referrals`);
  const readings = useApi<any[]>(`/patients/${patientId}/home-readings`);
  const visits = useApi<any[]>(`/patients/${patientId}/home-visits`);
  const family = useApi<any>(`/patients/${patientId}/family`);
  const medRule = useApi<any>("/rules/medicine_catalogue");
  const specRule = useApi<any>("/rules/referral_specialties");

  const [medForm, setMedForm] = useState({ medicine_code: "METFORMIN", dose_text: "", prescribed_by: "", source: "DOCTOR", delivery_mode: "HOME_DELIVERY", refill_every_days: "30" });
  const [refillForm, setRefillForm] = useState<Record<number, { delivery_ref: string; amount_inr: string }>>({});
  const [refForm, setRefForm] = useState({ specialty: "Cardiology", urgency: "ROUTINE", scheduled_for: "", reason_code: "" });
  const [homeForm, setHomeForm] = useState({ kind: "BP", systolic: "", diastolic: "", value: "" });
  const [visitForm, setVisitForm] = useState({ purpose_code: "VITALS_CHECK", scheduled_on: "", staff_name: "" });
  const [famForm, setFamForm] = useState({ related_patient_id: "", relationship: "spouse" });

  if (role !== "DOCTOR" && role !== "ADMIN") return null;

  const medCat: any[] = medRule.data?.data || medRule.data || [];
  const specialties: string[] = Object.keys(specRule.data?.data || specRule.data || { Cardiology: "" });

  function notifyChange(reloadFn: () => void) {
    reloadFn();
    onChanged?.();
  }

  async function addMed(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await api(`/patients/${patientId}/medicines`, {
        method: "POST",
        body: {
          medicine_code: medForm.medicine_code,
          dose_text: medForm.dose_text,
          prescribed_by: medForm.prescribed_by,
          source: medForm.source,
          delivery_mode: medForm.delivery_mode,
          refill_every_days: medForm.refill_every_days ? Number(medForm.refill_every_days) : undefined,
        },
      });
      setMedForm({ ...medForm, dose_text: "", prescribed_by: "" });
      notifyChange(meds.reload);
    } catch (err: any) {
      setMsg(err.message || "Could not save medicine");
    }
  }

  async function updateMed(mid: number, body: object) {
    setMsg("");
    try {
      await api(`/medicines/${mid}`, { method: "PATCH", body });
      notifyChange(meds.reload);
    } catch (err: any) {
      setMsg(err.message || "Could not update medicine");
    }
  }

  async function confirmRefill(sid: number) {
    setMsg("");
    const f = refillForm[sid] || { delivery_ref: "", amount_inr: "" };
    try {
      await api(`/refill-schedules/${sid}/confirm`, {
        method: "POST",
        body: {
          delivery_ref: f.delivery_ref,
          amount_inr: role === "ADMIN" && f.amount_inr ? Number(f.amount_inr) : undefined,
        },
      });
      notifyChange(meds.reload);
    } catch (err: any) {
      setMsg(err.message || "Could not confirm refill");
    }
  }

  async function addReferral(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await api(`/patients/${patientId}/referrals`, {
        method: "POST",
        body: {
          specialty: refForm.specialty,
          urgency: refForm.urgency,
          reason_code: refForm.reason_code,
          scheduled_for: refForm.scheduled_for || null,
        },
      });
      setRefForm({ ...refForm, reason_code: "", scheduled_for: "" });
      notifyChange(refs.reload);
    } catch (err: any) {
      setMsg(err.message || "Could not create referral");
    }
  }

  async function patchReferral(rid: number, status: string) {
    setMsg("");
    try {
      await api(`/referrals/${rid}`, { method: "PATCH", body: { status } });
      notifyChange(refs.reload);
    } catch (err: any) {
      setMsg(err.message || "Could not update referral");
    }
  }

  async function addReading(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const values = homeForm.kind === "BP"
      ? { systolic: Number(homeForm.systolic), diastolic: Number(homeForm.diastolic) }
      : { value: Number(homeForm.value) };
    try {
      await api(`/patients/${patientId}/home-readings`, { method: "POST", body: { kind: homeForm.kind, values } });
      setHomeForm({ ...homeForm, systolic: "", diastolic: "", value: "" });
      notifyChange(readings.reload);
    } catch (err: any) {
      setMsg(err.message || "Could not save reading");
    }
  }

  async function importCsv(file: File | null) {
    if (!file) return;
    setMsg("");
    if (file.size > 5 * 1024 * 1024) {
      setMsg("CSV file must be 5 MB or smaller.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/v1/patients/${patientId}/home-readings/import`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.detail || "CSV import failed");
      return;
    }
    setMsg(`Imported ${data.imported} readings${data.alerts ? ` (${data.alerts} alerts)` : ""}.`);
    notifyChange(readings.reload);
  }

  async function addVisit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await api(`/patients/${patientId}/home-visits`, { method: "POST", body: visitForm });
      setVisitForm({ ...visitForm, scheduled_on: "", staff_name: "" });
      notifyChange(visits.reload);
    } catch (err: any) {
      setMsg(err.message || "Could not schedule home visit");
    }
  }

  async function patchVisit(vid: number, status: string) {
    await api(`/home-visits/${vid}`, { method: "PATCH", body: { status } });
    visits.reload();
  }

  async function addFamilyLink(relatedId: number, relationship: string) {
    setMsg("");
    try {
      await api(`/patients/${patientId}/family-links`, {
        method: "POST",
        body: { related_patient_id: relatedId, relationship },
      });
      setFamForm({ ...famForm, related_patient_id: "" });
      family.reload();
    } catch (err: any) {
      setMsg(err.message || "Could not link family member");
    }
  }

  async function recordFamilyConsent(lid: number) {
    setMsg("");
    try {
      await api(`/family-links/${lid}/consent`, { method: "POST", body: {} });
      notifyChange(family.reload);
    } catch (err: any) {
      setMsg(err.message || "Could not record family consent");
    }
  }

  const refillRows = (meds.data || []).filter((m) => m.refill);

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Longitudinal Care &amp; Home Monitoring</h2>
        <div role="tablist" aria-label="Extended care tabs" className="flex flex-wrap gap-1.5 text-xs">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded-lg border px-2.5 py-1.5 font-medium ${tab === k ? "border-teal-800 bg-teal-800 text-white" : "border-slate-300 bg-slate-50 text-slate-700"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {msg && <p role="status" className="rounded border border-teal-200 bg-teal-50 p-2 text-xs text-teal-900">{msg}</p>}

      {tab === "medicines" && (
        <div className="space-y-3 text-sm">
          <form onSubmit={addMed} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select aria-label="Medicine" className="rounded border p-1.5" value={medForm.medicine_code} onChange={(e) => setMedForm({ ...medForm, medicine_code: e.target.value })}>
              {medCat.map((m) => <option key={m.code} value={m.code}>{m.generic_name} ({m.drug_class})</option>)}
            </select>
            <input className="rounded border p-1.5" placeholder="Dose (e.g. 500 mg OD)" value={medForm.dose_text} onChange={(e) => setMedForm({ ...medForm, dose_text: e.target.value })} />
            <input className="rounded border p-1.5" placeholder="Prescribed by" value={medForm.prescribed_by} onChange={(e) => setMedForm({ ...medForm, prescribed_by: e.target.value })} />
            <select aria-label="Source" className="rounded border p-1.5" value={medForm.source} onChange={(e) => setMedForm({ ...medForm, source: e.target.value })}>
              <option value="DOCTOR">Doctor prescribed</option>
              <option value="PATIENT_REPORTED">Patient reported</option>
            </select>
            <select aria-label="Delivery mode" className="rounded border p-1.5" value={medForm.delivery_mode} onChange={(e) => setMedForm({ ...medForm, delivery_mode: e.target.value })}>
              <option value="HOME_DELIVERY">Home delivery</option>
              <option value="PICKUP_AT_HUB">Pickup at hub</option>
            </select>
            <div className="flex gap-2">
              <input className="w-24 rounded border p-1.5" type="number" min={1} placeholder="Days" value={medForm.refill_every_days} onChange={(e) => setMedForm({ ...medForm, refill_every_days: e.target.value })} />
              <button type="submit" className="rounded bg-teal-800 px-3 py-1.5 text-xs font-medium text-white">Add medicine</button>
            </div>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b text-slate-600"><th className="p-2">Medicine</th><th>Dose</th><th>Started</th><th>Source</th><th>Status</th><th /></tr></thead>
              <tbody>
                {(meds.data || []).map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="p-2 font-medium">{m.generic_name} <span className="text-slate-500">({m.drug_class})</span></td>
                    <td>{m.dose_text || "—"}</td>
                    <td>{m.started_on}</td>
                    <td>{m.source}</td>
                    <td>{m.stopped_on ? `Stopped ${m.stopped_on}` : "Active"}</td>
                    <td className="space-x-2 p-2">
                      {!m.stopped_on && (
                        <>
                          <button type="button" className="underline text-teal-800" onClick={() => {
                            const d = window.prompt("New dose text", m.dose_text || "");
                            if (d !== null) updateMed(m.id, { dose_text: d });
                          }}>Edit dose</button>
                          <button type="button" className="underline text-rose-700" onClick={() => updateMed(m.id, { stopped_on: new Date().toISOString().slice(0, 10) })}>Stop</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "refills" && (
        <div className="space-y-2 overflow-x-auto text-xs">
          {!refillRows.length ? <p className="text-slate-500">No chronic refill schedules active.</p> : (
            <table className="w-full text-left">
              <thead><tr className="border-b text-slate-600"><th className="p-2">Medicine</th><th>Next refill</th><th>Mode</th><th>Task</th><th>Confirm refill</th></tr></thead>
              <tbody>
                {refillRows.map((m) => {
                  const s = m.refill;
                  const f = refillForm[s.id] || { delivery_ref: s.delivery_ref || "", amount_inr: "" };
                  return (
                    <tr key={s.id} className="border-t">
                      <td className="p-2 font-medium">{m.generic_name}</td>
                      <td>{s.next_refill_on}</td>
                      <td>
                        <select aria-label={`Delivery for ${m.generic_name}`} className="rounded border p-1" value={s.delivery_mode} onChange={(e) => updateMed(m.id, { delivery_mode: e.target.value })}>
                          <option value="HOME_DELIVERY">Home delivery</option>
                          <option value="PICKUP_AT_HUB">Pickup at hub</option>
                        </select>
                      </td>
                      <td>{s.task_status}</td>
                      <td className="flex flex-wrap items-center gap-1.5 p-2">
                        <input className="w-28 rounded border p-1" placeholder="Delivery ref" value={f.delivery_ref} onChange={(e) => setRefillForm({ ...refillForm, [s.id]: { ...f, delivery_ref: e.target.value } })} />
                        {role === "ADMIN" && <input className="w-20 rounded border p-1" type="number" placeholder="INR" value={f.amount_inr} onChange={(e) => setRefillForm({ ...refillForm, [s.id]: { ...f, amount_inr: e.target.value } })} />}
                        <button type="button" className="rounded bg-teal-800 px-2 py-1 font-medium text-white" onClick={() => confirmRefill(s.id)}>Confirm</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "referrals" && (
        <div className="space-y-3 text-sm">
          <form onSubmit={addReferral} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <select aria-label="Specialty" className="rounded border p-1.5" value={refForm.specialty} onChange={(e) => setRefForm({ ...refForm, specialty: e.target.value })}>
              {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="Urgency" className="rounded border p-1.5" value={refForm.urgency} onChange={(e) => setRefForm({ ...refForm, urgency: e.target.value })}>
              <option value="ROUTINE">ROUTINE</option>
              <option value="SOON">SOON</option>
              <option value="URGENT">URGENT</option>
            </select>
            <input className="rounded border p-1.5" type="date" value={refForm.scheduled_for} onChange={(e) => setRefForm({ ...refForm, scheduled_for: e.target.value })} />
            <button type="submit" className="rounded bg-teal-800 px-3 py-1.5 text-xs font-medium text-white">Add referral</button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b text-slate-600"><th className="p-2">Specialty</th><th>Urgency</th><th>Status</th><th>Scheduled</th><th /></tr></thead>
              <tbody>
                {(refs.data || []).map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 font-medium">{r.specialty}</td>
                    <td>{r.urgency}</td>
                    <td>{r.status}</td>
                    <td>{r.scheduled_for || "—"}</td>
                    <td className="space-x-2 p-2">
                      <button type="button" className="underline text-teal-800" onClick={() => patchReferral(r.id, "BOOKED")}>Mark booked</button>
                      <button type="button" className="underline text-emerald-800" onClick={() => patchReferral(r.id, "DONE")}>Done</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "home" && (
        <div className="space-y-4 text-sm">
          <form onSubmit={addReading} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <select aria-label="Reading kind" className="rounded border p-1.5" value={homeForm.kind} onChange={(e) => setHomeForm({ ...homeForm, kind: e.target.value })}>
              {HOME_KIND_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            {homeForm.kind === "BP" ? (
              <>
                <input className="rounded border p-1.5" type="number" required placeholder="Systolic (mmHg)" value={homeForm.systolic} onChange={(e) => setHomeForm({ ...homeForm, systolic: e.target.value })} />
                <input className="rounded border p-1.5" type="number" required placeholder="Diastolic (mmHg)" value={homeForm.diastolic} onChange={(e) => setHomeForm({ ...homeForm, diastolic: e.target.value })} />
              </>
            ) : (
              <input className="rounded border p-1.5 sm:col-span-2" type="number" step="0.1" required placeholder="Reading value" value={homeForm.value} onChange={(e) => setHomeForm({ ...homeForm, value: e.target.value })} />
            )}
            <button type="submit" className="rounded bg-teal-800 px-3 py-1.5 text-xs font-medium text-white">Log reading</button>
          </form>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="cursor-pointer rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 font-medium">
              Import CSV (&le; 5 MB)
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => importCsv(e.target.files?.[0] || null)} />
            </label>
            <a className="text-teal-800 underline" href={`/api/v1/patients/${patientId}/home-readings.csv`}>Export home readings (CSV)</a>
          </div>

          <div className="flex flex-wrap gap-2">
            {HOME_KIND_LIST.map((k) => <Sparkline key={k} rows={readings.data || []} kind={k} />)}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b text-slate-600"><th className="p-2">When</th><th>Kind</th><th>Values</th><th>Source</th><th>Alert</th></tr></thead>
              <tbody>
                {(readings.data || []).slice(0, 20).map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{String(r.taken_at).slice(0, 16).replace("T", " ")}</td>
                    <td>{r.kind}</td>
                    <td className="font-mono">{r.kind === "BP" ? `${r.values?.systolic}/${r.values?.diastolic}` : r.values?.value}</td>
                    <td>{r.source}</td>
                    <td className={r.alert ? "font-semibold text-rose-700" : "text-slate-400"}>{r.alert || "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t pt-3">
            <h3 className="mb-2 text-sm font-semibold">Home Visits</h3>
            <form onSubmit={addVisit} className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input className="rounded border p-1.5" required placeholder="Purpose (e.g. SAMPLE_PICKUP)" value={visitForm.purpose_code} onChange={(e) => setVisitForm({ ...visitForm, purpose_code: e.target.value })} />
              <input className="rounded border p-1.5" type="date" required value={visitForm.scheduled_on} onChange={(e) => setVisitForm({ ...visitForm, scheduled_on: e.target.value })} />
              <input className="rounded border p-1.5" placeholder="Staff name" value={visitForm.staff_name} onChange={(e) => setVisitForm({ ...visitForm, staff_name: e.target.value })} />
              <button type="submit" className="rounded bg-teal-800 px-3 py-1.5 text-xs font-medium text-white">Schedule visit</button>
            </form>
            <div className="space-y-1 text-xs">
              {(visits.data || []).map((v) => (
                <div key={v.id} className="flex flex-wrap items-center justify-between rounded border px-2.5 py-1.5">
                  <span>{v.scheduled_on} · <b>{v.purpose_code}</b> ({v.staff_name || "Unassigned"}) — {v.status}</span>
                  {v.status === "SCHEDULED" && (
                    <span className="space-x-2">
                      <button type="button" className="underline text-emerald-800" onClick={() => patchVisit(v.id, "DONE")}>Done</button>
                      <button type="button" className="underline text-slate-600" onClick={() => patchVisit(v.id, "CANCELLED")}>Cancel</button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "family" && (
        <div className="space-y-3 text-xs">
          {family.data?.household?.length > 0 && (
            <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
              <div className="font-semibold text-slate-700">Same household tag ({family.data.household_tag}):</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {family.data.household.map((h: any) => (
                  <button key={h.id} type="button" className="rounded border border-teal-700 bg-white px-2 py-1 text-teal-800" onClick={() => addFamilyLink(h.id, famForm.relationship)}>
                    Link {h.name} (#{h.id})
                  </button>
                ))}
              </div>
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); if (famForm.related_patient_id) addFamilyLink(Number(famForm.related_patient_id), famForm.relationship); }} className="flex flex-wrap gap-2">
            <input className="w-36 rounded border p-1.5" type="number" placeholder="Patient ID" value={famForm.related_patient_id} onChange={(e) => setFamForm({ ...famForm, related_patient_id: e.target.value })} />
            <input className="w-36 rounded border p-1.5" placeholder="Relationship" value={famForm.relationship} onChange={(e) => setFamForm({ ...famForm, relationship: e.target.value })} />
            <button type="submit" className="rounded bg-teal-800 px-3 py-1.5 font-medium text-white">Link family member</button>
          </form>
          <div className="space-y-2">
            {(family.data?.links || []).map((l: any) => (
              <div key={l.id} className="rounded border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <Link href={`/patients/view?id=${l.related_patient_id}`} className="font-semibold underline">{l.name}</Link> ({l.relationship})
                  </span>
                  {l.has_consent ? (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-900">Consent recorded</span>
                  ) : (
                    <button type="button" className="rounded bg-teal-800 px-2.5 py-1 font-medium text-white" onClick={() => recordFamilyConsent(l.id)}>Record member consent</button>
                  )}
                </div>
                {l.has_consent && l.summary ? (
                  <p className="mt-1 text-slate-700">
                    Conditions: {(l.summary.confirmed_conditions || []).join(", ") || "None"} · Buckets: {(l.summary.active_buckets || []).join(", ") || "None"}
                    {l.summary.recommended_screening ? " · Family preventive screening suggested" : ""}
                  </p>
                ) : (
                  <p className="mt-1 text-slate-500">Clinical details hidden until this family member records consent.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
