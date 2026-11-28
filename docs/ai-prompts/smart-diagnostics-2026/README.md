# Smart Diagnostics 2026 — AI build prompts

There is one prompt per page of `Smart Diagnostics 2026.pdf`. Each prompt is meant to be pasted into an AI coding
agent opened on this repository (Claude Code, Cursor, etc.).

## How to use
1. Paste **one page prompt at a time**. Each prompt tells the agent to read `00-shared-context.md` first. That file
   holds the shared rules: role checks, caller privacy, mirroring every API route in `frontend/worker.js`, versioned medical
   rules that need a doctor's sign-off, and audit.
2. Each prompt asks the agent to write a plan and wait for approval before coding. Review the plan, then let it build.
3. Merge and test each page before starting the next one. Later pages reuse the tables that earlier pages create.
4. Values marked **[CONFIRM]**, "starter value, clinician to confirm" or "business decision" need someone to decide them
   before production use.

## Files and dependencies

| Page | File | Builds | Depends on |
|---|---|---|---|
| 1 | page-01-relationship-platform.md | Care loop, touchpoints, relationship status, next best step | — |
| 2 | page-02-personalized-wellness-plans.md | Programme engine, health profile, plans 1–8 | 1 |
| 3 | page-03-disease-specific-management.md | Disease programmes 9–17, BONE/HYPERTENSION buckets | 2 |
| 4 | page-04-specialized-clinical-programs.md | Doctor-consider programmes 17–22 | 2, 3 |
| 5 | page-05-extended-programs-family-care.md | Medicines, refills, referrals, home readings, family links, programmes 23–30 | 2 |
| 6 | page-06-recommendation-combinations.md | 10 diagnostic findings, Primary/Secondary/Third recommendations | 2 (3–5 for targets) |
| 7 | page-07-retesting-schedule.md | Retest protocol for each finding (windows, tests, reminders) | 6 |
| 8 | page-08-ami-followup-journey.md | Day 0 → Day 92 journey engine, patient messaging layer | 2/6, 7 |
| 9 | page-09-retesting-protocol-tiers.md | 5 urgency tiers, SLA, queue order | 7 |
| 10 | page-10-hba1c-journey-parameter-display.md | Previous/Current comparison table, targets, HbA1c journey | 8 (journey part) |
| 11 | page-11-additional-retesting-protocols.md | Condition register with stages, condition protocols | 7, 9, 2 |
| 12 | page-12-ami-retesting-model.md | Approved retest plan (7 steps), Home/Hub booking, bundles, KPIs | 7, 9, 10, 11 |
| 13 | page-13-relationship-model-dimensions.md | Hubs, Express Nodes, Corporates, 12-dimension scorecard | 1 |
| 14 | page-14-holistic-health-loop-dashboard.md | Live Holistic Health Loop dashboard | 1, 13 |
| 15 | page-15-health360-membership.md | Health360 plans, memberships, entitlements, payments, corporate billing (+ patient portal design) | 1, 13 |
| 16 | page-16-ai-training-programmes.md | **Separate project**: SecondMedic Academy | — |
| 17 | page-17-health-hub-care-plans.md | Care-plan catalogue, doctor-assessed enrolment, bilingual flyers | 2–5, 13 |

Pages 1–15 and 17 are built. For the next stage (the "from report to outcome" video), see
`../smart-diagnostics-video/README.md`.

## Recommended build order
1 → 2 → 3 → 6 → 7 → 9 → 11 → 10 → 12 → 8 → 5 → 4 → 17 → 13 → 15 → 14, and 16 separately.

This order delivers the clinical core (recommendations and retesting) first, then the journey, then the commercial
layer (plans, memberships) and finally the management dashboards.

## Problems found in the document (the prompts already handle them)
- Page 3 is titled "9–16" but shows 9–17, lists "Kidney Health Plan" twice (13 and 14), and uses number 17 for Bone Health
  while page 4 uses 17 for Women's Health. The prompts use codes instead of numbers.
- Page 7: cholesterol's timeframe is 4–12 weeks but its reminder is Day 30–90. This is flagged for clinical decision.
- Page 8: the typos "Diagnostics bosults" and "And new results" are corrected.
- Page 10: the status table mixes rows. The prompt splits it into target status, change status and trend.
- Page 14: the loop numbers two steps "2" and differs from the page-1 loop. The prompt uses the 7 page-1 stages.
- Page 15: entitlement quantities are not defined. They are left for a business decision.
- Page 17: plans 01 and 05 are not visible, and Lifestyle Weight Care is partly hidden (marked [CONFIRM]). The QR
  code target is not defined.
