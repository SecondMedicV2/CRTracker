"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

export default function Doctors() {
  const { data, error, reload } = useApi<any[]>("/doctors");
  const [f, setF] = useState({ name: "", speciality: "", languages: "en,hi", phone: "", in_pilot: false });
  const [msg, setMsg] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/doctors", { method: "POST", body: { ...f, languages: f.languages.split(",").map((s) => s.trim()).filter(Boolean) } });
      setF({ ...f, name: "", speciality: "" }); setMsg(""); reload();
    } catch (err: any) { setMsg(err.message); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Doctors</h1>
      <form onSubmit={add} className="grid gap-2 rounded bg-white p-4 shadow md:grid-cols-6">
        <input className="rounded border p-2" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <input className="rounded border p-2" placeholder="Speciality" value={f.speciality} onChange={(e) => setF({ ...f, speciality: e.target.value })} />
        <input className="rounded border p-2" placeholder="Languages (comma separated)" value={f.languages} onChange={(e) => setF({ ...f, languages: e.target.value })} />
        <input className="rounded border p-2" placeholder="Phone to dial" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.in_pilot} onChange={(e) => setF({ ...f, in_pilot: e.target.checked })} /> In pilot</label>
        <button className="rounded bg-slate-900 p-2 text-white">Add doctor</button>
      </form>
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <RequestState loading={!data} error={error} retry={reload} empty={data?.length === 0 ? ("No doctors added yet.") : undefined} />
      {!error && !!data?.length && (
        <TableFrame label="Doctors">
          <table className="w-full bg-white text-left text-sm shadow">
            <thead><tr><th className="p-2">Name</th><th>Speciality</th><th>Languages</th><th>Phone</th><th>Pilot</th><th>Order</th></tr></thead>
            <tbody>{data?.map((d) => (
              <tr key={d.id} className="border-t"><td className="p-2">{d.name}</td><td>{d.speciality}</td><td>{d.languages.join(", ")}</td><td>{d.phone}</td><td>{d.in_pilot ? "Yes" : ""}</td><td>{d.priority_order}</td></tr>
            ))}</tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
