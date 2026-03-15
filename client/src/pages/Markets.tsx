import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Zap, Clock, DollarSign, Activity, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import React, { useState } from "react";
import { useLiveData, AssetKey } from "@/hooks/useLiveData";
import { MiniSparkline } from "@/components/MiniSparkline";
import { ConnectionStatus } from "@/components/ConnectionStatus";

// ── Odds visual bar ───────────────────────────────────────────────────────────
function OddsBar({ yes, no }: { yes: number; no: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-up font-medium">YES {Math.round(yes * 100)}¢</span>
        <span className="text-down font-medium">NO {Math.round(no * 100)}¢</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden bg-secondary flex">
        <div className="bg-up/70 transition-all duration-700 rounded-l-full" style={{ width: `${Math.round(yes * 100)}%` }} />
        <div className="bg-down/50 transition-all duration-700 rounded-r-full flex-1" />
      </div>
    </div>
  );
}

// ── Asset header card with live price ────────────────────────────────────────
function AssetPriceCard({ assetKey, selected, onClick }: { assetKey: AssetKey; selected: boolean; onClick: () => void }) {
  const { assets } = useLiveData(5000);
  const a = assets[assetKey];

  const colorMap: Record<AssetKey, { tab: string; glow: string; label: string }> = {
    BTC: { tab: "border-edge bg-edge/10 text-edge", glow: "glow-edge", label: "₿" },
    ETH: { tab: "border-teal bg-teal/10 text-teal", glow: "glow-teal", label: "Ξ" },
    SOL: { tab: "border-up bg-up/10 text-up", glow: "glow-up", label: "◎" },
  };
  const { tab, glow, label } = colorMap[assetKey];
  const isUp = (a?.change5m ?? 0) >= 0;

  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-xl border p-3 text-left transition-all duration-200 ${
        selected ? `${tab} ${glow}` : "border-border bg-card hover:border-border/80"
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

// ── Market card ───────────────────────────────────────────────────────────────
function MarketCard({ market, assetLabel, assetMomentum, settings }: any) {
  const { toast } = useToast();
  const [swipeDir, setSwipeDir] = useState<"up" | "down" | null>(null);

  const betMutation = useMutation({
    mutationFn: async (direction: "YES" | "NO") => {
      const s: any = settings || {};
      if (!s.alpacaApiKey) throw new Error("Add Alpaca API keys in Settings first");
      const odds = direction === "YES" ? market.yesOdds : market.noOdds;
      const implied = odds + (assetMomentum === "bullish" ? 0.08 : assetMomentum === "bearish" ? -0.08 : 0);
      const edge = Math.abs(implied - odds) * 100;
      return apiRequest("POST", "/api/trades", {
        market: market.name,
        marketId: market.id,
        direction,
        betSize: s.betSize || 25,
        entryOdds: odds,
        btcMomentum: assetMomentum === "bullish" ? 0.35 : assetMomentum === "bearish" ? -0.35 : 0,
        edgeDetected: Math.round(edge * 10) / 10,
        status: "open",
        pnl: 0,
        resolvedAt: null,
      });
    },
    onSuccess: (_, direction) => {
      setSwipeDir(direction === "YES" ? "up" : "down");
      toast({ title: `${assetLabel} bet placed: ${direction}`, description: market.name });
      setTimeout(() => setSwipeDir(null), 400);
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const impliedYes = market.yesOdds + (assetMomentum === "bullish" ? 0.09 : assetMomentum === "bearish" ? -0.09 : 0);
  const edgePct = Math.abs(impliedYes - market.yesOdds) * 100;
  const hasEdge = edgePct >= 3;
  const edgeDirection = impliedYes > market.yesOdds ? "YES" : "NO";

  return (
    <Card className={`bg-card border-border card-lift ${hasEdge ? "border-edge/40" : ""} ${
      swipeDir === "up" ? "swiping-up" : swipeDir === "down" ? "swiping-down" : ""
    }`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-sm text-foreground leading-snug">{market.name}</p>
          {hasEdge && (
            <Badge className="badge-edge text-[10px] flex-shrink-0 flex items-center gap-0.5">
              <Zap size={9} />Edge
            </Badge>
          )}
        </div>
        <OddsBar yes={market.yesOdds} no={market.noOdds} />
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><DollarSign size={10} />${(market.liquidity / 1000).toFixed(0)}k vol</span>
          <span className="flex items-center gap-1"><Clock size={10} />{market.timeLeft}</span>
          {hasEdge
            ? <span className="text-edge font-medium flex items-center gap-0.5"><Zap size={9} />{edgePct.toFixed(1)}%</span>
            : <span className="text-muted-foreground/50">No edge</span>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => betMutation.mutate("YES")} disabled={betMutation.isPending}
            className={`text-xs h-8 font-display font-700 ${
              edgeDirection === "YES" && hasEdge ? "bg-up text-white hover:bg-up/90" : "bg-up/15 text-up hover:bg-up/25 border border-up/20"
            }`}>
            <TrendingUp size={11} className="mr-1" />YES {Math.round(market.yesOdds * 100)}¢
          </Button>
          <Button size="sm" onClick={() => betMutation.mutate("NO")} disabled={betMutation.isPending}
            className={`text-xs h-8 font-display font-700 ${
              edgeDirection === "NO" && hasEdge ? "bg-down text-white hover:bg-down/90" : "bg-down/15 text-down hover:bg-down/25 border border-down/20"
            }`}>
            <TrendingDown size={11} className="mr-1" />NO {Math.round(market.noOdds * 100)}¢
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Markets data ──────────────────────────────────────────────────────────────
const ALL_MARKETS = {
  BTC: [
    { id: "btc-15m",       name: "Will BTC be higher in 15 min?",      yesOdds: 0.47, noOdds: 0.53, volume: 47200,  timeLeft: "12m",    liquidity: 47200  },
    { id: "btc-1h",        name: "Will BTC be higher in 1 hour?",       yesOdds: 0.51, noOdds: 0.49, volume: 93100,  timeLeft: "48m",    liquidity: 93100  },
    { id: "btc-83k-today", name: "Will BTC close above $83k today?",    yesOdds: 0.61, noOdds: 0.39, volume: 34000,  timeLeft: "6h",     liquidity: 34000  },
    { id: "btc-84k-2h",    name: "Will BTC be above $84k in 2 hours?",  yesOdds: 0.38, noOdds: 0.62, volume: 21500,  timeLeft: "1h 44m", liquidity: 21500  },
    { id: "btc-85k-week",  name: "Will BTC hit $85k this week?",        yesOdds: 0.44, noOdds: 0.56, volume: 128000, timeLeft: "3d",     liquidity: 128000 },
    { id: "btc-1pct-1h",   name: "Will BTC gain 1%+ this hour?",        yesOdds: 0.29, noOdds: 0.71, volume: 18000,  timeLeft: "52m",    liquidity: 18000  },
  ],
  ETH: [
    { id: "eth-15m",       name: "Will ETH be higher in 15 min?",       yesOdds: 0.48, noOdds: 0.52, volume: 32000,  timeLeft: "12m",    liquidity: 32000  },
    { id: "eth-1h",        name: "Will ETH be higher in 1 hour?",        yesOdds: 0.50, noOdds: 0.50, volume: 61000,  timeLeft: "48m",    liquidity: 61000  },
    { id: "eth-2k-today",  name: "Will ETH close above $2k today?",      yesOdds: 0.55, noOdds: 0.45, volume: 28000,  timeLeft: "6h",     liquidity: 28000  },
    { id: "eth-3k-week",   name: "Will ETH hit $3k this week?",          yesOdds: 0.22, noOdds: 0.78, volume: 54000,  timeLeft: "3d",     liquidity: 54000  },
    { id: "eth-1pct-1h",   name: "Will ETH gain 1%+ this hour?",         yesOdds: 0.31, noOdds: 0.69, volume: 14000,  timeLeft: "52m",    liquidity: 14000  },
    { id: "eth-2pct-day",  name: "Will ETH gain 2%+ today?",             yesOdds: 0.40, noOdds: 0.60, volume: 19000,  timeLeft: "6h",     liquidity: 19000  },
  ],
  SOL: [
    { id: "sol-15m",       name: "Will SOL be higher in 15 min?",        yesOdds: 0.49, noOdds: 0.51, volume: 18000,  timeLeft: "12m",    liquidity: 18000  },
    { id: "sol-1h",        name: "Will SOL be higher in 1 hour?",         yesOdds: 0.52, noOdds: 0.48, volume: 37000,  timeLeft: "48m",    liquidity: 37000  },
    { id: "sol-130-today", name: "Will SOL close above $130 today?",      yesOdds: 0.43, noOdds: 0.57, volume: 15000,  timeLeft: "6h",     liquidity: 15000  },
    { id: "sol-150-week",  name: "Will SOL hit $150 this week?",          yesOdds: 0.35, noOdds: 0.65, volume: 42000,  timeLeft: "3d",     liquidity: 42000  },
    { id: "sol-2pct-1h",   name: "Will SOL gain 2%+ this hour?",          yesOdds: 0.26, noOdds: 0.74, volume: 11000,  timeLeft: "52m",    liquidity: 11000  },
    { id: "sol-5pct-day",  name: "Will SOL gain 5%+ today?",              yesOdds: 0.18, noOdds: 0.82, volume: 9000,   timeLeft: "6h",     liquidity: 9000   },
  ],
};

export default function Markets() {
  const [activeTab, setActiveTab] = useState<AssetKey>("BTC");
  const { assets } = useLiveData(5000);

  const { data: settings } = useQuery({ queryKey: ["/api/settings"] });
  const { data: btcData } = useQuery({ queryKey: ["/api/btc"], refetchInterval: 15000 });
  const { data: edges } = useQuery({
    queryKey: ["/api/edges"],
    queryFn: () => apiRequest("GET", "/api/edges?limit=3").then((r) => r.json()),
    refetchInterval: 10000,
  });

  const btcMomentum = (btcData as any)?.momentum || "neutral";
  const getMomentum = (asset: AssetKey) => {
    if (asset === "BTC") return btcMomentum;
    const chg = assets[asset]?.change5m ?? 0;
    if (chg > 0.03) return "bullish";
    if (chg < -0.03) return "bearish";
    return "neutral";
  };

  const momentum = getMomentum(activeTab);
  const markets = ALL_MARKETS[activeTab];
  const activeAsset = assets[activeTab];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-800 text-foreground tracking-tight">Markets</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Short-term crypto prediction markets with live price feed</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-up pulse-dot" />
          <span className="text-xs text-up font-medium">Live prices</span>
        </div>
      </div>

      {/* Connection status pills */}
      <ConnectionStatus compact refetchInterval={60000} />

      {/* Asset selector cards with live prices */}
      <div className="flex gap-3">
        {(["BTC", "ETH", "SOL"] as AssetKey[]).map((k) => (
          <AssetPriceCard key={k} assetKey={k} selected={activeTab === k} onClick={() => setActiveTab(k)} />
        ))}
      </div>

      {/* Momentum + live stats bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className={`flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-xl border ${
          momentum === "bullish" ? "bg-up/10 border-up/20 text-up" :
          momentum === "bearish" ? "bg-down/10 border-down/20 text-down" :
          "bg-secondary border-border text-muted-foreground"
        }`}>
          {momentum === "bullish" ? <TrendingUp size={12} /> : momentum === "bearish" ? <TrendingDown size={12} /> : <Activity size={12} />}
          {activeTab} momentum: <span className="font-700 capitalize ml-0.5">{momentum}</span>
        </div>
        {activeAsset && (
          <>
            <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-border bg-secondary/30">
              <span className="text-muted-foreground">1m:</span>
              <span className={activeAsset.change1m >= 0 ? "text-up font-medium" : "text-down font-medium"}>
                {activeAsset.change1m >= 0 ? "+" : ""}{activeAsset.change1m.toFixed(3)}%
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-border bg-secondary/30">
              <span className="text-muted-foreground">5m:</span>
              <span className={activeAsset.change5m >= 0 ? "text-up font-medium" : "text-down font-medium"}>
                {activeAsset.change5m >= 0 ? "+" : ""}{activeAsset.change5m.toFixed(3)}%
              </span>
            </div>
          </>
        )}
      </div>

      {/* Edge alert */}
      {edges?.some((e: any) => e.edgePct >= 5 && e.status === "detected") && (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-edge/30 bg-edge/8">
          <Zap size={14} className="text-edge flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-edge">Edge Detected by Bot</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {edges?.find((e: any) => e.edgePct >= 5)?.market} — {edges?.find((e: any) => e.edgePct >= 5)?.edgePct.toFixed(1)}% mispricing
            </p>
          </div>
          <Badge className="ml-auto badge-edge text-xs flex-shrink-0">Auto-bet active</Badge>
        </div>
      )}

      {/* Markets grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {markets.map((m) => (
          <MarketCard
            key={m.id}
            market={m}
            assetLabel={activeTab}
            assetMomentum={momentum}
            settings={settings}
          />
        ))}
      </div>

      {/* How it works */}
      <Card className="bg-card border-border">
        <CardContent className="p-5">
          <h3 className="text-sm font-display font-700 text-foreground mb-3 flex items-center gap-2">
            <Zap size={13} className="text-teal" />
            How Edge Detection Works
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
            <div><p className="text-foreground font-medium mb-1">1. Live Price Feed</p><p>BTC, ETH, SOL prices pulled from Binance every 5 seconds. Sparklines show real-time trajectory.</p></div>
            <div><p className="text-foreground font-medium mb-1">2. Edge = Odds Mismatch</p><p>When momentum strongly implies a direction but Polymarket odds haven't moved yet — that's the edge window.</p></div>
            <div><p className="text-foreground font-medium mb-1">3. Auto-execute</p><p>Edge ≥ min threshold → bot places a real market order on Alpaca automatically. No manual action needed.</p></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
