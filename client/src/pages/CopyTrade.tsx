import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { RefreshCw, Plus, Trash2, Pause, Play, ExternalLink, CheckCircle, XCircle, Clock, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ───────────────────────────────────────────────────────────────────
function shortAddr(addr: string) { return addr.slice(0, 6) + "…" + addr.slice(-4); }

// Corner accent decoration for retro panels
function CornerAccents({ color = "hsl(120 100% 55%)" }: { color?: string }) {
  const s = (pos: any) => ({ position: "absolute" as const, width: 8, height: 8, ...pos });
  return (
    <>
      <div style={{ ...s({ top: -1, left: -1 }), borderTop: `2px solid ${color}`, borderLeft: `2px solid ${color}` }} />
      <div style={{ ...s({ top: -1, right: -1 }), borderTop: `2px solid ${color}`, borderRight: `2px solid ${color}` }} />
      <div style={{ ...s({ bottom: -1, left: -1 }), borderBottom: `2px solid ${color}`, borderLeft: `2px solid ${color}` }} />
      <div style={{ ...s({ bottom: -1, right: -1 }), borderBottom: `2px solid ${color}`, borderRight: `2px solid ${color}` }} />
    </>
  );
}

const PANEL: React.CSSProperties = {
  background: "hsl(220 20% 5%)",
  border: "1px solid hsl(120 100% 55% / 0.25)",
  borderRadius: "2px",
  position: "relative",
};

const PANEL_HDR: React.CSSProperties = {
  background: "hsl(120 100% 55% / 0.06)",
  borderBottom: "1px solid hsl(120 100% 55% / 0.2)",
  padding: "0.5rem 0.875rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const PANEL_TITLE: React.CSSProperties = {
  fontFamily: "var(--font-pixel)",
  fontSize: "0.55rem",
  color: "hsl(120 100% 55%)",
  letterSpacing: "0.08em",
};

const MONO: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
};

const PIXEL: React.CSSProperties = {
  fontFamily: "var(--font-pixel)",
};

// Status badge
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; border: string }> = {
    pending:   { color: "hsl(45 100% 55%)",  bg: "hsl(45 100% 55% / 0.08)",  border: "hsl(45 100% 55% / 0.3)" },
    filled:    { color: "hsl(120 100% 55%)", bg: "hsl(120 100% 55% / 0.08)", border: "hsl(120 100% 55% / 0.3)" },
    failed:    { color: "hsl(0 90% 55%)",    bg: "hsl(0 90% 55% / 0.08)",    border: "hsl(0 90% 55% / 0.3)" },
    skipped:   { color: "hsl(220 20% 50%)",  bg: "transparent",              border: "hsl(220 20% 30%)" },
    simulated: { color: "hsl(175 90% 55%)",  bg: "hsl(175 90% 55% / 0.08)", border: "hsl(175 90% 55% / 0.3)" },
  };
  const icons: Record<string, React.ReactNode> = {
    pending:   <Clock size={8} />,
    filled:    <CheckCircle size={8} />,
    failed:    <XCircle size={8} />,
    simulated: <Zap size={8} />,
    skipped:   <span>—</span>,
  };
  const style = map[status] || map.skipped;
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "0.25rem",
      padding: "0.1rem 0.35rem",
      border: `1px solid ${style.border}`,
      borderRadius: "2px",
      background: style.bg,
      color: style.color,
      fontSize: "0.58rem",
      fontFamily: "var(--font-pixel)",
      letterSpacing: "0.06em",
      textTransform: "uppercase" as const,
    }}>
      {icons[status]}{status}
    </span>
  );
}

