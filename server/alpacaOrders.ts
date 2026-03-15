/**
 * Alpaca Order Execution
 * Places real market orders for BTC/USD when an edge is detected.
 * Docs: https://docs.alpaca.markets/reference/postorder
 *
 * Symbol: BTCUSD  (crypto, available 24/7 on Alpaca)
 * Order type: market  (immediate fill at best price)
 * Side: buy (bullish edge) | sell (bearish edge)
 */

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  status: string;         // "new" | "filled" | "canceled" | "rejected"
  symbol: string;
  side: string;           // "buy" | "sell"
  type: string;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  created_at: string;
  filled_at: string | null;
}

export type PlaceOrderResult =
  | { ok: true; order: AlpacaOrder; isLive: boolean }
  | { ok: false; error: string };

async function postOrder(baseUrl: string, apiKey: string, apiSecret: string, body: object): Promise<AlpacaOrder> {
  const res = await fetch(`${baseUrl}/v2/orders`, {
    method: "POST",
    headers: {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": apiSecret,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<AlpacaOrder>;
}

async function getOrder(baseUrl: string, apiKey: string, apiSecret: string, orderId: string): Promise<AlpacaOrder> {
  const res = await fetch(`${baseUrl}/v2/orders/${orderId}`, {
    headers: {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": apiSecret,
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<AlpacaOrder>;
}

/**
 * Place a market order for a crypto asset on Alpaca.
 * @param side "buy" | "sell"
 * @param notional USD amount to trade (e.g. 10 = $10 worth of asset)
 * @param apiKey Alpaca API Key ID
 * @param apiSecret Alpaca API Secret Key
 * @param symbol Alpaca crypto symbol — "BTCUSD" | "ETHUSD" | "SOLUSD" (default BTCUSD)
 */
export async function placeAlpacaOrder(
  side: "buy" | "sell",
  notional: number,
  apiKey: string,
  apiSecret: string,
  symbol: string = "BTCUSD"
): Promise<{ ok: boolean; order?: AlpacaOrder; isLive?: boolean; error?: string }> {
  if (!apiKey || !apiSecret) {
    return { ok: false, error: "No API credentials configured." };
  }
  if (notional < 1) {
    return { ok: false, error: `Notional too small: $${notional} (minimum $1)` };
  }

  const body = {
    symbol,
    notional: notional.toFixed(2),  // fractional shares via notional
    side,
    type: "market",
    time_in_force: "gtc",           // good-till-canceled (required for crypto)
  };

  // Try live first, then paper
  for (const [baseUrl, isLive] of [
    ["https://api.alpaca.markets", true],
    ["https://paper-api.alpaca.markets", false],
  ] as [string, boolean][]) {
    try {
      const order = await postOrder(baseUrl, apiKey, apiSecret, body);
      console.log(`[AlpacaOrders] ${isLive ? "LIVE" : "PAPER"} order placed: ${side.toUpperCase()} $${notional} BTC — order ID: ${order.id}`);
      return { ok: true, order, isLive };
    } catch (err: any) {
      // If 403/401 on live, fall through to paper
      if (isLive && (err.message.includes("403") || err.message.includes("401") || err.message.includes("forbidden"))) {
        continue;
      }
      return { ok: false, error: err.message };
    }
  }

  return { ok: false, error: "Failed to place order on both live and paper endpoints." };
}

/**
 * Fetch the latest status of an existing order.
 */
export async function fetchOrderStatus(
  orderId: string,
  apiKey: string,
  apiSecret: string,
  isLive: boolean
): Promise<{ ok: boolean; order?: AlpacaOrder; error?: string }> {
  const baseUrl = isLive
    ? "https://api.alpaca.markets"
    : "https://paper-api.alpaca.markets";

  try {
    const order = await getOrder(baseUrl, apiKey, apiSecret, orderId);
    return { ok: true, order };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
