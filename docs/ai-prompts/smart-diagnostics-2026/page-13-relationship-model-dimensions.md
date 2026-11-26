# Prompt — Page 13: Current Transaction Model vs Proposed Relationship Model (12 dimensions)

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** the page-1 prompt (`care_touchpoints`, relationship status). It uses data from pages 5, 12, 15 and 17
when they exist, and shows "not available yet" otherwise.

## Goal
This page is a strategy comparison. In the app it becomes two things:
1. The **channel data** that the proposed model relies on: Health Hubs, Express Nodes and Corporate clients,
   plus where each patient came from.
2. An admin **Relationship Model Scorecard** that measures each of the 12 dimensions, showing the
   transaction-model metric next to the relationship-model metric, so management can see the shift happening.

## The dimensions, exactly as in the document

| Dimension | Current transaction model | Proposed relationship model | Metric to compute (current → proposed) |
|---|---|---|---|
| Customer relationship | Individual service purchase | Continuous healthcare engagement | one-time patients % → patients with ≥ 2 touchpoints on different dates in 12 months % |
| Revenue | Per transaction | Subscription + transactions + enterprise contracts | revenue split: transactions / subscriptions (page 15) / enterprise (corporate contracts) |
| Patient acquisition | Repeated acquisition and reactivation | Acquisition followed by retention and cross-selling | new vs reactivated patients → retained % and cross-sold % (≥ 2 loop stages) |
| Diagnostics | Revenue-generating test | Entry point into ongoing care | diagnostic revenue → % of diagnostic patients who entered ongoing care (accepted programme, plan or journey) |
| Pharmacy | Medicine purchase | Prescription management and refill continuity | medicine sales → refill continuity rate (page 5 refills on time ÷ due) |
| Doctors | Individual consultation | Longitudinal clinical relationship | consults → % of patients seen ≥ 2 times by the same doctor |
| AMI | Workflow automation | Continuous care coordination | tasks automated → journey steps completed on time % (page 8) |
| Health Hubs | Service delivery locations | Patient enrollment and care-management centers | visits per hub → enrolments and care-managed patients per hub |
| Express Nodes | Distribution and referral points | Local patient acquisition and engagement network | referrals per node → acquired patients per node and their 90-day engagement % |
| Corporate clients | Healthcare service buyers | Long-term population-health partners | one-off corporate camps → covered and active members, population-health summary |
| Core financial metric | Revenue per transaction | Annual contribution per active patient | average transaction value → 12-month revenue ÷ active patients |
| Strategic asset | Healthcare network | Healthcare network + longitudinal patient relationships | hubs and nodes count → patients in longitudinal relationships (≥ 12 months, ≥ 3 touchpoints) |

## What to build

### A. Channel entities (admin-managed; non-clinical)
- `health_hubs`: name, code, city, address, phone, opening_hours, active. If the page-12 prompt already created it, extend it.
- `express_nodes`: name, code, type (PHARMACY | CLINIC | PARTNER | KIOSK), city, linked health_hub_id, active.
- `corporate_clients`: name, code, contract_start, contract_end, pricing_model (PEPM), pepm_inr, covered_members,
  contact (encrypted), active.
- `patient_channel`: on `Patient`, add `source_channel` (LAB_IMPORT | HEALTH_HUB | EXPRESS_NODE | CORPORATE | DIRECT)
  and `source_ref_id`, plus `corporate_client_id` (nullable). Set them at import time from the lab booking data if
  available, otherwise let an admin edit them.
- Add a `health_hub_id` / `express_node_id` attribution to `care_touchpoints` (where the service was delivered).
- Admin CRUD screens under `frontend/app/(admin)/settings` (or a new "Network" section). Admin only, audited.

### B. Scorecard service
- `GET /api/relationship/scorecard?from=&to=&hub=&node=&corporate=` (admin only) returns, for each of the 12
  dimensions: `current_metric` {label, value}, `proposed_metric` {label, value, numerator, denominator}, the
  `trend` vs the previous period, and `data_status` (OK | PARTIAL | NOT_AVAILABLE with the missing feature named).
- **Corporate population-health summaries are aggregated only**: hide any cell with fewer than 10 patients
  (show "< 10"), and never list patients.
- Revenue comes from `care_touchpoints.amount_inr`, memberships (page 15) and corporate PEPM (`pepm_inr` ×
  active members per month).

### C. UI: admin "Relationship model" page
- Laid out like the slide: three columns (Dimension | Current transaction model | Proposed relationship model), with
  the document's text as the row headers and the live metric under each model, plus a delta arrow. Icons as on the slide
  (person, card, cycle, stethoscope, hub).
- Filters: date range, hub, node, corporate. CSV export (formula-safe). Phone layout: a card per dimension.
- Doctors and callers have no access (403).
- Edge parity in `frontend/worker.js`.

## Tests
- Every metric on a fixture dataset (numerator and denominator).
- Small-cell suppression (< 10).
- Admin-only access in the RBAC matrix.
- Channel CRUD is audited.
- `data_status` is NOT_AVAILABLE when a dependency (e.g. memberships) does not exist.
