import { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError, forbidden, notFound, wrap } from "../errors";
import { authed, me, requireAuth } from "../middleware/auth";
import type { Limiters } from "../middleware/limits";
import { messageBody, uuid } from "../schemas";
import { messageInclude, serializeMessage } from "../serializers";
import { loadSummaries } from "../services/conversations";
import { deleteMessage, markRead, sendMessage } from "../services/messaging";
import { canInteract, ensureConversation, requireParticipant } from "../services/relations";

const listQuery = z.object({ q: z.string().trim().max(50).optional(), archived: z.enum(["true", "false"]).default("false") });
const messagesQuery = z.object({
  before: uuid.optional(),
  after: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().min(1).max(100).optional(),
});

export function conversationsRouter(limits: Limiters) {
  const r = Router();
  r.use(requireAuth);
  const io = (req: import("express").Request) => req.app.get("io") as Server;

  r.get("/conversations", wrap(async (req, res) => {
    const { q, archived } = listQuery.parse(req.query);
    const userId = me(req).id;
    const where: Prisma.ConversationParticipantWhereInput = { archived: archived === "true" };
    if (q) {
      where.conversation = {
        OR: [
          { participants: { some: { userId: { not: userId }, user: { OR: [{ username: { contains: q.toLowerCase() } }, { displayName: { contains: q, mode: "insensitive" } }] } } } },
          { messages: { some: { body: { contains: q, mode: "insensitive" }, deletedAt: null, deletions: { none: { userId } } } } },
        ],
      };
    }
    const items = await loadSummaries(userId, where);
    items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastMessageAt.localeCompare(a.lastMessageAt));
    res.json({ conversations: items });
  }));

  // Start (or reopen) a conversation with an existing contact.
  r.post("/conversations", ...authed, wrap(async (req, res) => {
    const { userId } = z.object({ userId: uuid }).parse(req.body);
    const viewer = me(req).id;
    if (!(await canInteract(viewer, userId))) throw forbidden("You can only message your contacts");
    const conv = await ensureConversation(prisma, viewer, userId);
    const [summary] = await loadSummaries(viewer, { conversationId: conv.id });
    res.json({ conversation: summary });
  }));

  r.patch("/conversations/:id", ...authed, wrap(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const data = z.object({ pinned: z.boolean().optional(), archived: z.boolean().optional(), muted: z.boolean().optional() }).parse(req.body);
    if (!(await requireParticipant(me(req).id, id))) throw notFound("Conversation");
    await prisma.conversationParticipant.update({ where: { conversationId_userId: { conversationId: id, userId: me(req).id } }, data });
    const [summary] = await loadSummaries(me(req).id, { conversationId: id });
    res.json({ conversation: summary });
  }));

  r.get("/conversations/:id/messages", wrap(async (req, res) => {
    const conversationId = uuid.parse(req.params.id);
    const { before, after, limit, q } = messagesQuery.parse(req.query);
    const userId = me(req).id;
    if (!(await requireParticipant(userId, conversationId))) throw notFound("Conversation");

    const visible: Prisma.MessageWhereInput = { conversationId, deletions: { none: { userId } } };
    if (q) Object.assign(visible, { body: { contains: q, mode: "insensitive" }, deletedAt: null });

    const cursorId = before ?? after;
    if (cursorId) {
      const c = await prisma.message.findFirst({ where: { id: cursorId, conversationId }, select: { createdAt: true, id: true } });
      if (!c) throw new HttpError(400, "bad_cursor", "Unknown message cursor");
      const cmp = before ? "lt" : "gt";
      visible.AND = [{ OR: [{ createdAt: { [cmp]: c.createdAt } }, { createdAt: c.createdAt, id: { [cmp]: c.id } }] }];
    }
    const newestFirst = !after;
    const rows = await prisma.message.findMany({
      where: visible,
      orderBy: newestFirst ? [{ createdAt: "desc" }, { id: "desc" }] : [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      include: messageInclude,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    if (newestFirst) page.reverse();
    res.json({ messages: page.map((m) => serializeMessage(m, userId)), hasMore });
  }));

  // REST fallback for sending (the web app prefers the Socket.IO event). Same validation, same code path.
  r.post("/conversations/:id/messages", limits.messages, ...authed, wrap(async (req, res) => {
    const conversationId = uuid.parse(req.params.id);
    const body = z.object({ clientId: z.string().uuid(), body: messageBody, replyToId: uuid.optional().nullable() }).parse(req.body);
    const { message, duplicate } = await sendMessage(io(req), me(req).id, { conversationId, ...body });
    res.status(duplicate ? 200 : 201).json({ message });
  }));

  r.post("/conversations/:id/read", ...authed, wrap(async (req, res) => {
    const out = await markRead(io(req), me(req).id, uuid.parse(req.params.id));
    res.json(out);
  }));

  r.delete("/conversations/:id/messages/:messageId", ...authed, wrap(async (req, res) => {
    const scope = z.enum(["me", "all"]).parse(req.query.scope ?? "me");
    await deleteMessage(io(req), me(req).id, uuid.parse(req.params.id), uuid.parse(req.params.messageId), scope);
    res.status(204).end();
  }));

  return r;
}
