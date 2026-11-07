import { useCallback, useEffect, useState } from "react";
import { Ban, Check, MessageSquare, Search, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Avatar, ConfirmDialog, EmptyState, ErrorState, Spinner } from "../components/ui";
import { useChat } from "../context/ChatContext";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { lastSeenText } from "../lib/format";
import type { Conversation, PublicUser, SearchUser } from "../lib/types";

type Tab = "contacts" | "requests" | "find" | "blocked";

function Person({ user, sub, children }: { user: PublicUser; sub?: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl bg-bg0/20 p-3">
      <Avatar name={user.displayName} color={user.avatarColor} />
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate font-semibold">{user.displayName}</p>
        <p className="truncate text-sm text-muted">@{user.username}{sub ? ` · ${sub}` : ""}</p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  );
}

export default function ContactsPage() {
  const chat = useChat();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("contacts");
  const [confirm, setConfirm] = useState<{ kind: "remove" | "block"; user: PublicUser } | null>(null);
  const [blocked, setBlocked] = useState<PublicUser[] | null>(null);
  const [blockedErr, setBlockedErr] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchUser[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [searchErr, setSearchErr] = useState("");
  const [searching, setSearching] = useState(false);

  const loadBlocked = useCallback(() => {
    setBlockedErr("");
    api<{ blocked: PublicUser[] }>("/blocks").then((r) => setBlocked(r.blocked)).catch((e) => setBlockedErr(errorMessage(e)));
  }, []);
  useEffect(() => { if (tab === "blocked") loadBlocked(); }, [tab, loadBlocked]);

  const runSearch = useCallback(async (term: string, after?: string | null) => {
    setSearching(true); setSearchErr("");
    try {
      const r = await api<{ users: SearchUser[]; nextCursor: string | null }>(`/users/search?q=${encodeURIComponent(term)}${after ? `&cursor=${encodeURIComponent(after)}` : ""}`);
      setResults((prev) => (after && prev ? [...prev, ...r.users] : r.users));
      setCursor(r.nextCursor);
    } catch (e) { setSearchErr(errorMessage(e)); } finally { setSearching(false); }
  }, []);
  useEffect(() => {
    if (tab !== "find") return;
    if (q.trim().length < 3) { setResults(null); setSearchErr(""); return; }
    const t = window.setTimeout(() => void runSearch(q.trim()), 350);
    return () => window.clearTimeout(t);
  }, [q, tab, runSearch]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast("success", ok); } catch (e) { toast("error", errorMessage(e)); }
  };
  const openChat = (userId: string) => act(async () => {
    const r = await api<{ conversation: Conversation }>("/conversations", { method: "POST", body: { userId } });
    await chat.reloadConversations();
    nav(`/chats/${r.conversation.id}`);
  }, "Chat opened.");
  const addUser = (u: SearchUser) => act(async () => {
    const r = await api<{ status: string }>("/contacts/requests", { method: "POST", body: { username: u.username } });
    setResults((p) => p?.map((x) => (x.id === u.id ? { ...x, relationship: r.status === "accepted" ? "contact" : "request_sent" } : x)) ?? p);
    await Promise.all([chat.reloadRequests(), chat.reloadContacts(), chat.reloadConversations()]);
  }, "Contact request sent.");
  const accept = (id: string) => act(async () => { await api(`/contacts/requests/${id}/accept`, { method: "POST" }); await Promise.all([chat.reloadRequests(), chat.reloadContacts(), chat.reloadConversations()]); }, "Contact added.");
  const decline = (id: string) => act(async () => { await api(`/contacts/requests/${id}/decline`, { method: "POST" }); await chat.reloadRequests(); }, "Request declined.");
  const cancel = (id: string) => act(async () => { await api(`/contacts/requests/${id}`, { method: "DELETE" }); await chat.reloadRequests(); }, "Request cancelled.");
  const doConfirm = async () => {
    if (!confirm) return;
    const { kind, user } = confirm;
    await act(async () => {
      if (kind === "remove") await api(`/contacts/${user.id}`, { method: "DELETE" });
      else await api("/blocks", { method: "POST", body: { userId: user.id } });
      await Promise.all([chat.reloadContacts(), chat.reloadConversations(), chat.reloadRequests()]);
    }, kind === "remove" ? `${user.displayName} removed from contacts.` : `${user.displayName} blocked.`);
    setConfirm(null);
  };
  const unblock = (u: PublicUser) => act(async () => { await api(`/blocks/${u.id}`, { method: "DELETE" }); loadBlocked(); }, `${u.displayName} unblocked.`);

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "contacts", label: "Contacts" }, { id: "requests", label: "Requests", badge: chat.incoming.length }, { id: "find", label: "Find people" }, { id: "blocked", label: "Blocked" },
  ];
  return (
    <section aria-label="Contacts" className="glass flex h-full min-h-0 flex-col md:rounded-3xl">
      <header className="px-4 pb-2 pt-4 safe-t"><h1 className="text-xl font-bold tracking-tight">Contacts</h1></header>
      <div role="tablist" aria-label="Contact sections" className="mx-4 flex gap-1 overflow-x-auto rounded-2xl bg-bg0/30 p-1">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`min-h-[2.5rem] shrink-0 grow rounded-xl px-3 text-sm font-medium ${tab === t.id ? "bg-panel text-ink shadow" : "text-muted"}`}>
            {t.label}{t.badge ? <span className="ml-1.5 rounded-full bg-strong px-1.5 text-xs font-bold text-white">{t.badge}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {tab === "contacts" && (chat.contacts.length === 0 ? (
          <EmptyState icon={<Users className="h-7 w-7" />} title="No contacts yet">Use <button className="text-accent underline" onClick={() => setTab("find")}>Find people</button> to search by username and send a request.</EmptyState>
        ) : (
          <ul className="space-y-2">{chat.contacts.map((c) => (
            <Person key={c.id} user={c} sub={lastSeenText(c.presence) || undefined}>
              <button className="btn-primary" onClick={() => void openChat(c.id)}><MessageSquare aria-hidden className="h-4 w-4" />Message<span className="sr-only"> {c.username}</span></button>
              <button className="icon-btn" aria-label={`Remove ${c.username} from contacts`} onClick={() => setConfirm({ kind: "remove", user: c })}><UserMinus className="h-5 w-5" /></button>
              <button className="icon-btn text-danger" aria-label={`Block ${c.username}`} onClick={() => setConfirm({ kind: "block", user: c })}><Ban className="h-5 w-5" /></button>
            </Person>
          ))}</ul>
        ))}

        {tab === "requests" && (
          <div className="space-y-6">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-muted">Received</h2>
              {chat.incoming.length === 0 ? <p className="text-sm text-muted">No pending requests.</p> : (
                <ul className="space-y-2">{chat.incoming.map((r) => (
                  <Person key={r.id} user={r.user}>
                    <button className="btn-primary" aria-label={`Accept ${r.user.username}`} onClick={() => void accept(r.id)}><Check aria-hidden className="h-4 w-4" />Accept</button>
                    <button className="btn-ghost" aria-label={`Decline ${r.user.username}`} onClick={() => void decline(r.id)}><X aria-hidden className="h-4 w-4" />Decline</button>
                  </Person>
                ))}</ul>
              )}
            </div>
            <div>
              <h2 className="mb-2 text-sm font-semibold text-muted">Sent</h2>
              {chat.outgoing.length === 0 ? <p className="text-sm text-muted">You haven't sent any requests.</p> : (
                <ul className="space-y-2">{chat.outgoing.map((r) => (
                  <Person key={r.id} user={r.user} sub="Waiting for reply">
                    <button className="btn-ghost" aria-label={`Cancel request to ${r.user.username}`} onClick={() => void cancel(r.id)}>Cancel</button>
                  </Person>
                ))}</ul>
              )}
            </div>
          </div>
        )}

        {tab === "find" && (
          <div>
            <label htmlFor="user-search" className="mb-1.5 block text-sm font-medium">Search by username or display name</label>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input id="user-search" className="input pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="At least 3 characters" maxLength={50} autoComplete="off" />
            </div>
            <div className="mt-4" aria-live="polite">
              {searchErr ? <ErrorState message={searchErr} onRetry={() => void runSearch(q.trim())} /> : searching && !results ? <Spinner label="Searching" /> : results && results.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted">No one found for “{q}”. Check the spelling of their username.</p>
              ) : results ? (
                <>
                  <ul className="space-y-2">{results.map((u) => (
                    <Person key={u.id} user={u}>
                      {u.relationship === "contact" ? <span className="text-sm text-muted">Already a contact</span>
                        : u.relationship === "request_sent" ? <span className="text-sm text-muted">Request sent</span>
                        : u.relationship === "request_received" ? <button className="btn-ghost" onClick={() => setTab("requests")}>Respond in Requests</button>
                        : <button className="btn-primary" aria-label={`Add ${u.username}`} onClick={() => void addUser(u)}><UserPlus aria-hidden className="h-4 w-4" />Add</button>}
                    </Person>
                  ))}</ul>
                  {cursor && <div className="mt-3 text-center"><button className="btn-ghost" disabled={searching} onClick={() => void runSearch(q.trim(), cursor)}>Show more</button></div>}
                </>
              ) : <p className="p-4 text-center text-sm text-muted">Search is limited to usernames and display names. Email addresses are never shown.</p>}
            </div>
          </div>
        )}

        {tab === "blocked" && (blockedErr ? <ErrorState message={blockedErr} onRetry={loadBlocked} /> : !blocked ? <Spinner /> : blocked.length === 0 ? (
          <EmptyState icon={<Ban className="h-7 w-7" />} title="No blocked users">People you block can't message you or find you in search.</EmptyState>
        ) : (
          <ul className="space-y-2">{blocked.map((u) => <Person key={u.id} user={u}><button className="btn-ghost" onClick={() => void unblock(u)}>Unblock<span className="sr-only"> {u.username}</span></button></Person>)}</ul>
        ))}
      </div>
      {confirm && (
        <ConfirmDialog danger title={confirm.kind === "remove" ? `Remove ${confirm.user.displayName}?` : `Block ${confirm.user.displayName}?`} confirmLabel={confirm.kind === "remove" ? "Remove" : "Block"}
          message={confirm.kind === "remove" ? "You'll no longer be able to message each other until you reconnect. Your message history stays." : "They won't be able to message you or find you. You'll also be removed from each other's contacts."}
          onCancel={() => setConfirm(null)} onConfirm={() => void doConfirm()} />
      )}
    </section>
  );
}
