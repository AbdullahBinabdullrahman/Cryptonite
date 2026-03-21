/**
 * ML Engine — Roadmap Implementation
 *
 * Implements the 6-month quantitative trading roadmap:
 *
 * Month 1 – Probability calibration: track predicted q vs actual outcomes
 * Month 2 – EV + Kelly + Base Rate filter (already in clobStrategy; unified here)
 * Month 3 – Random Forest analogue: weighted ensemble of N binary signals
 * Month 4 – Bootstrap simulation: 10,000 resamples → 95% CI on win rate
 * Month 5 – XGBoost analogue: boosted signal weights (sequential error correction)
 * Month 6 – Self-improving weights: update signal weights after each resolved trade
 *
 * No Python required — runs entirely in Node.js/TypeScript.
 * Uses the same SQLite DB as the rest of the app.
 */

import Database from "better-sqlite3";
import path from "path";

// ─── DB setup ─────────────────────────────────────────────────────────────────
const DB_PATH = process.env.NODE_ENV === "production"
  ? "/data/polybot.db"
  : path.resolve(process.cwd(), "data", "polybot.db");

function getDb() {
  return new Database(DB_PATH, { fileMustExist: false });
}

// ─── Schema ───────────────────────────────────────────────────────────────────
export function initMlTables() {
  const db = getDb();
  try {
    // Prediction log: every signal with its predicted probability + eventual outcome
    db.exec(`
      CREATE TABLE IF NOT EXISTS ml_predictions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ts          INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        asset       TEXT NOT NULL,           -- BTC, ETH, SOL
        mode        TEXT NOT NULL,           -- SCALP | DAY | SWING | CLOB
        direction   TEXT NOT NULL,           -- BUY | YES | NO
        pred_q      REAL NOT NULL,           -- our predicted probability (0–1)
        market_p    REAL NOT NULL,           -- market-implied probability at entry
        ev          REAL NOT NULL,           -- pred_q - market_p
        kelly_f     REAL NOT NULL,           -- Kelly fraction used
        signals     TEXT NOT NULL,           -- JSON array of {name, fired} objects
        outcome     INTEGER,                 -- NULL=pending, 1=won, 0=lost
        resolved_ts INTEGER                  -- when outcome was recorded
      );

      CREATE TABLE IF NOT EXISTS ml_signal_weights (
        signal_name TEXT PRIMARY KEY,
        weight      REAL NOT NULL DEFAULT 1.0,
        wins        INTEGER NOT NULL DEFAULT 0,
        total       INTEGER NOT NULL DEFAULT 0,
        last_update INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS ml_base_rates (
        category    TEXT PRIMARY KEY,        -- e.g. "BTC_SCALP", "CLOB_BTC_UP"
        wins        INTEGER NOT NULL DEFAULT 0,
        total       INTEGER NOT NULL DEFAULT 0,
        last_update INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
    `);
  } finally {
    db.close();
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SignalResult {
  name: string;
  fired: boolean;
  confidence?: number; // 0–1, optional fine-grained score
}

export interface PredictionLog {
  asset: string;
  mode: string;
  direction: string;
  pred_q: number;
  market_p: number;
  ev: number;
  kelly_f: number;
  signals: SignalResult[];
}

// ─── Base Rate ────────────────────────────────────────────────────────────────
/**
 * Get the historical win-rate for a category.
 * Returns 0.5 (neutral) if fewer than 10 samples.
 */
export function getBaseRate(category: string): number {
  const db = getDb();
  try {
    const row = db.prepare(
      "SELECT wins, total FROM ml_base_rates WHERE category = ?"
    ).get(category) as { wins: number; total: number } | undefined;
    if (!row || row.total < 10) return 0.5; // not enough data
    return row.wins / row.total;
  } finally {
    db.close();
  }
}

function updateBaseRate(category: string, won: boolean) {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO ml_base_rates (category, wins, total)
      VALUES (?, ?, 1)
      ON CONFLICT(category) DO UPDATE SET
        wins  = wins + ?,
        total = total + 1,
        last_update = strftime('%s','now')
    `).run(category, won ? 1 : 0, won ? 1 : 0);
  } finally {
    db.close();
  }
}

// ─── Signal Weights (XGBoost analogue) ───────────────────────────────────────
/**
 * Get the learned weight for a named signal.
 * Starts at 1.0, adjusts up/down based on historical accuracy.
 */
export function getSignalWeight(signalName: string): number {
  const db = getDb();
  try {
    const row = db.prepare(
      "SELECT weight FROM ml_signal_weights WHERE signal_name = ?"
    ).get(signalName) as { weight: number } | undefined;
    return row?.weight ?? 1.0;
  } finally {
    db.close();
  }
}

/**
 * Weighted ensemble score (Random Forest analogue):
 * Each signal that fires contributes its learned weight.
 * Returns a score 0–1 representing ensemble confidence.
 */
export function ensembleScore(signals: SignalResult[]): number {
  if (!signals.length) return 0.5;
  const db = getDb();
  try {
    let totalWeight = 0;
    let firedWeight = 0;
    for (const s of signals) {
      const row = db.prepare(
        "SELECT weight FROM ml_signal_weights WHERE signal_name = ?"
      ).get(s.name) as { weight: number } | undefined;
      const w = row?.weight ?? 1.0;
      totalWeight += w;
      if (s.fired) firedWeight += w;
    }
    return totalWeight > 0 ? firedWeight / totalWeight : 0.5;
  } finally {
    db.close();
  }
}

/**
 * XGBoost-style boosted vote count:
 * Signals with higher learned accuracy get more "votes".
 * Returns number of effective votes (can be fractional).
 */
export function boostedVoteCount(signals: SignalResult[]): number {
  if (!signals.length) return 0;
  const db = getDb();
  try {
    let votes = 0;
    for (const s of signals) {
      if (!s.fired) continue;
      const row = db.prepare(
        "SELECT weight FROM ml_signal_weights WHERE signal_name = ?"
      ).get(s.name) as { weight: number } | undefined;
      votes += row?.weight ?? 1.0;
    }
    return votes;
  } finally {
    db.close();
  }
}

// Required weighted votes threshold (equivalent to 3-of-5 with equal weights = 3.0)
export const BOOSTED_VOTE_THRESHOLD = 3.0;

// ─── Prediction tracking ──────────────────────────────────────────────────────
export function logPrediction(pred: PredictionLog): number {
  const db = getDb();
  try {
    const result = db.prepare(`
      INSERT INTO ml_predictions
        (asset, mode, direction, pred_q, market_p, ev, kelly_f, signals)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pred.asset, pred.mode, pred.direction,
      pred.pred_q, pred.market_p, pred.ev, pred.kelly_f,
      JSON.stringify(pred.signals)
    );
    return result.lastInsertRowid as number;
  } finally {
    db.close();
  }
}

