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
import { LiveBotSprite } from "@/components/BotSprite";
import React, { useEffect, useRef, useState } from "react";

// ── Pixel section header ──────────────────────────────────────────────────────
function SectionHeader({ title, sub, badge }: { title: string; sub?: string; badge?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
        <span style={{ color: "hsl(45 100% 55%)", fontFamily: "var(--font-mono)", fontSize: 10 }}>▶</span>
        <span style={{ fontFamily: "var(--font-pixel)", fontSize: 8, color: "hsl(120 100% 60%)", letterSpacing: "0.1em", textShadow: "0 0 8px hsl(120 100% 50% / 0.5)" }}>
          {title}
        </span>
        {badge && (
          <span style={{
            fontFamily: "var(--font-pixel)", fontSize: 6, padding: "2px 6px",
            border: "1px solid hsl(45 100% 55% / 0.5)",
            color: "hsl(45 100% 60%)",
            background: "hsl(45 100% 55% / 0.08)",
            letterSpacing: "0.05em",
          }}>
            {badge}
          </span>
        )}
      </div>
      {sub && <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 35%)", paddingLeft: 18 }}>{sub}</div>}
    </div>
  );
}

// ── Stat card (arcade HUD style) ──────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color = "green", live = false, sparkData }: any) {
  const colorMap: Record<string, string> = {
    green: "hsl(120 100% 55%)",
    amber: "hsl(45 100% 55%)",
    red:   "hsl(0 90% 55%)",
    cyan:  "hsl(175 90% 55%)",
    teal:  "hsl(175 90% 55%)",
    up:    "hsl(120 100% 55%)",
    down:  "hsl(0 90% 55%)",
    edge:  "hsl(45 100% 55%)",
  };
  const col = colorMap[color] || colorMap.green;

  return (
    <div
      style={{
        background: "hsl(220 20% 5%)",
        border: `1px solid ${col}30`,
        boxShadow: `0 0 12px ${col}10, inset 0 0 20px ${col}04`,
        padding: "14px",
        position: "relative",
        cursor: "default",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = `${col}60`;
        (e.currentTarget as HTMLElement).style.boxShadow = `0 0 20px ${col}25, inset 0 0 20px ${col}08`;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = `${col}30`;
        (e.currentTarget as HTMLElement).style.boxShadow = `0 0 12px ${col}10, inset 0 0 20px ${col}04`;
      }}
    >
      {/* Corner accent */}
      <div style={{ position: "absolute", top: 0, left: 0, width: 8, height: 8, borderTop: `2px solid ${col}`, borderLeft: `2px solid ${col}` }} />
      <div style={{ position: "absolute", top: 0, right: 0, width: 8, height: 8, borderTop: `2px solid ${col}`, borderRight: `2px solid ${col}` }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, width: 8, height: 8, borderBottom: `2px solid ${col}`, borderLeft: `2px solid ${col}` }} />
      <div style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 8, borderBottom: `2px solid ${col}`, borderRight: `2px solid ${col}` }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 25% 35%)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {label}
            </span>
            {live && <div className="pulse-dot" style={{ width: 4, height: 4, background: col, boxShadow: `0 0 6px ${col}` }} />}
          </div>
          <div style={{ fontFamily: "var(--font-pixel)", fontSize: 13, color: col, textShadow: `0 0 10px ${col}60`, letterSpacing: "0.03em", marginBottom: 2 }}>
            {value}
          </div>
          {sub && <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 35%)" }}>{sub}</div>}
        </div>
        <div
          style={{
            width: 32, height: 32, flexShrink: 0, marginLeft: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `1px solid ${col}30`,
            background: `${col}10`,
          }}
        >
          <Icon size={14} style={{ color: col }} />
        </div>
      </div>

      {sparkData && sparkData.length >= 2 && (
        <div style={{ marginTop: 8 }}>
          <MiniSparkline data={sparkData} width={100} height={24} />
        </div>
      )}
    </div>
  );
}

