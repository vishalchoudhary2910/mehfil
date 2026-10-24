import { useState } from "react";
import { Link } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { SignInLink, catOptions } from "../ui.jsx";

const CATS = catOptions(true).map((c) => [c.key, `${c.icon} ${c.label}`]);

export default function Claim() {
  const { notify } = useSession();
  const [f, setF] = useState({
    name: "", category: "singer", city: "", area: "",
    phone: "", email: "", instagram: "", portfolio: "",
    bio: "", freelance: true,
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!f.name.trim() || !f.city.trim()) return setErr("Your act name and city are required.");
    if (!f.email && !f.phone && !f.instagram && !f.portfolio) {
      return setErr("Add at least one way to reach you — Instagram, a portfolio, email or phone.");
    }
    setBusy(true);
    try {
      const r = await api("/api/talent/self", { method: "POST", body: JSON.stringify(f) });
      setDone(r);
      notify("Your profile is live.");
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  };

  if (done) {
    const url = `${window.location.origin}${done.profile_url}`;
    return (
      <div className="wrap section center" style={{ maxWidth: 620 }}>
        <div style={{ fontSize: 44 }}>🎉</div>
        <h2>{done.created ? "You're live" : "Your profile is updated"}</h2>
        <p className="muted">
          <strong>{done.talent?.name || f.name}</strong> is now in the Mehfil directory as{" "}
          <strong>{(done.talent?.category || f.category).replace(/_/g, " ")}</strong> in {f.city}.
          Hosts and our gig-request engine can find you straight away.
        </p>
        <div className="card mt-2" style={{ textAlign: "left" }}>
          <div className="small muted">Your public profile</div>
          <div className="row between wrapline" style={{ gap: 8, marginTop: 6 }}>
            <Link to={done.profile_url} style={{ textDecoration: "underline", wordBreak: "break-all" }}>
              {url}
            </Link>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { navigator.clipboard?.writeText(url); notify("Profile link copied"); }}
            >
              Copy link
            </button>
          </div>
          <p className="small muted" style={{ margin: "10px 0 0" }}>
            Put that link in your Instagram bio. Add rates, packages and instant availability any
            time by claiming the profile — it takes one tap with a free account.
          </p>
          <div className="row wrapline mt-2" style={{ gap: 8 }}>
            <SignInLink returnTo={done.profile_url} className="btn btn-primary btn-sm">
              Claim my profile — take bookings
            </SignInLink>
            <Link to={done.profile_url} className="btn btn-ghost btn-sm">View public profile</Link>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 14 }}>
          No fees, no packages, no approval queue. You can be marked “open to gigs” and receive
          availability requests without ever creating an account.
        </p>
      </div>
    );
  }

  return (
    <div className="wrap section" style={{ maxWidth: 700, paddingTop: 30 }}>
      <div className="kicker">List your act — free</div>
      <h2>Get found by hosts in 30 seconds</h2>
      <p className="muted">
        Poets, shayars, stand-up comics, rappers, singers, DJs, bands, dancers, anchors, dhol and
        instrumentalists: add the basics and your profile goes live immediately. No account, no
        approval queue — sign in later with one tap to claim it and take bookings.
      </p>

      <form className="card" style={{ marginTop: 16 }} onSubmit={submit}>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label>Stage / act name *</label>
            <input className="input" value={f.name} onChange={set("name")} placeholder="e.g. Neon Qisse" required maxLength={120} />
          </div>
          <div className="field">
            <label>What you do</label>
            <select className="select" value={f.category} onChange={set("category")}>
              {CATS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label>City *</label>
            <input className="input" value={f.city} onChange={set("city")} placeholder="Pune" required maxLength={80} />
          </div>
          <div className="field">
            <label>Area / locality</label>
            <input className="input" value={f.area} onChange={set("area")} placeholder="Koregaon Park" />
          </div>
          <div className="field">
            <label>Instagram (or portfolio)</label>
            <input className="input" value={f.instagram} onChange={set("instagram")} placeholder="@handle" />
          </div>
          <div className="field">
            <label>Portfolio / website / demo</label>
            <input className="input" value={f.portfolio} onChange={set("portfolio")} placeholder="https://…" />
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={f.email} onChange={set("email")} placeholder="you@email.com" />
          </div>
          <div className="field">
            <label>Phone / WhatsApp</label>
            <input className="input" value={f.phone} onChange={set("phone")} placeholder="98765 43210" />
          </div>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>One line about your act</label>
          <textarea
            className="textarea"
            value={f.bio}
            onChange={set("bio")}
            placeholder="Sufi + Bollywood live band, 5-piece, sangeets & corporate"
            maxLength={500}
          />
        </div>
        <label className="row small" style={{ gap: 8, marginTop: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={f.freelance} onChange={(e) => setF({ ...f, freelance: e.target.checked })} />
          I'm open to freelance gigs — send me requests and quotes
        </label>
        {err && <div className="bad small" style={{ marginTop: 10 }}>{err}</div>}
        <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} disabled={busy}>
          {busy ? "Publishing…" : "Publish my profile →"}
        </button>
        <p className="field-hint" style={{ marginTop: 10 }}>
          At least one contact or link is required. We only use it for gig enquiries; no spam and no
          resale of your data. Claiming with a free account unlocks rates, packages and instant
          availability.
        </p>
      </form>

      <p className="small muted mt-3">
        Already listed from a public source?{" "}
        <Link to="/discover?view=directory" style={{ textDecoration: "underline" }}>Find and claim your profile</Link>{" "}
        instead.
      </p>
    </div>
  );
}
