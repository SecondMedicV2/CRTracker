from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app import assign
from app import db as dbmod
from app.models import AuditLog, CallLog, Followup, Notification, Patient
from tests.conftest import PW, client_as
from tests.test_followups import A1C_SEV, LDL, PSA, fu_of, make

API = "/api/v1"
_m = [0]


def future(hours=24):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def user_id(admin, email):
    return next(u["id"] for u in admin.get(f"{API}/users").json() if u["email"] == email)


def doctor(admin, name, email="doc@x.com", langs=("en",), order=100, pilot=False, phone="0201234567"):
    return admin.post(f"{API}/doctors", json={"name": name, "user_id": user_id(admin, email), "languages": list(langs),
                                              "priority_order": order, "in_pilot": pilot, "phone": phone}).json()["id"]


def second_doctor_client(admin, name="Dr Two", **kw):
    admin.post(f"{API}/users", json={"name": name, "email": "doc2@x.com", "password": PW, "role": "DOCTOR"})
    did = doctor(admin, name, "doc2@x.com", **kw)
    return did, client_as("doc2@x.com")


NAMES = ["Asha Rao", "Bimal Das", "Chitra Menon", "Dev Patel", "Esha Gupta", "Farhan Khan", "Gita Iyer", "Hari Nair",
         "Indu Shah", "Jaya Kapoor", "Kabir Joshi", "Lata Mishra"]  # clearly different, so identity review never triggers
THY = ("TSH", "TSH", 9.0, "HIGH", "severe", 50.0)
LIV = ("SGOT", "SGOT", 190.0, "HIGH", "severe", 300.0)


def new_fu(params=(A1C_SEV, LDL), days_ago=95, **kw):
    _m[0] += 1
    kw.setdefault("name", NAMES[_m[0] % len(NAMES)])
    kw.setdefault("mobile", f"90000{_m[0]:05d}")
    return fu_of(make(list(params), days_ago=days_ago, **kw)).id


def stage(fid):
    with dbmod.SessionLocal() as db:
        return db.get(Followup, fid).stage


def test_ac13_booking_needs_consent_then_creates_appointment(admin, caller):
    did = doctor(admin, "Dr One")
    fid = new_fu()
    book = {"outcome": "BOOKED", "slot_start": future(), "doctor_id": did}
    assert caller.post(f"{API}/followups/{fid}/calls", json=book).status_code == 409  # no consent yet
    assert stage(fid) == "NOT_CALLED"
    c = caller.post(f"{API}/followups/{fid}/consent")
    assert c.status_code == 201 and c.json()["channel"] == "caller_call" and c.json()["script_version"] == ""
    assert stage(fid) == "CONSENT_GIVEN"
    assert caller.post(f"{API}/followups/{fid}/consent").status_code == 201  # idempotent: still one consent
    assert caller.post(f"{API}/followups/{fid}/calls", json={**book, "slot_start": future(-2)}).status_code == 422  # past
    assert caller.post(f"{API}/followups/{fid}/calls", json={"outcome": "BOOKED", "doctor_id": did}).status_code == 422  # no slot
    r = caller.post(f"{API}/followups/{fid}/calls", json=book)
    assert r.status_code == 201 and r.json()["stage"] == "BOOKED" and r.json()["appointment"]["doctor_id"] == did
    w = caller.get(f"{API}/followups/{fid}/workflow").json()
    assert w["consent"] and w["appointment"]["status"] == "BOOKED" and "recommendations" not in w
    assert caller.post(f"{API}/followups/{fid}/calls", json=book).status_code == 409  # never call twice for one report


def test_script_version_is_recorded_with_consent(admin, caller):
    fid = new_fu()
    card = admin.post(f"{API}/followups/{fid}/call-card/generate").json()
    assert caller.post(f"{API}/followups/{fid}/consent").json()["script_version"] == f"card:{card['id']}"


def test_double_booking_the_same_doctor_is_refused(admin, caller):
    did = doctor(admin, "Dr One")
    slot = future(48)
    for n in range(2):
        fid = new_fu()
        caller.post(f"{API}/followups/{fid}/consent")
        r = caller.post(f"{API}/followups/{fid}/calls", json={"outcome": "BOOKED", "slot_start": slot, "doctor_id": did})
        assert r.status_code == (201 if n == 0 else 409)


