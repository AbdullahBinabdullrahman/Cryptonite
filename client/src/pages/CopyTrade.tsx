import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  RefreshCw, Plus, Trash2, Pause, Play, ExternalLink,
  CheckCircle, XCircle, Clock, Zap, Trophy, Star,
  TrendingUp, Users, Target, GitMerge, Wallet
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ───────────────────────────────────────────────────────────────────
function shortAddr(addr: string) { return addr.slice(0, 6) + "…" + addr.slice(-4); }
function fmt$(n: number) { return (n >= 0 ? "+" : "") + n.toFixed(2); }
function fmtPct(n: number) { return (n >= 0 ? "+" : "") + n.toFixed(1) + "%"; }

// ── Design tokens (high contrast retro) ──────────────────────────────────────
const G  = "hsl(120 100% 65%)";   // bright phosphor green
const G2 = "hsl(120 100% 45%)";   // dim green
const AM = "hsl(45 100% 65%)";    // amber/gold
const CY = "hsl(175 90% 60%)";    // cyan
const RD = "hsl(0 90% 62%)";      // red
const BG = "hsl(220 20% 4%)";     // near-black
const BG2= "hsl(220 18% 8%)";     // slightly lighter panel
const BG3= "hsl(220 18% 12%)";    // row hover bg
const BD = `1px solid hsl(120 100% 65% / 0.22)`;  // green border

const PIXEL = { fontFamily: "var(--font-pixel)" } as React.CSSProperties;
const MONO  = { fontFamily: "var(--font-mono)" }  as React.CSSProperties;

const PANEL: React.CSSProperties = {
  background: BG2, border: BD, borderRadius: 2, position: "relative",
};

const HDR: React.CSSProperties = {
  background: `hsl(120 100% 65% / 0.08)`,
  borderBottom: BD,
  padding: "0.6rem 1rem",
  display: "flex", alignItems: "center", justifyContent: "space-between",
};

const TITLE: React.CSSProperties = {
  ...PIXEL, fontSize: "0.6rem", color: G, letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
};

const BTN = (variant: "green" | "amber" | "red" | "ghost" = "green"): React.CSSProperties => {
  const colors = {
    green: { bg: `hsl(120 100% 65% / 0.12)`, border: `1px solid ${G}`, color: G },
    amber: { bg: `hsl(45 100% 65% / 0.12)`,  border: `1px solid ${AM}`, color: AM },
    red:   { bg: `hsl(0 90% 62% / 0.12)`,    border: `1px solid ${RD}`, color: RD },
    ghost: { bg: "transparent",              border: `1px solid hsl(120 100% 65% / 0.2)`, color: G2 },
  };
  return {
    ...PIXEL, fontSize: "0.52rem", letterSpacing: "0.06em",
    padding: "0.4rem 0.75rem", borderRadius: 2, cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: "0.3rem",
    transition: "all 0.15s", ...colors[variant],
  };
};

const INPUT: React.CSSProperties = {
  ...MONO, background: BG, border: BD, borderRadius: 2, color: G,
  padding: "0.4rem 0.6rem", width: "100%", fontSize: "0.8rem", outline: "none",
};

const LABEL: React.CSSProperties = {
  ...PIXEL, fontSize: "0.48rem", color: G2, letterSpacing: "0.06em",
  marginBottom: "0.25rem", display: "block",
};

// Corner accents
function CA({ color = G }: { color?: string }) {
  const s = (pos: any): React.CSSProperties => ({
    position: "absolute", width: 7, height: 7, ...pos,
  });
  return (<>
    <div style={{ ...s({ top: -1, left: -1 }), borderTop: `2px solid ${color}`, borderLeft: `2px solid ${color}` }} />
    <div style={{ ...s({ top: -1, right: -1 }), borderTop: `2px solid ${color}`, borderRight: `2px solid ${color}` }} />
    <div style={{ ...s({ bottom: -1, left: -1 }), borderBottom: `2px solid ${color}`, borderLeft: `2px solid ${color}` }} />
    <div style={{ ...s({ bottom: -1, right: -1 }), borderBottom: `2px solid ${color}`, borderRight: `2px solid ${color}` }} />
  </>);
}

