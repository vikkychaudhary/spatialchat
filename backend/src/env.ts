import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Root-level .env (shared by backend scripts). Real environment variables always win.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
  CLIENT_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((v) => v.trim().replace(/\/$/, "")).filter(Boolean)),
  APP_URL: z.string().url().default("http://localhost:5173"),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  SESSION_IDLE_HOURS: z.coerce.number().int().positive().default(72),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool.default("false"),
  MAIL_FROM: z.string().default("SpatialChat <no-reply@spatialchat.local>"),
  DISABLE_RATE_LIMITS: bool.default("false"),
});

// Treat empty strings (e.g. "KEY=") as unset.
const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "" && v !== undefined));
const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${msg}`);
}

const data = parsed.data;
const cookieSecure = data.COOKIE_SECURE ?? data.NODE_ENV === "production";

if (data.NODE_ENV === "production") {
  const problems: string[] = [];
  if (/change-me/i.test(data.SESSION_SECRET)) problems.push("SESSION_SECRET is still the example value");
  if (!cookieSecure) problems.push("COOKIE_SECURE must not be false in production");
  if (data.DISABLE_RATE_LIMITS) problems.push("DISABLE_RATE_LIMITS must be false in production");
  if (data.CLIENT_ORIGINS.some((o) => !o.startsWith("https://"))) problems.push("CLIENT_ORIGINS must all be https:// in production");
  if (problems.length) throw new Error(`Unsafe production configuration: ${problems.join("; ")}`);
}

export const env = { ...data, cookieSecure, isProd: data.NODE_ENV === "production", isTest: data.NODE_ENV === "test" };
