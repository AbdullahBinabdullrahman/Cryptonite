import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp, TrendingDown, Zap, Clock, DollarSign,
  Activity, ArrowUpRight, ArrowDownRight, Brain, Target, RefreshCw
} from "lucide-react";
import React, { useState } from "react";
import { useLiveData, AssetKey } from "@/hooks/useLiveData";
import { MiniSparkline } from "@/components/MiniSparkline";
import { ConnectionStatus } from "@/components/ConnectionStatus";

// ── Asset selector card ───────────────────────────────────────────────────────
function AssetPriceCard({ assetKey, selected, onClick }: { assetKey: AssetKey; selected: boolean; onClick: () => void }) {
  const { assets } = useLiveData(5000);
  const a = assets[assetKey];
  const colorMap: Record<AssetKey, { tab: string; label: string }> = {
    BTC:  { tab: "border-edge bg-edge/10 text-edge",  label: "₿" },
    ETH:  { tab: "border-teal bg-teal/10 text-teal",  label: "Ξ" },
    SOL:  { tab: "border-up   bg-up/10   text-up",    label: "◎" },
  };
  const { tab, label } = colorMap[assetKey];
  const isUp = (a?.change5m ?? 0) >= 0;

  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-xl border p-3 text-left transition-all duration-200 ${
        selected ? tab : "border-border bg-card hover:border-border/80"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className={`text-lg font-display font-800 ${selected ? "" : "text-muted-foreground"}`}>{label}</span>
          <span className={`text-xs font-display font-700 ${selected ? "" : "text-muted-foreground"}`}>{assetKey}</span>
        </div>
        <span className={`text-[10px] font-medium flex items-center gap-0.5 ${isUp ? "text-up" : "text-down"}`}>
          {isUp ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
          {isUp ? "+" : ""}{(a?.change5m ?? 0).toFixed(2)}%
        </span>
      </div>
      <p className="text-base font-display font-800 text-foreground tabular-nums">
        {a
          ? a.price >= 1000
            ? "$" + a.price.toLocaleString(undefined, { maximumFractionDigits: 0 })
            : "$" + a.price.toFixed(2)
          : "—"}
      </p>
      {a && <MiniSparkline data={a.history} width={90} height={20} />}
    </button>
  );
}

// ── Bayesian state badge ──────────────────────────────────────────────────────
function BayesBadge({ prior, posterior }: { prior: number; posterior: number }) {
  const shift = posterior - 0.5;
  const dir   = shift > 0.02 ? "bullish" : shift < -0.02 ? "bearish" : "neutral";
  return (
    <div className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${
      dir === "bullish" ? "bg-up/15 text-up" : dir === "bearish" ? "bg-down/15 text-down" : "bg-secondary text-muted-foreground"
    }`}>
      <Brain size={9} />
      P={Math.round(posterior * 100)}%
      <span className="opacity-60">was {Math.round(prior * 100)}%</span>
    </div>
  );
}

// ── Live CLOB market card ─────────────────────────────────────────────────────
function ClobMarketCard({ m }: { m: any }) {
  const evColor   = m.hasEdge ? "text-edge" : "text-muted-foreground/50";
  const sideColor = m.side === "YES" ? "text-up" : "text-down";
  const mins      = Math.floor(m.timeLeft / 60);
  const secs      = m.timeLeft % 60;
  const timeStr   = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <Card className={`bg-card border-border transition-all duration-300 ${m.hasEdge ? "border-edge/40 shadow-[0_0_12px_rgba(255,176,0,0.08)]" : ""}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-sm text-foreground leading-snug line-clamp-2">{m.question}</p>
          {m.hasEdge && (
            <Badge className="badge-edge text-[10px] flex-shrink-0 flex items-center gap-0.5">
              <Zap size={9} />Edge
            </Badge>
          )}
        </div>

        {/* Odds bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-up font-medium">YES {Math.round(m.yesPrice * 100)}¢</span>
            <span className="text-down font-medium">NO {Math.round(m.noPrice * 100)}¢</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-secondary flex">
            <div className="bg-up/70 transition-all duration-700 rounded-l-full" style={{ width: `${Math.round(m.yesPrice * 100)}%` }} />
            <div className="bg-down/50 transition-all duration-700 rounded-r-full flex-1" />
          </div>
          {/* Bayesian fair-value marker */}
          <div className="relative h-1">
            <div
              className="absolute top-0 w-0.5 h-1 bg-edge rounded-full"
              style={{ left: `${Math.round(m.posterior * 100)}%` }}
              title={`Model: ${Math.round(m.posterior * 100)}%`}
            />
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><DollarSign size={10} />${(m.liquidity / 1000).toFixed(0)}k</span>
          <span className="flex items-center gap-1"><Clock size={10} />{timeStr}</span>
          <span className={`font-medium flex items-center gap-0.5 ${evColor}`}>
            {m.hasEdge ? <><Zap size={9} />{m.evNet.toFixed(2)}% EV</> : "No edge"}
          </span>
        </div>

        {/* Bayesian signal */}
        {m.hasEdge && (
          <div className={`flex items-center justify-between text-[10px] pt-1 border-t border-border/50`}>
            <span className="text-muted-foreground flex items-center gap-1"><Brain size={9} />Model says:</span>
            <span className={`font-700 ${sideColor}`}>BUY {m.side} @ {m.side === "YES" ? Math.round(m.yesPrice * 100) : Math.round(m.noPrice * 100)}¢</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Markets() {
  const [activeTab, setActiveTab] = useState<AssetKey>("BTC");
  const { assets } = useLiveData(5000);

  // Live CLOB snapshot — refreshes every 15s
  const { data: clobData, isLoading: clobLoading, refetch: refetchClob } = useQuery({
    queryKey: ["/api/clob/markets"],
    queryFn: () => apiRequest("GET", "/api/clob/markets").then((r) => r.json()),
    refetchInterval: 15000,
  });

  const allMarkets: any[]  = clobData?.markets ?? [];
  const bayesMap: any      = clobData?.bayesState ?? {};
  const prices: any        = clobData?.prices ?? {};

  // Filter by selected asset tab
  const filtered = allMarkets.filter((m: any) => m.asset === activeTab);

  // Bayesian state for selected asset
  const bayes = bayesMap[activeTab];
  const assetPrice = prices[activeTab] ?? assets[activeTab]?.price ?? 0;

  // Edge count
  const edgeCount = allMarkets.filter((m: any) => m.hasEdge).length;

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-800 text-foreground tracking-tight">Markets</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Live Polymarket 5-min up/down markets — Bayesian edge detection</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetchClob()} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
            <RefreshCw size={14} className="text-muted-foreground" />
          </button>
          <div className="w-2 h-2 rounded-full bg-up pulse-dot" />
          <span className="text-xs text-up font-medium">Live</span>
        </div>
      </div>

      {/* Connection status */}
      <ConnectionStatus compact refetchInterval={60000} />

      {/* Edge summary banner */}
      {edgeCount > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-edge/30 bg-edge/8">
          <Zap size={14} className="text-edge flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-700 text-edge">{edgeCount} edge {edgeCount === 1 ? "opportunity" : "opportunities"} detected</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              CLOB strategy is auto-betting on mispricings every 10s
            </p>
          </div>
          <Badge className="badge-edge text-xs flex-shrink-0">Auto-betting</Badge>
        </div>
      )}

      {/* Asset selector */}
      <div className="flex gap-3">
        {(["BTC", "ETH", "SOL"] as AssetKey[]).map((k) => (
          <AssetPriceCard key={k} assetKey={k} selected={activeTab === k} onClick={() => setActiveTab(k)} />
        ))}
      </div>

      {/* Bayesian state for selected asset */}
      {bayes && (
        <div className="flex flex-wrap items-center gap-3">
          <div className={`flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-xl border ${
            bayes.posterior > 0.52 ? "bg-up/10 border-up/20 text-up" :
            bayes.posterior < 0.48 ? "bg-down/10 border-down/20 text-down" :
            "bg-secondary border-border text-muted-foreground"
          }`}>
            <Brain size={12} />
            Bayesian model: P(up) = <span className="font-700 ml-0.5">{Math.round(bayes.posterior * 100)}%</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-border bg-secondary/30">
            <Activity size={11} className="text-muted-foreground" />
            <span className="text-muted-foreground">σ²:</span>
            <span className="font-medium">{bayes.variance?.toFixed(8) ?? "—"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-border bg-secondary/30">
            <Target size={11} className="text-muted-foreground" />
            <span className="text-muted-foreground">{bayes.ticks} price ticks</span>
          </div>
        </div>
      )}

      {/* Markets grid */}
      {clobLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="p-8 text-center">
            <Activity size={28} className="text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">No {activeTab} markets found</p>
            <p className="text-xs text-muted-foreground mt-1">Polymarket may not have active 5-min {activeTab} markets right now.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((m: any, i: number) => (
            <ClobMarketCard key={i} m={m} />
          ))}
        </div>
      )}

      {/* How it works */}
      <Card className="bg-card border-border">
        <CardContent className="p-5">
          <h3 className="text-sm font-display font-700 text-foreground mb-3 flex items-center gap-2">
            <Brain size={13} className="text-teal" />
            How the Bayesian Engine Works
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
            <div>
              <p className="text-foreground font-medium mb-1">1. Bayesian Update</p>
              <p>P(H|D) = P(D|H)·P(H)/P(D) — model updates its probability estimate every 10 seconds using live price data as evidence.</p>
            </div>
            <div>
              <p className="text-foreground font-medium mb-1">2. EV Filter</p>
              <p>EV = q − p − c — only bets where model price (q) beats market price (p) + fees (c). Minimum 0.5% edge required.</p>
            </div>
            <div>
              <p className="text-foreground font-medium mb-1">3. Kelly Sizing</p>
              <p>f* = (b·p − q)/b — bet fraction scales with edge strength. $1–$10 per trade, auto-compounding profits.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
