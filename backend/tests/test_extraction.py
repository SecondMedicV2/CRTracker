from sqlalchemy import select

from app import db as dbmod
from app import status, worker
from app.analysis import analyse, flag_parameter, parse_range, severity_for
from app.extract import canonical_code, parse_value
from app.models import AuditLog, Order, Report, ReportParameter
from app.seed_data import ALIASES, REFERENCE_RANGES, SEVERITY

API = "/api/v1"
RULES = {"reference_ranges": REFERENCE_RANGES, "severity": SEVERITY}


def test_parse_range_forms():
    assert parse_range("<5.7") == (None, 5.7, False, True)
    assert parse_range("<= 5.7") == (None, 5.7, False, False)
    assert parse_range(">= 150") == (150.0, None, False, False)
    assert parse_range("10 - 20") == (10.0, 20.0, False, False)
    assert parse_range("0.4–4.2") == (0.4, 4.2, False, False)  # en dash
    assert parse_range("1,000 to 2,000") == (1000.0, 2000.0, False, False)
    assert parse_range("Absent") is None and parse_range("") is None


def test_parse_value_and_alias_mapping():
    assert parse_value("1,234.5") == (1234.5, "1,234.5")
    assert parse_value("<0.5")[0] == 0.5
    assert parse_value("Not detected")[0] is None
    for raw in ("Glycosylated  Hemoglobin", "HbA1c", " A1C "):
        assert canonical_code(raw, ALIASES) == "HBA1C"
    assert canonical_code("Mystery Test", ALIASES) == ""


def P(code="HBA1C", v=None, ref="", flag=""):
    return ReportParameter(param_code=code, value_num=v, ref_text=ref, lab_flag=flag)


def run(p, gender="M"):
    flag_parameter(p, gender, RULES)
    return p.system_flag, p.severity, p.ref_source


def test_report_range_wins_and_exclusive_bound():
    assert run(P(v=6.0, ref="<5.7"))[::2] == ("HIGH", "report")
    assert run(P(v=5.7, ref="<5.7"))[0] == "HIGH"  # '<5.7' excludes 5.7
    assert run(P(v=5.7, ref="<=5.7"))[0] == "NORMAL"
    assert run(P(code="X", v=5.0, ref="10 - 20"))[0] == "LOW"
    # the lab's wide range beats the stricter fallback table
    assert run(P(v=6.0, ref="<7"))[0] == "NORMAL"


def test_fallback_table_when_no_report_range():
    assert run(P(v=6.0)) == ("HIGH", "mild", "fallback")  # 5.0% over the 5.7 limit
    assert run(P(v=5.0))[0] == "NORMAL"
    assert run(P(code="VITAMIN_D", v=25))[0] == "LOW"  # insufficient band is below the normal band
    assert run(P(code="EGFR", v=50))[0] == "LOW"
    assert run(P(code="GLUCOSE_FASTING", v=60))[0] == "LOW"


def test_sex_specific_fallback_and_unknown_sex_is_not_guessed():
    hdl = lambda g: run(P(code="HDL", v=45), g)[0]
    assert hdl("M") == "NORMAL" and hdl("F") == "LOW"
    assert hdl("") == ""  # no sex, no flag


def test_no_range_no_fallback_uses_lab_flag_else_nothing():
    assert run(P(code="UNKNOWN", v=9, flag="H"))[::2] == ("HIGH", "lab_flag")
    assert run(P(code="UNKNOWN", v=9))[0] == ""
    assert run(P(code="UNKNOWN", v=None, ref="<5"))[0] == ""  # non-numeric value is not flagged


def test_severity_bands():
    assert [severity_for(d, SEVERITY) for d in (5, 10, 24.9, 25, 80)] == ["mild", "moderate", "moderate", "severe", "severe"]


def test_classification():
    r = Report(gender="M")
    assert analyse(r, [P(v=5.0), P(code="EGFR", v=90)], RULES) == "NORMAL"
    assert analyse(r, [P(v=5.0), P(code="EGFR", v=50)], RULES) == "ABNORMAL"


# ---- pipeline through the API ----
def tick_all():
    with dbmod.SessionLocal() as db:
        worker.tick(db)
        worker.extract_tick(db)


def the_order(oid):
    with dbmod.SessionLocal() as db:
        return db.scalar(select(Order).where(Order.order_id_external == oid))


