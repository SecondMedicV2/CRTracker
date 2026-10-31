# Security review (Phase 9, 31 Oct 2026)

This is a review by the build team of the code in this repository. It is **not** an independent penetration test and
it has **not** been reviewed against Indian data-protection law (DPDP Act 2023): that needs your legal team.

## What was checked
- Every API route against every role (anonymous, caller, doctor, admin): `backend/tests/test_security.py` pins the
  complete matrix, and fails if someone adds a route without deciding who may call it.
- Input handling (uploads, search, CSV), session handling, error handling, secrets, logging, exports, dependencies.
- The running web app in a browser: security headers, and an automated accessibility scan (axe-core) of 17 pages.

## Problems found and fixed in this phase
| # | Problem | Fix |
|---|---|---|
| 1 | Any logged-in user, **including a caller**, could read the clinical rule sets (normal ranges, bucket rules, score weights, critical values) | Rule sets are now readable by admin and doctor only |
| 2 | The doctor list gave every caller each doctor's phone number, login id and pilot flag | Callers now get names and languages only. The number appears only through "Connect doctor now" |
| 3 | Login took longer for a real email than an unknown one (lets someone discover which emails exist) | One password hash is always computed |
| 4 | An uploaded Excel file could expand to millions of rows in memory | Read stops after the row limit; uploads are limited to 5 MB while reading |
| 5 | No defence against another website making a signed-in browser change data | Browser requests that change data must come from the site itself (`ALLOWED_ORIGINS`), on top of SameSite cookies |
| 6 | No security headers; API answers could be cached | Added to API and web app (see below) |
| 7 | An unexpected server error could echo patient data in its message | A global handler logs only the error type and URL and returns a generic message |
| 8 | A weak `SECRET_KEY` was accepted in production mode | With `COOKIE_SECURE=true` the key must be 32+ characters |
| 9 | Failed-login audit rows could exceed the column size on Postgres | Email truncated to 60 characters |

## Controls in place
- **Passwords:** scrypt, at least 10 characters. Login is rate limited (5 failures per email and address per 15 minutes).
- **Sessions:** httpOnly, SameSite=Lax cookie, 30-minute expiry (setting). `Secure` when `COOKIE_SECURE=true`.
- **Roles:** enforced on the server for every route; the screens only hide what the server would refuse anyway.
- **Callers see no clinical data:** reports, trends, rules, exports, follow-up detail and the call card are refused.
  Their follow-up rows hold name, masked mobile, dates and stage. Scripts they read have no values, diagnoses, digits or drug names (checked by code).
- **Data at rest:** lab reports are encrypted files; mobile numbers are encrypted in the database with a separate keyed hash for matching.
  Names, ages and test values are **not** encrypted inside the database: use an encrypted disk or managed encrypted Postgres.
- **AI input:** only age, gender, dates and values are ever sent to a text generator. Never name or mobile.
- **Audit log:** logins, failed logins, every view of patient/report/trend/follow-up/call card data, every edit and export, reassignments and erasures.
  Patient data is never written to the audit log or server log.
- **Headers (web app):** Content-Security-Policy (own site only), X-Frame-Options DENY, nosniff, no-referrer, Permissions-Policy, HSTS in production.
  **API:** nosniff, DENY, no-referrer, `Cache-Control: no-store`.
- **Spreadsheet exports** escape cells that start with `= + - @`.

## Known limits and accepted risks (read before going live)
1. **Logout does not cancel the session token** - it only removes the cookie in that browser. A stolen cookie works until it expires (30 minutes). Disabling a user does cut access at once.
2. **Login rate limit is in memory** per server process. With several server processes or restarts it resets. Behind a proxy it sees the proxy's address unless the proxy forwards the real one. Put rate limiting at the proxy too.
3. **`npm audit` reports 2 issues (1 high) in PostCSS bundled inside Next.js 15.5.28.** Fixed only in Next 16 (a major upgrade). They involve processing hostile CSS at build time; this app only builds its own stylesheet. Plan the Next 16 upgrade; recheck with `npm audit`.
4. **Doctors can open any follow-up and patient, not only their assigned ones.** The spec did not ask for assignment-level restriction.
5. **No two-factor login.**
6. **`SECRET_KEY` doubles as the key for the mobile lookup hash.** Rotating it needs a re-hash job (not written).
7. **No malware scan** on uploaded files; only .csv/.xlsx are accepted and they are parsed, never executed.
8. **Python packages** are pinned in `backend/requirements.lock`. A vulnerability scan of them (e.g. `pip-audit`) was **not run** (tool not installed; slow connection here). Run it in CI.
9. **Test coverage gap:** there are no automated browser tests (Playwright). The browser checks were done by hand with a scripted scan.
10. **Not independently tested:** nobody has attacked this system. Commission a penetration test before real patient data goes in.

## Before real patient data goes in
- [ ] Host with HTTPS; set `COOKIE_SECURE=true`, `ALLOWED_ORIGINS`, a 32+ character `SECRET_KEY`, `FILE_ENCRYPTION_KEY`, Postgres.
- [ ] Encrypt the database disk / use managed encrypted Postgres; encrypted backups.
- [ ] Back up `FILE_ENCRYPTION_KEY` and `SECRET_KEY` separately from the data.
- [ ] Legal review of consent wording and data retention (Q16, DPDP Act).
- [ ] Doctor sign-off on every rule set (Rules screen shows what is pending).
- [ ] Run `pip-audit` / `npm audit`; plan the Next 16 upgrade.
- [ ] Penetration test.
