import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Slider } from "@/components/ui/slider";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormControl, FormMessage } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { RefreshCw, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { ConnectionStatus } from "@/components/ConnectionStatus";

const settingsSchema = z.object({
  alpacaApiKey: z.string().min(1, "API key is required"),
  alpacaApiSecret: z.string().optional(),
  polymarketWallet: z.string().optional(),
  betSize: z.number().min(1).max(1000),
  maxBetsPerDay: z.number().min(1).max(500),
  dailyStopLossPct: z.number().min(1).max(50),
  minEdgePct: z.number().min(0.5).max(20),
  startingBalance: z.number().min(1),
});

type SettingsForm = z.infer<typeof settingsSchema>;

const retro = {
  page: { padding: "1.25rem", display: "flex", flexDirection: "column" as const, gap: "1.25rem" },
  panel: {
    background: "hsl(220 20% 5%)",
    border: "1px solid hsl(120 100% 55% / 0.25)",
    borderRadius: "2px",
    position: "relative" as const,
  },
  panelHeader: {
    background: "hsl(120 100% 55% / 0.06)",
    borderBottom: "1px solid hsl(120 100% 55% / 0.2)",
    padding: "0.5rem 0.875rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  panelTitle: {
    fontFamily: "var(--font-pixel)",
    fontSize: "0.55rem",
    color: "hsl(120 100% 55%)",
    letterSpacing: "0.08em",
  },
  panelBody: { padding: "0.875rem" },
  label: {
    fontFamily: "var(--font-pixel)",
    fontSize: "0.5rem",
    color: "hsl(120 100% 55% / 0.7)",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    display: "block",
    marginBottom: "0.375rem",
  },
  input: {
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
  },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.35rem" },
  valueTag: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.75rem",
    color: "hsl(45 100% 55%)",
    background: "hsl(45 100% 55% / 0.08)",
    border: "1px solid hsl(45 100% 55% / 0.3)",
    borderRadius: "2px",
    padding: "0.1rem 0.4rem",
  },
  hint: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.6rem",
    color: "hsl(120 100% 55% / 0.45)",
    marginTop: "0.35rem",
    lineHeight: 1.6,
  },
  divider: { borderColor: "hsl(120 100% 55% / 0.1)", margin: "0.75rem 0" },
  btn: {
    width: "100%",
    padding: "0.65rem",
    background: "transparent",
    border: "2px solid hsl(120 100% 55%)",
    borderRadius: "2px",
    color: "hsl(120 100% 55%)",
    fontFamily: "var(--font-pixel)",
    fontSize: "0.55rem",
    letterSpacing: "0.1em",
    cursor: "pointer",
    textTransform: "uppercase" as const,
    transition: "all 0.15s",
  },
};

