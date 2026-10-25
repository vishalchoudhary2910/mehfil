import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { Empty, SignInLink, qs, usePageMeta } from "../ui.jsx";

const KINDS = [
  ["", "All jams"],
  ["jam", "🎵 Jam sessions"],
  ["vibe", "🎤 Need an audience"],
  ["hangout", "☕ Just hanging"],
];
const KIND_TAG = {
  jam: "Jam session",
  vibe: "Live — need audience",
  hangout: "Hangout",
};

const fmtDate = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

const isToday = (d) => d === new Date().toISOString().slice(0, 10);

function JamCard({ jam, session, onJoin, onBroadcast, onCancel, busy }) {
  const [copied, setCopied] = useState(false);
  const isHost = session?.user && jam.host_id === session.user.id;
  const share = `${window.location.origin}/jam/${jam.token}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(share);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard denied */ }
  };

  return (
    <div className="card card-hover stack" style={{ gap: 8 }}>
      <div className="row between">
        <span className="tag">{fmtDate(jam.date)} · {jam.start_time}</span>
        <span className={`badge ${jam.live ? "badge-new" : "badge-verified"}`}>
          {jam.live ? "🔴 Live now" : KIND_TAG[jam.kind] || "Jam"}
        </span>
      </div>
      <h3 style={{ fontSize: "1.08rem" }}>{jam.title}</h3>
      <div className="small muted">
        {[jam.venue, jam.area, jam.city].filter(Boolean).join(", ")}
        {jam.host_name ? ` · hosted by ${jam.host_name}` : ""}
      </div>
      {jam.genres && <div className="small muted">Vibe: {jam.genres}</div>}
      {jam.instruments && <div className="small muted">Bring / needed: {jam.instruments}</div>}
      {jam.description && <p className="small muted" style={{ margin: 0 }}>{jam.description}</p>}
      <div className="row wrapline" style={{ gap: 6 }}>
        <span className="tag">{Number(jam.going) || 0}/{jam.capacity} going</span>
        {Number(jam.broadcasts) > 0 && <span className="tag">📣 broadcast {jam.broadcasts}×</span>}
        {jam.status === "full" && <span className="tag">Full</span>}
      </div>
      <div className="row wrapline" style={{ gap: 6 }}>
        {session?.user ? (
          <button
            className={`btn btn-sm ${jam.joined ? "btn-ghost" : "btn-primary"}`}
            disabled={busy || jam.status === "full"}
            onClick={() => onJoin(jam)}
          >
            {jam.joined ? "✓ Going — leave" : jam.status === "full" ? "Full" : "I'm in"}
          </button>
        ) : (
          <SignInLink returnTo="/jams" className="btn btn-sm">I'm in</SignInLink>
        )}
        <button className="btn btn-ghost btn-sm" onClick={copy}>{copied ? "Copied ✓" : "Share"}</button>
        {isHost && isToday(jam.date) && jam.status === "open" && (
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onBroadcast(jam)}>
            🔴 Broadcast live
          </button>
        )}
        {isHost && ["open", "full"].includes(jam.status) && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onCancel(jam)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export default function Jams() {
  usePageMeta(
    "Jam circles tonight — Mehfil",
    "Free, low-pressure jam sessions near you. Say what you play, show up, and play with people from your city."
  );
  const [params, setParams] = useSearchParams();
  const { session, notify } = useSession();
  const [jams, setJams] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [alertOn, setAlertOn] = useState(false);
  const [form, setForm] = useState({
    title: "", kind: "jam", city: session?.user?.city || "Pune", area: "", venue: "",
    date: "", start_time: "19:00", instruments: "", genres: "", description: "", capacity: 20,
  });

  const city = params.get("city") || "";
  const kind = params.get("kind") || "";

  const load = useCallback(() => {
    api(`/api/jams${qs({ city, kind })}`)
      .then((d) => setJams(d.jams))
      .catch(() => setJams([]));
  }, [city, kind]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (session?.user) {
      api("/api/alerts").then((d) => {
        setAlertOn((d.alerts || []).some((a) => a.kind === "jams" && (!city || a.city === city)));
      }).catch(() => {});
    }
  }, [session, city]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api("/api/jams", { method: "POST", body: JSON.stringify(form) });
      notify("Jam published to your city feed.");
      setOpen(false);
      setForm((f) => ({ ...f, title: "", instruments: "", genres: "", description: "" }));
      if (r.share_url) setTimeout(() => navigator.clipboard?.writeText(r.share_url).catch(() => {}), 100);
      await load();
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (err) { notify(err.message, "err"); }
    finally { setBusy(false); }
  };

  const join = (jam) => act(async () => {
    const r = await api(`/api/jams/${jam.token}/rsvp`, { method: "POST", body: "{}" });
    setJams((js) => js.map((j) => (j.token === jam.token
      ? { ...j, joined: r.joined, going: r.going, status: r.going >= j.capacity ? "full" : "open" }
      : j)));
    notify(r.joined ? "You're in! ✓" : "Left the jam.");
  });

  const broadcast = (jam) => act(async () => {
    await api(`/api/jams/${jam.token}/broadcast`, { method: "POST", body: "{}" });
    notify("Broadcast sent — nearby members and attendees were alerted.");
    await load();
  });

  const cancel = (jam) => act(async () => {
    await api(`/api/jams/${jam.token}/cancel`, { method: "POST", body: "{}" });
    notify("Jam cancelled.");
    await load();
  });

  const toggleAlert = async () => {
    if (!session?.user) return;
    setBusy(true);
    try {
      if (alertOn) {
        const d = await api("/api/alerts");
        const mine = (d.alerts || []).filter((a) => a.kind === "jams" && (!city || a.city === city));
        await Promise.all(mine.map((a) => api(`/api/alerts/${a.id}`, { method: "DELETE" })));
        setAlertOn(false);
        notify("Jam alerts off.");
      } else {
        await api("/api/alerts", { method: "POST", body: JSON.stringify({ kind: "jams", city, email: session.user.email }) });
        setAlertOn(true);
        notify(`We'll ping you${city ? ` about jams in ${city}` : ""} — new sessions and live broadcasts.`);
      }
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const createBtn = session?.user ? (
    <button className="btn btn-primary" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Host a jam"}</button>
  ) : (
    <SignInLink returnTo="/jams" className="btn btn-primary">Sign in to host</SignInLink>
  );

  return (
    <div className="wrap section" style={{ maxWidth: 940 }}>
      <div className="section-head">
        <div>
          <div className="kicker">Jam Circles — free, always</div>
          <h2>Jam tonight. No gig, no fee.</h2>
          <p className="muted mb-0" style={{ maxWidth: 560 }}>
            Acoustic circles, open decks, shayari nights, or just chilling with people who get it.
            Hosting a session and need bodies — hit <strong>Broadcast live</strong> and everyone
            nearby gets pinged.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select
            className="select"
            style={{ width: "auto" }}
            value={city}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              e.target.value ? next.set("city", e.target.value) : next.delete("city");
              setParams(next, { replace: true });
            }}
            aria-label="City"
          >
            <option value="">All cities</option>
            {["Pune", "Mumbai", "Jaipur"].map((c) => <option key={c}>{c}</option>)}
          </select>
          {createBtn}
        </div>
      </div>

      {open && (
        <form className="card form-grid mt-2" onSubmit={create}>
          <div className="field full">
            <label>Title *</label>
            <input className="input" required maxLength={120} placeholder="Sunday acoustic circle at KP" value={form.title} onChange={set("title")} />
          </div>
          <div className="field">
            <label>Kind</label>
            <select className="select" value={form.kind} onChange={set("kind")}>
              <option value="jam">🎵 Jam session — play together</option>
              <option value="vibe">🎤 I'm performing — need an audience</option>
              <option value="hangout">☕ Just hanging — no pressure</option>
            </select>
          </div>
          <div className="field">
            <label>City *</label>
            <input className="input" required value={form.city} onChange={set("city")} />
          </div>
          <div className="field">
            <label>Area</label>
            <input className="input" placeholder="Koregaon Park" value={form.area} onChange={set("area")} />
          </div>
          <div className="field">
            <label>Venue / spot</label>
            <input className="input" placeholder="Home studio, cafe terrace…" value={form.venue} onChange={set("venue")} />
          </div>
          <div className="field">
            <label>Date *</label>
            <input type="date" className="input" required min={new Date().toISOString().slice(0, 10)} value={form.date} onChange={set("date")} />
          </div>
          <div className="field">
            <label>Start</label>
            <input type="time" className="input" value={form.start_time} onChange={set("start_time")} />
          </div>
          <div className="field">
            <label>Spots</label>
            <input type="number" min={2} max={200} className="input" value={form.capacity} onChange={set("capacity")} />
          </div>
          <div className="field full">
            <label>Instruments wanted</label>
            <input className="input" placeholder="guitar, tabla, cajón…" value={form.instruments} onChange={set("instruments")} />
          </div>
          <div className="field full">
            <label>Vibe / genres</label>
            <input className="input" placeholder="indie, sufi, lo-fi hip-hop…" value={form.genres} onChange={set("genres")} />
          </div>
          <div className="field full">
            <label>Notes</label>
            <textarea className="textarea" maxLength={800} value={form.description} onChange={set("description")} placeholder="BYO instrument, chai on us, all levels welcome." />
          </div>
          <div className="full row between">
            <span className="small muted">Free to join — always. Share link copies automatically.</span>
            <button className="btn btn-primary" disabled={busy}>{busy ? "Publishing…" : "Publish jam"}</button>
          </div>
        </form>
      )}

      <div className="row wrapline" style={{ gap: 6, marginTop: 14 }}>
        {KINDS.map(([v, l]) => (
          <button
            key={v}
            className={`chip ${kind === v ? "on" : ""}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              v ? next.set("kind", v) : next.delete("kind");
              setParams(next, { replace: true });
            }}
          >
            {l}
          </button>
        ))}
        <span style={{ marginLeft: "auto" }}>
          <button className={`chip ${alertOn ? "on" : ""}`} disabled={busy || !session?.user} onClick={toggleAlert}>
            {alertOn ? "🔔 Jam alerts on" : "🔔 Alert me about jams"}
          </button>
          {!session?.user && <span className="small muted" style={{ marginLeft: 6 }}>sign in to subscribe</span>}
        </span>
      </div>

      <div className="grid grid-3 mt-3">
        {jams === null ? (
          [...Array(3)].map((_, i) => <div key={i} className="card" style={{ height: 200 }}><div className="skeleton" style={{ height: 120 }} /></div>)
        ) : !jams.length ? (
          <div style={{ gridColumn: "1 / -1" }}>
            <Empty icon="🎸" title="No jams listed yet">
              Be the first — host a jam, share the link with your group, and let the broadcast bring the rest.
            </Empty>
          </div>
        ) : (
          jams.map((j) => (
            <JamCard key={j.id} jam={j} session={session} onJoin={join} onBroadcast={broadcast} onCancel={cancel} busy={busy} />
          ))
        )}
      </div>

      <div className="note note-info mt-3">
        <strong>How broadcasts work:</strong> the host taps “Broadcast live” on the day of the jam —
        Telegram, email attendees and your alert subscribers get pinged at once (max once per 30 min).
        Finished jams are retired automatically by the engine sweep.
      </div>
    </div>
  );
}
