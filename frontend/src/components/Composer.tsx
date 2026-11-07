import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Reply, Send, Smile, X } from "lucide-react";
import type { Message } from "../lib/types";

const EMOJI = "😀 😂 😊 😍 🥰 😎 🤔 😢 😭 😡 👍 👎 👏 🙏 💪 🎉 🔥 ✨ ❤️ 💙 💯 ✅ ❌ 👀 🙌 🤝 😴 🤗 😅 🙂 😉 😇 🤯 🥳 😬 🙄 🤷 👋 ☕ 🍕 🎶 🌟 🚀 📌 💡 🌈 🍀 🎂".split(" ");

interface Props {
  disabled: boolean;
  disabledReason?: string;
  replyTo: Message | null;
  replyName: string;
  onCancelReply: () => void;
  onSend: (text: string) => void;
  onTyping: (isTyping: boolean) => void;
}

export default function Composer({ disabled, disabledReason, replyTo, replyName, onCancelReply, onSend, onTyping }: Props) {
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<number>();
  const lastTypingSent = useRef(0);

  useEffect(() => { if (replyTo) ta.current?.focus(); }, [replyTo]);
  useEffect(() => () => window.clearTimeout(typingTimer.current), []);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const submit = () => {
    const body = text.trim();
    if (!body || disabled) return;
    onSend(body);
    setText(""); setEmojiOpen(false);
    window.clearTimeout(typingTimer.current);
    onTyping(false); lastTypingSent.current = 0;
  };
  const onChange = (v: string) => {
    setText(v);
    const now = Date.now();
    if (now - lastTypingSent.current > 2500) { onTyping(true); lastTypingSent.current = now; }
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => { onTyping(false); lastTypingSent.current = 0; }, 3000);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
    if (e.key === "Escape") { setEmojiOpen(false); onCancelReply(); }
  };
  const insertEmoji = (emoji: string) => {
    const el = ta.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + emoji.length, start + emoji.length); });
  };

  if (disabled) return <p role="status" className="border-t border-line/10 p-4 text-center text-sm text-muted safe-b">{disabledReason}</p>;
  return (
    <div className="relative border-t border-line/10 p-3 safe-b">
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border-l-4 border-accent bg-bg0/30 px-3 py-2 text-sm">
          <Reply aria-hidden className="h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1"><p className="font-semibold">Replying to {replyName}</p><p className="truncate text-muted">{replyTo.body}</p></div>
          <button className="icon-btn !min-h-0 !min-w-0 p-1.5" onClick={onCancelReply} aria-label="Cancel reply"><X className="h-4 w-4" /></button>
        </div>
      )}
      {emojiOpen && (
        <div role="group" aria-label="Emoji picker" className="glass-float rise absolute bottom-full left-3 right-3 z-20 mb-2 grid max-h-44 grid-cols-8 gap-1 overflow-y-auto rounded-2xl p-2 sm:right-auto sm:w-80">
          {EMOJI.map((e) => <button key={e} type="button" className="min-h-touch rounded-xl text-xl hover:bg-line/15" onClick={() => insertEmoji(e)} aria-label={`Insert ${e}`}>{e}</button>)}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button type="button" className="icon-btn shrink-0" aria-label="Emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((o) => !o)}><Smile className="h-5 w-5" /></button>
        <label htmlFor="composer" className="sr-only">Message</label>
        <textarea id="composer" ref={ta} rows={1} value={text} maxLength={4000} placeholder="Write a message" onChange={(e) => onChange(e.target.value)} onKeyDown={onKey}
          className="input max-h-36 min-h-touch flex-1 resize-none py-2.5 leading-6" />
        <button type="button" className="btn-primary shrink-0 !px-3.5" onClick={submit} disabled={!text.trim()} aria-label="Send message"><Send aria-hidden className="h-5 w-5" /></button>
      </div>
    </div>
  );
}
