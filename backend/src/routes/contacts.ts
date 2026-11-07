import { Router } from "express";
import type { Server } from "socket.io";
import { prisma } from "../db";
import { HttpError, notFound, wrap } from "../errors";
import { authed, me, requireAuth } from "../middleware/auth";
import type { Limiters } from "../middleware/limits";
import { username as usernameSchema, uuid } from "../schemas";
import { contactUser, publicUser } from "../serializers";
import { loadSummaries } from "../services/conversations";
import { emitToUsers } from "../services/realtime";
import { ensureConversation, isBlockedEitherWay, orderPair } from "../services/relations";
import { z } from "zod";

export function contactsRouter(limits: Limiters) {
  const r = Router();
  r.use(requireAuth);
  const io = (req: import("express").Request) => req.app.get("io") as Server;

  r.get("/contacts", wrap(async (req, res) => {
    const id = me(req).id;
    const rows = await prisma.contact.findMany({ where: { OR: [{ userAId: id }, { userBId: id }] }, include: { userA: true, userB: true }, orderBy: { createdAt: "desc" } });
    res.json({ contacts: rows.map((c) => contactUser(c.userAId === id ? c.userB : c.userA)) });
  }));

  r.get("/contacts/requests", wrap(async (req, res) => {
    const id = me(req).id;
    const [incoming, outgoing] = await Promise.all([
      prisma.contactRequest.findMany({ where: { receiverId: id }, include: { sender: true }, orderBy: { createdAt: "desc" } }),
      prisma.contactRequest.findMany({ where: { senderId: id }, include: { receiver: true }, orderBy: { createdAt: "desc" } }),
    ]);
    res.json({
      incoming: incoming.map((q) => ({ id: q.id, createdAt: q.createdAt.toISOString(), user: publicUser(q.sender) })),
      outgoing: outgoing.map((q) => ({ id: q.id, createdAt: q.createdAt.toISOString(), user: publicUser(q.receiver) })),
    });
  }));

  /** Accept: creates the contact + conversation, removes the request. Idempotent for already-accepted pairs. */
  async function acceptPair(req: import("express").Request, a: string, b: string) {
    const [userAId, userBId] = orderPair(a, b);
    await prisma.$transaction([
      prisma.contactRequest.deleteMany({ where: { OR: [{ senderId: a, receiverId: b }, { senderId: b, receiverId: a }] } }),
      prisma.contact.upsert({ where: { userAId_userBId: { userAId, userBId } }, create: { userAId, userBId }, update: {} }),
    ]);
    await ensureConversation(prisma, a, b);
    const server = io(req);
    for (const uid of [a, b]) {
      const [conversation] = await loadSummaries(uid, { conversation: { directKey: `${userAId}:${userBId}` } });
      server.to(`user:${uid}`).emit("contact:accepted", { conversation });
    }
  }

  r.post("/contacts/requests", limits.contactRequest, ...authed, wrap(async (req, res) => {
    const { username } = z.object({ username: usernameSchema }).parse(req.body);
    const viewer = me(req);
    const target = await prisma.user.findUnique({ where: { username } });
    // Same response for "missing", "self" and "blocked" so blocks and accounts aren't revealed.
    if (!target || target.id === viewer.id || (await isBlockedEitherWay(viewer.id, target.id))) throw notFound("User");
    const [userAId, userBId] = orderPair(viewer.id, target.id);
    if (await prisma.contact.findUnique({ where: { userAId_userBId: { userAId, userBId } } })) throw new HttpError(409, "already_contacts", "You're already contacts");
    const reverse = await prisma.contactRequest.findUnique({ where: { senderId_receiverId: { senderId: target.id, receiverId: viewer.id } } });
    if (reverse) {
      await acceptPair(req, viewer.id, target.id); // they already asked us - connect right away
      return res.status(201).json({ status: "accepted" });
    }
    const request = await prisma.contactRequest.upsert({
      where: { senderId_receiverId: { senderId: viewer.id, receiverId: target.id } },
      create: { senderId: viewer.id, receiverId: target.id },
      update: {},
    });
    emitToUsers(io(req), [target.id], "contact:request", { id: request.id, createdAt: request.createdAt.toISOString(), user: publicUser(viewer) });
    res.status(201).json({ status: "pending", id: request.id });
  }));

  r.post("/contacts/requests/:id/accept", ...authed, wrap(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const request = await prisma.contactRequest.findFirst({ where: { id, receiverId: me(req).id } });
    if (!request) throw notFound("Request");
    if (await isBlockedEitherWay(request.senderId, request.receiverId)) throw notFound("Request");
    await acceptPair(req, request.receiverId, request.senderId);
    res.json({ ok: true });
  }));

  // Receiver declines or sender cancels.
  const removeRequest = wrap(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const viewer = me(req).id;
    const request = await prisma.contactRequest.findFirst({ where: { id, OR: [{ senderId: viewer }, { receiverId: viewer }] } });
    if (!request) throw notFound("Request");
    await prisma.contactRequest.delete({ where: { id } });
    emitToUsers(io(req), [request.senderId, request.receiverId], "contact:request-removed", { id });
    res.status(204).end();
  });
  r.post("/contacts/requests/:id/decline", ...authed, removeRequest);
  r.delete("/contacts/requests/:id", ...authed, removeRequest);

  r.delete("/contacts/:userId", ...authed, wrap(async (req, res) => {
    const other = uuid.parse(req.params.userId);
    const [userAId, userBId] = orderPair(me(req).id, other);
    await prisma.contact.deleteMany({ where: { userAId, userBId } });
    emitToUsers(io(req), [me(req).id, other], "contact:removed", { userId: me(req).id === userAId ? userBId : userAId });
    res.status(204).end();
  }));

  r.get("/blocks", wrap(async (req, res) => {
    const rows = await prisma.blockedUser.findMany({ where: { blockerId: me(req).id }, include: { blocked: true }, orderBy: { createdAt: "desc" } });
    res.json({ blocked: rows.map((b) => publicUser(b.blocked)) });
  }));

  r.post("/blocks", ...authed, wrap(async (req, res) => {
    const { userId } = z.object({ userId: uuid }).parse(req.body);
    const viewer = me(req).id;
    if (userId === viewer) throw new HttpError(400, "invalid", "You can't block yourself");
    if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw notFound("User");
    const [userAId, userBId] = orderPair(viewer, userId);
    await prisma.$transaction([
      prisma.blockedUser.upsert({ where: { blockerId_blockedId: { blockerId: viewer, blockedId: userId } }, create: { blockerId: viewer, blockedId: userId }, update: {} }),
      prisma.contact.deleteMany({ where: { userAId, userBId } }),
      prisma.contactRequest.deleteMany({ where: { OR: [{ senderId: viewer, receiverId: userId }, { senderId: userId, receiverId: viewer }] } }),
    ]);
    emitToUsers(io(req), [viewer], "contact:removed", { userId });
    emitToUsers(io(req), [userId], "contact:removed", { userId: viewer });
    res.status(204).end();
  }));

  r.delete("/blocks/:userId", ...authed, wrap(async (req, res) => {
    const userId = uuid.parse(req.params.userId);
    await prisma.blockedUser.deleteMany({ where: { blockerId: me(req).id, blockedId: userId } });
    res.status(204).end();
  }));

  return r;
}
