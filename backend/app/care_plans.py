from datetime import date, datetime, timedelta, timezone
from sqlalchemy import select
from .models import CarePlan, CareTouchpoint, Doctor, Payment, PlanEnrollment, User
from .timeutil import IST, today_ist

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
        "qr_url": "",  # [CONFIRM] QR target not defined in the brief
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
        "qr_url": "",  # [CONFIRM] QR target not defined in the brief
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
        "qr_url": "",  # [CONFIRM] QR target not defined in the brief
        "linked_programs": ["CARDIAC_RISK_MGMT"]
    },
    {
        "number": "05",
        "code": "CP05_LIFESTYLE_WEIGHT",
        "line": "SM WEIGHT CARE",
        "name_en": "Lifestyle Weight Care",
        "name_hi": "वज़न नियंत्रण केयर",
        "for_text": "For healthy, lasting weight loss through food, activity and support",
        "colour": "emerald",
        "icon": "weight",
        "tiers": [
            {"tier": "ESSENTIAL", "price_inr": 2499, "period": "QUARTER", "annual_price_inr": None},
            {"tier": "PLUS", "price_inr": 3999, "period": "QUARTER", "annual_price_inr": 12999}
        ],
        "inclusions_plus": [
            "2 doctor reviews",
            "4 dietitian sessions with a meal plan you can follow at home",
            "A personal activity plan",
            "Metabolic blood tests at the start",
            "Monthly weigh-ins and progress check"
        ],
        "essential_covers": "Doctor reviews and care-coordinator support",
        "entitlements": {"DOCTOR_REVIEW": 2, "DIETITIAN_SESSION": 4},
        "tracked_measures": ["WEIGHT", "WAIST", "BP"],
        "charged_separately": ["Tests beyond the plan are charged separately."],
        "footnote": "Essential covers doctor reviews and care-coordinator support. Plan advised by our doctor after assessment. T&C apply.",
        "qr_url": "",  # [CONFIRM] QR target not defined in the brief
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
        "qr_url": "",  # [CONFIRM] QR target not defined in the brief
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
        "qr_url": "",  # [CONFIRM] QR target not defined in the brief
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
        "qr_url": "",  # [CONFIRM] QR target not defined in the brief
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
        "qr_url": "",  # [CONFIRM] QR target not defined in the brief
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
        "qr_url": "",  # [CONFIRM] QR target not defined in the brief
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
        "qr_url": "",  # [CONFIRM] QR target not defined in the brief
        "linked_programs": ["SENIOR_CARE"]
    },
    {
        "number": "12",
        "code": "CP12_MOVE",
        "line": "SM MOVE",
        "name_en": "Joint, Back & Mobility",
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
        "qr_url": "",  # [CONFIRM] QR target not defined in the brief
        "linked_programs": ["FITNESS_PLAN"]
    }
]

# Fields the admin catalogue editor may change. Prices are commercial, not medical.
EDITABLE_FIELDS = ("line", "name_en", "name_hi", "for_text", "colour", "icon", "tiers", "inclusions_plus", "essential_covers",
                   "entitlements", "tracked_measures", "charged_separately", "footnote", "qr_url", "linked_programs", "active")
PERIOD_DAYS = {"MONTH": 30, "QUARTER": 90, "BLOCK_8W": 56, "YEAR": 365}
LIVE = ("ACTIVE", "RENEWAL_DUE")
# Which Holistic Health Loop stage a plan sale counts under (the loop has no "enrolled" stage).
LINE_STAGE = {"SM SUGAR CARE": "CHRONIC_CONDITIONS", "SM HEART CARE": "CHRONIC_CONDITIONS", "SM THYROID & HER CARE": "CHRONIC_CONDITIONS",
              "SM LIVER CARE": "CHRONIC_CONDITIONS", "SM WEIGHT CARE": "EATING_WELL", "SM SENIOR CARE": "ONGOING_MONITORING",
              "SM MOVE": "PREVENTION"}

# Open questions for the business, shown on the admin screen.
CONFIRMS = [
    {"plan_code": "CP01", "field": "whole_plan", "note": "Plan 01 is not in the document (the flyers run 02-12). Probably Diabetes Care; needs a flyer."},
    {"plan_code": "ALL", "field": "qr_url", "note": "The flyers only show a [QR CODE] placeholder; the QR target page is not defined."},
    {"plan_code": "CP12_MOVE", "field": "essential_physio_session_count", "note": "Essential covers 'fewer physiotherapy sessions'; the number is not given."},
]


