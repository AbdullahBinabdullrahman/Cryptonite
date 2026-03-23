import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, desc, gte, and, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import {
  BotSettings, InsertBotSettings,
  Trade, InsertTrade,
  PnlSnapshot, InsertPnlSnapshot,
  BtcPriceHistory,
  EdgeOpportunity, InsertEdgeOpportunity,
  CopiedWallet, InsertCopiedWallet,
  CopyTrade, InsertCopyTrade,
} from "@shared/schema";
import path from "path";
import fs from "fs";

// ─── DB setup ────────────────────────────────────────────────────────────────
const DB_PATH = path.resolve(process.cwd(), "polybot.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");  // faster writes, safe concurrent reads
const db = drizzle(sqlite, { schema });

// ─── Bootstrap schema (run once on startup) ──────────────────────────────────
function initDb() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS bot_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alpaca_api_key TEXT NOT NULL DEFAULT '',
      alpaca_api_secret TEXT NOT NULL DEFAULT '',
      polymarket_wallet TEXT NOT NULL DEFAULT '',
      is_running INTEGER NOT NULL DEFAULT 0,
      bet_size REAL NOT NULL DEFAULT 2,
      max_bets_per_day INTEGER NOT NULL DEFAULT 50,
      daily_stop_loss_pct REAL NOT NULL DEFAULT 15,
      min_edge_pct REAL NOT NULL DEFAULT 3,
      total_balance REAL NOT NULL DEFAULT 100,
      starting_balance REAL NOT NULL DEFAULT 100
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market TEXT NOT NULL,
      market_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      bet_size REAL NOT NULL,
      entry_odds REAL NOT NULL,
      btc_momentum REAL NOT NULL,
      edge_detected REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      pnl REAL NOT NULL DEFAULT 0,
      log_return REAL,
      alpaca_order_id TEXT,
      alpaca_order_status TEXT,
      fill_price REAL,
      fill_qty REAL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS pnl_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      balance REAL NOT NULL,
      pnl REAL NOT NULL,
      trade_count INTEGER NOT NULL DEFAULT 0,
      win_rate REAL NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS btc_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price REAL NOT NULL,
      change_5m REAL NOT NULL DEFAULT 0,
      change_15m REAL NOT NULL DEFAULT 0,
      momentum TEXT NOT NULL DEFAULT 'neutral',
      timestamp INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS edge_opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market TEXT NOT NULL,
      market_id TEXT NOT NULL,
      poly_odds REAL NOT NULL,
      implied_odds REAL NOT NULL,
      edge_pct REAL NOT NULL,
      direction TEXT NOT NULL,
      liquidity REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'detected',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS copied_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      copy_pct REAL NOT NULL DEFAULT 100,
      total_copied INTEGER NOT NULL DEFAULT 0,
      total_pnl REAL NOT NULL DEFAULT 0,
      last_seen INTEGER,
      added_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS copy_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_id INTEGER NOT NULL,
      wallet_address TEXT NOT NULL,
      market TEXT NOT NULL,
      market_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      side TEXT NOT NULL,
      outcome TEXT NOT NULL,
      size REAL NOT NULL,
      price REAL NOT NULL,
      usdc_spent REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      poly_order_id TEXT,
      error_msg TEXT,
      pnl REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at INTEGER
    );
  `);

  // Ensure exactly one settings row exists
  const existing = sqlite.prepare("SELECT id FROM bot_settings LIMIT 1").get();
  if (!existing) {
    sqlite.prepare("INSERT INTO bot_settings DEFAULT VALUES").run();
  }

  // ── Safe migrations for existing DBs ──────────────────────────────────────
  // Add log_return column if missing (added in v4)
  try {
    sqlite.exec("ALTER TABLE trades ADD COLUMN log_return REAL");
    console.log("[DB] Migration: added log_return column to trades");
  } catch { /* column already exists — safe to ignore */ }
}

initDb();

// ─── Helper: map raw SQLite row timestamps ────────────────────────────────────
function toDate(val: any): Date {
  if (val instanceof Date) return val;
  if (typeof val === "number") return new Date(val * 1000);
  if (typeof val === "string") return new Date(val);
  return new Date();
}

function mapTrade(row: any): Trade {
  return {
    ...row,
    createdAt: toDate(row.createdAt),
    resolvedAt: row.resolvedAt ? toDate(row.resolvedAt) : null,
  };
}

function mapSnapshot(row: any): PnlSnapshot {
  return { ...row, timestamp: toDate(row.timestamp) };
}

function mapBtcPrice(row: any): BtcPriceHistory {
  return { ...row, timestamp: toDate(row.timestamp) };
}

function mapEdge(row: any): EdgeOpportunity {
  return { ...row, createdAt: toDate(row.createdAt) };
}

// ─── Row mappers for new tables ──────────────────────────────────────────────
function mapCopiedWallet(row: any): CopiedWallet {
  return {
    ...row,
    isActive: row.isActive === 1 || row.isActive === true,
    lastSeen: row.lastSeen ? toDate(row.lastSeen) : null,
    addedAt: toDate(row.addedAt),
  };
}

function mapCopyTrade(row: any): CopyTrade {
  return {
    ...row,
    createdAt: toDate(row.createdAt),
    resolvedAt: row.resolvedAt ? toDate(row.resolvedAt) : null,
  };
}

// ─── Storage interface ────────────────────────────────────────────────────────
export interface IStorage {
  getBotSettings(): Promise<BotSettings>;
  updateBotSettings(settings: Partial<InsertBotSettings>): Promise<BotSettings>;

  getTrades(limit?: number): Promise<Trade[]>;
  getTradesSince(since: Date): Promise<Trade[]>;
  getOpenTrades(): Promise<Trade[]>;
  createTrade(trade: InsertTrade): Promise<Trade>;
  resolveTrade(id: number, status: "won" | "lost", pnl: number): Promise<Trade>;
  updateTradeAlpacaOrder(id: number, orderId: string, orderStatus: string, fillPrice?: number, fillQty?: number): Promise<void>;
  getTodayTradeCount(): Promise<number>;
  getTodayWinRate(): Promise<{ wins: number; total: number; rate: number }>;
  getTodayPnl(): Promise<number>;

  getPnlSnapshots(limit?: number): Promise<PnlSnapshot[]>;
  createPnlSnapshot(snapshot: InsertPnlSnapshot): Promise<PnlSnapshot>;

  getLatestBtcPrice(): Promise<BtcPriceHistory | null>;
  createBtcPrice(data: { price: number; change5m: number; change15m: number; momentum: string }): Promise<BtcPriceHistory>;

  getEdgeOpportunities(limit?: number): Promise<EdgeOpportunity[]>;
  createEdgeOpportunity(opp: InsertEdgeOpportunity): Promise<EdgeOpportunity>;
  updateEdgeOpportunityStatus(id: number, status: string): Promise<void>;

  // Copy trading
  getCopiedWallets(): Promise<CopiedWallet[]>;
  getCopiedWallet(id: number): Promise<CopiedWallet | null>;
  addCopiedWallet(wallet: InsertCopiedWallet): Promise<CopiedWallet>;
  updateCopiedWallet(id: number, updates: Partial<InsertCopiedWallet>): Promise<CopiedWallet>;
  deleteCopiedWallet(id: number): Promise<void>;
  getCopyTrades(limit?: number): Promise<CopyTrade[]>;
  getCopyTradesByWallet(walletId: number, limit?: number): Promise<CopyTrade[]>;
  createCopyTrade(trade: InsertCopyTrade): Promise<CopyTrade>;
  updateCopyTrade(id: number, updates: Partial<InsertCopyTrade>): Promise<void>;
  isTradeCopied(walletId: number, marketId: string, side: string, timestamp: string): Promise<boolean>;
}

// ─── SQLite implementation ────────────────────────────────────────────────────
class SqliteStorage implements IStorage {

  async getBotSettings(): Promise<BotSettings> {
    const rows = db.select().from(schema.botSettings).limit(1).all();
    return rows[0] as BotSettings;
  }

  async updateBotSettings(updates: Partial<InsertBotSettings>): Promise<BotSettings> {
    await db.update(schema.botSettings).set(updates).where(eq(schema.botSettings.id, 1));
    return this.getBotSettings();
  }

  async getTrades(limit = 50): Promise<Trade[]> {
    const rows = db.select().from(schema.trades)
      .orderBy(desc(schema.trades.createdAt))
      .limit(limit)
      .all();
    return rows.map(mapTrade);
  }

  async getTradesSince(since: Date): Promise<Trade[]> {
    const rows = db.select().from(schema.trades)
      .where(gte(schema.trades.createdAt, since))
      .all();
    return rows.map(mapTrade);
  }

  async getOpenTrades(): Promise<Trade[]> {
    const rows = db.select().from(schema.trades)
      .where(eq(schema.trades.status, "open"))
      .all();
    return rows.map(mapTrade);
  }

  async createTrade(trade: InsertTrade): Promise<Trade> {
    const result = db.insert(schema.trades).values(trade).returning().get();
    return mapTrade(result);
  }

  async resolveTrade(id: number, status: "won" | "lost", pnl: number): Promise<Trade> {
    const resolvedAt = Math.floor(Date.now() / 1000);
    // Calculate log return: r = ln(final / initial)
    // final = betSize + pnl, initial = betSize
    const trade = db.select().from(schema.trades).where(eq(schema.trades.id, id)).get();
    let logReturn: number | null = null;
    const betSz = (trade as any)?.bet_size ?? (trade as any)?.betSize ?? 0;
    if (betSz > 0) {
      const finalValue = betSz + pnl;
      logReturn = finalValue > 0 ? Math.round(Math.log(finalValue / betSz) * 10000) / 10000 : null;
    }
    db.update(schema.trades)
      .set({ status, pnl, logReturn, resolvedAt: new Date() })
      .where(eq(schema.trades.id, id))
      .run();

    // Update account balance
    const settings = await this.getBotSettings();
    await this.updateBotSettings({ totalBalance: Math.round((settings.totalBalance + pnl) * 100) / 100 });

    const row = db.select().from(schema.trades).where(eq(schema.trades.id, id)).get();
    return mapTrade(row);
  }

  async updateTradeAlpacaOrder(id: number, orderId: string, orderStatus: string, fillPrice?: number, fillQty?: number): Promise<void> {
    db.update(schema.trades)
      .set({
        alpacaOrderId: orderId,
        alpacaOrderStatus: orderStatus,
        ...(fillPrice !== undefined ? { fillPrice } : {}),
        ...(fillQty !== undefined ? { fillQty } : {}),
      })
      .where(eq(schema.trades.id, id))
      .run();
  }

  async getTodayTradeCount(): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const rows = db.select().from(schema.trades)
      .where(gte(schema.trades.createdAt, todayStart))
      .all();
    return rows.length;
  }

  async getTodayWinRate(): Promise<{ wins: number; total: number; rate: number }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const rows = db.select().from(schema.trades)
      .where(and(
        gte(schema.trades.createdAt, todayStart),
        sql`${schema.trades.status} != 'open'`
      ))
      .all();
    const wins = rows.filter((t: any) => t.status === "won").length;
    const total = rows.length;
    return { wins, total, rate: total > 0 ? Math.round((wins / total) * 100) / 100 : 0 };
  }

  async getTodayPnl(): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const rows = db.select().from(schema.trades)
      .where(gte(schema.trades.createdAt, todayStart))
      .all() as any[];
    const total = rows.reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
    return Math.round(total * 100) / 100;
  }

  async getPnlSnapshots(limit = 30): Promise<PnlSnapshot[]> {
    const rows = db.select().from(schema.pnlSnapshots)
      .orderBy(schema.pnlSnapshots.timestamp)
      .all();
    return rows.map(mapSnapshot).slice(-limit);
  }

  async createPnlSnapshot(snapshot: InsertPnlSnapshot): Promise<PnlSnapshot> {
    const result = db.insert(schema.pnlSnapshots).values(snapshot).returning().get();
    return mapSnapshot(result);
  }

  async getLatestBtcPrice(): Promise<BtcPriceHistory | null> {
    const row = db.select().from(schema.btcPriceHistory)
      .orderBy(desc(schema.btcPriceHistory.timestamp))
      .limit(1)
      .get();
    return row ? mapBtcPrice(row) : null;
  }

  async createBtcPrice(data: { price: number; change5m: number; change15m: number; momentum: string }): Promise<BtcPriceHistory> {
    const result = db.insert(schema.btcPriceHistory).values(data).returning().get();
    // Keep only last 500 BTC price rows
    sqlite.prepare(`
      DELETE FROM btc_price_history WHERE id NOT IN (
        SELECT id FROM btc_price_history ORDER BY id DESC LIMIT 500
      )
    `).run();
    return mapBtcPrice(result);
  }

  async getEdgeOpportunities(limit = 20): Promise<EdgeOpportunity[]> {
    const rows = db.select().from(schema.edgeOpportunities)
      .orderBy(desc(schema.edgeOpportunities.createdAt))
      .limit(limit)
      .all();
    return rows.map(mapEdge);
  }

  async createEdgeOpportunity(opp: InsertEdgeOpportunity): Promise<EdgeOpportunity> {
    const result = db.insert(schema.edgeOpportunities).values(opp).returning().get();
    return mapEdge(result);
  }

  async updateEdgeOpportunityStatus(id: number, status: string): Promise<void> {
    db.update(schema.edgeOpportunities)
      .set({ status })
      .where(eq(schema.edgeOpportunities.id, id))
      .run();
  }

  // ─── Copy trading ───────────────────────────────────────────────────────

  async getCopiedWallets(): Promise<CopiedWallet[]> {
    const rows = db.select().from(schema.copiedWallets)
      .orderBy(desc(schema.copiedWallets.addedAt))
      .all();
    return rows.map(mapCopiedWallet);
  }

  async getCopiedWallet(id: number): Promise<CopiedWallet | null> {
    const row = db.select().from(schema.copiedWallets)
      .where(eq(schema.copiedWallets.id, id))
      .get();
    return row ? mapCopiedWallet(row) : null;
  }

  async addCopiedWallet(wallet: InsertCopiedWallet): Promise<CopiedWallet> {
    const result = db.insert(schema.copiedWallets).values(wallet).returning().get();
    return mapCopiedWallet(result);
  }

  async updateCopiedWallet(id: number, updates: Partial<InsertCopiedWallet>): Promise<CopiedWallet> {
    db.update(schema.copiedWallets).set(updates).where(eq(schema.copiedWallets.id, id)).run();
    return (await this.getCopiedWallet(id))!;
  }

  async deleteCopiedWallet(id: number): Promise<void> {
    db.delete(schema.copiedWallets).where(eq(schema.copiedWallets.id, id)).run();
  }

  async getCopyTrades(limit = 100): Promise<CopyTrade[]> {
    const rows = db.select().from(schema.copyTrades)
      .orderBy(desc(schema.copyTrades.createdAt))
      .limit(limit)
      .all();
    return rows.map(mapCopyTrade);
  }

  async getCopyTradesByWallet(walletId: number, limit = 50): Promise<CopyTrade[]> {
    const rows = db.select().from(schema.copyTrades)
      .where(eq(schema.copyTrades.walletId, walletId))
      .orderBy(desc(schema.copyTrades.createdAt))
      .limit(limit)
      .all();
    return rows.map(mapCopyTrade);
  }

  async createCopyTrade(trade: InsertCopyTrade): Promise<CopyTrade> {
    const result = db.insert(schema.copyTrades).values(trade).returning().get();
    return mapCopyTrade(result);
  }

  async updateCopyTrade(id: number, updates: Partial<InsertCopyTrade>): Promise<void> {
    db.update(schema.copyTrades).set(updates).where(eq(schema.copyTrades.id, id)).run();
  }

  async isTradeCopied(walletId: number, marketId: string, side: string, timestamp: string): Promise<boolean> {
    // Check if we've already copied this exact trade (dedup by wallet+market+side within 5 min window)
    const windowStart = new Date(new Date(timestamp).getTime() - 5 * 60 * 1000);
    const rows = db.select().from(schema.copyTrades)
      .where(and(
        eq(schema.copyTrades.walletId, walletId),
        eq(schema.copyTrades.marketId, marketId),
        eq(schema.copyTrades.side, side),
        gte(schema.copyTrades.createdAt, windowStart)
      ))
      .all();
    return rows.length > 0;
  }
}

export const storage = new SqliteStorage();
