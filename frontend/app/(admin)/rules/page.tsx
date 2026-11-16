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
