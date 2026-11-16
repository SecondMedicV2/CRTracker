"""Telephony and Outbound Calling for CRTracker.
Supports Manual dialing and MyOperator outbound calling (SecondMedic to customer)."""
import logging
import os
import re

import httpx

from .models import Doctor

log = logging.getLogger("telephony")


class TelephonyProvider:
    def dial_info(self, doctor: Doctor) -> dict:
        raise NotImplementedError

    def call_customer(self, customer_phone: str, customer_name: str = "", agent_phone: str = "", followup_id: int | None = None) -> dict:
        raise NotImplementedError


class ManualDialer(TelephonyProvider):
    def dial_info(self, doctor: Doctor) -> dict:
        return {"mode": "manual", "number": doctor.phone}

    def call_customer(self, customer_phone: str, customer_name: str = "", agent_phone: str = "", followup_id: int | None = None) -> dict:
        return {
            "mode": "manual",
            "provider": "manual",
            "to": customer_phone,
            "name": customer_name,
            "message": f"Dial {customer_phone} manually from SecondMedic",
            "status": "ready"
        }


class MyOperatorDialer(TelephonyProvider):
    """MyOperator outbound dialer: places outgoing calls from company (SecondMedic) to customer."""

    def __init__(self, api_key: str | None = None, company_id: str | None = None, caller_id: str | None = None):
        self.api_key = api_key if api_key is not None else os.getenv("MYOPERATOR_API_KEY", "")
        self.company_id = company_id if company_id is not None else os.getenv("MYOPERATOR_COMPANY_ID", "secondmedic")
        self.caller_id = caller_id if caller_id is not None else os.getenv("MYOPERATOR_CALLER_ID", "")
        self.api_url = os.getenv("MYOPERATOR_API_URL", "https://obd-api.myoperator.co/v1/sdk/outbound/call")

    def dial_info(self, doctor: Doctor) -> dict:
        return {
            "mode": "myoperator",
            "number": doctor.phone,
            "provider": "MyOperator",
            "from": "SecondMedic"
        }

    def call_customer(self, customer_phone: str, customer_name: str = "", agent_phone: str = "", followup_id: int | None = None) -> dict:
        clean_num = re.sub(r"[^\d+]", "", customer_phone or "")
        if len(clean_num) == 10 and not clean_num.startswith("+"):
            clean_num = f"+91{clean_num}"

        if self.api_key:
            try:
                payload = {
                    "company_id": self.company_id,
                    "secret_token": self.api_key,
                    "caller_id": self.caller_id,
                    "to": clean_num,
                    "agent": agent_phone or self.caller_id,
                    "reference_id": f"fu-{followup_id}" if followup_id else "direct"
                }
                resp = httpx.post(self.api_url, json=payload, timeout=10,
                                  headers={"Authorization": f"Bearer {self.api_key}"})
                if resp.status_code >= 400:
                    # never echo the provider's answer: it can repeat our token
                    reason = f"MyOperator rejected the call request (HTTP {resp.status_code})"
                    log.error(reason)
                    return {"success": False, "status": "rejected", "provider": "myoperator", "error": reason,
                            "to": clean_num, "message": reason}
                try:
                    res_data = resp.json()
                except ValueError:
                    res_data = {}
                res_data = res_data if isinstance(res_data, dict) else {}
                return {
                    "success": True,
                    "status": "initiated",
                    "provider": "myoperator",
                    "call_id": res_data.get("call_id") or f"MYOP-{res_data.get('id', 'LIVE')}",
                    "from": "SecondMedic",
                    "to": clean_num,
                    "customer_name": customer_name,
                    "message": f"Outgoing call initiated to {customer_name or clean_num} via MyOperator"
                }
            except httpx.HTTPError as e:
                reason = f"Could not reach MyOperator ({type(e).__name__})"
                log.error(reason)
                return {"success": False, "status": "failed", "provider": "myoperator", "error": reason,
                        "to": clean_num, "message": reason}

        # Simulation / ready state when MYOPERATOR_API_KEY is not yet populated
        return {
            "success": True,
            "status": "simulated",
            "provider": "myoperator",
            "call_id": f"MYOP-SIM-{followup_id or '0'}",
            "from": "SecondMedic",
            "to": clean_num,
            "customer_name": customer_name,
            "message": f"Outgoing call simulated from SecondMedic to {customer_name or clean_num} via MyOperator"
        }


def get_dialer() -> TelephonyProvider:
    provider = os.getenv("TELEPHONY_PROVIDER", "myoperator").lower()
    if provider == "myoperator":
        return MyOperatorDialer()
    return ManualDialer()
