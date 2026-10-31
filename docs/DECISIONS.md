# Decisions (defaults for [CONFIRM] items; all configurable via settings, none built yet)

| # | Decision | Default | Status |
|---|---|---|---|
| 1 | Caller sees clinical results | off (`caller_can_view_results`) | proposed |
| 2 | API pull schedule | daily 07:00 IST | proposed |
| 3 | Due date | collection date + bucket interval, else 90d; 3 months not a hard minimum | proposed |
| 4 | Shared mobile, different person | separate patients, household tag | proposed |
| 5 | Duplicate resolver | caller on call; admin from queue | proposed |
| 6 | Retest score & tiers | per spec 11.4 (HIGH ≥65, MEDIUM 40-64, LOW <40) | proposed |
| 7 | Normal patient re-engagement | none (yearly reminder off) | proposed |
| 8 | Max call attempts | 3 over 7 days | proposed |
| 9 | Real-time doctor connect | in-app notification + dial number | proposed |
| 10 | Cascade | timeout reassign (Esc 4h / Routine 24h) + pilot mode | proposed, Q9 open |
| 11 | Notifications | in-app only | proposed |
| 12 | Retest ordering | recommend + manual "ordered" tick | proposed |
| 13 | Starter medical content | ADA-style cut-offs, pending doctor sign-off | proposed |
| 14 | Stack | Next.js/FastAPI/Postgres/RQ; RQ not Celery | proposed, Q1 open |

