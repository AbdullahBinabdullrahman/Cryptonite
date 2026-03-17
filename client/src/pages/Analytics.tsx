/**
 * Analytics.tsx — Retro pixel/terminal AI agent analytics dashboard
 * Full-screen CRT-style stats with per-asset breakdown, hourly heatmap,
 * PnL curve, streaks, and signal accuracy metrics.
 */

import React, { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

// ── Palette ────────────────────────────────────────────────────────────────────
const C = {
  green:   "hsl(120 100% 55%)",
  green2:  "hsl(120 100% 40%)",
  green3:  "hsl(120 60% 30%)",
  amber:   "hsl(45 100% 60%)",
  cyan:    "hsl(175 90% 55%)",
  red:     "hsl(0 90% 60%)",
  magenta: "hsl(300 90% 60%)",
  blue:    "hsl(210 90% 60%)",
  dim:     "hsl(120 30% 28%)",
  dimmer:  "hsl(120 20% 14%)",
  bg:      "hsl(220 20% 3%)",
  bg2:     "hsl(220 20% 5%)",
  bg3:     "hsl(220 20% 7%)",
};

const ASSET_COLOR: Record<string, string> = {
  BTC: C.amber,
  ETH: C.blue,
  SOL: C.magenta,
  OTHER: C.dim,
};

// ── Helpers ────────────────────────────────────────────────────────────────────
const px = (s: string | number) => ({ fontFamily: "var(--font-pixel)", fontSize: typeof s === "number" ? `${s}rem` : s } as React.CSSProperties);
const mono = (s: string | number) => ({ fontFamily: "var(--font-mono)", fontSize: typeof s === "number" ? `${s}rem` : s } as React.CSSProperties);
const glow = (col: string) => ({ textShadow: `0 0 8px ${col}80` });

function Bar({ pct, color, height = 8 }: { pct: number; color: string; height?: number }) {
  return (
    <div style={{ width: "100%", height, background: C.dimmer, borderRadius: 1, overflow: "hidden" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", background: color, transition: "width 0.6s ease", boxShadow: `0 0 6px ${color}80` }} />
    </div>
  );
}

function StatBox({ label, value, sub, color = C.green }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.dimmer}`, padding: "0.6rem 0.75rem", flex: 1, minWidth: 0 }}>
      <div style={{ ...px("0.38rem"), color: C.dim, letterSpacing: "0.08em", marginBottom: "0.3rem" }}>{label}</div>
      <div style={{ ...mono("0.85rem"), color, fontWeight: 700, ...glow(color), lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ ...mono("0.52rem"), color: C.dim, marginTop: "0.2rem" }}>{sub}</div>}
    </div>
  );
}

// ── ASCII bar chart ────────────────────────────────────────────────────────────
function AsciiBarChart({ data, valueKey, labelKey, colorFn, height = 80 }:
  { data: any[]; valueKey: string; labelKey: string; colorFn?: (d: any) => string; height?: number }) {
  const max = Math.max(...data.map(d => Math.abs(d[valueKey])), 0.001);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height, width: "100%" }}>
      {data.map((d, i) => {
        const val = d[valueKey] as number;
        const pct = Math.abs(val) / max * 100;
        const col = colorFn ? colorFn(d) : (val >= 0 ? C.green : C.red);
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 2, cursor: "default" }}
            title={`${d[labelKey]}: ${val > 0 ? "+" : ""}${typeof val === "number" ? val.toFixed(2) : val}`}>
            <div style={{ width: "100%", height: `${pct}%`, minHeight: val !== 0 ? 2 : 0, background: col, boxShadow: `0 0 4px ${col}60`, transition: "height 0.4s ease" }} />
          </div>
        );
      })}
    </div>
  );
}

// ── Heatmap cell ───────────────────────────────────────────────────────────────
function HeatCell({ trades, winRate, pnl, hour }: { trades: number; winRate: number; pnl: number; hour: number }) {
  const intensity = Math.min(1, trades / 10);
  const col = pnl > 0 ? C.green : pnl < 0 ? C.red : C.dimmer;
  const bg = trades === 0 ? C.bg3 : `hsla(${pnl > 0 ? "120" : "0"}, 80%, 35%, ${0.1 + intensity * 0.5})`;
  return (
    <div title={`${hour}:00 — ${trades} trades | WR: ${winRate.toFixed(0)}% | PnL: $${pnl.toFixed(2)}`}
      style={{ flex: 1, minWidth: 0, height: 28, background: bg, border: `1px solid ${C.dimmer}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "default", transition: "background 0.3s" }}>
      <div style={{ ...mono("0.42rem"), color: trades > 0 ? col : C.dimmer }}>{trades > 0 ? trades : "·"}</div>
    </div>
  );
}

