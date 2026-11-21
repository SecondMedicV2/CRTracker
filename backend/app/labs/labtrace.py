"""LabTrace (Thyrocare - SecondMedic OS, https://thyrocare.secondmedic.workers.dev) as a lab source.

LabTrace books Thyrocare tests and receives their report PDFs. We sign in as its Master Manager, which sees every
Manager's work orders, and read three of its existing routes:

    POST /api/auth/login               -> `session` cookie (12 h JWT)
    GET  /api/work-orders[/:id]        -> patient name, age, gender, phone, status, Thyrocare patient id
    GET  /api/reports?workOrderId=:id  -> the stored report: an uploaded PDF (data: URL) or a LabTrace path that
                                          streams the signed Thyrocare PDF (/api/thyrocare/reports/:pid/pdf)

Error messages never include anything LabTrace sent back, since that can carry patient data."""
import base64
import re
import threading
import time
from datetime import date, datetime, timezone
from urllib.parse import quote

import httpx

from ..config import env
from .base import FetchResult, LabError, LabProvider

READY_STATUSES = {"report_ready", "delivered"}
ORDER_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,63}$")
MAX_PDF_BYTES = 20 * 1024 * 1024
SESSION_SECONDS = 11 * 3600  # LabTrace sessions last 12 h; renew a little early

_transport: httpx.BaseTransport | None = None  # tests swap in an httpx.MockTransport
_session = {"cookie": "", "until": 0.0}
_lock = threading.Lock()


def _client() -> httpx.Client:
    if not env.labtrace_login_id or not env.labtrace_password:
        raise LabError("LabTrace is not configured: set LABTRACE_LOGIN_ID and LABTRACE_PASSWORD")
    return httpx.Client(base_url=env.labtrace_url.rstrip("/"), timeout=60, transport=_transport, follow_redirects=False)


def _login(c: httpx.Client) -> str:
    try:
        r = c.post("/api/auth/login", json={"login_id": env.labtrace_login_id, "password": env.labtrace_password})
    except httpx.HTTPError as e:
        raise LabError(f"Cannot reach LabTrace ({type(e).__name__})")
    if r.status_code in (400, 401, 403):
        raise LabError("LabTrace refused the Master Manager login: check LABTRACE_LOGIN_ID / LABTRACE_PASSWORD")
    if r.status_code != 200:
        raise LabError(f"LabTrace login failed (HTTP {r.status_code})")
    if (r.json() or {}).get("role") != "master_manager":
        raise LabError("The LabTrace account is not a Master Manager, so it cannot see every Manager's orders")
    for header in r.headers.get_list("set-cookie"):
        if m := re.match(r"\s*session=([^;]+)", header):
            return m.group(1)
    raise LabError("LabTrace login returned no session")


def _get(c: httpx.Client, path: str, **params) -> httpx.Response:
    """GET with the shared Master Manager session; signs in again once if LabTrace says it expired."""
    for attempt in (1, 2):
        with _lock:
            if attempt == 2 or not _session["cookie"] or time.time() > _session["until"]:
                _session["cookie"], _session["until"] = _login(c), time.time() + SESSION_SECONDS
            cookie = _session["cookie"]
        try:
            r = c.get(path, params=params or None, headers={"Cookie": f"session={cookie}"})
        except httpx.HTTPError as e:
            raise LabError(f"Cannot reach LabTrace ({type(e).__name__})")
        if r.status_code != 401:
            return r
    raise LabError("LabTrace keeps rejecting the Master Manager session")


def _json(r: httpx.Response, what: str):
    if r.status_code == 404:
        raise LabError(f"{what} not found in LabTrace")
    if r.status_code != 200:
        raise LabError(f"LabTrace could not return {what.lower()} (HTTP {r.status_code})")
    try:
        return r.json()
    except ValueError:
        raise LabError(f"LabTrace sent an unreadable answer for {what.lower()}")


def _day(value) -> date | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")[:19].replace(" ", "T")).date()
    except (TypeError, ValueError):
        return None


