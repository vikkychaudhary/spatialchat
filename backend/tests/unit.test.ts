import { describe, expect, it } from "vitest";
import { hashToken, newToken, safeEqual } from "../src/tokens";
import { loginSchema, messageBody, registerSchema, searchSchema, sendMessageSchema } from "../src/schemas";
import { toErrorBody, HttpError } from "../src/errors";
import { orderPair } from "../src/services/relations";

describe("tokens", () => {
  it("generates unique, long tokens and hashes deterministically", () => {
    const a = newToken(), b = newToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a);
  });
  it("safeEqual compares in constant-time style and handles length mismatch", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("validation", () => {
  it("normalizes username and email", () => {
    const r = registerSchema.parse({ username: " Alice_01 ", email: " A@Example.COM ", password: "longenough-pass" });
    expect(r.username).toBe("alice_01");
    expect(r.email).toBe("a@example.com");
  });
  it("rejects bad usernames, short and huge passwords", () => {
    expect(() => registerSchema.parse({ username: "a b", email: "a@b.co", password: "longenough-pass" })).toThrow();
    expect(() => registerSchema.parse({ username: "alice", email: "a@b.co", password: "short" })).toThrow();
    expect(() => registerSchema.parse({ username: "alice", email: "a@b.co", password: "x".repeat(129) })).toThrow();
  });
  it("rejects empty and oversized messages", () => {
    expect(() => messageBody.parse("   ")).toThrow();
    expect(() => messageBody.parse("x".repeat(4001))).toThrow();
    expect(messageBody.parse("  hi  ")).toBe("hi");
  });
  it("requires a UUID clientId and ignores client-supplied sender fields", () => {
    const base = { conversationId: crypto.randomUUID(), body: "hi" };
    expect(() => sendMessageSchema.parse({ ...base, clientId: "nope" })).toThrow();
    const ok = sendMessageSchema.parse({ ...base, clientId: crypto.randomUUID(), senderId: "evil" });
    expect("senderId" in ok).toBe(false);
  });
  it("search needs 3+ characters and strips LIKE wildcards", () => {
    expect(() => searchSchema.parse({ q: "ab" })).toThrow();
    expect(searchSchema.parse({ q: "a%bc" }).q).toBe("abc");
  });
  it("login schema lowercases identifier", () => {
    expect(loginSchema.parse({ identifier: " BoB ", password: "x" }).identifier).toBe("bob");
  });
});

describe("helpers", () => {
  it("orderPair is symmetric", () => {
    expect(orderPair("b", "a")).toEqual(["a", "b"]);
    expect(orderPair("a", "b")).toEqual(["a", "b"]);
  });
  it("error mapper hides internals", () => {
    expect(toErrorBody(new Error("db password leaked")).body.error.message).not.toContain("leaked");
    expect(toErrorBody(new HttpError(403, "forbidden", "no")).status).toBe(403);
  });
});
