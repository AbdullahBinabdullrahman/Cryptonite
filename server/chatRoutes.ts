/**
 * chatRoutes.ts — Grok-powered terminal chat agent
 * - Streaming SSE responses (character-by-character typewriter effect)
 * - Web search via Grok's built-in search tool
 * - Live bot context injected into every system prompt
 * - Per-session conversation history
 */

import type { Express, Request, Response } from "express";
import { storage } from "./storage";

const GROK_API = "https://api.x.ai/v1/chat/completions";
const GROK_KEY = process.env.GROK_API_KEY || "";

// In-memory chat history per session (cleared on server restart)
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

    return `You are POLYBOT-AI, the intelligent trading assistant embedded inside a retro-style crypto trading terminal.

## YOUR PERSONALITY
- You are a sharp, no-nonsense trading intelligence module
- Communicate in a concise, terminal-style manner — use clear text, occasional ALL CAPS for emphasis
- You have deep knowledge of crypto trading algorithms, market microstructure, Polymarket prediction markets, options theory, Kelly Criterion, Bayesian inference, order flow analysis, and quantitative trading
- You can search the web for real-time information, news, and research

## LIVE BOT STATUS (injected at message time)
- Portfolio Balance: $${s.totalBalance?.toFixed(2) || "N/A"}
- Starting Balance: $${s.startingBalance?.toFixed(2) || "N/A"}
- Total Return: ${s.totalBalance && s.startingBalance ? (((s.totalBalance - s.startingBalance) / s.startingBalance) * 100).toFixed(2) : "N/A"}%
- Today PnL: $${todayPnl.toFixed(2)}
- Win Rate: ${total > 0 ? ((wins / total) * 100).toFixed(1) : "N/A"}% (${wins}/${total} recent trades)
- Bot Running: ${s.isRunning ? "YES" : "NO"}
- Bet Size: $${s.betSize} per trade
- Max Bets/Day: ${s.maxBetsPerDay}
- Daily Stop Loss: ${s.dailyStopLossPct}%
- Min Edge: ${s.minEdgePct}%
- Assets Traded: BTC, ETH, SOL (Alpaca) + Polymarket CLOB

## YOUR CAPABILITIES
1. Answer questions about trading strategies, algorithms, and techniques
2. Search the web for live crypto news, market conditions, research papers
3. Analyze the user's bot performance and suggest improvements
4. Explain quantitative concepts (Kelly sizing, Bayesian updating, order book imbalance, etc.)
5. Help schedule or plan strategy changes for the bot
6. Research Polymarket markets and odds

## RESPONSE FORMAT
- Be concise. Bullet points where useful.
- For web search results, summarize the key finding then provide your analysis
- When recommending parameter changes, state the exact values (e.g. "set betSize to $25")
- End responses naturally — no need for lengthy closings

Current time: ${new Date().toISOString()}`;
  } catch {
    return `You are POLYBOT-AI, a trading assistant with web search capabilities. Be concise and helpful.`;
  }
}

export function registerChatRoutes(app: Express) {

  // ── POST /api/chat — streaming chat ──────────────────────────────────────────
  app.post("/api/chat", async (req: Request, res: Response) => {
    const { message, clearHistory } = req.body;
    const sessionId = getSessionId(req);

    if (!GROK_KEY) {
      return res.status(500).json({ error: "GROK_API_KEY not configured" });
    }

    if (!message?.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Clear history if requested
    if (clearHistory) {
      chatSessions.delete(sessionId);
      return res.json({ ok: true });
    }

    // Get or create session history
    if (!chatSessions.has(sessionId)) {
      chatSessions.set(sessionId, []);
    }
    const history = chatSessions.get(sessionId)!;

    // Add user message
    history.push({ role: "user", content: message.trim() });

    // Keep last 20 messages to avoid token overflow
    if (history.length > 20) history.splice(0, history.length - 20);

    // Build system prompt with live context
    const systemPrompt = await buildSystemPrompt();

    // Set up SSE streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    try {
      const payload = {
        model: "grok-3",
        stream: true,
        max_tokens: 1024,
        messages: [
          { role: "system", content: systemPrompt },
          ...history.slice(-18), // last 18 messages
        ],
        // Enable Grok's live web search
        search_parameters: {
          mode: "auto",
        },
      };

      const grokRes = await fetch(GROK_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROK_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      if (!grokRes.ok) {
        const err = await grokRes.text();
        res.write(`data: ${JSON.stringify({ error: `Grok error: ${err}` })}\n\n`);
        return res.end();
      }

      const reader = grokRes.body?.getReader();
      if (!reader) {
        res.write(`data: ${JSON.stringify({ error: "No stream body" })}\n\n`);
        return res.end();
      }

      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              res.write(`data: ${JSON.stringify({ delta })}\n\n`);
            }
            // Capture search citations if present
            const citations = parsed.choices?.[0]?.delta?.citations;
            if (citations?.length) {
              res.write(`data: ${JSON.stringify({ citations })}\n\n`);
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      // Save assistant reply to history
      if (fullContent) {
        history.push({ role: "assistant", content: fullContent });
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();

    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ error: err.message || "Stream failed" })}\n\n`);
      res.end();
    }
  });

  // ── GET /api/chat/history — return session history ────────────────────────────
  app.get("/api/chat/history", (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const history = chatSessions.get(sessionId) || [];
    res.json(history);
  });

  // ── DELETE /api/chat/history — clear session ──────────────────────────────────
  app.delete("/api/chat/history", (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    chatSessions.delete(sessionId);
    res.json({ ok: true });
  });
}
