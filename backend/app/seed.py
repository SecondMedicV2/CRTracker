"""python -m app.seed : idempotent. Creates the first admin from ADMIN_EMAIL/ADMIN_PASSWORD
and loads starter rule sets (pending doctor sign-off)."""
from sqlalchemy import select

from .config import env
from .db import SessionLocal
from .models import RuleSet, User
from .security import hash_password
from .seed_data import RULE_SETS


def seed(db):
    for key, data in RULE_SETS.items():
        if not db.scalar(select(RuleSet).where(RuleSet.key == key)):
            db.add(RuleSet(key=key, version=1, data=data))
    if env.admin_email and env.admin_password and not db.scalar(select(User).where(User.role == "ADMIN")):
        db.add(User(name="Admin", email=env.admin_email.lower(), role="ADMIN",
                    password_hash=hash_password(env.admin_password)))
    db.commit()


if __name__ == "__main__":
    with SessionLocal() as db:
        seed(db)
    print("seeded")
