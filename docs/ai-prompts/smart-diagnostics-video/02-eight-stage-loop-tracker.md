# Prompt — Video 02: The 8-stage report-to-outcome tracker with SLA clocks

Read `docs/ai-prompts/smart-diagnostics-video/00-video-context.md` first and follow it exactly.
**Depends on:** prompt 01 (report doors) is helpful but not required. Uses `outcomes.py`, `Followup`,
`ProgramRecommendation`, `PlanEnrollment`, `CareJourney`, `compare.py`.

## Goal
Every report shows where it is in the loop **Capture → Read → Triage → Context → Match → Approve → Activate → Prove**,
with timestamps and the three SLA clocks from the video: **plan assigned within 24 hours, plan active within
48 hours, proof at the Day 90 retest**. Admins see what is stuck and where.

## What to build
1. **Stage events**: a table `loop_events` (report_id, patient_id, stage, at, by_user_id or "system", ref_entity, ref_id).
   Write an event at each real moment — do not infer stages from guesses:
   - CAPTURE: report created. READ: extraction finished (or human check finished). TRIAGE: triage colour set.
   - CONTEXT: health profile / medicines / family history / previous report reviewed (first of: profile saved,
     comparison generated). MATCH: recommendations generated. APPROVE: first ACCEPTED/ENROLLED programme decision
     or doctor plan sign-off. ACTIVATE: first paid plan or membership after the report. PROVE: a later report for
     the same patient with a comparison containing at least one measured change.
   - Backfill events for existing reports from stored timestamps where they exist; leave the rest empty.
2. **SLA clocks** (from CAPTURE): ASSIGNED_24H (APPROVE ≤ 24h), ACTIVE_48H (ACTIVATE ≤ 48h), PROVE_D90
   (PROVE within the approved retest window). Status per clock: MET, MISSED, RUNNING, NOT_APPLICABLE
   (e.g. GREEN with no plan needed). Put the hour limits in a setting so they can change.
3. **Escalation**: a worker tick notifies admins once when a clock is about to miss (e.g. 4 hours before) and once
   when it misses. Notification text has no clinical content.
4. **API**: `GET /api/v1/reports/{rid}/loop` (doctor/admin) and `GET /api/v1/loop/board` (admin: counts per stage,
   stuck items older than the SLA, filters by door, hub, city, date). Callers get 403.
5. **UI**: a horizontal 8-step tracker on the report and follow-up pages (done steps with time, current step,
   SLA badges), and an admin **Loop board** with counts per stage and a "stuck" list. Phone width must work.
6. **Outcomes page**: switch the existing `plan_signed_24h` and `plan_active_48h` metrics to read from
   `loop_events`, so there is one definition.
7. **Worker parity** for both routes.

## Tests
- Each stage event is written once, at the real moment, by the real trigger.
- Clocks: MET / MISSED / RUNNING / NOT_APPLICABLE cases, including IST day boundaries.
- Escalation notifies once per clock, never repeats, and contains no clinical words (`check_caller_safety`).
- RBAC and audit.