export function resolvePrediction(predId: number, won: boolean) {
  const db = getDb();
  try {
    const pred = db.prepare(
      "SELECT * FROM ml_predictions WHERE id = ?"
    ).get(predId) as any;
    if (!pred) return;

    db.prepare(`
      UPDATE ml_predictions
      SET outcome = ?, resolved_ts = strftime('%s','now')
      WHERE id = ?
    `).run(won ? 1 : 0, predId);

    // Update base rate for this category
    const category = `${pred.asset}_${pred.mode}`;
    updateBaseRate(category, won);

    // XGBoost-style weight update: boost signals that were correct
    const signals: SignalResult[] = JSON.parse(pred.signals || "[]");
    updateSignalWeights(signals, won);
  } finally {
    db.close();
  }
}

/**
 * Update signal weights using gradient boosting principle:
 * - Signals that correctly predicted the outcome get weight * 1.05
 * - Signals that wrongly predicted get weight * 0.95
 * - Clamp weights to [0.1, 3.0]
 */
function updateSignalWeights(signals: SignalResult[], won: boolean) {
  const db = getDb();
  try {
    for (const s of signals) {
      const correct = (s.fired && won) || (!s.fired && !won);
      const boost = correct ? 1.05 : 0.95;
      db.prepare(`
        INSERT INTO ml_signal_weights (signal_name, weight, wins, total)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(signal_name) DO UPDATE SET
          weight = MAX(0.1, MIN(3.0, weight * ?)),
          wins   = wins + ?,
          total  = total + 1,
          last_update = strftime('%s','now')
      `).run(
        s.name,
        Math.min(3.0, Math.max(0.1, 1.0 * boost)),
        won ? 1 : 0,
        boost,
        won ? 1 : 0
      );
    }
  } finally {
    db.close();
  }
}

