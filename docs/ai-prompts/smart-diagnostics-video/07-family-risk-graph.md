# Prompt — Video 07: Family risk graph

Read `docs/ai-prompts/smart-diagnostics-video/00-video-context.md` first and follow it exactly.
**Depends on:** `FamilyLink` (with consent), programme 30 "Family Preventive Health Plan", `HealthProfile`
family history, prompt 06 (outcomes).

## Goal
"With consent, one abnormal report brings screening to the relatives who share the risk."

## What to build
1. **Heritable-risk rules** (RuleSet, doctor sign-off, starter values marked "clinician to confirm"): which
   findings suggest screening relatives (e.g. diabetes/HbA1c, lipids, thyroid, anaemia types), which relationships
   (parent, sibling, child) and from what age, and which screening to offer. Never invent rules beyond the
   document; leave anything unclear as **[CONFIRM]**.
2. **Consent first**: two consents are needed — the index patient agrees to tell relatives that screening is
   advised (without sharing their result), and each relative consents to be contacted. Store both in `Consent`
   with type `FAMILY_SCREENING`. No consent → nothing happens.
3. **Graph**: build the family graph from `family_links` (both directions, merged patients resolved). For each
   abnormal finding with a heritable rule, list the consenting relatives who are due for screening.
4. **Outreach**: a caller task per relative with a neutral label ("Family health check invitation"); the relative
   never learns the index patient's result or condition. Optional neutral WhatsApp message through the guarded
   messaging layer.
5. **Tracking**: relatives screened, abnormal findings found through family screening, conversion to plans —
   shown on the Outcomes page as an aggregate.
6. **Privacy**: a relative's record must not reveal the index patient's data in any role; privacy export of one
   person must not include another person's clinical data; erasing a patient removes their links.
7. **Worker parity**.

## Tests
- No outreach without both consents; withdrawn consent stops pending tasks.
- Relatives' tasks and messages contain no clinical words and no index-patient details.
- Graph handles merged patients and both link directions.
- Aggregates suppress small cells.
