/**
 * Analytics.tsx — Retro pixel/terminal AI agent analytics dashboard
 * Shows: live strategy state (SCALP/DAY/SWING votes), per-asset indicators,
 * trade history metrics, hourly heatmap, PnL curve, signal accuracy.
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
  purple:  "hsl(270 80% 65%)",
  dim:     "hsl(120 30% 28%)",
  dimmer:  "hsl(120 20% 14%)",
  bg:      "hsl(220 20% 3%)",
  bg2:     "hsl(220 20% 5%)",
  bg3:     "hsl(220 20% 7%)",
};

const ASSET_COLOR: Record<string, string> = { BTC: C.amber, ETH: C.blue, SOL: C.magenta, OTHER: C.dim };
const MODE_COLOR:  Record<string, string> = { scalp: C.cyan, day: C.green, swing: C.amber };
const SESSION_COLOR: Record<string, string> = { US: C.green, EU: C.cyan, ASIA: C.purple };

// ── Style helpers ──────────────────────────────────────────────────────────────
const px   = (s: string | number): React.CSSProperties => ({ fontFamily: "var(--font-pixel)",  fontSize: typeof s === "number" ? `${s}rem` : s });
const mono = (s: string | number): React.CSSProperties => ({ fontFamily: "var(--font-mono)",   fontSize: typeof s === "number" ? `${s}rem` : s });
const glow = (col: string): React.CSSProperties => ({ textShadow: `0 0 8px ${col}80` });

// ── Reusable components ────────────────────────────────────────────────────────
function Bar({ pct, color, height = 6 }: { pct: number; color: string; height?: number }) {
  return (
    <div style={{ width: "100%", height, background: C.dimmer, borderRadius: 1, overflow: "hidden" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", background: color, transition: "width 0.5s ease", boxShadow: `0 0 4px ${color}60` }} />
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

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ ...px("0.44rem"), color: C.dim, letterSpacing: "0.1em", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span style={{ color: C.green3 }}>▸</span> {title}
    </div>
  );
}

function Card({ children, mb = true }: { children: React.ReactNode; mb?: boolean }) {
  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.dimmer}`, padding: "0.65rem 0.8rem", marginBottom: mb ? "0.7rem" : 0 }}>
      {children}
    </div>
  );
}

// ── ASCII bar chart ─────────────────────────────────────────────────────────────
function AsciiBarChart({ data, valueKey, labelKey, colorFn, height = 72 }:
  { data: any[]; valueKey: string; labelKey: string; colorFn?: (d: any) => string; height?: number }) {
  const max = Math.max(...data.map(d => Math.abs(d[valueKey])), 0.001);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height, width: "100%" }}>
      {data.map((d, i) => {
        const val = d[valueKey] as number;
        const pct = Math.abs(val) / max * 100;
        const col = colorFn ? colorFn(d) : (val >= 0 ? C.green : C.red);
        return (
          <div key={i} title={`${d[labelKey]}: ${val > 0 ? "+" : ""}${val.toFixed(2)}`}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 2, cursor: "default" }}>
            <div style={{ width: "100%", height: `${pct}%`, minHeight: val !== 0 ? 2 : 0, background: col, boxShadow: `0 0 3px ${col}60`, transition: "height 0.4s" }} />
          </div>
        );
      })}
    </div>
  );
}

// ── Heatmap cell ───────────────────────────────────────────────────────────────
function HeatCell({ trades, winRate, pnl, hour }: { trades: number; winRate: number; pnl: number; hour: number }) {
  const intensity = Math.min(1, trades / 8);
  const bg = trades === 0 ? C.bg3 : `hsla(${pnl > 0 ? "120" : "0"}, 80%, 35%, ${0.08 + intensity * 0.55})`;
  const col = pnl > 0 ? C.green : pnl < 0 ? C.red : C.dimmer;
  return (
    <div title={`${hour}:00 UTC — ${trades} trades | WR: ${winRate.toFixed(0)}% | PnL: $${pnl.toFixed(2)}`}
      style={{ flex: 1, minWidth: 0, height: 26, background: bg, border: `1px solid ${C.dimmer}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "default" }}>
      <div style={{ ...mono("0.42rem"), color: trades > 0 ? col : C.dimmer }}>{trades > 0 ? trades : "·"}</div>
    </div>
  );
}

// ── PnL Sparkline ──────────────────────────────────────────────────────────────
function PnlSparkline({ series }: { series: { pnl: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || !series.length) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const vals = series.map(s => s.pnl);
    const min = Math.min(...vals, 0), max = Math.max(...vals, 0.001);
    const range = max - min || 1;
    const toY = (v: number) => H - ((v - min) / range) * (H - 12) - 6;
    const toX = (i: number) => (i / Math.max(vals.length - 1, 1)) * W;
    ctx.strokeStyle = "hsl(120 20% 20%)"; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(0, toY(0)); ctx.lineTo(W, toY(0)); ctx.stroke(); ctx.setLineDash([]);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "hsla(120,100%,55%,0.2)"); grad.addColorStop(1, "hsla(120,100%,55%,0)");
    ctx.beginPath();
    vals.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = C.green; ctx.lineWidth = 1.5; ctx.beginPath();
    vals.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
    ctx.stroke();
  }, [series]);
  return <canvas ref={ref} width={600} height={80} style={{ width: "100%", height: 80, display: "block" }} />;
}

// ── Vote badge ─────────────────────────────────────────────────────────────────
function VoteBadge({ vote }: { vote: any }) {
  if (!vote) return <span style={{ ...mono("0.55rem"), color: C.dimmer }}>WARMING UP</span>;
  const col = vote.direction === "buy" ? C.green : vote.direction === "sell" ? C.red : C.dimmer;
  const label = vote.majority
    ? `${vote.direction?.toUpperCase()} ${vote.score}/5`
    : `NEUTRAL ${vote.votes?.filter((v: any) => v.vote === "buy").length ?? 0}B/${vote.votes?.filter((v: any) => v.vote === "sell").length ?? 0}S`;
  return (
    <span style={{ ...mono("0.58rem"), color: col, background: `${col}18`, padding: "2px 6px", border: `1px solid ${col}40`, ...glow(col) }}>
      {label}
    </span>
  );
}

// ── RSI gauge ─────────────────────────────────────────────────────────────────
function RsiGauge({ value }: { value: number | null }) {
  if (value === null) return <span style={{ ...mono("0.58rem"), color: C.dimmer }}>—</span>;
  const col = value > 75 ? C.red : value < 30 ? C.red : value >= 45 && value <= 62 ? C.green : C.amber;
  const zone = value > 75 ? "OVERBOUGHT" : value < 30 ? "OVERSOLD" : value >= 45 && value <= 62 ? "SWEET SPOT" : "NEUTRAL";
  return (
    <span style={{ ...mono("0.65rem"), color: col, ...glow(col) }} title={zone}>
      {value.toFixed(1)} <span style={{ ...mono("0.45rem"), color: C.dim }}>{zone}</span>
    </span>
  );
}

// ── Boot lines ─────────────────────────────────────────────────────────────────
const BOOT = [
  { t: "▶ POLYBOT ANALYTICS ENGINE v3.0", c: C.green },
  { t: "▶ LOADING MULTI-MODE STRATEGY STATE...", c: C.cyan },
  { t: "▶ SCALP + DAY + SWING MODULES ONLINE", c: C.cyan },
  { t: "▶ COMPUTING SIGNAL ACCURACY METRICS...", c: C.green2 },
  { t: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", c: C.dimmer },
];

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Analytics() {
  const [bootIdx, setBootIdx] = useState(0);
  const [bootDone, setBootDone] = useState(false);

  const { data } = useQuery<any>({ queryKey: ["/api/analytics"],      refetchInterval: 15000 });
  const { data: stratData } = useQuery<any>({ queryKey: ["/api/strategy-state"], refetchInterval: 5000 });

  useEffect(() => {
    if (bootIdx < BOOT.length) {
      const t = setTimeout(() => setBootIdx(i => i + 1), 110);
      return () => clearTimeout(t);
    } else { setTimeout(() => setBootDone(true), 150); }
  }, [bootIdx]);

  const s     = data?.summary;
  const assets: any[] = data?.assets || [];
  const heatmap: any[] = data?.hourlyHeatmap || [];
  const daily: any[]   = data?.dailySeries || [];
  const stratAssets: any[] = stratData?.assets || [];

  const bestHour  = heatmap.reduce((b, h) => h.pnl > (b?.pnl ?? -Infinity) ? h : b, null);
  const worstHour = heatmap.reduce((w, h) => h.pnl < (w?.pnl ?? Infinity)  ? h : w, null);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.green, fontFamily: "var(--font-mono)", padding: "0.75rem 1rem", position: "relative", overflowX: "hidden" }}>
      {/* Scanlines */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.08) 3px, rgba(0,0,0,0.08) 4px)" }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 960, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{ borderBottom: `1px solid ${C.dimmer}`, paddingBottom: "0.5rem", marginBottom: "0.8rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ ...px("0.68rem"), color: C.green, letterSpacing: "0.12em", ...glow(C.green) }}>◈ ANALYTICS TERMINAL</div>
            <div style={{ ...mono("0.55rem"), color: C.dim, marginTop: "0.15rem" }}>SCALP · DAY · SWING · SIGNAL ACCURACY · PNL METRICS</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ ...mono("0.52rem"), color: C.dimmer }}>{new Date().toUTCString().slice(0, 25)}</div>
            {stratData && <div style={{ ...mono("0.48rem"), color: C.green3, marginTop: 2 }}>LIVE ● {stratAssets.length} ASSETS</div>}
          </div>
        </div>

        {/* Boot */}
        {!bootDone && (
          <div style={{ marginBottom: "1rem" }}>
            {BOOT.slice(0, bootIdx).map((b, i) => (
              <div key={i} style={{ ...px("0.42rem"), color: b.c, lineHeight: 2.1, letterSpacing: "0.06em", ...glow(b.c) }}>{b.t}</div>
            ))}
            {bootIdx < BOOT.length && <span style={{ ...mono("0.65rem"), color: C.green }} className="blink">█</span>}
          </div>
        )}

        {bootDone && (
          <>
            {/* ══════════════════════════════════════════════════════════
                SECTION: LIVE STRATEGY STATE — per asset, per mode
            ══════════════════════════════════════════════════════════ */}
            <Card>
              <SectionHeader title="LIVE STRATEGY ENGINE — REAL-TIME SIGNALS" />
              {stratAssets.length === 0 ? (
                <div style={{ ...mono("0.6rem"), color: C.dimmer }}>BOT WARMING UP — FIRST TICK IN ~15s<span className="blink">_</span></div>
              ) : stratAssets.map((a: any) => {
                const session = a.session || "—";
                const cb = a.circuitBreakerUntil > Date.now();
                return (
                  <div key={a.asset} style={{ marginBottom: "0.9rem", background: C.bg3, border: `1px solid ${C.dimmer}`, padding: "0.55rem 0.7rem" }}>
                    {/* Asset header */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.45rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <span style={{ ...px("0.55rem"), color: ASSET_COLOR[a.asset], letterSpacing: "0.1em", ...glow(ASSET_COLOR[a.asset]) }}>{a.asset}</span>
                        <span style={{ ...mono("0.72rem"), color: ASSET_COLOR[a.asset], fontWeight: 700 }}>${a.price?.toLocaleString()}</span>
                        <span style={{ ...mono("0.55rem"), color: SESSION_COLOR[session] || C.dim, background: `${SESSION_COLOR[session] || C.dim}18`, padding: "1px 6px", border: `1px solid ${SESSION_COLOR[session] || C.dim}30` }}>
                          {session} SESSION
                        </span>
                      </div>
                      {cb && <span style={{ ...mono("0.52rem"), color: C.red }}>⚡ CIRCUIT BREAKER</span>}
                    </div>

                    {/* Indicator row */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.45rem" }}>
                      <div style={{ ...mono("0.55rem"), color: C.dim }}>
                        RSI: <RsiGauge value={a.rsi} />
                      </div>
                      <div style={{ ...mono("0.55rem"), color: C.dim }}>
                        EMA5: <span style={{ color: C.green }}>{a.ema5?.toFixed(0) ?? "—"}</span>
                      </div>
                      <div style={{ ...mono("0.55rem"), color: C.dim }}>
                        EMA15: <span style={{ color: C.green2 }}>{a.ema15?.toFixed(0) ?? "—"}</span>
                      </div>
                      <div style={{ ...mono("0.55rem"), color: C.dim }}>
                        EMA50: <span style={{ color: C.cyan }}>{a.ema50?.toFixed(0) ?? "—"}</span>
                      </div>
                      <div style={{ ...mono("0.55rem"), color: C.dim }}>
                        VWAP: <span style={{ color: C.purple }}>{a.vwap?.toFixed(0) ?? "—"}</span>
                      </div>
                      <div style={{ ...mono("0.55rem"), color: C.dim }}>
                        BB: <span style={{ color: C.amber }}>{a.bbLower?.toFixed(0) ?? "—"}</span>–<span style={{ color: C.amber }}>{a.bbUpper?.toFixed(0) ?? "—"}</span>
                        {a.bbWidth != null && <span style={{ color: C.dim }}> ({a.bbWidth.toFixed(2)}%)</span>}
                      </div>
                      <div style={{ ...mono("0.55rem"), color: C.dim }}>
                        FUNDING: <span style={{ color: a.fundingBias === "short" ? C.green : a.fundingBias === "long" ? C.red : C.dim }}>{(a.fundingBias || "NEUTRAL").toUpperCase()}</span>
                      </div>
                    </div>

                    {/* Mode votes */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
                      {(["scalp","day","swing"] as const).map(mode => {
                        const vote = mode === "scalp" ? a.lastScalpVote : mode === "day" ? a.lastDayVote : a.lastSwingVote;
                        const coolKey = `${mode}CooldownUntil`;
                        const onCooldown = a[coolKey] > Date.now();
                        const cdSecs = onCooldown ? Math.round((a[coolKey] - Date.now()) / 1000) : 0;
                        const modeColor = MODE_COLOR[mode];
                        return (
                          <div key={mode} style={{ background: C.bg2, border: `1px solid ${onCooldown ? C.dimmer : modeColor}30`, padding: "0.35rem 0.5rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
                              <span style={{ ...px("0.38rem"), color: modeColor, letterSpacing: "0.08em", ...glow(modeColor) }}>{mode.toUpperCase()}</span>
                              {onCooldown && <span style={{ ...mono("0.42rem"), color: C.dimmer }}>⏳{cdSecs}s</span>}
                            </div>
                            <VoteBadge vote={vote} />
                            {vote?.votes && (
                              <div style={{ marginTop: "0.25rem", display: "flex", flexWrap: "wrap", gap: "0.2rem" }}>
                                {vote.votes.map((v: any, i: number) => (
                                  <span key={i} style={{ ...mono("0.42rem"), color: v.vote === "buy" ? C.green : v.vote === "sell" ? C.red : C.dimmer, opacity: 0.8 }}>
                                    {v.name.replace("_", " ")}:{v.vote === "buy" ? "↑" : v.vote === "sell" ? "↓" : "·"}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </Card>

            {/* ══════════════════════════════════════════════════════════
                SECTION: SUMMARY STATS
            ══════════════════════════════════════════════════════════ */}
            {s && (
              <>
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.7rem" }}>
                  <StatBox label="TOTAL TRADES"  value={`${s.totalTrades}`}   sub={`${s.wins}W / ${s.losses}L / ${s.open} OPEN`} color={C.cyan} />
                  <StatBox label="WIN RATE"       value={`${s.winRate.toFixed(1)}%`}  sub="TARGET: >55%" color={s.winRate >= 55 ? C.green : s.winRate >= 45 ? C.amber : C.red} />
                  <StatBox label="TOTAL P&L"      value={`${s.totalPnl >= 0 ? "+" : ""}$${s.totalPnl.toFixed(2)}`} sub={`${s.allTimeReturn >= 0 ? "+" : ""}${s.allTimeReturn.toFixed(2)}% return`} color={s.totalPnl >= 0 ? C.green : C.red} />
                  <StatBox label="AVG BET"        value={`$${s.avgBetSize.toFixed(2)}`} sub={`AVG EDGE: ${s.avgEdge.toFixed(1)}%`} color={C.amber} />
                  <StatBox label="STREAK"         value={`${s.maxWinStreak}W`}  sub={`MAX LOSS: ${s.maxLossStreak}L`} color={C.green} />
                </div>

                {/* PnL curve */}
                <Card>
                  <SectionHeader title="PNL CURVE (ALL-TIME)" />
                  {daily.length > 1
                    ? <PnlSparkline series={daily} />
                    : <div style={{ ...mono("0.6rem"), color: C.dimmer, height: 80, display: "flex", alignItems: "center" }}>ACCUMULATING DATA...</div>
                  }
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.3rem" }}>
                    <div style={{ ...mono("0.5rem"), color: C.dim }}>START: ${s.startBalance.toFixed(2)}</div>
                    <div style={{ ...mono("0.5rem"), color: s.totalPnl >= 0 ? C.green : C.red }}>NOW: ${s.balance.toFixed(2)}</div>
                  </div>
                </Card>

                {/* Per-asset */}
                <Card>
                  <SectionHeader title="ASSET BREAKDOWN" />
                  {assets.length === 0
                    ? <div style={{ ...mono("0.6rem"), color: C.dimmer }}>NO COMPLETED TRADES YET</div>
                    : assets.map(a => (
                    <div key={a.asset} style={{ marginBottom: "0.5rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
                        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                          <span style={{ ...px("0.45rem"), color: ASSET_COLOR[a.asset] || C.dim, ...glow(ASSET_COLOR[a.asset] || C.dim) }}>{a.asset}</span>
                          <span style={{ ...mono("0.55rem"), color: C.dim }}>{a.trades} trades · {a.wins}W/{a.losses}L</span>
                        </div>
                        <div style={{ display: "flex", gap: "1rem" }}>
                          <span style={{ ...mono("0.58rem"), color: a.winRate >= 50 ? C.green : C.red }}>{a.winRate.toFixed(1)}% WR</span>
                          <span style={{ ...mono("0.58rem"), color: a.pnl >= 0 ? C.green : C.red }}>{a.pnl >= 0 ? "+" : ""}${a.pnl.toFixed(2)}</span>
                        </div>
                      </div>
                      <Bar pct={a.winRate} color={ASSET_COLOR[a.asset] || C.dim} height={5} />
                    </div>
                  ))}
                </Card>

                {/* Heatmap */}
                <Card>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                    <SectionHeader title="HOURLY TRADE HEATMAP (UTC)" />
                    {bestHour && <div style={{ ...mono("0.5rem"), color: C.dim }}>BEST: {bestHour.hour}:00 · WORST: {worstHour?.hour}:00</div>}
                  </div>
                  <div style={{ display: "flex", gap: "2px", marginBottom: "0.2rem" }}>
                    {heatmap.map(h => <HeatCell key={h.hour} {...h} />)}
                  </div>
                  <div style={{ display: "flex", gap: "2px" }}>
                    {heatmap.map(h => (
                      <div key={h.hour} style={{ flex: 1, ...mono("0.38rem"), color: C.dimmer, textAlign: "center" }}>
                        {h.hour % 6 === 0 ? `${h.hour}h` : ""}
                      </div>
                    ))}
                  </div>
                  {/* Session bands */}
                  <div style={{ display: "flex", gap: "1rem", marginTop: "0.4rem" }}>
                    {[{ label: "ASIA 0–7", col: C.purple }, { label: "EU 7–16", col: C.cyan }, { label: "US 13–21", col: C.green }].map(s => (
                      <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        <div style={{ width: 10, height: 8, background: s.col, opacity: 0.5 }} />
                        <span style={{ ...mono("0.45rem"), color: C.dim }}>{s.label}</span>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Hourly PnL bars */}
                <Card>
                  <SectionHeader title="HOURLY PNL DISTRIBUTION" />
                  <AsciiBarChart data={heatmap} valueKey="pnl" labelKey="hour" colorFn={d => d.pnl >= 0 ? C.green : C.red} height={72} />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.25rem" }}>
                    <span style={{ ...mono("0.45rem"), color: C.dimmer }}>0:00 UTC</span>
                    <span style={{ ...mono("0.45rem"), color: C.dimmer }}>12:00 UTC</span>
                    <span style={{ ...mono("0.45rem"), color: C.dimmer }}>23:00 UTC</span>
                  </div>
                </Card>

                {/* Signal engine modules */}
                <Card>
                  <SectionHeader title="AI SIGNAL ENGINE — MODULE STATUS" />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
                    {[
                      { label: "EMA CROSS (5/15)",      status: "ACTIVE",    mode: "SCALP",  color: C.cyan  },
                      { label: "RSI(14) FILTER",        status: "ACTIVE",    mode: "ALL",    color: C.green },
                      { label: "BOLLINGER BANDS",       status: "ACTIVE",    mode: "SCALP",  color: C.cyan  },
                      { label: "VWAP DEVIATION",        status: "ACTIVE",    mode: "SCALP",  color: C.cyan  },
                      { label: "LIQUIDITY SWEEP",       status: "ACTIVE",    mode: "DAY",    color: C.green },
                      { label: "BREAKER BLOCK",         status: "ACTIVE",    mode: "DAY",    color: C.green },
                      { label: "EMA 50/200 TREND",      status: "ACTIVE",    mode: "SWING",  color: C.amber },
                      { label: "FUNDING RATE PROXY",    status: "ACTIVE",    mode: "SWING",  color: C.amber },
                      { label: "TIME-OF-DAY BOOST",     status: "ACTIVE",    mode: "ALL",    color: C.green },
                      { label: "KELLY SIZING",          status: "ACTIVE",    mode: "ALL",    color: C.green },
                      { label: "POLYMARKET CROWD",      status: "ACTIVE",    mode: "S+D",    color: C.cyan  },
                      { label: "CLOB ENGINE",           status: "DISABLED",  mode: "—",      color: C.dim   },
                    ].map(item => (
                      <div key={item.label} style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "0.3rem 0.5rem", background: C.bg3, border: `1px solid ${C.dimmer}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ ...px("0.36rem"), color: C.dim, letterSpacing: "0.05em" }}>{item.label}</span>
                          <span style={{ ...mono("0.48rem"), color: item.color, ...glow(item.color) }}>● {item.status}</span>
                        </div>
                        <span style={{ ...mono("0.42rem"), color: item.color, opacity: 0.6, marginTop: 2 }}>MODE: {item.mode}</span>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Risk metrics */}
                <Card mb={false}>
                  <SectionHeader title="RISK METRICS" />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.4rem" }}>
                    <div>
                      <div style={{ ...px("0.38rem"), color: C.dim, marginBottom: 3 }}>MAX DAILY RISK</div>
                      <div style={{ ...mono("0.72rem"), color: C.amber }}>${(s.avgBetSize * 20).toFixed(0)}</div>
                      <div style={{ ...mono("0.45rem"), color: C.dim }}>20 trades × avg bet</div>
                    </div>
                    <div>
                      <div style={{ ...px("0.38rem"), color: C.dim, marginBottom: 3 }}>DAILY STOP-LOSS</div>
                      <div style={{ ...mono("0.72rem"), color: C.red }}>10%</div>
                      <div style={{ ...mono("0.45rem"), color: C.dim }}>${(s.balance * 0.1).toFixed(0)} max loss</div>
                    </div>
                    <div>
                      <div style={{ ...px("0.38rem"), color: C.dim, marginBottom: 3 }}>BREAKEVEN WR</div>
                      <div style={{ ...mono("0.72rem"), color: C.cyan }}>~50%</div>
                      <div style={{ ...mono("0.45rem"), color: C.dim }}>CURRENT: {s.winRate.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div style={{ ...px("0.38rem"), color: C.dim, marginBottom: 3 }}>CIRCUIT BREAKER</div>
                      <div style={{ ...mono("0.72rem"), color: C.green }}>25% WR</div>
                      <div style={{ ...mono("0.45rem"), color: C.dim }}>PAUSES 20 MIN</div>
                    </div>
                  </div>
                </Card>
              </>
            )}

            {!s && bootDone && (
              <div style={{ ...mono("0.65rem"), color: C.dim, textAlign: "center", padding: "2rem" }}>
                LOADING TRADE DATA<span className="blink">_</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
