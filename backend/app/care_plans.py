from datetime import date, datetime, timedelta, timezone
from sqlalchemy import select
from .models import CarePlan, PlanEnrollment, Payment, CareTouchpoint, User

STARTER_CARE_PLANS = [
    {
        "number": "02",
        "code": "CP02_PREDIABETES",
        "line": "SM SUGAR CARE",
        "name_en": "Prediabetes Care",
        "name_hi": "प्री-डायबिटीज़ केयर",
        "for_text": "If your sugar or HbA1c is borderline, act before it becomes diabetes",
        "colour": "amber",
        "icon": "sugar",
        "tiers": [
            {"tier": "ESSENTIAL", "price_inr": 1499, "period": "QUARTER", "annual_price_inr": None},
            {"tier": "PLUS", "price_inr": 2499, "period": "QUARTER", "annual_price_inr": 7999}
        ],
        "inclusions_plus": [
            "Doctor consultation and a personal risk-reduction plan",
            "3 dietitian sessions with simple, local food swaps",
            "Activity coaching that fits your day",
            "HbA1c test at the start; repeat at month 6 on the annual plan",
            "Regular check-ins on WhatsApp"
        ],
        "essential_covers": "Doctor review and care-coordinator support",
        "entitlements": {"DOCTOR_REVIEW": 2, "DIETITIAN_SESSION": 3, "HBA1C_TEST": 1},
        "tracked_measures": ["HBA1C", "WEIGHT", "WAIST"],
        "charged_separately": ["Tests beyond the plan are charged separately. Plan advised by our doctor after assessment. T&C apply."],
        "footnote": "Essential covers doctor review and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
        "qr_url": "https://secondmedic.com/plans/cp02",
        "linked_programs": ["DIABETES_MGMT"]
    },
    {
        "number": "03",
        "code": "CP03_HYPERTENSION",
        "line": "SM HEART CARE",
        "name_en": "Blood Pressure Care",
        "name_hi": "ब्लड प्रेशर (बीपी) केयर",
        "for_text": "For adults with high blood pressure (hypertension)",
        "colour": "red",
        "icon": "heart",
        "tiers": [
            {"tier": "ESSENTIAL", "price_inr": 1499, "period": "QUARTER", "annual_price_inr": None},
            {"tier": "PLUS", "price_inr": 2499, "period": "QUARTER", "annual_price_inr": 7999}
        ],
        "inclusions_plus": [
            "2 doctor reviews and medicine review",
            "Dietitian session on salt and everyday food",
            "Baseline blood tests and ECG",
            "Home BP log on WhatsApp, reviewed by our team",
            "Medicine refill reminders and home delivery"
        ],
        "essential_covers": "Doctor reviews and care-coordinator support",
        "entitlements": {"DOCTOR_REVIEW": 2, "DIETITIAN_SESSION": 1, "ECG": 1},
        "tracked_measures": ["HOME_BP", "CLINIC_BP", "MED_ADHERENCE"],
        "charged_separately": ["Medicines, BP monitor, echocardiogram charged separately."],
        "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
        "qr_url": "https://secondmedic.com/plans/cp03",
        "linked_programs": ["HYPERTENSION_MGMT"]
    },
    {
        "number": "04",
        "code": "CP04_CHOLESTEROL",
        "line": "SM HEART CARE",
        "name_en": "Cholesterol & Heart Care",
        "name_hi": "कोलेस्ट्रॉल और हृदय केयर",
        "for_text": "For high cholesterol or triglycerides, and anyone who wants to lower their heart risk",
        "colour": "red",
        "icon": "heart",
        "tiers": [
            {"tier": "ESSENTIAL", "price_inr": 1499, "period": "QUARTER", "annual_price_inr": None},
            {"tier": "PLUS", "price_inr": 2499, "period": "QUARTER", "annual_price_inr": 7999}
        ],
        "inclusions_plus": [
            "2 doctor reviews and medicine review",
            "Dietitian session for heart-healthy eating",
            "Lipid profile at the start and at follow-up",
            "Heart-risk assessment and ECG",
            "Cardiologist referral when needed"
        ],
        "essential_covers": "Doctor reviews and care-coordinator support",
        "entitlements": {"DOCTOR_REVIEW": 2, "DIETITIAN_SESSION": 1, "LIPID_PROFILE": 2, "ECG": 1},
        "tracked_measures": ["LIPIDS", "HEART_RISK", "BP"],
        "charged_separately": ["Medicines, TMT, echocardiogram, specialist consultations charged separately."],
        "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
        "qr_url": "https://secondmedic.com/plans/cp04",
        "linked_programs": ["CARDIAC_RISK_MGMT"]
    },
    {
        "number": "05",
        "code": "CP05_LIFESTYLE_WEIGHT",
        "line": "SM WEIGHT CARE",
        "name_en": "Lifestyle Weight Care",
        "name_hi": "लाइफस्टाइल वज़न केयर",
        "for_text": "Healthy, lasting weight loss through food, activity and support",
        "colour": "emerald",
        "icon": "weight",
        "tiers": [
            {"tier": "ESSENTIAL", "price_inr": 1499, "period": "QUARTER", "annual_price_inr": None},
            {"tier": "PLUS", "price_inr": 3999, "period": "QUARTER", "annual_price_inr": 12999}
        ],
        "inclusions_plus": [
            "2 doctor reviews",
            "3 dietitian sessions with a meal plan you can follow at home",
            "A personal activity plan",
            "Metabolic blood tests at the start",
            "Monthly weigh-ins and progress check"
        ],
        "essential_covers": "Doctor reviews and care-coordinator support",
        "entitlements": {"DOCTOR_REVIEW": 2, "DIETITIAN_SESSION": 3},
        "tracked_measures": ["WEIGHT", "WAIST", "BP"],
        "charged_separately": ["Tests beyond the plan are charged separately."],
        "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
        "qr_url": "https://secondmedic.com/plans/cp05",
        "linked_programs": ["WEIGHT_PLAN"]
    },
    {
        "number": "06",
        "code": "CP06_MEDICAL_WEIGHT",
        "line": "SM WEIGHT CARE",
        "name_en": "Medical Weight Management",
        "name_hi": "मेडिकल वज़न प्रबंधन",
        "for_text": "A doctor-supervised programme. Eligibility is assessed in person by our doctor.",
        "colour": "emerald",
        "icon": "weight",
        "tiers": [
            {"tier": "PROGRAMME", "price_inr": 5999, "period": "QUARTER", "annual_price_inr": 19999}
        ],
        "inclusions_plus": [
            "In-person medical assessment and eligibility check",
            "Monthly doctor reviews, with treatment only if suitable for you",
            "4 dietitian sessions, with protein and nutrition support",
            "Strength and activity guidance",
            "A maintenance plan to keep your progress"
        ],
        "essential_covers": "None (Programme tier only)",
        "entitlements": {"DOCTOR_REVIEW": 3, "DIETITIAN_SESSION": 4},
        "tracked_measures": ["WEIGHT", "WAIST", "HBA1C", "SIDE_EFFECTS"],
        "charged_separately": ["Medicine, if prescribed, is charged separately. Not every patient is eligible."],
        "footnote": "Programme fee ₹5,999 / quarter. Medical assessment required. T&C apply.",
        "qr_url": "https://secondmedic.com/plans/cp06",
        "linked_programs": ["GLP1_WEIGHT_ASSESSMENT"]
    },
    {
        "number": "07",
        "code": "CP07_DIET_NUTRITION",
        "line": "SM WEIGHT CARE",
        "name_en": "Diet & Nutrition Plan",
        "name_hi": "डाइट और पोषण प्लान",
        "for_text": "For anyone who wants a personal diet plan from a qualified dietitian",
        "colour": "emerald",
        "icon": "apple",
        "tiers": [
            {"tier": "ESSENTIAL", "price_inr": 999, "period": "QUARTER", "annual_price_inr": None},
            {"tier": "PLUS", "price_inr": 1999, "period": "QUARTER", "annual_price_inr": 6499}
        ],
        "inclusions_plus": [
            "4 one-to-one dietitian sessions",
            "Body composition analysis",
            "A meal plan that suits your food, budget and routine",
            "Weekly check-ins on WhatsApp",
            "Doctor input when your health needs it"
        ],
        "essential_covers": "Dietitian consultations",
        "entitlements": {"DIETITIAN_SESSION": 4},
        "tracked_measures": ["WEIGHT", "WAIST", "DIET_GOALS"],
        "charged_separately": ["Additional consultations charged separately."],
        "footnote": "Essential covers dietitian consultations. T&C apply.",
        "qr_url": "https://secondmedic.com/plans/cp07",
        "linked_programs": ["DIET_PLAN"]
    },
    {
        "number": "08",
        "code": "CP08_THYROID",
        "line": "SM THYROID & HER CARE",
        "name_en": "Thyroid Care",
        "name_hi": "थायरॉइड केयर",
        "for_text": "For underactive thyroid (hypothyroidism)",
        "colour": "purple",
        "icon": "shield",
        "tiers": [
            {"tier": "ESSENTIAL", "price_inr": 999, "period": "QUARTER", "annual_price_inr": None},
            {"tier": "PLUS", "price_inr": 1799, "period": "QUARTER", "annual_price_inr": 5999}
        ],
        "inclusions_plus": [
            "2 doctor reviews and medicine dose review",
            "Thyroid tests at the start and after any dose change",
            "Home sample collection",
            "Symptom review: energy, weight, sleep, mood",
            "Endocrinologist referral when needed"
        ],
        "essential_covers": "Doctor reviews and care-coordinator support",
        "entitlements": {"DOCTOR_REVIEW": 2, "THYROID_TEST": 2},
        "tracked_measures": ["THYROID_LEVELS", "SYMPTOMS", "WEIGHT"],
        "charged_separately": ["Medicines, thyroid ultrasound charged separately."],
        "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
        "qr_url": "https://secondmedic.com/plans/cp08",
        "linked_programs": ["THYROID_MGMT"]
    },
    {
        "number": "09",
        "code": "CP09_PCOS",
        "line": "SM THYROID & HER CARE",
        "name_en": "PCOS Care",
        "name_hi": "पीसीओएस केयर",
        "for_text": "For women with PCOS: periods, weight and long-term metabolic health",
        "colour": "purple",
        "icon": "shield",
        "tiers": [
            {"tier": "ESSENTIAL", "price_inr": 2499, "period": "QUARTER", "annual_price_inr": None},
            {"tier": "PLUS", "price_inr": 3999, "period": "QUARTER", "annual_price_inr": 12999}
        ],
        "inclusions_plus": [
            "Consultation with our partner gynaecologist or endocrinologist",
            "2 doctor follow-up reviews",
            "4 dietitian sessions for PCOS-friendly eating",
            "Blood tests as advised by your doctor",
            "Cycle tracking and private WhatsApp support"
        ],
        "essential_covers": "Doctor reviews and care-coordinator support",
        "entitlements": {"DOCTOR_REVIEW": 3, "DIETITIAN_SESSION": 4},
        "tracked_measures": ["CYCLE_REGULARITY", "WEIGHT", "METABOLIC_MARKERS"],
        "charged_separately": ["Pelvic ultrasound, additional hormone tests, fertility care charged separately."],
        "footnote": "Essential covers doctor reviews and care-coordinator support. T&C apply.",
        "qr_url": "https://secondmedic.com/plans/cp09",
        "linked_programs": ["PCOS_MGMT"]
    },
    {
        "number": "10",
        "code": "CP10_LIVER",
        "line": "SM LIVER CARE",
        "name_en": "Fatty Liver Care",
        "name_hi": "फैटी लिवर केयर",
        "for_text": "For fatty liver seen on ultrasound, or raised liver enzymes",
        "colour": "amber",
        "icon": "liver",
        "tiers": [
            {"tier": "ESSENTIAL", "price_inr": 1999, "period": "QUARTER", "annual_price_inr": None},
            {"tier": "PLUS", "price_inr": 2999, "period": "QUARTER", "annual_price_inr": 9999}
        ],
        "inclusions_plus": [
            "2 doctor reviews",
            "3 dietitian sessions for a liver-friendly diet",
            "Liver and metabolic blood tests",
            "Liver scarring (fibrosis) risk score",
            "Gastroenterologist referral when needed"
        ],
        "essential_covers": "Doctor reviews and care-coordinator support",
        "entitlements": {"DOCTOR_REVIEW": 2, "DIETITIAN_SESSION": 3},
        "tracked_measures": ["WEIGHT", "LIVER_ENZYMES", "FIBROSIS_RISK"],
        "charged_separately": ["Ultrasound, liver elastography (FibroScan) charged separately."],
        "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
        "qr_url": "https://secondmedic.com/plans/cp10",
        "linked_programs": ["LIVER_HEALTH"]
    },
    {
        "number": "11",
        "code": "CP11_SENIOR",
        "line": "SM SENIOR CARE",
        "name_en": "Senior Care",
        "name_hi": "वरिष्ठ नागरिक केयर",
        "for_text": "For adults 60+ managing several conditions, and families caring for them from near or far",
        "colour": "blue",
        "icon": "user",
        "tiers": [
            {"tier": "ESSENTIAL", "price_inr": 1999, "period": "MONTH", "annual_price_inr": None},
            {"tier": "PLUS", "price_inr": 3499, "period": "MONTH", "annual_price_inr": 34999}
        ],
        "inclusions_plus": [
            "Complete health and daily-function assessment",
            "Monthly doctor review, by video or at home",
            "Full medicine review and refill management",
            "Falls-risk and home-safety check",
            "Monthly health update for the family"
        ],
        "essential_covers": "Doctor reviews and care-coordinator support",
        "entitlements": {"DOCTOR_REVIEW": 1},
        "tracked_measures": ["MEDICINES", "FALLS", "HOSPITAL_VISITS", "DAILY_FUNCTION"],
        "charged_separately": ["Home nursing, medical devices, specialist consultations charged separately."],
        "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
        "qr_url": "https://secondmedic.com/plans/cp11",
        "linked_programs": ["SENIOR_CARE"]
    },
    {
        "number": "12",
        "code": "CP12_MOVE",
        "line": "SM MOVE",
        "name_en": "Joint, Back & Mobility Care",
        "name_hi": "जोड़ और कमर दर्द केयर",
        "for_text": "For long-standing knee, hip, back or neck pain",
        "colour": "indigo",
        "icon": "activity",
        "tiers": [
            {"tier": "ESSENTIAL", "price_inr": 3999, "period": "BLOCK_8W", "annual_price_inr": None},
            {"tier": "PLUS", "price_inr": 5999, "period": "BLOCK_8W", "annual_price_inr": None}
        ],
        "inclusions_plus": [
            "Doctor assessment of your pain and movement",
            "8 physiotherapy sessions, at the hub or at home",
            "A home exercise programme you can keep doing",
            "Weight and diet support where it helps your joints",
            "Orthopaedic referral when needed"
        ],
        "essential_covers": "Fewer physiotherapy sessions; ask our team.",
        "entitlements": {"PHYSIO_SESSION": 8, "DOCTOR_REVIEW": 1},
        "tracked_measures": ["PAIN_SCORE", "MOVEMENT_FUNCTION"],
        "charged_separately": ["X-ray and scans, injections, braces and supports charged separately."],
        "footnote": "Essential covers fewer physiotherapy sessions. Plan advised by our doctor after assessment. T&C apply.",
        "qr_url": "https://secondmedic.com/plans/cp12",
        "linked_programs": ["FITNESS_PLAN"]
    }
]