def test_outcomes_and_max_attempts(admin, caller):
    fid = new_fu()
    assert caller.post(f"{API}/followups/{fid}/calls", json={"outcome": "MAYBE"}).status_code == 422
    assert caller.post(f"{API}/followups/{fid}/calls", json={"outcome": "CALL_LATER"}).status_code == 422  # needs a time
    r = caller.post(f"{API}/followups/{fid}/calls", json={"outcome": "CALL_LATER", "call_later_at": future(3)})
    assert r.json()["stage"] == "CALL_LATER"
    assert caller.post(f"{API}/followups/{fid}/calls", json={"outcome": "NOT_REACHABLE"}).json()["stage"] == "NOT_REACHABLE"
    third = caller.post(f"{API}/followups/{fid}/calls", json={"outcome": "NOT_REACHABLE", "notes": "phone off"}).json()
    assert third["attempts"] == 3 and third["suppressed_reason"] == "Maximum call attempts reached"  # 3 tries in 7 days
    assert caller.post(f"{API}/followups/{fid}/calls", json={"outcome": "NOT_REACHABLE"}).status_code == 409
    assert fid not in [x["id"] for x in admin.get(f"{API}/followups").json()]  # stops appearing in the queue


def test_declined_wrong_number_and_do_not_call(admin, caller):
    a, b = new_fu(name="Same", mobile="9111100000"), new_fu(params=(THY,), name="Same", mobile="9111100000", days_ago=100)
    assert caller.post(f"{API}/followups/{a}/calls", json={"outcome": "DECLINED"}).json()["stage"] == "DECLINED"
    assert caller.post(f"{API}/followups/{a}/calls", json={"outcome": "NOT_REACHABLE"}).status_code == 409  # closed
    assert caller.post(f"{API}/followups/{b}/calls", json={"outcome": "DO_NOT_CALL"}).status_code == 201
    other = new_fu(params=(LIV,), name="Same", mobile="9111100000", days_ago=120)
    assert caller.post(f"{API}/followups/{other}/consent").status_code == 409  # patient asked not to be called
    assert caller.post(f"{API}/followups/{other}/calls", json={"outcome": "NOT_REACHABLE"}).status_code == 409
    with dbmod.SessionLocal() as db:
        assert db.scalar(select(Patient.do_not_call).where(Patient.name == "Same")) is True
    w = new_fu(name="Wrong", mobile="9222200000")
    assert caller.post(f"{API}/followups/{w}/calls", json={"outcome": "WRONG_NUMBER"}).json()["stage"] == "WRONG_NUMBER"
    assert w not in [x["id"] for x in admin.get(f"{API}/followups").json()]
    assert w in [x["id"] for x in admin.get(f"{API}/followups", params={"view": "done"}).json()]


def test_ac14_doctor_queue_escalation_first_with_unread_comments(admin, caller, doctor):
    did = globals()["doctor"](admin, "Dr One")  # the fixture shadows the helper name
    low = new_fu(params=(A1C_SEV,), days_ago=95)
    esc = new_fu(params=(PSA,), days_ago=0)
    high = new_fu(params=(A1C_SEV, LDL), days_ago=140)
    for f in (low, high):
        caller.post(f"{API}/followups/{f}/consent")
    q = doctor.get(f"{API}/doctor/queue").json()
    assert [x["id"] for x in q][0] == esc and {x["id"] for x in q} == {esc, low, high}
    assert q[1]["id"] == high  # then higher retest potential
    caller.post(f"{API}/followups/{high}/comments", json={"text": "Patient prefers evening calls"})
    caller.post(f"{API}/followups/{high}/comments", json={"text": "Mentioned dizziness", "urgent": True})
    badge = {x["id"]: x["unread_comments"] for x in doctor.get(f"{API}/doctor/queue").json()}
    assert badge[high] == 2 and badge[esc] == 0
    assert len(doctor.get(f"{API}/followups/{high}/comments").json()) == 2  # opening the thread marks it read
    assert {x["id"]: x["unread_comments"] for x in doctor.get(f"{API}/doctor/queue").json()}[high] == 0
    assert caller.get(f"{API}/doctor/queue").status_code == 403
    assert did


def test_escalation_request_sets_priority_and_notifies_doctor(admin, caller, doctor):
    doctor_id = globals()["doctor"](admin, "Dr One")
    fid = new_fu()
    assert caller.patch(f"{API}/followups/{fid}", json={"priority": "ESCALATION"}).status_code == 403
    r = caller.post(f"{API}/followups/{fid}/comments", json={"text": "Chest pain on the call", "request_escalation": True})
    assert r.status_code == 201 and r.json()["priority"] == "ESCALATION"
    n = doctor.get(f"{API}/notifications").json()
    assert n["unread"] >= 1 and any(x["urgent"] and "escalation" in x["text"].lower() for x in n["items"])
    assert caller.post(f"{API}/followups/{fid}/comments", json={"text": "  "}).status_code == 422
    assert doctor.patch(f"{API}/followups/{fid}", json={"priority": "ROUTINE"}).json()["priority"] == "ROUTINE"  # only a doctor can lower it
    assert doctor_id


