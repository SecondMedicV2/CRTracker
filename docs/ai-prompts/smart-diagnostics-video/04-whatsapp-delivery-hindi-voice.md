# Prompt — Video 04: Plan delivery on WhatsApp with a Hindi voice note (Activate)

Read `docs/ai-prompts/smart-diagnostics-video/00-video-context.md` first and follow it exactly.
**Depends on:** prompt 03 (signed personal plan), `messaging.py` / `OutboundMessage`, `Consent`, Health Hubs and
Express Nodes.

## Goal
After a doctor signs the plan, the patient receives it on WhatsApp with a short **Hindi voice note**, and is told
where it will be fulfilled: the nearest Express Node, a Health Hub, or at home.

## Important limits
- The existing rule says patient messages carry no test values or condition/medicine names. The video's plan
  message is clinical, so it needs **explicit patient consent to receive health information on WhatsApp**
  (a new consent type `WHATSAPP_HEALTH_INFO`) and a **doctor-approved message version**. Without that consent,
  fall back to the existing neutral "your plan is ready, please call us" message.
- Everything stays behind `whatsapp_enabled` and a new `voice_notes_enabled` setting (both off by default).
- Only send what the doctor approved. Store exactly what was sent (text hash, audio hash, template id, version).

## What to build
1. **Message templates** (RuleSet, doctor sign-off): English and Hindi text for "plan ready", "retest due",
   "collection booked", with placeholders only for dates, place names and prices.
2. **Voice note**: a `TextToSpeechProvider` interface with a "log only" adapter; Hindi audio generated from the
   approved Hindi text only (never from free text). Store audio encrypted; delete after the retention period in a
   setting.
3. **Fulfilment point**: choose the nearest active hub or node in the patient's city/pincode with the services the
   plan needs (add `pincode` and `services` to hubs/nodes if missing), or home collection. Patient can reply to
   change it; the reply creates a caller task, not an automatic change.
4. **Delivery tracking**: SENT / DELIVERED / READ / FAILED from the provider webhook; a failed send creates a caller
   task with the neutral label.
5. **UI**: on the follow-up page, a "Send to patient" button (enabled only when signed + consented), preview of
   the exact text and a play button for the voice note; delivery status timeline.
6. **Worker parity** (the edge may queue sends for the Python backend; say so in the response).

## Tests
- No send without doctor approval, consent and both switches.
- Without health-info consent only the neutral message is possible.
- Sent content matches the approved version byte for byte (hash check).
- Voice note is generated only from approved Hindi text; log-only adapter in tests; no PII in logs.
- Fulfilment point selection and the "change place" caller task.
