/**
 * TerminalChat.tsx — Retro CRT terminal chat powered by Grok + web search
 * Enhanced: bigger text, better readability, markdown rendering, improved contrast
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
const C = {
  green:   "hsl(120 100% 55%)",
  green2:  "hsl(120 100% 45%)",
  green3:  "hsl(120 60% 30%)",
  amber:   "hsl(45 100% 60%)",
  cyan:    "hsl(175 90% 60%)",
  red:     "hsl(0 90% 65%)",
  dim:     "hsl(120 40% 45%)",
  dimmer:  "hsl(120 20% 25%)",
  bg:      "hsl(220 20% 3%)",
  bg2:     "hsl(220 20% 5%)",
  bg3:     "hsl(220 20% 7%)",
  border:  "hsl(120 30% 14%)",
  purple:  "hsl(270 80% 70%)",
  gold:    "hsl(45 100% 50%)",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2); }

function formatTime(d: Date) {
  return d.toTimeString().slice(0, 8);
}

const BOOT_LINES = [
  { text: "╔══════════════════════════════════════════════════════╗", color: C.green3, delay: 0 },
  { text: "║   POLYBOT-AI TERMINAL  v3.0  ◈  GROK ENGINE          ║", color: C.green,  delay: 70 },
  { text: "╚══════════════════════════════════════════════════════╝", color: C.green3, delay: 140 },
  { text: "► NEURAL ENGINE . . . GROK-3 [xAI]  ✓", color: C.cyan,  delay: 220 },
  { text: "► WEB SEARCH . . . . . ENABLED       ✓", color: C.cyan,  delay: 300 },
  { text: "► PORTFOLIO CONTEXT . . LIVE         ✓", color: C.green, delay: 380 },
  { text: "► SESSION AUTH . . . . . SECURE      ✓", color: C.green, delay: 460 },
  { text: "─────────────────────────────────────────────────────────", color: C.dimmer, delay: 540 },
  { text: "Type your question or use /help for commands.", color: C.amber, delay: 620 },
  { text: "", color: C.dim, delay: 680 },
];

const HELP_TEXT = `┌─────────────────────────────────────────────────────┐
│  AVAILABLE COMMANDS                                 │
├─────────────────────────────────────────────────────┤
│  /clear    — Clear terminal history                 │
│  /status   — Show live bot status                   │
│  /help     — Show this help message                 │
│  ESC       — Abort streaming response               │
├─────────────────────────────────────────────────────┤
│  EXAMPLE QUERIES                                    │
├─────────────────────────────────────────────────────┤
│  > What is the Kelly Criterion for my bet size?     │
│  > Search for latest BTC market news                │
│  > Analyze my win rate and suggest improvements     │
│  > Explain order book imbalance trading             │
│  > What Polymarket markets should I watch?          │
│  > Review my portfolio and suggest rebalancing      │
└─────────────────────────────────────────────────────┘`;

// ── Markdown-lite renderer ─────────────────────────────────────────────────────
// Parses **bold**, `code`, # headers, - lists, numbered lists, > quotes
function renderMarkdown(text: string, textColor: string): React.ReactNode[] {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const key = i;

    // Horizontal rule
    if (/^[-─═]{3,}$/.test(line.trim())) {
      return <div key={key} style={{ color: C.dimmer, marginBottom: 4 }}>{line}</div>;
    }

    // H1 header
    if (line.startsWith("# ")) {
      return (
        <div key={key} style={{ color: C.cyan, fontWeight: "bold", fontSize: "1.05em", marginTop: 12, marginBottom: 4, letterSpacing: "0.06em", textShadow: `0 0 10px ${C.cyan}60` }}>
          ◈ {line.slice(2)}
        </div>
      );
    }

    // H2 header
    if (line.startsWith("## ")) {
      return (
        <div key={key} style={{ color: C.amber, fontWeight: "bold", fontSize: "0.98em", marginTop: 10, marginBottom: 3, letterSpacing: "0.04em" }}>
          ▸ {line.slice(3)}
        </div>
      );
    }

    // H3 header
    if (line.startsWith("### ")) {
      return (
        <div key={key} style={{ color: C.green2, fontSize: "0.94em", marginTop: 8, marginBottom: 2 }}>
          › {line.slice(4)}
        </div>
      );
    }

    // Blockquote
    if (line.startsWith("> ")) {
      return (
        <div key={key} style={{ borderLeft: `3px solid ${C.cyan}60`, paddingLeft: 10, color: C.dim, fontStyle: "italic", marginBottom: 2 }}>
          {inlineMarkdown(line.slice(2), C.dim)}
        </div>
      );
    }

    // Unordered list
    if (/^[-*•] /.test(line)) {
      return (
        <div key={key} style={{ display: "flex", gap: 8, marginBottom: 2 }}>
          <span style={{ color: C.amber, flexShrink: 0 }}>▸</span>
          <span>{inlineMarkdown(line.slice(2), textColor)}</span>
        </div>
      );
    }

    // Ordered list
    const olMatch = line.match(/^(\d+)\. (.*)/);
    if (olMatch) {
      return (
        <div key={key} style={{ display: "flex", gap: 8, marginBottom: 2 }}>
          <span style={{ color: C.amber, flexShrink: 0, minWidth: 20 }}>{olMatch[1]}.</span>
          <span>{inlineMarkdown(olMatch[2], textColor)}</span>
        </div>
      );
    }

    // Empty line → spacer
    if (!line.trim()) {
      return <div key={key} style={{ height: 6 }} />;
    }

    // Normal line
    return (
      <div key={key} style={{ marginBottom: 2 }}>
        {inlineMarkdown(line, textColor)}
      </div>
    );
  });
}

function inlineMarkdown(text: string, defaultColor: string): React.ReactNode {
  // Handle **bold**, `code`, *italic*
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let idx = 0;

  const patterns = [
    { re: /\*\*(.+?)\*\*/, render: (m: string) => <strong key={idx++} style={{ color: C.amber, fontWeight: "bold" }}>{m}</strong> },
    { re: /`([^`]+)`/, render: (m: string) => <code key={idx++} style={{ background: C.bg3, color: C.cyan, padding: "1px 5px", fontFamily: "var(--font-mono)", fontSize: "0.92em", border: `1px solid ${C.border}` }}>{m}</code> },
    { re: /\*(.+?)\*/, render: (m: string) => <em key={idx++} style={{ color: C.purple, fontStyle: "italic" }}>{m}</em> },
  ];

  while (remaining.length > 0) {
    let earliest: { index: number; full: string; content: string; render: (m: string) => React.ReactNode } | null = null;

    for (const pat of patterns) {
      const match = remaining.match(pat.re);
      if (match && match.index !== undefined) {
        if (!earliest || match.index < earliest.index) {
          earliest = { index: match.index, full: match[0], content: match[1], render: pat.render };
        }
      }
    }

    if (!earliest) {
      parts.push(<span key={idx++}>{remaining}</span>);
      break;
    }

    if (earliest.index > 0) {
      parts.push(<span key={idx++}>{remaining.slice(0, earliest.index)}</span>);
    }
    parts.push(earliest.render(earliest.content));
    remaining = remaining.slice(earliest.index + earliest.full.length);
  }

  return <>{parts}</>;
}

// ── Line renderer ──────────────────────────────────────────────────────────────
function TerminalLine({ line }: { line: ChatLine }) {
  const prefix = {
    user:      { symbol: "❯", color: C.amber  },
    assistant: { symbol: "◈", color: C.green  },
    system:    { symbol: "◆", color: C.cyan   },
    web:       { symbol: "⊕", color: C.cyan   },
  }[line.role];

  const textColor = {
    user:      C.amber,
    assistant: C.green,
    system:    C.cyan,
    web:       C.cyan,
  }[line.role];

  const isAssistant = line.role === "assistant";
  const isSystem    = line.role === "system";

  return (
    <div style={{
      marginBottom: "1rem",
      background: isAssistant ? `${C.green}06` : "transparent",
      border: isAssistant ? `1px solid ${C.border}` : "1px solid transparent",
      borderRadius: 2,
      padding: isAssistant ? "8px 12px 8px 12px" : "0",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: 6 }}>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.95rem",
          color: prefix.color,
          flexShrink: 0,
          textShadow: `0 0 8px ${prefix.color}`,
        }}>
          {prefix.symbol}
        </span>
        <span style={{
          fontFamily: "var(--font-pixel)",
          fontSize: "0.6rem",
          color: prefix.color,
          flexShrink: 0,
          letterSpacing: "0.08em",
          textShadow: `0 0 6px ${prefix.color}60`,
          background: `${prefix.color}18`,
          padding: "1px 6px",
          border: `1px solid ${prefix.color}30`,
        }}>
          {line.role.toUpperCase()}
        </span>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.65rem",
          color: C.dimmer,
          flexShrink: 0,
        }}>
          {formatTime(line.timestamp)}
        </span>
        {line.streaming && (
          <span style={{ fontSize: "0.6rem", color: C.dim, animation: "pulse 1s infinite" }}>
            ● STREAMING
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{
        fontFamily: "var(--font-mono)",
        fontSize: "0.88rem",
        color: textColor,
        paddingLeft: isSystem ? 0 : "1.2rem",
        lineHeight: 1.85,
        wordBreak: "break-word",
        textShadow: `0 0 10px ${textColor}30`,
        whiteSpace: isSystem ? "pre-wrap" : undefined,
      }}>
        {(isAssistant || isSystem) && !line.streaming
          ? renderMarkdown(line.content, textColor)
          : <span>{line.content}</span>
        }
        {line.streaming && (
          <span className="blink" style={{ color: C.green, marginLeft: 2 }}>█</span>
        )}
      </div>

      {/* Citations */}
      {line.citations && line.citations.length > 0 && (
        <div style={{ paddingLeft: "1.2rem", marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
          <div style={{ fontFamily: "var(--font-pixel)", fontSize: "0.55rem", color: C.dim, letterSpacing: "0.08em", marginBottom: 4 }}>
            ◈ WEB SOURCES
          </div>
          {line.citations.map((c, i) => (
            <div key={i} style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.72rem",
              color: C.cyan,
              opacity: 0.8,
              marginBottom: 2,
            }}>
              <span style={{ color: C.dimmer }}>[{i+1}]</span> {c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Boot sequence line ─────────────────────────────────────────────────────────
function BootLine({ text, color }: { text: string; color: string }) {
  const isBox = text.startsWith("╔") || text.startsWith("╚") || text.startsWith("║");
  return (
    <div style={{
      fontFamily: "var(--font-mono)",
      fontSize: isBox ? "0.78rem" : "0.75rem",
      color,
      letterSpacing: isBox ? 0 : "0.04em",
      lineHeight: 1.9,
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
  const { data: dashData } = useQuery({ queryKey: ["/api/dashboard"], refetchInterval: 30000, staleTime: 20000 });

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
      setTimeout(show, 70);
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
    apiRequest("DELETE", "/api/chat/history").catch(() => {});
    addLine("system", "TERMINAL CLEARED. SESSION HISTORY RESET.");
  }, [addLine]);

  const handleStatus = useCallback(() => {
    const d: any = dashData || {};
    const running = d.isRunning ? "● ACTIVE" : "○ STANDBY";
    const pnlStr  = (d.todayPnl || 0) >= 0 ? `+$${(d.todayPnl || 0).toFixed(2)}` : `-$${Math.abs(d.todayPnl || 0).toFixed(2)}`;
    const wr      = d.winRate?.rate ? (d.winRate.rate * 100).toFixed(1) : "N/A";
    const statusText = [
      "┌──────────────────────────────────┐",
      `│  BOT STATUS  : ${running.padEnd(16)}│`,
      `│  BALANCE     : $${(d.totalBalance?.toFixed(2) || "N/A").padEnd(15)}│`,
      `│  TODAY PNL   : ${pnlStr.padEnd(16)}│`,
      `│  WIN RATE    : ${(wr + "%").padEnd(16)}│`,
      `│  TRADES TODAY: ${String(d.todayCount || 0).padEnd(16)}│`,
      `│  BTC PRICE   : $${(d.btcPrice?.price?.toLocaleString() || "N/A").padEnd(14)}│`,
      "└──────────────────────────────────┘",
    ].join("\n");
    addLine("system", statusText);
  }, [dashData, addLine]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    setCmdHistory(prev => [trimmed, ...prev.slice(0, 49)]);
    setCmdIndex(-1);
    setInput("");

    if (trimmed === "/clear") { handleClear(); return; }
    if (trimmed === "/status") { addLine("user", "/status"); handleStatus(); return; }
    if (trimmed === "/help")   { addLine("user", "/help");   addLine("system", HELP_TEXT); return; }

    addLine("user", trimmed);

    setIsStreaming(true);
    const assistantId = addLine("assistant", "", { streaming: true });

    try {
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
        updateLine(assistantId, { content: `ERROR ${res.status}: ${err}`, streaming: false });
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

      updateLine(assistantId, { streaming: false });
      setIsStreaming(false);

    } catch (err: any) {
      if (err.name === "AbortError") {
        updateLine(assistantId, { content: "[RESPONSE ABORTED BY USER]", streaming: false });
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

  const SUGGESTIONS = [
    "Analyze my win rate",
    "Latest BTC news",
    "Optimize my bet size",
    "Review my portfolio",
    "Show trading signals",
  ];

  return (
    <div
      style={{
        height: "calc(100vh - 2.5rem)",
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        fontFamily: "var(--font-mono)",
        position: "relative",
        overflow: "hidden",
      }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* Scanline overlay */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10,
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.08) 3px, rgba(0,0,0,0.08) 4px)",
      }} />

      {/* Header bar */}
      <div style={{
        background: C.bg2,
        borderBottom: `1px solid ${C.border}`,
        padding: "0.55rem 1.25rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        zIndex: 5,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: "0.65rem", color: C.green, letterSpacing: "0.1em", textShadow: `0 0 10px ${C.green}` }}>
            ◈ POLYBOT-AI TERMINAL
          </span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: C.cyan,
            background: `${C.cyan}18`, padding: "1px 8px", border: `1px solid ${C.cyan}30`,
          }}>
            GROK-3 · WEB-ENABLED
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={(e) => { e.stopPropagation(); handleStatus(); }}
            style={{
              background: "none", border: `1px solid ${C.border}`, color: C.cyan,
              fontFamily: "var(--font-pixel)", fontSize: "0.52rem",
              padding: "0.25rem 0.65rem", cursor: "pointer", letterSpacing: "0.06em",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${C.cyan}20`; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
          >
            /STATUS
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleClear(); }}
            style={{
              background: "none", border: `1px solid ${C.border}`, color: C.dimmer,
              fontFamily: "var(--font-pixel)", fontSize: "0.52rem",
              padding: "0.25rem 0.65rem", cursor: "pointer", letterSpacing: "0.06em",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = C.dim; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = C.dimmer; }}
          >
            /CLEAR
          </button>
        </div>
      </div>

      {/* Terminal output area */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "1.25rem 1.5rem 0.5rem",
        zIndex: 5,
        scrollbarWidth: "thin",
        scrollbarColor: `${C.dimmer} transparent`,
      }}>
        {/* Boot lines */}
        {bootLines.filter(Boolean).map((bl, i) => (
          <BootLine key={i} text={bl?.text ?? ""} color={bl?.color ?? C.dim} />
        ))}

        {/* Chat lines */}
        {lines.map(line => (
          <TerminalLine key={line.id} line={line} />
        ))}

        {/* Streaming indicator (when no lines yet) */}
        {isStreaming && lines.every(l => !l.streaming) && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", color: C.dim, display: "flex", alignItems: "center", gap: 8 }}>
            <span className="blink">█</span>
            <span>GROK IS THINKING...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{
        borderTop: `1px solid ${C.border}`,
        padding: "0.85rem 1.5rem",
        background: C.bg2,
        flexShrink: 0,
        zIndex: 5,
      }}>
        {/* Suggestion chips */}
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={(e) => { e.stopPropagation(); setInput(s); inputRef.current?.focus(); }}
              style={{
                background: "transparent",
                border: `1px solid ${C.dimmer}`,
                borderRadius: "2px",
                color: C.dim,
                fontFamily: "var(--font-mono)",
                fontSize: "0.7rem",
                padding: "0.2rem 0.6rem",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = C.green3;
                (e.currentTarget as HTMLButtonElement).style.color = C.green;
                (e.currentTarget as HTMLButtonElement).style.background = `${C.green}10`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = C.dimmer;
                (e.currentTarget as HTMLButtonElement).style.color = C.dim;
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Input row */}
        <div style={{
          display: "flex", alignItems: "center", gap: "0.75rem",
          background: C.bg3, border: `1px solid ${isStreaming ? C.green3 : C.border}`,
          padding: "0.5rem 0.75rem",
          boxShadow: isStreaming ? `0 0 12px ${C.green}20` : "none",
          transition: "all 0.2s",
        }}>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: "1rem",
            color: isStreaming ? C.dim : C.amber, flexShrink: 0,
            textShadow: isStreaming ? "none" : `0 0 8px ${C.amber}`,
          }}>❯</span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            placeholder={isStreaming ? "GENERATING... (ESC to abort)" : "Enter command or question..."}
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
              fontSize: "0.88rem",
              color: isStreaming ? C.dim : C.amber,
              caretColor: C.green,
              letterSpacing: "0.02em",
            }}
          />
          <button
            onClick={(e) => { e.stopPropagation(); isStreaming ? abortRef.current?.abort() : sendMessage(input); }}
            style={{
              background: isStreaming ? `${C.red}15` : `${C.green}15`,
              border: `1px solid ${isStreaming ? C.red : C.green}60`,
              borderRadius: "2px",
              color: isStreaming ? C.red : C.green,
              fontFamily: "var(--font-pixel)",
              fontSize: "0.52rem",
              padding: "0.3rem 0.75rem",
              cursor: "pointer",
              letterSpacing: "0.1em",
              flexShrink: 0,
              transition: "all 0.15s",
            }}
          >
            {isStreaming ? "■ ABORT" : "► SEND"}
          </button>
        </div>

        {/* Hint */}
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: "0.63rem",
          color: C.dimmer, marginTop: "0.4rem",
          display: "flex", gap: "1rem",
        }}>
          <span>↑↓ history</span>
          <span>ESC abort stream</span>
          <span>/help /clear /status</span>
          {isStreaming && <span style={{ color: C.green, animation: "pulse 1s infinite" }}>● streaming</span>}
        </div>
      </div>
    </div>
  );
}
