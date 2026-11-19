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
    # Who the lab booked the test for (name/age/gender/mobile). Fills or overrides what the PDF says,
    # because the booking system holds the number our callers should dial.
    patient: dict | None = None
    ref: str = ""  # the lab's own human-readable order number, shown to admins


class LabProvider:
    name = "base"

    def list_serviced_orders(self, start: date, end: date) -> list[str]:
        raise NotImplementedError

    def fetch_report(self, order_id: str) -> FetchResult:
        raise NotImplementedError
