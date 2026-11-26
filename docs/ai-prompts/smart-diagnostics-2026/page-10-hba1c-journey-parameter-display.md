# Prompt — Page 10: HbA1c Patient Journey and the AMI Parameter Display

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** page 8 (journey engine) for the journey part. The parameter display works on its own, using
the existing `trends.py`.

## Goal
1. A **condition-specific journey** for elevated HbA1c (the worked example on the slide).
2. The **AMI Parameter Display**: a Previous → Current comparison table for any marker, with change, status
   and next action. Build it generically so it works for every marker, not only HbA1c.

## The HbA1c journey, exactly as in the document
Initial HbA1c: 8.2 %.

| Window | Step code | What happens |
|---|---|---|
| Day 0 | HBA1C_D0 | AMI flags elevated HbA1c and recommends clinical review |
| Day 1–7 | HBA1C_D1_7 | Doctor evaluates the patient and establishes a diabetes management plan |
| Day 7–30 | HBA1C_D7_30 | Diet plan, prescribed medication adherence, and glucose monitoring |
| Day 30–60 | HBA1C_D30_60 | AMI checks adherence and glucose trends. *Medication changes remain the responsibility of the treating clinician.* |
| Day 90 | HBA1C_D90 | Repeat HbA1c if clinically appropriate → New HbA1c: 7.1 % |

## The parameter display, as in the document (example)

| Parameter | Previous | Current | Change | Status | Next action |
|---|---|---|---|---|---|
| HbA1c | 8.2 % | 7.1 % | −1.1 percentage points | Above target | Continue clinical follow-up |

The slide also shows "Improved" and "Positive trend" in extra rows labelled "Status" and "Next Action",
which is confusing. Build it as **one row per parameter with three separate statuses**:
**Target status** (Above target / At target / Below target), **Change status** (Improved / Worsened /
No meaningful change), and **Trend** over 3 or more results (Positive trend / Negative trend / Stable).

## What to build

### A. Journey template `HBA1C_90`
- Add it to `journey_templates` (page 8), with windows instead of single days (`day_from`, `day_to`), the
  exact texts above, owners (SYSTEM, DOCTOR, DIETITIAN/COORDINATOR, SYSTEM+CALLER, LAB) and a neutral caller label.
- Use it instead of `STANDARD_92` when the main finding is HIGH_HBA1C (selection rule in the template RuleSet).
- Day 7–30: glucose monitoring uses page-5 `home_readings` (GLUCOSE_*) if present, otherwise a staff-entered reading.
- Day 30–60: AMI computes adherence (from call outcomes and refill confirmations) and the glucose trend, and shows
  the fixed disclaimer: "Medication changes remain the responsibility of the treating clinician."
  **The system must never suggest a medicine or a dose change.**
- Day 90: create a retest only if the doctor has confirmed "clinically appropriate" (a tick box on the Day 1–7
  plan, or the page-7 protocol says so).

### B. Clinical targets (`clinical_targets` RuleSet; doctor sign-off)
- For each marker: `target_op` and `target_value` (starter: HBA1C < 7.0 %, clinician to confirm), `direction`
  (LOWER_IS_BETTER | HIGHER_IS_BETTER | RANGE), and `min_meaningful_change` (starter: HBA1C 0.5 percentage points).
- Per-patient target override set by the doctor (stored on the follow-up or the health profile), because
  targets are individualised.

### C. Comparison service (`backend/app/compare.py`)
`compare(db, patient_id, report_id) -> list[Row]`, using the previous report that contains the same marker:
- `previous`, `current`, `unit`.
- `change`: absolute, written as "percentage points" when the unit is % (e.g. "−1.1 percentage points"), otherwise
  in the unit, plus a relative %.
- `target_status`, `change_status` and `trend`, using direction, targets and `min_meaningful_change`.
- `next_action` from a `next_action_rules` RuleSet. Starter rules:
  - above target and improved → "Continue clinical follow-up"
  - above target and worsened → "Doctor review"
  - at target → "Continue current plan; routine monitoring"
  - otherwise → "Individualized"
Reuse `trends.py` and the existing unit normalisation (`units.py`). Never compare values whose units differ:
mark them "Units differ — not compared".

### D. UI
- On the report view, follow-up view and patient view (doctor/admin): the parameter table styled like the
  slide, with coloured status pills (red for Above target / Worsened, teal for Improved / Positive trend),
  a small sparkline per row, and a toggle between "abnormal only" and "all".
- A journey strip for HBA1C_90 above the table, shown as the slide's 5 chevrons with the dates.
- Callers: no values and no table. Only "Results compared — doctor review scheduled" with a date.
- Printable patient summary (doctor action "Print for patient"): the table plus a plain-language line per
  row. Generated from templates, not AI.
- Edge parity in `frontend/worker.js`.

## Tests
- 8.2 → 7.1 gives "−1.1 percentage points", Above target, Improved, and "Continue clinical follow-up".
- A HIGHER_IS_BETTER marker (e.g. HDL or HB).
- Units differ → not compared.
- A change below `min_meaningful_change` → "No meaningful change".
- Trend needs 3 or more points.
- The journey selects HBA1C_90.
- No medicine or dose suggestion appears anywhere.
- The caller sees no values.
