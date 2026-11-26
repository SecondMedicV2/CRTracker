# Prompt — Page 11: Additional Retesting Protocols Worth Adding

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** page 7 (`retest_protocols` engine), page 9 (tiers) and the page-2 health profile (`conditions`).

## Goal
Add protocols that depend on the patient's **condition and its stage**, not just on a single abnormal value.
For example, the same HbA1c needs a different retest interval for prediabetes, stable diabetes or uncontrolled
diabetes. One report cannot tell these apart, so the doctor confirms the condition and its stage, and the
protocol follows from that.

## The table, exactly as in the document

| Code | Condition | Typical monitoring timeframe | Icon |
|---|---|---|---|
| B12_DEFICIENCY | Vitamin B12 deficiency | CBC response may be checked within 1–2 weeks when indicated; repeat B12 is not routinely necessary after treatment | red cell + tick |
| IRON_DEFICIENCY | Iron deficiency | Hb/CBC in 2–4 weeks; iron stores assessed later when appropriate | blood tube "Fe" |
| PREDIABETES | Prediabetes | Usually annual glycemic testing; earlier based on risk | calendar |
| DIABETES_STABLE | Stable diabetes | HbA1c approximately every 6 months when at goal | "6" clock HbA1c |
| DIABETES_UNCONTROLLED | Uncontrolled diabetes | HbA1c approximately every 3 months | "3" clock HbA1c with alert |
| HYPOTHYROID_STABLE_TREATED | Stable hypothyroidism on treatment | TSH generally every 6–12 months | thyroid |
| HYPERTENSION | Hypertension | Home BP monitoring over days to weeks; laboratory testing depends on medications and comorbidities | BP monitor |
| CKD | Chronic kidney disease | eGFR and urine albumin monitoring at least annually, more frequently with higher risk | kidney |
| DYSLIPIDEMIA_NEW_MED | Dyslipidemia after medication initiation | Lipid profile in 4–12 weeks | 3 tubes |
| DYSLIPIDEMIA_STABLE | Stable dyslipidemia | Lipid monitoring approximately every 3–12 months when indicated | lipid cycle + clock |

The slide has an empty "Note (if any)" column. Keep a `note` field per protocol for the clinical team.

## What to build

### A. Condition register
- Use `health_profiles.conditions` [{code, status SUSPECTED|CONFIRMED, stage, since, confirmed_by}], with the
  10 codes above in the `profile_codes` RuleSet. Each condition has its own UI with a stage picker (e.g. Diabetes →
  Prediabetes / Stable at goal / Uncontrolled).
- **Suggest, don't decide**: from labs and history, suggest a condition for the doctor to confirm. Starter rules,
  clinician to confirm:
  - HbA1c 5.7–6.4 % → PREDIABETES
  - HbA1c ≥ 6.5 % or a known diabetic → DIABETES (stable if at target from page 10, uncontrolled if above target on 2 consecutive results)
  - TSH abnormal while on levothyroxine (page 5 medicine) → HYPOTHYROID on treatment, stable if TSH is in range
  - eGFR < 60 or UACR high on 2 results ≥ 90 days apart → CKD
  - a lipid medicine started within the last 12 weeks → DYSLIPIDEMIA_NEW_MED, otherwise DYSLIPIDEMIA_STABLE
  - low B12 → B12_DEFICIENCY; low ferritin or iron with low Hb → IRON_DEFICIENCY
  - BP from the health profile ≥ 140/90 → HYPERTENSION
  Confirming, changing the stage or removing a condition is doctor-only and audited (codes only, no values).

### B. Condition protocols
- Add these 10 to `retest_protocols` as condition-based entries: `timeframe_text` (exact), structured windows
  (B12 CBC 7–14 days `when_indicated`; B12 repeat `routine: false`; iron Hb/CBC 14–28 days then iron stores
  `doctor_decides`; prediabetes 365 days or earlier by risk; stable diabetes 180 days; uncontrolled 90 days; stable
  hypothyroid 180–365 days; CKD ≤ 365 days, `risk_adjusted`; dyslipidemia new medicine 28–84 days from TREATMENT_START;
  stable dyslipidemia 90–365 days `when_indicated`), tests, tier (page 9) and note.
- **Precedence**: a confirmed condition protocol overrides a finding protocol (page 7) for the same marker group.
  Without a confirmed condition, the page-7 finding protocol applies.
- **Hypertension** is not a lab protocol. It creates a home BP monitoring schedule (page-5 `home_readings`
  BP reminders, e.g. twice daily for 7 days; starter value) and a doctor task to choose the lab tests based on medicines
  and comorbidities.

### C. UI
- Patient view (doctor/admin): a "Conditions & monitoring" card listing each confirmed condition, its stage, the active
  protocol, the next test date and its icon (as on the slide). Suggested conditions appear in a "To confirm" list.
- Admin Rules screen: the protocol table with the Note column, versioned, with sign-off.
- Callers: only "Monitoring due on <date>".
- Edge parity in `frontend/worker.js`.

## Tests
- Every suggestion rule (positive and negative).
- Only a doctor can confirm (403 for callers and the right behaviour for admins).
- Condition protocols take precedence over finding protocols.
- The stable/uncontrolled diabetes switch follows the page-10 targets.
- The hypertension monitoring schedule is created.
- No PII or values in audit records.
