from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

from sqlalchemy import select

from app import db as dbmod
from app import followup, pipeline, status, storage
from app.models import Followup, ImportBatch, Order, Patient, PatientBucket, Report, ReportParameter
from app.seed_data import BUCKETS, SCORE_WEIGHTS
from app.timeutil import today_ist

API = "/api/v1"
_n = [0]
A1C = ("HBA1C", "HbA1c", 6.1, "HIGH", "mild", 7.0)
A1C_SEV = ("HBA1C", "HbA1c", 9.0, "HIGH", "severe", 58.0)  # severe enough to clear the LOW tier with the starter weights
LDL = ("LDL", "LDL", 150, "HIGH", "mild", 8.0)
PSA = ("PSA", "PSA", 9.0, "HIGH", "severe", 80.0)
HB_OK = ("HEMOGLOBIN", "Haemoglobin", 14.0, "NORMAL", "", None)


def make(params, days_ago=0, name="Delvin", mobile="9876543210", age=40, status_after=None):
    """Insert an analysed report for a patient and run it through the real pipeline end (identity + follow-up)."""
    _n[0] += 1
    with dbmod.SessionLocal() as db:
        b = db.scalar(select(ImportBatch)) or ImportBatch(source="manual")
        db.add(b)
        db.flush()
        o = Order(order_id_external=f"F{_n[0]}", batch_id=b.id, status=status.EXTRACTING)
        db.add(o)
        db.flush()
        collected = datetime.now(timezone.utc) - timedelta(days=days_ago)
        rep = Report(order_id=o.id, patient_name=name, age=age, gender="M", collected_on=collected,
                     mobile_enc=storage.encrypt_str(mobile),
                     classification="ABNORMAL" if any(p[3] in ("LOW", "HIGH") for p in params) else "NORMAL")
        db.add(rep)
        db.flush()
        for code, raw, val, flag, sev, dev in params:
            db.add(ReportParameter(report_id=rep.id, param_code=code, param_name_raw=raw, value_num=val, value_text=str(val),
                                   system_flag=flag, severity=sev, deviation_pct=dev))
        db.flush()
        pipeline.conclude(db, o, rep)
        db.commit()
        return o.id


def fu_of(order_pk):
    with dbmod.SessionLocal() as db:
        return db.scalar(select(Followup).join(Report, Report.id == Followup.report_id).where(Report.order_id == order_pk))


def P(code, flag="HIGH", sev="mild", dev=5.0, name=None):
    return NS(param_code=code, system_flag=flag, severity=sev, deviation_pct=dev, param_name_raw=name or code, value_num=1.0)


# ---- pure rules ----
def test_buckets_multiple_other_and_direction_filter():
    got = followup.assign_buckets([P("HBA1C"), P("LDL", sev="moderate"), P("MYSTERY")], BUCKETS)
    assert set(got) == {"DIABETES", "LIPID", "OTHER"}
    assert got["LIPID"]["severity"] == "moderate" and "LDL high (moderate)" in got["LIPID"]["reasons"][0]
    assert set(followup.assign_buckets([P("PSA")], BUCKETS)) == {"CANCER_MARKER"}
    assert followup.assign_buckets([P("PSA", flag="LOW")], BUCKETS) == {}  # a low tumour marker is not a concern


def test_interval_default_and_immediate():
    d = followup.assign_buckets([P("HBA1C")], BUCKETS)
    assert followup.interval_for(d, 60) == 90  # bucket interval beats the default
    assert followup.interval_for(followup.assign_buckets([P("MYSTERY")], [{**BUCKETS[-1], "interval_days": None}]), 75) == 75
    assert followup.interval_for(followup.assign_buckets([P("HBA1C"), P("PSA")], BUCKETS), 90) == 0  # escalation wins


def test_score_components_and_tier_boundaries():
    w = SCORE_WEIGHTS
    s, parts, tier = followup.score("severe", 140, 90, "worsening", 3, True, w)
    assert (s, tier) == (30 + 25 + 20 + 15 + 10, "HIGH") and sum(p["points"] for p in parts) == s
    assert followup.score("mild", 0, 90, "none", 1, False, w)[::2] == (15, "LOW")
    # time ratio steps: <0.8, 0.8, 1.0, 1.5
    pts = [followup.score("", d, 100, "none", 1, False, w)[0] - 5 for d in (79, 80, 100, 150)]
    assert pts == [0, 10, 20, 25]
    # tier boundaries 40 / 65
    assert followup.score("moderate", 100, 100, "stable_abnormal", 1, False, w)[::2] == (55, "MEDIUM")
    assert followup.score("severe", 100, 100, "stable_abnormal", 1, False, w)[::2] == (65, "HIGH")
    assert followup.score("mild", 80, 100, "stable_abnormal", 3, False, w)[::2] == (45, "MEDIUM")
    assert followup.score("mild", 0, 100, "stable_abnormal", 3, False, w)[::2] == (35, "LOW")


