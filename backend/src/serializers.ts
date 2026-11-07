import type { NotificationPreference, Prisma, User } from "@prisma/client";
import { isOnline } from "./services/presence";

type PublicFields = Pick<User, "id" | "username" | "displayName" | "status" | "avatarColor">;

/** Fields safe to show to any signed-in user. Never includes email, hashes or settings. */
export const publicUser = (u: PublicFields) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  status: u.status,
  avatarColor: u.avatarColor,
});

/** Public fields plus presence, honouring the target user's privacy setting. Only use for contacts. */
export const contactUser = (u: User) => ({
  ...publicUser(u),
  presence: u.showLastSeen ? { online: isOnline(u.id), lastSeenAt: u.lastSeenAt?.toISOString() ?? null } : null,
});

export const selfUser = (u: User & { notificationPreference: NotificationPreference | null }) => ({
  ...publicUser(u),
  email: u.email,
  showLastSeen: u.showLastSeen,
  notifications: {
    soundEnabled: u.notificationPreference?.soundEnabled ?? true,
    desktopEnabled: u.notificationPreference?.desktopEnabled ?? false,
    previewsEnabled: u.notificationPreference?.previewsEnabled ?? true,
  },
});

export const messageInclude = {
  replyTo: { select: { id: true, senderId: true, body: true, deletedAt: true } },
  receipts: { select: { userId: true } },
} satisfies Prisma.MessageInclude;

export type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export function serializeMessage(m: MessageRow, viewerId: string) {
  const deleted = m.deletedAt !== null;
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    clientId: m.clientId,
    body: deleted ? null : m.body,
    createdAt: m.createdAt.toISOString(),
    deletedAt: m.deletedAt?.toISOString() ?? null,
    replyTo: m.replyTo
      ? { id: m.replyTo.id, senderId: m.replyTo.senderId, body: m.replyTo.deletedAt ? null : m.replyTo.body, deleted: m.replyTo.deletedAt !== null }
      : null,
    status: m.senderId === viewerId ? (m.receipts.length > 0 ? ("read" as const) : ("sent" as const)) : null,
  };
}
