import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export const newToken = () => randomBytes(32).toString("base64url");

/** Tokens are stored only as keyed hashes: a database leak alone cannot be replayed as a session. */
export const hashToken = (token: string) => createHmac("sha256", env.SESSION_SECRET).update(token).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
