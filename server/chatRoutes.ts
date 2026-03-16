/**
 * chatRoutes.ts — Grok-powered terminal chat agent
 * Uses xAI /v1/responses API with built-in web_search tool
 * Streaming SSE responses, live bot context injected per message
 */

import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { fetchAlpacaAccount, fetchAlpacaPositions } from "./alpacaClient";

const GROK_RESPONSES_API = "https://api.x.ai/v1/responses";
const GROK_KEY = process.env.GROK_API_KEY || "";

// In-memory chat history per session
const chatSessions = new Map<string, Array<{ role: string; content: string }>>();

function getSessionId(req: Request): string {
  return (req.session as any)?.userId?.toString() || "anon";
}

async function buildSystemPrompt(): Promise<string> {
  try {
    const settings = await storage.getBotSettings();
    const s: any = settings;

    // Fetch last 100 trades for full analysis
    const trades = await storage.getTrades(100);
    const tradeList: any[] = trades || [];

    // Compute stats
    const resolvedTrades = tradeList.filter((t: any) => t.status === "won" || t.status === "lost");
    const wins = resolvedTrades.filter((t: any) => t.status === "won").length;
    const losses = resolvedTrades.filter((t: any) => t.status === "lost").length;
    const winRate = resolvedTrades.length > 0 ? ((wins / resolvedTrades.length) * 100).toFixed(1) : "N/A";
    const totalPnl = resolvedTrades.reduce((acc: number, t: any) => acc + (t.pnl || 0), 0);
    const avgWin = wins > 0
      ? (resolvedTrades.filter((t: any) => t.status === "won").reduce((a: number, t: any) => a + (t.pnl || 0), 0) / wins).toFixed(2)
      : "0";
    const avgLoss = losses > 0
      ? (resolvedTrades.filter((t: any) => t.status === "lost").reduce((a: number, t: any) => a + (t.pnl || 0), 0) / losses).toFixed(2)
      : "0";

    // Today's trades
    const today = new Date().toDateString();
    const todayTrades = tradeList.filter((t: any) => new Date(t.createdAt || 0).toDateString() === today);
    const todayPnl = todayTrades.reduce((acc: number, t: any) => acc + (t.pnl || 0), 0);
    const todayWins = todayTrades.filter((t: any) => t.status === "won").length;
    const todayLosses = todayTrades.filter((t: any) => t.status === "lost").length;

    // Per-asset breakdown
    const assetMap: Record<string, { trades: number; wins: number; pnl: number }> = {};
    for (const t of resolvedTrades) {
      const sym = (t.market || "UNKNOWN").includes("ETH") ? "ETH" :
                  (t.market || "UNKNOWN").includes("SOL") ? "SOL" : "BTC";
      if (!assetMap[sym]) assetMap[sym] = { trades: 0, wins: 0, pnl: 0 };
      assetMap[sym].trades++;
      if (t.status === "won") assetMap[sym].wins++;
      assetMap[sym].pnl += t.pnl || 0;
    }
    const assetBreakdown = Object.entries(assetMap)
      .map(([sym, d]) => `  ${sym}: ${d.trades} trades, ${d.trades > 0 ? ((d.wins/d.trades)*100).toFixed(0) : 0}% win, PnL $${d.pnl.toFixed(2)}`)
      .join("\n");

    // Recent 10 trades summary
    const recentSummary = tradeList.slice(0, 10).map((t: any) =>
      `  [${t.status?.toUpperCase() || "OPEN"}] ${t.market?.slice(0, 40) || "?"} | $${(t.betSize || 0).toFixed(2)} bet | PnL: $${(t.pnl || 0).toFixed(2)}`
    ).join("\n");

    // Alpaca live positions
    let positionsSection = "  No positions data available";
    let accountSection = "  No account data available";
    try {
      const apiKey = s.alpacaApiKey || "";
      const apiSecret = s.alpacaApiSecret || "";
      if (apiKey && apiSecret) {
        const [acctResult, posResult] = await Promise.all([
          fetchAlpacaAccount(apiKey, apiSecret),
          fetchAlpacaPositions(apiKey, apiSecret),
        ]);
        if (acctResult.ok) {
          const a = acctResult.account;
          accountSection = [
            `  Account: ${acctResult.isLive ? "LIVE" : "PAPER"} | Status: ${a.status}`,
            `  Portfolio Value: $${parseFloat(a.portfolio_value).toFixed(2)}`,
            `  Cash:            $${parseFloat(a.cash).toFixed(2)}`,
            `  Equity:          $${parseFloat(a.equity).toFixed(2)}`,
            `  Buying Power:    $${parseFloat(a.buying_power).toFixed(2)}`,
            `  Last Close Eq:   $${parseFloat(a.last_equity).toFixed(2)}`,
            `  Day Change:      $${(parseFloat(a.equity) - parseFloat(a.last_equity)).toFixed(2)}`,
          ].join("\n");
        }
        if (posResult.ok && posResult.positions && posResult.positions.length > 0) {
          positionsSection = posResult.positions.map((p: any) =>
            `  ${p.symbol} | ${p.side.toUpperCase()} ${parseFloat(p.qty).toFixed(4)} units | Entry: $${parseFloat(p.avg_entry_price).toFixed(2)} | Current: $${parseFloat(p.current_price).toFixed(2)} | Mkt Value: $${parseFloat(p.market_value).toFixed(2)} | Unr. P&L: $${parseFloat(p.unrealized_pl).toFixed(2)} (${(parseFloat(p.unrealized_plpc)*100).toFixed(2)}%)`
          ).join("\n");
        } else if (posResult.ok) {
          positionsSection = "  No open positions currently";
        }
      }
    } catch (_) {
      // non-fatal
    }

    // Copy trades stats
    let copySection = "  No copy trade data";
    try {
      const copyTrades = await storage.getCopyTrades(50);
      const ct: any[] = copyTrades || [];
      const ctFilled = ct.filter((t: any) => t.status === "filled").length;
      const ctSpent = ct.reduce((a: number, t: any) => a + (t.usdcSpent || 0), 0);
      copySection = `  ${ct.length} total copy trades | ${ctFilled} filled | $${ctSpent.toFixed(2)} USDC deployed`;
    } catch (_) {}

    return `You are POLYBOT-AI, the intelligent trading assistant embedded inside PolyBot — a retro CRT crypto trading terminal.

## YOUR PERSONALITY
- Sharp, concise, no-nonsense quant trading intelligence
- Deep expertise: crypto markets, Polymarket prediction markets, Kelly Criterion, Bayesian inference, order book imbalance, CLOB strategies, momentum, mean reversion, statistical edge
- Use plain text. ALL CAPS for emphasis. Be direct.
- You have FULL access to the user's portfolio, live positions, and complete trade history below — use it to give specific, data-driven insights

## LIVE ALPACA ACCOUNT
${accountSection}

## OPEN POSITIONS (Alpaca)
${positionsSection}

## BOT CONFIGURATION
- Running        : ${s.isRunning ? "YES" : "NO"}
- Bet Size       : $${s.betSize} per trade
- Max Bets/Day   : ${s.maxBetsPerDay}
- Daily Stop Loss: ${s.dailyStopLossPct}%
- Min Edge       : ${s.minEdgePct}%
- Assets         : BTC, ETH, SOL (Alpaca) + Polymarket CLOB
- Starting Bal   : $${s.startingBalance?.toFixed(2)}
- Current Bal    : $${s.totalBalance?.toFixed(2)}
- Total Return   : ${s.totalBalance && s.startingBalance ? (((s.totalBalance - s.startingBalance) / s.startingBalance) * 100).toFixed(2) : "N/A"}%

## PERFORMANCE STATISTICS (last ${resolvedTrades.length} resolved trades)
- Win Rate  : ${winRate}% (${wins}W / ${losses}L)
- Total PnL : $${totalPnl.toFixed(2)}
- Avg Win   : +$${avgWin}
- Avg Loss  : $${avgLoss}
- Exp. Value: $${((wins > 0 ? parseFloat(avgWin) : 0) * (resolvedTrades.length > 0 ? wins/resolvedTrades.length : 0) + (losses > 0 ? parseFloat(avgLoss) : 0) * (resolvedTrades.length > 0 ? losses/resolvedTrades.length : 0)).toFixed(3)} per trade

## TODAY'S SESSION
- Trades    : ${todayTrades.length} (${todayWins}W / ${todayLosses}L)
- Today PnL : $${todayPnl.toFixed(2)}

## PER-ASSET BREAKDOWN
${assetBreakdown || "  No data yet"}

## COPY TRADING
${copySection}

## RECENT 10 TRADES
${recentSummary || "  No trades yet"}

## YOUR CAPABILITIES
1. Analyze the portfolio and give specific improvement recommendations
2. Search the web for live crypto news, research, and market conditions
3. Explain and suggest trading algorithms, parameter tuning, risk management
4. Identify patterns in the trade history above
5. Help schedule or plan strategy enhancements

## RESPONSE FORMAT
- Be concise and direct. Use bullet points for lists.
- Reference the actual numbers from the portfolio data above in your answers
- For parameter changes: give exact recommended values
- For web results: summarize then give your analysis

Current time: ${new Date().toISOString()}`;

  } catch (err: any) {
    return `You are POLYBOT-AI, a trading assistant with web search. Error loading portfolio context: ${err.message}. Be helpful with general trading questions. Time: ${new Date().toISOString()}`;
  }
}

