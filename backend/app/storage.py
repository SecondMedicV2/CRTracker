"""Encrypted-at-rest file storage for fetched reports (Part 6.3, 15.1)."""
import os
import uuid
from pathlib import Path

from cryptography.fernet import Fernet

from . import db as dbmod
from .config import env
from .models import StoredFile


def _fernet() -> Fernet:
    if not env.file_encryption_key:
        raise RuntimeError("FILE_ENCRYPTION_KEY is not set (generate one with: python -m app.storage)")
    return Fernet(env.file_encryption_key.encode())


def save(data: bytes, suffix: str) -> str:
    name = f"{uuid.uuid4().hex}.{suffix}.enc"
    blob = _fernet().encrypt(data)  # always encrypted, wherever it is kept
    if env.storage_backend == "db":
        with dbmod.SessionLocal() as db:  # own short transaction: the file is safe even if the caller rolls back
            db.add(StoredFile(name=name, data=blob))
            db.commit()
    else:
        Path(env.storage_dir).mkdir(parents=True, exist_ok=True)
        (Path(env.storage_dir) / name).write_bytes(blob)
    return name


def load(name: str) -> bytes:
    if env.storage_backend == "db":
        with dbmod.SessionLocal() as db:
            row = db.get(StoredFile, name)
            if not row:
                raise FileNotFoundError("stored report is missing")
            return _fernet().decrypt(bytes(row.data))
    return _fernet().decrypt((Path(env.storage_dir) / os.path.basename(name)).read_bytes())


def delete(name: str) -> None:
    if not name:
        return
    if env.storage_backend == "db":
        with dbmod.SessionLocal() as db:
            row = db.get(StoredFile, name)
            if row:
                db.delete(row)
                db.commit()
    else:
        Path(env.storage_dir, os.path.basename(name)).unlink(missing_ok=True)


def encrypt_str(s: str) -> str:
    return _fernet().encrypt(s.encode()).decode()


def decrypt_str(s: str) -> str:
    return _fernet().decrypt(s.encode()).decode()


if __name__ == "__main__":
    print(Fernet.generate_key().decode())
