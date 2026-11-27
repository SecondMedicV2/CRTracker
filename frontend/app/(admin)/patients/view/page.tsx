"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/lib/api";
import CareLoopCard from "@/components/CareLoopCard";
import ComparisonPanel from "@/components/ComparisonPanel";
import ConditionsMonitoringCard from "@/components/ConditionsMonitoringCard";
import ExtendedCareTabs from "@/components/ExtendedCareTabs";
import HealthProfileCard from "@/components/HealthProfileCard";
import JourneyTimeline from "@/components/JourneyTimeline";
import ProgramsPanel from "@/components/ProgramsPanel";
import TierBadge from "@/components/TierBadge";
import Trends from "@/components/Trends";
import { useApi } from "@/lib/useApi";
import { RoleContext } from "@/lib/navigation";
import { useContext, useState } from "react";

function PatientInner({ id }: { id: string }) {
  const { data: p, error, reload } = useApi<any>(`/patients/${id}`);
  const role = useContext(RoleContext);
  const [calling, setCalling] = useState(false);
  const [callMessage, setCallMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  if (error || !p) return <RequestState loading={!p} error={error} retry={reload} />;
  const patch = (body: object) => api(`/patients/${id}`, { method: "PATCH", body }).then(reload);
  async function callPatient() {
    if (!window.confirm(`Start a real call to ${p.name} at ${p.mobile}?`)) return;
    setCalling(true);
    setCallMessage("");
    try {
      await api(`/patients/${id}/call`, { method: "POST" });
      setCallMessage("MyOperator accepted the call request.");
    } catch (e: any) {
      setCallMessage(e.message);
    } finally {
      setCalling(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{p.name}</h1>
        <TierBadge label={p.protocol_tier_label} colour={p.protocol_tier_colour} />
      </div>
      <div className="text-sm">{p.age} · {p.gender} · <span className="font-mono">{p.mobile}</span></div>
      {role === "ADMIN" && (
        <div className="space-y-2">
          <button type="button" className="rounded-lg bg-teal-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={calling || p.do_not_call || !p.mobile} onClick={callPatient}>
            {calling ? "Starting call…" : "Call patient"}
          </button>
          {p.do_not_call && <p className="text-sm text-red-700">Calling is disabled because this patient asked not to be called.</p>}
          {callMessage && <p role="status" className="text-sm">{callMessage}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label>Language{" "}
          <select className="rounded border p-1" value={p.language} onChange={(e) => patch({ language: e.target.value })}>
            <option value="">Default</option><option value="en">English</option><option value="hi">Hindi</option><option value="hinglish">Hinglish</option>
          </select>
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={p.do_not_call} onChange={(e) => patch({ do_not_call: e.target.checked })} /> Do not call</label>
      </div>
      {p.household.length > 0 && (
        <div className="text-sm">Same household (shared mobile): {p.household.map((h: any) => (
          <Link key={h.id} className="mr-2 underline" href={`/patients/view?id=${h.id}`}>{h.name}</Link>
        ))}</div>
      )}
      <TableFrame label="Patient reports">
        <table className="w-full bg-white text-left text-sm shadow">
          <thead><tr><th className="p-2">Order</th><th>Collected</th><th>Status</th><th>Result</th><th>Urgency tier</th></tr></thead>
          <tbody>{p.reports.map((r: any) => (
            <tr key={r.order_id} className="border-t">
              <td className="p-2 font-mono">{r.report_id ? <Link className="underline" href={`/reports/view?id=${r.report_id}`}>{r.order_id}</Link> : r.order_id}</td>
              <td>{r.collected_on ? new Date(r.collected_on).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}</td>
              <td>{r.status}</td><td className={r.classification === "ABNORMAL" ? "text-red-700" : ""}>{r.classification}</td>
              <td><TierBadge label={r.protocol_tier_label} colour={r.protocol_tier_colour} /></td>
            </tr>
          ))}</tbody>
        </table>
      </TableFrame>
      <ComparisonPanel endpoint={`/patients/${id}/compare`} refreshKey={refreshKey} onUpdated={() => setRefreshKey((n) => n + 1)} />
      <JourneyTimeline patientId={id} role={role} refreshKey={refreshKey} onChanged={() => setRefreshKey((n) => n + 1)} />
      <Trends patientId={id} />
      <CareLoopCard patientId={id} role={role} refreshKey={refreshKey} />
      <ConditionsMonitoringCard patientId={id} role={role} refreshKey={refreshKey} onChanged={() => setRefreshKey((n) => n + 1)} />
      <HealthProfileCard patientId={id} onSaved={() => setRefreshKey((n) => n + 1)} />
      <ExtendedCareTabs patientId={id} role={role} onChanged={() => setRefreshKey((n) => n + 1)} />
      <ProgramsPanel patientId={id} mode="patient" refreshKey={refreshKey} onChanged={() => setRefreshKey((n) => n + 1)} />
    </div>
  );
}


function Detail() {
  const id = useSearchParams().get("id");
  return (
    <div className="space-y-4">
      <Link className="inline-block text-sm font-medium text-teal-800 underline" href="/patients">Back to Patients</Link>
      {id && /^\d+$/.test(id) ? <PatientInner key={id} id={id} /> : <p role="alert">Open a record from Patients.</p>}
    </div>
  );
}

export default function Patient() {
  return <Suspense fallback={<p role="status">Loading…</p>}><Detail /></Suspense>;
}
