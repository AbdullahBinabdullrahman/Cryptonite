import { Switch, Route, Link, useLocation, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Dashboard from "@/pages/Dashboard";
import Markets from "@/pages/Markets";
import Trades from "@/pages/Trades";
import CopyTrade from "@/pages/CopyTrade";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import PerplexityAttribution from "@/components/PerplexityAttribution";
import { LiveTicker } from "@/components/LiveTicker";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Portfolio from "@/pages/Portfolio";
import {
  LayoutDashboard, TrendingUp, List, Settings2, Zap, Copy,
  Bot, Menu, X, PieChart
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/",          icon: LayoutDashboard, label: "Dashboard"  },
  { href: "/portfolio", icon: PieChart,        label: "Portfolio"  },
  { href: "/markets",   icon: TrendingUp,      label: "Markets"    },
  { href: "/trades",    icon: List,            label: "Trades"     },
  { href: "/copy",      icon: Copy,            label: "Copy Trade" },
  { href: "/settings",  icon: Settings2,       label: "Settings"   },
];

// ── Bot status pill ───────────────────────────────────────────────────────────
function BotPill() {
  const { data } = useQuery({ queryKey: ["/api/dashboard"], refetchInterval: 5000 });
  const d: any = data || {};
  const running = d.isRunning === true;
  const pnl = d.todayPnl ?? 0;
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary/60 border border-border">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${running ? "bg-up pulse-dot" : "bg-muted-foreground/40"}`} />
      <span className={`text-[10px] font-medium ${running ? "text-up" : "text-muted-foreground"}`}>
        {running ? `+$${pnl.toFixed(2)} today` : "Stopped"}
      </span>
    </div>
  );
}

// ── Desktop sidebar ───────────────────────────────────────────────────────────
function Sidebar({ onClose }: { onClose?: () => void }) {
  const [location] = useLocation();
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal/15 border border-teal/30 flex items-center justify-center glow-teal flex-shrink-0">
            <Zap className="w-4 h-4 text-teal" />
          </div>
          <div>
            <div className="font-display font-800 text-sm text-foreground tracking-tight">PolyBot</div>
            <div className="text-[10px] text-muted-foreground">BTC Edge Trader</div>
          </div>
        </div>
        {/* Close button — mobile only */}
        {onClose && (
          <button onClick={onClose} className="md:hidden p-1 text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = location === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                active
                  ? "bg-teal/15 text-teal border border-teal/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bot status */}
      <div className="p-3 mx-2 mb-2 rounded-xl bg-secondary/40 border border-border">
        <BotPill />
      </div>

      {/* Attribution */}
      <div className="p-4 border-t border-border">
        <PerplexityAttribution />
      </div>
    </div>
  );
}

// ── Mobile top bar ────────────────────────────────────────────────────────────
function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border md:hidden">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-teal/15 border border-teal/30 flex items-center justify-center">
          <Zap className="w-3.5 h-3.5 text-teal" />
        </div>
        <span className="font-display font-800 text-sm text-foreground">PolyBot</span>
      </div>
      <div className="flex items-center gap-2">
        <BotPill />
        <button
          onClick={onMenu}
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
        >
          <Menu size={18} />
        </button>
      </div>
    </div>
  );
}

// ── Mobile bottom nav ─────────────────────────────────────────────────────────
function MobileBottomNav() {
  const [location] = useLocation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border md:hidden">
      <div className="flex items-center">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = location === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors ${
                active ? "text-teal" : "text-muted-foreground"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[9px] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ── AppShell (main UI) ───────────────────────────────────────────────────────────────────────
function AppShell() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
        <Router hook={useHashLocation}>

          {/* ── Desktop sidebar (hidden on mobile) ── */}
          <aside className="hidden md:flex fixed left-0 top-0 h-full w-[220px] bg-card border-r border-border flex-col z-50">
            <Sidebar />
          </aside>

          {/* ── Mobile drawer overlay ── */}
          {mobileMenuOpen && (
            <div className="fixed inset-0 z-[60] md:hidden">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
              <aside className="absolute left-0 top-0 h-full w-[260px] bg-card border-r border-border flex flex-col shadow-2xl">
                <Sidebar onClose={() => setMobileMenuOpen(false)} />
              </aside>
            </div>
          )}

          {/* ── Main content ── */}
          <div className="md:ml-[220px] flex flex-col min-h-screen">

            {/* Mobile top bar */}
            <MobileTopBar onMenu={() => setMobileMenuOpen(true)} />

            {/* Ticker */}
            <LiveTicker />

            {/* Page content — extra bottom padding on mobile for bottom nav */}
            <main className="flex-1 pb-20 md:pb-0">
              <Switch>
                <Route path="/"          component={Dashboard}  />
                <Route path="/portfolio" component={Portfolio}  />
                <Route path="/markets"   component={Markets}    />
                <Route path="/trades"    component={Trades}     />
                <Route path="/copy"      component={CopyTrade}  />
                <Route path="/settings"  component={Settings}   />
                <Route component={NotFound} />
              </Switch>
            </main>
          </div>

          {/* Mobile bottom nav */}
          <MobileBottomNav />

        </Router>
        <Toaster />
      </div>
  );
}

// ── Auth gate (needs QueryClientProvider as parent) ──────────────────────────
function AuthGate() {
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);

  const { data: authData, isLoading } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: () => apiRequest("GET", "/api/auth/me").then(r => r.json()),
    retry: false,
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
      </div>
    );
  }

  if (!authData?.loggedIn && !authedEmail) {
    return (
      <>
        <Login onLogin={e => setAuthedEmail(e)} />
        <Toaster />
      </>
    );
  }

  return <AppShell />;
}

// ── Root — QueryClientProvider wraps everything ───────────────────────────────
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  );
}

export default App;
