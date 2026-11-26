"""Idempotent backfill of care_touchpoints across all non-merged patients (Page 1)."""
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Patient
from app.relationship import sync_touchpoints


def backfill() -> int:
    total = 0
    with SessionLocal() as db:
        for pid in db.scalars(select(Patient.id).where(Patient.merged_into_id.is_(None))):
            total += sync_touchpoints(db, pid, commit=False)
        db.commit()
    return total


if __name__ == "__main__":
    print(f"Backfilled {backfill()} touchpoints")
