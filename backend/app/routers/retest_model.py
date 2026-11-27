"""Clinically approved 7-step retest plans, Health Hubs, bundles, explanations, and KPIs (Page 12)."""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import followup as fu_svc, retest_model as rm
from ..analysis import load_rules
from ..db import get_db
from ..models import Followup, HealthHub, RetestRecommendation, User
from ..security import audit, current_user, require
from .insights import _csv

router = APIRouter(tags=["retest-model"])
admin = require("ADMIN")
clinical = require("ADMIN", "DOCTOR")
doctor_only = require("DOCTOR")


class HubIn(BaseModel):
    name: str = Field(max_length=120)
    city: str = Field("", max_length=80)
    address: str = Field("", max_length=300)
    active: bool = True
    opening_hours: str = Field("07:00-19:00", max_length=120)


class HubPatch(BaseModel):
    name: str | None = Field(None, max_length=120)
    city: str | None = Field(None, max_length=80)
    address: str | None = Field(None, max_length=300)
    active: bool | None = None
    opening_hours: str | None = Field(None, max_length=120)


def _hub_out(h: HealthHub) -> dict:
    return {"id": h.id, "name": h.name, "city": h.city, "address": h.address, "active": h.active, "opening_hours": h.opening_hours}


@router.get("/health-hubs")
def list_hubs(include_inactive: bool = False, db: Session = Depends(get_db), me: User = Depends(current_user)):
    q = select(HealthHub).order_by(HealthHub.city, HealthHub.name, HealthHub.id)
    if not (include_inactive and me.role == "ADMIN"):
        q = q.where(HealthHub.active.is_(True))
    return [_hub_out(h) for h in db.scalars(q)]


