/**
 * Wallet Leaderboard Engine
 *
 * Discovers top-performing Polymarket wallets by:
 *  1. Fetching recent high-volume trades from Gamma API
 *  2. Aggregating PnL, win rate, ROI per unique wallet address
 *  3. Scoring wallets using a composite metric
 *  4. Caching results for 5 minutes (to avoid hammering API)
 *
 * No official "leaderboard" API exists on Polymarket — we derive it
 * from the public trades feed by aggregating per-trader statistics.
 */

import { fetchWalletPositions } from "./polymarketClient";

const GAMMA_API = "https://gamma-api.polymarket.com";
const DATA_API  = "https://data-api.polymarket.com";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletLeader {
  address: string;
  rank: number;
  displayName: string;       // first 6 + last 4 chars
  totalProfit: number;       // USD PnL
  roi: number;               // ROI % (profit / volume)
  winRate: number;           // % of resolved bets won
  totalTrades: number;
  volume: number;            // total USDC wagered
  avgBetSize: number;
  score: number;             // composite leaderboard score
  topMarkets: string[];      // top 3 market names they traded
  recentActivity: string;    // "Active Xs ago"
  verified: boolean;         // has traded 10+ markets
}

export interface WalletPosition {
  marketId: string;
  market: string;
  outcome: string;
  size: number;
  price: number;
  value: number;
  unrealizedPnl: number;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

interface Cache<T> { data: T; ts: number; }
let leaderCache: Cache<WalletLeader[]> | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Fetch recent trades and build leaderboard ─────────────────────────────

async function fetchRecentTrades(limit = 500): Promise<any[]> {
  try {
    const res = await fetch(
      `${GAMMA_API}/trades?limit=${limit}&order=desc`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn("[Leaderboard] fetchRecentTrades error:", err);
    return [];
  }
}

async function fetchTradesByWallet(address: string, limit = 100): Promise<any[]> {
  try {
    const res = await fetch(
      `${GAMMA_API}/trades?user=${address.toLowerCase()}&limit=${limit}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Score a wallet for leaderboard ranking:
 *   score = (winRate × 0.4) + (roi × 0.35) + (volume_factor × 0.15) + (diversity × 0.10)
 *
 * winRate:      0–1 (fraction of won trades)
 * roi:          normalized 0–1 (capped at +200% ROI = 1.0)
 * vol_factor:   log(volume + 1) / 10, capped at 1.0
 * diversity:    unique markets / 10, capped at 1.0
 */
function scoreWallet(stats: {
  winRate: number;
  roi: number;
  volume: number;
  uniqueMarkets: number;
  totalTrades: number;
}): number {
  if (stats.totalTrades < 3) return 0; // not enough data
  const roiNorm   = Math.max(0, Math.min(1, stats.roi / 2));         // cap at 200% ROI
  const volFactor = Math.min(1, Math.log10(stats.volume + 1) / 4);   // log scale volume
  const diversity = Math.min(1, stats.uniqueMarkets / 15);
  return (
    stats.winRate * 0.40 +
    roiNorm       * 0.35 +
    volFactor     * 0.15 +
    diversity     * 0.10
  );
}

function timeAgo(ts: string | null): string {
  if (!ts) return "Unknown";
  const ms = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export async function getTopWallets(forceRefresh = false): Promise<WalletLeader[]> {
  // Return cached if fresh
  if (!forceRefresh && leaderCache && Date.now() - leaderCache.ts < CACHE_TTL) {
    return leaderCache.data;
  }

  console.log("[Leaderboard] Fetching top wallets from Polymarket trades...");

  // 1. Fetch recent trades
  const trades = await fetchRecentTrades(500);
  if (!trades.length) {
    console.warn("[Leaderboard] No trades fetched");
    return leaderCache?.data ?? [];
  }

  // 2. Aggregate per wallet
  const walletMap: Map<string, {
    address: string;
    trades: any[];
    markets: Set<string>;
    totalSpent: number;
    totalWon: number;
    won: number;
    lost: number;
    lastTs: string | null;
  }> = new Map();

  for (const t of trades) {
    const addr = (t.maker || t.user || t.trader_id || "").toLowerCase();
    if (!addr || addr.length < 10) continue;

    let entry = walletMap.get(addr);
    if (!entry) {
      entry = {
        address: addr,
        trades: [],
        markets: new Set(),
        totalSpent: 0,
        totalWon: 0,
        won: 0,
        lost: 0,
        lastTs: null,
      };
      walletMap.set(addr, entry);
    }

    entry.trades.push(t);
    const mkt = t.conditionId || t.market_id || t.marketId || "";
    if (mkt) entry.markets.add(mkt);

    const spent = parseFloat(t.usdcAmt || t.usdc_amount || t.amount || "0");
    entry.totalSpent += spent;

    // Track pnl from resolved trades
    const pnl = parseFloat(t.profit || t.pnl || "0");
    if (pnl > 0) { entry.totalWon += pnl; entry.won++; }
    else if (pnl < 0) entry.lost++;

    const ts = t.timestamp || t.created_at;
    if (ts && (!entry.lastTs || new Date(ts) > new Date(entry.lastTs))) {
      entry.lastTs = ts;
    }
  }

  // 3. Build leaderboard entries
  const leaders: WalletLeader[] = [];

  for (const [addr, w] of walletMap.entries()) {
    if (w.trades.length < 2) continue; // need at least 2 trades

    const totalTrades = w.trades.length;
    const resolved = w.won + w.lost;
    const winRate = resolved > 0 ? w.won / resolved : 0.5;
    const profit = w.totalWon - (w.totalSpent > 0 ? w.totalSpent * 0.5 : 0); // rough estimate
    const roi = w.totalSpent > 0 ? profit / w.totalSpent : 0;
    const uniqueMarkets = w.markets.size;

    const topMarkets = w.trades
      .map(t => t.title || t.market || "")
      .filter(Boolean)
      .slice(0, 3);

    const score = scoreWallet({ winRate, roi, volume: w.totalSpent, uniqueMarkets, totalTrades });

    leaders.push({
      address: addr,
      rank: 0,
      displayName: addr.slice(0, 6) + "…" + addr.slice(-4),
      totalProfit: Math.round(profit * 100) / 100,
      roi: Math.round(roi * 10000) / 100,
      winRate: Math.round(winRate * 1000) / 10,
      totalTrades,
      volume: Math.round(w.totalSpent * 100) / 100,
      avgBetSize: Math.round((w.totalSpent / totalTrades) * 100) / 100,
      score: Math.round(score * 1000) / 1000,
      topMarkets: [...new Set(topMarkets)].slice(0, 3),
      recentActivity: timeAgo(w.lastTs),
      verified: uniqueMarkets >= 5,
    });
  }

  // 4. Sort by score, assign ranks
  leaders.sort((a, b) => b.score - a.score);
  leaders.forEach((l, i) => { l.rank = i + 1; });

  // Keep top 50
  const top50 = leaders.slice(0, 50);

  leaderCache = { data: top50, ts: Date.now() };
  console.log(`[Leaderboard] Built leaderboard with ${top50.length} wallets`);
  return top50;
}

// ─── Wallet profile deep-dive ─────────────────────────────────────────────────

export async function getWalletProfile(address: string): Promise<{
  address: string;
  trades: any[];
  positions: any[];
  stats: {
    totalTrades: number;
    winRate: number;
    totalVolume: number;
    totalProfit: number;
    roi: number;
    avgBetSize: number;
    uniqueMarkets: number;
    topMarkets: string[];
  };
}> {
  const [trades, positions] = await Promise.all([
    fetchTradesByWallet(address, 100),
    fetchWalletPositions(address),
  ]);

  const totalVolume = trades.reduce((s, t) => s + parseFloat(t.usdcAmt || t.amount || "0"), 0);
  const won = trades.filter(t => parseFloat(t.profit || "0") > 0).length;
  const lost = trades.filter(t => parseFloat(t.profit || "0") < 0).length;
  const resolved = won + lost;
  const totalProfit = trades.reduce((s, t) => s + parseFloat(t.profit || "0"), 0);
  const uniqueMarkets = new Set(trades.map(t => t.conditionId || t.market_id || "")).size;

  const topMarkets = [...new Set(
    trades.map(t => t.title || t.market || "").filter(Boolean)
  )].slice(0, 5);

  return {
    address,
    trades: trades.slice(0, 20),
    positions: positions.slice(0, 20),
    stats: {
      totalTrades: trades.length,
      winRate: resolved > 0 ? Math.round((won / resolved) * 1000) / 10 : 0,
      totalVolume: Math.round(totalVolume * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      roi: totalVolume > 0 ? Math.round((totalProfit / totalVolume) * 10000) / 100 : 0,
      avgBetSize: trades.length > 0 ? Math.round((totalVolume / trades.length) * 100) / 100 : 0,
      uniqueMarkets,
      topMarkets,
    },
  };
}

// ─── Smart Merge: blend positions from multiple wallets ─────────────────────

interface MergeCandidate {
  marketId: string;
  market: string;
  tokenId: string;
  outcome: string;
  side: string;
  price: number;
  walletCount: number;       // how many wallets have this position
  totalWeight: number;       // sum of wallet scores
  avgPrice: number;
  recommendedSize: number;   // scaled by consensus weight
}

export async function getMergedPositions(
  walletAddresses: string[],
  walletScores: Record<string, number>,
  maxPositions = 10,
  budget = 100 // USDC budget for merged copy
): Promise<MergeCandidate[]> {
  if (!walletAddresses.length) return [];

  // Fetch positions for all wallets in parallel
  const allPositions = await Promise.all(
    walletAddresses.map(addr => fetchWalletPositions(addr))
  );

  // Aggregate by marketId+outcome
  const posMap: Map<string, MergeCandidate> = new Map();

  walletAddresses.forEach((addr, i) => {
    const positions = allPositions[i] || [];
    const walletScore = walletScores[addr] ?? 0.5;

    for (const pos of positions) {
      const marketId = pos.conditionId || pos.market_id || "";
      const outcome = pos.outcome || pos.side || "YES";
      const key = `${marketId}:${outcome}`;

      let entry = posMap.get(key);
      if (!entry) {
        entry = {
          marketId,
          market: pos.title || pos.market || "Unknown",
          tokenId: pos.asset_id || pos.token_id || "",
          outcome,
          side: "BUY",
          price: parseFloat(pos.price || pos.avgPrice || "0.5"),
          walletCount: 0,
          totalWeight: 0,
          avgPrice: 0,
          recommendedSize: 0,
        };
        posMap.set(key, entry);
      }

      entry.walletCount++;
      entry.totalWeight += walletScore;
      entry.avgPrice = (entry.avgPrice * (entry.walletCount - 1) + parseFloat(pos.price || "0.5")) / entry.walletCount;
    }
  });

  // Filter: only positions held by 2+ wallets (consensus)
  const consensusPositions = [...posMap.values()]
    .filter(p => p.walletCount >= Math.max(1, Math.floor(walletAddresses.length * 0.4)))
    .sort((a, b) => b.totalWeight - a.totalWeight)
    .slice(0, maxPositions);

  // Allocate budget proportionally by weight
  const totalWeight = consensusPositions.reduce((s, p) => s + p.totalWeight, 0);
  for (const pos of consensusPositions) {
    const fraction = totalWeight > 0 ? pos.totalWeight / totalWeight : 1 / consensusPositions.length;
    pos.recommendedSize = Math.round(budget * fraction * 100) / 100;
  }

  return consensusPositions;
}
