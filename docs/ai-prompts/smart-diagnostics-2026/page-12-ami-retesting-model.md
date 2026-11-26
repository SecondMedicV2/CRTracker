# Prompt — Page 12: Building the AMI Clinically Approved Retesting Model

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** pages 7, 9 and 11 (protocols and tiers) and page 10 (comparison). Page 8 (journey) is optional.

## Goal
Turn every due retest into a **clinically approved retest plan** that explains **why** the test is needed,
**when** it is appropriate, and **how** the patient's indicators have changed. Bundle each of the first 5
protocols with the matching services, and measure the model with 3 KPIs.

> Key differentiator (from the slide, show it on the admin page): SecondMedic does not simply remind patients to
> repeat tests. It explains why the test is needed, when it is appropriate, and how their health indicators
> have changed over time.

## The 7-step recurring diagnostics journey, exactly as in the document
1. Next Recommended Test Date
2. Reason for Retesting
3. Treating Clinician or Approved Protocol
4. Previous Diagnostic Results
5. Recommended Tests
6. Home Collection or Health Hub Booking Option
7. Automated Report Comparison

## The initial 5-protocol integration, exactly as in the document
Each one is bundled with **Diagnostics + Physician Consult + Pharmacy + Nutrition**.

| Protocol | Window |
|---|---|
| DIABETES | 90 days |
| THYROID | 6–8 weeks after treatment changes |
| LIPIDS | 4–12 weeks after treatment changes |
| IRON-DEFICIENCY ANEMIA | 2–4 weeks |
| VITAMIN D | 8–12 weeks when indicated |

## The KPIs (AMI metrics), exactly as in the document

| KPI | Definition | Business significance |
|---|---|---|
| Retesting eligibility rate | Patients with a documented clinical indication for repeat testing ÷ patients assessed | Measures the appropriate follow-up opportunity |
| Retesting completion rate | Eligible patients completing retesting within the recommended window ÷ eligible patients due | Measures follow-up effectiveness |
| Repeat diagnostics revenue | Revenue generated from medically indicated repeat tests | Measures recurring diagnostic revenue |

## What to build

### A. Retest plan record: extend `RetestRecommendation` (migration), one record covering the 7 steps
1. `next_test_date` plus `window_start`/`window_end` (from protocols, pages 7/11)
2. `reason_code` (finding or condition code) plus `reason_text_clinical` (generated from the protocol's timeframe and
   considerations text; doctor-only)
3. `approved_by_doctor_id` **or** `protocol_code` + `protocol_version` (a signed-off RuleSet version).
   A retest plan is "clinically approved" only if one of the two is set. Unapproved plans cannot be booked.
4. `previous_results_snapshot`: marker codes plus report ids. Values are read live and never copied into logs.
5. `tests` (test-catalogue codes; optional tests marked)
6. Booking: `collection_mode` (HOME | HEALTH_HUB), `health_hub_id` (`health_hubs` table: name, city, address,
   active, opening hours; create it here if page 13 is not built yet), `slot_start`, `address_enc` (encrypted, HOME only),
   `booking_status` (NOT_BOOKED | BOOKED | COLLECTED | CANCELLED | NO_SHOW), `lab_order_ref`. The lab booking itself
   stays external: store the reference only.
7. `comparison_report_id`: set automatically when a new report for the same patient contains the plan's tests within the
   window (or up to 30 days after it). This triggers the page-10 comparison, and marks the plan COMPLETED_IN_WINDOW or
   COMPLETED_LATE.

### B. Protocol bundles (`protocol_bundles` RuleSet)
For DIABETES, THYROID, LIPIDS, IRON_DEFICIENCY_ANEMIA and VITAMIN_D: `window` (as in the table; link to the
`retest_protocols` variants), and `services` = [DIAGNOSTICS: tests, PHYSICIAN_CONSULT, PHARMACY (only if a medicine is active),
NUTRITION]. Each service has a `price_inr` (admin-only; add `price_inr` to `test_catalogue` entries too). Accepting a
bundle creates the retest plan plus one `care_touchpoints` row per service as it is delivered.

### C. Patient explanation ("why, when, how")
- A doctor/admin action "Explain to patient" builds a printable sheet in English or Hindi from templates (no AI),
  for handing over at the counter or reading out by the doctor:
  - **Why**: the plain-language reason from the protocol.
  - **When**: the window dates.
  - **How it changed**: the page-10 comparison rows.
- Patient messages (page 8) carry only "your follow-up test is due between <dates>", with no clinical content.

### D. KPI service and dashboard (admin only)
- `GET /api/kpis/retesting?from=&to=&hub=&protocol=` returns the 3 KPIs with numerator and denominator:
  - **Eligibility**: patients with an approved retest plan ÷ patients with an analysed report in the period.
  - **Completion**: plans completed within the window ÷ plans whose window ended in the period.
  - **Revenue**: the sum of `price_inr` of tests on completed plans (only medically indicated, i.e. approved plans).
- Dashboard tiles laid out like the slide's KPI table (name, definition, business significance, value, trend), filterable by
  protocol and Health Hub, with CSV export (formula-safe).

### E. UI
- A "Retest plan" card showing the 7 steps as a vertical checklist (the slide's left column) with the state of
  each step. The Booking step offers a Home / Health Hub toggle, a hub picker, a slot, and an address for home collection.
- An admin "Retesting model" page with the 5 protocol bundle cards (icons: Diagnostics, Physician consult, Pharmacy,
  Nutrition), the KPI table and the key-differentiator banner.
- Callers can book (mode, hub, slot, and the patient's address for home collection) but see only "Follow-up test", never the
  test names if they reveal a condition, and never the reasons or results.
- Edge parity in `frontend/worker.js`.

## Tests
- Unapproved plans cannot be booked.
- The automatic match of a new report closes the plan (in window vs late).
- KPI numerators and denominators on fixtures.
- Revenue counts only approved, completed plans.
- The booking address is encrypted.
- Caller filtering.
- CSV formula escaping.
