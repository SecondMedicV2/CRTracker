"""Tests for Page 8: AMI Automated Follow-up Journey (Day 0 -> Day 92), events, scheduler, messaging guards & superseding."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app import callcard as cc_svc, db as dbmod, journeys as jsvc, messaging, privacy
from app.analysis import load_rules
from app.models import (CallLog, CareJourney, ClinicalTask, Followup, JourneyStep, Notification, OutboundMessage, Patient,
                        ProgramRecommendation, Setting)
from app.seed_data import JOURNEY_TEMPLATES, MESSAGE_TEMPLATES
from app.timeutil import IST, today_ist
from tests.test_followups import fu_of
from tests.test_retest import _make_report

API = "/api/v1"


def test_journey_starts_with_page7_window_and_safety_templates(admin, caller, doctor):
    # 1. All STANDARD_92 caller_labels and EN MESSAGE_TEMPLATES pass check_caller_safety (zero clinical words, zero digits)
    with dbmod.SessionLocal() as db:
        rules = load_rules(db)
        for s in JOURNEY_TEMPLATES["templates"]["STANDARD_92"]["steps"]:
            errs = cc_svc.check_caller_safety({"caller_script": {"opening": s["caller_label"], "objection_handling": []}}, rules["caller_script_forbidden"], [])
            assert errs == [], f"{s['code']} caller_label failed: {errs}"
        for tcode, langs in MESSAGE_TEMPLATES["templates"].items():
            for lang, txt in langs.items():
                if lang == "en":
                    errs = cc_svc.check_caller_safety({"caller_script": {"opening": txt, "objection_handling": []}}, rules["caller_script_forbidden"], [])
                    assert errs == [], f"{tcode}:{lang} failed safety: {errs}"

    # 2. Abnormal report (LDL high, window 90 days fallback or HIGH_CHOLESTEROL 90 days) starts STANDARD_92 journey
    _, pid, o1 = _make_report([("LDL", "LDL", 190.0, "HIGH", "moderate", 46.0)], days_ago=0, name="Meera J", mobile="9730000001")
    fid = fu_of(o1).id

    j_doc = doctor.get(f"{API}/followups/{fid}/journey").json()
    assert j_doc["template_code"] == "STANDARD_92"
    assert j_doc["status"] == "ACTIVE"
    assert len(j_doc["steps"]) == 9
    assert [s["step_code"] for s in j_doc["steps"]] == [
        "D0_ANALYSED", "D1_RECOMMEND", "D7_ACTIVATION", "D30_ADHERENCE",
        "D60_PROGRESS", "D75_RETEST_NOTICE", "D90_RETEST", "D91_COMPARE", "D92_UPDATE_PLAN",
    ]
    d0 = next(s for s in j_doc["steps"] if s["step_code"] == "D0_ANALYSED")
    assert d0["status"] == "DONE"
    # Prompt corrected wordings for Day 75 and Day 91
    d75 = next(s for s in j_doc["steps"] if s["step_code"] == "D75_RETEST_NOTICE")
    d91 = next(s for s in j_doc["steps"] if s["step_code"] == "D91_COMPARE")
    assert d75["service"] == "Diagnostics booking"
    assert d91["service"] == "AMI longitudinal analysis"

    # Override Page 7 window to +42 days -> D90 shifts to +42d, D75 shifts to D90 - 15d (+27d)
    target_d90 = (today_ist() + timedelta(days=42)).isoformat()
    doctor.post(f"{API}/followups/{fid}/retest-override", json={"window_start": target_d90, "reason_code": "CLINICAL_JUDGMENT"})
    j_upd = doctor.get(f"{API}/followups/{fid}/journey").json()
    d90_upd = next(s for s in j_upd["steps"] if s["step_code"] == "D90_RETEST")
    d75_upd = next(s for s in j_upd["steps"] if s["step_code"] == "D75_RETEST_NOTICE")
    assert d90_upd["due_on"] == target_d90
    assert d75_upd["due_on"] == (today_ist() + timedelta(days=42 - 15)).isoformat()

    # Missing Page 7 window marks waiting_for_data on D75/D90
    with dbmod.SessionLocal() as db:
        f = db.get(Followup, fid)
        f.retest_window_start = None
        f.retest_window_end = None
        f.reminder_on = None
        for rec in db.scalars(select(jsvc.RetestRecommendation).where(jsvc.RetestRecommendation.followup_id == fid)):
            rec.window_start = None
        db.commit()
        jsvc.start_or_sync_journey(db, f)
        db.commit()
    j_wait = doctor.get(f"{API}/followups/{fid}/journey").json()
    assert next(s for s in j_wait["steps"] if s["step_code"] == "D90_RETEST")["waiting_for_data"] is True

    # Caller view sees neutral labels ONLY; patients/{pid}/journeys & outbound-messages blocked for caller
    assert caller.get(f"{API}/patients/{pid}/journeys").status_code == 403
    assert caller.get(f"{API}/outbound-messages").status_code == 403
    assert doctor.get(f"{API}/outbound-messages").status_code == 403
    j_cal = caller.get(f"{API}/followups/{fid}/journey").json()
    cal_blob = str(j_cal).lower()
    assert "caller_label" in cal_blob and "ami_action" not in cal_blob and "cholesterol" not in cal_blob and "190" not in cal_blob


def test_step_completion_events_and_superseding(admin, caller, doctor):
    doc_uid = doctor.get(f"{API}/auth/me").json()["id"]
    doc_row = admin.post(f"{API}/doctors", json={"name": "Dr J", "user_id": doc_uid}).json()
    doctor.post(f"{API}/rules/retest_protocols/signoff")
    _, pid, o1 = _make_report([("HBA1C", "HbA1c", 8.2, "HIGH", "moderate", 26.0)], days_ago=90, name="Kiran P", mobile="9730000002")
    fid = fu_of(o1).id
    admin.patch(f"{API}/followups/{fid}", json={"assigned_doctor_id": doc_row["id"]})
    caller.post(f"{API}/followups/{fid}/consent")

    # D1_RECOMMEND closes when recommendations exist + DOCTOR_DONE
    res_doc = doctor.post(f"{API}/followups/{fid}/doctor-outcome", json={"outcome": "DOCTOR_DONE", "retest_codes": ["HBA1C"]})
    assert res_doc.status_code == 200
    j1 = doctor.get(f"{API}/followups/{fid}/journey").json()
    assert next(s for s in j1["steps"] if s["step_code"] == "D1_RECOMMEND")["status"] == "DONE"

    # D7_ACTIVATION closes when a program is ACCEPTED
    progs = doctor.get(f"{API}/patients/{pid}/programs").json()
    if progs:
        doctor.post(f"{API}/program-recommendations/{progs[0]['id']}/decision", json={"decision": "ACCEPTED"})
        j_d7 = doctor.get(f"{API}/followups/{fid}/journey").json()
        assert next(s for s in j_d7["steps"] if s["step_code"] == "D7_ACTIVATION")["status"] == "DONE"

    # D30_ADHERENCE & D60_PROGRESS: caller logs check-in codes only; STOPPED/WORSE spawns Doctor ClinicalTask
    c30 = caller.post(f"{API}/followups/{fid}/journey/checkin", json={"step_code": "D30_ADHERENCE", "adherence_code": "TAKING", "symptom_code": "BETTER"})
    assert c30.status_code == 200 and c30.json()["clinical_task_id"] is None
    c60 = caller.post(f"{API}/followups/{fid}/journey/checkin", json={"step_code": "D60_PROGRESS", "adherence_code": "STOPPED", "symptom_code": "WORSE"})
    assert c60.status_code == 200 and c60.json()["clinical_task_id"] is not None
    with dbmod.SessionLocal() as db:
        t = db.get(ClinicalTask, c60.json()["clinical_task_id"])
        assert t is not None and t.task_type == "JOURNEY_ESCALATION"
        clogs = list(db.scalars(select(CallLog).where(CallLog.followup_id == fid, CallLog.adherence_code != "")))
        assert {c.adherence_code for c in clogs} == {"TAKING", "STOPPED"}

    # D90 + D91 close when repeat READY report arrives in window
    _make_report([("HBA1C", "HbA1c", 7.1, "HIGH", "mild", 9.2)], days_ago=0, name="Kiran P", mobile="9730000002")
    j_comp = doctor.get(f"{API}/followups/{fid}/journey").json()
    st_map = {s["step_code"]: s["status"] for s in j_comp["steps"]}
    assert st_map["D90_RETEST"] == "DONE" and st_map["D91_COMPARE"] == "DONE"

    # D92 closes & CareJourney completes when doctor sets post-comparison follow-up
    with dbmod.SessionLocal() as db:
        f = db.get(Followup, fid)
        f.next_followup_on = today_ist() + timedelta(days=90)
        db.commit()
    j_done = doctor.get(f"{API}/followups/{fid}/journey").json()
    assert next(s for s in j_done["steps"] if s["step_code"] == "D92_UPDATE_PLAN")["status"] == "DONE"
    assert j_done["status"] == "COMPLETED"

    # Superseding: start another ACTIVE journey on LDL -> newer LDL report supersedes it
    _, _, o_ldl1 = _make_report([("LDL", "LDL", 190.0, "HIGH", "moderate", 46.0)], days_ago=30, name="Sup Pat", mobile="9730000003")
    f_ldl1 = fu_of(o_ldl1).id
    j_ldl1 = doctor.get(f"{API}/followups/{f_ldl1}/journey").json()
    assert j_ldl1["status"] == "ACTIVE"

    _, pid_sup, o_ldl2 = _make_report([("LDL", "LDL", 180.0, "HIGH", "moderate", 40.0)], days_ago=0, name="Sup Pat", mobile="9730000003")
    all_j = doctor.get(f"{API}/patients/{pid_sup}/journeys").json()["journeys"]
    statuses = [x["status"] for x in all_j]
    assert "STOPPED" in statuses and "ACTIVE" in statuses
    stopped = next(x for x in all_j if x["status"] == "STOPPED")
    assert stopped["stop_reason"] == "superseded"


def test_scheduler_idempotency_and_messaging_guards(admin, caller, doctor):
    _, pid, o1 = _make_report([("LDL", "LDL", 195.0, "HIGH", "moderate", 50.0)], days_ago=75, name="Msg Pat", mobile="9730000004")
    fid = fu_of(o1).id

    daytime_ist = datetime.combine(today_ist(), datetime.min.time(), IST).replace(hour=11, minute=0).astimezone(timezone.utc)
    night_ist = datetime.combine(today_ist(), datetime.min.time(), IST).replace(hour=22, minute=0).astimezone(timezone.utc)

    with dbmod.SessionLocal() as db:
        # Without Consent -> BLOCKED_NO_CONSENT on D75 message
        j = db.scalar(select(CareJourney).where(CareJourney.followup_id == fid))
        d75 = db.scalar(select(JourneyStep).where(JourneyStep.journey_id == j.id, JourneyStep.step_code == "D75_RETEST_NOTICE"))
        m_no = messaging.send_patient_message(db, pid, "D75_RETEST_NOTICE", followup_id=fid, journey_step_id=d75.id, now=daytime_ist)
        assert m_no.status == "BLOCKED_NO_CONSENT"
        db.commit()

    # Grant Consent, then try during quiet hours (22:00 IST) -> BLOCKED_QUIET_HOURS
    caller.post(f"{API}/followups/{fid}/consent")
    with dbmod.SessionLocal() as db:
        j = db.scalar(select(CareJourney).where(CareJourney.followup_id == fid))
        d75 = db.scalar(select(JourneyStep).where(JourneyStep.journey_id == j.id, JourneyStep.step_code == "D75_RETEST_NOTICE"))
        m_q = messaging.send_patient_message(db, pid, "D75_RETEST_NOTICE", followup_id=fid, journey_step_id=d75.id, now=night_ist)
        assert m_q.status == "BLOCKED_QUIET_HOURS"

        # Enable do_not_call -> BLOCKED_DNC
        pat = db.get(Patient, pid)
        pat.do_not_call = True
        db.commit()
        m_dnc = messaging.send_patient_message(db, pid, "D75_RETEST_NOTICE", followup_id=fid, journey_step_id=d75.id, now=daytime_ist)
        assert m_dnc.status == "BLOCKED_DNC"

        # Clear do_not_call -> daytime IST CallTaskProvider sends (CALL_TASK_CREATED); run scheduler twice -> idempotent
        pat.do_not_call = False
        db.commit()
        res1 = jsvc.scheduler_tick(db, now=daytime_ist)
        assert res1["due"] >= 1 or res1["overdue"] >= 1
        assert res1["tasks"] >= 1
        notif_cnt1 = db.query(Notification).count()
        msg_cnt1 = db.query(OutboundMessage).filter(OutboundMessage.status == "CALL_TASK_CREATED").count()
        assert msg_cnt1 == 1

        res2 = jsvc.scheduler_tick(db, now=daytime_ist)
        assert res2["tasks"] == 0
        assert db.query(Notification).count() == notif_cnt1
        assert db.query(OutboundMessage).filter(OutboundMessage.status == "CALL_TASK_CREATED").count() == msg_cnt1

        # WhatsAppProvider stub behind whatsapp_enabled=True
        db.merge(Setting(key="whatsapp_enabled", value=True))
        db.commit()
        m_wa = messaging.send_patient_message(db, pid, "D30_CHECKIN", followup_id=fid, journey_step_id=None, now=daytime_ist)
        assert m_wa.channel == "WHATSAPP" and m_wa.status == "SENT" and m_wa.provider_ref.startswith("wa-stub:")
        db.commit()

    # Dashboard includes journeys counts, overdue_by_step & D0->D92 funnel
    dash = admin.get(f"{API}/dashboard").json()
    assert dash["journeys"]["active"] >= 1
    assert len(dash["journeys"]["funnel"]) == 9
    assert any(x["count"] > 0 for x in dash["journeys"]["overdue_by_step"])

    # Admin outbound message log returns messages without clinical leakage
    msgs = admin.get(f"{API}/outbound-messages").json()
    assert any(m["channel"] == "CALL_TASK" and m["status"] == "CALL_TASK_CREATED" for m in msgs)
    assert any(m["channel"] == "WHATSAPP" and m["status"] == "SENT" for m in msgs)

    # DPDP Export & Erase cover care_journeys, journey_steps & outbound_messages
    with dbmod.SessionLocal() as db:
        exp = privacy.export_patient(db, pid)
        assert len(exp["care_journeys"]) >= 1 and len(exp["journey_steps"]) >= 9 and len(exp["outbound_messages"]) >= 1
        erased = privacy.erase_patient(db, pid)
        assert erased["care_journeys"] >= 1 and erased["journey_steps"] >= 9 and erased["outbound_messages"] >= 1
