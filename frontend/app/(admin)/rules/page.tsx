"use client";
import { useState } from "react";
import { RequestState } from "@/components/RequestState";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const RULE_METADATA: Record<string, { title: string; desc: string }> = {
  aliases: {
    title: "Lab Test Name Aliases & Normalization",
    desc: "Maps diverse lab test names from Thyrocare, SRL, and local pathology labs to canonical system codes (e.g. 'FBS' -> 'GLUCOSE_FASTING')."
  },
  buckets: {
    title: "Clinical Condition Buckets",
    desc: "Defines clinical condition categories (Diabetes, Lipid/Cardio, Thyroid, Anaemia, Vitamin D, etc.) and their retest intervals."
  },
  test_catalogue: {
    title: "Master Test Catalogue",
    desc: "Authoritative list of blood and diagnostic tests available for doctors to order as retests."
  },
  reference_ranges: {
    title: "Clinical Reference Ranges",
    desc: "Standard biological reference intervals and severity bands used when a lab report does not print ranges."
  },
  critical_values: {
    title: "Critical / Panic Values (Emergency Escalation)",
    desc: "Alarm thresholds that trigger immediate emergency doctor escalation and clinical notifications."
  },
  score_weights: {
    title: "Retest Scoring & Prioritization Algorithm",
    desc: "Mathematical scoring weights for severity, time ratio, parameter count, and patient engagement."
  },
  severity: {
    title: "Severity Percentage Thresholds",
    desc: "Percentage distance beyond reference limits used to classify abnormal findings as mild, moderate, or severe."
  },
  caller_script_forbidden: {
    title: "Compliance: Forbidden Terms for Callers",
    desc: "Words that calling agents must never say (e.g. diagnoses, medicine names, prescribing terms)."
  },
  script_templates: {
    title: "Doctor & Caller Dialogue Templates",
    desc: "Structured script templates for explaining reports, taking patient consent, and doctor consultations."
  },
  relationship_next_steps: {
    title: "Relationship Next Best Step Rules",
    desc: "Deterministic priority rules determining clinical and neutral caller next steps across the 7-stage Care Loop."
  },
  profile_codes: {
    title: "Health Profile Controlled Codes",
    desc: "Clinician-maintained codes for family history, symptoms, limitations, imaging findings, and decline reasons."
  },
  care_programs: {
    title: "Personalised Care Programmes (1-30)",
    desc: "Versioned triggers, offerings, loop stages, and caller-safe labels for Wellness, Disease-specific, Specialized, Medication, Diagnostic, and Family programs."
  },
  medicine_catalogue: {
    title: "Medicine Catalogue",
    desc: "Clinician-curated medicines, drug classes, chronic refill intervals, and linked treatment-response biomarkers."
  },
  drug_nutrient_rules: {
    title: "Drug-Nutrient Interaction Rules",
    desc: "Conservative pharmacist/doctor review rules matching medication classes with low/high nutritional markers."
  },
  referral_specialties: {
    title: "Specialist Referral Directory",
    desc: "Configured medical specialties mapped to neutral caller-safe appointment labels."
  },
  diagnostic_findings: {
    title: "10 Shared Diagnostic Findings",
    desc: "Starter clinical triggers defining the 10 key findings shared across recommendations, retesting, and journeys."
  },
  recommendation_combinations: {
    title: "Ranked Recommendation Combinations (Primary -> Secondary -> Third)",
    desc: "Starter Primary, Secondary, and Third recommendations and neutral caller labels for each diagnostic finding."
  },
  retest_protocols: {
    title: "Retesting Schedule Protocols (Findings & Conditions)",
    desc: "Clinically grounded retest timeframes, repeat tests, clinical considerations, AMI reminders, and condition-based protocols with clinical notes."
  },
  clinical_targets: {
    title: "Clinical Targets (Page 10/11)",
    desc: "Starter clinical target rules (e.g. HbA1c < 7.0%) with direction and min meaningful change."
  },
  next_action_rules: {
    title: "Parameter Display Next Action Rules (Page 10)",
    desc: "Starter deterministic next-action rules combining Target Status and Change Status."
  },
  journey_templates: {
    title: "Patient Journey Templates (HBA1C_90 / STANDARD_92)",
    desc: "Selection rules, day windows, owners, neutral caller labels, and clinician disclaimers for follow-up journeys."
  },
  retest_tiers: {
    title: "Retesting Protocol Urgency Tiers (5 Tiers)",
    desc: "Urgent, Early follow-up, Treatment response, Metabolic follow-up, and Long-term monitoring windows, SLAs, colours, and neutral caller labels."
  }
};

