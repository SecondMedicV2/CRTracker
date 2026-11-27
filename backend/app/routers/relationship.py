"""Relationship loop & care touchpoints router (Page 1)."""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import select

from .. import relationship as rel, storage
from ..relationship_scorecard import compute_relationship_scorecard
from ..db import get_db
from ..models import CareTouchpoint, Patient, User, ExpressNode, CorporateClient
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


@router.get("/relationship/scorecard")
def get_scorecard(from_date: date | None = None, to_date: date | None = None, hub_id: int | None = None,
                  node_id: int | None = None, corporate_id: int | None = None,
                  request: Request = None, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    audit(db, request, me.id, "view", "relationship_scorecard")
    return compute_relationship_scorecard(db, from_date=from_date, to_date=to_date, hub_id=hub_id, node_id=node_id, corporate_id=corporate_id)


class ExpressNodeIn(BaseModel):
    name: str = Field(max_length=120)
    code: str = Field(max_length=60)
    node_type: str = Field("PHARMACY", max_length=30)
    city: str = Field("", max_length=80)
    health_hub_id: int | None = None
    active: bool = True


@router.get("/express-nodes")
def list_express_nodes(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    return db.scalars(select(ExpressNode)).all()


@router.post("/express-nodes", status_code=201)
def create_express_node(body: ExpressNodeIn, request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    node = ExpressNode(
        name=body.name, code=body.code, node_type=body.node_type, city=body.city,
        health_hub_id=body.health_hub_id, active=body.active, created_by=me.id
    )
    db.add(node)
    db.commit()
    audit(db, request, me.id, "create", "express_node", node.id)
    return node


@router.patch("/express-nodes/{node_id}")
def update_express_node(node_id: int, body: ExpressNodeIn, request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    node = db.get(ExpressNode, node_id)
    if not node:
        raise HTTPException(404, "Express node not found")
    node.name = body.name
    node.code = body.code
    node.node_type = body.node_type
    node.city = body.city
    node.health_hub_id = body.health_hub_id
    node.active = body.active
    db.commit()
    audit(db, request, me.id, "update", "express_node", node.id)
    return node


class CorporateClientIn(BaseModel):
    name: str = Field(max_length=120)
    code: str = Field(max_length=60)
    contract_start: date | None = None
    contract_end: date | None = None
    pricing_model: str = Field("PEPM", max_length=20)
    pepm_inr: int = 0
    covered_members: int = 0
    contact: str = Field("", max_length=200)
    active: bool = True


@router.get("/corporate-clients")
def list_corporate_clients(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    clients = db.scalars(select(CorporateClient)).all()
    out = []
    for c in clients:
        d = {
            "id": c.id, "name": c.name, "code": c.code, "contract_start": c.contract_start,
            "contract_end": c.contract_end, "pricing_model": c.pricing_model, "pepm_inr": c.pepm_inr,
            "covered_members": c.covered_members, "active": c.active
        }
        try:
            d["contact"] = storage.decrypt_str(c.contact_enc) if c.contact_enc else ""
        except Exception:
            d["contact"] = ""
        out.append(d)
    return out


@router.post("/corporate-clients", status_code=201)
def create_corporate_client(body: CorporateClientIn, request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    c = CorporateClient(
        name=body.name, code=body.code, contract_start=body.contract_start, contract_end=body.contract_end,
        pricing_model=body.pricing_model, pepm_inr=body.pepm_inr, covered_members=body.covered_members,
        contact_enc=storage.encrypt_str(body.contact) if body.contact else "", active=body.active, created_by=me.id
    )
    db.add(c)
    db.commit()
    audit(db, request, me.id, "create", "corporate_client", c.id)
    return c


@router.patch("/corporate-clients/{client_id}")
def update_corporate_client(client_id: int, body: CorporateClientIn, request: Request, db: Session = Depends(get_db), me: User = Depends(admin_only)):
    c = db.get(CorporateClient, client_id)
    if not c:
        raise HTTPException(404, "Corporate client not found")
    c.name = body.name
    c.code = body.code
    c.contract_start = body.contract_start
    c.contract_end = body.contract_end
    c.pricing_model = body.pricing_model
    c.pepm_inr = body.pepm_inr
    c.covered_members = body.covered_members
    c.contact_enc = storage.encrypt_str(body.contact) if body.contact else ""
    c.active = body.active
    db.commit()
    audit(db, request, me.id, "update", "corporate_client", c.id)
    return c
