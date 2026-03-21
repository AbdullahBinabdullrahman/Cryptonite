/**
 * CLOB Strategy Engine v2 — Bayesian + EV Filter + Kelly Sizing
 *
 * Based on the viral ARB ENGINE strategy:
 *   1. Bayesian Model:   P(H|D) = P(D|H)·P(H)/P(D)  — true prob from price/volume
 *   2. EV Filter:        EV_net  = q - p - c          — only trade if EV > threshold
 *   3. Stochastic Quote: r = s · qGamma(σ²/(T-t))    — limit order placement
 *   4. Kelly Sizing:     f = edge / odds              — bet fraction
 *
 * Every 10 seconds:
 *   - Fetch BTC/ETH/SOL prices from CoinGecko/Kraken
 *   - Update Bayesian posterior for each asset
 *   - Scan live 5-min Polymarket "Up or Down" markets
 *   - For each market, compute EV_net after 2% fees
 *   - Place CLOB limit order if EV_net > MIN_EV (0.005)
 *   - Size with Kelly criterion
 */

import { storage } from "./storage";
import { placeClobOrder } from "./polymarketClient";

const GAMMA_API   = "https://gamma-api.polymarket.com";
const CLOB_API    = "https://clob.polymarket.com";
const POLY_FEE    = 0.02;   // 2% Polymarket fee
const MIN_EV      = 0.015;  // minimum net EV raised to 1.5% — filters weak signals
const MAX_KELLY   = 0.05;   // cap Kelly at 5% of balance per trade
const MIN_BET     = 10.0;   // $10 minimum
const MAX_BET     = 100.0;  // $100 maximum per trade
const TICK_MS     = 10000;  // 10 seconds
const MAX_PER_DAY = 200;    // max 200 CLOB trades/day (was 1000 — reduces fee erosion)
const MAX_PER_TICK = 2;     // max 2 bets per tick
const STALE_POSITION_MS = 24 * 60 * 60 * 1000; // 24 hours — positions older than this are auto-resolved

// ─── Order book imbalance cache ───────────────────────────────────────────────
// Stores latest bid/ask imbalance per tokenId: >0 = buy pressure, <0 = sell pressure
const obImbalanceCache: Map<string, { imbalance: number; ts: number }> = new Map();

// ─── Per-session deduplication ────────────────────────────────────────────────
// Track marketIds+side already bet in this server session to prevent repeat bets.
// Reset on server restart (intentional — new session = fresh scan).
// Format: "<conditionId>:<YES|NO>"
const sessionBets: Set<string> = new Set();

// Per-day dedup: reset at midnight UTC
let dedupDayKey = new Date().toISOString().slice(0, 10); // "2026-03-21"
const dailyBets: Set<string> = new Set(); // "<conditionId>:<YES|NO>"

function getDailyBetKey(conditionId: string, side: string): string {
  // Reset if day rolled over
  const todayKey = new Date().toISOString().slice(0, 10);
  if (todayKey !== dedupDayKey) {
    dedupDayKey = todayKey;
    dailyBets.clear();
    console.log("[CLOBv2] Daily dedup set reset for new day:", todayKey);
  }
  return `${conditionId}:${side}`;
}

function hasAlreadyBetToday(conditionId: string, side: string): boolean {
  return dailyBets.has(getDailyBetKey(conditionId, side));
}

