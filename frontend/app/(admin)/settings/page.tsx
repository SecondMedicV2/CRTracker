"use client";
import { useState } from "react";
import { RequestState } from "@/components/RequestState";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type SettingMeta = {
  label: string;
  description: string;
  category: string;
};

const SETTINGS_MAP: Record<string, SettingMeta> = {
  company_name: {
    label: "Company / Clinic Name",
    description: "Organization name used in patient scripts, doctor handoffs, and outgoing caller templates.",
    category: "General & Organization"
  },
  default_language: {
    label: "Default Communication Language",
    description: "Default language for caller scripts and customer communication (e.g. en, hi, hinglish).",
    category: "General & Organization"
  },
  session_minutes: {
    label: "Session Inactivity Timeout (Minutes)",
    description: "Duration before inactive staff accounts are automatically logged out.",
    category: "General & Organization"
  },
  myoperator_company_id: {
    label: "MyOperator Company ID",
    description: "SecondMedic company identifier for authenticating outbound calls with MyOperator.",
    category: "Telephony & Outbound Calling (MyOperator)"
  },
  myoperator_api_key: {
    label: "MyOperator API Token",
    description: "Secret API token used to place outgoing click-to-call requests to customers.",
    category: "Telephony & Outbound Calling (MyOperator)"
  },
  myoperator_caller_id: {
    label: "MyOperator Outbound Virtual Number",
    description: "The official SecondMedic caller ID / DID number displayed on customer phones.",
    category: "Telephony & Outbound Calling (MyOperator)"
  },
  caller_can_view_results: {
    label: "Allow Callers to View Clinical Results",
    description: "When enabled, calling agents can view numerical test values and out-of-range indicators.",
    category: "Permissions & Access Control"
  },
  caller_script_requires_approval: {
    label: "Require Doctor Approval for Calling Scripts",
    description: "Calling scripts cannot be dialed until a doctor reviews and signs off on the call card.",
    category: "Permissions & Access Control"
  },
  pull_time_ist: {
    label: "Automated Daily Lab Sync Time (IST)",
    description: "Time of day (HH:MM IST) when completed reports are fetched from partner laboratories.",
    category: "Lab & Data Intake"
  },
  fetch_max_attempts: {
    label: "Lab Fetch Retry Limit",
    description: "Maximum number of attempts to retrieve pending reports from the lab before failing.",
    category: "Lab & Data Intake"
  },
  extraction_min_confidence_pct: {
    label: "Minimum AI Extraction Confidence (%)",
    description: "Reports with AI confidence below this threshold are routed to manual review.",
    category: "Lab & Data Intake"
  },
  identity_name_similarity_pct: {
    label: "Patient Identity Match Threshold (%)",
    description: "Threshold percentage for deduplicating and automatically matching returning patients.",
    category: "Patient Management"
  },
  max_call_attempts: {
    label: "Maximum Patient Call Attempts",
    description: "Number of call attempts allowed before a follow-up is closed as unreachable.",
    category: "Calling & Follow-up Protocols"
  },
  attempt_window_days: {
    label: "Call Attempt Window (Days)",
    description: "Window of days within which call attempts are counted against the maximum limit.",
    category: "Calling & Follow-up Protocols"
  },
  default_interval_days: {
    label: "Standard Retest Interval (Days)",
    description: "Default interval between lab tests before reminding patients to retest.",
    category: "Calling & Follow-up Protocols"
  },
  callcard_lead_days: {
    label: "Call Card Pre-generation Lead Time (Days)",
    description: "Days prior to follow-up due date to pre-generate AI doctor and caller scripts.",
    category: "Calling & Follow-up Protocols"
  },
  yearly_reengagement: {
    label: "Annual Patient Health Re-engagement",
    description: "Automatically re-contact patients 12 months after their last blood checkup.",
    category: "Calling & Follow-up Protocols"
  },
  timeout_escalation_hours: {
    label: "Escalation SLA Timeout (Hours)",
    description: "Maximum response window for urgent doctor reviews before escalating to supervisor.",
    category: "Clinical SLAs & Pilot Settings"
  },
  timeout_routine_hours: {
    label: "Routine Case SLA Timeout (Hours)",
    description: "Standard response window for routine follow-up doctor reviews.",
    category: "Clinical SLAs & Pilot Settings"
  },
  pilot_mode: {
    label: "Pilot Mode (Restrict to Pilot Doctors)",
    description: "When active, incoming follow-up cases are assigned only to doctors enrolled in the pilot.",
    category: "Clinical SLAs & Pilot Settings"
  }
};

