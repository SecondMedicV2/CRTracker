"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Admin sees everything; other roles only the pages listed (the API enforces this too).
const NAV: [string, string, string[]][] = [
  ["/", "Home", ["CALLER", "DOCTOR"]], ["/dashboard", "Dashboard", []], ["/import", "Import orders", []], ["/orders", "Orders", []],
  ["/doctor-queue", "My queue", ["DOCTOR"]], ["/followups", "Follow-ups", ["CALLER", "DOCTOR"]], ["/reports", "Reports", ["DOCTOR"]], ["/patients", "Patients", ["DOCTOR"]], ["/identity", "Duplicate review", ["CALLER"]],
  ["/users", "Users", []], ["/doctors", "Doctors", []], ["/rules", "Rules", []], ["/settings", "Settings", []], ["/audit", "Audit log", []],
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<any>(null);
  const [notes, setNotes] = useState<any>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api("/auth/me").then(setMe).catch(() => { window.location.href = "/login"; });
  }, []);
  useEffect(() => {
    if (!me) return;
    const load = () => api("/notifications").then(setNotes).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [me]);
  if (!me) return <p role="status" className="p-8 text-sm text-slate-600">Loading…</p>;
  const isAdmin = me.role === "ADMIN";
  return (
    <div className="min-h-screen md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:bg-white focus:p-2 print:hidden">Skip to the content</a>
      <nav aria-label="Main" className="bg-slate-900 p-4 text-sm text-white md:w-56 print:hidden">
        <div className="mb-4 font-semibold">CRTracker</div>
        <ul className="flex flex-wrap gap-3 md:block md:space-y-2">
          {NAV.filter(([, , roles]) => isAdmin || roles.includes(me.role)).map(([href, label]) => (
            <li key={href}><Link href={href} className="hover:underline">{label}</Link></li>
          ))}
        </ul>
        <div className="relative mt-4">
          <button className="underline" aria-label={`Notifications, ${notes.unread} unread`} onClick={() => setOpen(!open)}>
            Notifications{notes.unread > 0 && <span className="ml-1 rounded-full bg-red-600 px-2 text-xs">{notes.unread}</span>}
          </button>
          {open && (
            <div className="absolute z-10 mt-1 w-72 rounded bg-white p-2 text-slate-900 shadow">
              {notes.items.length === 0 && <div>No notifications</div>}
              <ul className="max-h-72 space-y-1 overflow-auto">{notes.items.map((n: any) => (
                <li key={n.id} className={n.read ? "text-slate-500" : n.urgent ? "font-medium text-red-700" : "font-medium"}>
                  <Link href={n.link || "/"} onClick={() => setOpen(false)}>{n.text}</Link>
                </li>))}</ul>
              <button className="mt-1 underline" onClick={() => api("/notifications/read-all", { method: "POST" }).then(() => api("/notifications").then(setNotes))}>Mark all read</button>
            </div>
          )}
        </div>
        <div className="mt-4 text-slate-300">{me.name} · {me.role}</div>
        <button className="mt-2 underline" onClick={async () => { await api("/auth/logout", { method: "POST" }); window.location.href = "/login"; }}>
          Sign out
        </button>
      </nav>
      <main id="main" className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
