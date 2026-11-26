"""Tests for Page 9 Retesting Protocol 5 Urgency Tiers, SLAs, sorting, and caller safety."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app import callcard, db as dbmod, retest
from app.models import AuditLog, Followup, Report, RuleSet
from app.seed_data import CALLER_FORBIDDEN, CRITICAL_VALUES, RETEST_TIERS, TEST_CATALOGUE
from app.timeutil import today_ist
from tests.test_followups import A1C_SEV, fu_of
from tests.test_retest import _make_report
from tests.test_workflow import doctor as make_doctor

API = "/api/v1"


def test_no_critical_values_seeded_and_tiers_present(admin):
    assert CRITICAL_VALUES == []
    with dbmod.SessionLocal() as db:
        cv = db.scalar(select(RuleSet).where(RuleSet.key == "critical_values", RuleSet.active))
        assert cv is not None and cv.data == []
        tiers = db.scalar(select(RuleSet).where(RuleSet.key == "retest_tiers", RuleSet.active))
        assert tiers is not None and [t["code"] for t in tiers.data] == ["URGENT", "EARLY", "TREATMENT_RESPONSE", "METABOLIC", "LONG_TERM"]
    assert admin.get(f"{API}/rules/retest_tiers").status_code == 200


def test_all_findings_and_variants_map_to_tiers_preserving_retest_tier():
    today = today_ist()
    # HIGH_CREATININE -> URGENT (even if mild or low score)
    oid_cr, _, _ = _make_report([("CREATININE", "Creatinine", 2.3, "HIGH", "severe", 70.0)], mobile="9600000001")
    with dbmod.SessionLocal() as db:
        f = db.get(Followup, fu_of(oid_cr).id)
        assert f.protocol_tier == "URGENT" and f.retest_tier in ("LOW", "MEDIUM", "HIGH")

    # LOW_HB -> EARLY (both default & on_treatment)
    oid_hb, _, _ = _make_report([("HEMOGLOBIN", "Hb", 9.5, "LOW", "moderate", 20.0)], mobile="9600000002")
    with dbmod.SessionLocal() as db:
        f = db.get(Followup, fu_of(oid_hb).id)
        assert f.protocol_tier == "EARLY"
        retest.plan_retest(db, f, state={"on_treatment": True, "treatment_anchor_on": today})
        assert f.protocol_tier == "EARLY"

    # ABNORMAL_LFT -> EARLY
    oid_lft, _, _ = _make_report([("SGPT", "SGPT", 90.0, "HIGH", "moderate", 35.0)], mobile="9600000003")
    with dbmod.SessionLocal() as db:
        f = db.get(Followup, fu_of(oid_lft).id)
        assert f.protocol_tier == "EARLY"

    # HIGH_CHOLESTEROL: default -> LONG_TERM; treatment_changed -> TREATMENT_RESPONSE
    oid_ch, _, _ = _make_report([("LDL", "LDL", 185.0, "HIGH", "moderate", 25.0)], mobile="9600000004")
    with dbmod.SessionLocal() as db:
        f = db.get(Followup, fu_of(oid_ch).id)
        assert f.protocol_tier == "LONG_TERM"
        retest.plan_retest(db, f, state={"treatment_changed": True, "treatment_anchor_on": today})
        assert f.protocol_tier == "TREATMENT_RESPONSE"

    # HIGH_TSH -> TREATMENT_RESPONSE
    oid_tsh, _, _ = _make_report([("TSH", "TSH", 11.0, "HIGH", "moderate", 40.0)], mobile="9600000005")
    with dbmod.SessionLocal() as db:
        f = db.get(Followup, fu_of(oid_tsh).id)
        assert f.protocol_tier == "TREATMENT_RESPONSE"

    # HIGH_HBA1C: default/targets_unmet -> METABOLIC; stable_at_goal -> LONG_TERM
    oid_a1c, _, _ = _make_report([A1C_SEV], days_ago=10, mobile="9600000006")
    with dbmod.SessionLocal() as db:
        f = db.get(Followup, fu_of(oid_a1c).id)
        assert f.protocol_tier == "METABOLIC"
        retest.plan_retest(db, f, state={"stable_at_goal": True})
        assert f.protocol_tier == "LONG_TERM"

    # LOW_VITD & OBESITY_METABOLIC -> METABOLIC; NORMAL_WITH_RISK -> LONG_TERM
    oid_vd, _, _ = _make_report([("VITAMIN_D", "Vitamin D", 14.0, "LOW", "moderate", 30.0)], mobile="9600000007")
    with dbmod.SessionLocal() as db:
        f = db.get(Followup, fu_of(oid_vd).id)
        assert f.protocol_tier == "METABOLIC"
        retest.plan_retest(db, f, detected=["OBESITY_METABOLIC"])
        assert f.protocol_tier == "METABOLIC"
        retest.plan_retest(db, f, detected=["NORMAL_WITH_RISK"])
        assert f.protocol_tier == "LONG_TERM"


def test_urgent_sorting_never_parked_notifications_and_sla_escalation(admin, doctor):
    make_doctor(admin, "Dr One")
    # High-score metabolic follow-up created first
    oid_a1c, _, _ = _make_report([A1C_SEV], days_ago=95, mobile="9611100001")
    # Low-score mild creatinine follow-up: must STILL be URGENT, never parked, and sorted first!
    oid_cr, _, _ = _make_report([("CREATININE", "Creatinine", 1.5, "HIGH", "mild", 5.0)], days_ago=0, mobile="9611100002")
    with dbmod.SessionLocal() as db:
        f_cr = db.get(Followup, fu_of(oid_cr).id)
        f_a1c = db.get(Followup, fu_of(oid_a1c).id)
        cr_id, a1c_id = f_cr.id, f_a1c.id
        assert f_cr.protocol_tier == "URGENT" and f_cr.retest_tier == "LOW"

    # URGENT never parked in low_potential, sorts first in /followups and /doctor/queue
    rows = admin.get(f"{API}/followups").json()
    assert rows[0]["id"] == cr_id and [r["id"] for r in rows] == [cr_id, a1c_id]
    assert cr_id not in [r["id"] for r in admin.get(f"{API}/followups", params={"view": "low_potential"}).json()]
    assert [r["id"] for r in admin.get(f"{API}/followups", params={"protocol_tier": "URGENT"}).json()] == [cr_id]

    dq = doctor.get(f"{API}/doctor/queue", params={"protocol_tier": "URGENT"}).json()
    assert [x["id"] for x in dq] == [cr_id]

    # URGENT notified both assigned doctor and admins
    assert any(n["urgent"] and "Urgent retest needed" in n["text"] for n in doctor.get(f"{API}/notifications").json()["items"])
    assert any(n["urgent"] and "Urgent retest needed" in n["text"] for n in admin.get(f"{API}/notifications").json()["items"])

    # Dashboard shows urgent_24h strip & summary shows per-tier open counts
    dash = admin.get(f"{API}/dashboard").json()
    assert dash["urgent_24h"] == 1 and dash["followups_due"]["urgent_24h"] == 1
    summary = admin.get(f"{API}/retesting-protocol/summary").json()
    counts = {t["code"]: t["open_count"] for t in summary["tiers"]}
    assert counts["URGENT"] == 1 and counts["METABOLIC"] == 1 and summary["total_open"] == 2

    # SLA escalation after >24h with no acceptance or attempts
    with dbmod.SessionLocal() as db:
        f_cr = db.get(Followup, cr_id)
        f_cr.created_at = datetime.now(timezone.utc) - timedelta(hours=26)
        db.commit()
        assert retest.sla_tick(db) == 1
        assert retest.sla_tick(db) == 0  # idempotent
        assert db.scalar(select(AuditLog).where(AuditLog.action == "sla_escalate", AuditLog.entity_id == str(cr_id))) is not None
    assert any("SLA overdue" in n["text"] for n in admin.get(f"{API}/notifications").json()["items"])


def test_tier_window_validation_manual_urgent_patient_and_caller_safety(admin, caller, doctor):
    make_doctor(admin, "Dr One")
    today = today_ist()
    oid, pid, _ = _make_report([A1C_SEV], days_ago=0, mobile="9622200001")
    fid = fu_of(oid).id

    # Outside METABOLIC tier window (56-84d) without override reason -> 422; inside (60d) -> 200
    assert doctor.patch(f"{API}/followups/{fid}", json={"retest_date": (today + timedelta(days=10)).isoformat()}).status_code == 422
    assert doctor.patch(f"{API}/followups/{fid}", json={"retest_date": (today + timedelta(days=60)).isoformat()}).status_code == 200

    # With reason -> audited override allowed
    ov = doctor.patch(f"{API}/followups/{fid}", json={
        "retest_date": (today + timedelta(days=10)).isoformat(),
        "retest_override_reason": "CLINICAL_JUDGMENT",
    })
    assert ov.status_code == 200 and ov.json()["retest_status"] == "OVERRIDDEN"

    # Doctor marks follow-up URGENT by hand -> URGENT notification sent
    up = doctor.patch(f"{API}/followups/{fid}", json={"protocol_tier": "URGENT"})
    assert up.status_code == 200 and up.json()["protocol_tier"] == "URGENT"
    assert any(n["urgent"] and f"id={fid}" in n["link"] for n in admin.get(f"{API}/notifications").json()["items"])

    # Patient endpoint carries tier badge fields
    pat = doctor.get(f"{API}/patients/{pid}").json()
    assert pat["protocol_tier"] == "URGENT" and pat["protocol_tier_colour"] == "red"
    assert pat["reports"][0]["protocol_tier"] == "URGENT"

    # Caller safety: all caller_label texts pass check_caller_safety & callers get neutral label + colour only
    cat_names = [t["name"] for t in TEST_CATALOGUE]
    for tier in RETEST_TIERS:
        fake_card = {"caller_script": {"opening": tier["caller_label"]}}
        assert callcard.check_caller_safety(fake_card, CALLER_FORBIDDEN, cat_names) == []

    caller_row = caller.get(f"{API}/followups").json()[0]
    assert caller_row["protocol_tier_colour"] == "red"
    assert caller_row["protocol_tier_label"] == "Priority call today"
    assert "protocol_tier" not in caller_row
    assert caller.get(f"{API}/followups", params={"protocol_tier": "URGENT"}).status_code == 403
    assert caller.get(f"{API}/retesting-protocol/summary").status_code == 403
    assert doctor.get(f"{API}/retesting-protocol/summary").status_code == 403
