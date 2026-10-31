import io
from datetime import datetime, timedelta, timezone

import pytest
from openpyxl import Workbook

from app import db as dbmod
from app import status, storage, worker
from app.models import AuditLog, Order
from sqlalchemy import select

API = "/api/v1"


def ids(n, prefix="ORD"):
    return [f"{prefix}{i:04d}" for i in range(n)]


def orders(**kw):
    with dbmod.SessionLocal() as db:
        return db.scalars(select(Order).filter_by(**kw).order_by(Order.id)).all()


def run_worker():
    with dbmod.SessionLocal() as db:
        return worker.tick(db)


def test_ac1_paste_100_then_repaste_creates_no_duplicates(admin):
    text = "\n".join(ids(100))
    b = admin.post(f"{API}/imports/manual", json={"text": text}).json()
    assert (b["total"], b["new"], b["duplicate"], b["failed"]) == (100, 100, 0, 0)
    b2 = admin.post(f"{API}/imports/manual", json={"text": ",".join(ids(100))}).json()
    assert (b2["new"], b2["duplicate"]) == (0, 100)
    assert len(orders()) == 100


def test_duplicates_inside_one_batch_and_invalid_ids(admin):
    b = admin.post(f"{API}/imports/manual", json={"text": "A1, A1 B2 ;; bad id! <x>"}).json()
    assert b["new"] == 3 and b["duplicate"] == 1 and b["failed"] == 2
    assert all(f["reason"] for f in b["failures"])
    assert admin.post(f"{API}/imports/manual", json={"text": "  ,, "}).status_code == 422


def test_ac2_csv_with_column_mapping(admin):
    csv = "Name,Order No\nx,C1\ny,C2\nz,\n".encode()
    prev = admin.post(f"{API}/imports/file/preview", files={"file": ("o.csv", csv)}).json()
    assert prev["columns"] == ["Name", "Order No"] and prev["rows"] == 3
    b = admin.post(f"{API}/imports/file", files={"file": ("o.csv", csv)}, data={"column": "Order No"}).json()
    assert (b["new"], b["total"], b["file_name"]) == (2, 2, "o.csv")
    assert admin.post(f"{API}/imports/file", files={"file": ("o.csv", csv)}, data={"column": "Nope"}).status_code == 422


def test_ac2_xlsx_and_bad_file_type(admin):
    wb = Workbook()
    wb.active.append(["order"])
    for i in ids(5, "X"):
        wb.active.append([i])
    buf = io.BytesIO()
    wb.save(buf)
    b = admin.post(f"{API}/imports/file", files={"file": ("o.xlsx", buf.getvalue())}, data={"column": "order"}).json()
    assert b["new"] == 5
    assert admin.post(f"{API}/imports/file", files={"file": ("o.txt", b"a")}, data={"column": "a"}).status_code == 422


def test_ac3_pull_now_via_mock_lab_and_failure_does_not_stop_batch(admin):
    r = admin.post(f"{API}/imports/pull", json={"start": "2026-10-01", "end": "2026-10-02"})
    assert r.status_code == 201 and r.json()["new"] == 6 and r.json()["source"] == "api"
    admin.post(f"{API}/imports/manual", json={"text": "GOOD1 FAIL1 GOOD2"})
    run_worker()
    got = {o.order_id_external: o.status for o in orders()}
    assert got["GOOD1"] == got["GOOD2"] == status.FETCHED  # FAIL1 did not block them
    assert got["FAIL1"] == status.QUEUED  # scheduled for retry
    assert admin.post(f"{API}/imports/pull", json={"start": "2026-10-05", "end": "2026-10-01"}).status_code == 502


def test_ac4_retry_then_failed_with_reason_then_manual_retry(admin):
    admin.put(f"{API}/settings/fetch_max_attempts", json={"value": 2})
    admin.post(f"{API}/imports/manual", json={"text": "FAIL9"})
    run_worker()
    o = orders()[0]
    assert (o.status, o.attempts) == (status.QUEUED, 1) and (o.next_attempt_at if o.next_attempt_at.tzinfo else o.next_attempt_at.replace(tzinfo=timezone.utc)) > datetime.now(timezone.utc)
    with dbmod.SessionLocal() as db:  # make the backoff elapse
        db.get(Order, o.id).next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    run_worker()
    o = orders()[0]
    assert o.status == status.FAILED_FETCH and "not available" in o.error
    assert admin.post(f"{API}/orders/{o.id}/retry").json()["status"] == status.QUEUED
    assert admin.post(f"{API}/orders/{o.id}/retry").status_code == 409  # no longer failed
    assert admin.get(f"{API}/orders", params={"status_": "QUEUED"}).json()[0]["order_id"] == "FAIL9"


def test_fetched_report_is_stored_encrypted_and_readable(admin):
    admin.post(f"{API}/imports/manual", json={"text": "OK1"})
    run_worker()
    o = orders()[0]
    assert o.status == status.FETCHED and o.report_kind == "json" and o.lab == "mock"
    from app.config import env
    from pathlib import Path

    assert b"Glycosylated" not in (Path(env.storage_dir) / o.report_path).read_bytes()
    assert b"Glycosylated" in storage.load(o.report_path)


def test_stuck_fetching_orders_are_recovered(admin):
    admin.post(f"{API}/imports/manual", json={"text": "S1"})
    with dbmod.SessionLocal() as db:
        o = db.scalars(select(Order)).one()
        o.status, o.updated_at = status.FETCHING, datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
        worker.recover_stuck(db)
    assert orders()[0].status == status.QUEUED


def test_status_machine_rejects_illegal_moves():
    o = Order(status=status.QUEUED)
    with pytest.raises(ValueError):
        status.move(o, status.READY)
    status.move(o, status.FETCHING)
    status.move(o, status.FETCHED)
    assert o.status == status.FETCHED


def test_scheduler_pulls_once_per_day_after_configured_time():
    ist = worker.IST
    with dbmod.SessionLocal() as db:
        assert worker.maybe_scheduled_pull(db, datetime(2026, 10, 30, 6, 0, tzinfo=ist)) is False  # before 07:00
        assert worker.maybe_scheduled_pull(db, datetime(2026, 10, 30, 7, 5, tzinfo=ist)) is True
        assert worker.maybe_scheduled_pull(db, datetime(2026, 10, 30, 9, 0, tzinfo=ist)) is False  # already today
        assert worker.maybe_scheduled_pull(db, datetime(2026, 10, 31, 7, 5, tzinfo=ist)) is True  # next day
        assert db.scalars(select(AuditLog).where(AuditLog.action == "scheduled_pull")).all()
    assert len(orders()) > 0


def test_intake_is_admin_only(caller, doctor):
    for c in (caller, doctor):
        assert c.post(f"{API}/imports/manual", json={"text": "A1"}).status_code == 403
        assert c.get(f"{API}/orders").status_code == 403
        assert c.post(f"{API}/imports/pull", json={"start": "2026-10-01", "end": "2026-10-01"}).status_code == 403


def test_pull_time_must_be_hh_mm(admin):
    assert admin.put(f"{API}/settings/pull_time_ist", json={"value": "7am"}).status_code == 422
    assert admin.put(f"{API}/settings/pull_time_ist", json={"value": "06:30"}).status_code == 200
