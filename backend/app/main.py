import logging
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import env
from .routers import admin, auth, callcards, followups, imports, insights, patients, reports, workflow

log = logging.getLogger("api")
app = FastAPI(title="CRTracker", docs_url="/api/docs", openapi_url="/api/openapi.json")
for r in (auth, admin, imports, reports, patients, followups, callcards, workflow, insights):
    app.include_router(r.router, prefix="/api/v1")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@app.middleware("http")
async def protect(request: Request, call_next):
    # Defence in depth on top of SameSite=Lax cookies: a browser request that changes data must come from our own site.
    origin = request.headers.get("origin")
    if request.method not in SAFE_METHODS and origin:
        host = urlparse(origin).netloc
        if origin not in {o.strip() for o in env.allowed_origins.split(",")} and host != request.headers.get("host"):
            return JSONResponse({"detail": "Cross-site request refused"}, status_code=403)
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/v1"):
        resp.headers["Cache-Control"] = "no-store"  # patient data must not sit in a shared cache
    return resp


@app.exception_handler(Exception)
async def unexpected(request: Request, exc: Exception):
    # log the kind of failure and where, never the message: it may contain patient data
    log.error("unhandled %s on %s %s", type(exc).__name__, request.method, request.url.path)
    return JSONResponse({"detail": "Something went wrong. Please try again."}, status_code=500)


@app.get("/api/health")
def health():
    return {"ok": True}
