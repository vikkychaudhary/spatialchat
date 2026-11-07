import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../db";

/** Contacts are stored once with userAId < userBId (enforced by a CHECK constraint). */
export const orderPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export async function areContacts(a: string, b: string): Promise<boolean> {
  const [userAId, userBId] = orderPair(a, b);
  return (await prisma.contact.count({ where: { userAId, userBId } })) > 0;
}

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  return (
    (await prisma.blockedUser.count({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    })) > 0
  );
}

/** Messaging and typing indicators require an accepted contact and no block in either direction. */
export async function canInteract(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  return (await areContacts(a, b)) && !(await isBlockedEitherWay(a, b));
}

export async function ensureConversation(db: PrismaClient | Prisma.TransactionClient, a: string, b: string) {
  const [x, y] = orderPair(a, b);
  const directKey = `${x}:${y}`;
  const existing = await db.conversation.findUnique({ where: { directKey } });
  if (existing) return existing;
  try {
    return await db.conversation.create({ data: { directKey, participants: { create: [{ userId: x }, { userId: y }] } } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return db.conversation.findUniqueOrThrow({ where: { directKey } });
    }
    throw e;
  }
}

/** Returns the participant row or throws 404 (404, not 403, so conversation IDs can't be probed). */
export async function requireParticipant(userId: string, conversationId: string) {
  const p = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!p) return null;
  return p;
}

export async function otherParticipantId(conversationId: string, userId: string): Promise<string | null> {
  const o = await prisma.conversationParticipant.findFirst({ where: { conversationId, userId: { not: userId } }, select: { userId: true } });
  return o?.userId ?? null;
}
