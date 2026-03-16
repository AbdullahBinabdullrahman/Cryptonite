import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  TrendingUp, TrendingDown, Zap, Clock, DollarSign,
  Activity, ArrowUpRight, ArrowDownRight, Brain, Target, RefreshCw
} from "lucide-react";
import React, { useState } from "react";
import { useLiveData, AssetKey } from "@/hooks/useLiveData";
import { MiniSparkline } from "@/components/MiniSparkline";
import { ConnectionStatus } from "@/components/ConnectionStatus";

// ── Pixel section header ──────────────────────────────────────────────────────
function PixelLabel({ text, color = "hsl(120 40% 35%)" }: { text: string; color?: string }) {
  return (
    <div style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color, letterSpacing: "0.1em", textTransform: "uppercase" }}>
      {text}
    </div>
  );
}

// ── Asset selector tab ────────────────────────────────────────────────────────
function AssetTab({ assetKey, selected, onClick }: { assetKey: AssetKey; selected: boolean; onClick: () => void }) {
  const { assets } = useLiveData(5000);
  const a = assets[assetKey];
  const colorMap: Record<AssetKey, string> = {
    BTC: "hsl(45 100% 55%)",
    ETH: "hsl(175 90% 55%)",
    SOL: "hsl(120 100% 55%)",
  };
  const symMap: Record<AssetKey, string> = { BTC: "₿", ETH: "Ξ", SOL: "◎" };
  const col = colorMap[assetKey];
  const isUp = (a?.change5m ?? 0) >= 0;

  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 12px",
        background: selected ? `${col}10` : "hsl(220 20% 5%)",
        border: `1px solid ${selected ? `${col}50` : "hsl(120 30% 12%)"}`,
        boxShadow: selected ? `0 0 14px ${col}20` : "none",
        cursor: "pointer",
        transition: "all 0.15s ease",
        textAlign: "left" as const,
        position: "relative" as const,
      }}
    >
      {selected && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${col}, transparent)` }} />
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: 10, color: selected ? col : "hsl(120 25% 30%)", textShadow: selected ? `0 0 8px ${col}80` : "none" }}>
            {symMap[assetKey]}
          </span>
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: selected ? col : "hsl(120 25% 30%)", letterSpacing: "0.05em" }}>
            {assetKey}
          </span>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: isUp ? "hsl(120 100% 55%)" : "hsl(0 90% 55%)" }}>
          {isUp ? "▲" : "▼"}{(a?.change5m ?? 0).toFixed(2)}%
        </span>
      </div>
      <div style={{ fontFamily: "var(--font-pixel)", fontSize: 10, color: selected ? "hsl(120 90% 70%)" : "hsl(120 30% 35%)" }}>
        {a ? (a.price >= 1000 ? "$" + a.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "$" + a.price.toFixed(2)) : "----"}
      </div>
      {a && <div style={{ marginTop: 4 }}><MiniSparkline data={a.history} width={80} height={16} /></div>}
    </button>
  );
}

// ── CLOB market card ──────────────────────────────────────────────────────────
function ClobMarketCard({ m }: { m: any }) {
  const hasEdge  = m.hasEdge;
  const mins     = Math.floor(m.timeLeft / 60);
  const secs     = m.timeLeft % 60;
  const timeStr  = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const yesP     = Math.round(m.yesPrice * 100);
  const noP      = Math.round(m.noPrice * 100);
  const modelP   = Math.round(m.posterior * 100);

  return (
    <div
      style={{
        background: "hsl(220 20% 5%)",
        border: `1px solid ${hasEdge ? "hsl(45 100% 55% / 0.35)" : "hsl(120 30% 12%)"}`,
        boxShadow: hasEdge ? "0 0 14px hsl(45 100% 55% / 0.1)" : "none",
        padding: "12px",
        position: "relative",
        transition: "border-color 0.2s",
      }}
    >
      {/* Edge indicator */}
      {hasEdge && (
        <div style={{ position: "absolute", top: 0, right: 0, padding: "3px 8px", background: "hsl(45 100% 55% / 0.12)", border: "1px solid hsl(45 100% 55% / 0.3)", borderTop: "none", borderRight: "none" }}>
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(45 100% 65%)", letterSpacing: "0.08em" }}>⚡ EDGE</span>
        </div>
      )}

      {/* Question */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 70% 60%)", marginBottom: 10, lineHeight: 1.4, paddingRight: hasEdge ? 50 : 0 }}>
        {m.question}
      </div>

      {/* Odds bar */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(120 100% 55%)", letterSpacing: "0.05em" }}>YES {yesP}¢</span>
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(0 90% 60%)", letterSpacing: "0.05em" }}>NO {noP}¢</span>
        </div>
        {/* Bar */}
        <div style={{ height: 6, background: "hsl(220 20% 4%)", border: "1px solid hsl(120 30% 12%)", overflow: "hidden", position: "relative" }}>
          <div style={{ width: `${yesP}%`, height: "100%", background: "linear-gradient(90deg, hsl(120 80% 35%), hsl(120 100% 50%))", transition: "width 0.7s ease" }} />
          {/* Model marker */}
          <div style={{
            position: "absolute", top: 0, bottom: 0, width: 2,
            left: `${modelP}%`,
            background: "hsl(45 100% 55%)",
            boxShadow: "0 0 4px hsl(45 100% 55%)",
          }} title={`Model: ${modelP}%`} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "hsl(45 100% 55%)" }}>◆ MODEL {modelP}%</span>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 35%)", display: "flex", alignItems: "center", gap: 3 }}>
          <DollarSign size={9} />${(m.liquidity / 1000).toFixed(0)}k
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 35%)", display: "flex", alignItems: "center", gap: 3 }}>
          <Clock size={9} />{timeStr}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: hasEdge ? "hsl(45 100% 60%)" : "hsl(120 20% 25%)", display: "flex", alignItems: "center", gap: 3 }}>
          {hasEdge ? <><Zap size={9} />{m.evNet.toFixed(2)}% EV</> : "NO EDGE"}
        </span>
      </div>

      {/* Trade signal */}
      {hasEdge && (
        <div style={{
          borderTop: "1px dashed hsl(45 100% 55% / 0.2)",
          paddingTop: 6,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 25% 30%)", letterSpacing: "0.08em" }}>SIGNAL:</span>
          <span style={{
            fontFamily: "var(--font-pixel)", fontSize: 7, letterSpacing: "0.06em",
            color: m.side === "YES" ? "hsl(120 100% 60%)" : "hsl(0 90% 60%)",
            textShadow: m.side === "YES" ? "0 0 6px hsl(120 100% 50%)" : "0 0 6px hsl(0 90% 55%)",
          }}>
            BUY {m.side} @ {m.side === "YES" ? yesP : noP}¢
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Markets() {
  const [activeTab, setActiveTab] = useState<AssetKey>("BTC");
  const { assets } = useLiveData(5000);

  const { data: clobData, isLoading: clobLoading, refetch: refetchClob } = useQuery({
    queryKey: ["/api/clob/markets"],
    queryFn: () => apiRequest("GET", "/api/clob/markets").then((r) => r.json()),
    refetchInterval: 15000,
  });

  const allMarkets: any[]  = clobData?.markets ?? [];
  const bayesMap: any      = clobData?.bayesState ?? {};
  const prices: any        = clobData?.prices ?? {};
  const filtered           = allMarkets.filter((m: any) => m.asset === activeTab);
  const bayes              = bayesMap[activeTab];
  const assetPrice         = prices[activeTab] ?? assets[activeTab]?.price ?? 0;
  const edgeCount          = allMarkets.filter((m: any) => m.hasEdge).length;

  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "var(--font-pixel)", fontSize: 10, color: "hsl(120 100% 60%)", letterSpacing: "0.1em", marginBottom: 3, textShadow: "0 0 10px hsl(120 100% 50% / 0.4)" }}>
            ══ MARKET SCANNER ══
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 35%)" }}>
            LIVE POLYMARKET 5-MIN MARKETS · BAYESIAN EDGE DETECTION
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => refetchClob()}
            style={{ background: "none", border: "1px solid hsl(120 30% 15%)", padding: "5px 7px", cursor: "pointer", color: "hsl(120 40% 40%)" }}
          >
            <RefreshCw size={12} />
          </button>
          <div className="pulse-dot" style={{ width: 5, height: 5, background: "hsl(120 100% 55%)", boxShadow: "0 0 6px hsl(120 100% 50%)" }} />
          <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(120 80% 55%)", letterSpacing: "0.08em" }}>LIVE</span>
        </div>
      </div>

      {/* Connection status */}
      <ConnectionStatus compact refetchInterval={60000} />

      {/* ── Edge banner ── */}
      {edgeCount > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px",
          border: "1px solid hsl(45 100% 55% / 0.35)",
          background: "hsl(45 100% 55% / 0.06)",
          boxShadow: "0 0 16px hsl(45 100% 55% / 0.08)",
        }}>
          <Zap size={14} style={{ color: "hsl(45 100% 55%)", flexShrink: 0, filter: "drop-shadow(0 0 4px hsl(45 100% 55%))" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(45 100% 60%)", letterSpacing: "0.08em" }}>
              {edgeCount} EDGE {edgeCount === 1 ? "OPPORTUNITY" : "OPPORTUNITIES"} DETECTED
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 35%)", marginTop: 2 }}>
              CLOB ENGINE AUTO-BETTING ON MISPRICINGS EVERY 10s
            </div>
          </div>
          <span style={{
            fontFamily: "var(--font-pixel)", fontSize: 6, padding: "3px 7px",
            border: "1px solid hsl(45 100% 55% / 0.4)",
            color: "hsl(45 100% 65%)",
            letterSpacing: "0.08em",
          }}>AUTO-ON</span>
        </div>
      )}

      {/* ── Asset tabs ── */}
      <div style={{ display: "flex", gap: 6 }}>
        {(["BTC", "ETH", "SOL"] as AssetKey[]).map((k) => (
          <AssetTab key={k} assetKey={k} selected={activeTab === k} onClick={() => setActiveTab(k)} />
        ))}
      </div>

      {/* ── Bayesian state ── */}
      {bayes && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[
            {
              label: "BAYESIAN P(UP)",
              value: `${Math.round(bayes.posterior * 100)}%`,
              color: bayes.posterior > 0.52 ? "hsl(120 100% 55%)" : bayes.posterior < 0.48 ? "hsl(0 90% 55%)" : "hsl(45 100% 55%)",
            },
            { label: "VARIANCE σ²", value: bayes.variance?.toFixed(8) ?? "—", color: "hsl(120 50% 45%)" },
            { label: "PRICE TICKS", value: String(bayes.ticks), color: "hsl(120 50% 45%)" },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              style={{
                padding: "7px 10px",
                background: "hsl(220 20% 5%)",
                border: `1px solid ${color}25`,
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              <span style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 25% 30%)", letterSpacing: "0.08em" }}>{label}:</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color, letterSpacing: "0.03em" }}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Markets grid ── */}
      {clobLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ height: 160, background: "hsl(220 20% 5%)", border: "1px solid hsl(120 30% 10%)" }}>
              <div style={{ padding: 12, fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 30%)" }}>LOADING<span className="blink">_</span></div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: "32px 20px", textAlign: "center",
          background: "hsl(220 20% 5%)",
          border: "1px solid hsl(120 30% 10%)",
        }}>
          <Activity size={24} style={{ color: "hsl(120 25% 25%)", margin: "0 auto 10px" }} />
          <div style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(120 30% 30%)", letterSpacing: "0.1em" }}>
            NO {activeTab} MARKETS FOUND
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 20% 25%)", marginTop: 6 }}>
            Polymarket may not have active 5-min {activeTab} markets right now.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
          {filtered.map((m: any, i: number) => (
            <ClobMarketCard key={i} m={m} />
          ))}
        </div>
      )}

      {/* ── Engine explanation ── */}
      <div style={{ background: "hsl(220 20% 5%)", border: "1px solid hsl(120 30% 10%)", padding: "14px" }}>
        <div style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(175 90% 55%)", letterSpacing: "0.1em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <Brain size={11} style={{ color: "hsl(175 90% 55%)" }} />
          ENGINE DOCUMENTATION
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
          {[
            { n: "01", title: "BAYESIAN UPDATE", desc: "P(H|D) = P(D|H)·P(H)/P(D) — probability updates every 10s using live price data as evidence." },
            { n: "02", title: "EV FILTER", desc: "EV = q − p − c — only bets where model price (q) beats market price (p) + fees (c). Min 0.5% edge." },
            { n: "03", title: "KELLY SIZING", desc: "f* = (b·p − q)/b — bet fraction scales with edge strength. $10–$100 per trade, auto-compound." },
          ].map(({ n, title, desc }) => (
            <div key={n}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(45 100% 55%)", letterSpacing: "0.1em" }}>#{n}</span>
                <span style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 70% 50%)", letterSpacing: "0.08em" }}>{title}</span>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 20% 30%)", lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
