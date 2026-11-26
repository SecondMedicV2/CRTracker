# Shared context for every "Smart Diagnostics 2026" build prompt

Every page prompt in this folder starts with "Read 00-shared-context.md first". This file holds the
rules, names and building blocks that all pages share, so that the pages fit together into one system.

## The repository

- Backend: Python / FastAPI / SQLAlchemy / Alembic in `backend/app`. Migrations are in
  `backend/migrations/versions`. They must run on both SQLite (local) and PostgreSQL (production).
- Frontend: Next.js / React / TypeScript / Tailwind in `frontend/app` and `frontend/components`.
  The staff screens are in `frontend/app/(admin)/…`, and the API client is in `frontend/lib/api.ts`.
- Edge API: `frontend/worker.js` is a Cloudflare Worker. When `BACKEND_URL` and `EDGE_SECRET` are set,
  it proxies `/api/*` to the Python backend. Otherwise it **is** the production API, backed by Cloudflare
  KV (`getStore` / `saveStore`). **Every new API route, role check, per-role field filter and rule must
  be implemented in both the FastAPI backend and `frontend/worker.js`, with identical behaviour.**
- Read these before planning: `AGENTS.md`, `PROJECT-CONTEXT.md`, `docs/SECURITY.md`, `docs/DECISIONS.md`,
  `docs/ACCEPTANCE.md`, `docs/OPEN_QUESTIONS.md`.

## Existing building blocks (reuse them; do not duplicate)

| Need | Use |
|---|---|
| Patients (deduplicated, `merged_into_id`), reports, report parameters | `backend/app/models.py`: `Patient`, `Report`, `ReportParameter` |
| Lab value flags LOW/HIGH/NORMAL and severity | `backend/app/analysis.py`, `backend/app/classify.py` |
| Canonical marker codes and aliases | `backend/app/biomarkers.py` (`find_marker`, `marker_code`) and the `aliases` rule set. Two code styles exist (e.g. `HBA1C`, `VITD`, `CREAT` in biomarkers.py, and `VITAMIN_D`, `CREATININE` in `seed_data.py` buckets). Check which one `ReportParameter.param_code` actually stores, and map through it. Never invent a parallel list. Add any missing marker (e.g. urine albumin / UACR) through the existing alias mechanism. |
| Condition groups ("buckets") on each report | `PatientBucket`, `Followup.bucket_codes`, the `buckets` rule set in `seed_data.py` |
| Follow-up queue, stages, due dates, priority, score | `backend/app/followup.py`, `Followup`, `backend/app/routers/followups.py`, `workflow.py` |
| Comparison with the previous report | `backend/app/trends.py`, `followup.param_trends` |
| Doctor actions: appointments, retest recommendations, next follow-up date | `Appointment`, `RetestRecommendation`, `Followup.next_followup_on` |
| Caller cards and caller-safety check (forbidden clinical words) | `backend/app/callcard.py` (`check_caller_safety`), the `caller_script_forbidden` rule set |
| Versioned medical rules that need a doctor's sign-off | `RuleSet` + `/api/admin/rules/{key}` (+ `/signoff`) and the admin **Rules** screen |
| Simple non-medical settings | `Setting` + `settings_store.get_setting` + `/api/admin/settings/{key}` |
| Role checks / audit | `security.require(...)`, `security.audit(db, request, user_id, action, entity, entity_id)` |
| Encryption of sensitive fields | `storage.encrypt_str` / `storage.decrypt_str` |
| Patient data export and erasure (privacy rights) | `backend/app/privacy.py` (`export_patient`, `erase_patient`). **Every new table that holds patient data must be added to both.** |
| IST dates | `timeutil.today_ist()`; store datetimes in UTC |
| Staff notifications | `Notification` |
| Background jobs | `backend/app/worker.py` (and the Worker `scheduled()` cron for the edge engine) |

## Names shared across pages (keep them consistent)

- `care_programs`: a RuleSet catalogue of the personalised programmes on pages 2–5 (code, document number,
  name, group, trigger rules, offering text, linked care-plan codes).
- `program_recommendations`: a table of programmes suggested for a patient/follow-up and what happened to each.
- `health_profiles`: a table of encrypted non-lab health data (vitals, history, symptoms, lifestyle,
  medicines, doctor-confirmed conditions), added on page 2.
- `care_touchpoints`: the patient's service history across the 7 Holistic Health Loop stages
  (PREVENTION, EATING_WELL, DIAGNOSTICS, CONSULTATIONS, MEDICATIONS, CHRONIC_CONDITIONS,
  ONGOING_MONITORING), added by the page-1 prompt. If a page needs it and it does not exist yet, create it
  with exactly that shape.
- `retest_protocols`: a RuleSet of retest windows for each finding (pages 7 and 11). `retest_tiers`: a RuleSet
  of the 5 urgency tiers (page 9).
- `care_journeys` / `journey_steps`: the scheduled Day 0 → Day 92 follow-up journey (page 8).
- `care_plans` / `plan_enrollments`: the Health Hub care-plan catalogue and enrolments (page 17).
- `memberships`: the Health360 plans and subscriptions (page 15).
- `health_hubs`, `express_nodes`, `corporate_clients`: delivery and acquisition channels (page 13).

## Non-negotiable rules (from AGENTS.md; tests must prove them)

1. **Server-side roles** on every route: `anonymous`, `caller`, `doctor`, `admin`. Add every new route to the
   route/role matrix in `backend/tests/test_security.py`.
2. **Callers never see clinical data**: no report values, trends, rules, condition or programme names that reveal
   a condition (e.g. "Diabetes Management Plan"), drug names or diagnosis details. A caller gets only the patient's name, the masked
   mobile number, dates, stage/status, and a **neutral label** (e.g. "Care plan follow-up call"). Every programme,
   plan, journey step and recommendation therefore has both a `clinical_label` and a `caller_label`, and the
   caller label must pass `check_caller_safety`.
3. **AI prompts** may contain only age, gender, test dates and numeric values. Never names or mobile numbers.
   Prefer deterministic rules. Use AI only where a page explicitly needs free-text generation.
4. **Audit** every view, create, edit, export and delete of patient data. Never write patient PII
   (names, phone numbers, test values, condition or medicine names) into logs or audit details.
5. **Medical content** (triggers, thresholds, retest windows, targets) goes into versioned `RuleSet`s and needs
   doctor sign-off before production use. Seed the values from the document, mark them "starter values,
   clinician to confirm", and never invent critical values.
6. **Patient-facing messages** (WhatsApp/SMS) need recorded consent (`Consent`), must respect
   `do_not_call`, and must never contain test values or condition/medicine names. They can only say that
   something is due, with a call-back number.
7. Spreadsheet exports escape cells starting with `=`, `+`, `-`, `@`. Uploads are limited to 5 MB.
8. UI must work at desktop width and at 375 px phone width, using the existing Tailwind styles and components.

## Working method for every page

1. Read the files above and the code you will touch. Then write a short plan (data model, migration,
   endpoints with roles, Worker changes, UI, tests) and **wait for my approval before coding**.
2. Implement backend → Worker parity → frontend → seed data → tests.
3. Done means:
   - `cd backend && .venv/Scripts/python -m pytest` passes.
   - `cd frontend && npm run build` passes.
   - The new screens work for admin, doctor and caller at desktop and phone width, with synthetic data only.
4. Finish with a summary: files changed, how to try it, and every item that needs clinical sign-off
   or a business decision.