def seed_care_plans(db):
    """Insert missing plans only: the catalogue is admin-edited, so a restart must not overwrite those edits."""
    for plan_data in STARTER_CARE_PLANS:
        if not db.scalar(select(CarePlan).where(CarePlan.code == plan_data["code"])):
            db.add(CarePlan(**plan_data))
    db.commit()


def mask_plan_name(role: str, plan_number: str, name_en: str) -> str:
    if role and role.upper() == "CALLER":
        return f"Health Hub care plan {plan_number}"
    return name_en


def mask_plan_name_hi(role: str, plan_number: str, name_hi: str) -> str:
    if role and role.upper() == "CALLER":
        return f"हेल्थ हब केयर प्लान {plan_number}"
    return name_hi


def plan_out(p: CarePlan, role: str) -> dict:
    """Plan names and contents reveal conditions (PCOS, thyroid...), so callers get a numbered, neutral version."""
    caller = (role or "").upper() == "CALLER"
    return {"id": p.id, "number": p.number, "code": f"CP{p.number}" if caller else p.code, "line": "" if caller else p.line,
            "name_en": mask_plan_name(role, p.number, p.name_en), "name_hi": mask_plan_name_hi(role, p.number, p.name_hi),
            "for_text": "Health Hub care plan" if caller else p.for_text, "colour": p.colour, "icon": "" if caller else p.icon,
            "tiers": p.tiers, "inclusions_plus": [] if caller else p.inclusions_plus,
            "essential_covers": "" if caller else p.essential_covers, "entitlements": {} if caller else p.entitlements,
            "tracked_measures": [] if caller else p.tracked_measures, "charged_separately": [] if caller else p.charged_separately,
            "footnote": "" if caller else p.footnote, "qr_url": p.qr_url, "linked_programs": [] if caller else p.linked_programs,
            "active": p.active}


def _validate_plan_fields(changes: dict) -> None:
    for t in changes.get("tiers", []) or []:
        if t.get("tier") not in ("ESSENTIAL", "PLUS", "PROGRAMME") or t.get("period") not in PERIOD_DAYS:
            raise ValueError("Each tier needs tier ESSENTIAL|PLUS|PROGRAMME and period MONTH|QUARTER|BLOCK_8W|YEAR")
        if not isinstance(t.get("price_inr"), int) or t["price_inr"] < 0:
            raise ValueError("Tier prices must be whole, non-negative rupees")
    for k, v in (changes.get("entitlements") or {}).items():
        if not isinstance(v, int) or v < 0:
            raise ValueError(f"Entitlement {k} must be a non-negative whole number")
    q = changes.get("qr_url")
    if q and not q.startswith("https://"):
        raise ValueError("qr_url must be an https:// address")


def create_plan(db, data: dict) -> CarePlan:
    if db.scalar(select(CarePlan).where(CarePlan.code == data["code"])):
        raise ValueError("A plan with this code already exists")
    _validate_plan_fields(data)
    p = CarePlan(**{k: v for k, v in data.items() if k in EDITABLE_FIELDS or k in ("code", "number")})
    db.add(p)
    db.commit()
    return p


def update_plan(db, code: str, changes: dict) -> CarePlan:
    p = db.scalar(select(CarePlan).where(CarePlan.code == code))
    if not p:
        raise LookupError("Care plan not found")
    _validate_plan_fields(changes)
    for k in EDITABLE_FIELDS:
        if k in changes:
            setattr(p, k, changes[k])
    db.commit()
    return p


def suggest_enrollment(db, patient_id: int, plan_code: str, tier: str, health_hub_id: int | None, created_by: int | None) -> PlanEnrollment:
    """Step 1: a plan is suggested. It is only sold after a doctor's assessment ("Plan advised by our doctor after assessment")."""
    plan = db.scalar(select(CarePlan).where(CarePlan.code == plan_code, CarePlan.active.is_(True)))
    if not plan:
        raise ValueError("Plan not found")
    tier_info = next((t for t in plan.tiers if t["tier"] == tier), None)
    if not tier_info:
        raise ValueError("Invalid tier for plan")
    open_enr = db.scalar(select(PlanEnrollment).where(PlanEnrollment.patient_id == patient_id, PlanEnrollment.plan_code == plan_code,
                                                      PlanEnrollment.status.in_(("SUGGESTED", "DOCTOR_ASSESSED", *LIVE))))
    if open_enr:
        raise ValueError("This patient already has an open enrolment for this plan")
    enr = PlanEnrollment(patient_id=patient_id, plan_code=plan_code, tier=tier, status="SUGGESTED", health_hub_id=health_hub_id,
                         price_inr=tier_info["price_inr"], entitlements_used={}, created_by=created_by)
    db.add(enr)
    db.commit()
    return enr


