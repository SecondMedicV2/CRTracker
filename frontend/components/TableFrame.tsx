export function TableFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return <div role="region" aria-label={label} tabIndex={0} className="table-frame rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">{children}</div>;
}
