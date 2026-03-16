import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  TrendingUp, TrendingDown, Wallet, BarChart2,
  RefreshCw, Activity, DollarSign, Target, Award, AlertCircle,
  ChevronRight, Clock,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

function PnlBadge({ value }: { value: number }) {
  const pos = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-700 px-2 py-0.5 rounded-full
      ${pos ? "bg-teal/15 text-teal" : "bg-red-500/15 text-red-400"}`}>
      {pos ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {fmt$(value)}
    </span>
  );
}

function StatCard({
  label, value, sub, icon: Icon, color = "teal",
}: {
  label: string; value: string; sub?: string;
  icon: any; color?: "teal" | "edge" | "green" | "red";
}) {
  const colors: Record<string, string> = {
    teal: "bg-teal/10 text-teal border-teal/20",
    edge: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-base font-display font-800 text-foreground truncate">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Custom tooltip for the P&L chart ─────────────────────────────────────────
function PnlTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value as number;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className={`font-700 ${v >= 0 ? "text-teal" : "text-red-400"}`}>{fmt$(v)}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
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
      <div className="flex items-center justify-center h-48 gap-3 text-muted-foreground">
        <Activity size={18} className="animate-pulse" />
        <span className="text-sm">Loading portfolio…</span>
      </div>
    );
  }

  const alpaca   = data?.alpaca   ?? { positions: [], isLive: false, count: 0 };
  const bot      = data?.bot      ?? { openPositions: [], openCount: 0, totalInvested: 0, resolvedCount: 0, totalRealizedPnl: 0, won: 0, lost: 0, winRate: 0, pnlByDay: [] };
  const account  = data?.account  ?? { totalBalance: 0, startingBalance: 0, allTimePnl: 0 };

  const allTimePnlPos = account.allTimePnl >= 0;
  const alpacaTotalPl = alpaca.positions.reduce((s: number, p: any) => s + parseFloat(p.unrealized_pl ?? "0"), 0);

  return (
    <div className="space-y-6 pb-10">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display font-800 text-foreground">Portfolio</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {alpaca.isLive ? "Live Alpaca account" : "Paper trading account"} · Auto-refreshes every 30s
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Balance"
          value={fmt$(account.totalBalance)}
          sub={`Started at ${fmt$(account.startingBalance)}`}
          icon={Wallet}
          color="teal"
        />
        <StatCard
          label="All-Time P&L"
          value={fmt$(account.allTimePnl)}
          sub={fmtPct((account.allTimePnl / Math.max(account.startingBalance, 1)) * 100)}
          icon={allTimePnlPos ? TrendingUp : TrendingDown}
          color={allTimePnlPos ? "green" : "red"}
        />
        <StatCard
          label="Realized P&L"
          value={fmt$(bot.totalRealizedPnl)}
          sub={`${bot.resolvedCount} resolved trades`}
          icon={DollarSign}
          color={bot.totalRealizedPnl >= 0 ? "green" : "red"}
        />
        <StatCard
          label="Win Rate"
          value={`${bot.winRate}%`}
          sub={`${bot.won}W / ${bot.lost}L`}
          icon={Award}
          color="edge"
        />
      </div>

      {/* P&L chart */}
      {bot.pnlByDay.length > 1 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <BarChart2 size={13} />Daily Realized P&L
          </p>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={bot.pnlByDay} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pgr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ngr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} width={48} tickFormatter={v => `$${v}`} />
              <Tooltip content={<PnlTooltip />} />
              <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 4" />
              <Area
                type="monotone"
                dataKey="pnl"
                stroke="#14b8a6"
                strokeWidth={2}
                fill="url(#pgr)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Alpaca positions */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target size={14} className="text-teal" />
            <span className="text-sm font-display font-700 text-foreground">Alpaca Positions</span>
            <span className="text-xs text-muted-foreground">({alpaca.count})</span>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            alpaca.isLive ? "bg-teal/15 text-teal" : "bg-amber-500/15 text-amber-400"
          }`}>
            {alpaca.isLive ? "Live" : "Paper"}
          </span>
        </div>

        {alpaca.positions.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <AlertCircle size={18} className="opacity-40" />
            No open positions in Alpaca right now
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Table header */}
            <div className="hidden md:grid grid-cols-6 px-4 py-2 text-xs text-muted-foreground font-medium">
              <span className="col-span-1">Symbol</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Avg Entry</span>
              <span className="text-right">Current</span>
              <span className="text-right">Market Value</span>
              <span className="text-right">Unrealized P&L</span>
            </div>
            {alpaca.positions.map((p: any) => {
              const pl     = parseFloat(p.unrealized_pl ?? "0");
              const plpc   = parseFloat(p.unrealized_plpc ?? "0") * 100;
              const pos    = pl >= 0;
              return (
                <div
                  key={p.symbol}
                  className="px-4 py-3 grid grid-cols-2 md:grid-cols-6 gap-2 md:gap-0 items-center hover:bg-secondary/20 transition-colors"
                  data-testid={`position-row-${p.symbol}`}
                >
                  {/* Symbol */}
                  <div className="flex items-center gap-2 col-span-1">
                    <div className="w-7 h-7 rounded-lg bg-teal/10 border border-teal/20 flex items-center justify-center">
                      <span className="text-xs font-800 text-teal">
                        {p.symbol.replace("USD", "").slice(0, 3)}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-700 text-foreground">{p.symbol}</p>
                      <p className="text-xs text-muted-foreground capitalize">{p.side}</p>
                    </div>
                  </div>
                  {/* Qty */}
                  <div className="text-right md:block hidden">
                    <p className="text-xs font-600 text-foreground">{parseFloat(p.qty).toFixed(4)}</p>
                  </div>
                  {/* Avg Entry */}
                  <div className="text-right md:block hidden">
                    <p className="text-xs text-foreground">{fmt$(parseFloat(p.avg_entry_price))}</p>
                  </div>
                  {/* Current */}
                  <div className="text-right md:block hidden">
                    <p className="text-xs text-foreground">{fmt$(parseFloat(p.current_price))}</p>
                  </div>
                  {/* Market Value */}
                  <div className="text-right">
                    <p className="text-xs font-700 text-foreground">{fmt$(parseFloat(p.market_value))}</p>
                    <p className="text-xs text-muted-foreground md:hidden">
                      Entry: {fmt$(parseFloat(p.avg_entry_price))}
                    </p>
                  </div>
                  {/* P&L */}
                  <div className="text-right">
                    <p className={`text-xs font-800 ${pos ? "text-teal" : "text-red-400"}`}>
                      {pos ? "+" : ""}{fmt$(pl)}
                    </p>
                    <p className={`text-xs ${pos ? "text-teal/70" : "text-red-400/70"}`}>
                      {fmtPct(plpc)}
                    </p>
                  </div>
                </div>
              );
            })}
            {/* Total unrealized P&L row */}
            {alpaca.positions.length > 0 && (
              <div className="px-4 py-2.5 flex items-center justify-between bg-secondary/20">
                <span className="text-xs text-muted-foreground font-medium">Total Unrealized P&L</span>
                <PnlBadge value={alpacaTotalPl} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bot open positions */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Activity size={14} className="text-violet-400" />
          <span className="text-sm font-display font-700 text-foreground">Bot Open Positions</span>
          <span className="text-xs text-muted-foreground">({bot.openCount} markets · {fmt$(bot.totalInvested)} invested)</span>
        </div>

        {bot.openPositions.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <AlertCircle size={18} className="opacity-40" />
            No open bot positions
          </div>
        ) : (
          <div className="divide-y divide-border">
            {bot.openPositions.slice(0, 50).map((p: any, i: number) => (
              <div
                key={i}
                className="px-4 py-3 flex items-start gap-3 hover:bg-secondary/20 transition-colors"
                data-testid={`bot-position-${i}`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-800
                  ${p.direction === "YES" || p.direction === "BUY"
                    ? "bg-teal/10 text-teal border border-teal/20"
                    : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
                  {p.direction === "YES" || p.direction === "BUY" ? "↑" : "↓"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-600 text-foreground leading-tight truncate" title={p.market}>
                    {p.market.length > 60 ? p.market.slice(0, 60) + "…" : p.market}
                  </p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      {p.tradeCount} trade{p.tradeCount > 1 ? "s" : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Avg entry: <span className="text-foreground">{(p.avgEntryPrice * 100).toFixed(1)}¢</span>
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock size={10} />
                      {new Date(p.openedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-800 text-foreground">{fmt$(p.totalInvested)}</p>
                  <p className="text-xs text-muted-foreground">invested</p>
                </div>
              </div>
            ))}
            {bot.openPositions.length > 50 && (
              <div className="px-4 py-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-1">
                <ChevronRight size={12} />
                {bot.openPositions.length - 50} more positions — view in Trades tab
              </div>
            )}
          </div>
        )}
      </div>

      {/* Resolved trade breakdown */}
      {bot.resolvedCount > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <BarChart2 size={13} />Resolved Trade Breakdown
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-secondary/30 rounded-lg p-3 text-center">
              <p className="text-lg font-800 font-display text-foreground">{bot.resolvedCount}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            <div className="bg-teal/8 border border-teal/15 rounded-lg p-3 text-center">
              <p className="text-lg font-800 font-display text-teal">{bot.won}</p>
              <p className="text-xs text-teal/70">Won</p>
            </div>
            <div className="bg-red-500/8 border border-red-500/15 rounded-lg p-3 text-center">
              <p className="text-lg font-800 font-display text-red-400">{bot.lost}</p>
              <p className="text-xs text-red-400/70">Lost</p>
            </div>
          </div>
          {/* Win rate bar */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Win Rate</span>
              <span className="font-700 text-foreground">{bot.winRate}%</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-teal rounded-full transition-all duration-500"
                style={{ width: `${bot.winRate}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
