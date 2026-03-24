import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertBotSettingsSchema, insertTradeSchema } from "@shared/schema";
import { startBotEngine, stopBotEngine, getLiveStrategyState } from "./botEngine";
import { startCopyEngine, syncWalletNow } from "./copyEngine";
import { startClobStrategy, stopClobStrategy, getClobSnapshot } from "./clobStrategy";
import { fetchAlpacaAccount, fetchAlpacaPositions } from "./alpacaClient";
import { fetchOrderStatus } from "./alpacaOrders";
import { fetchWalletPositions } from "./polymarketClient";
import {
  sendOtpEmail, verifyOtp, verifyTotp,
  generateTotpSetup, enableTotp, getUserById, requireAuth,
  setUserPassword, verifyPassword, issueToken, getUserIdFromRequest, setAuthCookie,
} from "./auth";
import { z } from "zod";
import { getMLStats } from "./mlEngine";
import { insertCopiedWalletSchema } from "@shared/schema";
import { getTopWallets, getWalletProfile, getMergedPositions } from "./walletLeaderboard";

// Start engines on server boot
startBotEngine();
startCopyEngine();
// CLOB enabled — wallet 0xeb0ad9B38733D5e7A51F1120d2d2e63055aAC3Af is funded
startClobStrategy();

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ─── Auth Routes ──────────────────────────────────────────────────────────

  // Check session
  app.get("/api/auth/me", (req, res) => {
    const userId = getUserIdFromRequest(req);
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

    // Set session + issue JWT
    (req.session as any).userId = result.userId;
    req.session.save(() => {
      const user = getUserById(result.userId!);
      const token = issueToken(result.userId!);
      setAuthCookie(res, token);
      res.json({ ok: true, email: user.email, totpEnabled: !!user.totp_enabled, token });
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

  // Password login — POST /api/auth/login { email, password }
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const result = await verifyPassword(email.toLowerCase().trim(), String(password));
    if (!result.ok) return res.status(401).json({ error: result.error });
    if (result.totpEnabled) {
      // Has TOTP — return partial flag, don't create session yet
      return res.json({ ok: true, totpRequired: true, email: email.toLowerCase().trim() });
    }
    (req.session as any).userId = result.userId;
    req.session.save(() => {
      const user = getUserById(result.userId!);
      const token = issueToken(result.userId!);
      setAuthCookie(res, token);
      res.json({ ok: true, email: user.email, totpEnabled: false, token });
    });
  });

  // Set/change password — POST /api/auth/set-password { email, password }
  // Must be called while authenticated (owner only for now)
  app.post("/api/auth/set-password", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    const result = await setUserPassword(email.toLowerCase().trim(), String(password));
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, message: "Password updated" });
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

  // ─── Portfolio ────────────────────────────────────────────────────────────
  // GET /api/portfolio — Alpaca positions + bot trade P&L summary
  app.get("/api/portfolio", async (_req, res) => {
    const settings = await storage.getBotSettings();

    // 1. Alpaca live positions
    let alpacaPositions: any[] = [];
    let isLive = false;
    if (settings.alpacaApiKey && settings.alpacaApiSecret) {
      const r = await fetchAlpacaPositions(settings.alpacaApiKey, settings.alpacaApiSecret);
      if (r.ok && r.positions) {
        alpacaPositions = r.positions;
        isLive = r.isLive ?? false;
      }
    }

    // 2. Bot trade summary — group open trades by market, compute avg entry & unrealized P&L
    const allTrades = await storage.getTrades(10000);
    const openTrades = allTrades.filter(t => t.status === "open" || t.status === "clob:placed" || t.status === "clob:simulated" || t.status === "pending" || t.status === "filled");
    const resolvedTrades = allTrades.filter(t => t.status === "won" || t.status === "lost");

    // Group open trades by market question
    const byMarket: Record<string, typeof openTrades> = {};
    for (const t of openTrades) {
      const key = t.market || t.marketId;
      if (!byMarket[key]) byMarket[key] = [];
      byMarket[key].push(t);
    }

    const openPositions = Object.entries(byMarket).map(([market, trades]) => {
      const totalInvested = trades.reduce((s, t) => s + t.betSize, 0);
      const avgEntry = trades.reduce((s, t) => s + t.entryOdds, 0) / trades.length;
      const direction = trades[0].direction;
      const latestTs = trades.reduce((max, t) => Math.max(max, new Date(t.createdAt).getTime()), 0);
      return {
        market,
        direction,
        tradeCount: trades.length,
        totalInvested: Math.round(totalInvested * 100) / 100,
        avgEntryPrice: Math.round(avgEntry * 1000) / 1000,
        unrealizedPnl: 0, // resolved at settlement
        openedAt: new Date(latestTs).toISOString(),
      };
    });

    // 3. Resolved P&L summary
    const totalRealized = resolvedTrades.reduce((s, t) => s + t.pnl, 0);
    const won  = resolvedTrades.filter(t => t.status === "won").length;
    const lost = resolvedTrades.filter(t => t.status === "lost").length;

    // 4. Cumulative log return: sum of all ln(final/initial) per resolved trade
    const resolvedWithLog = resolvedTrades.filter(t => t.logReturn != null && isFinite(t.logReturn as number));
    const cumulativeLogReturn = resolvedWithLog.reduce((s, t) => s + (t.logReturn as number), 0);
    // Convert to compound return %: (e^sum - 1) * 100
    const compoundReturnPct = Math.round((Math.exp(cumulativeLogReturn) - 1) * 10000) / 100;

    // 5. All-time P&L by day (for sparkline)
    const byDay: Record<string, number> = {};
    for (const t of resolvedTrades) {
      if (!t.resolvedAt) continue;
      const day = new Date(t.resolvedAt).toISOString().slice(0, 10);
      byDay[day] = (byDay[day] ?? 0) + t.pnl;
    }
    const pnlByDay = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, pnl]) => ({ date, pnl: Math.round(pnl * 100) / 100 }));

    // 6. CLOB / Polymarket trades (identified by Polymarket market names)
    const clobTrades = allTrades
      .filter(t => t.market?.toLowerCase().includes("up or down") || t.market?.toLowerCase().includes("polymarket") || (t.alpacaOrderId && t.alpacaOrderId.startsWith("0x")))
      .slice(-50)
      .reverse()
      .map(t => ({
        id: t.id,
        market: t.market,
        direction: t.direction,
        betSize: t.betSize,
        entryOdds: t.entryOdds,
        edge: t.edgeDetected,
        status: t.status,
        pnl: t.pnl,
        logReturn: t.logReturn ?? null,
        createdAt: t.createdAt,
        resolvedAt: t.resolvedAt,
      }));

    res.json({
      alpaca: {
        positions: alpacaPositions,
        isLive,
        count: alpacaPositions.length,
      },
      bot: {
        openPositions,
        openCount: openPositions.length,
        totalInvested: openPositions.reduce((s, p) => s + p.totalInvested, 0),
        resolvedCount: resolvedTrades.length,
        totalRealizedPnl: Math.round(totalRealized * 100) / 100,
        won,
        lost,
        winRate: resolvedTrades.length > 0 ? Math.round((won / resolvedTrades.length) * 1000) / 10 : 0,
        pnlByDay,
        cumulativeLogReturn: Math.round(cumulativeLogReturn * 10000) / 10000,
        compoundReturnPct,
      },
      clob: {
        trades: clobTrades,
        count: clobTrades.length,
        totalPnl: Math.round(clobTrades.filter(t => t.status === "won" || t.status === "lost").reduce((s, t) => s + t.pnl, 0) * 100) / 100,
      },
      account: {
        totalBalance: settings.totalBalance,
        startingBalance: settings.startingBalance,
        allTimePnl: Math.round((settings.totalBalance - settings.startingBalance) * 100) / 100,
      },
    });
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

  // Debug: test Polymarket CLOB auth (does NOT place a real order)
  app.get("/api/clob/test-auth", requireAuth, async (req: any, res) => {
    try {
      const { Wallet } = await import("ethers");
      const pk = process.env.POLY_PRIVATE_KEY || "";
      if (!pk) return res.json({ ok: false, error: "POLY_PRIVATE_KEY not set in env" });
      const pkNorm = pk.startsWith("0x") ? pk : "0x" + pk;
      const wallet = new Wallet(pkNorm);
      const addr = wallet.address;
      const funder = process.env.POLY_FUNDER_ADDRESS || "";
      // For Polymarket proxy wallets: signer (0x4E23) != funder (0xeb0a) — that's expected
      // The signer key authenticates on behalf of the funder address
      const match = true; // proxy wallet pattern: signer != funder is intentional

      // Try L1 auth
      const ts = Math.floor(Date.now() / 1000);
      const domain = { name: "ClobAuthDomain", version: "1", chainId: 137 };
      const types = { ClobAuth: [
        { name: "address", type: "address" }, { name: "timestamp", type: "string" },
        { name: "nonce", type: "uint256" }, { name: "message", type: "string" },
      ] };
      const sig = await wallet.signTypedData(domain, types, {
        address: addr, timestamp: String(ts), nonce: 0,
        message: "This message attests that I control the given wallet",
      });

      const authRes = await fetch("https://clob.polymarket.com/auth/derive-api-key", {
        headers: { "POLY_ADDRESS": addr, "POLY_SIGNATURE": sig, "POLY_TIMESTAMP": String(ts), "POLY_NONCE": "0" },
        signal: AbortSignal.timeout(20000),
      });
      const rawText = await authRes.text();
      let authBody: any = {};
      try { authBody = JSON.parse(rawText); } catch { authBody = { raw: rawText }; }
      res.json({
        ok: authRes.ok && !!authBody.apiKey,
        walletAddress: addr,
        funderMatch: match,
        funder,
        l1Status: authRes.status,
        apiKeyPreview: authBody.apiKey ? authBody.apiKey.slice(0, 8) + "..." : null,
        error: authBody.error || authBody.message || authBody.raw || null,
        rawResponse: authBody,
      });
    } catch (e: any) {
      res.json({ ok: false, error: e.message });
    }
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

  // ── Analytics endpoint ────────────────────────────────────────────────────────
  app.get("/api/analytics", async (_req, res) => {
    try {
      const allTrades = await storage.getTrades(500);
      const settings  = await storage.getBotSettings();
      const snapshots = await storage.getPnlSnapshots(30);

      // Per-asset breakdown
      const assetMap: Record<string, { wins: number; losses: number; pnl: number; trades: number }> = {};
      for (const t of allTrades) {
        const asset = t.market?.includes("BTC") || t.market?.includes("bitcoin") ? "BTC"
          : t.market?.includes("ETH") || t.market?.includes("ethereum") ? "ETH"
          : t.market?.includes("SOL") || t.market?.includes("solana") ? "SOL" : "OTHER";
        if (!assetMap[asset]) assetMap[asset] = { wins: 0, losses: 0, pnl: 0, trades: 0 };
        assetMap[asset].trades++;
        assetMap[asset].pnl += t.pnl || 0;
        if (t.status === "won") assetMap[asset].wins++;
        if (t.status === "lost") assetMap[asset].losses++;
      }

      // Hourly heatmap (24h)
      const hourMap: Record<number, { trades: number; wins: number; pnl: number }> = {};
      for (let i = 0; i < 24; i++) hourMap[i] = { trades: 0, wins: 0, pnl: 0 };
      for (const t of allTrades) {
        const h = new Date(t.createdAt).getUTCHours();
        hourMap[h].trades++;
        hourMap[h].pnl += t.pnl || 0;
        if (t.status === "won") hourMap[h].wins++;
      }

      // Signal accuracy (EMA cross confirmed by Polymarket)
      const confirmed   = allTrades.filter(t => t.alpacaOrderStatus && !t.alpacaOrderStatus.startsWith("clob"));
      const won         = confirmed.filter(t => t.status === "won");
      const lost        = confirmed.filter(t => t.status === "lost");
      const open        = confirmed.filter(t => t.status === "open");
      const totalPnl    = confirmed.reduce((s, t) => s + (t.pnl || 0), 0);
      const avgBet      = confirmed.length ? confirmed.reduce((s, t) => s + (t.betSize || 0), 0) / confirmed.length : 0;
      const avgEdge     = confirmed.length ? confirmed.reduce((s, t) => s + (t.edgeDetected || 0), 0) / confirmed.length : 0;

      // Win streak / loss streak
      let curStreak = 0, maxWinStreak = 0, maxLossStreak = 0, streakType = "";
      for (const t of [...confirmed].reverse()) {
        if (t.status === "won") {
          if (streakType === "win") { curStreak++; maxWinStreak = Math.max(maxWinStreak, curStreak); }
          else { streakType = "win"; curStreak = 1; maxWinStreak = Math.max(maxWinStreak, 1); }
        } else if (t.status === "lost") {
          if (streakType === "loss") { curStreak++; maxLossStreak = Math.max(maxLossStreak, curStreak); }
          else { streakType = "loss"; curStreak = 1; maxLossStreak = Math.max(maxLossStreak, 1); }
        }
      }

      // Daily PnL series from snapshots
      const dailySeries = snapshots.map(s => ({
        date: new Date(s.timestamp).toISOString().slice(0,10),
        pnl: Math.round((s.balance - settings.startingBalance) * 100) / 100,
        balance: s.balance,
        winRate: s.winRate,
      }));

      res.json({
        summary: {
          totalTrades:   confirmed.length,
          wins:          won.length,
          losses:        lost.length,
          open:          open.length,
          winRate:       confirmed.length ? Math.round(won.length / (won.length + lost.length) * 10000) / 100 : 0,
          totalPnl:      Math.round(totalPnl * 100) / 100,
          avgBetSize:    Math.round(avgBet * 100) / 100,
          avgEdge:       Math.round(avgEdge * 100) / 100,
          maxWinStreak,
          maxLossStreak,
          balance:       settings.totalBalance,
          startBalance:  settings.startingBalance,
          allTimeReturn: Math.round((settings.totalBalance - settings.startingBalance) / settings.startingBalance * 10000) / 100,
        },
        assets: Object.entries(assetMap).map(([asset, d]) => ({
          asset,
          trades:  d.trades,
          wins:    d.wins,
          losses:  d.losses,
          winRate: d.trades ? Math.round(d.wins / Math.max(1, d.wins + d.losses) * 10000) / 100 : 0,
          pnl:     Math.round(d.pnl * 100) / 100,
        })),
        hourlyHeatmap: Object.entries(hourMap).map(([h, d]) => ({
          hour:    parseInt(h),
          trades:  d.trades,
          wins:    d.wins,
          winRate: d.trades ? Math.round(d.wins / d.trades * 10000) / 100 : 0,
          pnl:     Math.round(d.pnl * 100) / 100,
        })),
        dailySeries,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Live strategy state (for Analytics page) ──────────────────────────────
  // ML Engine stats — calibration, bootstrap CI, signal weights, base rates
  app.get("/api/ml-stats", requireAuth, (_req, res) => {
    try {
      res.json(getMLStats());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/strategy-state", (_req, res) => {
    try {
      const state = getLiveStrategyState();
      res.json({ assets: state, timestamp: Date.now() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Wallet Leaderboard ──────────────────────────────────────────────────────

  // Top wallets ranked by score (PnL, win rate, ROI, diversity)
  app.get("/api/leaderboard", async (req, res) => {
    try {
      const refresh = req.query.refresh === "true";
      const leaders = await getTopWallets(refresh);
      res.json(leaders);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Deep profile for a specific wallet
  app.get("/api/leaderboard/profile/:address", async (req, res) => {
    try {
      const profile = await getWalletProfile(req.params.address);
      res.json(profile);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Smart merge: blend positions from multiple wallets
  app.post("/api/leaderboard/merge", async (req, res) => {
    try {
      const { wallets, budget = 100 } = req.body as { wallets: { address: string; score: number }[]; budget?: number };
      if (!Array.isArray(wallets) || !wallets.length) {
        return res.status(400).json({ error: "wallets array required" });
      }
      const addresses = wallets.map(w => w.address);
      const scores: Record<string, number> = {};
      wallets.forEach(w => { scores[w.address] = w.score; });
      const positions = await getMergedPositions(addresses, scores, 10, budget);
      res.json(positions);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Execute a merge-copy: place all merged positions using user's POLY wallet
  app.post("/api/leaderboard/execute-merge", requireAuth, async (req, res) => {
    try {
      const { wallets, budget = 100 } = req.body as { wallets: { address: string; score: number }[]; budget?: number };
      if (!Array.isArray(wallets) || !wallets.length) {
        return res.status(400).json({ error: "wallets array required" });
      }
      const addresses = wallets.map(w => w.address);
      const scores: Record<string, number> = {};
      wallets.forEach(w => { scores[w.address] = w.score; });
      const positions = await getMergedPositions(addresses, scores, 10, budget);

      // Import here to avoid circular deps
      const { placeClobOrder } = await import("./polymarketClient");
      const settings = await storage.getBotSettings();
      const pk  = settings.polyPrivateKey    || process.env.POLY_PRIVATE_KEY    || "";
      const fdr = settings.polyFunderAddress || process.env.POLY_FUNDER_ADDRESS || "0xeb0ad9B38733D5e7A51F1120d2d2e63055aAC3Af";

      const pkClean = pk.startsWith("0x") ? pk.slice(2) : pk;
      if (pkClean.length !== 64) {
        return res.status(400).json({ error: "POLY_PRIVATE_KEY not configured" });
      }

      const results: any[] = [];
      for (const pos of positions) {
        if (!pos.tokenId) { results.push({ market: pos.market, status: "skipped", reason: "no tokenId" }); continue; }
        const size = pos.recommendedSize / pos.avgPrice;
        const result = await placeClobOrder({
          privateKey: pk, funderAddress: fdr,
          tokenId: pos.tokenId, side: "BUY",
          size: Math.round(size * 100) / 100,
          price: pos.avgPrice, marketId: pos.marketId,
        });
        results.push({ market: pos.market, outcome: pos.outcome, status: result.status, orderId: result.orderId, error: result.error });
        // Brief pause between orders
        await new Promise(r => setTimeout(r, 300));
      }
      res.json({ placed: results.filter(r => r.status !== "failed").length, results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: Trigger Render redeploy via deploy hook ─────────────────
  app.post("/api/admin/redeploy", requireAuth, async (_req, res) => {
    const hook = process.env.RENDER_DEPLOY_HOOK;
    if (!hook) return res.status(400).json({ error: "RENDER_DEPLOY_HOOK not set in env vars" });
    try {
      const r = await fetch(hook, { method: "GET", signal: AbortSignal.timeout(10000) });
      res.json({ ok: true, status: r.status, message: "Deploy triggered" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: Fix balance (removes simulated trade impact) ──────────────────
  app.post("/api/admin/fix-balance", requireAuth, async (_req, res) => {
    try {
      // Recalculate true balance: starting balance + sum of non-simulated resolved PnL
      const allTrades = await storage.getTrades(10000);
      const realPnl = allTrades
        .filter(t => t.status === "won" || t.status === "lost")
        .filter(t => !t.alpacaOrderId?.startsWith("sim-") && t.alpacaOrderStatus !== "clob:simulated")
        .reduce((s, t) => s + (t.pnl || 0), 0);

      // Base starting balance from context: $2017 USDC on live Polymarket wallet
      const POLY_STARTING_BALANCE = 2017;
      const correctedBalance = Math.round((POLY_STARTING_BALANCE + realPnl) * 100) / 100;

      await storage.updateBotSettings({ totalBalance: correctedBalance });
      console.log(`[Admin] Balance corrected to $${correctedBalance} (real PnL: $${realPnl.toFixed(2)})`);
      res.json({ ok: true, correctedBalance, realPnl });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
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
