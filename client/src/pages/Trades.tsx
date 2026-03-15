import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status, alpacaStatus }: { status: string; alpacaStatus?: string | null }) {
  const alpacaCore = alpacaStatus?.split(":")?.[1];
  const isLive = alpacaStatus?.startsWith("live:");
  const isPaper = alpacaStatus?.startsWith("paper:");
  const displayStatus = alpacaCore || status;

  const colorMap: Record<string, string> = {
    open: "text-edge border-edge/30 bg-edge/5",
    won: "text-up border-up/30 bg-up/5",
    lost: "text-down border-down/30 bg-down/5",
    filled: "text-up border-up/30 bg-up/5",
    rejected: "text-down border-down/30 bg-down/5",
    pending_new: "text-edge border-edge/30 bg-edge/5",
    partially_filled: "text-teal border-teal/30 bg-teal/5",
    canceled: "text-muted-foreground border-border",
  };
  const iconMap: Record<string, any> = {
    open: <Clock size={9} className="mr-1" />,
    won: <CheckCircle size={9} className="mr-1" />,
    lost: <XCircle size={9} className="mr-1" />,
    filled: <CheckCircle size={9} className="mr-1" />,
    rejected: <XCircle size={9} className="mr-1" />,
    pending_new: <Clock size={9} className="mr-1" />,
  };

  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant="outline" className={`text-[10px] capitalize flex items-center w-fit whitespace-nowrap ${colorMap[displayStatus] || colorMap[status] || ""}`}>
        {iconMap[displayStatus] || iconMap[status]}
        {displayStatus.replace(/_/g, " ")}
      </Badge>
      {alpacaStatus && (
        <span className={`text-[9px] font-semibold tracking-wide ${isLive ? "text-up" : isPaper ? "text-edge" : "text-muted-foreground"}`}>
          {isLive ? "● LIVE" : isPaper ? "◎ PAPER" : ""}
        </span>
      )}
    </div>
  );
}

function DirectionBadge({ direction }: { direction: string }) {
  const isBuy = direction === "YES";
  return (
    <Badge variant="outline" className={`text-[10px] font-bold w-fit ${isBuy ? "text-up border-up/30 bg-up/5" : "text-down border-down/30 bg-down/5"}`}>
      {isBuy ? <TrendingUp size={9} className="mr-1" /> : <TrendingDown size={9} className="mr-1" />}
      {isBuy ? "YES" : "NO"}
    </Badge>
  );
}