// ─── Bootstrap simulation ─────────────────────────────────────────────────────
export interface BootstrapResult {
  mean: number;          // observed win rate
  ci_low: number;        // 2.5th percentile (95% CI lower bound)
  ci_high: number;       // 97.5th percentile (95% CI upper bound)
  n_trades: number;      // number of resolved trades used
  n_simulations: number; // always 10,000
  edge_confirmed: boolean; // true if ci_low > 0.55
}

export function runBootstrap(n = 10_000): BootstrapResult {
  const db = getDb();
  let outcomes: number[] = [];
  try {
    const rows = db.prepare(
      "SELECT outcome FROM ml_predictions WHERE outcome IS NOT NULL"
    ).all() as { outcome: number }[];
    outcomes = rows.map(r => r.outcome);
  } finally {
    db.close();
  }

  if (outcomes.length < 5) {
    return {
      mean: 0.5, ci_low: 0, ci_high: 1,
      n_trades: outcomes.length, n_simulations: n,
      edge_confirmed: false,
    };
  }

  const len = outcomes.length;
  const means: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < len; j++) {
      sum += outcomes[Math.floor(Math.random() * len)];
    }
    means[i] = sum / len;
  }
  means.sort((a, b) => a - b);

  const mean    = outcomes.reduce((s, v) => s + v, 0) / len;
  const ci_low  = means[Math.floor(n * 0.025)];
  const ci_high = means[Math.floor(n * 0.975)];

  return {
    mean, ci_low, ci_high,
    n_trades: len,
    n_simulations: n,
    edge_confirmed: ci_low > 0.55,
  };
}

// ─── Calibration data ─────────────────────────────────────────────────────────
/**
 * Calibration: group predictions by pred_q bucket (0.1 wide),
 * compute actual win rate per bucket.
 * A perfectly calibrated model has actual ≈ predicted.
 */
export interface CalibrationBucket {
  bucket_low: number;  // e.g. 0.5
  bucket_high: number; // e.g. 0.6
  predicted_mean: number;
  actual_rate: number;
  count: number;
}

