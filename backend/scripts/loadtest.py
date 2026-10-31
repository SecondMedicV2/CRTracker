"""Load test for the Phase 9 targets: ~500 orders/day and a 100-order bulk import.

Run from backend/:  python -m scripts.loadtest [orders=500]
Uses a throw-away SQLite database in a temp folder and the mock lab (so lab and AI latency are NOT included:
real Thyrocare/LLM calls will dominate the per-order time). Prints a table; exits 1 if a target is missed.
"""
import os
import random
import statistics
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

N = int(sys.argv[1]) if len(sys.argv) > 1 else 500
TMP = tempfile.mkdtemp(prefix="crt-load-")
from cryptography.fernet import Fernet  # noqa: E402

os.environ.update(SECRET_KEY="load-test-secret-key-at-least-32-chars!", DATABASE_URL=f"sqlite:///{TMP}/load.db", LAB_PROVIDER="mock",
                  STORAGE_DIR=f"{TMP}/files", FILE_ENCRYPTION_KEY=Fernet.generate_key().decode())

from fastapi.testclient import TestClient  # noqa: E402

from app import assign, security, worker  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.labs import mock  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, Doctor, User  # noqa: E402
from app.seed import seed  # noqa: E402

security.SCRYPT_N = 2**4  # login cost is not what we measure here
FIRST = ["Asha", "Bimal", "Chitra", "Dev", "Esha", "Farhan", "Gita", "Hari", "Indu", "Jaya", "Kabir", "Lata", "Manoj", "Nisha", "Om", "Pooja"]
LAST = ["Rao", "Das", "Menon", "Patel", "Gupta", "Khan", "Iyer", "Nair", "Shah", "Kapoor", "Joshi", "Mishra", "Verma", "Bose", "Reddy", "Singh"]


def varied_report(order_id: str, collected):
    """Every order is a different person with plausible values (the stock mock gives everyone the same patient)."""
    rnd = random.Random(order_id)
    i = int(order_id.split("-")[-1])
    return {"order_id": order_id, "lab": "mock",
            "patient": {"name": f"{FIRST[i % 16]} {LAST[(i // 16) % 16]}{' ' + 'ABCDEFGHIJ'[i // 256] if i >= 256 else ''}",
                        "age": 25 + rnd.randint(0, 50), "gender": rnd.choice("MF"), "mobile": f"9{800000000 + i}"},
            "collected_on": collected.isoformat(), "reported_on": (collected + timedelta(days=1)).isoformat(),
            "parameters": [
                {"name": "Glycosylated Hemoglobin", "value": str(round(rnd.uniform(4.8, 9.0), 1)), "unit": "%", "ref_range": "<5.7"},
                {"name": "LDL Cholesterol", "value": str(rnd.randint(80, 190)), "unit": "mg/dl", "ref_range": "<100"},
                {"name": "Haemoglobin", "value": str(round(rnd.uniform(9, 16), 1)), "unit": "g/dl", "ref_range": "13 - 17"},
                {"name": "TSH", "value": str(round(rnd.uniform(0.2, 8), 2)), "unit": "uIU/mL", "ref_range": "0.4 - 4.2"}]}


mock.sample_report = varied_report

Base.metadata.create_all(engine)
with SessionLocal() as db:
    seed(db)
    db.add(User(name="Admin", email="a@x.com", role="ADMIN", password_hash=security.hash_password("long-enough-pass-1")))
    for k in range(3):
        db.add(Doctor(name=f"Dr {k}", languages=["en"], priority_order=10 * (k + 1)))
    db.commit()

client = TestClient(app)
assert client.post("/api/v1/auth/login", json={"email": "a@x.com", "password": "long-enough-pass-1"}).status_code == 200
rows = []


def timed(label, fn, target=None, per=None):
    t = time.perf_counter()
    out = fn()
    s = time.perf_counter() - t
    rows.append((label, s, per, target))
    return out


def latency(label, path, reps=7, target=1.0):
    ts = []
    for _ in range(reps):
        t = time.perf_counter()
        r = client.get(path)
        ts.append(time.perf_counter() - t)
        assert r.status_code == 200, (path, r.status_code, r.text[:200])
    rows.append((f"GET {label}", statistics.median(ts), max(ts), target))


# ---- 100-order bulk import (paste) ----
hundred = "\n".join(f"LT-{i:05d}" for i in range(100))
r = timed("bulk import of 100 pasted order IDs", lambda: client.post("/api/v1/imports/manual", json={"text": hundred}), target=5.0)
assert r.json()["new"] == 100
r = timed("re-paste the same 100 (all duplicates)", lambda: client.post("/api/v1/imports/manual", json={"text": hundred}), target=5.0)
assert r.json()["duplicate"] == 100

# ---- the rest of the day's orders ----
rest = "\n".join(f"LT-{i:05d}" for i in range(100, N))
r = timed(f"import the other {N - 100} orders", lambda: client.post("/api/v1/imports/manual", json={"text": rest}))
assert r.json()["new"] == N - 100


def drain(fn):
    total = 0
    while True:
        with SessionLocal() as db:
            n = fn(db)
        if not n:
            return total
        total += n


fetched = timed(f"worker: fetch {N} reports", lambda: drain(worker.tick))
ext = timed(f"worker: extract + flag + link patient + follow-up ({N})", lambda: drain(worker.extract_tick))
rows[-2:] = [(l, s, s / N * 1000, t) for l, s, _, t in rows[-2:]]
cards = timed("worker: pre-generate call cards", lambda: drain(lambda db: worker.callcard_tick(db, 100)))
rows[-1] = (f"worker: pre-generate call cards ({cards})", rows[-1][1], rows[-1][1] / max(cards, 1) * 1000, None)
with SessionLocal() as db:
    timed("worker: cascade check", lambda: assign.cascade_tick(db))

# ---- what people wait for on screen ----
latency("/followups (queue)", "/api/v1/followups")
latency("/followups/summary", "/api/v1/followups/summary")
latency("/followups?view=overdue", "/api/v1/followups?view=overdue")
latency("/doctor/queue (admin, all)", "/api/v1/doctor/queue")
latency("/reports", "/api/v1/reports")
latency("/patients?q=asha", "/api/v1/patients?q=asha")
latency("/dashboard", "/api/v1/dashboard", target=2.0)
latency("/orders", "/api/v1/orders")
latency("/exports/followups.csv", "/api/v1/exports/followups.csv", target=3.0)
fid = client.get("/api/v1/followups").json()[0]["id"]
latency("/followups/{id} (detail)", f"/api/v1/followups/{fid}")
latency("/followups/{id}/caller-card", f"/api/v1/followups/{fid}/caller-card")
pid = client.get("/api/v1/patients?q=asha").json()[0]["id"]
latency("/trends/{patient}", f"/api/v1/trends/{pid}?codes=HBA1C,LDL")

# ---- report ----
print(f"\nLoad test: {N} orders, throw-away SQLite DB, mock lab (no network or AI latency)\n")
print(f"{'step':<58}{'seconds':>9}{'ms/order':>10}{'max s':>8}{'target s':>10}")
bad = 0
for label, s, extra, target in rows:
    per = f"{extra:.1f}" if label.startswith("worker") and extra is not None else ""
    mx = f"{extra:.2f}" if label.startswith("GET") else ""
    miss = target is not None and s > target
    bad += miss
    print(f"{label:<58}{s:>9.2f}{per:>10}{mx:>8}{(f'{target:.1f}' if target else ''):>10}{'  <-- SLOW' if miss else ''}")
print("\nRESULT:", "all targets met" if not bad else f"{bad} step(s) over target")
sys.exit(1 if bad else 0)
