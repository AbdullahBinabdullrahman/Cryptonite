import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  BarChart3, TrendingUp, TrendingDown, Clock, CheckCircle, XCircle,
  RefreshCw, Activity, DollarSign, Target, Zap
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import React, { useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, CartesianGrid
} from "recharts";

// ── Cumulative PNL chart ──────────────────────────────────────────────────────
function PnlChart({ trades }: { trades: any[] }) {
  const resolved = trades.filter((t) => t.status !== "open" && t.createdAt);
  if (resolved.length < 2) return null;
  let cum = 0;
  const data = resolved
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((t) => { cum += t.pnl || 0; return { cum: parseFloat(cum.toFixed(2)) }; });

  const CustomTip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const v = payload[0].value;
    return (
      <div style={{ background: "hsl(220 20% 4%)", border: "1px solid hsl(120 60% 20%)", padding: "6px 10px" }}>
        <div style={{ fontFamily: "var(--font-pixel)", fontSize: 8, color: v >= 0 ? "hsl(120 100% 60%)" : "hsl(0 90% 60%)" }}>
          {v >= 0 ? "+" : ""}${v.toFixed(2)}
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: "hsl(220 20% 5%)", border: "1px solid hsl(120 30% 12%)", padding: "12px 14px" }}>
      <div style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(175 90% 55%)", letterSpacing: "0.1em", marginBottom: 8 }}>
        ▸ CUMULATIVE PNL CURVE
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="hsl(120, 100%, 50%)" stopOpacity={0.2} />
              <stop offset="95%" stopColor="hsl(120, 100%, 50%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 2" stroke="hsl(120 30% 10%)" />
          <XAxis tick={false} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "hsl(120 25% 30%)", fontSize: 8, fontFamily: "Share Tech Mono" }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
          <Tooltip content={<CustomTip />} />
          <Area type="monotone" dataKey="cum" stroke="hsl(120, 100%, 50%)" strokeWidth={1.5} fill="url(#pnlGrad)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Win/Loss by edge chart ─────────────────────────────────────────────────────
