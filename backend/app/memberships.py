from datetime import date, datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from .models import MembershipPlan, Membership, Payment, Patient, PatientBucket, ProgramRecommendation, User, CareTouchpoint
from .timeutil import today_ist
from . import assign

HEALTH360_PLANS = [
    {
        "code": "H360_FREE",
        "name": "Health360 Free",
        "target_text": "Every registered patient",
        "price_inr_monthly": 0,
        "benefits_text": "Digital health record, reports, reminders, health alerts",
        "includes_plan": "",
        "entitlements": []
    },
    {
        "code": "H360_ESSENTIAL",
        "name": "Health360 Essential",
        "target_text": "Individuals and families",
        "price_inr_monthly": 199,
        "benefits_text": "Care navigation, medicine reminders, preventive screening calendar, member service benefits",
        "includes_plan": "H360_FREE",
        "entitlements": [
            {"code": "CARE_NAVIGATION", "quantity": 2, "period": "MONTH", "description": "Care navigation support"},
            {"code": "MEDICINE_REMINDERS", "quantity": 30, "period": "MONTH", "description": "Automated medicine reminders"}
        ]
    },
    {
        "code": "H360_PLUS",
        "name": "Health360 Plus",
        "target_text": "Preventive healthcare users",
        "price_inr_monthly": 499,
        "benefits_text": "Essential benefits plus defined teleconsultation and preventive-care entitlements",
        "includes_plan": "H360_ESSENTIAL",
        "entitlements": [
            {"code": "TELECONSULT", "quantity": 1, "period": "QUARTER", "description": "Defined teleconsultation"},
            {"code": "PREVENTIVE_SCREEN", "quantity": 1, "period": "YEAR", "description": "Preventive screening calendar/check"}
        ]
    },
    {
        "code": "H360_CHRONIC",
        "name": "Health360 Chronic",
        "target_text": "Diabetes, hypertension and thyroid patients",
        "price_inr_monthly": 799,
        "benefits_text": "Clinician-supervised chronic-care program, monitoring and follow-up",
        "includes_plan": "H360_PLUS",
        "entitlements": [
            {"code": "DOCTOR_REVIEW", "quantity": 1, "period": "MONTH", "description": "Clinician supervision and review"},
            {"code": "DIETITIAN_SESSION", "quantity": 1, "period": "MONTH", "description": "Chronic care dietitian session"}
        ]
    },
    {
        "code": "H360_SENIOR",
        "name": "Health360 Senior",
        "target_text": "Elderly patients",
        "price_inr_monthly": 1499,
        "benefits_text": "Care coordination, caregiver updates, scheduled clinical reviews and homecare coordination",
        "includes_plan": "H360_ESSENTIAL",
        "entitlements": [
            {"code": "CAREGIVER_UPDATE", "quantity": 4, "period": "MONTH", "description": "Monthly family caregiver updates"},
            {"code": "HOME_VISIT", "quantity": 1, "period": "QUARTER", "description": "Homecare coordination / visit"}
        ]
    },
    {
        "code": "H360_CORPORATE",
        "name": "Health360 Corporate",
        "target_text": "Employer-sponsored members",
        "price_inr_monthly": 199,  # PEPM average (99-299)
        "benefits_text": "Preventive care, OPD access, care navigation and selected chronic-care benefits",
        "includes_plan": "H360_ESSENTIAL",
        "entitlements": [
            {"code": "OPD_VISIT", "quantity": 1, "period": "MONTH", "description": "OPD consultation access"},
            {"code": "CARE_NAVIGATION", "quantity": 2, "period": "MONTH", "description": "Priority care navigation"}
        ]
    }
]

def seed_memberships(db: Session):
    for p in HEALTH360_PLANS:
        existing = db.scalar(select(MembershipPlan).where(MembershipPlan.code == p["code"]))
        if not existing:
            db.add(MembershipPlan(**p))
        else:
            for k, v in p.items():
                setattr(existing, k, v)
    db.commit()

def assign_free_membership(db: Session, patient_id: int):
    existing = db.scalar(select(Membership).where(Membership.patient_id == patient_id, Membership.plan_code == "H360_FREE"))
    if not existing:
        m = Membership(
            patient_id=patient_id,
            plan_code="H360_FREE",
            status="ACTIVE",
            payer="SELF",
            start_on=today_ist(),
            current_period_end=today_ist() + timedelta(days=365)
        )
        db.add(m)
        db.commit()

