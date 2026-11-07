import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { ORIGIN, befriend, connectSocket, emitAck, register, startApp, waitFor, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => { t = await startApp(); });
afterAll(async () => { await t.close(); await prisma.$disconnect(); });

describe("discovery and contacts", () => {
  it("searches by username with pagination shape, never exposing email", async () => {
    const a = await register(t, "finder");
    const b = await register(t, "findme");
    const res = await a.http("get", `/users/search?q=${b.username.slice(0, 8)}`).expect(200);
    const hit = res.body.users.find((u: any) => u.id === b.id);
    expect(hit).toBeTruthy();
    expect(hit.relationship).toBe("none");
    expect(JSON.stringify(res.body)).not.toContain("@example.test");
    expect(res.body).toHaveProperty("nextCursor");
    await a.http("get", "/users/search?q=ab").expect(400); // too short
  });

  it("handles request/accept and duplicates safely", async () => {
    const a = await register(t, "reqa");
    const b = await register(t, "reqb");
    await a.http("post", "/contacts/requests").send({ username: b.username }).expect(201);
    await a.http("post", "/contacts/requests").send({ username: b.username }).expect(201); // idempotent
    expect(await prisma.contactRequest.count({ where: { senderId: a.id, receiverId: b.id } })).toBe(1);
    await a.http("post", "/contacts/requests").send({ username: a.username }).expect(404); // self
    const list = await b.http("get", "/contacts/requests").expect(200);
    await a.http("post", `/contacts/requests/${list.body.incoming[0].id}/accept`).expect(404); // only receiver can accept
    await b.http("post", `/contacts/requests/${list.body.incoming[0].id}/accept`).expect(200);
    await b.http("post", "/contacts/requests").send({ username: a.username }).expect(409);
    expect((await a.http("get", "/contacts")).body.contacts.map((c: any) => c.id)).toContain(b.id);
  });

  it("decline removes a request; reverse request auto-connects", async () => {
    const a = await register(t, "da");
    const b = await register(t, "db");
    await a.http("post", "/contacts/requests").send({ username: b.username }).expect(201);
    const id = (await b.http("get", "/contacts/requests")).body.incoming[0].id;
    await b.http("post", `/contacts/requests/${id}/decline`).expect(204);
    expect((await b.http("get", "/contacts/requests")).body.incoming).toHaveLength(0);
    await a.http("post", "/contacts/requests").send({ username: b.username }).expect(201);
    const res = await b.http("post", "/contacts/requests").send({ username: a.username }).expect(201);
    expect(res.body.status).toBe("accepted");
  });
});

