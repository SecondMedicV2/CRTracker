"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { RequestState } from "@/components/RequestState";
import { api } from "@/lib/api";
import { navigationFor, Role, RoleContext } from "@/lib/navigation";
import { useApi } from "@/lib/useApi";

type Notifications = { unread: number; items: { id: number; read: boolean; urgent: boolean; link: string; text: string }[] };

export default function Shell({ children }: { children: React.ReactNode }) {
  const { data: me, error, reload } = useApi<{ name: string; role: Role }>("/auth/me");
  const path = usePathname();
  const [notes, setNotes] = useState<Notifications>({ unread: 0, items: [] });
  const [notesOpen, setNotesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const [markingRead, setMarkingRead] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!me) return;
    const load = () => api<Notifications>("/notifications").then(setNotes).catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [me]);

  async function markRead() {
    setMarkingRead(true);
    setActionError("");
    try {
      await api("/notifications/read-all", { method: "POST" });
      setNotes(await api<Notifications>("/notifications"));
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setMarkingRead(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    setActionError("");
    try {
      await api("/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch (err: any) {
      setActionError(err.message);
      setSigningOut(false);
    }
  }

  if (!me) return <main className="mx-auto max-w-lg p-6"><RequestState loading={!error} error={error} retry={reload} /></main>;

  return (
    <div className="min-h-screen md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-30 focus:bg-white focus:p-3 print:hidden">Skip to the content</a>
      <aside className="workspace-sidebar bg-slate-900 text-slate-100 md:sticky md:top-0 md:max-h-dvh md:w-60 md:shrink-0 md:self-start md:overflow-y-auto print:hidden">
        <div className="flex min-h-16 items-center justify-between gap-3 px-4 md:border-b md:border-white/10">
          <Link href="/" className="flex items-center gap-2 font-semibold" onClick={() => setMenuOpen(false)}>
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-teal-300 text-xs font-bold text-slate-900">CR</span>
            CRTracker
          </Link>
          <button type="button" aria-expanded={menuOpen} aria-controls="workspace-menu" className="rounded-lg border border-white/30 px-3 py-2 text-sm md:hidden" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? "Close menu" : "Menu"}
          </button>
        </div>
        <div id="workspace-menu" className={`${menuOpen ? "block" : "hidden"} space-y-5 px-4 pb-4 md:block md:pt-4`}>
          <nav aria-label="Main" className="space-y-4">
            {navigationFor(me.role).map((group) => (
              <div key={group.label}>
                <p className="mb-1 px-2 text-xs font-medium text-slate-400">{group.label}</p>
                <ul className="space-y-0.5">
                  {group.items.map(({ href, label, detail }) => {
                    const active = path === href || path.startsWith(`${href}/`) || (detail && path.startsWith(`${detail}/`));
                    return <li key={href}><Link href={href} aria-current={active ? (path === href ? "page" : "location") : undefined}
                      onClick={() => { setMenuOpen(false); setNotesOpen(false); }}
                      className={`block rounded-lg px-2 py-2 text-sm ${active ? "bg-teal-300 font-semibold text-slate-900" : "hover:bg-white/10"}`}>{label}</Link></li>;
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className="space-y-2 border-t border-white/10 pt-3 text-sm">
            <button type="button" className="rounded-lg px-2 py-2 hover:bg-white/10" aria-expanded={notesOpen} aria-controls="workspace-notifications"
              aria-label={`Notifications, ${notes.unread} unread`} onClick={() => setNotesOpen(!notesOpen)}>
              Notifications{notes.unread > 0 && <span className="ml-2 rounded-full bg-teal-300 px-2 text-xs text-slate-900">{notes.unread}</span>}
            </button>
            <div id="workspace-notifications" hidden={!notesOpen} className="space-y-2 rounded-lg bg-white p-3 text-slate-900">
              {notes.items.length === 0 ? <p>No notifications</p> : (
                <ul className="max-h-60 space-y-2 overflow-auto">{notes.items.map((n) => (
                  <li key={n.id} className={n.read ? "text-slate-600" : n.urgent ? "font-medium text-red-700" : "font-medium"}>
                    <Link href={n.link || "/"} onClick={() => { setNotesOpen(false); setMenuOpen(false); }}>{n.text}</Link>
                  </li>
                ))}</ul>
              )}
              {notes.unread > 0 && <button type="button" className="underline" onClick={markRead} disabled={markingRead}>{markingRead ? "Marking as read…" : "Mark all read"}</button>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-2 px-2">
              <span className="break-all text-slate-300">{me.name} <span className="text-xs">· {me.role}</span></span>
              <button type="button" className="py-2 underline" onClick={signOut} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
            </div>
            {actionError && <p role="alert" className="px-2 text-red-200">{actionError}</p>}
          </div>
        </div>
      </aside>
      <main id="main" tabIndex={-1} className="workspace min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-7xl"><RoleContext.Provider value={me.role}>{children}</RoleContext.Provider></div>
      </main>
    </div>
  );
}