def import_and_run(admin, text):
    admin.post(f"{API}/imports/manual", json={"text": text})
    tick_all()


def test_clean_report_becomes_ready_and_abnormal(admin):
    import_and_run(admin, "OK1 NORMAL1")
    assert the_order("OK1").status == status.READY and the_order("NORMAL1").status == status.READY
    reps = {r["order_id"]: r for r in admin.get(f"{API}/reports").json()}
    assert reps["OK1"]["classification"] == "ABNORMAL" and reps["OK1"]["abnormal_count"] == 1
    assert reps["NORMAL1"]["classification"] == "NORMAL"
    d = admin.get(f"{API}/reports/{reps['OK1']['id']}").json()
    a1c = next(p for p in d["parameters"] if p["param_code"] == "HBA1C")
    assert (a1c["system_flag"], a1c["severity"], a1c["unit"], a1c["ref_source"]) == ("HIGH", "mild", "%", "report")
    assert next(p for p in d["parameters"] if p["param_code"] == "HEMOGLOBIN")["unit"] == "g/dL"


def test_missing_gender_goes_to_review_then_approve(admin):
    import_and_run(admin, "REVIEW1")
    assert the_order("REVIEW1").status == status.NEEDS_REVIEW
    rep = admin.get(f"{API}/reports", params={"status_": "NEEDS_REVIEW"}).json()[0]
    assert rep["needs_review"] and "Gender missing" in rep["review_reasons"]
    rid = rep["id"]
    assert admin.post(f"{API}/reports/{rid}/approve").status_code == 422  # still no gender
    assert admin.patch(f"{API}/reports/{rid}", json={"gender": "X"}).status_code == 422
    assert admin.patch(f"{API}/reports/{rid}", json={"gender": "f"}).json()["gender"] == "F"
    d = admin.get(f"{API}/reports/{rid}").json()
    pid = next(p["id"] for p in d["parameters"] if p["param_code"] == "HBA1C")
    assert admin.patch(f"{API}/reports/{rid}/parameters/{pid}", json={"value": "5.0"}).json()["value_num"] == 5.0
    assert admin.post(f"{API}/reports/{rid}/approve").json()["status"] == status.READY
    assert admin.get(f"{API}/reports/{rid}").json()["classification"] == "NORMAL"
    assert admin.post(f"{API}/reports/{rid}/approve").status_code == 409  # already done
    assert admin.patch(f"{API}/reports/{rid}", json={"age": 40}).status_code == 409
    with dbmod.SessionLocal() as db:  # corrections logged by field name, not value
        logged = [a.entity_id for a in db.scalars(select(AuditLog).where(AuditLog.action == "correct"))]
    assert "%d:gender" % rid in logged and not any("5.0" in x for x in logged)


def test_pdf_report_fails_extraction_with_reason_and_can_retry(admin):
    import_and_run(admin, "PDF1")
    o = the_order("PDF1")
    assert o.status == status.FAILED_EXTRACT and "Could not read this PDF" in o.error  # the mock sends a broken stub
    assert admin.post(f"{API}/orders/{o.id}/retry").json()["status"] == status.FETCHED
    tick_all()
    assert the_order("PDF1").status == status.FAILED_EXTRACT  # still unreadable, but no crash or duplicate rows
    with dbmod.SessionLocal() as db:
        assert db.scalars(select(Report)).all() == []


def test_rerun_replaces_report_instead_of_duplicating(admin):
    import_and_run(admin, "OK2")
    o = the_order("OK2")
    with dbmod.SessionLocal() as db:
        o = db.get(Order, o.id)
        o.status = status.FETCHED  # simulate a re-run
        db.commit()
    tick_all()
    with dbmod.SessionLocal() as db:
        assert len(db.scalars(select(Report)).all()) == 1
        assert len(db.scalars(select(ReportParameter)).all()) == 3


def test_callers_cannot_see_results_and_views_are_audited(admin, caller, doctor):
    import_and_run(admin, "OK3")
    rid = admin.get(f"{API}/reports").json()[0]["id"]
    assert caller.get(f"{API}/reports").status_code == 403
    assert caller.get(f"{API}/reports/{rid}").status_code == 403
    assert doctor.get(f"{API}/reports/{rid}").status_code == 200
    actions = [(a["action"], a["entity"], a["entity_id"]) for a in admin.get(f"{API}/audit").json()]
    assert ("view", "report", str(rid)) in actions
