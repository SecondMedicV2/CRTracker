"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const STATUS_BADGE: Record<string, string> = {
  SUGGESTED: "bg-amber-100 text-amber-900",
  ACCEPTED: "bg-emerald-100 text-emerald-900",
  ENROLLED: "bg-teal-100 text-teal-950",
  DECLINED: "bg-slate-200 text-slate-700",
  DISCUSS_LATER: "bg-sky-100 text-sky-900",
  EXPIRED: "bg-slate-100 text-slate-500",
};

export default function FollowupCombinationsTable({
  fid,
  onChanged,
}: {
  fid: string;
  onChanged?: () => void;
}) {
  const { data, error, reload } = useApi<any>(`/followups/${fid}/recommendations`);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  async function decide(recId: number, decision: "ACCEPTED" | "ENROLLED" | "DECLINED") {
    setMsg("");
    setBusyId(recId);
    try {
      await api(`/program-recommendations/${recId}/decision`, {
        method: "POST",
        body: { decision, reason_code: decision === "DECLINED" ? "CLINICALLY_NOT_INDICATED" : "" },
      });
      reload();
      onChanged?.();
    } catch (err: any) {
      setMsg(err.message || "Could not update recommendation");
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>;
  if (!data) return <p role="status" className="text-sm text-slate-500">Loading recommendation combinations…</p>;

  const rows: any[] = data.combinations || [];

  const renderSlot = (slot: any) => {
    if (!slot) return <span className="text-xs text-slate-400">—</span>;
    const locked = busyId === slot.recommendation_id;
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-slate-900">{slot.label}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[slot.status] || "bg-slate-100"}`}>
            {slot.status}
          </span>
        </div>
        {slot.condition === "IF_APPROPRIATE" && (
          <div className="text-[11px] text-amber-800">Clinician eligibility review</div>
        )}
        {slot.recommendation_id && (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <button
              type="button"
              disabled={locked}
              onClick={() => decide(slot.recommendation_id, "ACCEPTED")}
              className="rounded bg-teal-800 px-2 py-0.5 font-medium text-white disabled:opacity-40"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => decide(slot.recommendation_id, "ENROLLED")}
              className="rounded border border-teal-800 px-2 py-0.5 font-medium text-teal-900 disabled:opacity-40"
            >
              Enroll
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => decide(slot.recommendation_id, "DECLINED")}
              className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 disabled:opacity-40"
            >
              Decline
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Ranked recommendation combinations</h2>
        <span className="text-xs text-slate-500">Ordered by severity: Primary → Secondary → Third</span>
      </div>
      {msg && <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">{msg}</p>}
      {!rows.length ? (
        <p className="text-xs text-slate-500">No combination findings detected for this report.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-700">
                <th className="p-2.5 font-semibold">Finding</th>
                <th className="p-2.5 font-semibold">Primary</th>
                <th className="p-2.5 font-semibold">Secondary</th>
                <th className="p-2.5 font-semibold">Third</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.finding_code} className="border-t align-top">
                  <td className="p-2.5 font-semibold text-slate-900">
                    <span className="mr-1.5" aria-hidden="true">{r.icon}</span>
                    {r.finding_label}
                  </td>
                  <td className="p-2.5">{renderSlot(r.primary)}</td>
                  <td className="p-2.5">{renderSlot(r.secondary)}</td>
                  <td className="p-2.5">{renderSlot(r.third)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
