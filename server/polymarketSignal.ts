/**
 * Polymarket Signal Feed — FREE, no deposit required
 *
 * Reads live Polymarket 5-min Up/Down markets as a crowd-probability signal.
 * Used to CONFIRM or REJECT Alpaca trade signals from botEngine.
 *
 * Logic:
 *   - Fetch all active 5-min BTC/ETH/SOL Up/Down markets from Gamma API
 *   - For each asset, get the nearest-expiry market's YES price
 *   - YES price = crowd probability of going UP (e.g. 0.67 = 67% chance up)
 *   - Also fetch order book imbalance from CLOB API (free, public)
 *
 * Signal rules:
 *   BUY  confirmed if: yesPrice > MIN_CROWD_PROB  (crowd says likely up)
 *   SELL confirmed if: yesPrice < (1 - MIN_CROWD_PROB)  (crowd says likely down)
 *   SKIP if: crowd is neutral (yesPrice between 0.38–0.62) — no edge
 */

const GAMMA_API       = "https://gamma-api.polymarket.com";
const CLOB_API        = "https://clob.polymarket.com";
const MIN_CROWD_PROB  = 0.58;  // need 58%+ crowd consensus to confirm trade
const CACHE_TTL_MS    = 8000;  // refresh every 8s (one bot tick)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PolySignal {
  asset: string;           // "BTC" | "ETH" | "SOL"
  yesPrice: number;        // 0–1, crowd probability of going UP
  obImbalance: number;     // -1 to +1, order book buy/sell pressure
  crowdDirection: "up" | "down" | "neutral";
  confidence: number;      // 0–1, how strong the signal is
  marketQuestion: string;  // e.g. "Bitcoin Up or Down - 2:30PM-2:35PM ET"
  timeRemaining: number;   // seconds until market resolves
}

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  signal: PolySignal;
  ts: number;
}
const signalCache = new Map<string, CacheEntry>();

// ─── Market fetch ─────────────────────────────────────────────────────────────

interface RawMarket {
  question: string;
  conditionId: string;
  clobTokenIds: string | string[];
  endDate: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
}

let marketListCache: { data: RawMarket[]; ts: number } = { data: [], ts: 0 };

