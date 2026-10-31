from ..config import env
from .base import LabProvider
from .mock import MockLab
from .thyrocare import ThyrocareLab


def get_lab() -> LabProvider:
    return {"mock": MockLab, "thyrocare": ThyrocareLab}[env.lab_provider]()
