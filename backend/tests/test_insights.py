from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app import db as dbmod
from app.models import ReportParameter
from tests.test_followups import A1C, A1C_SEV, LDL, fu_of, make
from tests.test_workflow import doctor as make_doctor
from tests.test_workflow import new_fu

API = "/api/v1"


def a1c(value, flag="HIGH", dev=5.0):
    return ("HBA1C", "HbA1c", value, flag, "mild" if flag != "NORMAL" else "", dev if flag != "NORMAL" else 0.0)


def patient_with_history(admin, steps, name="Trend Tina", mobile="9555500001"):
    """steps: [(days_ago, value, flag)] oldest first. Returns the patient id."""
    pks = [make([a1c(v, f)], days_ago=d, name=name, mobile=mobile) for d, v, f in steps]
    with dbmod.SessionLocal() as db:
        from app.models import Order

        return db.get(Order, pks[0]).patient_id


def test_ac16_trend_has_every_stored_report_with_band_and_clickable_points(admin):
    pid = patient_with_history(admin, [(400, 6.4, "HIGH"), (200, 5.9, "HIGH"), (30, 5.2, "NORMAL")])
    with dbmod.SessionLocal() as db:  # give the reports a printed range and unit, as a real lab would
        for p in db.scalars(select(ReportParameter).where(ReportParameter.param_code == "HBA1C")):
            p.ref_text, p.ref_low, p.ref_high, p.unit = "<5.7", None, 5.7, "%"
        db.commit()
    t = admin.get(f"{API}/trends/{pid}", params={"codes": "hba1c"}).json()
    s = t["series"][0]
    assert [p["value"] for p in s["points"]] == [6.4, 5.9, 5.2] and [p["flag"] for p in s["points"]] == ["HIGH", "HIGH", "NORMAL"]
    assert s["points"][0]["date"] < s["points"][1]["date"] < s["points"][2]["date"]  # oldest first
    assert s["band"] == {"low": None, "high": 5.7} and s["band_source"] == "report" and s["unit"] == "%"
    assert all(p["report_id"] and p["order_id"] for p in s["points"])  # each point opens its report
    assert admin.get(f"{API}/reports/{s['points'][0]['report_id']}").status_code == 200
    assert t["history_starts"] == (datetime.now(timezone.utc) - timedelta(days=400)).date().isoformat()  # "history starts from..."


def test_range_selector_and_four_test_limit_and_validation(admin):
    pid = patient_with_history(admin, [(800, 6.0, "HIGH"), (300, 6.1, "HIGH"), (10, 6.2, "HIGH")])
    n = lambda r: len(admin.get(f"{API}/trends/{pid}", params={"codes": "HBA1C", "range": r}).json()["series"][0]["points"])
    assert (n("1y"), n("5y"), n("all")) == (2, 3, 3)
    assert admin.get(f"{API}/trends/{pid}", params={"codes": "HBA1C", "range": "10y"}).status_code == 422
    assert admin.get(f"{API}/trends/{pid}", params={"codes": "A,B,C,D,E"}).status_code == 422
    assert admin.get(f"{API}/trends/{pid}", params={"codes": ""}).status_code == 422
    two = admin.get(f"{API}/trends/{pid}", params={"codes": "HBA1C,LDL"}).json()["series"]
    assert [s["code"] for s in two] == ["HBA1C", "LDL"] and two[1]["points"] == []  # no data is an empty line, not an error
    assert admin.get(f"{API}/trends/9999", params={"codes": "HBA1C"}).status_code == 404


def test_fallback_band_comes_from_the_admin_table_when_no_range_printed(admin):
    pid = patient_with_history(admin, [(100, 6.0, "HIGH")])
    s = admin.get(f"{API}/trends/{pid}", params={"codes": "HBA1C"}).json()["series"][0]
    assert s["band"] == {"low": None, "high": 5.7} and s["band_source"] == "admin_table"


def test_held_reports_never_appear_in_trends(admin):
    pid = patient_with_history(admin, [(100, 6.0, "HIGH")], name="Delvin", mobile="9876543210")
    make([a1c(7.5)], days_ago=10, name="Delvin", mobile="9123456780")  # same name+age, other mobile: held for review
    pts = admin.get(f"{API}/trends/{pid}", params={"codes": "HBA1C"}).json()["series"][0]["points"]
    assert [p["value"] for p in pts] == [6.0]


def test_parameter_list_puts_abnormal_tests_first(admin):
    pks = [make([a1c(6.0), ("HEMOGLOBIN", "Haemoglobin", 14.0, "NORMAL", "", None), LDL], days_ago=50, name="Multi Mona", mobile="9555500002")]
    with dbmod.SessionLocal() as db:
        from app.models import Order

        pid = db.get(Order, pks[0]).patient_id
    params = admin.get(f"{API}/trends/{pid}/parameters").json()
    assert [p["code"] for p in params][:2] in (["HBA1C", "LDL"], ["LDL", "HBA1C"]) and params[-1]["code"] == "HEMOGLOBIN"
    assert params[0]["abnormal"] == 1 and params[0]["count"] == 1


def test_trend_access_and_audit(admin, caller, doctor):
    pid = patient_with_history(admin, [(100, 6.0, "HIGH")])
    assert caller.get(f"{API}/trends/{pid}", params={"codes": "HBA1C"}).status_code == 403  # callers never see results
    assert caller.get(f"{API}/trends/{pid}/parameters").status_code == 403
    assert doctor.get(f"{API}/trends/{pid}", params={"codes": "HBA1C"}).status_code == 200
    assert ("view", "trend") in [(a["action"], a["entity"]) for a in admin.get(f"{API}/audit").json()]


