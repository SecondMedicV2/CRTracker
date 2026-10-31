# Acceptance criteria (Part 16.3), checked on 31 Oct 2026

**Result: 19 of 20 met or met with a stated limit. AC17 is NOT met.**
"Test" means an automated test in `backend/tests/` that passes (`python -m pytest`, 121 tests). Everything was tested with the
**mock lab** and **synthetic reports**: no real Thyrocare data, no real PDFs, no Postgres.

| AC | Status | Evidence | Limit to know about |
|---|---|---|---|
| 1 Paste 100 order IDs, summary, re-paste = no duplicates | **Met** | `test_ac1_paste_100_then_repaste_creates_no_duplicates`; 100 IDs import in 0.06 s | |
| 2 CSV/XLSX import with column mapping | **Met** | `test_ac2_csv_with_column_mapping`, `test_ac2_xlsx_and_bad_file_type`; Import screen | |
| 3 "Pull now" via the Thyrocare adapter, failures per order don't stop the batch | **Partly** | `test_ac3_pull_now_via_mock_lab_and_failure_does_not_stop_batch` (mock lab) | **The real Thyrocare adapter is a placeholder.** Their API documents and credentials are still needed (Q2) |
| 4 Each order reaches READY or a clear failure with Retry | **Met** for structured reports | `test_ac4_retry_then_failed_with_reason_then_manual_retry`, `test_pdf_report_fails_extraction_with_reason_and_can_retry` | **PDF reports always end as "failed to read" (with Retry)** until an AI/OCR reader is chosen (Q3) |
| 5 Out-of-range uses the report's own range, then the admin table | **Met** | `test_report_range_wins_and_exclusive_bound`, `test_fallback_table_when_no_report_range` | Starter ranges need doctor sign-off |
| 6 Normal/abnormal; abnormal patients in buckets with a visible reason | **Met** | `test_ac7_diabetes_due_90_days_after_collection_and_ac6_visible_reason`, `test_buckets_multiple_other_and_direction_filter` | No hypertension bucket (Q4); cancer markers only trigger on HIGH |
| 7 Follow-up lists: tomorrow / week / 30 days / overdue; diabetes = 90 days | **Met** | `test_list_views_and_ordering`, `test_ac7_...` | |
| 8 Same name+age, different mobile = review; same name+gender+mobile = auto-link | **Met** | `test_ac8_same_name_and_age_different_mobile_triggers_review`, `test_exact_match_auto_links_across_spelling_variants` | Name matching is basic text similarity; tune on real names |
| 9 Retest score with breakdown and tier; LOW parked, not deleted | **Met** | `test_score_components_and_tier_boundaries`, `test_single_mild_abnormal_is_parked_with_starter_weights` | Owner decided to keep spec weights: a lone mild abnormal is parked (Q24) |
| 10 Call Card: scope + doctor script + caller script, schema-valid, no number outside the data | **Met for the built-in generator** | `test_ac10_card_has_all_three_parts_and_validates`, `test_grounding_rejects_invented_numbers_and_unknown_tests` | Scripts come from templates, **not from an AI model**. The optional AI adapter was never run against a live model |
| 11 Caller script never has a diagnosis, value or drug name | **Met** | `test_ac11_caller_script_safety_checks`, `test_bad_output_is_retried_twice_then_needs_review` | Word lists are a starter; a doctor must extend them |
| 12 Caller can't see clinical interpretation unless the flag is on | **Met** | `test_caller_matrix`, `test_roles_caller_sees_no_clinical_data_until_flag`, `test_callers_cannot_read_clinical_rule_sets` | |
| 13 Consent required before a BOOKED outcome | **Met** | `test_ac13_booking_needs_consent_then_creates_appointment` | |
| 14 Doctor queue: escalations first + unread caller comments | **Met** | `test_ac14_doctor_queue_escalation_first_with_unread_comments` | |
| 15 Unaccepted case reassigned after the timeout, logged | **Met** | `test_ac15_unaccepted_case_cascades_after_timeout_and_is_logged` | "Cascade" is our reading of the wording (Q9) |
| 16 Trend graph with every stored report, range band, clickable points | **Met** | `test_ac16_trend_has_every_stored_report_...`; checked in a real browser | Only reports held here (no Thyrocare history yet, Q2). One chart per test, not overlaid |
| **17 Original demo flow still works (manual upload → priority → doctor)** | **NOT MET** | | **The "Upload single report" screen (PDF + mobile + name + consent) was never built.** No prototype code existed in this workspace, and PDFs can't be read yet (Q3, Q17). The pieces it needs (consent, priority, doctor choice, doctor queue) exist, but there is no upload path for a lone PDF |
| 18 Audit log records every patient-data view and edit | **Met** | `test_audit_records_actions`, `test_views_are_audited_...`, `test_trend_access_and_audit`, export/erase tests | |
| 19 Scripts in English, Hindi, Hinglish; missing language falls back with a notice | **Met** | `test_ac19_three_languages_and_fallback_notice` | Hindi/Hinglish wording is machine-written: needs a native-speaker review (Q20) |
| 20 Admin edits ranges, buckets, intervals, weights, templates without a deploy; versioned | **Met** | `test_rules_seeded_pending_then_versioned_and_signoff` | Edited as raw JSON text on the Rules screen |

## Other things the spec asked for that are not delivered
- Single-report upload screen with the original demo flow (AC17 above).
- Real Thyrocare connection and PDF reading (blocked: Q2, Q3, Q17).
- Hypertension bucket and the critical-values table (blocked: Q4, Q5; the table is empty on purpose).
- Automated browser tests (Playwright, Part 16.2). Replaced by manual scripted browser checks.
- Real dialer, WhatsApp/SMS/email (Q12; in-app notifications only).
- Doctor availability/working hours when booking (Q14).
- Production hosting and monitoring (hosting not chosen).

## Performance (Part 15.5): met on this laptop
Measured with `python -m scripts.loadtest 2000` (mock lab, SQLite, a low-memory Windows PC; real lab and AI delays are not included):
- 100-order bulk import: 0.13 s. Re-pasting it: 0.04 s.
- 2,000 orders processed (download, read, flag, link patient, create follow-up): 68 s, **34 ms per order, flat as the data grows**
  (before the Phase 9 fixes it was 87 ms per order and rising).
- Every screen answered in under 0.4 s with 2,000 orders loaded; dashboard 0.04 s; 2,000-row CSV export 0.30 s.
- At 500 orders/day this is under 20 seconds of work a day. Real Thyrocare and AI calls will dominate.
