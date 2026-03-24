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

// ─── Alpaca Position ─────────────────────────────────────────────────────────
export interface AlpacaPosition {
  symbol: string;
  asset_class: string;       // "crypto" | "us_equity"
  qty: string;               // shares/units held
  avg_entry_price: string;   // cost basis per unit
  current_price: string;     // latest market price
  market_value: string;      // qty × current_price
  cost_basis: string;        // qty × avg_entry_price
  unrealized_pl: string;     // market_value - cost_basis
  unrealized_plpc: string;   // percent change
  side: string;              // "long" | "short"
  change_today: string;      // intraday dollar change
  [key: string]: unknown;
}

export async function fetchAlpacaPositions(
  apiKey: string,
  apiSecret: string
): Promise<{ ok: boolean; positions?: AlpacaPosition[]; isLive?: boolean; error?: string }> {
  if (!apiKey || !apiSecret) return { ok: false, error: "No credentials" };

  async function tryPositions(baseUrl: string) {
    const res = await fetch(`${baseUrl}/v2/positions`, {
      headers: {
        "APCA-API-KEY-ID": apiKey,
        "APCA-API-SECRET-KEY": apiSecret,
        "Accept": "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<AlpacaPosition[]>;
  }

  try {
    const positions = await tryPositions("https://api.alpaca.markets");
    return { ok: true, positions, isLive: true };
  } catch {
    try {
      const positions = await tryPositions("https://paper-api.alpaca.markets");
      return { ok: true, positions, isLive: false };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
}

export async function fetchAlpacaAccount(
  apiKey: string,
  apiSecret: string
): Promise<{ ok: boolean; account?: AlpacaAccount; isLive?: boolean; error?: string }> {
  if (!apiKey || !apiSecret) {
    return { ok: false, error: "No API credentials configured." };
  }

  // Use key prefix to determine live vs paper (AK = live, PK = paper)
  const isLiveKey = apiKey.startsWith("AK");
  const baseUrl = isLiveKey
    ? "https://api.alpaca.markets"
    : "https://paper-api.alpaca.markets";

  try {
    const account = await tryFetch(baseUrl, apiKey, apiSecret);
    return { ok: true, account, isLive: isLiveKey };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
