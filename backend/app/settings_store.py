from sqlalchemy.orm import Session

from .config import SETTING_DEFAULTS
from .models import Setting


def get_setting(db: Session, key: str):
    row = db.get(Setting, key)
    return row.value if row else SETTING_DEFAULTS[key]


def all_settings(db: Session) -> dict:
    return {**SETTING_DEFAULTS, **{s.key: s.value for s in db.query(Setting)}}
