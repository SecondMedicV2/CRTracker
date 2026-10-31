"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "no date");

function Side({ title, p }: { title: string; p: any }) {
  return (
    <div className="flex-1 space-y-1 rounded border p-3">
      <div className="font-medium">{title}</div>
      <div>{p.name}</div>
      <div>Age {p.age} · {p.gender || "?"}</div>
      <div className="font-mono">{p.mobile || "no mobile"}</div>
      <ul className="text-slate-600">{p.orders.map((o: any) => <li key={o.order_id}>{o.order_id} · {fmt(o.report_date)}</li>)}</ul>
    </div>
  );
}

export default function Identity() {
  const { data, error, reload } = useApi<any[]>("/identity-reviews");
  const [msg, setMsg] = useState("");
  const decide = (id: number, decision: string) =>
    api(`/identity-reviews/${id}/decide`, { method: "POST", body: { decision } }).then(() => { setMsg(""); reload(); }).catch((e) => setMsg(e.message));

  if (error) return <p role="alert">{error}</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Is this the same person?</h1>
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      {data?.length === 0 && <p className="text-sm text-slate-600">Nothing waiting for a decision.</p>}
      {data?.map((r) => (
        <section key={r.id} className="space-y-3 rounded bg-white p-4 text-sm shadow">
          <div className="text-amber-700">{r.reason}</div>
          <div className="flex flex-col gap-3 md:flex-row">
            <Side title="Already in the system" p={r.existing} />
            <Side title="New report" p={r.new} />
          </div>
          <div className="flex gap-2">
            <button className="rounded bg-slate-900 px-3 py-1 text-white" onClick={() => decide(r.id, "SAME")}>Same person: merge</button>
            <button className="rounded border px-3 py-1" onClick={() => decide(r.id, "DIFFERENT")}>Different person: keep separate</button>
          </div>
        </section>
      ))}
    </div>
  );
}
