from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import callcard as cc, relationship as rel, retest as retest_svc
from ..analysis import load_rules
from ..db import get_db
from ..llm import LLMError
from ..models import CallCard, Followup, Patient, ProgramRecommendation, Referral, RefillSchedule, User
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
    root_pid = rel.canonical_patient_id(db, p.id)
    catalogue = {item["code"]: item for item in load_rules(db).get("care_programs", [])}
    recs = db.scalars(select(ProgramRecommendation).where(
        ProgramRecommendation.patient_id == root_pid, ProgramRecommendation.status.in_(("SUGGESTED", "ACCEPTED"))
    )).all()
    program_followups = sorted({
        catalogue[r.program_code]["caller_label"]
        for r in recs if r.program_code in catalogue and catalogue[r.program_code].get("mode") != "DOCTOR_CONSIDER"
    })
    refill_due = db.scalar(select(RefillSchedule.id).where(
        RefillSchedule.patient_id == root_pid, RefillSchedule.status == "ACTIVE", RefillSchedule.task_status == "DUE"
    ).limit(1)) is not None
    specs = load_rules(db).get("referral_specialties", {})
    refs = db.scalars(select(Referral).where(Referral.patient_id == root_pid, Referral.status.in_(("SUGGESTED", "BOOKED")))).all()
    specialist_bookings = [
        {"id": rf.id, "label": specs.get(rf.specialty, "Specialist appointment to book"), "scheduled_for": rf.scheduled_for, "status": rf.status}
        for rf in refs
    ]
    combos = load_rules(db).get("recommendation_combinations", {})
    combo_labels = {
        s["target"]: s["caller_label"]
        for c_def in combos.values() for slot in ("primary", "secondary", "third")
        if (s := c_def.get(slot))
    }
    ranked_recs = sorted(
        (r for r in recs if r.rank is not None and catalogue.get(r.program_code, {}).get("mode") != "DOCTOR_CONSIDER"
         and r.status in ("SUGGESTED", "ACCEPTED", "ENROLLED")),
        key=lambda r: (r.rank, r.id),
    )
    next_steps = list(dict.fromkeys(
        lbl for r in ranked_recs
        if (lbl := combo_labels.get(r.program_code) or catalogue.get(r.program_code, {}).get("caller_label"))
    ))
    audit(db, request, me.id, "view", "caller_card", fid)
    tmeta = retest_svc.tier_meta(db, f.protocol_tier)
    return {"followup_id": fid, "patient_id": root_pid, "patient_name": p.name, "mobile": mobile_out(p, me), "language": c.language,
            "notice": c.notice, "report_age_days": c.content["summary"]["report_age_days"], "reason_for_call": cc.reason_for_call(c),
            "script": {k: v for k, v in script.items() if k != "do_not_say"}, "do_not_say": script["do_not_say"],
            "priority": f.priority, "protocol_tier_colour": tmeta["colour_token"], "protocol_tier_label": tmeta["caller_label"],
            "program_followups": program_followups, "next_steps": next_steps,
            "refill_reminder": "Pharmacy refill reminder call" if refill_due else None,
            "specialist_bookings": specialist_bookings}
