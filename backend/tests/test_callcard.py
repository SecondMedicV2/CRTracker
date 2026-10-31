import copy
import json

import pytest

from app import callcard as cc
from app import db as dbmod
from app import worker
from app.analysis import load_rules
from app.config import env
from app.llm import LLMError, TemplateProvider
from app.models import CallCard, Followup
from tests.test_followups import A1C, A1C_SEV, LDL, fu_of, make

API = "/api/v1"


def fid_for(params=(A1C_SEV, LDL), days_ago=95, **kw):
    return fu_of(make(list(params), days_ago=days_ago, **kw)).id


def ctx(fid):
    with dbmod.SessionLocal() as db:
        fu = db.get(Followup, fid)
        data, rules = cc.build_input(db, fu), load_rules(db)
        return data, rules, TemplateProvider().generate(data, rules["script_templates"])


def test_ac10_card_has_all_three_parts_and_validates(admin):
    fid = fid_for()
    r = admin.post(f"{API}/followups/{fid}/call-card/generate")
    assert r.status_code == 201
    c = r.json()
    assert c["validation_status"] == "VALID" and c["version"] == 1 and c["label"].startswith("AI-generated draft")
    body = c["content"]
    assert {t["test_code"] for t in body["retest"]["recommended_tests"]} == {"HBA1C", "FBS", "PPBS", "LIPID"}
    assert body["retest"]["tier"] == "MEDIUM" and len(body["retest"]["score_breakdown"]) == 5
    assert body["doctor_script"]["scientific_talking_points"] and body["caller_script"]["free_followup_pitch"]
    assert body["needs_doctor_review"] is True and body["retest"]["ideal_window"]["from"]
    data, rules, content = ctx(fid)
    assert cc.validate_all(content, data, rules) == []
    assert "Delvin" not in json.dumps(data) and "9876543210" not in json.dumps(data)  # de-identified input


def test_grounding_rejects_invented_numbers_and_unknown_tests():
    data, rules, content = ctx(fid_for())
    bad = copy.deepcopy(content)
    bad["doctor_script"]["discussion_points"].append("HbA1c was 7.9 last time")
    assert any("7.9" in e for e in cc.check_grounding(bad, data))
    bad = copy.deepcopy(content)
    bad["retest"]["recommended_tests"][0]["test_code"] = "MAGIC"
    assert any("MAGIC" in e for e in cc.check_grounding(bad, data))
    bad = copy.deepcopy(content)
    bad["retest"]["recommended_tests"][0]["name"] = "Invented Panel"
    assert cc.check_grounding(bad, data)


def test_ac11_caller_script_safety_checks():
    data, rules, content = ctx(fid_for())
    names, forb = [t["name"] for t in rules["test_catalogue"]], rules["caller_script_forbidden"]

    def with_line(line, field="free_followup_pitch"):
        c = copy.deepcopy(content)
        c["caller_script"][field] = line
        return cc.check_caller_safety(c, forb, names)

    assert with_line("You have diabetes, so the doctor wants to see you.")          # diagnosis
    assert with_line("Your sugar level was 6.1 last time.")                         # value
    assert with_line("The doctor will review your report in 5 minutes.")            # any digit
    assert with_line("Please keep taking metformin until then.")                    # drug
    assert with_line("आपको मधुमेह है।")                                               # Hindi diagnosis
    assert with_line("Your result is abnormal.", "opening")
    assert with_line("Your cholesterol is high.", "closing")
    assert not with_line("A free follow-up call is available after your Vitamin B12 and Fasting Blood Sugar tests.")  # test names are allowed
    assert not with_line("Hello {patient_name}, this is {caller_name} from {company}.", "opening")
    c = copy.deepcopy(content)
    c["caller_script"]["do_not_say"] = ["Never mention diabetes or 6.1"]  # guidance for the caller, not spoken
    assert not cc.check_caller_safety(c, forb, names)
    c["caller_script"]["objection_handling"][0]["reply"] = "It is not cancer."
    assert cc.check_caller_safety(c, forb, names)


