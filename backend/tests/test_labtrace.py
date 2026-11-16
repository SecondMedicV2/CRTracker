"""LabTrace adapter against a fake LabTrace (synthetic data only), the PDF reader and the scheduled pull."""
import base64
import json
from datetime import date, datetime

import httpx
import pytest
from sqlalchemy import select

from app import db as dbmod
from app import extract, storage, worker
from app.config import env
from app.labs import labtrace
from app.labs.base import LabError
from app.models import Followup, ImportBatch, Order, Patient, Report

API = "/api/v1"
REPORT_LINES = [
    "Thyrocare Technologies Ltd",
    "Name : SYNTHETIC PATIENT (45Y/M)",
    "Mobile : 9000011111",
    "Sample Collected on : 10 Nov 2026",
    "TEST NAME TECHNOLOGY VALUE UNITS REFERENCE RANGE",
    "Glycosylated Hemoglobin H.P.L.C 6.1 % < 5.7",
    "Haemoglobin PHOTOMETRY 14.5 g/dL 13.0-17.0",
    "TSH C.L.I.A 2.1 uIU/mL 0.4 - 4.2",
    "Page 1 of 2",
]


def make_pdf(lines: list[str]) -> bytes:
    esc = lambda s: s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = "BT /F1 10 Tf 40 800 Td 14 TL " + " ".join(f"({esc(l)}) Tj T*" for l in lines) + " ET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream"]
    out, offsets = b"%PDF-1.4\n", []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    return out + f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()


PDF = make_pdf(REPORT_LINES)
WORK_ORDERS = [
    {"id": "wo_1_ready", "order_number": "4821", "status": "report_ready", "patient_name": "Synthetic Patient",
     "patient_age": 45, "patient_age_unit": "Y", "patient_gender": "Male", "patient_phone": "+91 90000-11111",
     "sample_collection_datetime": "2026-11-10T07:30:00", "thyrocare_patient_id": None, "report_id": "r1"},
    {"id": "wo_2_proxy", "order_number": "4822", "status": "delivered", "patient_name": "Second Synthetic",
     "patient_age": 52, "patient_age_unit": "Y", "patient_gender": "Female", "patient_phone": "09000022222",
     "sample_collection_datetime": "2026-11-11 09:00:00", "thyrocare_patient_id": "TP99", "report_id": None},
    {"id": "wo_3_inlab", "order_number": "4823", "status": "in_lab", "patient_name": "Not Ready",
     "patient_age": 30, "patient_age_unit": "Y", "patient_gender": "Male", "patient_phone": "9000033333",
     "sample_collection_datetime": "2026-11-11T09:00:00", "report_id": None},
    {"id": "wo_4_old", "order_number": "4824", "status": "report_ready", "patient_name": "Too Old",
     "patient_age": 30, "patient_age_unit": "Y", "patient_gender": "Male", "patient_phone": "9000044444",
     "sample_collection_datetime": "2026-10-01T09:00:00", "report_id": "r4"},
]
REPORTS = {"wo_1_ready": [{"id": "r1", "work_order_id": "wo_1_ready", "uploaded_at": "2026-11-12T10:00:00",
                            "file_url": "data:application/pdf;base64," + base64.b64encode(PDF).decode()}],
           "wo_2_proxy": [], "wo_3_inlab": [], "wo_4_old": []}


