import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { contactUser, messageInclude, publicUser, serializeMessage } from "../serializers";

/** Builds conversation list entries (N+1 per conversation, capped at 200 - fine for personal messaging). */
export async function loadSummaries(userId: string, where: Prisma.ConversationParticipantWhereInput = {}) {
  const rows = await prisma.conversationParticipant.findMany({
    where: { userId, ...where },
    include: {
      conversation: { include: { participants: { where: { userId: { not: userId } }, include: { user: true } } } },
    },
    orderBy: { conversation: { lastMessageAt: "desc" } },
    take: 200,
  });
  const otherIds = rows.map((r) => r.conversation.participants[0]?.userId).filter((x): x is string => !!x);
  const [contacts, blocks] = await Promise.all([
    prisma.contact.findMany({ where: { OR: [{ userAId: userId, userBId: { in: otherIds } }, { userBId: userId, userAId: { in: otherIds } }] } }),
    prisma.blockedUser.findMany({ where: { OR: [{ blockerId: userId, blockedId: { in: otherIds } }, { blockedId: userId, blockerId: { in: otherIds } }] } }),
  ]);
  const contactSet = new Set(contacts.map((c) => (c.userAId === userId ? c.userBId : c.userAId)));
  const blockSet = new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));

  const items = await Promise.all(
    rows.map(async (r) => {
      const other = r.conversation.participants[0]?.user;
      if (!other) return null;
      const visible = { conversationId: r.conversationId, deletions: { none: { userId } } };
      const [last, unread] = await Promise.all([
        prisma.message.findFirst({ where: visible, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: messageInclude }),
        prisma.message.count({ where: { ...visible, senderId: { not: userId }, deletedAt: null, receipts: { none: { userId } } } }),
      ]);
      const canMessage = contactSet.has(other.id) && !blockSet.has(other.id);
      return {
        id: r.conversationId,
        other: canMessage ? contactUser(other) : { ...publicUser(other), presence: null },
        pinned: r.pinned,
        archived: r.archived,
        muted: r.muted,
        unreadCount: unread,
        lastMessageAt: (last?.createdAt ?? r.conversation.lastMessageAt).toISOString(),
        lastMessage: last ? serializeMessage(last, userId) : null,
        canMessage,
      };
    }),
  );
  return items.filter((x): x is NonNullable<typeof x> => x !== null);
}
