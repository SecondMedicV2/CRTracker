"use client";
import { useRouter } from "next/navigation";
import { useRef } from "react";

// Plain SVG on purpose: no chart library, and presentation attributes (not CSS classes) so the
// picture can be exported as a PNG exactly as it looks on screen.
const W = 640, H = 230, L = 52, R = 16, T = 16, B = 34;
const OUT = "#b91c1c", OK = "#334155", BAND = "#bbf7d0";

export default function TrendChart({ s }: { s: any }) {
  const router = useRouter();
  const svg = useRef<SVGSVGElement>(null);
  const pts = s.points.filter((p: any) => p.date);
  if (pts.length === 0) return <div className="rounded bg-white p-3 text-sm shadow">{s.name}: no results in this period.</div>;

  const t = (d: string) => new Date(d).getTime();
  const t0 = Math.min(...pts.map((p: any) => t(p.date))), t1 = Math.max(...pts.map((p: any) => t(p.date)));
  const vals = pts.map((p: any) => p.value);
  const b = s.band ?? {};
  let lo = Math.min(...vals, b.low ?? Infinity), hi = Math.max(...vals, b.high ?? -Infinity);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const x = (d: string) => (t1 === t0 ? (L + W - R) / 2 : L + ((t(d) - t0) / (t1 - t0)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const bandTop = b.high != null ? y(Math.min(b.high, hi)) : T, bandBottom = b.low != null ? y(Math.max(b.low, lo)) : H - B;
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  const d = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  function exportPng() {
    const el = svg.current!;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(el)], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = W * 2; c.height = H * 2;
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob!); a.download = `${s.code}-trend.png`; a.click();
        URL.revokeObjectURL(url);
      });
    };
    img.src = url;
  }

  return (
    <figure className="rounded bg-white p-3 shadow print:shadow-none">
      <figcaption className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium">{s.name}{s.unit && ` (${s.unit})`}
          {s.band && <span className="ml-2 font-normal text-slate-500">
            normal {b.low != null ? fmt(b.low) : "up to"}{b.low != null && b.high != null ? " to " : ""}{b.high != null ? fmt(b.high) : " and above"}
            {s.band_source === "admin_table" && " (admin table)"}</span>}</span>
        <button className="text-xs underline print:hidden" onClick={exportPng}>Save image</button>
      </figcaption>
      <svg ref={svg} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="group"
        aria-label={`${s.name} over time: ${pts.length} results`} fontFamily="sans-serif" fontSize="11">
        <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
        {s.band && <rect x={L} y={bandTop} width={W - L - R} height={Math.max(bandBottom - bandTop, 0)} fill={BAND} opacity="0.55" />}
        <line x1={L} y1={T} x2={L} y2={H - B} stroke="#94a3b8" />
        <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="#94a3b8" />
        <text x={L - 6} y={y(hi - pad) + 4} textAnchor="end" fill="#475569">{fmt(hi - pad)}</text>
        <text x={L - 6} y={y(lo + pad) + 4} textAnchor="end" fill="#475569">{fmt(lo + pad)}</text>
        <text x={L} y={H - 12} fill="#475569">{d(pts[0].date)}</text>
        {pts.length > 1 && <text x={W - R} y={H - 12} textAnchor="end" fill="#475569">{d(pts[pts.length - 1].date)}</text>}
        <polyline fill="none" stroke="#64748b" strokeWidth="1.5" points={pts.map((p: any) => `${x(p.date)},${y(p.value)}`).join(" ")} />
        {pts.map((p: any, i: number) => {
          const out = p.flag === "LOW" || p.flag === "HIGH";
          const open = () => router.push(`/reports/${p.report_id}`);
          return (
            <circle key={i} cx={x(p.date)} cy={y(p.value)} r="6" fill={out ? OUT : OK} stroke="#fff" strokeWidth="1.5" tabIndex={0}
              role="link" style={{ cursor: "pointer" }} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}>
              <title>{`${d(p.date)}: ${fmt(p.value)} ${s.unit}${out ? ` (${p.flag.toLowerCase()}${p.severity ? `, ${p.severity}` : ""})` : ""} · order ${p.order_id} · click to open the report`}</title>
            </circle>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{s.name} results</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Value</th><th scope="col">Flag</th><th scope="col">Order</th></tr></thead>
        <tbody>{pts.map((p: any, i: number) => <tr key={i}><td>{d(p.date)}</td><td>{fmt(p.value)} {s.unit}</td><td>{p.flag || "normal"}</td><td>{p.order_id}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
