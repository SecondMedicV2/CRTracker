# Prompt — Page 17: Health Hub Care Plans (catalogue, enrolment and printable flyers)

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** pages 2–5 (programmes, for linking plans to programmes) and page 13 (`health_hubs`). It reuses the
page-15 `payments` if built, and otherwise creates the same `payments` table.

## Goal
Bring the Health Hub care plans (the "Ask at the counter today" flyers) into CRTracker:
- a **plan catalogue** with Essential and Plus pricing
- **doctor-assessed enrolment** ("Plan advised by our doctor after assessment")
- **entitlement tracking** for what's included
- **tracked measures** ("We track")
- **printable bilingual (English/Hindi) A5 flyers with a QR code**.

## The plans, exactly as on the flyers
Values marked **[CONFIRM]** are hidden or cut off in the document. Seed them as blank and list them in your summary for
me to fill in. Plans 01 and 05 are not visible in the document; "Lifestyle Weight Care" is probably 05 **[CONFIRM]**.

| No. | Line | Plan (EN / HI) | For | What's included (Plus) | Plus period | We track | Essential | Plus | Charged separately / notes |
|---|---|---|---|---|---|---|---|---|---|
| 02 | SM SUGAR CARE | Prediabetes Care / प्री-डायबिटीज़ केयर | If your sugar or HbA1c is borderline, act before it becomes diabetes | Doctor consultation and a personal risk-reduction plan; 3 dietitian sessions with simple, local food swaps; Activity coaching that fits your day; HbA1c test at the start; repeat at month 6 on the annual plan; Regular check-ins on WhatsApp | per quarter | HbA1c, Weight, Waist | ₹1,499 / quarter | ₹2,499 / quarter · ₹7,999 / year | Tests beyond the plan are charged separately. Essential covers doctor review and care-coordinator support. Plan advised by our doctor after assessment. T&C apply. |
| 03 | SM HEART CARE | Blood Pressure Care / ब्लड प्रेशर (बीपी) केयर | For adults with high blood pressure (hypertension) | 2 doctor reviews and medicine review; Dietitian session on salt and everyday food; Baseline blood tests and ECG; Home BP log on WhatsApp, reviewed by our team; Medicine refill reminders and home delivery | per quarter | Home BP, Clinic BP, Medicine adherence | ₹1,499 / quarter | ₹2,499 / quarter · ₹7,999 / year | Charged separately: medicines, BP monitor, echocardiogram. Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply. |
| 04 | SM HEART CARE | Cholesterol & Heart Care / कोलेस्ट्रॉल और हृदय केयर | For high cholesterol or triglycerides, and anyone who wants to lower their heart risk | 2 doctor reviews and medicine review; Dietitian session for heart-healthy eating; Lipid profile at the start and at follow-up; Heart-risk assessment and ECG; Cardiologist referral when needed | per quarter | Cholesterol & lipids, Heart-risk score, Blood pressure | ₹1,499 / quarter | ₹2,499 / quarter · ₹7,999 / year | Charged separately: medicines, TMT, echocardiogram, specialist consultations. Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply. |
| 05 [CONFIRM] | SM WEIGHT CARE | Lifestyle Weight Care / [CONFIRM Hindi: "… नियंत्रण केयर"] | [CONFIRM start] …healthy, lasting weight loss through food, activity and support | [CONFIRM n] doctor reviews; [CONFIRM n] dietitian sessions with a meal plan you can follow at home; A personal activity plan; Metabolic blood tests at the start; Monthly weigh-ins and progress check | per quarter | Weight, Waist, Blood pressure | ₹[CONFIRM],499 / quarter | ₹3,999 / quarter · ₹12,999 / year | [Tests] beyond the plan are charged separately. Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply. |
| 06 | SM WEIGHT CARE | Medical Weight Management / मेडिकल वज़न प्रबंधन | A doctor-supervised programme. Eligibility is assessed in person by our doctor. | (per quarter, single tier) In-person medical assessment and eligibility check; Monthly doctor reviews, with treatment only if suitable for you; 4 dietitian sessions, with protein and nutrition support; Strength and activity guidance; A maintenance plan to keep your progress | per quarter | Weight, Waist, HbA1c, Side effects | — (no Essential) | Programme fee ₹5,999 / quarter · ₹19,999 / year | Medicine, if prescribed, is charged separately. Medicines and tests beyond the plan are charged separately. Not every patient is eligible for medical treatment; our doctor decides after assessment. Results vary. T&C apply. |
| 07 | SM WEIGHT CARE | Diet & Nutrition Plan / डाइट और पोषण प्लान | For anyone who wants a personal diet plan from a qualified dietitian | 4 one-to-one dietitian sessions; Body composition analysis; A meal plan that suits your food, budget and routine; Weekly check-ins on WhatsApp; Doctor input when your health needs it | per quarter | Weight, Waist, Diet goals | ₹999 / quarter | ₹1,999 / quarter · ₹6,499 / year | [CONFIRM: footer hidden; ends "…dietitian consultations"] |
| 08 | SM THYROID & HER CARE | Thyroid Care / थायरॉइड केयर | For underactive thyroid (hypothyroidism) | 2 doctor reviews and medicine dose review; Thyroid tests at the start and after any dose change; Home sample collection; Symptom review: energy, weight, sleep, mood; Endocrinologist referral when needed | per quarter | Thyroid levels, Symptoms, Weight | ₹999 / quarter | ₹1,799 / quarter · ₹5,999 / year | Charged separately: medicines, thyroid ultrasound. Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply. |
| 09 | SM THYROID & HER CARE | PCOS Care / पीसीओएस केयर | For women with PCOS: periods, weight and long-term metabolic health | Consultation with our partner gynaecologist or endocrinologist; 2 doctor follow-up reviews; 4 dietitian sessions for PCOS-friendly eating; Blood tests as advised by your doctor; Cycle tracking and private WhatsApp support | per quarter | Cycle regularity, Weight, Metabolic markers | ₹2,499 / quarter | ₹3,999 / quarter · ₹12,999 / year | Charged separately: pelvic ultrasound, additional hormone tests, fertility care. Essential covers [doc]tor reviews and care-coordinator support. T&C apply. |
| 10 | SM LIVER CARE | Fatty Liver Care / फैटी लिवर केयर | For fatty liver seen on ultrasound, or raised liver enzymes | 2 doctor reviews; 3 dietitian sessions for a liver-friendly diet; Liver and metabolic blood tests; Liver scarring (fibrosis) risk score; Gastroenterologist referral when needed | per quarter | Weight, Liver enzymes, Fibrosis risk | ₹1,999 / quarter | ₹2,999 / quarter · ₹9,999 / year | Charged separately: ultrasound, liver elastography (FibroScan). Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply. |
| 11 | SM SENIOR CARE | Senior Care / वरिष्ठ नागरिक केयर | For adults 60+ managing several conditions, and families caring for them from near or far | Complete health and daily-function assessment; Monthly doctor review, by video or at home; Full medicine review and refill management; Falls-risk and home-safety check; Monthly health update for the family | per month | Medicines, Falls, Hospital visits, Daily function | ₹1,999 / month | ₹3,499 / month · ₹34,999 / year | Charged separately: home nursing, medical devices, specialist consultations. Essential covers doctor reviews and care-coordinator support. T&C apply. |
| 12 | SM MOVE | Joint, Back & Mobility / जोड़ और कमर दर्द केयर | For long-standing knee, hip, back or neck pain | Doctor assessment of your pain and movement; 8 physiotherapy sessions, at the hub or at home; A home exercise programme you can keep doing; Weight and diet support where it helps your joints; Orthopaedic referral when needed | per 8 weeks | Pain score, Movement & function | ₹3,999 / 8-week block | ₹5,999 / 8-week block | Charged separately: X-ray and scans, injections, braces and supports. Essential covers fewer physiotherapy sessions; ask our team. Plan advised by our doctor after assessment. T&C apply. |