// ── Add Wallet Form (modal) ────────────────────────────────────────────────────
function AddWalletForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [address, setAddress] = useState("");
  const [label, setLabel]     = useState("");
  const [copyPct, setCopyPct] = useState("100");

  const addMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/copy/wallets", {
      address: address.trim(),
      label: label.trim(),
      copyPct: parseFloat(copyPct) || 100,
      isActive: true,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/copy/wallets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/copy/stats"] });
      toast({ title: "Wallet added", description: `Now copying ${shortAddr(address)}` });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const valid = address.startsWith("0x") && address.length === 42;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "hsl(220 20% 3%)",
    border: "1px solid hsl(120 100% 55% / 0.3)",
    borderRadius: "2px",
    padding: "0.45rem 0.625rem",
    fontFamily: "var(--font-mono)",
    fontSize: "0.72rem",
    color: "hsl(120 100% 55%)",
    outline: "none",
    boxSizing: "border-box" as const,
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-pixel)",
    fontSize: "0.48rem",
    color: "hsl(120 100% 55% / 0.7)",
    letterSpacing: "0.1em",
    display: "block",
    marginBottom: "0.35rem",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)",
      padding: "1rem",
    }}>
      <div style={{ ...PANEL, width: "100%", maxWidth: "28rem", boxShadow: "0 0 40px hsl(120 100% 55% / 0.15)" }}>
        <CornerAccents />
        <div style={PANEL_HDR}>
          <span style={PANEL_TITLE}>▸ ADD CLONE TARGET</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(0 90% 55%)", fontFamily: "var(--font-pixel)", fontSize: "0.6rem" }}>[ X ]</button>
        </div>
        <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div>
            <label style={labelStyle}>WALLET ADDRESS</label>
            <input
              placeholder="0x4e2355789ae74089..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              style={inputStyle}
            />
            {address && !valid && (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "hsl(0 90% 55%)", marginTop: "0.25rem" }}>
                ERR: Must be a valid 0x address (42 chars)
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>LABEL (OPTIONAL)</label>
            <input
              placeholder="e.g. WHALE #1, TOP TRADER"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              style={{ ...inputStyle, fontFamily: "var(--font-pixel)", fontSize: "0.55rem" }}
            />
          </div>
          <div>
            <label style={labelStyle}>COPY SIZE %</label>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="number" min={1} max={200}
                value={copyPct}
                onChange={(e) => setCopyPct(e.target.value)}
                style={{ ...inputStyle, width: "5rem" }}
              />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "hsl(120 100% 55% / 0.5)" }}>% OF THEIR BET SIZE</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
            <button
              onClick={() => addMutation.mutate()}
              disabled={!valid || addMutation.isPending}
              style={{
                flex: 1,
                padding: "0.55rem",
                background: valid && !addMutation.isPending ? "hsl(120 100% 55% / 0.1)" : "transparent",
                border: "1px solid hsl(120 100% 55%)",
                borderRadius: "2px",
                color: "hsl(120 100% 55%)",
                fontFamily: "var(--font-pixel)",
                fontSize: "0.5rem",
                letterSpacing: "0.08em",
                cursor: valid && !addMutation.isPending ? "pointer" : "not-allowed",
                opacity: valid && !addMutation.isPending ? 1 : 0.5,
              }}
            >
              {addMutation.isPending ? "[ ADDING... ]" : "[ ADD CLONE TARGET ]"}
            </button>
            <button
              onClick={onClose}
              style={{
                padding: "0.55rem 0.75rem",
                background: "transparent",
                border: "1px solid hsl(220 20% 30%)",
                borderRadius: "2px",
                color: "hsl(220 20% 60%)",
                fontFamily: "var(--font-pixel)",
                fontSize: "0.5rem",
                cursor: "pointer",
              }}
            >
              [ ABORT ]
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Wallet Card ────────────────────────────────────────────────────────────────
function WalletCard({ wallet, onSync }: { wallet: any; onSync: (id: number) => void }) {
  const { toast } = useToast();

  const toggleMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/copy/wallets/${wallet.id}`, { isActive: !wallet.isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/copy/wallets"] });
      toast({ title: wallet.isActive ? "Paused" : "Resumed", description: shortAddr(wallet.address) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/copy/wallets/${wallet.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/copy/wallets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/copy/stats"] });
      toast({ title: "Wallet removed" });
    },
  });

  const pnlPositive = (wallet.totalPnl || 0) >= 0;
  const activeColor = wallet.isActive ? "hsl(120 100% 55%)" : "hsl(220 20% 35%)";

  return (
    <div style={{
      ...PANEL,
      borderColor: wallet.isActive ? "hsl(120 100% 55% / 0.3)" : "hsl(220 20% 20%)",
      opacity: wallet.isActive ? 1 : 0.6,
      transition: "all 0.2s",
    }}>
      <CornerAccents color={activeColor} />

      {/* Header bar */}
      <div style={{ ...PANEL_HDR, borderBottomColor: `${activeColor}30` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: wallet.isActive ? "hsl(120 100% 55%)" : "hsl(220 20% 35%)",
            boxShadow: wallet.isActive ? "0 0 6px hsl(120 100% 55%)" : "none",
          }} />
          <span style={{ ...PIXEL, fontSize: "0.55rem", color: activeColor, letterSpacing: "0.08em" }}>
            {wallet.label || shortAddr(wallet.address)}
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {[
            { icon: <RefreshCw size={10} />, onClick: () => onSync(wallet.id), title: "Sync", color: "hsl(175 90% 55%)" },
            { icon: wallet.isActive ? <Pause size={10} /> : <Play size={10} />, onClick: () => toggleMutation.mutate(), title: wallet.isActive ? "Pause" : "Resume", color: "hsl(45 100% 55%)" },
            { icon: <Trash2 size={10} />, onClick: () => deleteMutation.mutate(), title: "Remove", color: "hsl(0 90% 55%)" },
          ].map(({ icon, onClick, title, color }, i) => (
            <button key={i} onClick={onClick} title={title} style={{
              background: "none", border: "none", cursor: "pointer",
              color, padding: "0.2rem", opacity: 0.7,
            }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.7"; }}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        <div style={{ ...MONO, fontSize: "0.62rem", color: "hsl(120 100% 55% / 0.45)" }}>
          {shortAddr(wallet.address)}
        </div>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.375rem" }}>
          {[
            { label: "COPIED", value: wallet.totalCopied ?? 0, color: "hsl(120 100% 55%)" },
            { label: "COPY %", value: `${wallet.copyPct}%`, color: "hsl(45 100% 55%)" },
            { label: "PNL", value: `${pnlPositive ? "+" : ""}$${(wallet.totalPnl || 0).toFixed(2)}`, color: pnlPositive ? "hsl(120 100% 55%)" : "hsl(0 90% 55%)" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: "hsl(220 20% 3%)",
              border: "1px solid hsl(120 100% 55% / 0.1)",
              borderRadius: "2px",
              padding: "0.4rem 0.3rem",
              textAlign: "center",
            }}>
              <div style={{ ...PIXEL, fontSize: "0.38rem", color: "hsl(120 100% 55% / 0.45)", letterSpacing: "0.06em", marginBottom: "0.2rem" }}>{label}</div>
              <div style={{ ...MONO, fontSize: "0.75rem", color }}>{value}</div>
            </div>
          ))}
        </div>

        {wallet.lastSeen && (
          <div style={{ ...MONO, fontSize: "0.58rem", color: "hsl(120 100% 55% / 0.4)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <Clock size={9} />
            LAST TRADE: {formatDistanceToNow(new Date(wallet.lastSeen), { addSuffix: true }).toUpperCase()}
          </div>
        )}

        <a
          href={`https://polymarket.com/profile/${wallet.address}`}
          target="_blank" rel="noopener noreferrer"
          style={{ ...MONO, fontSize: "0.6rem", color: "hsl(175 90% 55%)", textDecoration: "none", display: "flex", alignItems: "center", gap: "0.25rem" }}
        >
          <ExternalLink size={9} />VIEW ON POLYMARKET ↗
        </a>
      </div>
    </div>
  );
}

