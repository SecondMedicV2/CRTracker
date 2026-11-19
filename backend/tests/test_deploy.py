"""Behaviour needed to run behind the Cloudflare Worker on a free backend host."""
from sqlalchemy import select

from app import db as dbmod
from app import privacy, status
from app.config import env
from app.models import AuditLog, Followup, Order, Patient, Setting, StoredFile
from app.timeutil import today_ist
from tests.conftest import client_as
from tests.test_followups import A1C_SEV, fu_of, make

API = "/api/v1"
SECRET = "edge-secret-for-tests"


def test_backend_refuses_requests_that_skip_the_worker(monkeypatch):
    monkeypatch.setattr(env, "edge_secret", SECRET)
    c = client_as()
    assert c.get(f"{API}/auth/me").status_code == 403 and c.get(f"{API}/auth/me").json() == {"detail": "Direct access refused"}
    assert c.get(f"{API}/auth/me", headers={"X-Edge-Secret": "wrong"}).status_code == 403
    assert c.get(f"{API}/auth/me", headers={"X-Edge-Secret": SECRET}).status_code == 401  # through: now it is just "not signed in"
    assert c.get("/api/health").status_code == 200  # the host's health check has no secret


def test_without_the_edge_secret_setting_local_development_is_unchanged():
    assert client_as().get(f"{API}/auth/me").status_code == 401


def test_visitor_address_comes_from_the_worker_only_after_the_secret_checks_out(monkeypatch):
    monkeypatch.setattr(env, "edge_secret", SECRET)
    h = {"X-Edge-Secret": SECRET, "X-Client-IP": "203.0.113.9"}
    client_as().post(f"{API}/auth/login", json={"email": "nobody@x.com", "password": "wrong-password-1"}, headers=h)
    with dbmod.SessionLocal() as db:
        assert db.scalar(select(AuditLog.ip).where(AuditLog.action == "login_failed")) == "203.0.113.9"


def test_cron_endpoint_exists_only_behind_the_worker(monkeypatch):
    c = client_as()
    assert c.post("/api/internal/tick").status_code == 404  # no edge secret configured
    monkeypatch.setattr(env, "edge_secret", SECRET)
    assert c.post("/api/internal/tick").status_code == 403
    assert c.post("/api/internal/tick", headers={"X-Edge-Secret": "nope"}).status_code == 403
    r = c.post("/api/internal/tick", headers={"X-Edge-Secret": SECRET})
    assert r.status_code == 200 and set(r.json()) == {"fetched", "extracted", "cards", "reassigned", "rounds"}


def test_one_cron_call_does_all_the_background_work(monkeypatch, admin):
    monkeypatch.setattr(env, "edge_secret", SECRET)
    with dbmod.SessionLocal() as db:  # pretend today's 07:00 pull already ran, so only our 3 orders are in play
        db.merge(Setting(key="_last_pull_date", value=today_ist().isoformat()))
        db.merge(Setting(key="pull_every_minutes", value=0))  # and no hourly repeat
        db.commit()
    admin.post(f"{API}/imports/manual", json={"text": "OK1 NORMAL1 FAIL1"}, headers={"X-Edge-Secret": SECRET})
    r = client_as().post("/api/internal/tick", headers={"X-Edge-Secret": SECRET}).json()
    assert r["fetched"] >= 2 and r["extracted"] == 2 and r["cards"] == 0  # the mock report is a lone mild value: parked, so no card yet
    with dbmod.SessionLocal() as db:
        got = {o.order_id_external: o.status for o in db.scalars(select(Order))}
        assert got["OK1"] == got["NORMAL1"] == status.READY and got["FAIL1"] == status.QUEUED  # failed one waits for its retry
        assert db.scalars(select(Followup)).all()  # a follow-up was created for the abnormal report


def test_reports_can_live_in_the_database_encrypted(monkeypatch, admin):
    monkeypatch.setattr(env, "storage_backend", "db")
    admin.post(f"{API}/imports/manual", json={"text": "OK1"})
    from app import worker

    with dbmod.SessionLocal() as db:
        worker.tick(db)
        worker.extract_tick(db)
    with dbmod.SessionLocal() as db:
        o = db.scalar(select(Order))
        row = db.get(StoredFile, o.report_path)
        assert o.status == status.READY  # read back through the database store
        assert row is not None and b"Glycosylated" not in bytes(row.data)  # stored encrypted, never as plain text


def test_erasing_a_patient_removes_the_database_copy_of_their_report(monkeypatch):
    monkeypatch.setattr(env, "storage_backend", "db")
    from app import storage

    pk = make([A1C_SEV], days_ago=95, name="Asha Rao", mobile="9876501234")
    with dbmod.SessionLocal() as db:
        o = db.get(Order, pk)
        o.report_path = storage.save(b"%PDF fake", "pdf")
        db.commit()
        name, pid = o.report_path, o.patient_id
        assert db.get(StoredFile, name) is not None
        privacy.erase_patient(db, pid)
    with dbmod.SessionLocal() as db:
        assert db.get(StoredFile, name) is None and db.get(Patient, pid) is None
    assert fu_of(pk) is None
