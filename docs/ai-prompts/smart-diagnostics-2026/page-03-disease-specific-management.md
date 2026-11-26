# Prompt — Page 3: Disease-Specific Management (programmes 9–17)

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** the page-2 prompt (programme engine `care_programs`, `program_recommendations`, `health_profiles`).
If those do not exist yet, build them first exactly as the page-2 prompt describes.

## Goal
Add the disease-specific management programmes to the same engine, so that an abnormal report produces the
right disease programme. Link each one to CRTracker's existing condition buckets (DIABETES, LIPID, THYROID,
ANAEMIA, VIT_D_B12, KIDNEY, LIVER), and add the missing BONE and HYPERTENSION conditions.

## The programmes, exactly as in the document
(The slide is titled "9–16" but shows 9–17, and lists "Kidney Health Plan" twice, as both 13 and 14. Build
Kidney **once** (doc numbers 13/14). Use codes, not numbers, as keys, because number 17 is also used for
"Women's Health Plan" on page 4.)

| Doc # | Code | Programme | Diagnostic trigger | Personalised offering | Linked bucket |
|---|---|---|---|---|---|
| 9 | DIABETES_MGMT | Diabetes Management Plan | Elevated HbA1c or glucose. | Doctor, dietitian, glucose monitoring and medication adherence. | DIABETES |
| 10 | CARDIAC_RISK_MGMT | Cardiac Risk Management | Lipid abnormalities and cardiovascular risk factors. | Cardiovascular assessment, lifestyle and follow-up. | LIPID |
| 11 | HYPERTENSION_MGMT | Hypertension Management | Elevated BP readings and relevant clinical history. | BP monitoring, consultation and medication refill support. | new: HYPERTENSION (from health profile, not labs) |
| 12 | THYROID_MGMT | Thyroid Management | Abnormal TSH, T3 or T4. | Physician consultation, medication tracking and appropriate retesting. | THYROID |
| 13/14 | KIDNEY_HEALTH | Kidney Health Plan | Abnormal creatinine, eGFR or urine albumin. | Kidney risk assessment, clinician review and monitoring. | KIDNEY |
| 15 | LIVER_HEALTH | Liver Health Plan | Abnormal liver enzymes or other liver-related findings. | Physician evaluation, metabolic assessment and follow-up. | LIVER |
| 16 | ANEMIA_MGMT | Anemia Management | Low hemoglobin, ferritin or abnormal blood indices. | Investigation of cause, nutritional/medical management and retesting. | ANAEMIA |
| 17 | BONE_HEALTH | Bone Health Plan | Vitamin D deficiency, osteoporosis risk or relevant imaging. | Bone health assessment and clinician-directed management. | new: BONE |

## What to build
1. **Programme entries** in `care_programs` (group "Disease-specific management", loop stage CHRONIC_CONDITIONS,
   mode AUTO_SUGGEST). Each has a neutral `caller_label` such as "Doctor follow-up plan". It must not say
   "diabetes", "kidney" or similar; check it with `check_caller_safety`.
2. **Starter triggers** (structured format from page 2; mark each "starter value, clinician to confirm"):
   - DIABETES_MGMT: HBA1C HIGH, or GLU_F / GLU_PP / GLU_R HIGH, or active bucket DIABETES.
   - CARDIAC_RISK_MGMT: any lipid marker abnormal (CHOL, LDL, TG, NON_HDL high; HDL low), **and/or**
     a cardiovascular risk factor: family_history HEART_DISEASE, smoking, BMI ≥ 25, HBA1C HIGH, BP ≥ 140/90.
   - HYPERTENSION_MGMT: the average of the last 2 health-profile BP readings ≥ 140/90 (clinic) or ≥ 135/85 (home),
     or a confirmed condition HYPERTENSION. BP is not a lab value, so this programme only fires once BP has been recorded.
   - THYROID_MGMT: TSH, T3, T4, FT3 or FT4 outside its range.
   - KIDNEY_HEALTH: CREAT HIGH, EGFR LOW, or urine albumin / UACR HIGH. Add the UACR marker and its aliases
     through the existing alias mechanism if it is missing.
   - LIVER_HEALTH: ALT, AST, ALP, GGT or BILI_T HIGH, or ALB LOW, or confirmed condition FATTY_LIVER.
   - ANEMIA_MGMT: HB LOW, FERRITIN LOW, or abnormal indices (MCV, MCH, MCHC, RDW_CV outside range).
   - BONE_HEALTH: VITD LOW together with (age ≥ 50, or gender F with age ≥ 45, or family_history OSTEOPOROSIS),
     or confirmed condition OSTEOPOROSIS / OSTEOPENIA (from imaging such as DEXA). Add an
     `imaging_findings` list to the health profile: [{code, done_on}] with codes OSTEOPENIA,
     OSTEOPOROSIS, FATTY_LIVER_USG, THYROID_NODULE.
3. **New buckets** BONE and HYPERTENSION in the `buckets` RuleSet (new rule version that needs sign-off).
   HYPERTENSION is assigned from the health profile, not from lab values. Do not change how existing
   buckets are assigned.
4. **Programme ↔ bucket link**: when an existing bucket is active on the follow-up, show the matching
   disease programme as the primary suggestion for that bucket.
5. **UI**: in the "Recommended plans" panel, group the disease programmes under the heading
   "Disease-specific management". The patient view shows a row of disease cards (icon, name, trigger,
   offering, status) in the style of the slide. Callers see only the neutral label.
6. **Edge parity**: the same triggers and buckets in `frontend/worker.js`.

## Tests
- A positive and a negative case for every programme, including the BP-only Hypertension case and the Bone
  rule's age/gender branch.
- Kidney exists only once.
- The caller sees no disease words anywhere in API responses for these programmes.
- Bucket assignment for existing buckets is unchanged (regression test against current fixtures).

## Out of scope here
Retest windows (pages 7, 9, 11), care-plan prices (page 17).
