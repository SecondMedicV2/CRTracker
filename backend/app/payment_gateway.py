"""Online payment provider interface (Health360, page 15).

Only a Razorpay TEST-mode adapter exists, and it is used only when the admin setting `online_payments_enabled`
is on and test keys are configured. While the switch is off, `get_provider` returns None and nothing is sent anywhere.
"""
from __future__ import annotations

import hashlib
import hmac
from typing import Protocol

import httpx
from sqlalchemy.orm import Session

from .config import env
from .settings_store import get_setting


class PaymentError(Exception):
    pass


class PaymentProvider(Protocol):
    name: str

    def create_order(self, amount_inr: int, receipt: str) -> dict: ...

    def verify(self, order_id: str, payment_id: str, signature: str) -> bool: ...


class RazorpayTestProvider:
    name = "razorpay_test"
    api = "https://api.razorpay.com/v1"

    def __init__(self, key_id: str, key_secret: str):
        if not key_id.startswith("rzp_test_"):
            raise PaymentError("Only Razorpay test keys (rzp_test_...) are allowed")
        self.key_id, self.key_secret = key_id, key_secret

    def create_order(self, amount_inr: int, receipt: str) -> dict:
        # receipt is an internal reference only (e.g. "mem-12"): no patient name or phone leaves the system
        r = httpx.post(f"{self.api}/orders", auth=(self.key_id, self.key_secret), timeout=15,
                       json={"amount": int(amount_inr) * 100, "currency": "INR", "receipt": receipt[:40]})
        if r.status_code >= 300:
            raise PaymentError(f"Payment provider refused the order ({r.status_code})")
        data = r.json()
        return {"order_id": data["id"], "amount_inr": amount_inr, "key_id": self.key_id}

    def verify(self, order_id: str, payment_id: str, signature: str) -> bool:
        expected = hmac.new(self.key_secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature or "")


def get_provider(db: Session) -> PaymentProvider | None:
    if not get_setting(db, "online_payments_enabled"):
        return None
    if not (env.razorpay_key_id and env.razorpay_key_secret):
        raise PaymentError("Online payments are switched on but no Razorpay test keys are configured")
    return RazorpayTestProvider(env.razorpay_key_id, env.razorpay_key_secret)