class FakeLabTrace:
    def __init__(self, role="master_manager"):
        self.role, self.logins, self.expire_next = role, 0, False

    def __call__(self, req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path == "/api/auth/login":
            body = json.loads(req.content)
            if body != {"login_id": "master", "password": "pw"}:
                return httpx.Response(401, json={"error": "Invalid credentials."})
            self.logins += 1
            return httpx.Response(200, json={"ok": True, "role": self.role},
                                  headers={"set-cookie": f"session=tok{self.logins}; HttpOnly; Secure; SameSite=Strict; Path=/"})
        if req.headers.get("cookie") != f"session=tok{self.logins}" or self.expire_next:
            self.expire_next = False
            return httpx.Response(401, json={"error": "Invalid or expired session."})
        if path == "/api/work-orders":
            return httpx.Response(200, json=WORK_ORDERS)
        if path.startswith("/api/work-orders/"):
            wo = next((w for w in WORK_ORDERS if w["id"] == path.rsplit("/", 1)[1]), None)
            return httpx.Response(200, json=wo) if wo else httpx.Response(404, json={"error": "Not found"})
        if path == "/api/reports":
            return httpx.Response(200, json=REPORTS.get(req.url.params["workOrderId"], []))
        if path == "/api/thyrocare/reports/TP99/pdf":
            return httpx.Response(200, content=PDF, headers={"content-type": "application/pdf"})
        return httpx.Response(404, json={"error": "Report not ready"})


@pytest.fixture
def fake(monkeypatch):
    lab = FakeLabTrace()
    monkeypatch.setattr(labtrace, "_transport", httpx.MockTransport(lab))
    monkeypatch.setattr(env, "labtrace_url", "https://labtrace.test")
    monkeypatch.setattr(env, "labtrace_login_id", "master")
    monkeypatch.setattr(env, "labtrace_password", "pw")
    monkeypatch.setattr(env, "lab_provider", "labtrace")
    labtrace.reset_session()
    yield lab
    labtrace.reset_session()


def test_lists_only_ready_orders_in_the_date_range_with_one_login(fake):
    lab = labtrace.LabTraceLab()
    assert lab.list_serviced_orders(date(2026, 11, 9), date(2026, 11, 12)) == ["wo_1_ready", "wo_2_proxy"]
    assert lab.list_serviced_orders(date(2026, 9, 1), date(2026, 11, 12)) == ["wo_1_ready", "wo_2_proxy", "wo_4_old"]
    assert fake.logins == 1  # the session is reused


def test_fetch_uses_the_stored_pdf_and_the_booked_patient(fake):
    res = labtrace.LabTraceLab().fetch_report("wo_1_ready")
    assert res.pdf == PDF and res.ref == "4821"
    assert res.patient == {"name": "Synthetic Patient", "age": 45, "gender": "Male", "mobile": "9000011111"}
    assert res.collected_on.date() == date(2026, 11, 10)


def test_fetch_falls_back_to_the_thyrocare_proxy_route(fake):
    res = labtrace.LabTraceLab().fetch_report("wo_2_proxy")
    assert res.pdf == PDF and res.patient["mobile"] == "9000022222"


def test_report_not_ready_and_unknown_orders_are_lab_errors(fake):
    with pytest.raises(LabError, match="not ready"):
        labtrace.LabTraceLab().fetch_report("wo_3_inlab")
    with pytest.raises(LabError, match="not found"):
        labtrace.LabTraceLab().fetch_report("wo_missing")


def test_expired_session_signs_in_again(fake):
    labtrace.LabTraceLab().list_serviced_orders(date(2026, 11, 9), date(2026, 11, 12))
    fake.expire_next = True
    assert labtrace.LabTraceLab().list_serviced_orders(date(2026, 11, 9), date(2026, 11, 12))
    assert fake.logins == 2


def test_only_a_master_manager_login_is_accepted(fake, monkeypatch):
    fake.role = "manager"
    with pytest.raises(LabError, match="not a Master Manager"):
        labtrace.LabTraceLab().list_serviced_orders(date(2026, 11, 9), date(2026, 11, 12))
    monkeypatch.setattr(env, "labtrace_password", "wrong")
    with pytest.raises(LabError, match="refused"):
        labtrace.LabTraceLab().list_serviced_orders(date(2026, 11, 9), date(2026, 11, 12))
    monkeypatch.setattr(env, "labtrace_password", "")
    with pytest.raises(LabError, match="not configured"):
        labtrace.LabTraceLab().list_serviced_orders(date(2026, 11, 9), date(2026, 11, 12))


def test_mobile_numbers_are_normalised():
    assert [labtrace.indian_mobile(m) for m in ("+91 98765-43210", "09876543210", "919876543210", "9876543210")] == ["9876543210"] * 4


def test_pdf_reader_finds_results_and_skips_headers_and_identity():
    data = extract.pdf_to_data(PDF)
    assert [(p["name"], p["value"], p["unit"], p["ref_range"]) for p in data["parameters"]] == [
        ("Glycosylated Hemoglobin", "6.1", "%", "< 5.7"),
        ("Haemoglobin", "14.5", "g/dL", "13.0-17.0"),
        ("TSH", "2.1", "uIU/mL", "0.4 - 4.2"),
    ]


def test_scanned_or_broken_pdfs_are_extract_errors():
    with pytest.raises(extract.ExtractError):
        extract.pdf_to_data(b"%PDF-1.4 not really a pdf")
    with pytest.raises(extract.ExtractError, match="no readable text"):
        extract.pdf_to_data(make_pdf([]))


def test_redaction_removes_identity_before_any_ai_sees_it():
    text = "\n".join(REPORT_LINES + ["Report for Synthetic Patient, call 90000 11111 or x@y.com"])
    out = extract.redact(text, {"name": "Synthetic Patient"})
    assert "Synthetic" not in out and "9000011111" not in out and "90000 11111" not in out and "x@y.com" not in out
    assert "Glycosylated Hemoglobin H.P.L.C 6.1 % < 5.7" in out


def test_booking_details_win_over_the_report_text():
    assert extract.merge_patient({"name": "SYN P", "age": 44, "gender": "", "mobile": ""},
                                 {"name": "Synthetic Patient", "age": None, "gender": "Male", "mobile": "9000011111"}) == \
        {"name": "Synthetic Patient", "age": 44, "gender": "Male", "mobile": "9000011111"}


def test_pull_to_follow_up_end_to_end(fake, admin):
    b = admin.post(f"{API}/imports/pull", json={"start": "2026-11-09", "end": "2026-11-12"}).json()
    assert (b["new"], b["failed"]) == (2, 0)
    with dbmod.SessionLocal() as db:
        assert worker.tick(db) == 2
        assert worker.extract_tick(db) == 2
        orders = db.scalars(select(Order).order_by(Order.id)).all()
        assert [o.lab_ref for o in orders] == ["4821", "4822"]
        assert all(o.error == "" for o in orders), [o.error for o in orders]
        reports = db.scalars(select(Report).order_by(Report.id)).all()
        assert [(r.patient_name, r.age, r.gender) for r in reports] == [("Synthetic Patient", 45, "M"), ("Second Synthetic", 52, "F")]
        assert storage.decrypt_str(reports[0].mobile_enc) == "9000011111"
        assert db.scalars(select(Patient)).all() and db.scalars(select(Followup)).all()  # callers have someone to ring
        assert "9000011111" not in orders[0].patient_hint_enc  # stored encrypted
    listing = admin.get(f"{API}/imports").json()[0]
    assert listing["orders_count"] == 2
    assert listing["patients"][0]["lab_ref"] == "4821" and listing["patients"][0]["mobile"] == "9000011111"
    again = admin.post(f"{API}/imports/pull", json={"start": "2026-11-09", "end": "2026-11-12"}).json()
    assert (again["new"], again["duplicate"]) == (0, 2)


def test_pull_reports_labtrace_errors_without_patient_data(fake, admin, monkeypatch):
    monkeypatch.setattr(env, "labtrace_password", "wrong")
    r = admin.post(f"{API}/imports/pull", json={"start": "2026-11-09", "end": "2026-11-12"})
    assert r.status_code == 502 and "LabTrace" in r.json()["detail"]


def test_scheduler_can_repeat_during_the_day(fake):
    ist = worker.IST
    with dbmod.SessionLocal() as db:  # defaults: every 60 minutes, 7 days back
        assert worker.maybe_scheduled_pull(db, datetime(2026, 11, 12, 7, 0, tzinfo=ist)) is True
        assert worker.maybe_scheduled_pull(db, datetime(2026, 11, 12, 7, 30, tzinfo=ist)) is False
        assert worker.maybe_scheduled_pull(db, datetime(2026, 11, 12, 8, 1, tzinfo=ist)) is True
        assert len(db.scalars(select(Order)).all()) == 2  # the 10 and 11 Nov samples; 1 Oct is outside the 7 days
        assert len(db.scalars(select(ImportBatch)).all()) == 1  # the 08:01 pull found nothing new: no empty batch
