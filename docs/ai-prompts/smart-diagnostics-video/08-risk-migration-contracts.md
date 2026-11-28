# Prompt — Video 08: Risk-migration contracts and outcome pricing (planned; build switched off)

Read `docs/ai-prompts/smart-diagnostics-video/00-video-context.md` first and follow it exactly.
**Depends on:** prompt 06 (verified health deltas), `CorporateClient`, corporate billing in `routers/memberships.py`,
prompt 03 (payer types).

## Goal
"Employers pay a bonus for every employee who moves to a lower risk band." The video marks outcome-linked pricing
and employer contracts as **planned**, so build the engine and reports, **switched off by default**, with every
commercial number entered by an admin — nothing seeded as if real.

## What to build
1. **Risk bands** (RuleSet, doctor sign-off): a deterministic band per member (e.g. LOW / MODERATE / HIGH) from
   verified ledger values and triage history. Starter rules only from existing clinical rule sets; anything new is
   **[CONFIRM]**.
2. **Contract terms** per corporate client (admin): baseline window, measurement window, bonus per member who moves
   down at least one band (₹), cap per period, minimum cohort size (default 10), and whether worsening reduces the
   bonus. Setting `risk_contracts_enabled` (off).
3. **Measurement**: for each contract period, the cohort of members with both a baseline and a verified follow-up
   band; members who moved down, stayed, moved up. Only verified, clinically timed values count.
4. **Statement**: an aggregate bonus statement next to the PEPM statement (formula-safe CSV), with suppression when
   the cohort is under the minimum. No individual employee data leaves the system.
5. **Insurer outcome pricing**: the same engine with payer type INSURER, behind its own switch, **[CONFIRM]** —
   build the data model and statement only.
6. **Worker parity** for the read-only statement routes.

## Tests
- Switch off → routes return 404/409 and no statement is produced.
- Band movement maths, caps, minimum cohort suppression.
- Only verified ledger values are used.
- No individual employee is identifiable in any employer output.
