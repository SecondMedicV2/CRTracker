"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const DEFAULT_CODES = {
  family_history: ["DIABETES", "HEART_DISEASE", "HYPERTENSION", "THYROID", "KIDNEY", "CANCER", "OSTEOPOROSIS"],
  symptoms: ["FATIGUE", "POOR_SLEEP", "SNORING", "DAYTIME_SLEEPINESS", "HIGH_STRESS", "LOW_MOOD", "ANXIETY", "JOINT_PAIN", "BREATHLESSNESS", "IRREGULAR_PERIODS", "HAIR_LOSS", "WEIGHT_GAIN"],
  activity_levels: ["SEDENTARY", "LIGHT", "MODERATE", "ACTIVE"],
  physical_limitations: ["NONE", "JOINT_PROBLEM", "BACK_PROBLEM", "HEART_CONDITION", "BALANCE_PROBLEM", "OTHER"],
  functional_statuses: ["INDEPENDENT", "NEEDS_SOME_HELP", "DEPENDENT"],
  imaging_findings: ["OSTEOPENIA", "OSTEOPOROSIS", "FATTY_LIVER_USG", "THYROID_NODULE"],
  menstrual_patterns: ["REGULAR", "IRREGULAR", "ABSENT"],
};

export default function HealthProfileCard({ patientId, onSaved }: { patientId: string; onSaved?: () => void }) {
  const { data, error, reload } = useApi<any>(`/patients/${patientId}/health-profile`);
  const codesRule = useApi<any>("/rules/profile_codes");
  const codes = codesRule.data?.data || DEFAULT_CODES;

  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [bpList, setBpList] = useState<any[]>([]);
  const [bpSys, setBpSys] = useState("");
  const [bpDia, setBpDia] = useState("");
  const [bpDate, setBpDate] = useState("");
  const [bpWhere, setBpWhere] = useState("CLINIC");
  const [activity, setActivity] = useState("");
  const [sleepHours, setSleepHours] = useState("");
  const [smoking, setSmoking] = useState(false);
  const [funcStatus, setFuncStatus] = useState("");
  const [familyHistory, setFamilyHistory] = useState<string[]>([]);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [limitations, setLimitations] = useState<string[]>([]);
  const [imaging, setImaging] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [planningPreg, setPlanningPreg] = useState<string>("");
  const [ttcMonths, setTtcMonths] = useState("");
  const [menstrual, setMenstrual] = useState("");
  const [pregnancies, setPregnancies] = useState("");
  const [cgName, setCgName] = useState("");
  const [cgRel, setCgRel] = useState("");
  const [cgPhone, setCgPhone] = useState("");
  const [cgConsent, setCgConsent] = useState(false);
  const [medCount, setMedCount] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    if (!data) return;
    setHeight(data.vitals?.height_cm != null ? String(data.vitals.height_cm) : "");
    setWeight(data.vitals?.weight_kg != null ? String(data.vitals.weight_kg) : "");
    setWaist(data.vitals?.waist_cm != null ? String(data.vitals.waist_cm) : "");
    setBpList(data.vitals?.bp_readings || []);
    setActivity(data.lifestyle?.activity_level || "");
    setSleepHours(data.lifestyle?.sleep_hours != null ? String(data.lifestyle.sleep_hours) : "");
    setSmoking(Boolean(data.lifestyle?.smoking));
    setFuncStatus(data.functional_status || "");
    setFamilyHistory(data.family_history || []);
    setSymptoms((data.symptoms || []).map((s: any) => (typeof s === "string" ? s : s.code)));
    setLimitations(data.physical_limitations || []);
    setImaging((data.imaging_findings || []).map((i: any) => i.code));
    setConditions((data.conditions || []).map((c: any) => c.code));
    const pp = data.reproductive?.planning_pregnancy;
    setPlanningPreg(pp === true ? "yes" : pp === false ? "no" : "");
    setTtcMonths(data.reproductive?.trying_to_conceive_months != null ? String(data.reproductive.trying_to_conceive_months) : "");
    setMenstrual(data.reproductive?.menstrual_pattern || "");
    setPregnancies(data.reproductive?.pregnancies != null ? String(data.reproductive.pregnancies) : "");
    setCgName(data.caregiver?.name || "");
    setCgRel(data.caregiver?.relationship || "");
    setCgPhone(data.caregiver?.phone || "");
    setCgConsent(Boolean(data.caregiver?.phone_consent));
    setMedCount(data.medicine_count != null ? String(data.medicine_count) : "");
  }, [data]);

  const hNum = Number(height);
  const wNum = Number(weight);
  const liveBmi = hNum > 0 && wNum > 0 ? (wNum / ((hNum / 100) ** 2)).toFixed(1) : "—";

  const toggle = (list: string[], setList: (v: string[]) => void, code: string) => {
    setList(list.includes(code) ? list.filter((x) => x !== code) : [...list, code]);
  };

  function addBp() {
    if (!bpSys || !bpDia) return;
    setBpList([...bpList, { systolic: Number(bpSys), diastolic: Number(bpDia), taken_on: bpDate || new Date().toISOString().slice(0, 10), where: bpWhere }]);
    setBpSys("");
    setBpDia("");
    setBpDate("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    setStatusMsg("");
    try {
      await api(`/patients/${patientId}/health-profile`, {
        method: "PUT",
        body: {
          vitals: {
            height_cm: height ? Number(height) : null,
            weight_kg: weight ? Number(weight) : null,
            waist_cm: waist ? Number(waist) : null,
            bp_readings: bpList,
          },
          lifestyle: {
            activity_level: activity,
            sleep_hours: sleepHours ? Number(sleepHours) : null,
            smoking,
          },
          functional_status: funcStatus,
          family_history: familyHistory,
          symptoms: symptoms.map((code) => ({ code, date: new Date().toISOString().slice(0, 10) })),
          physical_limitations: limitations,
          imaging_findings: imaging.map((code) => ({ code, done_on: "" })),
          reproductive: {
            planning_pregnancy: planningPreg === "yes" ? true : planningPreg === "no" ? false : null,
            trying_to_conceive_months: ttcMonths !== "" ? Number(ttcMonths) : null,
            menstrual_pattern: menstrual,
            pregnancies: pregnancies !== "" ? Number(pregnancies) : null,
          },
          caregiver: {
            name: cgName,
            relationship: cgRel,
            phone: cgPhone,
            phone_consent: cgConsent,
          },
          medicine_count: medCount !== "" ? Number(medCount) : null,
        },
      });
      setStatusMsg("Health profile saved and programmes re-evaluated.");
      reload();
      onSaved?.();
    } catch (err: any) {
      setMsg(err.message || "Could not save health profile");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>;
  if (!data) return <p role="status" className="text-sm text-slate-500">Loading health profile…</p>;

  return (
    <section aria-labelledby="health-profile-heading" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="health-profile-heading" className="text-lg font-semibold text-slate-900">Health profile (encrypted)</h2>
        <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800">Live BMI: {liveBmi}</span>
      </div>

      <form onSubmit={save} className="space-y-4 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label><span className="block text-xs text-slate-600">Height (cm)</span><input type="number" step="0.1" className="mt-1 w-full rounded border p-1.5" value={height} onChange={(e) => setHeight(e.target.value)} /></label>
          <label><span className="block text-xs text-slate-600">Weight (kg)</span><input type="number" step="0.1" className="mt-1 w-full rounded border p-1.5" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
          <label><span className="block text-xs text-slate-600">Waist (cm)</span><input type="number" step="0.1" className="mt-1 w-full rounded border p-1.5" value={waist} onChange={(e) => setWaist(e.target.value)} /></label>
          <label><span className="block text-xs text-slate-600">Activity</span>
            <select className="mt-1 w-full rounded border p-1.5" value={activity} onChange={(e) => setActivity(e.target.value)}>
              <option value="">Unset</option>
              {(codes.activity_levels || []).map((a: string) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label><span className="block text-xs text-slate-600">Functional status</span>
            <select className="mt-1 w-full rounded border p-1.5" value={funcStatus} onChange={(e) => setFuncStatus(e.target.value)}>
              <option value="">Unset</option>
              {(codes.functional_statuses || []).map((f: string) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label><span className="block text-xs text-slate-600">Medicines count</span><input type="number" min={0} className="mt-1 w-full rounded border p-1.5" value={medCount} onChange={(e) => setMedCount(e.target.value)} /></label>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={smoking} onChange={(e) => setSmoking(e.target.checked)} /> Smoker</label>
          <label className="flex items-center gap-2 text-xs">Sleep (hrs)<input type="number" step="0.5" className="w-20 rounded border p-1" value={sleepHours} onChange={(e) => setSleepHours(e.target.value)} /></label>
        </div>

        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold text-slate-700">BP readings ({bpList.length})</div>
          {bpList.length > 0 && (
            <ul className="flex flex-wrap gap-2 text-xs">
              {bpList.map((b, i) => (
                <li key={i} className="rounded border bg-white px-2 py-1">
                  {b.systolic}/{b.diastolic} ({b.where}{b.taken_on ? `, ${b.taken_on}` : ""})
                  <button type="button" className="ml-2 text-red-600" onClick={() => setBpList(bpList.filter((_, j) => j !== i))}>×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <input type="number" placeholder="Sys" aria-label="Systolic BP" className="w-20 rounded border bg-white p-1 text-xs" value={bpSys} onChange={(e) => setBpSys(e.target.value)} />
            <input type="number" placeholder="Dia" aria-label="Diastolic BP" className="w-20 rounded border bg-white p-1 text-xs" value={bpDia} onChange={(e) => setBpDia(e.target.value)} />
            <select aria-label="BP setting" className="rounded border bg-white p-1 text-xs" value={bpWhere} onChange={(e) => setBpWhere(e.target.value)}>
              <option value="CLINIC">CLINIC</option><option value="HOME">HOME</option>
            </select>
            <input type="date" aria-label="BP date" className="rounded border bg-white p-1 text-xs" value={bpDate} onChange={(e) => setBpDate(e.target.value)} />
            <button type="button" onClick={addBp} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium">Add BP</button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-700">Family history</div>
            <div className="flex flex-wrap gap-2 text-xs">
              {(codes.family_history || []).map((c: string) => (
                <label key={c} className="flex items-center gap-1"><input type="checkbox" checked={familyHistory.includes(c)} onChange={() => toggle(familyHistory, setFamilyHistory, c)} />{c}</label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-700">Physical limitations & imaging</div>
            <div className="flex flex-wrap gap-2 text-xs">
              {(codes.physical_limitations || []).map((c: string) => (
                <label key={c} className="flex items-center gap-1"><input type="checkbox" checked={limitations.includes(c)} onChange={() => toggle(limitations, setLimitations, c)} />{c}</label>
              ))}
              {(codes.imaging_findings || []).map((c: string) => (
                <label key={c} className="flex items-center gap-1 text-teal-900"><input type="checkbox" checked={imaging.includes(c)} onChange={() => toggle(imaging, setImaging, c)} />{c}</label>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold text-slate-700">Symptoms</div>
          <div className="flex flex-wrap gap-2 text-xs">
            {(codes.symptoms || []).map((c: string) => (
              <label key={c} className="flex items-center gap-1"><input type="checkbox" checked={symptoms.includes(c)} onChange={() => toggle(symptoms, setSymptoms, c)} />{c}</label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Confirmed conditions:</span>
          {conditions.length > 0
            ? conditions.map((c) => <span key={c} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-800">{c}</span>)
            : <span>None</span>}
          <span className="text-[11px] text-slate-500">(Managed by a doctor in Conditions &amp; monitoring above)</span>
        </div>

        <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-800">Reproductive history & caregiver contact</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label><span className="block text-xs text-slate-600">Planning pregnancy</span>
              <select className="mt-1 w-full rounded border p-1.5 text-xs" value={planningPreg} onChange={(e) => setPlanningPreg(e.target.value)}>
                <option value="">Unset</option><option value="yes">Yes</option><option value="no">No</option>
              </select>
            </label>
            <label><span className="block text-xs text-slate-600">Trying (months)</span><input type="number" min={0} className="mt-1 w-full rounded border p-1.5 text-xs" value={ttcMonths} onChange={(e) => setTtcMonths(e.target.value)} /></label>
            <label><span className="block text-xs text-slate-600">Menstrual pattern</span>
              <select className="mt-1 w-full rounded border p-1.5 text-xs" value={menstrual} onChange={(e) => setMenstrual(e.target.value)}>
                <option value="">Unset</option>
                {(codes.menstrual_patterns || []).map((m: string) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label><span className="block text-xs text-slate-600">Pregnancies</span><input type="number" min={0} className="mt-1 w-full rounded border p-1.5 text-xs" value={pregnancies} onChange={(e) => setPregnancies(e.target.value)} /></label>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label><span className="block text-xs text-slate-600">Caregiver name</span><input className="mt-1 w-full rounded border p-1.5 text-xs" value={cgName} onChange={(e) => setCgName(e.target.value)} /></label>
            <label><span className="block text-xs text-slate-600">Relationship</span><input className="mt-1 w-full rounded border p-1.5 text-xs" value={cgRel} onChange={(e) => setCgRel(e.target.value)} /></label>
            <div>
              <label><span className="block text-xs text-slate-600">Caregiver phone (encrypted)</span><input className="mt-1 w-full rounded border p-1.5 text-xs" value={cgPhone} onChange={(e) => setCgPhone(e.target.value)} /></label>
              <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600"><input type="checkbox" checked={cgConsent} onChange={(e) => setCgConsent(e.target.checked)} /> Consent recorded for caregiver phone</label>
            </div>
          </div>
        </details>

        {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
        {statusMsg && <p role="status" className="text-sm text-teal-800">{statusMsg}</p>}
        <button type="submit" disabled={saving} className="rounded-lg bg-teal-800 px-4 py-2 font-medium text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save health profile"}
        </button>
      </form>
    </section>
  );
}
