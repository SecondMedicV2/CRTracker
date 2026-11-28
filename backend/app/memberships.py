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
    """Insert missing plans only: the catalogue is admin-edited, so a restart must not overwrite those edits."""
    for p in HEALTH360_PLANS:
        if not db.scalar(select(MembershipPlan).where(MembershipPlan.code == p["code"])):
            db.add(MembershipPlan(**p))
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

def editable_plan_fields() -> tuple[str, ...]:
    return ("name", "target_text", "price_inr_monthly", "benefits_text", "includes_plan", "entitlements", "active")


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

PAID_STATUSES = ("ACTIVE", "RENEWAL_DUE")
SIGNOFF_PLANS = ("H360_CHRONIC",)  # clinician-supervised: a doctor must sign off before it starts


def _plan(db: Session, code: str) -> MembershipPlan:
    plan = db.scalar(select(MembershipPlan).where(MembershipPlan.code == code))
    if not plan:
        raise ValueError("Plan not found")
    return plan


def effective_entitlements(db: Session, plan_code: str) -> dict[str, int]:
    """Entitlements of a plan plus those of the plans it includes (Plus includes Essential, and so on)."""
    out: dict[str, int] = {}
    seen: set[str] = set()
    code = plan_code
    while code and code not in seen:
        seen.add(code)
        p = db.scalar(select(MembershipPlan).where(MembershipPlan.code == code))
        if not p:
            break
        for e in p.entitlements or []:
            out[e["code"]] = out.get(e["code"], 0) + int(e.get("quantity") or 0)
        code = p.includes_plan
    return out


def _next_status(m: Membership, paid: bool) -> str:
    if m.plan_code in SIGNOFF_PLANS and m.signed_off_at is None:
        return "PENDING_SIGNOFF"
    return "ACTIVE" if paid else "PENDING_PAYMENT"


def enroll_membership(db: Session, patient_id: int, plan_code: str, payer: str = "SELF", corporate_client_id: int | None = None,
                      enrolled_by: int | None = None, health_hub_id: int | None = None, payment_details: dict | None = None,
                      enrolled_by_role: str = "", member_ref: str = ""):
    """Free is always active. Corporate members are billed to the employer. Everyone else pays at the counter;
    Chronic also waits for a doctor's sign-off (a doctor enrolling signs off at once)."""
    from .outcomes import assert_plan_sale_allowed

    plan = _plan(db, plan_code)
    payer = (payer or "SELF").upper()
    if payer == "CORPORATE" and not corporate_client_id:
        raise ValueError("A corporate membership needs a corporate client")
    if plan.price_inr_monthly > 0:
        assert_plan_sale_allowed(db, patient_id)

    start_d = today_ist()
    m = Membership(patient_id=patient_id, plan_code=plan_code, status="PENDING_PAYMENT", payer=payer,
                   corporate_client_id=corporate_client_id, start_on=start_d, current_period_end=start_d + timedelta(days=30),
                   enrolled_by=enrolled_by, health_hub_id=health_hub_id, entitlements_used={}, member_ref=member_ref[:60])
    if plan_code in SIGNOFF_PLANS and enrolled_by_role.upper() == "DOCTOR":
        m.signed_off_by, m.signed_off_at = enrolled_by, datetime.now(timezone.utc)
    db.add(m)
    db.flush()

    paid = plan.price_inr_monthly == 0 or payer == "CORPORATE"
    amount = int((payment_details or {}).get("amount_inr") or 0)
    if not paid and amount > 0:
        _add_payment(db, m, amount, payment_details or {}, enrolled_by, health_hub_id)
        paid = True
    m.status = _next_status(m, paid)
    db.commit()
    return m


def _add_payment(db: Session, m: Membership, amount: int, details: dict, user_id: int | None, hub_id: int | None) -> Payment:
    if amount <= 0:
        raise ValueError("amount_inr must be positive")
    pay = Payment(patient_id=m.patient_id, membership_id=m.id, amount_inr=amount,
                  method=(details.get("method") or "COUNTER_CASH")[:30], reference=(details.get("reference") or "")[:60],
                  status=details.get("status", "PAID"), health_hub_id=hub_id or m.health_hub_id, received_by=user_id,
                  received_at=datetime.now(timezone.utc))
    db.add(pay)
    db.flush()
    return pay


def has_paid(db: Session, m: Membership) -> bool:
    return bool(db.scalar(select(Payment.id).where(Payment.membership_id == m.id, Payment.status == "PAID").limit(1)))


