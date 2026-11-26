# Prompt — Page 7: Retesting Schedule for the 10 Diagnostic Findings

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** the page-6 prompt (`diagnostic_findings` and `findings.detect`). If it is not built yet, build
section A of the page-6 prompt first. Page 9 (urgency tiers) and page 11 (condition protocols) extend this page.

## Goal
Replace CRTracker's flat 90-day retest interval (`interval_days` on every bucket in `seed_data.py`) with a
**retest protocol for each finding**: a clinically grounded window, the tests to repeat, clinical notes and
the day the AMI reminder goes out.

## The table, exactly as in the document

| Finding | Recommended retesting timeframe | Tests to repeat | Clinical considerations | AMI reminder |
|---|---|---|---|---|
| Low Vitamin D | 8–12 weeks if retesting is indicated | 25-OH Vitamin D; calcium when appropriate | Routine retesting is not necessary for every patient. Consider after treatment in selected patients, particularly those at higher risk. | Day 60–90 |
| Elevated HbA1c | 3 months if treatment changes or glucose targets are unmet; 6 months if stable and at goal | HbA1c; glucose as indicated | HbA1c reflects approximately 2–3 months of glycemic exposure. | Day 90 |
| Elevated cholesterol | 4–12 weeks after starting/changing lipid-lowering treatment; otherwise individualized | Lipid profile | Stable patients on treatment generally require monitoring every 3–12 months. | Day 30–90 |
| Elevated TSH | 6–8 weeks after starting/changing levothyroxine; otherwise individualized | TSH; free T4 when indicated | Mild untreated abnormalities may need confirmation before treatment. | Day 45–60 |
| Low hemoglobin | 2–4 weeks after initiating treatment for confirmed iron-deficiency anemia | CBC/Hb; reticulocytes when indicated | Investigate the cause of anemia. Severe anemia or concerning symptoms require earlier evaluation. | Day 14–28 |
| Elevated creatinine | Within 48 hours to 2 weeks, depending on severity and context | Creatinine, eGFR, electrolytes; urine tests as indicated | Possible acute kidney injury requires prompt evaluation and sometimes repeat testing within 24–48 hours or sooner. | Risk-based |
| Abnormal liver enzymes | 2–4 weeks for selected mild, stable abnormalities; sooner when clinically indicated | Liver panel and cause-specific investigations | Do not delay investigation of significant abnormalities, jaundice or concerning symptoms merely to repeat the test. | Day 14–28, if appropriate |
| Obesity with metabolic abnormalities | 3 months for HbA1c when indicated; lipid follow-up based on treatment | HbA1c, glucose, lipid profile as appropriate | Weight and BP can be monitored more frequently. | Day 90 |
| Multiple chronic conditions | 1–3 months, depending on conditions and treatment | Disease-specific tests | Each condition requires its own monitoring schedule. | Personalized |
| Normal report with risk factors | 6–12 months or longer, based on risk and screening guidelines | Risk-appropriate preventive tests | Normal results do not automatically justify repeat testing at six months. | Risk-based |

Note for the clinical team (include it in the sign-off checklist): for cholesterol, the timeframe says 4–12 weeks
(28–84 days) but the reminder says Day 30–90. Keep both values as written and flag the mismatch for a decision.

## What to build

### A. `retest_protocols` RuleSet (versioned; doctor sign-off; seeded from the table)
For each finding: `finding_code`, `timeframe_text`, `tests_text`, `considerations_text` (all exact), plus structured fields:
- `variants`: a list of {`when`, `window_min_days`, `window_max_days`, `anchor`}, where `anchor` is
  REPORT_DATE | TREATMENT_START | TREATMENT_CHANGE, and `when` is a condition such as `treatment_changed`,
  `targets_unmet`, `stable_at_goal`, `on_treatment`, `default`. Examples:
  - HIGH_HBA1C: {targets_unmet or treatment_changed: 90 days}, {stable_at_goal: 180 days}
  - HIGH_CHOLESTEROL: {treatment_changed: 28–84 days from TREATMENT_CHANGE}, {default: INDIVIDUALIZED}
  - HIGH_TSH: {treatment_changed: 42–56 days from TREATMENT_CHANGE}, {default: INDIVIDUALIZED}
  - LOW_HB: {on_treatment: 14–28 days from TREATMENT_START}
  - HIGH_CREATININE: {default: 0–14 days, `risk_based`: true}
  - ABNORMAL_LFT: {mild_stable: 14–28 days}, {default: DOCTOR_DECIDES}
  - LOW_VITD: {indicated: 56–84 days}, with `requires_indication: true` (no automatic retest)
  - OBESITY_METABOLIC: {default: 90 days}; MULTI_CHRONIC: {default: 30–90 days, `personalized`: true}
  - NORMAL_WITH_RISK: {default: 180–365 days, `risk_based`: true}
- `tests`: test-catalogue codes (VITD, CALCIUM, HBA1C, FBS, LIPID, TSH, FT4, CBC, RETIC, KFT,
  ELECTROLYTES, URINE_ROUTINE, UACR, LFT…). Add any missing codes to `test_catalogue`. "When indicated" tests
  are `optional: true`.
- `reminder`: {mode: FIXED, day_min, day_max} | {mode: RISK_BASED} | {mode: PERSONALIZED} |
  {mode: IF_APPROPRIATE, day_min, day_max}.

### B. Scheduling logic (`backend/app/retest.py`)
- `plan_retest(db, followup)` picks the protocol for the follow-up's highest-priority finding, chooses the
  variant from the patient's state, and sets:
  - `Followup.retest_window_start` / `retest_window_end` (new columns)
  - `Followup.reminder_on` (new column; = anchor + day_min)
  - `Followup.due_on`, kept for the existing queue (= the window start)
  - the default tests on the `RetestRecommendation`.
- The anchor dates come from page 5 medicines (`started_on` / `last_changed_on`) when they exist. Otherwise the
  doctor enters "Treatment started/changed on" on the follow-up (new field `treatment_anchor_on`).
- `requires_indication`, `RISK_BASED`, `PERSONALIZED`, `INDIVIDUALIZED` and `DOCTOR_DECIDES` **never
  auto-schedule**. They put the follow-up in the doctor queue with the label "Doctor to set retest date", and
  the doctor picks the date (the existing `next_followup_on`).
- With several findings, each finding keeps its own window (MULTI_CHRONIC: "each condition requires its own
  monitoring schedule"). The follow-up shows the earliest one and lists the rest.
- Remove nothing from the bucket `interval_days`: it stays the fallback when no protocol matches.

### C. UI
- The doctor/admin follow-up view gets a "Retest plan" panel laid out like the slide row: finding, timeframe bar
  (window start → end), tests to repeat, clinical considerations (shown in full to the doctor) and the
  reminder day. There is an "Override date" button with a required reason code (audited).
- Admin Rules screen: the protocol table, editable, with version and sign-off status.
- The caller queue shows only "Retest due", with the window dates. No finding or test names if they reveal a condition.
- Edge parity in `frontend/worker.js`, including the cron that surfaces reminders that are due.

## Tests
- Every row produces the right window for each of its variants.
- Anchors work, both from medicines and from the manual date.
- The rows that are not auto-scheduled go to the doctor queue.
- The fallback is used when no protocol matches.
- IST date boundaries are correct.
- Callers see no clinical text.
- Existing follow-up tests keep passing.
