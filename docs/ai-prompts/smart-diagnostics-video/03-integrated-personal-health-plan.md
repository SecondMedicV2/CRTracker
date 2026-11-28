# Prompt — Video 03: One personal health plan at one price (Match + Approve)

Read `docs/ai-prompts/smart-diagnostics-video/00-video-context.md` first and follow it exactly.
**Depends on:** programmes 1–30 and combinations (`programs.py`), retest plans and bundles (`retest_model.py`),
care plans (`care_plans.py`), memberships, Health Hubs / Express Nodes, `outcomes.assert_plan_sale_allowed`.

## Goal
Today a patient with several findings gets several separate recommendations. The video asks for **one personal
health plan at one price, not three separate programmes**: AMI drafts one integrated plan, a doctor signs it, and
it is priced for whoever pays.

Example from the video (synthetic): Sunita, 48, HbA1c 8.2%, high cholesterol, low vitamin D and low haemoglobin →
one signed plan on Day 1, retests bundled into **two blood draws instead of five**, all four markers improved by
Day 90 (HbA1c 7.1%), plan continues.

## What to build
1. **Personal health plan** (`personal_plans` + `personal_plan_items`, versioned):
   - one **primary** plan and **up to two add-ons**, drawn from the 30-programme library and the care-plan catalogue;
   - the retest schedule from the approved retest plan, with bundling into the fewest draws (reuse page-12 bundles);
   - **one price** (sum of components minus a bundle discount from a setting, never below the floor price set by
     admin), and the payer: PATIENT, EMPLOYER (corporate client) or INSURER (**[CONFIRM]** — build the payer type
     and a price list per payer, insurer switched off).
2. **AMI drafting and ranking** (deterministic rules first; an AI may only write the plain-language summary):
   rank candidates by (1) clinical priority (triage colour, urgency tier), (2) patient history (conditions,
   medicines, previous plans), (3) the nearest fulfilment point (hub/node with capacity in the patient's city),
   (4) who pays. Store the score breakdown so the doctor can see why.
3. **Doctor approval**: the doctor can accept, remove or swap components and the price is recomputed. Approval
   records the doctor, the time and the exact version. Count doctor edits (feeds the existing "doctor edit rate"
   metric). A RED patient cannot get a plan until cleared (existing gate).
4. **Activation**: on payment (or employer/insurer cover), create the underlying `PlanEnrollment` / `Membership` /
   retest bookings in one transaction. Cancelling refunds through the existing payment records (manual).
5. **API + roles**: draft (system/doctor/admin), edit & approve (doctor only), view (doctor/admin; callers see only
   "Personal health plan" with price and dates), pay (counter staff/caller).
6. **UI**: a "Personal health plan" panel on the follow-up page: components, reasons, bundled retest dates,
   one price, approve button for doctors; a neutral caller view.
7. **Worker parity**.

## Tests
- At most one primary and two add-ons; no duplicate programmes; GREEN patients get a preventive plan and no
  extra tests.
- Bundling produces fewer draws than separate retests for the Sunita example.
- Price maths, floor price, payer price lists, insurer switch off.
- Only a doctor approves; edits after approval need a new approval; RED gate enforced.
- Callers never see components or conditions.
