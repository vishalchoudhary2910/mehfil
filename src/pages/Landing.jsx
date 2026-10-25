import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../session.jsx";
import { INR, CATS, Stars, SignInLink, qs } from "../ui.jsx";

function Hero() {
  const nav = useNavigate();
  const [meta, setMeta] = useState(null);
  const [city, setCity] = useState("");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { api("/api/meta").then(setMeta).catch(() => {}); }, []);

  return (
    <section className="hero">
      <div className="wrap">
        <div className="row wrapline" style={{ gap: 8 }}>
          <span className="pill">🇮🇳 Launch city: Pune · Mumbai · Jaipur</span>
          <span className="pill">Escrow-protected bookings</span>
          <span className="pill">⚡ Quick-match deck: swipe, match, chat in minutes</span>
        </div>
        <h1 className="mt-2">
          Hire, team up, and perform — the <em>operating system</em> for live and creative talent.
        </h1>
        <p className="sub">
          Hire DJs, singers, bands, <strong>poets &amp; shayars, stand-up comics, rappers, dancers
          and anchors</strong> for real events — with genuine profiles, upfront prices and real
          availability. Then find bandmates, run your shows, jam for free tonight, and keep the
          receipts in the app.
        </p>

        <form
          className="hero-search"
          onSubmit={(e) => { e.preventDefault(); nav(`/discover${qs({ q, city, category: cat })}`); }}
        >
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Try “shayari”, “sufi band”, “stand-up”…"
            aria-label="Search artists"
            style={{ minWidth: 220, flex: "1 1 240px" }}
          />
          <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
            <option value="">Any city</option>
            {(meta?.cities || []).map((c) => (
              <option key={c.city} value={c.city}>{c.city} ({c.n})</option>
            ))}
          </select>
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            <option value="">Any category</option>
            {(meta?.categories || []).map((c) => (
              <option key={c.category} value={c.category}>
                {CATS[c.category]?.label || c.category} — from {INR(c.from_price)}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit">Find your artist</button>
        </form>

        <div className="hero-stats">
          <div><div className="n">{(meta?.categories || []).reduce((s, c) => s + c.n, 0) || "0"}+</div><div className="l">profiles to hire</div></div>
          <div><div className="n">{meta?.directory_total || 0}+</div><div className="l">acts found by the daily radar</div></div>
          <div><div className="n">0%</div><div className="l">commission for Founding Artists</div></div>
          <div><div className="n">&lt;5 min</div><div className="l">from brief to invited acts</div></div>
        </div>
      </div>
    </section>
  );
}

function Categories() {
  const nav = useNavigate();
  const entries = Object.entries(CATS).filter(([k]) => k !== "other");
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <div>
            <div className="kicker">Every kind of act</div>
            <h2>Poets, comics, rappers and the whole stage</h2>
            <p className="muted mb-0" style={{ maxWidth: 600 }}>
              Cafes, clubs, banquets, college fests and private parties — one discovery feed for
              every performer, not just the three categories agencies push.
            </p>
          </div>
          <Link className="btn btn-ghost btn-sm" to="/discover">See everyone →</Link>
        </div>
        <div className="grid grid-4">
          {entries.map(([k, v]) => (
            <button
              key={k}
              className="card card-hover"
              style={{ textAlign: "left", cursor: "pointer" }}
              onClick={() => nav(`/discover?category=${k}`)}
            >
              <div style={{ fontSize: 30 }}>{v.icon}</div>
              <h3 className="mt-1">{v.label}</h3>
              <p className="small muted mb-0">
                Open mics, sangeets, club nights, college fests and corporate days — real
                profiles, upfront prices, no quote-and-wait.
              </p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ["1", "Describe the event", "Date, city, venue, budget, guest count and a short brief — sound, power, must-play songs."],
    ["2", "Compare real options", "Fixed-price packages, performance samples, verified badges and availability you can trust."],
    ["3", "Book with escrow", "40% advance is held by Mehfil, not the artist. Contract auto-generated from the booking."],
    ["4", "Event day & release", "Artist checks in at the venue. You confirm the show; escrow releases and both sides review."],
  ];
  return (
    <section className="section section-dark">
      <div className="wrap">
        <div className="section-head">
          <div>
            <div className="kicker" style={{ color: "var(--marigold)" }}>Booked in under 5 minutes</div>
            <h2 style={{ color: "#fff" }}>How a booking runs</h2>
          </div>
        </div>
        <div className="grid grid-4">
          {steps.map(([n, t, d]) => (
            <div key={n} className="card" style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)", color: "#efe8f7" }}>
              <div
                style={{
                  width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center",
                  background: "linear-gradient(135deg, var(--marigold), var(--saffron))",
                  color: "#2a1405", fontWeight: 800, marginBottom: 12,
                }}
              >
                {n}
              </div>
              <h3 style={{ color: "#fff", fontSize: "1.05rem" }}>{t}</h3>
              <p className="small" style={{ color: "#b9acc9", margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Wedge() {
  const rows = [
    ["Instant, fixed-price packages", true, false],
    ["Escrow + auto contract", true, false],
    ["Artist-to-artist collab board", true, false],
    ["Masked contact until paid", true, false],
    ["Two-way reviews tied to real gigs", true, false],
    ["Mid-budget private events welcome", true, false],
  ];
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <div>
            <div className="kicker">Why not WhatsApp?</div>
            <h2>Safer than a DM, faster than an agency</h2>
            <p className="muted mb-0" style={{ maxWidth: 560 }}>
              Your real competitor is Instagram, WhatsApp and word of mouth. Mehfil wins by being
              safer (escrow, verified profiles, contracts) and faster (real availability, prices
              upfront) than a message thread.
            </p>
          </div>
        </div>
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table className="compare-table">
            <thead>
              <tr><th>What you get</th><th>Mehfil</th><th>DM / word of mouth</th></tr>
            </thead>
            <tbody>
              {rows.map(([label, yes, no]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className={yes ? "yes" : ""}>{yes ? "✓" : "—"}</td>
                  <td className={no ? "yes" : "no"}>{no ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Trust() {
  const items = [
    ["🛡️", "Escrow, not trust-falls", "Your advance sits with the platform until the gig is confirmed. Paying outside the app forfeits every protection — by design."],
    ["✅", "KYC-verified artists", "PAN-backed profiles, verified badges and a gig history that can't be taken to WhatsApp."],
    ["📄", "Contract per booking", "Scope, timing, payment, cancellation and liability — generated automatically, accepted by both sides."],
    ["⚖️", "Clear cancellation rules", "Flexible, moderate or strict — chosen by the artist, shown before you pay, enforced on refunds."],
    ["🚨", "Safety at private events", "Host verification, event-day check-in and a dispute window with the payout frozen while ops reviews."],
    ["🔁", "Rebook in one tap", "Anniversary and birthday prompts, past-brief prefilled — because the second booking should be easier."],
  ];
  return (
    <section className="section section-plum">
      <div className="wrap">
        <div className="section-head">
          <div>
            <div className="kicker" style={{ color: "var(--marigold)" }}>Trust is the product</div>
            <h2 style={{ color: "#fff" }}>Both sides are protected</h2>
          </div>
        </div>
        <div className="grid grid-3">
          {items.map(([ic, t, d]) => (
            <div key={t} className="feature" style={{ background: "rgba(255,255,255,0.045)", borderRadius: 14, padding: 16, border: "1px solid rgba(255,255,255,0.1)" }}>
              <div className="ic" style={{ background: "rgba(245,166,35,0.16)" }}>{ic}</div>
              <div>
                <strong style={{ color: "#fff" }}>{t}</strong>
                <p className="small" style={{ color: "#b9acc9", margin: "4px 0 0" }}>{d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturedArtists() {
  const [artists, setArtists] = useState([]);
  useEffect(() => { api("/api/artists?sort=rating").then((d) => setArtists(d.artists.slice(0, 4))).catch(() => {}); }, []);
  if (!artists.length) return null;
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <div>
            <div className="kicker">Live on Mehfil now</div>
            <h2>Artists booking this season</h2>
          </div>
          <Link className="btn btn-ghost btn-sm" to="/discover">Browse everyone →</Link>
        </div>
        <div className="grid grid-4">
          {artists.map((a) => (
            <Link key={a.id} to={`/artist/${a.slug}`} className="card card-hover artist-card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="cover" style={{ height: 90, borderRadius: 0, background: `linear-gradient(135deg, hsl(${a.hue}, 62%, 42%), hsl(${(a.hue + 52) % 360}, 70%, 54%))` }}>
                <div className="who">
                  <div className="name">{a.stage_name}</div>
                  <div className="meta">{CATS[a.category]?.label} · {a.city}</div>
                </div>
              </div>
              <div className="body" style={{ padding: "12px 14px 14px" }}>
                <Stars value={a.rating} count={a.reviews_count} />
                <div className="foot">
                  <span className="price">{INR(a.base_price_inr)}<span className="small muted" style={{ fontWeight: 400 }}> onwards</span></span>
                  <span className="tag">{a.gigs_done} gigs</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function ShowsTeaser() {
  const [shows, setShows] = useState([]);
  useEffect(() => { api("/api/shows").then((d) => setShows(d.shows.slice(0, 3))).catch(() => {}); }, []);
  if (!shows.length) return null;
  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="section-head">
          <div>
            <div className="kicker">Free & paid shows</div>
            <h2>What's happening near you</h2>
          </div>
          <Link className="btn btn-ghost btn-sm" to="/shows">All shows →</Link>
        </div>
        <div className="grid grid-3">
          {shows.map((s) => (
            <div key={s.id} className="card">
              <div className="row between">
                <span className="tag">{new Date(s.date + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                <span className={`badge ${s.is_free ? "badge-new" : "badge-verified"}`}>
                  {s.is_free ? "Free" : INR(s.price_inr)}
                </span>
              </div>
              <h3 className="mt-1" style={{ fontSize: "1.05rem" }}>{s.title}</h3>
              <p className="small muted mb-0">{s.venue}, {s.city} · {s.rsvps} going</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function JamsTeaser() {
  const [jams, setJams] = useState([]);
  useEffect(() => { api("/api/jams").then((d) => setJams((d.jams || []).slice(0, 3))).catch(() => {}); }, []);
  if (!jams.length) return null;
  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="section-head">
          <div>
            <div className="kicker">Jam circles — free</div>
            <h2>Jam tonight, no gig required</h2>
          </div>
          <Link className="btn btn-ghost btn-sm" to="/jams">All jams →</Link>
        </div>
        <div className="grid grid-3">
          {jams.map((j) => (
            <Link key={j.id} to={`/jam/${j.token}`} className="card card-hover">
              <div className="row between">
                <span className="tag">{new Date(j.date + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {j.start_time}</span>
                <span className="badge badge-new">Free</span>
              </div>
              <h3 className="mt-1" style={{ fontSize: "1.05rem" }}>{j.title}</h3>
              <p className="small muted mb-0">{[j.venue, j.city].filter(Boolean).join(", ")} · {Number(j.going) || 0} going</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function VenueCTA() {
  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div
          className="card"
          style={{
            background: "linear-gradient(135deg, #14202e, #1f3a2e)",
            color: "#eaf4ee", padding: "34px", display: "flex",
            gap: 22, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap",
          }}
        >
          <div style={{ maxWidth: 560 }}>
            <h2 style={{ color: "#fff" }}>Run a café, bar or restaurant? Hosting a party, wedding or fest?</h2>
            <p className="small" style={{ color: "#b8d4c4", marginBottom: 0 }}>
              Tell us the night in 60 seconds — occasion, date, place, budget — and get a shortlist of
              verified local acts with rates, clips and availability. Birthdays, sangeets, house gigs,
              open-mic nights, college fests: one brief, minutes to a reply.
            </p>
          </div>
          <div className="row wrapline" style={{ gap: 10 }}>
            <Link to="/venues" className="btn btn-primary btn-lg">
              Get a free shortlist
            </Link>
            <Link to="/need" className="btn btn-ghost btn-lg" style={{ color: "#fff", borderColor: "rgba(255,255,255,0.35)" }}>
              Post a 60-sec gig brief
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function ArtistCTA() {
  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div
          className="card"
          style={{
            background: "linear-gradient(135deg, #241733, #4a2c14)",
            color: "#f3ecfa", padding: "34px", display: "flex",
            gap: 22, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap",
          }}
        >
          <div style={{ maxWidth: 560 }}>
            <h2 style={{ color: "#fff" }}>Performer? Your profile is already waiting</h2>
            <p className="small" style={{ color: "#cbbde0", marginBottom: 0 }}>
              We scan public listings and open sources every day for real acts. Claim a discovered
              profile in one click, or add yourself free in 30 seconds — no packages needed, open
              to freelance gigs. Founding Artists get 0% commission for six months.
            </p>
          </div>
          <div className="row wrapline" style={{ gap: 10 }}>
            <SignInLink returnTo="/join" className="btn btn-primary btn-lg">Claim your profile</SignInLink>
            <Link to="/list-your-act" className="btn btn-ghost btn-lg" style={{ color: "#fff", borderColor: "rgba(255,255,255,0.35)" }}>
              Add yourself free
            </Link>
            <Link to="/collab" className="btn btn-ghost btn-lg" style={{ color: "#fff", borderColor: "rgba(255,255,255,0.35)" }}>
              Browse collab board
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <>
      <Hero />
      <Categories />
      <HowItWorks />
      <FeaturedArtists />
      <Wedge />
      <Trust />
      <ShowsTeaser />
      <JamsTeaser />
      <VenueCTA />
      <ArtistCTA />
    </>
  );
}
