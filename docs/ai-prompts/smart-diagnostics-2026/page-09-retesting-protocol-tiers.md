# Prompt — Page 9: Recommended SecondMedic Retesting Protocol (AMI Engine) — 5 urgency tiers

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** the page-7 prompt (`retest_protocols`). It can be built before page 7: in that case the tiers
are assigned from the buckets and critical values, and page 7 later links its protocols to them.

## Goal
Put every retest into one of 5 urgency tiers, so the queues, SLAs, colours and escalation follow one consistent scheme.

## The tiers, exactly as in the document

| Order | Code | Tier | Retesting window | Details | Colour |
|---|---|---|---|---|---|
| 1 | URGENT | Urgent | Same day to 48 hours, as clinically directed | Critical abnormalities, suspected acute kidney injury | red |
| 2 | EARLY | Early follow-up | 1–4 weeks | Selected anemia and liver conditions | teal |
| 3 | TREATMENT_RESPONSE | Treatment response | 4–8 weeks | Lipid treatment, thyroid medication adjustments | navy blue |
| 4 | METABOLIC | Metabolic follow-up | 8–12 weeks | HbA1c, selected vitamin deficiencies | amber |
| 5 | LONG_TERM | Long-term monitoring | 3–12 months or longer | Stable chronic disease and preventive screening | green |

(The slide repeats "clinically" in "as clinically clinically directed". Use the text above.)

## What to build
1. **`retest_tiers` RuleSet** (versioned, sign-off), seeded with the table: `code`, `label`, `window_min_days`,
   `window_max_days` (URGENT 0–2, EARLY 7–28, TREATMENT_RESPONSE 28–56, METABOLIC 56–84, LONG_TERM 90–365+),
   `details_text`, `colour_token`, `sla_hours` (URGENT: 24; others: none), and `caller_label` (neutral, e.g.
   "Priority call today" for URGENT, otherwise "Follow-up call").
2. **Tier mapping** (starter values, clinician to confirm):
   - URGENT: any `critical_values` hit (the existing list is deliberately empty until a doctor supplies values;
     **do not invent critical values**), or a HIGH_CREATININE protocol flagged as suspected acute kidney injury.
     Doctors can also mark a follow-up URGENT by hand.
   - EARLY: LOW_HB (on treatment), ABNORMAL_LFT (mild stable).
   - TREATMENT_RESPONSE: HIGH_CHOLESTEROL and HIGH_TSH after a treatment change.
   - METABOLIC: HIGH_HBA1C, LOW_VITD (when indicated), OBESITY_METABOLIC.
   - LONG_TERM: stable chronic conditions (page 11) and NORMAL_WITH_RISK.
   Add a `tier` field to each `retest_protocols` variant. Store the result on `Followup.protocol_tier` (new
   column). **Do not reuse the existing `retest_tier` field**, which holds the LOW/MEDIUM/HIGH score tier.
3. **Queue behaviour**:
   - Sort order: URGENT first, then the existing score.
   - URGENT also creates an urgent `Notification` for the assigned doctor and the admins, appears in a red
     "Urgent — action within 24 h" strip on the dashboard, and is escalated (to admin) if nothing has
     happened within `sla_hours`.
   - A follow-up's retest date must fall inside its tier window. A doctor can override it with a reason code (audited).
4. **UI**:
   - The 5 tiers as coloured chevron cards (like the slide) on a "Retesting protocol" admin page,
     showing counts of open follow-ups per tier.
   - A tier badge (colour and label) in every queue row, card and patient view. Callers see the badge
     colour and the neutral label only.
   - Filters by tier in the follow-up and doctor queues.
5. **Edge parity** in `frontend/worker.js`, including SLA escalation in the cron.

## Tests
- The mapping for every finding and variant.
- URGENT sorting, notifications and SLA escalation.
- A manual override needs a reason and writes an audit row.
- No critical values are seeded.
- The callers' neutral labels pass the safety check.
