import { createContext, useContext, useEffect, useState, useCallback } from "react";

const SessionCtx = createContext(null);

// All API access funnels through here: same-origin cookies carry the session,
// the server is the only authority on who you are.
export async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let body = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export function SessionProvider({ children }) {
  // session: null (signed out) | { user, artist } | undefined (loading)
  const [session, setSession] = useState(undefined);
  const [toast, setToast] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setSession(await api("/api/me"));
    } catch (e) {
      setSession(e.status === 401 ? null : null);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const notify = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), 3600);
  }, []);

  return (
    <SessionCtx.Provider value={{ session, refresh, notify }}>
      {children}
      {toast && <div className={`toast ${toast.kind === "err" ? "err" : ""}`}>{toast.msg}</div>}
    </SessionCtx.Provider>
  );
}

export const useSession = () => useContext(SessionCtx);
