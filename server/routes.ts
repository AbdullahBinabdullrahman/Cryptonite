import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertBotSettingsSchema, insertTradeSchema } from "@shared/schema";
import { startBotEngine, stopBotEngine } from "./botEngine";
import { startCopyEngine, syncWalletNow } from "./copyEngine";
import { startClobStrategy, stopClobStrategy, getClobSnapshot } from "./clobStrategy";
import { fetchAlpacaAccount } from "./alpacaClient";
import { fetchOrderStatus } from "./alpacaOrders";
import { fetchWalletPositions } from "./polymarketClient";
import {
  sendOtpEmail, verifyOtp, verifyTotp,
  generateTotpSetup, enableTotp, getUserById, requireAuth
} from "./auth";
import { z } from "zod";
import { insertCopiedWalletSchema } from "@shared/schema";

// Start engines on server boot
startBotEngine();
startCopyEngine();
startClobStrategy();

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ─── Auth Routes ──────────────────────────────────────────────────────────

  // Check session
  app.get("/api/auth/me", (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ loggedIn: false });
    const user = getUserById(userId);
    if (!user) return res.status(401).json({ loggedIn: false });
    res.json({ loggedIn: true, email: user.email, totpEnabled: !!user.totp_enabled });
  });

  // Send email OTP
  app.post("/api/auth/send-otp", async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email required" });
    const result = await sendOtpEmail(email.toLowerCase().trim());
    if (!result.ok) return res.status(400).json({ error: result.error });
    // In dev mode, return the preview URL so user can see the code
    res.json({ ok: true, previewUrl: result.previewUrl || null });
  });

  // Verify OTP or TOTP token
  app.post("/api/auth/verify", (req, res) => {
    const { email, code, totpToken } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email required" });

    let result: { ok: boolean; userId?: number; error?: string };

    if (totpToken) {
      // TOTP path (Google Authenticator)
      result = verifyTotp(email.toLowerCase().trim(), String(totpToken));
    } else if (code) {
      // Email OTP path
      result = verifyOtp(email.toLowerCase().trim(), String(code));
    } else {
      return res.status(400).json({ error: "code or totpToken required" });
    }

    if (!result.ok) return res.status(401).json({ error: result.error });

    // Set session
    (req.session as any).userId = result.userId;
    req.session.save(() => {
      const user = getUserById(result.userId!);
      res.json({ ok: true, email: user.email, totpEnabled: !!user.totp_enabled });
    });
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  // TOTP setup — get QR code
  app.get("/api/auth/totp-setup", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not logged in" });
    const result = await generateTotpSetup(userId);
    if (!result.ok) return res.status(500).json({ error: result.error });
    res.json({ secret: result.secret, qrDataUrl: result.qrDataUrl });
  });

  // TOTP enable — verify first token
  app.post("/api/auth/totp-enable", (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not logged in" });
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "Token required" });
    const result = enableTotp(userId, String(token));
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, message: "TOTP enabled — use authenticator app to log in next time" });
  });

  // ─── Bot Settings ─────────────────────────────────────────────────────────
  app.get("/api/settings", async (_req, res) => {
    const settings = await storage.getBotSettings();
    // Mask secrets
    const masked = {
      ...settings,
      alpacaApiSecret: settings.alpacaApiSecret ? "••••••••••••" : "",
    };
    res.json(masked);
  });

  app.patch("/api/settings", async (req, res) => {
    try {
      const partial = insertBotSettingsSchema.partial().parse(req.body);
      const updated = await storage.updateBotSettings(partial);

      // If API keys were just provided, sync real balance from Alpaca
      const currentSettings = await storage.getBotSettings();
      const keyToUse = partial.alpacaApiKey || currentSettings.alpacaApiKey;
      const secretToUse = partial.alpacaApiSecret || currentSettings.alpacaApiSecret;

      if (keyToUse && secretToUse) {
        try {
          const result = await fetchAlpacaAccount(keyToUse, secretToUse);
          if (result.ok && result.account) {
            const portfolioValue = parseFloat(result.account.portfolio_value);
            const cash = parseFloat(result.account.cash);
            const realBalance = portfolioValue > 0 ? portfolioValue : cash;
            if (realBalance > 0) {
              await storage.updateBotSettings({
                totalBalance: realBalance,
                startingBalance: realBalance,
              });
            }
          }
        } catch (_) {
          // Don't fail the settings save if Alpaca sync fails
        }
      }

      const final = await storage.getBotSettings();
      res.json({
        ...final,
        alpacaApiSecret: final.alpacaApiSecret ? "••••••••••••" : "",
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Alpaca Account ───────────────────────────────────────────────────────
  app.get("/api/alpaca/account", async (_req, res) => {
    const settings = await storage.getBotSettings();
    if (!settings.alpacaApiKey || !settings.alpacaApiSecret) {
      return res.json({ ok: false, error: "No API credentials configured." });
    }
    const result = await fetchAlpacaAccount(settings.alpacaApiKey, settings.alpacaApiSecret);
    if (result.ok && result.account) {
      // Keep totalBalance in sync with real portfolio value
      const portfolioValue = parseFloat(result.account.portfolio_value);
      const cash = parseFloat(result.account.cash);
      const realBalance = portfolioValue > 0 ? portfolioValue : cash;
      if (realBalance > 0) {
        await storage.updateBotSettings({ totalBalance: realBalance });
      }
    }
    res.json(result);
  });

  // ─── Bot Control ──────────────────────────────────────────────────────────
  // ─── CLOB Strategy ────────────────────────────────────────────────────────

  app.get("/api/clob/markets", async (_req, res) => {
    try {
      const snapshot = await getClobSnapshot();
      res.json(snapshot);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/clob/start", async (_req, res) => {
    startClobStrategy();
    res.json({ ok: true, message: "CLOB strategy started" });
  });

  app.post("/api/clob/stop", async (_req, res) => {
    stopClobStrategy();
    res.json({ ok: true, message: "CLOB strategy stopped" });
  });

  // ─── Bot Controls ─────────────────────────────────────────────────────────

  app.post("/api/bot/start", async (_req, res) => {
    const settings = await storage.getBotSettings();
    if (!settings.alpacaApiKey) {
      return res.status(400).json({ error: "Please configure your Alpaca API keys first." });
    }
    await storage.updateBotSettings({ isRunning: true });
    startBotEngine();
    res.json({ isRunning: true });
  });

  app.post("/api/bot/stop", async (_req, res) => {
    await storage.updateBotSettings({ isRunning: false });
    res.json({ isRunning: false });
  });

  // ─── Dashboard Stats ──────────────────────────────────────────────────────
  app.get("/api/dashboard", async (_req, res) => {
    const [settings, todayPnl, winRate, todayCount, btcPrice, pnlSnapshots] = await Promise.all([
      storage.getBotSettings(),
      storage.getTodayPnl(),
      storage.getTodayWinRate(),
      storage.getTodayTradeCount(),
      storage.getLatestBtcPrice(),
      storage.getPnlSnapshots(30),
    ]);

    const totalReturn = settings.startingBalance > 0
      ? ((settings.totalBalance - settings.startingBalance) / settings.startingBalance) * 100
      : 0;

    res.json({
      totalBalance: settings.totalBalance,
      startingBalance: settings.startingBalance,
      totalReturn: Math.round(totalReturn * 100) / 100,
      todayPnl,
      winRate,
      todayCount,
      btcPrice,
      pnlHistory: pnlSnapshots,
      isRunning: settings.isRunning,
    });
  });

  // ─── Trades ───────────────────────────────────────────────────────────────
  app.post("/api/trades", async (req, res) => {
    try {
      const trade = insertTradeSchema.parse(req.body);
      const created = await storage.createTrade(trade);
      res.json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/trades", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const trades = await storage.getTrades(limit);
    res.json(trades);
  });

  // ─── Manual order status refresh ──────────────────────────────────────────
  app.post("/api/orders/sync", async (_req, res) => {
    try {
      const settings = await storage.getBotSettings();
      if (!settings.alpacaApiKey || !settings.alpacaApiSecret) {
        return res.json({ synced: 0, message: "No API keys" });
      }
      const openTrades = await storage.getOpenTrades();
      let synced = 0;
      for (const trade of openTrades) {
        if (!trade.alpacaOrderId) continue;
        const isLive = trade.alpacaOrderStatus?.startsWith("live:") ?? false;
        const result = await fetchOrderStatus(
          trade.alpacaOrderId,
          settings.alpacaApiKey,
          settings.alpacaApiSecret,
          isLive
        );
        if (result.ok && result.order) {
          const order = result.order;
          const statusPrefix = isLive ? "live:" : "paper:";
          await storage.updateTradeAlpacaOrder(
            trade.id, order.id, statusPrefix + order.status,
            order.filled_avg_price ? parseFloat(order.filled_avg_price) : undefined,
            order.filled_qty ? parseFloat(order.filled_qty) : undefined,
          );
          if (order.status === "filled" && order.filled_avg_price) {
            const fillPrice = parseFloat(order.filled_avg_price);
            const fillQty = parseFloat(order.filled_qty || "0");
            const notionalFilled = fillPrice * fillQty;
            const pnl = trade.direction === "YES"
              ? Math.round((notionalFilled - trade.betSize) * 100) / 100
              : Math.round((trade.betSize - notionalFilled) * 100) / 100;
            await storage.resolveTrade(trade.id, pnl >= 0 ? "won" : "lost", pnl);
          }
          synced++;
        }
      }
      res.json({ synced, message: `Synced ${synced} orders` });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Edge Opportunities ───────────────────────────────────────────────────
  app.get("/api/edges", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    const edges = await storage.getEdgeOpportunities(limit);
    res.json(edges);
  });

  // ─── BTC Price ───────────────────────────────────────────────────────
  app.get("/api/btc", async (_req, res) => {
    const price = await storage.getLatestBtcPrice();
    res.json(price);
  });

  // ─── Live prices for all 3 assets (CoinGecko primary, Binance fallback) ───
  app.get("/api/prices", async (_req, res) => {
    // Try CoinGecko first (works globally)
    async function geckoPrice(): Promise<{ BTC: number | null; ETH: number | null; SOL: number | null }> {
      try {
        const r = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd",
          { signal: AbortSignal.timeout(6000) }
        );
        if (!r.ok) return { BTC: null, ETH: null, SOL: null };
        const d = await r.json() as Record<string, { usd: number }>;
        return {
          BTC: d.bitcoin?.usd ?? null,
          ETH: d.ethereum?.usd ?? null,
          SOL: d.solana?.usd ?? null,
        };
      } catch { return { BTC: null, ETH: null, SOL: null }; }
    }
    // Binance fallback for individual asset
    async function binancePrice(symbol: string): Promise<number | null> {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return null;
        const d = await r.json() as { price?: string; code?: number };
        if (d.code) return null; // geo-blocked
        return parseFloat(d.price!);
      } catch { return null; }
    }
    // Kraken fallback
    async function krakenPrice(pair: string): Promise<number | null> {
      try {
        const r = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return null;
        const d = await r.json() as { result?: Record<string, { c: string[] }> };
        const key = Object.keys(d.result || {})[0];
        return key ? parseFloat(d.result![key].c[0]) : null;
      } catch { return null; }
    }

    // Try CoinGecko first
    const gecko = await geckoPrice();

    // For any null values, fallback to Binance then Kraken
    const btcFromDB = (await storage.getLatestBtcPrice())?.price ?? null;
    const btcFallback = gecko.BTC ?? (await binancePrice("BTCUSDT")) ?? (await krakenPrice("XBTUSD")) ?? btcFromDB;
    const ethFallback = gecko.ETH ?? (await binancePrice("ETHUSDT")) ?? (await krakenPrice("ETHUSD"));
    const solFallback = gecko.SOL ?? (await binancePrice("SOLUSDT")) ?? (await krakenPrice("SOLUSD"));

    res.json({
      BTC: btcFallback ? Math.round(btcFallback) : null,
      ETH: ethFallback ? Math.round(ethFallback * 100) / 100 : null,
      SOL: solFallback ? Math.round(solFallback * 100) / 100 : null,
      source: gecko.BTC ? "coingecko" : "fallback",
    });
  });

  // ─── Connection status (Alpaca + Polymarket health check) ────────────────
  app.get("/api/status", async (_req, res) => {
    const settings = await storage.getBotSettings();

    // Alpaca check
    let alpacaStatus: "connected" | "paper" | "disconnected" = "disconnected";
    let alpacaDetails: any = null;
    if (settings.alpacaApiKey && settings.alpacaApiSecret) {
      const result = await fetchAlpacaAccount(settings.alpacaApiKey, settings.alpacaApiSecret);
      if (result.ok && result.account) {
        alpacaStatus = result.isLive ? "connected" : "paper";
        alpacaDetails = {
          portfolio: parseFloat(result.account.portfolio_value || "0"),
          cash: parseFloat(result.account.cash || "0"),
          buyingPower: parseFloat(result.account.buying_power || "0"),
          equity: parseFloat(result.account.equity || "0"),
          accountNumber: result.account.account_number,
          accountStatus: result.account.status,
          cryptoStatus: result.account.crypto_status,
        };
      }
    }

    // Polymarket check — try to reach CLOB API
    let polyStatus: "connected" | "disconnected" | "no_key" = "no_key";
    let polyDetails: any = null;
    const privateKey = process.env.POLY_PRIVATE_KEY;
    const funderAddress = process.env.POLY_FUNDER_ADDRESS;
    if (privateKey && funderAddress) {
      try {
        const r = await fetch("https://clob.polymarket.com/", { signal: AbortSignal.timeout(5000) });
        polyStatus = r.ok ? "connected" : "disconnected";
        polyDetails = { funder: funderAddress.slice(0, 6) + "…" + funderAddress.slice(-4) };
      } catch {
        polyStatus = "disconnected";
      }
    }

    res.json({
      alpaca: { status: alpacaStatus, details: alpacaDetails },
      polymarket: { status: polyStatus, details: polyDetails },
      bot: { running: settings.isRunning, todayCount: 0 },
      timestamp: new Date().toISOString(),
    });
  });

  // ─── Markets (BTC + ETH + SOL) ──────────────────────────────────────────────────
  app.get("/api/markets", async (_req, res) => {
    const markets = [
      // BTC
      { id: "btc-15m",       name: "Will BTC be higher in 15 min?",     yesOdds: 0.47, noOdds: 0.53, volume: 47200,  timeLeft: "12m",    liquidity: 47200,  category: "btc" },
      { id: "btc-1h",        name: "Will BTC be higher in 1 hour?",      yesOdds: 0.51, noOdds: 0.49, volume: 93100,  timeLeft: "48m",    liquidity: 93100,  category: "btc" },
      { id: "btc-83k-today", name: "Will BTC close above $83k today?",   yesOdds: 0.61, noOdds: 0.39, volume: 34000,  timeLeft: "6h",     liquidity: 34000,  category: "btc" },
      { id: "btc-84k-2h",    name: "Will BTC be above $84k in 2 hours?", yesOdds: 0.38, noOdds: 0.62, volume: 21500,  timeLeft: "1h 44m", liquidity: 21500,  category: "btc" },
      { id: "btc-85k-week",  name: "Will BTC hit $85k this week?",       yesOdds: 0.44, noOdds: 0.56, volume: 128000, timeLeft: "3d",     liquidity: 128000, category: "btc" },
      { id: "btc-1pct-1h",   name: "Will BTC gain 1%+ this hour?",       yesOdds: 0.29, noOdds: 0.71, volume: 18000,  timeLeft: "52m",    liquidity: 18000,  category: "btc" },
      // ETH
      { id: "eth-15m",       name: "Will ETH be higher in 15 min?",      yesOdds: 0.48, noOdds: 0.52, volume: 32000,  timeLeft: "12m",    liquidity: 32000,  category: "eth" },
      { id: "eth-1h",        name: "Will ETH be higher in 1 hour?",       yesOdds: 0.50, noOdds: 0.50, volume: 61000,  timeLeft: "48m",    liquidity: 61000,  category: "eth" },
      { id: "eth-2k-today",  name: "Will ETH close above $2k today?",     yesOdds: 0.55, noOdds: 0.45, volume: 28000,  timeLeft: "6h",     liquidity: 28000,  category: "eth" },
      { id: "eth-3k-week",   name: "Will ETH hit $3k this week?",         yesOdds: 0.22, noOdds: 0.78, volume: 54000,  timeLeft: "3d",     liquidity: 54000,  category: "eth" },
      { id: "eth-1pct-1h",   name: "Will ETH gain 1%+ this hour?",        yesOdds: 0.31, noOdds: 0.69, volume: 14000,  timeLeft: "52m",    liquidity: 14000,  category: "eth" },
      { id: "eth-2pct-day",  name: "Will ETH gain 2%+ today?",            yesOdds: 0.40, noOdds: 0.60, volume: 19000,  timeLeft: "6h",     liquidity: 19000,  category: "eth" },
      // SOL
      { id: "sol-15m",       name: "Will SOL be higher in 15 min?",       yesOdds: 0.49, noOdds: 0.51, volume: 18000,  timeLeft: "12m",    liquidity: 18000,  category: "sol" },
      { id: "sol-1h",        name: "Will SOL be higher in 1 hour?",        yesOdds: 0.52, noOdds: 0.48, volume: 37000,  timeLeft: "48m",    liquidity: 37000,  category: "sol" },
      { id: "sol-130-today", name: "Will SOL close above $130 today?",     yesOdds: 0.43, noOdds: 0.57, volume: 15000,  timeLeft: "6h",     liquidity: 15000,  category: "sol" },
      { id: "sol-150-week",  name: "Will SOL hit $150 this week?",         yesOdds: 0.35, noOdds: 0.65, volume: 42000,  timeLeft: "3d",     liquidity: 42000,  category: "sol" },
      { id: "sol-2pct-1h",   name: "Will SOL gain 2%+ this hour?",         yesOdds: 0.26, noOdds: 0.74, volume: 11000,  timeLeft: "52m",    liquidity: 11000,  category: "sol" },
      { id: "sol-5pct-day",  name: "Will SOL gain 5%+ today?",             yesOdds: 0.18, noOdds: 0.82, volume: 9000,   timeLeft: "6h",     liquidity: 9000,   category: "sol" },
    ];
    res.json(markets);
  });

  // Live Polymarket markets from CLOB
  app.get("/api/markets/live", async (_req, res) => {
    try {
      const snapshot = await getClobSnapshot();
      res.json(snapshot.markets);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Copy Trading ───────────────────────────────────────────────────────

  // List all copied wallets
  app.get("/api/copy/wallets", async (_req, res) => {
    const wallets = await storage.getCopiedWallets();
    res.json(wallets);
  });

  // Add a wallet to copy
  app.post("/api/copy/wallets", async (req, res) => {
    try {
      const body = insertCopiedWalletSchema.parse(req.body);
      const wallet = await storage.addCopiedWallet(body);
      res.json(wallet);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Update wallet settings (label, copyPct, isActive)
  app.patch("/api/copy/wallets/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
      const updates = insertCopiedWalletSchema.partial().parse(req.body);
      const wallet = await storage.updateCopiedWallet(id, updates);
      res.json(wallet);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Delete a wallet
  app.delete("/api/copy/wallets/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteCopiedWallet(id);
    res.json({ ok: true });
  });

  // Fetch live Polymarket positions for a wallet
  app.get("/api/copy/wallets/:address/positions", async (req, res) => {
    try {
      const positions = await fetchWalletPositions(req.params.address);
      res.json(positions);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Manual sync a wallet now
  app.post("/api/copy/wallets/:id/sync", async (req, res) => {
    const id = parseInt(req.params.id);
    const result = await syncWalletNow(id);
    res.json(result);
  });

  // All copy trades
  app.get("/api/copy/trades", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const walletId = req.query.walletId ? parseInt(req.query.walletId as string) : undefined;
    const trades = walletId
      ? await storage.getCopyTradesByWallet(walletId, limit)
      : await storage.getCopyTrades(limit);
    res.json(trades);
  });

  // Summary stats for copy trading
  app.get("/api/copy/stats", async (_req, res) => {
    const [wallets, trades] = await Promise.all([
      storage.getCopiedWallets(),
      storage.getCopyTrades(500),
    ]);
    const totalCopied = trades.length;
    const filled = trades.filter(t => t.status === "filled").length;
    const failed = trades.filter(t => t.status === "failed").length;
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const totalSpent = trades.filter(t => t.status === "filled").reduce((s, t) => s + t.usdcSpent, 0);
    res.json({
      totalWallets: wallets.length,
      activeWallets: wallets.filter(w => w.isActive).length,
      totalCopied,
      filled,
      failed,
      totalPnl: Math.round(totalPnl * 100) / 100,
      totalSpent: Math.round(totalSpent * 100) / 100,
    });
  });

  // ── Self-ping to prevent Render free tier from sleeping ─────────────────────
  // Pings itself every 14 minutes so the service never idles out
  if (process.env.NODE_ENV === "production" && process.env.RENDER_EXTERNAL_URL) {
    const selfUrl = `${process.env.RENDER_EXTERNAL_URL}/api/dashboard`;
    setInterval(async () => {
      try {
        await fetch(selfUrl, { signal: AbortSignal.timeout(5000) });
      } catch { /* silent — just keeping awake */ }
    }, 14 * 60 * 1000); // every 14 minutes
    console.log(`[KeepAlive] Self-ping active → ${selfUrl}`);
  }

  return httpServer;
}
