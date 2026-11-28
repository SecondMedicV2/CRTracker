# Prompt — Video 01: Five doors for reports (Capture)

Read `docs/ai-prompts/smart-diagnostics-video/00-video-context.md` first and follow it exactly.
**Depends on:** the existing intake (`intake.py`, `routers/imports.py`, `labs/`), extraction (`extract.py`,
`ai_insights.py`), identity matching (`identity.py`) and `ExpressNode` / `CorporateClient`.

## Goal
Reports can reach CRTracker through five doors, and every report — whatever the door — enters the same pipeline
(read → triage → context → match). Today only door 1 (our labs: LabTrace/Thyrocare/mock and manual upload) exists.
Note: the manual PDF upload currently returns a hard-coded example patient in `imports.py` (`preview_file`
and the PDF branch of `import_file`); replace that placeholder as part of this work.

## The five doors

| Code | Door | How it arrives | Who records it |
|---|---|---|---|
| OWN_LAB | Our labs | Existing lab pull / order import | System |
| WHATSAPP_PHOTO | A photo of any lab's report on WhatsApp | Inbound WhatsApp media webhook (behind `whatsapp_enabled`) | System, then a human checker |
| EXPRESS_NODE | Express Node counter | Counter staff upload a photo/PDF at a node | Counter staff (see prompt 05) |
| EMPLOYER_CHECK | Employer health checks | CSV/XLSX batch of results per corporate client (5 MB limit) | Admin |
| CONSENT_PULL | Consent-based record pull | **[CONFIRM]** the video says "a pack consent"; treat as ABHA/ABDM consent. Build only the interface and a stub adapter. | System after patient consent |

## What to build
1. **Report source**: add `source_door` (the codes above) and `source_ref_id` (node / corporate client) to `Report`
   (and `Order` if needed). Migration + backfill existing rows to `OWN_LAB`. Show the door on report lists.
2. **One intake function** `intake.receive_report(db, door, file_or_rows, meta)` that stores the file encrypted
   (`storage`), creates or matches the patient (`identity`), creates the report in `PENDING_READ`, and queues
   extraction. Every door calls it; no door has its own pipeline.
3. **WhatsApp photo door**: a provider interface for inbound media (`/api/v1/webhooks/whatsapp` with signature
   verification, rate limit, 5 MB limit, image/PDF types only). Match the sender's mobile through the keyed mobile
   hash; an unknown number creates an identity review, never a silent new patient. Reply only with a neutral
   acknowledgement ("We have received your report. Our team will contact you."). Off unless `whatsapp_enabled`.
4. **Image reading**: extend extraction to images (photos are skewed and low quality). Values below the
   `extraction_min_confidence_pct` setting go to the existing human-checker review — never straight into triage.
5. **Employer health checks**: upload per corporate client, rows matched by employee id or mobile, each row becomes
   a report with `source_door=EMPLOYER_CHECK`. Employers later see aggregates only (small-cell suppression < 10).
6. **Consent pull**: `RecordPullProvider` interface + a stub that returns nothing; a consent record type
   `RECORD_PULL` in `Consent`; admin setting `consent_pull_enabled` (off). Mark the whole door **[CONFIRM]**.
7. **Worker parity** for the new routes (the webhook may return 503 on the edge if the Python backend is required —
   say so explicitly in the response).
8. **UI**: the import screen gets a door selector; reports list and patient view show the door; admin dashboard
   shows reports per door per day.

## Tests
- Each door creates a report through `receive_report` with the right `source_door`.
- WhatsApp: bad signature → 401; unknown number → identity review; oversized file → 413; switch off → 404/503.
- Low-confidence values go to human review and are not triaged.
- Employer batch: formula-safe export of errors, matching by employee id and mobile.
- No patient name or mobile number appears in logs, audit details or AI prompts.
- RBAC matrix updated in `test_security.py`.
