import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app import db as dbmod
from app import privacy, storage
from app.config import env
from app.models import (AuditLog, CallCard, CallLog, Comment, Consent, Followup, Notification, Order, Patient, PatientBucket,
                        Report, ReportParameter)
from tests.test_followups import A1C_SEV, LDL, fu_of, make
from tests.test_workflow import doctor as make_doctor
from tests.test_workflow import new_fu

API = "/api/v1"


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def patient_with_activity(admin, caller, name, mobile):
    """A patient with a stored lab file, a follow-up, call card, consent, call, comment and notification."""
    fid = new_fu(name=name, mobile=mobile)
    admin.post(f"{API}/followups/{fid}/call-card/generate")
    caller.post(f"{API}/followups/{fid}/consent")
    caller.post(f"{API}/followups/{fid}/comments", json={"text": "patient prefers evenings"})
    caller.post(f"{API}/followups/{fid}/calls", json={"outcome": "NOT_REACHABLE", "notes": "no answer"})
    with dbmod.SessionLocal() as db:
        f = db.get(Followup, fid)
        o = db.scalar(select(Order).join(Report, Report.order_id == Order.id).where(Report.id == f.report_id))
        o.report_path = storage.save(b"%PDF fake report for " + name.encode(), "pdf")  # as if fetched from the lab
        db.commit()
        return f.patient_id, fid, o.report_path


def test_export_has_everything_including_the_decrypted_mobile(admin, caller, tmp_path):
    make_doctor(admin, "Dr One")
    pid, fid, _ = patient_with_activity(admin, caller, "Asha Rao", "9876501234")
    out = tmp_path / "p.json"
    privacy.main(["export", str(pid), "--out", str(out)])
    d = json.loads(out.read_text(encoding="utf-8"))
    assert d["patients"][0]["name"] == "Asha Rao" and d["patients"][0]["mobile"] == "9876501234"
    assert "mobile_enc" not in json.dumps(d) and "mobile_hash" not in json.dumps(d)  # no ciphertext or hash in the export
    assert len(d["reports"]) == 1 and {p["param_code"] for p in d["reports"][0]["parameters"]} == {"HBA1C", "LDL"}
    assert d["reports"][0]["mobile"] == "9876501234"
    assert len(d["followups"]) == 1 and len(d["consents"]) == 1 and len(d["calls"]) == 1 and len(d["comments"]) == 1
    assert d["call_cards"] and d["buckets"]


def test_erase_removes_the_patient_and_everything_linked_but_not_others(admin, caller):
    make_doctor(admin, "Dr One")
    pid, fid, path = patient_with_activity(admin, caller, "Asha Rao", "9876501234")
    other_pid, other_fid, other_path = patient_with_activity(admin, caller, "Bimal Das", "9123400000")
    assert Path(env.storage_dir, path).exists()
    with dbmod.SessionLocal() as db:
        before_other = {m.__name__: count(db, m) for m in (Order, Report, Followup)}
        counts = privacy.erase_patient(db, pid)
    assert counts["patients"] == 1 and counts["orders"] == 1 and counts["followups"] == 1 and counts["consents"] == 1
    with dbmod.SessionLocal() as db:
        for model, col in ((Patient, Patient.id), (Followup, Followup.patient_id), (PatientBucket, PatientBucket.patient_id)):
            assert db.scalar(select(func.count()).select_from(model).where(col == pid)) == 0
        assert db.scalar(select(func.count()).select_from(Consent).where(Consent.followup_id == fid)) == 0
        assert db.scalar(select(func.count()).select_from(CallLog).where(CallLog.followup_id == fid)) == 0
        assert db.scalar(select(func.count()).select_from(Comment).where(Comment.followup_id == fid)) == 0
        assert db.scalar(select(func.count()).select_from(CallCard).where(CallCard.followup_id == fid)) == 0
        assert db.scalar(select(func.count()).select_from(Notification).where(Notification.link == f"/followups/{fid}")) == 0
        assert not [n for n in db.scalars(select(Notification.text)) if "Asha" in n]
        assert count(db, Patient) == 1 and db.get(Patient, other_pid).name == "Bimal Das"  # the other person is untouched
        assert count(db, Order) == before_other["Order"] - 1 and count(db, Followup) == before_other["Followup"] - 1
        assert count(db, ReportParameter) == 2  # only the other patient's two values remain
        log = db.scalar(select(AuditLog).where(AuditLog.action == "erase"))
        assert log.entity_id.startswith(f"{pid}:") and "Asha" not in log.entity_id  # a record that it happened, no patient data
    assert not Path(env.storage_dir, path).exists() and Path(env.storage_dir, other_path).exists()  # the stored lab file is gone too


def test_erase_also_removes_duplicate_records_merged_into_the_patient(admin, caller):
    a = make([A1C_SEV, LDL], days_ago=95, name="Delvin", mobile="9876543210")
    b = make([A1C_SEV, LDL], days_ago=95, name="Delvin", mobile="9123456780")  # held for review as a possible duplicate
    rid = admin.get(f"{API}/identity-reviews").json()[0]["id"]
    admin.post(f"{API}/identity-reviews/{rid}/decide", json={"decision": "SAME"})
    with dbmod.SessionLocal() as db:
        main_pid = db.get(Order, a).patient_id
        assert db.get(Order, b).patient_id == main_pid and count(db, Patient) == 2
        privacy.erase_patient(db, main_pid)
    with dbmod.SessionLocal() as db:
        assert count(db, Patient) == 0 and count(db, Order) == 0 and count(db, Report) == 0 and count(db, ReportParameter) == 0
    assert fu_of(a) is None


def test_cli_refuses_without_yes_and_for_unknown_patient(admin, caller, capsys):
    pid, _, _ = patient_with_activity(admin, caller, "Asha Rao", "9876501234")
    with pytest.raises(SystemExit) as e:
        privacy.main(["erase", str(pid)])
    assert "--yes" in str(e.value)
    with dbmod.SessionLocal() as db:
        assert db.get(Patient, pid) is not None  # nothing was deleted
    with pytest.raises(SystemExit) as e:
        privacy.main(["erase", "9999", "--yes"])
    assert "No patient" in str(e.value)
    privacy.main(["erase", str(pid), "--yes"])
    assert "Erased" in capsys.readouterr().out
    with dbmod.SessionLocal() as db:
        assert db.get(Patient, pid) is None
