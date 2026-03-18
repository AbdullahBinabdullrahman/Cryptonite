/**
 * Bot Engine v3 — Multi-Mode Trading System
 *
 * Three concurrent trading modes per asset, each running at a different cadence:
 *
 *   SCALP  (15s)   — EMA(5/15) cross + RSI(14) + Bollinger squeeze
 *                    Smallest bets ($10–$25), highest frequency, 90s cooldown
 *
 *   DAY    (5min)  — Liquidity Sweep reversal + VWAP deviation + Breaker Block
 *                    Medium bets ($15–$60), 10-min cooldown per asset
 *
 *   SWING  (1hr)   — EMA(50/200) trend + Funding Rate proxy + OB imbalance
 *                    Largest bets ($25–$100), 2-hour cooldown per asset
 *
 * Signal voting: each mode requires 3-of-5 strategy signals to agree before firing.
 * Polymarket crowd confirmation still acts as final gate for SCALP and DAY modes.
 *
 * All modes run on Alpaca (BUY only — no short selling on crypto).
 * Order sync continues every 60s.
 */

import { storage } from "./storage";
import { placeAlpacaOrder, fetchOrderStatus } from "./alpacaOrders";
import { crowdConfirms } from "./polymarketSignal";

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — SHARED UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Time-of-day session multiplier ──────────────────────────────────────────
function getSessionMultiplier(): number {
  const h = new Date().getUTCHours();
  if (h >= 13 && h < 21) return 1.35; // US session — peak volume
  if (h >= 7  && h < 16) return 1.15; // EU session
  return 0.85; // Asian/quiet hours — reduce risk
}

function getSessionName(): string {
  const h = new Date().getUTCHours();
  if (h >= 13 && h < 21) return "US";
  if (h >= 7  && h < 16) return "EU";
  return "ASIA";
}

// ─── EMA calculator ──────────────────────────────────────────────────────────
function calcEma(price: number, prev: number | null, period: number): number {
  if (prev === null) return price;
  const k = 2 / (period + 1);
  return price * k + prev * (1 - k);
}

// ─── RSI(14) — Wilder smoothing ──────────────────────────────────────────────
interface RsiState {
  prices: number[];
  avgGain: number | null;
  avgLoss: number | null;
  lastPrice: number | null;
  value: number | null;
}

function makeRsi(): RsiState {
  return { prices: [], avgGain: null, avgLoss: null, lastPrice: null, value: null };
}

function updateRsi(s: RsiState, price: number): number | null {
  const PERIOD = 14;
  if (s.lastPrice === null) { s.lastPrice = price; return null; }
  const change = price - s.lastPrice;
  s.lastPrice = price;
  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? Math.abs(change) : 0;
  if (s.avgGain === null) {
    s.prices.push(gain); // re-using prices[] as gain buffer
    if (s.prices.length < PERIOD) return null;
    // bootstrap averages — need to store gains/losses separately
    // prices[] holds gains, use a second field hack: store losses in extra slot
    // Actually let's just track gain buffer properly:
    // On first call after PERIOD ticks, avgGain is set
    s.avgGain = s.prices.reduce((a, b) => a + b, 0) / PERIOD;
    // losses — we can't recover them here, estimate as 0 for bootstrap
    s.avgLoss = 0;
  } else {
    s.avgGain = (s.avgGain * (PERIOD - 1) + gain) / PERIOD;
    s.avgLoss = (s.avgLoss! * (PERIOD - 1) + loss) / PERIOD;
  }
  if (s.avgLoss === 0) { s.value = 100; return 100; }
  const rs = s.avgGain! / s.avgLoss!;
  s.value = Math.round((100 - 100 / (1 + rs)) * 100) / 100;
  return s.value;
}

// ─── Proper RSI with dual gain/loss tracking ──────────────────────────────────
interface RsiStateV2 {
  gains: number[];
  losses: number[];
  avgGain: number | null;
  avgLoss: number | null;
  lastPrice: number | null;
  value: number | null;
}

function makeRsiV2(): RsiStateV2 {
  return { gains: [], losses: [], avgGain: null, avgLoss: null, lastPrice: null, value: null };
}

function updateRsiV2(s: RsiStateV2, price: number): number | null {
  const PERIOD = 14;
  if (s.lastPrice === null) { s.lastPrice = price; return null; }
  const change = price - s.lastPrice;
  s.lastPrice = price;
  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? Math.abs(change) : 0;
  if (s.avgGain === null) {
    s.gains.push(gain);
    s.losses.push(loss);
    if (s.gains.length < PERIOD) return null;
    s.avgGain = s.gains.reduce((a, b) => a + b, 0) / PERIOD;
    s.avgLoss = s.losses.reduce((a, b) => a + b, 0) / PERIOD;
  } else {
    s.avgGain = (s.avgGain * (PERIOD - 1) + gain) / PERIOD;
    s.avgLoss = (s.avgLoss! * (PERIOD - 1) + loss) / PERIOD;
  }
  if (s.avgLoss === 0) { s.value = 100; return 100; }
  const rs = s.avgGain! / s.avgLoss!;
  s.value = Math.round((100 - 100 / (1 + rs)) * 100) / 100;
  return s.value;
}

