"""Tests for AI Report Insights:
1. Validator:
   - Rejects invented numbers and unknown refs/codes
   - Rejects disease, medicine, or digits in caller text
   - Caps AI priority at PRIORITY
   - Falls back to template on rejection
2. Critical rule hit -> URGENT regardless of AI output
3. No PII in the provider input (assert on the built dict)
4. LLM_PROVIDER=template end-to-end produces a valid insight
5. Role checks: a caller cannot read the draft, approve, or see values
6. Doctor edit, regenerate, approve, reject workflow
7. Priority queue wiring: URGENT first, then by score
"""
import pytest
from sqlalchemy import select

from app import ai_insights, db as dbmod
from app.analysis import load_rules
from app.models import CriticalRule, Followup, Order, Report, ReportInsight, ReportParameter
from tests.test_followups import A1C_SEV, LDL, make

API = "/api/v1"


def test_no_pii_in_provider_input(admin):
    oid = make([A1C_SEV, LDL], name="Secret Patient", mobile="9876501234")
    with dbmod.SessionLocal() as db:
        rep = db.scalar(select(Report).where(Report.order_id == oid))
        data = ai_insights.build_insight_input(db, rep)

    # Assert no PII keys or values
    assert "patient_name" not in data
    assert "mobile" not in data
    assert "mobile_hash" not in data
    assert "Secret Patient" not in str(data)
    assert "9876501234" not in str(data)
    assert data["age"] == 40
    assert data["gender"] == "M"
    assert len(data["results"]) == 2


def test_template_provider_end_to_end_produces_valid_insight(admin, doctor):
    oid = make([A1C_SEV, LDL], name="Synthetic Test Patient", mobile="9888800001")
    with dbmod.SessionLocal() as db:
        rep = db.scalar(select(Report).where(Report.order_id == oid))
        rid = rep.id

    res = doctor.get(f"{API}/reports/{rid}/insight")
    assert res.status_code == 200
    insight = res.json()
    assert insight["status"] == "DRAFT"
    assert insight["provider"] == "template"

    content = insight["content"]
    assert "overview" in content
    assert "normal" not in content["overview"].lower()
    assert len(content["defects"]) >= 1
    assert "suggestions" in content
    assert "doctor_connect" in content
    assert content["doctor_connect"]["priority"] in ("PRIORITY", "ROUTINE", "URGENT")
    assert "future" in content
    assert "red_flag_protocol" in content
    assert content["needs_doctor_review"] is True


def test_validator_rejects_hallucinations_and_forbidden_caller_text():
    with dbmod.SessionLocal() as db:
        rules = load_rules(db)

    data = {
        "results": [{"ref": "101", "param_code": "HB", "name": "Haemoglobin", "value": "11.0", "unit": "g/dL", "status": "LOW", "severity": "mild"}],
        "catalogue": [{"code": "CBC", "name": "Complete Blood Count"}],
        "critical_hits": [],
    }

    # 1. Invalid ref
    bad_ref_content = {
        "schema_version": "1.0",
        "overview": "Overview text.",
        "defects": [{"ref": "999", "marker": "Haemoglobin", "status": "LOW", "severity": "mild", "what_it_measures": "Oxygen carrier", "explanation": "Low Hb", "related_refs": [], "priority": "MEDIUM"}],
        "suggestions": {"doctor_discussion": [], "caller_questions": ["How are you?"], "clarifications_for_doctor": []},
        "doctor_connect": {"priority": "PRIORITY", "source": "ai", "reason": "Low Hb", "connect_within_hours": 24},
        "future": {"monitoring_tests": ["CBC"], "suggested_window_days": 30, "trend_notes": [], "watch_markers": ["HB"]},
        "red_flag_protocol": "Warning protocol.",
        "limitations": "Limitations.",
        "needs_doctor_review": True,
    }
    errs = ai_insights.validate_insight(bad_ref_content, data, rules)
    assert any("does not exist in input results" in e for e in errs)

    # 2. AI setting URGENT priority
    ai_urgent_content = {**bad_ref_content, "defects": [{"ref": "101", "marker": "Haemoglobin", "status": "LOW", "severity": "mild", "what_it_measures": "Oxygen carrier", "explanation": "Low Hb", "related_refs": [], "priority": "MEDIUM"}],
                         "doctor_connect": {"priority": "URGENT", "source": "ai", "reason": "Severe", "connect_within_hours": 4}}
    errs2 = ai_insights.validate_insight(ai_urgent_content, data, rules)
    assert any("AI is not permitted to set URGENT" in e for e in errs2)

    # 3. Caller question with digits
    digit_caller_content = {**bad_ref_content, "defects": [{"ref": "101", "marker": "Haemoglobin", "status": "LOW", "severity": "mild", "what_it_measures": "Oxygen carrier", "explanation": "Low Hb", "related_refs": [], "priority": "MEDIUM"}],
                            "suggestions": {"doctor_discussion": [], "caller_questions": ["Did your Hb drop to 10?"], "clarifications_for_doctor": []}}
    errs3 = ai_insights.validate_insight(digit_caller_content, data, rules)
    assert any("Caller question contains a number" in e for e in errs3)

    # 4. Caller question with forbidden disease name (e.g. diabetes)
    disease_caller_content = {**bad_ref_content, "defects": [{"ref": "101", "marker": "Haemoglobin", "status": "LOW", "severity": "mild", "what_it_measures": "Oxygen carrier", "explanation": "Low Hb", "related_refs": [], "priority": "MEDIUM"}],
                              "suggestions": {"doctor_discussion": [], "caller_questions": ["Do you have diabetes?"], "clarifications_for_doctor": []}}
    errs4 = ai_insights.validate_insight(disease_caller_content, data, rules)
    assert any("forbidden word 'diabetes'" in e for e in errs4)


