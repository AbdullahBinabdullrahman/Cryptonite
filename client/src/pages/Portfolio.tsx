import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  TrendingUp, TrendingDown, Wallet, BarChart2,
  RefreshCw, Activity, DollarSign, Target, Award, AlertCircle,
  ChevronRight, Clock,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(n: number, decimals = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}
function fmtPct(n: number) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

// ── Panel wrapper ─────────────────────────────────────────────────────────────
function Panel({ title, icon: Icon, iconColor = "hsl(120 100% 55%)", badge, children }: any) {
  return (
    <div style={{ background: "hsl(220 20% 5%)", border: "1px solid hsl(120 30% 12%)", overflow: "hidden" }}>
      <div style={{
        padding: "9px 14px",
        borderBottom: "1px solid hsl(120 20% 8%)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "hsl(220 20% 4%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {Icon && <Icon size={12} style={{ color: iconColor }} />}
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: iconColor, letterSpacing: "0.1em" }}>{title}</span>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

// ── PNL tooltip ───────────────────────────────────────────────────────────────
function PnlTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value as number;
  return (
    <div style={{ background: "hsl(220 20% 4%)", border: "1px solid hsl(120 60% 20%)", padding: "6px 10px" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(120 30% 35%)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-pixel)", fontSize: 8, color: v >= 0 ? "hsl(120 100% 60%)" : "hsl(0 90% 60%)" }}>
        {fmt$(v)}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Portfolio() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/portfolio"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/portfolio");
      return res.json();
    },
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, gap: 10, color: "hsl(120 25% 35%)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
        <Activity size={16} className="animate-pulse" />
        LOADING PORTFOLIO<span className="blink">_</span>
      </div>
    );
  }

  const alpaca  = data?.alpaca  ?? { positions: [], isLive: false, count: 0 };
  const bot     = data?.bot     ?? { openPositions: [], openCount: 0, totalInvested: 0, resolvedCount: 0, totalRealizedPnl: 0, won: 0, lost: 0, winRate: 0, pnlByDay: [] };
  const account = data?.account ?? { totalBalance: 0, startingBalance: 0, allTimePnl: 0 };

  const allTimePnlPos  = account.allTimePnl >= 0;
  const alpacaTotalPl  = alpaca.positions.reduce((s: number, p: any) => s + parseFloat(p.unrealized_pl ?? "0"), 0);

  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "var(--font-pixel)", fontSize: 10, color: "hsl(120 100% 60%)", letterSpacing: "0.1em", marginBottom: 3, textShadow: "0 0 10px hsl(120 100% 50% / 0.4)" }}>
            ══ INVENTORY ══
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 35%)" }}>
            {alpaca.isLive ? "LIVE ALPACA ACCOUNT" : "PAPER TRADING ACCOUNT"} · REFRESHES EVERY 30s
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{
            background: "transparent",
            border: "1px solid hsl(120 40% 15%)",
            color: "hsl(120 40% 40%)",
            fontFamily: "var(--font-pixel)", fontSize: 7,
            letterSpacing: "0.08em", padding: "5px 10px",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
          }}
        >
          <RefreshCw size={9} className={isFetching ? "animate-spin" : ""} />
          SYNC
        </button>
      </div>

      {/* ── Summary stat cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
        {[
          { label: "TOTAL BALANCE", value: fmt$(account.totalBalance), sub: `BASE: ${fmt$(account.startingBalance)}`, color: "hsl(175 90% 55%)", Icon: Wallet },
          { label: "ALL-TIME P&L",  value: fmt$(account.allTimePnl), sub: fmtPct((account.allTimePnl / Math.max(account.startingBalance, 1)) * 100), color: allTimePnlPos ? "hsl(120 100% 55%)" : "hsl(0 90% 55%)", Icon: allTimePnlPos ? TrendingUp : TrendingDown },
          { label: "REALIZED P&L",  value: fmt$(bot.totalRealizedPnl), sub: `${bot.resolvedCount} RESOLVED`, color: bot.totalRealizedPnl >= 0 ? "hsl(120 100% 55%)" : "hsl(0 90% 55%)", Icon: DollarSign },
          { label: "WIN RATE",      value: `${bot.winRate}%`, sub: `${bot.won}W / ${bot.lost}L`, color: "hsl(45 100% 55%)", Icon: Award },
        ].map(({ label, value, sub, color, Icon }) => (
          <div
            key={label}
            style={{
              background: "hsl(220 20% 5%)",
              border: `1px solid ${color}25`,
              padding: "12px",
              position: "relative",
            }}
          >
            <div style={{ position: "absolute", top: 0, left: 0, width: 6, height: 6, borderTop: `1px solid ${color}`, borderLeft: `1px solid ${color}` }} />
            <div style={{ position: "absolute", bottom: 0, right: 0, width: 6, height: 6, borderBottom: `1px solid ${color}`, borderRight: `1px solid ${color}` }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 25% 30%)", letterSpacing: "0.1em", marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: "var(--font-pixel)", fontSize: 11, color, textShadow: `0 0 8px ${color}50`, marginBottom: 3 }}>{value}</div>
                {sub && <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 20% 28%)" }}>{sub}</div>}
              </div>
              <Icon size={14} style={{ color, opacity: 0.6 }} />
            </div>
          </div>
        ))}
      </div>

      {/* ── P&L chart ── */}
      {bot.pnlByDay.length > 1 && (
        <Panel title="DAILY REALIZED P&L" icon={BarChart2}>
          <div style={{ padding: "12px 14px" }}>
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={bot.pnlByDay} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="pgr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="hsl(120, 100%, 50%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(120, 100%, 50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: "hsl(120 25% 30%)", fontFamily: "Share Tech Mono" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 8, fill: "hsl(120 25% 30%)", fontFamily: "Share Tech Mono" }} tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v}`} />
                <Tooltip content={<PnlTooltip />} />
                <ReferenceLine y={0} stroke="hsl(120 30% 15%)" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="pnl" stroke="hsl(120, 100%, 50%)" strokeWidth={1.5} fill="url(#pgr)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {/* ── Alpaca positions ── */}
      <Panel
        title="ALPACA POSITIONS"
        icon={Target}
        iconColor="hsl(175 90% 55%)"
        badge={
          <span style={{
            fontFamily: "var(--font-pixel)", fontSize: 6, padding: "2px 7px",
            border: `1px solid ${alpaca.isLive ? "hsl(120 100% 50% / 0.4)" : "hsl(45 100% 55% / 0.4)"}`,
            color: alpaca.isLive ? "hsl(120 100% 60%)" : "hsl(45 100% 55%)",
            letterSpacing: "0.08em",
          }}>
            {alpaca.isLive ? "LIVE" : "PAPER"} [{alpaca.count}]
          </span>
        }
      >
        {alpaca.positions.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 20% 25%)" }}>
            NO OPEN POSITIONS
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 60px 90px 90px 100px 100px",
              padding: "6px 12px",
              borderBottom: "1px solid hsl(120 20% 8%)",
            }}>
              {["SYMBOL", "QTY", "ENTRY", "CURRENT", "MKT VALUE", "UNREAL P&L"].map(h => (
                <div key={h} style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 20% 25%)", letterSpacing: "0.08em", textAlign: h !== "SYMBOL" ? "right" as const : "left" as const }}>{h}</div>
              ))}
            </div>
            {alpaca.positions.map((p: any) => {
              const pl   = parseFloat(p.unrealized_pl ?? "0");
              const plpc = parseFloat(p.unrealized_plpc ?? "0") * 100;
              const pos  = pl >= 0;
              return (
                <div
                  key={p.symbol}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 60px 90px 90px 100px 100px",
                    padding: "8px 12px",
                    borderBottom: "1px solid hsl(120 15% 7%)",
                    alignItems: "center",
                  }}
                  data-testid={`position-row-${p.symbol}`}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid hsl(175 90% 55% / 0.3)", background: "hsl(175 90% 55% / 0.07)" }}>
                      <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(175 90% 60%)" }}>
                        {p.symbol.replace("USD", "").slice(0, 3)}
                      </span>
                    </div>
                    <div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 70% 60%)" }}>{p.symbol}</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(120 25% 30%)", textTransform: "capitalize" as const }}>{p.side}</div>
                    </div>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 50% 50%)", textAlign: "right" as const }}>{parseFloat(p.qty).toFixed(4)}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 40% 40%)", textAlign: "right" as const }}>{fmt$(parseFloat(p.avg_entry_price))}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 60% 55%)", textAlign: "right" as const }}>{fmt$(parseFloat(p.current_price))}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 60% 55%)", textAlign: "right" as const }}>{fmt$(parseFloat(p.market_value))}</div>
                  <div style={{ textAlign: "right" as const }}>
                    <div style={{ fontFamily: "var(--font-pixel)", fontSize: 8, color: pos ? "hsl(120 100% 60%)" : "hsl(0 90% 60%)", textShadow: pos ? "0 0 5px hsl(120 100% 50% / 0.4)" : "none" }}>
                      {pos ? "+" : ""}{fmt$(pl)}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: pos ? "hsl(120 60% 45%)" : "hsl(0 70% 50%)" }}>
                      {fmtPct(plpc)}
                    </div>
                  </div>
                </div>
              );
            })}
            {/* Total P&L row */}
            <div style={{ padding: "8px 14px", background: "hsl(220 20% 4%)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 25% 30%)", letterSpacing: "0.08em" }}>TOTAL UNREALIZED P&L</span>
              <span style={{ fontFamily: "var(--font-pixel)", fontSize: 8, color: alpacaTotalPl >= 0 ? "hsl(120 100% 60%)" : "hsl(0 90% 60%)" }}>
                {alpacaTotalPl >= 0 ? "+" : ""}{fmt$(alpacaTotalPl)}
              </span>
            </div>
          </div>
        )}
      </Panel>

      {/* ── Bot open positions ── */}
      <Panel title="BOT OPEN POSITIONS" icon={Activity} iconColor="hsl(175 60% 55%)">
        {bot.openPositions.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 20% 25%)" }}>
            NO OPEN BOT POSITIONS
          </div>
        ) : (
          <div>
            {/* Subtitle */}
            <div style={{ padding: "6px 12px", borderBottom: "1px solid hsl(120 20% 8%)", fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 30%)" }}>
              {bot.openCount} MARKETS · {fmt$(bot.totalInvested)} INVESTED
            </div>
            {bot.openPositions.slice(0, 50).map((p: any, i: number) => {
              const isBuy = p.direction === "YES" || p.direction === "BUY";
              return (
                <div
                  key={i}
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid hsl(120 15% 7%)",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                  }}
                  data-testid={`bot-position-${i}`}
                >
                  <div style={{
                    width: 24, height: 24, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: `1px solid ${isBuy ? "hsl(120 100% 50% / 0.3)" : "hsl(0 90% 55% / 0.3)"}`,
                    fontFamily: "var(--font-pixel)", fontSize: 8,
                    color: isBuy ? "hsl(120 100% 60%)" : "hsl(0 90% 60%)",
                  }}>
                    {isBuy ? "↑" : "↓"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 60% 55%)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                      {p.market.length > 70 ? p.market.slice(0, 70) + "…" : p.market}
                    </div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(120 25% 30%)" }}>{p.tradeCount} trade{p.tradeCount > 1 ? "s" : ""}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(120 25% 30%)" }}>
                        ENTRY: <span style={{ color: "hsl(120 50% 45%)" }}>{(p.avgEntryPrice * 100).toFixed(1)}¢</span>
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(120 20% 25%)", display: "flex", alignItems: "center", gap: 3 }}>
                        <Clock size={9} />{new Date(p.openedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" as const, flexShrink: 0 }}>
                    <div style={{ fontFamily: "var(--font-pixel)", fontSize: 8, color: "hsl(120 70% 55%)" }}>{fmt$(p.totalInvested)}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(120 20% 28%)" }}>INVESTED</div>
                  </div>
                </div>
              );
            })}
            {bot.openPositions.length > 50 && (
              <div style={{ padding: "10px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 30%)" }}>
                +{bot.openPositions.length - 50} MORE → SEE TRADES TAB
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* ── Resolved breakdown ── */}
      {bot.resolvedCount > 0 && (
        <Panel title="RESOLVED TRADE BREAKDOWN" icon={BarChart2} iconColor="hsl(45 100% 55%)">
          <div style={{ padding: "12px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
              {[
                { label: "TOTAL", value: bot.resolvedCount, color: "hsl(120 60% 55%)" },
                { label: "WIN",   value: bot.won,          color: "hsl(120 100% 55%)" },
                { label: "LOSS",  value: bot.lost,         color: "hsl(0 90% 55%)" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ textAlign: "center", padding: "10px 6px", border: `1px solid ${color}20`, background: `${color}08` }}>
                  <div style={{ fontFamily: "var(--font-pixel)", fontSize: 13, color, textShadow: `0 0 8px ${color}50` }}>{value}</div>
                  <div style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 20% 28%)", letterSpacing: "0.1em", marginTop: 4 }}>{label}</div>
                </div>
              ))}
            </div>
            {/* Win rate health bar */}
            <div style={{ marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 25% 30%)", letterSpacing: "0.08em" }}>WIN RATE</span>
              <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(120 100% 55%)" }}>{bot.winRate}%</span>
            </div>
            <div className="health-bar">
              <div className="health-bar-fill" style={{ width: `${Math.min(bot.winRate, 100)}%` }} />
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