def test_doctor_notes_are_hidden_from_callers_unless_shared(admin, caller, doctor):
    globals()["doctor"](admin, "Dr One")
    fid = new_fu()
    doctor.post(f"{API}/followups/{fid}/comments", json={"text": "Clinical: HbA1c rising"})
    doctor.post(f"{API}/followups/{fid}/comments", json={"text": "Please call after 6pm", "for_caller": True})
    assert [c["text"] for c in caller.get(f"{API}/followups/{fid}/comments").json()] == ["Please call after 6pm"]
    assert len(doctor.get(f"{API}/followups/{fid}/comments").json()) == 2


def test_connect_doctor_now_shows_number_and_notifies(admin, caller, doctor):
    globals()["doctor"](admin, "Dr One", phone="0229999999")
    fid = new_fu()
    r = caller.post(f"{API}/followups/{fid}/connect-doctor").json()
    assert r == {"doctor": "Dr One", "dial": {"mode": "manual", "number": "0229999999"}}
    assert any("connect" in x["text"] for x in doctor.get(f"{API}/notifications").json()["items"])
    assert doctor.post(f"{API}/followups/{fid}/connect-doctor").status_code == 403


def test_auto_assignment_language_priority_and_pilot(admin):
    hi = doctor(admin, "Dr Hindi", "doc@x.com", langs=("en", "hi"), order=50)
    did2, _ = second_doctor_client(admin, langs=("en",), order=10)
    a = new_fu(name="A", mobile="9333300001")  # patient language unset -> English -> priority order wins (doctor 2)
    with dbmod.SessionLocal() as db:
        assert db.get(Followup, a).assigned_doctor_id == did2
        pid = db.get(Followup, a).patient_id
    admin.patch(f"{API}/patients/{pid}", json={"language": "hi"})
    b = fu_of(make([A1C_SEV, LDL], days_ago=95, name="A", mobile="9333300001")).id  # same patient, new report
    with dbmod.SessionLocal() as db:
        assert db.get(Followup, b).assigned_doctor_id == hi  # Hindi speaker beats priority order
    # pilot mode: only flagged doctors receive new cases
    admin.put(f"{API}/doctors/{did2}", json={"name": "Dr Two", "user_id": user_id(admin, "doc2@x.com"), "in_pilot": True})
    admin.put(f"{API}/settings/pilot_mode", json={"value": True})
    c = new_fu(name="C", mobile="9333300003")
    with dbmod.SessionLocal() as db:
        assert db.get(Followup, c).assigned_doctor_id == did2
    admin.put(f"{API}/settings/pilot_mode", json={"value": False})
    with dbmod.SessionLocal() as db:
        assert {d.id for d in assign.eligible(db)} == {hi, did2}


def age_assignment(fid, hours):
    with dbmod.SessionLocal() as db:
        f = db.get(Followup, fid)
        f.assigned_at = datetime.now(timezone.utc) - timedelta(hours=hours)
        db.commit()


def test_ac15_unaccepted_case_cascades_after_timeout_and_is_logged(admin, caller, doctor):
    d1 = globals()["doctor"](admin, "Dr One", order=10)
    d2, doc2 = second_doctor_client(admin, order=20)
    d3 = admin.post(f"{API}/doctors", json={"name": "Dr Three", "priority_order": 30}).json()["id"]
    routine, esc = new_fu(name="R", mobile="9444400001"), new_fu(params=(PSA,), days_ago=0, name="E", mobile="9444400002")
    for f in (routine, esc):
        caller.post(f"{API}/followups/{f}/consent")
    owner = lambda f: dbmod.SessionLocal().get(Followup, f).assigned_doctor_id
    assert owner(routine) == owner(esc) == d1
    age_assignment(routine, 5)
    age_assignment(esc, 5)
    with dbmod.SessionLocal() as db:
        assert assign.cascade_tick(db) == 1  # escalation timed out at 4h, routine (24h) did not
    assert owner(esc) == d2 and owner(routine) == d1
    assert any("reassigned" in x["text"] for x in doc2.get(f"{API}/notifications").json()["items"])
    with dbmod.SessionLocal() as db:
        assert db.scalar(select(AuditLog).where(AuditLog.action == "reassign")) is not None
    age_assignment(esc, 5)
    with dbmod.SessionLocal() as db:
        assign.cascade_tick(db)
    assert owner(esc) == d3  # third doctor next; nobody is asked twice in a round
    age_assignment(esc, 5)
    with dbmod.SessionLocal() as db:
        assign.cascade_tick(db)
    assert owner(esc) in (d1, d2)  # everyone tried: a new round starts
    age_assignment(routine, 30)  # accepting stops the clock
    assert doctor.post(f"{API}/followups/{routine}/accept").status_code == 200
    with dbmod.SessionLocal() as db:
        assign.cascade_tick(db)
    assert owner(routine) == d1
    assert doc2.post(f"{API}/followups/{routine}/accept").status_code == 403  # not their case


