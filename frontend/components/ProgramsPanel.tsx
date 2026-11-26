"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const WELLNESS_CODES = [
  "VITAMIN_PLAN", "DIET_PLAN", "PREVENTIVE_PLAN", "WEIGHT_PLAN",
  "FITNESS_PLAN", "SLEEP_PLAN", "STRESS_PLAN", "HEALTHY_AGING_PLAN",
];

const DISEASE_CARDS = [
  { code: "DIABETES_MGMT", icon: "🩸", name: "Diabetes Management Plan", trigger: "Elevated HbA1c or glucose.", offering: "Doctor, dietitian, glucose monitoring and medication adherence." },
  { code: "CARDIAC_RISK_MGMT", icon: "❤️", name: "Cardiac Risk Management", trigger: "Lipid abnormalities and cardiovascular risk factors.", offering: "Cardiovascular assessment, lifestyle and follow-up." },
  { code: "HYPERTENSION_MGMT", icon: "🩺", name: "Hypertension Management", trigger: "Elevated BP readings and relevant clinical history.", offering: "BP monitoring, consultation and medication refill support." },
  { code: "THYROID_MGMT", icon: "🦋", name: "Thyroid Management", trigger: "Abnormal TSH, T3 or T4.", offering: "Physician consultation, medication tracking and appropriate retesting." },
  { code: "KIDNEY_HEALTH", icon: "🫘", name: "Kidney Health Plan", trigger: "Abnormal creatinine, eGFR or urine albumin.", offering: "Kidney risk assessment, clinician review and monitoring." },
  { code: "LIVER_HEALTH", icon: "🫀", name: "Liver Health Plan", trigger: "Abnormal liver enzymes or other liver-related findings.", offering: "Physician evaluation, metabolic assessment and follow-up." },
  { code: "ANEMIA_MGMT", icon: "🧬", name: "Anemia Management", trigger: "Low hemoglobin, ferritin or abnormal blood indices.", offering: "Investigation of cause, nutritional/medical management and retesting." },
  { code: "BONE_HEALTH", icon: "🦴", name: "Bone Health Plan", trigger: "Vitamin D deficiency, osteoporosis risk or relevant imaging.", offering: "Bone health assessment and clinician-directed management." },
];

const SPECIALIZED_CARDS = [
  { code: "WOMENS_HEALTH", icon: "🌸", name: "Women's Health Plan", trigger: "Anemia, thyroid abnormalities, age and relevant symptoms.", offering: "Gynecology, nutrition and preventive screening." },
  { code: "PCOS_MGMT", icon: "⚖️", name: "PCOS Management Plan", trigger: "Relevant metabolic findings plus clinical symptoms.", offering: "Gynecology/endocrinology review, diet and lifestyle program." },
  { code: "MENS_HEALTH", icon: "🛡️", name: "Men's Health Plan", trigger: "Age, metabolic markers and clinical history.", offering: "Cardiometabolic, sexual and preventive health assessment." },
  { code: "FERTILITY_PRECONCEPTION", icon: "🌱", name: "Fertility & Preconception Plan", trigger: "Relevant reproductive investigations and medical history.", offering: "Specialist consultation, nutritional assessment and follow-up." },
  { code: "SENIOR_CARE", icon: "🤝", name: "Senior Citizen Care Plan", trigger: "Age, comorbidities, medication burden and functional needs.", offering: "Elder care, home visits and caregiver support." },
  { code: "GLP1_WEIGHT_ASSESSMENT", icon: "📋", name: "GLP-1 / Medical Weight-Loss Assessment", trigger: "Obesity-related clinical criteria and metabolic risk.", offering: "Physician-led eligibility assessment (eligibility is decided by a physician in person), treatment monitoring and nutrition support." },
];

const EXTENDED_CARDS = [
  { code: "MED_REVIEW", icon: "💊", name: "Medication Review Plan", trigger: "Existing prescriptions, relevant lab abnormalities.", offering: "Pharmacist/doctor review of medication safety." },
  { code: "PHARMACY_REFILL", icon: "📦", name: "Monthly Pharmacy Refill Plan", trigger: "Active chronic medication prescriptions.", offering: "Automated refill reminders and home delivery." },
  { code: "DRUG_NUTRIENT_REVIEW", icon: "🧪", name: "Drug-Nutrient Interaction Review", trigger: "Medication list plus nutritional findings.", offering: "Clinician/pharmacist assessment of potential interactions." },
  { code: "TREATMENT_RESPONSE", icon: "📈", name: "Treatment Response Monitoring", trigger: "Serial reports and active treatment plan.", offering: "Biomarker trend analysis and scheduled clinical follow-up." },
  { code: "FOLLOWUP_DIAGNOSTIC", icon: "🔬", name: "Follow-up Diagnostic Plan", trigger: "Abnormal, borderline or changing results.", offering: "Appropriate confirmatory tests and retesting." },
  { code: "SPECIALIST_CONSULT", icon: "👨‍⚕️", name: "Specialist Consultation Plan", trigger: "Findings requiring further clinical evaluation.", offering: "Relevant specialist appointment." },
  { code: "HOME_MONITORING", icon: "🏠", name: "Home Health Monitoring Plan", trigger: "Diabetes, hypertension or other monitoring needs.", offering: "Connected devices, home visits and digital tracking." },
  { code: "FAMILY_PREVENTIVE", icon: "👪", name: "Family Preventive Health Plan", trigger: "Family history, age and individual risk factors.", offering: "Consent-based family screening and prevention plans." },
];

