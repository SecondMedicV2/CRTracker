---
marp: true
theme: gaia
_class: lead
paginate: true
backgroundColor: #f5f5f5
---

# CRTracker
## Report Intelligence & Doctor Follow-Up CRM

---

# Problem & Solution
- **The Challenge**: Manually reviewing blood test reports, tracking follow-up calls, and coordinating doctor triage is slow and error-prone.
- **The Solution**: CRTracker automates report ingestion, flags critical values, generates call cards with strict PII segregation, and streamlines doctor-caller workflows.

---

# Architecture & Tech Stack
- **Backend**: Python 3, FastAPI, SQLAlchemy, Alembic, SQLite (local) / PostgreSQL (production).
- **Frontend**: Next.js, React, TypeScript, Tailwind CSS.
- **Background Worker**: Automated pipeline (fetch, read, flag, patient link, follow-up generation).

---

# Security & Compliance
- **Server-Side RBAC**: Pinned role matrix (`anonymous`, `caller`, `doctor`, `admin`) tested across 62 API routes.
- **PII & Data Isolation**: Callers see zero clinical data. Mobile numbers hashed; lab reports encrypted at rest (`storage/`).
- **Input & Header Defenses**: File upload size limits (5 MB), spreadsheet formula escaping, strict CSP, HSTS, and API cache control.

---

# Free Cloud Deployment
- **Stack**: Cloudflare Workers (static site + 2-min cron trigger) + Render (FastAPI backend) + Supabase (PostgreSQL database).
- **Zero-Cost Scaling**: Designed to run entirely on free tiers with automated background ticking and secure shared secrets (`EDGE_SECRET`).

---

# Validation & Status
- **Test Suite**: 199+ backend unit and security tests passing successfully (`pytest`).
- **Frontend Build**: Optimized Next.js production build passing with zero errors.
- **Next Steps**: Complete pre-launch checklist (`docs/SECURITY.md`), database disk encryption, and independent pen-testing prior to live patient data ingestion.
