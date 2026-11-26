"""Health profiles & care programme recommendations router (Pages 2-4)."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import extended as ext, findings, followup as fu_svc, programs as prog_svc, relationship as rel
from ..analysis import load_rules
from ..db import get_db
from ..models import (CareTouchpoint, Followup, Order, Patient, PatientBucket, ProgramRecommendation, Report,
                      RetestRecommendation, User)
from ..security import audit, current_user, require
from ..timeutil import today_ist

router = APIRouter(tags=["programs"])
clinical = require("ADMIN", "DOCTOR")


def _patient(db: Session, pid: int) -> Patient:
    p = db.get(Patient, pid)
    if not p:
        raise HTTPException(404, "No such patient")
    root = rel.canonical_patient_id(db, pid)
    return db.get(Patient, root) if root != pid else p


@router.get("/patients/{pid}/health-profile")
def get_health_profile(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    profile, exists, row = prog_svc.get_profile(db, p.id)
    audit(db, request, me.id, "view", "health_profile", p.id)
    return {"patient_id": p.id, "exists": exists, "updated_at": row.updated_at if row else None, **profile}


@router.put("/patients/{pid}/health-profile")
def put_health_profile(pid: int, body: dict, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    p = _patient(db, pid)
    try:
        profile, row = prog_svc.save_profile(db, p.id, body, me.id)
    except ValueError as err:
        raise HTTPException(422, str(err))
    fu_svc.sync_profile_buckets(db, p.id, commit=False)
    rel.sync_touchpoints(db, p.id, commit=False)
    prog_svc.evaluate(db, p.id, commit=False)
    findings.sync_combinations(db, p.id, commit=False)
    db.commit()
    audit(db, request, me.id, "update", "health_profile", p.id)
    return {"patient_id": p.id, "exists": True, "updated_at": row.updated_at, **profile}


@router.get("/patients/{pid}/programs")
def get_patient_programs(pid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(current_user)):
    p = _patient(db, pid)
    rules = load_rules(db)
    catalogue = {c["code"]: c for c in rules.get("care_programs", [])}
    combo_meta = {
        s["target"]: s
        for c_def in rules.get("recommendation_combinations", {}).values()
        for slot in ("primary", "secondary", "third")
        if (s := c_def.get(slot))
    }
    _, pids = rel.patient_family_ids(db, p.id)
    recs = list(db.scalars(
        select(ProgramRecommendation).where(ProgramRecommendation.patient_id == p.id)
        .order_by(ProgramRecommendation.id.desc())
    ))
    audit(db, request, me.id, "view", "program_recommendations", p.id)

    if me.role == "CALLER":
        # Callers never see clinical names, codes, rules or any DOCTOR_CONSIDER item.
        out = []
        for r in recs:
            meta = catalogue.get(r.program_code, {})
            if meta.get("mode") == "DOCTOR_CONSIDER" or r.status == "EXPIRED":
                continue
            lbl = meta.get("caller_label") or combo_meta.get(r.program_code, {}).get("caller_label", "Wellness plan follow-up")
            out.append({"caller_label": lbl, "status": r.status})
        return out

    active_buckets = {
        b.bucket_code for b in db.scalars(
            select(PatientBucket).where(PatientBucket.patient_id.in_(pids), PatientBucket.active.is_(True))
        )
    }
    items = []
    for r in recs:
        meta = catalogue.get(r.program_code, {})
        c_meta = combo_meta.get(r.program_code, {})
        linked = meta.get("linked_bucket", "")
        items.append({
            "id": r.id,
            "patient_id": r.patient_id,
            "followup_id": r.followup_id,
            "report_id": r.report_id,
            "program_code": r.program_code,
            "doc_number": meta.get("doc_number", ""),
            "group": meta.get("group", ""),
            "clinical_label": meta.get("clinical_label") or c_meta.get("label", r.program_code),
            "caller_label": meta.get("caller_label") or c_meta.get("caller_label", ""),
            "trigger_text": meta.get("trigger_text", ""),
            "offering_text": meta.get("offering_text", ""),
            "loop_stage": meta.get("loop_stage") or findings.SERVICE_LOOP_STAGE.get(r.program_code, ""),
            "mode": meta.get("mode", "AUTO_SUGGEST"),
            "linked_bucket": linked,
            "is_primary_for_bucket": bool(linked and linked in active_buckets),
            "specialty": meta.get("specialty", ""),
            "rank": r.rank,
            "finding_code": r.finding_code or "",
            "rule_version": r.rule_version,
            "status": r.status,
            "matched_rules": r.reason_codes or [],
            "missing_data": r.missing_data or [],
            "notes": r.notes or [],
            "decline_reason_code": r.decline_reason_code,
            "decided_at": r.decided_at,
        })
    items.sort(key=lambda x: (0 if x["is_primary_for_bucket"] else 1, x["rank"] or 99, x["doc_number"], x["id"]))
    return items


class ProgramDecision(BaseModel):
    decision: str  # ACCEPTED | DECLINED | DISCUSS_LATER | ENROLLED
    reason_code: str = Field("", max_length=40)


@router.post("/program-recommendations/{rec_id}/decision")
def decide_program(rec_id: int, body: ProgramDecision, request: Request, db: Session = Depends(get_db),
                   me: User = Depends(clinical)):
    rec = db.get(ProgramRecommendation, rec_id)
    if not rec:
        raise HTTPException(404, "No such recommendation")
    decision = body.decision.strip().upper()
    if decision not in ("ACCEPTED", "DECLINED", "DISCUSS_LATER", "ENROLLED"):
        raise HTTPException(422, "Decision must be ACCEPTED, ENROLLED, DECLINED or DISCUSS_LATER")

    meta = next((c for c in load_rules(db).get("care_programs", []) if c["code"] == rec.program_code), {})
    if decision == "DECLINED" and meta.get("mode") == "DOCTOR_CONSIDER" and not body.reason_code.strip():
        raise HTTPException(422, "Select a reason code when marking a consider item as not suitable")

    rec.status = decision
    rec.decided_by = me.id
    rec.decided_at = datetime.now(timezone.utc)
    rec.decline_reason_code = body.reason_code.strip().upper()[:40] if decision == "DECLINED" else ""

    if decision in ("ACCEPTED", "ENROLLED"):
        stage = meta.get("loop_stage") or findings.SERVICE_LOOP_STAGE.get(rec.program_code, "PREVENTION")
        existing_tp = db.scalar(select(CareTouchpoint).where(
            CareTouchpoint.patient_id == rec.patient_id,
            CareTouchpoint.ref_entity == "program_recommendation",
            CareTouchpoint.ref_id == rec.id,
            CareTouchpoint.stage == stage,
        ))
        if not existing_tp:
            db.add(CareTouchpoint(
                patient_id=rec.patient_id, stage=stage, service_code=rec.program_code,
                occurred_on=today_ist(), source="MANUAL",
                ref_entity="program_recommendation", ref_id=rec.id, created_by=me.id,
            ))
        if meta.get("specialty"):
            ext.ensure_referral_for_accepted_program(db, rec.patient_id, rec.followup_id, rec.program_code, meta["specialty"], me.id)
        if rec.program_code in ("FOLLOWUP_DIAGNOSTIC", "RETEST") and rec.followup_id:
            if not db.scalar(select(RetestRecommendation.id).where(RetestRecommendation.followup_id == rec.followup_id).limit(1)):
                rules = load_rules(db)
                cat_codes = {t["code"] for t in rules.get("test_catalogue", [])}
                b_retest = {b["code"]: b.get("retest", []) for b in rules.get("buckets", [])}
                active_b = [b.bucket_code for b in db.scalars(
                    select(PatientBucket).where(PatientBucket.patient_id == rec.patient_id, PatientBucket.active.is_(True))
                )]
                tests = sorted({tc for b in active_b for tc in b_retest.get(b, []) if tc in cat_codes})
                if tests:
                    db.add(RetestRecommendation(followup_id=rec.followup_id, test_codes=tests))
        if rec.program_code == "TREATMENT_RESPONSE" and rec.followup_id:
            fu = db.get(Followup, rec.followup_id)
            if fu and fu.next_followup_on is None:
                fu.next_followup_on = today_ist() + timedelta(days=30)

    db.commit()
    # Audit only the recommendation row id, never program_code or patient PII.
    audit(db, request, me.id, f"program_{decision.lower()}", "program_recommendation", rec.id)
    return {
        "id": rec.id,
        "status": rec.status,
        "decline_reason_code": rec.decline_reason_code,
        "decided_at": rec.decided_at,
        "suggested_specialty": meta.get("specialty", "") if decision in ("ACCEPTED", "ENROLLED") else "",
    }


@router.get("/followups/{fid}/recommendations")
def followup_recommendations(fid: int, request: Request, db: Session = Depends(get_db), me: User = Depends(clinical)):
    f = db.get(Followup, fid)
    if not f:
        raise HTTPException(404, "No such follow-up")
    audit(db, request, me.id, "view", "followup_recommendations", fid)
    return findings.combinations_for_followup(db, fid)