// ── Live asset strip ──────────────────────────────────────────────────────────
function AssetStrip() {
  const { assets } = useLiveData(5000);
  const keys = ["BTC", "ETH", "SOL"] as const;
  const config = {
    BTC: { color: "hsl(45 100% 55%)",  sym: "₿", label: "BITCOIN" },
    ETH: { color: "hsl(175 90% 55%)", sym: "Ξ", label: "ETHEREUM" },
    SOL: { color: "hsl(120 100% 55%)", sym: "◎", label: "SOLANA" },
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {keys.map((k) => {
        const a = assets[k];
        const { color, sym, label } = config[k];
        const isUp = (a?.change5m ?? 0) >= 0;
        const chg = (a?.change5m ?? 0);
        return (
          <div
            key={k}
            style={{
              background: "hsl(220 20% 5%)",
              border: `1px solid ${color}25`,
              boxShadow: `0 0 10px ${color}08`,
              padding: "10px 12px",
              position: "relative",
            }}
          >
            <div style={{ position: "absolute", top: 0, left: 0, width: 6, height: 6, borderTop: `1px solid ${color}`, borderLeft: `1px solid ${color}` }} />
            <div style={{ position: "absolute", top: 0, right: 0, width: 6, height: 6, borderTop: `1px solid ${color}`, borderRight: `1px solid ${color}` }} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontFamily: "var(--font-pixel)", fontSize: 10, color, textShadow: `0 0 8px ${color}80` }}>{sym}</span>
                <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color, letterSpacing: "0.05em" }}>{k}</span>
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: isUp ? "hsl(120 100% 55%)" : "hsl(0 90% 55%)" }}>
                {isUp ? "▲" : "▼"} {isUp ? "+" : ""}{chg.toFixed(2)}%
              </span>
            </div>
            <div style={{ fontFamily: "var(--font-pixel)", fontSize: 10, color: "hsl(120 85% 70%)", marginBottom: 4, letterSpacing: "0.02em" }}>
              {a ? (a.price >= 1000 ? "$" + a.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "$" + a.price.toFixed(2)) : "----"}
            </div>
            {a && <MiniSparkline data={a.history} width={80} height={20} />}
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
    { label: "BOT ENGINE", value: d.isRunning ? "ONLINE" : "OFFLINE", color: d.isRunning ? "hsl(120 100% 55%)" : "hsl(120 25% 30%)", pulse: d.isRunning },
    { label: "ALPACA", value: alpacaConnected ? (alpacaIsLive ? "LIVE" : "PAPER") : "NO SIGNAL", color: alpacaConnected ? (alpacaIsLive ? "hsl(120 100% 55%)" : "hsl(45 100% 55%)") : "hsl(0 90% 55%)" },
    { label: "BETS TODAY", value: String(d.todayCount ?? 0), color: "hsl(45 100% 55%)" },
    { label: "TICK RATE", value: "15s", color: "hsl(175 90% 55%)" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
      {/* Label row */}
      <div style={{ gridColumn: "1/-1", fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 25% 30%)", letterSpacing: "0.1em", marginBottom: 2 }}>
        ▸ SYSTEM DIAGNOSTICS
      </div>
      {metrics.map(({ label, value, color, pulse }) => (
        <div
          key={label}
          style={{
            background: "hsl(220 20% 4%)",
            border: "1px solid hsl(120 30% 12%)",
            padding: "8px 10px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
            {pulse && (
              <div className="pulse-dot" style={{ width: 5, height: 5, background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0 }} />
            )}
            <div>
              <div style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 25% 28%)", letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color, letterSpacing: "0.05em" }}>{value}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Live trade feed row ───────────────────────────────────────────────────────
function TradeFeedRow({ t, isNew }: { t: any; isNew: boolean }) {
  const isWon  = t.status === "won";
  const isLost = t.status === "lost";
  const isOpen = t.status === "open";
  const pnl    = t.pnl || 0;

  return (
    <div
      className={isNew ? "sweep-in" : ""}
      style={{
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid hsl(120 20% 8%)",
        background: isNew ? "hsl(120 100% 50% / 0.03)" : "transparent",
        transition: "background 0.5s",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 70% 55%)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>
          {t.market}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 30%)" }}>
          ${t.betSize} · edge {t.edgeDetected}% · {t.createdAt ? formatDistanceToNow(new Date(t.createdAt), { addSuffix: true }) : "—"}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {/* Direction */}
        <span style={{
          fontFamily: "var(--font-pixel)", fontSize: 6, padding: "2px 5px",
          border: `1px solid ${t.direction === "YES" ? "hsl(120 100% 50% / 0.4)" : "hsl(0 90% 55% / 0.4)"}`,
          color: t.direction === "YES" ? "hsl(120 100% 60%)" : "hsl(0 90% 60%)",
          background: t.direction === "YES" ? "hsl(120 100% 50% / 0.07)" : "hsl(0 90% 55% / 0.07)",
        }}>
          {t.direction}
        </span>
        {/* Status */}
        <span style={{
          fontFamily: "var(--font-pixel)", fontSize: 6, padding: "2px 5px",
          color: isOpen ? "hsl(45 100% 55%)" : isWon ? "hsl(120 100% 60%)" : "hsl(0 90% 60%)",
          border: `1px solid ${isOpen ? "hsl(45 100% 55% / 0.3)" : isWon ? "hsl(120 100% 50% / 0.3)" : "hsl(0 90% 55% / 0.3)"}`,
        }}>
          {isOpen ? "LIVE" : isWon ? "WIN" : "LOSS"}
        </span>
        {/* PnL */}
        {!isOpen && (
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: pnl >= 0 ? "hsl(120 100% 60%)" : "hsl(0 90% 60%)", textShadow: pnl >= 0 ? "0 0 6px hsl(120 100% 50% / 0.5)" : "0 0 6px hsl(0 90% 55% / 0.5)" }}>
            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Custom chart tooltip ──────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "hsl(220 20% 4%)",
      border: "1px solid hsl(120 60% 20%)",
      padding: "8px 12px",
      boxShadow: "0 0 12px hsl(120 100% 50% / 0.15)",
    }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 30% 40%)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-pixel)", fontSize: 9, color: "hsl(120 100% 60%)" }}>
        ${payload[0]?.value?.toFixed(2)}
      </div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { toast } = useToast();
  const prevTradeCount = useRef(0);
  const [newTradeIds, setNewTradeIds] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery({ queryKey: ["/api/dashboard"], refetchInterval: 15000, staleTime: 10000 });
  const { data: alpacaData } = useQuery({
    queryKey: ["/api/alpaca/account"],
    queryFn: () => apiRequest("GET", "/api/alpaca/account").then((r) => r.json()),
    refetchInterval: 60000,
    staleTime: 30000,
    retry: false,
  });
  const { data: trades, isLoading: tradesLoading } = useQuery({
    queryKey: ["/api/trades"],
    queryFn: () => apiRequest("GET", "/api/trades?limit=10").then((r) => r.json()),
    refetchInterval: 20000,
    staleTime: 15000,
  });
  const { data: edges } = useQuery({
    queryKey: ["/api/edges"],
    queryFn: () => apiRequest("GET", "/api/edges?limit=5").then((r) => r.json()),
    refetchInterval: 20000,
    staleTime: 15000,
  });

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
      toast({ title: "BOT STARTED", description: "Edge detection running." });
    },
    onError: (e: any) => toast({ title: "ERROR", description: e.message, variant: "destructive" }),
  });

  const stopMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/bot/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "BOT STOPPED" });
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
  const balanceSpark = pnlHistory.map((p: any) => ({ ts: new Date(p.timestamp || Date.now()).getTime(), price: p.balance ?? 0 }));

  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Header HUD ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Bot sprite */}
          <LiveBotSprite size={5} label={false} />
          <div>
            <div style={{ fontFamily: "var(--font-pixel)", fontSize: 11, color: "hsl(120 100% 60%)", textShadow: "0 0 12px hsl(120 100% 50% / 0.5)", letterSpacing: "0.08em", marginBottom: 4 }}>
              ══ MISSION CONTROL ══
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 30% 40%)" }}>
              LIVE BTC · ETH · SOL EDGE DETECTION &amp; AUTO EXECUTION
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Bot status badge */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 10px",
            border: `1px solid ${d.isRunning ? "hsl(120 100% 50% / 0.4)" : "hsl(120 25% 20%)"}`,
            background: d.isRunning ? "hsl(120 100% 50% / 0.07)" : "hsl(220 20% 5%)",
            boxShadow: d.isRunning ? "0 0 12px hsl(120 100% 50% / 0.15)" : "none",
          }}>
            {d.isRunning && <div className="pulse-dot" style={{ width: 5, height: 5, background: "hsl(120 100% 55%)", boxShadow: "0 0 6px hsl(120 100% 50%)" }} />}
            <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: d.isRunning ? "hsl(120 100% 60%)" : "hsl(120 25% 35%)", letterSpacing: "0.08em" }}>
              {d.isRunning ? "BOT: ACTIVE" : "BOT: STANDBY"}
            </span>
          </div>

          {/* Start / Stop */}
          {d.isRunning ? (
            <button
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              style={{
                background: "transparent",
                border: "2px solid hsl(0 90% 55%)",
                color: "hsl(0 90% 65%)",
                fontFamily: "var(--font-pixel)", fontSize: 8,
                letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "6px 12px", cursor: "pointer",
                boxShadow: "0 0 10px hsl(0 90% 55% / 0.2)",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <Square size={10} /> HALT
            </button>
          ) : (
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="bot-running"
              style={{
                background: "transparent",
                border: "2px solid hsl(120 100% 50%)",
                color: "hsl(120 100% 65%)",
                fontFamily: "var(--font-pixel)", fontSize: 8,
                letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "6px 12px", cursor: "pointer",
                boxShadow: "0 0 14px hsl(120 100% 50% / 0.3)",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <Play size={10} /> LAUNCH
            </button>
          )}
        </div>
      </div>

      {/* ── Asset strip ── */}
      <AssetStrip />

      {/* ── Bot health ── */}
      <BotHealthPanel d={d} alpaca={alpaca} />

      {/* ── Connection pills ── */}
      <ConnectionStatus compact refetchInterval={30000} />

      {/* ── Win rate health bar ── */}
      <div style={{
        background: "hsl(220 20% 5%)",
        border: "1px solid hsl(120 30% 12%)",
        padding: "12px 14px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(120 25% 35%)", letterSpacing: "0.1em" }}>WIN RATE</span>
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: 8, color: winRatePct >= 55 ? "hsl(120 100% 60%)" : winRatePct >= 40 ? "hsl(45 100% 55%)" : "hsl(0 90% 55%)" }}>
            {winRatePct}%
          </span>
        </div>
        <div className="health-bar">
          <div
            className="health-bar-fill"
            style={{
              width: `${Math.min(winRatePct, 100)}%`,
              background: `linear-gradient(90deg,
                ${winRatePct >= 55 ? "hsl(120 100% 35%), hsl(120 100% 55%)" :
                  winRatePct >= 40 ? "hsl(30 100% 40%), hsl(45 100% 55%)" :
                                     "hsl(0 80% 35%), hsl(0 90% 55%)"}
              )`,
            }}
          />
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 30%)", marginTop: 4 }}>
          {d.winRate?.wins || 0} WINS / {d.winRate?.total || 0} RESOLVED
        </div>
      </div>

      {/* ── Stat cards ── */}
      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ height: 100, background: "hsl(220 20% 5%)", border: "1px solid hsl(120 30% 10%)" }} />
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          <StatCard
            label="PORTFOLIO"
            value={`$${displayBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            sub={alpacaConnected ? `${alpacaIsLive ? "LIVE" : "PAPER"} · $${parseFloat(alpaca.account?.cash || "0").toFixed(0)} CASH` : `BASE $${(d.startingBalance || 0).toFixed(0)}`}
            icon={DollarSign} color="cyan" live={alpacaConnected} sparkData={balanceSpark}
          />
          <StatCard
            label="TOTAL RETURN"
            value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`}
            sub={`${d.totalReturn || 0}% ALL-TIME`}
            icon={TrendingUp} color={totalPnl >= 0 ? "green" : "red"}
          />
          <StatCard
            label="TODAY PNL"
            value={`${(d.todayPnl || 0) >= 0 ? "+" : ""}$${(d.todayPnl || 0).toFixed(2)}`}
            sub={`${d.todayCount || 0} BETS PLACED`}
            icon={Activity} color={(d.todayPnl || 0) >= 0 ? "green" : "red"} live
          />
          <StatCard
            label="WIN RATE"
            value={`${winRatePct}%`}
            sub={`${d.winRate?.wins || 0} / ${d.winRate?.total || 0}`}
            icon={Target} color="amber"
          />
        </div>
      )}

      {/* ── Chart + edges ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 8 }}>

          {/* PNL chart */}
          <div style={{ background: "hsl(220 20% 5%)", border: "1px solid hsl(120 30% 12%)", padding: "12px 14px" }}>
            <SectionHeader title="PERFORMANCE CHART" sub="Balance over time" badge={`${d.totalReturn || 0}% ROI`} />
            {isLoading ? (
              <div style={{ height: 180, background: "hsl(220 20% 4%)" }} />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={pnlHistory}>
                  <defs>
                    <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="hsl(120, 100%, 50%)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="hsl(120, 100%, 50%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 2" stroke="hsl(120 30% 10%)" />
                  <XAxis dataKey="label" tick={{ fill: "hsl(120 25% 30%)", fontSize: 8, fontFamily: "Share Tech Mono" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "hsl(120 25% 30%)", fontSize: 8, fontFamily: "Share Tech Mono" }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="balance" stroke="hsl(120, 100%, 50%)" strokeWidth={1.5} fill="url(#balGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Live edges */}
          <div style={{ background: "hsl(220 20% 5%)", border: "1px solid hsl(120 30% 12%)", padding: "12px 14px", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(45 100% 55%)", letterSpacing: "0.08em", textShadow: "0 0 6px hsl(45 100% 55% / 0.5)" }}>
                ⚡ LIVE EDGES
              </div>
              <div className="pulse-dot" style={{ width: 5, height: 5, background: "hsl(120 100% 55%)", boxShadow: "0 0 6px hsl(120 100% 50%)" }} />
            </div>
            {!edges?.length ? (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 30%)" }}>SCANNING FOR EDGES<span className="blink">_</span></div>
            ) : (
              <div>
                {edges.slice(0, 6).map((e: any) => (
                  <div key={e.id} className="sweep-in" style={{ borderBottom: "1px solid hsl(120 20% 8%)", paddingBottom: 6, marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 60% 55%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, paddingRight: 6 }}>
                        {e.market}
                      </div>
                      <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(45 100% 60%)", flexShrink: 0 }}>+{e.edgePct}%</span>
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(120 25% 30%)" }}>
                      {(e.polyOdds * 100).toFixed(0)}¢ → {(e.impliedOdds * 100).toFixed(0)}¢
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Live trade feed ── */}
      <div style={{ background: "hsl(220 20% 5%)", border: "1px solid hsl(120 30% 12%)" }}>
        <div style={{
          padding: "10px 14px",
          borderBottom: "1px solid hsl(120 20% 8%)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <SectionHeader title="LIVE TRADE FEED" />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {tradeList.length > 0 && <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 30%)" }}>{tradeList.length} ORDERS</span>}
            <div className="pulse-dot" style={{ width: 5, height: 5, background: "hsl(120 100% 55%)" }} />
          </div>
        </div>
        {tradesLoading ? (
          <div style={{ padding: "12px 14px" }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{ height: 40, background: "hsl(220 20% 4%)", marginBottom: 4 }} />
            ))}
          </div>
        ) : !tradeList.length ? (
          <div style={{ padding: "14px", fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 25% 30%)" }}>
            &gt; NO TRADES LOGGED. START BOT AND ADD ALPACA KEYS.
            <span className="blink">_</span>
          </div>
        ) : (
          <div>
            {tradeList.slice(0, 8).map((t: any) => (
              <TradeFeedRow key={t.id} t={t} isNew={newTradeIds.has(t.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
