"""Page 5: Extended clinical programs (23-30), refills, referrals, home readings/visits, and family consent tests."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app import db as dbmod, extended as ext, pipeline, privacy, status, storage
from app.models import (AuditLog, CareTouchpoint, Followup, HomeReading, ImportBatch, Order,
                        RefillSchedule, Report, ReportParameter, RetestRecommendation)
from tests.test_workflow import doctor as make_doctor

API = "/api/v1"
DRUG_WORDS = {"metformin", "glimepiride", "insulin", "atorvastatin", "levothyroxine", "omeprazole"}
_seq = [100]


def _seed(params, *, name="Rani Devi", mobile="9876500011", age=52, gender="F", days_ago=1):
    _seq[0] += 1
    with dbmod.SessionLocal() as db:
        b = db.scalar(select(ImportBatch)) or ImportBatch(source="manual")
        if not b.id:
            db.add(b)
            db.flush()
        o = Order(order_id_external=f"P5-{_seq[0]}", batch_id=b.id, status=status.EXTRACTING)
        db.add(o)
        db.flush()
        collected = datetime.now(timezone.utc) - timedelta(days=days_ago)
        rep = Report(
            order_id=o.id, patient_name=name, age=age, gender=gender, collected_on=collected,
            mobile_enc=storage.encrypt_str(mobile),
            classification="ABNORMAL" if any(p.get("flag") in ("LOW", "HIGH") for p in params) else "NORMAL",
        )
        db.add(rep)
        db.flush()
        for p in params:
            db.add(ReportParameter(
                report_id=rep.id, param_code=p["code"], param_name_raw=p.get("name", p["code"]),
                value_num=p["value"], value_text=str(p["value"]), unit=p.get("unit", ""),
                system_flag=p.get("flag", "NORMAL"), severity=p.get("severity", ""),
            ))
        db.flush()
        pipeline.conclude(db, o, rep)
        fid = db.scalar(select(Followup.id).where(Followup.report_id == rep.id))
        pid = o.patient_id
        db.commit()
        return pid, rep.id, fid


def test_p5_program_triggers_and_actions(doctor):
    p1 = [
        {"code": "HBA1C", "name": "HbA1c", "value": 7.8, "flag": "HIGH", "unit": "%", "severity": "moderate"},
        {"code": "CREATININE", "name": "Creatinine", "value": 1.0, "flag": "NORMAL", "unit": "mg/dL"},
    ]
    p2 = [
        {"code": "HBA1C", "name": "HbA1c", "value": 7.1, "flag": "HIGH", "unit": "%", "severity": "moderate"},
        {"code": "B12", "name": "Vitamin B12", "value": 140, "flag": "LOW", "unit": "pg/mL", "severity": "moderate"},
        {"code": "MAGNESIUM", "name": "Magnesium", "value": 1.3, "flag": "LOW", "unit": "mg/dL", "severity": "mild"},
        {"code": "CREATININE", "name": "Creatinine", "value": 1.18, "flag": "NORMAL", "unit": "mg/dL"},
        {"code": "LDL", "name": "LDL Cholesterol", "value": 240, "flag": "HIGH", "unit": "mg/dL", "severity": "severe"},
    ]
    pid, _, _ = _seed(p1, name="Anil Verma", mobile="9876511122", age=54, gender="M", days_ago=60)
    _seed(p2, name="Anil Verma", mobile="9876511122", age=54, gender="M", days_ago=1)

    r = doctor.post(f"{API}/patients/{pid}/medicines", json={"medicine_code": "METFORMIN", "dose_text": "500 mg BD"})
    assert r.status_code == 201 and r.json()["refill"]["refill_every_days"] == 30
    assert doctor.post(f"{API}/patients/{pid}/medicines", json={"medicine_code": "OMEPRAZOLE", "dose_text": "20 mg OD"}).status_code == 201
    assert doctor.post(f"{API}/patients/{pid}/home-readings", json={"kind": "BP", "values": {"systolic": 148, "diastolic": 94}}).status_code == 201
    assert doctor.put(f"{API}/patients/{pid}/health-profile", json={"family_history": ["DIABETES"]}).status_code == 200

    progs = {x["program_code"]: x for x in doctor.get(f"{API}/patients/{pid}/programs").json()}
    for code in ("MED_REVIEW", "PHARMACY_REFILL", "DRUG_NUTRIENT_REVIEW", "TREATMENT_RESPONSE", "FOLLOWUP_DIAGNOSTIC",
                 "SPECIALIST_CONSULT", "HOME_MONITORING", "FAMILY_PREVENTIVE"):
        assert code in progs, f"{code} did not trigger"
    assert any("Vitamin B12" in n for n in progs["DRUG_NUTRIENT_REVIEW"]["notes"])
    assert any("magnesium" in n.lower() for n in progs["DRUG_NUTRIENT_REVIEW"]["notes"])

    assert doctor.post(f"{API}/program-recommendations/{progs['FOLLOWUP_DIAGNOSTIC']['id']}/decision", json={"decision": "ACCEPTED"}).status_code == 200
    assert doctor.post(f"{API}/program-recommendations/{progs['TREATMENT_RESPONSE']['id']}/decision", json={"decision": "ACCEPTED"}).status_code == 200
    with dbmod.SessionLocal() as db:
        retests = list(db.scalars(select(RetestRecommendation)))
        assert len(retests) >= 1
        fus = list(db.scalars(select(Followup).where(Followup.patient_id == pid)))
        assert any(f.next_followup_on is not None for f in fus)

    w_pid, _, _ = _seed(
        [{"code": "HB", "name": "Haemoglobin", "value": 10.2, "flag": "LOW", "unit": "g/dL", "severity": "moderate"}],
        name="Meera Nair", mobile="9876522233", age=44, gender="F",
    )
    w_progs = {x["program_code"]: x for x in doctor.get(f"{API}/patients/{w_pid}/programs").json()}
    assert "WOMENS_HEALTH" in w_progs
    dec = doctor.post(f"{API}/program-recommendations/{w_progs['WOMENS_HEALTH']['id']}/decision", json={"decision": "ACCEPTED"})
    assert dec.status_code == 200 and dec.json()["suggested_specialty"] == "Gynecology"
    refs = doctor.get(f"{API}/patients/{w_pid}/referrals").json()
    assert any(rf["specialty"] == "Gynecology" and rf["status"] == "SUGGESTED" for rf in refs)


def test_negative_non_chronic_and_normal_labs_do_not_trigger(doctor):
    pid, _, _ = _seed([{"code": "GLU_F", "name": "FBS", "value": 85, "flag": "NORMAL", "unit": "mg/dL"}],
                      name="Normal User", mobile="9876533344", age=30, gender="M")
    assert doctor.post(f"{API}/patients/{pid}/medicines", json={"medicine_code": "OMEPRAZOLE", "dose_text": "20 mg"}).status_code == 201
    codes = {x["program_code"] for x in doctor.get(f"{API}/patients/{pid}/programs").json()}
    for absent in ("MED_REVIEW", "PHARMACY_REFILL", "DRUG_NUTRIENT_REVIEW", "TREATMENT_RESPONSE", "FAMILY_PREVENTIVE"):
        assert absent not in codes


def test_refill_tick_ist_boundary_and_caller_safety(admin, doctor, caller):
    make_doctor(admin, "Dr Refill")
    pid, _, fid = _seed([{"code": "HBA1C", "name": "HbA1c", "value": 7.4, "flag": "HIGH", "unit": "%", "severity": "moderate"}])
    assert admin.post(f"{API}/followups/{fid}/call-card/generate").status_code == 201
    assert doctor.post(f"{API}/call-cards/{fid}/approve").status_code == 200

    res = doctor.post(f"{API}/patients/{pid}/medicines", json={"medicine_code": "METFORMIN", "started_on": "2026-11-01", "refill_every_days": 29})
    assert res.status_code == 201
    sid = res.json()["refill"]["id"]

    with dbmod.SessionLocal() as db:
        assert ext.refill_tick(db, now=datetime(2026, 11, 26, 18, 20, tzinfo=timezone.utc)) == 0
        assert ext.refill_tick(db, now=datetime(2026, 11, 26, 18, 40, tzinfo=timezone.utc)) == 1

    r_ref = doctor.post(f"{API}/patients/{pid}/referrals", json={"specialty": "Endocrinology", "urgency": "SOON"})
    assert r_ref.status_code == 201
    rid = r_ref.json()["id"]

    tasks = caller.get(f"{API}/refill-tasks").json()
    assert len(tasks) == 1 and tasks[0]["label"] == "Pharmacy refill reminder call"
    card = caller.get(f"{API}/followups/{fid}/caller-card").json()
    assert card["refill_reminder"] == "Pharmacy refill reminder call"
    assert card["specialist_bookings"][0]["label"] == "Specialist appointment to book"
    c_refs = caller.get(f"{API}/patients/{pid}/referrals").json()
    assert len(c_refs) == 1 and set(c_refs[0].keys()) == {"id", "label", "urgency", "status", "scheduled_for"}
    c_progs = caller.get(f"{API}/patients/{pid}/programs").json()

    blob = f"{tasks} {card} {c_refs} {c_progs}".lower()
    for w in DRUG_WORDS:
        assert w not in blob, f"Drug word {w!r} leaked to caller!"
    assert "endocrinology" not in blob

    assert caller.patch(f"{API}/referrals/{rid}", json={"status": "DONE"}).status_code == 403
    assert caller.patch(f"{API}/referrals/{rid}", json={"status": "BOOKED"}).status_code == 200
    assert caller.post(f"{API}/refill-schedules/{sid}/confirm", json={"delivery_ref": "ORD-99", "amount_inr": 500}).status_code == 200

    with dbmod.SessionLocal() as db:
        tps = list(db.scalars(select(CareTouchpoint).where(CareTouchpoint.ref_entity == "refill", CareTouchpoint.ref_id == sid)))
        assert tps and tps[0].amount_inr is None
        audits = list(db.scalars(select(AuditLog).where(AuditLog.entity == "patient_medication")))
        assert audits and all("metformin" not in a.entity_id.lower() for a in audits)

    for m, url in [
        ("GET", f"{API}/patients/{pid}/medicines"),
        ("POST", f"{API}/patients/{pid}/medicines"),
        ("GET", f"{API}/patients/{pid}/home-readings"),
        ("GET", f"{API}/patients/{pid}/home-visits"),
        ("GET", f"{API}/patients/{pid}/family"),
        ("POST", f"{API}/patients/{pid}/referrals"),
    ]:
        assert caller.request(m, url, json={}).status_code == 403


def test_home_readings_csv_limit_alerts_visits_and_family_consent(doctor):
    pid, _, _ = _seed([{"code": "HBA1C", "name": "HbA1c", "value": 7.4, "flag": "HIGH", "unit": "%", "severity": "moderate"}],
                      mobile="9876544455", name="Suresh Rao")
    too_big = b"kind,value,taken_at\nWEIGHT,70,2026-11-20T09:00:00\n" + b"WEIGHT,70,2026-11-20T09:00:00\n" * 180000
    assert len(too_big) > 5 * 1024 * 1024
    assert doctor.post(f"{API}/patients/{pid}/home-readings/import", files={"file": ("big.csv", too_big)}).status_code == 413

    csv_ok = b"kind,systolic,diastolic,value,taken_at\nBP,152,96,,2026-11-20T08:00:00\nWEIGHT,,,71.5,2026-11-21T08:00:00\n"
    imp = doctor.post(f"{API}/patients/{pid}/home-readings/import", files={"file": ("ok.csv", csv_ok)})
    assert imp.status_code == 201 and imp.json() == {"imported": 2, "alerts": 1}
    assert doctor.get(f"{API}/patients/{pid}/home-readings.csv").status_code == 200

    hv = doctor.post(f"{API}/patients/{pid}/home-visits", json={"purpose_code": "VITALS_CHECK", "scheduled_on": "2026-12-01", "staff_name": "Nurse Priya"})
    assert hv.status_code == 201
    assert doctor.patch(f"{API}/home-visits/{hv.json()['id']}", json={"status": "DONE"}).status_code == 200

    rel_pid, _, _ = _seed([{"code": "TSH", "name": "TSH", "value": 9.8, "flag": "HIGH", "unit": "mIU/L", "severity": "moderate"}],
                          mobile="9876544455", name="Kavita Rao", age=49, gender="F")
    link = doctor.post(f"{API}/patients/{pid}/family-links", json={"related_patient_id": rel_pid, "relationship": "spouse"})
    assert link.status_code == 201 and link.json()["has_consent"] is False
    fam_before = doctor.get(f"{API}/patients/{pid}/family").json()
    assert fam_before["links"][0]["has_consent"] is False and fam_before["links"][0]["summary"] is None

    assert doctor.post(f"{API}/family-links/{link.json()['id']}/consent").status_code == 201
    fam_after = doctor.get(f"{API}/patients/{pid}/family").json()
    assert fam_after["links"][0]["has_consent"] is True
    assert "THYROID" in fam_after["links"][0]["summary"]["active_buckets"]

    progs_after = {x["program_code"] for x in doctor.get(f"{API}/patients/{pid}/programs").json()}
    assert "FAMILY_PREVENTIVE" in progs_after

    assert doctor.post(f"{API}/patients/{pid}/medicines", json={"medicine_code": "ATORVASTATIN"}).status_code == 201
    with dbmod.SessionLocal() as db:
        exported = privacy.export_patient(db, pid)
        assert len(exported["patient_medications"]) == 1 and len(exported["home_readings"]) == 2 and len(exported["family_links"]) == 1
        privacy.erase_patient(db, pid)
        assert list(db.scalars(select(HomeReading).where(HomeReading.patient_id == pid))) == []
        assert list(db.scalars(select(RefillSchedule).where(RefillSchedule.patient_id == pid))) == []
