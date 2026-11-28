"""Report-to-outcome loop: RED/AMBER/GREEN triage, the doctor clearance that unlocks plan sales, and outcome metrics."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from .. import outcomes
from ..db import get_db
from ..models import Followup, User
from ..security import audit, require

router = APIRouter(tags=["outcomes"])
doctor_admin = require("ADMIN", "DOCTOR")
doctor_only = require("DOCTOR")
admin_only = require("ADMIN")


def _fu(db: Session, fid: int) -> Followup:
    fu = db.get(Followup, fid)
    if not fu:
        raise HTTPException(404, "Follow-up not found")
    return fu


@router.get("/followups/{fid}/triage")
def get_triage(fid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(doctor_admin)):
    fu = _fu(db, fid)
    audit(db, request, me.id, "view", "followup_triage", fu.id)
    return outcomes.triage_out(fu)


@router.post("/followups/{fid}/clear")
def post_clear(fid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(doctor_only)):
    """A doctor has spoken to / reviewed the patient: plan sales are allowed again for this result."""
    fu = outcomes.clear_followup(db, _fu(db, fid), me.id)
    audit(db, request, me.id, "clear", "followup", fu.id)
    return outcomes.triage_out(fu)


@router.get("/outcomes/metrics")
def get_outcome_metrics(from_: date | None = Query(None, alias="from"), to: date | None = None, request: Request = None,
                        db: Session = Depends(get_db), me: User = Depends(admin_only)):
    if from_ and to and from_ > to:
        raise HTTPException(422, "from must be on or before to")
    data = outcomes.outcome_metrics(db, from_, to)
    audit(db, request, me.id, "view", "outcome_metrics", f"{data['from']}:{data['to']}")
    return data
