import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { Empty, SignInLink } from "../ui.jsx";

const KIND_TAG = { jam: "Jam session", vibe: "Live — need audience", hangout: "Hangout" };

const fmtDate = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

export default function JamDetail() {
  const { token } = useParams();
  const nav = useNavigate();
  const { session, notify } = useSession();
  const [view, setView] = useState(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    api(`/api/jams/${token}`)
      .then(setView)
      .catch((e) => (e.status === 404 ? setMissing(true) : notify(e.message, "err")));
  }, [token, notify]);

  useEffect(() => { load(); }, [load]);

  if (missing) {
    return (
      <div className="wrap section" style={{ maxWidth: 620 }}>
        <Empty icon="🔍" title="Jam not found">
          It may have been cancelled or has already happened.
        </Empty>
        <div className="center mt-2">
          <button className="btn btn-primary" onClick={() => nav("/jams")}>Browse other jams</button>
        </div>
      </div>
    );
  }
  if (!view) return <div className="wrap section"><div className="skeleton" style={{ height: 260 }} /></div>;

  const jam = view.jam;
  const isHost = session?.user && jam.host_id === session.user.id;
  const share = view.share_url || `${window.location.origin}/jam/${token}`;

  const act = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) notify(okMsg);
      load();
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const join = () => act(async () => {
    const r = await api(`/api/jams/${token}/rsvp`, { method: "POST", body: "{}" });
    notify(r.joined ? "You're in! ✓" : "Left the jam.");
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(share);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* denied */ }
  };

  return (
    <div className="wrap section" style={{ maxWidth: 720 }}>
      <div className="row between wrapline" style={{ gap: 8 }}>
        <span className="tag">{fmtDate(jam.date)} · {jam.start_time}</span>
        <span className={`badge ${jam.live ? "badge-new" : "badge-verified"}`}>
          {jam.status === "cancelled" ? "Cancelled" : jam.status === "expired" ? "Ended" : jam.live ? "🔴 Live now" : KIND_TAG[jam.kind] || "Jam"}
        </span>
      </div>

      <h2 className="mt-2">{jam.title}</h2>
      <p className="muted">
        {[jam.venue, jam.area, jam.city].filter(Boolean).join(", ")}
        {jam.host_name ? ` · hosted by ${jam.host_name}` : ""}
      </p>

      <div className="kpi-grid mt-2">
        <div className="kpi"><div className="n">{Number(jam.going_count) || 0}/{jam.capacity}</div><div className="l">going</div></div>
        <div className="kpi"><div className="n">{Number(jam.broadcasts) || 0}</div><div className="l">broadcasts</div></div>
        <div className="kpi"><div className="n">Free</div><div className="l">always</div></div>
      </div>

      {jam.genres && <p className="small muted mt-2"><strong>Vibe:</strong> {jam.genres}</p>}
      {jam.instruments && <p className="small muted"><strong>Bring / needed:</strong> {jam.instruments}</p>}
      {jam.description && <p className="mt-2">{jam.description}</p>}

      <div className="card mt-2 stack" style={{ gap: 8 }}>
        <strong>Who's coming</strong>
        <div className="row wrapline" style={{ gap: 6 }}>
          {view.attendees.length ? view.attendees.map((n, i) => <span key={i} className="tag">{n}</span>) : (
            <span className="small muted">Nobody yet — be the first.</span>
          )}
        </div>
      </div>

      <div className="row wrapline mt-3" style={{ gap: 8 }}>
        {["open", "full"].includes(jam.status) && jam.status !== "expired" && (
          session?.user ? (
            <button className={`btn ${jam.joined ? "btn-ghost" : "btn-primary"}`} disabled={busy || jam.status === "full"} onClick={join}>
              {jam.joined ? "✓ Going — leave" : jam.status === "full" ? "Full" : "I'm in"}
            </button>
          ) : (
            <SignInLink returnTo={`/jam/${token}`} className="btn btn-primary">Sign in to join</SignInLink>
          )
        )}
        <button className="btn btn-ghost" onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>
        {isHost && jam.date === new Date().toISOString().slice(0, 10) && jam.status === "open" && (
          <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api(`/api/jams/${token}/broadcast`, { method: "POST", body: "{}" }), "Broadcast sent — attendees and subscribers alerted.")}>
            🔴 Broadcast live
          </button>
        )}
        {isHost && ["open", "full"].includes(jam.status) && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => act(() => api(`/api/jams/${token}/cancel`, { method: "POST", body: "{}" }), "Jam cancelled.")}>
            Cancel jam
          </button>
        )}
      </div>

      <p className="small muted mt-3">
        Jam Circles are free by design — no booking, no escrow, no commission. If the vibe turns into
        a real gig, take it to <a href="/need" style={{ textDecoration: "underline" }}>a proper gig request</a>.
      </p>
    </div>
  );
}
