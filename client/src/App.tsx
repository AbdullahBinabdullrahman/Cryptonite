import { Switch, Route, Link, useLocation, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient, apiRequest, setAuthToken } from "@/lib/queryClient";
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
import { LiveBotSprite } from "@/components/BotSprite";
import TerminalChat from "@/pages/TerminalChat";
import Analytics from "@/pages/Analytics";
import {
  LayoutDashboard, TrendingUp, List, Settings2, Zap, Copy,
  Bot, Menu, X, PieChart, Terminal, BarChart2
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/",          icon: LayoutDashboard, label: "Dashboard",  code: "01" },
  { href: "/portfolio", icon: PieChart,        label: "Portfolio",  code: "02" },
  { href: "/markets",   icon: TrendingUp,      label: "Markets",    code: "03" },
  { href: "/trades",    icon: List,            label: "Trades",     code: "04" },
  { href: "/copy",      icon: Copy,            label: "Copy Trade", code: "05" },
  { href: "/chat",       icon: Terminal,  label: "AI Agent",   code: "06" },
  { href: "/analytics",  icon: BarChart2,  label: "Analytics",  code: "07" },
  { href: "/settings",   icon: Settings2, label: "Config",     code: "08" },
];

// ── Bot status display ────────────────────────────────────────────────────────
function BotStatus() {
  const { data } = useQuery({ queryKey: ["/api/dashboard"], refetchInterval: 15000, staleTime: 10000 });
  const d: any = data || {};
  const running = d.isRunning === true;
  const pnl = d.todayPnl ?? 0;
  return (
    <div className="flex items-center gap-2 px-2 py-1" style={{ fontFamily: "var(--font-pixel)", fontSize: 7 }}>
      <div className={`w-2 h-2 flex-shrink-0 ${running ? "bg-green-400 pulse-dot" : "bg-gray-600"}`}
           style={{ boxShadow: running ? "0 0 6px #0f0" : "none" }} />
      <span className={running ? "text-green-400" : "text-gray-500"} style={{ letterSpacing: "0.05em" }}>
        {running ? `BOT:ON  +$${pnl.toFixed(2)}` : "BOT:OFF"}
      </span>
    </div>
  );
}

// ── Desktop sidebar ───────────────────────────────────────────────────────────
function Sidebar({ onClose }: { onClose?: () => void }) {
  const [location] = useLocation();

  return (
    <div className="flex flex-col h-full" style={{ background: "hsl(220 20% 4%)" }}>

      {/* ── ASCII logo area ── */}
      <div className="p-4 border-b" style={{ borderColor: "hsl(120 40% 12%)" }}>
        <div className="flex items-center justify-between">
          <div>
            {/* Pixel logo */}
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-8 h-8 flex items-center justify-center flex-shrink-0"
                style={{
                  background: "hsl(220 20% 4%)",
                  border: "2px solid hsl(120 100% 50% / 0.6)",
                  boxShadow: "0 0 10px hsl(120 100% 50% / 0.4), inset 0 0 10px hsl(120 100% 50% / 0.1)"
                }}
              >
                <Zap className="w-4 h-4" style={{ color: "hsl(120 100% 60%)", filter: "drop-shadow(0 0 4px #0f0)" }} />
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-pixel)", fontSize: 9, color: "hsl(120 100% 65%)", textShadow: "0 0 10px hsl(120 100% 50% / 0.6)", letterSpacing: "0.05em" }}>
                  POLYBOT
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(45 100% 55%)", letterSpacing: "0.05em" }}>
                  BTC EDGE v2.0
                </div>
              </div>
            </div>
            {/* System status line */}
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 40% 35%)" }}>
              SYS: <span style={{ color: "hsl(120 100% 55%)" }}>ONLINE</span>
              <span className="blink" style={{ color: "hsl(120 100% 55%)" }}>_</span>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="md:hidden p-1" style={{ color: "hsl(120 40% 40%)" }}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ── Bot sprite ── */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "12px 0 8px",
        borderBottom: "1px solid hsl(120 40% 10%)",
        borderTop: "1px solid hsl(120 40% 10%)",
        background: "hsl(220 20% 3%)",
      }}>
        <LiveBotSprite size={4} label={true} />
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {/* Section label */}
        <div className="px-4 mb-2" style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 30% 30%)", letterSpacing: "0.1em" }}>
          ▸ NAVIGATION
        </div>

        {NAV_ITEMS.map(({ href, icon: Icon, label, code }) => {
          const active = location === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className="flex items-center gap-3 px-4 py-2.5 mx-2 mb-0.5 transition-all duration-100 relative"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: active ? "hsl(120 100% 65%)" : "hsl(120 40% 40%)",
                background: active ? "hsl(120 100% 50% / 0.07)" : "transparent",
                border: active ? "1px solid hsl(120 60% 20%)" : "1px solid transparent",
                letterSpacing: "0.05em",
                boxShadow: active ? "0 0 12px hsl(120 100% 50% / 0.1), inset 0 0 12px hsl(120 100% 50% / 0.05)" : "none",
              }}
            >
              {/* Active arrow */}
              {active && (
                <span style={{ position: "absolute", left: 4, color: "hsl(120 100% 55%)", fontSize: 8, textShadow: "0 0 8px hsl(120 100% 50%)" }}>▶</span>
              )}
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: active ? "hsl(45 100% 55%)" : "hsl(120 25% 30%)", minWidth: 16 }}>
                {code}
              </span>
              <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ filter: active ? "drop-shadow(0 0 4px hsl(120 100% 50%))" : "none" }} />
              <span>{label.toUpperCase()}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Bot status terminal box ── */}
      <div
        className="mx-3 mb-3 p-3"
        style={{
          background: "hsl(220 20% 3%)",
          border: "1px solid hsl(120 40% 12%)",
          boxShadow: "inset 0 0 12px hsl(120 100% 50% / 0.03)"
        }}
      >
        <div style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 30% 30%)", letterSpacing: "0.1em", marginBottom: 6 }}>
          ▸ SYSTEM STATUS
        </div>
        <BotStatus />
      </div>

      {/* Attribution */}
      <div className="px-4 pb-4" style={{ borderTop: "1px dashed hsl(120 30% 12%)", paddingTop: 8 }}>
        <PerplexityAttribution />
      </div>
    </div>
  );
}

