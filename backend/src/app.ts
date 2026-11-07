import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { prisma } from "./db";
import { env } from "./env";
import { errorMiddleware } from "./errors";
import { originGuard } from "./middleware/auth";
import { createLimiters } from "./middleware/limits";
import { authRouter } from "./routes/auth";
import { contactsRouter } from "./routes/contacts";
import { conversationsRouter } from "./routes/conversations";
import { usersRouter } from "./routes/users";
import { createSocketServer } from "./socket";

export interface AppOptions {
  /** Defaults to true unless DISABLE_RATE_LIMITS=true (development/e2e only). */
  rateLimits?: boolean;
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);

  const wsOrigins = env.CLIENT_ORIGINS.map((o) => o.replace(/^http/, "ws"));
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"], // React inline style attributes
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'", ...env.CLIENT_ORIGINS, ...wsOrigins],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
          "upgrade-insecure-requests": env.isProd ? [] : null,
        },
      },
      referrerPolicy: { policy: "no-referrer" }, // keeps password-reset tokens out of Referer headers
      strictTransportSecurity: env.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );
  app.use(cors({ origin: env.CLIENT_ORIGINS, credentials: true }));
  app.use(express.json({ limit: "16kb" }));
  app.use(originGuard);

  const limits = createLimiters(opts.rateLimits ?? !env.DISABLE_RATE_LIMITS);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "database_unavailable" });
    }
  });

  const api = express.Router();
  api.use(limits.api);
  api.use("/auth", authRouter(limits));
  api.use(usersRouter(limits));
  api.use(contactsRouter(limits));
  api.use(conversationsRouter(limits));
  app.use("/api/v1", api);
  app.use("/api", (_req, res) => res.status(404).json({ error: { code: "not_found", message: "Not found" } }));

  // Production: serve the built SPA from the same origin (simplest, safest cookie setup).
  const dist = path.resolve(__dirname, "../../frontend/dist");
  if (fs.existsSync(path.join(dist, "index.html")) && !env.isTest) {
    app.use(express.static(dist, { index: false, maxAge: env.isProd ? "1h" : 0 }));
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use(errorMiddleware);

  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);
  app.set("io", io);
  return { app, httpServer, io };
}
