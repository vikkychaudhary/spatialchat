import { useMemo, useState } from "react";
import { BellOff, MessageSquarePlus, Pin, Search } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useChat } from "../context/ChatContext";
import { formatListTime } from "../lib/format";
import { Avatar, EmptyState, ErrorState, Spinner } from "./ui";
import { useAuth } from "../context/AuthContext";

export default function ConversationList() {
  const { id: activeId } = useParams();
  const { user } = useAuth();
  const { conversations, conversationsLoaded, conversationsError, reloadConversations, typing } = useChat();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"active" | "archived">("active");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return conversations.filter((c) => {
      if (c.archived !== (tab === "archived")) return false;
      if (!needle) return true;
      return c.other.displayName.toLowerCase().includes(needle) || c.other.username.includes(needle) || (c.lastMessage?.body ?? "").toLowerCase().includes(needle);
    });
  }, [conversations, q, tab]);

  return (
    <section aria-label="Conversations" className="glass-recessed flex h-full min-h-0 flex-col md:rounded-3xl md:border md:border-line/10">
      <header className="flex items-center justify-between px-4 pb-2 pt-4 safe-t md:pt-4">
        <h1 className="text-xl font-bold tracking-tight">Chats</h1>
        <Link to="/contacts" className="icon-btn" aria-label="Start a new chat"><MessageSquarePlus className="h-5 w-5" /></Link>
      </header>
      <div className="px-4 pb-2">
        <label htmlFor="conv-search" className="sr-only">Search conversations</label>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input id="conv-search" className="input pl-10" placeholder="Search chats and messages" value={q} onChange={(e) => setQ(e.target.value)} maxLength={50} />
        </div>
        <div role="tablist" aria-label="Conversation filter" className="mt-3 flex gap-1 rounded-2xl bg-bg0/30 p-1">
          {(["active", "archived"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`min-h-[2.25rem] flex-1 rounded-xl text-sm font-medium capitalize ${tab === t ? "bg-panel text-ink shadow" : "text-muted"}`}>{t}</button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {!conversationsLoaded ? <Spinner label="Loading chats" /> : conversationsError ? (
          <ErrorState message={conversationsError} onRetry={() => void reloadConversations()} />
        ) : shown.length === 0 ? (
          q ? <EmptyState icon={<Search />} title="No matches">Try a different name or word.</EmptyState> :
          tab === "archived" ? <EmptyState icon={<Search />} title="Nothing archived">Archived chats appear here.</EmptyState> :
          <EmptyState icon={<MessageSquarePlus />} title="Start your first chat">
            Find a friend by username in <Link className="text-accent underline" to="/contacts">Contacts</Link>. Once they accept, your conversation shows up here.
          </EmptyState>
        ) : (
          <ul className="space-y-1">
            {shown.map((c) => {
              const last = c.lastMessage;
              const preview = typing[c.id] ? "typing…" : !last ? "No messages yet" : last.deletedAt ? "Message deleted" : `${last.senderId === user?.id ? "You: " : ""}${last.body ?? ""}`;
              return (
                <li key={c.id}>
                  <Link to={`/chats/${c.id}`} aria-current={activeId === c.id ? "page" : undefined}
                    className={`flex min-h-[4.25rem] items-center gap-3 rounded-2xl px-3 py-2 transition-all ${activeId === c.id ? "bg-strong/25 shadow-lg" : "hover:bg-line/10"}`}>
                    <div className="relative">
                      <Avatar name={c.other.displayName} color={c.other.avatarColor} />
                      {c.other.presence?.online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-bg0 bg-ok"><span className="sr-only">Online</span></span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-semibold">{c.other.displayName}</span>
                        <time className="shrink-0 text-xs text-muted" dateTime={c.lastMessageAt}>{last ? formatListTime(c.lastMessageAt) : ""}</time>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`truncate text-sm ${typing[c.id] ? "text-accent" : "text-muted"}`}>{preview}</span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          {c.pinned && <Pin aria-label="Pinned" className="h-3.5 w-3.5 text-muted" />}
                          {c.muted && <BellOff aria-label="Muted" className="h-3.5 w-3.5 text-muted" />}
                          {c.unreadCount > 0 && <span className="min-w-[1.35rem] rounded-full bg-strong px-1.5 text-center text-xs font-bold leading-[1.35rem] text-white"><span aria-hidden>{c.unreadCount > 99 ? "99+" : c.unreadCount}</span><span className="sr-only">{c.unreadCount} unread messages</span></span>}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
