import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { api, errorMessage } from "../lib/api";
import { beep } from "../lib/notify";
import type { Conversation, ContactUser, Message, RequestItem } from "../lib/types";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";

type Connection = "online" | "connecting" | "offline";

interface ChatApi {
  conversations: Conversation[];
  conversationsLoaded: boolean;
  conversationsError: string | null;
  messages: Record<string, Message[]>;
  hasMore: Record<string, boolean>;
  typing: Record<string, boolean>;
  connection: Connection;
  contacts: ContactUser[];
  incoming: RequestItem[];
  outgoing: RequestItem[];
  totalUnread: number;
  reloadConversations: () => Promise<void>;
  reloadContacts: () => Promise<void>;
  reloadRequests: () => Promise<void>;
  loadMessages: (id: string, mode: "latest" | "older") => Promise<void>;
  send: (conversationId: string, body: string, replyTo: Message | null) => void;
  retry: (m: Message) => void;
  remove: (m: Message, scope: "me" | "all") => Promise<void>;
  markRead: (id: string) => Promise<void>;
  setTyping: (id: string, isTyping: boolean) => void;
  setActive: (id: string | null) => void;
  patchConversation: (id: string, patch: Partial<Pick<Conversation, "pinned" | "archived" | "muted">>) => Promise<void>;
}
const Ctx = createContext<ChatApi | null>(null);
export const useChat = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useChat outside provider");
  return v;
};

const cmp = (a: Message, b: Message) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1);
const sortConvs = (list: Conversation[]) => [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastMessageAt.localeCompare(a.lastMessageAt));

