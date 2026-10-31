from datetime import date, datetime, timedelta, timezone

from .base import FetchResult, LabError, LabProvider


def sample_report(order_id: str, collected: datetime) -> dict:
    """Structured fake report. Markers in the ID pick the scenario:
    NORMAL = healthy values, REVIEW = gender missing (needs human review), default = high HbA1c."""
    oid = order_id.upper()
    return {
        "order_id": order_id, "lab": "mock",
        "patient": {"name": "Test Patient", "age": 45, "gender": "" if "REVIEW" in oid else "M", "mobile": "9000000000"},
        "collected_on": collected.isoformat(), "reported_on": (collected + timedelta(days=1)).isoformat(),
        "parameters": [
            {"name": "Glycosylated Hemoglobin", "value": "5.2" if "NORMAL" in oid else "6.1", "unit": "%", "ref_range": "<5.7"},
            {"name": "Haemoglobin", "value": "14.5", "unit": "g/dl", "ref_range": "13 - 17"},
            {"name": "TSH", "value": "2.1", "unit": "uIU/mL", "ref_range": "0.4 - 4.2"},
        ],
    }


class MockLab(LabProvider):
    """Deterministic fake for dev/tests. IDs containing FAIL always error; PDF returns a stub
    PDF (extraction of PDFs is not available yet); everything else returns structured data."""

    name = "mock"

    def list_serviced_orders(self, start: date, end: date) -> list[str]:
        if end < start:
            raise LabError("End date is before start date")
        days = (end - start).days + 1
        return [f"MOCK-{(start + timedelta(d)).strftime('%Y%m%d')}-{i:02d}" for d in range(days) for i in range(1, 4)]

    def fetch_report(self, order_id: str) -> FetchResult:
        if "FAIL" in order_id.upper():
            raise LabError("Mock lab: report not available")
        t = datetime.now(timezone.utc) - timedelta(days=95)
        if "PDF" in order_id.upper():
            return FetchResult(pdf=b"%PDF-1.4 mock report " + order_id.encode(), collected_on=t, reported_on=t + timedelta(days=1))
        return FetchResult(data=sample_report(order_id, t), collected_on=t, reported_on=t + timedelta(days=1))
