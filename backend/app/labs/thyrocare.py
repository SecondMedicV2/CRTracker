from datetime import date

from .base import FetchResult, LabError, LabProvider


class ThyrocareLab(LabProvider):
    """Placeholder. Thyrocare's base URL, auth, rate limits and response format are still an
    open blocker (OPEN_QUESTIONS Q2), so nothing is guessed here."""

    name = "thyrocare"

    def list_serviced_orders(self, start: date, end: date) -> list[str]:
        raise LabError("Thyrocare API is not configured yet (docs and credentials pending)")

    def fetch_report(self, order_id: str) -> FetchResult:
        raise LabError("Thyrocare API is not configured yet (docs and credentials pending)")
