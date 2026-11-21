import csv
import io
import re
from itertools import islice
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .labs import get_lab
from .models import ImportBatch, Order

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_/\-]{0,63}$")
MAX_ROWS = 5000
MAX_BYTES = 5 * 1024 * 1024


def split_ids(text: str) -> list[str]:
    return [t for t in re.split(r"[,\s;]+", text) if t]


def read_file(name: str, raw: bytes) -> tuple[list[str], list[list[str]]]:
    """Returns (headers, rows) for a .csv or .xlsx upload."""
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "File is larger than 5 MB")
    lower = name.lower()
    if lower.endswith(".csv"):
        rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig", errors="replace"))))
    elif lower.endswith(".xlsx"):
        from openpyxl import load_workbook

        try:
            ws = load_workbook(io.BytesIO(raw), read_only=True, data_only=True).active
            # stop early: a small zipped file can expand to millions of rows
            rows = [["" if c is None else str(c) for c in r] for r in islice(ws.iter_rows(values_only=True), MAX_ROWS * 2 + 2)]
        except Exception:
            raise HTTPException(422, "Could not read this XLSX file")
    else:
        raise HTTPException(422, "Only .csv and .xlsx files are supported")
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        raise HTTPException(422, "The file is empty")
    if len(rows) > MAX_ROWS + 1:
        raise HTTPException(422, f"More than {MAX_ROWS} rows; split the file")
    return [h.strip() for h in rows[0]], rows[1:]


def column_values(headers: list[str], rows: list[list[str]], column: str) -> list[str]:
    if column not in headers:
        raise HTTPException(422, f"Column '{column}' not found in the file")
    i = headers.index(column)
    return [r[i].strip() for r in rows if i < len(r) and r[i].strip()]


def create_batch(db: Session, source: str, values: list[str], user_id: int | None, file_name: str = "") -> ImportBatch:
    """Idempotent: an order ID already in the system (or repeated in this batch) is counted as
    duplicate, never inserted twice."""
    batch = ImportBatch(source=source, file_name=file_name, started_by=user_id, created_by=user_id, failures=[])
    db.add(batch)
    db.flush()
    values = [v.strip() for v in values if v.strip()]
    existing: set[str] = set()
    for i in range(0, len(values), 500):
        chunk = values[i : i + 500]
        existing.update(db.scalars(select(Order.order_id_external).where(Order.order_id_external.in_(chunk))))
    seen: set[str] = set()
    failures = []
    for v in values:
        if not ID_RE.match(v):
            failures.append({"value": v[:64], "reason": "Not a valid order ID"})
        elif v in existing or v in seen:
            batch.duplicate += 1
        else:
            seen.add(v)
            db.add(Order(order_id_external=v, batch_id=batch.id, created_by=user_id))
            batch.new += 1
    batch.total = len(values)
    batch.failed = len(failures)
    batch.failures = failures
    db.commit()
    return batch


def pull_now(db: Session, start: date, end: date, user_id: int | None) -> ImportBatch:
    """Raises LabError if the lab cannot list orders."""
    lab = get_lab()
    message = ""
    if hasattr(lab, "pull_details"):
        details = lab.pull_details(start, end)
        ids = details["orders"]
        message = details["message"]
    else:
        ids = lab.list_serviced_orders(start, end)
        message = f"{len(ids)} new report(s) pulled from LabTrace." if ids else "LabTrace has no ready reports for these dates."
    
    batch = create_batch(db, "api", ids, user_id, f"{start}..{end}")
    batch.message = message
    db.commit()
    return batch


def batch_out(b: ImportBatch) -> dict:
    return {"id": b.id, "source": b.source, "file_name": b.file_name, "total": b.total, "new": b.new,
            "duplicate": b.duplicate, "failed": b.failed, "failures": b.failures, "started_by": b.started_by,
            "created_at": b.created_at, "message": b.message}
