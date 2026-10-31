// Two ways to build the same app:
//   npm run build     -> normal Next.js server (local use). /api is proxied to the backend; headers set here.
//   npm run build:cf  -> static files in ./out for Cloudflare. /api proxying and security headers are done by
//                        worker.js and public/_headers instead, because a static export has no server.
const forCloudflare = process.env.npm_lifecycle_event === "build:cf";
const prod = process.env.NODE_ENV === "production";

// Next.js needs inline scripts/styles; everything else is locked to our own origin. (Relaxed in dev for hot reload.)
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${prod ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const common = { poweredByHeader: false };

export default forCloudflare
  ? { ...common, output: "export" }
  : {
      ...common,
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${process.env.BACKEND_URL ?? "http://127.0.0.1:8000"}/api/:path*` }];
      },
      async headers() {
        return [{
          source: "/:path*",
          headers: [
            { key: "Content-Security-Policy", value: csp },
            { key: "X-Frame-Options", value: "DENY" },
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "no-referrer" },
            { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
            ...(prod ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
          ],
        }];
      },
    };