// ── PnL Sparkline ──────────────────────────────────────────────────────────────
function PnlSparkline({ series }: { series: { pnl: number; date: string }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !series.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const vals = series.map(s => s.pnl);
    const min = Math.min(...vals, 0);
    const max = Math.max(...vals, 0.001);
    const range = max - min || 1;
    const toY = (v: number) => H - ((v - min) / range) * (H - 10) - 5;
    const toX = (i: number) => (i / Math.max(vals.length - 1, 1)) * W;
    // Zero line
    ctx.strokeStyle = `hsl(120 20% 20%)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, toY(0)); ctx.lineTo(W, toY(0)); ctx.stroke();
    ctx.setLineDash([]);
    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "hsla(120,100%,55%,0.25)");
    grad.addColorStop(1, "hsla(120,100%,55%,0)");
    ctx.beginPath();
    vals.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    // Line
    ctx.strokeStyle = C.green; ctx.lineWidth = 1.5;
    ctx.beginPath();
    vals.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
    ctx.stroke();
  }, [series]);
  return <canvas ref={canvasRef} width={400} height={80} style={{ width: "100%", height: 80, display: "block" }} />;
}

// ── Boot lines ─────────────────────────────────────────────────────────────────
const BOOT = [
  { t: "▶ INITIALIZING ANALYTICS ENGINE v2.0", c: C.green },
  { t: "▶ LOADING TRADE HISTORY DATABASE...", c: C.cyan },
  { t: "▶ COMPUTING SIGNAL ACCURACY METRICS...", c: C.cyan },
  { t: "▶ RENDERING HEATMAP + PNL CURVES...", c: C.green2 },
  { t: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", c: C.dimmer },
];

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Analytics() {
  const [bootDone, setBootDone] = useState(false);
  const [bootIdx, setBootIdx] = useState(0);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/analytics"],
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (bootIdx < BOOT.length) {
      const t = setTimeout(() => setBootIdx(i => i + 1), 120);
      return () => clearTimeout(t);
    } else {
      setTimeout(() => setBootDone(true), 200);
    }
  }, [bootIdx]);

  const s = data?.summary;
  const assets: any[] = data?.assets || [];
  const heatmap: any[] = data?.hourlyHeatmap || [];
  const daily: any[] = data?.dailySeries || [];

  // Best/worst hour
  const bestHour = heatmap.reduce((best, h) => h.pnl > (best?.pnl ?? -Infinity) ? h : best, null);
  const worstHour = heatmap.reduce((worst, h) => h.pnl < (worst?.pnl ?? Infinity) ? h : worst, null);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.green, fontFamily: "var(--font-mono)", padding: "0.75rem", position: "relative", overflowX: "hidden" }}>
      {/* Scanlines */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 4px)" }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ borderBottom: `1px solid ${C.dimmer}`, paddingBottom: "0.5rem", marginBottom: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ ...px("0.65rem"), color: C.green, letterSpacing: "0.12em", ...glow(C.green) }}>◈ ANALYTICS TERMINAL</div>
            <div style={{ ...mono("0.55rem"), color: C.dim, marginTop: "0.15rem" }}>AI AGENT PERFORMANCE · SIGNAL ACCURACY · PNL METRICS</div>
          </div>
          <div style={{ ...mono("0.52rem"), color: C.dimmer }}>{new Date().toUTCString().slice(0, 25)}</div>
        </div>

        {/* Boot sequence */}
        {!bootDone && (
          <div style={{ marginBottom: "1rem" }}>
            {BOOT.slice(0, bootIdx).map((b, i) => (
              <div key={i} style={{ ...px("0.42rem"), color: b.c, lineHeight: 2, letterSpacing: "0.06em", ...glow(b.c) }}>{b.t}</div>
            ))}
            {bootIdx < BOOT.length && <span style={{ ...mono("0.65rem"), color: C.green }} className="blink">█</span>}
          </div>
        )}

        {isLoading && bootDone && (
          <div style={{ ...px("0.45rem"), color: C.dim, letterSpacing: "0.08em" }}>LOADING DATA<span className="blink">_</span></div>
        )}

        {bootDone && s && (
          <>
            {/* ── Summary row ── */}
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              <StatBox label="TOTAL TRADES" value={`${s.totalTrades}`} sub={`${s.wins}W / ${s.losses}L / ${s.open} OPEN`} color={C.cyan} />
              <StatBox label="WIN RATE" value={`${s.winRate.toFixed(1)}%`} sub={`TARGET: >55%`} color={s.winRate >= 55 ? C.green : s.winRate >= 45 ? C.amber : C.red} />
              <StatBox label="TOTAL P&L" value={`${s.totalPnl >= 0 ? "+" : ""}$${s.totalPnl.toFixed(2)}`} sub={`${s.allTimeReturn >= 0 ? "+" : ""}${s.allTimeReturn.toFixed(2)}% return`} color={s.totalPnl >= 0 ? C.green : C.red} />
              <StatBox label="AVG BET SIZE" value={`$${s.avgBetSize.toFixed(2)}`} sub={`AVG EDGE: ${s.avgEdge.toFixed(1)}%`} color={C.amber} />
              <StatBox label="BEST STREAK" value={`${s.maxWinStreak}W`} sub={`MAX LOSS: ${s.maxLossStreak}L`} color={C.green} />
            </div>

            {/* ── PnL curve ── */}
            <div style={{ background: C.bg2, border: `1px solid ${C.dimmer}`, padding: "0.6rem 0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ ...px("0.42rem"), color: C.dim, letterSpacing: "0.08em", marginBottom: "0.4rem" }}>▸ PNL CURVE (ALL-TIME)</div>
              {daily.length > 1 ? <PnlSparkline series={daily} /> : (
                <div style={{ ...mono("0.6rem"), color: C.dimmer, height: 80, display: "flex", alignItems: "center" }}>NOT ENOUGH DATA YET</div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.3rem" }}>
                <div style={{ ...mono("0.5rem"), color: C.dim }}>START: ${s.startBalance.toFixed(2)}</div>
                <div style={{ ...mono("0.5rem"), color: s.totalPnl >= 0 ? C.green : C.red }}>NOW: ${s.balance.toFixed(2)}</div>
              </div>
            </div>

            {/* ── Per-asset breakdown ── */}
            <div style={{ background: C.bg2, border: `1px solid ${C.dimmer}`, padding: "0.6rem 0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ ...px("0.42rem"), color: C.dim, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>▸ ASSET BREAKDOWN</div>
              {assets.length === 0 && <div style={{ ...mono("0.6rem"), color: C.dimmer }}>NO TRADES YET</div>}
              {assets.map(a => (
                <div key={a.asset} style={{ marginBottom: "0.5rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
                    <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                      <span style={{ ...px("0.45rem"), color: ASSET_COLOR[a.asset] || C.dim, letterSpacing: "0.08em", ...glow(ASSET_COLOR[a.asset] || C.dim) }}>{a.asset}</span>
                      <span style={{ ...mono("0.55rem"), color: C.dim }}>{a.trades} trades · {a.wins}W/{a.losses}L</span>
                    </div>
                    <div style={{ display: "flex", gap: "1rem" }}>
                      <span style={{ ...mono("0.58rem"), color: a.winRate >= 50 ? C.green : C.red }}>{a.winRate.toFixed(1)}% WR</span>
                      <span style={{ ...mono("0.58rem"), color: a.pnl >= 0 ? C.green : C.red }}>{a.pnl >= 0 ? "+" : ""}${a.pnl.toFixed(2)}</span>
                    </div>
                  </div>
                  <Bar pct={a.winRate} color={ASSET_COLOR[a.asset] || C.dim} height={6} />
                </div>
              ))}
            </div>

            {/* ── Hourly heatmap ── */}
            <div style={{ background: C.bg2, border: `1px solid ${C.dimmer}`, padding: "0.6rem 0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                <div style={{ ...px("0.42rem"), color: C.dim, letterSpacing: "0.08em" }}>▸ HOURLY TRADE HEATMAP (UTC)</div>
                {bestHour && <div style={{ ...mono("0.5rem"), color: C.dim }}>BEST: {bestHour.hour}:00 · WORST: {worstHour?.hour}:00</div>}
              </div>
              <div style={{ display: "flex", gap: "2px", marginBottom: "0.25rem" }}>
                {heatmap.map(h => <HeatCell key={h.hour} {...h} />)}
              </div>
              {/* Hour labels */}
              <div style={{ display: "flex", gap: "2px" }}>
                {heatmap.map(h => (
                  <div key={h.hour} style={{ flex: 1, ...mono("0.38rem"), color: C.dimmer, textAlign: "center" }}>
                    {h.hour % 6 === 0 ? `${h.hour}h` : ""}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "1rem", marginTop: "0.3rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <div style={{ width: 10, height: 10, background: C.green, opacity: 0.6 }} />
                  <span style={{ ...mono("0.48rem"), color: C.dim }}>PROFITABLE HOUR</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <div style={{ width: 10, height: 10, background: C.red, opacity: 0.6 }} />
                  <span style={{ ...mono("0.48rem"), color: C.dim }}>LOSING HOUR</span>
                </div>
              </div>
            </div>

            {/* ── Hourly PnL bars ── */}
            <div style={{ background: C.bg2, border: `1px solid ${C.dimmer}`, padding: "0.6rem 0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ ...px("0.42rem"), color: C.dim, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>▸ HOURLY PNL DISTRIBUTION</div>
              <AsciiBarChart
                data={heatmap}
                valueKey="pnl"
                labelKey="hour"
                colorFn={d => d.pnl >= 0 ? C.green : C.red}
                height={72}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.25rem" }}>
                <span style={{ ...mono("0.45rem"), color: C.dimmer }}>0:00 UTC</span>
                <span style={{ ...mono("0.45rem"), color: C.dimmer }}>12:00 UTC</span>
                <span style={{ ...mono("0.45rem"), color: C.dimmer }}>23:00 UTC</span>
              </div>
            </div>

            {/* ── Signal engine status ── */}
            <div style={{ background: C.bg2, border: `1px solid ${C.dimmer}`, padding: "0.6rem 0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ ...px("0.42rem"), color: C.dim, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>▸ AI SIGNAL ENGINE STATUS</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                {[
                  { label: "EMA CROSS FILTER", status: "ACTIVE", color: C.green },
                  { label: "POLYMARKET CROWD", status: "ACTIVE", color: C.green },
                  { label: "OB IMBALANCE SIGNAL", status: "ACTIVE", color: C.green },
                  { label: "WIN-RATE CIRCUIT BREAKER", status: "ACTIVE", color: C.green },
                  { label: "KELLY POSITION SIZING", status: "ACTIVE", color: C.green },
                  { label: "CLOB ENGINE", status: "DISABLED", color: C.dim },
                ].map(item => (
                  <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.3rem 0.5rem", background: C.bg3, border: `1px solid ${C.dimmer}` }}>
                    <span style={{ ...px("0.38rem"), color: C.dim, letterSpacing: "0.06em" }}>{item.label}</span>
                    <span style={{ ...mono("0.5rem"), color: item.color, ...glow(item.color) }}>● {item.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Risk metrics ── */}
            <div style={{ background: C.bg2, border: `1px solid ${C.dimmer}`, padding: "0.6rem 0.75rem" }}>
              <div style={{ ...px("0.42rem"), color: C.dim, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>▸ RISK METRICS</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
                <div>
                  <div style={{ ...px("0.38rem"), color: C.dim, marginBottom: "0.15rem" }}>ACCOUNT RISK/DAY</div>
                  <div style={{ ...mono("0.7rem"), color: C.amber }}>~${(s.avgBetSize * 20).toFixed(0)} MAX</div>
                  <div style={{ ...mono("0.48rem"), color: C.dim }}>20 trades × ${s.avgBetSize.toFixed(0)}</div>
                </div>
                <div>
                  <div style={{ ...px("0.38rem"), color: C.dim, marginBottom: "0.15rem" }}>STOP LOSS</div>
                  <div style={{ ...mono("0.7rem"), color: C.red }}>10% / DAY</div>
                  <div style={{ ...mono("0.48rem"), color: C.dim }}>${(s.balance * 0.1).toFixed(0)} MAX LOSS</div>
                </div>
                <div>
                  <div style={{ ...px("0.38rem"), color: C.dim, marginBottom: "0.15rem" }}>BREAKEVEN WR</div>
                  <div style={{ ...mono("0.7rem"), color: C.cyan }}>~50%</div>
                  <div style={{ ...mono("0.48rem"), color: C.dim }}>CURRENT: {s.winRate.toFixed(1)}%</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
