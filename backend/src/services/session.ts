import type { Response } from "express";
import type { NotificationPreference, User } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { hashToken, newToken } from "../tokens";

// "__Host-" prefix (HTTPS only) forbids a Domain attribute and forces Path=/, which blocks cookie-tossing from subdomains.
export const COOKIE_NAME = env.cookieSecure ? "__Host-sc_sid" : "sc_sid";

export interface AuthContext {
  user: User & { notificationPreference: NotificationPreference | null };
  sessionId: string;
  csrfToken: string;
  expiresAt: Date;
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: "lax" as const,
  path: "/",
});

export async function createSession(res: Response, userId: string): Promise<{ csrfToken: string; sessionId: string }> {
  const token = newToken();
  const csrfToken = newToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000);
  const session = await prisma.session.create({ data: { userId, tokenHash: hashToken(token), csrfToken, expiresAt } });
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), expires: expiresAt });
  return { csrfToken, sessionId: session.id };
}

export const clearSessionCookie = (res: Response) => res.clearCookie(COOKIE_NAME, cookieOptions());

export async function authenticateToken(token: string | undefined): Promise<AuthContext | null> {
  if (!token || token.length > 200) return null;
  const s = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { notificationPreference: true } } },
  });
  if (!s) return null;
  const now = Date.now();
  const idleMs = env.SESSION_IDLE_HOURS * 3600_000;
  if (s.expiresAt.getTime() <= now || now - s.lastUsedAt.getTime() > idleMs) {
    await prisma.session.delete({ where: { id: s.id } }).catch(() => undefined);
    return null;
  }
  if (now - s.lastUsedAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: s.id }, data: { lastUsedAt: new Date(now) } }).catch(() => undefined);
  }
  return { user: s.user, sessionId: s.id, csrfToken: s.csrfToken, expiresAt: s.expiresAt };
}
