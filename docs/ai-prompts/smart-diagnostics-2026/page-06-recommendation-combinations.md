# Prompt — Page 6: Most Valuable Recommendation Combinations

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** the page-2 prompt (engine). Pages 3–5 add the programmes this page points to; where a
target programme does not exist yet, store the target as a service code and link it later.

## Goal
For each of the 10 key diagnostic findings, give the patient a ranked set of three recommendations:
**Primary → Secondary → Third**. This page also defines the shared list of **10 diagnostic findings**,
which pages 7, 9, 10 and 12 reuse.

## The table, exactly as in the document

| Finding code | Diagnostic finding | Primary recommendation | Secondary recommendation | Third recommendation |
|---|---|---|---|---|
| LOW_VITD | Low Vitamin D | Vitamin plan | Bone health assessment | Appropriate retesting |
| HIGH_HBA1C | Elevated HbA1c | Diabetes plan | Personalized diet | Medication review/refill if prescribed |
| HIGH_CHOLESTEROL | Elevated cholesterol | Cardiac risk assessment | Diet plan | Lifestyle monitoring |
| HIGH_TSH | Elevated TSH | Thyroid consultation | Medication management if prescribed | Thyroid follow-up |
| LOW_HB | Low hemoglobin | Anemia evaluation | Nutrition assessment | Follow-up diagnostics |
| HIGH_CREATININE | Elevated creatinine | Kidney health consultation | Medication safety review | Renal monitoring |
| ABNORMAL_LFT | Abnormal liver enzymes | Liver health evaluation | Diet/lifestyle assessment | Clinician-directed investigation |
| OBESITY_METABOLIC | Obesity with metabolic abnormalities | Weight management | Dietitian consultation | Medical weight-loss eligibility assessment |
| MULTI_CHRONIC | Multiple chronic conditions | Integrated chronic care | Pharmacy refill management | Home monitoring |
| NORMAL_WITH_RISK | Normal report with risk factors | Preventive health plan | Lifestyle guidance | Future screening schedule |

## What to build

### A. `diagnostic_findings` RuleSet (shared; versioned; doctor sign-off)
Define each finding with the structured trigger format from page 2 (starter values, clinician to confirm):
- LOW_VITD: VITD LOW. HIGH_HBA1C: HBA1C HIGH. HIGH_CHOLESTEROL: CHOL HIGH or LDL HIGH or NON_HDL HIGH.
- HIGH_TSH: TSH HIGH. LOW_HB: HB LOW. HIGH_CREATININE: CREAT HIGH (or EGFR LOW).
- ABNORMAL_LFT: any of ALT, AST, ALP, GGT, BILI_T HIGH.
- OBESITY_METABOLIC: BMI ≥ 25 (health profile) together with any of HIGH_HBA1C, HIGH_CHOLESTEROL, TG HIGH, HDL LOW.
- MULTI_CHRONIC: ≥ 2 active chronic buckets or confirmed conditions.
- NORMAL_WITH_RISK: report classification NORMAL together with any risk factor (age ≥ 40, family_history, BMI ≥ 23,
  smoking, sedentary).
Write one function, `findings.detect(db, patient_id, report_id) -> list[str]`, used everywhere. Store the
detected finding codes on the follow-up (`Followup.finding_codes`, JSON, new column plus migration).

### B. `recommendation_combinations` RuleSet
For each finding: `primary`, `secondary`, `third`, each being {`label` (exact text above),
`caller_label` (neutral), `target` = programme code (e.g. VITAMIN_PLAN, BONE_HEALTH, DIABETES_MGMT,
DIET_PLAN, MED_REVIEW, PHARMACY_REFILL, CARDIAC_RISK_MGMT, THYROID_MGMT, ANEMIA_MGMT,
FOLLOWUP_DIAGNOSTIC, KIDNEY_HEALTH, LIVER_HEALTH, WEIGHT_PLAN, GLP1_WEIGHT_ASSESSMENT, HOME_MONITORING,
PREVENTIVE_PLAN, SENIOR_CARE…) or a service code (RETEST, LIFESTYLE_MONITORING, DIETITIAN_CONSULT,
SPECIALIST_CONSULT, SCREENING_SCHEDULE), and `condition`: ALWAYS | IF_PRESCRIBED | IF_APPROPRIATE}.
`IF_PRESCRIBED` items (e.g. "Medication review/refill if prescribed", "Medication management if prescribed") show only when
the patient has an active medicine of the matching class (page 5). Without page 5, show them with the
hint "only if prescribed — confirm with patient".

### C. Recommendation set per follow-up
- When a follow-up is built, create one **recommendation set** per detected finding: three ranked items
  that are also written into `program_recommendations` (with a `rank` 1/2/3 column and a `finding_code` column).
  If two findings point to the same programme, merge them and keep the higher rank.
- Order findings by severity (existing `severity`/score), so the most important finding's primary comes first.

### D. UI
- Doctor/admin follow-up view: a table laid out exactly like the slide (Finding | Primary | Secondary | Third),
  with an icon per row and per-item status chips (Suggested/Accepted/Declined/Enrolled) and Accept/Decline buttons.
- Caller card: only "Recommended next steps: 3" with neutral labels (e.g. "Doctor consultation", "Diet
  support", "Repeat test"). No finding names. Run the caller labels through `check_caller_safety`.
- Admin Rules screen: edit both RuleSets with sign-off.
- Admin dashboard: for each finding, the share of patients who accepted the primary, secondary and third item
  (the conversion funnel).
- Edge parity in `frontend/worker.js`.

## Tests
- Each of the 10 findings is detected (positive and negative cases).
- The 3 items come out in the right order.
- IF_PRESCRIBED items are hidden without a medicine.
- Merging works when two findings share a target.
- Callers get no finding or programme names.
- RuleSet edits create a new version that needs sign-off.
