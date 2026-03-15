/**
 * Alpaca API client — fetches real account balance & portfolio data
 * Docs: https://docs.alpaca.markets/reference/getaccount-1
 *
 * Live base URL:  https://api.alpaca.markets
 * Paper base URL: https://paper-api.alpaca.markets
 */

export interface AlpacaAccount {
  id: string;
  cash: string;           // Settled cash balance
  portfolio_value: string; // Total equity value
  equity: string;          // Account equity
  buying_power: string;
  last_equity: string;     // Equity at last market close
  status: string;          // "ACTIVE" etc.
  currency: string;
  pattern_day_trader: boolean;
  account_blocked: boolean;
  account_number?: string;
  crypto_status?: string;
  [key: string]: unknown;  // allow extra fields from Alpaca API
}

export type AlpacaAccountResult =
  | { ok: true; account: AlpacaAccount; isLive: boolean }
  | { ok: false; error: string };

async function tryFetch(baseUrl: string, apiKey: string, apiSecret: string) {
  const res = await fetch(`${baseUrl}/v2/account`, {
    headers: {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": apiSecret,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<AlpacaAccount>;
}

export async function fetchAlpacaAccount(
  apiKey: string,
  apiSecret: string
): Promise<{ ok: boolean; account?: AlpacaAccount; isLive?: boolean; error?: string }> {
  if (!apiKey || !apiSecret) {
    return { ok: false, error: "No API credentials configured." };
  }

  // Try live first, then fall back to paper
  try {
    const account = await tryFetch("https://api.alpaca.markets", apiKey, apiSecret);
    return { ok: true, account, isLive: true };
  } catch (liveErr: any) {
    // If it's a 403/401, try paper trading endpoint
    try {
      const account = await tryFetch("https://paper-api.alpaca.markets", apiKey, apiSecret);
      return { ok: true, account, isLive: false };
    } catch (paperErr: any) {
      return {
        ok: false,
        error: `Live: ${liveErr.message} | Paper: ${paperErr.message}`,
      };
    }
  }
}
