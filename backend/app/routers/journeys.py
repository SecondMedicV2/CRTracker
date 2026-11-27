"""API routes for Page 8 Care Journeys (Day 0 -> Day 92), Check-ins, and Outbound Message Log."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import journeys as jsvc, relationship as rel
from ..db import get_db
from ..models import CareJourney, Followup, OutboundMessage, Patient, User
from ..security import audit, current_user, require

router = APIRouter(tags=["journeys"])
admin = require("ADMIN")
clinical = require("ADMIN", "DOCTOR")


def _fu(db: Session, fid: int) -> Followup:
    f = db.get(Followup, fid)
    if not f:
        raise HTTPException(404, "No such follow-up")
    return f


@router.get("/followups/{fid}/journey")
def get_followup_journey(fid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(current_user)):
    f = _fu(db, fid)
    j = db.scalar(select(CareJourney).where(CareJourney.followup_id == fid).order_by(CareJourney.id.desc()))
    if not j:
        j = jsvc.start_or_sync_journey(db, f)
    else:
        jsvc.sync_journey_events(db, followup_id=fid)
    db.commit()
    audit(db, request, me.id, "view", "care_journey", fid)
    if not j:
        return {"id": None, "followup_id": fid, "status": "NONE", "steps": []}
    return jsvc.journey_out(db, j, role=me.role)


@router.get("/patients/{pid}/journeys")
def list_patient_journeys(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = db.get(Patient, pid)
    if not p or p.merged_into_id:
        raise HTTPException(404, "No such patient")
    root_pid = rel.canonical_patient_id(db, p.id)
    pids = [root_pid, *db.scalars(select(Patient.id).where(Patient.merged_into_id == root_pid))]
    jsvc.sync_journey_events(db, patient_id=root_pid)
    rows = list(db.scalars(select(CareJourney).where(CareJourney.patient_id.in_(pids)).order_by(CareJourney.id.desc())))
    db.commit()
    audit(db, request, me.id, "view", "patient_journeys", root_pid)
    return {"patient_id": root_pid, "journeys": [jsvc.journey_out(db, j, role=me.role) for j in rows]}


class CheckinIn(BaseModel):
    step_code: str = Field("", max_length=40)
    adherence_code: str = Field("", max_length=20)
    symptom_code: str = Field("", max_length=20)


@router.post("/followups/{fid}/journey/checkin")
def post_journey_checkin(fid: int, body: CheckinIn, request: Request, db: Session = Depends(get_db), me: User = Depends(current_user)):
    f = _fu(db, fid)
    try:
        res = jsvc.record_checkin(
            db, f,
            step_code=body.step_code or None,
            adherence_code=body.adherence_code,
            symptom_code=body.symptom_code,
            user_id=me.id, role=me.role,
        )
    except ValueError as err:
        raise HTTPException(422, str(err))
    db.commit()
    # Audit only numeric followup id & structured status codes, never PII or free text.
    audit(db, request, me.id, "checkin", "care_journey", f"{fid}:{res['adherence_code']}:{res['symptom_code']}")
    return res


@router.get("/outbound-messages")
def list_outbound_messages(
    request: Request,
    patient_id: int | None = Query(None),
    limit: int = Query(200, le=500),
    db: Session = Depends(get_db),
    me: User = Depends(admin),
):
    q = select(OutboundMessage, Patient.name).join(Patient, Patient.id == OutboundMessage.patient_id)
    if patient_id is not None:
        root_pid = rel.canonical_patient_id(db, patient_id)
        pids = [root_pid, *db.scalars(select(Patient.id).where(Patient.merged_into_id == root_pid))]
        q = q.where(OutboundMessage.patient_id.in_(pids))
    rows = db.execute(q.order_by(OutboundMessage.id.desc()).limit(limit)).all()
    audit(db, request, me.id, "view", "outbound_messages", str(patient_id or "all"))
    return [
        {
            "id": m.id,
            "patient_id": m.patient_id,
            "patient_name": pname,
            "followup_id": m.followup_id,
            "journey_step_id": m.journey_step_id,
            "template_code": m.template_code,
            "language": m.language,
            "channel": m.channel,
            "status": m.status,
            "sent_at": m.sent_at,
            "provider_ref": m.provider_ref,
            "error": m.error,
            "created_at": m.created_at,
        }
        for m, pname in rows
    ]
