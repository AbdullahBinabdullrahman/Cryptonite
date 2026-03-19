import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import ConnectSqlite3 from "connect-sqlite3";
import path from "path";
import { registerRoutes } from "./routes";
import { registerChatRoutes } from "./chatRoutes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { initAuthTables } from "./auth";
import { storage } from "./storage";

const SqliteStore = ConnectSqlite3(session);

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// ── Session ───────────────────────────────────────────────────────────────────
// SQLite-backed session store — survives server restarts, 30-day rolling TTL
const dbDir = process.env.NODE_ENV === "production"
  ? "/data"
  : path.resolve(process.cwd(), "data");

app.use(
  session({
    store: new (SqliteStore as any)({
      db: "sessions.sqlite",
      dir: dbDir,
      table: "sessions",
      concurrentDB: true,
    }),
    secret: process.env.SESSION_SECRET || "polybot-super-secret-key-change-in-prod",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days, refreshed on each request
    },
  })
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// CORS — allow Cloudflare-hosted frontend + credentials for cookies
app.use((req, res, next) => {
  const allowed = [
    "https://www.perplexity.ai",
    "https://sites.pplx.app",
  ];
  const origin = req.headers.origin || "";
  if (allowed.some(o => origin.startsWith(o)) || !origin) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  // Init auth tables
  initAuthTables();

  // ── Auto-load credentials from Render env vars ──────────────────────────────
  // If ALPACA_KEY / POLY keys are set in environment (via Render dashboard),
  // inject them into the DB so the user never has to enter them in the UI.
  try {
    const envUpdates: Record<string, string> = {};
    if (process.env.ALPACA_KEY)          envUpdates.alpacaApiKey     = process.env.ALPACA_KEY;
    if (process.env.ALPACA_SECRET)       envUpdates.alpacaApiSecret  = process.env.ALPACA_SECRET;
    if (process.env.POLY_FUNDER_ADDRESS) envUpdates.polymarketWallet = process.env.POLY_FUNDER_ADDRESS;
    if (Object.keys(envUpdates).length > 0) {
      await storage.updateBotSettings(envUpdates);
      console.log("[boot] Injected env credentials into DB:", Object.keys(envUpdates).join(", "));
    }
  } catch (e) {
    console.warn("[boot] Could not auto-inject env credentials:", e);
  }

  await registerRoutes(httpServer, app);
  registerChatRoutes(app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    log(`serving on port ${port}`);
  });
})();
