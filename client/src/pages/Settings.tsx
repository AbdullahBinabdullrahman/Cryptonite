import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Settings2, Shield, Zap, DollarSign, CheckCircle, AlertTriangle, Eye, EyeOff, Wifi, WifiOff, RefreshCw } from "lucide-react";
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

export default function Settings() {
  const { toast } = useToast();
  const [showSecret, setShowSecret] = useState(false);

  const { data: settings, isLoading } = useQuery({ queryKey: ["/api/settings"] });

  // Fetch real Alpaca account info
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

  // Populate form when settings load
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
      // Don't overwrite secret if left blank (shows ••••)
      if (!payload.alpacaApiSecret || payload.alpacaApiSecret === "••••••••••••") {
        delete payload.alpacaApiSecret;
      }
      return apiRequest("PATCH", "/api/settings", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alpaca/account"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      // Refetch Alpaca data immediately after save
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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-800 text-foreground tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure your Alpaca connection and bot parameters</p>
      </div>

      {/* Full connection status panel */}
      <ConnectionStatus refetchInterval={30000} />

      <Form {...form}>
        <form onSubmit={form.handleSubmit((d) => saveMutation.mutate(d))} className="space-y-6">

          {/* Connection Status */}
          <div className={`p-4 rounded-xl border ${
            alpacaConnected
              ? alpacaIsLive ? "border-up/25 bg-up/8" : "border-edge/25 bg-edge/8"
              : hasApiKey ? "border-edge/25 bg-edge/8" : "border-border bg-secondary/50"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {alpacaConnected ? (
                  <Wifi size={16} className={alpacaIsLive ? "text-up" : "text-edge"} />
                ) : hasApiKey ? (
                  <AlertTriangle size={16} className="text-edge" />
                ) : (
                  <WifiOff size={16} className="text-muted-foreground" />
                )}
                <div>
                  <p className={`text-sm font-medium ${
                    alpacaConnected ? (alpacaIsLive ? "text-up" : "text-edge") : hasApiKey ? "text-edge" : "text-muted-foreground"
                  }`}>
                    {alpacaConnected
                      ? `Alpaca ${alpacaIsLive ? "Live" : "Paper"} Account`
                      : hasApiKey ? "Keys saved — verifying..."
                      : "Alpaca Not Connected"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {alpacaConnected
                      ? `Status: ${alpaca.account?.status || "ACTIVE"} · ${alpaca.account?.currency || "USD"}`
                      : hasApiKey ? "Enter your secret key and save to connect."
                      : "Enter your Alpaca API keys below to enable the bot."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => refetchAlpaca()}
                className="text-muted-foreground hover:text-foreground p-1 rounded"
                title="Refresh Alpaca connection"
              >
                <RefreshCw size={13} className={alpacaLoading ? "animate-spin" : ""} />
              </button>
            </div>

            {/* Live balance breakdown */}
            {alpacaConnected && (
              <div className="mt-3 grid grid-cols-3 gap-3 pt-3 border-t border-border/50">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Portfolio</p>
                  <p className="text-sm font-display font-700 text-foreground mt-0.5">${alpacaPortfolio?.toFixed(2)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Cash</p>
                  <p className="text-sm font-display font-700 text-foreground mt-0.5">${alpacaCash?.toFixed(2)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Buying Power</p>
                  <p className={`text-sm font-display font-700 mt-0.5 ${
                    alpacaIsLive ? "text-up" : "text-edge"
                  }`}>${alpacaBuyingPower?.toFixed(2)}</p>
                </div>
              </div>
            )}

            {/* Error from Alpaca */}
            {alpaca.ok === false && hasApiKey && (
              <p className="mt-2 text-xs text-down">{alpaca.error}</p>
            )}
          </div>

          {/* Alpaca API */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-display font-700 flex items-center gap-2">
                <Shield size={14} className="text-teal" />
                Alpaca API Connection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="alpacaApiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground uppercase tracking-wider">API Key</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        data-testid="input-alpaca-key"
                        placeholder="PKxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="bg-secondary border-border font-mono text-sm"
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
                    <FormLabel className="text-xs text-muted-foreground uppercase tracking-wider">Secret Key</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          data-testid="input-alpaca-secret"
                          type={showSecret ? "text" : "password"}
                          placeholder="Leave blank to keep existing secret"
                          className="bg-secondary border-border font-mono text-sm pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecret(!showSecret)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
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
                    <FormLabel className="text-xs text-muted-foreground uppercase tracking-wider">Polymarket Wallet (optional)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        data-testid="input-wallet"
                        placeholder="0x... your Polygon wallet address"
                        className="bg-secondary border-border font-mono text-sm"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <p className="text-xs text-muted-foreground">
                Keys are stored locally in memory only. Never sent to any third party. Get your Alpaca keys at{" "}
                <a href="https://alpaca.markets" target="_blank" rel="noopener" className="text-teal underline">alpaca.markets</a>.
              </p>
            </CardContent>
          </Card>

          {/* Starting Balance */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-display font-700 flex items-center gap-2">
                <DollarSign size={14} className="text-teal" />
                Capital Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <FormField
                control={form.control}
                name="startingBalance"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-xs text-muted-foreground uppercase tracking-wider">Starting Balance (USDC)</FormLabel>
                      <span className="text-sm font-display font-700 text-teal">${field.value}</span>
                    </div>
                    <FormControl>
                      <Slider
                        min={50} max={10000} step={50}
                        value={[field.value]}
                        onValueChange={([v]) => field.onChange(v)}
                        className="mt-2"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Set this to your actual starting USDC balance for accurate PNL tracking.</p>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Bot Parameters */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-display font-700 flex items-center gap-2">
                <Zap size={14} className="text-teal" />
                Bot Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">

              {/* Bet Size */}
              <FormField
                control={form.control}
                name="betSize"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-xs text-muted-foreground uppercase tracking-wider">Bet Size (USDC per trade)</FormLabel>
                      <span className="text-sm font-display font-700 text-foreground">${field.value}</span>
                    </div>
                    <FormControl>
                      <Slider min={1} max={50} step={1} value={[field.value]} onValueChange={([v]) => field.onChange(v)} className="mt-2" />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      = {((betSize / startingBal) * 100).toFixed(1)}% of starting balance.{" "}
                      <span className={`font-medium ${((betSize / startingBal) * 100) <= 2 ? "text-up" : "text-edge"}`}>
                        {((betSize / startingBal) * 100) <= 2 ? "✓ Safe (≤2%)" : "⚠ Above 2% — consider reducing"}
                      </span>
                    </p>
                  </FormItem>
                )}
              />

              <Separator className="bg-border" />

              {/* Max bets per day */}
              <FormField
                control={form.control}
                name="maxBetsPerDay"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-xs text-muted-foreground uppercase tracking-wider">Max Bets Per Day</FormLabel>
                      <span className="text-sm font-display font-700 text-foreground">{field.value}</span>
                    </div>
                    <FormControl>
                      <Slider min={5} max={200} step={5} value={[field.value]} onValueChange={([v]) => field.onChange(v)} className="mt-2" />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Max daily exposure: ${betSize * maxBets} USDC</p>
                  </FormItem>
                )}
              />

              <Separator className="bg-border" />

              {/* Daily stop loss */}
              <FormField
                control={form.control}
                name="dailyStopLossPct"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-xs text-muted-foreground uppercase tracking-wider">Daily Stop Loss</FormLabel>
                      <Badge variant="outline" className="text-xs text-down border-down/30">{field.value}% = -${((startingBal * field.value) / 100).toFixed(0)}</Badge>
                    </div>
                    <FormControl>
                      <Slider min={5} max={30} step={1} value={[field.value]} onValueChange={([v]) => field.onChange(v)} className="mt-2" />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Bot auto-stops if you lose more than this % in one day. Recommended: 15%.</p>
                  </FormItem>
                )}
              />

              <Separator className="bg-border" />

              {/* Min edge % */}
              <FormField
                control={form.control}
                name="minEdgePct"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-xs text-muted-foreground uppercase tracking-wider">Minimum Edge to Bet</FormLabel>
                      <span className="text-sm font-display font-700 text-edge">{field.value}%</span>
                    </div>
                    <FormControl>
                      <Slider min={1} max={15} step={0.5} value={[field.value]} onValueChange={([v]) => field.onChange(v)} className="mt-2" />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Only bet when Polymarket odds diverge from BTC momentum by at least this amount. Recommended: 3–5%.</p>
                  </FormItem>
                )}
              />

            </CardContent>
          </Card>

          <Button
            type="submit"
            disabled={saveMutation.isPending}
            data-testid="button-save-settings"
            className="w-full bg-teal text-background hover:bg-teal/90 font-display font-700"
          >
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