def test_schema_validation_reports_missing_and_wrong_values():
    data, rules, content = ctx(fid_for())
    bad = copy.deepcopy(content)
    del bad["caller_script"]["consent_request"]
    bad["retest"]["confidence"] = "sure"
    bad["abnormal_findings"][0]["direction"] = "up"
    errs = cc.validate_schema(bad)
    assert any("consent_request" in e for e in errs) and any("confidence" in e for e in errs) and any("direction" in e for e in errs)
    assert cc.validate_schema("nope") == ["Card is not an object"]


class Violator:
    name, model, prompt_version = "bad", "bad-1", "v1"

    def __init__(self, ok_after=None):
        self.calls, self.ok_after = 0, ok_after

    def generate(self, data, templates):
        self.calls += 1
        c = TemplateProvider().generate(data, templates)
        if self.ok_after is None or self.calls <= self.ok_after:
            c["caller_script"]["free_followup_pitch"] = "Your diabetes needs a repeat test."
        return c


def test_bad_output_is_retried_twice_then_needs_review(monkeypatch, admin):
    fid = fid_for()
    v = Violator()
    monkeypatch.setattr(cc, "get_llm", lambda: v)
    c = admin.post(f"{API}/followups/{fid}/call-card/generate").json()
    assert v.calls == 3 and c["validation_status"] == "NEEDS_REVIEW" and "diabetes" in c["validation_errors"][0]
    assert admin.post(f"{API}/followups/{fid}/caller-card").status_code == 405
    assert admin.get(f"{API}/followups/{fid}/caller-card").status_code == 409  # unvalidated script is never shown


def test_retry_can_succeed_on_second_attempt(monkeypatch, admin):
    fid = fid_for()
    v = Violator(ok_after=1)
    monkeypatch.setattr(cc, "get_llm", lambda: v)
    c = admin.post(f"{API}/followups/{fid}/call-card/generate").json()
    assert v.calls == 2 and c["validation_status"] == "VALID" and c["model"] == "bad-1"


def test_ac19_three_languages_and_fallback_notice(admin):
    fid = fid_for()
    pid = fu_of_patient(fid)
    seen = {}
    for lang in ("en", "hi", "hinglish"):
        admin.patch(f"{API}/patients/{pid}", json={"language": lang})
        c = admin.post(f"{API}/followups/{fid}/call-card/generate").json()
        assert c["validation_status"] == "VALID" and c["language"] == lang and c["notice"] == ""
        seen[lang] = c["content"]["caller_script"]["opening"]
    assert "नमस्ते" in seen["hi"] and "Namaste" in seen["hinglish"] and "Hello" in seen["en"]
    admin.patch(f"{API}/patients/{pid}", json={"language": "mr"})
    c = admin.post(f"{API}/followups/{fid}/call-card/generate").json()
    assert c["language"] == "en" and "Showing English" in c["notice"] and "'mr'" in c["notice"]
    assert c["version"] == 4 and [v["version"] for v in c["versions"]] == [1, 2, 3, 4]


def fu_of_patient(fid):
    with dbmod.SessionLocal() as db:
        return db.get(Followup, fid).patient_id


def test_caller_card_hides_clinical_content_and_fills_placeholders(admin, caller):
    fid = fid_for()
    assert caller.get(f"{API}/followups/{fid}/caller-card").status_code == 409  # no card yet
    admin.post(f"{API}/followups/{fid}/call-card/generate")
    r = caller.get(f"{API}/followups/{fid}/caller-card")
    assert r.status_code == 200
    d = r.json()
    assert d["reason_for_call"] == "Due for a follow-up on your HbA1c, Fasting Blood Sugar, Post-Prandial Blood Sugar, Lipid Profile"
    assert "Delvin" in d["script"]["opening"] and "Cal" in d["script"]["opening"] and "{" not in d["script"]["opening"]
    assert d["mobile"].startswith("XXXXXX")
    dumped = json.dumps(d)
    for leak in ("abnormal", "retest", "doctor_script", "6.1", "HIGH", "score"):  # AC12: nothing clinical
        assert leak not in dumped
    assert caller.get(f"{API}/followups/{fid}/call-card").status_code == 403
    assert caller.post(f"{API}/followups/{fid}/call-card/generate").status_code == 403


