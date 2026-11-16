# CRTracker handover guide

Report Intelligence + Doctor Follow-Up CRM. Reads patients' blood-test reports, finds who is due a follow-up, prepares a
Call Card (retest scope, doctor script, caller script), and runs the caller and doctor workflow around it.
Status of every promised feature: `ACCEPTANCE.md`. Risks and security: `SECURITY.md`. Why things work the way they do: `DECISIONS.md`.
Questions still waiting for an answer: `OPEN_QUESTIONS.md`.

## 1. What is in the box
| Part | What it is |
|---|---|
| `backend/` | Python (FastAPI) service: the API, plus the background worker. SQLAlchemy + Alembic. 128 automated tests (also run on PostgreSQL). |
| `frontend/` | Next.js website (admin, caller and doctor screens). Talks to the API through the same address (`/api`). |
| `docs/` | This guide and the decision, security, acceptance and question logs. |
| `backend/scripts/loadtest.py` | Load test (500 / 2,000 orders). |
| `backend/app/privacy.py` | Export or erase one patient's data on request. |

Hosting plan (free plans only): website + cron on Cloudflare, API on Render, database on Supabase: see `DEPLOY_FREE.md`.

## 2. First run on a computer (for the free cloud setup see DEPLOY_FREE.md)
```bash
# 1. backend
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.lock        # Linux/Mac: .venv/bin/pip
cp ../.env.example .env                               # then edit it (see section 3)
.venv/Scripts/python -m app.storage                   # prints a key: paste it into FILE_ENCRYPTION_KEY
.venv/Scripts/python -m alembic upgrade head          # creates the database
.venv/Scripts/python -m app.seed                      # first admin + starter medical rules
.venv/Scripts/python -m uvicorn app.main:app --port 8000

# 2. the background worker (separate window) - REQUIRED, nothing is fetched or prepared without it
cd backend && .venv/Scripts/python -m app.worker

# 3. website (separate window)
cd frontend && npm install && npm run build && npm run start      # http://localhost:3000
```
Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`, then change that password and create real users (Users screen).
Tests: `cd backend && .venv/Scripts/python -m pytest`. Load test: `python -m scripts.loadtest 500`.

## 3. Settings you must understand (`backend/.env`)
See `.env.example` for every key, with comments. The important ones:
- `SECRET_KEY`, `FILE_ENCRYPTION_KEY`: **back both up, separately from the data.** Without the file key the stored reports cannot be opened. Changing `SECRET_KEY` logs everyone out and breaks mobile-number matching.
- `DATABASE_URL`: SQLite works for a trial. Use PostgreSQL for real use (`pip install` already includes the driver).
- `COOKIE_SECURE=true` and `ALLOWED_ORIGINS=<your site address>` once it is on HTTPS.
- `LAB_PROVIDER`: `mock` (made-up reports) until the Thyrocare connection is finished. `LLM_PROVIDER`: `template` (no AI).

Business settings (no restart needed) are on the **Settings** screen: pull time (07:00 IST), attempt limits, doctor timeouts (4 h escalation / 24 h routine),
pilot mode, whether callers can see results (off), whether callers need doctor-approved scripts (off), company name spoken in scripts, and MyOperator click-to-call credentials.
Admins can start a call from a patient detail page; the app blocks patients marked "Do not call" and confirms before sending the request. The API token is masked in Settings responses.
Set the MyOperator company ID, API token, and outbound virtual number in Settings before calling. Live calls incur provider usage and should only be tested against a number you control.

## 4. Who does what
| Role | Screens |
|---|---|
| **Admin** | Dashboard, import orders, orders, reports, patients, duplicate review, follow-ups, users, doctors, rules, settings, audit log |
| **Caller** | Follow-ups (their queue), caller card (script, consent, outcome, booking, comments, escalation request, connect doctor), duplicate review. **No clinical data.** |
| **Doctor** | My queue, follow-ups and Call Card (edit/approve), reports, patients, trends, notifications |

## 5. Day-to-day
1. Orders arrive by pasting IDs, uploading CSV/XLSX, or the daily pull at the set time (mock lab only for now).
2. The worker fetches, reads and flags each report, links it to a patient (or asks a person to confirm a possible duplicate), and creates the follow-up.
3. Admin watches **Dashboard → "Needs attention"**: failed downloads (Retry on the Orders screen), reports needing review (fix on the Reports screen), duplicate checks waiting.
4. Callers work **Follow-ups**; doctors work **My queue**. Unaccepted cases move to the next doctor automatically.
5. Doctors approve Call Cards (optional unless the setting requires it) and record outcomes and test recommendations.

## 6. Medical content: must be signed off by a doctor
Normal ranges, bucket rules, severity cut-offs, score weights, script wording and the forbidden-word lists are **starter content** in the **Rules** screen.
Each shows "pending sign-off" until a doctor presses *Record doctor sign-off*. Any edit creates a new version that needs sign-off again.
The critical-values table is **empty on purpose**; no hypertension bucket exists. Do not use for real patients until a doctor has reviewed everything.

## 7. Operations
- **Backups:** back up the database and the `STORAGE_DIR` folder together, plus the two keys, separately and encrypted.
- **Worker health:** if the worker stops, imports sit as QUEUED and no follow-ups or cards appear. It logs errors without patient data. Run it under a service manager that restarts it.
- **Patient asks for their data / deletion:** `python -m app.privacy export <patient id> --out file.json` and `python -m app.privacy erase <patient id> --yes`
  (erase is permanent and removes duplicates merged into that patient, their stored reports, follow-ups, call history and notifications; the audit log keeps a note that it happened).
  Find the id on the Patients screen address (`/patients/<id>`).
- **Adding a lab test name that isn't recognised:** edit the `aliases` rule set. Reports with unknown test names go to "needs review".
- **Rotating `SECRET_KEY`:** needs a re-hash of mobile lookups (not written). Do not rotate casually.
- **Migrations:** every release: `python -m alembic upgrade head`.

## 8. Before going live: decisions and work still outstanding
Blocking (from `OPEN_QUESTIONS.md`): Thyrocare API documents and credentials (Q2); which AI/OCR provider (Q3); 10+ real sample PDFs (Q17);
final bucket list and who signs rules off (Q4); critical values from a doctor (Q5); languages (Q11); provider account/API behavior validation (Q12); test catalogue/prices (Q13); doctors and hours (Q14);
hosting, retention and legal review (Q16); brand and pitch wording (Q19, Q20).
Work not done: the single-report upload screen (AC17), real Thyrocare adapter, PDF reading, Playwright browser tests, penetration test, Next.js 16 upgrade (see `SECURITY.md`).

## 9. Where things live in the code
`app/routers/*` the API · `app/pipeline.py` fetch→read→flag→patient→follow-up · `app/analysis.py` flagging · `app/extract.py` reading/validation ·
`app/identity.py` duplicate check · `app/followup.py` buckets, due date, score · `app/callcard.py` + `app/llm.py` Call Card and its safety checks ·
`app/assign.py` doctor assignment and cascade · `app/worker.py` background loop · `app/labs/` lab connections · `app/seed_*.py` starter medical content ·
`frontend/app/(admin)/*` screens · `backend/tests/` tests (start with `test_security.py` to see who can do what).