Common flyer elements: SecondMedic logo with "Consistency, Reliability & Accuracy"; "HEALTH HUB CARE PLAN"; a
coloured header with the plan number, line and icon; "WHAT'S INCLUDED · PLUS, PER <period>"; "WE TRACK" chips;
"Ask at the counter today" / "काउंटर पर पूछें"; an Essential price box; a Plus "BEST VALUE" price box; a QR code box;
footnote.

## What to build

### A. Plan catalogue (`care_plans` table, admin-managed; prices are commercial, not medical)
Fields:
- `number`, `code` (e.g. CP02_PREDIABETES), `line`, `name_en`, `name_hi`, `for_text`, `colour`, `icon`
- `tiers`: [{tier ESSENTIAL|PLUS|PROGRAMME, price_inr, period QUARTER|MONTH|BLOCK_8W|YEAR, annual_price_inr}]
- `inclusions_plus` (list of text), `essential_covers` (text)
- `entitlements`: structured units per period, e.g. DIETITIAN_SESSION ×3, DOCTOR_REVIEW ×2, PHYSIO_SESSION ×8, HBA1C_TEST ×1,
  ECG ×1, LIPID_PROFILE ×2, HOME_COLLECTION. Essential entitlements are not itemised on the flyers, so make them
  **[CONFIRM]** apart from "doctor reviews and care-coordinator support".
