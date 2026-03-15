/**
 * useLiveData — shared hook for real-time prices + bot status
 * Polls /api/prices every 5s and accumulates a rolling 60-point sparkline per asset.
 */
import { useState, useEffect, useRef } from "react";

// Use the same API base as queryClient so deployed calls go through the proxy
const API_BASE = ("__PORT_5000__" as string).startsWith("__") ? "" : "__PORT_5000__";

export type AssetKey = "BTC" | "ETH" | "SOL";

export interface PricePoint {
  ts: number;   // unix ms
  price: number;
}

export interface LiveAsset {
  price: number;
  change5m: number;   // % vs 5 min ago
  change1m: number;   // % vs 1 min ago
  history: PricePoint[]; // last 60 ticks
  trend: "up" | "down" | "flat";
}

export type LivePrices = Record<AssetKey, LiveAsset | null>;

const MAX_HISTORY = 60;

export function useLiveData(intervalMs = 5000) {
  const historyRef = useRef<Record<AssetKey, PricePoint[]>>({ BTC: [], ETH: [], SOL: [] });
  const [assets, setAssets] = useState<LivePrices>({ BTC: null, ETH: null, SOL: null });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const r = await fetch(`${API_BASE}/api/prices`);
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as Record<AssetKey, number | null>;
        const now = Date.now();

        const next: LivePrices = { BTC: null, ETH: null, SOL: null };

        (["BTC", "ETH", "SOL"] as AssetKey[]).forEach((key) => {
          const price = data[key];
          if (!price) return;

          const hist = historyRef.current[key];
          hist.push({ ts: now, price });
          if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);

          // Safe findLast polyfill (Array.findLast not available in all browsers)
          const findLW = (arr: PricePoint[], fn: (p: PricePoint) => boolean) => {
            for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) return arr[i];
            return undefined;
          };
          const ago5m = findLW(hist, (p) => p.ts <= now - 5 * 60 * 1000);
          const ago1m = findLW(hist, (p) => p.ts <= now - 60 * 1000);
          const prev = hist.length >= 2 ? hist[hist.length - 2] : null;

          const change5m = ago5m ? ((price - ago5m.price) / ago5m.price) * 100 : 0;
          const change1m = ago1m ? ((price - ago1m.price) / ago1m.price) * 100 : 0;
          const trend = prev
            ? price > prev.price ? "up" : price < prev.price ? "down" : "flat"
            : "flat";

          next[key] = { price, change5m, change1m, history: [...hist], trend };
        });

        if (!cancelled) {
          setAssets(next);
          setLastUpdated(now);
        }
      } catch {/* silent */}
    }

    tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);

  return { assets, lastUpdated };
}