export function getCalibrationData(): CalibrationBucket[] {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT pred_q, outcome
      FROM ml_predictions
      WHERE outcome IS NOT NULL
    `).all() as { pred_q: number; outcome: number }[];

    if (rows.length < 10) return [];

    const buckets: Record<number, { sum_pred: number; sum_out: number; count: number }> = {};
    for (const row of rows) {
      const b = Math.floor(row.pred_q * 10) / 10; // 0.0, 0.1, ..., 0.9
      if (!buckets[b]) buckets[b] = { sum_pred: 0, sum_out: 0, count: 0 };
      buckets[b].sum_pred += row.pred_q;
      buckets[b].sum_out  += row.outcome;
      buckets[b].count    += 1;
    }

    return Object.entries(buckets)
      .filter(([, v]) => v.count >= 3)
      .map(([k, v]) => ({
        bucket_low:     parseFloat(k),
        bucket_high:    parseFloat(k) + 0.1,
        predicted_mean: v.sum_pred / v.count,
        actual_rate:    v.sum_out  / v.count,
        count:          v.count,
      }))
      .sort((a, b) => a.bucket_low - b.bucket_low);
  } finally {
    db.close();
  }
}

// ─── ML Stats summary ─────────────────────────────────────────────────────────
export interface MLStats {
  total_predictions: number;
  resolved: number;
  pending: number;
  overall_win_rate: number;
  win_rate_by_mode: Record<string, { wins: number; total: number; rate: number }>;
  win_rate_by_asset: Record<string, { wins: number; total: number; rate: number }>;
  top_signals: Array<{ name: string; weight: number; accuracy: number; total: number }>;
  base_rates: Array<{ category: string; rate: number; total: number }>;
  bootstrap: BootstrapResult;
  calibration: CalibrationBucket[];
  avg_ev: number;
  avg_kelly: number;
}

export function getMLStats(): MLStats {
  const db = getDb();
  try {
    const allPreds = db.prepare(
      "SELECT * FROM ml_predictions"
    ).all() as any[];

    const resolved   = allPreds.filter(p => p.outcome !== null);
    const pending    = allPreds.filter(p => p.outcome === null);
    const wins       = resolved.filter(p => p.outcome === 1);
    const overall_wr = resolved.length > 0 ? wins.length / resolved.length : 0;

    // Win rate by mode
    const by_mode: Record<string, { wins: number; total: number; rate: number }> = {};
    for (const p of resolved) {
      if (!by_mode[p.mode]) by_mode[p.mode] = { wins: 0, total: 0, rate: 0 };
      by_mode[p.mode].total++;
      if (p.outcome === 1) by_mode[p.mode].wins++;
    }
    for (const m of Object.values(by_mode)) m.rate = m.total > 0 ? m.wins / m.total : 0;

    // Win rate by asset
    const by_asset: Record<string, { wins: number; total: number; rate: number }> = {};
    for (const p of resolved) {
      if (!by_asset[p.asset]) by_asset[p.asset] = { wins: 0, total: 0, rate: 0 };
      by_asset[p.asset].total++;
      if (p.outcome === 1) by_asset[p.asset].wins++;
    }
    for (const a of Object.values(by_asset)) a.rate = a.total > 0 ? a.wins / a.total : 0;

    // Top signals by weight
    const sigRows = db.prepare(
      "SELECT signal_name, weight, wins, total FROM ml_signal_weights ORDER BY weight DESC LIMIT 15"
    ).all() as any[];
    const top_signals = sigRows.map(s => ({
      name:     s.signal_name,
      weight:   Math.round(s.weight * 1000) / 1000,
      accuracy: s.total > 0 ? Math.round((s.wins / s.total) * 1000) / 1000 : 0.5,
      total:    s.total,
    }));

    // Base rates
    const brRows = db.prepare(
      "SELECT category, wins, total FROM ml_base_rates ORDER BY total DESC LIMIT 20"
    ).all() as any[];
    const base_rates = brRows.map(b => ({
      category: b.category,
      rate:     b.total > 0 ? Math.round((b.wins / b.total) * 1000) / 1000 : 0.5,
      total:    b.total,
    }));

    // Avg EV + Kelly
    const avg_ev    = resolved.length > 0
      ? resolved.reduce((s: number, p: any) => s + p.ev, 0) / resolved.length : 0;
    const avg_kelly = resolved.length > 0
      ? resolved.reduce((s: number, p: any) => s + p.kelly_f, 0) / resolved.length : 0;

    return {
      total_predictions: allPreds.length,
      resolved:          resolved.length,
      pending:           pending.length,
      overall_win_rate:  Math.round(overall_wr * 1000) / 1000,
      win_rate_by_mode:  by_mode,
      win_rate_by_asset: by_asset,
      top_signals,
      base_rates,
      bootstrap:         runBootstrap(),
      calibration:       getCalibrationData(),
      avg_ev:            Math.round(avg_ev * 10000) / 10000,
      avg_kelly:         Math.round(avg_kelly * 10000) / 10000,
    };
  } finally {
    db.close();
  }
}
