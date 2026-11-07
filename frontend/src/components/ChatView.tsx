import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, CheckCheck, Clock, Copy, Info, MoreHorizontal, Reply, Search, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { dayKey, dayLabel, formatTime, lastSeenText } from "../lib/format";
import type { Conversation, Message } from "../lib/types";
import Composer from "./Composer";
import { Avatar, ConfirmDialog, ErrorState, Spinner } from "./ui";

function StatusMark({ m }: { m: Message }) {
  if (m.status === "pending") return <span className="inline-flex items-center gap-1"><Clock aria-hidden className="h-3 w-3" />Sending…</span>;
  if (m.status === "failed") return <span className="inline-flex items-center gap-1 font-semibold"><AlertCircle aria-hidden className="h-3 w-3" />Not sent</span>;
  if (m.status === "read") return <span className="inline-flex items-center gap-1"><CheckCheck aria-hidden className="h-3.5 w-3.5" /><span className="sr-only">Read</span></span>;
  if (m.status === "sent") return <span className="inline-flex items-center gap-1"><Check aria-hidden className="h-3.5 w-3.5" /><span className="sr-only">Sent</span></span>;
  return null;
}

interface Props { conversation: Conversation; onToggleDetails: () => void }

export default function ChatView({ conversation, onToggleDetails }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const chat = useChat();
  const { messages, hasMore, typing, loadMessages, markRead, send, retry, remove, setTyping } = chat;
  const list = messages[conversation.id];
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ m: Message; scope: "me" | "all" } | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef(0);
  const loadingOlder = useRef(false);

  const load = useCallback(() => {
    setLoadError(null);
    loadMessages(conversation.id, "latest").catch((e) => setLoadError(errorMessage(e)));
  }, [conversation.id, loadMessages]);

  useEffect(() => { stick.current = true; setReplyTo(null); setSearching(false); setQuery(""); setResults(null); load(); }, [conversation.id, load]);
  useEffect(() => { if (conversation.unreadCount > 0 && document.visibilityState === "visible") void markRead(conversation.id); }, [conversation.id, conversation.unreadCount, markRead, list?.length]);

  // Keep the view pinned to the newest message unless the reader scrolled up; preserve position when older history loads.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (loadingOlder.current) { el.scrollTop += el.scrollHeight - prevHeight.current; loadingOlder.current = false; }
    else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [list]);

  useEffect(() => {
    if (!menuFor) return;
    const close = (e: Event) => { if (!(e.target as HTMLElement).closest("[data-menu]")) setMenuFor(null); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuFor(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [menuFor]);

  useEffect(() => {
    if (!searching || query.trim().length < 1) { setResults(null); return; }
    const t = window.setTimeout(() => {
      api<{ messages: Message[] }>(`/conversations/${conversation.id}/messages?q=${encodeURIComponent(query.trim())}&limit=50`)
        .then((r) => setResults(r.messages.reverse()))
        .catch((e) => toast("error", errorMessage(e)));
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, searching, conversation.id, toast]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const older = async () => {
    const el = scroller.current;
    if (!el) return;
    prevHeight.current = el.scrollHeight; loadingOlder.current = true;
    try { await loadMessages(conversation.id, "older"); } catch (e) { loadingOlder.current = false; toast("error", errorMessage(e)); }
  };

  const other = conversation.other;
  const findName = (id: string) => (id === user?.id ? "yourself" : other.displayName);
  const status = typing[conversation.id] ? "typing…" : lastSeenText(other.presence);
  const copy = async (m: Message) => {
    try { await navigator.clipboard.writeText(m.body ?? ""); toast("success", "Message copied."); }
    catch { toast("error", "Couldn't copy. Select the text and copy it manually."); }
    setMenuFor(null);
  };
  const doDelete = async () => {
    if (!confirm) return;
    try { await remove(confirm.m, confirm.scope); toast("success", confirm.scope === "all" ? "Message deleted for everyone." : "Message deleted for you."); }
    catch (e) { toast("error", errorMessage(e)); }
    setConfirm(null);
  };

  const renderMessage = (m: Message, i: number, arr: Message[]) => {
    const mine = m.senderId === user?.id;
    const showDay = i === 0 || dayKey(arr[i - 1]!.createdAt) !== dayKey(m.createdAt);
    const deleted = m.deletedAt !== null;
    return (
      <li key={m.id}>
        {showDay && <div className="my-3 flex justify-center"><span className="rounded-full bg-bg0/40 px-3 py-1 text-xs text-muted">{dayLabel(m.createdAt)}</span></div>}
        <div className={`group flex items-end gap-1 ${mine ? "flex-row-reverse" : ""}`}>
          <div className={`max-w-[82%] rounded-3xl px-4 py-2.5 sm:max-w-[70%] ${mine ? "bubble-me rounded-br-lg" : "bubble-them rounded-bl-lg"} ${m.status === "failed" ? "ring-2 ring-danger" : ""}`}>
            {m.replyTo && (
              <div className={`mb-1.5 rounded-xl border-l-4 px-2.5 py-1 text-xs ${mine ? "border-white/70 bg-black/20" : "border-accent bg-bg0/30"}`}>
                <p className="font-semibold">{findName(m.replyTo.senderId)}</p>
                <p className="line-clamp-2 break-words opacity-90">{m.replyTo.deleted || m.replyTo.body === null ? "Message deleted" : m.replyTo.body}</p>
              </div>
            )}
            {deleted ? <p className="italic opacity-80">This message was deleted</p> : <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body}</p>}
            <div className={`mt-1 flex items-center gap-2 text-[11px] ${mine ? "justify-end text-white/85" : "text-muted"}`}>
              <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>
              {mine && <StatusMark m={m} />}
            </div>
            {m.status === "failed" && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" role="alert">
                <span>{m.error ?? "Couldn't send."}</span>
                {!m.permanent && <button className="rounded-lg bg-white/20 px-2 py-1 font-semibold underline" onClick={() => retry(m)}>Retry</button>}
                <button className="rounded-lg bg-white/20 px-2 py-1 font-semibold" onClick={() => void remove(m, "me")}>Discard</button>
              </div>
            )}
          </div>
          {!deleted && m.status !== "pending" && m.status !== "failed" && (
            <div className="relative" data-menu>
              <button className="icon-btn opacity-70 focus:opacity-100 group-hover:opacity-100" aria-label="Message actions" aria-haspopup="menu" aria-expanded={menuFor === m.id} onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}><MoreHorizontal className="h-5 w-5" /></button>
              {menuFor === m.id && (
                <div role="menu" className={`glass-float rise absolute bottom-full z-20 mb-1 w-52 rounded-2xl p-1.5 ${mine ? "right-0" : "left-0"}`}>
                  <button role="menuitem" className="flex min-h-touch w-full items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-line/10" onClick={() => { setReplyTo(m); setMenuFor(null); }}><Reply className="h-4 w-4" />Reply</button>
                  <button role="menuitem" className="flex min-h-touch w-full items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-line/10" onClick={() => void copy(m)}><Copy className="h-4 w-4" />Copy text</button>
                  <button role="menuitem" className="flex min-h-touch w-full items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-line/10" onClick={() => { setConfirm({ m, scope: "me" }); setMenuFor(null); }}><Trash2 className="h-4 w-4" />Delete for me</button>
                  {mine && <button role="menuitem" className="flex min-h-touch w-full items-center gap-2 rounded-xl px-3 text-left text-sm text-danger hover:bg-danger/10" onClick={() => { setConfirm({ m, scope: "all" }); setMenuFor(null); }}><Trash2 className="h-4 w-4" />Delete for everyone</button>}
                </div>
              )}
            </div>
          )}
        </div>
      </li>
    );
  };

  const shown = searching && results ? results : list;
  return (
    <section aria-label={`Conversation with ${other.displayName}`} className="glass flex h-full min-h-0 flex-col md:rounded-3xl">
      <header className="flex items-center gap-1 border-b border-line/10 px-2 py-2 safe-t md:safe-t-0">
        <Link to="/chats" className="icon-btn md:hidden" aria-label="Back to conversations"><ArrowLeft className="h-5 w-5" /></Link>
        {searching ? (
          <>
            <label htmlFor="msg-search" className="sr-only">Search in this conversation</label>
            <input id="msg-search" autoFocus className="input mx-1 flex-1" placeholder="Search in this conversation" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} />
            <button className="icon-btn" aria-label="Close search" onClick={() => { setSearching(false); setQuery(""); setResults(null); }}><X className="h-5 w-5" /></button>
          </>
        ) : (
          <>
            <button className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-1 text-left hover:bg-line/10" onClick={onToggleDetails} aria-label={`Conversation details for ${other.displayName}`}>
              <Avatar name={other.displayName} color={other.avatarColor} size={40} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{other.displayName}</span>
                <span className={`block truncate text-xs ${typing[conversation.id] ? "text-accent" : "text-muted"}`} aria-live="polite">{status}</span>
              </span>
            </button>
            <button className="icon-btn" aria-label="Search in conversation" onClick={() => setSearching(true)}><Search className="h-5 w-5" /></button>
            <button className="icon-btn" aria-label="Conversation details" onClick={onToggleDetails}><Info className="h-5 w-5" /></button>
          </>
        )}
      </header>

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3" role="log" aria-label="Messages">
        {loadError ? <ErrorState message={loadError} onRetry={load} /> : !list ? <Spinner label="Loading messages" /> : (
          <>
            {!searching && hasMore[conversation.id] && <div className="mb-3 flex justify-center"><button className="btn-ghost !min-h-[2.25rem] text-xs" onClick={() => void older()}>Load earlier messages</button></div>}
            {searching && query && results?.length === 0 && <p className="p-6 text-center text-sm text-muted">No messages match “{query}”.</p>}
            {!searching && list.length === 0 && <p className="p-8 text-center text-sm text-muted">No messages yet. Say hello to {other.displayName}!</p>}
            <ul className="space-y-1.5">{(shown ?? []).map(renderMessage)}</ul>
          </>
        )}
      </div>

      <Composer
        disabled={!conversation.canMessage}
        disabledReason="You can't message this person. They may have been removed from your contacts or blocked."
        replyTo={replyTo} replyName={replyTo ? findName(replyTo.senderId) : ""} onCancelReply={() => setReplyTo(null)}
        onSend={(body) => { stick.current = true; send(conversation.id, body, replyTo); setReplyTo(null); }}
        onTyping={(t) => setTyping(conversation.id, t)}
      />
      {confirm && (
        <ConfirmDialog
          title={confirm.scope === "all" ? "Delete for everyone?" : "Delete for you?"}
          message={confirm.scope === "all" ? "This removes the message for both of you. It can't be undone." : "The message is removed from your view only. The other person still sees it."}
          confirmLabel="Delete" danger onConfirm={() => void doDelete()} onCancel={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