def sign_off_membership(db: Session, membership_id: int, doctor_user_id: int) -> Membership:
    m = db.get(Membership, membership_id)
    if not m:
        raise ValueError("Membership not found")
    if m.plan_code not in SIGNOFF_PLANS:
        raise ValueError("This plan does not need a doctor's sign-off")
    if m.status not in ("PENDING_SIGNOFF", "PENDING_PAYMENT", "ACTIVE"):
        raise ValueError(f"Cannot sign off a {m.status.lower()} membership")
    if m.signed_off_at is None:
        m.signed_off_by, m.signed_off_at = doctor_user_id, datetime.now(timezone.utc)
    if m.status == "PENDING_SIGNOFF":
        m.status = _next_status(m, has_paid(db, m) or m.payer == "CORPORATE")
    db.commit()
    return m


def record_membership_payment(db: Session, membership_id: int, amount_inr: int, details: dict, user_id: int | None) -> Membership:
    """A counter payment. On a live or lapsed membership it renews it for another month."""
    from .outcomes import assert_plan_sale_allowed

    m = db.get(Membership, membership_id)
    if not m:
        raise ValueError("Membership not found")
    if m.status == "CANCELLED":
        raise ValueError("Cannot take a payment on a cancelled membership")
    assert_plan_sale_allowed(db, m.patient_id)
    _add_payment(db, m, amount_inr, details, user_id, None)
    if m.status in PAID_STATUSES or m.status == "EXPIRED":
        base = today_ist() if m.status == "EXPIRED" else max(m.current_period_end, today_ist())
        m.current_period_end = base + timedelta(days=30)
        m.renewal_count += 1
        m.last_reminded_on = None
        m.entitlements_used = {}  # a new month starts with a fresh allowance
    m.status = _next_status(m, True)
    db.commit()
    return m


MEMBERSHIP_TRANSITIONS = {"PAUSED": ("ACTIVE", "RENEWAL_DUE"), "ACTIVE": ("PAUSED",),
                          "CANCELLED": ("ACTIVE", "RENEWAL_DUE", "PAUSED", "PENDING_PAYMENT", "PENDING_SIGNOFF")}


def set_membership_status(db: Session, membership_id: int, status: str) -> Membership:
    m = db.get(Membership, membership_id)
    if not m:
        raise ValueError("Membership not found")
    status = (status or "").upper()
    if status not in MEMBERSHIP_TRANSITIONS or m.status not in MEMBERSHIP_TRANSITIONS[status]:
        raise ValueError(f"Cannot change a {m.status.lower()} membership to {status.lower() or 'nothing'}")
    if m.plan_code == "H360_FREE" and status == "CANCELLED":
        raise ValueError("The free plan cannot be cancelled")
    m.status = status
    db.commit()
    return m


def consume_membership_entitlement(db: Session, membership_id: int, entitlement_code: str, commit: bool = True):
    m = db.get(Membership, membership_id)
    if not m:
        raise ValueError("Membership not found")
    if m.status not in PAID_STATUSES:
        raise ValueError("Only an active membership has entitlements to use")
    allowed = effective_entitlements(db, m.plan_code)
    if entitlement_code not in allowed:
        raise ValueError("Entitlement not included in plan")
    used = int((m.entitlements_used or {}).get(entitlement_code, 0))
    if used >= allowed[entitlement_code]:
        raise ValueError(f"{entitlement_code} allowance used up ({used} of {allowed[entitlement_code]})")
    m.entitlements_used = {**(m.entitlements_used or {}), entitlement_code: used + 1}
    if commit:
        db.commit()
    return m


def membership_renewal_tick(db: Session, now: datetime | None = None) -> int:
    """Daily (IST): Free and corporate memberships roll on; a self-paid one gets one caller renewal task
    7 days before its period ends, and expires 7 days after it ends unpaid."""
    ts = now or datetime.now(timezone.utc)
    today = ts.astimezone(timezone(timedelta(hours=5, minutes=30))).date()
    count = 0
    caller_ids = None
    for m in db.scalars(select(Membership).where(Membership.status.in_(PAID_STATUSES))).all():
        if m.plan_code == "H360_FREE" or m.payer == "CORPORATE":
            if m.current_period_end <= today:
                m.current_period_end = today + timedelta(days=365 if m.plan_code == "H360_FREE" else 30)
                count += 1
            continue
        if m.current_period_end < today - timedelta(days=7):
            m.status = "EXPIRED"
            count += 1
        elif m.current_period_end <= today + timedelta(days=7) and m.last_reminded_on is None:
            if caller_ids is None:
                caller_ids = [u for (u,) in db.execute(select(User.id).where(User.role == "CALLER", User.active))]
            if caller_ids:
                assign.notify(db, caller_ids, f"Membership renewal call due for patient #{m.patient_id}", f"/patients/view?id={m.patient_id}")
            m.last_reminded_on = today
            m.status = "RENEWAL_DUE"
            count += 1
    db.commit()
    return count
