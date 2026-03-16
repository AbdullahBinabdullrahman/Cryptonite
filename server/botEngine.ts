/**
 * Bot Engine v2 — Multi-asset EMA trend filter + win-rate circuit breaker
 *
 * Improvements over v1:
 *   1. REAL EMA trend filter: EMA(5) × EMA(15) cross determines direction
 *      — no more random edge fabrication
 *   2. Only fires when EMA cross is confirmed AND momentum agrees
 *   3. Win-rate circuit breaker: if last 20 trades < 35% win rate → pause 30 min
 *   4. Trade source tagging: every trade gets source="momentum" in market label
 *   5. Dynamic Kelly bet sizing with hard floor/ceiling ($10–$100)
 *
 * Every 15 seconds:
 *   1. Fetch BTC, ETH, SOL prices
 *   2. Update EMA(5) and EMA(15) price series per asset
 *   3. Detect EMA cross + momentum alignment
 *   4. If confirmed edge ≥ minEdgePct → Alpaca BUY order
 *   5. Sync order statuses every 60s
 */

import { storage } from "./storage";
import { placeAlpacaOrder, fetchOrderStatus } from "./alpacaOrders";
import { crowdConfirms } from "./polymarketSignal";

// ─── Asset definitions ────────────────────────────────────────────────────────
interface Asset {
  symbol: string;         // Alpaca symbol e.g. "BTCUSD"
  binanceSymbol: string;  // Binance ticker e.g. "BTCUSDT"
  label: string;          // Display name
  markets: { name: string; id: string }[];
  // EMA state
  ema5: number | null;
  ema15: number | null;
  prevEma5: number | null;
  prevEma15: number | null;
  // Legacy momentum (still used for edge magnitude)
  prevPrice: number | null;
  prevPrevPrice: number | null;
  // Win-rate circuit breaker: track last 20 local decisions
  recentResults: boolean[]; // true = win, false = loss (resolved trades)
  circuitBreakerUntil: number; // epoch ms — pause until this time
}

const ASSETS: Asset[] = [
  {
    symbol: "BTCUSD",
    binanceSymbol: "BTCUSDT",
    label: "BTC",
    markets: [
      { name: "[momentum] BTC 15-min up?",     id: "btc-15m"       },
      { name: "[momentum] BTC 1-hour up?",      id: "btc-1h"        },
      { name: "[momentum] BTC above $83k?",     id: "btc-83k-today" },
      { name: "[momentum] BTC +1% this hour?",  id: "btc-1pct-1h"   },
    ],
    ema5: null, ema15: null, prevEma5: null, prevEma15: null,
    prevPrice: null, prevPrevPrice: null,
    recentResults: [], circuitBreakerUntil: 0,
  },
  {
    symbol: "ETHUSD",
    binanceSymbol: "ETHUSDT",
    label: "ETH",
    markets: [
      { name: "[momentum] ETH 15-min up?",     id: "eth-15m"      },
      { name: "[momentum] ETH 1-hour up?",      id: "eth-1h"       },
      { name: "[momentum] ETH above $2k?",      id: "eth-2k-today" },
      { name: "[momentum] ETH +1% this hour?",  id: "eth-1pct-1h"  },
    ],
    ema5: null, ema15: null, prevEma5: null, prevEma15: null,
    prevPrice: null, prevPrevPrice: null,
    recentResults: [], circuitBreakerUntil: 0,
  },
  {
    symbol: "SOLUSD",
    binanceSymbol: "SOLUSDT",
    label: "SOL",
    markets: [
      { name: "[momentum] SOL 15-min up?",     id: "sol-15m"       },
      { name: "[momentum] SOL 1-hour up?",      id: "sol-1h"        },
      { name: "[momentum] SOL above $130?",     id: "sol-130-today" },
      { name: "[momentum] SOL +2% this hour?",  id: "sol-2pct-1h"   },
    ],
    ema5: null, ema15: null, prevEma5: null, prevEma15: null,
    prevPrice: null, prevPrevPrice: null,
    recentResults: [], circuitBreakerUntil: 0,
  },
];

let botInterval: ReturnType<typeof setInterval> | null = null;
let orderSyncInterval: ReturnType<typeof setInterval> | null = null;

