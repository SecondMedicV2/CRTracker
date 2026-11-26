# Prompt — Page 2: Personalized Recommendations After a Diagnostic Report Is Uploaded (plans 1–8)

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.

## Goal
When a diagnostic lab report is uploaded and analysed, CRTracker must recommend the right personalised
plans for the patient. This page defines the **programme recommendation engine** that pages 3, 4 and 5 add
more programmes to, plus the first 8 programmes. It also adds a **health profile**, because several triggers
depend on data that a lab report does not contain (BMI, symptoms, family history, stress, function).

## The 8 programmes, exactly as in the document

| # | Code | Programme | Diagnostic trigger | Personalised offering | Loop stage |
|---|---|---|---|---|---|
| 1 | VITAMIN_PLAN | Vitamin Plan | Low Vitamin D, B12 or other confirmed deficiencies. | Clinician-approved supplementation, reminders and retesting. | PREVENTION |
| 2 | DIET_PLAN | Personalized Diet Plan | HbA1c, lipid abnormalities, obesity-related findings. | Dietitian-designed nutrition plan. | EATING_WELL |
| 3 | PREVENTIVE_PLAN | Preventive Health Plan | Age, family history, risk factors and screening history. | Personalized annual screening schedule. | PREVENTION |
| 4 | WEIGHT_PLAN | Weight Management Plan | BMI, HbA1c, lipids and metabolic risk. | Diet, exercise, doctor review and progress tracking. | EATING_WELL |
| 5 | FITNESS_PLAN | Fitness & Exercise Plan | Metabolic risk, physical limitations and clinical history. | Personalized activity and fitness guidance. | PREVENTION |
| 6 | SLEEP_PLAN | Sleep Improvement Plan | Relevant symptoms, obesity and metabolic risk. | Sleep assessment, sleep hygiene and referral where indicated. | PREVENTION |
| 7 | STRESS_PLAN | Stress & Mental Wellness Plan | Patient-reported stress, symptoms and relevant history. | Mental wellness screening and professional support. | PREVENTION |
| 8 | HEALTHY_AGING_PLAN | Healthy Aging Plan | Age, functional status, nutritional and metabolic findings. | Age-appropriate preventive and functional health program. | PREVENTION |

## What to build

### A. Health profile (non-lab data the triggers need)
- New table `health_profiles` (one per patient; follow `merged_into_id`). Store all clinical content as **one
  encrypted JSON** (`storage.encrypt_str`), with `updated_by` / `updated_at`. Fields:
  - vitals: `height_cm`, `weight_kg`, `bmi` (computed, never typed), `waist_cm`,
    `bp_readings` [{systolic, diastolic, taken_on, where: CLINIC|HOME}]
  - `family_history` codes: DIABETES, HEART_DISEASE, HYPERTENSION, THYROID, KIDNEY, CANCER, OSTEOPOROSIS
  - `symptoms` codes (patient-reported, with date): FATIGUE, POOR_SLEEP, SNORING, DAYTIME_SLEEPINESS,
    HIGH_STRESS, LOW_MOOD, ANXIETY, JOINT_PAIN, BREATHLESSNESS, IRREGULAR_PERIODS, HAIR_LOSS, WEIGHT_GAIN
  - `lifestyle`: activity_level (SEDENTARY|LIGHT|MODERATE|ACTIVE), sleep_hours, smoking, alcohol, diet_type
  - `physical_limitations` codes: NONE, JOINT_PROBLEM, BACK_PROBLEM, HEART_CONDITION, BALANCE_PROBLEM, OTHER
  - `functional_status`: INDEPENDENT | NEEDS_SOME_HELP | DEPENDENT
  - `screening_history` [{screen_code, done_on}]
  - `conditions` [{code, status: SUSPECTED|CONFIRMED, stage, since}]. These are doctor-confirmed only;
    pages 3, 4 and 11 use them.
  Keep all code lists in a RuleSet `profile_codes`, so the clinical team can edit them.
- Endpoints: `GET/PUT /api/patients/{id}/health-profile`, for doctor and admin only (callers get 403).
  Audit every view and edit. Add the table to `privacy.export_patient` and `privacy.erase_patient`.
- UI: a "Health profile" card on the patient view (`frontend/app/(admin)/patients/view/page.tsx`) with a
  compact form and BMI calculated live. It is hidden from callers.

### B. Programme catalogue (`care_programs` RuleSet, versioned, doctor sign-off)
Each programme has: `code`, `doc_number`, `group` ("Wellness" for this page), `clinical_label`,
`caller_label` (neutral, e.g. "Wellness plan follow-up", which must pass `check_caller_safety`),
`trigger_text` and `offering_text` (exact text from the table above), `loop_stage`, `mode`
(`AUTO_SUGGEST` = shown automatically when triggered, `DOCTOR_CONSIDER` = shown only to the doctor as
"consider"), and `trigger` (structured rules below).

