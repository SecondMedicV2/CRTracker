# Free deployment: Cloudflare + Supabase + Render

Everything here uses **free plans only**: no card is needed for Cloudflare Workers, Supabase Free or a Render free web service.
(Cloudflare R2 is deliberately not used: switching it on needs a payment method. Reports are kept encrypted in the database instead.)

```
 Browser ──► Cloudflare Worker "crtracker" (free)          Render free web service (Python API)      Supabase Free
              • serves the website (static files)  ──/api──►  • FastAPI, refuses anyone but the Worker ──► • PostgreSQL
              • adds the shared secret + visitor address       • does the background work when poked          (all data, incl.
              • cron every 2 minutes ──► POST /api/internal/tick ─┘                                           encrypted reports)
```
Why a cron instead of a worker process: free hosts put an idle service to sleep, which would stop a worker loop. The Cloudflare cron wakes
the API and the API does one round of work (fetch, read, flag, follow-ups, call cards, doctor reassignment, the 07:00 IST pull).
It also keeps Render and Supabase from going idle. Work happens within about 2 minutes of arriving.

## What is already done (by the build)
- Website built as static files and a Worker written for Cloudflare: `frontend/worker.js`, `frontend/wrangler.jsonc`, `frontend/public/_headers`.
- Backend made ready for it: only the Worker may call it (`EDGE_SECRET`), reports can be stored in the database (`STORAGE_BACKEND=db`),
  and `POST /api/internal/tick` does one round of background work.
- Proven on real PostgreSQL 18 (all 9 migrations and the whole test suite).

## What you do once (about 15 minutes, no payment)
### 1. Supabase (free database)
1. supabase.com > **New project** (Free plan). Use a new project, not one of your existing ones. Pick the region closest to India (Mumbai) and save the database password.
2. Project > **Connect** > **Session pooler** > copy the connection string. Turn it into the `DATABASE_URL` the app needs by
   changing the start to `postgresql+psycopg://` and putting the password in. Example shape:
   `postgresql+psycopg://postgres.<project-ref>:<PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
   If the password has symbols such as `@ : / #`, URL-encode them (`@` becomes `%40`).
3. Free projects are paused after 7 days without activity: the 2-minute cron keeps it active.

### 2. Render (free backend)
1. render.com > sign up with GitHub > **New** > **Blueprint** > choose the `SecondMedicV2/CRTracker` repository. Render reads `render.yaml`.
2. Fill the values it asks for (the build leaves them in a local file, see "Secrets" below): `DATABASE_URL` (step 1), `FILE_ENCRYPTION_KEY`,
   `EDGE_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (10+ characters), and `ALLOWED_ORIGINS` = the Cloudflare site address.
3. Deploy. When it is live, copy its address (like `https://crtracker-api.onrender.com`).

### 3. Cloudflare (website + cron)
Tell the build the backend address and it will set it and redeploy, or do it yourself:
```bash
cd frontend
# put the Render address in wrangler.jsonc under vars.BACKEND_URL, then:
npm run cf:deploy
```
Open the site address, sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then create real users.

## Secrets
Generated for you and saved **outside the repository** in `C:\Users\DELL\Documents\CRTracker-secrets.txt` (never committed, never printed in chat):
`EDGE_SECRET` (must be identical on Cloudflare and Render) and `FILE_ENCRYPTION_KEY`.
**Back that file up somewhere safe.** Losing `FILE_ENCRYPTION_KEY` means the stored reports can no longer be opened.

## Free-plan limits to know about
| Service | Limit | What it means here |
|---|---|---|
| Cloudflare Workers Free | 100,000 requests/day, 10 ms CPU per request | Pages cost nothing (static). Only `/api` calls and the cron count: plenty for a clinic team |
| Render free web service | Sleeps after 15 min idle (about 1 minute to wake), 750 hours/month, 512 MB RAM | The cron keeps it awake. First click after a long quiet spell can be slow |
| Supabase Free | 500 MB database, paused after 7 idle days | Stored reports share the 500 MB. Structured reports are about 2 KB each; **PDFs (about 200 KB) would fill it in weeks**, so move reports to object storage before PDFs flow at volume |
| Free tiers in general | No uptime promise, no backups you control | Not suitable for real patient data without a paid plan, backups and a legal review (docs/SECURITY.md) |

When you outgrow this: paid Render/Supabase plans need no code changes; only the settings above change.
