"""Channel-agnostic patient messaging layer with Consent, DNC, and 09:00-20:00 IST guards (Page 8)."""
from datetime import datetime, timezone
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import assign, relationship as rel
from .analysis import load_rules
from .models import Consent, OutboundMessage, Patient, User
from .seed_data import MESSAGE_TEMPLATES
from .settings_store import get_setting
from .timeutil import IST


class MessagingProvider(Protocol):
    channel: str

    def send(
        self,
        db: Session,
        patient: Patient,
        template_code: str,
        lang: str,
        text: str,
        *,
        followup_id: int | None = None,
        journey_step_id: int | None = None,
        now: datetime,
    ) -> OutboundMessage: ...


class CallTaskProvider:
    """Default provider: converts patient messages into neutral caller follow-up tasks."""

    channel = "CALL_TASK"

    def send(
        self,
        db: Session,
        patient: Patient,
        template_code: str,
        lang: str,
        text: str,
        *,
        followup_id: int | None = None,
        journey_step_id: int | None = None,
        now: datetime,
    ) -> OutboundMessage:
        msg = OutboundMessage(
            patient_id=patient.id,
            followup_id=followup_id,
            journey_step_id=journey_step_id,
            template_code=template_code,
            language=lang,
            channel=self.channel,
            status="CALL_TASK_CREATED",
            sent_at=now,
            provider_ref=f"call_task:{patient.id}:{journey_step_id or template_code}",
        )
        db.add(msg)
        db.flush()
        caller_ids = [u for (u,) in db.execute(select(User.id).where(User.role == "CALLER", User.active))]
        if not caller_ids:
            caller_ids = [u for (u,) in db.execute(select(User.id).where(User.role == "ADMIN", User.active))]
        if caller_ids:
            link = f"/caller-card/view?id={followup_id}" if followup_id else "/followups"
            assign.notify(db, caller_ids, "Follow-up reminder call due", link)
        return msg


class WhatsAppProvider:
    """WhatsApp Business stub gated behind Setting whatsapp_enabled=false; zero live keys in code."""

    channel = "WHATSAPP"

    def send(
        self,
        db: Session,
        patient: Patient,
        template_code: str,
        lang: str,
        text: str,
        *,
        followup_id: int | None = None,
        journey_step_id: int | None = None,
        now: datetime,
    ) -> OutboundMessage:
        msg = OutboundMessage(
            patient_id=patient.id,
            followup_id=followup_id,
            journey_step_id=journey_step_id,
            template_code=template_code,
            language=lang,
            channel=self.channel,
            status="SENT",
            sent_at=now,
            provider_ref=f"wa-stub:{patient.id}:{journey_step_id or template_code}",
        )
        db.add(msg)
        db.flush()
        return msg


def get_provider(db: Session) -> MessagingProvider:
    return WhatsAppProvider() if get_setting(db, "whatsapp_enabled") else CallTaskProvider()


def render_message_text(rules: dict | None, template_code: str, lang: str = "en", callback_number: str = "") -> tuple[str, str]:
    mt = (rules or {}).get("message_templates") or MESSAGE_TEMPLATES
    templates = mt.get("templates") or MESSAGE_TEMPLATES["templates"]
    entry = templates.get(template_code) or templates.get("D75_RETEST_NOTICE") or {}
    norm_lang = "hi" if (lang or "").strip().lower().startswith("hi") else "en"
    raw = entry.get(norm_lang) or entry.get("en") or "Your scheduled follow-up check-in is due."
    cb = (callback_number or "").strip() or "our care team helpline"
    return norm_lang, str(raw).replace("{callback_number}", cb)


def is_within_send_hours_ist(now: datetime | None = None) -> bool:
    ts = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return 9 <= ts.astimezone(IST).hour < 20


def send_patient_message(
    db: Session,
    patient_id: int,
    template_code: str,
    *,
    followup_id: int | None = None,
    journey_step_id: int | None = None,
    now: datetime | None = None,
) -> OutboundMessage | None:
    """Send neutral patient message or create caller task after verifying Consent, DNC, and 09:00-20:00 IST."""
    ts = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    root_pid = rel.canonical_patient_id(db, patient_id)
    patient = db.get(Patient, root_pid)
    if not patient:
        return None
    pids = [root_pid, *db.scalars(select(Patient.id).where(Patient.merged_into_id == root_pid))]

    if journey_step_id is not None:
        sent_prev = db.scalar(
            select(OutboundMessage).where(
                OutboundMessage.journey_step_id == journey_step_id,
                OutboundMessage.status.in_(("SENT", "CALL_TASK_CREATED")),
            ).limit(1)
        )
        if sent_prev:
            return sent_prev

    provider = get_provider(db)
    lang = "hi" if (patient.language or get_setting(db, "default_language") or "en").lower().startswith("hi") else "en"

    def _blocked(status_code: str, reason: str) -> OutboundMessage:
        if journey_step_id is not None:
            ex_b = db.scalar(
                select(OutboundMessage).where(
                    OutboundMessage.journey_step_id == journey_step_id,
                    OutboundMessage.status == status_code,
                ).order_by(OutboundMessage.id.desc()).limit(1)
            )
            if ex_b and ex_b.created_at:
                ex_dt = ex_b.created_at if ex_b.created_at.tzinfo else ex_b.created_at.replace(tzinfo=timezone.utc)
                if ex_dt.astimezone(IST).date() == ts.astimezone(IST).date():
                    return ex_b
        m = OutboundMessage(
            patient_id=root_pid,
            followup_id=followup_id,
            journey_step_id=journey_step_id,
            template_code=template_code,
            language=lang,
            channel=provider.channel,
            status=status_code,
            error=reason[:240],
        )
        db.add(m)
        db.flush()
        return m

    dnc = any(db.scalars(select(Patient.do_not_call).where(Patient.id.in_(pids))))
    if dnc:
        return _blocked("BLOCKED_DNC", "Patient requested do not call")

    has_consent = db.scalar(select(Consent.id).where(Consent.patient_id.in_(pids)).limit(1)) is not None
    if not has_consent:
        return _blocked("BLOCKED_NO_CONSENT", "No recorded consent for messaging")

    if not is_within_send_hours_ist(ts):
        return _blocked("BLOCKED_QUIET_HOURS", "Outside 09:00-20:00 IST messaging window")

    rules = load_rules(db)
    norm_lang, text = render_message_text(rules, template_code, lang, get_setting(db, "callback_number"))
    return provider.send(
        db, patient, template_code, norm_lang, text,
        followup_id=followup_id, journey_step_id=journey_step_id, now=ts,
    )
