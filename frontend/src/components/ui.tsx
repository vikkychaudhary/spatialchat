import { useEffect, useRef, type ReactNode } from "react";
import { AlertCircle, Loader2, WifiOff } from "lucide-react";
import { initials } from "../lib/format";
import { useChat } from "../context/ChatContext";

export function Avatar({ name, color, size = 44 }: { name: string; color: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, ${color}, rgb(40 30 110))`, boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.3), 0 4px 10px -4px rgb(0 0 0 / 0.5)" }}
    >
      {initials(name)}
    </span>
  );
}

export const Spinner = ({ label = "Loading" }: { label?: string }) => (
  <div role="status" className="flex items-center justify-center gap-2 p-8 text-muted">
    <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> <span>{label}…</span>
  </div>
);

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div aria-hidden className="glass flex h-16 w-16 items-center justify-center rounded-3xl text-accent">{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="max-w-xs text-sm text-muted">{children}</div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 p-8 text-center">
      <AlertCircle aria-hidden className="h-8 w-8 text-danger" />
      <p className="text-sm"><span className="font-semibold">Error: </span>{message}</p>
      {onRetry && <button className="btn-ghost" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function ConnectionBanner() {
  const { connection } = useChat();
  if (connection === "online") return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-strong/90 px-3 py-1.5 text-center text-xs font-medium text-white safe-t">
      <WifiOff aria-hidden className="h-4 w-4" />
      {connection === "connecting" ? "Reconnecting…" : "You're offline. Messages will send when you reconnect."}
    </div>
  );
}

interface ConfirmProps {
  title: string; message: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; children?: ReactNode;
  onConfirm: () => void; onCancel: () => void;
}
export function ConfirmDialog({ title, message, confirmLabel, danger, busy, children, onConfirm, onCancel }: ConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg" className="glass-float rise w-full max-w-sm rounded-3xl p-5 safe-b">
        <h2 id="dlg-title" className="text-lg font-semibold">{title}</h2>
        <div id="dlg-msg" className="mt-2 text-sm text-muted">{message}</div>
        {children}
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={danger ? "btn-danger" : "btn-primary"} disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function Field({ label, id, error, hint, ...props }: { label: string; id: string; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      <input id={id} className="input" aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} {...props} />
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-danger"><span className="font-semibold">Error: </span>{error}</p>}
    </div>
  );
}
