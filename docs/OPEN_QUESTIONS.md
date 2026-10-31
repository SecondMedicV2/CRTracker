# Open Questions (blockers marked ⛔)

1. Q1 Existing prototype repo/stack to extend, or build fresh? (assumed fresh)
2. ⛔ Q2 Thyrocare API: docs, base URL, auth, rate limits, list-by-date, PDF vs JSON, full patient history, newer-order lookup, stable patient ID.
3. ⛔ Q3 Which LLM + key? Is the CEO's "A to Z" key the Thyrocare key, the LLM key, or both?
4. ⛔ Q4 Final bucket list, clinical sign-off owner, how to detect hypertension (BP/history source?).
5. ⛔ Q5 Critical-values table from a doctor (ships empty with warning until then).
6. Q6 Confirm HbA1c cut-offs (6.5 = diabetes range).
7. Q7 Is 3 months a hard minimum or only the default?
8. Q8 Any re-engagement for NORMAL patients?
9. ⛔ Q9 What exactly does "cascade to the rest of the doctors" mean?
10. Q10 Should callers see any clinical info at all (even the "reason for call" wording)?
11. ⛔ Q11 Languages beyond English / Hindi / Hinglish.
12. ⛔ Q12 Telephony/dialer in use; real-time transfer in v1?
13. Q13 Test catalogue with Thyrocare codes and prices; should v1 place retest orders?
14. Q14 Doctors: count, specialities, languages, hours/slots, how bookings work.
15. Q15 Number of callers/doctors; daily volume (assumed 500 orders/day).
16. Q16 Data retention/deletion policy; hosting cloud and region.
17. ⛔ Q17 10+ real/anonymised Thyrocare PDFs (until then: synthetic).
18. ⛔ Q18 Confirm OPD/fever (Hindujā) flow is OUT.
19. Q19 Company/product name, branding, exact wording of the free follow-up pitch.
20. Q20 Who approves final doctor/caller script templates?

New from review:
21. Do you want the folder/project to stay named CRTracker for the product name too (UI title)?
22. Can the Thyrocare order ID alone identify the patient (name/mobile), or does our side need to supply mobile?
23. Where will this be hosted for the pilot (local, a VM, cloud)? Needed for storage/encryption choices.
24. RESOLVED (31 Oct 2026): keep the spec weights, a lone mild abnormal value stays parked. Retest-score weights (Part 11.4): with the starter weights a lone mildly-abnormal value scores 35 and is parked (LOW below 40) even when due. Is that the intended behaviour, or should the LOW cut-off or the weights change?
25. Should a caller be allowed to use the AI caller script before a doctor approves it? Default is yes (it is validated and contains nothing clinical); the switch is `caller_script_requires_approval`.
26. The Hindi and Hinglish script wording is a machine-written starter: who reviews it before real calls? (Same as Q20.)
27. Doctor availability: should the booking screen offer only slots inside a doctor's working hours? Today any non-overlapping time is accepted (extends Q14).
28. After 3 failed attempts a follow-up is dropped from all lists. Should an admin be able to re-open it, or should it go to a "gave up" list?
29. Trend graphs show one panel per test. Do you want an option to overlay several tests on one chart (needs a decision on how to scale different units)?
30. Which dashboard numbers matter most to the CEO weekly? Anything missing (cost per booking, retest revenue) needs test prices (Q13).
31. AC17: the original "upload one report (PDF + mobile + name + consent), choose priority and doctor" screen was never built and cannot read PDFs yet. Do you still need it as a separate fallback path once Thyrocare import works? If yes, it also needs Q3 (PDF reader) and Q17 (sample PDFs).
32. Upgrade to Next.js 16 to clear the two `npm audit` findings (major upgrade, needs a regression pass). Schedule it before launch?
33. Commission an independent penetration test and a legal review (DPDP Act) before real patient data goes in?
34. Should doctors only see their own assigned patients (today they see all)? Needs a decision before hosting.
