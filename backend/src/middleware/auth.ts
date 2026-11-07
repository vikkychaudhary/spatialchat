import type { NextFunction, Request, Response } from "express";
import { parse } from "cookie";
import { env } from "../env";
import { HttpError } from "../errors";
import { safeEqual } from "../tokens";
import { COOKIE_NAME, authenticateToken, clearSessionCookie, type AuthContext } from "../services/session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Defence in depth against CSRF for every state-changing request (including unauthenticated ones such as login):
 * browsers always attach Origin to cross-site POST/PUT/PATCH/DELETE, so a foreign Origin is rejected.
 * Combined with SameSite=Lax cookies and the per-session CSRF token below.
 */
export function originGuard(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get("origin");
  if (origin && !env.CLIENT_ORIGINS.includes(origin)) return next(new HttpError(403, "bad_origin", "Request origin is not allowed"));
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = parse(req.headers.cookie ?? "")[COOKIE_NAME];
    const auth = await authenticateToken(token);
    if (!auth) {
      if (token) clearSessionCookie(res);
      return next(new HttpError(401, "unauthenticated", "Please sign in"));
    }
    req.auth = auth;
    next();
  } catch (e) {
    next(e);
  }
}

/** Synchronizer-token CSRF check; must run after requireAuth. */
export function csrfProtect(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const sent = req.get("x-csrf-token");
  if (!req.auth || !sent || !safeEqual(sent, req.auth.csrfToken)) {
    return next(new HttpError(403, "bad_csrf", "Security token missing or invalid. Refresh the page and try again."));
  }
  next();
}

export const authed = [requireAuth, csrfProtect];
export const me = (req: Request) => req.auth!.user;