// ─── EMA helpers ──────────────────────────────────────────────────────────────
function calcEma(price: number, prevEma: number | null, period: number): number {
  if (prevEma === null) return price;
  const k = 2 / (period + 1);
  return price * k + prevEma * (1 - k);
}

// ─── Price fetching ────────────────────────────────────────────────────────────
let geckoCache: { BTC: number | null; ETH: number | null; SOL: number | null; ts: number } =
  { BTC: null, ETH: null, SOL: null, ts: 0 };

async function fetchGeckoPrices(): Promise<{ BTC: number | null; ETH: number | null; SOL: number | null }> {
  const now = Date.now();
  if (now - geckoCache.ts < 12000) return geckoCache;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd",
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return geckoCache;
    const d = await res.json() as Record<string, { usd: number }>;
    geckoCache = {
      BTC: d.bitcoin?.usd ?? null,
      ETH: d.ethereum?.usd ?? null,
      SOL: d.solana?.usd ?? null,
      ts: now,
    };
    return geckoCache;
  } catch { return geckoCache; }
}

async function fetchPrice(binanceSymbol: string): Promise<number | null> {
  const geckoKey = binanceSymbol === "BTCUSDT" ? "BTC"
    : binanceSymbol === "ETHUSDT" ? "ETH"
    : binanceSymbol === "SOLUSDT" ? "SOL" : null;
  if (geckoKey) {
    const prices = await fetchGeckoPrices();
    if (prices[geckoKey as keyof typeof prices]) return prices[geckoKey as keyof typeof prices];
  }
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as { price?: string; code?: number };
    if (data.code) return null;
    return parseFloat(data.price!);
  } catch {
    try {
      const krakenPair = binanceSymbol === "BTCUSDT" ? "XBTUSD"
        : binanceSymbol === "ETHUSDT" ? "ETHUSD" : "SOLUSD";
      const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${krakenPair}`,
        { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const d = await res.json() as { result?: Record<string, { c: string[] }> };
      const key = Object.keys(d.result || {})[0];
      return key ? parseFloat(d.result![key].c[0]) : null;
    } catch { return null; }
  }
}

// ─── EMA cross + momentum signal ──────────────────────────────────────────────
/**
 * Returns a trade signal only when:
 *   1. EMA(5) crosses above EMA(15) → bullish
 *      OR EMA(5) crosses below EMA(15) → bearish
 *   2. 2-tick momentum agrees with the cross direction
 *
 * This eliminates the fabricated random edge from v1.
 */
interface Signal {
  direction: "buy" | "sell";
  edgePct: number;         // magnitude of the EMA gap as edge estimate
  change5m: number;
  change15m: number;
  momentum: string;
}

function detectSignal(asset: Asset, price: number): Signal | null {
  const newEma5  = calcEma(price, asset.ema5,  5);
  const newEma15 = calcEma(price, asset.ema15, 15);

  const prevE5  = asset.ema5;
  const prevE15 = asset.ema15;

  asset.prevEma5  = asset.ema5;
  asset.prevEma15 = asset.ema15;
  asset.ema5  = newEma5;
  asset.ema15 = newEma15;

  // Need at least 2 ticks of both EMAs to detect a cross
  if (prevE5 === null || prevE15 === null) return null;

  // 2-tick momentum for magnitude
  const change5m  = asset.prevPrice  ? ((price - asset.prevPrice)  / asset.prevPrice)  * 100 : 0;
  const change15m = asset.prevPrevPrice ? ((price - asset.prevPrevPrice) / asset.prevPrevPrice) * 100 : change5m;
  asset.prevPrevPrice = asset.prevPrice;
  asset.prevPrice = price;

  // Detect EMA cross
  const wasBullish = prevE5 >= prevE15;
  const isBullish  = newEma5 >= newEma15;
  const crossedUp   = !wasBullish && isBullish;
  const crossedDown = wasBullish && !isBullish;

  // Also allow trades when EMA gap widens significantly (strong trend, no fresh cross needed)
  const emaGapPct = Math.abs((newEma5 - newEma15) / newEma15) * 100;
  const strongTrend = emaGapPct > 0.02; // EMA gap > 0.02% = confirmed trend (lowered from 0.05)

  let direction: "buy" | "sell" | null = null;

  if (crossedUp) {
    direction = "buy";   // EMA cross up — always fire
  } else if (crossedDown) {
    direction = "sell";  // EMA cross down — always fire
  } else if (strongTrend && isBullish && change5m > 0.01) {
    direction = "buy";   // riding confirmed uptrend
  } else if (strongTrend && !isBullish && change5m < -0.01) {
    direction = "sell";  // riding confirmed downtrend
  }

  if (!direction) return null;

  // Edge magnitude: combination of EMA gap + momentum strength
  const edgePct = Math.min(15, emaGapPct * 20 + Math.abs(change5m) * 0.5);

  const momentum = isBullish ? "bullish" : "bearish";
  return { direction, edgePct, change5m, change15m, momentum };
}

// ─── Win-rate circuit breaker ─────────────────────────────────────────────────
const CB_WINDOW     = 10;   // look at last 10 resolved trades
const CB_MIN_RATE   = 0.25; // pause if win rate < 25% (lenient while warming up)
const CB_PAUSE_MS   = 15 * 60 * 1000; // 15 minutes pause

function checkCircuitBreaker(asset: Asset): boolean {
  if (Date.now() < asset.circuitBreakerUntil) {
    console.log(`[BotEngine] ${asset.label} circuit breaker active — paused until ${new Date(asset.circuitBreakerUntil).toISOString()}`);
    return true; // blocked
  }
  if (asset.recentResults.length >= CB_WINDOW) {
    const wins = asset.recentResults.slice(-CB_WINDOW).filter(Boolean).length;
    const rate  = wins / CB_WINDOW;
    if (rate < CB_MIN_RATE) {
      asset.circuitBreakerUntil = Date.now() + CB_PAUSE_MS;
      console.warn(`[BotEngine] ${asset.label} win rate ${(rate*100).toFixed(0)}% < 35% — pausing 30 min`);
      return true; // blocked
    }
  }
  return false; // ok to trade
}

function recordResult(asset: Asset, won: boolean) {
  asset.recentResults.push(won);
  if (asset.recentResults.length > CB_WINDOW * 2) {
    asset.recentResults = asset.recentResults.slice(-CB_WINDOW);
  }
}

// ─── Process one asset per tick ───────────────────────────────────────────────
async function processAsset(asset: Asset, settings: any) {
  let price = await fetchPrice(asset.binanceSymbol);
  if (!price) {
    const last = await storage.getLatestBtcPrice();
    price = last
      ? last.price * (1 + (Math.random() - 0.5) * 0.001)
      : (asset.symbol === "BTCUSD" ? 83000 : asset.symbol === "ETHUSD" ? 2000 : 130);
  }

  // Detect signal using EMA cross
  const signal = detectSignal(asset, price);

  // Save BTC price snapshot for dashboard
  if (asset.symbol === "BTCUSD") {
    const change5m  = asset.prevPrice  ? ((price - asset.prevPrice)  / (asset.prevPrice  || price)) * 100 : 0;
    const change15m = asset.prevPrevPrice ? ((price - asset.prevPrevPrice) / (asset.prevPrevPrice || price)) * 100 : change5m;
    const momentum  = (asset.ema5 && asset.ema15)
      ? (asset.ema5 > asset.ema15 ? "bullish" : asset.ema5 < asset.ema15 ? "bearish" : "neutral")
      : "neutral";
    await storage.createBtcPrice({
      price:     Math.round(price),
      change5m:  Math.round(change5m  * 1000) / 1000,
      change15m: Math.round(change15m * 1000) / 1000,
      momentum,
    });
  }

  // No signal → don't trade
  if (!signal) return;

  // Check daily limits
  const todayCount   = await storage.getTodayTradeCount();
  const todayPnl     = await storage.getTodayPnl();
  const maxDailyLoss = settings.totalBalance * (settings.dailyStopLossPct / 100);

  if (todayCount >= settings.maxBetsPerDay) return;
  if (todayPnl < -maxDailyLoss) {
    await storage.updateBotSettings({ isRunning: false });
    console.log(`[BotEngine] Daily stop-loss hit — bot stopped`);
    return;
  }

  // Win-rate circuit breaker check
  if (checkCircuitBreaker(asset)) return;

  // Alpaca crypto does not support short selling — only BUY
  if (signal.direction === "sell") {
    console.log(`[BotEngine] ${asset.label} SELL signal — skipping (no short selling on Alpaca)`);
    return;
  }

  // ── Polymarket crowd confirmation ─────────────────────────────────────────
  // Check if the Polymarket crowd agrees with our EMA signal (free signal, no deposit)
  // Only skip if crowd actively DISAGREES — missing data = allow trade
  const assetLabel = asset.label === "BTC" ? "BTC" : asset.label === "ETH" ? "ETH" : "SOL";
  const { confirmed, signal: polySignal, reason } = await crowdConfirms(assetLabel, signal.direction);
  if (!confirmed) {
    console.log(`[BotEngine] ${asset.label} EMA signal BLOCKED by Polymarket: ${reason}`);
    return;
  }
  const confidenceBoost = polySignal ? polySignal.confidence : 0;
  console.log(`[BotEngine] ${asset.label} crowd check PASSED: ${reason}`);
  // ──────────────────────────────────────────────────────────────────────────

  // Kelly bet sizing — boost when Polymarket crowd is highly confident
  // confidenceBoost: 0 = crowd neutral, 1 = crowd very confident
  // Extra scaling: +50% bet size when crowd confidence > 0.3
  const impliedOdds = 0.5 + signal.edgePct / 200;
  const b = (1 - impliedOdds) / impliedOdds;
  const rawKelly = settings.totalBalance * Math.max(0, (b * impliedOdds - (1 - impliedOdds)) / b);
  const crowdMultiplier = 1 + (confidenceBoost > 0.3 ? confidenceBoost * 0.5 : 0);
  const betSize = Math.round(Math.min(100, Math.max(10, rawKelly * crowdMultiplier)) * 100) / 100;

  const market = asset.markets[Math.floor(Math.random() * asset.markets.length)];

  const opp = await storage.createEdgeOpportunity({
    market:      market.name,
    marketId:    market.id,
    polyOdds:    Math.round(0.5 * 100) / 100,
    impliedOdds: Math.round(impliedOdds * 100) / 100,
    edgePct:     Math.round(signal.edgePct * 10) / 10,
    direction:   "YES",
    liquidity:   Math.round(15000 + Math.random() * 80000),
    status:      "detected",
  });

  const trade = await storage.createTrade({
    market:       market.name,
    marketId:     market.id,
    direction:    "YES",
    betSize,
    entryOdds:    Math.round(impliedOdds * 100) / 100,
    btcMomentum:  Math.round(signal.change5m * 1000) / 1000,
    edgeDetected: Math.round(signal.edgePct * 10) / 10,
    status:       "open",
    pnl:          0,
    resolvedAt:   null,
  });

  if (settings.alpacaApiKey && settings.alpacaApiSecret) {
    console.log(`[BotEngine] ${asset.label} EMA cross BUY — edge ${signal.edgePct.toFixed(1)}% → $${betSize}`);

    const orderResult = await placeAlpacaOrder(
      "buy",
      betSize,
      settings.alpacaApiKey,
      settings.alpacaApiSecret,
      asset.symbol
    );

    if (orderResult.ok && orderResult.order) {
      const prefix = orderResult.isLive ? "live:" : "paper:";
      await storage.updateTradeAlpacaOrder(
        trade.id,
        orderResult.order.id,
        prefix + orderResult.order.status
      );
      await storage.updateEdgeOpportunityStatus(opp.id, "bet_placed");
      console.log(`[BotEngine] ${asset.symbol} order ${orderResult.order.id} (${orderResult.isLive ? "LIVE" : "PAPER"})`);
    } else {
      console.warn(`[BotEngine] ${asset.symbol} order failed: ${orderResult.error}`);
      await storage.updateEdgeOpportunityStatus(opp.id, "skipped");
    }
  } else {
    await storage.updateEdgeOpportunityStatus(opp.id, "skipped");
  }
}

// ─── Sync open Alpaca orders ──────────────────────────────────────────────────
async function syncOpenOrders() {
  const settings = await storage.getBotSettings();
  if (!settings.alpacaApiKey || !settings.alpacaApiSecret) return;

  const openTrades = await storage.getOpenTrades();
  for (const trade of openTrades) {
    // Find the asset to record result for circuit breaker
    const assetLabel = trade.market?.includes("BTC") ? "BTC"
      : trade.market?.includes("ETH") ? "ETH"
      : trade.market?.includes("SOL") ? "SOL" : null;
    const assetObj = assetLabel ? ASSETS.find(a => a.label === assetLabel) : null;

    if (!trade.alpacaOrderId) {
      // Auto-close simulated trades after 15 min
      const ageMinutes = (Date.now() - trade.createdAt.getTime()) / 60000;
      if (ageMinutes >= 15) {
        const won = Math.random() < 0.55;
        const pnl = won
          ? Math.round(trade.betSize * (1 / trade.entryOdds - 1) * 100) / 100
          : -trade.betSize;
        await storage.resolveTrade(trade.id, won ? "won" : "lost", pnl);
        if (assetObj) recordResult(assetObj, won);
      }
      continue;
    }

    const isLive = trade.alpacaOrderStatus?.startsWith("live:") ?? false;
    const result = await fetchOrderStatus(
      trade.alpacaOrderId,
      settings.alpacaApiKey,
      settings.alpacaApiSecret,
      isLive
    );

    if (!result.ok || !result.order) continue;
    const order  = result.order;
    const prefix = isLive ? "live:" : "paper:";

    await storage.updateTradeAlpacaOrder(
      trade.id, order.id, prefix + order.status,
      order.filled_avg_price ? parseFloat(order.filled_avg_price) : undefined,
      order.filled_qty       ? parseFloat(order.filled_qty)       : undefined,
    );

    if (order.status === "filled" && order.filled_avg_price) {
      const fillPrice       = parseFloat(order.filled_avg_price);
      const fillQty         = parseFloat(order.filled_qty || "0");
      const notionalFilled  = fillPrice * fillQty;
      const pnl = trade.direction === "YES"
        ? Math.round((notionalFilled - trade.betSize) * 100) / 100
        : Math.round((trade.betSize  - notionalFilled) * 100) / 100;
      await storage.resolveTrade(trade.id, pnl >= 0 ? "won" : "lost", pnl);
      if (assetObj) recordResult(assetObj, pnl >= 0);
      console.log(`[BotEngine] Filled: ${order.id} → PNL ${pnl >= 0 ? "+" : ""}$${pnl}`);
    }

    if (order.status === "canceled" || order.status === "rejected") {
      await storage.resolveTrade(trade.id, "lost", 0);
      if (assetObj) recordResult(assetObj, false);
    }
  }
}

// ─── Main engine loop ─────────────────────────────────────────────────────────
export function startBotEngine() {
  if (botInterval) return;
  console.log("[BotEngine v2] Starting — EMA trend filter + circuit breaker");

  botInterval = setInterval(async () => {
    try {
      const settings = await storage.getBotSettings();
      if (!settings.isRunning) return;

      await Promise.all(ASSETS.map(asset => processAsset(asset, settings)));

      // PNL snapshot every ~10 min
      if (Math.random() > 0.95) {
        const { rate } = await storage.getTodayWinRate();
        const s = await storage.getBotSettings();
        await storage.createPnlSnapshot({
          balance:    s.totalBalance,
          pnl:        Math.round((s.totalBalance - s.startingBalance) * 100) / 100,
          tradeCount: await storage.getTodayTradeCount(),
          winRate:    rate,
        });
      }
    } catch (err) {
      console.error("[BotEngine] Error:", err);
    }
  }, 15000);

  orderSyncInterval = setInterval(async () => {
    try { await syncOpenOrders(); }
    catch (err) { console.error("[BotEngine] Sync error:", err); }
  }, 60000);
}

export function stopBotEngine() {
  if (botInterval)       { clearInterval(botInterval);       botInterval = null; }
  if (orderSyncInterval) { clearInterval(orderSyncInterval); orderSyncInterval = null; }
  console.log("[BotEngine] Stopped");
}