def test_critical_values_rule():
    cv = [{"param_code": "K", "below": 2.5, "above": 6.5}]
    assert followup.is_critical([NS(param_code="K", value_num=7.0)], cv)
    assert followup.is_critical([NS(param_code="K", value_num=2.0)], cv)
    assert not followup.is_critical([NS(param_code="K", value_num=4.0)], cv)
    assert not followup.is_critical([NS(param_code="K", value_num=7.0)], [])  # empty table: nothing is critical


# ---- through the pipeline ----
def test_ac7_diabetes_due_90_days_after_collection_and_ac6_visible_reason():
    pk = make([A1C, HB_OK], days_ago=95)
    f = fu_of(pk)
    assert f.due_on == today_ist() - timedelta(days=5) and f.bucket_codes == ["DIABETES"]
    with dbmod.SessionLocal() as db:
        b = db.scalars(select(PatientBucket)).one()
    assert b.bucket_code == "DIABETES" and "HbA1c high (mild)" in b.reason and b.active


def test_single_mild_abnormal_is_parked_with_starter_weights(admin):
    # 10 (mild) + 20 (due now) + 5 (one bucket) = 35 < 40: LOW tier, so parked even when due
    pk = make([A1C], days_ago=95)
    f = fu_of(pk)
    assert (f.retest_score, f.retest_tier) == (35, "LOW")
    assert admin.get(f"{API}/followups", params={"view": "overdue"}).json() == []
    assert len(admin.get(f"{API}/followups", params={"view": "low_potential"}).json()) == 1


def test_normal_report_gets_no_followup():
    pk = make([HB_OK])
    assert fu_of(pk) is None


def test_list_views_and_ordering(admin):
    today = today_ist()
    make([A1C_SEV], days_ago=95, name="Overdue Olga", mobile="9000000001")        # due 5 days ago, ratio>1 -> medium-ish
    make([A1C_SEV], days_ago=89, name="Tomorrow Tim", mobile="9000000002")        # due tomorrow
    make([A1C_SEV], days_ago=83, name="Week Wendy", mobile="9000000003")          # due in 7 days
    make([A1C_SEV, LDL], days_ago=70, name="Month Mo", mobile="9000000004")            # due in 20 days
    make([A1C], days_ago=0, name="Fresh Fred", mobile="9000000005")           # due in 90 days, tiny score -> parked
    names = lambda v: [r["patient_name"] for r in admin.get(f"{API}/followups", params={"view": v}).json()]
    assert names("overdue") == ["Overdue Olga"]
    assert names("due_tomorrow") == ["Tomorrow Tim"]
    assert set(names("due_this_week")) == {"Tomorrow Tim", "Week Wendy"}
    assert set(names("next_30_days")) == {"Tomorrow Tim", "Week Wendy", "Month Mo"}
    assert "Fresh Fred" not in names("queue") and names("low_potential") == ["Fresh Fred"]  # AC9: parked, not deleted
    s = admin.get(f"{API}/followups/summary").json()
    assert (s["overdue"], s["due_tomorrow"], s["low_potential"]) == (1, 1, 1) and s["_buckets"] == {"DIABETES": 5, "LIPID": 1}


def test_escalation_for_cancer_marker_is_immediate_and_never_parked(admin):
    pk = make([PSA], days_ago=0)
    f = fu_of(pk)
    assert f.priority == "ESCALATION" and f.due_on == today_ist() and f.bucket_codes == ["CANCER_MARKER"]
    rows = admin.get(f"{API}/followups", params={"view": "escalations"}).json()
    assert len(rows) == 1 and rows[0]["retest_tier"] in ("LOW", "MEDIUM", "HIGH")
    assert admin.get(f"{API}/followups", params={"view": "low_potential"}).json() == []


def test_queue_orders_escalation_then_tier_then_due(admin):
    make([A1C], days_ago=60, name="Mid", mobile="9000000011")
    make([A1C, LDL], days_ago=140, name="High", mobile="9000000012")
    make([PSA], name="Esc", mobile="9000000013")
    assert [r["patient_name"] for r in admin.get(f"{API}/followups").json()][:2] == ["Esc", "High"]


