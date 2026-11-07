import rateLimit from "express-rate-limit";
import type { Request, RequestHandler } from "express";

const passthrough: RequestHandler = (_req, _res, next) => next();

/** Builds the set of rate limiters. When disabled (tests/e2e only) every limiter is a no-op. */
export function createLimiters(enabled: boolean) {
  const make = (windowMs: number, limit: number, message: string, keyGenerator?: (req: Request) => string, skipSuccessfulRequests = false): RequestHandler =>
    enabled
      ? rateLimit({
          windowMs,
          limit,
          standardHeaders: "draft-7",
          legacyHeaders: false,
          skipSuccessfulRequests,
          keyGenerator,
          validate: { keyGeneratorIpFallback: false } as never,
          handler: (_req, res) => {
            res.status(429).json({ error: { code: "rate_limited", message } });
          },
        })
      : passthrough;
  const byUser = (req: Request) => `u:${req.auth?.user.id ?? "anon"}`;
  const byIdentifier = (req: Request) => `id:${String(req.body?.identifier ?? "").toLowerCase().slice(0, 254)}`;
  const min = 60_000;
  const hour = 60 * min;
  return {
    api: make(min, 300, "Too many requests. Slow down."),
    loginIp: make(15 * min, 30, "Too many sign-in attempts. Try again later.", undefined, true),
    loginAccount: make(15 * min, 10, "Too many sign-in attempts. Try again later.", byIdentifier, true),
    register: make(hour, 10, "Too many sign-ups from this network. Try again later."),
    forgot: make(hour, 5, "Too many reset requests. Try again later."),
    search: make(min, 30, "Too many searches. Wait a moment.", byUser),
    contactRequest: make(hour, 30, "Too many contact requests. Try again later.", byUser),
    messages: make(min, 120, "You're sending messages too quickly.", byUser),
  };
}
export type Limiters = ReturnType<typeof createLimiters>;