def assess_enrollment(db, enrollment_id: int, doctor_id: int, eligible: bool, note_code: str = ""):
    """Step 2 (doctor): DOCTOR_ASSESSED, or NOT_ELIGIBLE (e.g. Medical Weight Management treatment criteria not met)."""
    enr = db.get(PlanEnrollment, enrollment_id)
    if not enr:
        raise ValueError("Enrollment not found")
    if enr.status not in ("SUGGESTED", "DOCTOR_ASSESSED", "NOT_ELIGIBLE"):
        raise ValueError(f"Cannot assess a {enr.status.lower()} enrolment")
    doctor = db.scalar(select(Doctor).where(Doctor.user_id == doctor_id))
    enr.assessed_by_doctor_id = doctor.id if doctor else None
    enr.assessed_on = datetime.now(timezone.utc)
    if not eligible:
        enr.status = "NOT_ELIGIBLE"
        enr.eligibility_note_code = (note_code or ("NOT_ELIGIBLE_FOR_MEDICAL_TREATMENT" if enr.plan_code == "CP06_MEDICAL_WEIGHT"
                                                   else "NOT_ELIGIBLE"))[:60]
    else:
        enr.status = "DOCTOR_ASSESSED"
        enr.eligibility_note_code = (note_code or "")[:60]
    db.commit()
    return enr


def pay_enrollment(db, enrollment_id: int, payment_details: dict, received_by: int | None) -> PlanEnrollment:
    """Step 3 (counter): payment starts the plan period. On a live or ended plan it is a renewal."""
    from .outcomes import assert_plan_sale_allowed

    enr = db.get(PlanEnrollment, enrollment_id)
    if not enr:
        raise ValueError("Enrollment not found")
    renewal = enr.status in (*LIVE, "ENDED")
    if enr.status != "DOCTOR_ASSESSED" and not renewal:
        raise ValueError("A doctor must assess the patient before this plan can be paid for")
    assert_plan_sale_allowed(db, enr.patient_id)
    plan = db.scalar(select(CarePlan).where(CarePlan.code == enr.plan_code))
    tier_info = next((t for t in (plan.tiers if plan else []) if t["tier"] == enr.tier), None)
    if not tier_info:
        raise ValueError("Invalid tier for plan")
    price = tier_info["price_inr"]
    payment = Payment(patient_id=enr.patient_id, amount_inr=price, method=(payment_details.get("method") or "COUNTER")[:30],
                      reference=(payment_details.get("reference") or "")[:60], status="PAID", health_hub_id=enr.health_hub_id,
                      received_by=received_by, received_at=datetime.now(timezone.utc))
    db.add(payment)
    db.flush()

    today = today_ist()
    days = PERIOD_DAYS.get(tier_info["period"], 90)
    if renewal:
        start = max(enr.period_end, today) if enr.status in LIVE and enr.period_end else today
        enr.renewal_count += 1
        enr.entitlements_used = {}
        enr.last_reminded_on = None
    else:
        start = today
        enr.period_start = today
        enr.activated_at = datetime.now(timezone.utc)
    enr.period_end = start + timedelta(days=days)
    enr.status = "ACTIVE"
    enr.price_inr = price
    enr.payment_id = payment.id
    db.add(CareTouchpoint(patient_id=enr.patient_id, stage=LINE_STAGE.get(plan.line, "CHRONIC_CONDITIONS"), service_code=enr.plan_code,
                          occurred_on=today, source="AUTO", ref_entity="payments", ref_id=payment.id, amount_inr=price,
                          health_hub_id=enr.health_hub_id, created_by=received_by))
    db.commit()
    return enr