// Rank medal
function Medal({ rank }: { rank: number }) {
  if (rank === 1) return <span style={{ color: "#FFD700", fontSize: "1rem" }}>🥇</span>;
  if (rank === 2) return <span style={{ color: "#C0C0C0", fontSize: "1rem" }}>🥈</span>;
  if (rank === 3) return <span style={{ color: "#CD7F32", fontSize: "1rem" }}>🥉</span>;
  return <span style={{ ...PIXEL, fontSize: "0.5rem", color: G2 }}>#{rank}</span>;
}

// Score bar
function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct > 70 ? G : pct > 40 ? AM : RD;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 80 }}>
      <div style={{ flex: 1, height: 6, background: BG, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ ...PIXEL, fontSize: "0.5rem", color, minWidth: 28 }}>{pct}%</span>
    </div>
  );
}

// Status badge
function Badge({ status }: { status: string }) {
  const map: Record<string, { c: string; bg: string }> = {
    pending:   { c: AM,  bg: `hsl(45 100% 65% / 0.1)` },
    filled:    { c: G,   bg: `hsl(120 100% 65% / 0.1)` },
    failed:    { c: RD,  bg: `hsl(0 90% 62% / 0.1)` },
    skipped:   { c: G2,  bg: "transparent" },
    simulated: { c: CY,  bg: `hsl(175 90% 60% / 0.1)` },
    active:    { c: G,   bg: `hsl(120 100% 65% / 0.1)` },
    paused:    { c: AM,  bg: `hsl(45 100% 65% / 0.1)` },
  };
  const { c, bg } = map[status] ?? map.skipped;
  return (
    <span style={{
      ...PIXEL, fontSize: "0.48rem", color: c, background: bg,
      border: `1px solid ${c}44`, borderRadius: 2, padding: "0.1rem 0.35rem",
      letterSpacing: "0.06em", textTransform: "uppercase" as const,
    }}>{status}</span>
  );
}

// ─── Tab switcher ──────────────────────────────────────────────────────────────
type Tab = "leaderboard" | "following" | "trades";

