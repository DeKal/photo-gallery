import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearToken, getMe, getToken, login as apiLogin, setToken } from "./api";
import { REQUIRES_ADMIN, type Capability } from "./permissions";

// Runtime auth state. A single admin account gates curation and the worker
// functions; anonymous visitors browse read-only. The token lives in
// localStorage (see api.ts) and is validated against /auth/me on load so a
// stale/expired token silently drops back to anonymous.
interface AuthState {
  isAdmin: boolean;
  username: string | null;
  ready: boolean; // false until the initial /auth/me check settles
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    getMe()
      .then((me) => setUsername(me.username))
      .catch(() => clearToken())
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      isAdmin: username != null,
      username,
      ready,
      login: async (u, p) => {
        const res = await apiLogin(u, p);
        setToken(res.token);
        setUsername(res.username);
      },
      logout: () => {
        clearToken();
        setUsername(null);
      },
    }),
    [username, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx == null) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Whether the current user may use a capability: everyone when it doesn't
// require admin, otherwise only a signed-in admin. Gates UI controls in sync
// with the backend's permission map (see permissions.ts).
export function useCan(capability: Capability): boolean {
  const { isAdmin } = useAuth();
  return !REQUIRES_ADMIN[capability] || isAdmin;
}