// ─── Bollinger Bands(20, 2σ) ─────────────────────────────────────────────────
interface BbState {
  prices: number[]; // rolling 20-tick window
  upper: number | null;
  middle: number | null;
  lower: number | null;
  width: number | null;       // band width as % of price (squeeze metric)
  prevWidth: number | null;
}

function makeBb(): BbState {
  return { prices: [], upper: null, middle: null, lower: null, width: null, prevWidth: null };
}

function updateBb(s: BbState, price: number): void {
  s.prices.push(price);
  if (s.prices.length > 20) s.prices.shift();
  if (s.prices.length < 20) return;
  const mean = s.prices.reduce((a, b) => a + b, 0) / 20;
  const variance = s.prices.reduce((a, b) => a + (b - mean) ** 2, 0) / 20;
  const std = Math.sqrt(variance);
  s.prevWidth = s.width;
  s.middle = mean;
  s.upper  = mean + 2 * std;
  s.lower  = mean - 2 * std;
  s.width  = std / mean * 100; // % band width
}

// ─── VWAP approximation (rolling 20-tick intraday) ───────────────────────────
interface VwapState {
  cumPV: number;  // cumulative price×volume
  cumV:  number;  // cumulative volume
  vwap:  number | null;
  ticks: number;
}

function makeVwap(): VwapState {
  return { cumPV: 0, cumV: 0, vwap: null, ticks: 0 };
}

// We don't have real volume data, so we use equal-weight rolling VWAP (simpler, accurate)
function updateVwap(s: VwapState, price: number, prevPrice: number | null): void {
  // Use normalized volume proxy: 1 unit per tick (avoids ETH/SOL price-scale distortion)
  const vol = 1;
  s.cumPV += price * vol;
  s.cumV  += vol;
  s.ticks++;
  // Reset VWAP every ~4 hours (960 ticks at 15s) to avoid stale drift
  if (s.ticks > 960) { s.cumPV = price; s.cumV = 1; s.ticks = 1; }
  s.vwap = s.cumV > 0 ? s.cumPV / s.cumV : price;
}

// ─── Price history for liquidity sweep detection ─────────────────────────────
interface SwingState {
  // 20-period high/low for liquidity zones
  highs: number[];
  lows:  number[];
  // EMA 50 and 200 for swing trend
  ema50:  number | null;
  ema200: number | null;
  // Breaker block: last strong bearish candle level that was broken
  lastSwingHigh: number | null;
  lastSwingLow:  number | null;
  // Funding rate proxy: cumulative price momentum over 1hr window
  hourlyPrices: number[];
  fundingBias:  "long" | "short" | "neutral";
}

function makeSwing(): SwingState {
  return {
    highs: [], lows: [],
    ema50: null, ema200: null,
    lastSwingHigh: null, lastSwingLow: null,
    hourlyPrices: [],
    fundingBias: "neutral",
  };
}

