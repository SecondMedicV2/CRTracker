"""Patient data export and erasure on request (Part 15.7, DPDP Act). Deliberately a command line tool, not an API:

    python -m app.privacy export 12 --out patient-12.json
    python -m app.privacy erase 12 --yes

Both work on the person as a whole: the patient and any duplicate records merged into them. The audit log keeps a
line saying the erasure happened (ids and counts only, no patient data)."""
import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from . import storage
from .config import env
from .db import SessionLocal
from .models import (Appointment, CallCard, CallLog, CareTouchpoint, ClinicalTask, Comment, Consent, FamilyLink,
                     Followup, HealthProfile, HomeReading, HomeVisit, IdentityReview, MonitoringSchedule,
                     Notification, Order, Patient, PatientBucket, PatientMedication, ProgramRecommendation, Referral,
                     RefillSchedule, Report, ReportParameter, RetestRecommendation)
from .security import audit


def _ids(db: Session, pid: int) -> dict:
    if not db.get(Patient, pid):
        raise ValueError(f"No patient with id {pid}")
    pids = [pid, *db.scalars(select(Patient.id).where(Patient.merged_into_id == pid))]
    orders = list(db.scalars(select(Order).where(Order.patient_id.in_(pids))))
    oids = [o.id for o in orders]
    rids = list(db.scalars(select(Report.id).where(Report.order_id.in_(oids))))
    fids = list(db.scalars(select(Followup.id).where(Followup.patient_id.in_(pids))))
    return {"patients": pids, "orders": orders, "order_ids": oids, "reports": rids, "followups": fids}


def export_patient(db: Session, pid: int) -> dict:
    x = _ids(db, pid)
    rows = lambda model, col, ids: list(db.scalars(select(model).where(col.in_(ids)))) if ids else []
    plain = lambda r: {c.name: (v.isoformat() if hasattr(v, "isoformat") else v) for c in r.__table__.columns if (v := getattr(r, c.name)) is not None}
    people = []
    for p in rows(Patient, Patient.id, x["patients"]):
        d = plain(p)
        d["mobile"] = storage.decrypt_str(p.mobile_enc) if p.mobile_enc else ""
        d.pop("mobile_enc", None), d.pop("mobile_hash", None)
        people.append(d)
    reports = []
    for r in rows(Report, Report.id, x["reports"]):
        d = plain(r)
        d["mobile"] = storage.decrypt_str(r.mobile_enc) if r.mobile_enc else ""
        d.pop("mobile_enc", None)
        d["parameters"] = [plain(p) for p in rows(ReportParameter, ReportParameter.report_id, [r.id])]
        reports.append(d)
    profiles = []
    for hp in rows(HealthProfile, HealthProfile.patient_id, x["patients"]):
        d = plain(hp)
        raw = storage.decrypt_str(hp.payload_enc) if hp.payload_enc else "{}"
        try:
            d["profile"] = json.loads(raw)
        except Exception:
            d["profile"] = {}
        d.pop("payload_enc", None)
        profiles.append(d)
    meds = []
    for m in rows(PatientMedication, PatientMedication.patient_id, x["patients"]):
        md = plain(m)
        md["dose_text"] = storage.decrypt_str(m.dose_text_enc) if m.dose_text_enc else ""
        md["prescribed_by"] = storage.decrypt_str(m.prescribed_by_enc) if m.prescribed_by_enc else ""
        md.pop("dose_text_enc", None)
        md.pop("prescribed_by_enc", None)
        meds.append(md)
    flinks = list(db.scalars(select(FamilyLink).where(or_(FamilyLink.patient_id.in_(x["patients"]), FamilyLink.related_patient_id.in_(x["patients"])))))
    return {"patients": people, "orders": [plain(o) for o in x["orders"]], "reports": reports,
            "followups": [plain(f) for f in rows(Followup, Followup.id, x["followups"])],
            "buckets": [plain(b) for b in rows(PatientBucket, PatientBucket.patient_id, x["patients"])],
            "call_cards": [plain(c) for c in rows(CallCard, CallCard.followup_id, x["followups"])],
            "consents": [plain(c) for c in rows(Consent, Consent.patient_id, x["patients"])],
            "calls": [plain(c) for c in rows(CallLog, CallLog.followup_id, x["followups"])],
            "comments": [plain(c) for c in rows(Comment, Comment.followup_id, x["followups"])],
            "appointments": [plain(a) for a in rows(Appointment, Appointment.followup_id, x["followups"])],
            "retest_recommendations": [plain(r) for r in rows(RetestRecommendation, RetestRecommendation.followup_id, x["followups"])],
            "care_touchpoints": [plain(t) for t in rows(CareTouchpoint, CareTouchpoint.patient_id, x["patients"])],
            "health_profiles": profiles,
            "program_recommendations": [plain(r) for r in rows(ProgramRecommendation, ProgramRecommendation.patient_id, x["patients"])],
            "patient_medications": meds,
            "refill_schedules": [plain(s) for s in rows(RefillSchedule, RefillSchedule.patient_id, x["patients"])],
            "referrals": [plain(r) for r in rows(Referral, Referral.patient_id, x["patients"])],
            "home_readings": [plain(r) for r in rows(HomeReading, HomeReading.patient_id, x["patients"])],
            "home_visits": [plain(v) for v in rows(HomeVisit, HomeVisit.patient_id, x["patients"])],
            "monitoring_schedules": [plain(s) for s in rows(MonitoringSchedule, MonitoringSchedule.patient_id, x["patients"])],
            "clinical_tasks": [plain(t) for t in rows(ClinicalTask, ClinicalTask.patient_id, x["patients"])],
            "family_links": [plain(l) for l in flinks]}


