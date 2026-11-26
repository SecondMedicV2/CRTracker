# Prompt — Page 16: AI Training Programmes (SecondMedic Academy)

> **Important:** this page is a training/education product, not part of the patient follow-up system.
> Build it as a **separate small project** (its own repository or its own folder such as `academy/` with its own
> deploy). It must have **no access to CRTracker's database, patient data or API**. Paste the prompt below
> into an AI coding agent in a new, empty project. It does not need `00-shared-context.md`.

---

You are building **SecondMedic Academy**, a small website and admin tool for selling and running AI training
programmes. Stack: Next.js + TypeScript + Tailwind (static marketing pages) and a small backend for enquiries and
enrolments (use Cloudflare Workers + D1, or Supabase; propose one and ask me before choosing). Branding: SecondMedic
(teal-to-blue gradient, as on the slide).

## The programmes, exactly as in the document
(The slide header reads "Modules ! Programme"; use "Programme / Module".)

| Code | Programme / module | Target customer | Suggested format | Initial fee range to test | What the learner or buyer receives |
|---|---|---|---|---|---|
| APPLIED_AI | Applied AI and Automation | College students, graduates and junior professionals with suitable foundations | 12–16 weeks | ₹20,000–₹30,000 per learner | Assessed projects involving data, automation and AI applications; interview preparation |
| AI_AT_WORK | AI at Work | Sales, finance, HR, marketing, administration and operations professionals | 4–6 weeks, evenings or weekends | ₹8,000–₹12,000 per learner | Practical workflows relevant to their current work |
| AI_ORG | AI Productivity for Organisations | Businesses, colleges and professional teams | Two training days plus a clearly scoped follow-up | ₹50,000–₹1 lakh per organisation | Team training and development of selected workplace use cases |
| HEALTHCARE_OPS | Healthcare Operations module | Hospital, diagnostic, pharmacy and healthcare administration teams | Specialist module within the above programmes | Price after defining scope | Administrative and operational applications using suitable training data |

## What to build
1. **Public site**:
   - A home page with the 4 programmes as cards (icon, target customer, format, fee range, outcomes).
   - A detail page per programme.
   - An enquiry form: name, email, phone, organisation (for AI_ORG/HEALTHCARE_OPS), programme, preferred batch, message.
   - Consent checkbox for being contacted.
   - Spam protection with a honeypot field and rate limiting. No CAPTCHA solving.
   - Fee ranges are labelled "Introductory fee range — final fee confirmed on enrolment" (the document says "initial
     fee range to test").
2. **Admin** (login required; roles admin/staff):
   - Programme editor (all fields above, plus a published flag).
   - Batches/cohorts (programme, start date, schedule, mode online/offline/hybrid, seats, fee charged).
   - Leads pipeline (NEW → CONTACTED → QUALIFIED → ENROLLED | LOST) with notes.
   - Learner enrolments with fee, payment records (manual entry; an online gateway only after my approval) and status.
   - B2B organisation deals for AI_ORG/HEALTHCARE_OPS with a **scope** record (use cases, number of participants, days,
     agreed price), because "price after defining scope".
   - Dashboard: leads by programme and source, conversion rate, revenue booked vs collected, seats filled per batch.
   - CSV export (escape cells starting with `=`, `+`, `-`, `@`).
3. **HEALTHCARE_OPS rule**: course material and exercises must use **synthetic or properly de-identified data only**.
   No real patient data, ever. State this on the programme page and in the admin scope form (a required tick box).
4. Security: hashed passwords, server-side role checks, audit log of admin changes, security headers (CSP,
   X-Frame-Options DENY, nosniff), and no PII in logs.
5. Must be responsive (375 px phone), accessible (labels, contrast), and pass lint/build. Add tests for the enquiry
   API, the lead-stage transitions and the CSV escaping.

Start by writing a short plan and the data model, and wait for my approval before coding.
