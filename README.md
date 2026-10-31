# CRTracker

Report Intelligence + Doctor Follow-Up CRM. Turns each blood-test report into a prepared follow-up: who to call, when, why,
what the doctor should say and what the caller should say.

**Start with [docs/HANDOVER.md](docs/HANDOVER.md)** (how to run it, who does what, what is still missing).

| Read this | To learn |
|---|---|
| [docs/HANDOVER.md](docs/HANDOVER.md) | Run it, operate it, what must happen before real patients |
| [docs/DEPLOY_FREE.md](docs/DEPLOY_FREE.md) | Free hosting on Cloudflare + Supabase + Render: what runs where and the setup steps |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | Each of the 20 acceptance criteria: met or not, with evidence |
| [docs/SECURITY.md](docs/SECURITY.md) | Security review, what was fixed, accepted risks, pre-launch checklist |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why things work the way they do (per phase) |
| [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) | Answers still needed from the business |
| [docs/PHASE0_PLAN.md](docs/PHASE0_PLAN.md) | The original plan |

## Quick start (local)
```bash
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements.lock      # Linux/Mac: .venv/bin/
cp ../.env.example .env                  # edit it; make FILE_ENCRYPTION_KEY with: python -m app.storage
.venv/Scripts/python -m alembic upgrade head && .venv/Scripts/python -m app.seed
.venv/Scripts/python -m uvicorn app.main:app --port 8000      # API
.venv/Scripts/python -m app.worker                              # background worker (second window, required)

cd ../frontend && npm install && npm run build && npm run start   # http://localhost:3000
```
Tests: `cd backend && .venv/Scripts/python -m pytest` (128 tests). Load test: `python -m scripts.loadtest 500`.

**Status:** hosting plan chosen (all free plans, see DEPLOY_FREE.md); the Cloudflare site/Worker is `frontend/` (`npm run cf:deploy`), the API is described by `render.yaml`. The Thyrocare connection and PDF reading are not finished
(waiting on documents and a provider decision); the app runs on a built-in mock lab and structured test reports.
