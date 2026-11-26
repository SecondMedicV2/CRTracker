# Prompt — Page 5: Extended Clinical Programs & Family Care (programmes 23–30)

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** the page-2 prompt (engine and health profile). It works better with pages 3 and 4 built.

## Goal
Add the three remaining programme groups: **Medication & Treatment Support (23–26)**, **Diagnostic & Specialist
Recommendations (27–29)** and **Family & Longitudinal Healthcare (30)**. They need four capabilities that
CRTracker does not have yet: a medicine list, refill schedules, specialist referrals and home readings,
plus family links.

## The programmes, exactly as in the document

| Doc # | Group | Code | Programme | Diagnostic trigger | Personalised offering |
|---|---|---|---|---|---|
| 23 | Medication & treatment support | MED_REVIEW | Medication Review Plan | Existing prescriptions, relevant lab abnormalities. | Pharmacist/doctor review of medication safety. |
| 24 | Medication & treatment support | PHARMACY_REFILL | Monthly Pharmacy Refill Plan | Active chronic medication prescriptions. | Automated refill reminders and home delivery. |
| 25 | Medication & treatment support | DRUG_NUTRIENT_REVIEW | Drug–Nutrient Interaction Review | Medication list plus nutritional findings. | Clinician/pharmacist assessment of potential interactions. |
| 26 | Medication & treatment support | TREATMENT_RESPONSE | Treatment Response Monitoring | Serial reports and active treatment plan. | Biomarker trend analysis and scheduled clinical follow-up. |
| 27 | Diagnostic & specialist | FOLLOWUP_DIAGNOSTIC | Follow-up Diagnostic Plan | Abnormal, borderline or changing results. | Appropriate confirmatory tests and retesting. |
| 28 | Diagnostic & specialist | SPECIALIST_CONSULT | Specialist Consultation Plan | Findings requiring further clinical evaluation. | Relevant specialist appointment. |
| 29 | Diagnostic & specialist | HOME_MONITORING | Home Health Monitoring Plan | Diabetes, hypertension or other monitoring needs. | Connected devices, home visits and digital tracking. |
| 30 | Family & longitudinal | FAMILY_PREVENTIVE | Family Preventive Health Plan | Family history, age and individual risk factors. | Consent-based family screening and prevention plans. |

## What to build

### A. Medicine list (needed by 23, 24, 25, 26)
- `medicine_catalogue` RuleSet: {code, generic_name, drug_class, is_chronic, default_refill_days}. Seed a
  small starter list for the chronic classes CRTracker deals with (metformin, other oral antidiabetics,
  insulin, statins, levothyroxine, antihypertensive classes, iron, vitamin D, B12), marked "clinician to confirm".
- `patient_medications` table (encrypted details): patient_id, medicine_code, dose_text (encrypted),
  started_on, last_changed_on, stopped_on, prescribed_by (free text, encrypted), source (DOCTOR | PATIENT_REPORTED).
  Doctor/admin only. **Callers and caller cards must never see medicine names.** Add the table to privacy export/erase.
- Changing a dose sets `last_changed_on`. Pages 7 and 11 use this as the "treatment start/change" anchor date.

### B. Refills (24)
- `refill_schedules`: patient_medication_id, refill_every_days, next_refill_on, delivery_mode (HOME_DELIVERY |
  PICKUP_AT_HUB), status. A daily job (`backend/app/worker.py` and the Worker `scheduled()`) creates a
  **caller task** 3 days before `next_refill_on`. The caller sees only "Pharmacy refill reminder call",
  never the drug. When the refill is confirmed, `next_refill_on` moves forward and an `amount_inr` touchpoint is
  recorded in MEDICATIONS. Home delivery is recorded as a reference number only (the pharmacy system is external).

### C. Drug–nutrient interactions (25)
- `drug_nutrient_rules` RuleSet: {drug_class, nutrient_marker, direction, note}. Seed only well-established
  starter examples (e.g. metformin with low B12, PPIs with low B12/magnesium), marked "pharmacist/clinician to
  confirm". When a patient's medicine list matches a rule and the report shows that nutrient abnormal, suggest
  DRUG_NUTRIENT_REVIEW and show the matched note to the doctor only.

### D. Treatment response (26) and follow-up diagnostics (27)
- TREATMENT_RESPONSE: ≥ 2 reports with the same marker and an active medicine linked to that marker's class.
  Show the trend chart from `trends.py`, and schedule a clinical follow-up date (`Followup.next_followup_on`).
- FOLLOWUP_DIAGNOSTIC: any abnormal marker, a "borderline" value (within 5 % of a range limit, starter value), or
  a change of more than 10 % from the previous report (starter value). Pre-fill a `RetestRecommendation` with
  confirmatory tests from `test_catalogue`.

### E. Specialist referrals (28)
- `referrals` table: patient_id, followup_id, specialty (catalogue: Cardiology, Endocrinology,
  Nephrology, Gastroenterology/Hepatology, Gynecology, Orthopaedics, Neurology, Psychiatry/Psychology,
  Geriatrics, Urology), reason_code, urgency (ROUTINE | SOON | URGENT), status (SUGGESTED | BOOKED | DONE | DECLINED),
  appointment_ref, created_by. The doctor creates it. The caller can see "Specialist appointment to book"
  plus a date, with no specialty name if that reveals the condition (map each specialty to a neutral caller label).

### F. Home monitoring (29)
- `home_readings`: patient_id, kind (BP | GLUCOSE_FASTING | GLUCOSE_RANDOM | WEIGHT | SPO2), values, taken_at,
  source (MANUAL_STAFF | CSV_IMPORT | DEVICE), entered_by. Staff entry form plus CSV import (5 MB limit, formula-safe).
  Show charts on the patient view, with alerts to the doctor when readings cross starter thresholds.
- `HOME_MONITORING` triggers when DIABETES or HYPERTENSION is active, or the doctor requests it. Connected-device
  integration is a later phase: define a provider interface `DeviceProvider` only, with no vendor.
- Home visits: a `home_visits` table (patient, purpose code, scheduled_on, status, staff).

### G. Family preventive plan (30)
- Use the existing `Patient.household_tag` to link family members. Add a `family_links` table (patient_id,
  related_patient_id, relationship, consent_id). **Consent is per member**: no data about one member is shown
  on another member's record without that member's recorded consent.
- Trigger: a family_history entry, or another linked member with a confirmed chronic condition, together with
  age/risk factors. Offering: suggest a screening plan for each consenting member.

### H. Programme entries and UI
- Add all 8 to `care_programs`, with the group headings exactly as above and neutral caller labels.
- Patient view tabs for doctor/admin: Medicines, Refills, Referrals, Home readings, Family.
- The doctor screen shows programmes 23–30 in their three groups, matching the slide.
- Full parity in `frontend/worker.js` (KV storage for the new tables).

## Tests
- Triggers for all 8 programmes.
- The refill job creates tasks on the right day (IST).
- Drug names never appear in caller responses or audit details.
- Family data is not visible without the member's consent.
- CSV import rejects files over 5 MB and escapes formulas on export.
- Every new route is in the RBAC matrix.

## Out of scope here
A real pharmacy or e-prescription integration, connected-device vendor SDKs, payments.