@router.post("/health-hubs", status_code=201)
def create_hub(body: HubIn, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    h = HealthHub(name=body.name.strip(), city=body.city.strip(), address=body.address.strip(),
                  active=body.active, opening_hours=body.opening_hours.strip(), created_by=me.id)
    db.add(h)
    db.commit()
    audit(db, request, me.id, "create", "health_hub", h.id)
    return _hub_out(h)


@router.patch("/health-hubs/{hid}")
def update_hub(hid: int, body: HubPatch, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    h = db.get(HealthHub, hid)
    if not h:
        raise HTTPException(404, "No such health hub")
    for field in ("name", "city", "address", "active", "opening_hours"):
        v = getattr(body, field)
        if v is not None:
            setattr(h, field, v.strip() if isinstance(v, str) else v)
    db.commit()
    audit(db, request, me.id, "update", "health_hub", hid)
    return _hub_out(h)


@router.get("/followups/{fid}/retest-plan")
def get_followup_retest_plan(fid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(current_user)):
    fu = db.get(Followup, fid)
    if not fu:
        raise HTTPException(404, "No such follow-up")
    plan = db.scalar(select(RetestRecommendation).where(RetestRecommendation.followup_id == fid).order_by(RetestRecommendation.id.desc()))
    if not plan:
        w_s = fu.retest_window_start or fu.next_followup_on or fu.due_on
        w_e = fu.retest_window_end or w_s
        return {
            "id": None,
            "followup_id": fid,
            "label": "Follow-up test" if me.role == "CALLER" else None,
            "approved": False,
            "next_test_date": w_s,
            "window_start": w_s,
            "window_end": w_e,
            "booking_status": "NOT_BOOKED",
            "plan_status": "PLANNED",
            "steps": [],
        }
    out = rm.plan_out(db, plan, fu, role=me.role)
    db.commit()
    audit(db, request, me.id, "view", "retest_plan", plan.id)
    return out


@router.post("/retest-recommendations/{rid}/approve")
def approve_retest_plan(rid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(doctor_only)):
    plan = db.get(RetestRecommendation, rid)
    if not plan:
        raise HTTPException(404, "No such retest plan")
    fu = db.get(Followup, plan.followup_id)
    rm.approve_plan(db, plan, me.id)
    db.commit()
    audit(db, request, me.id, "approve", "retest_plan", rid)
    return rm.plan_out(db, plan, fu, role=me.role)


class BookIn(BaseModel):
    collection_mode: str = Field(max_length=20)
    health_hub_id: int | None = None
    slot_start: datetime | None = None
    address: str = Field("", max_length=300)
    booking_status: str = Field("BOOKED", max_length=20)
    lab_order_ref: str = Field("", max_length=64)


@router.post("/retest-recommendations/{rid}/book")
def book_retest_plan(rid: int, body: BookIn, request: Request, db: Session = Depends(get_db), me: User = Depends(current_user)):
    plan = db.get(RetestRecommendation, rid)
    if not plan:
        raise HTTPException(404, "No such retest plan")
    fu = db.get(Followup, plan.followup_id)
    try:
        rm.book_plan(
            db, plan, collection_mode=body.collection_mode, health_hub_id=body.health_hub_id,
            slot_start=body.slot_start, address=body.address, booking_status=body.booking_status,
            lab_order_ref=body.lab_order_ref,
        )
    except PermissionError as err:
        raise HTTPException(409, str(err))
    except LookupError as err:
        raise HTTPException(404, str(err))
    except ValueError as err:
        raise HTTPException(422, str(err))
    db.commit()
    # Audit booking id + mode only, never address or test names
    audit(db, request, me.id, "book", "retest_plan", f"{rid}:{plan.collection_mode}:{plan.booking_status}")
    return rm.plan_out(db, plan, fu, role=me.role)


@router.get("/retest-recommendations/{rid}/explain")
def explain_retest_plan(rid: int, request: Request, lang: str = "en", db: Session = Depends(get_db), me: User = Depends(clinical)):
    plan = db.get(RetestRecommendation, rid)
    if not plan:
        raise HTTPException(404, "No such retest plan")
    fu = db.get(Followup, plan.followup_id)
    out = rm.explain_plan(db, plan, fu, lang=lang)
    db.commit()
    audit(db, request, me.id, "explain", "retest_plan", f"{rid}:{out['language']}")
    return out


@router.post("/followups/{fid}/bundles/{bundle_code}/accept")
def accept_protocol_bundle(fid: int, bundle_code: str, request: Request, db: Session = Depends(get_db), me: User = Depends(doctor_only)):
    fu = db.get(Followup, fid)
    if not fu:
        raise HTTPException(404, "No such follow-up")
    try:
        res = rm.accept_bundle(db, fu, bundle_code, me.id)
    except LookupError as err:
        raise HTTPException(404, str(err))
    db.commit()
    audit(db, request, me.id, "accept_bundle", "followup", f"{fid}:{res['bundle_code']}")
    plan = db.get(RetestRecommendation, res["plan_id"])
    return {**res, "plan": rm.plan_out(db, plan, fu, role=me.role)}


@router.get("/kpis/retesting")
def kpis_retesting(
    frm: date | None = Query(None, alias="from"),
    to: date | None = None,
    hub: int | None = None,
    protocol: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(admin),
):
    return rm.compute_kpis(db, frm=frm, to=to, hub_id=hub, protocol=protocol)


@router.get("/kpis/retesting.csv")
def kpis_retesting_csv(
    request: Request,
    frm: date | None = Query(None, alias="from"),
    to: date | None = None,
    hub: int | None = None,
    protocol: str | None = None,
    db: Session = Depends(get_db),
    me: User = Depends(admin),
):
    data = rm.compute_kpis(db, frm=frm, to=to, hub_id=hub, protocol=protocol)
    audit(db, request, me.id, "export", "retesting_kpis", f"{data['from']}:{data['to']}")
    rows = [
        [k["name"], k["numerator"], k["denominator"], k["display"], k["unit"], k["trend"], k["definition"], k["business_significance"]]
        for k in data["kpis"]
    ]
    return _csv(
        f"retesting-kpis-{data['from']}-to-{data['to']}.csv",
        ["KPI", "Numerator", "Denominator", "Value", "Unit", "Trend", "Definition", "Business significance"],
        rows,
    )
