# Prompt — Page 1: From Transactions to an Integrated Relationship Platform

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.

## Goal
Today SecondMedic earns from one-off purchases (a test, a consult, a medicine). The goal is a continuous
relationship in which every patient moves around the **Holistic Health Loop**, and CRTracker coordinates it.
Build the first version of that relationship layer on top of the existing patient and follow-up data.

The loop has 7 stages, in this order (use these exact codes):
1 PREVENTION, 2 EATING_WELL, 3 DIAGNOSTICS, 4 CONSULTATIONS, 5 MEDICATIONS, 6 CHRONIC_CONDITIONS, 7 ONGOING_MONITORING.
(The slide numbers two stages "2"; use the order above.)

## What to build

### 1. Care touchpoints (one longitudinal record per patient)
- New table `care_touchpoints`: id, patient_id (FK patients), stage (one of the 7 codes), service_code,
  occurred_on (date, IST), source (AUTO | MANUAL), ref_entity + ref_id (e.g. "report", 12),
  amount_inr (nullable int, admin-only), health_hub_id (nullable), created_by, created_at.
  Unique on (patient_id, ref_entity, ref_id, stage), so automatic syncing is idempotent.
- AUTOMATIC touchpoints, derived from existing data. Write one function, `sync_touchpoints(db, patient_id)`, called after
  the report pipeline, after a doctor completes a follow-up, and from a backfill script in `backend/scripts`:
  - every Report linked to the patient → DIAGNOSTICS (occurred_on = collected_on)
  - Appointment DONE, or a follow-up reaching DOCTOR_DONE → CONSULTATIONS
  - each active PatientBucket → CHRONIC_CONDITIONS
  - a RetestRecommendation that was ordered, or a doctor-set `next_followup_on` → ONGOING_MONITORING
  Respect merged patients (`merged_into_id`).
- MANUAL touchpoints are logged by doctors/admins by picking from an admin-editable `care_services` setting
  [{code, name, stage, default_amount_inr}]. Seed DIETITIAN_PLAN → EATING_WELL, PREVENTIVE_SCREEN → PREVENTION,
  PHARMACY_REFILL → MEDICATIONS, HOME_COLLECTION → DIAGNOSTICS, TELECONSULT → CONSULTATIONS.
  No free-text clinical notes and no drug names: catalogue codes only.
- Add the table to privacy export/erase.

### 2. Relationship status (deterministic)
Thresholds come from the setting `relationship_thresholds`:
- **NEW**: first touchpoint ≤ 30 days ago.
- **ACTIVE**: a touchpoint ≤ 90 days ago, and no overdue follow-up.
- **AT_RISK**: last touchpoint 90–180 days ago, or a follow-up past `due_on` and not done.
- **LAPSED**: no touchpoint for more than 180 days.
Use `today_ist()`.

### 3. Next best step (first matching rule; each has a clinical label and a neutral caller label)
1. CHRONIC_CONDITIONS but no ONGOING_MONITORING in the next or last 120 days → "Schedule retest"
2. An abnormal DIAGNOSTICS with no CONSULTATIONS after it → "Doctor consultation"
3. CHRONIC_CONDITIONS but no EATING_WELL → "Diet plan"
4. LAPSED or AT_RISK → "Re-engagement call"
5. Only DIAGNOSTICS, all normal → "Preventive screening plan"
Mark the rule table as needing clinical sign-off.

### 4. API (`backend/app/routers/relationship.py`, mirrored in `frontend/worker.js`)
- `GET /api/patients/{id}/relationship`: the stages with counts and last dates, the status and the next step.
- `POST /api/patients/{id}/touchpoints` and `DELETE /api/touchpoints/{id}` (manual touchpoints only).
- `GET /api/relationship/summary` (admin): active / at-risk / lapsed counts, 12-month retention, average distinct stages per
  active patient, annual contribution per active patient, and stage coverage %.
Roles:
- admin: everything.
- doctor: the full loop, without amounts.
- caller: name, masked mobile, status, last touchpoint date and the neutral next step only.
- anonymous: nothing.
Audit views and edits without PII.

### 5. Frontend
- Patient view: a "Care loop" card (a 7-stage stepper with counts and dates, a status badge, the next step, a timeline, and an
  "Add service" form).
- Callers: a status badge and the neutral next step only.
- Dashboard: "Relationship" stat tiles.
- Settings: the service catalogue and the thresholds.
- Desktop and 375 px.

## Tests
- `sync_touchpoints` is idempotent.
- Status at the boundary days.
- Next-step rules.
- Per-role field filtering.
- Audit entries.
- The RBAC matrix.
- Worker parity.
