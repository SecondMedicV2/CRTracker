"use client";
import { useContext, useState } from "react";
import { api } from "@/lib/api";
import { RoleContext } from "@/lib/navigation";
import { useApi } from "@/lib/useApi";
import { TableFrame } from "@/components/TableFrame";

const fmtDate = (d?: string | null) =>
  d && !isNaN(Date.parse(d))
    ? new Date(`${String(d).slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "\u2014";

function Sparkline({ points }: { points: { value: number; flag?: string; date?: string }[] }) {
  if (!points || points.length < 2) return <span className="text-xs text-slate-400">{"\u2014"}</span>;
  const w = 72;
  const h = 22;
  const vals = points.map((p) => Number(p.value));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const px = (i: number) => 4 + (i / (points.length - 1)) * (w - 8);
  const py = (v: number) => 4 + (1 - (v - lo) / (hi - lo)) * (h - 8);
  const coords = points.map((p, i) => `${px(i).toFixed(1)},${py(Number(p.value)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label={`Sparkline of ${points.length} results`} className="shrink-0">
      <polyline fill="none" stroke="#0f766e" strokeWidth="1.7" points={coords} />
      {points.map((p, i) => {
        const abn = p.flag === "HIGH" || p.flag === "LOW";
        return <circle key={i} cx={px(i)} cy={py(Number(p.value))} r={i === points.length - 1 ? 2.6 : 1.8} fill={abn ? "#dc2626" : "#0f766e"} />;
      })}
    </svg>
  );
}

function statusPillCls(val: string | null | undefined, kind: "target" | "change" | "trend") {
  if (!val) return "border-slate-200 bg-slate-100 text-slate-600";
  if (val === "Above target" || val === "Worsened" || val === "Negative trend") {
    return "border-rose-200 bg-rose-100 text-rose-800";
  }
  if (val === "Improved" || val === "Positive trend") {
    return "border-teal-200 bg-teal-100 text-teal-800";
  }
  if (val === "At target") {
    return "border-emerald-200 bg-emerald-100 text-emerald-800";
  }
  if (kind === "target" && val === "Below target") {
    return "border-amber-200 bg-amber-100 text-amber-900";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function JourneyStrip({
  journey,
  isDoctor,
  patientId,
  onReload,
}: {
  journey: any;
  isDoctor: boolean;
  patientId: number | string;
  onReload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [gluOpen, setGluOpen] = useState(false);
  const [gluVal, setGluVal] = useState("");
  const [gluKind, setGluKind] = useState("GLUCOSE_FASTING");
  const [msg, setMsg] = useState("");
  if (!journey || journey.template_code !== "HBA1C_90") return null;

  async function toggleDay90(checked: boolean) {
    if (!journey.followup_id) return;
    setBusy(true);
    setMsg("");
    try {
      await api(`/followups/${journey.followup_id}/journey/day90-confirm`, {
        method: "POST",
        body: { clinically_appropriate: checked },
      });
      onReload();
    } catch (e: any) {
      setMsg(e.message || "Could not update Day 90 confirmation");
    } finally {
      setBusy(false);
    }
  }

  async function saveGlucose(e: React.FormEvent) {
    e.preventDefault();
    if (!gluVal) return;
    setBusy(true);
    setMsg("");
    try {
      await api(`/patients/${patientId}/home-readings`, {
        method: "POST",
        body: { kind: gluKind, values: { value: Number(gluVal) } },
      });
      setGluVal("");
      setGluOpen(false);
      onReload();
    } catch (err: any) {
      setMsg(err.message || "Could not save glucose reading");
    } finally {
      setBusy(false);
    }
  }

  const glu = journey.glucose_monitoring || {};
  const adh = journey.adherence || {};

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900">HbA1c Follow-up Journey ({journey.template_code})</h3>
          <p className="text-xs text-slate-500">
            Anchor date {fmtDate(journey.anchor_date)}
            {journey.initial_hba1c != null && <> · Initial HbA1c: <b>{journey.initial_hba1c} %</b></>}
            {journey.new_hba1c != null && <> · Repeat HbA1c: <b className="text-teal-800">{journey.new_hba1c} %</b></>}
          </p>
        </div>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-900">
          {journey.disclaimer}
        </span>
      </div>

      {msg && <p role="alert" className="text-xs font-medium text-rose-700">{msg}</p>}

      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5" aria-label="HBA1C_90 journey steps">
        {(journey.steps || []).map((step: any, idx: number) => {
          const done = step.status === "DONE";
          const due = step.status === "DUE";
          const cls = done
            ? "border-teal-300 bg-teal-50/80 text-teal-950"
            : due
              ? "border-amber-300 bg-amber-50/80 text-amber-950"
              : "border-slate-200 bg-slate-50 text-slate-800";
          const rangeStr = step.date_from === step.date_to ? fmtDate(step.date_from) : `${fmtDate(step.date_from)} \u2013 ${fmtDate(step.date_to)}`;
          return (
            <li key={step.code} className={`relative rounded-xl border p-3 text-xs ${cls}`}>
              <div className="flex items-center justify-between gap-1">
                <span className="font-bold text-slate-900">{step.window_label}</span>
                <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                  {step.status.replace(/_/g, " ")}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] font-medium text-slate-600">{rangeStr}</p>
              <p className="mt-1.5 leading-snug">{step.what_happens}</p>
              <p className="mt-1 text-[10px] font-semibold text-slate-500">Owner: {step.owner}</p>

              {step.code === "HBA1C_D1_7" && journey.followup_id && (
                <label className="mt-2 flex items-start gap-1.5 rounded border border-slate-200 bg-white p-1.5 text-[11px]">
                  <input
                    type="checkbox"
                    disabled={!isDoctor || busy}
                    checked={Boolean(journey.day90_clinically_appropriate)}
                    onChange={(e) => toggleDay90(e.target.checked)}
                    aria-label="Day 90 repeat HbA1c clinically appropriate"
                  />
                  <span>Day 90 repeat HbA1c clinically appropriate</span>
                </label>
              )}

              {step.code === "HBA1C_D7_30" && (
                <div className="mt-2 space-y-1 text-[11px]">
                  <div className="text-slate-600">
                    Glucose source: <b>{glu.source === "home_readings" ? "Home readings" : glu.source === "staff_entered" ? "Staff-entered" : "None yet"}</b>
                    {glu.latest && <> ({glu.latest.value} mg/dL)</>}
                  </div>
                  <button
                    type="button"
                    className="font-semibold text-teal-800 underline print:hidden"
                    onClick={() => setGluOpen((v) => !v)}
                  >
                    {gluOpen ? "Close" : "+ Enter glucose reading"}
                  </button>
                  {gluOpen && (
                    <form onSubmit={saveGlucose} className="mt-1 flex flex-col gap-1 rounded border bg-white p-1.5">
                      <select aria-label="Glucose kind" className="rounded border p-1" value={gluKind} onChange={(e) => setGluKind(e.target.value)}>
                        <option value="GLUCOSE_FASTING">Fasting</option>
                        <option value="GLUCOSE_RANDOM">Random</option>
                      </select>
                      <input type="number" step="0.1" placeholder="mg/dL" className="rounded border p-1" value={gluVal} onChange={(e) => setGluVal(e.target.value)} />
                      <button type="submit" disabled={busy || !gluVal} className="rounded bg-teal-800 px-2 py-0.5 text-white">Save</button>
                    </form>
                  )}
                </div>
              )}

              {step.code === "HBA1C_D30_60" && (
                <div className="mt-2 text-[11px] text-slate-600">
                  <div>Calls: <b>{adh.calls_logged ?? 0}</b> · Refills confirmed: <b>{adh.refill_confirmations ?? 0}</b></div>
                  {glu.direction && <div>Glucose trend: <b>{glu.direction}</b></div>}
                </div>
              )}

              {step.code === "HBA1C_D90" && journey.new_hba1c != null && (
                <div className="mt-1.5 font-semibold text-teal-800">New HbA1c: {journey.new_hba1c} %</div>
              )}

              {idx < 4 && (
                <span aria-hidden="true" className="hidden sm:inline-block absolute -right-2 top-1/2 -translate-y-1/2 z-10 text-slate-400 font-bold">
                  {"\u203A"}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function ComparisonPanel({
  endpoint,
  refreshKey = 0,
  onUpdated,
}: {
  endpoint: string;
  refreshKey?: number;
  onUpdated?: () => void;
}) {
  const role = useContext(RoleContext);
  const sep = endpoint.includes("?") ? "&" : "?";
  const { data, error, reload } = useApi<any>(`${endpoint}${sep}k=${refreshKey}`);
  const [filterMode, setFilterMode] = useState<"abnormal" | "all">("abnormal");
  const [showPrintSummary, setShowPrintSummary] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editOp, setEditOp] = useState("<");
  const [editVal, setEditVal] = useState("");
  const [editMsg, setEditMsg] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);

  if (role === "CALLER") return null;
  if (error) return null;
  if (!data) return null;

  const rows: any[] = data.rows || [];
  if (rows.length === 0 && !data.journey) return null;

  const isDoctor = role === "DOCTOR";
  const abnRows = rows.filter((r) => r.is_abnormal);
  const displayed = filterMode === "abnormal" ? (abnRows.length > 0 ? abnRows : rows) : rows;

  async function saveTarget(row: any) {
    if (!editVal || !data.patient_id) return;
    setSavingTarget(true);
    setEditMsg("");
    try {
      const cur = await api<any>(`/patients/${data.patient_id}/health-profile`);
      const nextTargets = {
        ...(cur.targets || {}),
        [row.param_code]: {
          target_op: editOp,
          target_value: Number(editVal),
          unit: row.unit || "",
          direction: editOp === ">=" || editOp === ">" ? "HIGHER_IS_BETTER" : "LOWER_IS_BETTER",
        },
      };
      await api(`/patients/${data.patient_id}/health-profile`, { method: "PUT", body: { targets: nextTargets } });
      setEditingCode(null);
      reload();
      onUpdated?.();
    } catch (e: any) {
      setEditMsg(e.message || "Could not update target");
    } finally {
      setSavingTarget(false);
    }
  }

  return (
    <section className="space-y-4" aria-label="AMI Parameter Display and Journey">
      {data.journey && (
        <JourneyStrip
          journey={data.journey}
          isDoctor={isDoctor}
          patientId={data.patient_id}
          onReload={() => {
            reload();
            onUpdated?.();
          }}
        />
      )}

      {rows.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">AMI Parameter Display</h2>
              <p className="text-xs text-slate-500">
                Current {fmtDate(data.current_collected_on)}
                {data.previous_collected_on ? ` vs Previous ${fmtDate(data.previous_collected_on)}` : " · First available report"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-medium">
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 ${filterMode === "abnormal" ? "bg-white font-bold text-rose-700 shadow-sm" : "text-slate-600"}`}
                  onClick={() => setFilterMode("abnormal")}
                >
                  Abnormal only ({abnRows.length})
                </button>
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 ${filterMode === "all" ? "bg-white font-bold text-slate-900 shadow-sm" : "text-slate-600"}`}
                  onClick={() => setFilterMode("all")}
                >
                  All ({rows.length})
                </button>
              </div>
              <button
                type="button"
                className="rounded-lg border border-teal-800 bg-teal-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-900"
                onClick={() => {
                  setShowPrintSummary(true);
                  setTimeout(() => window.print(), 50);
                }}
              >
                Print for patient
              </button>
            </div>
          </div>

          {editMsg && <p role="alert" className="text-xs font-medium text-rose-700">{editMsg}</p>}

          <TableFrame label="AMI Parameter Display table">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b bg-slate-50 text-slate-700">
                <tr>
                  <th className="p-2.5">Parameter</th>
                  <th className="p-2.5">Previous</th>
                  <th className="p-2.5">Current</th>
                  <th className="p-2.5">Change</th>
                  <th className="p-2.5">Trend (3+)</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Next action</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((r) => (
                  <tr key={r.param_code} className="border-t align-top">
                    <td className="p-2.5">
                      <div className="font-semibold text-slate-900">{r.label}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Target: <span className="font-medium">{r.target_display}</span>
                        {r.target_source === "patient_override" && " (patient target)"}
                        {isDoctor && (
                          <button
                            type="button"
                            className="ml-2 text-teal-700 underline print:hidden"
                            onClick={() => {
                              setEditingCode(editingCode === r.param_code ? null : r.param_code);
                              setEditOp(r.target_op === ">=" || r.target_op === ">" ? r.target_op : "<");
                              setEditVal(r.target_value != null ? String(r.target_value) : "");
                            }}
                          >
                            Edit target
                          </button>
                        )}
                      </div>
                      {editingCode === r.param_code && isDoctor && (
                        <div className="mt-1.5 flex items-center gap-1 print:hidden">
                          <select aria-label="Target operator" className="rounded border px-1 py-0.5 text-xs" value={editOp} onChange={(e) => setEditOp(e.target.value)}>
                            <option value="<">&lt;</option>
                            <option value="<=">&lt;=</option>
                            <option value=">=">&gt;=</option>
                            <option value=">">&gt;</option>
                          </select>
                          <input
                            aria-label={`Target value for ${r.label}`}
                            type="number"
                            step="0.1"
                            className="w-16 rounded border px-1.5 py-0.5 text-xs"
                            value={editVal}
                            onChange={(e) => setEditVal(e.target.value)}
                          />
                          <button type="button" disabled={savingTarget} onClick={() => saveTarget(r)} className="rounded bg-teal-800 px-2 py-0.5 text-xs text-white">
                            Save
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="p-2.5 whitespace-nowrap text-slate-700">
                      {r.previous != null ? `${r.previous} ${r.previous_unit || r.unit}` : "\u2014"}
                    </td>
                    <td className="p-2.5 whitespace-nowrap font-semibold text-slate-900">
                      {r.current} {r.unit}
                    </td>
                    <td className="p-2.5">
                      <div className="font-medium text-slate-800">{r.change_display}</div>
                      {r.change_pct_display && <div className="text-[11px] text-slate-500">{r.change_pct_display}</div>}
                    </td>
                    <td className="p-2.5">
                      <div className="flex flex-col gap-1">
                        <Sparkline points={r.sparkline || []} />
                        {r.trend ? (
                          <span className={`inline-block w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPillCls(r.trend, "trend")}`}>
                            {r.trend}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">Needs 3+ results</span>
                        )}
                      </div>
                    </td>
                    <td className="p-2.5">
                      <div className="flex flex-col gap-1">
                        {r.target_status && (
                          <span className={`inline-block w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPillCls(r.target_status, "target")}`}>
                            {r.target_status}
                          </span>
                        )}
                        {r.change_status && (
                          <span className={`inline-block w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPillCls(r.change_status, "change")}`}>
                            {r.change_status}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-2.5 font-medium text-slate-900">{r.next_action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>

          {showPrintSummary && (
            <div className="rounded-xl border border-slate-300 bg-slate-50 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">Printable Patient Summary {data.patient_name ? `\u2014 ${data.patient_name}` : ""}</h3>
                <button type="button" className="text-slate-600 underline print:hidden" onClick={() => setShowPrintSummary(false)}>Hide summary</button>
              </div>
              <ul className="space-y-1.5 list-disc pl-4 text-slate-800">
                {displayed.map((r) => (
                  <li key={r.param_code}>{r.patient_summary_line}</li>
                ))}
              </ul>
              <p className="pt-1 font-medium text-slate-600">{data.printable_disclaimer}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
