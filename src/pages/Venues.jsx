import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { usePageMeta } from "../ui.jsx";

const KINDS = [
  ["cafe", "☕", "Café / coffee shop", "Weekly live sets, acoustic evenings"],
  ["bar", "🍸", "Bar / pub", "Open-mic nights, DJ slots, bands"],
  ["restaurant", "🍽️", "Restaurant", "Dinner jazz, weekend performers"],
  ["house-party", "🏠", "House party", "Sangeet, anniversaries, get-togethers"],
  ["birthday", "🎂", "Birthday", "Kids entertainers, acoustic, DJs"],
  ["wedding", "💍", "Wedding", "Sangeet, mehndi, pheras, reception"],
  ["festival", "🎪", "Festival / college fest", "Lineups and stage acts"],
  ["corporate", "💼", "Corporate", "Annual days, product nights, awards"],
];

const STEPS = [
  ["Tell us the night", "One short brief — occasion, date, place, budget. Takes 60 seconds.", "📝"],
  ["We shortlist", "Verified local acts matched to your vibe, with clips, rates and availability.", "🎯"],
  ["You pick & book", "Chat instantly, lock the date, pay with escrow-style protection.", "🤝"],
];

export default function Venues() {
  const { session, notify } = useSession();
  usePageMeta(
    "Live performers for cafés, parties & weddings — Mehfil",
    "Tell us the night once. Get a free shortlist of verified local performers with rates, clips and availability — DJs, singers, bands, poets, anchors and more."
  );
  const [meta, setMeta] = useState(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: session?.user?.name || "",
    venue: "", city: "", kind: "cafe", date: "", need: "",
    email: session?.user?.email || "", phone: "", website: "",
  });

  useEffect(() => {
    api("/api/venues/meta").then(setMeta).catch(() => null);
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/venues", { method: "POST", body: JSON.stringify(form) });
      setSent(true);
      notify("Request received — your shortlist is on the way", "ok");
    } catch (err) {
      notify(err.message, "err");
    }
    setBusy(false);
  };

  const waText = encodeURIComponent(
    "Hi Mehfil — I'm planning live music for my venue/event. Here's what I need: "
  );
  const waLink = `https://wa.me/?text=${waText}`;

  return (
    <div>
      <section className="hero">
        <div className="wrap">
          <div className="kicker" style={{ color: "var(--marigold)" }}>For venues & occasions</div>
          <h1>
            Live talent for your <em>café, bar, party or stage</em> — shortlisted in hours
          </h1>
          <p className="sub">
            Tell us the night once. We match it to verified local performers — singers, DJs,
            bands, poets, anchors — with rates, clips and availability. Chat and book within minutes.
          </p>
          <div className="badges">
            <span className="pill">{meta ? meta.artists : "—"}+ listed acts</span>
            <span className="pill">{meta ? meta.cities : "—"}+ cities</span>
            <span className="pill">Escrow-style payments</span>
            <span className="pill">Two-way reviews</span>
          </div>
          <div className="row wrapline" style={{ gap: 10, marginTop: 24 }}>
            <a href="#brief" className="btn btn-primary btn-lg">Get a free shortlist</a>
            <a href={waLink} target="_blank" rel="noreferrer" className="btn btn-ghost btn-lg" style={{ color: "#fff", borderColor: "rgba(255,255,255,0.35)" }}>
              Message us on WhatsApp
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <div className="kicker">What do you need?</div>
              <h2>Pick your occasion</h2>
            </div>
            <Link to="/discover" className="btn btn-ghost btn-sm">Or browse all talent →</Link>
          </div>
          <div className="grid grid-4">
            {KINDS.map(([key, ic, label, hint]) => (
              <a
                key={key}
                className="card card-hover venue-kind"
                href={`#brief`}
                onClick={() => setForm((f) => ({ ...f, kind: key }))}
              >
                <div className="big" style={{ fontSize: 26 }}>{ic}</div>
                <b>{label}</b>
                <span className="small muted">{hint}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-dark">
        <div className="wrap">
          <div className="section-head">
            <div>
              <div className="kicker">How it works</div>
              <h2 style={{ color: "#fff" }}>Brief → shortlist → booked</h2>
            </div>
          </div>
          <div className="grid grid-3">
            {STEPS.map(([title, body, ic], i) => (
              <div key={title} className="card" style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)", color: "#efe8f7" }}>
                <div className="row between">
                  <span style={{ fontSize: 24 }}>{ic}</span>
                  <span className="tiny" style={{ color: "var(--marigold)", fontWeight: 700 }}>STEP {i + 1}</span>
                </div>
                <h3 style={{ color: "#fff", marginTop: 10 }}>{title}</h3>
                <p className="small" style={{ color: "#b9a9d4" }}>{body}</p>
              </div>
            ))}
          </div>
          <p className="small center mt-3" style={{ color: "#a99cc0" }}>
            Regulars report getting their first reply within the hour — acts that answer fast book fast.
          </p>
        </div>
      </section>

      <section className="section" id="brief">
        <div className="wrap" style={{ maxWidth: 760 }}>
          <div className="section-head">
            <div>
              <div className="kicker">60-second brief</div>
              <h2>Tell us about your night</h2>
            </div>
          </div>

          {sent ? (
            <div className="card center" style={{ padding: 34 }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <h3 className="mt-1">Request received</h3>
              <p className="muted">
                A shortlist of verified local acts is on its way to your inbox. Want to browse
                while you wait?
              </p>
              <div className="row center" style={{ justifyContent: "center", gap: 10 }}>
                <Link to="/discover" className="btn btn-primary">Browse talent</Link>
                <Link to="/match" className="btn btn-ghost">Swipe the deck</Link>
              </div>
            </div>
          ) : (
            <form className="card" onSubmit={submit}>
              <input
                className="hp-field"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={form.website}
                onChange={set("website")}
              />
              <div className="form-grid">
                <div className="field">
                  <label>Your name</label>
                  <input className="input" value={form.name} onChange={set("name")} placeholder="Riya" required />
                </div>
                <div className="field">
                  <label>Venue / event name (optional)</label>
                  <input className="input" value={form.venue} onChange={set("venue")} placeholder="Cafe Kapi, house party…" />
                </div>
                <div className="field">
                  <label>City</label>
                  <input className="input" value={form.city} onChange={set("city")} placeholder="Pune" required />
                </div>
                <div className="field">
                  <label>Occasion</label>
                  <select className="select" value={form.kind} onChange={set("kind")}>
                    {KINDS.map(([k, , label]) => <option key={k} value={k}>{label}</option>)}
                    <option value="other">Something else</option>
                  </select>
                </div>
                <div className="field">
                  <label>Date (optional)</label>
                  <input className="input" type="date" value={form.date} onChange={set("date")} />
                </div>
                <div className="field">
                  <label>How we reach you</label>
                  <div className="row" style={{ gap: 8 }}>
                    <input className="input" type="email" value={form.email} onChange={set("email")} placeholder="you@venue.com" />
                    <input className="input" value={form.phone} onChange={set("phone")} placeholder="Phone / WhatsApp" style={{ maxWidth: 150 }} />
                  </div>
                  <span className="field-hint">
                    Share an email and we'll send your shortlist plus up to two follow-ups.
                    Every email has a one-click unsubscribe.
                  </span>
                </div>
                <div className="field full">
                  <label>What's the vibe?</label>
                  <textarea
                    className="textarea"
                    value={form.need}
                    onChange={set("need")}
                    placeholder="Acoustic duo for 40 guests, 7–10pm, budget ₹15k — or ‘surprise us’."
                  />
                  <span className="field-hint">One email + city is enough to start. We'll fill in the rest on the call.</span>
                </div>
              </div>
              <div className="row mt-2 wrapline" style={{ gap: 10 }}>
                <button className="btn btn-primary btn-lg" disabled={busy}>
                  {busy ? "Sending…" : "Get my shortlist"}
                </button>
                <a href={waLink} target="_blank" rel="noreferrer" className="btn btn-ghost">WhatsApp instead</a>
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="note note-info">
            <strong>Also for artists:</strong> play gigs, not forms — the{" "}
            <Link to="/match">quick-match deck</Link> puts open gigs in your swipe stack, and a
            60-second <Link to="/need">gig brief</Link> brings hosts to you.
          </div>
          <div className="grid grid-3 mt-3">
            {[["Post a gig brief", "/need", "Hosts: describe the night, get invited acts"],
              ["Quick match", "/match", "Swipe open gigs and available talent"],
              ["List your act", "/list-your-act", "Get found by venues searching your city"]].map(([t, to, d]) => (
              <Link key={to} to={to} className="card card-hover">
                <b>{t}</b>
                <div className="small muted mt-1">{d}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
