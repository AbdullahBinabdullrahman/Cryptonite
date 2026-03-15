import { useState, useRef, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, Mail, Shield, Smartphone, ArrowRight, Loader2,
  CheckCircle, Eye, EyeOff, RefreshCw, Lock, KeyRound,
} from "lucide-react";

type Step = "credentials" | "otp" | "totp" | "totp-setup";

interface LoginProps {
  onLogin: (email: string) => void;
}

// ── OTP digit input ───────────────────────────────────────────────────────────
function OtpInput({ length = 6, onComplete }: { length?: number; onComplete: (val: string) => void }) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (i: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const next  = [...digits];
    next[i]     = digit;
    setDigits(next);
    if (digit && i < length - 1) refs.current[i + 1]?.focus();
    if (next.every(d => d !== "")) onComplete(next.join(""));
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!text) return;
    const next = Array(length).fill("");
    text.split("").forEach((c, i) => { next[i] = c; });
    setDigits(next);
    refs.current[Math.min(text.length, length - 1)]?.focus();
    if (text.length === length) onComplete(text);
    e.preventDefault();
  };

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          className={`w-11 h-14 text-center text-xl font-800 font-display rounded-xl border bg-secondary/40 text-foreground
            transition-all duration-150 outline-none focus:ring-2 focus:ring-teal/50 focus:border-teal
            ${d ? "border-teal/60 bg-teal/8" : "border-border"}`}
        />
      ))}
    </div>
  );
}