function markBetToday(conditionId: string, side: string): void {
  const key = getDailyBetKey(conditionId, side);
  dailyBets.add(key);
  sessionBets.add(key); // also mark in session set
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceTick { price: number; volume?: number; ts: number }

interface BayesState {
  prior: number;       // P(H) — prob BTC goes up this 5-min window
  posterior: number;   // P(H|D) — updated after new data
  variance: number;    // σ² — rolling price variance
  ticks: PriceTick[];  // last 60 ticks (~10 min history)
}

interface ClobMarket {
  question: string;
  conditionId: string;
  tokenIdYes: string;
  tokenIdNo: string;
  yesPrice: number;
  noPrice: number;
  liquidity: number;
  endDate: string;
  asset: string;
  timeRemaining: number; // seconds until resolution
}

interface EdgeOpp {
  market: ClobMarket;
  prior: number;
  posterior: number;
  evNet: number;
  side: "YES" | "NO";
  tokenId: string;
  limitPrice: number;   // stochastic reservation price
  kellyFraction: number;
  betSize: number;
}

// ─── Bayesian state per asset ─────────────────────────────────────────────────

const bayesState: Record<string, BayesState> = {};

function getOrInitBayes(asset: string): BayesState {
  if (!bayesState[asset]) {
    bayesState[asset] = { prior: 0.5, posterior: 0.5, variance: 0.0001, ticks: [] };
  }
  return bayesState[asset];
}

/**
 * Bayesian update: P(H|D) = P(D|H)·P(H) / P(D)
 *
 * H = "price will go UP in next 5 min"
 * D = observed price change in last tick
 *
 * Likelihood P(D|H):
 *   If H is true (going up), positive price changes are more likely.
 *   We model P(D|H=up)   ~ N(+μ, σ²) where μ = mean positive move
 *         P(D|H=down) ~ N(-μ, σ²)
 *
 * Using log-likelihood ratio for stability.
 */
function updateBayes(state: BayesState, newPrice: number): void {
  const now = Date.now();
  state.ticks.push({ price: newPrice, ts: now });

  // Keep last 10 minutes of ticks
  state.ticks = state.ticks.filter(t => now - t.ts < 10 * 60 * 1000);

  if (state.ticks.length < 3) return;

  const prices = state.ticks.map(t => t.price);
  const n = prices.length;

  // Compute rolling variance σ²
  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  state.variance = returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length;
  state.variance = Math.max(state.variance, 1e-8); // avoid division by zero

  // Observed data: last 5-tick price change
  const recent = prices.slice(-5);
  const delta = (recent[recent.length - 1] - recent[0]) / recent[0];

  // Expected positive move per tick under H=up (use historical mean of positive returns)
  const posReturns = returns.filter(r => r > 0);
  const mu = posReturns.length > 0
    ? posReturns.reduce((s, r) => s + r, 0) / posReturns.length
    : 0.0005;

  // Log-likelihood ratio: ln[P(D|up) / P(D|down)]
  // Under N(+μ, σ²): log P(D|up)   = -(delta-mu)²/(2σ²)
  // Under N(-μ, σ²): log P(D|down) = -(delta+mu)²/(2σ²)
  const llr = ((delta + mu) ** 2 - (delta - mu) ** 2) / (2 * state.variance);
  const likelihoodRatio = Math.exp(Math.min(5, Math.max(-5, llr))); // clamp

  // Bayes update: P(H|D) = P(D|H)·P(H) / [P(D|H)·P(H) + P(D|¬H)·P(¬H)]
  const prior = state.prior;
  const posterior = (likelihoodRatio * prior) / (likelihoodRatio * prior + (1 - prior));

  state.posterior = Math.max(0.05, Math.min(0.95, posterior));

  // Slow-decay prior toward posterior (0.9 momentum)
  state.prior = 0.9 * prior + 0.1 * state.posterior;
}

// ─── Stochastic reservation price (Avellaneda-Stoikov) ───────────────────────
// r = s · qGamma(σ² / (T - t))
// We use the gamma quantile approximation for limit order placement.
function reservationPrice(midPrice: number, variance: number, timeRemaining: number): number {
  if (timeRemaining <= 0) return midPrice;
  const gamma = 0.36; // risk aversion (from screenshot: gamma=0.36)
  const adjustment = gamma * variance / timeRemaining * 300; // normalize to minutes
  // Slightly inside the mid to get filled
  return Math.max(0.01, Math.min(0.99, midPrice - adjustment));
}


// ─── Order Book Imbalance ─────────────────────────────────────────────────────
/**
 * Fetch order book depth for a token and compute bid/ask imbalance.
 *
 * Imbalance = (totalBidQty - totalAskQty) / (totalBidQty + totalAskQty)
 *   > +0.2  → strong buy pressure  → boost YES confidence
 *   < -0.2  → strong sell pressure → boost NO confidence
 *
 * Cached for 8s (one tick) to avoid hammering the CLOB API.
 */
async function fetchOrderBookImbalance(tokenId: string): Promise<number> {
  const cached = obImbalanceCache.get(tokenId);
  if (cached && Date.now() - cached.ts < 8000) return cached.imbalance;

  try {
    const res = await fetch(`${CLOB_API}/book?token_id=${tokenId}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return 0;

    const book = await res.json() as {
      bids?: { price: string; size: string }[];
      asks?: { price: string; size: string }[];
    };

    const bids = book.bids ?? [];
    const asks = book.asks ?? [];

    // Use top-3 levels only to measure near-mid pressure
    const topBids = bids.slice(0, 3);
    const topAsks = asks.slice(0, 3);

    const bidQty = topBids.reduce((s, l) => s + parseFloat(l.size), 0);
    const askQty = topAsks.reduce((s, l) => s + parseFloat(l.size), 0);
    const total  = bidQty + askQty;

    const imbalance = total > 0 ? (bidQty - askQty) / total : 0;
    obImbalanceCache.set(tokenId, { imbalance, ts: Date.now() });
    return imbalance;
  } catch {
    return 0;
  }
}

/**
 * Imbalance-adjusted probability:
 * When the order book shows strong buy pressure (imbalance > 0.2),
 * the true probability is likely higher than the Bayesian estimate alone.
 * We apply a small boost/penalty to the model probability.
 *
 *   adjustedProb = modelProb + OB_WEIGHT × imbalance
 *   OB_WEIGHT = 0.08 (8% max shift from order book signal)
 */
const OB_WEIGHT = 0.08;

function adjustProbWithOrderBook(modelProb: number, imbalance: number): number {
  return Math.max(0.05, Math.min(0.95, modelProb + OB_WEIGHT * imbalance));
}

// ─── Price fetching ───────────────────────────────────────────────────────────

const priceCache: { data: Record<string, number>; ts: number } = { data: {}, ts: 0 };

async function fetchPrices(): Promise<Record<string, number>> {
  if (Date.now() - priceCache.ts < 8000) return priceCache.data;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,ripple,dogecoin&vs_currencies=usd",
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) throw new Error("CoinGecko failed");
    const d = await res.json() as Record<string, { usd: number }>;
    priceCache.data = {
      BTC: d.bitcoin?.usd ?? 0,
      ETH: d.ethereum?.usd ?? 0,
      SOL: d.solana?.usd ?? 0,
      XRP: d.ripple?.usd ?? 0,
      DOGE: d.dogecoin?.usd ?? 0,
    };
    priceCache.ts = Date.now();
    return priceCache.data;
  } catch {
    // Kraken fallback
    try {
      const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD", {
        signal: AbortSignal.timeout(5000),
      });
      const d = await res.json() as any;
      priceCache.data = {
        BTC: parseFloat(d.result?.XXBTZUSD?.c?.[0] ?? "0"),
        ETH: parseFloat(d.result?.XETHZUSD?.c?.[0] ?? "0"),
        SOL: parseFloat(d.result?.SOLUSD?.c?.[0]   ?? "0"),
        XRP: 0, DOGE: 0,
      };
      priceCache.ts = Date.now();
    } catch {}
    return priceCache.data;
  }
}

// ─── Fetch live up/down markets ───────────────────────────────────────────────

let marketCache: { data: ClobMarket[]; ts: number } = { data: [], ts: 0 };

async function fetchUpDownMarkets(): Promise<ClobMarket[]> {
  // Refresh every 60s (markets don't change often)
  if (Date.now() - marketCache.ts < 60000 && marketCache.data.length > 0) {
    return marketCache.data;
  }
  try {
    const res = await fetch(
      `${GAMMA_API}/markets?active=true&closed=false&limit=200&order=startDate&ascending=false`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return marketCache.data;
    const raw = await res.json() as any[];
    if (!Array.isArray(raw)) return marketCache.data;

    const now = Date.now();
    const markets: ClobMarket[] = [];

    for (const m of raw) {
      const q: string = (m.question || m.title || "").toLowerCase();
      const liq = parseFloat(m.liquidity ?? "0");
      if (!q.includes("up or down")) continue;
      if (liq < 500) continue;

      let asset = "";
      if (q.includes("bitcoin")) asset = "BTC";
      else if (q.includes("ethereum")) asset = "ETH";
      else if (q.includes("solana")) asset = "SOL";
      else if (q.includes("xrp")) asset = "XRP";
      else if (q.includes("dogecoin")) asset = "DOGE";
      else continue;

      // clobTokenIds from Gamma API comes as a JSON string e.g. '["123","456"]'
      // We must parse it before treating it as an array.
      const rawTokenIds = m.clobTokenIds ?? "[]";
      const tokenIds: string[] = typeof rawTokenIds === "string"
        ? (() => { try { return JSON.parse(rawTokenIds); } catch { return []; } })()
        : (Array.isArray(rawTokenIds) ? rawTokenIds : []);
      if (tokenIds.length < 2) continue;

      const endDate = m.endDate ? new Date(m.endDate).getTime() : now + 300000;
      const timeRemaining = Math.max(0, (endDate - now) / 1000);

      // Fetch Yes price from CLOB
      let yesPrice = 0.5;
      try {
        const pr = await fetch(`${CLOB_API}/price?token_id=${tokenIds[0]}&side=buy`, {
          signal: AbortSignal.timeout(4000),
        });
        if (pr.ok) {
          const pd = await pr.json() as { price?: string };
          yesPrice = parseFloat(pd.price ?? "0.5");
          if (isNaN(yesPrice) || yesPrice <= 0 || yesPrice >= 1) yesPrice = 0.5;
        }
      } catch {}

      markets.push({
        question: m.question || m.title,
        conditionId: m.conditionId || "",
        tokenIdYes: tokenIds[0],
        tokenIdNo: tokenIds[1],
        yesPrice,
        noPrice: 1 - yesPrice,
        liquidity: liq,
        endDate: m.endDate || "",
        asset,
        timeRemaining,
      });
    }

    marketCache = { data: markets, ts: Date.now() };
    return markets;
  } catch (err) {
    console.warn("[CLOBv2] fetchUpDownMarkets error:", err);
    return marketCache.data;
  }
}

// ─── EV calculation ───────────────────────────────────────────────────────────
/**
 * EV_net = q - p - c
 *   q = model price (Bayesian posterior for YES, or 1-posterior for NO)
 *   p = market price for the token we're buying
 *   c = fees (2% of p) + slippage estimate (0.5%)
 */
function calcEV(modelProb: number, marketPrice: number): number {
  const c = POLY_FEE * marketPrice + 0.005; // fee + slippage
  return modelProb - marketPrice - c;
}

// ─── Kelly criterion ──────────────────────────────────────────────────────────
// f* = (b·p - q) / b  where b = odds (payout per $1 bet), p = win prob, q = 1-p
function kellyFraction(winProb: number, limitPrice: number): number {
  if (limitPrice <= 0 || limitPrice >= 1) return 0;
  const b = (1 - limitPrice) / limitPrice; // net odds
  const q = 1 - winProb;
  const f = (b * winProb - q) / b;
  return Math.max(0, Math.min(MAX_KELLY, f));
}

// ─── Find edge opportunities ──────────────────────────────────────────────────

async function findEdgeOpps(markets: ClobMarket[], bayesMap: Record<string, BayesState>): Promise<EdgeOpp[]> {
  const opps: EdgeOpp[] = [];

  for (const mkt of markets) {
    const state = bayesMap[mkt.asset];
    if (!state || state.ticks.length < 3) continue;

    const posterior = state.posterior; // P(BTC goes up) from Bayesian
    const variance  = state.variance;

    // ── Fetch order book imbalance for YES token
    // imbalance > 0  → more bids than asks → crowd expects YES
    // imbalance < 0  → more asks than bids → crowd expects NO
    const obImbalance = await fetchOrderBookImbalance(mkt.tokenIdYes);

    // Adjust model probability with order book signal
    const adjYesProb = adjustProbWithOrderBook(posterior,       obImbalance);
    const adjNoProb  = adjustProbWithOrderBook(1 - posterior,  -obImbalance);

    // ── YES side: adjusted model says UP more than market thinks
    const evYes = calcEV(adjYesProb, mkt.yesPrice);
    if (evYes > MIN_EV && mkt.timeRemaining > 60 && !hasAlreadyBetToday(mkt.conditionId, "YES")) {
      const rPrice = reservationPrice(mkt.yesPrice, variance, mkt.timeRemaining);
      const kf     = kellyFraction(adjYesProb, rPrice);
      if (kf > 0) {
        opps.push({
          market: mkt,
          prior: state.prior,
          posterior: adjYesProb,  // store OB-adjusted value
          evNet: evYes,
          side: "YES",
          tokenId: mkt.tokenIdYes,
          limitPrice: rPrice,
          kellyFraction: kf,
          betSize: 0,
        });
      }
    }

    // ── NO side: adjusted model says DOWN, market underprices NO
    const evNo = calcEV(adjNoProb, mkt.noPrice);
    if (evNo > MIN_EV && mkt.timeRemaining > 60 && !hasAlreadyBetToday(mkt.conditionId, "NO")) {
      const rPrice = reservationPrice(mkt.noPrice, variance, mkt.timeRemaining);
      const kf     = kellyFraction(adjNoProb, rPrice);
      if (kf > 0) {
        opps.push({
          market: mkt,
          prior: state.prior,
          posterior: adjNoProb,
          evNet: evNo,
          side: "NO",
          tokenId: mkt.tokenIdNo,
          limitPrice: rPrice,
          kellyFraction: kf,
          betSize: 0,
        });
      }
    }
  }

  // Sort by EV descending
  opps.sort((a, b) => b.evNet - a.evNet);
  return opps;
}

// ─── Place order ──────────────────────────────────────────────────────────────

async function placeBet(opp: EdgeOpp, balance: number, settings: any): Promise<boolean> {
  const pk  = settings.polyPrivateKey    || process.env.POLY_PRIVATE_KEY    || "";
  const fdr = settings.polyFunderAddress || process.env.POLY_FUNDER_ADDRESS || "0xeb0ad9B38733D5e7A51F1120d2d2e63055aAC3Af";

  // Guard: private key must be a 64-char hex string (0x + 64 chars = 66, or bare 64)
  const pkClean = pk.startsWith("0x") ? pk.slice(2) : pk;
  if (pkClean.length !== 64) {
    console.warn("[CLOB] POLY_PRIVATE_KEY not set or invalid — skipping order. Set it in Render env vars.");
    return false;
  }

  // Kelly-sized bet, clamped between MIN_BET and MAX_BET
  const rawBet = balance * opp.kellyFraction;
  opp.betSize  = Math.min(MAX_BET, Math.max(MIN_BET, rawBet));
  const shares = opp.betSize / opp.limitPrice;

  // Record trade
  const trade = await storage.createTrade({
    market:        opp.market.question,
    marketId:      opp.market.conditionId,
    direction:     opp.side,
    betSize:       opp.betSize,
    entryOdds:     opp.limitPrice,
    btcMomentum:   opp.posterior - 0.5, // signed momentum indicator
    edgeDetected:  Math.round(opp.evNet * 10000) / 100,
    status:        "open",
    pnl:           0,
    resolvedAt:    null,
  });

  // Place CLOB limit order
  const result = await placeClobOrder({
    privateKey:    pk,
    funderAddress: fdr,
    tokenId:       opp.tokenId,
    side:          "BUY",
    size:          Math.round(shares * 100) / 100,
    price:         opp.limitPrice,
    marketId:      opp.market.conditionId,
  });

  const status = result.status === "simulated" ? "clob:simulated" : "clob:placed";
  await storage.updateTradeAlpacaOrder(trade.id, result.orderId ?? `clob-${Date.now()}`, status);

  // Mark this market+side as bet today so we don't repeat it
  markBetToday(opp.market.conditionId, opp.side);

  console.log(
    `[CLOBv2] ${opp.market.asset} ${opp.side} | ` +
    `prior=${(opp.prior*100).toFixed(1)}% → post=${(opp.posterior*100).toFixed(1)}% | ` +
    `EV=${(opp.evNet*100).toFixed(2)}% | Kelly=${(opp.kellyFraction*100).toFixed(2)}% | ` +
    `$${opp.betSize.toFixed(2)} @ ${opp.limitPrice.toFixed(3)} | ${status}`
  );
  return result.ok;
}


// ─── Stale position cleanup ───────────────────────────────────────────────────
/**
 * Polymarket markets resolve within their end window (typically 5-30 min).
 * Our DB may have lingering "open" CLOB entries never updated.
 * Auto-resolve any CLOB trade still "open" after 24h as "lost" (conservative).
 */
let lastStaleCheck = 0;

async function clearStalePositions(): Promise<void> {
  const now = Date.now();
  if (now - lastStaleCheck < 60 * 60 * 1000) return; // max once per hour
  lastStaleCheck = now;
  try {
    const openTrades = await storage.getOpenTrades();
    let cleared = 0;
    for (const trade of openTrades) {
      const isClobTrade =
        trade.alpacaOrderStatus?.startsWith("clob") ||
        (!trade.alpacaOrderStatus && (trade.marketId?.length ?? 0) > 10);
      if (!isClobTrade) continue;
      const ageMs = now - new Date(trade.createdAt).getTime();
      if (ageMs > STALE_POSITION_MS) {
        await storage.resolveTrade(trade.id, "lost", -trade.betSize);
        cleared++;
      }
    }
    if (cleared > 0) {
      console.log(`[CLOBv2] Auto-resolved ${cleared} stale position(s) older than 24h`);
    }
  } catch (err) {
    console.warn("[CLOBv2] clearStalePositions error:", err);
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

let clobInterval: ReturnType<typeof setInterval> | null = null;

export function startClobStrategy() {
  if (clobInterval) return;
  console.log("[CLOBv2] Starting — Bayesian edge detection on 5-min Up/Down markets");

  clobInterval = setInterval(async () => {
    try {
      const settings = await storage.getBotSettings();
      if (!settings.isRunning) return;

      const todayCount = await storage.getTodayTradeCount();
      if (todayCount >= MAX_PER_DAY) return;

      const todayPnl = await storage.getTodayPnl();
      const maxDailyLoss = settings.totalBalance * ((settings.dailyStopLossPct ?? 5) / 100);
      if (todayPnl < -maxDailyLoss) return;

      // 1. Fetch prices and update Bayesian state
      const prices = await fetchPrices();
      for (const [sym, price] of Object.entries(prices)) {
        if (price > 0) {
          const state = getOrInitBayes(sym);
          updateBayes(state, price);
        }
      }

      // 2. Fetch live markets
      const markets = await fetchUpDownMarkets();
      if (!markets.length) return;

      // 3. Find edge opportunities
      const opps = await findEdgeOpps(markets, bayesState);
      if (!opps.length) return;

      console.log(`[CLOBv2] ${opps.length} edge opps | top EV=${(opps[0].evNet*100).toFixed(2)}%`);

      // 3.5 Clear stale positions older than 24h (runs at most once/hour)
      await clearStalePositions();

      // 4. Place top opportunities (max MAX_PER_TICK per tick)
      const limit = Math.min(MAX_PER_TICK, opps.length, MAX_PER_DAY - todayCount);
      for (let i = 0; i < limit; i++) {
        await placeBet(opps[i], settings.totalBalance, settings);
        await new Promise(r => setTimeout(r, 500)); // 500ms cooldown between orders
      }

    } catch (err) {
      console.error("[CLOBv2] tick error:", err);
    }
  }, TICK_MS);
}

export function stopClobStrategy() {
  if (clobInterval) { clearInterval(clobInterval); clobInterval = null; }
  console.log("[CLOBv2] Stopped");
}

// ─── Snapshot for UI ──────────────────────────────────────────────────────────

export async function getClobSnapshot() {
  const markets = await fetchUpDownMarkets();
  const prices  = await fetchPrices();

  // Refresh Bayesian state with latest prices
  for (const [sym, price] of Object.entries(prices)) {
    if (price > 0) {
      const state = getOrInitBayes(sym);
      updateBayes(state, price);
    }
  }

  // Fetch OB imbalance for all markets in parallel (for UI display)
  const imbalances = await Promise.all(
    markets.slice(0, 30).map(m => fetchOrderBookImbalance(m.tokenIdYes))
  );

  const rows = markets.slice(0, 30).map((m, i) => {
    const state      = bayesState[m.asset];
    const posterior  = state?.posterior ?? 0.5;
    const variance   = state?.variance  ?? 0.0001;
    const obImb      = imbalances[i] ?? 0;
    const adjYes     = adjustProbWithOrderBook(posterior,      obImb);
    const adjNo      = adjustProbWithOrderBook(1 - posterior, -obImb);
    const evYes      = calcEV(adjYes, m.yesPrice);
    const evNo       = calcEV(adjNo,  m.noPrice);
    const bestEv     = Math.max(evYes, evNo);
    const bestSide   = evYes >= evNo ? "YES" : "NO";
    return {
      question:    m.question,
      asset:       m.asset,
      yesPrice:    Math.round(m.yesPrice  * 1000) / 1000,
      noPrice:     Math.round(m.noPrice   * 1000) / 1000,
      posterior:   Math.round(adjYes      * 1000) / 1000,  // OB-adjusted
      obImbalance: Math.round(obImb       * 1000) / 1000,
      evNet:       Math.round(bestEv * 10000) / 100,
      side:        bestSide,
      liquidity:   Math.round(m.liquidity),
      hasEdge:     bestEv > MIN_EV,
      timeLeft:    Math.round(m.timeRemaining),
    };
  });

  return {
    markets: rows,
    bayesState: Object.fromEntries(
      Object.entries(bayesState).map(([k, v]) => [k, {
        prior:     Math.round(v.prior     * 1000) / 1000,
        posterior: Math.round(v.posterior * 1000) / 1000,
        variance:  Math.round(v.variance  * 1e8)  / 1e8,
        ticks:     v.ticks.length,
      }])
    ),
    prices,
    lastUpdated: new Date().toISOString(),
  };
}
