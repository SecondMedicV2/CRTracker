"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

// The MyOperator User ID decides whose MyOperator phone/app rings first when this person places a call.
function OperatorIdCell({ u, onSaved, onError }: { u: any; onSaved: () => void; onError: (m: string) => void }) {
  const saved = u.myoperator_user_id || "";
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const changed = value.trim() !== saved;

  async function save() {
    setBusy(true);
    try {
      await api(`/users/${u.id}`, { method: "PATCH", body: { myoperator_user_id: value.trim() } });
      onError(""); onSaved();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-2">
      <input aria-label={`MyOperator User ID for ${u.name}`} className="w-44 rounded border p-1 font-mono text-xs" placeholder="Not set"
        value={value} maxLength={64} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && changed && !busy) save(); }} />
      {changed && <button className="underline disabled:opacity-50" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>}
    </div>
  );
}

export default function Users() {
  const { data, error, reload } = useApi<any[]>("/users");
  const [f, setF] = useState({ name: "", email: "", password: "", role: "CALLER", myoperator_user_id: "" });
  const [msg, setMsg] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/users", { method: "POST", body: { ...f, myoperator_user_id: f.myoperator_user_id.trim() } });
      setF({ ...f, name: "", email: "", password: "", myoperator_user_id: "" });
      setMsg(""); reload();
    } catch (err: any) { setMsg(err.message); }
  }
  async function toggle(u: any) {
    try { await api(`/users/${u.id}`, { method: "PATCH", body: { active: !u.active } }); reload(); }
    catch (err: any) { setMsg(err.message); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Users</h1>
      <form onSubmit={add} className="grid gap-2 rounded bg-white p-4 shadow md:grid-cols-6">
        <input className="rounded border p-2" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <input className="rounded border p-2" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        <input className="rounded border p-2" type="password" placeholder="Password (10+ chars)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        <select aria-label="Role" className="rounded border p-2" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option>ADMIN</option><option>CALLER</option><option>DOCTOR</option>
        </select>
        <input aria-label="MyOperator User ID" className="rounded border p-2" placeholder="MyOperator User ID (optional)" maxLength={64}
          value={f.myoperator_user_id} onChange={(e) => setF({ ...f, myoperator_user_id: e.target.value })} />
        <button className="rounded bg-slate-900 p-2 text-white">Add user</button>
      </form>
      <p className="text-xs text-slate-600">
        MyOperator User ID: copy it from the person&apos;s profile under Manage → Users in the MyOperator panel. Their MyOperator phone rings first when they place a call, then the patient is dialled.
      </p>
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <RequestState loading={!data} error={error} retry={reload} empty={data?.length === 0 ? ("No users found.") : undefined} />
      {!error && !!data?.length && (
        <TableFrame label="Users">
          <table className="w-full bg-white text-left text-sm shadow">
            <thead><tr><th className="p-2">Name</th><th>Email</th><th>Role</th><th>MyOperator User ID</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{data?.map((u) => (
              <tr key={u.id} className="border-t"><td className="p-2">{u.name}</td><td>{u.email}</td><td>{u.role}</td>
                <td className="py-1"><OperatorIdCell key={u.myoperator_user_id || ""} u={u} onSaved={reload} onError={setMsg} /></td>
                <td>{u.active ? "Active" : "Disabled"}</td>
                <td><button className="underline" onClick={() => toggle(u)}>{u.active ? "Disable" : "Enable"}</button></td></tr>
            ))}</tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
