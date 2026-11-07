import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { io as ioClient, type Socket } from "socket.io-client";
import { createApp } from "../src/app";

export const ORIGIN = "http://localhost:5173";
export const PASSWORD = "CorrectHorse-Battery9";

export async function startApp(opts: Parameters<typeof createApp>[0] = { rateLimits: false }) {
  const ctx = createApp(opts);
  await new Promise<void>((r) => ctx.httpServer.listen(0, "127.0.0.1", r));
  const port = (ctx.httpServer.address() as AddressInfo).port;
  return { ...ctx, port, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => { ctx.io.close(); ctx.httpServer.close(() => r()); }) };
}
export type TestApp = Awaited<ReturnType<typeof startApp>>;

export interface Client {
  id: string;
  username: string;
  csrf: string;
  cookie: string;
  http: (method: "get" | "post" | "patch" | "delete", path: string) => request.Test;
}

const uniq = () => randomUUID().replace(/-/g, "").slice(0, 10);

export async function register(t: TestApp, name = "user"): Promise<Client> {
  const username = `${name}_${uniq()}`;
  const res = await request(t.app).post("/api/v1/auth/register").set("Origin", ORIGIN)
    .send({ username, email: `${username}@example.test`, password: PASSWORD });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
  const client: Client = {
    id: res.body.user.id, username, csrf: res.body.csrfToken, cookie,
    http: (method, path) => request(t.app)[method](`/api/v1${path}`).set("Cookie", cookie).set("Origin", ORIGIN).set("X-CSRF-Token", client.csrf),
  };
  return client;
}

/** Makes two users contacts with a conversation. */
export async function befriend(t: TestApp, a: Client, b: Client): Promise<string> {
  await a.http("post", "/contacts/requests").send({ username: b.username }).expect(201);
  const reqs = await b.http("get", "/contacts/requests").expect(200);
  await b.http("post", `/contacts/requests/${reqs.body.incoming[0].id}/accept`).expect(200);
  const conv = await a.http("post", "/conversations").send({ userId: b.id }).expect(200);
  return conv.body.conversation.id as string;
}

export function connectSocket(t: TestApp, cookie: string, origin = ORIGIN): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(t.url, { extraHeaders: { cookie, origin }, transports: ["websocket"], forceNew: true, reconnection: false });
    s.on("connect", () => resolve(s));
    s.on("connect_error", (e) => reject(e));
  });
}

export const emitAck = <T = any>(s: Socket, event: string, payload: unknown): Promise<T> =>
  new Promise((resolve) => s.timeout(5000).emit(event, payload, (err: unknown, res: T) => resolve(err ? ({ ok: false, error: { code: "timeout" } } as T) : res)));

export const waitFor = <T = any>(s: Socket, event: string, ms = 4000): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (d: T) => { clearTimeout(t); resolve(d); });
  });
