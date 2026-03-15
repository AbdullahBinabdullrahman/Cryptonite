import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Copy, Wallet, TrendingUp, TrendingDown, RefreshCw,
  Plus, Trash2, Pause, Play, ExternalLink, CheckCircle, XCircle, Clock, Zap,
  Activity, DollarSign
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";

// ── Helpers ───────────────────────────────────────────────────────────────────
function shortAddr(addr: string) { return addr.slice(0, 6) + "…" + addr.slice(-4); }

function StatusDot({ active }: { active: boolean }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${active ? "bg-up pulse-dot" : "bg-muted-foreground/40"}`} />;
}

function CopyStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:   "text-edge border-edge/30 bg-edge/5",
    filled:    "text-up border-up/30 bg-up/5",
    failed:    "text-down border-down/30 bg-down/5",
    skipped:   "text-muted-foreground border-border",
    simulated: "text-teal border-teal/30 bg-teal/5",
  };
  const icons: Record<string, any> = {
    pending:   <Clock size={9} className="mr-1" />,
    filled:    <CheckCircle size={9} className="mr-1" />,
    failed:    <XCircle size={9} className="mr-1" />,
    simulated: <Zap size={9} className="mr-1" />,
  };
  return (
    <Badge variant="outline" className={`text-[10px] capitalize flex items-center w-fit ${map[status] || ""}`}>
      {icons[status]}{status}
    </Badge>
  );
}

// ── Add Wallet Form ───────────────────────────────────────────────────────────
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md bg-card border-border shadow-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-display font-700 flex items-center gap-2">
            <Plus size={13} className="text-teal" />Add Wallet to Copy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground uppercase tracking-wider">Wallet Address</label>
            <Input placeholder="0x4e2355789ae74089..." value={address} onChange={(e) => setAddress(e.target.value)}
              className="font-mono text-xs" />
            {address && !valid && <p className="text-[11px] text-down">Must be a valid 0x address (42 chars)</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground uppercase tracking-wider">Label (optional)</label>
            <Input placeholder="e.g. Whale #1, Top Trader" value={label} onChange={(e) => setLabel(e.target.value)} className="text-xs" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground uppercase tracking-wider">Copy Size %</label>
            <div className="flex items-center gap-2">
              <Input type="number" min={1} max={200} value={copyPct} onChange={(e) => setCopyPct(e.target.value)} className="w-24 text-xs" />
              <span className="text-xs text-muted-foreground">% of their bet size</span>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={() => addMutation.mutate()} disabled={!valid || addMutation.isPending}
              className="flex-1 bg-teal text-background hover:bg-teal/90 text-xs font-display font-700">
              {addMutation.isPending ? "Adding…" : "Add Wallet"}
            </Button>
            <Button size="sm" variant="outline" onClick={onClose} className="text-xs">Cancel</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Wallet Card ───────────────────────────────────────────────────────────────
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

  return (
    <Card className={`bg-card border-border card-lift transition-all ${wallet.isActive ? "border-teal/20" : "opacity-55"}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <StatusDot active={wallet.isActive} />
              <p className="font-display font-700 text-sm text-foreground">{wallet.label || shortAddr(wallet.address)}</p>
            </div>
            <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{shortAddr(wallet.address)}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-teal" onClick={() => onSync(wallet.id)} title="Sync now">
              <RefreshCw size={12} />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-edge"
              onClick={() => toggleMutation.mutate()} disabled={toggleMutation.isPending}
              title={wallet.isActive ? "Pause" : "Resume"}>
              {wallet.isActive ? <Pause size={12} /> : <Play size={12} />}
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-down"
              onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} title="Remove">
              <Trash2 size={12} />
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Copied", value: wallet.totalCopied },
            { label: "Copy %", value: `${wallet.copyPct}%` },
            { label: "PNL", value: `${pnlPositive ? "+" : ""}$${(wallet.totalPnl || 0).toFixed(2)}`, color: pnlPositive ? "text-up" : "text-down" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-secondary/40 rounded-lg p-2 text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className={`text-sm font-display font-700 mt-0.5 ${color || "text-foreground"}`}>{value}</p>
            </div>
          ))}
        </div>

        {wallet.lastSeen && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock size={10} />Last trade {formatDistanceToNow(new Date(wallet.lastSeen), { addSuffix: true })}
          </p>
        )}

        <a href={`https://polymarket.com/profile/${wallet.address}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] text-teal hover:text-teal/80 transition-colors">
          <ExternalLink size={10} />View on Polymarket
        </a>
      </CardContent>
    </Card>
  );
}

// ── Activity feed ─────────────────────────────────────────────────────────────
function ActivityFeed({ trades }: { trades: any[] }) {
  if (!trades.length) return null;
  const recent = trades.slice(0, 8);
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-display font-700 flex items-center gap-2">
          <Activity size={13} className="text-up" />Live Activity Feed
        </CardTitle>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-up pulse-dot" />
          <span className="text-xs text-muted-foreground">Polls every 60s</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/50">
          {recent.map((t: any) => (
            <div key={t.id} className="px-4 py-3 flex items-center justify-between sweep-in">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate pr-2">{t.market}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {shortAddr(t.walletAddress)} · {t.side} {t.outcome} · ${t.usdcSpent?.toFixed(2)}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <CopyStatusBadge status={t.status} />
                {t.createdAt && (
                  <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
                    {formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CopyTrade() {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeTab, setActiveTab] = useState<"wallets" | "trades">("wallets");

  const { data: wallets = [], isLoading: walletsLoading } = useQuery({ queryKey: ["/api/copy/wallets"], refetchInterval: 30000 });
  const { data: stats } = useQuery({ queryKey: ["/api/copy/stats"], refetchInterval: 30000 });
  const { data: copyTrades = [], isLoading: tradesLoading } = useQuery({
    queryKey: ["/api/copy/trades"],
    queryFn: () => apiRequest("GET", "/api/copy/trades?limit=100").then((r) => r.json()),
    refetchInterval: 10000,
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
  const totalSpent = tradeList.reduce((acc, t) => acc + (t.usdcSpent || 0), 0);

  return (
    <div className="p-6 space-y-5">
      {showAddForm && <AddWalletForm onClose={() => setShowAddForm(false)} />}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-800 text-foreground tracking-tight flex items-center gap-2">
            <Copy size={20} className="text-teal" />Copy Trading
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Mirror Polymarket whale wallets automatically</p>
        </div>
        <Button size="sm" onClick={() => setShowAddForm(true)}
          className="bg-teal text-background hover:bg-teal/90 text-xs font-display font-700 gap-1.5 h-9">
          <Plus size={12} />Add Wallet
        </Button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Wallets Tracked", value: s.totalWallets ?? 0, icon: Wallet, color: "text-foreground" },
          { label: "Active", value: s.activeWallets ?? 0, icon: Activity, color: "text-teal" },
          { label: "Trades Copied", value: s.filled ?? 0, icon: CheckCircle, color: "text-up" },
          { label: "Success Rate", value: `${successRate}%`, icon: TrendingUp, color: "text-edge" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                <Icon size={15} className={color} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
                <p className={`text-xl font-display font-700 ${color}`}>{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(["wallets", "trades"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-full text-xs font-display font-700 border transition-all capitalize ${
              activeTab === tab ? "text-teal border-teal bg-teal/10" : "text-muted-foreground border-border hover:border-foreground/30"
            }`}>
            {tab === "wallets" ? `Wallets (${walletList.length})` : `Copy Trades (${tradeList.length})`}
          </button>
        ))}
      </div>

      {/* Wallets tab */}
      {activeTab === "wallets" && (
        <>
          {walletsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-44" />)}
            </div>
          ) : walletList.length === 0 ? (
            <Card className="bg-card border-border border-dashed">
              <CardContent className="p-10 text-center space-y-3">
                <Wallet size={32} className="text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">No wallets added yet</p>
                <p className="text-xs text-muted-foreground/60">Add a Polymarket wallet to start copying trades automatically</p>
                <Button size="sm" onClick={() => setShowAddForm(true)}
                  className="bg-teal text-background hover:bg-teal/90 text-xs font-display font-700 gap-1.5 mt-2">
                  <Plus size={12} />Add First Wallet
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {walletList.map((w: any) => (
                <WalletCard key={w.id} wallet={w} onSync={(id) => syncMutation.mutate(id)} />
              ))}
            </div>
          )}

          {/* How it works */}
          <Card className="bg-card border-border">
            <CardContent className="p-5 space-y-3">
              <h3 className="text-sm font-display font-700 text-foreground flex items-center gap-2">
                <Copy size={12} className="text-teal" />How Copy Trading Works
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
                <div><p className="text-foreground font-medium mb-1">1. Add a Wallet</p><p>Paste any Polymarket wallet address. Set what % of their bet size to mirror.</p></div>
                <div><p className="text-foreground font-medium mb-1">2. Auto-copy Every 60s</p><p>Engine polls activity. When a new trade is detected, it places the same order using your Polymarket key.</p></div>
                <div><p className="text-foreground font-medium mb-1">3. Track Performance</p><p>All copied trades appear in the Trades tab with fill price, status, and PNL.</p></div>
              </div>
              <div className="mt-2 p-3 rounded-lg bg-secondary/40 border border-border text-xs text-muted-foreground">
                <span className="text-edge font-medium">Connected wallet: </span>
                <span className="font-mono">0x4e2355…e6093</span>
                <span className="mx-2 text-border">·</span>
                <span className="text-teal">Private key configured ✓</span>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Trades tab */}
      {activeTab === "trades" && (
        <>
          {/* Activity feed */}
          <ActivityFeed trades={tradeList} />

          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-display font-700 flex items-center gap-2">
                <TrendingUp size={13} className="text-teal" />All Copied Trades
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {tradesLoading ? (
                <div className="px-5 pb-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              ) : tradeList.length === 0 ? (
                <p className="text-sm text-muted-foreground px-5 pb-4">No copy trades yet. Add a wallet and the engine will start copying.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-secondary/20">
                        {["Wallet", "Market", "Side", "Outcome", "Size", "Price", "USDC", "Status", "Order ID", "Time"].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-muted-foreground font-medium uppercase tracking-wider whitespace-nowrap text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {tradeList.map((t: any) => (
                        <tr key={t.id} className="hover:bg-secondary/30 transition-colors">
                          <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{shortAddr(t.walletAddress)}</td>
                          <td className="px-4 py-3 max-w-[160px]">
                            <p className="truncate font-medium text-foreground" title={t.market}>{t.market}</p>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={`text-[10px] ${t.side === "BUY" ? "text-up border-up/30" : "text-down border-down/30"}`}>{t.side}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={`text-[10px] ${t.outcome === "Yes" ? "text-up border-up/30" : "text-down border-down/30"}`}>{t.outcome}</Badge>
                          </td>
                          <td className="px-4 py-3 font-medium text-foreground">{t.size?.toFixed(2)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{(t.price * 100).toFixed(1)}¢</td>
                          <td className="px-4 py-3 text-edge font-medium">${t.usdcSpent?.toFixed(2)}</td>
                          <td className="px-4 py-3"><CopyStatusBadge status={t.status} /></td>
                          <td className="px-4 py-3">
                            {t.polyOrderId ? (
                              <span className="font-mono text-[10px] text-muted-foreground truncate block max-w-[80px]" title={t.polyOrderId}>{t.polyOrderId.slice(0, 8)}…</span>
                            ) : <span className="text-muted-foreground/30">—</span>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                            {t.createdAt ? formatDistanceToNow(new Date(t.createdAt), { addSuffix: true }) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