export function registerChatRoutes(app: Express) {

  // ── POST /api/chat — streaming SSE ───────────────────────────────────────────
  app.post("/api/chat", async (req: Request, res: Response) => {
    const { message, clearHistory } = req.body;
    const sessionId = getSessionId(req);

    if (!GROK_KEY) {
      return res.status(500).json({ error: "GROK_API_KEY not configured on server" });
    }

    if (clearHistory) {
      chatSessions.delete(sessionId);
      return res.json({ ok: true });
    }

    if (!message?.trim()) {
      return res.status(400).json({ error: "Message required" });
    }

    // Get or init session history
    if (!chatSessions.has(sessionId)) chatSessions.set(sessionId, []);
    const history = chatSessions.get(sessionId)!;

    // Add user message
    history.push({ role: "user", content: message.trim() });
    if (history.length > 20) history.splice(0, history.length - 20);

    const systemPrompt = await buildSystemPrompt();

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.flushHeaders();

    try {
      // Build input array for /v1/responses — system prompt as first user message with instructions
      const inputMessages = [
        { role: "system", content: systemPrompt },
        ...history.slice(-18),
      ];

      const payload = {
        model: "grok-4-0709",
        stream: true,
        max_output_tokens: 1024,
        input: inputMessages,
        tools: [
          { type: "web_search" },
        ],
      };

      const grokRes = await fetch(GROK_RESPONSES_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROK_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      if (!grokRes.ok) {
        const errText = await grokRes.text();
        res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
        return res.end();
      }

      const reader = grokRes.body?.getReader();
      if (!reader) {
        res.write(`data: ${JSON.stringify({ error: "No stream body" })}\n\n`);
        return res.end();
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      const citations: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // Split on double newline (SSE event boundary)
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventBlock of events) {
          // Each block has: "event: xxx\ndata: {...}"
          // Extract just the data line
          const dataLine = eventBlock.split("\n").find(l => l.startsWith("data: "));
          if (!dataLine) continue;
          const data = dataLine.slice(6).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const type: string = parsed.type || "";

            // Text delta from /v1/responses
            if (type === "response.output_text.delta") {
              const delta: string = parsed.delta || "";
              if (delta) {
                fullContent += delta;
                res.write(`data: ${JSON.stringify({ delta })}\n\n`);
              }
            }

            // Citations from web search results
            if (type === "response.web_search_call.completed") {
              const results = parsed.output?.results || [];
              for (const r of results) {
                if (r.url) citations.push(r.url);
              }
            }

            // Response completed
            if (type === "response.completed") {
              // Extract any citations from final output
              const output = parsed.response?.output || [];
              for (const item of output) {
                if (item.type === "message") {
                  for (const c of (item.content || [])) {
                    if (c.type === "output_text" && c.annotations) {
                      for (const ann of c.annotations) {
                        if (ann.url) citations.push(ann.url);
                      }
                    }
                  }
                }
              }
            }

          } catch {
            // skip malformed
          }
        }
      }

      // Save assistant reply
      if (fullContent) {
        history.push({ role: "assistant", content: fullContent });
      }

      // Send citations then done
      if (citations.length) {
        res.write(`data: ${JSON.stringify({ citations })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();

    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ error: err.message || "Stream failed" })}\n\n`);
      res.end();
    }
  });

  // ── GET /api/chat/history ────────────────────────────────────────────────────
  app.get("/api/chat/history", (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    res.json(chatSessions.get(sessionId) || []);
  });

  // ── DELETE /api/chat/history ─────────────────────────────────────────────────
  app.delete("/api/chat/history", (req: Request, res: Response) => {
    chatSessions.delete(getSessionId(req));
    res.json({ ok: true });
  });
}
