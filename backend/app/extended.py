"""Extended clinical services: medicines, refills, referrals, home monitoring & family links (Page 5)."""
import csv
import io
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from . import assign, relationship as rel, storage
from .analysis import load_rules
from .models import (CareTouchpoint, Consent, FamilyLink, Followup, HomeReading, HomeVisit, Patient,
                     PatientBucket, PatientMedication, Referral, RefillSchedule, User)
from .timeutil import IST, today_ist

MAX_HOME_CSV_BYTES = 5 * 1024 * 1024
HOME_KINDS = {"BP", "GLUCOSE_FASTING", "GLUCOSE_RANDOM", "WEIGHT", "SPO2"}
DELIVERY_MODES = {"HOME_DELIVERY", "PICKUP_AT_HUB"}
REFERRAL_URGENCY = {"ROUTINE", "SOON", "URGENT"}
REFERRAL_STATUS = {"SUGGESTED", "BOOKED", "DONE", "DECLINED"}
VISIT_STATUS = {"SCHEDULED", "DONE", "CANCELLED"}


def refill_tick(db: Session, now: datetime | None = None) -> int:
    """Creates caller reminder tasks 3 days before next_refill_on (IST). Never exposes drug names."""
    today = (now or datetime.now(timezone.utc)).astimezone(IST).date()
    due_cutoff = today + timedelta(days=3)
    schedules = list(db.scalars(
        select(RefillSchedule).where(RefillSchedule.status == "ACTIVE", RefillSchedule.next_refill_on <= due_cutoff)
    ))
    caller_ids = [u for (u,) in db.execute(select(User.id).where(User.role == "CALLER", User.active))]
    created = 0
    for s in schedules:
        if s.reminder_sent_for == s.next_refill_on:
            continue
        s.reminder_sent_for = s.next_refill_on
        s.task_status = "DUE"
        s.task_due_on = s.next_refill_on - timedelta(days=3)
        if caller_ids:
            assign.notify(db, caller_ids, "Pharmacy refill reminder call", "/followups")
        created += 1
    if created:
        db.commit()
    return created


def check_home_reading_alert(kind: str, values: dict) -> str:
    """Starter alert thresholds for home monitoring; clinician to confirm."""
    if kind == "BP":
        sys_v, dia_v = float(values.get("systolic") or 0), float(values.get("diastolic") or 0)
        if sys_v >= 140 or dia_v >= 90 or (0 < sys_v < 90):
            return "BP threshold crossed"
    elif kind == "GLUCOSE_FASTING":
        v = float(values.get("value") or 0)
        if v >= 126 or (0 < v < 70):
            return "Fasting glucose threshold crossed"
    elif kind == "GLUCOSE_RANDOM":
        v = float(values.get("value") or 0)
        if v >= 200 or (0 < v < 70):
            return "Random glucose threshold crossed"
    elif kind == "SPO2":
        v = float(values.get("value") or 100)
        if 0 < v < 94:
            return "Low SpO2 threshold crossed"
    return ""


def parse_home_readings_csv(raw: bytes) -> list[dict]:
    if len(raw) > MAX_HOME_CSV_BYTES:
        raise ValueError("File is larger than 5 MB")
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig", errors="replace"))))
    if not rows:
        raise ValueError("CSV file is empty")
    out = []
    for row in rows[:5000]:
        kind = str(row.get("kind") or "").strip().upper()
        if kind not in HOME_KINDS:
            raise ValueError(f"Unsupported reading kind: {kind}")
        taken_raw = str(row.get("taken_at") or "").strip()
        try:
            taken = datetime.fromisoformat(taken_raw) if taken_raw else datetime.now(timezone.utc)
            if taken.tzinfo is None:
                taken = taken.replace(tzinfo=IST).astimezone(timezone.utc)
        except ValueError:
            raise ValueError(f"Invalid taken_at: {taken_raw}")
        if kind == "BP":
            vals = {"systolic": int(float(row["systolic"])), "diastolic": int(float(row["diastolic"]))}
        else:
            vals = {"value": float(row["value"])}
        out.append({"kind": kind, "values": vals, "taken_at": taken})
    return out


def ensure_referral_for_accepted_program(db: Session, patient_id: int, followup_id: int | None,
                                        program_code: str, specialty: str, user_id: int | None) -> Referral | None:
    if not specialty:
        return None
    existing = db.scalar(select(Referral).where(
        Referral.patient_id == patient_id, Referral.reason_code == program_code, Referral.status != "DECLINED"
    ))
    if existing:
        return existing
    ref = Referral(
        patient_id=patient_id, followup_id=followup_id, specialty=specialty, reason_code=program_code,
        urgency="ROUTINE", status="SUGGESTED", created_by=user_id,
    )
    db.add(ref)
    db.flush()
    return ref


def consenting_family_summaries(db: Session, patient_id: int) -> list[dict]:
    """Returns linked family members; clinical info is returned ONLY when that member recorded consent."""
    root = rel.canonical_patient_id(db, patient_id)
    links = list(db.scalars(select(FamilyLink).where(FamilyLink.patient_id == root).order_by(FamilyLink.id)))
    out = []
    for ln in links:
        rp = db.get(Patient, ln.related_patient_id)
        if not rp or rp.merged_into_id:
            continue
        has_consent = ln.consent_id is not None and db.get(Consent, ln.consent_id) is not None
        item = {
            "id": ln.id,
            "related_patient_id": rp.id,
            "name": rp.name,
            "relationship": ln.relationship,
            "has_consent": has_consent,
            "consent_id": ln.consent_id,
            "summary": None,
        }
        if has_consent:
            from . import programs as prog_svc
            prof, _, _ = prog_svc.get_profile(db, rp.id)
            buckets = sorted({
                b.bucket_code for b in db.scalars(
                    select(PatientBucket).where(PatientBucket.patient_id == rp.id, PatientBucket.active.is_(True))
                ) if b.bucket_code != "OTHER"
            })
            confirmed = sorted({c["code"] for c in prof.get("conditions", []) if c.get("status") == "CONFIRMED"})
            item["summary"] = {
                "age": rp.age,
                "confirmed_conditions": confirmed,
                "active_buckets": buckets,
                "recommended_screening": bool(confirmed or buckets),
            }
        out.append(item)
    return out


def med_out(m: PatientMedication, catalogue: dict[str, dict], sched: RefillSchedule | None) -> dict:
    meta = catalogue.get(m.medicine_code, {})
    return {
        "id": m.id,
        "patient_id": m.patient_id,
        "medicine_code": m.medicine_code,
        "generic_name": meta.get("generic_name", m.medicine_code),
        "drug_class": meta.get("drug_class", ""),
        "is_chronic": bool(meta.get("is_chronic", False)),
        "dose_text": storage.decrypt_str(m.dose_text_enc) if m.dose_text_enc else "",
        "started_on": m.started_on,
        "last_changed_on": m.last_changed_on,
        "stopped_on": m.stopped_on,
        "prescribed_by": storage.decrypt_str(m.prescribed_by_enc) if m.prescribed_by_enc else "",
        "source": m.source,
        "refill": {
            "id": sched.id,
            "refill_every_days": sched.refill_every_days,
            "next_refill_on": sched.next_refill_on,
            "delivery_mode": sched.delivery_mode,
            "delivery_ref": sched.delivery_ref,
            "status": sched.status,
            "task_status": sched.task_status,
        } if sched else None,
    }
