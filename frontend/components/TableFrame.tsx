export function TableFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return <div role="region" aria-label={label} tabIndex={0} className="table-frame overflow-x-auto rounded-xl border border-slate-200 bg-white">{children}</div>;
}
