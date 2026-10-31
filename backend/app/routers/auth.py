from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import env
from ..db import get_db
from ..models import User
from ..security import (COOKIE, audit, check_login_rate, clear_login_fails, current_user, make_token,
                        record_login_fail, verify_password, dummy_hash, client_ip)
from ..settings_store import get_setting

router = APIRouter(prefix="/auth", tags=["auth"])


class Login(BaseModel):
    email: str
    password: str


def public(u: User):
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "active": u.active}


@router.post("/login")
def login(body: Login, request: Request, response: Response, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    key = f"{email}|{client_ip(request)}"
    check_login_rate(key)
    user = db.scalar(select(User).where(User.email == email))
    # always do one password hash so an unknown email takes as long as a wrong password
    ok = verify_password(body.password, user.password_hash if user else dummy_hash())
    if not user or not user.active or not ok:
        record_login_fail(key)
        audit(db, request, user.id if user else None, "login_failed", "user", email[:60])
        raise HTTPException(401, "Wrong email or password")
    clear_login_fails(key)
    minutes = get_setting(db, "session_minutes")
    response.set_cookie(COOKIE, make_token(user.id, minutes), max_age=minutes * 60, httponly=True,
                        samesite="lax", secure=env.cookie_secure)
    audit(db, request, user.id, "login", "user", user.id)
    return public(user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE)
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return public(user)
