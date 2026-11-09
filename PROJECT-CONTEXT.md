# CRTracker project context

- **Purpose** — CRTracker turns lab reports into follow-up queues and call cards for administrators, callers, and doctors.
- **Stack** — Next.js, React, TypeScript, and Tailwind on the frontend. FastAPI, SQLAlchemy, Alembic, and a Python worker on the backend. Local runs can use SQLite. The hosting design uses Cloudflare, Render, and Supabase Postgres.
- **Current phase** — The core workflow runs with a mock lab and structured test reports. The workspace has had a responsive UI pass. Live Thyrocare integration, PDF intake and extraction, and clinical sign-off are pending.
- **Constraints** — Local development and demos use synthetic data. Patient privacy, server-side role checks, and IST business dates apply across the app.
- **Definition of done** — The affected role can complete the workflow in the browser at desktop and phone widths. Type checks, builds, and relevant backend tests pass. Any production use of medical rules requires clinical sign-off.
