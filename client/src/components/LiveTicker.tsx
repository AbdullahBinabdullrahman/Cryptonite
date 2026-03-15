/**
 * LiveTicker — scrolling horizontal ticker bar with BTC/ETH/SOL live prices
 */
import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useLiveData, AssetKey } from "@/hooks/useLiveData";

const ASSET_COLORS: Record<AssetKey, string> = {
  BTC: "text-edge",
  ETH: "text-teal",
  SOL: "text-up",
};

function TickerItem({ assetKey, asset }: { assetKey: AssetKey; asset: NonNullable<ReturnType<typeof useLiveData>["assets"][AssetKey]> }) {
  const color = ASSET_COLORS[assetKey];
  const isUp = asset.change5m >= 0;
  const Icon = asset.trend === "up" ? TrendingUp : asset.trend === "down" ? TrendingDown : Minus;

  return (
    <span className="inline-flex items-center gap-2 px-4 text-xs">
      <span className={`font-display font-700 ${color}`}>{assetKey}</span>
      <span className="text-foreground font-semibold">
        ${asset.price >= 1000
          ? asset.price.toLocaleString(undefined, { maximumFractionDigits: 0 })
          : asset.price.toFixed(2)}
      </span>
      <span className={`flex items-center gap-0.5 font-medium ${isUp ? "text-up" : "text-down"}`}>
        <Icon size={10} />
        {isUp ? "+" : ""}{asset.change5m.toFixed(2)}%
      </span>
      <span className="text-border">·</span>
    </span>
  );
}

export function LiveTicker() {
  const { assets, lastUpdated } = useLiveData(5000);

  const hasAny = Object.values(assets).some(Boolean);

  if (!hasAny) {
    return (
      <div className="h-8 bg-card border-b border-border flex items-center px-4">
        <span className="text-xs text-muted-foreground animate-pulse">Loading live prices…</span>
      </div>
    );
  }

  // Duplicate content for seamless loop
  const content = (["BTC", "ETH", "SOL"] as AssetKey[]).map((k) =>
    assets[k] ? <TickerItem key={k} assetKey={k} asset={assets[k]!} /> : null
  );

  return (
    <div className="h-8 bg-card border-b border-border overflow-hidden relative flex items-center">
      {/* Live dot */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-3 border-r border-border h-full">
        <div className="w-1.5 h-1.5 rounded-full bg-up pulse-dot" />
        <span className="text-[10px] font-medium text-up uppercase tracking-wider">Live</span>
      </div>

      {/* Scrolling ticker */}
      <div className="flex-1 overflow-hidden">
        <div className="ticker-scroll flex whitespace-nowrap">
          <div className="flex">{content}{content}</div>
        </div>
      </div>

      {/* Last updated */}
      {lastUpdated && (
        <div className="flex-shrink-0 px-3 border-l border-border h-full flex items-center">
          <span className="text-[10px] text-muted-foreground/60">
            {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
      )}
    </div>
  );
}
