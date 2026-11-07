export interface Presence { online: boolean; lastSeenAt: string | null }
export interface PublicUser { id: string; username: string; displayName: string; status: string; avatarColor: string }
export interface ContactUser extends PublicUser { presence: Presence | null }
export interface NotificationPrefs { soundEnabled: boolean; desktopEnabled: boolean; previewsEnabled: boolean }
export interface Self extends PublicUser { email: string; showLastSeen: boolean; notifications: NotificationPrefs }
export type Relationship = "none" | "contact" | "request_sent" | "request_received";
export interface SearchUser extends PublicUser { relationship: Relationship }
export interface RequestItem { id: string; createdAt: string; user: PublicUser }

export type MessageStatus = "pending" | "failed" | "sent" | "read" | null;
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  clientId: string;
  body: string | null;
  createdAt: string;
  deletedAt: string | null;
  replyTo: { id: string; senderId: string; body: string | null; deleted: boolean } | null;
  status: MessageStatus;
  error?: string;
  permanent?: boolean;
}
export interface Conversation {
  id: string;
  other: ContactUser;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  unreadCount: number;
  lastMessageAt: string;
  lastMessage: Message | null;
  canMessage: boolean;
}
