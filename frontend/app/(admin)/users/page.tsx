"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

export default function Users() {
  const { data, error, reload } = useApi<any[]>("/users");
  const [f, setF] = useState({ name: "", email: "", password: "", role: "CALLER" });
  const [msg, setMsg] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/users", { method: "POST", body: f });
      setF({ ...f, name: "", email: "", password: "" });
      setMsg(""); reload();
    } catch (err: any) { setMsg(err.message); }
  }
  async function toggle(u: any) {
    try { await api(`/users/${u.id}`, { method: "PATCH", body: { active: !u.active } }); reload(); }
    catch (err: any) { setMsg(err.message); }
  }

  if (error) return <p role="alert">{error}</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Users</h1>
      <form onSubmit={add} className="grid gap-2 rounded bg-white p-4 shadow md:grid-cols-5">
        <input className="rounded border p-2" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <input className="rounded border p-2" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        <input className="rounded border p-2" type="password" placeholder="Password (10+ chars)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        <select aria-label="Role" className="rounded border p-2" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option>ADMIN</option><option>CALLER</option><option>DOCTOR</option>
        </select>
        <button className="rounded bg-slate-900 p-2 text-white">Add user</button>
      </form>
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <table className="w-full bg-white text-left text-sm shadow">
        <thead><tr><th className="p-2">Name</th><th>Email</th><th>Role</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{data?.map((u) => (
          <tr key={u.id} className="border-t"><td className="p-2">{u.name}</td><td>{u.email}</td><td>{u.role}</td>
            <td>{u.active ? "Active" : "Disabled"}</td>
            <td><button className="underline" onClick={() => toggle(u)}>{u.active ? "Disable" : "Enable"}</button></td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
