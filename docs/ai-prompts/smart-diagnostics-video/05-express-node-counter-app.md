# Prompt — Video 05: Express Node counter app ("report to counter in 48 hours")

Read `docs/ai-prompts/smart-diagnostics-video/00-video-context.md` first and follow it exactly.
**Depends on:** `ExpressNode`, prompt 01 (EXPRESS_NODE door), prompt 03 (signed plan), care-plan payments.

## Goal
A neighbourhood chemist or partner counter (an Express Node) can take in a report from any lab, and later hand
over a **doctor-signed plan** and take payment, **within 48 hours**. This is a small, phone-first app for counter
staff — a new role with very limited access.

## What to build
1. **Role `NODE_STAFF`**, always linked to one `express_node_id`. Login like other staff (rate-limited). Sees only
   patients registered or served at their node, and only non-clinical fields (like a caller), plus the signed
   plan's **caller-safe** summary and price. Add the role to the RBAC matrix in `test_security.py`; every existing
   route must refuse it unless listed.
2. **Counter flows** (phone-width first, large buttons, Hindi/English):
   - "New report": capture a photo or PDF of the report, the patient's name and mobile, and consent → calls
     `intake.receive_report(door=EXPRESS_NODE)`.
   - "Plans ready": patients from this node whose plan is signed, with the 48-hour clock.
   - "Collect payment": counter payment (cash/UPI/card) for the signed plan; prints or shares a receipt
     without clinical content.
   - "Book sample collection": at the node or at home, using the existing booking.
3. **Attribution**: every touchpoint, payment and new patient from the app carries `express_node_id`, so the page-13
   scorecard counts real node activity.
4. **Node dashboard (admin)**: reports received, plans handed over within 48 hours, conversion, revenue per node.
   Aggregates only.
5. **Worker parity** for all routes; the app must work against the edge API.

## Tests
- NODE_STAFF cannot read clinical data, other nodes' patients, or any admin/doctor route.
- A report from the counter enters the normal pipeline with `source_door=EXPRESS_NODE`.
- Payment only for a signed plan; RED gate enforced; receipt has no clinical words.
- 48-hour clock and node attribution feed the outcomes and scorecard metrics.