// ── Main login component ──────────────────────────────────────────────────────
export default function Login({ onLogin }: LoginProps) {
  const { toast } = useToast();
  const [step, setStep]             = useState<Step>("credentials");
  const [email, setEmail]           = useState("a.maher.bina@gmail.com");
  const [password, setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [countdown, setCountdown]   = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [totpSetup, setTotpSetup]   = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [totpInput, setTotpInput]   = useState("");
  // "otp" sub-mode: user chose to skip password and use OTP instead
  const [useOtpMode, setUseOtpMode] = useState(false);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  // ── Password login ─────────────────────────────────────────────────────────
  const loginWithPassword = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      const res  = await apiRequest("POST", "/api/auth/login", {
        email: email.trim(),
        password,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      if (data.totpRequired) {
        setStep("totp");
        return;
      }
      onLogin(data.email);
    } catch (e: any) {
      toast({ title: "Login failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ── Send OTP (fallback / no-password path) ─────────────────────────────────
  const sendOtp = async () => {
    if (!email.trim()) return;
    setLoading(true);
    try {
      const res  = await apiRequest("POST", "/api/auth/send-otp", { email: email.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send code");
      setPreviewUrl(data.previewUrl || null);
      setStep("otp");
      setCountdown(60);
      toast({ title: "Code sent", description: `Check ${email}` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ── Verify OTP ─────────────────────────────────────────────────────────────
  const verifyOtp = async (code: string) => {
    setLoading(true);
    try {
      const res  = await apiRequest("POST", "/api/auth/verify", { email: email.trim(), code });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");
      if (data.totpEnabled) {
        setStep("totp");
        setLoading(false);
        return;
      }
      onLogin(data.email);
    } catch (e: any) {
      toast({ title: "Invalid code", description: e.message, variant: "destructive" });
      setLoading(false);
    }
  };

  // ── Verify TOTP ────────────────────────────────────────────────────────────
  const verifyTotp = async (token: string) => {
    setLoading(true);
    try {
      const res  = await apiRequest("POST", "/api/auth/verify", { email: email.trim(), totpToken: token });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");
      onLogin(data.email);
    } catch (e: any) {
      toast({ title: "Invalid code", description: e.message, variant: "destructive" });
      setLoading(false);
    }
  };

  // ── TOTP setup ─────────────────────────────────────────────────────────────
  const loadTotpSetup = async () => {
    setLoading(true);
    try {
      const res  = await apiRequest("GET", "/api/auth/totp-setup");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTotpSetup(data);
      setStep("totp-setup");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const enableTotp = async () => {
    if (!totpInput || totpInput.length < 6) return;
    setLoading(true);
    try {
      const res  = await apiRequest("POST", "/api/auth/totp-enable", { token: totpInput });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: "Authenticator enabled", description: "Use your app to log in next time" });
      onLogin(email);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setLoading(false);
    }
  };

  // ── Layout ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-teal/5 rounded-full blur-3xl" />
        <div className="absolute top-2/3 left-1/3 w-[300px] h-[300px] bg-edge/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal/15 border border-teal/30 glow-teal mb-4">
            <Zap className="w-8 h-8 text-teal" />
          </div>
          <h1 className="font-display text-2xl font-800 text-foreground tracking-tight">PolyBot</h1>
          <p className="text-sm text-muted-foreground mt-1">BTC Edge Trader</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl shadow-black/20">

          {/* ── Credentials step (email + password) ── */}
          {step === "credentials" && !useOtpMode && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-display font-700 text-foreground flex items-center gap-2">
                  <Lock size={14} className="text-teal" />Sign in
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">Enter your email and password</p>
              </div>

              {/* Email */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Email address</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && document.getElementById("pw-input")?.focus()}
                    placeholder="you@example.com"
                    data-testid="input-email"
                    className="w-full pl-9 pr-4 py-2.5 text-sm bg-secondary/40 border border-border rounded-xl text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-teal/40 focus:border-teal transition-all"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Password</label>
                <div className="relative">
                  <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="pw-input"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && loginWithPassword()}
                    placeholder="••••••••"
                    data-testid="input-password"
                    className="w-full pl-9 pr-10 py-2.5 text-sm bg-secondary/40 border border-border rounded-xl text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-teal/40 focus:border-teal transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <button
                onClick={loginWithPassword}
                disabled={loading || !email.trim() || !password}
                data-testid="button-login"
                className="w-full py-2.5 rounded-xl bg-teal text-black font-display font-700 text-sm flex items-center justify-center gap-2 hover:bg-teal/90 transition-colors disabled:opacity-50"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <><ArrowRight size={15} />Sign in</>}
              </button>

              {/* OTP fallback */}
              <button
                onClick={() => setUseOtpMode(true)}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
              >
                No password? Sign in with email code →
              </button>
            </div>
          )}

          {/* ── OTP fallback (email code) ── */}
          {step === "credentials" && useOtpMode && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-display font-700 text-foreground">Sign in with code</h2>
                <p className="text-xs text-muted-foreground mt-0.5">We'll send a 6-digit code to your email</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Email address</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendOtp()}
                    placeholder="you@example.com"
                    className="w-full pl-9 pr-4 py-2.5 text-sm bg-secondary/40 border border-border rounded-xl text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-teal/40 focus:border-teal transition-all"
                  />
                </div>
              </div>
              <button
                onClick={sendOtp}
                disabled={loading || !email.trim()}
                className="w-full py-2.5 rounded-xl bg-teal text-black font-display font-700 text-sm flex items-center justify-center gap-2 hover:bg-teal/90 transition-colors disabled:opacity-50"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <><ArrowRight size={15} />Send code</>}
              </button>
              <button
                onClick={() => setUseOtpMode(false)}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Back to password login
              </button>
            </div>
          )}

          {/* ── OTP verification step ── */}
          {step === "otp" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-display font-700 text-foreground">Enter code</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sent to <span className="text-foreground font-medium">{email}</span>
                </p>
              </div>

              {/* Dev preview link */}
              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-teal hover:underline p-2.5 rounded-lg bg-teal/8 border border-teal/20"
                >
                  <Mail size={12} />
                  Preview email (dev mode) →
                </a>
              )}

              <OtpInput length={6} onComplete={verifyOtp} />

              {loading && (
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={13} className="animate-spin" />Verifying...
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <button onClick={() => { setStep("credentials"); setUseOtpMode(true); }} className="text-muted-foreground hover:text-foreground transition-colors">
                  ← Change email
                </button>
                {countdown > 0 ? (
                  <span className="text-muted-foreground">Resend in {countdown}s</span>
                ) : (
                  <button onClick={sendOtp} className="text-teal hover:underline flex items-center gap-1">
                    <RefreshCw size={11} />Resend code
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── TOTP login step ── */}
          {step === "totp" && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-edge/15 border border-edge/30 flex items-center justify-center flex-shrink-0">
                  <Smartphone size={18} className="text-edge" />
                </div>
                <div>
                  <h2 className="text-base font-display font-700 text-foreground">Authenticator</h2>
                  <p className="text-xs text-muted-foreground">Enter the 6-digit code from your app</p>
                </div>
              </div>

              <OtpInput length={6} onComplete={verifyTotp} />

              {loading && (
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={13} className="animate-spin" />Verifying...
                </div>
              )}

              <button
                onClick={() => { setStep("credentials"); setUseOtpMode(false); }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Back to sign in
              </button>
            </div>
          )}

          {/* ── TOTP setup step ── */}
          {step === "totp-setup" && totpSetup && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-display font-700 text-foreground flex items-center gap-2">
                  <Shield size={15} className="text-teal" />Set up 2FA
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">Scan with Google Authenticator or Authy</p>
              </div>

              {/* QR code */}
              <div className="flex justify-center">
                <div className="p-3 bg-white rounded-xl">
                  <img src={totpSetup.qrDataUrl} alt="TOTP QR" className="w-40 h-40" />
                </div>
              </div>

              {/* Manual secret */}
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Or enter manually:</p>
                <div className="flex items-center gap-2 bg-secondary/40 border border-border rounded-xl px-3 py-2">
                  <code className={`text-xs flex-1 font-mono text-teal tracking-wider ${showSecret ? "" : "blur-sm select-none"}`}>
                    {totpSetup.secret}
                  </code>
                  <button onClick={() => setShowSecret(s => !s)} className="text-muted-foreground hover:text-foreground">
                    {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>

              {/* Confirm token */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Enter code from your app to confirm:</p>
                <OtpInput length={6} onComplete={c => setTotpInput(c)} />
              </div>

              <button
                onClick={enableTotp}
                disabled={loading || totpInput.length < 6}
                className="w-full py-2.5 rounded-xl bg-teal text-black font-display font-700 text-sm flex items-center justify-center gap-2 hover:bg-teal/90 transition-colors disabled:opacity-50"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <><CheckCircle size={15} />Enable 2FA</>}
              </button>

              <button
                onClick={() => onLogin(email)}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip for now →
              </button>
            </div>
          )}
        </div>

        {/* Setup 2FA prompt after OTP login (shown below card) */}
        {step === "otp" && !loading && (
          <button
            onClick={loadTotpSetup}
            className="w-full mt-3 py-2 rounded-xl border border-edge/30 bg-edge/8 text-xs font-medium text-edge hover:bg-edge/15 transition-colors flex items-center justify-center gap-2"
          >
            <Shield size={12} />Set up Google Authenticator (recommended)
          </button>
        )}
      </div>
    </div>
  );
}