Trigger rule format, evaluated deterministically with no AI: `{"any": [...]}` / `{"all": [...]}` of conditions:
- `{"lab": "<marker code>", "flag": "LOW"|"HIGH"|"ABNORMAL"}` or `{"lab": "...", "op": ">=", "value": n}`
- `{"bucket": "<bucket code>"}` (active PatientBucket)
- `{"profile": "<field>", "op": ">=", "value": n}`, `{"profile": "<list field>", "contains": "<code>"}`
- `{"age": ">=", "value": n}`, `{"gender": "M"|"F"}`
- `{"condition": "<code>", "status": "CONFIRMED"}`

Seed these starter triggers, and mark each one "starter value, clinician to confirm":
1. VITAMIN_PLAN: any lab VITD LOW, B12 LOW, FOLATE LOW, FERRITIN LOW, CALCIUM LOW.
2. DIET_PLAN: any HBA1C HIGH, any lipid marker abnormal (CHOL, LDL, HDL low, TG, NON_HDL), or BMI ≥ 25.
3. PREVENTIVE_PLAN: age ≥ 30, or any family_history entry, or no screening_history in the last 12 months.
4. WEIGHT_PLAN: BMI ≥ 25 (obesity cut-off for Asian Indians), or BMI ≥ 23 together with HBA1C HIGH or a lipid abnormality.
5. FITNESS_PLAN: (HBA1C HIGH, lipid abnormal or BMI ≥ 23) together with activity_level SEDENTARY|LIGHT. If
   `physical_limitations` contains anything but NONE, add the note "doctor clearance needed".
6. SLEEP_PLAN: symptoms POOR_SLEEP, SNORING or DAYTIME_SLEEPINESS, or BMI ≥ 30 together with a metabolic abnormality.
7. STRESS_PLAN: symptoms HIGH_STRESS, LOW_MOOD or ANXIETY. Mode `DOCTOR_CONSIDER`.
8. HEALTHY_AGING_PLAN: age ≥ 60, together with a functional_status other than INDEPENDENT, or any nutritional
   (VITD, B12, ALB, HB low) or metabolic abnormality.

### C. Recommendation engine
- New module `backend/app/programs.py` with `evaluate(db, patient_id, report_id) -> list[Match]`. Each match
  has `program_code`, `matched_rules` (rule identifiers only, never values) and `missing_data` (e.g. "BMI not
  recorded", so the doctor knows a trigger could not be checked).
- New table `program_recommendations`: id, patient_id, followup_id (nullable), report_id, program_code,
  rule_version, `status` (SUGGESTED | ACCEPTED | DECLINED | ENROLLED | EXPIRED), reason_codes (JSON),
  decided_by, decided_at, decline_reason_code, created_at. Unique on (report_id, program_code).
- Run `evaluate` at the end of the report pipeline (after `followup.build`), and again whenever the health profile changes.
  It must be idempotent and must not overwrite a doctor's decision.
- Endpoints:
  - `GET /api/patients/{id}/programs`: doctor/admin get the full list; callers get only
    `[{caller_label, status}]`.
  - `POST /api/program-recommendations/{id}/decision` {ACCEPTED | DECLINED, reason_code}: doctor/admin.
  - On ACCEPTED, write a `care_touchpoints` row in the programme's `loop_stage` (source MANUAL).
- UI:
  - Doctor queue and follow-up detail: a "Recommended plans" panel. Each item shows the offering text,
    why it was triggered (the doctor may see values), missing data, and Accept / Decline buttons.
  - Caller card: one neutral line ("Wellness plan follow-up") when anything is SUGGESTED or ACCEPTED.
  - Admin dashboard: counts of suggested / accepted / declined per programme over a date range.
- The flow shown on the slide (Diagnostic lab report → Diagnostic Pipeline → plans 1…8) should appear as a
  horizontal stepper on the patient view, highlighting the programmes that apply.

## Tests (add to `backend/tests/test_programs.py` and `test_security.py`)
- One positive and one negative trigger case for each of the 8 programmes.
- Missing profile data produces `missing_data` and no crash.
- Re-running is idempotent and keeps doctor decisions.
- Callers cannot read the health profile or clinical programme names (403 or filtered fields).
- Audit rows are written without PII.
- Worker parity: the same evaluation results from `frontend/worker.js` for a fixture patient.

## Out of scope here
Disease programmes 9–30 (pages 3–5), care-plan pricing and enrolment (page 17), patient messaging (page 8).