// ── Mobile top bar ────────────────────────────────────────────────────────────
function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2 md:hidden"
      style={{
        background: "hsl(220 20% 4%)",
        borderBottom: "1px solid hsl(120 40% 12%)"
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 flex items-center justify-center"
          style={{ border: "1px solid hsl(120 100% 50% / 0.5)", boxShadow: "0 0 8px hsl(120 100% 50% / 0.3)" }}
        >
          <Zap className="w-3 h-3" style={{ color: "hsl(120 100% 60%)" }} />
        </div>
        <span style={{ fontFamily: "var(--font-pixel)", fontSize: 8, color: "hsl(120 100% 65%)", textShadow: "0 0 8px hsl(120 100% 50% / 0.5)" }}>
          POLYBOT
        </span>
      </div>
      <div className="flex items-center gap-2">
        <BotStatus />
        <button
          onClick={onMenu}
          className="p-1.5 transition-colors"
          style={{ border: "1px solid hsl(120 40% 15%)", color: "hsl(120 40% 50%)" }}
        >
          <Menu size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Mobile bottom nav ─────────────────────────────────────────────────────────
function MobileBottomNav() {
  const [location] = useLocation();
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
      style={{
        background: "hsl(220 20% 4%)",
        borderTop: "1px solid hsl(120 40% 12%)"
      }}
    >
      <div className="flex items-center">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = location === href;
          return (
            <Link
              key={href}
              href={href}
              className="flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors"
              style={{
                color: active ? "hsl(120 100% 60%)" : "hsl(120 30% 35%)",
                filter: active ? "drop-shadow(0 0 4px hsl(120 100% 50%))" : "none"
              }}
            >
              <Icon className="w-4 h-4" />
              <span style={{ fontFamily: "var(--font-pixel)", fontSize: 6, letterSpacing: "0.05em" }}>
                {label.toUpperCase().slice(0, 4)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ── Scanline sweep overlay ─────────────────────────────────────────────────────
function ScanlineSweep() {
  return <div className="scanline-sweep pointer-events-none" />;
}

// ── AppShell (main UI) ─────────────────────────────────────────────────────────
function AppShell() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen" style={{ background: "hsl(220 20% 4%)", color: "hsl(120 100% 75%)" }}>
      <Router hook={useHashLocation}>
        <ScanlineSweep />

        {/* ── Desktop sidebar ── */}
        <aside
          className="hidden md:flex fixed left-0 top-0 h-full flex-col z-50"
          style={{
            width: 220,
            borderRight: "1px solid hsl(120 40% 12%)",
            boxShadow: "4px 0 20px hsl(120 100% 50% / 0.04)"
          }}
        >
          <Sidebar />
        </aside>

        {/* ── Mobile drawer overlay ── */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-[60] md:hidden">
            <div
              className="absolute inset-0"
              style={{ background: "rgba(0,0,0,0.8)" }}
              onClick={() => setMobileMenuOpen(false)}
            />
            <aside
              className="absolute left-0 top-0 h-full flex flex-col shadow-2xl"
              style={{
                width: 240,
                borderRight: "1px solid hsl(120 40% 12%)"
              }}
            >
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

          {/* Page content */}
          <main className="flex-1 pb-20 md:pb-0">
            <Switch>
              <Route path="/"          component={Dashboard}  />
              <Route path="/portfolio" component={Portfolio}  />
              <Route path="/markets"   component={Markets}    />
              <Route path="/trades"    component={Trades}     />
              <Route path="/copy"      component={CopyTrade}    />
              <Route path="/chat"       component={TerminalChat} />
              <Route path="/analytics"  component={Analytics}    />
              <Route path="/settings"   component={Settings}     />
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

// ── Auth gate (needs QueryClientProvider as parent) ───────────────────────────
function AuthGate() {
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);

  // On mount, the browser automatically sends the HttpOnly 'polybot_token'
  // cookie (set by the server on login) with this request. The server reads
  // the cookie and returns { loggedIn: true } if the JWT is still valid.
  const { data: authData, isLoading } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: () => apiRequest("GET", "/api/auth/me")
      .then(r => r.json())
      .catch(() => ({ loggedIn: false })),
    retry: false,
    staleTime: 5 * 60 * 1000,   // re-validate every 5 min
    refetchInterval: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "hsl(220 20% 4%)" }}
      >
        <div className="text-center">
          <div
            className="w-12 h-12 mx-auto mb-4 flex items-center justify-center"
            style={{ border: "2px solid hsl(120 100% 50% / 0.5)", boxShadow: "0 0 20px hsl(120 100% 50% / 0.3)" }}
          >
            <Zap className="w-5 h-5 animate-pulse" style={{ color: "hsl(120 100% 60%)" }} />
          </div>
          <div style={{ fontFamily: "var(--font-pixel)", fontSize: 8, color: "hsl(120 60% 45%)", letterSpacing: "0.1em" }}>
            LOADING SYS
            <span className="blink">_</span>
          </div>
        </div>
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

// ── Root ─────────────────────────────────────────────────────────────────────
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  );
}

export default App;
