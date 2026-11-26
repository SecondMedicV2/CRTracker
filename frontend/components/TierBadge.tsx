"use client";

const COLOUR_CLASSES: Record<string, string> = {
  red: "border-red-300 bg-red-100 text-red-900",
  teal: "border-teal-300 bg-teal-100 text-teal-900",
  "navy blue": "border-blue-800 bg-blue-900 text-white",
  amber: "border-amber-300 bg-amber-100 text-amber-900",
  green: "border-emerald-300 bg-emerald-100 text-emerald-900",
};

export default function TierBadge({
  label,
  colour,
}: {
  label?: string | null;
  colour?: string | null;
}) {
  if (!label) return null;
  const cls = COLOUR_CLASSES[(colour || "").toLowerCase()] || "border-slate-300 bg-slate-100 text-slate-800";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}