def mask_plan_name(role: str, plan_code: str, name: str) -> str:
    if role and role.upper() == "CALLER" and plan_code == "H360_CHRONIC":
        return "Health360 Care"
    return name

def suggest_memberships(db: Session, patient_id: int) -> list[str]:
    suggestions = []
    patient = db.get(Patient, patient_id)
    if not patient:
        return suggestions

    if patient.age and patient.age >= 60:
        suggestions.append("H360_SENIOR")

    # Check active buckets for chronic
    buckets = [b.bucket_code for b in db.scalars(select(PatientBucket).where(PatientBucket.patient_id == patient_id, PatientBucket.active.is_(True)))]
    if any(b in ("DIABETES", "HYPERTENSION", "THYROID") for b in buckets):
        suggestions.append("H360_CHRONIC")

    # Check preventive recommendation
    rec = db.scalar(select(ProgramRecommendation).where(ProgramRecommendation.patient_id == patient_id, ProgramRecommendation.program_code == "PREVENTIVE_PLAN"))
    if rec:
        suggestions.append("H360_PLUS")

    return suggestions

def enroll_membership(db: Session, patient_id: int, plan_code: str, payer: str = "SELF", corporate_client_id: int | None = None,
                      enrolled_by: int | None = None, health_hub_id: int | None = None, payment_details: dict | None = None):
    plan = db.scalar(select(MembershipPlan).where(MembershipPlan.code == plan_code))
    if not plan:
        raise HTTPException(404, "Plan not found")

    # Chronic requires doctor sign-off if self-enrolling or initially requested
    status = "ACTIVE"
    if plan_code == "H360_CHRONIC" and payer == "SELF":
        status = "PENDING_PAYMENT"  # or pending doctor signoff

    start_d = today_ist()
    end_d = start_d + timedelta(days=30)

    m = Membership(
        patient_id=patient_id,
        plan_code=plan_code,
        status=status,
        payer=payer,
        corporate_client_id=corporate_client_id,
        start_on=start_d,
        current_period_end=end_d,
        enrolled_by=enrolled_by,
        health_hub_id=health_hub_id,
        entitlements_used={}
    )
    db.add(m)
    db.flush()

    if payment_details and plan.price_inr_monthly > 0:
        pay = Payment(
            patient_id=patient_id,
            membership_id=m.id,
            amount_inr=payment_details.get("amount_inr", plan.price_inr_monthly),
            method=payment_details.get("method", "COUNTER_CASH"),
            reference=payment_details.get("reference", ""),
            status="PAID",
            health_hub_id=health_hub_id,
            received_by=enrolled_by,
            received_at=datetime.now(timezone.utc)
        )
        db.add(pay)
        m.status = "ACTIVE"

    db.commit()
    return m

def consume_membership_entitlement(db: Session, membership_id: int, entitlement_code: str):
    m = db.get(Membership, membership_id)
    if not m:
        raise ValueError("Membership not found")
    plan = db.scalar(select(MembershipPlan).where(MembershipPlan.code == m.plan_code))
    if not plan:
        raise ValueError("Plan not found")

    ent = next((e for e in plan.entitlements if e["code"] == entitlement_code), None)
    if not ent:
        raise ValueError("Entitlement not included in plan")

    used = m.entitlements_used.get(entitlement_code, 0)
    used_dict = dict(m.entitlements_used)
    used_dict[entitlement_code] = used + 1
    m.entitlements_used = used_dict
    db.commit()
    return m

def membership_renewal_tick(db: Session, now: datetime | None = None) -> int:
    ts = now or datetime.now(timezone.utc)
    today = ts.astimezone(timezone(timedelta(hours=5, minutes=30))).date()
    
    # 7 days before period end, create task
    upcoming = db.scalars(select(Membership).where(
        Membership.status == "ACTIVE",
        Membership.current_period_end == today + timedelta(days=7)
    )).all()

    caller_ids = [u for (u,) in db.execute(select(User.id).where(User.role == "CALLER", User.active))]
    count = 0
    for m in upcoming:
        if caller_ids:
            assign.notify(db, caller_ids, f"Membership renewal call due for patient #{m.patient_id}", f"/patients/view?id={m.patient_id}")
        count += 1

    # Expire if unpaid 7 days after period end
    expired = db.scalars(select(Membership).where(
        Membership.status == "ACTIVE",
        Membership.current_period_end < today - timedelta(days=7)
    )).all()
    for m in expired:
        m.status = "EXPIRED"
        count += 1

    db.commit()
    return count
