import re
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import SETTING_DEFAULTS
from ..db import get_db
from ..models import AuditLog, Doctor, RuleSet, Setting, User
from ..security import audit, current_user, hash_password, require
from ..settings_store import all_settings
from .auth import public

router = APIRouter(tags=["admin"])
admin = require("ADMIN")
Role = Literal["ADMIN", "CALLER", "DOCTOR"]


# ---- users ----
class UserIn(BaseModel):
    name: str = Field(max_length=120)
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)
    role: Role


class UserPatch(BaseModel):
    name: str | None = Field(None, max_length=120)
    password: str | None = Field(None, max_length=200)
    role: Role | None = None
    active: bool | None = None


@router.get("/users")
def list_users(db: Session = Depends(get_db), _: User = Depends(admin)):
    return [public(u) for u in db.scalars(select(User).order_by(User.id))]


@router.post("/users", status_code=201)
def create_user(body: UserIn, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    email = body.email.strip().lower()
    if len(body.password) < 10:
        raise HTTPException(422, "Password must be at least 10 characters")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Email already exists")
    u = User(name=body.name, email=email, role=body.role, password_hash=hash_password(body.password), created_by=me.id)
    db.add(u)
    db.commit()
    audit(db, request, me.id, "create", "user", u.id)
    return public(u)


@router.patch("/users/{uid}")
def patch_user(uid: int, body: UserPatch, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "No such user")
    if uid == me.id and (body.active is False or (body.role and body.role != "ADMIN")):
        raise HTTPException(400, "You cannot lock yourself out")
    if body.password is not None:
        if len(body.password) < 10:
            raise HTTPException(422, "Password must be at least 10 characters")
        u.password_hash = hash_password(body.password)
    for f in ("name", "role", "active"):
        if getattr(body, f) is not None:
            setattr(u, f, getattr(body, f))
    db.commit()
    audit(db, request, me.id, "update", "user", uid)
    return public(u)


# ---- doctors (readable by any signed-in user: callers pick one when booking) ----
class DoctorIn(BaseModel):
    name: str = Field(max_length=120)
    user_id: int | None = None
    speciality: str = Field("", max_length=120)
    languages: list[str] = []
    priority_order: int = 100
    active: bool = True
    phone: str = Field("", max_length=30)
    in_pilot: bool = False


def doc_out(d: Doctor):
    return {c: getattr(d, c) for c in ("id", "user_id", "name", "speciality", "languages", "priority_order", "active", "phone", "in_pilot")}


@router.get("/doctors")
def list_doctors(db: Session = Depends(get_db), me: User = Depends(current_user)):
    out = [doc_out(d) for d in db.scalars(select(Doctor).order_by(Doctor.priority_order, Doctor.id))]
    if me.role == "CALLER":  # callers pick a name to book with; the number is only shown through "connect now"
        out = [{k: v for k, v in d.items() if k not in ("phone", "user_id", "in_pilot")} for d in out]
    return out


@router.post("/doctors", status_code=201)
def create_doctor(body: DoctorIn, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    d = Doctor(**body.model_dump(), created_by=me.id)
    db.add(d)
    db.commit()
    audit(db, request, me.id, "create", "doctor", d.id)
    return doc_out(d)


@router.put("/doctors/{did}")
def update_doctor(did: int, body: DoctorIn, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    d = db.get(Doctor, did)
    if not d:
        raise HTTPException(404, "No such doctor")
    for k, v in body.model_dump().items():
        setattr(d, k, v)
    db.commit()
    audit(db, request, me.id, "update", "doctor", did)
    return doc_out(d)


# ---- settings ----
@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _: User = Depends(admin)):
    return all_settings(db)


@router.put("/settings/{key}")
def put_setting(key: str, body: dict, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    if key not in SETTING_DEFAULTS:
        raise HTTPException(404, "Unknown setting")
    value = body.get("value")
    if key == "pull_time_ist" and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(value)):
        raise HTTPException(422, "Time must be HH:MM")
    if type(value) is not type(SETTING_DEFAULTS[key]):
        raise HTTPException(422, f"Value must be {type(SETTING_DEFAULTS[key]).__name__}")
    db.merge(Setting(key=key, value=value, updated_by=me.id))
    db.commit()
    audit(db, request, me.id, "update", "setting", key)
    return all_settings(db)


# ---- rules: versioned, doctor sign-off ----
def latest(db: Session, key: str) -> RuleSet | None:
    return db.scalar(select(RuleSet).where(RuleSet.key == key, RuleSet.active).order_by(RuleSet.version.desc()))


def rule_out(r: RuleSet, with_data=True):
    out = {"key": r.key, "version": r.version, "signed_off_by": r.signed_off_by,
           "signed_off_at": r.signed_off_at, "pending_signoff": r.signed_off_at is None}
    return {**out, "data": r.data} if with_data else out


@router.get("/rules")
def list_rules(db: Session = Depends(get_db), _: User = Depends(admin)):
    keys = db.scalars(select(RuleSet.key).distinct())
    return [rule_out(latest(db, k), with_data=False) for k in keys]


@router.get("/rules/{key}")
def get_rule(key: str, db: Session = Depends(get_db), _: User = Depends(require("ADMIN", "DOCTOR"))):  # clinical content: not for callers
    r = latest(db, key)
    if not r:
        raise HTTPException(404, "No such rule set")
    return rule_out(r)


@router.put("/rules/{key}")
def put_rule(key: str, body: dict, request: Request, db: Session = Depends(get_db), me: User = Depends(admin)):
    if "data" not in body:
        raise HTTPException(422, "Body must be {\"data\": ...}")
    old = latest(db, key)
    if not old:
        raise HTTPException(404, "No such rule set")
    old.active = False
    new = RuleSet(key=key, version=old.version + 1, data=body["data"], created_by=me.id)
    db.add(new)
    db.commit()
    audit(db, request, me.id, "new_version", "rule_set", f"{key}:v{new.version}")
    return rule_out(new)


@router.post("/rules/{key}/signoff")
def signoff(key: str, request: Request, db: Session = Depends(get_db), me: User = Depends(require("ADMIN", "DOCTOR"))):
    r = latest(db, key)
    if not r:
        raise HTTPException(404, "No such rule set")
    r.signed_off_by, r.signed_off_at = me.id, datetime.now(timezone.utc)
    db.commit()
    audit(db, request, me.id, "signoff", "rule_set", f"{key}:v{r.version}")
    return rule_out(r, with_data=False)


# ---- audit ----
@router.get("/audit")
def get_audit(limit: int = 100, db: Session = Depends(get_db), _: User = Depends(admin)):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 500)))
    return [{"id": a.id, "user_id": a.user_id, "action": a.action, "entity": a.entity,
             "entity_id": a.entity_id, "at": a.at, "ip": a.ip} for a in rows]