# ---------------- dashboard ----------------
def test_dashboard_counts_funnel_and_rates(admin, caller, doctor):
    make_doctor(admin, "Dr One")
    a, b, c = new_fu(), new_fu(), new_fu(params=(A1C,), days_ago=0)  # c is parked (low potential)
    admin.post(f"{API}/imports/manual", json={"text": "X1 X2"})  # two queued orders
    for f in (a, b):
        caller.post(f"{API}/followups/{f}/consent")
    slot = (date.today() + timedelta(days=3)).isoformat() + "T10:00:00"
    caller.post(f"{API}/followups/{a}/calls", json={"outcome": "BOOKED", "slot_start": slot})
    caller.post(f"{API}/followups/{b}/calls", json={"outcome": "NOT_REACHABLE"})
    d = admin.get(f"{API}/dashboard").json()
    assert d["orders"]["imported"] >= 5 and d["orders"]["by_status"]["QUEUED"] == 2 and d["orders"]["reports_ready"] == 3
    assert d["results"] == {"normal": 0, "abnormal": 3}
    assert d["calls"]["made"] == 2 and d["calls"]["bookings"] == 1 and d["calls"]["by_outcome"] == {"BOOKED": 1, "NOT_REACHABLE": 1}
    assert d["calls"]["consent_rate_pct"] == 100  # both followups that were called had consent
    steps = {s["step"]: s["count"] for s in d["funnel"]}
    assert steps == {"Follow-ups created": 3, "Called": 2, "Consent given": 2, "Booked": 1, "Doctor call done": 0,
                     "Retest recommended": 0, "Retest ordered": 0}
    assert d["followups_due"]["parked"] == 1 and d["followups_due"]["overdue"] >= 1
    assert d["patients_per_bucket"]["DIABETES"] == 3
    assert d["doctors"][0]["name"] == "Dr One" and d["doctors"][0]["upcoming_bookings"] == 1 and d["doctors"][0]["open_cases"] >= 1
    assert d["needs_attention"] == {"failed_fetch": 0, "failed_extract": 0, "needs_review": 0, "pending_identity": 0}


def test_dashboard_date_filter_and_validation(admin):
    new_fu()
    old = admin.get(f"{API}/dashboard", params={"from": "2020-01-01", "to": "2020-01-31"}).json()
    assert old["orders"]["imported"] == 0 and old["funnel"][0]["count"] == 0 and old["calls"]["consent_rate_pct"] is None
    today = date.today().isoformat()
    assert admin.get(f"{API}/dashboard", params={"from": today, "to": today}).json()["orders"]["imported"] == 1
    assert admin.get(f"{API}/dashboard", params={"from": "2026-02-01", "to": "2026-01-01"}).status_code == 422
    assert admin.get(f"{API}/dashboard", params={"from": "nope"}).status_code == 422


def test_dashboard_is_admin_only(caller, doctor):
    assert caller.get(f"{API}/dashboard").status_code == 403
    assert doctor.get(f"{API}/dashboard").status_code == 403


def test_dashboard_flags_orders_needing_attention(admin):
    admin.post(f"{API}/imports/manual", json={"text": "PDF-1 REVIEW-1"})
    from app import worker

    with dbmod.SessionLocal() as db:
        worker.tick(db)
        worker.extract_tick(db)
    d = admin.get(f"{API}/dashboard").json()["needs_attention"]
    assert d["failed_extract"] == 1 and d["needs_review"] == 1


# ---------------- exports ----------------
def test_followup_csv_export_is_safe_and_audited(admin, caller, doctor):
    new_fu(name="=HYPERLINK(\"http://x\")")
    new_fu(name="Normal Nora", mobile="9666600001")
    r = admin.get(f"{API}/exports/followups.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]
    lines = r.text.strip().splitlines()
    assert lines[0].startswith("Follow-up,Patient,Mobile,Due") and len(lines) == 3
    assert "'=HYPERLINK" in r.text and ",=HYPERLINK" not in r.text and '"=HYPERLINK' not in r.text  # no live formula in a cell
    assert caller.get(f"{API}/exports/followups.csv").status_code == 403
    assert doctor.get(f"{API}/exports/followups.csv", params={"view": "overdue"}).status_code == 200
    assert admin.get(f"{API}/exports/followups.csv", params={"view": "nope"}).status_code == 422
    assert ("export", "followups") in [(a["action"], a["entity"]) for a in admin.get(f"{API}/audit").json()]


def test_trend_csv_export(admin, caller):
    pid = patient_with_history(admin, [(100, 6.0, "HIGH"), (10, 5.1, "NORMAL")])
    r = admin.get(f"{API}/exports/trends/{pid}.csv", params={"codes": "HBA1C"})
    rows = r.text.strip().splitlines()
    assert rows[0] == "Test,Date,Value,Unit,Flag,Order" and len(rows) == 3 and ",6.0," in rows[1] and ",NORMAL," in rows[2]
    assert caller.get(f"{API}/exports/trends/{pid}.csv", params={"codes": "HBA1C"}).status_code == 403
    assert admin.get(f"{API}/exports/trends/{pid}.csv", params={"codes": ""}).status_code == 422


def test_csv_cell_escaping_unit():
    from app.routers.insights import _cell

    assert [_cell(x) for x in ("=1+1", "+1", "-1", "@a", "ok", None, 5)] == ["'=1+1", "'+1", "'-1", "'@a", "ok", "", "5"]
    assert fu_of and A1C_SEV