// ── PNL Chart ─────────────────────────────────────────────────────────────────
function PnlChart({ trades }: { trades: any[] }) {
  const resolved = trades.filter((t) => t.status !== "open" && t.createdAt);
  if (resolved.length < 2) return null;

  // Cumulative PNL over time
  let cum = 0;
  const data = resolved
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((t) => {
      cum += t.pnl || 0;
      return { cum: parseFloat(cum.toFixed(2)), label: formatDistanceToNow(new Date(t.createdAt), { addSuffix: true }) };
    });

  const CustomTip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const v = payload[0].value;
    return (
      <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">
        <p className={`font-display font-700 ${v >= 0 ? "text-up" : "text-down"}`}>
          {v >= 0 ? "+" : ""}${v.toFixed(2)}
        </p>
      </div>
    );
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-display font-700 flex items-center gap-2">
          <Activity size={13} className="text-teal" />
          Cumulative PNL Curve
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(142 72% 45%)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="hsl(142 72% 45%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 12%, 18%)" />
            <XAxis dataKey="label" tick={false} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "hsl(210, 10%, 55%)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
            <Tooltip content={<CustomTip />} />
            <Area type="monotone" dataKey="cum" stroke="hsl(142 72% 45%)" strokeWidth={2} fill="url(#pnlGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ── Win/Loss distribution bar chart ──────────────────────────────────────────
function WinLossChart({ trades }: { trades: any[] }) {
  const resolved = trades.filter((t) => t.status !== "open");
  if (resolved.length < 3) return null;

  // Group by edge bucket
  const buckets: Record<string, { w: number; l: number }> = {};
  resolved.forEach((t) => {
    const edge = Math.floor((t.edgeDetected || 0) / 2) * 2;
    const k = `${edge}–${edge + 2}%`;
    if (!buckets[k]) buckets[k] = { w: 0, l: 0 };
    if (t.status === "won") buckets[k].w++;
    else buckets[k].l++;
  });

  const data = Object.entries(buckets).map(([edge, { w, l }]) => ({ edge, wins: w, losses: l }));

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-display font-700 flex items-center gap-2">
          <BarChart3 size={13} className="text-edge" />
          Win/Loss by Edge %
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data} barGap={2}>
            <XAxis dataKey="edge" tick={{ fill: "hsl(210, 10%, 55%)", fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: "hsl(210, 10%, 55%)", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: "hsl(220 14% 11%)", border: "1px solid hsl(220 12% 18%)", borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: "hsl(210 20% 94%)" }}
            />
            <Bar dataKey="wins" fill="hsl(142 72% 45%)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="losses" fill="hsl(0 65% 50%)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ── Filter tabs ───────────────────────────────────────────────────────────────
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
      toast({ title: "Orders synced", description: data.message || "Done" });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const tradeList: any[] = Array.isArray(trades) ? trades : [];
  const resolved = tradeList.filter((t) => t.status !== "open");
  const openTrades = tradeList.filter((t) => t.status === "open");
  const wins = resolved.filter((t) => t.status === "won").length;
  const losses = resolved.filter((t) => t.status === "lost").length;
  const totalPnl = resolved.reduce((s, t) => s + (t.pnl || 0), 0);
  const winRate = resolved.length > 0 ? (wins / resolved.length * 100).toFixed(1) : "—";
  const avgEdge = tradeList.length > 0 ? (tradeList.reduce((s, t) => s + (t.edgeDetected || 0), 0) / tradeList.length).toFixed(1) : "—";
  const realOrders = tradeList.filter((t) => t.alpacaOrderId).length;
  const avgBetSize = tradeList.length > 0 ? (tradeList.reduce((s, t) => s + (t.betSize || 0), 0) / tradeList.length).toFixed(2) : "—";

  const filterMap: Record<Filter, (t: any) => boolean> = {
    all: () => true,
    open: (t) => t.status === "open",
    won: (t) => t.status === "won",
    lost: (t) => t.status === "lost",
    live: (t) => !!t.alpacaOrderId,
  };
  const filtered = tradeList.filter(filterMap[filter]);

  const filterTabs: { key: Filter; label: string; count: number; color: string }[] = [
    { key: "all", label: "All", count: tradeList.length, color: "text-foreground border-foreground/20 bg-foreground/5" },
    { key: "open", label: "Open", count: openTrades.length, color: "text-edge border-edge/30 bg-edge/8" },
    { key: "won", label: "Won", count: wins, color: "text-up border-up/30 bg-up/8" },
    { key: "lost", label: "Lost", count: losses, color: "text-down border-down/30 bg-down/8" },
    { key: "live", label: "Alpaca", count: realOrders, color: "text-teal border-teal/30 bg-teal/8" },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-800 text-foreground tracking-tight">Trade Log</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All bot orders · updates every 5s
            {realOrders > 0 && <span className="ml-2 text-teal font-medium">· {realOrders} Alpaca orders</span>}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}
          className="gap-2 text-xs h-9">
          <RefreshCw size={12} className={syncMutation.isPending ? "animate-spin" : ""} />
          Sync Orders
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: "Total Trades", value: tradeList.length, icon: BarChart3, color: "text-foreground" },
          { label: "Win Rate", value: `${winRate}%`, icon: Target, color: "text-up" },
          { label: "Total PNL", value: `${totalPnl >= 0 ? "+" : ""}$${Math.abs(totalPnl).toFixed(2)}`, icon: DollarSign, color: totalPnl >= 0 ? "text-up" : "text-down" },
          { label: "Avg Edge", value: `${avgEdge}%`, icon: Zap, color: "text-edge" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                <Icon size={16} className={color} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
                <p className={`text-xl font-display font-700 ${color}`}>{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* W/L/Open pill row */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-up/10 border border-up/20 text-up font-medium">
          <CheckCircle size={11} /> {wins} Won
        </span>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-down/10 border border-down/20 text-down font-medium">
          <XCircle size={11} /> {losses} Lost
        </span>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-edge/10 border border-edge/20 text-edge font-medium">
          <Clock size={11} /> {openTrades.length} Open
        </span>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary border border-border text-muted-foreground font-medium">
          Avg bet ${avgBetSize}
        </span>
      </div>

      {/* Performance charts */}
      {resolved.length >= 2 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <PnlChart trades={tradeList} />
          <WinLossChart trades={tradeList} />
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {filterTabs.map(({ key, label, count, color }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-full text-xs font-display font-700 border transition-all ${
              filter === key ? color : "text-muted-foreground border-border hover:border-foreground/20"
            }`}
          >
            {label} {count > 0 ? `(${count})` : ""}
          </button>
        ))}
      </div>

      {/* Trade table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-display font-700 flex items-center gap-2">
            <BarChart3 size={13} className="text-teal" />
            {filter === "all" ? "All Orders" : filterTabs.find((f) => f.key === filter)?.label + " Orders"}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-up pulse-dot" />
            <span className="text-xs text-muted-foreground">Live updates</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="px-5 pb-4 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground px-5 pb-4">
              {filter === "all" ? "No trades yet. Start the bot and add your Alpaca keys." : `No ${filter} trades.`}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-secondary/20">
                    {["#", "Market", "Side", "Size", "Edge", "Mom.", "Status", "Fill $", "PNL", "Order", "Time"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-muted-foreground font-medium uppercase tracking-wider whitespace-nowrap text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filtered.map((t: any) => (
                    <tr key={t.id} className={`hover:bg-secondary/30 transition-colors ${t.status === "open" ? "bg-edge/3" : ""}`}>
                      <td className="px-3 py-2.5 text-muted-foreground/40 font-mono text-[10px]">{t.id}</td>
                      <td className="px-3 py-2.5 min-w-[180px] max-w-[220px]">
                        <p className="font-medium text-foreground leading-tight" style={{ wordBreak: "break-word" }}>{t.market}</p>
                        <p className="text-[9px] text-muted-foreground/50 mt-0.5">{t.marketId}</p>
                      </td>
                      <td className="px-3 py-2.5"><DirectionBadge direction={t.direction} /></td>
                      <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">${t.betSize}</td>
                      <td className="px-3 py-2.5 text-edge font-medium whitespace-nowrap">{t.edgeDetected}%</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`flex items-center gap-0.5 ${(t.btcMomentum || 0) >= 0 ? "text-up" : "text-down"}`}>
                          {(t.btcMomentum || 0) >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                          {(t.btcMomentum || 0) >= 0 ? "+" : ""}{(t.btcMomentum || 0).toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={t.status} alpacaStatus={t.alpacaOrderStatus} />
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {t.fillPrice ? `$${Number(t.fillPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {t.status !== "open" ? (
                          <span className={`font-display font-700 ${(t.pnl || 0) >= 0 ? "text-up" : "text-down"}`}>
                            {(t.pnl || 0) >= 0 ? "+" : ""}${(t.pnl || 0).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {t.alpacaOrderId ? (
                          <span className="font-mono text-[9px] text-muted-foreground truncate block max-w-[70px]" title={t.alpacaOrderId}>
                            {t.alpacaOrderId.slice(0, 8)}…
                          </span>
                        ) : (
                          <span className="text-muted-foreground/25 text-[10px]">sim</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap text-[10px]">
                        {t.createdAt ? formatDistanceToNow(new Date(t.createdAt), { addSuffix: true }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
