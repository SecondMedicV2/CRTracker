"""Encrypted-at-rest file storage for fetched reports (Part 6.3, 15.1)."""
import os
import uuid
from pathlib import Path

from cryptography.fernet import Fernet

from .config import env


def _fernet() -> Fernet:
    if not env.file_encryption_key:
        raise RuntimeError("FILE_ENCRYPTION_KEY is not set (generate one with: python -m app.storage)")
    return Fernet(env.file_encryption_key.encode())


def save(data: bytes, suffix: str) -> str:
    Path(env.storage_dir).mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{suffix}.enc"
    (Path(env.storage_dir) / name).write_bytes(_fernet().encrypt(data))
    return name


def load(name: str) -> bytes:
    return _fernet().decrypt((Path(env.storage_dir) / os.path.basename(name)).read_bytes())


def encrypt_str(s: str) -> str:
    return _fernet().encrypt(s.encode()).decode()


def decrypt_str(s: str) -> str:
    return _fernet().decrypt(s.encode()).decode()


if __name__ == "__main__":
    print(Fernet.generate_key().decode())
