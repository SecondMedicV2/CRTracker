# AGENTS.md — CRTracker Coding Agent Guide

This file provides core instructions, build/test commands, architectural guardrails, and security standards for AI coding agents working on the CRTracker repository.

## Quick Reference & Commands

- **Backend Tests**: `cd backend && .venv/Scripts/python -m pytest` (Runs 199+ unit and security tests)
- **Backend API**: `cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000`
- **Background Worker**: `cd backend && .venv/Scripts/python -m app.worker`
- **Frontend Build**: `cd frontend && npm install && npm run build`
- **Load Test**: `python -m scripts.loadtest 500`

---

## Architecture & Project Structure

- **Backend**: Python / FastAPI / SQLAlchemy / Alembic / SQLite (local) / PostgreSQL (production). Located in `backend/app/`.
- **Frontend**: Next.js / React / TypeScript / Tailwind CSS. Located in `frontend/app/` and `frontend/components/`.
- **Core Domain**: Turns lab reports into prepared follow-up call cards, risk analysis, and triage queues for administrators, callers, and doctors.

---

## Security Analysis & Compliance Standards (Focus Area)

CRTracker handles sensitive health data and follows strict security and privacy standards. When modifying code, adhere strictly to the following protocols:

1. **Server-Side Role Enforcement & Access Matrix**:
   - Every API endpoint must enforce role checks (`anonymous`, `caller`, `doctor`, `admin`).
   - `backend/tests/test_security.py` validates the complete RBAC matrix and will fail if a route is added without proper authorization definitions. Never bypass server-side checks.
2. **Patient Data Privacy & Masking**:
   - **Callers**: Must **never** see clinical data (reports, trends, clinical rules, drug/disease names, diagnosis digits). Follow-up rows hold only name, masked mobile, dates, and stage.
   - **AI Prompts**: Only send age, gender, test dates, and numeric values to AI models. **Never** include patient names or mobile numbers.
   - **Storage Encryption**: Lab reports are encrypted at rest (`storage/`). Mobile numbers are encrypted in the database with a separate keyed hash for searching/matching.
3. **Input Validation & Safety**:
   - Uploaded spreadsheet/PDF files must be bounded in size (5 MB limit) and parsed defensively to prevent memory exhaustion.
   - Spreadsheet exports must escape formulas starting with `=`, `+`, `-`, `@`.
4. **Audit Logging**:
   - All logins, failed logins, data views, edits, exports, reassignments, and erasures must be recorded in the audit log.
   - **Never** write patient PII (names, phone numbers, test values) into server logs or audit log detail fields.
5. **Security Headers & Configuration**:
   - Maintain strict security headers (CSP, `X-Frame-Options: DENY`, `nosniff`, `Cache-Control: no-store` on APIs).
   - In production mode (`COOKIE_SECURE=true`), `SECRET_KEY` must be at least 32 characters.

---

## Documentation Links

For deeper context, refer to the following documentation (Link, don't duplicate):
- [Security Review & Pre-Launch Checklist](docs/SECURITY.md)
- [Handover & Deployment Guide](docs/HANDOVER.md)
- [Acceptance Criteria](docs/ACCEPTANCE.md)
- [Architecture Decisions](docs/DECISIONS.md)
- [Project Context](PROJECT-CONTEXT.md)
