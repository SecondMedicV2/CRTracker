import httpx
from sqlalchemy import select

from app import db as dbmod
from app.models import AuditLog, Order
from tests.test_followups import make

API = "/api/v1"


def new_patient():
    order_id = make([], name="Test Call Patient", mobile="9876543210")
    with dbmod.SessionLocal() as db:
        order = db.get(Order, order_id)
        return order.patient_id


def configure_myoperator(admin):
    settings = {
        "myoperator_company_id": "test-company",
        "myoperator_api_key": "test-secret-token",
        "myoperator_caller_id": "08012345678",
    }
    for key, value in settings.items():
        response = admin.put(f"{API}/settings/{key}", json={"value": value})
        assert response.status_code == 200
    settings_response = admin.get(f"{API}/settings")
    assert settings_response.json()["myoperator_api_key"] == "********"
    assert "test-secret-token" not in settings_response.text
    return settings


def test_admin_can_start_patient_call_through_myoperator(admin, monkeypatch):
    patient_id = new_patient()
    settings = configure_myoperator(admin)
    requests = []

    def fake_post(url, **kwargs):
        requests.append((url, kwargs))
        return httpx.Response(200, json={"status": "success"}, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.telephony.httpx.post", fake_post)
    response = admin.post(f"{API}/patients/{patient_id}/call")

    assert response.status_code == 202
    assert response.json() == {"status": "initiated"}
    assert len(requests) == 1
    url, kwargs = requests[0]
    assert url == "https://api.myoperator.com/v1/click_to_call"
    assert kwargs["headers"] == {"Authorization": f"Bearer {settings['myoperator_api_key']}"}
    assert kwargs["json"] == {
        "company_id": settings["myoperator_company_id"],
        "caller_id": settings["myoperator_caller_id"],
        "customer_number": "9876543210",
    }
    with dbmod.SessionLocal() as db:
        assert db.scalar(select(AuditLog).where(AuditLog.action == "outbound_call", AuditLog.entity_id == str(patient_id)))


def test_patient_call_requires_configuration_and_admin(admin, doctor, caller, monkeypatch):
    patient_id = new_patient()
    called = False

    def unexpected_post(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("provider should not be called")

    monkeypatch.setattr("app.telephony.httpx.post", unexpected_post)
    assert admin.post(f"{API}/patients/{patient_id}/call").status_code == 503
    assert doctor.post(f"{API}/patients/{patient_id}/call").status_code == 403
    assert caller.post(f"{API}/patients/{patient_id}/call").status_code == 403
    assert not called


def test_patient_call_respects_do_not_call(admin, monkeypatch):
    patient_id = new_patient()
    configure_myoperator(admin)
    assert admin.patch(f"{API}/patients/{patient_id}", json={"do_not_call": True}).status_code == 200

    def unexpected_post(*args, **kwargs):
        raise AssertionError("provider should not be called")

    monkeypatch.setattr("app.telephony.httpx.post", unexpected_post)
    response = admin.post(f"{API}/patients/{patient_id}/call")
    assert response.status_code == 409
    assert "asked not to be called" in response.json()["detail"]


def test_myoperator_failure_is_sanitized(admin, monkeypatch):
    patient_id = new_patient()
    settings = configure_myoperator(admin)

    def rejected_post(*args, **kwargs):
        return httpx.Response(401, text=f"invalid token: {settings['myoperator_api_key']}",
                              request=httpx.Request("POST", args[0]))

    monkeypatch.setattr("app.telephony.httpx.post", rejected_post)
    response = admin.post(f"{API}/patients/{patient_id}/call")
    assert response.status_code == 502
    assert "MyOperator rejected" in response.json()["detail"]
    assert settings["myoperator_api_key"] not in response.text