## Phase 1 build notes
- Auth: httpOnly session cookie (JWT, 30 min, `session_minutes` setting); Next.js proxies `/api` so no CORS. Login rate limit is in-memory (single process) until Redis arrives.
- Passwords: stdlib scrypt, min 10 chars. No default admin password: set `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `.env` before `python -m app.seed`.
- DB: SQLite for dev/tests, Postgres via `DATABASE_URL` (+ `psycopg`). Only Phase 1 tables exist; each phase adds its own Alembic migration.
- Rules are versioned; any edit creates a new version and resets doctor sign-off. Critical values ship empty; HYPERTENSION bucket not seeded (blockers Q4/Q5).
- Tailwind v3 (not v4): v4's native engine crashed `next build` on Node 24 / Windows.
- Not yet done in Phase 1: Playwright e2e (nothing meaningful to click yet), field-level mobile encryption (no mobile data until Phase 2/4).

## Phase 2 build notes (intake)
- Background work is a DB-polling worker (`python -m app.worker`), not Redis/RQ: enough for ~500 orders/day, one fewer service. The 07:00 IST daily pull runs inside the same worker. IST is a fixed +05:30 offset (no DST).
- Reports are stored Fernet-encrypted under `STORAGE_DIR`; `FILE_ENCRYPTION_KEY` is required (`python -m app.storage` makes one).
- The Thyrocare adapter is a stub that returns a clear "not configured" error. Nothing is guessed until the API docs arrive (Q2). `LAB_PROVIDER=mock` is the default for dev.
- Fetch retries: 3 attempts (`fetch_max_attempts`), backoff 1 min then 4 min, then FAILED_FETCH with a Retry button.

## Phase 3 build notes (extraction + analysis)
- Structured lab JSON is used directly. PDF extraction is a stub that fails with FAILED_EXTRACT until an LLM/OCR provider is chosen (Q3); Retry is available.
- Canonical report shape is documented at the top of `app/extract.py`. The Thyrocare adapter must map into it once the response format is known.
- Aliases live in the versioned `aliases` rule set, so the separate `parameter_aliases` table from the spec was skipped. Existing databases keep their old alias version; new aliases (TSH, FT3...) need an admin edit or re-seed on a fresh DB.
- Confidence = 100 minus penalties (gender or age missing 30 each, unmapped test 10 each, etc). Below `extraction_min_confidence_pct` (80) goes to NEEDS_REVIEW.
- Flagging order: report's own range, then admin fallback table, then the lab's printed flag. Sex-specific ranges are skipped when sex is unknown. `<5.7` excludes 5.7. Severity = distance outside the limit as % of the limit: under 10% mild, under 25% moderate, otherwise severe (rule set `severity`, needs doctor sign-off).
- Callers get 403 on all report endpoints. Every report view and every correction is audit-logged (corrections log field names, not values). Mobile numbers are stored field-encrypted.
- Units are only normalised in spelling, never converted.

## Phase 4 build notes (patients + identity)
- Rules, in order: (1) same mobile + same normalised name + same gender = auto-link. (2) same mobile + similar name (>= `identity_name_similarity_pct`, 85) + same gender = review. (3) different or missing mobile + same gender + age within 1 year + same or similar name = review. (4) same mobile but a different person (different name or gender) = new patient, both tagged with a shared `HH-` household tag, no review.
- The age window is +/-1 year because stored age is the age at the report date and reports are months apart. Similarity uses Python difflib, which is crude for Indian-name spelling variants; revisit with real data.
- On a near match the new patient is created straight away and the order waits in `PENDING_IDENTITY` (not READY, so later phases must only use READY orders). "Same person" moves that patient's orders to the existing patient; "Different" releases the order. Unmerge (admin only) restores them from `moved_order_ids`.
- Who decides: admin and caller. Callers see only demographics, order IDs and report dates with the mobile masked (last 4 digits), never results. Doctors can search patients but not decide.
- Mobile numbers: stored encrypted for display and as an HMAC (keyed on `SECRET_KEY`) for matching and search. Rotating `SECRET_KEY` requires re-hashing; also `SECRET_KEY` rotation logs everyone out.
- Not done: orders that reached READY before Phase 4 (dev data only) have no patient. A backfill command is not written.
- Open: Q9.6 (Thyrocare stable patient ID or mobile) would add a stronger link key once the API is known.

## Phase 5 build notes (buckets, timeline, follow-ups, retest score)
- A follow-up is created when an order becomes READY (or when an identity review releases it). Only ABNORMAL reports get one; normal patients get none. One follow-up per report, so the same report is never called twice. Started follow-ups (stage past NOT_CALLED) are never changed by recompute; `POST /followups/recompute` re-applies edited rules to the rest.
- Buckets: each abnormal value maps to a bucket through the `buckets` rule set (any number per patient); unmatched abnormal values go to OTHER. A bucket can set `only_direction` (cancer markers count only when HIGH). Newer reports make older bucket rows inactive (kept as history).
- Due date = collection date + the smallest bucket interval (bucket value, else `default_interval_days` 90). Interval 0 (cancer markers) = due today. Escalation if a bucket is ESCALATION or a critical value is hit (critical table is empty until Q5).
- Score and tiers exactly as spec 11.4 (weights live in the `score_weights` rule set). Trend compares the deviation of each abnormal test with the patient's previous value of the same test (more than 1 point worse = worsening). Engagement bonus applies if the patient has any follow-up at stage RETEST_ORDERED.
- Parked = ROUTINE priority and LOW tier. Parked follow-ups are hidden from the queue and tabs but listed under "Low potential"; ESCALATION is never parked.
- Suppression: if a newer report already contains every test that was abnormal, the older follow-up is marked "A newer report already covers these tests" (in either order of arrival). This uses our own stored reports only; the Thyrocare lookup for newer orders is still open (Q2).
- Callers get a reduced row (name, masked mobile, due date, report age, stage, priority) and no buckets, scores, tiers or detail unless `caller_can_view_results` is on. Sort order everywhere: escalation, then HIGH/MEDIUM/LOW, then earliest due.
- "This week" = today through the next 7 days. Dates are in IST.

### Heads-up for the business owner
With the starter weights, a patient with a single mildly abnormal value scores 10 + 20 + 5 = 35 and is parked as LOW, even when the follow-up is due. A single moderate value reaches MEDIUM (45). That matches the spec as written but may park many "borderline" patients; the weights or the 40 cut-off can be edited in the `score_weights` rule set, and the owner decided on 31 Oct 2026 to keep the spec weights as written (Q24 resolved).

## Phase 6 build notes (Call Card)
- **No AI vendor chosen yet (Q3).** The default generator is `template` (LLM_PROVIDER=template): it fills the admin-editable `script_templates` rule set from the structured data, needs no key and is fully deterministic. An optional `anthropic` provider (LLM_PROVIDER=anthropic, ANTHROPIC_API_KEY, LLM_MODEL) exists behind the same interface but has NOT been run against the live API; its output goes through the same validators. Whichever provider is used must be on a no-training plan (record it here once chosen).
- The generator receives only age, gender, dates, values, flags, buckets, score and the test catalogue: never the patient name or mobile. Caller scripts keep `{patient_name}`, `{caller_name}`, `{company}` placeholders that are filled only when a caller opens the card.
- Guardrails run in code on every card: schema; every number must appear in the input; recommended tests must be catalogue tests with the catalogue name; the caller script may contain no digits, no diagnosis words and no drug words (lists in the `caller_script_forbidden` rule set, test names from the catalogue are allowed). Up to 3 tries; if it never validates the card is stored as NEEDS_REVIEW with the reasons and is never shown to callers.
- Every regeneration or doctor edit is a new immutable version (model, prompt version, input hash, editor stored). Only a DOCTOR can approve, only the latest VALID version. A doctor's edit still has to pass schema and caller-safety checks.
- `caller_script_requires_approval` (default OFF): callers may use a validated script before a doctor approves it, because it contains no clinical content. Turn it on to require approval first.
- The worker pre-generates cards for active, non-parked follow-ups due within `callcard_lead_days` (14). Parked (LOW potential) follow-ups get a card only on request.
- Languages: English, Hindi, Hinglish. A patient language with no template falls back to English with a visible notice. The Hindi and Hinglish wording is a machine-written starter and needs a native-speaker and doctor review (Q20) before real calls.
- Callers see: name, masked mobile, report age, a non-clinical reason ("Due for a follow-up on your Lipid Profile"), and the script. Reason text names test panels only.
- Dev database: `python -m app.seed` adds the new rule sets but does not change rule sets that already exist.

## Phase 7 build notes (caller and doctor workflows)
- **Consent first.** A booking (and a doctor marking a call done) is refused with 409 until consent is recorded for that follow-up. Consent stores who took it, the channel (caller or doctor call) and which call-card version was read out. One consent per follow-up; taking it again is a no-op.
- **Outcomes** (caller): BOOKED, CALL_LATER, NOT_REACHABLE, DECLINED, WRONG_NUMBER, DO_NOT_CALL. Every outcome is a call log. Max 3 attempts per follow-up in 7 days (settings); once the limit is hit by unreachable/call-later outcomes the follow-up is suppressed with "Maximum call attempts reached" and drops out of every list (it is not shown in Done either; an admin can still see it through the follow-up id). DO_NOT_CALL flags the patient and blocks calls and consent on all their follow-ups. A closed follow-up can't be called again.
- **Booking:** slot start in the future, 5-120 minutes, double-booking the same doctor is refused. Naive times from the browser are read as IST and stored in UTC. There is no availability or working-hours model yet (Q14), so any free time is bookable.
- **Escalation request:** a caller's "Request escalation" (urgent symptoms) sets priority to ESCALATION immediately and sends an urgent notification; callers still cannot lower priority, only a doctor or admin can.
- **Comments:** caller comments are always visible to the caller thread. Doctor notes are hidden from callers unless the doctor ticks "Caller can read this" (keeps clinical remarks away from callers). A doctor opening the thread marks callers' comments read; the doctor queue shows the unread count.
- **Doctor queue** = cases assigned to that doctor that are booked, consented or escalations; order: escalation, retest potential, due date. Admin sees all or filters by doctor.
- **Assignment:** a new, non-parked follow-up is assigned automatically: language match first, then the doctor's priority order, then the lightest open load. With `pilot_mode` on, only doctors marked "In pilot" are eligible.
- **Cascade (Q9 still open, default reading):** a case that needs a doctor and is not accepted within 4h (escalation) or 24h (routine) moves to the next eligible doctor; nobody is asked twice in a round; after a full round it starts over; accepted cases are left alone. Every move is audit-logged and notified. The worker runs it.
- **Connect doctor now:** in-app urgent notification to the doctor plus the doctor's phone number shown to the caller (`TelephonyProvider` interface with a manual dialer; real dialer is Q12). Notifications fall back to the admins when a doctor has no login.
- **After the call:** doctor records DOCTOR_DONE (optionally recommending catalogue tests and a next follow-up date) or asks the caller to re-contact; marking a recommendation "ordered" is a manual tick and moves the stage to RETEST_ORDERED (which earns the engagement bonus on that patient's next score).
- **Migration 0007** adds NOT NULL columns with server defaults so it works on a database that already has doctors and follow-ups.
- Not done: no calendar view, no SMS/WhatsApp/email notifications (in-app bell only, polled every 30 s), no way yet to un-suppress a given-up follow-up.

## Phase 8 build notes (trends, dashboard, exports)
- **Trend graphs** use every READY report we hold for the patient (reports held for identity review are excluded). Each test is drawn in its own panel (up to 4 at a time) rather than overlaid on one axis, because different units on one axis mislead; same-panel overlay can be added if wanted. Red dots are out of range, the green band is the latest printed range (else the admin table's normal band), tooltip shows date, value and order, and clicking a dot opens that report. Range selector: 1 year / 5 years / all. Charts are plain SVG (no chart library) so "Save image" exports a PNG exactly as shown; "Print / PDF" uses the browser's print (sidebar hidden).
- **History limit:** the page says "History starts from <first report date>: earlier reports are not in the system". Thyrocare's full past-order history is unknown (Q2); once it is, an importer can backfill and the graphs fill in.
- Trend and CSV views are staff-only (admin and doctor), audit-logged, and callers get 403.
- **Dashboard** (admin only, date range defaults to the last 30 days in IST): orders imported by status, reports ready, normal vs abnormal, patients per bucket (current), follow-ups due today / this week / overdue / parked, calls made by outcome, consent rate, bookings, doctor calls done, retests recommended and ordered, doctor load, and a "needs attention" strip for failed downloads, failed readings, reports to review and duplicate checks. Activity numbers (calls, consent rate) count what happened in the period; the funnel counts follow-ups *created* in the period and how far each got. "Called" means any call by a caller or admin that was not the doctor's own call.
- **CSV exports** (admin, doctor): the current follow-up list (up to 2,000 rows; includes patient names, mobile masked for doctors) and a patient's trend data. Cells that start with = + - @ get a leading apostrophe so a spreadsheet cannot run them as formulas. Every export is audit-logged.
- Not done: dashboard charts over time (only snapshot numbers and the funnel), scheduled/emailed reports, PDF generated server-side.

## Phase 9 build notes (hardening and handover)
- **Security review** found and fixed nine problems (list in `SECURITY.md`); the two most important: callers could read clinical rule sets, and callers got every doctor's phone number. The full route-by-role matrix is now a test (`tests/test_security.py`) and fails when a new route is added without deciding who may use it.
- **Cross-site protection:** state-changing browser requests need an `Origin` from `ALLOWED_ORIGINS` or the same host. Requests with no `Origin` (curl, scripts, tests) pass: they cannot be forged by another website.
- **Performance:** profiled a 1,000-order run and fixed four hot spots: the doctor-load count scanned the whole follow-up table for every doctor (now one grouped query plus an index), the duplicate check loaded every same-gender patient of a similar age (now an indexed query on columns only with a name-length pre-filter and cheap similarity bounds), the rule sets were re-read about four times per order (now once per request/worker loop), and the caller-safety check compiled about 40 patterns per script line (now two). Result: 87 -> 34 ms per order at 2,000 orders, and the per-order cost no longer grows with the table size. Migration 0008 adds the two indexes. The rule cache means an admin's rule edit is picked up by the worker on its next loop, not mid-loop.
- **Patient data export / erasure:** `python -m app.privacy export|erase <id>` (command line on purpose). Erase removes the patient, any duplicates merged into them, stored reports, follow-ups, call cards, calls, comments, consents, appointments, retest recommendations, notifications that name them; it leaves an audit line with counts only. Data retention default stays "keep until asked" (Q16).
- **Accessibility:** an automated scan (axe-core) of 17 pages in a real browser found real problems (unlabeled form controls, empty table headers, low-contrast amber text, chart dots nested inside an image role); all fixed, re-scan is clean. Also added: skip link, visible keyboard focus, chart data table for screen readers, labelled navigation. Not tested with an actual screen reader or on a phone.
- **Error states:** expired sessions go back to sign-in, network failures and validation problems show plain-language messages, generic error and not-found pages, Loading state.
- **Input limits:** names, phone, language are length-limited so Postgres does not reject them with a server error. PostgreSQL itself could not be run here (Docker not running); all 20 tables were only checked to compile for the PostgreSQL dialect. **Run the migrations and the test suite against a real Postgres before hosting.**
- **Dependency pinning:** `backend/requirements.lock` (exact versions from the tested environment, Python 3.14). `requirements.txt` stays loose for CI (Python 3.13).
- **Not done:** Playwright browser tests, penetration test, `pip-audit`, Next.js 16 upgrade, the AC17 single-report upload screen.