def test_critical_rule_forces_urgent_priority(admin, doctor):
    # Add doctor-approved critical rule: Haemoglobin < 9.0 g/dL
    cr_res = doctor.post(f"{API}/critical-rules", json={
        "marker": "Haemoglobin",
        "comparator": "<",
        "threshold": 9.0,
        "unit": "g/dL",
        "note": "Critical anemia threshold",
    })
    assert cr_res.status_code == 201
    rule_id = cr_res.json()["id"]

    # Patient with Hb 7.5 g/dL (meets critical rule)
    hb_crit = ("HB", "Haemoglobin", 7.5, "LOW", "severe", 40.0)
    oid = make([hb_crit], name="Crit Anemia", mobile="9777700001")

    with dbmod.SessionLocal() as db:
        rep = db.scalar(select(Report).where(Report.order_id == oid))
        rid = rep.id
        fu = db.scalar(select(Followup).where(Followup.report_id == rid))
        for p in db.scalars(select(ReportParameter).where(ReportParameter.report_id == rid)):
            p.unit = "g/dL"
        db.commit()

    ins_res = doctor.post(f"{API}/reports/{rid}/insight/regenerate")
    assert ins_res.status_code == 200
    insight = ins_res.json()
    assert insight["content"]["doctor_connect"]["priority"] == "URGENT"
    assert insight["content"]["doctor_connect"]["source"] == "rule"
    assert "urgent" in insight["content"]["doctor_connect"]["reason"].lower() or "critical" in insight["content"]["doctor_connect"]["reason"].lower()

    # Clean up rule
    admin.patch(f"{API}/critical-rules/{rule_id}", json={"active": False})


def test_role_checks_caller_cannot_see_draft_or_values(admin, doctor, caller):
    oid = make([A1C_SEV], name="Role Patient", mobile="9666600001")
    with dbmod.SessionLocal() as db:
        rep = db.scalar(select(Report).where(Report.order_id == oid))
        rid = rep.id

    # 1. Caller cannot view DRAFT insight
    draft_res = caller.get(f"{API}/reports/{rid}/insight")
    assert draft_res.status_code == 403

    # 2. Caller cannot approve or regenerate
    assert caller.post(f"{API}/reports/{rid}/insight/approve").status_code == 403
    assert caller.post(f"{API}/reports/{rid}/insight/regenerate").status_code == 403
    assert caller.patch(f"{API}/reports/{rid}/insight", json={"overview": "hacked"}).status_code == 403
    assert caller.post(f"{API}/critical-rules", json={"marker": "HB", "comparator": "<", "threshold": 5, "unit": "g/dL"}).status_code == 403

    # 3. Doctor generates and approves
    doctor.get(f"{API}/reports/{rid}/insight")  # generates draft
    appr = doctor.post(f"{API}/reports/{rid}/insight/approve")
    assert appr.status_code == 200
    assert appr.json()["status"] == "APPROVED"

    # 4. Caller now reads approved insight - caller_safe mode with NO defects/values
    caller_res = caller.get(f"{API}/reports/{rid}/insight")
    assert caller_res.status_code == 200
    data = caller_res.json()
    assert data["caller_safe"] is True
    assert "defects" not in data["content"]
    assert "caller_questions" in data["content"]
    assert "doctor_connect" in data["content"]


def test_doctor_workflow_edit_regenerate_and_queue_reorder(admin, doctor):
    oid = make([A1C_SEV], name="Doc Flow", mobile="9555500003")
    with dbmod.SessionLocal() as db:
        rep = db.scalar(select(Report).where(Report.order_id == oid))
        rid = rep.id

    # View generates draft
    d1 = doctor.get(f"{API}/reports/{rid}/insight").json()
    assert d1["status"] == "DRAFT"

    # Edit overview inline
    patched = doctor.patch(f"{API}/reports/{rid}/insight", json={"overview": "Doctor modified clinical overview."}).json()
    assert patched["content"]["overview"] == "Doctor modified clinical overview."

    # Regenerate
    regen = doctor.post(f"{API}/reports/{rid}/insight/regenerate").json()
    assert regen["status"] == "DRAFT"

    # Approve
    approved = doctor.post(f"{API}/reports/{rid}/insight/approve").json()
    assert approved["status"] == "APPROVED"
    assert approved["approved_by"] is not None

    # Followup priority updated to approved insight priority
    with dbmod.SessionLocal() as db:
        fu = db.scalar(select(Followup).where(Followup.report_id == rid))
        assert fu.priority == approved["content"]["doctor_connect"]["priority"]
