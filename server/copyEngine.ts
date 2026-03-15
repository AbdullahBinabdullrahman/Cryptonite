/**
 * Copy Engine
 *
 * Every 60 seconds:
 *  1. For each active wallet in copied_wallets, fetch their recent trades from Polymarket
 *  2. For each new trade not yet copied, place an equivalent CLOB order using our private key
 *  3. Record the copy trade in the database with status + order ID
 *  4. Update wallet stats (totalCopied, lastSeen)
 */

import { storage } from "./storage";
import { fetchWalletTrades, placeClobOrder } from "./polymarketClient";

// Our Polymarket credentials (from user config)
const POLY_PRIVATE_KEY    = "019cec4d-35f6-7db6-9702-a189b1a21bb9";
const POLY_FUNDER_ADDRESS = "0x4e2355789ae74089cdeea5d091e43567447e6093";

let copyInterval: ReturnType<typeof setInterval> | null = null;

// Track last-seen trade timestamps per wallet to avoid re-processing
const lastSeen: Record<number, Date> = {};

async function processWallet(walletId: number, walletAddress: string, copyPct: number) {
  try {
    const since = lastSeen[walletId] ?? new Date(Date.now() - 5 * 60 * 1000); // last 5 min on first run
    const trades = await fetchWalletTrades(walletAddress, since);

    if (!trades.length) return;

    console.log(`[CopyEngine] Wallet ${walletAddress.slice(0, 8)}… — ${trades.length} new trade(s)`);

    let copiedCount = 0;

    for (const trade of trades) {
      // Skip if already copied (dedup)
      const alreadyCopied = await storage.isTradeCopied(
        walletId, trade.marketId, trade.side, trade.timestamp
      );
      if (alreadyCopied) continue;

      // Scale size by copyPct
      const scaledSize = Math.max(0.1, (trade.size * copyPct) / 100);

      // Create pending copy trade record
      const copyTrade = await storage.createCopyTrade({
        walletId,
        walletAddress,
        market: trade.market,
        marketId: trade.marketId,
        tokenId: trade.tokenId,
        side: trade.side,
        outcome: trade.outcome,
        size: scaledSize,
        price: trade.price,
        usdcSpent: scaledSize * trade.price,
        status: "pending",
        polyOrderId: null,
        errorMsg: null,
        pnl: 0,
        resolvedAt: null,
      });

      // Place the order on Polymarket CLOB
      const result = await placeClobOrder({
        privateKey: POLY_PRIVATE_KEY,
        funderAddress: POLY_FUNDER_ADDRESS,
        tokenId: trade.tokenId,
        side: trade.side,
        size: scaledSize,
        price: trade.price,
        marketId: trade.marketId,
      });

      if (result.ok) {
        await storage.updateCopyTrade(copyTrade.id, {
          status: result.status === "simulated" ? "filled" : "filled",
          polyOrderId: result.orderId,
          errorMsg: result.error ?? null,
        });
        copiedCount++;
        console.log(`[CopyEngine] Copied ${trade.side} ${scaledSize.toFixed(2)} @ ${trade.price} — market: ${trade.market.slice(0, 40)}`);
      } else {
        await storage.updateCopyTrade(copyTrade.id, {
          status: "failed",
          errorMsg: result.error ?? "Unknown error",
        });
        console.warn(`[CopyEngine] Order failed for wallet ${walletAddress.slice(0, 8)}: ${result.error}`);
      }
    }

    // Update wallet stats
    if (copiedCount > 0) {
      const wallet = await storage.getCopiedWallet(walletId);
      if (wallet) {
        await storage.updateCopiedWallet(walletId, {
          totalCopied: wallet.totalCopied + copiedCount,
          lastSeen: new Date(),
        });
      }
    }

    // Advance the seen window
    lastSeen[walletId] = new Date();
  } catch (err) {
    console.error(`[CopyEngine] Error processing wallet ${walletAddress.slice(0, 8)}:`, err);
  }
}

export function startCopyEngine() {
  if (copyInterval) return;
  console.log("[CopyEngine] Starting — will poll wallets every 60s");

  copyInterval = setInterval(async () => {
    try {
      const wallets = await storage.getCopiedWallets();
      const active = wallets.filter(w => w.isActive);
      if (!active.length) return;

      await Promise.all(
        active.map(w => processWallet(w.id, w.address, w.copyPct))
      );
    } catch (err) {
      console.error("[CopyEngine] Poll error:", err);
    }
  }, 60_000);
}

export function stopCopyEngine() {
  if (copyInterval) {
    clearInterval(copyInterval);
    copyInterval = null;
    console.log("[CopyEngine] Stopped");
  }
}

// Manual sync — call from route handler
export async function syncWalletNow(walletId: number): Promise<{ copied: number; error?: string }> {
  try {
    const wallet = await storage.getCopiedWallet(walletId);
    if (!wallet) return { copied: 0, error: "Wallet not found" };

    const before = wallet.totalCopied;
    await processWallet(wallet.id, wallet.address, wallet.copyPct);
    const after = (await storage.getCopiedWallet(walletId))!.totalCopied;
    return { copied: after - before };
  } catch (err: any) {
    return { copied: 0, error: err.message };
  }
}
