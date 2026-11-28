# Prompt — Video 09: Pilot rollout gates and report economics

Read `docs/ai-prompts/smart-diagnostics-video/00-video-context.md` first and follow it exactly.
**Depends on:** the Outcomes page (`outcomes.py`), Health Hubs (city), prompts 01–08 for their switches.

## Goal
The video's rollout runs over 18 months, and **each phase must pass its exit test before the next tranche of spend**:
- Phase 1 (months 1–3): five protocols (diabetes, thyroid, lipids, iron-deficiency anaemia, vitamin D) live in
  Lucknow and two hub cities; prove conversion on 1,000 reports.
- Phase 2: all 30 plans, the Express Node counter app, three employer pilots.
- Phase 3: consent-based record pull at scale, insurer products priced on outcomes, the family risk graph.

The video's economics (₹1,500 test → ~₹23,000 first-year revenue; 15% conversion; ₹980 extra revenue per report;
₹9.8 crore per lakh reports) are **illustrative assumptions to validate in the pilot**. Store them as editable
"assumptions" and always show measured values next to them — never present an assumption as a result.

## What to build
1. **Rollout settings**: per city — which phase, which protocols/plans are live, which features (doors, voice notes,
   node app, family graph, risk contracts) are on. Features check the patient's / hub's city. Admin screen to edit,
   audited.
2. **Exit tests** (admin-editable): each phase has measurable criteria from the Outcomes metrics, e.g. reports
   processed ≥ 1,000, conversion ≥ X%, RED 60-minute compliance ≥ Y%, signed plan 24h ≥ Z%. A "phase gate" page
   shows each criterion as PASS / NOT YET with the measured value and the period. Moving a city to the next phase
   requires all criteria to pass **or** an admin override with a written reason (audited).
3. **Report economics**: measured revenue per report, conversion (reports → paid plan), first-year revenue per
   converted patient (plan + medicines + retests + family screening, from real payments/touchpoints), shown next to
   the stored assumptions, with the gap.
4. **Worker parity** for the read routes.

## Tests
- Features are off in cities not in the right phase.
- Gate criteria compute from real metrics; override needs a reason and is audited.
- Assumptions are never shown without the measured value and a clear "assumption" label.
