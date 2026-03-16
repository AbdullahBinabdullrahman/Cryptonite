/**
 * TerminalChat.tsx — Retro CRT terminal chat powered by Grok + web search
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────
type MessageRole = "user" | "assistant" | "system" | "web";

interface ChatLine {
  id: string;
  role: MessageRole;
  content: string;
  citations?: string[];
  timestamp: Date;
  streaming?: boolean;
}

// ── Colour map ─────────────────────────────────────────────────────────────────
const COLORS = {
  green:   "hsl(120 100% 55%)",
  green2:  "hsl(120 100% 40%)",
  green3:  "hsl(120 60% 30%)",
  amber:   "hsl(45 100% 55%)",
  cyan:    "hsl(175 90% 55%)",
  red:     "hsl(0 90% 60%)",
  dim:     "hsl(120 30% 30%)",
  dimmer:  "hsl(120 20% 20%)",
  bg:      "hsl(220 20% 3%)",
  bg2:     "hsl(220 20% 5%)",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2); }

function formatTime(d: Date) {
  return d.toTimeString().slice(0, 8);
}

const BOOT_LINES = [
  { text: "POLYBOT-AI TERMINAL v2.0", color: COLORS.green, delay: 0 },
  { text: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", color: COLORS.dimmer, delay: 80 },
  { text: "NEURAL ENGINE: GROK-3 [xAI]", color: COLORS.cyan, delay: 160 },
  { text: "WEB SEARCH: ENABLED", color: COLORS.cyan, delay: 240 },
  { text: "BOT CONTEXT: LIVE", color: COLORS.green, delay: 320 },
  { text: "SESSION: SECURE", color: COLORS.green, delay: 400 },
  { text: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", color: COLORS.dimmer, delay: 480 },
  { text: "Type your question below. /help for commands.", color: COLORS.amber, delay: 560 },
  { text: "", color: COLORS.dim, delay: 600 },
];

const HELP_TEXT = `AVAILABLE COMMANDS
──────────────────────────────────────
/clear       Clear terminal history
/status      Show live bot status
/help        Show this help

EXAMPLE QUERIES
──────────────────────────────────────
> What is the Kelly Criterion and should I adjust my bet size?
> Search for latest BTC market news
> Analyze my win rate and suggest improvements
> Explain order book imbalance trading
> What Polymarket markets should I be watching?
> How does Bayesian updating apply to my CLOB strategy?`;

// ── Line renderer ──────────────────────────────────────────────────────────────
function TerminalLine({ line }: { line: ChatLine }) {
  const prefix = {
    user:      { symbol: "❯", color: COLORS.amber },
    assistant: { symbol: "◈", color: COLORS.green },
    system:    { symbol: "◆", color: COLORS.cyan },
    web:       { symbol: "⊕", color: COLORS.cyan },
  }[line.role];

  const textColor = {
    user:      COLORS.amber,
    assistant: COLORS.green,
    system:    COLORS.cyan,
    web:       COLORS.cyan,
  }[line.role];

  return (
    <div style={{ marginBottom: "0.75rem", lineHeight: 1.7 }}>
      {/* Prefix row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.7rem",
          color: prefix.color,
          flexShrink: 0,
          marginTop: "0.05rem",
          textShadow: `0 0 6px ${prefix.color}`,
        }}>
          {prefix.symbol}
        </span>
        <span style={{
          fontFamily: "var(--font-pixel)",
          fontSize: "0.42rem",
          color: COLORS.dim,
          flexShrink: 0,
          marginTop: "0.1rem",
          letterSpacing: "0.05em",
        }}>
          [{line.role.toUpperCase()}]
        </span>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.45rem",
          color: COLORS.dimmer,
          flexShrink: 0,
          marginTop: "0.12rem",
        }}>
          {formatTime(line.timestamp)}
        </span>
      </div>

      {/* Content */}
      <div style={{
        fontFamily: "var(--font-mono)",
        fontSize: "0.72rem",
        color: textColor,
        paddingLeft: "1.5rem",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        lineHeight: 1.8,
        textShadow: `0 0 8px ${textColor}40`,
      }}>
        {line.content}
        {line.streaming && (
          <span className="blink" style={{ color: COLORS.green, marginLeft: 2 }}>█</span>
        )}
      </div>

      {/* Citations */}
      {line.citations && line.citations.length > 0 && (
        <div style={{ paddingLeft: "1.5rem", marginTop: "0.3rem" }}>
          {line.citations.map((c, i) => (
            <div key={i} style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.6rem",
              color: COLORS.cyan,
              opacity: 0.7,
            }}>
              [WEB-{i+1}] {c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Boot sequence line ─────────────────────────────────────────────────────────
function BootLine({ text, color }: { text: string; color: string }) {
  return (
    <div style={{
      fontFamily: text.includes("━") ? "var(--font-mono)" : "var(--font-pixel)",
      fontSize: text.includes("━") ? "0.7rem" : "0.55rem",
      color,
      letterSpacing: text.includes("━") ? 0 : "0.08em",
      lineHeight: 1.8,
      textShadow: `0 0 8px ${color}50`,
    }}>
      {text || "\u00A0"}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TerminalChat() {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [bootLines, setBootLines] = useState<typeof BOOT_LINES>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdIndex, setCmdIndex] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Live dashboard data for /status command
  const { data: dashData } = useQuery({ queryKey: ["/api/dashboard"], refetchInterval: 10000 });

  // Boot animation
  useEffect(() => {
    let i = 0;
    let cancelled = false;
    const show = () => {
      if (cancelled || i >= BOOT_LINES.length) return;
      const line = BOOT_LINES[i];
      if (!line) return;
      setBootLines(prev => [...prev, line]);
      i++;
      setTimeout(show, 80);
    };
    const t = setTimeout(show, 100);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, bootLines, isStreaming]);

  // Focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const addLine = useCallback((role: MessageRole, content: string, extra: Partial<ChatLine> = {}) => {
    const line: ChatLine = { id: uid(), role, content, timestamp: new Date(), ...extra };
    setLines(prev => [...prev, line]);
    return line.id;
  }, []);

  const updateLine = useCallback((id: string, update: Partial<ChatLine>) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...update } : l));
  }, []);

  const handleClear = useCallback(() => {
    setLines([]);
    setBootLines([]);
    // Also clear server history
    apiRequest("DELETE", "/api/chat/history").catch(() => {});
    addLine("system", "TERMINAL CLEARED. SESSION HISTORY RESET.");
  }, [addLine]);

  const handleStatus = useCallback(() => {
    const d: any = dashData || {};
    const statusText = [
      `BOT STATUS: ${d.isRunning ? "● ACTIVE" : "○ STANDBY"}`,
      `BALANCE   : $${d.totalBalance?.toFixed(2) || "N/A"}`,
      `TODAY PNL : ${(d.todayPnl || 0) >= 0 ? "+" : ""}$${(d.todayPnl || 0).toFixed(2)}`,
      `WIN RATE  : ${d.winRate?.rate ? (d.winRate.rate * 100).toFixed(1) : "N/A"}% (${d.winRate?.wins || 0}/${d.winRate?.total || 0})`,
      `TRADES    : ${d.todayCount || 0} today`,
      `BTC PRICE : $${d.btcPrice?.price?.toLocaleString() || "N/A"}`,
    ].join("\n");
    addLine("system", statusText);
  }, [dashData, addLine]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    // Save to command history
    setCmdHistory(prev => [trimmed, ...prev.slice(0, 49)]);
    setCmdIndex(-1);
    setInput("");

    // Handle slash commands
    if (trimmed === "/clear") { handleClear(); return; }
    if (trimmed === "/status") { addLine("user", "/status"); handleStatus(); return; }
    if (trimmed === "/help") { addLine("user", "/help"); addLine("system", HELP_TEXT); return; }

    // Show user message
    addLine("user", trimmed);

    // Streaming assistant response
    setIsStreaming(true);
    const assistantId = addLine("assistant", "", { streaming: true });

    try {
      // Use fetch directly for SSE streaming (apiRequest doesn't support it)
      const RENDER_URL = "https://cryptonite-wt0e.onrender.com";
      const API_BASE = typeof window !== "undefined" && window.location.hostname !== "localhost"
        ? RENDER_URL : "";

      abortRef.current = new AbortController();

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: trimmed }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        updateLine(assistantId, { content: `ERROR: ${err}`, streaming: false });
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let citations: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const data = part.slice(6).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.error) {
              fullContent += `\nERROR: ${parsed.error}`;
              updateLine(assistantId, { content: fullContent, streaming: false });
              setIsStreaming(false);
              return;
            }

            if (parsed.delta) {
              fullContent += parsed.delta;
              updateLine(assistantId, { content: fullContent, streaming: true });
            }

            if (parsed.citations) {
              citations = [...citations, ...parsed.citations];
              updateLine(assistantId, { citations });
            }

            if (parsed.done) {
              updateLine(assistantId, { content: fullContent, streaming: false, citations: citations.length ? citations : undefined });
              setIsStreaming(false);
            }
          } catch {
            // skip malformed
          }
        }
      }

      // Ensure streaming flag cleared
      updateLine(assistantId, { streaming: false });
      setIsStreaming(false);

    } catch (err: any) {
      if (err.name === "AbortError") {
        updateLine(assistantId, { content: "[ABORTED]", streaming: false });
      } else {
        updateLine(assistantId, { content: `CONNECTION ERROR: ${err.message}`, streaming: false });
      }
      setIsStreaming(false);
    }
  }, [isStreaming, addLine, updateLine, handleClear, handleStatus]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      sendMessage(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(cmdIndex + 1, cmdHistory.length - 1);
      setCmdIndex(next);
      setInput(cmdHistory[next] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(cmdIndex - 1, -1);
      setCmdIndex(next);
      setInput(next === -1 ? "" : cmdHistory[next] || "");
    } else if (e.key === "Escape" && isStreaming) {
      abortRef.current?.abort();
    }
  };

  return (
    <div
      style={{
        height: "calc(100vh - 2.5rem)",
        display: "flex",
        flexDirection: "column",
        background: COLORS.bg,
        fontFamily: "var(--font-mono)",
        position: "relative",
        overflow: "hidden",
      }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* Scanline overlay */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10,
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)",
      }} />

      {/* Header bar */}
      <div style={{
        background: COLORS.bg2,
        borderBottom: `1px solid ${COLORS.dimmer}`,
        padding: "0.5rem 1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        zIndex: 5,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: "0.55rem", color: COLORS.green, letterSpacing: "0.1em", textShadow: `0 0 8px ${COLORS.green}` }}>
            ◈ POLYBOT-AI TERMINAL
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: COLORS.dimmer }}>GROK-3 · WEB-ENABLED</span>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            onClick={(e) => { e.stopPropagation(); handleStatus(); }}
            style={{ background: "none", border: `1px solid ${COLORS.dimmer}`, color: COLORS.cyan, fontFamily: "var(--font-pixel)", fontSize: "0.42rem", padding: "0.2rem 0.5rem", cursor: "pointer", letterSpacing: "0.06em" }}
          >
            /STATUS
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleClear(); }}
            style={{ background: "none", border: `1px solid ${COLORS.dimmer}`, color: COLORS.dim, fontFamily: "var(--font-pixel)", fontSize: "0.42rem", padding: "0.2rem 0.5rem", cursor: "pointer", letterSpacing: "0.06em" }}
          >
            /CLEAR
          </button>
        </div>
      </div>

      {/* Terminal output area */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "1rem 1.25rem 0.5rem",
        zIndex: 5,
        scrollbarWidth: "thin",
        scrollbarColor: `${COLORS.dimmer} transparent`,
      }}>
        {/* Boot lines */}
        {bootLines.filter(Boolean).map((bl, i) => (
          <BootLine key={i} text={bl?.text ?? ""} color={bl?.color ?? COLORS.dim} />
        ))}

        {/* Chat lines */}
        {lines.map(line => (
          <TerminalLine key={line.id} line={line} />
        ))}

        {/* Streaming indicator */}
        {isStreaming && lines.every(l => !l.streaming) && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: COLORS.dim }}>
            <span className="blink">█</span> PROCESSING...
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{
        borderTop: `1px solid ${COLORS.dimmer}`,
        padding: "0.75rem 1.25rem",
        background: COLORS.bg2,
        flexShrink: 0,
        zIndex: 5,
      }}>
        {/* Suggestion chips */}
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          {[
            "Analyze my win rate",
            "Latest BTC news",
            "Optimize my bet size",
            "Explain CLOB strategy",
          ].map(s => (
            <button
              key={s}
              onClick={(e) => { e.stopPropagation(); setInput(s); inputRef.current?.focus(); }}
              style={{
                background: "transparent",
                border: `1px solid ${COLORS.dimmer}`,
                borderRadius: "2px",
                color: COLORS.dim,
                fontFamily: "var(--font-mono)",
                fontSize: "0.58rem",
                padding: "0.15rem 0.5rem",
                cursor: "pointer",
                transition: "all 0.1s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = COLORS.green3; (e.currentTarget as HTMLButtonElement).style.color = COLORS.green2; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = COLORS.dimmer; (e.currentTarget as HTMLButtonElement).style.color = COLORS.dim; }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Input row */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: COLORS.amber, flexShrink: 0, textShadow: `0 0 6px ${COLORS.amber}` }}>❯</span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            placeholder={isStreaming ? "PROCESSING... (ESC to abort)" : "Enter command or question..."}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: "var(--font-mono)",
              fontSize: "0.72rem",
              color: isStreaming ? COLORS.dim : COLORS.amber,
              caretColor: COLORS.green,
              letterSpacing: "0.02em",
            }}
          />
          <button
            onClick={(e) => { e.stopPropagation(); isStreaming ? abortRef.current?.abort() : sendMessage(input); }}
            style={{
              background: isStreaming ? "transparent" : `${COLORS.green}15`,
              border: `1px solid ${isStreaming ? COLORS.red : COLORS.green}60`,
              borderRadius: "2px",
              color: isStreaming ? COLORS.red : COLORS.green,
              fontFamily: "var(--font-pixel)",
              fontSize: "0.42rem",
              padding: "0.3rem 0.6rem",
              cursor: "pointer",
              letterSpacing: "0.08em",
              flexShrink: 0,
            }}
          >
            {isStreaming ? "ABORT" : "SEND"}
          </button>
        </div>

        {/* Hint */}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.55rem", color: COLORS.dimmer, marginTop: "0.35rem" }}>
          ↑↓ history · ESC abort · /help · /clear · /status
        </div>
      </div>
    </div>
  );
}
