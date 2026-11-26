# Prompt — Page 14: Current Model vs Future Model — the Holistic Health Loop dashboard

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** the page-1 prompt (`care_touchpoints`) and the page-13 prompt (scorecard and channels).

## Goal
Page 14 repeats the page-13 dimensions as a picture: on the left, the **transaction cycle**; on the right, the
**Holistic Health Loop** with recurring revenue. Build it as a live, interactive admin dashboard that shows
how patients and revenue actually move through each model.

## What the slide shows (exactly)
- Header rows (same as page 13): Customer relationship (Individual service purchase → Continuous healthcare
  engagement); Revenue (Revenue per transaction → Subscription + transactions + enterprise contracts); Patient
  acquisition (Repeated acquisition and reactivation → Acquisition followed by retention and cross-selling).
- **Current model: transaction-driven** cycle: [Customer] → Service Purchase (Diagnostics/Med Purchase/Consultation)
  → Revenue → End/Reactivate. Strategic asset: Healthcare network.
- **Future model: relationship platform** loop: 1. Prevention → 2. Eating well → 2. Diagnostics → 3. Consultations →
  Continuous Care Coordination (AMI) → Retention → Ongoing Monitoring → back to Holistic Revenue.
  Side labels: "Corporate Population Health Partnerships"; "Continuous Recurring Revenue (Subscription + transactions +
  Population Health Partnerships)". Strategic asset: Healthcare network + longitudinal patient relationships.
- Rows covered by the pictures: Diagnostics, Pharmacy, Doctors, AMI, Health Hubs, Express Nodes, Corporate clients,
  Core financial metric, Strategic asset.

Slide inconsistencies to resolve: the slide numbers two steps "2" (Eating well, Diagnostics), and this loop
differs from page 1 (it adds "Continuous Care Coordination (AMI)" and "Retention", and leaves out Medications and Chronic
conditions). Use the **7 `care_touchpoints` stages** from page 1 as the loop nodes, in the order PREVENTION →
EATING_WELL → DIAGNOSTICS → CONSULTATIONS → MEDICATIONS → CHRONIC_CONDITIONS → ONGOING_MONITORING. Show **AMI
coordination** as the centre hub of the loop, and **Retention** as the arrow that closes the loop.

## What to build

### A. Data service: `GET /api/relationship/loop?from=&to=&hub=&corporate=` (admin only)
- For each stage: patients with a touchpoint in the period, revenue (`amount_inr`), and the % of active patients.
- **Flows**: the number of patients whose next touchpoint moved from stage A to stage B within 120 days (a transition
  matrix over the 7 stages). This drives the arrow thickness.
- **Retention**: patients active in the previous period and still active in this one ÷ patients active in the previous period.
- **AMI coordination**: journeys active, steps completed on time % (page 8), retest completion % (page 12).
- **Revenue ring**: transactions vs subscriptions (page 15) vs population-health partnerships (corporate PEPM, page 13),
  plus "Holistic revenue" = the total and "Annual contribution per active patient".
- **Transaction cohort for the left picture**: patients with exactly one touchpoint in 12 months (one-time
  purchase); reactivated patients (a touchpoint after > 180 days of no touchpoint); revenue per transaction.
- Use aggregates only, with small-cell suppression (< 10).

### B. UI: admin "Health Loop" page
- Two side-by-side panels styled like the slide (teal left panel, blue right panel; stacked on phones):
  - **Left**: an SVG cycle Customer → Service purchase → Revenue → End/Reactivate, with live counts (one-time patients,
    reactivated patients, revenue per transaction) and the "Healthcare network" footer (hubs and nodes count).
  - **Right**: an SVG loop with the 7 stage nodes (icons: runner, food, scanner, doctor, pills, clipboard, smartwatch),
    arrow thickness by flow, AMI in the centre, a Retention arrow, the side labels from the slide, and a revenue ring. The
    footer "Healthcare network + longitudinal patient relationships" shows the count of longitudinal patients (page 13
    definition).
- The three header rows (Customer relationship, Revenue, Patient acquisition) show the live metrics from the page-13
  scorecard. The remaining rows link to the scorecard.
- Clicking a stage node opens a drill-down: trend over time and the top services in that stage (service codes, no
  patient-level data).
- Filters: date range, Health Hub, corporate client. Export as PNG (client-side) and CSV (formula-safe).
- Must be readable in light and dark themes. Use tokens from the existing Tailwind config.
- Doctors and callers have no access.
- Edge parity in `frontend/worker.js` for the data endpoint.

## Tests
- The transition matrix on a fixture.
- The retention formula.
- The cohort definitions (one-time, reactivated).
- Suppression for fewer than 10 patients.
- Admin-only route in the RBAC matrix.
- The frontend build passes.
