# CRTracker – Phase 0 Plan (no code yet)

## 1. Goal in my words
After a Thyrocare blood report is delivered it "dies as a PDF". CRTracker turns each report into a follow-up:
the system (outbound, not patient-initiated) pulls serviced orders, extracts values, classifies Normal/Abnormal,
buckets abnormal patients by issue, places them on a timeline (default report date + 90 days), and scores
**retest potential**. For each due patient it produces a **Call Card**: (A) retest scope, (B) doctor script,
(C) caller script. A non-medical caller phones, pitches the *free* doctor follow-up, takes consent and books;
the doctor uses the card to recommend a retest. Callers never interpret results. Low-potential patients are
parked so no one's time is wasted. Flags are only an input; the output is scope + scripts.

## 2. Implementation plan (phases → Parts)
| Phase | Delivers | Parts |
|---|---|---|
| 1 Foundation | Repo, auth + 3 roles, DB + migrations, settings, audit log, seed data, admin shell, CI, `.env.example` | 3, 10, 15 |
| 2 Intake | Manual / CSV-XLSX / API-pull import, batch summary, idempotency, scheduler (07:00 IST), order status machine, `LabProvider` + Thyrocare adapter + mock | 5, 6.2 |
| 3 Extraction + analysis | PDF/JSON parse, alias + unit normalisation, validation, NEEDS_REVIEW screen, range engine, severity | 6, 7.1-7.2 |
| 4 Patients + identity | Name+gender+mobile key, near-match review queue, merge/unmerge, shared-mobile household | 9 |
| 5 Buckets + follow-ups | Bucket rules, due dates, list tabs, priority engine, retest score, LOW parking | 7.3-7.5, 8, 11 |
| 6 Call Card AI | `LLMProvider`, schema validation, guardrails (number/test/caller-script checks), languages, doctor edit/approve | 12 |
| 7 Workflows | Caller card, consent, outcomes, booking, comments, doctor queue, cascade/pilot, connect-doctor stub | 13.1-13.3 |
| 8 Trends + dashboard | Trend charts, dashboard, exports | 13.4, 13.6 |
| 9 Hardening | Security review, 500 orders/day perf, a11y, docs | 15, 16 |

**Task list:** each phase = schema → services → API (role-checked) → UI → tests → walkthrough. Acceptance criteria AC1-AC20
are mapped as: AC1-4 → P2, AC5-6 → P3/5, AC7/9 → P5, AC8 → P4, AC10-11,19 → P6, AC12-15 → P7, AC16 → P8, AC17-18,20 → P1/7/9.
Demo flow (AC17) is rebuilt in P3/P7 since no prototype code exists here.

## 3. Default stack (no existing codebase; confirm Q1)
Next.js + TS + Tailwind + Recharts · FastAPI + SQLAlchemy + Alembic · PostgreSQL · RQ/Redis workers · S3-compatible storage ·
`LabProvider`, `LLMProvider`, `TelephonyProvider` adapters · pytest + Playwright.
Ponytail note: to ship the 1–2 day first version fast I propose **Celery/RQ → RQ only**, **local-disk encrypted storage in dev**, and
no microservices. One repo, two apps (`backend/`, `frontend/`).

## 4. Assumptions for every [CONFIRM] (defaults, all configurable; logged in DECISIONS.md)
1. Caller cannot see clinical results (`caller_can_view_results=false`).
2. Scheduler pulls daily 07:00 IST.
3. Due date = collection date + bucket interval, fallback 90 days; 3 months is the *default*, not a hard minimum (escalations immediate).
4. Same mobile + different name/gender → separate patients, shared "household" tag.
5. Caller resolves duplicates on the call; admin can resolve from queue.
6. Retest-score weights and tiers (HIGH ≥65, MEDIUM 40-64, LOW <40) as in 11.4.
7. NORMAL patients: no call; yearly reminder OFF.
8. Max 3 call attempts over 7 days.
9. "Connect doctor now" = in-app notification + number to dial; no telephony.
10. Cascade = reassign after timeout (Escalation 4h, Routine 24h); admin pilot-mode doctor subset.
11. Notifications in-app only.
12. v1 recommends tests and records "ordered" manually; no ordering/payments.
13. HbA1c cut-offs per ADA (6.5 = diabetes range), pending doctor sign-off.
14. Thyroid etc. use lab range only. Retention: keep indefinitely with admin delete/export.

## 5. Contradictions and risks
- **HbA1c 6.5**: meeting said "pre-diabetic"; standard says diabetes range. Seeded standard values, needs doctor confirmation (Q6).
- **Caller identity-check vs. no-clinical rule**: caller resolves duplicates but must not see results; duplicate review shows only demographics, so OK, but the caller needs the name/age/order IDs.
- **Hypertension / cancer** can't be derived from blood values alone → blocked (Q4).
- **Cancer markers = ESCALATION** but critical-values table is empty by design → no invented values; warning banner shown.
- **Doctor "cascade"** wording contradicts itself (timeout vs. after success) → default supports both; needs answer (Q9).
- **Caller sees "non-clinical reason"** ("due for lipid profile review") still leaks the test category; confirm wording is acceptable (Q10).
- **PHI to LLM**: only age/gender/values sent; provider must be no-training (Q3). Free-text doctor edits never go back to the LLM with identifiers.
- **Retest scoring vs. clinical justification**: score is business-flavoured; tests only recommended if clinically justified, enforced by guardrail.
- **Timeline**: 1-2 days (CEO) is realistic only for Phases 1-3 with mock lab and synthetic PDFs; real Thyrocare layouts need the 10 sample PDFs.
- **Language quality**: LLM Hindi/Hinglish scripts need native-speaker review before use (Q20).
- **Legal**: DPDP Act consent wording needs legal review.
- Part 17.1 (OPD/fever "Hindujā" flow) assumed OUT of scope.
