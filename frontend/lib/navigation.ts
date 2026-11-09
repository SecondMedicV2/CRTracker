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
  ] },
  { label: "Administration", items: [
    { href: "/users", label: "Users", roles: ["ADMIN"] },
    { href: "/doctors", label: "Doctors", roles: ["ADMIN"] },
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