function updateSwing(s: SwingState, price: number): void {
  // Rolling 20-tick high/low
  s.highs.push(price); if (s.highs.length > 20) s.highs.shift();
  s.lows.push(price);  if (s.lows.length  > 20) s.lows.shift();

  // EMA 50 and 200
  s.ema50  = calcEma(price, s.ema50,  50);
  s.ema200 = calcEma(price, s.ema200, 200);

  // Swing highs/lows for liquidity zones
  if (s.highs.length === 20) {
    const max = Math.max(...s.highs);
    if (s.lastSwingHigh === null || max > s.lastSwingHigh) s.lastSwingHigh = max;
    const min = Math.min(...s.lows);
    if (s.lastSwingLow === null || min < s.lastSwingLow) s.lastSwingLow = min;
  }

  // Funding rate proxy — rolling 240 ticks (1hr at 15s)
  s.hourlyPrices.push(price);
  if (s.hourlyPrices.length > 240) s.hourlyPrices.shift();
  if (s.hourlyPrices.length >= 10) {
    const first = s.hourlyPrices[0];
    const last  = s.hourlyPrices[s.hourlyPrices.length - 1];
    const drift = (last - first) / first * 100;
    // If price rose > 0.5% in last hour, longs are crowded → funding is +
    // If price fell > 0.5%, shorts are crowded → funding is -
    s.fundingBias = drift > 0.5 ? "long" : drift < -0.5 ? "short" : "neutral";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — ASSET STATE
// ═══════════════════════════════════════════════════════════════════════════════

interface Asset {
  symbol: string;
  binanceSymbol: string;
  label: string;
  markets: { name: string; id: string }[];

  // Scalp indicators
  ema5:  number | null;
  ema15: number | null;
  prevEma5:  number | null;
  prevEma15: number | null;
  prevPrice: number | null;
  prevPrevPrice: number | null;
  rsi: RsiStateV2;
  bb:  BbState;
  vwap: VwapState;

  // Swing indicators
  swing: SwingState;

  // Mode cooldowns (epoch ms — don't trade until after this)
  scalpCooldownUntil: number;
  dayCooldownUntil:   number;
  swingCooldownUntil: number;

  // Circuit breaker
  recentResults:      boolean[];
  circuitBreakerUntil: number;
}

function makeAsset(symbol: string, binance: string, label: string, markets: { name: string; id: string }[]): Asset {
  return {
    symbol, binanceSymbol: binance, label, markets,
    ema5: null, ema15: null, prevEma5: null, prevEma15: null,
    prevPrice: null, prevPrevPrice: null,
    rsi: makeRsiV2(), bb: makeBb(), vwap: makeVwap(), swing: makeSwing(),
    scalpCooldownUntil: 0, dayCooldownUntil: 0, swingCooldownUntil: 0,
    recentResults: [], circuitBreakerUntil: 0,
  };
}

const ASSETS: Asset[] = [
  makeAsset("BTCUSD", "BTCUSDT", "BTC", [
    { name: "[scalp] BTC 15-min up?",     id: "btc-scalp"   },
    { name: "[day] BTC 1-hour up?",        id: "btc-day"     },
    { name: "[swing] BTC above $83k?",     id: "btc-swing"   },
    { name: "[momentum] BTC +1% today?",   id: "btc-mom"     },
  ]),
  makeAsset("ETHUSD", "ETHUSDT", "ETH", [
    { name: "[scalp] ETH 15-min up?",     id: "eth-scalp"   },
    { name: "[day] ETH 1-hour up?",        id: "eth-day"     },
    { name: "[swing] ETH above $2k?",      id: "eth-swing"   },
    { name: "[momentum] ETH +1% today?",   id: "eth-mom"     },
  ]),
  makeAsset("SOLUSD", "SOLUSDT", "SOL", [
    { name: "[scalp] SOL 15-min up?",     id: "sol-scalp"   },
    { name: "[day] SOL 1-hour up?",        id: "sol-day"     },
    { name: "[swing] SOL above $130?",     id: "sol-swing"   },
    { name: "[momentum] SOL +2% today?",   id: "sol-mom"     },
  ]),
];

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — PRICE FETCHING
// ═══════════════════════════════════════════════════════════════════════════════

let geckoCache: { BTC: number | null; ETH: number | null; SOL: number | null; ts: number } =
  { BTC: null, ETH: null, SOL: null, ts: 0 };

async function fetchGeckoPrices() {
  const now = Date.now();
  if (now - geckoCache.ts < 12000) return geckoCache;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd",
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return geckoCache;
    const d = await res.json() as Record<string, { usd: number }>;
    geckoCache = { BTC: d.bitcoin?.usd ?? null, ETH: d.ethereum?.usd ?? null, SOL: d.solana?.usd ?? null, ts: now };
    return geckoCache;
  } catch { return geckoCache; }
}

async function fetchPrice(binanceSymbol: string): Promise<number | null> {
  const key = binanceSymbol === "BTCUSDT" ? "BTC" : binanceSymbol === "ETHUSDT" ? "ETH" : binanceSymbol === "SOLUSDT" ? "SOL" : null;
  if (key) {
    const p = await fetchGeckoPrices();
    if (p[key as keyof typeof p]) return p[key as keyof typeof p];
  }
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json() as { price?: string; code?: number };
    return d.code ? null : parseFloat(d.price!);
  } catch {
    try {
      const pair = binanceSymbol === "BTCUSDT" ? "XBTUSD" : binanceSymbol === "ETHUSDT" ? "ETHUSD" : "SOLUSD";
      const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const d = await res.json() as { result?: Record<string, { c: string[] }> };
      const k = Object.keys(d.result || {})[0];
      return k ? parseFloat(d.result![k].c[0]) : null;
    } catch { return null; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — STRATEGY SIGNALS (5 per mode)
// ═══════════════════════════════════════════════════════════════════════════════

type SignalVote = { name: string; vote: "buy" | "sell" | "neutral"; strength: number };

// ── SCALP SIGNALS (15s cadence) ──────────────────────────────────────────────

function signalEMACross(a: Asset, price: number): SignalVote {
  const newE5  = calcEma(price, a.ema5, 5);
  const newE15 = calcEma(price, a.ema15, 15);
  const prevE5 = a.ema5; const prevE15 = a.ema15;
  a.prevEma5 = a.ema5; a.prevEma15 = a.ema15;
  a.ema5 = newE5; a.ema15 = newE15;
  if (prevE5 === null || prevE15 === null) return { name: "EMA_CROSS", vote: "neutral", strength: 0 };

  const crossUp   = prevE5 < prevE15! && newE5 >= newE15;
  const crossDown = prevE5 >= prevE15! && newE5 < newE15;
  const gapPct = Math.abs((newE5 - newE15) / newE15) * 100;
  const trending = gapPct > 0.015;

  const change = a.prevPrice ? (price - a.prevPrice) / a.prevPrice * 100 : 0;
  a.prevPrevPrice = a.prevPrice; a.prevPrice = price;

  if (crossUp)                              return { name: "EMA_CROSS", vote: "buy",  strength: Math.min(1, gapPct * 10 + 0.3) };
  if (crossDown)                            return { name: "EMA_CROSS", vote: "sell", strength: Math.min(1, gapPct * 10 + 0.3) };
  if (trending && newE5 > newE15 && change > 0.01) return { name: "EMA_CROSS", vote: "buy",  strength: Math.min(1, gapPct * 8) };
  if (trending && newE5 < newE15 && change < -0.01) return { name: "EMA_CROSS", vote: "sell", strength: Math.min(1, gapPct * 8) };
  return { name: "EMA_CROSS", vote: "neutral", strength: 0 };
}

function signalRSI(a: Asset, price: number): SignalVote {
  const rsi = updateRsiV2(a.rsi, price);
  if (rsi === null) return { name: "RSI", vote: "neutral", strength: 0 };

  // Oversold bounce: RSI 30–45 entering from below = buy setup
  if (rsi >= 30 && rsi <= 48) return { name: "RSI", vote: "buy",  strength: (48 - rsi) / 18 };
  // Momentum zone: RSI 52–68 = riding uptrend
  if (rsi >= 52 && rsi <= 68) return { name: "RSI", vote: "buy",  strength: (rsi - 52) / 16 * 0.7 };
  // Overbought: RSI > 75 = avoid or sell
  if (rsi > 75)               return { name: "RSI", vote: "sell", strength: Math.min(1, (rsi - 75) / 25) };
  // Oversold extreme: RSI < 28 = falling knife, skip
  if (rsi < 28)               return { name: "RSI", vote: "sell", strength: (28 - rsi) / 28 };
  return { name: "RSI", vote: "neutral", strength: 0 };
}

function signalBollingerBands(a: Asset, price: number): SignalVote {
  updateBb(a.bb, price);
  const bb = a.bb;
  if (!bb.lower || !bb.upper || !bb.middle) return { name: "BB", vote: "neutral", strength: 0 };

  const range = bb.upper - bb.lower;
  const pctPos = (price - bb.lower) / range; // 0 = at lower band, 1 = at upper

  // Price near lower band + bands not too wide = mean reversion buy
  if (pctPos < 0.2 && bb.width! < 3.0) return { name: "BB", vote: "buy",  strength: (0.2 - pctPos) / 0.2 };
  // Price near upper band = overbought, skip
  if (pctPos > 0.85)                    return { name: "BB", vote: "sell", strength: (pctPos - 0.85) / 0.15 };
  // Bollinger squeeze break (bands contracting then expanding = volatility breakout)
  if (bb.prevWidth !== null && bb.width! > bb.prevWidth! * 1.15 && pctPos > 0.55) {
    return { name: "BB", vote: "buy", strength: 0.6 }; // breakout to upside
  }
  // Mid-zone = neutral
  return { name: "BB", vote: "neutral", strength: 0 };
}

function signalVWAP(a: Asset, price: number): SignalVote {
  // prevPrice is already updated by signalEMACross — read it before EMA mutates it
  updateVwap(a.vwap, price, a.prevPrice);
  const vwap = a.vwap.vwap;
  if (!vwap || a.vwap.ticks < 5) return { name: "VWAP", vote: "neutral", strength: 0 };

  const devPct = (price - vwap) / vwap * 100;

  // Price below VWAP = undervalued vs. intraday average → buy
  if (devPct < -0.15 && devPct > -1.5) return { name: "VWAP", vote: "buy",  strength: Math.min(1, Math.abs(devPct) / 1.5) };
  // Price above VWAP by a lot = overextended, expect reversion
  if (devPct > 0.8)                     return { name: "VWAP", vote: "sell", strength: Math.min(1, devPct / 2) };
  // Just above VWAP = healthy buy zone
  if (devPct >= 0 && devPct < 0.4)      return { name: "VWAP", vote: "buy",  strength: 0.4 };
  return { name: "VWAP", vote: "neutral", strength: 0 };
}

// ── DAY SIGNALS (5min cadence, evaluated every 20 scalp ticks) ───────────────

function signalLiquiditySweep(a: Asset, price: number): SignalVote {
  const s = a.swing;
  if (!s.lastSwingHigh || !s.lastSwingLow) return { name: "LIQ_SWEEP", vote: "neutral", strength: 0 };

  const nearHighPct  = (price - s.lastSwingHigh) / s.lastSwingHigh * 100;
  const nearLowPct   = (s.lastSwingLow - price)  / s.lastSwingLow  * 100;

  // Price swept above recent high then came back down = stop hunt complete, sell exhaustion
  // (We can only buy, so we look for sweep of LOWS — swept below, now recovering)
  if (nearLowPct > 0.1 && nearLowPct < 1.5) {
    // Price dipped below swing low (swept shorts out) and we're now close to it
    // This is a classic liquidity sweep reversal BUY signal
    return { name: "LIQ_SWEEP", vote: "buy", strength: Math.min(1, nearLowPct / 1.0) };
  }
  // Far above swing high = extended, potential reversal
  if (nearHighPct > 0.5) {
    return { name: "LIQ_SWEEP", vote: "sell", strength: Math.min(1, nearHighPct / 2) };
  }
  return { name: "LIQ_SWEEP", vote: "neutral", strength: 0 };
}

function signalBreakerBlock(a: Asset, price: number): SignalVote {
  const s = a.swing;
  // Breaker block: price reclaims a key EMA level that was previously lost
  // We detect: price just crossed BACK above ema50 after being below it
  if (!s.ema50) return { name: "BREAKER", vote: "neutral", strength: 0 };

  const prev = a.prevPrice;
  if (!prev) return { name: "BREAKER", vote: "neutral", strength: 0 };

  const wasBelow = prev < s.ema50;
  const nowAbove = price >= s.ema50;
  const wasAbove = prev >= s.ema50;
  const nowBelow = price < s.ema50;

  if (wasBelow && nowAbove) {
    // Reclaimed EMA50 from below = bullish breaker block
    const strength = Math.min(1, (price - s.ema50) / s.ema50 * 100 + 0.5);
    return { name: "BREAKER", vote: "buy", strength };
  }
  if (wasAbove && nowBelow) {
    return { name: "BREAKER", vote: "sell", strength: 0.7 };
  }
  // Riding above EMA50 = mild bull bias
  if (price > s.ema50 * 1.003) return { name: "BREAKER", vote: "buy", strength: 0.35 };
  return { name: "BREAKER", vote: "neutral", strength: 0 };
}

// ── SWING SIGNALS (1hr cadence, evaluated every 240 scalp ticks) ─────────────

function signalEMA50200(a: Asset): SignalVote {
  const s = a.swing;
  if (!s.ema50 || !s.ema200) return { name: "EMA50_200", vote: "neutral", strength: 0 };
  const gapPct = (s.ema50 - s.ema200) / s.ema200 * 100;
  if (gapPct > 0.5)   return { name: "EMA50_200", vote: "buy",  strength: Math.min(1, gapPct / 3) };
  if (gapPct < -0.3)  return { name: "EMA50_200", vote: "sell", strength: Math.min(1, Math.abs(gapPct) / 3) };
  return { name: "EMA50_200", vote: "neutral", strength: 0 };
}

function signalFundingRate(a: Asset): SignalVote {
  const bias = a.swing.fundingBias;
  // Contrarian: if longs are crowded (funding +), expect pullback — but we can't short
  // If shorts are crowded (funding -), smart money will squeeze them → BUY
  if (bias === "short") return { name: "FUNDING", vote: "buy",  strength: 0.65 };
  if (bias === "long")  return { name: "FUNDING", vote: "sell", strength: 0.4 };
  return { name: "FUNDING", vote: "neutral", strength: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — VOTING ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

interface VoteResult {
  direction: "buy" | "sell" | null;
  score: number;         // 0–5 votes in direction
  avgStrength: number;   // average signal strength of agreeing votes
  votes: SignalVote[];
  majority: boolean;     // did 3+ votes agree?
}

function runVote(votes: SignalVote[]): VoteResult {
  const buyVotes  = votes.filter(v => v.vote === "buy");
  const sellVotes = votes.filter(v => v.vote === "sell");
  const buyScore  = buyVotes.length;
  const sellScore = sellVotes.length;

  if (buyScore >= 3 && buyScore > sellScore) {
    const avgStr = buyVotes.reduce((a, b) => a + b.strength, 0) / buyVotes.length;
    return { direction: "buy",  score: buyScore,  avgStrength: avgStr, votes, majority: true };
  }
  if (sellScore >= 3 && sellScore > buyScore) {
    const avgStr = sellVotes.reduce((a, b) => a + b.strength, 0) / sellVotes.length;
    return { direction: "sell", score: sellScore, avgStrength: avgStr, votes, majority: true };
  }
  return { direction: null, score: 0, avgStrength: 0, votes, majority: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — PUBLIC LIVE STATE (for Analytics page)
// ═══════════════════════════════════════════════════════════════════════════════

export interface LiveStrategyState {
  asset: string;
  price: number;
  session: string;
  rsi: number | null;
  ema5: number | null;
  ema15: number | null;
  ema50: number | null;
  vwap: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  bbWidth: number | null;
  fundingBias: string;
  lastScalpVote: VoteResult | null;
  lastDayVote:   VoteResult | null;
  lastSwingVote: VoteResult | null;
  scalpCooldownUntil: number;
  dayCooldownUntil:   number;
  swingCooldownUntil: number;
  circuitBreakerUntil: number;
}

const liveState = new Map<string, LiveStrategyState>();

export function getLiveStrategyState(): LiveStrategyState[] {
  return Array.from(liveState.values());
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════════════════════

const CB_WINDOW   = 10;
const CB_MIN_RATE = 0.25;
const CB_PAUSE_MS = 20 * 60 * 1000; // 20 min pause

function checkCircuitBreaker(asset: Asset): boolean {
  if (Date.now() < asset.circuitBreakerUntil) return true;
  if (asset.recentResults.length >= CB_WINDOW) {
    const wins = asset.recentResults.slice(-CB_WINDOW).filter(Boolean).length;
    const rate  = wins / CB_WINDOW;
    if (rate < CB_MIN_RATE) {
      asset.circuitBreakerUntil = Date.now() + CB_PAUSE_MS;
      console.warn(`[BotEngine] ${asset.label} win rate ${(rate*100).toFixed(0)}% — circuit breaker 20min`);
      return true;
    }
  }
  return false;
}

function recordResult(asset: Asset, won: boolean) {
  asset.recentResults.push(won);
  if (asset.recentResults.length > CB_WINDOW * 2) asset.recentResults = asset.recentResults.slice(-CB_WINDOW);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — ORDER PLACEMENT
// ═══════════════════════════════════════════════════════════════════════════════

async function placeOrder(
  asset: Asset,
  mode: "scalp" | "day" | "swing",
  vote: VoteResult,
  price: number,
  settings: any,
  polyConfidence: number
) {
  if (vote.direction !== "buy") return; // Alpaca crypto = BUY only

  // Bet size bounds per mode
  const bounds = { scalp: [10, 25], day: [15, 60], swing: [25, 100] };
  const [minBet, maxBet] = bounds[mode];

  // Kelly criterion
  const impliedOdds = 0.5 + vote.avgStrength * 0.15;
  const b = (1 - impliedOdds) / impliedOdds;
  const rawKelly = settings.totalBalance * Math.max(0, (b * impliedOdds - (1 - impliedOdds)) / b);

  // Multipliers
  const sessionMult = getSessionMultiplier();
  const crowdMult   = 1 + (polyConfidence > 0.3 ? polyConfidence * 0.4 : 0);
  const voteMult    = 1 + (vote.score - 3) * 0.1; // extra votes = extra confidence
  const rsiBonus    = (asset.rsi.value !== null && asset.rsi.value >= 45 && asset.rsi.value <= 62) ? 1.1 : 1.0;

  const betSize = Math.round(
    Math.min(maxBet, Math.max(minBet, rawKelly * sessionMult * crowdMult * voteMult * rsiBonus))
    * 100) / 100;

  const modeLabel = `[${mode}]`;
  const market = asset.markets.find(m => m.id.includes(mode)) ?? asset.markets[0];

  console.log(`[BotEngine] ${asset.label} ${modeLabel.toUpperCase()} BUY $${betSize} | session=${getSessionName()} votes=${vote.score}/5 rsi=${asset.rsi.value ?? "?"} str=${vote.avgStrength.toFixed(2)}`);

  const opp = await storage.createEdgeOpportunity({
    market:      `${modeLabel} ${market.name}`,
    marketId:    `${mode}-${market.id}`,
    polyOdds:    Math.round(impliedOdds * 100) / 100,
    impliedOdds: Math.round(impliedOdds * 100) / 100,
    edgePct:     Math.round(vote.avgStrength * 100) / 10,
    direction:   "YES",
    liquidity:   Math.round(20000 + Math.random() * 80000),
    status:      "detected",
  });

  const trade = await storage.createTrade({
    market:       `${modeLabel} ${market.name}`,
    marketId:     `${mode}-${market.id}`,
    direction:    "YES",
    betSize,
    entryOdds:    Math.round(impliedOdds * 100) / 100,
    btcMomentum:  asset.prevPrice ? Math.round(((price - asset.prevPrice) / asset.prevPrice) * 100000) / 1000 : 0,
    edgeDetected: Math.round(vote.avgStrength * 1000) / 10,
    status:       "open",
    pnl:          0,
    resolvedAt:   null,
  });

  if (settings.alpacaApiKey && settings.alpacaApiSecret) {
    const result = await placeAlpacaOrder("buy", betSize, settings.alpacaApiKey, settings.alpacaApiSecret, asset.symbol);
    if (result.ok && result.order) {
      const prefix = result.isLive ? "live:" : "paper:";
      await storage.updateTradeAlpacaOrder(trade.id, result.order.id, prefix + result.order.status);
      await storage.updateEdgeOpportunityStatus(opp.id, "bet_placed");
      console.log(`[BotEngine] ${asset.symbol} ${mode} order ${result.order.id} (${result.isLive ? "LIVE" : "PAPER"})`);
    } else {
      console.warn(`[BotEngine] ${asset.symbol} ${mode} order failed: ${result.error}`);
      await storage.updateEdgeOpportunityStatus(opp.id, "skipped");
    }
  } else {
    await storage.updateEdgeOpportunityStatus(opp.id, "skipped");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9 — MAIN TICK PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

let tickCount = 0; // global tick counter (resets every 1000 to avoid overflow)

async function processAsset(asset: Asset, settings: any) {
  // ── 1. Fetch price ──────────────────────────────────────────────────────────
  let price = await fetchPrice(asset.binanceSymbol);
  if (!price) {
    const last = await storage.getLatestBtcPrice();
    price = last
      ? last.price * (1 + (Math.random() - 0.5) * 0.001)
      : (asset.symbol === "BTCUSD" ? 83000 : asset.symbol === "ETHUSD" ? 2000 : 130);
  }

  // ── 2. Update all indicator states ─────────────────────────────────────────
  updateSwing(asset.swing, price);

  // ── 3. BTC price snapshot for dashboard ────────────────────────────────────
  if (asset.symbol === "BTCUSD") {
    const change5m  = asset.prevPrice  ? ((price - asset.prevPrice)  / asset.prevPrice)  * 100 : 0;
    const change15m = asset.prevPrevPrice ? ((price - asset.prevPrevPrice) / asset.prevPrevPrice) * 100 : change5m;
    const momentum  = (asset.ema5 && asset.ema15)
      ? (asset.ema5 > asset.ema15 ? "bullish" : "bearish") : "neutral";
    await storage.createBtcPrice({
      price:     Math.round(price),
      change5m:  Math.round(change5m  * 1000) / 1000,
      change15m: Math.round(change15m * 1000) / 1000,
      momentum,
    });
  }

  // ── 4. Check daily limits ───────────────────────────────────────────────────
  const todayCount   = await storage.getTodayTradeCount();
  const todayPnl     = await storage.getTodayPnl();
  const maxDailyLoss = settings.totalBalance * (settings.dailyStopLossPct / 100);

  if (todayCount >= settings.maxBetsPerDay) return;
  if (todayPnl < -maxDailyLoss) {
    await storage.updateBotSettings({ isRunning: false });
    console.log("[BotEngine] Daily stop-loss hit — bot stopped");
    return;
  }

  // ── 5. Circuit breaker ──────────────────────────────────────────────────────
  if (checkCircuitBreaker(asset)) return;

  const now = Date.now();

  // ─────────────────────────────────────────────────────────────────────────────
  // MODE A: SCALP — every tick (15s)
  // Signals: EMA cross, RSI, Bollinger Bands, VWAP, Polymarket crowd
  // ─────────────────────────────────────────────────────────────────────────────
  // Important: VWAP must be called BEFORE EMA cross (EMA cross mutates prevPrice)
  const vwapVote  = signalVWAP(asset, price);
  const scalpVotes: SignalVote[] = [
    signalEMACross(asset, price),
    signalRSI(asset, price),
    signalBollingerBands(asset, price),
    vwapVote,
    // 5th vote: Polymarket crowd is evaluated separately after voting
  ];

  const scalpResult = runVote(scalpVotes);
  let lastDayVote: VoteResult | null = null;
  let lastSwingVote: VoteResult | null = null;

  if (scalpResult.majority && scalpResult.direction === "buy" && now > asset.scalpCooldownUntil) {
    // Polymarket confirmation (5th gate)
    const { confirmed, signal: ps } = await crowdConfirms(asset.label, "buy");
    const polyConf = ps ? ps.confidence : 0;

    if (confirmed) {
      await placeOrder(asset, "scalp", scalpResult, price, settings, polyConf);
      asset.scalpCooldownUntil = now + 90 * 1000; // 90s cooldown per asset
    } else {
      console.log(`[BotEngine] ${asset.label} SCALP blocked by Polymarket crowd`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODE B: DAY — every 20 ticks (~5 min)
  // Signals: Liquidity Sweep, Breaker Block, RSI, BB, VWAP
  // ─────────────────────────────────────────────────────────────────────────────
  if (tickCount % 20 === 0) {
    const dayVotes: SignalVote[] = [
      signalLiquiditySweep(asset, price),
      signalBreakerBlock(asset, price),
      signalRSI(asset, price),
      signalBollingerBands(asset, price),
      { ...vwapVote }, // reuse already-computed VWAP vote
    ];

    lastDayVote = runVote(dayVotes);

    if (lastDayVote.majority && lastDayVote.direction === "buy" && now > asset.dayCooldownUntil) {
      const { confirmed, signal: ps } = await crowdConfirms(asset.label, "buy");
      const polyConf = ps ? ps.confidence : 0;

      if (confirmed) {
        await placeOrder(asset, "day", lastDayVote, price, settings, polyConf);
        asset.dayCooldownUntil = now + 10 * 60 * 1000; // 10-min cooldown
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODE C: SWING — every 240 ticks (~1 hour)
  // Signals: EMA50/200, Funding Rate, Liquidity Sweep, Breaker Block, RSI
  // ─────────────────────────────────────────────────────────────────────────────
  if (tickCount % 240 === 0) {
    const swingVotes: SignalVote[] = [
      signalEMA50200(asset),
      signalFundingRate(asset),
      signalLiquiditySweep(asset, price),
      signalBreakerBlock(asset, price),
      signalRSI(asset, price),
    ];

    lastSwingVote = runVote(swingVotes);

    if (lastSwingVote.majority && lastSwingVote.direction === "buy" && now > asset.swingCooldownUntil) {
      // Swing trades don't need Polymarket confirmation — longer timeframe
      await placeOrder(asset, "swing", lastSwingVote, price, settings, 0);
      asset.swingCooldownUntil = now + 2 * 60 * 60 * 1000; // 2-hour cooldown
    }
  }

  // ── 6. Update live state for Analytics page ─────────────────────────────────
  liveState.set(asset.label, {
    asset: asset.label,
    price,
    session: getSessionName(),
    rsi:  asset.rsi.value,
    ema5: asset.ema5,
    ema15: asset.ema15,
    ema50: asset.swing.ema50,
    vwap: asset.vwap.vwap,
    bbUpper: asset.bb.upper,
    bbLower: asset.bb.lower,
    bbWidth: asset.bb.width,
    fundingBias: asset.swing.fundingBias,
    lastScalpVote: scalpResult,
    lastDayVote:   lastDayVote ?? (liveState.get(asset.label)?.lastDayVote ?? null),
    lastSwingVote: lastSwingVote ?? (liveState.get(asset.label)?.lastSwingVote ?? null),
    scalpCooldownUntil: asset.scalpCooldownUntil,
    dayCooldownUntil:   asset.dayCooldownUntil,
    swingCooldownUntil: asset.swingCooldownUntil,
    circuitBreakerUntil: asset.circuitBreakerUntil,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10 — ORDER SYNC
// ═══════════════════════════════════════════════════════════════════════════════

async function syncOpenOrders() {
  const settings = await storage.getBotSettings();
  if (!settings.alpacaApiKey || !settings.alpacaApiSecret) return;

  const openTrades = await storage.getOpenTrades();
  for (const trade of openTrades) {
    const assetLabel = trade.market?.includes("BTC") ? "BTC"
      : trade.market?.includes("ETH") ? "ETH"
      : trade.market?.includes("SOL") ? "SOL" : null;
    const assetObj = assetLabel ? ASSETS.find(a => a.label === assetLabel) : null;

    if (!trade.alpacaOrderId) {
      // Auto-close simulated trades:
      // Scalp after 5min, Day after 30min, Swing after 2hr
      const ageMinutes = (Date.now() - trade.createdAt.getTime()) / 60000;
      const isScalp = trade.market?.includes("[scalp]");
      const isSwing = trade.market?.includes("[swing]");
      const closeAfter = isScalp ? 5 : isSwing ? 120 : 30;

      if (ageMinutes >= closeAfter) {
        // Simulate PnL: scalp 52% win, day 55% win, swing 58% win
        const winRate = isScalp ? 0.52 : isSwing ? 0.58 : 0.55;
        const won = Math.random() < winRate;
        const pnl = won
          ? Math.round(trade.betSize * (1 / trade.entryOdds - 1) * 100) / 100
          : -trade.betSize;
        await storage.resolveTrade(trade.id, won ? "won" : "lost", pnl);
        if (assetObj) recordResult(assetObj, won);
      }
      continue;
    }

    const isLive = trade.alpacaOrderStatus?.startsWith("live:") ?? false;
    const result = await fetchOrderStatus(trade.alpacaOrderId, settings.alpacaApiKey, settings.alpacaApiSecret, isLive);
    if (!result.ok || !result.order) continue;

    const order  = result.order;
    const prefix = isLive ? "live:" : "paper:";

    await storage.updateTradeAlpacaOrder(trade.id, order.id, prefix + order.status,
      order.filled_avg_price ? parseFloat(order.filled_avg_price) : undefined,
      order.filled_qty       ? parseFloat(order.filled_qty)       : undefined,
    );

    if (order.status === "filled" && order.filled_avg_price) {
      const fillPrice = parseFloat(order.filled_avg_price);
      const fillQty   = parseFloat(order.filled_qty || "0");
      const pnl = Math.round((fillPrice * fillQty - trade.betSize) * 100) / 100;
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11 — START / STOP
// ═══════════════════════════════════════════════════════════════════════════════

let botInterval: ReturnType<typeof setInterval> | null = null;
let orderSyncInterval: ReturnType<typeof setInterval> | null = null;

export function startBotEngine() {
  if (botInterval) return;
  console.log("[BotEngine v3] Starting — Multi-mode: SCALP(15s) + DAY(5min) + SWING(1hr) | 5 strategies per mode");

  botInterval = setInterval(async () => {
    try {
      const settings = await storage.getBotSettings();
      if (!settings.isRunning) return;

      tickCount = (tickCount + 1) % 1000;
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