def seed_care_plans(db):
    for plan_data in STARTER_CARE_PLANS:
        existing = db.scalar(select(CarePlan).where(CarePlan.code == plan_data["code"]))
        if not existing:
            db.add(CarePlan(**plan_data))
        else:
            for k, v in plan_data.items():
                setattr(existing, k, v)
    db.commit()

def mask_plan_name(role: str, plan_number: str, name_en: str) -> str:
    if role and role.upper() == "CALLER":
        return f"Health Hub care plan {plan_number}"
    return name_en

def assess_enrollment(db, enrollment_id: int, doctor_id: int, eligible: bool, note_code: str = ""):
    enr = db.get(PlanEnrollment, enrollment_id)
    if not enr:
        raise ValueError("Enrollment not found")
    
    plan = db.scalar(select(CarePlan).where(CarePlan.code == enr.plan_code))
    if plan and plan.code == "CP06_MEDICAL_WEIGHT" and not eligible:
        enr.status = "NOT_ELIGIBLE"
        enr.eligibility_note_code = note_code or "NOT_ELIGIBLE_FOR_MEDICAL_TREATMENT"
        enr.assessed_by_doctor_id = doctor_id
        enr.assessed_on = datetime.now(timezone.utc)
        db.commit()
        return enr

    enr.status = "DOCTOR_ASSESSED"
    enr.assessed_by_doctor_id = doctor_id
    enr.assessed_on = datetime.now(timezone.utc)
    enr.eligibility_note_code = note_code
    db.commit()
    return enr

