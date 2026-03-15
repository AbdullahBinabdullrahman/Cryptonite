import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from "recharts";
import {
  TrendingUp, TrendingDown, Play, Square, Zap,
  Target, Activity, DollarSign, BarChart3, ArrowUpRight,
  Wifi, WifiOff, Bot, Flame, Clock, CheckCircle, XCircle
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useLiveData } from "@/hooks/useLiveData";
import { MiniSparkline } from "@/components/MiniSparkline";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import React, { useEffect, useRef, useState } from "react";

// ── Live flip number animation ────────────────────────────────────────────────
function FlipNumber({ value, prefix = "", suffix = "", className = "" }: { value: number; prefix?: string; suffix?: string; className?: string }) {
  const [display, setDisplay] = useState(value);
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    if (value !== prev.current) {
      setFlash(true);
      setDisplay(value);
      prev.current = value;
      const t = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <span className={`${className} transition-all duration-300 ${flash ? "scale-110 opacity-100" : ""}`}
      style={{ display: "inline-block" }}>
      {prefix}{display}{suffix}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, trend, icon: Icon, color = "teal", live = false, sparkData }: any) {
  const colorMap: Record<string, string> = {
    teal: "text-teal", up: "text-up", down: "text-down", edge: "text-edge",
  };
  const bgMap: Record<string, string> = {
    teal: "bg-teal/10 border-teal/20", up: "bg-up/10 border-up/20",
    down: "bg-down/10 border-down/20", edge: "bg-edge/10 border-edge/20",
  };
  return (
    <Card className={`bg-card border-border card-lift`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
              {live && <div className="w-1.5 h-1.5 rounded-full bg-up pulse-dot" />}
            </div>
            <p className={`text-2xl font-display font-800 ${colorMap[color] || "text-foreground"} tabular-nums`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${bgMap[color] || "bg-secondary border-border"}`}>
            <Icon className={`w-5 h-5 ${colorMap[color]}`} />
          </div>
        </div>
        {sparkData && sparkData.length >= 2 && (
          <div className="mt-3">
            <MiniSparkline data={sparkData} width={120} height={28} />
          </div>
        )}
        {trend !== undefined && (
          <div className={`mt-2 flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-up" : "text-down"}`}>
            {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {trend >= 0 ? "+" : ""}{trend}% today
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Live asset strip ──────────────────────────────────────────────────────────
function AssetStrip() {
  const { assets } = useLiveData(5000);
  const keys = ["BTC", "ETH", "SOL"] as const;
  const labels: Record<string, { color: string; accent: string }> = {
    BTC: { color: "text-edge", accent: "border-edge/30 bg-edge/8" },
    ETH: { color: "text-teal", accent: "border-teal/30 bg-teal/8" },
    SOL: { color: "text-up", accent: "border-up/30 bg-up/8" },
  };

  return (
    <div className="grid grid-cols-3 gap-3">
      {keys.map((k) => {
        const a = assets[k];
        const { color, accent } = labels[k];
        const isUp = (a?.change5m ?? 0) >= 0;
        return (
          <div key={k} className={`rounded-xl border p-3 ${accent}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-display font-700 ${color}`}>{k}</span>
              <span className={`text-[10px] font-medium flex items-center gap-0.5 ${isUp ? "text-up" : "text-down"}`}>
                {isUp ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                {isUp ? "+" : ""}{(a?.change5m ?? 0).toFixed(2)}%
              </span>
            </div>
            <p className="text-lg font-display font-800 text-foreground tabular-nums">
              {a ? (a.price >= 1000 ? "$" + a.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "$" + a.price.toFixed(2)) : "—"}
            </p>
            {a && <MiniSparkline data={a.history} width={100} height={24} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Bot health panel ──────────────────────────────────────────────────────────
function BotHealthPanel({ d, alpaca }: { d: any; alpaca: any }) {
  const alpacaConnected = alpaca?.ok === true;
  const alpacaIsLive = alpaca?.isLive === true;

  const metrics = [
    {
      label: "Bot Status",
      value: d.isRunning ? "Running" : "Stopped",
      color: d.isRunning ? "text-up" : "text-muted-foreground",
      icon: <Bot size={12} className={d.isRunning ? "text-up" : "text-muted-foreground"} />,
    },
    {
      label: "Alpaca",
      value: alpacaConnected ? (alpacaIsLive ? "Live" : "Paper") : "Offline",
      color: alpacaConnected ? (alpacaIsLive ? "text-up" : "text-edge") : "text-down",
      icon: alpacaConnected ? <Wifi size={12} className={alpacaIsLive ? "text-up" : "text-edge"} /> : <WifiOff size={12} className="text-down" />,
    },
    {
      label: "Today's Bets",
      value: d.todayCount ?? 0,
      color: "text-foreground",
      icon: <Flame size={12} className="text-edge" />,
    },
    {
      label: "Engine",
      value: "15s tick",
      color: "text-teal",
      icon: <Activity size={12} className="text-teal" />,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {metrics.map(({ label, value, color, icon }) => (
        <div key={label} className="bg-secondary/30 rounded-xl p-3 border border-border flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className={`text-sm font-display font-700 ${color}`}>{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Live trade feed row ───────────────────────────────────────────────────────
function TradeFeedRow({ t, isNew }: { t: any; isNew: boolean }) {
  const isWon = t.status === "won";
  const isLost = t.status === "lost";
  const isOpen = t.status === "open";

  return (
    <div className={`px-5 py-3 flex items-center justify-between transition-all duration-500 ${isNew ? "bg-teal/5 sweep-in" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground truncate pr-2">{t.market}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          ${t.betSize} · edge {t.edgeDetected}% ·{" "}
          {t.createdAt ? formatDistanceToNow(new Date(t.createdAt), { addSuffix: true }) : "—"}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Badge
          variant="outline"
          className={`text-[10px] ${
            t.direction === "YES" ? "text-up border-up/30 bg-up/5" : "text-down border-down/30 bg-down/5"
          }`}
        >
          {t.direction}
        </Badge>
        <Badge
          variant="outline"
          className={`text-[10px] ${
            isOpen ? "text-edge border-edge/30" :
            isWon ? "text-up border-up/30" :
            isLost ? "text-down border-down/30" : ""
          }`}
        >
          {isOpen ? <Clock size={9} className="mr-0.5" /> : isWon ? <CheckCircle size={9} className="mr-0.5" /> : <XCircle size={9} className="mr-0.5" />}
          {t.status}
        </Badge>
        {!isOpen && (
          <span className={`text-xs font-display font-700 ${(t.pnl || 0) >= 0 ? "text-up" : "text-down"}`}>
            {(t.pnl || 0) >= 0 ? "+" : ""}${(t.pnl || 0).toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── PNL Bar chart (daily) ─────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-display font-700 text-teal">${payload[0]?.value?.toFixed(2)}</p>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { toast } = useToast();
  const prevTradeCount = useRef(0);
  const [newTradeIds, setNewTradeIds] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["/api/dashboard"],
    refetchInterval: 5000,
  });

  const { data: alpacaData } = useQuery({
    queryKey: ["/api/alpaca/account"],
    queryFn: () => apiRequest("GET", "/api/alpaca/account").then((r) => r.json()),
    refetchInterval: 30000,
    retry: false,
  });

  const { data: trades, isLoading: tradesLoading } = useQuery({
    queryKey: ["/api/trades"],
    queryFn: () => apiRequest("GET", "/api/trades?limit=10").then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: edges } = useQuery({
    queryKey: ["/api/edges"],
    queryFn: () => apiRequest("GET", "/api/edges?limit=5").then((r) => r.json()),
    refetchInterval: 5000,
  });

  // Flash new rows
  useEffect(() => {
    if (!trades) return;
    const list: any[] = Array.isArray(trades) ? trades : [];
    if (list.length > prevTradeCount.current) {
      const newOnes = list.slice(0, list.length - prevTradeCount.current).map((t: any) => t.id);
      setNewTradeIds(new Set(newOnes));
      setTimeout(() => setNewTradeIds(new Set()), 3000);
    }
    prevTradeCount.current = list.length;
  }, [trades]);

  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/bot/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Bot started", description: "Edge detection is now running." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const stopMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/bot/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Bot stopped" });
    },
  });

  const d: any = data || {};
  const pnlHistory = (d.pnlHistory || []).map((s: any) => ({
    ...s,
    label: format(new Date(s.timestamp), "MMM d HH:mm"),
    pnl: s.pnl ?? 0,
  }));

  const totalPnl = (d.totalBalance || 0) - (d.startingBalance || 0);
  const winRatePct = d.winRate?.rate ? Math.round(d.winRate.rate * 100) : 0;

  const alpaca: any = alpacaData || {};
  const alpacaConnected = alpaca.ok === true;
  const alpacaIsLive = alpaca.isLive === true;
  const alpacaBalance = alpacaConnected && alpaca.account
    ? parseFloat(alpaca.account.portfolio_value || alpaca.account.cash || "0")
    : null;
  const displayBalance = alpacaBalance !== null ? alpacaBalance : (d.totalBalance || 0);

  const tradeList: any[] = Array.isArray(trades) ? trades : [];

  // Build sparkline for balance
  const balanceSpark = pnlHistory.map((p: any) => ({ ts: new Date(p.timestamp || Date.now()).getTime(), price: p.balance ?? 0 }));

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-800 text-foreground tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Live BTC · ETH · SOL edge detection & automated execution</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Live status indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-secondary/50">
            <div className={`w-2 h-2 rounded-full ${d.isRunning ? "bg-up pulse-dot" : "bg-muted-foreground"}`} />
            <span className={`text-xs font-medium ${d.isRunning ? "text-up" : "text-muted-foreground"}`}>
              {d.isRunning ? "Bot Running" : "Bot Stopped"}
            </span>
          </div>
          {d.isRunning ? (
            <Button size="sm" variant="destructive" onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending} className="gap-2 h-9">
              <Square size={13} /> Stop Bot
            </Button>
          ) : (
            <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}
              className="gap-2 h-9 bg-teal text-background hover:bg-teal/90 bot-running">
              <Play size={13} /> Start Bot
            </Button>
          )}
        </div>
      </div>

      {/* Live asset strip */}
      <AssetStrip />

      {/* Bot health */}
      <BotHealthPanel d={d} alpaca={alpaca} />

      {/* Connection status — compact pills */}
      <ConnectionStatus compact refetchInterval={30000} />

      {/* Stats grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard
            label="Portfolio"
            value={`$${displayBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            sub={alpacaConnected
              ? `${alpacaIsLive ? "Live" : "Paper"} · cash $${parseFloat(alpaca.account?.cash || "0").toFixed(2)}`
              : `Started $${(d.startingBalance || 0).toFixed(2)}`}
            icon={DollarSign}
            color="teal"
            live={alpacaConnected}
            sparkData={balanceSpark}
          />
          <StatCard
            label="Total Return"
            value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`}
            sub={`${d.totalReturn || 0}% all-time`}
            icon={TrendingUp}
            color={totalPnl >= 0 ? "up" : "down"}
          />
          <StatCard
            label="Today's PNL"
            value={`${(d.todayPnl || 0) >= 0 ? "+" : ""}$${(d.todayPnl || 0).toFixed(2)}`}
            sub={`${d.todayCount || 0} bets today`}
            icon={Activity}
            color={(d.todayPnl || 0) >= 0 ? "up" : "down"}
            live
          />
          <StatCard
            label="Win Rate"
            value={`${winRatePct}%`}
            sub={`${d.winRate?.wins || 0} of ${d.winRate?.total || 0} resolved`}
            icon={Target}
            color="edge"
          />
        </div>
      )}

      {/* PNL chart + edge feed */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* PNL Chart */}
        <Card className="xl:col-span-2 bg-card border-border">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-display font-700">Portfolio Performance</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Balance over time (updates every 5s)</p>
            </div>
            <Badge variant="outline" className="text-xs text-teal border-teal/30">
              <ArrowUpRight size={11} className="mr-1" />{d.totalReturn || 0}%
            </Badge>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={pnlHistory}>
                  <defs>
                    <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(175, 75%, 42%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(175, 75%, 42%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 12%, 18%)" />
                  <XAxis dataKey="label" tick={{ fill: "hsl(210, 10%, 55%)", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "hsl(210, 10%, 55%)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="balance" stroke="hsl(175, 75%, 42%)" strokeWidth={2} fill="url(#balGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Edge Opportunities */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-display font-700 flex items-center gap-2">
              <Zap size={13} className="text-edge" />
              Live Edges
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-up pulse-dot" />
              <Badge variant="outline" className="text-[10px] badge-edge">Live</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!edges?.length ? (
              <p className="text-sm text-muted-foreground px-5 pb-4">Scanning for edges…</p>
            ) : (
              <div className="divide-y divide-border">
                {edges.slice(0, 6).map((e: any) => (
                  <div key={e.id} className="px-4 py-3 sweep-in">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-foreground truncate pr-2 flex-1">{e.market}</p>
                      <span className="text-xs font-display font-800 text-edge flex-shrink-0">+{e.edgePct}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-muted-foreground">
                        Poly {(e.polyOdds * 100).toFixed(0)}¢ → Implied {(e.impliedOdds * 100).toFixed(0)}¢
                      </p>
                      <Badge className={`text-[10px] ${e.direction === "YES" ? "bg-up/15 text-up border-up/20" : "bg-down/15 text-down border-down/20"} border`}>
                        {e.direction}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Live trade feed */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-display font-700 flex items-center gap-2">
            <BarChart3 size={13} className="text-teal" />
            Live Trade Feed
          </CardTitle>
          <div className="flex items-center gap-2">
            {tradeList.length > 0 && (
              <span className="text-xs text-muted-foreground">{tradeList.length} orders</span>
            )}
            <div className="w-1.5 h-1.5 rounded-full bg-up pulse-dot" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {tradesLoading ? (
            <div className="px-5 pb-4 space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !tradeList.length ? (
            <p className="text-sm text-muted-foreground px-5 pb-4">No trades yet. Start the bot and add your Alpaca keys.</p>
          ) : (
            <div className="divide-y divide-border/50">
              {tradeList.slice(0, 8).map((t: any) => (
                <TradeFeedRow key={t.id} t={t} isNew={newTradeIds.has(t.id)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
