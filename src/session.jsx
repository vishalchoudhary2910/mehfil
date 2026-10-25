import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

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
    // The probe itself is allowed to 401 quietly; any other 401 means the
    // session died mid-session, so the UI should stop pretending it is signed in.
    if (res.status === 401 && path !== "/api/me" && typeof window !== "undefined") {
      window.dispatchEvent(new Event("mehfil:unauthorized"));
    }
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
  const signedIn = useRef(false);

  const notify = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), 3600);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setSession(await api("/api/me"));
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { signedIn.current = !!session?.user; }, [session]);

  // Session hygiene without polling: drop to signed-out the moment any API
  // answers 401, and re-check once after the tab has been asleep for a minute
  // (cookies may have expired while the laptop lid was closed).
  useEffect(() => {
    let hiddenAt = 0;
    const onUnauthorized = () => {
      if (signedIn.current) notify("Your session expired — sign in again.", "err");
      setSession(null);
    };
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt > 60_000) refresh();
    };
    window.addEventListener("mehfil:unauthorized", onUnauthorized);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("mehfil:unauthorized", onUnauthorized);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [notify, refresh]);

  return (
    <SessionCtx.Provider value={{ session, refresh, notify }}>
      {children}
      {toast && <div className={`toast ${toast.kind === "err" ? "err" : ""}`} role="status">{toast.msg}</div>}
    </SessionCtx.Provider>
  );
}

export const useSession = () => useContext(SessionCtx);
