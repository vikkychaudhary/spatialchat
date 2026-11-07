import type { Server as HttpServer } from "node:http";
import { parse } from "cookie";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { prisma } from "./db";
import { env } from "./env";
import { HttpError, toErrorBody } from "./errors";
import { log } from "./logger";
import { sendMessageSchema, uuid } from "./schemas";
import { markRead, sendMessage } from "./services/messaging";
import { connected, disconnected, isOnline } from "./services/presence";
import { sessionRoom, userRoom } from "./services/realtime";
import { canInteract, otherParticipantId, requireParticipant } from "./services/relations";
import { COOKIE_NAME, authenticateToken } from "./services/session";

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; error: { code: string; message: string } }) => void;

/** Small token bucket per socket so a connected client can't flood events. */
function makeBucket(capacity: number, refillPerSec: number) {
  let tokens = capacity;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

async function broadcastPresence(io: Server, userId: string, online: boolean) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { showLastSeen: true, lastSeenAt: true } });
  if (!user?.showLastSeen) return; // privacy: users who hide presence never broadcast it
  const contacts = await prisma.contact.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] } });
  const payload = { userId, online, lastSeenAt: user.lastSeenAt?.toISOString() ?? null };
  for (const c of contacts) io.to(userRoom(c.userAId === userId ? c.userBId : c.userAId)).emit("presence", payload);
}

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGINS, credentials: true },
    maxHttpBufferSize: 16 * 1024, // message bodies are capped at 4000 chars
    serveClient: false,
  });

  // Every connection must present a valid session cookie from an allowed origin.
  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && !env.CLIENT_ORIGINS.includes(origin)) return next(new Error("forbidden_origin"));
      const token = parse(socket.handshake.headers.cookie ?? "")[COOKIE_NAME];
      const auth = await authenticateToken(token);
      if (!auth) return next(new Error("unauthorized"));
      socket.data.userId = auth.user.id;
      socket.data.sessionId = auth.sessionId;
      socket.data.expiresAt = auth.expiresAt.getTime();
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const userId: string = socket.data.userId;
    // Clients never join rooms themselves: the server only places a socket in its OWN user/session rooms,
    // so guessing a conversation ID can never subscribe anyone to someone else's messages.
    void socket.join([userRoom(userId), sessionRoom(socket.data.sessionId)]);
    if (connected(userId)) void broadcastPresence(io, userId, true).catch((e) => log.error("presence failed", e));

    const allow = makeBucket(30, 10);

    /** Wraps a handler with: session-expiry check, rate limit, zod validation, error -> ack conversion. */
    const on = <S extends z.ZodTypeAny>(event: string, schema: S, handler: (data: z.infer<S>) => Promise<Record<string, unknown> | void>) => {
      socket.on(event, async (raw: unknown, ack?: Ack) => {
        const reply: Ack = typeof ack === "function" ? ack : () => undefined;
        try {
          if (Date.now() > socket.data.expiresAt) {
            socket.disconnect(true);
            return;
          }
          if (!allow()) throw new HttpError(429, "rate_limited", "You're doing that too fast");
          const data = schema.parse(raw);
          const result = (await handler(data)) ?? {};
          reply({ ok: true, ...result });
        } catch (e) {
          const { status, body } = toErrorBody(e);
          if (status >= 500) log.error(`socket ${event} failed`, e);
          reply({ ok: false, error: { code: body.error.code, message: body.error.message } });
        }
      });
    };

    on("message:send", sendMessageSchema, async (data) => {
      const { message } = await sendMessage(io, userId, data);
      return { message };
    });

    on("message:read", z.object({ conversationId: uuid }), async ({ conversationId }) => {
      await markRead(io, userId, conversationId);
    });

    on("typing", z.object({ conversationId: uuid, isTyping: z.boolean() }), async ({ conversationId, isTyping }) => {
      if (!(await requireParticipant(userId, conversationId))) throw new HttpError(404, "not_found", "Conversation not found");
      const otherId = await otherParticipantId(conversationId, userId);
      if (!otherId || !(await canInteract(userId, otherId))) return;
      io.to(userRoom(otherId)).emit("typing", { conversationId, userId, isTyping });
    });

    socket.on("disconnect", () => {
      if (!disconnected(userId)) return;
      void (async () => {
        const lastSeenAt = new Date();
        await prisma.user.update({ where: { id: userId }, data: { lastSeenAt } }).catch(() => undefined);
        if (!isOnline(userId)) await broadcastPresence(io, userId, false);
      })().catch((e) => log.error("presence failed", e));
    });
  });

  return io;
}