// ── Activity Feed ─────────────────────────────────────────────────────────────
function ActivityFeed({ trades }: { trades: any[] }) {
  if (!trades.length) return null;
  const recent = trades.slice(0, 8);
  return (
    <div style={{ ...PANEL, borderColor: "hsl(120 100% 55% / 0.2)" }}>
      <CornerAccents />
      <div style={PANEL_HDR}>
        <span style={PANEL_TITLE}>▸ LIVE ACTIVITY FEED</span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "hsl(120 100% 55%)", boxShadow: "0 0 5px hsl(120 100% 55%)" }} className="pulse-dot" />
          <span style={{ ...MONO, fontSize: "0.58rem", color: "hsl(120 100% 55% / 0.5)" }}>POLLS EVERY 60s</span>
        </div>
      </div>
      <div>
        {recent.map((t: any, i) => (
          <div key={t.id} style={{
            padding: "0.6rem 0.875rem",
            borderBottom: i < recent.length - 1 ? "1px solid hsl(120 100% 55% / 0.06)" : "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
          }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ ...MONO, fontSize: "0.65rem", color: "hsl(120 100% 55%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.market}
              </div>
              <div style={{ ...MONO, fontSize: "0.58rem", color: "hsl(120 100% 55% / 0.45)", marginTop: "0.15rem" }}>
                &gt; {shortAddr(t.walletAddress)} · {t.side} {t.outcome} · ${t.usdcSpent?.toFixed(2)}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
              <StatusBadge status={t.status} />
              {t.createdAt && (
                <span style={{ ...MONO, fontSize: "0.55rem", color: "hsl(120 100% 55% / 0.3)", whiteSpace: "nowrap" }}>
                  {formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CopyTrade() {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeTab, setActiveTab] = useState<"wallets" | "trades">("wallets");

  const { data: wallets = [], isLoading: walletsLoading } = useQuery({ queryKey: ["/api/copy/wallets"], refetchInterval: 60000, staleTime: 30000 });
  const { data: stats } = useQuery({ queryKey: ["/api/copy/stats"], refetchInterval: 60000, staleTime: 30000 });
  const { data: copyTrades = [], isLoading: tradesLoading } = useQuery({
    queryKey: ["/api/copy/trades"],
    queryFn: () => apiRequest("GET", "/api/copy/trades?limit=100").then((r) => r.json()),
    refetchInterval: 20000,
    staleTime: 15000,
  });

  const syncMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/copy/wallets/${id}/sync`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/copy/wallets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/copy/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/copy/stats"] });
      toast({ title: "Synced", description: `${data.copied ?? 0} new trade(s) copied` });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const walletList: any[] = (wallets as any) || [];
  const tradeList: any[] = (copyTrades as any) || [];
  const s: any = stats || {};

  const filledTrades = tradeList.filter((t) => t.status === "filled");
  const successRate = tradeList.length > 0 ? ((filledTrades.length / tradeList.length) * 100).toFixed(1) : "—";

  const statCards = [
    { label: "WALLETS", value: s.totalWallets ?? 0, color: "hsl(120 100% 55%)" },
    { label: "ACTIVE", value: s.activeWallets ?? 0, color: "hsl(175 90% 55%)" },
    { label: "COPIED", value: s.filled ?? 0, color: "hsl(120 100% 55%)" },
    { label: "SUCCESS", value: `${successRate}%`, color: "hsl(45 100% 55%)" },
  ];

  return (
    <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {showAddForm && <AddWalletForm onClose={() => setShowAddForm(false)} />}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", borderBottom: "1px solid hsl(120 100% 55% / 0.15)", paddingBottom: "0.75rem" }}>
        <div>
          <div style={{ fontFamily: "var(--font-pixel)", fontSize: "0.8rem", color: "hsl(120 100% 55%)", letterSpacing: "0.1em" }}>
            ══ CLONE UNIT ══
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", color: "hsl(120 100% 55% / 0.45)", marginTop: "0.25rem" }}>
            MIRROR POLYMARKET WHALE WALLETS IN REAL-TIME
          </div>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          style={{
            padding: "0.45rem 0.75rem",
            background: "hsl(120 100% 55% / 0.1)",
            border: "1px solid hsl(120 100% 55%)",
            borderRadius: "2px",
            color: "hsl(120 100% 55%)",
            fontFamily: "var(--font-pixel)",
            fontSize: "0.48rem",
            letterSpacing: "0.08em",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.3rem",
          }}
        >
          <Plus size={10} />[ ADD TARGET ]
        </button>
      </div>

      {/* Stats bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.625rem" }}>
        {statCards.map(({ label, value, color }) => (
          <div key={label} style={{ ...PANEL, borderColor: `${color}30` }}>
            <CornerAccents color={color} />
            <div style={{ padding: "0.75rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--font-pixel)", fontSize: "0.45rem", color: `${color}99`, letterSpacing: "0.08em" }}>{label}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "1.2rem", color }}>{value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {(["wallets", "trades"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "0.4rem 0.75rem",
              background: activeTab === tab ? "hsl(120 100% 55% / 0.1)" : "transparent",
              border: activeTab === tab ? "1px solid hsl(120 100% 55%)" : "1px solid hsl(120 100% 55% / 0.2)",
              borderRadius: "2px",
              color: activeTab === tab ? "hsl(120 100% 55%)" : "hsl(120 100% 55% / 0.45)",
              fontFamily: "var(--font-pixel)",
              fontSize: "0.48rem",
              letterSpacing: "0.08em",
              cursor: "pointer",
              textTransform: "uppercase" as const,
            }}
          >
            {tab === "wallets" ? `WALLETS (${walletList.length})` : `COPY TRADES (${tradeList.length})`}
          </button>
        ))}
      </div>

      {/* Wallets tab */}
      {activeTab === "wallets" && (
        <>
          {walletsLoading ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))", gap: "0.75rem" }}>
              {[...Array(3)].map((_, i) => (
                <div key={i} style={{ ...PANEL, height: "11rem", opacity: 0.4 }}>
                  <div style={{ ...PANEL_HDR }}><span style={PANEL_TITLE}>LOADING...</span></div>
                </div>
              ))}
            </div>
          ) : walletList.length === 0 ? (
            <div style={{ ...PANEL, textAlign: "center" }}>
              <CornerAccents color="hsl(120 100% 55% / 0.3)" />
              <div style={{ padding: "3rem 1.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
                <div style={{ fontFamily: "var(--font-pixel)", fontSize: "1.5rem", color: "hsl(120 100% 55% / 0.2)" }}>◈</div>
                <div style={{ fontFamily: "var(--font-pixel)", fontSize: "0.55rem", color: "hsl(120 100% 55% / 0.5)", letterSpacing: "0.08em" }}>NO CLONE TARGETS REGISTERED</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", color: "hsl(120 100% 55% / 0.35)" }}>Add a Polymarket wallet to start copying trades</div>
                <button
                  onClick={() => setShowAddForm(true)}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "hsl(120 100% 55% / 0.1)",
                    border: "1px solid hsl(120 100% 55%)",
                    borderRadius: "2px",
                    color: "hsl(120 100% 55%)",
                    fontFamily: "var(--font-pixel)",
                    fontSize: "0.48rem",
                    letterSpacing: "0.08em",
                    cursor: "pointer",
                    marginTop: "0.5rem",
                  }}
                >
                  [ ADD FIRST TARGET ]
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))", gap: "0.75rem" }}>
              {walletList.map((w: any) => (
                <WalletCard key={w.id} wallet={w} onSync={(id) => syncMutation.mutate(id)} />
              ))}
            </div>
          )}

          {/* How it works */}
          <div style={{ ...PANEL, borderColor: "hsl(175 90% 55% / 0.2)" }}>
            <CornerAccents color="hsl(175 90% 55%)" />
            <div style={{ ...PANEL_HDR, borderBottomColor: "hsl(175 90% 55% / 0.15)" }}>
              <span style={{ ...PANEL_TITLE, color: "hsl(175 90% 55%)" }}>▸ CLONE PROTOCOL // HOW IT WORKS</span>
            </div>
            <div style={{ padding: "0.875rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "0.75rem" }}>
              {[
                { step: "01", title: "ADD TARGET", desc: "Paste any Polymarket wallet address. Set % of their bet size to mirror." },
                { step: "02", title: "AUTO-COPY", desc: "Engine polls activity every 60s. New trades placed instantly using your Poly key." },
                { step: "03", title: "TRACK PNL", desc: "All copied trades appear in Trades tab with fill price, status, and PNL." },
              ].map(({ step, title, desc }) => (
                <div key={step}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.4rem" }}>
                    <span style={{ fontFamily: "var(--font-pixel)", fontSize: "0.55rem", color: "hsl(175 90% 55%)" }}>[{step}]</span>
                    <span style={{ fontFamily: "var(--font-pixel)", fontSize: "0.52rem", color: "hsl(120 100% 55%)", letterSpacing: "0.06em" }}>{title}</span>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", color: "hsl(120 100% 55% / 0.45)", lineHeight: 1.6 }}>{desc}</div>
                </div>
              ))}
            </div>
            <div style={{
              margin: "0 0.875rem 0.875rem",
              padding: "0.5rem 0.75rem",
              background: "hsl(220 20% 3%)",
              border: "1px solid hsl(120 100% 55% / 0.15)",
              borderRadius: "2px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.62rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              flexWrap: "wrap" as const,
            }}>
              <span style={{ color: "hsl(45 100% 55%)" }}>&gt; CONNECTED WALLET:</span>
              <span style={{ color: "hsl(120 100% 55%)" }}>0x4e2355…e6093</span>
              <span style={{ color: "hsl(120 100% 55% / 0.3)" }}>·</span>
              <span style={{ color: "hsl(175 90% 55%)" }}>PRIVATE KEY CONFIGURED ✓</span>
            </div>
          </div>
        </>
      )}

      {/* Trades tab */}
      {activeTab === "trades" && (
        <>
          <ActivityFeed trades={tradeList} />

          <div style={PANEL}>
            <CornerAccents />
            <div style={PANEL_HDR}>
              <span style={PANEL_TITLE}>▸ ALL COPIED TRADES</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "hsl(120 100% 55% / 0.45)" }}>{tradeList.length} RECORDS</span>
            </div>

            {tradesLoading ? (
              <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {[...Array(5)].map((_, i) => (
                  <div key={i} style={{ height: "2.5rem", background: "hsl(120 100% 55% / 0.04)", borderRadius: "2px" }} />
                ))}
              </div>
            ) : tradeList.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "hsl(120 100% 55% / 0.4)" }}>
                &gt; NO COPY TRADES YET. ADD A WALLET AND THE ENGINE WILL START COPYING.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid hsl(120 100% 55% / 0.15)", background: "hsl(120 100% 55% / 0.03)" }}>
                      {["WALLET", "MARKET", "SIDE", "OUTCOME", "SIZE", "PRICE", "USDC", "STATUS", "ORDER ID", "TIME"].map((h) => (
                        <th key={h} style={{
                          padding: "0.5rem 0.75rem",
                          textAlign: "left",
                          fontFamily: "var(--font-pixel)",
                          fontSize: "0.42rem",
                          color: "hsl(120 100% 55% / 0.5)",
                          letterSpacing: "0.06em",
                          whiteSpace: "nowrap" as const,
                          fontWeight: "normal",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tradeList.map((t: any) => (
                      <tr key={t.id} style={{ borderBottom: "1px solid hsl(120 100% 55% / 0.06)" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "hsl(120 100% 55% / 0.03)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "transparent"; }}
                      >
                        <td style={{ padding: "0.6rem 0.75rem", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "hsl(120 100% 55% / 0.5)", whiteSpace: "nowrap" as const }}>
                          {shortAddr(t.walletAddress)}
                        </td>
                        <td style={{ padding: "0.6rem 0.75rem", maxWidth: "10rem" }}>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "hsl(120 100% 55%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }} title={t.market}>
                            {t.market}
                          </div>
                        </td>
                        <td style={{ padding: "0.6rem 0.75rem" }}>
                          <span style={{
                            padding: "0.1rem 0.35rem",
                            border: `1px solid ${t.side === "BUY" ? "hsl(120 100% 55% / 0.4)" : "hsl(0 90% 55% / 0.4)"}`,
                            borderRadius: "2px",
                            color: t.side === "BUY" ? "hsl(120 100% 55%)" : "hsl(0 90% 55%)",
                            fontFamily: "var(--font-pixel)",
                            fontSize: "0.45rem",
                            letterSpacing: "0.06em",
                          }}>{t.side}</span>
                        </td>
                        <td style={{ padding: "0.6rem 0.75rem" }}>
                          <span style={{
                            padding: "0.1rem 0.35rem",
                            border: `1px solid ${t.outcome === "Yes" ? "hsl(120 100% 55% / 0.4)" : "hsl(0 90% 55% / 0.4)"}`,
                            borderRadius: "2px",
                            color: t.outcome === "Yes" ? "hsl(120 100% 55%)" : "hsl(0 90% 55%)",
                            fontFamily: "var(--font-pixel)",
                            fontSize: "0.45rem",
                            letterSpacing: "0.06em",
                          }}>{t.outcome}</span>
                        </td>
                        <td style={{ padding: "0.6rem 0.75rem", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "hsl(120 100% 55%)" }}>
                          {t.size?.toFixed(2)}
                        </td>
                        <td style={{ padding: "0.6rem 0.75rem", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "hsl(120 100% 55% / 0.6)" }}>
                          {(t.price * 100).toFixed(1)}¢
                        </td>
                        <td style={{ padding: "0.6rem 0.75rem", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "hsl(45 100% 55%)" }}>
                          ${t.usdcSpent?.toFixed(2)}
                        </td>
                        <td style={{ padding: "0.6rem 0.75rem" }}>
                          <StatusBadge status={t.status} />
                        </td>
                        <td style={{ padding: "0.6rem 0.75rem" }}>
                          {t.polyOrderId ? (
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "hsl(120 100% 55% / 0.45)" }} title={t.polyOrderId}>
                              {t.polyOrderId.slice(0, 8)}…
                            </span>
                          ) : <span style={{ color: "hsl(120 100% 55% / 0.2)" }}>—</span>}
                        </td>
                        <td style={{ padding: "0.6rem 0.75rem", fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "hsl(120 100% 55% / 0.4)", whiteSpace: "nowrap" as const }}>
                          {t.createdAt ? formatDistanceToNow(new Date(t.createdAt), { addSuffix: true }) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
