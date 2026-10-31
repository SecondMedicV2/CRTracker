import os
import tempfile

from cryptography.fernet import Fernet

os.environ["SECRET_KEY"] = "test-secret-key-at-least-32-bytes-long!!"
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["LAB_PROVIDER"] = "mock"
os.environ["STORAGE_DIR"] = tempfile.mkdtemp()
os.environ["FILE_ENCRYPTION_KEY"] = Fernet.generate_key().decode()

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool

from app import db as dbmod
from app.models import Base, User
from app.security import hash_password
from app.seed import seed

# one shared in-memory DB for the whole test session
dbmod.engine.dispose()
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

dbmod.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
dbmod.SessionLocal = sessionmaker(dbmod.engine, expire_on_commit=False)

from app.main import app  # noqa: E402
from app import security  # noqa: E402

security.SCRYPT_N = 2**4  # cheap hashing: the CI box / dev laptop may be short on RAM

PW = "correct-horse-battery"


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(dbmod.engine)
    Base.metadata.create_all(dbmod.engine)
    security._fails.clear()
    with dbmod.SessionLocal() as db:
        for name, role in (("Ada", "ADMIN"), ("Cal", "CALLER"), ("Doc", "DOCTOR")):
            db.add(User(name=name, email=f"{name.lower()}@x.com", role=role, password_hash=hash_password(PW)))
        db.commit()
        seed(db)


def client_as(email=None):
    c = TestClient(app)
    if email:
        assert c.post("/api/v1/auth/login", json={"email": email, "password": PW}).status_code == 200
    return c


@pytest.fixture
def admin():
    return client_as("ada@x.com")


@pytest.fixture
def caller():
    return client_as("cal@x.com")


@pytest.fixture
def doctor():
    return client_as("doc@x.com")
