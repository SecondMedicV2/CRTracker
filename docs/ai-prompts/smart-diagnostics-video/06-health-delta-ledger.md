# Prompt — Video 06: The health delta ledger (Prove)

Read `docs/ai-prompts/smart-diagnostics-video/00-video-context.md` first and follow it exactly.
**Depends on:** `compare.py`, approved retest plans (`retest_model.py`), `outcomes.verified_health_deltas`,
prompt 03 (personal plan cycles).

## Goal
"Every cycle ends with a verified before and after. Patients and employers see outcomes, not activity."
Build a permanent, append-only ledger of what was recommended and what changed, per care cycle. This is the
outcome data set the video calls the moat.

## What to build
1. **Ledger** `health_deltas` (append-only; corrections are new rows that reference the row they replace):
   patient_id, cycle_id (personal plan or follow-up), marker_code, baseline report/value/date, retest report/value/date,
   unit, target, change_status (Improved / Worsened / No meaningful change from `compare._eval_change_status`),
   **clinically timed** flag (retest inside the approved window), recommended plan codes, verified_by (doctor) and
   verified_at. A delta counts towards the North Star only when it is clinically timed **and** doctor-verified.
2. **Verification step**: on the Day 91 comparison, the doctor confirms the deltas (one click per cycle; can mark a
   value as unreliable with a reason code). Unverified deltas stay "pending".
3. **North Star**: switch `outcomes.verified_health_deltas` to read the ledger (verified + clinically timed), so the
   number on the Outcomes page means exactly what the video says.
4. **Patient view (staff-side)**: "Your progress" summary per cycle for doctors to share; callers see nothing clinical.
5. **Employer view**: aggregated, de-identified deltas per corporate client (share of members improved per marker
   group, per period), small-cell suppression < 10, exportable as a formula-safe CSV. No individual rows ever.
6. **Research export (admin)**: de-identified ledger extract (no names, mobiles, exact dates — use month and age
   band), behind a setting and audit.
7. **Worker parity**.

## Tests
- Append-only: no update/delete of ledger rows; corrections reference the original.
- Only clinically timed + verified deltas count in the North Star.
- Employer report suppresses small cells and contains no identifiers.
- De-identified export has no direct identifiers and uses age bands / months.
- Privacy export includes the ledger; erase removes the patient's rows (and the de-identified copy is not linkable).
