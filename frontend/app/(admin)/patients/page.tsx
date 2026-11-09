"use client";
import { RequestState } from "@/components/RequestState";
import { TableFrame } from "@/components/TableFrame";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/useApi";

export default function Patients() {
  const [q, setQ] = useState("");
  const { data, error, reload } = useApi<any[]>(`/patients?q=${encodeURIComponent(q)}`);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Patients</h1>
      <label className="block max-w-sm text-sm font-medium">Search by name or mobile number
        <input className="mt-1 block w-full rounded-lg border p-2" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <RequestState loading={!data} error={error} retry={reload} empty={data?.length === 0 ? (q.trim() ? "No patients match your search." : "No patients yet.") : undefined} />
      {!error && !!data?.length && (
        <TableFrame label="Patients">
          <table className="w-full bg-white text-left text-sm shadow">
            <thead><tr><th className="p-2">Name</th><th>Age</th><th>Gender</th><th>Mobile</th><th>Household</th><th><span className="sr-only">Notes</span></th></tr></thead>
            <tbody>{data?.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-2"><Link className="underline" href={`/patients/view?id=${p.id}`}>{p.name}</Link></td>
                <td>{p.age}</td><td>{p.gender}</td><td className="font-mono">{p.mobile}</td><td>{p.household_tag}</td>
                <td>{p.do_not_call && <span className="text-red-700">Do not call</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
