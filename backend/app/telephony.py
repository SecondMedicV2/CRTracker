"""Real-time connect (Part 13.1). v1 has no dialer integration: the caller is shown a number to dial.
Swap in a real provider here once the call centre's dialer is known (Q12)."""
from .models import Doctor


class TelephonyProvider:
    def dial_info(self, doctor: Doctor) -> dict:
        raise NotImplementedError


class ManualDialer(TelephonyProvider):
    def dial_info(self, doctor: Doctor) -> dict:
        return {"mode": "manual", "number": doctor.phone}


def get_dialer() -> TelephonyProvider:
    return ManualDialer()