function WinLossChart({ trades }: { trades: any[] }) {
  const resolved = trades.filter((t) => t.status !== "open");
  if (resolved.length < 3) return null;
  const buckets: Record<string, { w: number; l: number }> = {};
  resolved.forEach((t) => {
    const edge = Math.floor((t.edgeDetected || 0) / 2) * 2;
    const k    = `${edge}–${edge + 2}%`;
    if (!buckets[k]) buckets[k] = { w: 0, l: 0 };
    if (t.status === "won") buckets[k].w++;
    else buckets[k].l++;
  });
  const data = Object.entries(buckets).map(([edge, { w, l }]) => ({ edge, wins: w, losses: l }));

  return (
    <div style={{ background: "hsl(220 20% 5%)", border: "1px solid hsl(120 30% 12%)", padding: "12px 14px" }}>
      <div style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(45 100% 55%)", letterSpacing: "0.1em", marginBottom: 8 }}>
        ▸ WIN/LOSS BY EDGE %
      </div>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={data} barGap={2}>
          <XAxis dataKey="edge" tick={{ fill: "hsl(120 25% 30%)", fontSize: 8, fontFamily: "Share Tech Mono" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: "hsl(120 25% 30%)", fontSize: 8, fontFamily: "Share Tech Mono" }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "hsl(220 20% 4%)", border: "1px solid hsl(120 40% 15%)", borderRadius: 0, fontSize: 10, fontFamily: "Share Tech Mono" }}
            labelStyle={{ color: "hsl(120 60% 50%)" }}
          />
          <Bar dataKey="wins"   fill="hsl(120, 100%, 45%)" radius={[0, 0, 0, 0]} />
          <Bar dataKey="losses" fill="hsl(0, 90%, 50%)"    radius={[0, 0, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Filter button ─────────────────────────────────────────────────────────────
type Filter = "all" | "open" | "won" | "lost" | "live";

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Trades() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>("all");

  const { data: trades, isLoading } = useQuery({
    queryKey: ["/api/trades"],
    queryFn: () => apiRequest("GET", "/api/trades?limit=200").then((r) => r.json()),
    refetchInterval: 5000,
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/orders/sync"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "SYNCED", description: data.message || "Done" });
    },
    onError: (e: any) => toast({ title: "SYNC FAILED", description: e.message, variant: "destructive" }),
  });

  const tradeList: any[] = Array.isArray(trades) ? trades : [];
  const resolved  = tradeList.filter((t) => t.status !== "open");
  const openTrades = tradeList.filter((t) => t.status === "open");
  const wins      = resolved.filter((t) => t.status === "won").length;
  const losses    = resolved.filter((t) => t.status === "lost").length;
  const totalPnl  = resolved.reduce((s, t) => s + (t.pnl || 0), 0);
  const winRate   = resolved.length > 0 ? (wins / resolved.length * 100).toFixed(1) : "—";
  const avgEdge   = tradeList.length > 0 ? (tradeList.reduce((s, t) => s + (t.edgeDetected || 0), 0) / tradeList.length).toFixed(1) : "—";
  const realOrders = tradeList.filter((t) => t.alpacaOrderId).length;
  const avgBetSize = tradeList.length > 0 ? (tradeList.reduce((s, t) => s + (t.betSize || 0), 0) / tradeList.length).toFixed(2) : "—";

  const filterMap: Record<Filter, (t: any) => boolean> = {
    all:  () => true,
    open: (t) => t.status === "open",
    won:  (t) => t.status === "won",
    lost: (t) => t.status === "lost",
    live: (t) => !!t.alpacaOrderId,
  };
  const filtered = tradeList.filter(filterMap[filter]);

  const filterTabs: { key: Filter; label: string; count: number; color: string }[] = [
    { key: "all",  label: "ALL",    count: tradeList.length,  color: "hsl(120 80% 55%)" },
    { key: "open", label: "OPEN",   count: openTrades.length, color: "hsl(45 100% 55%)" },
    { key: "won",  label: "WIN",    count: wins,              color: "hsl(120 100% 55%)" },
    { key: "lost", label: "LOSS",   count: losses,            color: "hsl(0 90% 55%)" },
    { key: "live", label: "ALPACA", count: realOrders,        color: "hsl(175 90% 55%)" },
  ];

  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "var(--font-pixel)", fontSize: 10, color: "hsl(120 100% 60%)", letterSpacing: "0.1em", marginBottom: 3, textShadow: "0 0 10px hsl(120 100% 50% / 0.4)" }}>
            ══ COMBAT LOG ══
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 35%)" }}>
            ALL BOT ORDERS · LIVE UPDATES EVERY 5s
            {realOrders > 0 && <span style={{ color: "hsl(175 90% 55%)", marginLeft: 8 }}>· {realOrders} ALPACA</span>}
          </div>
        </div>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          style={{
            background: "transparent",
            border: "1px solid hsl(120 40% 18%)",
            color: "hsl(120 50% 45%)",
            fontFamily: "var(--font-pixel)",
            fontSize: 7,
            letterSpacing: "0.08em",
            padding: "6px 10px",
            cursor: "pointer",
            display: "flex", alignItems: "center", gap: 5,
          }}
        >
          <RefreshCw size={10} className={syncMutation.isPending ? "animate-spin" : ""} />
          SYNC
        </button>
      </div>

      {/* ── Summary stat boxes ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
        {[
          { label: "TOTAL TRADES", value: tradeList.length, color: "hsl(120 70% 55%)" },
          { label: "WIN RATE",     value: `${winRate}%`,    color: "hsl(120 100% 55%)" },
          { label: "TOTAL PNL",    value: `${totalPnl >= 0 ? "+" : ""}$${Math.abs(totalPnl).toFixed(2)}`, color: totalPnl >= 0 ? "hsl(120 100% 55%)" : "hsl(0 90% 55%)" },
          { label: "AVG EDGE",     value: `${avgEdge}%`,    color: "hsl(45 100% 55%)" },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            style={{
              background: "hsl(220 20% 5%)",
              border: `1px solid ${color}25`,
              padding: "10px 12px",
              position: "relative",
            }}
          >
            <div style={{ position: "absolute", top: 0, left: 0, width: 6, height: 6, borderTop: `1px solid ${color}`, borderLeft: `1px solid ${color}` }} />
            <div style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 25% 30%)", letterSpacing: "0.1em", marginBottom: 3 }}>{label}</div>
            <div style={{ fontFamily: "var(--font-pixel)", fontSize: 11, color, textShadow: `0 0 8px ${color}50` }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Status pills ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {[
          { label: `${wins} WIN`, color: "hsl(120 100% 55%)", bg: "hsl(120 100% 55% / 0.08)" },
          { label: `${losses} LOSS`, color: "hsl(0 90% 55%)", bg: "hsl(0 90% 55% / 0.08)" },
          { label: `${openTrades.length} OPEN`, color: "hsl(45 100% 55%)", bg: "hsl(45 100% 55% / 0.08)" },
          { label: `AVG BET $${avgBetSize}`, color: "hsl(120 40% 40%)", bg: "transparent" },
        ].map(({ label, color, bg }) => (
          <span
            key={label}
            style={{
              fontFamily: "var(--font-pixel)", fontSize: 7, letterSpacing: "0.08em",
              padding: "4px 8px",
              border: `1px solid ${color}35`,
              color, background: bg,
            }}
          >
            {label}
          </span>
        ))}
      </div>

      {/* ── Charts ── */}
      {resolved.length >= 2 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 8 }}>
          <PnlChart trades={tradeList} />
          <WinLossChart trades={tradeList} />
        </div>
      )}

      {/* ── Filter row ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {filterTabs.map(({ key, label, count, color }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              background: filter === key ? `${color}12` : "transparent",
              border: `1px solid ${filter === key ? `${color}50` : "hsl(120 30% 12%)"}`,
              color: filter === key ? color : "hsl(120 25% 30%)",
              fontFamily: "var(--font-pixel)",
              fontSize: 7,
              letterSpacing: "0.08em",
              padding: "5px 10px",
              cursor: "pointer",
              transition: "all 0.1s ease",
              boxShadow: filter === key ? `0 0 8px ${color}20` : "none",
            }}
          >
            {label} {count > 0 ? `[${count}]` : ""}
          </button>
        ))}
      </div>

      {/* ── Trade table ── */}
      <div style={{ background: "hsl(220 20% 5%)", border: "1px solid hsl(120 30% 12%)", overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid hsl(120 20% 8%)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(175 90% 55%)", letterSpacing: "0.1em" }}>
            ▸ {filter === "all" ? "ALL ORDERS" : filterTabs.find(f => f.key === filter)?.label + " ORDERS"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div className="pulse-dot" style={{ width: 4, height: 4, background: "hsl(120 100% 55%)" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(120 25% 30%)" }}>LIVE</span>
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: 12 }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{ height: 32, background: "hsl(220 20% 4%)", marginBottom: 4 }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "20px 14px", fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 25% 30%)" }}>
            &gt; NO TRADES FOUND<span className="blink">_</span>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid hsl(120 30% 10%)" }}>
                  {["#", "MARKET", "SIDE", "SIZE", "EDGE", "MOM", "STATUS", "FILL", "PNL", "ORDER", "TIME"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "7px 10px",
                        textAlign: "left" as const,
                        fontFamily: "var(--font-pixel)",
                        fontSize: 6,
                        color: "hsl(120 25% 28%)",
                        letterSpacing: "0.1em",
                        whiteSpace: "nowrap" as const,
                        background: "hsl(220 20% 4%)",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t: any) => {
                  const isWon  = t.status === "won";
                  const isLost = t.status === "lost";
                  const isOpen = t.status === "open";
                  const pnl    = t.pnl || 0;
                  return (
                    <tr
                      key={t.id}
                      style={{
                        borderBottom: "1px solid hsl(120 20% 7%)",
                        background: isOpen ? "hsl(45 100% 55% / 0.02)" : "transparent",
                      }}
                    >
                      <td style={{ padding: "6px 10px", fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 20% 22%)" }}>{t.id}</td>
                      <td style={{ padding: "6px 10px", minWidth: 160, maxWidth: 200 }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 60% 55%)", lineHeight: 1.3, wordBreak: "break-word" as const }}>{t.market}</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(120 15% 25%)", marginTop: 1 }}>{t.marketId}</div>
                      </td>
                      <td style={{ padding: "6px 10px" }}>
                        <span style={{
                          fontFamily: "var(--font-pixel)", fontSize: 6, padding: "2px 5px",
                          border: `1px solid ${t.direction === "YES" ? "hsl(120 100% 50% / 0.4)" : "hsl(0 90% 55% / 0.4)"}`,
                          color: t.direction === "YES" ? "hsl(120 100% 60%)" : "hsl(0 90% 60%)",
                        }}>
                          {t.direction}
                        </span>
                      </td>
                      <td style={{ padding: "6px 10px", fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 70% 55%)", whiteSpace: "nowrap" as const }}>${t.betSize}</td>
                      <td style={{ padding: "6px 10px", fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(45 100% 55%)", whiteSpace: "nowrap" as const }}>{t.edgeDetected}%</td>
                      <td style={{ padding: "6px 10px", whiteSpace: "nowrap" as const }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: (t.btcMomentum || 0) >= 0 ? "hsl(120 100% 55%)" : "hsl(0 90% 55%)", display: "flex", alignItems: "center", gap: 2 }}>
                          {(t.btcMomentum || 0) >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                          {(t.btcMomentum || 0).toFixed(2)}%
                        </span>
                      </td>
                      <td style={{ padding: "6px 10px" }}>
                        <div>
                          <span style={{
                            fontFamily: "var(--font-pixel)", fontSize: 6, padding: "2px 5px",
                            color: isOpen ? "hsl(45 100% 55%)" : isWon ? "hsl(120 100% 60%)" : "hsl(0 90% 60%)",
                            border: `1px solid ${isOpen ? "hsl(45 100% 55% / 0.3)" : isWon ? "hsl(120 100% 50% / 0.3)" : "hsl(0 90% 55% / 0.3)"}`,
                            display: "block",
                          }}>
                            {isOpen ? "LIVE" : isWon ? "WIN" : "LOSS"}
                          </span>
                          {t.alpacaOrderStatus && (
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: t.alpacaOrderStatus.startsWith("live:") ? "hsl(120 100% 55%)" : "hsl(45 100% 55%)", marginTop: 1 }}>
                              {t.alpacaOrderStatus.startsWith("live:") ? "● LIVE" : "◎ PAPER"}
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "6px 10px", fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 30% 40%)", whiteSpace: "nowrap" as const }}>
                        {t.fillPrice ? `$${Number(t.fillPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td style={{ padding: "6px 10px", whiteSpace: "nowrap" as const }}>
                        {t.status !== "open" ? (
                          <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: pnl >= 0 ? "hsl(120 100% 60%)" : "hsl(0 90% 60%)", textShadow: pnl >= 0 ? "0 0 5px hsl(120 100% 50% / 0.4)" : "0 0 5px hsl(0 90% 55% / 0.4)" }}>
                            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                          </span>
                        ) : <span style={{ color: "hsl(120 20% 22%)" }}>—</span>}
                      </td>
                      <td style={{ padding: "6px 10px" }}>
                        {t.alpacaOrderId ? (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(120 25% 30%)" }} title={t.alpacaOrderId}>
                            {t.alpacaOrderId.slice(0, 8)}…
                          </span>
                        ) : (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(120 15% 22%)" }}>sim</span>
                        )}
                      </td>
                      <td style={{ padding: "6px 10px", fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(120 20% 28%)", whiteSpace: "nowrap" as const }}>
                        {t.createdAt ? formatDistanceToNow(new Date(t.createdAt), { addSuffix: true }) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
