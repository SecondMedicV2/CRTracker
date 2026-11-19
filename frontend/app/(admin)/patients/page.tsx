"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

export default function Patients() {
  const [q, setQ] = useState("");
  const { data, error, reload } = useApi<any[]>(`/patients?q=${encodeURIComponent(q)}`);
  const [callingId, setCallingId] = useState<number | null>(null);
  const [callMsg, setCallMsg] = useState("");

  async function handleCall(patient: any) {
    if (patient.do_not_call) {
      alert("This patient has requested not to be called.");
      return;
    }
    const mobile = patient.mobile || "9876543210";
    if (!window.confirm(`Initiate outbound call to ${patient.name} (${mobile}) via SecondMedic MyOperator dialer?`)) return;

    setCallingId(patient.id);
    setCallMsg("");
    try {
      const res = await api<any>(`/patients/${patient.id}/call`, { method: "POST" });
      setCallMsg(res.message || `Outgoing call initiated to ${patient.name} (${mobile}) via MyOperator.`);
    } catch (e: any) {
      setCallMsg(e.message || "Failed to initiate call via MyOperator.");
    } finally {
      setCallingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Patients</h1>
          <p className="text-xs text-slate-500">Patient profiles, contact information, and calling access.</p>
        </div>
        <label className="block max-w-sm text-sm font-medium">
          <input
            placeholder="Search by name or mobile…"
            className="block w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-teal-600 focus:outline-none"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      {callMsg && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs text-teal-950">
          <div className="flex items-center gap-2 font-medium">
            <span>📞</span>
            <span>{callMsg}</span>
          </div>
          <button onClick={() => setCallMsg("")} className="font-bold text-teal-800 hover:underline">Dismiss</button>
        </div>
      )}

      <RequestState loading={!data} error={error} retry={reload} empty={data?.length === 0 ? (q.trim() ? "No patients match your search." : "No patients yet.") : undefined} />
      {!error && !!data?.length && (
        <TableFrame label="Patients">
          <table className="w-full bg-white text-left text-sm shadow rounded-xl overflow-hidden">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="p-3">Name</th>
                <th>Age</th>
                <th>Gender</th>
                <th>Mobile</th>
                <th>Household</th>
                <th>Status</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((p) => (
                <tr key={p.id} className="border-t hover:bg-slate-50/60 transition">
                  <td className="p-3 font-semibold text-slate-900">
                    <Link className="underline hover:text-teal-700" href={`/patients/view?id=${p.id}`}>{p.name}</Link>
                  </td>
                  <td>{p.age ?? "—"}</td>
                  <td>{p.gender || "—"}</td>
                  <td className="font-mono text-slate-700">{p.mobile}</td>
                  <td>{p.household_tag || "—"}</td>
                  <td>
                    {p.do_not_call ? (
                      <span className="rounded bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 border border-rose-200">Do not call</span>
                    ) : (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">Callable</span>
                    )}
                  </td>
                  <td className="text-right p-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={callingId === p.id || p.do_not_call || !p.mobile}
                        onClick={() => handleCall(p)}
                        className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-2.5 py-1 text-xs font-bold text-white shadow-xs hover:bg-teal-800 transition disabled:opacity-40"
                        title={p.do_not_call ? "Patient requested no calls" : "Place call via MyOperator"}
                      >
                        <span>📞</span>
                        <span>{callingId === p.id ? "Calling…" : "Call"}</span>
                      </button>
                      <Link
                        href={`/patients/view?id=${p.id}`}
                        className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-200 transition"
                      >
                        Profile
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
