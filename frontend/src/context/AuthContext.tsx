import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setCsrf, setUnauthorizedHandler } from "../lib/api";
import type { Self } from "../lib/types";

interface AuthState {
  user: Self | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: { username: string; email: string; displayName?: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: Self) => void;
  clear: () => void;
}
const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside provider");
  return v;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Self | null>(null);
  const [loading, setLoading] = useState(true);
  const clear = useCallback(() => { setCsrf(""); setUser(null); }, []);

  useEffect(() => {
    setUnauthorizedHandler(clear); // any 401 (expired/invalid session) returns the app to the sign-in screen
    api<{ user: Self; csrfToken: string }>("/auth/me")
      .then((r) => { setCsrf(r.csrfToken); setUser(r.user); })
      .catch(() => clear())
      .finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  const value = useMemo<AuthState>(() => ({
    user, loading, setUser, clear,
    login: async (identifier, password) => {
      const r = await api<{ user: Self; csrfToken: string }>("/auth/login", { method: "POST", body: { identifier, password } });
      setCsrf(r.csrfToken); setUser(r.user);
    },
    register: async (input) => {
      const r = await api<{ user: Self; csrfToken: string }>("/auth/register", { method: "POST", body: input });
      setCsrf(r.csrfToken); setUser(r.user);
    },
    logout: async () => {
      try { await api("/auth/logout", { method: "POST" }); } finally { clear(); }
    },
  }), [user, loading, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
