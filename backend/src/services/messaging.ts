import { Prisma } from "@prisma/client";
import type { Server } from "socket.io";
import { prisma } from "../db";
import { HttpError, forbidden, notFound } from "../errors";
import { messageInclude, serializeMessage } from "../serializers";
import { canInteract, otherParticipantId, requireParticipant } from "./relations";
import { userRoom } from "./realtime";

export interface SendInput {
  conversationId: string;
  clientId: string;
  body: string;
  replyToId?: string | null;
}

/**
 * Single code path for sending (used by both Socket.IO and REST). Identity comes ONLY from `userId`
 * (the authenticated session) - sender, participants and timestamps are never taken from the client.
 */
export async function sendMessage(io: Server, userId: string, input: SendInput) {
  if (!(await requireParticipant(userId, input.conversationId))) throw notFound("Conversation");
  const otherId = await otherParticipantId(input.conversationId, userId);
  if (!otherId) throw notFound("Conversation");
  if (!(await canInteract(userId, otherId))) throw forbidden("You can't send messages in this conversation");

  // Idempotency: a retry with the same clientId returns the original message instead of duplicating it.
  const existing = await prisma.message.findUnique({
    where: { senderId_clientId: { senderId: userId, clientId: input.clientId } },
    include: messageInclude,
  });
  if (existing) {
    if (existing.conversationId !== input.conversationId) throw new HttpError(409, "client_id_reused", "clientId was already used");
    return { message: serializeMessage(existing, userId), duplicate: true };
  }

  if (input.replyToId) {
    const target = await prisma.message.findFirst({ where: { id: input.replyToId, conversationId: input.conversationId }, select: { id: true } });
    if (!target) throw new HttpError(400, "bad_reply", "The message you're replying to doesn't exist");
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: {
          conversationId: input.conversationId,
          senderId: userId,
          clientId: input.clientId,
          body: input.body,
          replyToId: input.replyToId ?? null,
        },
        include: messageInclude,
      });
      await tx.conversation.update({ where: { id: input.conversationId }, data: { lastMessageAt: m.createdAt } });
      // A new message un-archives the conversation for the recipient so it isn't missed.
      await tx.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: input.conversationId, userId: otherId } },
        data: { archived: false },
      });
      return m;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await prisma.message.findUnique({
        where: { senderId_clientId: { senderId: userId, clientId: input.clientId } },
        include: messageInclude,
      });
      if (dup) return { message: serializeMessage(dup, userId), duplicate: true };
    }
    throw e;
  }

  io.to(userRoom(userId)).emit("message:new", serializeMessage(created, userId));
  io.to(userRoom(otherId)).emit("message:new", serializeMessage(created, otherId));
  return { message: serializeMessage(created, userId), duplicate: false };
}

export async function markRead(io: Server, userId: string, conversationId: string) {
  if (!(await requireParticipant(userId, conversationId))) throw notFound("Conversation");
  const otherId = await otherParticipantId(conversationId, userId);
  const unread = await prisma.message.findMany({
    where: { conversationId, senderId: { not: userId }, deletedAt: null, receipts: { none: { userId } } },
    select: { id: true },
    take: 1000,
  });
  if (unread.length === 0) return { messageIds: [] as string[] };
  await prisma.messageReceipt.createMany({ data: unread.map((m) => ({ messageId: m.id, userId })), skipDuplicates: true });
  const payload = { conversationId, readerId: userId, messageIds: unread.map((m) => m.id) };
  io.to(userRoom(userId)).emit("message:read", payload); // sync the reader's other devices
  if (otherId) io.to(userRoom(otherId)).emit("message:read", payload);
  return { messageIds: payload.messageIds };
}

export async function deleteMessage(io: Server, userId: string, conversationId: string, messageId: string, scope: "me" | "all") {
  if (!(await requireParticipant(userId, conversationId))) throw notFound("Conversation");
  const msg = await prisma.message.findFirst({ where: { id: messageId, conversationId } });
  if (!msg) throw notFound("Message");
  const otherId = await otherParticipantId(conversationId, userId);

  if (scope === "me") {
    await prisma.messageDeletion.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId },
      update: {},
    });
    io.to(userRoom(userId)).emit("message:deleted", { conversationId, messageId, scope: "me" });
    return;
  }
  if (msg.senderId !== userId) throw forbidden("You can only delete your own messages for everyone");
  if (!msg.deletedAt) await prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date(), body: "" } });
  const payload = { conversationId, messageId, scope: "all" };
  io.to(userRoom(userId)).emit("message:deleted", payload);
  if (otherId) io.to(userRoom(otherId)).emit("message:deleted", payload);
}
