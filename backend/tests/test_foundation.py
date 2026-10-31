from app.config import SETTING_DEFAULTS
from tests.conftest import PW, client_as

API = "/api/v1"


def test_login_wrong_password_and_rate_limit():
    c = client_as()
    for _ in range(5):
        assert c.post(f"{API}/auth/login", json={"email": "ada@x.com", "password": "bad"}).status_code == 401
    assert c.post(f"{API}/auth/login", json={"email": "ada@x.com", "password": PW}).status_code == 429


def test_requires_login():
    assert client_as().get(f"{API}/users").status_code == 401


def test_role_gates(caller, doctor, admin):
    assert caller.get(f"{API}/users").status_code == 403
    assert doctor.get(f"{API}/audit").status_code == 403
    assert caller.put(f"{API}/settings/pilot_mode", json={"value": True}).status_code == 403
    assert admin.get(f"{API}/users").status_code == 200
    assert caller.get(f"{API}/doctors").status_code == 200  # any signed-in user


def test_admin_creates_user_and_cannot_lock_self_out(admin):
    r = admin.post(f"{API}/users", json={"name": "N", "email": "N@X.com", "password": "longenough123", "role": "CALLER"})
    assert r.status_code == 201 and r.json()["email"] == "n@x.com"
    assert admin.post(f"{API}/users", json={"name": "N", "email": "n@x.com", "password": "longenough123", "role": "CALLER"}).status_code == 409
    assert admin.post(f"{API}/users", json={"name": "N", "email": "o@x.com", "password": "short", "role": "CALLER"}).status_code == 422
    me = admin.get(f"{API}/auth/me").json()["id"]
    assert admin.patch(f"{API}/users/{me}", json={"active": False}).status_code == 400


def test_settings_default_and_typed_update(admin):
    assert admin.get(f"{API}/settings").json()["caller_can_view_results"] is False
    assert admin.put(f"{API}/settings/caller_can_view_results", json={"value": True}).json()["caller_can_view_results"] is True
    assert admin.put(f"{API}/settings/max_call_attempts", json={"value": "x"}).status_code == 422
    assert admin.put(f"{API}/settings/nope", json={"value": 1}).status_code == 404
    assert set(admin.get(f"{API}/settings").json()) == set(SETTING_DEFAULTS)


def test_rules_seeded_pending_then_versioned_and_signoff(admin, doctor):
    rules = {r["key"]: r for r in admin.get(f"{API}/rules").json()}
    assert "buckets" in rules and all(r["pending_signoff"] for r in rules.values())
    assert admin.get(f"{API}/rules/critical_values").json()["data"] == []  # never invented
    assert "HYPERTENSION" not in {b["code"] for b in admin.get(f"{API}/rules/buckets").json()["data"]}
    v2 = admin.put(f"{API}/rules/buckets", json={"data": []}).json()
    assert v2["version"] == 2 and v2["pending_signoff"]
    s = doctor.post(f"{API}/rules/buckets/signoff").json()
    assert s["pending_signoff"] is False and s["version"] == 2
    assert admin.put(f"{API}/rules/buckets", json={"data": [1]}).json()["pending_signoff"]  # edit resets sign-off


def test_audit_records_actions(admin):
    admin.put(f"{API}/settings/pilot_mode", json={"value": True})
    actions = {(a["action"], a["entity"]) for a in admin.get(f"{API}/audit").json()}
    assert ("login", "user") in actions and ("update", "setting") in actions
