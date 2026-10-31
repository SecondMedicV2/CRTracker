"""Unique patient identity (Part 9): name + gender + mobile.
exact match -> auto-link; near match -> human review; shared mobile with a different
person -> separate patient in a household."""
import hashlib
import hmac
import re
from datetime import datetime, timezone
from difflib import SequenceMatcher

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from . import followup, status, storage
from .config import env
from .models import Followup, IdentityReview, Order, Patient, PatientBucket, Report
from .settings_store import get_setting

TITLES = {"mr", "mrs", "ms", "miss", "mx", "dr", "shri", "smt", "sri", "shrimati"}


def norm_name(s: str) -> str:
    words = re.sub(r"[^\w\s]|\d|_", " ", (s or "").lower()).split()
    while words and words[0] in TITLES:
        words.pop(0)
    return " ".join(words)


def norm_mobile(s: str) -> str:
    """Digits only, +91 / 91 / leading 0 stripped. '' if it is not a 10-digit number."""
    d = re.sub(r"\D", "", s or "")
    if len(d) == 12 and d.startswith("91"):
        d = d[2:]
    elif len(d) == 11 and d.startswith("0"):
        d = d[1:]
    return d if len(d) == 10 else ""


# shortcut: keyed on SECRET_KEY, so rotating it needs a re-hash of patients.mobile_hash.
def mobile_hash(m: str) -> str:
    return hmac.new(env.secret_key.encode(), m.encode(), hashlib.sha256).hexdigest() if m else ""


def is_similar(a: str, b: str, threshold: float) -> bool:
    sm = SequenceMatcher(None, a, b)
    t = threshold / 100
    # the first two are cheap upper bounds: most pairs are rejected without the full comparison
    return sm.real_quick_ratio() >= t and sm.quick_ratio() >= t and sm.ratio() >= t


def _age_close(a, b) -> bool:
    return a is not None and b is not None and abs(a - b) <= 1  # reports are months/years apart


def resolve(db: Session, order: Order, report: Report) -> str:
    """Sets order.patient_id. Returns 'pending' if a human must decide, else 'linked'."""
    if order.patient_id:  # re-run of an already linked order: never create a second patient
        return "linked"
    name_n = norm_name(report.patient_name)
    mob = norm_mobile(storage.decrypt_str(report.mobile_enc)) if report.mobile_enc else ""
    h = mobile_hash(mob)
    thr = get_setting(db, "identity_name_similarity_pct")
    live = Patient.merged_into_id.is_(None)

    same_mobile = db.scalars(select(Patient).where(live, Patient.mobile_hash == h)).all() if h else []
    for p in same_mobile:
        if p.name_norm == name_n and p.gender == report.gender:
            order.patient_id, p.age = p.id, report.age
            return "linked"

    reason, cand = "", None
    for p in same_mobile:  # same number, similar name and gender: probably a typo
        if p.gender == report.gender and is_similar(p.name_norm, name_n, thr):
            reason, cand = "Same mobile and similar name", p
            break
    if not cand and name_n and report.age is not None:
        # names that are >= thr% alike cannot differ much in length: lets the database drop most rows
        lo, hi = int(len(name_n) * thr / (200 - thr)), int(len(name_n) * (200 - thr) / thr) + 1
        rows = db.execute(select(Patient.id, Patient.name_norm, Patient.mobile_hash, Patient.age).where(
            live, Patient.gender == report.gender, Patient.age.between(report.age - 1, report.age + 1),
            func.length(Patient.name_norm).between(lo, hi))).all()
        for pid, pname, phash, _ in rows:
            if h and phash == h:
                continue  # same mobile is handled above (household)
            if pname == name_n:
                reason = "Same name and age, different mobile" if (h and phash) else "Same name and age, mobile missing"
            elif is_similar(pname, name_n, thr):
                reason = "Similar name, same gender and age, different mobile"
            else:
                continue
            cand = db.get(Patient, pid)
            break

    new = Patient(name=report.patient_name, name_norm=name_n, gender=report.gender, age=report.age,
                  mobile_enc=report.mobile_enc, mobile_hash=h)
    db.add(new)
    db.flush()
    order.patient_id = new.id
    if cand:
        db.add(IdentityReview(patient_a_id=cand.id, patient_b_id=new.id, order_id=order.id, reason=reason))
        return "pending"
    if same_mobile:  # shared number, different person: keep apart, tag as one household
        tag = "HH-" + h[:8]
        new.household_tag = tag
        for p in same_mobile:
            p.household_tag = tag
    return "linked"


def decide(db: Session, review: IdentityReview, decision: str, user_id: int) -> None:
    a, b = db.get(Patient, review.patient_a_id), db.get(Patient, review.patient_b_id)
    if decision == "SAME":
        review.moved_order_ids = list(db.scalars(select(Order.id).where(Order.patient_id == b.id)))
        db.execute(update(Order).where(Order.patient_id == b.id).values(patient_id=a.id))
        for model in (Followup, PatientBucket):  # follow-ups and buckets follow the merged patient
            db.execute(update(model).where(model.patient_id == b.id).values(patient_id=a.id))
        b.merged_into_id = a.id
        a.age = b.age if b.age is not None else a.age
    review.status, review.decided_by, review.decided_at = decision, user_id, datetime.now(timezone.utc)
    order = db.get(Order, review.order_id)
    if order.status == status.PENDING_IDENTITY:
        status.move(order, status.READY)
        followup.build(db, order)
    db.commit()


def unmerge(db: Session, review: IdentityReview, user_id: int) -> None:
    b = db.get(Patient, review.patient_b_id)
    b.merged_into_id = None
    if review.moved_order_ids:
        db.execute(update(Order).where(Order.id.in_(review.moved_order_ids)).values(patient_id=b.id))
        report_ids = select(Report.id).where(Report.order_id.in_(review.moved_order_ids))
        for model in (Followup, PatientBucket):
            db.execute(update(model).where(model.report_id.in_(report_ids)).values(patient_id=b.id))
    review.status, review.decided_by, review.decided_at = "UNMERGED", user_id, datetime.now(timezone.utc)
    db.commit()