def enroll_patient(db, patient_id: int, plan_code: str, tier: str, health_hub_id: int | None, payment_details: dict):
    plan = db.scalar(select(CarePlan).where(CarePlan.code == plan_code))
    if not plan:
        raise ValueError("Plan not found")

    # Find tier price & period
    tier_info = next((t for t in plan.tiers if t["tier"] == tier), None)
    if not tier_info:
        raise ValueError("Invalid tier for plan")

    price = tier_info["price_inr"]
    period = tier_info["period"]

    # Record payment
    payment = Payment(
        patient_id=patient_id,
        amount_inr=price,
        method=payment_details.get("method", "COUNTER"),
        reference=payment_details.get("reference", ""),
        status="PAID",
        health_hub_id=health_hub_id
    )
    db.add(payment)
    db.flush()

    start_date = date.today()
    if period == "MONTH":
        end_date = start_date + timedelta(days=30)
    elif period == "QUARTER":
        end_date = start_date + timedelta(days=90)
    elif period == "BLOCK_8W":
        end_date = start_date + timedelta(days=56)
    elif period == "YEAR":
        end_date = start_date + timedelta(days=365)
    else:
        end_date = start_date + timedelta(days=90)

    enrollment = PlanEnrollment(
        patient_id=patient_id,
        plan_code=plan_code,
        tier=tier,
        status="ACTIVE",
        health_hub_id=health_hub_id,
        period_start=start_date,
        period_end=end_date,
        price_inr=price,
        payment_id=payment.id,
        entitlements_used={}
    )
    db.add(enrollment)
    db.flush()

    # Record touchpoint
    tp = CareTouchpoint(
        patient_id=patient_id,
        stage="ENROLLED",
        service_code=plan_code,
        occurred_on=start_date,
        source="AUTO",
        ref_entity="plan_enrollments",
        ref_id=enrollment.id,
        amount_inr=price,
        health_hub_id=health_hub_id
    )
    db.add(tp)
    db.commit()
    return enrollment

def consume_entitlement(db, enrollment_id: int, entitlement_key: str, units: int = 1):
    enr = db.get(PlanEnrollment, enrollment_id)
    if not enr:
        raise ValueError("Enrollment not found")
    plan = db.scalar(select(CarePlan).where(CarePlan.code == enr.plan_code))
    if not plan:
        raise ValueError("Plan not found")

    allowed = plan.entitlements.get(entitlement_key, 0)
    used = enr.entitlements_used.get(entitlement_key, 0)
    
    new_used = used + units
    if new_used > allowed:
        # Warning/overuse can be flagged or permitted with note
        pass

    used_dict = dict(enr.entitlements_used)
    used_dict[entitlement_key] = new_used
    enr.entitlements_used = used_dict
    db.commit()
    return enr
