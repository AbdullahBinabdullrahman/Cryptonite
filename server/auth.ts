/**
 * Auth Module — Email OTP + TOTP (Google Authenticator)
 *
 * Flow A — Email OTP:
 *   POST /api/auth/send-otp  { email }  → sends 6-digit code via email
 *   POST /api/auth/verify    { email, code } → validates, creates session
 *
 * Flow B — TOTP (after first login):
 *   GET  /api/auth/totp-setup   → returns secret + QR code URI
 *   POST /api/auth/totp-enable  { token } → validates token, enables TOTP
 *   POST /api/auth/verify       { email, totpToken } → validates TOTP directly
 *
 * Session: express-session stored in SQLite, httpOnly cookie
 */

import { authenticator } from "otplib";
import nodemailer from "nodemailer";
import QRCode from "qrcode";
import Database from "better-sqlite3";
import path from "path";
import bcrypt from "bcryptjs";

// ─── DB handle (reuse same file as storage) ───────────────────────────────────
const DB_PATH = process.env.DATABASE_URL?.replace("file:", "") ||
  path.resolve(process.cwd(), "polybot.db");

function getDb() {
  return new Database(DB_PATH);
}

// ─── Init auth tables ─────────────────────────────────────────────────────────
export function initAuthTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      totp_secret   TEXT,
      totp_enabled  INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS otp_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL,
      code       TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // Add password_hash column to existing deployments that don't have it yet
  try {
    db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
    console.log("[Auth] Migrated: added password_hash column");
  } catch {
    // Column already exists — ignore
  }

  // Seed owner account if no users exist
  const count = (db.prepare("SELECT COUNT(*) as n FROM users").get() as any).n;
  if (count === 0) {
    db.prepare("INSERT INTO users (email) VALUES (?)").run("a.maher.bina@gmail.com");
    console.log("[Auth] Owner account seeded: a.maher.bina@gmail.com");
  }
  db.close();
}

// ─── Password auth ────────────────────────────────────────────────────────────

export async function setUserPassword(
  email: string,
  plainPassword: string
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  try {
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as any;
    if (!user) return { ok: false, error: "User not found" };
    const hash = await bcrypt.hash(plainPassword, 12);
    db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(hash, email);
    console.log(`[Auth] Password set for ${email}`);
    return { ok: true };
  } finally {
    db.close();
  }
}

export async function verifyPassword(
  email: string,
  plainPassword: string
): Promise<{ ok: boolean; userId?: number; totpEnabled?: boolean; error?: string }> {
  const db = getDb();
  try {
    const user = db.prepare(
      "SELECT id, password_hash, totp_enabled FROM users WHERE email = ?"
    ).get(email) as any;
    if (!user) return { ok: false, error: "Email not authorised." };
    if (!user.password_hash) return { ok: false, error: "No password set. Use email OTP to log in." };

    const match = await bcrypt.compare(plainPassword, user.password_hash);
    if (!match) return { ok: false, error: "Incorrect password." };

    const now = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, user.id);
    return { ok: true, userId: user.id, totpEnabled: !!user.totp_enabled };
  } finally {
    db.close();
  }
}

// ─── Email transporter ────────────────────────────────────────────────────────
// Uses Gmail SMTP if env vars are set, otherwise uses Ethereal (dev preview)
let transporter: nodemailer.Transporter | null = null;

async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    console.log("[Auth] Gmail SMTP configured");
  } else {
    // Ethereal test account — emails viewable at https://ethereal.email
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log("[Auth] Using Ethereal test SMTP — preview at https://ethereal.email");
  }
  return transporter;
}

