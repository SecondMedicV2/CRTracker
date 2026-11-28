"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const STYLE: Record<string, string> = {
  RED: "border-red-200 bg-red-50 text-red-900",
  AMBER: "border-amber-200 bg-amber-50 text-amber-900",
  GREEN: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

/** RED / AMBER / GREEN safety triage. A RED result blocks every plan sale until a doctor clears it. */
export default function TriageBadge({ followupId, role }: { followupId: string; role?: string | null }) {
  const { data, reload } = useApi<any>(`/followups/${followupId}/triage`);
  const [msg, setMsg] = useState("");
  if (!data) return null;

  const clear = async () => {
    setMsg("");
    try {
      await api(`/followups/${followupId}/clear`, { method: "POST" });
      reload();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  return (
    <section className={`rounded-2xl border p-4 text-sm ${STYLE[data.colour] || STYLE.GREEN}`} aria-label="Safety triage">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-bold">{data.colour}</span>
          <span className="ml-2">{data.rule}</span>
        </div>
        {data.plan_sale_blocked && role === "DOCTOR" && (
          <button onClick={clear} className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800">
            I have reviewed this result: allow plans
          </button>
        )}
      </div>
      {data.plan_sale_blocked && <p className="mt-2 text-xs font-semibold">Plan sales are blocked until a doctor clears this result.</p>}
      {data.colour === "RED" && data.cleared && <p className="mt-2 text-xs">Cleared by a doctor.</p>}
      {msg && <p role="alert" className="mt-2 text-xs text-red-700">{msg}</p>}
    </section>
  );
}