function Rule({ k, onChange }: { k: string; onChange: () => void }) {
  const { data, error, reload } = useApi<any>(`/rules/${k}`);
  const [text, setText] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const meta = RULE_METADATA[k] || {
    title: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    desc: `Medical rule set for ${k}`
  };

  if (error || !data) return <RequestState loading={!data} error={error} retry={reload} />;
  const ruleData = data.data !== undefined ? data.data : data;
  const shown = text ?? JSON.stringify(ruleData, null, 2);

  async function save() {
    setSaving(true);
    try {
      const parsed = JSON.parse(shown);
      await api(`/rules/${k}`, { method: "PUT", body: { data: parsed } });
      setText(null);
      setMsg("");
      reload();
      onChange();
    } catch (e: any) {
      setMsg(e.message || "Invalid JSON format");
    } finally {
      setSaving(false);
    }
  }

  async function signoff() {
    try {
      await api(`/rules/${k}/signoff`, { method: "POST" });
      reload();
      onChange();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  return (
    <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3 group">
      <summary className="cursor-pointer text-sm font-semibold flex flex-wrap items-center justify-between gap-3 list-none">
        <div className="flex items-center gap-2">
          <span className="text-teal-700 font-mono text-base group-open:rotate-90 transition-transform">▸</span>
          <div>
            <h2 className="font-bold text-slate-900 text-base">{meta.title}</h2>
            <p className="text-xs text-slate-500 font-normal mt-0.5">{meta.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
            Key: {k} · v{data.version || 1}
          </span>
          {data.pending_signoff ? (
            <span className="rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-xs font-bold text-amber-900">
              Pending Doctor Sign-off
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 text-xs font-bold text-emerald-900">
              ✓ Signed Off
            </span>
          )}
        </div>
      </summary>

      <div className="pt-3 border-t border-slate-100 space-y-3">
        {k === "retest_protocols" && Array.isArray(ruleData) && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {ruleData.filter((p: any) => p.signoff_note).map((p: any) => (
              <div key={p.finding_code || p.condition_code} className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950">
                <b>Sign-off checklist ({p.finding_name || p.condition_name}):</b> {p.signoff_note}
              </div>
            ))}
            {(() => {
              let rows: any[] = ruleData;
              try { if (text !== null) rows = JSON.parse(text); } catch {}
              const updateRow = (idx: number, field: string, val: string) => {
                const next = rows.map((item: any, i: number) => (i === idx ? { ...item, [field]: val } : item));
                setText(JSON.stringify(next, null, 2));
              };
              const indexed = rows.map((p: any, idx: number) => ({ p, idx }));
              const findingRows = indexed.filter(({ p }) => Boolean(p.finding_code));
              const conditionRows = indexed.filter(({ p }) => Boolean(p.condition_code));
              return (
                <>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b bg-slate-50 text-slate-600">
                        <tr>
                          <th className="p-2">Finding</th>
                          <th className="p-2">Recommended retesting timeframe</th>
                          <th className="p-2">Tests to repeat</th>
                          <th className="p-2">Clinical considerations</th>
                          <th className="p-2">AMI reminder</th>
                        </tr>
                      </thead>
                      <tbody>
                        {findingRows.map(({ p, idx }) => (
                          <tr key={p.finding_code} className="border-t align-top">
                            <td className="p-2 font-semibold whitespace-nowrap">{p.finding_name}</td>
                            <td className="p-2 min-w-[200px]"><input aria-label={`${p.finding_code} timeframe`} className="w-full rounded border px-1.5 py-1" value={p.timeframe_text || ""} onChange={(e) => updateRow(idx, "timeframe_text", e.target.value)} /></td>
                            <td className="p-2 min-w-[160px]"><input aria-label={`${p.finding_code} tests`} className="w-full rounded border px-1.5 py-1" value={p.tests_text || ""} onChange={(e) => updateRow(idx, "tests_text", e.target.value)} /></td>
                            <td className="p-2 min-w-[240px]"><input aria-label={`${p.finding_code} considerations`} className="w-full rounded border px-1.5 py-1" value={p.considerations_text || ""} onChange={(e) => updateRow(idx, "considerations_text", e.target.value)} /></td>
                            <td className="p-2 min-w-[130px]"><input aria-label={`${p.finding_code} reminder`} className="w-full rounded border px-1.5 py-1" value={p.ami_reminder_text || ""} onChange={(e) => updateRow(idx, "ami_reminder_text", e.target.value)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {conditionRows.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <div className="border-b bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800">
                        Condition-based retesting protocols (Page 11)
                      </div>
                      <table className="w-full text-left text-xs">
                        <thead className="border-b bg-slate-50 text-slate-600">
                          <tr>
                            <th className="p-2">Code</th>
                            <th className="p-2">Condition</th>
                            <th className="p-2">Typical monitoring timeframe</th>
                            <th className="p-2">Tier</th>
                            <th className="p-2">Note (if any)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {conditionRows.map(({ p, idx }) => (
                            <tr key={p.condition_code} className="border-t align-top">
                              <td className="p-2 font-mono whitespace-nowrap">{p.condition_code}</td>
                              <td className="p-2 font-semibold whitespace-nowrap">{p.condition_name}</td>
                              <td className="p-2 min-w-[240px]"><input aria-label={`${p.condition_code} timeframe`} className="w-full rounded border px-1.5 py-1" value={p.timeframe_text || ""} onChange={(e) => updateRow(idx, "timeframe_text", e.target.value)} /></td>
                              <td className="p-2 whitespace-nowrap font-mono">{p.tier || "LONG_TERM"}</td>
                              <td className="p-2 min-w-[200px]"><input aria-label={`${p.condition_code} note`} placeholder="Optional clinical team note" className="w-full rounded border px-1.5 py-1" value={p.note || ""} onChange={(e) => updateRow(idx, "note", e.target.value)} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
        <label className="block text-xs font-semibold text-slate-700">
          Rule Definition (JSON)
          <textarea
            aria-label={`${k} (JSON)`}
            className="mt-1 h-72 w-full rounded-xl border border-slate-300 bg-slate-900 p-3 font-mono text-xs text-emerald-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
            value={shown}
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        {msg && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 font-medium">{msg}</p>}

        <div className="flex flex-wrap gap-2 text-sm pt-1">
          <button
            className="rounded-lg bg-teal-800 px-4 py-2 font-semibold text-white shadow-sm hover:bg-teal-900 transition disabled:opacity-40"
            disabled={text === null || saving}
            onClick={save}
          >
            {saving ? "Saving…" : "Save as New Version"}
          </button>
          <button
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 transition"
            onClick={signoff}
          >
            Record Doctor Sign-off
          </button>
        </div>
      </div>
    </details>
  );
}

function CriticalRules() {
  const { data, error, reload } = useApi<any[]>("/critical-rules");
  const [msg, setMsg] = useState("");
  if (error || !data) return <RequestState loading={!data} error={error} retry={reload} />;

  async function toggle(rule: any) {
    try {
      await api(`/critical-rules/${rule.id}`, { method: "PATCH", body: { active: !rule.active } });
      setMsg("");
      reload();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  return (
    <div className="space-y-3 rounded bg-white p-4 shadow">
      <div>
        <h2 className="text-base font-semibold">Critical Lab Rules (Urgent triggers)</h2>
        <p className="text-xs text-slate-600">
          Doctor-approved safety triggers. Reports matching any active rule are locked to URGENT priority and prioritized in doctor queues.
        </p>
      </div>
      {msg && <p role="alert" className="text-xs text-red-600">{msg}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b bg-slate-50 text-slate-700">
              <th className="p-2">Parameter</th>
              <th>Condition</th>
              <th>Urgency</th>
              <th>Clinical reason</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r: any) => (
              <tr key={r.id} className="border-b hover:bg-slate-50">
                <td className="p-2 font-medium">{r.canonical_name || r.param_code}</td>
                <td className="font-mono">{r.operator} {r.threshold_value} {r.unit}</td>
                <td>
                  <span className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-800">
                    {r.urgency_tier}
                  </span>
                </td>
                <td className="text-slate-600">{r.reason}</td>
                <td>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={r.active}
                      onChange={() => toggle(r)}
                      aria-label={`Toggle ${r.param_code} rule`}
                    />
                    <span className={r.active ? "font-medium text-emerald-700" : "text-slate-400"}>
                      {r.active ? "Active" : "Disabled"}
                    </span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Rules() {
  const { data, error, reload } = useApi<any[]>("/rules");
  const pending = data?.some((r) => r.pending_signoff);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Clinical & Operational Rules</h1>
        <p className="mt-1 text-sm text-slate-600">
          Version-controlled medical logic governing lab aliases, condition buckets, reference thresholds, and caller compliance.
        </p>
      </div>

      <RequestState loading={!data} error={error} retry={reload} empty={data?.length === 0 ? "No rule sets found." : undefined} />
      {pending && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <strong>Starter content, pending clinical sign-off:</strong> Medical rules must be signed off by a licensed doctor before live diagnostic evaluation.
        </div>
      )}

      <div className="space-y-4">
        {data?.map((r) => <Rule key={r.key} k={r.key} onChange={reload} />)}
      </div>
      <CriticalRules />
    </div>
  );
}
