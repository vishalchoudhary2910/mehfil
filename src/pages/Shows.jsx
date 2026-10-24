import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { INR, Empty, SignInLink, SourceBadge, qs } from "../ui.jsx";

const fmt = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

export default function Shows() {
  const [params, setParams] = useSearchParams();
  const { session, notify } = useSession();
  const [shows, setShows] = useState(null);
  const [mine, setMine] = useState({});
  const [ticket, setTicket] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "", performers: "", venue: "", city: "Pune",
    date: "", start_time: "20:00", is_free: "1", price_inr: "", capacity: 80, description: "",
  });

  const city = params.get("city") || "";
  const load = () => api(`/api/shows${qs({ city })}`).then((d) => setShows(d.shows)).catch(() => setShows([]));
  const ticketed = (shows || []).filter((s) => (ticket === "free" ? s.is_free : ticket === "paid" ? !s.is_free : true));
  useEffect(() => { load(); }, [city]); // eslint-disable-line

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/shows", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          is_free: form.is_free === "1",
          price_inr: Number(form.price_inr) || 0,
          capacity: Number(form.capacity) || 80,
        }),
      });
      notify("Show published to your city feed.");
      setOpen(false);
      await load();
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const rsvp = async (id) => {
    if (!session?.user) return;
    setBusy(true);
    try {
      const r = await api(`/api/shows/${id}/rsvp`, { method: "POST", body: "{}" });
      setMine((m) => ({ ...m, [id]: r.rsvping }));
      setShows((ss) => ss.map((s) => s.id === id ? { ...s, rsvps: s.rsvps + (r.rsvping ? 1 : -1) } : s));
      notify(r.rsvping ? "You're going! ✓" : "RSVP removed.");
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const createShowBtn = session?.user ? (
    <button className="btn btn-primary" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Create a show"}</button>
  ) : (
    <SignInLink returnTo="/shows" className="btn btn-primary">Sign in to create</SignInLink>
  );

  return (
    <div className="wrap section" style={{ maxWidth: 940 }}>
      <div className="section-head">
        <div>
          <div className="kicker">Free & paid shows</div>
          <h2>What's happening this weekend</h2>
          <p className="muted mb-0" style={{ maxWidth: 540 }}>
            Open mics, intimate concerts and rooftop sessions — artists and venues list, the city
            RSVPs, everyone discovers the next act.
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
          >
            <option value="">All cities</option>
            {["Pune", "Mumbai", "Jaipur"].map((c) => <option key={c}>{c}</option>)}
          </select>
          {createShowBtn}
        </div>
      </div>

      {open && (
        <form className="card form-grid mt-2" onSubmit={create}>
          <div className="field full">
            <label>Show title</label>
            <input className="input" required placeholder="Qisse Open Mic Night #42" value={form.title} onChange={set("title")} />
          </div>
          <div className="field">
            <label>Performers</label>
            <input className="input" placeholder="Your act / lineup" value={form.performers} onChange={set("performers")} />
          </div>
          <div className="field">
            <label>Venue</label>
            <input className="input" required placeholder="The Workshop Cafe" value={form.venue} onChange={set("venue")} />
          </div>
          <div className="field">
            <label>City</label>
            <input className="input" required value={form.city} onChange={set("city")} />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" className="input" required min={new Date().toISOString().slice(0, 10)} value={form.date} onChange={set("date")} />
          </div>
          <div className="field">
            <label>Start</label>
            <input type="time" className="input" value={form.start_time} onChange={set("start_time")} />
          </div>
          <div className="field">
            <label>Ticket type</label>
            <select className="select" value={form.is_free} onChange={set("is_free")}>
              <option value="1">Free</option>
              <option value="0">Paid</option>
            </select>
          </div>
          {form.is_free === "0" && (
            <div className="field">
              <label>Price (₹)</label>
              <input type="number" min="0" className="input" value={form.price_inr} onChange={set("price_inr")} />
            </div>
          )}
          <div className="field">
            <label>Capacity</label>
            <input type="number" min="1" className="input" value={form.capacity} onChange={set("capacity")} />
          </div>
          <div className="field full">
            <label>Description</label>
            <textarea className="textarea" value={form.description} onChange={set("description")} />
          </div>
          <div className="full row between">
            <span className="small muted">Shows list on your city feed and followers' timelines.</span>
            <button className="btn btn-primary" disabled={busy}>Publish show</button>
          </div>
        </form>
      )}

      <div className="row wrapline" style={{ gap: 6, marginTop: 14 }}>
        {[["", "All shows"], ["free", "Free entry"], ["paid", "Paid tickets"]].map(([v, l]) => (
          <button key={v} className={`chip ${ticket === v ? "on" : ""}`} onClick={() => setTicket(v)}>{l}</button>
        ))}
        <span className="small muted" style={{ marginLeft: "auto" }}>
          Imported from venue calendars and event feeds every day — free and paid alike.
        </span>
      </div>

      <div className="grid grid-3 mt-3">
        {shows === null ? (
          [...Array(3)].map((_, i) => <div key={i} className="card" style={{ height: 170 }}><div className="skeleton" style={{ height: 100 }} /></div>)
        ) : !ticketed.length ? (
          <Empty icon="🎪" title={ticket ? `No ${ticket} shows listed` : "No shows listed yet"} />
        ) : (
          ticketed.map((s) => (
            <div key={s.id} className="card card-hover stack" style={{ gap: 8 }}>
              <div className="row between">
                <span className="tag">{fmt(s.date)} · {s.start_time}</span>
                <span className={`badge ${s.is_free ? "badge-new" : "badge-verified"}`}>
                  {s.is_free ? "Free entry" : INR(s.price_inr)}
                </span>
              </div>
              <h3 style={{ fontSize: "1.08rem" }}>{s.title}</h3>
              <div className="small muted">{s.performers}</div>
              <div className="small muted">{s.venue}, {s.city} · {s.rsvps}/{s.capacity} going{s.organizer ? ` · ${s.organizer}` : ""}</div>
              {s.description && <p className="small muted" style={{ margin: 0 }}>{s.description}</p>}
              <div className="row wrapline" style={{ gap: 6 }}>
                {s.source && s.source !== "manual" ? <SourceBadge source={s.source} /> : null}
                {s.source_url ? (
                  <a className="tag" href={s.source_url} target="_blank" rel="noreferrer">Original listing ↗</a>
                ) : null}
              </div>
              <div className="mt-1">
                {session?.user ? (
                  <button className={`btn btn-sm btn-block ${mine[s.id] ? "btn-ghost" : "btn-primary"}`} disabled={busy} onClick={() => rsvp(s.id)}>
                    {mine[s.id] ? "✓ You're going — undo" : "RSVP"}
                  </button>
                ) : (
                  <SignInLink returnTo="/shows" className="btn btn-sm btn-block">RSVP</SignInLink>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="note note-info mt-3">
        <strong>Run a night?</strong> Create the show here, then{" "}
        <a href="/need" style={{ textDecoration: "underline" }}>send one gig request</a>{" "}
        and our engine invites every matching act nearby. Artists:{" "}
        <a href="/list-your-act" style={{ textDecoration: "underline" }}>add your act free</a>{" "}
        and we'll invite you when a matching show or private gig opens.
      </div>
    </div>
  );
}
