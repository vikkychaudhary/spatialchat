import { Router } from "express";
import { prisma } from "../db";
import { HttpError, wrap } from "../errors";
import { authed, me, requireAuth } from "../middleware/auth";
import type { Limiters } from "../middleware/limits";
import { profileSchema, searchSchema, settingsSchema, username as usernameSchema } from "../schemas";
import { publicUser, selfUser } from "../serializers";

export type Relationship = "none" | "contact" | "request_sent" | "request_received";

async function relationships(viewerId: string, ids: string[]): Promise<Map<string, Relationship>> {
  const [contacts, requests] = await Promise.all([
    prisma.contact.findMany({ where: { OR: [{ userAId: viewerId, userBId: { in: ids } }, { userBId: viewerId, userAId: { in: ids } }] } }),
    prisma.contactRequest.findMany({ where: { OR: [{ senderId: viewerId, receiverId: { in: ids } }, { receiverId: viewerId, senderId: { in: ids } }] } }),
  ]);
  const map = new Map<string, Relationship>();
  for (const c of contacts) map.set(c.userAId === viewerId ? c.userBId : c.userAId, "contact");
  for (const q of requests) map.set(q.senderId === viewerId ? q.receiverId : q.senderId, q.senderId === viewerId ? "request_sent" : "request_received");
  return map;
}

export function usersRouter(limits: Limiters) {
  const r = Router();
  r.use(requireAuth);

  // Search: min 3 chars, rate limited per user, excludes self and anyone who blocked the caller.
  r.get("/users/search", limits.search, wrap(async (req, res) => {
    const { q, cursor } = searchSchema.parse(req.query);
    const viewer = me(req);
    const take = 20;
    const users = await prisma.user.findMany({
      where: {
        id: { not: viewer.id },
        blocking: { none: { blockedId: viewer.id } },
        blockedBy: { none: { blockerId: viewer.id } },
        ...(cursor ? { username: { gt: cursor } } : {}),
        OR: [{ username: { startsWith: q.toLowerCase() } }, { displayName: { contains: q, mode: "insensitive" } }],
      },
      orderBy: { username: "asc" },
      take: take + 1,
    });
    const page = users.slice(0, take);
    const rel = await relationships(viewer.id, page.map((u) => u.id));
    res.json({
      users: page.map((u) => ({ ...publicUser(u), relationship: rel.get(u.id) ?? "none" })),
      nextCursor: users.length > take ? page[page.length - 1]!.username : null,
    });
  }));

  r.get("/users/by-username/:username", limits.search, wrap(async (req, res) => {
    const name = usernameSchema.parse(req.params.username);
    const viewer = me(req);
    const user = await prisma.user.findFirst({
      where: { username: name, id: { not: viewer.id }, blocking: { none: { blockedId: viewer.id } } },
    });
    if (!user) throw new HttpError(404, "not_found", "User not found");
    const rel = await relationships(viewer.id, [user.id]);
    res.json({ user: { ...publicUser(user), relationship: rel.get(user.id) ?? "none" } });
  }));

  r.patch("/me/profile", ...authed, wrap(async (req, res) => {
    const data = profileSchema.parse(req.body);
    const user = await prisma.user.update({ where: { id: me(req).id }, data, include: { notificationPreference: true } });
    res.json({ user: selfUser(user) });
  }));

  r.patch("/me/settings", ...authed, wrap(async (req, res) => {
    const { showLastSeen, ...prefs } = settingsSchema.parse(req.body);
    const id = me(req).id;
    if (showLastSeen !== undefined) await prisma.user.update({ where: { id }, data: { showLastSeen } });
    if (Object.keys(prefs).length) await prisma.notificationPreference.upsert({ where: { userId: id }, create: { userId: id, ...prefs }, update: prefs });
    const user = await prisma.user.findUniqueOrThrow({ where: { id }, include: { notificationPreference: true } });
    res.json({ user: selfUser(user) });
  }));

  return r;
}
