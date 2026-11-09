"use client";
import { useState } from "react";
import { api } from "@/lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await api("/auth/login", { method: "POST", body: { email, password } });
      window.location.href = "/";
    } catch (err: any) {
      setError(err.message);
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-900 px-4 py-8">
      <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-2xl bg-white p-6 shadow-xl sm:p-8">
        <header>
          <span aria-hidden="true" className="mb-4 grid size-10 place-items-center rounded-lg bg-teal-200 text-sm font-bold text-teal-950">CR</span>
          <h1 className="text-2xl font-semibold">Sign in to CRTracker</h1>
          <p className="mt-1 text-sm text-slate-600">Access your report and follow-up workspace.</p>
        </header>
        <label className="block text-sm font-medium">Email
          <input className="mt-1 w-full rounded-lg border border-slate-400 p-2.5" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm font-medium">Password
          <input className="mt-1 w-full rounded-lg border border-slate-400 p-2.5" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <button type="submit" disabled={pending} className="w-full rounded-lg bg-teal-800 p-2.5 font-semibold text-white hover:bg-teal-900">{pending ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