def test_trend_worsening_adds_points_and_breakdown_is_visible(admin):
    make([("HBA1C", "HbA1c", 5.8, "HIGH", "mild", 1.0)], days_ago=200)
    pk = make([("HBA1C", "HbA1c", 6.4, "HIGH", "mild", 12.0)], days_ago=100)
    f = fu_of(pk)
    trend = next(p for p in f.score_breakdown if p["factor"].startswith("Trend"))
    assert trend["detail"] == "worsening" and trend["points"] == 20
    d = admin.get(f"{API}/followups/{f.id}").json()
    assert len(d["score_breakdown"]) == 5 and d["buckets_detail"][0]["code"] == "DIABETES"


def test_newer_report_suppresses_older_followup_and_engagement_bonus():
    old = make([A1C], days_ago=200)
    assert fu_of(old).suppressed_reason == ""
    make([A1C, LDL], days_ago=100)  # re-tested HbA1c more recently
    assert fu_of(old).suppressed_reason == "A newer report already covers these tests"
    # a patient who ordered a retest before gets the engagement bonus
    with dbmod.SessionLocal() as db:
        fo = db.scalar(select(Followup).where(Followup.report_id == fu_of(old).report_id))
        fo.stage = "RETEST_ORDERED"
        db.commit()
    pk = make([A1C], days_ago=10)
    assert any(p["factor"].startswith("Has ordered") and p["points"] == 10 for p in fu_of(pk).score_breakdown)


def test_started_followup_is_not_disturbed_by_recompute(admin):
    pk = make([A1C], days_ago=95)
    with dbmod.SessionLocal() as db:
        f = db.scalar(select(Followup))
        f.stage, f.due_on = "BOOKED", today_ist() + timedelta(days=30)
        db.commit()
    assert admin.post(f"{API}/followups/recompute").json()["recomputed"] == 1
    assert fu_of(pk).stage == "BOOKED" and fu_of(pk).due_on == today_ist() + timedelta(days=30)


def test_roles_caller_sees_no_clinical_data_until_flag(admin, caller, doctor):
    pk = make([A1C_SEV], days_ago=95)
    fid = fu_of(pk).id
    row = caller.get(f"{API}/followups").json()[0]
    assert "buckets" not in row and "retest_score" not in row and row["mobile"].startswith("XXXXXX")  # AC12
    assert caller.get(f"{API}/followups/{fid}").status_code == 403
    assert caller.get(f"{API}/followups", params={"bucket": "DIABETES"}).status_code == 403
    assert caller.get(f"{API}/followups", params={"view": "low_potential"}).status_code == 403
    assert "low_potential" not in caller.get(f"{API}/followups/summary").json()
    assert caller.patch(f"{API}/followups/{fid}", json={"priority": "ESCALATION"}).status_code == 403
    admin.put(f"{API}/settings/caller_can_view_results", json={"value": True})
    assert caller.get(f"{API}/followups/{fid}").status_code == 200
    assert "retest_score" in caller.get(f"{API}/followups").json()[0]


def test_priority_change_and_doctor_assignment(admin, doctor):
    pk = make([A1C], days_ago=95)
    fid = fu_of(pk).id
    did = admin.post(f"{API}/doctors", json={"name": "Dr A"}).json()["id"]
    r = doctor.patch(f"{API}/followups/{fid}", json={"priority": "ESCALATION", "assigned_doctor_id": did}).json()
    assert r["priority"] == "ESCALATION" and r["assigned_doctor_id"] == did
    assert admin.patch(f"{API}/followups/{fid}", json={"priority": "URGENT"}).status_code == 422
    assert admin.patch(f"{API}/followups/{fid}", json={"assigned_doctor_id": 999}).status_code == 422
    assert [x["id"] for x in admin.get(f"{API}/followups", params={"doctor_id": did, "view": "escalations"}).json()] == [fid]
    acts = [(a["action"], a["entity"]) for a in admin.get(f"{API}/audit").json()]
    assert ("update", "followup") in acts and ("view", "followup") not in acts


def test_unknown_view_rejected(admin):
    assert admin.get(f"{API}/followups", params={"view": "nope"}).status_code == 422


def test_merge_moves_followups_with_the_patient(admin):
    a = make([A1C], days_ago=95, name="Delvin", mobile="9876543210")
    b = make([A1C], days_ago=95, name="Delvin", mobile="9123456780")  # same name+age, other mobile -> held
    with dbmod.SessionLocal() as db:
        assert fu_of(b) is None and db.get(Order, b).status == status.PENDING_IDENTITY  # held, no call yet
    rid = admin.get(f"{API}/identity-reviews").json()[0]["id"]
    admin.post(f"{API}/identity-reviews/{rid}/decide", json={"decision": "SAME"})
    fa, fb = fu_of(a), fu_of(b)
    assert fb is not None and fa.patient_id == fb.patient_id
    admin.post(f"{API}/identity-reviews/{rid}/unmerge")
    assert fu_of(a).patient_id != fu_of(b).patient_id
