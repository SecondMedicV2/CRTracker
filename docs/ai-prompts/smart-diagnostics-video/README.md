# Smart Diagnostics video — AI build prompts

Build prompts for the parts of the "SecondMedic Smart Diagnostics — from report to outcome" video that CRTracker
does not have yet. They continue the page prompts in `../smart-diagnostics-2026/` (pages 1–17 of the PDF), which
are already built.

## How to use
1. Open an AI coding agent (Claude Code, Cursor, etc.) on this repository.
2. Paste **one prompt at a time**, in the order below. Each prompt tells the agent to read `00-video-context.md`
   (and through it the original `00-shared-context.md`) before planning.
3. The agent writes a plan and waits. Review it, approve it, let it build, then test and merge before the next prompt.
4. Items marked **[CONFIRM]** need a business or clinical decision before production use.

## Prompts

| # | File | Builds | Depends on |
|---|---|---|---|
| 01 | 01-five-intake-doors.md | Five ways a report arrives (own labs, WhatsApp photo, Express Node counter, employer checks, consent pull) feeding one pipeline | — |
| 02 | 02-eight-stage-loop-tracker.md | Capture → … → Prove tracker per report with the 24h / 48h / Day 90 SLA clocks | 01 helpful |
| 03 | 03-integrated-personal-health-plan.md | One primary plan + up to two add-ons, bundled retests, one price per payer, doctor-signed | — |
| 04 | 04-whatsapp-delivery-hindi-voice.md | Signed plan delivered on WhatsApp with a Hindi voice note and the nearest fulfilment point | 03 |
| 05 | 05-express-node-counter-app.md | Phone-first app and limited role for Express Node counter staff | 01, 03 |
| 06 | 06-health-delta-ledger.md | Append-only, doctor-verified before/after ledger; North Star; employer outcome reports | 03 helpful |
| 07 | 07-family-risk-graph.md | Consent-based screening invitations for relatives who share a risk | 06 |
| 08 | 08-risk-migration-contracts.md | Employer bonus per member moving to a lower risk band; insurer outcome pricing (switched off) | 06 |
| 09 | 09-pilot-rollout-and-economics.md | City-by-city phases, exit-test gates, measured report economics vs the video's assumptions | 01–08 switches |

## Recommended order
01 → 03 → 02 → 06 → 04 → 05 → 07 → 09 → 08.
The clinical core (capture, one signed plan, the loop clock, proof) comes first; channels and commercial models after.

## What these prompts deliberately do not do
- They do not treat the video's figures (₹23,000 per patient, 15% conversion, 19 hubs, 1,000+ nodes) as data.
  Prompt 09 stores them as assumptions shown next to measured values.
- They do not allow AI prescribing or sending anything clinical that a doctor has not signed.
- They keep every new channel and commercial model behind a switch that is off by default.
