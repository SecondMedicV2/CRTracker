from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import callcard as cc
from ..db import get_db
from ..llm import LLMError
from ..models import CallCard, Followup, Patient, User
from ..security import audit, current_user, require
from ..settings_store import get_setting
from .patients import mobile_out

router = APIRouter(tags=["call-cards"])
staff = require("ADMIN", "DOCTOR")


def card_out(db: Session, c: CallCard) -> dict:
    versions = db.scalars(select(CallCard).where(CallCard.followup_id == c.followup_id).order_by(CallCard.version)).all()
    return {"id": c.id, "followup_id": c.followup_id, "version": c.version, "language": c.language, "content": c.content,
            "model": c.model, "prompt_version": c.prompt_version, "validation_status": c.validation_status,
            "validation_errors": c.validation_errors, "notice": c.notice,
            "approved": c.doctor_approved_at is not None, "approved_at": c.doctor_approved_at,
            "label": "AI-generated draft, doctor to confirm" if c.doctor_approved_at is None else "Approved by doctor",
            "versions": [{"id": v.id, "version": v.version, "validation_status": v.validation_status, "edited_by": v.edited_by,
                          "approved": v.doctor_approved_at is not None, "created_at": v.created_at} for v in versions]}


def _followup(db: Session, fid: int) -> Followup:
    f = db.get(Followup, fid)
    if not f:
        raise HTTPException(404, "No such follow-up")
    return f


@router.get("/followups/{fid}/call-card")
def get_card(fid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(staff)):
    _followup(db, fid)
    c = cc.latest(db, fid)
    if not c:
        raise HTTPException(404, "No call card yet")
    audit(db, request, me.id, "view", "call_card", c.id)
    return card_out(db, c)


@router.post("/followups/{fid}/call-card/generate", status_code=201)
def generate(fid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(staff)):
    f = _followup(db, fid)
    try:
        c = cc.generate(db, f, me.id)
    except LLMError as e:
        raise HTTPException(502, str(e))
    audit(db, request, me.id, "generate", "call_card", c.id)
    return card_out(db, c)


@router.put("/call-cards/{cid}")
def edit_card(cid: int, body: dict, request: Request, db: Session = Depends(get_db), me: User = Depends(staff)):
    c = db.get(CallCard, cid)
    if not c:
        raise HTTPException(404, "No such call card")
    if "content" not in body:
        raise HTTPException(422, 'Body must be {"content": ...}')
    try:
        new = cc.edit(db, c, body["content"], me.id)
    except ValueError as e:
        raise HTTPException(422, "; ".join(e.args[0]))
    audit(db, request, me.id, "edit", "call_card", new.id)
    return card_out(db, new)


@router.post("/call-cards/{cid}/approve")
def approve(cid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(require("DOCTOR"))):
    c = db.get(CallCard, cid)
    if not c:
        raise HTTPException(404, "No such call card")
    if cc.latest(db, c.followup_id).id != c.id:
        raise HTTPException(409, "Only the latest version can be approved")
    if c.validation_status != "VALID":
        raise HTTPException(409, "Fix the validation problems (edit the card) before approving")
    c.doctor_approved_by, c.doctor_approved_at = me.id, datetime.now(timezone.utc)
    db.commit()
    audit(db, request, me.id, "approve", "call_card", cid)
    return card_out(db, c)


@router.get("/followups/{fid}/caller-card")
def caller_card(fid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(current_user)):
    """What a caller sees: identity, a non-clinical reason and the caller script. Never findings or values."""
    f = _followup(db, fid)
    c = cc.latest(db, fid)
    if not c or c.validation_status != "VALID":
        raise HTTPException(409, "The call script is not ready yet")
    if get_setting(db, "caller_script_requires_approval") and c.doctor_approved_at is None:
        raise HTTPException(409, "The call script is waiting for doctor approval")
    p = db.get(Patient, f.patient_id)
    script = cc.render_caller_script(c.content["caller_script"], p.name, me.name, get_setting(db, "company_name"))
    deficits = []
    if c and c.content and "abnormal_findings" in c.content:
        for a in c.content["abnormal_findings"]:
            direction = str(a.get("direction", "")).lower()
            status_label = "Deficit (Low)" if direction == "low" else "Elevated (High)"
            deficits.append({
                "param_code": a.get("param_code", ""),
                "name": a.get("name", ""),
                "value": a.get("value"),
                "unit": a.get("unit", ""),
                "ref_range": a.get("ref_range", ""),
                "direction": direction,
                "severity": a.get("severity", "mild"),
                "status_label": status_label,
                "guidance": f"Doctor to review {a.get('name', 'finding')} with customer."
            })
    audit(db, request, me.id, "view", "caller_card", fid)
    return {"followup_id": fid, "patient_name": p.name, "mobile": mobile_out(p, me), "language": c.language,
            "notice": c.notice, "report_age_days": c.content["summary"]["report_age_days"], "reason_for_call": cc.reason_for_call(c),
            "deficits": deficits, "abnormal_findings": deficits,
            "script": {k: v for k, v in script.items() if k != "do_not_say"}, "do_not_say": script["do_not_say"],
            "priority": f.priority}