function emitAck<T>(socket: Socket | null, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) return reject(new Error("You're offline. This will send when you reconnect."));
    socket.timeout(8000).emit(event, payload, (err: unknown, res: { ok: boolean; error?: { message: string } }) => {
      if (err) return reject(new Error("The server didn't respond in time."));
      if (res?.ok) return resolve(res as T);
      reject(Object.assign(new Error(res?.error?.message ?? "Couldn't send"), { permanent: true }));
    });
  });
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user, clear } = useAuth();
  const toast = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setLoaded] = useState(false);
  const [conversationsError, setConvError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const [typing, setTypingState] = useState<Record<string, boolean>>({});
  const [connection, setConnection] = useState<Connection>("connecting");
  const [contacts, setContacts] = useState<ContactUser[]>([]);
  const [incoming, setIncoming] = useState<RequestItem[]>([]);
  const [outgoing, setOutgoing] = useState<RequestItem[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const activeRef = useRef<string | null>(null);
  const userRef = useRef(user);
  const convsRef = useRef(conversations);
  const msgsRef = useRef(messages);
  userRef.current = user;
  convsRef.current = conversations;
  msgsRef.current = messages;

  const reloadConversations = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        api<{ conversations: Conversation[] }>("/conversations?archived=false"),
        api<{ conversations: Conversation[] }>("/conversations?archived=true"),
      ]);
      setConversations(sortConvs([...a.conversations, ...b.conversations]));
      setConvError(null);
    } catch (e) {
      setConvError(errorMessage(e));
    } finally {
      setLoaded(true);
    }
  }, []);
  const reloadContacts = useCallback(async () => {
    try { setContacts((await api<{ contacts: ContactUser[] }>("/contacts")).contacts); } catch { /* shown on the contacts page via retry */ }
  }, []);
  const reloadRequests = useCallback(async () => {
    try {
      const r = await api<{ incoming: RequestItem[]; outgoing: RequestItem[] }>("/contacts/requests");
      setIncoming(r.incoming); setOutgoing(r.outgoing);
    } catch { /* ignore */ }
  }, []);

  const upsertMessage = useCallback((m: Message) => {
    setMessages((prev) => {
      const list = prev[m.conversationId];
      if (!list) return prev;
      const i = list.findIndex((x) => x.id === m.id || x.clientId === m.clientId);
      const next = i >= 0 ? list.map((x, idx) => (idx === i ? { ...m } : x)) : [...list, m];
      next.sort(cmp);
      return { ...prev, [m.conversationId]: next };
    });
  }, []);
  const patchMessage = useCallback((conversationId: string, id: string, patch: Partial<Message>) => {
    setMessages((prev) => (prev[conversationId] ? { ...prev, [conversationId]: prev[conversationId]!.map((m) => (m.id === id ? { ...m, ...patch } : m)) } : prev));
  }, []);

  const loadMessages = useCallback(async (id: string, mode: "latest" | "older") => {
    const cur = msgsRef.current[id] ?? [];
    const oldest = cur.find((m) => m.status !== "pending" && m.status !== "failed");
    const qs = mode === "older" && oldest ? `?before=${oldest.id}&limit=50` : "?limit=50";
    const data = await api<{ messages: Message[]; hasMore: boolean }>(`/conversations/${id}/messages${qs}`);
    setMessages((prev) => {
      const existing = prev[id] ?? [];
      const map = new Map<string, Message>();
      for (const m of existing) if (m.status !== "pending" && m.status !== "failed") map.set(m.id, m);
      for (const m of data.messages) map.set(m.id, m);
      const arr = [...map.values()];
      for (const l of existing) if ((l.status === "pending" || l.status === "failed") && !arr.some((m) => m.clientId === l.clientId)) arr.push(l);
      arr.sort(cmp);
      return { ...prev, [id]: arr };
    });
    if (mode === "older" || cur.length === 0) setHasMore((p) => ({ ...p, [id]: data.hasMore }));
  }, []);

  const markRead = useCallback(async (id: string) => {
    const c = convsRef.current.find((x) => x.id === id);
    if (!c || c.unreadCount === 0) return;
    setConversations((prev) => prev.map((x) => (x.id === id ? { ...x, unreadCount: 0 } : x)));
    try { await emitAck(socketRef.current, "message:read", { conversationId: id }); }
    catch { await api(`/conversations/${id}/read`, { method: "POST" }).catch(() => undefined); }
  }, []);
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;

  const transmit = useCallback(async (m: Message) => {
    patchMessage(m.conversationId, m.id, { status: "pending", error: undefined });
    try {
      const res = await emitAck<{ message: Message }>(socketRef.current, "message:send", {
        conversationId: m.conversationId, clientId: m.clientId, body: m.body, replyToId: m.replyTo?.id ?? null,
      });
      upsertMessage(res.message);
    } catch (e) {
      patchMessage(m.conversationId, m.id, { status: "failed", error: errorMessage(e), permanent: Boolean((e as { permanent?: boolean }).permanent) });
    }
  }, [patchMessage, upsertMessage]);
  const transmitRef = useRef(transmit);
  transmitRef.current = transmit;

  const send = useCallback((conversationId: string, body: string, replyTo: Message | null) => {
    const me = userRef.current;
    if (!me) return;
    const clientId = crypto.randomUUID(); // idempotency key: retries can't create duplicates
    const m: Message = {
      id: clientId, clientId, conversationId, senderId: me.id, body, createdAt: new Date().toISOString(), deletedAt: null, status: "pending",
      replyTo: replyTo ? { id: replyTo.id, senderId: replyTo.senderId, body: replyTo.body, deleted: replyTo.deletedAt !== null } : null,
    };
    setMessages((prev) => ({ ...prev, [conversationId]: [...(prev[conversationId] ?? []), m] }));
    void transmit(m);
  }, [transmit]);
  const retry = useCallback((m: Message) => void transmit(m), [transmit]);

  const remove = useCallback(async (m: Message, scope: "me" | "all") => {
    if (m.status === "failed" || m.status === "pending") {
      setMessages((prev) => ({ ...prev, [m.conversationId]: (prev[m.conversationId] ?? []).filter((x) => x.id !== m.id) }));
      return;
    }
    await api(`/conversations/${m.conversationId}/messages/${m.id}?scope=${scope}`, { method: "DELETE" });
  }, []);

  const setTyping = useCallback((id: string, isTyping: boolean) => {
    socketRef.current?.volatile.emit("typing", { conversationId: id, isTyping });
  }, []);
  const setActive = useCallback((id: string | null) => { activeRef.current = id; }, []);

  const patchConversation = useCallback(async (id: string, patch: Partial<Pick<Conversation, "pinned" | "archived" | "muted">>) => {
    const r = await api<{ conversation: Conversation }>(`/conversations/${id}`, { method: "PATCH", body: patch });
    setConversations((prev) => sortConvs(prev.map((c) => (c.id === id ? r.conversation : c))));
  }, []);

  // Socket lifecycle: one authenticated connection per signed-in user.
  useEffect(() => {
    if (!user) {
      setConversations([]); setMessages({}); setHasMore({}); setContacts([]); setIncoming([]); setOutgoing([]); setLoaded(false);
      return;
    }
    void reloadConversations(); void reloadContacts(); void reloadRequests();
    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    const timers: Record<string, number> = {};
    let reloadTimer: number | undefined;
    const scheduleReload = () => { window.clearTimeout(reloadTimer); reloadTimer = window.setTimeout(() => void reloadConversations(), 250); };

    const resync = () => {
      // After (re)connecting: refetch lists + the open conversation, then resend anything that failed while offline.
      void reloadConversations(); void reloadContacts(); void reloadRequests();
      const active = activeRef.current;
      if (active) void loadMessages(active, "latest").catch(() => undefined);
      for (const list of Object.values(msgsRef.current)) for (const m of list) if (m.status === "failed" && !m.permanent) void transmitRef.current(m);
    };
    socket.on("connect", () => { setConnection("online"); resync(); });
    socket.on("disconnect", () => setConnection("offline"));
    socket.io.on("reconnect_attempt", () => setConnection("connecting"));
    socket.on("connect_error", (err) => {
      setConnection("offline");
      if (err.message === "unauthorized") clear(); // session ended on the server
    });

    socket.on("message:new", (m: Message) => {
      upsertMessage(m);
      const me = userRef.current!;
      const mine = m.senderId === me.id;
      const conv = convsRef.current.find((c) => c.id === m.conversationId);
      if (!conv) { scheduleReload(); return; }
      const viewing = activeRef.current === conv.id && document.visibilityState === "visible";
      setConversations((prev) => sortConvs(prev.map((c) => (c.id === conv.id
        ? { ...c, lastMessage: m, lastMessageAt: m.createdAt, archived: mine ? c.archived : false, unreadCount: mine || viewing ? c.unreadCount : c.unreadCount + 1 }
        : c))));
      if (mine) return;
      if (viewing) { window.setTimeout(() => void markReadRef.current(conv.id), 0); return; }
      if (conv.muted) return;
      const prefs = me.notifications;
      if (prefs.soundEnabled) beep();
      if (prefs.desktopEnabled && "Notification" in window && Notification.permission === "granted" && document.visibilityState === "hidden") {
        new Notification(conv.other.displayName, { body: prefs.previewsEnabled ? (m.body ?? "") : "New message", tag: conv.id });
      }
    });
    socket.on("message:deleted", (e: { conversationId: string; messageId: string; scope: "me" | "all" }) => {
      setMessages((prev) => {
        const list = prev[e.conversationId];
        if (!list) return prev;
        return { ...prev, [e.conversationId]: e.scope === "me" ? list.filter((m) => m.id !== e.messageId) : list.map((m) => (m.id === e.messageId ? { ...m, body: null, deletedAt: new Date().toISOString() } : m)) };
      });
      scheduleReload();
    });
    socket.on("message:read", (e: { conversationId: string; readerId: string; messageIds: string[] }) => {
      if (e.readerId === userRef.current?.id) {
        setConversations((prev) => prev.map((c) => (c.id === e.conversationId ? { ...c, unreadCount: 0 } : c)));
        return;
      }
      const ids = new Set(e.messageIds);
      setMessages((prev) => (prev[e.conversationId] ? { ...prev, [e.conversationId]: prev[e.conversationId]!.map((m) => (ids.has(m.id) && m.status === "sent" ? { ...m, status: "read" } : m)) } : prev));
    });
    socket.on("typing", (e: { conversationId: string; isTyping: boolean }) => {
      window.clearTimeout(timers[e.conversationId]);
      setTypingState((p) => ({ ...p, [e.conversationId]: e.isTyping }));
      if (e.isTyping) timers[e.conversationId] = window.setTimeout(() => setTypingState((p) => ({ ...p, [e.conversationId]: false })), 5000);
    });
    socket.on("presence", (e: { userId: string; online: boolean; lastSeenAt: string | null }) => {
      setConversations((prev) => prev.map((c) => (c.other.id === e.userId && c.other.presence ? { ...c, other: { ...c.other, presence: { online: e.online, lastSeenAt: e.lastSeenAt } } } : c)));
      setContacts((prev) => prev.map((c) => (c.id === e.userId && c.presence ? { ...c, presence: { online: e.online, lastSeenAt: e.lastSeenAt } } : c)));
    });
    socket.on("contact:request", (e: RequestItem) => { toast("info", `${e.user.displayName} (@${e.user.username}) wants to connect.`); void reloadRequests(); });
    socket.on("contact:request-removed", () => void reloadRequests());
    socket.on("contact:accepted", () => { toast("success", "You're now connected."); void reloadContacts(); void reloadRequests(); void reloadConversations(); });
    socket.on("contact:removed", () => { void reloadContacts(); void reloadConversations(); });
    socket.on("conversation:removed", (e: { conversationId: string }) => setConversations((prev) => prev.filter((c) => c.id !== e.conversationId)));

    const goOffline = () => setConnection("offline");
    const goOnline = () => { setConnection("connecting"); socket.connect(); };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    const onVisible = () => { const a = activeRef.current; if (a && document.visibilityState === "visible") void markReadRef.current(a); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      document.removeEventListener("visibilitychange", onVisible);
      Object.values(timers).forEach((t) => window.clearTimeout(t));
      window.clearTimeout(reloadTimer);
      socket.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const totalUnread = useMemo(() => conversations.filter((c) => !c.muted && !c.archived).reduce((n, c) => n + c.unreadCount, 0), [conversations]);

  const value: ChatApi = {
    conversations, conversationsLoaded, conversationsError, messages, hasMore, typing, connection, contacts, incoming, outgoing, totalUnread,
    reloadConversations, reloadContacts, reloadRequests, loadMessages, send, retry, remove, markRead, setTyping, setActive, patchConversation,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