// ─── Generate 6-digit OTP ─────────────────────────────────────────────────────
function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ─── Send email OTP ───────────────────────────────────────────────────────────
export async function sendOtpEmail(email: string): Promise<{ ok: boolean; previewUrl?: string; error?: string }> {
  const db = getDb();
  try {
    // Check user exists
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as any;
    if (!user) {
      return { ok: false, error: "Email not authorised. Contact admin to add your account." };
    }

    // Invalidate old OTPs
    db.prepare("UPDATE otp_sessions SET used = 1 WHERE email = ? AND used = 0").run(email);

    // Generate new OTP (expires in 10 minutes)
    const code      = generateOtp();
    const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 min

    db.prepare("INSERT INTO otp_sessions (email, code, expires_at) VALUES (?, ?, ?)").run(email, code, expiresAt);

    // Send email
    const mailer = await getTransporter();
    const info = await mailer.sendMail({
      from: `"PolyBot" <${process.env.SMTP_USER || "polybot@noreply.com"}>`,
      to: email,
      subject: "Your PolyBot login code",
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:400px;margin:0 auto;padding:32px;background:#0f1117;color:#e2e8f0;border-radius:12px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="width:48px;height:48px;background:#14b8a6;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:24px">⚡</div>
            <h1 style="font-size:20px;font-weight:800;margin:12px 0 4px;color:#f1f5f9">PolyBot Login</h1>
            <p style="color:#64748b;font-size:13px;margin:0">Your one-time code</p>
          </div>
          <div style="background:#1e2533;border:1px solid #2d3748;border-radius:12px;padding:24px;text-align:center;margin-bottom:20px">
            <p style="letter-spacing:12px;font-size:36px;font-weight:800;color:#14b8a6;margin:0;font-family:monospace">${code}</p>
          </div>
          <p style="color:#64748b;font-size:12px;text-align:center;margin:0">
            Expires in <strong style="color:#94a3b8">10 minutes</strong>. Never share this code.
          </p>
        </div>
      `,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
    if (previewUrl) console.log("[Auth] OTP email preview:", previewUrl);

    return { ok: true, previewUrl: previewUrl || undefined };
  } catch (err: any) {
    console.error("[Auth] sendOtpEmail error:", err.message);
    return { ok: false, error: err.message };
  } finally {
    db.close();
  }
}

// ─── Verify email OTP ─────────────────────────────────────────────────────────
export function verifyOtp(email: string, code: string): { ok: boolean; userId?: number; error?: string } {
  const db = getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = db.prepare(`
      SELECT id, expires_at FROM otp_sessions
      WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).get(email, code, now) as any;

    if (!row) return { ok: false, error: "Invalid or expired code. Try again." };

    // Mark used
    db.prepare("UPDATE otp_sessions SET used = 1 WHERE id = ?").run(row.id);

    // Get user
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as any;
    if (!user) return { ok: false, error: "User not found." };

    // Update last login
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, user.id);

    return { ok: true, userId: user.id };
  } finally {
    db.close();
  }
}

// ─── Get user by ID ───────────────────────────────────────────────────────────
export function getUserById(id: number) {
  const db = getDb();
  try {
    return db.prepare("SELECT id, email, totp_secret, totp_enabled FROM users WHERE id = ?").get(id) as any;
  } finally {
    db.close();
  }
}

// ─── TOTP Setup — generate secret + QR code ──────────────────────────────────
export async function generateTotpSetup(userId: number): Promise<{
  ok: boolean; secret?: string; qrUri?: string; qrDataUrl?: string; error?: string;
}> {
  const db = getDb();
  try {
    const user = db.prepare("SELECT email, totp_secret FROM users WHERE id = ?").get(userId) as any;
    if (!user) return { ok: false, error: "User not found" };

    // Generate new secret (or reuse existing pending one)
    const secret = user.totp_secret || authenticator.generateSecret();
    const otpAuthUrl = authenticator.keyuri(user.email, "PolyBot", secret);
    const qrDataUrl  = await QRCode.toDataURL(otpAuthUrl);

    // Save secret (not enabled yet — enabled after first verify)
    db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(secret, userId);

    return { ok: true, secret, qrUri: otpAuthUrl, qrDataUrl };
  } catch (err: any) {
    return { ok: false, error: err.message };
  } finally {
    db.close();
  }
}

// ─── TOTP Enable (verify first token to confirm setup) ───────────────────────
export function enableTotp(userId: number, token: string): { ok: boolean; error?: string } {
  const db = getDb();
  try {
    const user = db.prepare("SELECT totp_secret FROM users WHERE id = ?").get(userId) as any;
    if (!user?.totp_secret) return { ok: false, error: "No TOTP secret found. Run setup first." };

    const valid = authenticator.verify({ token, secret: user.totp_secret });
    if (!valid) return { ok: false, error: "Invalid token. Make sure your authenticator app time is synced." };

    db.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(userId);
    return { ok: true };
  } finally {
    db.close();
  }
}

// ─── TOTP Verify (login with authenticator app) ───────────────────────────────
export function verifyTotp(email: string, token: string): { ok: boolean; userId?: number; error?: string } {
  const db = getDb();
  try {
    const user = db.prepare("SELECT id, totp_secret, totp_enabled FROM users WHERE email = ?").get(email) as any;
    if (!user) return { ok: false, error: "User not found." };
    if (!user.totp_enabled || !user.totp_secret) return { ok: false, error: "TOTP not set up for this account." };

    const valid = authenticator.verify({ token, secret: user.totp_secret });
    if (!valid) return { ok: false, error: "Invalid authenticator code." };

    const now = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, user.id);
    return { ok: true, userId: user.id };
  } finally {
    db.close();
  }
}

// ─── Auth middleware ───────────────────────────────────────────────────────────
import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if ((req.session as any)?.userId) return next();
  res.status(401).json({ error: "Unauthorised", code: "NOT_LOGGED_IN" });
}
