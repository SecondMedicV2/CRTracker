"use client";

import { createContext } from "react";

export type Role = "ADMIN" | "CALLER" | "DOCTOR";
export const RoleContext = createContext<Role | null>(null);

type NavItem = { href: string; label: string; roles: Role[]; description?: string; detail?: string };

export const NAV: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [
    { href: "/", label: "Home", roles: ["ADMIN", "CALLER", "DOCTOR"] },
    { href: "/dashboard", label: "Dashboard", roles: ["ADMIN"], description: "See follow-up activity and work that needs attention." },
  ] },
  { label: "Work queues", items: [
    { href: "/doctor-queue", label: "My queue", roles: ["ADMIN", "DOCTOR"], description: "Review assigned cases and upcoming calls." },
    { href: "/followups", label: "Follow-ups", roles: ["ADMIN", "CALLER", "DOCTOR"], detail: "/caller-card", description: "See due cases and open the next call card." },
    { href: "/identity", label: "Duplicate review", roles: ["ADMIN", "CALLER"], description: "Check possible duplicate patient records." },
  ] },
  { label: "Lab records", items: [
    { href: "/import", label: "Import orders", roles: ["ADMIN"], description: "Add order IDs, upload a file, or pull orders from the lab." },
    { href: "/orders", label: "Orders", roles: ["ADMIN"] },
    { href: "/reports", label: "Reports", roles: ["ADMIN", "DOCTOR"], description: "Open lab reports and see which need review." },
    { href: "/patients", label: "Patients", roles: ["ADMIN", "DOCTOR"] },
    { href: "/dialer", label: "Manual dialer", roles: ["ADMIN", "CALLER", "DOCTOR"], description: "Manual outbound dialing via MyOperator." },
  ] },
  { label: "Administration", items: [
    { href: "/relationship", label: "Relationship scorecard", roles: ["ADMIN"], description: "Patient relationship lifecycle scorecard." },
    { href: "/relationship/loop", label: "Health loop", roles: ["ADMIN"], description: "Care touchpoint loop & retention analysis." },
    { href: "/care-plans", label: "Care plans", roles: ["ADMIN", "CALLER", "DOCTOR"], description: "Suggest, assess and take payment for Health Hub care plans." },
    { href: "/outcomes", label: "Outcomes", roles: ["ADMIN"], description: "North Star verified health deltas and the loop operating metrics." },
    { href: "/memberships", label: "Memberships", roles: ["ADMIN"], description: "Health360 memberships & corporate billing." },
    { href: "/users", label: "Users", roles: ["ADMIN"] },
    { href: "/doctors", label: "Doctors", roles: ["ADMIN"] },
    { href: "/retesting-protocol", label: "Retesting protocol", roles: ["ADMIN"], description: "5-tier urgency windows, SLAs, and open counts." },
    { href: "/rules", label: "Rules", roles: ["ADMIN"] },
    { href: "/settings", label: "Settings", roles: ["ADMIN"] },
    { href: "/audit", label: "Audit log", roles: ["ADMIN"] },
  ] },
];

export function navigationFor(role: Role) {
  return NAV.map(({ label, items }) => ({
    label,
    items: items.filter((item) => item.roles.includes(role)).map((item) => {
      if (role === "CALLER" && item.href === "/followups") {
        return { ...item, label: "Calling queue", description: "Open a report follow-up, record the outcome, and arrange a doctor call." };
      }
      return item;
    }),
  }))
    .filter(({ items }) => items.length > 0);
}
