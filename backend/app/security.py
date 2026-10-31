import hashlib
import hmac
import os
import time
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .config import env
from .db import get_db
from .models import AuditLog, User

COOKIE = "crt_session"
SCRYPT_N = 2**14  # tests lower this; the stored hash is only valid for the N it was made with


def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=SCRYPT_N, r=8, p=1)
    return f"scrypt${salt.hex()}${h.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, salt, h = stored.split("$")
        got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=SCRYPT_N, r=8, p=1)
        return hmac.compare_digest(got.hex(), h)
    except ValueError:
        return False


_dummy: list[str] = []


def dummy_hash() -> str:
    if not _dummy:
        _dummy.append(hash_password("not-a-real-password"))
    return _dummy[0]


def make_token(user_id: int, minutes: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return jwt.encode({"sub": str(user_id), "exp": exp}, env.secret_key, algorithm="HS256")


# shortcut: in-memory counter, per process; move to Redis when running >1 worker.
_fails: dict[str, list[float]] = {}


def check_login_rate(key: str, limit: int = 5, window: int = 900):
    recent = [t for t in _fails.get(key, []) if time.time() - t < window]
    _fails[key] = recent
    if len(recent) >= limit:
        raise HTTPException(429, "Too many failed attempts. Try again later.")


def record_login_fail(key: str):
    _fails.setdefault(key, []).append(time.time())


def clear_login_fails(key: str):
    _fails.pop(key, None)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE)
    try:
        uid = int(jwt.decode(token, env.secret_key, algorithms=["HS256"])["sub"])
    except Exception:
        raise HTTPException(401, "Not signed in")
    user = db.get(User, uid)
    if not user or not user.active:
        raise HTTPException(401, "Not signed in")
    return user


def require(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Not allowed")
        return user

    return dep


def audit(db: Session, request: Request | None, user_id: int | None, action: str, entity: str, entity_id="") -> None:
    ip = request.client.host if request and request.client else ""
    db.add(AuditLog(user_id=user_id, action=action, entity=entity, entity_id=str(entity_id), ip=ip))
    db.commit()