def test_approval_required_setting_and_doctor_approval_rules(admin, caller, doctor):
    fid = fid_for()
    cid = admin.post(f"{API}/followups/{fid}/call-card/generate").json()["id"]
    admin.put(f"{API}/settings/caller_script_requires_approval", json={"value": True})
    assert caller.get(f"{API}/followups/{fid}/caller-card").status_code == 409
    assert admin.post(f"{API}/call-cards/{cid}/approve").status_code == 403  # approval is a doctor's job
    ok = doctor.post(f"{API}/call-cards/{cid}/approve").json()
    assert ok["approved"] and ok["label"] == "Approved by doctor"
    assert caller.get(f"{API}/followups/{fid}/caller-card").status_code == 200
    new = admin.post(f"{API}/followups/{fid}/call-card/generate").json()  # a regenerated version starts unapproved
    assert not new["approved"] and doctor.post(f"{API}/call-cards/{cid}/approve").status_code == 409  # old version


def test_doctor_edit_makes_new_version_and_is_still_safety_checked(admin, doctor):
    fid = fid_for()
    c = admin.post(f"{API}/followups/{fid}/call-card/generate").json()
    edited = copy.deepcopy(c["content"])
    edited["doctor_script"]["opening"] = "Custom opening written by the doctor."
    r = doctor.put(f"{API}/call-cards/{c['id']}", json={"content": edited})
    assert r.status_code == 200 and r.json()["version"] == 2 and r.json()["content"]["doctor_script"]["opening"].startswith("Custom")
    assert doctor.get(f"{API}/followups/{fid}/call-card").json()["versions"][1]["edited_by"] is not None
    edited["caller_script"]["opening"] = "You have cancer {patient_name}."
    bad = doctor.put(f"{API}/call-cards/{r.json()['id']}", json={"content": edited})
    assert bad.status_code == 422 and "cancer" in bad.json()["detail"]
    assert doctor.put(f"{API}/call-cards/{c['id']}", json={}).status_code == 422
    fixed = copy.deepcopy(c["content"])
    fixed["retest"]["confidence"] = "unsure"
    assert doctor.put(f"{API}/call-cards/{c['id']}", json={"content": fixed}).status_code == 422


def test_views_are_audited_and_nothing_is_stored_for_missing_cards(admin):
    fid = fid_for()
    assert admin.get(f"{API}/followups/{fid}/call-card").status_code == 404
    admin.post(f"{API}/followups/{fid}/call-card/generate")
    admin.get(f"{API}/followups/{fid}/call-card")
    acts = [(a["action"], a["entity"]) for a in admin.get(f"{API}/audit").json()]
    assert ("view", "call_card") in acts and ("generate", "call_card") in acts
    assert admin.get(f"{API}/followups/9999/call-card").status_code == 404


def test_worker_pregenerates_for_due_followups_only_once_and_skips_parked(admin):
    due = fid_for(days_ago=95)
    parked = fu_of(make([A1C], days_ago=0, name="Fred", mobile="9000000009")).id  # LOW tier
    far = fu_of(make([A1C_SEV, LDL], days_ago=0, name="Far", mobile="9000000008")).id  # due in ~90 days
    with dbmod.SessionLocal() as db:
        assert worker.callcard_tick(db) == 1
        assert worker.callcard_tick(db) == 0
        have = {c.followup_id for c in db.query(CallCard)}
    assert have == {due} and parked not in have and far not in have


def test_llm_failure_gives_clear_error_not_a_crash(monkeypatch, admin):
    fid = fid_for()
    monkeypatch.setattr(env, "llm_provider", "anthropic")
    monkeypatch.setattr(env, "anthropic_api_key", "")
    r = admin.post(f"{API}/followups/{fid}/call-card/generate")
    assert r.status_code == 502 and "ANTHROPIC_API_KEY" in r.json()["detail"]
    with dbmod.SessionLocal() as db:
        assert db.query(CallCard).count() == 0
