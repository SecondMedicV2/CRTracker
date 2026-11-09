"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const STATUSES = ["", "QUEUED", "FETCHING", "FETCHED", "FAILED_FETCH"];

function Orders() {
  const params = useSearchParams();
  const router = useRouter();
  const batch = params.get("batch_id");
  const filter = params.get("status_") ?? "";
  const status = STATUSES.includes(filter) ? filter : "";
  const qs = new URLSearchParams({ ...(status && { status_: status }), ...(batch && { batch_id: batch }) }).toString();
  const { data, error, reload } = useApi<any[]>(`/orders?${qs}`);
  const [msg, setMsg] = useState("");

  function setStatus(next: string) {
    const query = new URLSearchParams({ ...(batch && { batch_id: batch }), ...(next && { status_: next }) }).toString();
    router.replace(query ? `/orders?${query}` : "/orders", { scroll: false });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Orders{batch ? ` · batch #${batch}` : ""}</h1>
      <div className="flex items-center gap-3 text-sm">
        <select aria-label="Filter by status" className="rounded border p-1" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}
        </select>
        <button className="underline" onClick={reload}>Refresh</button>
      </div>
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <RequestState loading={!data} error={error} retry={reload} empty={data?.length === 0 ? (status || batch ? "No orders match these filters." : "No orders imported yet.") : undefined} />
      {!error && !!data?.length && (
        <TableFrame label="Orders">
          <table className="w-full bg-white text-left text-sm shadow">
            <thead><tr><th className="p-2">Order ID</th><th>Status</th><th>Tries</th><th>Reason</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{data?.map((o) => (
              <tr key={o.id} className="border-t"><td className="p-2 font-mono">{o.order_id}</td><td>{o.status}</td><td>{o.attempts}</td>
                <td className="text-red-700">{o.error}</td>
                <td>{o.status === "FAILED_FETCH" && (
                  <button className="underline" onClick={() => api(`/orders/${o.id}/retry`, { method: "POST" }).then(() => { setMsg(""); reload(); }).catch((e) => setMsg(e.message))}>Retry</button>
                )}</td></tr>
            ))}</tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<p role="status">Loading orders…</p>}><Orders /></Suspense>;
}