def _when(value) -> datetime | None:
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00").replace(" ", "T"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def indian_mobile(raw) -> str:
    """'+91 98765-43210' / '09876543210' / '919876543210' -> '9876543210'. Anything else is returned as digits."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits


def patient_of(wo: dict) -> dict:
    age = wo.get("patient_age")
    if wo.get("patient_age_unit") == "M" and age is not None:
        age = 0  # infants: LabTrace stores months
    return {"name": str(wo.get("patient_name") or "").strip(), "age": age, "gender": wo.get("patient_gender") or "",
            "mobile": indian_mobile(wo.get("patient_phone"))}


def _pdf(raw: bytes) -> bytes | None:
    return raw if raw.startswith(b"%PDF") and len(raw) <= MAX_PDF_BYTES else None


class LabTraceLab(LabProvider):
    name = "labtrace"

    def pull_details(self, start: date, end: date) -> dict:
        if end < start:
            raise LabError("End date is before start date")
        with _client() as c:
            rows = _json(_get(c, "/api/work-orders"), "Work orders")
        
        if isinstance(rows, list):
            work_orders = rows
        elif isinstance(rows, dict):
            work_orders = rows.get("data") or rows.get("work_orders") or rows.get("items") or rows.get("results")
            if not isinstance(work_orders, list):
                raise LabError("LabTrace sent work orders in an unexpected format.")
        else:
            raise LabError("LabTrace sent work orders in an unexpected format.")

        fetched = len(work_orders)
        not_ready = 0
        out_of_range = 0
        no_date = 0
        status_counts = {}
        orders = []

        for wo in work_orders:
            st = str(wo.get("status") or "").lower()
            if st:
                status_counts[st] = status_counts.get(st, 0) + 1
            
            is_ready = st in READY_STATUSES or bool(wo.get("report_id"))
            if not is_ready:
                not_ready += 1
                continue

            day = _day(wo.get("sample_collection_datetime")) or _day(wo.get("created_at"))
            if not day:
                no_date += 1
                continue
            
            if not (start <= day <= end):
                out_of_range += 1
                continue

            if ORDER_ID_RE.match(str(wo.get("id") or "")):
                orders.append(wo["id"])

        status_str = ", ".join(f"{k} {v}" for k, v in status_counts.items()) if status_counts else "none"
        if not orders:
            parts = [f"LabTrace returned {fetched} work order{'s' if fetched != 1 else ''}"]
            if not_ready:
                parts.append(f"{not_ready} not ready (statuses: {status_str})")
            if out_of_range:
                parts.append(f"{out_of_range} ready but collected outside {start.strftime('%d %b')} – {end.strftime('%d %b %Y')}")
            if no_date:
                parts.append(f"{no_date} with no collection date")
            message = ": ".join(parts[:1]) + ("" if len(parts) == 1 else " (" + "; ".join(parts[1:]) + ").")
            if fetched == 0:
                message = "LabTrace has no ready reports for these dates."
        else:
            message = f"{len(orders)} new report(s) pulled from LabTrace."

        return {
            "orders": orders,
            "fetched": fetched,
            "not_ready": not_ready,
            "out_of_range": out_of_range,
            "no_date": no_date,
            "status_counts": status_counts,
            "message": message
        }

    def list_serviced_orders(self, start: date, end: date) -> list[str]:
        """Work orders whose report is ready and whose sample was collected between start and end (inclusive)."""
        return self.pull_details(start, end)["orders"]

    def fetch_report(self, order_id: str) -> FetchResult:
        if not ORDER_ID_RE.match(order_id):
            raise LabError("Not a LabTrace work order id")
        with _client() as c:
            wo = _json(_get(c, f"/api/work-orders/{order_id}"), "Work order")
            reports = _json(_get(c, "/api/reports", workOrderId=order_id), "Report list")
            pdf, reported = self._report_pdf(c, wo, reports if isinstance(reports, list) else [])
        return FetchResult(pdf=pdf, patient=patient_of(wo), ref=str(wo.get("order_number") or "")[:64],
                           collected_on=_when(wo.get("sample_collection_datetime")), reported_on=reported)

    def _report_pdf(self, c: httpx.Client, wo: dict, reports: list[dict]) -> tuple[bytes, datetime | None]:
        for rep in sorted(reports, key=lambda r: str(r.get("uploaded_at") or ""), reverse=True):
            for url in (rep.get("pdf_url"), rep.get("file_url")):
                url = str(url or "")
                raw = None
                if url.startswith("data:application/pdf;base64,"):
                    try:
                        raw = base64.b64decode(url.split(",", 1)[1], validate=False)
                    except ValueError:
                        raw = None
                elif url.startswith("/api/"):  # LabTrace's own route; never follow links to other hosts
                    r = _get(c, url)
                    raw = r.content if r.status_code == 200 else None
                if raw and (pdf := _pdf(raw)):
                    return pdf, _when(rep.get("uploaded_at"))
        if pid := str(wo.get("thyrocare_patient_id") or "").strip():
            r = _get(c, f"/api/thyrocare/reports/{quote(pid, safe='')}/pdf")
            if r.status_code == 200 and (pdf := _pdf(r.content)):
                return pdf, None
            if r.status_code not in (200, 404):
                raise LabError(f"LabTrace could not download the Thyrocare report (HTTP {r.status_code})")
        raise LabError("The report is not ready in LabTrace yet")


def reset_session() -> None:
    with _lock:
        _session["cookie"], _session["until"] = "", 0.0
