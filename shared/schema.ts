import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Bot configuration / settings
export const botSettings = sqliteTable("bot_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  alpacaApiKey: text("alpaca_api_key").notNull().default(""),
  alpacaApiSecret: text("alpaca_api_secret").notNull().default(""),
  polymarketWallet: text("polymarket_wallet").notNull().default(""),
  isRunning: integer("is_running", { mode: "boolean" }).notNull().default(false),
  betSize: real("bet_size").notNull().default(2),
  maxBetsPerDay: integer("max_bets_per_day").notNull().default(50),
  dailyStopLossPct: real("daily_stop_loss_pct").notNull().default(15),
  minEdgePct: real("min_edge_pct").notNull().default(3),
  totalBalance: real("total_balance").notNull().default(100),
  startingBalance: real("starting_balance").notNull().default(100),
});

// Individual trades placed by the bot
export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  market: text("market").notNull(),
  marketId: text("market_id").notNull(),
  direction: text("direction").notNull(),           // "BUY" | "SELL" | "YES" | "NO"
  betSize: real("bet_size").notNull(),
  entryOdds: real("entry_odds").notNull(),
  btcMomentum: real("btc_momentum").notNull(),
  edgeDetected: real("edge_detected").notNull(),
  status: text("status").notNull().default("open"), // "open" | "won" | "lost" | "pending" | "filled" | "rejected"
  pnl: real("pnl").notNull().default(0),
  // Alpaca order tracking
  alpacaOrderId: text("alpaca_order_id"),
  alpacaOrderStatus: text("alpaca_order_status"),   // "new" | "filled" | "canceled" | "rejected"
  fillPrice: real("fill_price"),
  fillQty: real("fill_qty"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
});

// Hourly PNL snapshots for charting
export const pnlSnapshots = sqliteTable("pnl_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  balance: real("balance").notNull(),
  pnl: real("pnl").notNull(),
  tradeCount: integer("trade_count").notNull().default(0),
  winRate: real("win_rate").notNull().default(0),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// BTC market data snapshots
export const btcPriceHistory = sqliteTable("btc_price_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  price: real("price").notNull(),
  change5m: real("change_5m").notNull().default(0),
  change15m: real("change_15m").notNull().default(0),
  momentum: text("momentum").notNull().default("neutral"),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Edge opportunities detected
export const edgeOpportunities = sqliteTable("edge_opportunities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  market: text("market").notNull(),
  marketId: text("market_id").notNull(),
  polyOdds: real("poly_odds").notNull(),
  impliedOdds: real("implied_odds").notNull(),
  edgePct: real("edge_pct").notNull(),
  direction: text("direction").notNull(),
  liquidity: real("liquidity").notNull(),
  status: text("status").notNull().default("detected"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// ─── Copy trading: wallets to copy ──────────────────────────────────────────
export const copiedWallets = sqliteTable("copied_wallets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  address: text("address").notNull().unique(),
  label: text("label").notNull().default(""),           // friendly name
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  copyPct: real("copy_pct").notNull().default(100),     // % of their bet size to mirror
  totalCopied: integer("total_copied").notNull().default(0), // # trades copied
  totalPnl: real("total_pnl").notNull().default(0),
  lastSeen: integer("last_seen", { mode: "timestamp" }),
  addedAt: integer("added_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Trades placed by the copy engine (mirroring a target wallet)
export const copyTrades = sqliteTable("copy_trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  walletId: integer("wallet_id").notNull(),             // FK → copied_wallets.id
  walletAddress: text("wallet_address").notNull(),
  market: text("market").notNull(),                     // market question
  marketId: text("market_id").notNull(),                // Polymarket condition_id
  tokenId: text("token_id").notNull(),                  // outcome token ID (CLOB)
  side: text("side").notNull(),                         // "BUY" | "SELL"
  outcome: text("outcome").notNull(),                   // "YES" | "NO"
  size: real("size").notNull(),                         // shares
  price: real("price").notNull(),                       // avg fill price
  usdcSpent: real("usdc_spent").notNull().default(0),
  status: text("status").notNull().default("pending"),  // "pending" | "filled" | "failed" | "skipped"
  polyOrderId: text("poly_order_id"),                   // Polymarket order ID
  errorMsg: text("error_msg"),
  pnl: real("pnl").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
});

// Insert schemas
export const insertBotSettingsSchema = createInsertSchema(botSettings).omit({ id: true });
export const insertTradeSchema = createInsertSchema(trades).omit({ id: true, createdAt: true });
export const insertPnlSnapshotSchema = createInsertSchema(pnlSnapshots).omit({ id: true, timestamp: true });
export const insertBtcPriceSchema = createInsertSchema(btcPriceHistory).omit({ id: true, timestamp: true });
export const insertEdgeOpportunitySchema = createInsertSchema(edgeOpportunities).omit({ id: true, createdAt: true });
export const insertCopiedWalletSchema = createInsertSchema(copiedWallets).omit({ id: true, addedAt: true });
export const insertCopyTradeSchema = createInsertSchema(copyTrades).omit({ id: true, createdAt: true });

// Types
export type BotSettings = typeof botSettings.$inferSelect;
export type InsertBotSettings = z.infer<typeof insertBotSettingsSchema>;
export type Trade = typeof trades.$inferSelect;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type PnlSnapshot = typeof pnlSnapshots.$inferSelect;
export type InsertPnlSnapshot = z.infer<typeof insertPnlSnapshotSchema>;
export type BtcPriceHistory = typeof btcPriceHistory.$inferSelect;
export type EdgeOpportunity = typeof edgeOpportunities.$inferSelect;
export type InsertEdgeOpportunity = z.infer<typeof insertEdgeOpportunitySchema>;
export type CopiedWallet = typeof copiedWallets.$inferSelect;
export type InsertCopiedWallet = z.infer<typeof insertCopiedWalletSchema>;
export type CopyTrade = typeof copyTrades.$inferSelect;
export type InsertCopyTrade = z.infer<typeof insertCopyTradeSchema>;
