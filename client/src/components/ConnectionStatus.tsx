/**
 * ConnectionStatus — live Alpaca + Polymarket connection health panel
 * Uses /api/status for a single authoritative health check
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Wifi, WifiOff, AlertTriangle, CheckCircle, XCircle,
  DollarSign, ShieldCheck, Activity, RefreshCw, ExternalLink
} from "lucide-react";

interface StatusResult {
  alpaca: {
    status: "connected" | "paper" | "disconnected";
    details: {
      portfolio: number;
      cash: number;
      buyingPower: number;
      equity: number;
      accountNumber: string;
      accountStatus: string;
      cryptoStatus: string;
    } | null;
  };
  polymarket: {
    status: "connected" | "disconnected" | "no_key";
    details: { funder: string } | null;
  };
  bot: { running: boolean; todayCount: number };
  timestamp: string;
}

function AlpacaStatusCard({ alpaca }: { alpaca: StatusResult["alpaca"] }) {
  const isConnected = alpaca.status !== "disconnected";
  const isPaper = alpaca.status === "paper";
  const d = alpaca.details;

  const statusColor = alpaca.status === "connected" ? "text-up" : alpaca.status === "paper" ? "text-edge" : "text-down";
  const borderColor = alpaca.status === "connected" ? "border-up/25 bg-up/5" : alpaca.status === "paper" ? "border-edge/25 bg-edge/5" : "border-border bg-secondary/30";

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${borderColor}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {isConnected ? (
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isPaper ? "bg-edge/15 border border-edge/25" : "bg-up/15 border border-up/25"}`}>
              <Wifi size={16} className={statusColor} />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-xl bg-secondary border border-border flex items-center justify-center">
              <WifiOff size={16} className="text-down" />
            </div>
          )}
          <div>
            <p className={`text-sm font-display font-700 ${statusColor}`}>
              Alpaca {alpaca.status === "connected" ? "Live Account" : alpaca.status === "paper" ? "Paper Account" : "Not Connected"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isConnected ? `Account: ${d?.accountNumber} · ${d?.accountStatus}` : "Enter API keys in Settings to connect"}
            </p>
          </div>
        </div>
        <Badge variant="outline" className={`text-xs font-700 ${
          alpaca.status === "connected" ? "text-up border-up/30 bg-up/8" :
          alpaca.status === "paper" ? "text-edge border-edge/30 bg-edge/8" :
          "text-down border-down/30"
        }`}>
          {alpaca.status === "connected" ? "● LIVE" : alpaca.status === "paper" ? "◎ PAPER" : "✕ OFFLINE"}
        </Badge>
      </div>

      {/* Account stats */}
      {isConnected && d && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-border/50">
          {[
            { label: "Portfolio", value: `$${d.portfolio.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, color: "text-foreground" },
            { label: "Cash", value: `$${d.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, color: d.cash >= 0 ? "text-up" : "text-down" },
            { label: "Buying Power", value: `$${d.buyingPower.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, color: isPaper ? "text-edge" : "text-teal" },
            { label: "Crypto", value: d.cryptoStatus === "ACTIVE" ? "Active" : d.cryptoStatus, color: d.cryptoStatus === "ACTIVE" ? "text-up" : "text-muted-foreground" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-secondary/40 rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className={`text-sm font-display font-700 mt-0.5 tabular-nums ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Not connected CTA */}
      {!isConnected && (
        <div className="flex items-center gap-2 pt-1">
          <AlertTriangle size={12} className="text-edge flex-shrink-0" />
          <p className="text-xs text-muted-foreground">Go to Settings → Alpaca API Connection and save your keys</p>
        </div>
      )}
    </div>
  );
}

function PolymarketStatusCard({ polymarket }: { polymarket: StatusResult["polymarket"] }) {
  const isConnected = polymarket.status === "connected";
  const noKey = polymarket.status === "no_key";
  const d = polymarket.details;

  const borderColor = isConnected ? "border-teal/25 bg-teal/5" : noKey ? "border-border bg-secondary/30" : "border-down/20 bg-down/5";

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${borderColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
            isConnected ? "bg-teal/15 border border-teal/25" : "bg-secondary border border-border"
          }`}>
            {isConnected ? <CheckCircle size={16} className="text-teal" /> :
             noKey ? <ShieldCheck size={16} className="text-muted-foreground" /> :
             <XCircle size={16} className="text-down" />}
          </div>
          <div>
            <p className={`text-sm font-display font-700 ${isConnected ? "text-teal" : noKey ? "text-muted-foreground" : "text-down"}`}>
              Polymarket CLOB {isConnected ? "Reachable" : noKey ? "Key Not Set" : "Unreachable"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isConnected && d ? `Funder: ${d.funder}` : noKey ? "Set POLY_PRIVATE_KEY in environment" : "Cannot reach clob.polymarket.com"}
            </p>
          </div>
        </div>
        <Badge variant="outline" className={`text-xs font-700 ${
          isConnected ? "text-teal border-teal/30 bg-teal/8" :
          noKey ? "text-muted-foreground border-border" :
          "text-down border-down/30"
        }`}>
          {isConnected ? "● ONLINE" : noKey ? "NO KEY" : "✕ OFFLINE"}
        </Badge>
      </div>

      {isConnected && (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-border/50">
          <span className="text-xs px-2.5 py-1 rounded-full bg-teal/10 border border-teal/20 text-teal font-medium flex items-center gap-1">
            <CheckCircle size={10} /> CLOB API reachable
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-secondary border border-border text-muted-foreground font-medium flex items-center gap-1">
            <Activity size={10} /> Copy engine polling 60s
          </span>
          <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer"
            className="text-xs px-2.5 py-1 rounded-full bg-secondary border border-border text-teal hover:text-teal/80 font-medium flex items-center gap-1 transition-colors">
            <ExternalLink size={10} /> Open Polymarket
          </a>
        </div>
      )}

      {noKey && (
        <div className="flex items-center gap-2 pt-1">
          <AlertTriangle size={12} className="text-edge flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            Copy trading requires <span className="text-foreground font-medium">POLY_PRIVATE_KEY</span> and <span className="text-foreground font-medium">POLY_FUNDER_ADDRESS</span> set in the server environment
          </p>
        </div>
      )}
    </div>
  );
}

interface Props {
  compact?: boolean;  // smaller version for dashboard/sidebar
  refetchInterval?: number;
}

export function ConnectionStatus({ compact = false, refetchInterval = 30000 }: Props) {
  const { data, isLoading, refetch, isFetching } = useQuery<StatusResult>({
    queryKey: ["/api/status"],
    queryFn: () => apiRequest("GET", "/api/status").then((r) => r.json()),
    refetchInterval,
    retry: false,
  });

  if (isLoading) {
    if (compact) return <div className="flex gap-2"><Skeleton className="h-6 w-24 rounded-full" /><Skeleton className="h-6 w-28 rounded-full" /></div>;
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  if (!data) {
    if (compact) return null;
    return null;
  }

  if (compact) {
    // Mini version — 2 colored pills
    const alpacaOk = data.alpaca.status !== "disconnected";
    const polyOk = data.polymarket.status === "connected";
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full border ${
          alpacaOk ? "text-up border-up/25 bg-up/8" : "text-down border-down/25 bg-down/8"
        }`}>
          {alpacaOk ? <Wifi size={9} /> : <WifiOff size={9} />}
          Alpaca {data.alpaca.status === "connected" ? "Live" : data.alpaca.status === "paper" ? "Paper" : "Offline"}
        </span>
        <span className={`flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full border ${
          polyOk ? "text-teal border-teal/25 bg-teal/8" : "text-muted-foreground border-border"
        }`}>
          {polyOk ? <CheckCircle size={9} /> : <XCircle size={9} />}
          Polymarket {polyOk ? "Online" : data.polymarket.status === "no_key" ? "No Key" : "Offline"}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-display font-700 text-foreground flex items-center gap-2">
          <Activity size={14} className="text-teal" />
          Connection Status
        </h3>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={11} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <AlpacaStatusCard alpaca={data.alpaca} />
      <PolymarketStatusCard polymarket={data.polymarket} />

      {/* Last checked */}
      {data.timestamp && (
        <p className="text-[10px] text-muted-foreground/60 text-right">
          Last checked: {new Date(data.timestamp).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
