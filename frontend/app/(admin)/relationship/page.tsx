"use client";
import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { RequestState } from "@/components/RequestState";

const istDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

export default function RelationshipModelPage() {
  const [from, setFrom] = useState(() => istDate.format(Date.now() - 365 * 864e5));
  const [to, setTo] = useState(() => istDate.format(Date.now()));
  const [hubId, setHubId] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [corpId, setCorpId] = useState("");

  const queryParams = new URLSearchParams({
    from,
    to,
    ...(hubId ? { hub_id: hubId } : {}),
    ...(nodeId ? { node_id: nodeId } : {}),
    ...(corpId ? { corporate_id: corpId } : {}),
  });

  const { data: scorecard, error, reload } = useApi<any>(`/relationship/scorecard?${queryParams}`);

  const exportCSV = () => {
    if (!scorecard?.dimensions) return;
    const headers = ["Dimension", "Current Transaction Model", "Proposed Relationship Model", "Live Metric", "Data Status"];
    const rows = scorecard.dimensions.map((d: any) => [
      d.dimension,
      d.current_model,
      d.proposed_model,
      d.proposed_metric?.value || "",
      d.data_status || "OK"
    ]);

    const sanitize = (val: any) => {
      let str = String(val ?? "");
      if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
      return `"${str.replace(/"/g, '""')}"`;
    };

    const csvContent = [headers.map(sanitize).join(","), ...rows.map((r: any[]) => r.map(sanitize).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `relationship_scorecard_${from}_to_${to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Relationship Model Scorecard (Page 13)</h1>
          <p className="mt-1 text-sm text-slate-500">12 dimensions comparing current transaction model against proposed relationship model.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={exportCSV}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-sm">
        <label className="flex items-center gap-2">
          <span className="text-slate-500">From</span>
          <input type="date" className="rounded-lg border border-slate-200 px-3 py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-500">To</span>
          <input type="date" className="rounded-lg border border-slate-200 px-3 py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-500">Hub ID</span>
          <input type="number" placeholder="All Hubs" className="w-24 rounded-lg border border-slate-200 px-3 py-1.5" value={hubId} onChange={(e) => setHubId(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-500">Node ID</span>
          <input type="number" placeholder="All Nodes" className="w-24 rounded-lg border border-slate-200 px-3 py-1.5" value={nodeId} onChange={(e) => setNodeId(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-500">Corporate ID</span>
          <input type="number" placeholder="All Corps" className="w-24 rounded-lg border border-slate-200 px-3 py-1.5" value={corpId} onChange={(e) => setCorpId(e.target.value)} />
        </label>
      </div>

      <RequestState loading={!scorecard} error={error} retry={reload} />

      {scorecard && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3.5 text-left font-semibold text-slate-700">Dimension</th>
                <th className="px-6 py-3.5 text-left font-semibold text-slate-700">Current Transaction Model</th>
                <th className="px-6 py-3.5 text-left font-semibold text-slate-700">Proposed Relationship Model</th>
                <th className="px-6 py-3.5 text-left font-semibold text-slate-700">Live Metric (Current → Proposed)</th>
                <th className="px-6 py-3.5 text-right font-semibold text-slate-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {scorecard.dimensions.map((d: any, idx: number) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="px-6 py-4 font-bold text-slate-900">{d.dimension}</td>
                  <td className="px-6 py-4 text-slate-600">
                    <div className="font-medium text-slate-800">{d.current_model}</div>
                    <div className="text-xs text-slate-400">{d.current_metric?.label}: {d.current_metric?.value}</div>
                  </td>
                  <td className="px-6 py-4 text-slate-600">
                    <div className="font-medium text-slate-800">{d.proposed_model}</div>
                    <div className="text-xs text-teal-700">{d.proposed_metric?.label}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="inline-flex items-center gap-2 rounded-lg bg-teal-50 px-3 py-1 font-bold text-teal-800 border border-teal-100">
                      <span>{d.proposed_metric?.value}</span>
                      <span className="text-teal-600">↑</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${d.data_status === "OK" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {d.data_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