describe("messaging over REST and Socket.IO", () => {
  it("delivers a message in real time and stores it", async () => {
    const a = await register(t, "ma");
    const b = await register(t, "mb");
    const conv = await befriend(t, a, b);
    const sa = await connectSocket(t, a.cookie);
    const sb = await connectSocket(t, b.cookie);
    const incoming = waitFor(sb, "message:new");
    const ack = await emitAck(sa, "message:send", { conversationId: conv, clientId: randomUUID(), body: "hello bob" });
    expect(ack.ok).toBe(true);
    const got = await incoming;
    expect(got.body).toBe("hello bob");
    expect(got.senderId).toBe(a.id);
    const history = await b.http("get", `/conversations/${conv}/messages`).expect(200);
    expect(history.body.messages.map((m: any) => m.body)).toEqual(["hello bob"]);
    sa.close(); sb.close();
  });

  it("is idempotent for retried client IDs (no duplicates)", async () => {
    const a = await register(t, "ia");
    const b = await register(t, "ib");
    const conv = await befriend(t, a, b);
    const clientId = randomUUID();
    const first = await a.http("post", `/conversations/${conv}/messages`).send({ clientId, body: "once" }).expect(201);
    const second = await a.http("post", `/conversations/${conv}/messages`).send({ clientId, body: "once" }).expect(200);
    expect(second.body.message.id).toBe(first.body.message.id);
    expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(1);
  });

  it("paginates history in order", async () => {
    const a = await register(t, "pa");
    const b = await register(t, "pb");
    const conv = await befriend(t, a, b);
    for (let i = 1; i <= 7; i++) await a.http("post", `/conversations/${conv}/messages`).send({ clientId: randomUUID(), body: `m${i}` }).expect(201);
    const page1 = await a.http("get", `/conversations/${conv}/messages?limit=3`).expect(200);
    expect(page1.body.messages.map((m: any) => m.body)).toEqual(["m5", "m6", "m7"]);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await a.http("get", `/conversations/${conv}/messages?limit=3&before=${page1.body.messages[0].id}`).expect(200);
    expect(page2.body.messages.map((m: any) => m.body)).toEqual(["m2", "m3", "m4"]);
    const sync = await a.http("get", `/conversations/${conv}/messages?after=${page2.body.messages[2].id}&limit=10`).expect(200);
    expect(sync.body.messages.map((m: any) => m.body)).toEqual(["m5", "m6", "m7"]);
  });

  it("tracks unread counts and read receipts", async () => {
    const a = await register(t, "ra");
    const b = await register(t, "rb");
    const conv = await befriend(t, a, b);
    await a.http("post", `/conversations/${conv}/messages`).send({ clientId: randomUUID(), body: "ping" }).expect(201);
    expect((await b.http("get", "/conversations")).body.conversations[0].unreadCount).toBe(1);
    await b.http("post", `/conversations/${conv}/read`).expect(200);
    expect((await b.http("get", "/conversations")).body.conversations[0].unreadCount).toBe(0);
    const hist = await a.http("get", `/conversations/${conv}/messages`).expect(200);
    expect(hist.body.messages[0].status).toBe("read");
  });

  it("delete for me hides only for me; delete for everyone is sender-only", async () => {
    const a = await register(t, "xa");
    const b = await register(t, "xb");
    const conv = await befriend(t, a, b);
    const m = (await a.http("post", `/conversations/${conv}/messages`).send({ clientId: randomUUID(), body: "secret" }).expect(201)).body.message;
    await b.http("delete", `/conversations/${conv}/messages/${m.id}?scope=all`).expect(403);
    await b.http("delete", `/conversations/${conv}/messages/${m.id}?scope=me`).expect(204);
    expect((await b.http("get", `/conversations/${conv}/messages`)).body.messages).toHaveLength(0);
    expect((await a.http("get", `/conversations/${conv}/messages`)).body.messages).toHaveLength(1);
    await a.http("delete", `/conversations/${conv}/messages/${m.id}?scope=all`).expect(204);
    const tomb = (await a.http("get", `/conversations/${conv}/messages`)).body.messages[0];
    expect(tomb.body).toBeNull();
    expect((await prisma.message.findUniqueOrThrow({ where: { id: m.id } })).body).toBe("");
  });

  it("rejects invalid and oversized inputs", async () => {
    const a = await register(t, "va");
    const b = await register(t, "vb");
    const conv = await befriend(t, a, b);
    await a.http("post", `/conversations/${conv}/messages`).send({ clientId: randomUUID(), body: "" }).expect(400);
    await a.http("post", `/conversations/${conv}/messages`).send({ clientId: randomUUID(), body: "x".repeat(4001) }).expect(400);
    await a.http("post", `/conversations/${conv}/messages`).send({ clientId: "not-a-uuid", body: "hi" }).expect(400);
    await request(t.app).post("/api/v1/auth/login").set("Origin", ORIGIN).send({ identifier: "x", password: "y".repeat(50_000) }).expect(413);
  });
});