// ─── LEADERBOARD TAB ─────────────────────────────────────────────────────────
function LeaderboardTab() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [budget, setBudget] = useState("50");
  const [mergeResult, setMergeResult] = useState<any[] | null>(null);
  const [executing, setExecuting] = useState(false);

  const { data: leaders = [], isFetching, refetch } = useQuery<any[]>({
    queryKey: ["/api/leaderboard"],
    queryFn: () => apiRequest("GET", "/api/leaderboard").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const addMutation = useMutation({
    mutationFn: (addr: string) => apiRequest("POST", "/api/copy/wallets", { address: addr, label: `Top Trader ${addr.slice(0,6)}`, copyPct: 100 }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/copy/wallets"] });
      toast({ title: "Wallet added to following" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleSelect = (addr: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(addr)) next.delete(addr);
      else next.add(addr);
      return next;
    });
    setMergeResult(null);
  };

  const previewMerge = async () => {
    if (selected.size < 1) return;
    const wallets = [...selected].map(addr => {
      const w = leaders.find(l => l.address === addr);
      return { address: addr, score: w?.score ?? 0.5 };
    });
    try {
      const res = await apiRequest("POST", "/api/leaderboard/merge", {
        wallets, budget: parseFloat(budget) || 50,
      });
      const data = await res.json();
      setMergeResult(data);
    } catch (e: any) {
      toast({ title: "Merge preview failed", description: e.message, variant: "destructive" });
    }
  };

  const executeMerge = async () => {
    if (!mergeResult?.length) return;
    setExecuting(true);
    const wallets = [...selected].map(addr => {
      const w = leaders.find(l => l.address === addr);
      return { address: addr, score: w?.score ?? 0.5 };
    });
    try {
      const res = await apiRequest("POST", "/api/leaderboard/execute-merge", {
        wallets, budget: parseFloat(budget) || 50,
      });
      const data = await res.json();
      toast({ title: `Merge executed: ${data.placed} orders placed` });
      setMergeResult(null);
      setSelected(new Set());
    } catch (e: any) {
      toast({ title: "Execute failed", description: e.message, variant: "destructive" });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Controls */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <button style={BTN("ghost")} onClick={() => refetch()}>
          <RefreshCw size={10} style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }} />
          REFRESH
        </button>
        <span style={{ ...PIXEL, fontSize: "0.5rem", color: G2 }}>
          {leaders.length} WALLETS RANKED
        </span>
        {selected.size > 0 && (<>
          <span style={{ ...PIXEL, fontSize: "0.5rem", color: AM }}>{selected.size} SELECTED</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <label style={{ ...PIXEL, fontSize: "0.48rem", color: G2 }}>BUDGET $</label>
            <input
              value={budget} onChange={e => setBudget(e.target.value)}
              style={{ ...INPUT, width: 60, padding: "0.2rem 0.4rem" }}
            />
          </div>
          <button style={BTN("amber")} onClick={previewMerge}>
            <GitMerge size={10} /> PREVIEW MERGE
          </button>
          {mergeResult && (
            <button style={BTN("green")} disabled={executing} onClick={executeMerge}>
              <Target size={10} /> {executing ? "PLACING..." : "EXECUTE MERGE"}
            </button>
          )}
        </>)}
      </div>

      {/* Leaderboard table */}
      <div style={{ ...PANEL, overflow: "hidden" }}>
        <CA />
        <div style={HDR}>
          <span style={TITLE}><Trophy size={10} style={{ display: "inline", marginRight: 4 }} /> POLYMARKET TOP TRADERS</span>
          <span style={{ ...PIXEL, fontSize: "0.48rem", color: G2 }}>RANKED BY SCORE</span>
        </div>

        {/* Table header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "2rem 1fr 5rem 5rem 5rem 5rem 5.5rem 5.5rem 4.5rem",
          gap: "0 0.5rem",
          padding: "0.4rem 1rem",
          borderBottom: BD,
          background: `hsl(120 100% 65% / 0.04)`,
        }}>
          {["#", "WALLET", "PROFIT", "WIN%", "ROI", "TRADES", "VOLUME", "SCORE", "ACTION"].map(h => (
            <span key={h} style={{ ...PIXEL, fontSize: "0.42rem", color: G2, letterSpacing: "0.06em" }}>{h}</span>
          ))}
        </div>

        {/* Rows */}
        {leaders.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            <div style={{ ...PIXEL, fontSize: "0.55rem", color: G2 }}>
              {isFetching ? "SCANNING POLYMARKET TRADES..." : "NO DATA — CLICK REFRESH"}
            </div>
          </div>
        ) : leaders.map((w: any) => {
          const isSel = selected.has(w.address);
          return (
            <div
              key={w.address}
              onClick={() => toggleSelect(w.address)}
              style={{
                display: "grid",
                gridTemplateColumns: "2rem 1fr 5rem 5rem 5rem 5rem 5.5rem 5.5rem 4.5rem",
                gap: "0 0.5rem",
                padding: "0.6rem 1rem",
                borderBottom: `1px solid hsl(120 100% 65% / 0.08)`,
                background: isSel ? `hsl(120 100% 65% / 0.06)` : "transparent",
                cursor: "pointer",
                alignItems: "center",
                transition: "background 0.12s",
              }}
              onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = BG3; }}
              onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <Medal rank={w.rank} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" }}>
                <span style={{ ...MONO, fontSize: "0.78rem", color: G, letterSpacing: "0.02em" }}>
                  {w.displayName}
                  {w.verified && <span style={{ marginLeft: 4, color: CY, fontSize: "0.6rem" }}>✓</span>}
                  {isSel && <span style={{ marginLeft: 4, color: AM }}>★</span>}
                </span>
                <span style={{ ...PIXEL, fontSize: "0.42rem", color: G2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {w.topMarkets?.[0] ?? "—"}
                </span>
              </div>
              <span style={{ ...MONO, fontSize: "0.82rem", color: w.totalProfit >= 0 ? G : RD }}>
                {fmt$(w.totalProfit)}
              </span>
              <span style={{ ...MONO, fontSize: "0.82rem", color: w.winRate >= 55 ? G : w.winRate >= 45 ? AM : RD }}>
                {w.winRate.toFixed(1)}%
              </span>
              <span style={{ ...MONO, fontSize: "0.82rem", color: w.roi >= 0 ? G : RD }}>
                {fmtPct(w.roi)}
              </span>
              <span style={{ ...MONO, fontSize: "0.82rem", color: G }}>{w.totalTrades}</span>
              <span style={{ ...MONO, fontSize: "0.82rem", color: G2 }}>${w.volume.toFixed(0)}</span>
              <ScoreBar score={w.score} />
              <div style={{ display: "flex", gap: "0.3rem" }}>
                <button
                  style={{ ...BTN("green"), padding: "0.25rem 0.4rem", fontSize: "0.46rem" }}
                  onClick={e => { e.stopPropagation(); addMutation.mutate(w.address); }}
                  title="Follow this wallet"
                >
                  <Plus size={8} />
                </button>
                <a
                  href={`https://polymarket.com/profile/${w.address}`}
                  target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{ ...BTN("ghost"), padding: "0.25rem 0.4rem", fontSize: "0.46rem" }}
                >
                  <ExternalLink size={8} />
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {/* Merge preview */}
      {mergeResult && mergeResult.length > 0 && (
        <div style={{ ...PANEL }}>
          <CA color={AM} />
          <div style={{ ...HDR, borderBottomColor: `${AM}44` }}>
            <span style={{ ...TITLE, color: AM }}><GitMerge size={10} style={{ display: "inline", marginRight: 4 }} /> MERGED POSITIONS PREVIEW</span>
            <span style={{ ...PIXEL, fontSize: "0.48rem", color: G2 }}>BUDGET ${budget}</span>
          </div>
          {mergeResult.map((pos: any, i: number) => (
            <div key={i} style={{
              padding: "0.6rem 1rem",
              borderBottom: `1px solid hsl(45 100% 65% / 0.1)`,
              display: "grid",
              gridTemplateColumns: "1fr 4rem 4rem 5rem 5rem",
              gap: "0 0.5rem", alignItems: "center",
            }}>
              <span style={{ ...MONO, fontSize: "0.75rem", color: G, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pos.market}
              </span>
              <span style={{ ...PIXEL, fontSize: "0.52rem", color: pos.outcome === "Yes" || pos.outcome === "YES" ? G : RD }}>
                {pos.outcome}
              </span>
              <span style={{ ...PIXEL, fontSize: "0.52rem", color: G2 }}>
                {pos.walletCount} wallets
              </span>
              <span style={{ ...MONO, fontSize: "0.78rem", color: AM }}>
                @{pos.avgPrice.toFixed(3)}
              </span>
              <span style={{ ...MONO, fontSize: "0.78rem", color: G }}>
                ${pos.recommendedSize.toFixed(2)}
              </span>
            </div>
          ))}
          {mergeResult.length === 0 && (
            <div style={{ padding: "1.5rem", textAlign: "center" }}>
              <span style={{ ...PIXEL, fontSize: "0.52rem", color: G2 }}>NO CONSENSUS POSITIONS FOUND</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── FOLLOWING TAB ───────────────────────────────────────────────────────────
function FollowingTab() {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [addAddr, setAddAddr] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addPct, setAddPct] = useState("100");

  const { data: wallets = [], refetch } = useQuery<any[]>({
    queryKey: ["/api/copy/wallets"],
    queryFn: () => apiRequest("GET", "/api/copy/wallets").then(r => r.json()),
    staleTime: 30000, refetchInterval: 30000,
  });

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/copy/stats"],
    queryFn: () => apiRequest("GET", "/api/copy/stats").then(r => r.json()),
    staleTime: 30000,
  });

  const addMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/copy/wallets", {
      address: addAddr, label: addLabel || `Wallet ${addAddr.slice(0,6)}`,
      copyPct: parseFloat(addPct) || 100,
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/copy/wallets"] });
      setShowAdd(false); setAddAddr(""); setAddLabel(""); setAddPct("100");
      toast({ title: "Wallet added" });
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/copy/wallets/${id}`, { isActive }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/copy/wallets"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/copy/wallets/${id}`).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/copy/wallets"] }),
  });

  const syncMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/copy/wallets/${id}/sync`).then(r => r.json()),
    onSuccess: (d: any) => toast({ title: `Synced: ${d.copied} trade(s) copied` }),
  });

  // Stats bar
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Stats */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "0.5rem" }}>
          {[
            { label: "ACTIVE", value: stats.activeWallets, color: G },
            { label: "TOTAL COPIED", value: stats.totalCopied, color: CY },
            { label: "FILLED", value: stats.filled, color: G },
            { label: "FAILED", value: stats.failed, color: RD },
            { label: "TOTAL P&L", value: fmt$(stats.totalPnl), color: stats.totalPnl >= 0 ? G : RD },
          ].map(s => (
            <div key={s.label} style={{ ...PANEL, padding: "0.6rem 0.75rem", textAlign: "center" }}>
              <div style={{ ...MONO, fontSize: "1.1rem", color: s.color, fontWeight: "bold" }}>{s.value}</div>
              <div style={{ ...PIXEL, fontSize: "0.42rem", color: G2, marginTop: 3 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Add wallet */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <button style={BTN("green")} onClick={() => setShowAdd(v => !v)}>
          <Plus size={10} /> ADD WALLET
        </button>
        <button style={BTN("ghost")} onClick={() => refetch()}>
          <RefreshCw size={10} /> REFRESH
        </button>
      </div>

      {showAdd && (
        <div style={{ ...PANEL, padding: "1rem" }}>
          <CA />
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: "0.5rem", alignItems: "flex-end" }}>
            <div>
              <label style={LABEL}>WALLET ADDRESS</label>
              <input style={INPUT} placeholder="0x…" value={addAddr} onChange={e => setAddAddr(e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>LABEL (optional)</label>
              <input style={INPUT} placeholder="Whale #1" value={addLabel} onChange={e => setAddLabel(e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>COPY %</label>
              <input style={INPUT} type="number" min={1} max={200} value={addPct} onChange={e => setAddPct(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: "0.3rem" }}>
              <button style={BTN("green")} onClick={() => addMut.mutate()}>ADD</button>
              <button style={BTN("ghost")} onClick={() => setShowAdd(false)}>✕</button>
            </div>
          </div>
        </div>
      )}

      {/* Wallet cards */}
      {wallets.length === 0 ? (
        <div style={{ ...PANEL, padding: "2.5rem", textAlign: "center" }}>
          <div style={{ ...PIXEL, fontSize: "0.6rem", color: G2, marginBottom: "0.75rem" }}>
            NO WALLETS FOLLOWED
          </div>
          <div style={{ ...MONO, fontSize: "0.8rem", color: G2 }}>
            Browse the leaderboard and click + to follow top traders
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "0.75rem" }}>
          {wallets.map((w: any) => (
            <div key={w.id} style={{ ...PANEL, padding: "1rem" }}>
              <CA color={w.isActive ? G : G2} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.6rem" }}>
                <div>
                  <div style={{ ...PIXEL, fontSize: "0.55rem", color: G, marginBottom: 2 }}>
                    {w.label || shortAddr(w.address)}
                  </div>
                  <div style={{ ...MONO, fontSize: "0.72rem", color: G2 }}>{shortAddr(w.address)}</div>
                </div>
                <Badge status={w.isActive ? "active" : "paused"} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", marginBottom: "0.8rem" }}>
                <div>
                  <div style={{ ...PIXEL, fontSize: "0.42rem", color: G2 }}>COPY PCT</div>
                  <div style={{ ...MONO, fontSize: "0.9rem", color: AM }}>{w.copyPct}%</div>
                </div>
                <div>
                  <div style={{ ...PIXEL, fontSize: "0.42rem", color: G2 }}>TRADES COPIED</div>
                  <div style={{ ...MONO, fontSize: "0.9rem", color: CY }}>{w.totalCopied}</div>
                </div>
                <div>
                  <div style={{ ...PIXEL, fontSize: "0.42rem", color: G2 }}>TOTAL PNL</div>
                  <div style={{ ...MONO, fontSize: "0.9rem", color: w.totalPnl >= 0 ? G : RD }}>
                    {fmt$(w.totalPnl)}
                  </div>
                </div>
                <div>
                  <div style={{ ...PIXEL, fontSize: "0.42rem", color: G2 }}>LAST SEEN</div>
                  <div style={{ ...MONO, fontSize: "0.72rem", color: G2 }}>
                    {w.lastSeen ? formatDistanceToNow(new Date(w.lastSeen), { addSuffix: true }) : "Never"}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                <button style={BTN(w.isActive ? "amber" : "green")} onClick={() => toggleMut.mutate({ id: w.id, isActive: !w.isActive })}>
                  {w.isActive ? <><Pause size={8} /> PAUSE</> : <><Play size={8} /> RESUME</>}
                </button>
                <button style={BTN("ghost")} onClick={() => syncMut.mutate(w.id)}>
                  <Zap size={8} /> SYNC
                </button>
                <a href={`https://polymarket.com/profile/${w.address}`} target="_blank" rel="noopener noreferrer" style={BTN("ghost")}>
                  <ExternalLink size={8} /> PROFILE
                </a>
                <button style={{ ...BTN("red"), marginLeft: "auto" }} onClick={() => deleteMut.mutate(w.id)}>
                  <Trash2 size={8} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TRADES TAB ──────────────────────────────────────────────────────────────
function TradesTab() {
  const { data: trades = [] } = useQuery<any[]>({
    queryKey: ["/api/copy/trades"],
    queryFn: () => apiRequest("GET", "/api/copy/trades?limit=100").then(r => r.json()),
    staleTime: 30000, refetchInterval: 30000,
  });

  return (
    <div style={{ ...PANEL }}>
      <CA />
      <div style={HDR}>
        <span style={TITLE}><Target size={10} style={{ display: "inline", marginRight: 4 }} /> COPY TRADES</span>
        <span style={{ ...PIXEL, fontSize: "0.48rem", color: G2 }}>{trades.length} TOTAL</span>
      </div>

      {/* Col headers */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 4.5rem 4.5rem 4.5rem 5rem 5rem 5rem",
        gap: "0 0.5rem", padding: "0.4rem 1rem", borderBottom: BD,
        background: `hsl(120 100% 65% / 0.04)`,
      }}>
        {["MARKET", "WALLET", "SIDE", "OUTCOME", "SIZE", "PRICE", "STATUS"].map(h => (
          <span key={h} style={{ ...PIXEL, fontSize: "0.42rem", color: G2 }}>{h}</span>
        ))}
      </div>

      {trades.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <span style={{ ...PIXEL, fontSize: "0.55rem", color: G2 }}>NO COPY TRADES YET</span>
        </div>
      ) : trades.map((t: any) => (
        <div key={t.id} style={{
          display: "grid",
          gridTemplateColumns: "1fr 4.5rem 4.5rem 4.5rem 5rem 5rem 5rem",
          gap: "0 0.5rem", padding: "0.55rem 1rem",
          borderBottom: `1px solid hsl(120 100% 65% / 0.06)`,
          alignItems: "center",
        }}>
          <span style={{ ...MONO, fontSize: "0.72rem", color: G, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t.market}
          </span>
          <span style={{ ...MONO, fontSize: "0.7rem", color: G2 }}>{shortAddr(t.walletAddress)}</span>
          <span style={{ ...PIXEL, fontSize: "0.5rem", color: t.side === "BUY" ? G : RD }}>{t.side}</span>
          <span style={{ ...PIXEL, fontSize: "0.5rem", color: t.outcome === "YES" || t.outcome === "Yes" ? G : RD }}>
            {t.outcome}
          </span>
          <span style={{ ...MONO, fontSize: "0.78rem", color: G }}>{t.size.toFixed(2)}</span>
          <span style={{ ...MONO, fontSize: "0.78rem", color: AM }}>@{t.price.toFixed(3)}</span>
          <Badge status={t.status} />
        </div>
      ))}
    </div>
  );
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────
export default function CopyTrade() {
  const [tab, setTab] = useState<Tab>("leaderboard");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "leaderboard", label: "LEADERBOARD", icon: <Trophy size={10} /> },
    { id: "following",   label: "FOLLOWING",   icon: <Users size={10} /> },
    { id: "trades",      label: "COPY TRADES", icon: <TrendingUp size={10} /> },
  ];

  return (
    <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem", minHeight: "100vh" }}>
      {/* Page header */}
      <div style={{ ...PANEL, padding: "0.875rem 1rem" }}>
        <CA />
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Wallet size={20} color={G} />
          <div>
            <div style={{ ...PIXEL, fontSize: "0.65rem", color: G, letterSpacing: "0.1em" }}>
              COPY TRADING ENGINE
            </div>
            <div style={{ ...MONO, fontSize: "0.75rem", color: G2, marginTop: 3 }}>
              Follow top Polymarket wallets · Copy single or merge multiple
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: "0.25rem", borderBottom: BD, paddingBottom: "0.5rem" }}>
        {tabs.map(t => (
          <button
            key={t.id}
            style={{
              ...PIXEL, fontSize: "0.52rem", letterSpacing: "0.08em",
              padding: "0.45rem 0.875rem", borderRadius: 2, cursor: "pointer",
              display: "flex", alignItems: "center", gap: "0.35rem",
              background: tab === t.id ? `hsl(120 100% 65% / 0.12)` : "transparent",
              border: tab === t.id ? `1px solid ${G}` : `1px solid transparent`,
              color: tab === t.id ? G : G2,
              transition: "all 0.15s",
            }}
            onClick={() => setTab(t.id)}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "leaderboard" && <LeaderboardTab />}
      {tab === "following"   && <FollowingTab />}
      {tab === "trades"      && <TradesTab />}
    </div>
  );
}
