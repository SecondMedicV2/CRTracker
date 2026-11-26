"""Extended clinical features router: medicines, refills, referrals, home readings/visits, family (Page 5)."""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import assign, extended as ext, programs as prog_svc, relationship as rel, storage
from ..analysis import load_rules
from ..db import get_db
from ..models import (CareTouchpoint, Consent, FamilyLink, HomeReading, HomeVisit, Patient, PatientMedication,
                      Referral, RefillSchedule, User)
from ..security import audit, current_user, require
from ..timeutil import IST, today_ist
from .insights import _csv
from .patients import mobile_out

router = APIRouter(tags=["extended"])
clinical = require("ADMIN", "DOCTOR")
staff3 = require("ADMIN", "DOCTOR", "CALLER")


def _patient(db: Session, pid: int) -> Patient:
    p = db.get(Patient, pid)
    if not p:
        raise HTTPException(404, "No such patient")
    root = rel.canonical_patient_id(db, pid)
    return db.get(Patient, root) if root != pid else p


def _reeval(db: Session, pid: int) -> None:
    rel.sync_touchpoints(db, pid, commit=False)
    prog_svc.evaluate(db, pid, commit=False)


# ---- A. Medicines (doctor/admin only; callers get 403) ----
@router.get("/patients/{pid}/medicines")
def list_medicines(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    cat = {m["code"]: m for m in load_rules(db).get("medicine_catalogue", [])}
    meds = list(db.scalars(select(PatientMedication).where(PatientMedication.patient_id == p.id).order_by(PatientMedication.id.desc())))
    scheds = {s.patient_medication_id: s for s in db.scalars(select(RefillSchedule).where(RefillSchedule.patient_id == p.id))}
    audit(db, request, me.id, "view", "patient_medicines", p.id)
    return [ext.med_out(m, cat, scheds.get(m.id)) for m in meds]


class MedIn(BaseModel):
    medicine_code: str = Field(max_length=50)
    dose_text: str = Field("", max_length=120)
    started_on: date | None = None
    prescribed_by: str = Field("", max_length=120)
    source: str = "DOCTOR"
    refill_every_days: int | None = None
    delivery_mode: str = "HOME_DELIVERY"


@router.post("/patients/{pid}/medicines", status_code=201)
def add_medicine(pid: int, body: MedIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    cat = {m["code"]: m for m in load_rules(db).get("medicine_catalogue", [])}
    code = body.medicine_code.strip().upper()
    if code not in cat:
        raise HTTPException(422, f"Unknown medicine_code: {code}")
    if body.source not in ("DOCTOR", "PATIENT_REPORTED"):
        raise HTTPException(422, "source must be DOCTOR or PATIENT_REPORTED")
    if body.delivery_mode not in ext.DELIVERY_MODES:
        raise HTTPException(422, "delivery_mode must be HOME_DELIVERY or PICKUP_AT_HUB")
    start = body.started_on or today_ist()
    med = PatientMedication(
        patient_id=p.id,
        medicine_code=code,
        dose_text_enc=storage.encrypt_str(body.dose_text.strip()) if body.dose_text.strip() else "",
        started_on=start,
        last_changed_on=start,
        prescribed_by_enc=storage.encrypt_str(body.prescribed_by.strip()) if body.prescribed_by.strip() else "",
        source=body.source,
        created_by=me.id,
    )
    db.add(med)
    db.flush()
    sched = None
    meta = cat[code]
    every = body.refill_every_days or meta.get("default_refill_days")
    if meta.get("is_chronic") or body.refill_every_days:
        days = max(1, int(every or 30))
        sched = RefillSchedule(
            patient_medication_id=med.id, patient_id=p.id, refill_every_days=days,
            next_refill_on=start + timedelta(days=days), delivery_mode=body.delivery_mode, status="ACTIVE",
        )
        db.add(sched)
        db.flush()
    _reeval(db, p.id)
    db.commit()
    # Audit only the numeric medication row id, never medicine_code or dose.
    audit(db, request, me.id, "create", "patient_medication", med.id)
    return ext.med_out(med, cat, sched)


class MedPatch(BaseModel):
    dose_text: str | None = Field(None, max_length=120)
    stopped_on: date | None = None
    last_changed_on: date | None = None
    delivery_mode: str | None = None


@router.patch("/medicines/{mid}")
def patch_medicine(mid: int, body: MedPatch, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    med = db.get(PatientMedication, mid)
    if not med:
        raise HTTPException(404, "No such medication")
    if body.dose_text is not None:
        med.dose_text_enc = storage.encrypt_str(body.dose_text.strip()) if body.dose_text.strip() else ""
        med.last_changed_on = body.last_changed_on or today_ist()
    elif body.last_changed_on is not None:
        med.last_changed_on = body.last_changed_on
    sched = db.scalar(select(RefillSchedule).where(RefillSchedule.patient_medication_id == med.id))
    if body.stopped_on is not None:
        med.stopped_on = body.stopped_on
        if sched:
            sched.status = "STOPPED"
    if body.delivery_mode is not None and sched:
        if body.delivery_mode not in ext.DELIVERY_MODES:
            raise HTTPException(422, "Invalid delivery_mode")
        sched.delivery_mode = body.delivery_mode
    _reeval(db, med.patient_id)
    db.commit()
    audit(db, request, me.id, "update", "patient_medication", med.id)
    cat = {m["code"]: m for m in load_rules(db).get("medicine_catalogue", [])}
    return ext.med_out(med, cat, sched)


# ---- B. Refill tasks & confirmation ----
@router.get("/refill-tasks")
def list_refill_tasks(db: Session = Depends(get_db), me: User = Depends(staff3)):
    rows = db.execute(
        select(RefillSchedule, Patient).join(Patient, Patient.id == RefillSchedule.patient_id)
        .where(RefillSchedule.status == "ACTIVE", RefillSchedule.task_status == "DUE")
        .order_by(RefillSchedule.next_refill_on, RefillSchedule.id)
    ).all()
    return [
        {
            "id": s.id,
            "patient_id": p.id,
            "patient_name": p.name,
            "mobile": mobile_out(p, me),
            "label": "Pharmacy refill reminder call",
            "next_refill_on": s.next_refill_on,
            "task_due_on": s.task_due_on,
            "delivery_mode": s.delivery_mode,
            "status": s.task_status,
        }
        for s, p in rows
    ]


class RefillConfirm(BaseModel):
    delivery_ref: str = Field("", max_length=60)
    amount_inr: int | None = None


@router.post("/refill-schedules/{sid}/confirm")
def confirm_refill(sid: int, body: RefillConfirm, request: Request, db: Session = Depends(get_db), me: User = Depends(staff3)):
    s = db.get(RefillSchedule, sid)
    if not s:
        raise HTTPException(404, "No such refill schedule")
    s.delivery_ref = body.delivery_ref.strip()[:60]
    s.next_refill_on = max(s.next_refill_on, today_ist()) + timedelta(days=s.refill_every_days)
    s.task_status = "DONE"
    amt = body.amount_inr if (me.role == "ADMIN" and body.amount_inr is not None) else None
    db.add(CareTouchpoint(
        patient_id=s.patient_id, stage="MEDICATIONS", service_code="PHARMACY_REFILL",
        occurred_on=today_ist(), source="MANUAL", ref_entity="refill", ref_id=s.id,
        amount_inr=amt, created_by=me.id,
    ))
    db.commit()
    audit(db, request, me.id, "refill_confirm", "refill_schedule", s.id)
    return {"id": s.id, "next_refill_on": s.next_refill_on, "delivery_ref": s.delivery_ref, "task_status": s.task_status}


# ---- E. Specialist referrals ----
@router.get("/patients/{pid}/referrals")
def list_referrals(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(current_user)):
    p = _patient(db, pid)
    specs = load_rules(db).get("referral_specialties", {})
    rows = list(db.scalars(select(Referral).where(Referral.patient_id == p.id).order_by(Referral.id.desc())))
    audit(db, request, me.id, "view", "referrals", p.id)
    if me.role == "CALLER":
        return [
            {
                "id": r.id,
                "label": specs.get(r.specialty, "Specialist appointment to book"),
                "urgency": r.urgency,
                "status": r.status,
                "scheduled_for": r.scheduled_for,
            }
            for r in rows if r.status != "DECLINED"
        ]
    return [
        {
            "id": r.id, "patient_id": r.patient_id, "followup_id": r.followup_id,
            "specialty": r.specialty, "reason_code": r.reason_code, "urgency": r.urgency,
            "status": r.status, "appointment_ref": r.appointment_ref, "scheduled_for": r.scheduled_for,
            "created_at": r.created_at,
        }
        for r in rows
    ]


class ReferralIn(BaseModel):
    specialty: str = Field(max_length=60)
    followup_id: int | None = None
    reason_code: str = Field("", max_length=60)
    urgency: str = "ROUTINE"
    scheduled_for: date | None = None


@router.post("/patients/{pid}/referrals", status_code=201)
def create_referral(pid: int, body: ReferralIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    specs = load_rules(db).get("referral_specialties", {})
    if body.specialty not in specs:
        raise HTTPException(422, f"Unknown specialty: {body.specialty}")
    if body.urgency not in ext.REFERRAL_URGENCY:
        raise HTTPException(422, "Invalid urgency")
    ref = Referral(
        patient_id=p.id, followup_id=body.followup_id, specialty=body.specialty,
        reason_code=body.reason_code.strip().upper()[:60], urgency=body.urgency,
        status="SUGGESTED", scheduled_for=body.scheduled_for, created_by=me.id,
    )
    db.add(ref)
    db.flush()
    _reeval(db, p.id)
    db.commit()
    audit(db, request, me.id, "create", "referral", ref.id)
    return {"id": ref.id, "patient_id": ref.patient_id, "specialty": ref.specialty, "urgency": ref.urgency,
            "status": ref.status, "scheduled_for": ref.scheduled_for}


class ReferralPatch(BaseModel):
    status: str | None = None
    appointment_ref: str | None = Field(None, max_length=80)
    scheduled_for: date | None = None


@router.patch("/referrals/{rid}")
def patch_referral(rid: int, body: ReferralPatch, request: Request, db: Session = Depends(get_db), me: User = Depends(staff3)):
    ref = db.get(Referral, rid)
    if not ref:
        raise HTTPException(404, "No such referral")
    if body.status is not None:
        st = body.status.strip().upper()
        if st not in ext.REFERRAL_STATUS:
            raise HTTPException(422, "Invalid status")
        if me.role == "CALLER" and st != "BOOKED":
            raise HTTPException(403, "Callers can only mark referrals as BOOKED")
        ref.status = st
    if body.appointment_ref is not None:
        ref.appointment_ref = body.appointment_ref.strip()[:80]
    if body.scheduled_for is not None:
        ref.scheduled_for = body.scheduled_for
    db.commit()
    audit(db, request, me.id, "update", "referral", ref.id)
    if me.role == "CALLER":
        return {"id": ref.id, "label": "Specialist appointment to book", "status": ref.status, "scheduled_for": ref.scheduled_for}
    return {"id": ref.id, "specialty": ref.specialty, "status": ref.status,
            "appointment_ref": ref.appointment_ref, "scheduled_for": ref.scheduled_for}


# ---- F. Home readings & home visits ----
@router.get("/patients/{pid}/home-readings")
def list_home_readings(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    rows = list(db.scalars(select(HomeReading).where(HomeReading.patient_id == p.id).order_by(HomeReading.taken_at.desc(), HomeReading.id.desc()).limit(200)))
    audit(db, request, me.id, "view", "home_readings", p.id)
    return [
        {"id": r.id, "patient_id": r.patient_id, "kind": r.kind, "values": r.values,
         "taken_at": r.taken_at, "source": r.source, "alert": ext.check_home_reading_alert(r.kind, r.values)}
        for r in rows
    ]


class ReadingIn(BaseModel):
    kind: str
    values: dict
    taken_at: datetime | None = None


@router.post("/patients/{pid}/home-readings", status_code=201)
def add_home_reading(pid: int, body: ReadingIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    kind = body.kind.strip().upper()
    if kind not in ext.HOME_KINDS:
        raise HTTPException(422, f"kind must be one of {sorted(ext.HOME_KINDS)}")
    taken = body.taken_at or datetime.now(timezone.utc)
    if taken.tzinfo is None:
        taken = taken.replace(tzinfo=IST).astimezone(timezone.utc)
    hr = HomeReading(patient_id=p.id, kind=kind, values=body.values, taken_at=taken, source="MANUAL_STAFF", entered_by=me.id)
    db.add(hr)
    db.flush()
    alert = ext.check_home_reading_alert(kind, body.values)
    if alert:
        assign.notify(db, assign.doctor_users(db), "Home monitoring alert", f"/patients/view?id={p.id}", urgent=True)
    _reeval(db, p.id)
    db.commit()
    audit(db, request, me.id, "create", "home_reading", hr.id)
    return {"id": hr.id, "kind": hr.kind, "values": hr.values, "taken_at": hr.taken_at, "alert": alert}


@router.post("/patients/{pid}/home-readings/import", status_code=201)
async def import_home_readings(pid: int, request: Request, file: UploadFile = File(...),
                               db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    raw = await file.read(ext.MAX_HOME_CSV_BYTES + 1)
    try:
        items = ext.parse_home_readings_csv(raw)
    except ValueError as err:
        code = 413 if "5 MB" in str(err) else 422
        raise HTTPException(code, str(err))
    alerts = 0
    for item in items:
        hr = HomeReading(patient_id=p.id, kind=item["kind"], values=item["values"], taken_at=item["taken_at"],
                         source="CSV_IMPORT", entered_by=me.id)
        db.add(hr)
        if ext.check_home_reading_alert(item["kind"], item["values"]):
            alerts += 1
    if alerts:
        assign.notify(db, assign.doctor_users(db), "Home monitoring alert", f"/patients/view?id={p.id}", urgent=True)
    _reeval(db, p.id)
    db.commit()
    audit(db, request, me.id, "import", "home_readings", f"{p.id}:{len(items)}")
    return {"imported": len(items), "alerts": alerts}


@router.get("/patients/{pid}/home-readings.csv")
def export_home_readings(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    rows = list(db.scalars(select(HomeReading).where(HomeReading.patient_id == p.id).order_by(HomeReading.taken_at.desc())))
    audit(db, request, me.id, "export", "home_readings", p.id)
    return _csv(
        f"home-readings-{p.id}.csv",
        ["Date", "Kind", "Systolic", "Diastolic", "Value", "Source"],
        [
            [r.taken_at.isoformat(), r.kind, r.values.get("systolic", ""), r.values.get("diastolic", ""),
             r.values.get("value", ""), r.source]
            for r in rows
        ],
    )


@router.get("/patients/{pid}/home-visits")
def list_home_visits(pid: int, db: Session = Depends(get_db), _: User = Depends(clinical)):
    p = _patient(db, pid)
    rows = list(db.scalars(select(HomeVisit).where(HomeVisit.patient_id == p.id).order_by(HomeVisit.scheduled_on.desc(), HomeVisit.id.desc())))
    return [{"id": v.id, "patient_id": v.patient_id, "purpose_code": v.purpose_code, "scheduled_on": v.scheduled_on,
             "status": v.status, "staff_name": v.staff_name} for v in rows]


class VisitIn(BaseModel):
    purpose_code: str = Field(max_length=40)
    scheduled_on: date
    staff_name: str = Field("", max_length=120)


@router.post("/patients/{pid}/home-visits", status_code=201)
def create_home_visit(pid: int, body: VisitIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    v = HomeVisit(patient_id=p.id, purpose_code=body.purpose_code.strip().upper(), scheduled_on=body.scheduled_on,
                  staff_name=body.staff_name.strip(), status="SCHEDULED", created_by=me.id)
    db.add(v)
    db.commit()
    audit(db, request, me.id, "create", "home_visit", v.id)
    return {"id": v.id, "patient_id": v.patient_id, "purpose_code": v.purpose_code, "scheduled_on": v.scheduled_on,
            "status": v.status, "staff_name": v.staff_name}


class VisitPatch(BaseModel):
    status: str


@router.patch("/home-visits/{vid}")
def patch_home_visit(vid: int, body: VisitPatch, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    v = db.get(HomeVisit, vid)
    if not v:
        raise HTTPException(404, "No such visit")
    st = body.status.strip().upper()
    if st not in ext.VISIT_STATUS:
        raise HTTPException(422, "Invalid visit status")
    v.status = st
    db.commit()
    audit(db, request, me.id, "update", "home_visit", v.id)
    return {"id": v.id, "status": v.status}


# ---- G. Consent-gated family links ----
@router.get("/patients/{pid}/family")
def get_family(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    household = []
    if p.household_tag:
        household = [
            {"id": h.id, "name": h.name}
            for h in db.scalars(select(Patient).where(
                Patient.household_tag == p.household_tag, Patient.id != p.id, Patient.merged_into_id.is_(None)
            ))
        ]
    links = ext.consenting_family_summaries(db, p.id)
    audit(db, request, me.id, "view", "family_links", p.id)
    return {"patient_id": p.id, "household_tag": p.household_tag, "household": household, "links": links}


class FamilyLinkIn(BaseModel):
    related_patient_id: int
    relationship: str = Field(max_length=40)


@router.post("/patients/{pid}/family-links", status_code=201)
def create_family_link(pid: int, body: FamilyLinkIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    rp = _patient(db, body.related_patient_id)
    if rp.id == p.id:
        raise HTTPException(422, "Cannot link a patient to themselves")
    existing = db.scalar(select(FamilyLink).where(FamilyLink.patient_id == p.id, FamilyLink.related_patient_id == rp.id))
    if existing:
        raise HTTPException(409, "Family link already exists")
    ln = FamilyLink(patient_id=p.id, related_patient_id=rp.id, relationship=body.relationship.strip()[:40])
    db.add(ln)
    db.commit()
    audit(db, request, me.id, "create", "family_link", ln.id)
    return {"id": ln.id, "related_patient_id": rp.id, "relationship": ln.relationship, "has_consent": False}


@router.post("/family-links/{lid}/consent", status_code=201)
def record_family_consent(lid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    ln = db.get(FamilyLink, lid)
    if not ln:
        raise HTTPException(404, "No such family link")
    if not ln.consent_id:
        c = Consent(patient_id=ln.related_patient_id, followup_id=None, given_by_user=me.id, channel="family_link")
        db.add(c)
        db.flush()
        ln.consent_id = c.id
    _reeval(db, ln.patient_id)
    db.commit()
    audit(db, request, me.id, "consent", "family_link", ln.id)
    return {"id": ln.id, "consent_id": ln.consent_id, "has_consent": True}