- `tracked_measures` (codes: WEIGHT, WAIST, HBA1C, HOME_BP, CLINIC_BP, MED_ADHERENCE, LIPIDS, HEART_RISK, BP,
  THYROID_LEVELS, SYMPTOMS, CYCLE_REGULARITY, METABOLIC_MARKERS, LIVER_ENZYMES, FIBROSIS_RISK, MEDICINES, FALLS,
  HOSPITAL_VISITS, DAILY_FUNCTION, PAIN_SCORE, MOVEMENT_FUNCTION, DIET_GOALS, SIDE_EFFECTS)
- `charged_separately` (list), `footnote`, `qr_url` (configurable; the document only shows a "[QR CODE]" placeholder,
  so the target is a business decision), `linked_programs` (programme codes from pages 2–5, e.g. CP02 → DIABETES_MGMT/
  WEIGHT_PLAN, CP03 → HYPERTENSION_MGMT, CP04 → CARDIAC_RISK_MGMT, CP06 → GLP1_WEIGHT_ASSESSMENT, CP07 → DIET_PLAN,
  CP08 → THYROID_MGMT, CP09 → PCOS_MGMT, CP10 → LIVER_HEALTH, CP11 → SENIOR_CARE, CP12 → FITNESS_PLAN), `active`.
- Seed all plans from the table above.

### B. Enrolment flow
- `plan_enrollments`: patient_id, plan_code, tier, status (SUGGESTED → DOCTOR_ASSESSED → ENROLLED → ACTIVE →
  RENEWAL_DUE → ENDED | DECLINED | NOT_ELIGIBLE), health_hub_id, assessed_by_doctor_id, assessed_on, period_start,
  period_end, price_inr, payment_id, eligibility_note_code.
- When an accepted programme (pages 2–6) has a linked plan, suggest the plan.
- **"Plan advised by our doctor after assessment"**: ENROLLED needs DOCTOR_ASSESSED first. Medical Weight Management
  (06) also needs an explicit "eligible" decision, and must record NOT_ELIGIBLE with a reason code when it is not.
- Counter payment is recorded at enrolment (reuse page-15 `payments`).
- Renewal: a caller task 7 days before `period_end`.
- Entitlement usage: consume units from `care_touchpoints`. Show used/included, and warn on overuse.
- **Tracked measures**: show the enrolment's measures as a mini dashboard, fed by labs, `home_readings` and health
  profile entries. Missing data shows "not recorded yet".

### C. Printable flyers
- Route `/(admin)/care-plans/[code]/flyer` renders an A5 portrait flyer that reproduces the layout above, bilingual
  EN/HI, in the plan colour, with a QR code generated client-side from `qr_url` (use a pinned, well-known QR library).
  It must print cleanly (print CSS) and download as PDF through the browser's print. An admin can print the full set.

### D. Privacy and roles
- Plan names reveal conditions (e.g. "PCOS Care", "Thyroid Care"), so **callers see only "Health Hub care plan <number>"**
  plus status, dates and price. Doctors and admins see everything.
- Counter staff (caller role) can record a payment for an enrolment that a doctor has already assessed.
- Add the tables to privacy export/erase. Audit enrolment and payment changes (codes only).
- Edge parity in `frontend/worker.js`.

### E. Admin screens
- Catalogue editor (all fields, bilingual, preview of the flyer).
- Enrolments list with filters (hub, plan, status).
- Revenue per plan and hub (feeds the page 13/14 dashboards).
- A list of [CONFIRM] fields still missing.

## Tests
- Seed data matches the table, prices included.
- The enrolment state machine (no ENROLLED without DOCTOR_ASSESSED; Medical Weight Management eligibility).
- Entitlement consumption.
- The renewal task date.
- The caller sees "Health Hub care plan <number>" only.
- The flyer route renders for every plan, and the build passes.