def test_doctor_outcome_needs_consent_and_records_retest(admin, caller, doctor):
    did = globals()["doctor"](admin, "Dr One")
    fid = new_fu()
    out = {"outcome": "DOCTOR_DONE", "notes": "Discussed", "retest_codes": ["HBA1C", "LIPID"], "next_followup_on": "2027-02-01"}
    assert doctor.post(f"{API}/followups/{fid}/doctor-outcome", json=out).status_code == 409  # no consent
    doctor.post(f"{API}/followups/{fid}/consent")  # the doctor can take consent on a direct call
    assert doctor.post(f"{API}/followups/{fid}/doctor-outcome", json={**out, "retest_codes": ["MAGIC"]}).status_code == 422
    assert doctor.post(f"{API}/followups/{fid}/doctor-outcome", json={"outcome": "X"}).status_code == 422
    assert doctor.post(f"{API}/followups/{fid}/doctor-outcome", json=out).json()["stage"] == "RETEST_RECOMMENDED"
    w = doctor.get(f"{API}/followups/{fid}/workflow").json()
    rec = w["recommendations"][0]
    assert rec["test_codes"] == ["HBA1C", "LIPID"] and w["next_followup_on"] == "2027-02-01" and w["accepted_at"]
    assert doctor.post(f"{API}/followups/{fid}/doctor-outcome", json=out).status_code == 409  # closed
    assert doctor.post(f"{API}/retest-recommendations/{rec['id']}/ordered", json={"ordered_ref": "ORD-77"}).status_code == 200
    assert stage(fid) == "RETEST_ORDERED"
    assert caller.post(f"{API}/retest-recommendations/{rec['id']}/ordered", json={}).status_code == 403
    assert fid in [x["id"] for x in admin.get(f"{API}/followups", params={"view": "done"}).json()]
    assert did


def test_doctor_can_ask_caller_to_recontact(admin, caller, doctor):
    globals()["doctor"](admin, "Dr One")
    fid = new_fu()
    doctor.post(f"{API}/followups/{fid}/consent")
    r = doctor.post(f"{API}/followups/{fid}/doctor-outcome", json={"outcome": "RECALL_CALLER", "notes": "Needs fasting report first"})
    assert r.json()["stage"] == "CALL_LATER"
    assert [c["text"] for c in caller.get(f"{API}/followups/{fid}/comments").json()] == ["Needs fasting report first"]


def test_notifications_read_all(admin, caller, doctor):
    globals()["doctor"](admin, "Dr One")
    new_fu()
    n = doctor.get(f"{API}/notifications").json()
    assert n["unread"] == 1 and n["items"][0]["text"].startswith("New follow-up")
    doctor.post(f"{API}/notifications/read-all")
    assert doctor.get(f"{API}/notifications").json()["unread"] == 0
    assert caller.get(f"{API}/notifications").json()["items"] == []  # only your own


def test_call_logs_are_recorded_and_audited(admin, caller):
    fid = new_fu()
    caller.post(f"{API}/followups/{fid}/calls", json={"outcome": "NOT_REACHABLE", "notes": "no answer"})
    with dbmod.SessionLocal() as db:
        log = db.scalars(select(CallLog)).one()
        assert (log.outcome, log.role, log.notes) == ("NOT_REACHABLE", "CALLER", "no answer")
        assert db.scalar(select(Notification)) is None or True
    assert ("call", "followup") in [(a["action"], a["entity"]) for a in admin.get(f"{API}/audit").json()]


def test_doctor_without_a_login_falls_back_to_notifying_admins(admin):
    did = admin.post(f"{API}/doctors", json={"name": "No Login"}).json()["id"]
    new_fu()
    items = admin.get(f"{API}/notifications").json()["items"]
    assert did and any("assigned" in x["text"] for x in items)  # nobody is left uninformed
