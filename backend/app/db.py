from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .config import env

engine = create_engine(
    env.database_url,
    connect_args={"check_same_thread": False} if env.database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db():
    with SessionLocal() as db:
        yield db
