"""Records GET answers from a LOCAL backend (mock lab data only) into frontend/demo-data.json for the Worker's demo mode.
Run: python -m scripts.capture_demo   (backend on :8000, ADMIN_* from .env)."""
import http.cookiejar, json, pathlib, urllib.request
from datetime import date, timedelta

from app.config import env as s

BASE = "http://127.0.0.1:8000/api/v1"
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:8000"})
    try:
        return json.load(op.open(req))
    except Exception:
        return None


assert call("/auth/login", {"email": s.admin_email, "password": s.admin_password}), "login failed"

out = {}
def grab(path, key=None):
    data = call(path)
    if data is not None:
        out[key or path.split("?")[0]] = data
    return data

today = date.today()
grab("/auth/me")
grab(f"/dashboard?from={today - timedelta(days=29)}&to={today}", "/dashboard")
for p in ["/notifications", "/orders", "/followups/summary", "/doctors", "/users", "/reports", "/patients",
          "/rules", "/settings", "/identity-reviews", "/retest-recommendations", "/audit", "/call-cards"]:
    grab(p)
for kind in ("queue",):
    grab(f"/followups?view={kind}", "/followups")
for f in (out.get("/followups") or []):
    i = f["id"]
    for sub in ("", "/comments", "/workflow", "/call-card", "/caller-card", "/calls"):
        grab(f"/followups/{i}{sub}")
for r in (out.get("/reports") or []):
    grab(f"/reports/{r['id']}")
for p in (out.get("/patients") or []):
    pid = p["id"]
    grab(f"/patients/{pid}")
    params = grab(f"/trends/{pid}/parameters")
    codes = ",".join(x["code"] for x in params or [])
    grab(f"/trends/{pid}?codes={codes}&range=all", f"/trends/{pid}")
for k in ("test_catalogue", "buckets", "score_weights"):
    grab(f"/rules/{k}")

dest = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "demo-data.json"
dest.write_text(json.dumps(out, indent=0))
print(len(out), "endpoints recorded ->", dest)
for k in sorted(out):
    print(" ", k)
