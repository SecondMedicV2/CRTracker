from dataclasses import dataclass
from datetime import date, datetime


class LabError(Exception):
    """Raised for any lab fetch/list problem; message is shown to the admin (no patient data)."""


@dataclass
class FetchResult:
    pdf: bytes | None = None
    data: dict | None = None  # structured JSON if the lab provides it (skips OCR)
    collected_on: datetime | None = None
    reported_on: datetime | None = None


class LabProvider:
    name = "base"

    def list_serviced_orders(self, start: date, end: date) -> list[str]:
        raise NotImplementedError

    def fetch_report(self, order_id: str) -> FetchResult:
        raise NotImplementedError
