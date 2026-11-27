"""Pins who may call what (the route/role matrix), plus the hardening added in Phase 9."""
import io
import re

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.config import Env
from app.main import app
from tests.conftest import client_as

API = "/api/v1"
PUBLIC = {("POST", "/api/v1/auth/login"), ("POST", "/api/v1/auth/logout")}
SKIP = {"/api/docs", "/api/openapi.json", "/api/docs/oauth2-redirect", "/api/redoc", "/api/health"}

# Routes a CALLER may use (everything else must answer 403). Callers get no clinical data.
CALLER_OK = {
    ("GET", "/api/v1/auth/me"), ("GET", "/api/v1/doctors"), ("GET", "/api/v1/identity-reviews"),
    ("POST", "/api/v1/identity-reviews/{rid}/decide"), ("GET", "/api/v1/followups"), ("GET", "/api/v1/followups/summary"),
    ("GET", "/api/v1/followups/{fid}/caller-card"), ("POST", "/api/v1/followups/{fid}/consent"),
    ("POST", "/api/v1/followups/{fid}/calls"), ("GET", "/api/v1/followups/{fid}/comments"),
    ("POST", "/api/v1/followups/{fid}/comments"), ("POST", "/api/v1/followups/{fid}/connect-doctor"),
    ("GET", "/api/v1/followups/{fid}/workflow"), ("GET", "/api/v1/notifications"), ("POST", "/api/v1/notifications/read-all"),
    ("GET", "/api/v1/patients/{pid}/relationship"), ("GET", "/api/v1/patients/{pid}/programs"),
    ("GET", "/api/v1/refill-tasks"), ("POST", "/api/v1/refill-schedules/{sid}/confirm"),
    ("GET", "/api/v1/patients/{pid}/referrals"), ("PATCH", "/api/v1/referrals/{rid}"),
}
# Routes a DOCTOR must be refused (admin-only or caller-only work).
DOCTOR_FORBIDDEN = {
    ("GET", "/api/v1/users"), ("POST", "/api/v1/users"), ("PATCH", "/api/v1/users/{uid}"), ("POST", "/api/v1/doctors"),
    ("PUT", "/api/v1/doctors/{did}"), ("GET", "/api/v1/settings"), ("PUT", "/api/v1/settings/{key}"), ("GET", "/api/v1/rules"),
    ("PUT", "/api/v1/rules/{key}"), ("GET", "/api/v1/audit"), ("POST", "/api/v1/imports/manual"),
    ("POST", "/api/v1/imports/file/preview"), ("POST", "/api/v1/imports/file"), ("POST", "/api/v1/imports/pull"),
    ("GET", "/api/v1/imports"), ("GET", "/api/v1/imports/{bid}"), ("DELETE", "/api/v1/imports/{bid}"), ("GET", "/api/v1/orders"),
    ("DELETE", "/api/v1/orders/{oid}"), ("POST", "/api/v1/orders/{oid}/retry"),
    ("GET", "/api/v1/identity-reviews"), ("POST", "/api/v1/identity-reviews/{rid}/decide"),
    ("POST", "/api/v1/identity-reviews/{rid}/unmerge"), ("POST", "/api/v1/followups/recompute"),
    ("POST", "/api/v1/followups/{fid}/calls"), ("POST", "/api/v1/followups/{fid}/connect-doctor"), ("GET", "/api/v1/dashboard"),
    ("POST", "/api/v1/patients/{pid}/call"), ("GET", "/api/v1/relationship/summary"),
    ("GET", "/api/v1/retesting-protocol/summary"),
}
# Only a doctor may approve a call card or manage confirmed patient conditions / clinical tasks / Day 90 journey confirm; admin gets 403.
ADMIN_FORBIDDEN = {
    ("POST", "/api/v1/call-cards/{cid}/approve"),
    ("POST", "/api/v1/patients/{pid}/conditions"),
    ("DELETE", "/api/v1/patients/{pid}/conditions/{code}"),
    ("POST", "/api/v1/clinical-tasks/{tid}/complete"),
    ("POST", "/api/v1/followups/{fid}/journey/day90-confirm"),
}


def routes():
    for path, ops in app.openapi()["paths"].items():
        if path not in SKIP:
            for m in sorted(x.upper() for x in ops):
                if (m, path) not in PUBLIC:
                    yield m, path


def hit(c, m, path):
    url = re.sub(r"\{[^}]+\}", "1", path)
    return c.request(m, url, **({"json": {}} if m in ("POST", "PUT", "PATCH") else {})).status_code


def test_every_route_needs_a_login():
    anon = client_as()
    open_routes = [(m, p, s) for m, p in routes() if (s := hit(anon, m, p)) != 401]
    assert open_routes == []


def test_caller_matrix(caller):
    assert {(m, p) for m, p in routes() if hit(caller, m, p) != 403} == CALLER_OK


def test_doctor_matrix(doctor):
    assert {(m, p) for m, p in routes() if hit(doctor, m, p) == 403} == DOCTOR_FORBIDDEN


def test_admin_matrix(admin):
    assert {(m, p) for m, p in routes() if hit(admin, m, p) == 403} == ADMIN_FORBIDDEN