export default function Settings() {
  const { data, error, reload } = useApi<Record<string, any>>("/settings");
  const [msg, setMsg] = useState("");
  const [success, setSuccess] = useState("");
  const [resetting, setResetting] = useState(false);

  async function set(key: string, raw: string | boolean, current: any) {
    const value = typeof current === "number" ? Number(raw) : raw;
    try {
      await api(`/settings/${key}`, { method: "PUT", body: { value } });
      setMsg("");
      setSuccess(`Saved ${SETTINGS_MAP[key]?.label || key}`);
      setTimeout(() => setSuccess(""), 3000);
      reload();
    } catch (e: any) {
      setMsg(e.message);
      setSuccess("");
    }
  }

  async function resetAllData() {
    if (!confirm("Are you sure you want to completely clear all demo and test data (orders, reports, patients, batches)? This cannot be undone.")) {
      return;
    }
    setResetting(true);
    setMsg("");
    try {
      await api("/admin/reset-data", { method: "POST" });
      setSuccess("All demo and test data has been successfully cleared!");
      reload();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setResetting(false);
    }
  }

  // Group settings by category
  const categories: Record<string, [string, any][]> = {};
  if (data) {
    Object.entries(data).forEach(([key, val]) => {
      const cat = SETTINGS_MAP[key]?.category || "Other System Settings";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push([key, val]);
    });
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">System Settings</h1>
        <p className="mt-1 text-sm text-slate-600">Configure business rules, MyOperator calling credentials, and operational thresholds.</p>
      </div>

      <RequestState loading={!data} error={error} retry={reload} />
      {msg && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{msg}</p>}
      {success && <p role="status" className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm font-medium text-teal-900">{success}</p>}

      {data && Object.entries(categories).map(([category, items]) => (
        <section key={category} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2.5">{category}</h2>
          <div className="divide-y divide-slate-100">
            {items.map(([k, v]) => {
              const meta = SETTINGS_MAP[k] || {
                label: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                description: `Configure ${k}`
              };
              const isBool = typeof v === "boolean";

              return (
                <div key={k} className="py-3.5 flex flex-wrap items-center justify-between gap-4">
                  <div className="max-w-xl">
                    <label htmlFor={`setting-${k}`} className="font-semibold text-sm text-slate-900 cursor-pointer">
                      {meta.label}
                    </label>
                    <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
                    <span className="text-[11px] font-mono text-slate-400">Key: {k}</span>
                  </div>

                  <div className="shrink-0">
                    {isBool ? (
                      <input
                        id={`setting-${k}`}
                        type="checkbox"
                        className="size-5 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                        checked={v}
                        onChange={(e) => set(k, e.target.checked, v)}
                      />
                    ) : (
                      <input
                        id={`setting-${k}`}
                        className="rounded-lg border border-slate-300 p-2 text-sm font-medium text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 min-w-44"
                        defaultValue={v ?? ""}
                        placeholder="Not configured"
                        onBlur={(e) => e.target.value !== String(v ?? "") && set(k, e.target.value, v)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* Admin Maintenance / Clean Data */}
      <section className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5 shadow-sm space-y-3">
        <h2 className="text-base font-bold text-rose-950">Data Reset & Maintenance</h2>
        <p className="text-xs text-rose-800">
          Administrator privilege: Purge all existing demo batches, orders, reports, patients, and calling records from the system for a fresh start.
        </p>
        <button
          type="button"
          disabled={resetting}
          onClick={resetAllData}
          className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-800 transition disabled:opacity-50"
        >
          {resetting ? "Clearing data…" : "Clear All Demo & Test Data"}
        </button>
      </section>
    </div>
  );
}