describe("authorization", () => {
  it("non-participants cannot read, send, mark read, delete or change conversations", async () => {
    const a = await register(t, "za");
    const b = await register(t, "zb");
    const mallory = await register(t, "mallory");
    const conv = await befriend(t, a, b);
    const m = (await a.http("post", `/conversations/${conv}/messages`).send({ clientId: randomUUID(), body: "private" }).expect(201)).body.message;

    await mallory.http("get", `/conversations/${conv}/messages`).expect(404);
    await mallory.http("get", `/conversations/${conv}/messages?q=private`).expect(404);
    await mallory.http("post", `/conversations/${conv}/messages`).send({ clientId: randomUUID(), body: "hi" }).expect(404);
    await mallory.http("post", `/conversations/${conv}/read`).expect(404);
    await mallory.http("delete", `/conversations/${conv}/messages/${m.id}?scope=me`).expect(404);
    await mallory.http("patch", `/conversations/${conv}`).send({ pinned: true }).expect(404);
    expect((await mallory.http("get", "/conversations")).body.conversations).toHaveLength(0);
    await mallory.http("post", "/conversations").send({ userId: a.id }).expect(403); // not a contact
  });

  it("socket connections require a valid session and an allowed origin", async () => {
    const a = await register(t, "sa");
    await expect(connectSocket(t, "sc_sid=forged")).rejects.toBeTruthy();
    await expect(connectSocket(t, a.cookie, "https://evil.example")).rejects.toBeTruthy();
  });

  it("a socket cannot send into, or receive from, someone else's conversation", async () => {
    const a = await register(t, "ua");
    const b = await register(t, "ub");
    const mallory = await register(t, "mal2");
    const conv = await befriend(t, a, b);
    const sm = await connectSocket(t, mallory.cookie);
    const sa = await connectSocket(t, a.cookie);
    let leaked = false;
    sm.on("message:new", () => { leaked = true; });
    sm.on("typing", () => { leaked = true; });
    const ack = await emitAck(sm, "message:send", { conversationId: conv, clientId: randomUUID(), body: "intrusion" });
    expect(ack.ok).toBe(false);
    await emitAck(sm, "typing", { conversationId: conv, isTyping: true });
    await emitAck(sm, "message:read", { conversationId: conv });
    // Mallory tries to "join" the conversation room by name - the server has no such handler.
    sm.emit("join", conv); sm.emit("conversation:join", conv);
    await emitAck(sa, "message:send", { conversationId: conv, clientId: randomUUID(), body: "legit" });
    await new Promise((r) => setTimeout(r, 400));
    expect(leaked).toBe(false);
    expect(await prisma.message.count({ where: { conversationId: conv, body: "intrusion" } })).toBe(0);
    sm.close(); sa.close();
  });

  it("ignores client-supplied sender IDs (no impersonation)", async () => {
    const a = await register(t, "ia2");
    const b = await register(t, "ib2");
    const conv = await befriend(t, a, b);
    const sb = await connectSocket(t, b.cookie);
    const ack = await emitAck(sb, "message:send", { conversationId: conv, clientId: randomUUID(), body: "who am i", senderId: a.id, createdAt: "2001-01-01T00:00:00Z" });
    expect(ack.ok).toBe(true);
    expect(ack.message.senderId).toBe(b.id);
    expect(new Date(ack.message.createdAt).getFullYear()).toBeGreaterThan(2020);
    sb.close();
  });

  it("malformed socket payloads are rejected, not crashed on", async () => {
    const a = await register(t, "mf");
    const s = await connectSocket(t, a.cookie);
    for (const bad of [null, "str", 42, {}, { conversationId: "x" }, { conversationId: randomUUID(), clientId: randomUUID(), body: "x".repeat(5000) }]) {
      const res = await emitAck(s, "message:send", bad);
      expect(res.ok).toBe(false);
    }
    s.close();
  });
});

describe("blocking", () => {
  it("blocked users can't message, find or contact the blocker", async () => {
    const a = await register(t, "ba");
    const b = await register(t, "bb");
    const conv = await befriend(t, a, b);
    await a.http("post", "/blocks").send({ userId: b.id }).expect(204);

    await b.http("post", `/conversations/${conv}/messages`).send({ clientId: randomUUID(), body: "let me in" }).expect(403);
    await a.http("post", `/conversations/${conv}/messages`).send({ clientId: randomUUID(), body: "you too" }).expect(403);
    await b.http("post", "/contacts/requests").send({ username: a.username }).expect(404);
    const search = await b.http("get", `/users/search?q=${a.username.slice(0, 8)}`).expect(200);
    expect(search.body.users.find((u: any) => u.id === a.id)).toBeUndefined();
    expect((await a.http("get", "/contacts")).body.contacts).toHaveLength(0);

    await a.http("delete", `/blocks/${b.id}`).expect(204);
    await b.http("post", `/conversations/${conv}/messages`).send({ clientId: randomUUID(), body: "still not contacts" }).expect(403); // block removed contact
  });
});

describe("database constraints", () => {
  it("enforces unique pairs, ordered contacts and self-reference checks", async () => {
    const a = await register(t, "ca");
    const b = await register(t, "cb");
    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await prisma.contact.create({ data: { userAId: x, userBId: y } });
    await expect(prisma.contact.create({ data: { userAId: x, userBId: y } })).rejects.toBeTruthy();
    await expect(prisma.contact.create({ data: { userAId: y, userBId: x } })).rejects.toBeTruthy(); // CHECK userAId < userBId
    await expect(prisma.contactRequest.create({ data: { senderId: a.id, receiverId: a.id } })).rejects.toBeTruthy();
    await expect(prisma.blockedUser.create({ data: { blockerId: a.id, blockedId: a.id } })).rejects.toBeTruthy();
  });

  it("deleting a user cascades their data", async () => {
    const a = await register(t, "cas");
    const b = await register(t, "cat");
    const conv = await befriend(t, a, b);
    await a.http("post", `/conversations/${conv}/messages`).send({ clientId: randomUUID(), body: "bye" }).expect(201);
    await a.http("delete", "/auth/account").send({ password: "CorrectHorse-Battery9" }).expect(204);
    expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(0);
    expect(await prisma.conversation.count({ where: { id: conv } })).toBe(0);
  });
});
