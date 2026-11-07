import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type Kind = "success" | "error" | "info";
interface Toast { id: number; kind: Kind; message: string }
interface ToastApi { toast: (kind: Kind, message: string) => void }

const Ctx = createContext<ToastApi>({ toast: () => undefined });
export const useToast = () => useContext(Ctx).toast;

const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
const labels = { success: "Success", error: "Error", info: "Notice" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setItems((p) => p.filter((t) => t.id !== id)), []);
  const toast = useCallback((kind: Kind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((p) => [...p.slice(-3), { id, kind, message }]);
    setTimeout(() => dismiss(id), kind === "error" ? 8000 : 4500);
  }, [dismiss]);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-3 safe-t">
        {items.map((t) => {
          const Icon = icons[t.kind];
          return (
            <div key={t.id} className="glass-float rise pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl p-3 text-sm">
              <Icon aria-hidden className={`mt-0.5 h-5 w-5 shrink-0 ${t.kind === "error" ? "text-danger" : t.kind === "success" ? "text-ok" : "text-accent"}`} />
              <p className="flex-1"><span className="font-semibold">{labels[t.kind]}: </span>{t.message}</p>
              <button className="icon-btn !min-h-0 !min-w-0 p-1" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}><X className="h-4 w-4" /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
