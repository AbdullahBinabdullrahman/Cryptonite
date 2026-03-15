import { Switch, Route, Link, useLocation } from "wouter";
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
import PerplexityAttribution from "@/components/PerplexityAttribution";
import { LiveTicker } from "@/components/LiveTicker";
import { useQuery } from "@tanstack/react-query";
import { useLiveData } from "@/hooks/useLiveData";
import {
  LayoutDashboard, TrendingUp, List, Settings2, Zap, Copy,
  Bot, Activity
} from "lucide-react";

// ── Live sidebar bot status ───────────────────────────────────────────────────
function SidebarBotStatus() {
  const { data } = useQuery({
    queryKey: ["/api/dashboard"],
    refetchInterval: 5000,
  });
  const d: any = data || {};
  const running = d.isRunning === true;
  const todayPnl = d.todayPnl ?? 0;
  const todayCount = d.todayCount ?? 0;

  return (
    <div className="p-3 mx-2 mb-2 rounded-xl bg-secondary/40 border border-border space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${running ? "bg-up pulse-dot" : "bg-muted-foreground/40"}`} />
          <span className={`text-xs font-medium ${running ? "text-up" : "text-muted-foreground"}`}>
            {running ? "Bot Active" : "Bot Stopped"}
          </span>
        </div>
        <Bot size={13} className={running ? "text-up" : "text-muted-foreground"} />
      </div>
      {running && (
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Today PNL</p>
            <p className={`text-xs font-display font-700 ${todayPnl >= 0 ? "text-up" : "text-down"}`}>
              {todayPnl >= 0 ? "+" : ""}${todayPnl.toFixed(2)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Bets</p>
            <p className="text-xs font-display font-700 text-edge">{todayCount}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar() {
  const [location] = useLocation();
  const navItems = [
    { href: "/",        icon: LayoutDashboard, label: "Dashboard" },
    { href: "/markets", icon: TrendingUp,      label: "Markets"   },
    { href: "/trades",  icon: List,            label: "Trades"    },
    { href: "/copy",    icon: Copy,            label: "Copy Trade"},
    { href: "/settings",icon: Settings2,       label: "Settings"  },
  ];

  return (
    <aside className="fixed left-0 top-0 h-full w-[220px] bg-card border-r border-border flex flex-col z-50">
      {/* Logo */}
      <div className="p-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal/15 border border-teal/30 flex items-center justify-center glow-teal">
            <Zap className="w-4 h-4 text-teal" />
          </div>
          <div>
            <div className="font-display font-800 text-sm text-foreground tracking-tight">PolyBot</div>
            <div className="text-[10px] text-muted-foreground">BTC Edge Trader</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = location === href;
          return (
            <Link
              key={href}
              href={href}
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

      {/* Live bot status widget */}
      <SidebarBotStatus />

      {/* Attribution */}
      <div className="p-4 border-t border-border">
        <PerplexityAttribution />
      </div>
    </aside>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background text-foreground">
        <Router hook={useHashLocation}>
          <Sidebar />
          <div className="ml-[220px] flex flex-col min-h-screen">
            {/* Live ticker bar at top */}
            <LiveTicker />
            <main className="flex-1">
              <Switch>
                <Route path="/"        component={Dashboard} />
                <Route path="/markets" component={Markets}   />
                <Route path="/trades"  component={Trades}    />
                <Route path="/copy"    component={CopyTrade} />
                <Route path="/settings"component={Settings}  />
                <Route component={NotFound} />
              </Switch>
            </main>
          </div>
        </Router>
        <Toaster />
      </div>
    </QueryClientProvider>
  );
}

import { Router } from "wouter";
export default App;
