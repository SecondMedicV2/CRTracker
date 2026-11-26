# Prompt — Page 4: Specialized Clinical Programs (programmes 17–22)

Read `docs/ai-prompts/smart-diagnostics-2026/00-shared-context.md` first and follow it exactly.
**Depends on:** the page-2 prompt (engine and health profile) and the page-3 prompt.

## Goal
Add the specialised programmes. Every trigger here combines lab findings with symptoms, history or clinical
judgement, so all of them are **DOCTOR_CONSIDER** programmes: they appear only on the doctor's screen as
"Consider", and only a doctor can accept them. Several are sensitive (sexual health, fertility, weight-loss
medicine), so caller and audit privacy is critical.

## The programmes, exactly as in the document
(Doc number 17 is also used on page 3 for Bone Health, so use codes as keys.)

| Doc # | Code | Programme | Diagnostic trigger | Personalised offering |
|---|---|---|---|---|
| 17 | WOMENS_HEALTH | Women's Health Plan | Anemia, thyroid abnormalities, age and relevant symptoms. | Gynecology, nutrition and preventive screening. |
| 18 | PCOS_MGMT | PCOS Management Plan | Relevant metabolic findings plus clinical symptoms. | Gynecology/endocrinology review, diet and lifestyle program. |
| 19 | MENS_HEALTH | Men's Health Plan | Age, metabolic markers and clinical history. | Cardiometabolic, sexual and preventive health assessment. |
| 20 | FERTILITY_PRECONCEPTION | Fertility & Preconception Plan | Relevant reproductive investigations and medical history. | Specialist consultation, nutritional assessment and follow-up. |
| 21 | SENIOR_CARE | Senior Citizen Care Plan | Age, comorbidities, medication burden and functional needs. | Elder care, home visits and caregiver support. |
| 22 | GLP1_WEIGHT_ASSESSMENT | GLP-1 / Medical Weight-Loss Assessment | Obesity-related clinical criteria and metabolic risk. | Physician-led eligibility assessment, treatment monitoring and nutrition support. |

## What to build
1. **Health-profile additions** (encrypted, doctor/admin only): `reproductive` {planning_pregnancy (bool),
   trying_to_conceive_months, menstrual_pattern REGULAR|IRREGULAR|ABSENT, pregnancies}, a `caregiver` contact
   (name and relationship; the phone number is encrypted and needs consent), and `medicine_count` (until page 5
   adds the full medicine list). Add the reproductive tests (AMH, LH, FSH, PROLACTIN, TESTOSTERONE, BETA_HCG)
   as markers/aliases if they are missing.
2. **Programme entries** (group "Specialized clinical programs", mode DOCTOR_CONSIDER, loop stage
   CONSULTATIONS except SENIOR_CARE → CHRONIC_CONDITIONS). Caller labels are fully neutral, e.g. "Doctor
   consultation follow-up". They must never mention gender-specific, sexual, fertility or weight-loss medicine terms.
3. **Starter triggers** (mark each "starter value, clinician to confirm"):
   - WOMENS_HEALTH: gender F, together with (HB LOW, thyroid abnormal, or age ≥ 40), together with any relevant
     symptom (FATIGUE, IRREGULAR_PERIODS, HAIR_LOSS, WEIGHT_GAIN), or age ≥ 40 on its own for preventive screening.
   - PCOS_MGMT: gender F, age 15–45, symptom IRREGULAR_PERIODS (or menstrual_pattern IRREGULAR), together with
     a metabolic finding (HBA1C/GLU HIGH, TG HIGH, HDL LOW, BMI ≥ 23), or a high TESTOSTERONE / LH:FSH ratio when tested.
   - MENS_HEALTH: gender M, age ≥ 40, together with any metabolic marker abnormal or a relevant
     family/clinical history.
   - FERTILITY_PRECONCEPTION: reproductive.planning_pregnancy = true, or any reproductive test abnormal, or
     trying_to_conceive_months ≥ 12.
   - SENIOR_CARE: age ≥ 60, together with (≥ 2 active chronic buckets/conditions, medicine_count ≥ 5, or
     functional_status other than INDEPENDENT).
   - GLP1_WEIGHT_ASSESSMENT: BMI ≥ 27.5 together with a metabolic abnormality, or BMI ≥ 32.5. These are
     starter Asian cut-offs. The offering text must say "eligibility is decided by a physician in person";
     never suggest a drug or a dose.
4. **Doctor workflow**: a "Consider" section in the doctor's follow-up view. Each item shows why it was
   suggested, the missing data, and the buttons **Accept and refer**, **Not suitable** (with a reason code)
   and **Discuss later**. Accepting creates a `care_touchpoints` row and, if the page-5 referral feature
   exists, a specialist referral (Gynecology, Endocrinology, Andrology/Urology, Fertility specialist,
   Geriatrics, Obesity medicine).
5. **Extra privacy**: these programme codes must never appear in audit `entity_id`/details, notifications,
   caller cards or exports for callers. Notifications to doctors say only "New consider item".
6. **UI**: in the patient view, show the 6 programmes as cards in the slide style (icon, name, trigger,
   offering) with their status. Hide the whole section from callers.
7. **Edge parity** in `frontend/worker.js`.

## Tests
- Positive and negative cases for every programme, including the gender and age guards (e.g. a
  male patient never gets PCOS or Women's Health).
- DOCTOR_CONSIDER items never show up in caller responses, notifications or audit details.
- GLP-1 offering text contains no drug names.

## Out of scope here
Booking specialists in external systems, and medicine prescribing.
