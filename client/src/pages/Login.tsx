import { useState, useRef, useEffect } from "react";
import { apiRequest, setAuthToken } from "@/lib/queryClient";
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
          className="w-10 h-12 text-center text-lg font-bold outline-none transition-all duration-150"
          style={{
            fontFamily: "var(--font-pixel)",
            fontSize: 14,
            background: "hsl(220 20% 3%)",
            border: d ? "2px solid hsl(120 100% 50% / 0.8)" : "2px solid hsl(120 40% 18%)",
            color: "hsl(120 100% 70%)",
            boxShadow: d ? "0 0 10px hsl(120 100% 50% / 0.4), inset 0 0 8px hsl(120 100% 50% / 0.05)" : "none",
            borderRadius: 0,
            caretColor: "hsl(120 100% 60%)",
          }}
        />
      ))}
    </div>
  );
}

// ── Boot lines component ──────────────────────────────────────────────────────
function BootLines() {
  const lines = [
    "> POLYBOT OS v2.0 LOADING...",
    "> CHECKING NEURAL NETS... [OK]",
    "> CONNECTING POLYMARKET... [OK]",
    "> ALPACA BRIDGE... [OK]",
    "> CLOB ENGINE... READY",
    "> AUTHENTICATION REQUIRED_",
  ];
  return (
    <div className="space-y-0.5 mb-6">
      {lines.map((line, i) => (
        <div
          key={i}
          className="boot-line"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: i === lines.length - 1 ? "hsl(45 100% 55%)" : "hsl(120 60% 45%)",
            letterSpacing: "0.03em",
            animationDelay: `${i * 0.18}s`,
          }}
        >
          {line}
        </div>
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
  const [useOtpMode, setUseOtpMode] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  const loginWithPassword = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      const res  = await apiRequest("POST", "/api/auth/login", { email: email.trim(), password });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      if (data.totpRequired) { setStep("totp"); return; }
      if (data.token) setAuthToken(data.token);
      onLogin(data.email);
    } catch (e: any) {
      toast({ title: "ACCESS DENIED", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

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
      toast({ title: "CODE TRANSMITTED", description: `Check ${email}` });
    } catch (e: any) {
      toast({ title: "TRANSMISSION ERROR", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (code: string) => {
    setLoading(true);
    try {
      const res  = await apiRequest("POST", "/api/auth/verify", { email: email.trim(), code });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");
      if (data.totpEnabled) { setStep("totp"); setLoading(false); return; }
      if (data.token) setAuthToken(data.token);
      onLogin(data.email);
    } catch (e: any) {
      toast({ title: "INVALID TOKEN", description: e.message, variant: "destructive" });
      setLoading(false);
    }
  };

  const verifyTotp = async (token: string) => {
    setLoading(true);
    try {
      const res  = await apiRequest("POST", "/api/auth/verify", { email: email.trim(), totpToken: token });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");
      if (data.token) setAuthToken(data.token);
      onLogin(data.email);
    } catch (e: any) {
      toast({ title: "INVALID TOKEN", description: e.message, variant: "destructive" });
      setLoading(false);
    }
  };

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
      toast({ title: "2FA ENABLED", description: "Authenticator armed and ready" });
      onLogin(email);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setLoading(false);
    }
  };

  // ── Shared input style ──────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "hsl(220 20% 3%)",
    border: "1px solid hsl(120 60% 18%)",
    color: "hsl(120 100% 70%)",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    padding: "8px 10px 8px 32px",
    borderRadius: 0,
    outline: "none",
    letterSpacing: "0.03em",
    caretColor: "hsl(120 100% 60%)",
  };

  const btnPrimary: React.CSSProperties = {
    width: "100%",
    background: "transparent",
    border: "2px solid hsl(120 100% 50%)",
    color: "hsl(120 100% 65%)",
    fontFamily: "var(--font-pixel)",
    fontSize: 9,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    padding: "10px 20px",
    cursor: "pointer",
    boxShadow: "0 0 12px hsl(120 100% 50% / 0.25), inset 0 0 12px hsl(120 100% 50% / 0.05)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 0,
    transition: "all 0.1s ease",
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: "hsl(220 20% 4%)" }}
    >
      {/* Matrix-style bg dots */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-20" style={{ zIndex: 0 }}>
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${(i * 5.3) % 100}%`,
              top: `${(i * 7.7) % 100}%`,
              width: 1,
              height: 1,
              background: "hsl(120 100% 50%)",
              boxShadow: "0 0 4px hsl(120 100% 50%)",
              opacity: Math.random() * 0.5 + 0.2,
            }}
          />
        ))}
      </div>

      {/* CRT corner decorations */}
      {[
        { top: 16, left: 16 },
        { top: 16, right: 16 },
        { bottom: 16, left: 16 },
        { bottom: 16, right: 16 },
      ].map((pos, i) => (
        <div
          key={i}
          style={{
            position: "fixed",
            ...pos,
            width: 20,
            height: 20,
            borderTop: i < 2 ? "2px solid hsl(120 60% 25%)" : "none",
            borderBottom: i >= 2 ? "2px solid hsl(120 60% 25%)" : "none",
            borderLeft: i % 2 === 0 ? "2px solid hsl(120 60% 25%)" : "none",
            borderRight: i % 2 === 1 ? "2px solid hsl(120 60% 25%)" : "none",
            pointerEvents: "none",
            zIndex: 10,
          }}
        />
      ))}

      <div className="relative w-full max-w-sm" style={{ zIndex: 1 }}>
        {/* ── Terminal header ── */}
        <div className="text-center mb-6">
          <div
            className="inline-flex items-center justify-center w-16 h-16 mb-4"
            style={{
              border: "2px solid hsl(120 100% 50% / 0.7)",
              boxShadow: "0 0 20px hsl(120 100% 50% / 0.4), inset 0 0 20px hsl(120 100% 50% / 0.08)",
              background: "hsl(220 20% 4%)",
            }}
          >
            <Zap className="w-8 h-8" style={{ color: "hsl(120 100% 60%)", filter: "drop-shadow(0 0 8px hsl(120 100% 50%))" }} />
          </div>

          <div style={{ fontFamily: "var(--font-pixel)", fontSize: 14, color: "hsl(120 100% 65%)", textShadow: "0 0 16px hsl(120 100% 50% / 0.7)", letterSpacing: "0.1em" }}>
            POLYBOT
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(45 100% 55%)", letterSpacing: "0.08em", marginTop: 2 }}>
            SECURE TERMINAL ACCESS
          </div>
        </div>

        {/* ── Main panel ── */}
        <div
          style={{
            background: "hsl(220 20% 5%)",
            border: "1px solid hsl(120 60% 18%)",
            boxShadow: "0 0 30px hsl(120 100% 50% / 0.08), inset 0 0 30px hsl(120 100% 50% / 0.02)",
            padding: "0",
          }}
        >
          {/* Panel title bar */}
          <div
            style={{
              padding: "6px 16px",
              borderBottom: "1px solid hsl(120 40% 12%)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "hsl(220 20% 4%)",
            }}
          >
            <div className="blink" style={{ width: 6, height: 6, background: "hsl(120 100% 50%)", boxShadow: "0 0 4px hsl(120 100% 50%)" }} />
            <span style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(120 40% 40%)", letterSpacing: "0.1em" }}>
              {step === "credentials" ? "USER AUTHENTICATION" : step === "otp" ? "OTP VERIFICATION" : step === "totp" ? "2FA REQUIRED" : "2FA SETUP"}
            </span>
          </div>

          <div style={{ padding: "16px" }}>
            {/* Boot lines (only on credential step) */}
            {step === "credentials" && !useOtpMode && <BootLines />}

            {/* ── Credentials step ── */}
            {step === "credentials" && !useOtpMode && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Email */}
                <div>
                  <div style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(120 40% 35%)", letterSpacing: "0.1em", marginBottom: 4 }}>
                    USER_ID:
                  </div>
                  <div style={{ position: "relative" }}>
                    <Mail size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "hsl(120 40% 40%)" }} />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && document.getElementById("pw-input")?.focus()}
                      placeholder="user@system.net"
                      data-testid="input-email"
                      style={inputStyle}
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <div style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(120 40% 35%)", letterSpacing: "0.1em", marginBottom: 4 }}>
                    PASSKEY:
                  </div>
                  <div style={{ position: "relative" }}>
                    <KeyRound size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "hsl(120 40% 40%)" }} />
                    <input
                      id="pw-input"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && loginWithPassword()}
                      placeholder="••••••••"
                      data-testid="input-password"
                      style={{ ...inputStyle, paddingRight: 36 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(s => !s)}
                      style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "hsl(120 40% 40%)", background: "none", border: "none", cursor: "pointer" }}
                    >
                      {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                </div>

                <button
                  onClick={loginWithPassword}
                  disabled={loading || !email.trim() || !password}
                  data-testid="button-login"
                  style={{ ...btnPrimary, opacity: (loading || !email.trim() || !password) ? 0.4 : 1 }}
                >
                  {loading
                    ? <><Loader2 size={12} className="animate-spin" />AUTHENTICATING...</>
                    : <><ArrowRight size={12} />ENTER SYSTEM</>}
                </button>

                <div style={{ textAlign: "center" }}>
                  <button
                    onClick={() => setUseOtpMode(true)}
                    style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 30% 35%)", background: "none", border: "none", cursor: "pointer", letterSpacing: "0.03em" }}
                  >
                    &gt; NO PASSKEY? USE EMAIL TOKEN →
                  </button>
                </div>
              </div>
            )}

            {/* ── OTP mode ── */}
            {step === "credentials" && useOtpMode && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 60% 50%)", marginBottom: 4 }}>
                  &gt; EMAIL TOKEN AUTH MODE
                </div>
                <div style={{ position: "relative" }}>
                  <Mail size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "hsl(120 40% 40%)" }} />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendOtp()}
                    placeholder="user@system.net"
                    style={inputStyle}
                  />
                </div>
                <button
                  onClick={sendOtp}
                  disabled={loading || !email.trim()}
                  style={{ ...btnPrimary, opacity: (loading || !email.trim()) ? 0.4 : 1 }}
                >
                  {loading ? <><Loader2 size={12} className="animate-spin" />TRANSMITTING...</> : <><ArrowRight size={12} />SEND TOKEN</>}
                </button>
                <button
                  onClick={() => setUseOtpMode(false)}
                  style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 30% 35%)", background: "none", border: "none", cursor: "pointer" }}
                >
                  ← BACK TO PASSKEY
                </button>
              </div>
            )}

            {/* ── OTP verification ── */}
            {step === "otp" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(120 60% 45%)", letterSpacing: "0.1em", marginBottom: 4 }}>
                    TOKEN TRANSMITTED
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 40% 40%)" }}>
                    DEST: <span style={{ color: "hsl(120 80% 60%)" }}>{email}</span>
                  </div>
                </div>
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(45 100% 55%)", display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", border: "1px solid hsl(45 100% 55% / 0.3)", background: "hsl(45 100% 55% / 0.05)" }}
                  >
                    <Mail size={10} /> PREVIEW EMAIL (DEV) →
                  </a>
                )}
                <OtpInput length={6} onComplete={verifyOtp} />
                {loading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 40% 40%)" }}>
                    <Loader2 size={11} className="animate-spin" /> VERIFYING TOKEN...
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 9 }}>
                  <button onClick={() => { setStep("credentials"); setUseOtpMode(true); }} style={{ color: "hsl(120 30% 35%)", background: "none", border: "none", cursor: "pointer" }}>
                    ← CHANGE DEST
                  </button>
                  {countdown > 0
                    ? <span style={{ color: "hsl(120 25% 30%)" }}>RESEND IN {countdown}s</span>
                    : <button onClick={sendOtp} style={{ color: "hsl(45 100% 55%)", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                        <RefreshCw size={9} /> RESEND
                      </button>
                  }
                </div>
              </div>
            )}

            {/* ── TOTP login ── */}
            {step === "totp" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 36, height: 36, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      border: "1px solid hsl(45 100% 55% / 0.4)",
                      boxShadow: "0 0 10px hsl(45 100% 55% / 0.2)",
                    }}
                  >
                    <Smartphone size={16} style={{ color: "hsl(45 100% 55%)" }} />
                  </div>
                  <div>
                    <div style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(45 100% 55%)", letterSpacing: "0.1em" }}>2FA REQUIRED</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 40% 40%)", marginTop: 2 }}>Enter 6-digit authenticator code</div>
                  </div>
                </div>
                <OtpInput length={6} onComplete={verifyTotp} />
                {loading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 40% 40%)" }}>
                    <Loader2 size={11} className="animate-spin" /> VERIFYING...
                  </div>
                )}
                <button onClick={() => { setStep("credentials"); setUseOtpMode(false); }} style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 30% 35%)", background: "none", border: "none", cursor: "pointer" }}>
                  ← BACK TO SIGN IN
                </button>
              </div>
            )}

            {/* ── TOTP setup ── */}
            {step === "totp-setup" && totpSetup && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(175 90% 50%)", letterSpacing: "0.1em" }}>
                  <Shield size={10} style={{ display: "inline", marginRight: 6 }} />
                  INSTALL 2FA MODULE
                </div>
                <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "hsl(120 40% 40%)" }}>
                  Scan QR with Google Authenticator or Authy
                </div>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <div style={{ padding: 8, background: "#fff" }}>
                    <img src={totpSetup.qrDataUrl} alt="TOTP QR" style={{ width: 140, height: 140 }} />
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 30% 30%)", marginBottom: 4, letterSpacing: "0.1em" }}>MANUAL KEY:</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", border: "1px solid hsl(120 40% 15%)", background: "hsl(220 20% 3%)" }}>
                    <code style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(120 80% 55%)", flex: 1, filter: showSecret ? "none" : "blur(4px)", userSelect: showSecret ? "auto" : "none" }}>
                      {totpSetup.secret}
                    </code>
                    <button onClick={() => setShowSecret(s => !s)} style={{ color: "hsl(120 40% 40%)", background: "none", border: "none", cursor: "pointer" }}>
                      {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-pixel)", fontSize: 6, color: "hsl(120 30% 30%)", marginBottom: 6, letterSpacing: "0.1em" }}>CONFIRM CODE:</div>
                  <OtpInput length={6} onComplete={c => setTotpInput(c)} />
                </div>
                <button
                  onClick={enableTotp}
                  disabled={loading || totpInput.length < 6}
                  style={{ ...btnPrimary, borderColor: "hsl(175 90% 50%)", color: "hsl(175 90% 65%)", opacity: (loading || totpInput.length < 6) ? 0.4 : 1 }}
                >
                  {loading ? <><Loader2 size={12} className="animate-spin" />INSTALLING...</> : <><CheckCircle size={12} />ENABLE 2FA</>}
                </button>
                <button onClick={() => onLogin(email)} style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "hsl(120 25% 30%)", background: "none", border: "none", cursor: "pointer" }}>
                  SKIP FOR NOW →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Setup 2FA prompt after OTP */}
        {step === "otp" && !loading && (
          <button
            onClick={loadTotpSetup}
            style={{
              width: "100%", marginTop: 8, padding: "8px 12px",
              border: "1px solid hsl(45 100% 55% / 0.3)",
              background: "hsl(45 100% 55% / 0.05)",
              color: "hsl(45 100% 60%)",
              fontFamily: "var(--font-pixel)", fontSize: 7,
              letterSpacing: "0.08em",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            <Shield size={10} /> INSTALL GOOGLE AUTHENTICATOR
          </button>
        )}

        {/* INSERT COIN prompt */}
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <span className="insert-coin" style={{ fontFamily: "var(--font-pixel)", fontSize: 7, color: "hsl(45 100% 55%)", letterSpacing: "0.1em", textShadow: "0 0 8px hsl(45 100% 55%)" }}>
            ★ INSERT COIN TO CONTINUE ★
          </span>
        </div>
      </div>
    </div>
  );
}
