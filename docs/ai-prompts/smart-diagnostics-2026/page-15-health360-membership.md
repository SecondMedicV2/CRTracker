# Prompt — Page 15: Proposed Health360 Membership Architecture

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** page 1 (`care_touchpoints`) and page 13 (`corporate_clients`). It works better with pages 8, 11 and 17.

## Goal
Add **Health360 memberships**: plan tiers, member enrolment, entitlements, renewals, payment records and corporate
(employer-paid) billing. The Free tier promises patients a digital health record and alerts, which needs a
**patient-facing portal**. That is a new role and a new security surface, so it is **Phase B, built only after I
approve Phase A**.

## The plans, exactly as in the document

| Code | Plan | Target customer | Monthly price | Key benefits |
|---|---|---|---|---|
| H360_FREE | Health360 Free | Every registered patient | Free | Digital health record, reports, reminders, health alerts |
| H360_ESSENTIAL | Health360 Essential | Individuals and families | ₹199 | Care navigation, medicine reminders, preventive screening calendar, member service benefits |
| H360_PLUS | Health360 Plus | Preventive healthcare users | ₹499 | Essential benefits plus defined teleconsultation and preventive-care entitlements |
| H360_CHRONIC | Health360 Chronic | Diabetes, hypertension and thyroid patients | ₹799 | Clinician-supervised chronic-care program, monitoring and follow-up |
| H360_SENIOR | Health360 Senior | Elderly patients | ₹1,499 | Care coordination, caregiver updates, scheduled clinical reviews and homecare coordination |
| H360_CORPORATE | Health360 Corporate | Employer-sponsored members | ₹99–299 PEPM | Preventive care, OPD access, care navigation and selected chronic-care benefits |

## Phase A: staff-side memberships (build now)

### A1. Plan catalogue (`membership_plans`, admin-managed Setting/table; not medical)
Code, name, target text, `price_inr_monthly` (Corporate: `pepm_min` 99 / `pepm_max` 299; the actual rate is per
corporate contract), benefits text (exact), `includes_plan` (Plus includes Essential), active, and
`entitlements` = [{code, quantity, period (MONTH|QUARTER|YEAR), description}].
The document says "defined teleconsultation and preventive-care entitlements" but gives no numbers. **Seed the
quantities as 0 and flag them as a business decision**: list them in the summary for me to fill in. Entitlement codes:
TELECONSULT, PREVENTIVE_SCREEN, DOCTOR_REVIEW, DIETITIAN_SESSION, HOME_VISIT, CARE_NAVIGATION, MEDICINE_REMINDERS,
CAREGIVER_UPDATE, OPD_VISIT.

### A2. Memberships
- `memberships`: patient_id, plan_code, status (ACTIVE | PENDING_PAYMENT | PAUSED | CANCELLED | EXPIRED), payer (SELF |
  CORPORATE), corporate_client_id, start_on, current_period_end, auto_renew, enrolled_by, health_hub_id,
  family_group_id (Essential is "individuals and families": up to N members per family, N being a business decision,
  using page-5 `family_links` with consent).
- Every registered patient gets H360_FREE automatically (no payment).
- Eligibility suggestions (deterministic; shown to doctor/admin, with a neutral line for callers):
  - H360_CHRONIC: a confirmed condition (page 11) or an active bucket of DIABETES, HYPERTENSION or THYROID.
    The clinical programme itself must be clinician-supervised, so enrolment needs a doctor's sign-off.
  - H360_SENIOR: age ≥ 60.
  - H360_PLUS: patients with a PREVENTIVE_PLAN recommendation (page 2).
- Entitlement usage: when a matching `care_touchpoints` row is recorded (e.g. TELECONSULT), consume one unit. Show
  "used / included" for each period, and warn when it runs out.

### A3. Payments (no live gateway in this task)
- `payments`: membership_id, amount_inr, method (COUNTER_CASH | COUNTER_UPI | COUNTER_CARD | ONLINE | CORPORATE_INVOICE),
  reference, received_by, received_at, status. Staff record counter payments.
- A `PaymentProvider` interface, with a Razorpay **test-mode** adapter behind the setting `online_payments_enabled=false`.
  No keys in code; they come from environment variables. Live payments need my explicit approval.
- A renewal job (daily, IST): 7 days before `current_period_end`, create a caller task "Membership renewal call"; if
  the membership is unpaid 7 days after the end date, set it to EXPIRED.

### A4. Corporate billing
- Monthly statement per `corporate_clients` row: active members × the contract `pepm_inr`. Export as CSV (formula-safe)
  and as a printable invoice summary. No employee health data in the statement, only member counts.
- A member roster can be imported by CSV (5 MB limit): employee id, name, mobile (encrypted), matched to patients
  through the existing identity logic.

### A5. UI and roles
- Patient view: a membership card showing the plan, status, period, entitlements used/included, payments and
  renew/cancel actions.
- Admin: plans editor, membership list with filters, corporate statements, revenue tiles (MRR by plan; these feed pages 13/14).
- Caller: can see plan **tier name** and status and record a counter payment. **Exception**: H360_CHRONIC reveals a
  condition group, so callers see it as "Health360 Care" instead.
- Doctor: sees the membership and the clinical entitlements. Signs off Chronic enrolment.
- Add the tables to privacy export/erase. Audit every membership and payment change.
- Edge parity in `frontend/worker.js`.

## Phase B: patient portal (plan it, then STOP and ask me before building)
For H360_FREE's "digital health record, reports, reminders, health alerts":
- a new `patient` role with OTP login to the registered mobile (rate-limited, OTP hashed, short expiry)
- patients see only their own reports (decrypted on demand), comparison (page 10), reminders and alerts
- consent screens
- full RBAC tests.
Write this as a design note in `docs/` and wait for my approval.

## Tests
- Free is auto-assigned.
- Eligibility suggestions.
- Entitlement consumption and limits.
- The renewal job dates (IST).
- Corporate statement maths.
- A Chronic enrolment needs a doctor's sign-off.
- Callers see "Health360 Care" for Chronic.
- Payment records are audited.
- No gateway call happens while the flag is off.
