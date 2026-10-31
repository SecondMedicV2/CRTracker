// Cloudflare Worker (free plan). Three jobs:
//  1. serves the static website (./out) - handled by the "assets" binding, no code runs for pages;
//  2. passes /api/* to the Python backend, adding a secret so the backend refuses anyone who bypasses us;
//  3. every few minutes (cron) tells the backend to do its background work (fetch, read, follow-ups, call cards).
// Settings: BACKEND_URL (a normal variable) and EDGE_SECRET (a secret, set with `wrangler secret put EDGE_SECRET`).

import demo from "./demo-data.json";

// Demo mode: while no backend is connected, the Worker answers /api/v1 from recorded sample data (made-up mock-lab
// patients, see backend/scripts/capture_demo.py). Any email/password signs in; nothing is saved; no real data involved.
const DEMO_COOKIE = "crt_demo=1";
function demoApi(request, url) {
  const path = url.pathname.replace(/^\/api\/v1/, "").replace(/\/$/, "");
  const signedIn = (request.headers.get("cookie") || "").includes(DEMO_COOKIE);
  const reply = (status, body, cookie) => {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Demo": "1" };
    if (cookie) headers["Set-Cookie"] = cookie;
    return new Response(JSON.stringify(body), { status, headers });
  };
  if (url.pathname === "/api/health") return reply(200, { ok: true, demo: true });
  if (path === "/auth/login" && request.method === "POST")
    return reply(200, demo["/auth/me"], DEMO_COOKIE + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600");
  if (path === "/auth/logout") return reply(200, { ok: true }, DEMO_COOKIE.split("=")[0] + "=; Path=/; Max-Age=0");
  if (!signedIn) return reply(401, { detail: "Not signed in" });
  if (request.method !== "GET") return reply(403, { detail: "Demo mode: changes are not saved." });
  const hit = demo[path];
  return hit === undefined ? reply(404, { detail: "Not part of the demo data" }) : reply(200, hit);
}

const json = (status, detail) =>
  new Response(JSON.stringify({ detail }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!env.BACKEND_URL || !env.EDGE_SECRET) return demoApi(request, url);

    const upstream = new Request(new URL(url.pathname + url.search, env.BACKEND_URL), request);
    upstream.headers.set("X-Edge-Secret", env.EDGE_SECRET);
    upstream.headers.set("X-Client-IP", request.headers.get("cf-connecting-ip") ?? ""); // for the login rate limit and audit log
    try {
      const res = await fetch(upstream, { redirect: "manual" });
      const out = new Response(res.body, res);
      out.headers.set("X-Content-Type-Options", "nosniff");
      return out;
    } catch {
      return json(502, "Cannot reach the server. It may be waking up: try again in a minute.");
    }
  },

  async scheduled(_event, env, ctx) {
    if (!env.BACKEND_URL || !env.EDGE_SECRET) return;
    // A free backend host sleeps when idle: this call also wakes it. waitUntil keeps the Worker alive for the reply.
    ctx.waitUntil(fetch(new URL("/api/internal/tick", env.BACKEND_URL), { method: "POST", headers: { "X-Edge-Secret": env.EDGE_SECRET } }).catch(() => {}));
  },
};
