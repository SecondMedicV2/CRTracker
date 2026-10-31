"use client";
import { useApi } from "@/lib/useApi";

export default function Audit() {
  const { data, error } = useApi<any[]>("/audit?limit=200");
  if (error) return <p role="alert">{error}</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <table className="w-full bg-white text-left text-sm shadow">
        <thead><tr><th className="p-2">When</th><th>User</th><th>Action</th><th>Entity</th><th>ID</th><th>IP</th></tr></thead>
        <tbody>{data?.map((a) => (
          <tr key={a.id} className="border-t"><td className="p-2">{new Date(a.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
            <td>{a.user_id ?? "-"}</td><td>{a.action}</td><td>{a.entity}</td><td>{a.entity_id}</td><td>{a.ip}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
