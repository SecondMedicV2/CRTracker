# Prompt — Page 8: AMI Automated Follow-up Journey (Day 0 → Day 92)

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** pages 2/6 (recommendations) and page 7 (retest windows). Where those are missing, use the
existing follow-up due date and mark the step "waiting for data".

## Goal
Each abnormal report starts a **care journey**: a timeline of steps, each with an "AMI action" (what the system
does) and a "SecondMedic service" (who delivers it). The system moves the patient along automatically,
creates tasks for staff, and (once a patient channel exists) sends reminders.

## The journey, exactly as in the document

| Day | Step code | AMI action | SecondMedic service |
|---|---|---|---|
| Day 0 | D0_ANALYSED | Diagnostic report uploaded and analyzed | Report interpretation |
| Day 1 | D1_RECOMMEND | Personalized health recommendations | Doctor/dietitian consultation |
| Day 7 | D7_ACTIVATION | Check care-plan activation | Pharmacy, nutrition or chronic care |
| Day 30 | D30_ADHERENCE | Adherence and symptom follow-up | Care management |
| Day 60 | D60_PROGRESS | Review progress and upcoming monitoring | Care coordinator |
| Day 75 | D75_RETEST_NOTICE | Notify patient of clinician-approved retest | Diagnostics booking |
| Day 90 | D90_RETEST | Perform scheduled retesting | Perform collection: Home collection or Health Hub |
| Day 91 | D91_COMPARE | Compare old and new results | AMI longitudinal analysis |
| Day 92 | D92_UPDATE_PLAN | Update care plan following clinical review | Relevant SecondMedic services |

(The slide has typos: "Diagnostics bosults" should read "Diagnostics booking", and the Day-91 service column
says "And new results" where it means "AMI longitudinal analysis". Use the corrected wording above.)

## What to build

### A. Journey template (`journey_templates` RuleSet; doctor sign-off)
Template `STANDARD_92`, with one entry per step: `code`, `day_offset`, `ami_action`, `service`, `clinical_label`,
`caller_label` (neutral), `owner` (SYSTEM | DOCTOR | DIETITIAN | CALLER | COORDINATOR), `channel`
(AUTO | TASK | CALL | PATIENT_MESSAGE), `completes_when` (an event, see below) and `skip_if` (e.g. skip
D7_ACTIVATION when nothing was accepted).
**Day 75 and Day 90 are not fixed**: when a page-7 retest window exists, D90_RETEST = the window start, and
D75_RETEST_NOTICE = the protocol's reminder day (or the window start minus 15 days). Keep 75/90 as the default.

### B. Journey instances
- `care_journeys`: id, patient_id, followup_id, template_code, template_version, started_on (= report date),
  status (ACTIVE | COMPLETED | STOPPED), stop_reason.
- `journey_steps`: journey_id, step_code, due_on, status (PENDING | DUE | DONE | SKIPPED | OVERDUE),
  completed_on, completed_by, completion_event, task_ref.
- Start a journey when a follow-up is created for an abnormal report. Only one active journey per patient
  per condition group: a newer report restarts the journey and closes the old one as "superseded".

### C. Automatic step completion (events that already exist or come from earlier pages)
- D0: report status READY and analysed.
- D1: recommendations generated **and** a doctor/dietitian consultation done (Appointment DONE or follow-up DOCTOR_DONE).
- D7: any `program_recommendations` ACCEPTED or ENROLLED, or a plan enrolment (page 17).
- D30 / D60: a caller or coordinator logs the call outcome (adherence: TAKING | MISSED | STOPPED; symptoms:
  BETTER | SAME | WORSE). Store the outcome as codes only. A WORSE or STOPPED outcome creates a doctor task.
- D75: retest reminder delivered (a call logged or a patient message sent).
- D90: a new report for the same patient containing the retest tests, or a booking recorded (Home or Health Hub, page 12).
- D91: an automatic comparison of the old and new values is created (reuse `trends.py`; page 10 builds the display).
- D92: the doctor reviews and updates the plan (new recommendations accepted, next retest set).

### D. Scheduler
A daily job in `backend/app/worker.py` and the Worker `scheduled()` cron (IST):
- marks steps DUE or OVERDUE
- creates caller tasks for CALL steps and doctor `Notification`s for DOCTOR steps
- sends PATIENT_MESSAGE steps through the messaging layer (E).
It must be idempotent.

### E. Patient messaging layer (channel-agnostic)
- `outbound_messages`: patient_id, template_code, channel (WHATSAPP | SMS | CALL_TASK), status, sent_at,
  provider_ref, error. Templates live in a `message_templates` RuleSet, in English and Hindi. **Templates
  never contain test values, condition names, medicine names or programme names.** They only say that a
  follow-up, retest or plan check-in is due, plus a call-back number.
- A `MessagingProvider` interface with a default `CallTaskProvider` (turns the message into a caller task).
  Add a `WhatsAppProvider` stub behind the setting `whatsapp_enabled=false`, with no live keys in code.
- Before sending: recorded `Consent` for messaging, not `do_not_call`, quiet hours 9:00–20:00 IST.

### F. UI
- Patient view and follow-up view: the horizontal timeline from the slide (icons, Day labels, two rows
  "AMI action" / "SecondMedic service"), with each node coloured by status and a hover that shows the dates.
  It becomes vertical on phones.
- Caller view: the same timeline with neutral labels only.
- Dashboard: journeys active / completed, steps overdue for each step, and the drop-off funnel D0→D92.
- Admin: edit the template with sign-off; message log.
- Full parity in `frontend/worker.js`.

## Tests
- A journey starts and step dates are computed, including from a page-7 window.
- Each completion event closes the right step.
- The scheduler is idempotent and IST-correct.
- Templates are checked to contain no clinical words (run them through `check_caller_safety`).
- Consent, DNC and quiet-hours guards work.
- A newer report supersedes the journey.