def enroll_patient(db, patient_id: int, plan_code: str, tier: str, health_hub_id: int | None, payment_details: dict):
    """Kept for callers of the old one-step API: creates the suggestion only. Selling needs assess + pay."""
    return suggest_enrollment(db, patient_id, plan_code, tier, health_hub_id, payment_details.get("created_by"))


def consume_entitlement(db, enrollment_id: int, entitlement_key: str, units: int = 1, commit: bool = True) -> tuple[PlanEnrollment, bool]:
    """Records use of an included service. Returns (enrolment, overuse) — overuse is allowed but flagged to staff."""
    enr = db.get(PlanEnrollment, enrollment_id)
    if not enr:
        raise ValueError("Enrollment not found")
    if enr.status not in LIVE:
        raise ValueError("Only an active plan has entitlements to use")
    if units < 1:
        raise ValueError("units must be at least 1")
    plan = db.scalar(select(CarePlan).where(CarePlan.code == enr.plan_code))
    allowed = (plan.entitlements if plan else {}).get(entitlement_key)
    if allowed is None:
        raise ValueError("Entitlement not included in plan")
    new_used = int((enr.entitlements_used or {}).get(entitlement_key, 0)) + units
    enr.entitlements_used = {**(enr.entitlements_used or {}), entitlement_key: new_used}
    if commit:
        db.commit()
    return enr, new_used > allowed


def care_plan_renewal_tick(db, now: datetime | None = None) -> int:
    """Daily (IST): one caller renewal task 7 days before a plan period ends; the plan ends 7 days after, if unpaid.
    The task text carries no plan name (plan names reveal conditions)."""
    from . import assign

    today = (now or datetime.now(timezone.utc)).astimezone(IST).date()
    count = 0
    caller_ids = None
    for enr in db.scalars(select(PlanEnrollment).where(PlanEnrollment.status.in_(LIVE), PlanEnrollment.period_end.is_not(None))).all():
        if enr.period_end < today - timedelta(days=7):
            enr.status = "ENDED"
            count += 1
        elif enr.period_end <= today + timedelta(days=7) and enr.last_reminded_on is None:
            if caller_ids is None:
                caller_ids = [u for (u,) in db.execute(select(User.id).where(User.role == "CALLER", User.active))]
            if caller_ids:
                assign.notify(db, caller_ids, f"Health Hub care plan renewal call due for patient #{enr.patient_id}",
                              f"/patients/view?id={enr.patient_id}")
            enr.last_reminded_on = today
            enr.status = "RENEWAL_DUE"
            count += 1
    db.commit()
    return count


# A recorded service uses up one unit of a matching entitlement (care plan first, then Health360 membership).
TOUCHPOINT_ENTITLEMENTS = {"TELECONSULT": ("DOCTOR_REVIEW", "TELECONSULT"), "DIETITIAN_PLAN": ("DIETITIAN_SESSION",),
                           "PREVENTIVE_SCREEN": ("PREVENTIVE_SCREEN",), "HOME_COLLECTION": ("HOME_COLLECTION",)}


def consume_for_touchpoint(db, patient_id: int, service_code: str) -> dict | None:
    """Returns what was used ({"source", "id", "entitlement"}) or None. Never blocks recording the service itself."""
    from .memberships import PAID_STATUSES, consume_membership_entitlement, effective_entitlements
    from .models import Membership

    keys = TOUCHPOINT_ENTITLEMENTS.get(service_code, ())
    for enr in db.scalars(select(PlanEnrollment).where(PlanEnrollment.patient_id == patient_id, PlanEnrollment.status.in_(LIVE))):
        plan = db.scalar(select(CarePlan).where(CarePlan.code == enr.plan_code))
        for k in keys:
            if plan and k in (plan.entitlements or {}) and int((enr.entitlements_used or {}).get(k, 0)) < plan.entitlements[k]:
                consume_entitlement(db, enr.id, k, 1, commit=False)
                return {"source": "care_plan", "id": enr.id, "entitlement": k}
    for m in db.scalars(select(Membership).where(Membership.patient_id == patient_id, Membership.status.in_(PAID_STATUSES))):
        allowed = effective_entitlements(db, m.plan_code)
        for k in keys:
            if k in allowed and int((m.entitlements_used or {}).get(k, 0)) < allowed[k]:
                consume_membership_entitlement(db, m.id, k, commit=False)
                return {"source": "membership", "id": m.id, "entitlement": k}
    return None
