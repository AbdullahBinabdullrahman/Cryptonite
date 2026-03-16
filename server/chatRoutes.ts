/**
 * chatRoutes.ts — Grok-powered terminal chat agent
 * Uses xAI /v1/responses API with built-in web_search tool
 * Streaming SSE responses, live bot context injected per message
 */

import type { Express, Request, Response } from "express";
import { storage } from "./storage";

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
    const trades = await storage.getRecentTrades(20);
    const s: any = settings;

    const wins = trades.filter((t: any) => (t.pnl || 0) > 0).length;
    const total = trades.length;
    const todayPnl = trades
      .filter((t: any) => {
        const d = new Date(t.createdAt || Date.now());
        return d.toDateString() === new Date().toDateString();
      })
      .reduce((acc: number, t: any) => acc + (t.pnl || 0), 0);

    return `You are POLYBOT-AI, an intelligent trading assistant embedded in a retro CRT terminal interface.

## PERSONALITY
- Sharp, concise, no-nonsense trading intelligence
- Use plain text; ALL CAPS for emphasis when needed
- Deep knowledge: crypto markets, Polymarket prediction markets, Kelly Criterion, Bayesian inference, order book analysis, CLOB strategies, quantitative trading, momentum, mean reversion

## LIVE BOT STATUS (as of this message)
- Portfolio Balance : $${s.totalBalance?.toFixed(2) || "N/A"}
- Starting Balance  : $${s.startingBalance?.toFixed(2) || "N/A"}
- Total Return      : ${s.totalBalance && s.startingBalance ? (((s.totalBalance - s.startingBalance) / s.startingBalance) * 100).toFixed(2) : "N/A"}%
- Today PnL         : $${todayPnl.toFixed(2)}
- Win Rate          : ${total > 0 ? ((wins / total) * 100).toFixed(1) : "N/A"}% (${wins}/${total} recent)
- Bot Running       : ${s.isRunning ? "YES" : "NO"}
- Bet Size          : $${s.betSize} per trade
- Max Bets/Day      : ${s.maxBetsPerDay}
- Daily Stop Loss   : ${s.dailyStopLossPct}%
- Min Edge          : ${s.minEdgePct}%
- Assets            : BTC, ETH, SOL (Alpaca paper) + Polymarket CLOB

## CAPABILITIES
1. Answer trading strategy / algorithm questions
2. Search the web for live crypto news and research
3. Analyze bot performance and suggest parameter improvements
4. Explain quant concepts relevant to the user's setup
5. Help plan strategy enhancements

## FORMAT
- Be concise. Bullet points when listing.
- For web results: summarize key finding then provide analysis
- For parameter recommendations: give exact values
- Current time: ${new Date().toISOString()}`;
  } catch {
    return `You are POLYBOT-AI, a trading assistant. Be concise and helpful. Time: ${new Date().toISOString()}`;
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
