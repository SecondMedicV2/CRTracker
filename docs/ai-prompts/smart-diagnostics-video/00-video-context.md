# Shared context for the "Smart Diagnostics — from report to outcome" build prompts

These prompts build the parts of the SecondMedic Smart Diagnostics video that CRTracker does not have yet.
Every prompt starts with "Read 00-video-context.md first". Read **both** of these before planning:

1. `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` — the repository layout, building blocks, naming
   and the non-negotiable rules (roles, caller privacy, AI data limits, audit, Worker parity, migrations, tests).
   **All of those rules apply here unchanged.**
2. This file — what the video asks for, and what is already built.

## What the video describes (the target)

A diagnostic report stops being the end of a transaction and becomes the start of a care loop:

**Capture → Read → Triage → Context → Match → Approve → Activate → Prove**

- **Capture**: reports arrive through five doors: SecondMedic's own labs, a WhatsApp photo of any lab's report,
  an Express Node counter, employer health checks, and a consent-based health-record pull (the video's wording is
  unclear — "a pack consent" — treat it as ABHA/ABDM consent and mark it **[CONFIRM]**).
- **Read**: AMI extracts and codes every biomarker; a human checker reviews anything uncertain.
- **Triage**: every report is checked against a critical-value list approved by the Chief Medical Officer.
  RED → doctor call within 60 minutes and no plan is sold until a doctor clears it. AMBER → doctor review within
  24 hours and the matching condition plan. GREEN → a preventive plan, with no extra tests pushed.
- **Context**: history, current medicines, family history and past reports build a risk profile.
- **Match**: one primary plan plus up to two add-ons from the 30-plan library, retest dates set, and one price for
  whoever pays (patient, employer or insurer).
- **Approve**: a SecondMedic doctor reviews and signs. **Nothing clinical reaches a patient unsigned.**
- **Activate**: the plan reaches the patient on WhatsApp with a Hindi voice note and is fulfilled at the nearest
  Express Node, Health Hub or at home.
- **Prove**: at Day 90 the patient is retested, results are compared, and the plan is renewed.

Targets: plan assigned within 24 hours, plan active within 48 hours, measurable proof at the Day 90 retest.

Principles that every prompt must keep: **AMI drafts, the doctor decides, the network delivers. No AI prescribing.
Every retest needs a clinical reason.** Outcome-linked pricing and employer contracts are marked "planned" in the
video — build them behind switches that are off by default.

North Star: **verified health deltas** — members with at least one biomarker improved at a clinically timed retest.

The video's numbers (₹1,500 test → ~₹23,000 first-year revenue, 15% conversion, ₹980 per report, 19 hubs,
1,000+ Express Nodes, 1,300+ enterprise clients) are **illustrative assumptions to validate in the pilot**.
Never hard-code them as data or show them as measured results.

## Already built (reuse; do not rebuild)

| Piece | Where |
|---|---|
| Programmes 1–30, recommendation combinations (primary/secondary/third), health profile | `backend/app/programs.py`, `seed_programs.py`, `routers/programs.py`, `ProgramRecommendation`, `HealthProfile` |
| Retest protocols, 5 urgency tiers with SLA, condition protocols, approved retest plans, Home/Hub booking, bundles, KPIs | `retest.py`, `retest_model.py`, `RetestRecommendation`, `routers/retest_model.py` |
| Day 0 → Day 92 journeys, guarded patient messaging (no clinical content, consent, do-not-call) | `journeys.py`, `messaging.py`, `CareJourney`, `JourneyStep`, `OutboundMessage` |
| Previous/current comparison with target, change status ("Improved"/"Worsened") and trend | `compare.py` (`compare`, `_eval_change_status`) |
| Critical-value rules (clinician-approved) | `CriticalRule`, `routers/insights.py`, admin **Rules** screen |
| RED/AMBER/GREEN triage, the plan-sale gate, doctor clearance | `backend/app/outcomes.py` (`triage_colour`, `assert_plan_sale_allowed`, `clear_followup`), `routers/outcomes.py`, `frontend/components/TriageBadge.tsx` |
| North Star and operating metrics (signed plan 24h, active plan 48h, RED call 60 min, AMBER review 24h, retest completion, renewal, revenue per report, doctor edit rate) | `outcomes.outcome_metrics`, `GET /api/v1/outcomes/metrics`, admin **Outcomes** page |
| Health Hub care plans (suggest → doctor assess → pay → active), renewals, entitlement use | `care_plans.py`, `routers/care_plans.py`, `PlanEnrollment` |
| Health360 memberships, doctor sign-off for Chronic, payments, corporate billing and roster import, Razorpay test-mode provider (switched off) | `memberships.py`, `routers/memberships.py`, `payment_gateway.py` |
| Health Hubs, Express Nodes, corporate clients, family links with consent | `HealthHub`, `ExpressNode`, `CorporateClient`, `FamilyLink` |
| Data-backed scorecard and Health Loop | `relationship_scorecard.py`, `relationship_loop.py`, `relationship_metrics.py` |
| Edge (Cloudflare Worker) mirror of plans, memberships, triage and outcomes | `frontend/lib/plansParity.js`, `frontend/lib/backendParity.js`, `frontend/worker.js` |

Check the code before relying on this table; extend these modules rather than creating parallel ones.

## Extra rules for this set

1. **Doctor sign-off is the gate.** Anything a patient receives that contains clinical meaning (a plan, a retest
   date with its reason, a voice note) needs a recorded doctor approval (`approved_by`, `approved_at`) on the exact
   version sent. Store the version; never send an edited version without a new approval.
2. **Outbound channels** (WhatsApp, voice notes, SMS) go through the existing guarded messaging layer and stay
   behind `whatsapp_enabled` (off by default). Use a provider interface with a "log only" adapter for tests; no live
   sends in development.
3. **AI use**: only for drafting (AMI drafts) and for reading report images/PDFs. Send the AI only age, gender, test
   dates and values (and the image with identifying text masked where the provider allows). The doctor's decision
   is always deterministic and recorded.
4. **Feature switches**: every new channel or commercial model gets an admin setting, off by default, so the pilot
   can roll out city by city.
5. Finish each prompt with the "Done means" checks from the shared context, plus the list of **[CONFIRM]** items.