def test_new_routes_must_be_classified():
    """Fails when someone adds a route without deciding who may call it (update the sets above)."""
    assert len(list(routes())) == 109  # 105 + 4 (Page 10 compare endpoints & Day 90 confirmation)


# ---- the two leaks the review found ----
def test_callers_cannot_read_clinical_rule_sets(admin, caller, doctor):
    for key in ("buckets", "reference_ranges", "score_weights", "critical_values", "retest_protocols",
                "retest_tiers", "clinical_targets", "next_action_rules", "journey_templates"):
        assert caller.get(f"{API}/rules/{key}").status_code == 403
        assert doctor.get(f"{API}/rules/{key}").status_code == 200


def test_caller_doctor_list_has_no_phone_or_login(admin, caller, doctor):
    admin.post(f"{API}/doctors", json={"name": "Dr X", "phone": "0201234567", "user_id": 3, "in_pilot": True})
    assert set(caller.get(f"{API}/doctors").json()[0]) == {"id", "name", "speciality", "languages", "priority_order", "active"}
    assert doctor.get(f"{API}/doctors").json()[0]["phone"] == "0201234567"


# ---- headers, cross-site and error handling ----
def test_security_headers_and_no_store_on_api():
    r = client_as().get(f"{API}/auth/me")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer" and r.headers["cache-control"] == "no-store"


def test_cross_site_writes_are_refused_but_own_site_and_reads_work(admin):
    def post(origin):
        return admin.post(f"{API}/imports/manual", json={"text": "CSRF1"}, headers={"Origin": origin} if origin else {})

    assert post("https://evil.example").status_code == 403
    assert len(admin.get(f"{API}/orders").json()) == 0  # the refused request changed nothing
    assert post("http://localhost:3000").status_code == 201  # configured site
    assert post("http://testserver").status_code == 201  # same host
    assert post(None).status_code == 201  # not a browser (curl, tests)
    assert admin.get(f"{API}/imports", headers={"Origin": "https://evil.example"}).status_code == 200  # reads change nothing


def test_unexpected_errors_never_leak_details():
    from app.db import get_db

    def boom():
        raise RuntimeError("patient Asha Rao 9876543210")

    app.dependency_overrides[get_db] = boom
    try:
        r = TestClient(app, raise_server_exceptions=False).get(f"{API}/auth/me")
    finally:
        app.dependency_overrides.pop(get_db)
    assert r.status_code == 500 and r.json() == {"detail": "Something went wrong. Please try again."}
    assert "Asha" not in r.text and "9876543210" not in r.text


def test_unknown_email_costs_one_password_hash_like_a_wrong_password(monkeypatch):
    import app.routers.auth as auth_mod

    calls = []
    real = auth_mod.verify_password
    monkeypatch.setattr(auth_mod, "verify_password", lambda pw, stored: calls.append(1) or real(pw, stored))
    c = client_as()
    assert c.post(f"{API}/auth/login", json={"email": "nobody@x.com", "password": "whatever-long"}).status_code == 401
    assert c.post(f"{API}/auth/login", json={"email": "ada@x.com", "password": "wrong-password-1"}).status_code == 401
    assert len(calls) == 2


def test_production_mode_requires_a_long_secret():
    with pytest.raises(ValueError, match="at least 32"):
        Env(secret_key="short", cookie_secure=True)
    assert Env(secret_key="x" * 32, cookie_secure=True).cookie_secure
    assert Env(secret_key="short", cookie_secure=False).secret_key == "short"  # dev stays easy


# ---- uploads ----
def test_oversized_and_overlong_uploads_are_refused(admin):
    big = b"id\n" + b"A\n" * (3 * 1024 * 1024)  # about 6 MB
    assert admin.post(f"{API}/imports/file/preview", files={"file": ("big.csv", big)}).status_code == 413
    wb = Workbook()
    wb.active.append(["order"])
    for i in range(5100):
        wb.active.append([f"R{i}"])
    buf = io.BytesIO()
    wb.save(buf)
    r = admin.post(f"{API}/imports/file", files={"file": ("long.xlsx", buf.getvalue())}, data={"column": "order"})
    assert r.status_code == 422 and "5000" in r.json()["detail"]
    assert admin.post(f"{API}/imports/file", files={"file": ("bad.xlsx", b"not a zip")}, data={"column": "order"}).status_code == 422


def test_over_long_text_is_a_clear_422_not_a_database_error(admin):
    """SQLite ignores column sizes but PostgreSQL rejects over-long values, so inputs are limited up front."""
    long = "x" * 300
    assert admin.post(f"{API}/users", json={"name": long, "email": "a@x.com", "password": "long-enough-pass", "role": "CALLER"}).status_code == 422
    assert admin.post(f"{API}/doctors", json={"name": "Dr", "phone": long}).status_code == 422
    assert admin.post(f"{API}/doctors", json={"name": long}).status_code == 422
    from tests.test_followups import A1C_SEV, fu_of, make
    from app import db as dbmod
    from app.models import Followup

    with dbmod.SessionLocal() as db:
        pid = db.get(Followup, fu_of(make([A1C_SEV], days_ago=95)).id).patient_id
    assert admin.patch(f"{API}/patients/{pid}", json={"language": "x" * 21}).status_code == 422
    assert admin.patch(f"{API}/patients/{pid}", json={"language": "hinglish"}).status_code == 200