const DECLINE_REASONS = [
  "CLINICALLY_NOT_INDICATED", "PATIENT_DECLINED", "ALREADY_MANAGED", "CONTRAINDICATED", "OTHER",
];

const BADGE: Record<string, string> = {
  SUGGESTED: "bg-amber-100 text-amber-900",
  ACCEPTED: "bg-emerald-100 text-emerald-900",
  DECLINED: "bg-slate-200 text-slate-700",
  DISCUSS_LATER: "bg-sky-100 text-sky-900",
  EXPIRED: "bg-slate-100 text-slate-500",
};

export default function ProgramsPanel({
  patientId,
  mode = "followup",
  refreshKey = 0,
  onChanged,
}: {
  patientId: string;
  mode?: "patient" | "followup";
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const { data, error, reload } = useApi<any[]>(`/patients/${patientId}/programs?r=${refreshKey}`);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");

  async function decide(id: number, decision: "ACCEPTED" | "DECLINED" | "DISCUSS_LATER", needsReason = false) {
    setMsg("");
    setNote("");
    const reason_code = reasons[id] || (needsReason ? "" : "CLINICALLY_NOT_INDICATED");
    if (decision === "DECLINED" && needsReason && !reason_code) {
      setMsg("Select a reason before marking a consider item as not suitable.");
      return;
    }
    try {
      const res = await api<any>(`/program-recommendations/${id}/decision`, {
        method: "POST",
        body: { decision, reason_code },
      });
      if (res.suggested_specialty) setNote(`Accepted — suggested referral: ${res.suggested_specialty}`);
      reload();
      onChanged?.();
    } catch (err: any) {
      setMsg(err.message || "Could not update recommendation");
    }
  }

  if (error) return <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>;
  if (!data) return <p role="status" className="text-sm text-slate-500">Loading programmes…</p>;

  const byCode = Object.fromEntries(data.map((r) => [r.program_code, r]));
  const autoItems = data.filter((r) => r.mode !== "DOCTOR_CONSIDER" && r.status !== "EXPIRED");
  const considerItems = data.filter((r) => r.mode === "DOCTOR_CONSIDER" && r.status !== "EXPIRED");
  const wellness = autoItems.filter((r) => r.group === "Wellness");
  const disease = autoItems.filter((r) => r.group === "Disease-specific management");
  const medSupport = autoItems.filter((r) => r.group === "Medication & treatment support");
  const diagSpec = autoItems.filter((r) => r.group === "Diagnostic & specialist");
  const famLong = autoItems.filter((r) => r.group === "Family & longitudinal");

  const renderRow = (r: any, isConsider: boolean) => (
    <div key={r.id} className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-slate-900">
          {r.clinical_label}
          {r.is_primary_for_bucket && <span className="ml-2 rounded bg-teal-100 px-2 py-0.5 text-[11px] text-teal-900">Primary ({r.linked_bucket})</span>}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[r.status] || "bg-slate-100"}`}>{r.status}</span>
      </div>
      <p className="text-xs text-slate-700">{r.offering_text}</p>
      {r.matched_rules?.length > 0 && <div className="text-[11px] text-slate-500">Matched: {r.matched_rules.join(", ")}</div>}
      {r.missing_data?.length > 0 && <div className="text-[11px] text-amber-800">Missing data: {r.missing_data.join(", ")}</div>}
      {r.notes?.length > 0 && <div className="text-[11px] font-semibold text-rose-700">Note: {r.notes.join("; ")}</div>}
      {r.specialty && <div className="text-[11px] text-slate-600">Suggested specialty: {r.specialty}</div>}
      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
        <button type="button" onClick={() => decide(r.id, "ACCEPTED")} className="rounded bg-teal-800 px-2.5 py-1 font-medium text-white">
          {isConsider ? "Accept and refer" : "Accept"}
        </button>
        {isConsider && (
          <select aria-label={`Reason for ${r.clinical_label}`} className="rounded border p-1" value={reasons[r.id] || ""} onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })}>
            <option value="">Reason if not suitable…</option>
            {DECLINE_REASONS.map((rc) => <option key={rc} value={rc}>{rc}</option>)}
          </select>
        )}
        <button type="button" onClick={() => decide(r.id, "DECLINED", isConsider)} className="rounded border border-slate-300 px-2.5 py-1 font-medium">
          {isConsider ? "Not suitable" : "Decline"}
        </button>
        {isConsider && (
          <button type="button" onClick={() => decide(r.id, "DISCUSS_LATER")} className="rounded border border-slate-300 px-2.5 py-1">
            Discuss later
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {msg && <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{msg}</p>}
      {note && <p role="status" className="rounded border border-teal-200 bg-teal-50 p-2 text-sm text-teal-900">{note}</p>}

      {mode === "patient" && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Diagnostic pipeline → Wellness plans (1–8)</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-slate-100 px-2 py-1 font-medium">Lab report</span>
            <span>→</span>
            <span className="rounded bg-slate-100 px-2 py-1 font-medium">Diagnostic Pipeline</span>
            <span>→</span>
            {WELLNESS_CODES.map((c, idx) => {
              const hit = byCode[c] && byCode[c].status !== "EXPIRED";
              return (
                <span key={c} className={`rounded border px-2 py-1 font-medium ${hit ? "border-teal-500 bg-teal-50 text-teal-900" : "border-slate-200 text-slate-400"}`}>
                  {idx + 1}. {c.replace(/_PLAN$/, "").replace(/_/g, " ")}
                </span>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Recommended plans</h2>
        {!autoItems.length && <p className="text-xs text-slate-500">No automatic plans triggered yet.</p>}
        {wellness.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">Wellness</h3>
            <div className="grid gap-3 md:grid-cols-2">{wellness.map((r) => renderRow(r, false))}</div>
          </div>
        )}
        {disease.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">Disease-specific management</h3>
            <div className="grid gap-3 md:grid-cols-2">{disease.map((r) => renderRow(r, false))}</div>
          </div>
        )}
        {medSupport.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">Medication &amp; treatment support</h3>
            <div className="grid gap-3 md:grid-cols-2">{medSupport.map((r) => renderRow(r, false))}</div>
          </div>
        )}
        {diagSpec.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">Diagnostic &amp; specialist</h3>
            <div className="grid gap-3 md:grid-cols-2">{diagSpec.map((r) => renderRow(r, false))}</div>
          </div>
        )}
        {famLong.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">Family &amp; longitudinal</h3>
            <div className="grid gap-3 md:grid-cols-2">{famLong.map((r) => renderRow(r, false))}</div>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Consider (doctor assessment)</h2>
        {!considerItems.length ? (
          <p className="text-xs text-slate-600">No consider items triggered for this patient.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">{considerItems.map((r) => renderRow(r, true))}</div>
        )}
      </section>

      {mode === "patient" && (
        <>
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Disease-specific management catalogue (9–17)</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {DISEASE_CARDS.map((c) => {
                const rec = byCode[c.code];
                return (
                  <article key={c.code} className={`rounded-lg border p-3 text-xs ${rec ? "border-teal-400 bg-teal-50/40" : "border-slate-200 bg-slate-50/60"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{c.icon} {c.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE[rec?.status] || "bg-slate-200 text-slate-600"}`}>{rec?.status || "NOT TRIGGERED"}</span>
                    </div>
                    <p className="mt-1 text-slate-600"><b>Trigger:</b> {c.trigger}</p>
                    <p className="mt-1 text-slate-700"><b>Offering:</b> {c.offering}</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Specialized clinical programs (17–22)</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SPECIALIZED_CARDS.map((c) => {
                const rec = byCode[c.code];
                return (
                  <article key={c.code} className={`rounded-lg border p-3 text-xs ${rec ? "border-amber-400 bg-amber-50/40" : "border-slate-200 bg-slate-50/60"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{c.icon} {c.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE[rec?.status] || "bg-slate-200 text-slate-600"}`}>{rec?.status || "NOT TRIGGERED"}</span>
                    </div>
                    <p className="mt-1 text-slate-600"><b>Trigger:</b> {c.trigger}</p>
                    <p className="mt-1 text-slate-700"><b>Offering:</b> {c.offering}</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Extended clinical &amp; family programs (23–30)</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {EXTENDED_CARDS.map((c) => {
                const rec = byCode[c.code];
                return (
                  <article key={c.code} className={`rounded-lg border p-3 text-xs ${rec ? "border-teal-400 bg-teal-50/40" : "border-slate-200 bg-slate-50/60"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{c.icon} {c.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE[rec?.status] || "bg-slate-200 text-slate-600"}`}>{rec?.status || "NOT TRIGGERED"}</span>
                    </div>
                    <p className="mt-1 text-slate-600"><b>Trigger:</b> {c.trigger}</p>
                    <p className="mt-1 text-slate-700"><b>Offering:</b> {c.offering}</p>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