async function fetchMarketList(): Promise<RawMarket[]> {
  if (Date.now() - marketListCache.ts < 60000 && marketListCache.data.length > 0) {
    return marketListCache.data;
  }
  try {
    const res = await fetch(
      `${GAMMA_API}/markets?active=true&closed=false&limit=500&order=startDate&ascending=false`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return marketListCache.data;
    const raw = await res.json() as RawMarket[];
    if (!Array.isArray(raw)) return marketListCache.data;
    marketListCache = { data: raw, ts: Date.now() };
    return raw;
  } catch {
    return marketListCache.data;
  }
}

// ─── Order book imbalance ──────────────────────────────────────────────────────

const obCache = new Map<string, { imbalance: number; ts: number }>();

async function fetchOBImbalance(tokenId: string): Promise<number> {
  const cached = obCache.get(tokenId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.imbalance;
  try {
    const res = await fetch(`${CLOB_API}/book?token_id=${tokenId}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return 0;
    const book = await res.json() as {
      bids?: { price: string; size: string }[];
      asks?: { price: string; size: string }[];
    };
    const bids = (book.bids ?? []).slice(0, 5);
    const asks = (book.asks ?? []).slice(0, 5);
    const bidQty = bids.reduce((s, l) => s + parseFloat(l.size), 0);
    const askQty = asks.reduce((s, l) => s + parseFloat(l.size), 0);
    const total  = bidQty + askQty;
    const imbalance = total > 0 ? (bidQty - askQty) / total : 0;
    obCache.set(tokenId, { imbalance, ts: Date.now() });
    return imbalance;
  } catch { return 0; }
}

// ─── YES price fetch ───────────────────────────────────────────────────────────

async function fetchYesPrice(tokenId: string): Promise<number> {
  try {
    const res = await fetch(`${CLOB_API}/price?token_id=${tokenId}&side=buy`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return 0.5;
    const d = await res.json() as { price?: string };
    const p = parseFloat(d.price ?? "0.5");
    return isNaN(p) || p <= 0 || p >= 1 ? 0.5 : p;
  } catch { return 0.5; }
}

// ─── Main signal function ──────────────────────────────────────────────────────

/**
 * Get the current Polymarket crowd signal for an asset.
 * Returns null if no relevant market found or market is expired.
 *
 * @param asset "BTC" | "ETH" | "SOL"
 */
export async function getPolySignal(asset: string): Promise<PolySignal | null> {
  // Check cache
  const cached = signalCache.get(asset);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.signal;

  try {
    const markets = await fetchMarketList();
    const now = Date.now();

    // Filter to relevant Up/Down markets for this asset
    const assetKeyword = asset === "BTC" ? "bitcoin"
      : asset === "ETH" ? "ethereum"
      : asset === "SOL" ? "solana" : asset.toLowerCase();

    const relevant = markets.filter(m => {
      const q = (m.question || "").toLowerCase();
      // Match both "Bitcoin Up or Down" and "up or down" patterns
      if (!q.includes("up or down")) return false;
      if (!q.includes(assetKeyword)) return false;
      // Must have some liquidity to be meaningful
      if (parseFloat(m.liquidity || "0") < 500) return false;
      if (!m.active || m.closed) return false;
      const end = m.endDate ? new Date(m.endDate).getTime() : 0;
      const remaining = (end - now) / 1000;
      return remaining > 30 && remaining < 600; // between 30s and 10 min
    });

    if (!relevant.length) return null;

    // Pick the market expiring soonest (most relevant for short-term signal)
    relevant.sort((a, b) => {
      const ta = a.endDate ? new Date(a.endDate).getTime() : 0;
      const tb = b.endDate ? new Date(b.endDate).getTime() : 0;
      return ta - tb;
    });

    const market = relevant[0];
    const endMs  = market.endDate ? new Date(market.endDate).getTime() : now + 300000;
    const timeRemaining = Math.max(0, (endMs - now) / 1000);

    // Parse token IDs
    const rawIds = market.clobTokenIds ?? "[]";
    const tokenIds: string[] = typeof rawIds === "string"
      ? (() => { try { return JSON.parse(rawIds); } catch { return []; } })()
      : (Array.isArray(rawIds) ? rawIds : []);

    if (tokenIds.length < 1) return null;

    // Fetch YES price + order book imbalance in parallel
    const [yesPrice, obImbalance] = await Promise.all([
      fetchYesPrice(tokenIds[0]),
      tokenIds[0] ? fetchOBImbalance(tokenIds[0]) : Promise.resolve(0),
    ]);

    // Combine: adjust YES probability with OB signal (small weight)
    const OB_WEIGHT = 0.05;
    const adjustedYes = Math.max(0.05, Math.min(0.95, yesPrice + OB_WEIGHT * obImbalance));

    // Determine crowd direction
    let crowdDirection: "up" | "down" | "neutral";
    if (adjustedYes >= MIN_CROWD_PROB) {
      crowdDirection = "up";
    } else if (adjustedYes <= (1 - MIN_CROWD_PROB)) {
      crowdDirection = "down";
    } else {
      crowdDirection = "neutral";
    }

    // Confidence = how far from 0.5 (0 = coin flip, 1 = certain)
    const confidence = Math.abs(adjustedYes - 0.5) * 2;

    const signal: PolySignal = {
      asset,
      yesPrice: Math.round(adjustedYes * 1000) / 1000,
      obImbalance: Math.round(obImbalance * 1000) / 1000,
      crowdDirection,
      confidence: Math.round(confidence * 1000) / 1000,
      marketQuestion: market.question,
      timeRemaining: Math.round(timeRemaining),
    };

    signalCache.set(asset, { signal, ts: Date.now() });
    return signal;

  } catch (err) {
    console.warn(`[PolySignal] ${asset} fetch error:`, err);
    return null;
  }
}

/**
 * Quick check: does Polymarket crowd agree with our trade direction?
 *
 * @param asset   "BTC" | "ETH" | "SOL"
 * @param direction  "buy" | "sell"
 * @returns true = crowd confirms, false = crowd disagrees or neutral
 */
export async function crowdConfirms(asset: string, direction: "buy" | "sell"): Promise<{
  confirmed: boolean;
  signal: PolySignal | null;
  reason: string;
}> {
  const signal = await getPolySignal(asset);

  if (!signal) {
    // No Polymarket data — allow trade (don't block on missing data)
    return { confirmed: true, signal: null, reason: "no polymarket data — allowing" };
  }

  if (signal.crowdDirection === "neutral") {
    return {
      confirmed: false,
      signal,
      reason: `crowd neutral (${(signal.yesPrice * 100).toFixed(0)}% YES) — skipping`,
    };
  }

  const crowdAgrees =
    (direction === "buy"  && signal.crowdDirection === "up") ||
    (direction === "sell" && signal.crowdDirection === "down");

  if (crowdAgrees) {
    return {
      confirmed: true,
      signal,
      reason: `crowd confirms ${direction} — ${(signal.yesPrice * 100).toFixed(0)}% YES, confidence ${(signal.confidence * 100).toFixed(0)}%`,
    };
  } else {
    return {
      confirmed: false,
      signal,
      reason: `crowd disagrees — signals ${signal.crowdDirection} but we want ${direction} (${(signal.yesPrice * 100).toFixed(0)}% YES)`,
    };
  }
}
