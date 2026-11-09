"use client";

import Link from "next/link";
import { useContext } from "react";
import { navigationFor, Role, RoleContext } from "@/lib/navigation";
import { useApi } from "@/lib/useApi";

const SHORTCUTS: Record<Role, string[]> = {
  ADMIN: ["/dashboard", "/import", "/followups"],
  CALLER: ["/followups", "/identity"],
  DOCTOR: ["/doctor-queue", "/followups", "/reports"],
};

function ClinicalSignoff() {
  const { data } = useApi<{ pending_signoff: boolean }[]>("/rules");
  const pending = data?.filter((rule) => rule.pending_signoff).length ?? 0;
  return pending > 0 && (
    <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">Clinical sign-off pending</p>
      <p className="mt-1">A doctor must approve {pending === 1 ? "1 rule set" : `${pending} rule sets`} before production use.</p>
      <Link href="/rules" className="mt-2 inline-block font-semibold underline">Review medical rules</Link>
    </div>
  );
}

export default function Home() {
  const role = useContext(RoleContext);
  if (!role) return null;
  const links = navigationFor(role).flatMap((group) => group.items);
  return (
    <div className="space-y-6">
      <header className="rounded-2xl bg-slate-900 p-5 text-white sm:p-8">
        <p className="text-sm font-semibold text-teal-300">Report and follow-up workspace</p>
        <h1 className="mt-2 text-2xl font-semibold">Home</h1>
        <p className="mt-2 text-sm text-slate-300">Open a shortcut below to start your work.</p>
      </header>
      {role === "ADMIN" && <ClinicalSignoff />}
      <section aria-labelledby="shortcuts-heading">
        <h2 id="shortcuts-heading" className="mb-3 font-semibold">Quick links</h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SHORTCUTS[role].map((href) => {
            const item = links.find((link) => link.href === href);
            return item && <li key={href}><Link href={href} className="block h-full rounded-xl border border-slate-200 bg-white p-4 hover:border-teal-700">
              <span className="font-semibold text-teal-800">{item.label} <span aria-hidden="true">→</span></span>
              <span className="mt-1 block text-sm text-slate-600">{item.description}</span>
            </Link></li>;
          })}
        </ul>
      </section>
    </div>
  );
}
