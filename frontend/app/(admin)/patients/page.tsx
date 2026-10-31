"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/useApi";

export default function Patients() {
  const [q, setQ] = useState("");
  const { data, error } = useApi<any[]>(`/patients?q=${encodeURIComponent(q)}`);
  if (error) return <p role="alert">{error}</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Patients</h1>
      <input className="w-full max-w-sm rounded border p-2 text-sm" placeholder="Search by name or mobile number" value={q} onChange={(e) => setQ(e.target.value)} />
      <table className="w-full bg-white text-left text-sm shadow">
        <thead><tr><th className="p-2">Name</th><th>Age</th><th>Gender</th><th>Mobile</th><th>Household</th><th /></tr></thead>
        <tbody>{data?.map((p) => (
          <tr key={p.id} className="border-t">
            <td className="p-2"><Link className="underline" href={`/patients/${p.id}`}>{p.name}</Link></td>
            <td>{p.age}</td><td>{p.gender}</td><td className="font-mono">{p.mobile}</td><td>{p.household_tag}</td>
            <td>{p.do_not_call && <span className="text-red-700">Do not call</span>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
