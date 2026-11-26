"""Connected-device provider interface (Page 5; vendor SDKs out of scope)."""
from datetime import datetime
from typing import Protocol


class DeviceProvider(Protocol):
    name: str

    def fetch_readings(self, patient_ref: str, since: datetime | None = None) -> list[dict]:
        """Return normalized readings: [{"kind", "values", "taken_at"}]."""
        ...
