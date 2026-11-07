import { Router } from "express";
import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import type { Server } from "socket.io";
import { prisma } from "../db";
import { env } from "../env";
import { HttpError, wrap } from "../errors";
import { log } from "../logger";
import { authed, me, requireAuth } from "../middleware/auth";
import type { Limiters } from "../middleware/limits";
import { changePasswordSchema, deleteAccountSchema, forgotSchema, loginSchema, registerSchema, resetSchema } from "../schemas";
import { selfUser } from "../serializers";
import { sendPasswordResetEmail } from "../services/mail";
import { sessionRoom, userRoom } from "../services/realtime";
import { COOKIE_NAME, clearSessionCookie, createSession } from "../services/session";
import { hashToken, newToken } from "../tokens";
import { parse } from "cookie";

// OWASP-recommended minimum Argon2id parameters (19 MiB, t=2, p=1).
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export const hashPassword = (pw: string) => argon2.hash(pw, ARGON_OPTS);

// Verifying against a dummy hash when the account doesn't exist keeps response timing similar.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("dummy-password-for-timing"));

const RESET_TTL_MS = 30 * 60_000;

export function authRouter(limits: Limiters) {
  const r = Router();
  const io = (req: import("express").Request) => req.app.get("io") as Server;

  r.post("/register", limits.register, wrap(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const taken = await prisma.user.findFirst({ where: { OR: [{ username: input.username }, { email: input.email }] }, select: { id: true } });
    // Deliberately generic: do not reveal whether the username or the email was the clash.
    if (taken) throw new HttpError(409, "unavailable", "That username or email is not available");
    const passwordHash = await hashPassword(input.password);
    let user;
    try {
      user = await prisma.user.create({
        data: {
          username: input.username,
          email: input.email,
          passwordHash,
          displayName: input.displayName ?? input.username,
          notificationPreference: { create: {} },
        },
        include: { notificationPreference: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "unavailable", "That username or email is not available");
      throw e;
    }
    const { csrfToken } = await createSession(res, user.id);
    res.status(201).json({ user: selfUser(user), csrfToken });
  }));

  r.post("/login", limits.loginIp, limits.loginAccount, wrap(async (req, res) => {
    const { identifier, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findFirst({
      where: { OR: [{ username: identifier }, { email: identifier }] },
      include: { notificationPreference: true },
    });
    const ok = await argon2.verify(user?.passwordHash ?? (await getDummyHash()), password).catch(() => false);
    if (!user || !ok) throw new HttpError(401, "invalid_credentials", "Incorrect username/email or password");

    // Session rotation: drop whatever session cookie the browser sent, then issue a brand-new one.
    const old = parse(req.headers.cookie ?? "")[COOKIE_NAME];
    if (old) await prisma.session.deleteMany({ where: { tokenHash: hashToken(old) } });
    const { csrfToken } = await createSession(res, user.id);
    res.json({ user: selfUser(user), csrfToken });
  }));

  r.post("/logout", ...authed, wrap(async (req, res) => {
    const { sessionId } = req.auth!;
    await prisma.session.deleteMany({ where: { id: sessionId } });
    clearSessionCookie(res);
    io(req).in(sessionRoom(sessionId)).disconnectSockets(true);
    res.status(204).end();
  }));

  r.get("/me", requireAuth, wrap(async (req, res) => {
    res.json({ user: selfUser(req.auth!.user), csrfToken: req.auth!.csrfToken });
  }));

  r.post("/forgot-password", limits.forgot, wrap(async (req, res) => {
    const { email } = forgotSchema.parse(req.body);
    // Always respond the same way so the endpoint can't be used to discover accounts.
    res.json({ ok: true, message: "If that email has an account, a reset link is on its way." });
    void (async () => {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return;
      const token = newToken();
      await prisma.$transaction([
        prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
        prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } }),
      ]);
      await sendPasswordResetEmail(user.email, `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`);
    })().catch((e) => log.error("password reset email failed", e));
  }));

  r.post("/reset-password", limits.forgot, wrap(async (req, res) => {
    const { token, password } = resetSchema.parse(req.body);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) throw new HttpError(400, "invalid_token", "This reset link is invalid or has expired");
    const passwordHash = await hashPassword(password);
    // Single-use: the conditional update fails if another request consumed the token first.
    const claimed = await prisma.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new HttpError(400, "invalid_token", "This reset link is invalid or has expired");
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.session.deleteMany({ where: { userId: record.userId } }), // sign out everywhere
    ]);
    io(req).in(userRoom(record.userId)).disconnectSockets(true);
    res.json({ ok: true });
  }));

  r.post("/change-password", ...authed, wrap(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = me(req);
    if (!(await argon2.verify(user.passwordHash, currentPassword).catch(() => false))) throw new HttpError(403, "invalid_credentials", "Current password is incorrect");
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
    // Privilege change => rotate: revoke every session (and sockets), then issue a fresh one for this browser.
    await prisma.session.deleteMany({ where: { userId: user.id } });
    io(req).in(userRoom(user.id)).disconnectSockets(true);
    const { csrfToken } = await createSession(res, user.id);
    res.json({ ok: true, csrfToken });
  }));

  r.delete("/account", ...authed, wrap(async (req, res) => {
    const { password } = deleteAccountSchema.parse(req.body);
    const user = me(req);
    if (!(await argon2.verify(user.passwordHash, password).catch(() => false))) throw new HttpError(403, "invalid_credentials", "Password is incorrect");
    const convs = await prisma.conversation.findMany({
      where: { participants: { some: { userId: user.id } } },
      select: { id: true, participants: { select: { userId: true } } },
    });
    await prisma.$transaction([
      prisma.conversation.deleteMany({ where: { id: { in: convs.map((c) => c.id) } } }), // cascades messages & receipts
      prisma.user.delete({ where: { id: user.id } }), // cascades sessions, contacts, blocks, tokens, preferences
    ]);
    const server = io(req);
    for (const c of convs) for (const p of c.participants) if (p.userId !== user.id) server.to(userRoom(p.userId)).emit("conversation:removed", { conversationId: c.id });
    server.in(userRoom(user.id)).disconnectSockets(true);
    clearSessionCookie(res);
    res.status(204).end();
  }));

  return r;
}
