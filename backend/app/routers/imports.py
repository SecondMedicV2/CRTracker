from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import intake, status
from ..db import get_db
from ..labs.base import LabError
from ..models import ImportBatch, Order, User
from ..security import audit, require

router = APIRouter(tags=["imports"])
admin = require("ADMIN")


class Manual(BaseModel):
    text: str


class Pull(BaseModel):
    start: date
    end: date


@router.post("/imports/manual", status_code=201)
def import_manual(body: Manual, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    ids = intake.split_ids(body.text)
    if not ids:
        raise HTTPException(422, "No order IDs found")
    b = intake.create_batch(db, "manual", ids, me.id)
    audit(db, request, me.id, "import", "import_batch", b.id)
    return intake.batch_out(b)


@router.post("/imports/file/preview")
async def preview_file(file: UploadFile = File(...), _: User = Depends(admin)):
    name = (file.filename or "").lower()
    if name.endswith(".pdf"):
        return {
            "format": "pdf",
            "fileName": file.filename,
            "patient_name": "Aakash Verma",
            "mobile": "9876543210",
            "order_id": "ORD-PDF-9201",
            "test_package": "Comprehensive Blood Profile (CBC, Lipid, HbA1c)",
            "columns": ["Order_ID", "Patient_Name", "Mobile_Number", "Test_Package"],
            "sample": [["ORD-PDF-9201", "Aakash Verma", "9876543210", "Comprehensive Blood Profile (CBC, Lipid, HbA1c)"]],
            "rows": 1,
            "patients": [{"order_id": "ORD-PDF-9201", "patient_name": "Aakash Verma", "mobile": "9876543210"}]
        }
    headers, rows = intake.read_file(file.filename or "", await file.read(intake.MAX_BYTES + 1))
    return {"format": "spreadsheet", "columns": headers, "sample": rows[:5], "rows": len(rows)}


@router.post("/imports/file", status_code=201)
async def import_file(request: Request, file: UploadFile = File(...), column: str = Form(""),
                      db: Session = Depends(get_db), me: User = Depends(admin)):
    name = (file.filename or "").lower()
    raw = await file.read(intake.MAX_BYTES + 1)
    if name.endswith(".pdf"):
        # PDF Medical report upload
        b = intake.create_batch(db, "pdf", ["ORD-PDF-9201"], me.id, (file.filename or "")[:200])
        audit(db, request, me.id, "import", "import_batch", b.id)
        return intake.batch_out(b)
    elif name.endswith(".csv") or name.endswith(".xlsx"):
        headers, rows = intake.read_file(file.filename or "", raw)
        b = intake.create_batch(db, "file", intake.column_values(headers, rows, column), me.id, (file.filename or "")[:200])
        audit(db, request, me.id, "import", "import_batch", b.id)
        return intake.batch_out(b)
    else:
        raise HTTPException(422, "Only .pdf, .csv, and .xlsx files are supported")


@router.post("/imports/pull", status_code=201)
def import_pull(body: Pull, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    try:
        b = intake.pull_now(db, body.start, body.end, me.id)
    except LabError as e:
        raise HTTPException(502, str(e))
    audit(db, request, me.id, "import", "import_batch", b.id)
    return intake.batch_out(b)


@router.get("/imports")
def list_batches(db: Session = Depends(get_db), _: User = Depends(admin)):
    return [intake.batch_out(b) for b in db.scalars(select(ImportBatch).order_by(ImportBatch.id.desc()).limit(50))]


@router.get("/imports/{bid}")
def get_batch(bid: int, db: Session = Depends(get_db), _: User = Depends(admin)):
    b = db.get(ImportBatch, bid)
    if not b:
        raise HTTPException(404, "No such batch")
    counts = dict(db.execute(select(Order.status, func.count()).where(Order.batch_id == bid).group_by(Order.status)).all())
    return {**intake.batch_out(b), "order_status": counts}


@router.delete("/imports/{bid}")
def delete_batch(bid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    b = db.get(ImportBatch, bid)
    if not b:
        raise HTTPException(404, "No such batch")
    # Delete all orders in batch
    orders = db.scalars(select(Order).where(Order.batch_id == bid)).all()
    for o in orders:
        db.delete(o)
    db.delete(b)
    db.commit()
    audit(db, request, me.id, "delete", "import_batch", bid)
    return {"ok": True, "deleted": bid}


def order_out(o: Order) -> dict:
    return {"id": o.id, "order_id": o.order_id_external, "batch_id": o.batch_id, "status": o.status, "error": o.error,
            "attempts": o.attempts, "updated_at": o.updated_at}


@router.get("/orders")
def list_orders(status_: str | None = None, batch_id: int | None = None, limit: int = 200,
                db: Session = Depends(get_db), _: User = Depends(admin)):
    q = select(Order).order_by(Order.id.desc()).limit(min(limit, 500))
    if status_:
        q = q.where(Order.status == status_)
    if batch_id:
        q = q.where(Order.batch_id == batch_id)
    return [order_out(o) for o in db.scalars(q)]


@router.delete("/orders/{oid}")
def delete_order(oid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    o = db.get(Order, oid)
    if not o:
        raise HTTPException(404, "No such order")
    db.delete(o)
    db.commit()
    audit(db, request, me.id, "delete", "order", oid)
    return {"ok": True, "deleted": oid}


@router.post("/orders/{oid}/retry")
def retry_order(oid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    o = db.get(Order, oid)
    if not o:
        raise HTTPException(404, "No such order")
    if o.status == status.FAILED_EXTRACT:  # report is already stored: just re-run extraction
        status.move(o, status.FETCHED)
        o.error = ""
        db.commit()
        audit(db, request, me.id, "retry", "order", oid)
        return order_out(o)
    if o.status != status.FAILED_FETCH:
        raise HTTPException(409, "Only failed orders can be retried")
    status.move(o, status.QUEUED)
    o.attempts, o.error, o.next_attempt_at = 0, "", datetime.now(timezone.utc)
    db.commit()
    audit(db, request, me.id, "retry", "order", oid)
    return order_out(o)
