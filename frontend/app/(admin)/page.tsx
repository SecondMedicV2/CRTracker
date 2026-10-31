"use client";
import { useApi } from "@/lib/useApi";

export default function Home() {
  const { data: rules } = useApi<any[]>("/rules"); // 403 for non-admins: banner simply hidden
  const pending = rules?.filter((r) => r.pending_signoff) ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Welcome</h1>
      {pending.length > 0 && (
        <div role="alert" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm">
          Medical rules pending clinical sign-off: {pending.map((r) => r.key).join(", ")}. A doctor must approve them before production use.
        </div>
      )}
      <p className="text-sm text-slate-600">Import, follow-up queues and the Call Card arrive in the next phases.</p>
    </div>
  );
}
