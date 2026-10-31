from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import pipeline, status, storage
from ..db import get_db
from ..models import Order, Report, ReportParameter, User
from ..security import audit, require

router = APIRouter(tags=["reports"])
clinical = require("ADMIN", "DOCTOR")  # callers never see results (Part 3.2, AC12)


def param_out(p: ReportParameter) -> dict:
    return {c: getattr(p, c) for c in ("id", "param_code", "param_name_raw", "value_num", "value_text", "unit", "ref_low",
                                       "ref_high", "ref_text", "lab_flag", "system_flag", "severity", "deviation_pct", "ref_source")}


def report_out(r: Report, o: Order) -> dict:
    return {"id": r.id, "order_id": o.order_id_external, "order_pk": o.id, "status": o.status, "patient_name": r.patient_name,
            "age": r.age, "gender": r.gender, "collected_on": r.collected_on, "reported_on": r.reported_on, "lab": r.lab_name,
            "confidence": r.extraction_confidence, "needs_review": r.needs_review, "review_reasons": r.review_reasons,
            "classification": r.classification}


@router.get("/reports")
def list_reports(status_: str | None = None, classification: str | None = None, limit: int = 200,
                 db: Session = Depends(get_db), _: User = Depends(clinical)):
    q = select(Report, Order).join(Order, Order.id == Report.order_id).order_by(Report.id.desc()).limit(min(limit, 500))
    if status_:
        q = q.where(Order.status == status_)
    if classification:
        q = q.where(Report.classification == classification)
    rows = db.execute(q).all()
    abnormal = dict(db.execute(select(ReportParameter.report_id, func.count()).where(
        ReportParameter.system_flag.in_(("LOW", "HIGH"))).group_by(ReportParameter.report_id)).all())
    return [{**report_out(r, o), "abnormal_count": abnormal.get(r.id, 0)} for r, o in rows]


def _get(db: Session, rid: int) -> tuple[Report, Order]:
    r = db.get(Report, rid)
    if not r:
        raise HTTPException(404, "No such report")
    return r, db.get(Order, r.order_id)


@router.get("/reports/{rid}")
def get_report(rid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    r, o = _get(db, rid)
    audit(db, request, me.id, "view", "report", rid)  # AC18: every patient-data view is logged
    params = db.scalars(select(ReportParameter).where(ReportParameter.report_id == rid).order_by(ReportParameter.id)).all()
    return {**report_out(r, o), "parameters": [param_out(p) for p in params]}


class ReportPatch(BaseModel):
    patient_name: str | None = None
    age: int | None = None
    gender: str | None = None
    mobile: str | None = None


class ParamPatch(BaseModel):
    param_code: str | None = None
    value: str | None = None
    unit: str | None = None
    ref_text: str | None = None


def _need_review(o: Order):
    if o.status != status.NEEDS_REVIEW:
        raise HTTPException(409, "Only reports waiting for review can be corrected")


@router.patch("/reports/{rid}")
def patch_report(rid: int, body: ReportPatch, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    r, o = _get(db, rid)
    _need_review(o)
    changed = []
    if body.gender is not None:
        g = body.gender.strip().upper()[:1]
        if g not in ("M", "F"):
            raise HTTPException(422, "Gender must be M or F")
        r.gender = g
        changed.append("gender")
    if body.age is not None:
        if not 0 <= body.age <= 120:
            raise HTTPException(422, "Age must be 0-120")
        r.age = body.age
        changed.append("age")
    if body.patient_name is not None:
        r.patient_name = body.patient_name.strip()[:120]
        changed.append("patient_name")
    if body.mobile is not None:
        r.mobile_enc = storage.encrypt_str(body.mobile.strip()) if body.mobile.strip() else ""
        changed.append("mobile")
    db.commit()
    audit(db, request, me.id, "correct", "report", f"{rid}:{','.join(changed)}")  # field names only, never values
    return report_out(r, o)


@router.patch("/reports/{rid}/parameters/{pid}")
def patch_parameter(rid: int, pid: int, body: ParamPatch, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    r, o = _get(db, rid)
    _need_review(o)
    p = db.get(ReportParameter, pid)
    if not p or p.report_id != rid:
        raise HTTPException(404, "No such parameter")
    from ..extract import parse_value
    from ..analysis import parse_range

    changed = []
    if body.value is not None:
        p.value_num, p.value_text = parse_value(body.value)
        changed.append("value")
    if body.unit is not None:
        p.unit = body.unit.strip()[:30]
        changed.append("unit")
    if body.param_code is not None:
        p.param_code = body.param_code.strip().upper()[:40]
        changed.append("param_code")
    if body.ref_text is not None:
        p.ref_text = body.ref_text.strip()[:60]
        rng = parse_range(p.ref_text)
        p.ref_low, p.ref_high = (rng[0], rng[1]) if rng else (None, None)
        changed.append("ref_text")
    db.commit()
    audit(db, request, me.id, "correct", "report_parameter", f"{pid}:{','.join(changed)}")
    return param_out(p)


@router.post("/reports/{rid}/approve")
def approve(rid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    r, o = _get(db, rid)
    _need_review(o)
    if r.gender not in ("M", "F") or r.age is None:
        raise HTTPException(422, "Gender and age are required before approving")
    pipeline.approve_review(db, o, r)
    audit(db, request, me.id, "approve_review", "report", rid)
    return report_out(r, o)
