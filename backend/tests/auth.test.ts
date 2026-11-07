import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { ORIGIN, PASSWORD, register, startApp, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => { t = await startApp(); });
afterAll(async () => { await t.close(); await prisma.$disconnect(); });

const json = (path: string, body: unknown, origin: string | null = ORIGIN) => {
  const r = request(t.app).post(`/api/v1${path}`);
  if (origin) r.set("Origin", origin);
  return r.send(body);
};

describe("registration and login", () => {
  it("registers, hides secrets, sets an HttpOnly cookie and stores a hash", async () => {
    const username = `reg_${Date.now()}`;
    const res = await json("/auth/register", { username, email: `${username}@example.test`, password: PASSWORD }).expect(201);
    expect(res.body.user.email).toBe(`${username}@example.test`);
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const row = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
    const sessions = await prisma.session.findMany({ where: { userId: row.id } });
    expect(cookie).not.toContain(sessions[0]!.tokenHash); // only a hash is stored
  });

  it("rejects duplicate username/email with a generic message", async () => {
    const a = await register(t, "dup");
    const res = await json("/auth/register", { username: a.username, email: "other@example.test", password: PASSWORD }).expect(409);
    expect(res.body.error.code).toBe("unavailable");
  });

  it("validates input", async () => {
    await json("/auth/register", { username: "x", email: "bad", password: "short" }).expect(400);
  });

  it("login works by username and email; wrong credentials are generic", async () => {
    const a = await register(t, "login");
    await json("/auth/login", { identifier: a.username, password: PASSWORD }).expect(200);
    await json("/auth/login", { identifier: `${a.username}@example.test`, password: PASSWORD }).expect(200);
    const bad = await json("/auth/login", { identifier: a.username, password: "wrong-password-1" }).expect(401);
    const ghost = await json("/auth/login", { identifier: "no_such_user_zz", password: "wrong-password-1" }).expect(401);
    expect(bad.body.error.message).toBe(ghost.body.error.message);
  });

  it("rotates the session on login (old cookie stops working)", async () => {
    const a = await register(t, "rot");
    const res = await request(t.app).post("/api/v1/auth/login").set("Origin", ORIGIN).set("Cookie", a.cookie).send({ identifier: a.username, password: PASSWORD }).expect(200);
    expect(res.headers["set-cookie"]).toBeTruthy();
    await a.http("get", "/auth/me").expect(401);
  });
});

describe("sessions and CSRF", () => {
  it("requires authentication on protected endpoints", async () => {
    await request(t.app).get("/api/v1/conversations").expect(401);
    await request(t.app).get("/api/v1/users/search?q=abc").expect(401);
    await request(t.app).get("/api/v1/contacts").expect(401);
  });

  it("rejects state-changing requests without a valid CSRF token", async () => {
    const a = await register(t, "csrf");
    await request(t.app).post("/api/v1/auth/logout").set("Cookie", a.cookie).set("Origin", ORIGIN).expect(403);
    await request(t.app).post("/api/v1/auth/logout").set("Cookie", a.cookie).set("Origin", ORIGIN).set("X-CSRF-Token", "wrong").expect(403);
  });

  it("rejects requests from a foreign origin", async () => {
    const a = await register(t, "origin");
    const res = await request(t.app).post("/api/v1/auth/logout").set("Cookie", a.cookie).set("Origin", "https://evil.example").set("X-CSRF-Token", a.csrf);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("bad_origin");
  });

  it("logout invalidates the session server-side", async () => {
    const a = await register(t, "out");
    await a.http("post", "/auth/logout").expect(204);
    await a.http("get", "/auth/me").expect(401);
  });

  it("expired sessions are rejected and removed", async () => {
    const a = await register(t, "exp");
    await prisma.session.updateMany({ where: { userId: a.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await a.http("get", "/auth/me").expect(401);
    expect(await prisma.session.count({ where: { userId: a.id } })).toBe(0);
  });
});

describe("password reset", () => {
  it("responds identically for known and unknown emails", async () => {
    const a = await register(t, "forgot");
    const known = await json("/auth/forgot-password", { email: `${a.username}@example.test` }).expect(200);
    const unknown = await json("/auth/forgot-password", { email: "nobody-here@example.test" }).expect(200);
    expect(known.body).toEqual(unknown.body);
  });

  it("tokens are single-use, short-lived, and end all sessions", async () => {
    const a = await register(t, "reset");
    const { hashToken } = await import("../src/tokens");
    const raw = "r".repeat(43);
    await prisma.passwordResetToken.create({ data: { userId: a.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 60_000) } });
    await json("/auth/reset-password", { token: raw, password: "BrandNewPassw0rd!" }).expect(200);
    await json("/auth/reset-password", { token: raw, password: "AnotherPassw0rd!!" }).expect(400); // reused
    await a.http("get", "/auth/me").expect(401); // old session revoked
    await json("/auth/login", { identifier: a.username, password: "BrandNewPassw0rd!" }).expect(200);

    const expired = "e".repeat(43);
    await prisma.passwordResetToken.create({ data: { userId: a.id, tokenHash: hashToken(expired), expiresAt: new Date(Date.now() - 1000) } });
    await json("/auth/reset-password", { token: expired, password: "BrandNewPassw0rd!2" }).expect(400);
  });
});

describe("account deletion", () => {
  it("requires the password and removes the user and sessions", async () => {
    const a = await register(t, "del");
    await a.http("delete", "/auth/account").send({ password: "wrong-password-1" }).expect(403);
    await a.http("delete", "/auth/account").send({ password: PASSWORD }).expect(204);
    expect(await prisma.user.count({ where: { id: a.id } })).toBe(0);
    await a.http("get", "/auth/me").expect(401);
  });
});

describe("rate limiting", () => {
  it("locks out repeated failed logins", async () => {
    const limited = await startApp({ rateLimits: true });
    try {
      let last = 0;
      for (let i = 0; i < 12; i++) {
        const res = await request(limited.app).post("/api/v1/auth/login").set("Origin", ORIGIN).send({ identifier: "ratelimit_target", password: "wrong-password-1" });
        last = res.status;
      }
      expect(last).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe("health", () => {
  it("reports ok and ready", async () => {
    await request(t.app).get("/health").expect(200);
    await request(t.app).get("/ready").expect(200);
  });
  it("sets security headers", async () => {
    const res = await request(t.app).get("/health");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
