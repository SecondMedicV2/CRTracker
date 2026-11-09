"use client";
import { useState } from "react";
import { RequestState } from "@/components/RequestState";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

export default function Settings() {
  const { data, error, reload } = useApi<Record<string, any>>("/settings");
  const [msg, setMsg] = useState("");

  async function set(key: string, raw: string | boolean, current: any) {
    const value = typeof current === "number" ? Number(raw) : raw;
    try { await api(`/settings/${key}`, { method: "PUT", body: { value } }); setMsg(""); reload(); }
    catch (e: any) { setMsg(e.message); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <p className="text-sm text-slate-600">Changes save when you toggle a setting or leave an edited field.</p>
      <RequestState loading={!data} error={error} retry={reload} />
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <div className="divide-y rounded bg-white shadow">
        {data && Object.entries(data).map(([k, v]) => (
          <label key={k} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span className="font-mono">{k}</span>
            {typeof v === "boolean"
              ? <input type="checkbox" checked={v} onChange={(e) => set(k, e.target.checked, v)} />
              : <input className="rounded border p-1" defaultValue={v} onBlur={(e) => e.target.value !== String(v) && set(k, e.target.value, v)} />}
          </label>
        ))}
      </div>
    </div>
  );
}
