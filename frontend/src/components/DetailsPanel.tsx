import { useState } from "react";
import { Archive, ArchiveRestore, Ban, Bell, BellOff, Pin, PinOff, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useChat } from "../context/ChatContext";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { lastSeenText } from "../lib/format";
import type { Conversation } from "../lib/types";
import { Avatar, ConfirmDialog } from "./ui";

export default function DetailsPanel({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const { patchConversation, reloadConversations, reloadContacts } = useChat();
  const toast = useToast();
  const nav = useNavigate();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const o = conversation.other;

  const toggle = async (key: "pinned" | "archived" | "muted", label: string) => {
    try { await patchConversation(conversation.id, { [key]: !conversation[key] }); toast("success", `${label} updated.`); }
    catch (e) { toast("error", errorMessage(e)); }
  };
  const block = async () => {
    setBusy(true);
    try {
      await api("/blocks", { method: "POST", body: { userId: o.id } });
      toast("success", `${o.displayName} is blocked.`);
      await Promise.all([reloadConversations(), reloadContacts()]);
      nav("/chats");
    } catch (e) { toast("error", errorMessage(e)); } finally { setBusy(false); setConfirmBlock(false); }
  };
  const row = "flex min-h-touch w-full items-center gap-3 rounded-2xl px-3 text-left text-sm hover:bg-line/10";
  return (
    <aside aria-label="Conversation details" className="glass-float fixed inset-y-0 right-0 z-30 flex w-[min(22rem,100vw)] flex-col overflow-y-auto p-4 safe-t safe-b xl:glass xl:static xl:z-auto xl:w-80 xl:shrink-0 xl:rounded-3xl">
      <button className="icon-btn ml-auto xl:hidden" aria-label="Close details" onClick={onClose}><X className="h-5 w-5" /></button>
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <Avatar name={o.displayName} color={o.avatarColor} size={88} />
        <h2 className="text-xl font-bold">{o.displayName}</h2>
        <p className="text-sm text-muted">@{o.username}</p>
        {o.presence && <p className="text-xs text-muted">{lastSeenText(o.presence)}</p>}
        {o.status && <p className="mt-2 rounded-2xl bg-bg0/30 px-3 py-2 text-sm [overflow-wrap:anywhere]">{o.status}</p>}
      </div>
      <div className="space-y-1">
        <button className={row} aria-pressed={conversation.pinned} onClick={() => void toggle("pinned", "Pin")}>{conversation.pinned ? <PinOff className="h-5 w-5" /> : <Pin className="h-5 w-5" />}{conversation.pinned ? "Unpin conversation" : "Pin conversation"}</button>
        <button className={row} aria-pressed={conversation.muted} onClick={() => void toggle("muted", "Mute")}>{conversation.muted ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}{conversation.muted ? "Unmute notifications" : "Mute notifications"}</button>
        <button className={row} aria-pressed={conversation.archived} onClick={() => void toggle("archived", "Archive")}>{conversation.archived ? <ArchiveRestore className="h-5 w-5" /> : <Archive className="h-5 w-5" />}{conversation.archived ? "Move to chats" : "Archive conversation"}</button>
        <button className={`${row} text-danger`} onClick={() => setConfirmBlock(true)}><Ban className="h-5 w-5" />Block {o.displayName}</button>
      </div>
      {confirmBlock && (
        <ConfirmDialog title={`Block ${o.displayName}?`} danger busy={busy} confirmLabel="Block" onCancel={() => setConfirmBlock(false)} onConfirm={() => void block()}
          message="They won't be able to message you, find you in search or send you contact requests. You'll also be removed from each other's contacts." />
      )}
    </aside>
  );
}
