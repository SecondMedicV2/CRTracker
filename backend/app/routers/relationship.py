"""Relationship loop & care touchpoints router (Page 1)."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import relationship as rel
from ..db import get_db
from ..models import CareTouchpoint, Patient, User
from ..security import audit, current_user, require
from ..settings_store import get_setting
from ..timeutil import today_ist
from .patients import mobile_out

router = APIRouter(tags=["relationship"])
clinical = require("ADMIN", "DOCTOR")
admin_only = require("ADMIN")


def _patient(db: Session, pid: int) -> Patient:
    p = db.get(Patient, pid)
    if not p:
        raise HTTPException(404, "No such patient")
    root = rel.canonical_patient_id(db, pid)
    return db.get(Patient, root) if root != pid else p


def _tp_out(t: CareTouchpoint, role: str) -> dict:
    out = {
        "id": t.id, "patient_id": t.patient_id, "stage": t.stage, "service_code": t.service_code,
        "occurred_on": t.occurred_on, "source": t.source, "health_hub_id": t.health_hub_id, "created_at": t.created_at,
    }
    if role == "ADMIN":
        out["amount_inr"] = t.amount_inr
    return out


@router.get("/patients/{pid}/relationship")
def get_relationship(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(current_user)):
    p = _patient(db, pid)
    data = rel.build_patient_relationship(db, p.id)
    audit(db, request, me.id, "view", "relationship", p.id)
    if me.role == "CALLER":
        step = data["next_step"]
        return {
            "patient_id": p.id,
            "patient_name": p.name,
            "mobile": mobile_out(p, me),
            "status": data["status"],
            "last_touchpoint_on": data["last_touchpoint_on"],
            "next_step": {"caller_label": step["caller_label"]} if step else None,
        }
    services = [
        {"code": s["code"], "name": s["name"], "stage": s["stage"], **({"default_amount_inr": s.get("default_amount_inr")} if me.role == "ADMIN" else {})}
        for s in get_setting(db, "care_services") if isinstance(s, dict) and s.get("code")
    ]
    out = {
        "patient_id": p.id,
        "status": data["status"],
        "last_touchpoint_on": data["last_touchpoint_on"],
        "next_step": data["next_step"],
        "stages": data["stages"],
        "touchpoints": [_tp_out(t, me.role) for t in data["touchpoints"]],
        "services": services,
    }
    if me.role == "ADMIN":
        out["total_amount_inr"] = sum(t.amount_inr or 0 for t in data["touchpoints"])
    return out


class TouchpointIn(BaseModel):
    service_code: str = Field(max_length=60)
    occurred_on: date | None = None
    amount_inr: int | None = None
    health_hub_id: int | None = None


@router.post("/patients/{pid}/touchpoints", status_code=201)
def add_touchpoint(pid: int, body: TouchpointIn, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    services = {s["code"]: s for s in get_setting(db, "care_services") if isinstance(s, dict) and "code" in s}
    svc = services.get(body.service_code.strip().upper())
    if not svc or svc.get("stage") not in rel.STAGES:
        raise HTTPException(422, "Unknown service_code")
    amt = body.amount_inr if (me.role == "ADMIN" and body.amount_inr is not None) else svc.get("default_amount_inr")
    if amt is not None and amt < 0:
        raise HTTPException(422, "amount_inr must be non-negative")
    tp = CareTouchpoint(
        patient_id=p.id,
        stage=svc["stage"],
        service_code=svc["code"],
        occurred_on=body.occurred_on or today_ist(),
        source="MANUAL",
        ref_entity="manual",
        ref_id=None,
        amount_inr=amt,
        health_hub_id=body.health_hub_id,
        created_by=me.id,
    )
    db.add(tp)
    db.commit()
    audit(db, request, me.id, "create", "touchpoint", tp.id)
    return _tp_out(tp, me.role)


@router.delete("/touchpoints/{tid}")
def delete_touchpoint(tid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    tp = db.get(CareTouchpoint, tid)
    if not tp:
        raise HTTPException(404, "No such touchpoint")
    if tp.source != "MANUAL":
        raise HTTPException(409, "Only manual touchpoints can be deleted")
    db.delete(tp)
    db.commit()
    audit(db, request, me.id, "delete", "touchpoint", tid)
    return {"ok": True}


@router.get("/relationship/summary")
def get_summary(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    return rel.relationship_summary(db)