def erase_patient(db: Session, pid: int) -> dict:
    x = _ids(db, pid)
    pids, oids, rids, fids = x["patients"], x["order_ids"], x["reports"], x["followups"]
    counts = {}

    def wipe(name, stmt):
        counts[name] = db.execute(stmt).rowcount

    for o in x["orders"]:  # the stored (encrypted) lab report files
        storage.delete(o.report_path)
    links = [f"/followups/view?id={f}" for f in fids] + [f"/patients/view?id={p}" for p in pids]
    if links:  # notification texts/links tied to the patient
        wipe("notifications", delete(Notification).where(Notification.link.in_(links)))
    if fids:
        for name, model in (("call_cards", CallCard), ("calls", CallLog), ("comments", Comment),
                            ("appointments", Appointment), ("retest_recommendations", RetestRecommendation)):
            wipe(name, delete(model).where(model.followup_id.in_(fids)))
    wipe("family_links", delete(FamilyLink).where(or_(FamilyLink.patient_id.in_(pids), FamilyLink.related_patient_id.in_(pids))))
    wipe("consents", delete(Consent).where(or_(Consent.patient_id.in_(pids), Consent.followup_id.in_(fids or [0]))))
    wipe("refill_schedules", delete(RefillSchedule).where(RefillSchedule.patient_id.in_(pids)))
    wipe("patient_medications", delete(PatientMedication).where(PatientMedication.patient_id.in_(pids)))
    wipe("referrals", delete(Referral).where(Referral.patient_id.in_(pids)))
    wipe("home_readings", delete(HomeReading).where(HomeReading.patient_id.in_(pids)))
    wipe("home_visits", delete(HomeVisit).where(HomeVisit.patient_id.in_(pids)))
    wipe("monitoring_schedules", delete(MonitoringSchedule).where(MonitoringSchedule.patient_id.in_(pids)))
    wipe("clinical_tasks", delete(ClinicalTask).where(ClinicalTask.patient_id.in_(pids)))
    wipe("program_recommendations", delete(ProgramRecommendation).where(ProgramRecommendation.patient_id.in_(pids)))
    wipe("health_profiles", delete(HealthProfile).where(HealthProfile.patient_id.in_(pids)))
    wipe("care_touchpoints", delete(CareTouchpoint).where(CareTouchpoint.patient_id.in_(pids)))
    wipe("identity_reviews", delete(IdentityReview).where(or_(IdentityReview.patient_a_id.in_(pids), IdentityReview.patient_b_id.in_(pids),
                                                              IdentityReview.order_id.in_(oids or [0]))))
    wipe("buckets", delete(PatientBucket).where(PatientBucket.patient_id.in_(pids)))
    wipe("followups", delete(Followup).where(Followup.patient_id.in_(pids)))
    if rids:
        wipe("report_parameters", delete(ReportParameter).where(ReportParameter.report_id.in_(rids)))
    wipe("reports", delete(Report).where(Report.order_id.in_(oids or [0])))
    wipe("orders", delete(Order).where(Order.patient_id.in_(pids)))
    wipe("patients", delete(Patient).where(Patient.merged_into_id.in_([pid])))  # merged duplicates first (they point at the main record)
    counts["patients"] += db.execute(delete(Patient).where(Patient.id == pid)).rowcount
    audit(db, None, None, "erase", "patient", f"{pid}:{sum(counts.values())} rows")
    db.commit()
    return counts


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m app.privacy")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export", help="write everything held about a patient to a JSON file")
    e.add_argument("patient_id", type=int)
    e.add_argument("--out", required=True, help="file to write (contains personal data: store it safely)")
    d = sub.add_parser("erase", help="permanently delete a patient and everything linked to them")
    d.add_argument("patient_id", type=int)
    d.add_argument("--yes", action="store_true", help="required: this cannot be undone")
    a = ap.parse_args(argv)
    with SessionLocal() as db:
        try:
            if a.cmd == "export":
                Path(a.out).write_text(json.dumps(export_patient(db, a.patient_id), indent=2, ensure_ascii=False), encoding="utf-8")
                print(f"Wrote {a.out}")
            else:
                if not a.yes:
                    sys.exit("Refusing to erase without --yes. This permanently deletes the patient and cannot be undone.")
                print("Erased:", erase_patient(db, a.patient_id))
        except ValueError as err:
            sys.exit(str(err))


if __name__ == "__main__":
    main()