// Corner accents for retro panels
function CornerAccents({ color = "hsl(120 100% 55%)" }: { color?: string }) {
  const s = (pos: any) => ({
    position: "absolute" as const, width: 8, height: 8, ...pos,
  });
  return (
    <>
      <div style={{ ...s({ top: -1, left: -1 }), borderTop: `2px solid ${color}`, borderLeft: `2px solid ${color}` }} />
      <div style={{ ...s({ top: -1, right: -1 }), borderTop: `2px solid ${color}`, borderRight: `2px solid ${color}` }} />
      <div style={{ ...s({ bottom: -1, left: -1 }), borderBottom: `2px solid ${color}`, borderLeft: `2px solid ${color}` }} />
      <div style={{ ...s({ bottom: -1, right: -1 }), borderBottom: `2px solid ${color}`, borderRight: `2px solid ${color}` }} />
    </>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const [showSecret, setShowSecret] = useState(false);

  const { data: settings } = useQuery({ queryKey: ["/api/settings"] });

  const { data: alpacaData, isLoading: alpacaLoading, refetch: refetchAlpaca } = useQuery({
    queryKey: ["/api/alpaca/account"],
    queryFn: () => apiRequest("GET", "/api/alpaca/account").then(r => r.json()),
    retry: false,
    refetchInterval: false,
  });

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      alpacaApiKey: "",
      alpacaApiSecret: "",
      polymarketWallet: "",
      betSize: 2,
      maxBetsPerDay: 50,
      dailyStopLossPct: 15,
      minEdgePct: 3,
      startingBalance: 100,
    },
  });

  useEffect(() => {
    if (settings) {
      const s: any = settings;
      form.reset({
        alpacaApiKey: s.alpacaApiKey || "",
        alpacaApiSecret: "",
        polymarketWallet: s.polymarketWallet || "",
        betSize: s.betSize || 2,
        maxBetsPerDay: s.maxBetsPerDay || 50,
        dailyStopLossPct: s.dailyStopLossPct || 15,
        minEdgePct: s.minEdgePct || 3,
        startingBalance: s.startingBalance || 100,
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: SettingsForm) => {
      const payload: any = { ...data };
      if (!payload.alpacaApiSecret || payload.alpacaApiSecret === "••••••••••••") {
        delete payload.alpacaApiSecret;
      }
      return apiRequest("PATCH", "/api/settings", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alpaca/account"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setTimeout(() => refetchAlpaca(), 500);
      toast({ title: "Settings saved", description: "Syncing balance from Alpaca..." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const s: any = settings || {};
  const hasApiKey = s.alpacaApiKey && s.alpacaApiKey.length > 0;
  const alpaca: any = alpacaData || {};
  const alpacaConnected = alpaca.ok === true;
  const alpacaIsLive = alpaca.isLive === true;
  const alpacaPortfolio = alpacaConnected && alpaca.account ? parseFloat(alpaca.account.portfolio_value || "0") : null;
  const alpacaCash = alpacaConnected && alpaca.account ? parseFloat(alpaca.account.cash || "0") : null;
  const alpacaBuyingPower = alpacaConnected && alpaca.account ? parseFloat(alpaca.account.buying_power || "0") : null;

  const betSize = form.watch("betSize") || 2;
  const stopLoss = form.watch("dailyStopLossPct") || 15;
  const startingBal = form.watch("startingBalance") || 100;
  const maxBets = form.watch("maxBetsPerDay") || 50;

  const statusColor = alpacaConnected
    ? alpacaIsLive ? "hsl(120 100% 55%)" : "hsl(45 100% 55%)"
    : hasApiKey ? "hsl(45 100% 55%)" : "hsl(0 90% 55%)";

  const statusText = alpacaConnected
    ? `[ ${alpacaIsLive ? "LIVE" : "PAPER"} ] ALPACA UPLINK ESTABLISHED`
    : hasApiKey ? "[ VERIFYING ] KEYS SAVED — AWAITING AUTH"
    : "[ OFFLINE ] NO UPLINK CONFIGURED";

  return (
    <div style={retro.page}>
      {/* Page header */}
      <div style={{ borderBottom: "1px solid hsl(120 100% 55% / 0.15)", paddingBottom: "0.75rem" }}>
        <div style={{ fontFamily: "var(--font-pixel)", fontSize: "0.8rem", color: "hsl(120 100% 55%)", letterSpacing: "0.1em" }}>
          ⚙ SYSTEM.CONFIG
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "hsl(120 100% 55% / 0.5)", marginTop: "0.25rem" }}>
          CONFIGURE ALPACA UPLINK AND BOT PARAMETERS
        </div>
      </div>

      {/* Connection status component */}
      <ConnectionStatus refetchInterval={30000} />

      <Form {...form}>
        <form onSubmit={form.handleSubmit((d) => saveMutation.mutate(d))} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

          {/* Alpaca status terminal readout */}
          <div style={{ ...retro.panel, borderColor: `${statusColor}40` }}>
            <CornerAccents color={statusColor} />
            <div style={{ ...retro.panelHeader, borderBottomColor: `${statusColor}30` }}>
              <span style={{ ...retro.panelTitle, color: statusColor }}>▸ ALPACA UPLINK STATUS</span>
              <button
                type="button"
                onClick={() => refetchAlpaca()}
                style={{ background: "none", border: "none", cursor: "pointer", color: statusColor, padding: 0 }}
                title="Refresh Alpaca connection"
              >
                <RefreshCw size={11} style={{ display: "block" }} className={alpacaLoading ? "animate-spin" : ""} />
              </button>
            </div>
            <div style={{ ...retro.panelBody, fontFamily: "var(--font-mono)", fontSize: "0.68rem" }}>
              <div style={{ color: statusColor, marginBottom: "0.5rem" }}>
                <span style={{ color: "hsl(120 100% 55% / 0.4)" }}>&gt; STATUS: </span>
                {statusText}
              </div>

              {alpacaConnected && (
                <>
                  <div style={{ color: "hsl(120 100% 55% / 0.5)", marginBottom: "0.5rem", fontSize: "0.6rem" }}>
                    ACCOUNT: {alpaca.account?.status || "ACTIVE"} · {alpaca.account?.currency || "USD"}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem", marginTop: "0.5rem" }}>
                    {[
                      { label: "PORTFOLIO", value: `$${alpacaPortfolio?.toFixed(2)}`, color: "hsl(120 100% 55%)" },
                      { label: "CASH", value: `$${alpacaCash?.toFixed(2)}`, color: "hsl(120 100% 55%)" },
                      { label: "BUYING PWR", value: `$${alpacaBuyingPower?.toFixed(2)}`, color: alpacaIsLive ? "hsl(120 100% 55%)" : "hsl(45 100% 55%)" },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{
                        background: "hsl(220 20% 3%)",
                        border: "1px solid hsl(120 100% 55% / 0.15)",
                        borderRadius: "2px",
                        padding: "0.5rem",
                        textAlign: "center",
                      }}>
                        <div style={{ fontFamily: "var(--font-pixel)", fontSize: "0.42rem", color: "hsl(120 100% 55% / 0.5)", letterSpacing: "0.08em", marginBottom: "0.3rem" }}>{label}</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", color }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {alpaca.ok === false && hasApiKey && (
                <div style={{ color: "hsl(0 90% 55%)", fontSize: "0.6rem", marginTop: "0.5rem" }}>
                  ERR: {alpaca.error}
                </div>
              )}
            </div>
          </div>

          {/* Alpaca API panel */}
          <div style={retro.panel}>
            <CornerAccents />
            <div style={retro.panelHeader}>
              <span style={retro.panelTitle}>▸ ALPACA UPLINK // API CREDENTIALS</span>
            </div>
            <div style={{ ...retro.panelBody, display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              <FormField
                control={form.control}
                name="alpacaApiKey"
                render={({ field }) => (
                  <FormItem>
                    <span style={retro.label}>API KEY</span>
                    <FormControl>
                      <input
                        {...field}
                        data-testid="input-alpaca-key"
                        placeholder="PKxxxxxxxxxxxxxxxxxxxxxxxx"
                        style={retro.input}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="alpacaApiSecret"
                render={({ field }) => (
                  <FormItem>
                    <span style={retro.label}>SECRET KEY</span>
                    <FormControl>
                      <div style={{ position: "relative" }}>
                        <input
                          {...field}
                          data-testid="input-alpaca-secret"
                          type={showSecret ? "text" : "password"}
                          placeholder="Leave blank to keep existing secret"
                          style={{ ...retro.input, paddingRight: "2rem" }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecret(!showSecret)}
                          style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "hsl(120 100% 55% / 0.6)", padding: 0 }}
                        >
                          {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="polymarketWallet"
                render={({ field }) => (
                  <FormItem>
                    <span style={retro.label}>POLYMARKET WALLET (OPTIONAL)</span>
                    <FormControl>
                      <input
                        {...field}
                        data-testid="input-wallet"
                        placeholder="0x... your Polygon wallet address"
                        style={retro.input}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div style={{ ...retro.hint, borderLeft: "2px solid hsl(120 100% 55% / 0.2)", paddingLeft: "0.5rem" }}>
                &gt; Keys stored locally in memory only. Never sent to 3rd parties.{" "}
                <a href="https://alpaca.markets" target="_blank" rel="noopener" style={{ color: "hsl(175 90% 55%)", textDecoration: "none" }}>alpaca.markets ↗</a>
              </div>
            </div>
          </div>

          {/* Capital config */}
          <div style={retro.panel}>
            <CornerAccents color="hsl(45 100% 55%)" />
            <div style={{ ...retro.panelHeader, borderBottomColor: "hsl(45 100% 55% / 0.2)" }}>
              <span style={{ ...retro.panelTitle, color: "hsl(45 100% 55%)" }}>▸ CAPITAL CONFIG</span>
            </div>
            <div style={retro.panelBody}>
              <FormField
                control={form.control}
                name="startingBalance"
                render={({ field }) => (
                  <FormItem>
                    <div style={retro.row}>
                      <span style={{ ...retro.label, marginBottom: 0 }}>STARTING BALANCE (USDC)</span>
                      <span style={retro.valueTag}>${field.value}</span>
                    </div>
                    <FormControl>
                      <Slider min={50} max={10000} step={50} value={[field.value]} onValueChange={([v]) => field.onChange(v)} className="mt-2" />
                    </FormControl>
                    <div style={retro.hint}>&gt; Set to your actual USDC starting balance for accurate PNL tracking.</div>
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* Bot parameters */}
          <div style={retro.panel}>
            <CornerAccents color="hsl(175 90% 55%)" />
            <div style={{ ...retro.panelHeader, borderBottomColor: "hsl(175 90% 55% / 0.2)" }}>
              <span style={{ ...retro.panelTitle, color: "hsl(175 90% 55%)" }}>▸ BOT PARAMETERS</span>
            </div>
            <div style={{ ...retro.panelBody, display: "flex", flexDirection: "column", gap: "1rem" }}>

              {/* Bet size */}
              <FormField
                control={form.control}
                name="betSize"
                render={({ field }) => (
                  <FormItem>
                    <div style={retro.row}>
                      <span style={{ ...retro.label, marginBottom: 0 }}>BET SIZE (USDC/TRADE)</span>
                      <span style={retro.valueTag}>${field.value}</span>
                    </div>
                    <FormControl>
                      <Slider min={1} max={50} step={1} value={[field.value]} onValueChange={([v]) => field.onChange(v)} className="mt-1" />
                    </FormControl>
                    <div style={retro.hint}>
                      &gt; {((betSize / startingBal) * 100).toFixed(1)}% of starting balance.{" "}
                      <span style={{ color: ((betSize / startingBal) * 100) <= 2 ? "hsl(120 100% 55%)" : "hsl(45 100% 55%)" }}>
                        {((betSize / startingBal) * 100) <= 2 ? "✓ SAFE (≤2%)" : "⚠ ABOVE 2% — CONSIDER REDUCING"}
                      </span>
                    </div>
                  </FormItem>
                )}
              />

              <hr style={retro.divider} />

              {/* Max bets per day */}
              <FormField
                control={form.control}
                name="maxBetsPerDay"
                render={({ field }) => (
                  <FormItem>
                    <div style={retro.row}>
                      <span style={{ ...retro.label, marginBottom: 0 }}>MAX BETS / DAY</span>
                      <span style={retro.valueTag}>{field.value}</span>
                    </div>
                    <FormControl>
                      <Slider min={5} max={200} step={5} value={[field.value]} onValueChange={([v]) => field.onChange(v)} className="mt-1" />
                    </FormControl>
                    <div style={retro.hint}>&gt; Max daily exposure: ${betSize * maxBets} USDC</div>
                  </FormItem>
                )}
              />

              <hr style={retro.divider} />

              {/* Daily stop loss */}
              <FormField
                control={form.control}
                name="dailyStopLossPct"
                render={({ field }) => (
                  <FormItem>
                    <div style={retro.row}>
                      <span style={{ ...retro.label, marginBottom: 0 }}>DAILY STOP LOSS</span>
                      <span style={{ ...retro.valueTag, color: "hsl(0 90% 55%)", background: "hsl(0 90% 55% / 0.08)", border: "1px solid hsl(0 90% 55% / 0.3)" }}>
                        {field.value}% = -${((startingBal * field.value) / 100).toFixed(0)}
                      </span>
                    </div>
                    <FormControl>
                      <Slider min={5} max={30} step={1} value={[field.value]} onValueChange={([v]) => field.onChange(v)} className="mt-1" />
                    </FormControl>
                    <div style={retro.hint}>&gt; Bot auto-stops if daily loss exceeds this %. Recommended: 15%.</div>
                  </FormItem>
                )}
              />

              <hr style={retro.divider} />

              {/* Min edge */}
              <FormField
                control={form.control}
                name="minEdgePct"
                render={({ field }) => (
                  <FormItem>
                    <div style={retro.row}>
                      <span style={{ ...retro.label, marginBottom: 0 }}>MIN EDGE TO BET</span>
                      <span style={{ ...retro.valueTag, color: "hsl(45 100% 55%)", background: "hsl(45 100% 55% / 0.08)", border: "1px solid hsl(45 100% 55% / 0.3)" }}>
                        {field.value}%
                      </span>
                    </div>
                    <FormControl>
                      <Slider min={1} max={15} step={0.5} value={[field.value]} onValueChange={([v]) => field.onChange(v)} className="mt-1" />
                    </FormControl>
                    <div style={retro.hint}>&gt; Only bet when odds diverge from BTC momentum by at least this amount. Recommended: 3–5%.</div>
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* Save button */}
          <button
            type="submit"
            disabled={saveMutation.isPending}
            data-testid="button-save-settings"
            style={{
              ...retro.btn,
              ...(saveMutation.isPending ? { opacity: 0.5, cursor: "not-allowed" } : {}),
            }}
            onMouseEnter={(e) => { if (!saveMutation.isPending) { (e.target as HTMLButtonElement).style.background = "hsl(120 100% 55% / 0.1)"; } }}
            onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = "transparent"; }}
          >
            {saveMutation.isPending ? "[ SAVING... ]" : "[ SAVE CONFIG ]"}
          </button>

        </form>
      </Form>
    </div>
  );
}
