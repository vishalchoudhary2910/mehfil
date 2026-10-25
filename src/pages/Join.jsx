import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { INR, CATS, Empty } from "../ui.jsx";

// One shared taxonomy: every category (poets, shayars, comics, dancers…) has
// skills, so onboarding never crashes on a newly added category.
import { catOptions } from "../ui.jsx";
const SUB_SKILLS = Object.fromEntries(catOptions(true).map((c) => [c.key, c.skills]));
const LANGS = ["Hindi", "English", "Marathi", "Punjabi", "Gujarati", "Bengali", "Sanskrit"];

export default function Join() {
  const nav = useNavigate();
  const { session, refresh, notify } = useSession();
  const [params] = useSearchParams();
  const claimedRef = useRef(false);
  const [step, setStep] = useState(1);
  const [quoteMode, setQuoteMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    stage_name: "", category: "dj", city: "Pune", area: "", bio: "",
    experience_years: 3, travel_radius_km: 25, cancellation_policy: "moderate",
    sub_skills: [], languages: ["Hindi", "English"], instagram: "", youtube: "", portfolio_url: "",
    tagline: "",
  });

  // A ?ref=CODE visit is an artist-invite attribution — claim it once signed in.
  useEffect(() => {
    const ref = params.get("ref");
    if (!ref || !session?.user || claimedRef.current) return;
    claimedRef.current = true;
    api("/api/referral/claim", { method: "POST", body: JSON.stringify({ code: ref }) })
      .then(() => notify("Invite code applied — welcome aboard!"))
      .catch(() => null);
  }, [params, session, notify]);
  const [pkgs, setPkgs] = useState([
    { name: "", price_inr: "", duration_hours: 3, description: "", inclusions: [] },
  ]);

  if (session?.artist) {
    return (
      <div className="wrap section">
        <Empty icon="🎤" title="You already have a live profile">
          <div className="mt-2 row" style={{ gap: 10, justifyContent: "center" }}>
            <button className="btn btn-primary btn-sm" onClick={() => nav("/dashboard")}>Open Artist desk</button>
            <button className="btn btn-ghost btn-sm" onClick={() => nav(`/artist/${session.artist.slug}`)}>View public page</button>
          </div>
        </Empty>
      </div>
    );
  }

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const toggle = (k, v) =>
    setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));

  const setPkg = (i, k, v) =>
    setPkgs((ps) => ps.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));

  const step1Ok = f.stage_name.trim() && f.city.trim() && f.sub_skills.length;
  const step3Ok = pkgs.every((p) => p.name.trim() && Number(p.price_inr) > 0);

  const submit = async () => {
    setBusy(true);
    try {
      const { artist } = await api("/api/artist/profile", {
        method: "POST",
        body: JSON.stringify({
          ...f,
          quote_on_request: quoteMode,
          experience_years: Number(f.experience_years),
          travel_radius_km: Number(f.travel_radius_km),
          packages: quoteMode ? [] : pkgs
            .filter((p) => p.name.trim() && Number(p.price_inr) > 0)
            .map((p) => ({ ...p, price_inr: Number(p.price_inr), duration_hours: Number(p.duration_hours) || 3 })),
        }),
      });
      // Profile design rides on the design endpoint — tagline goes live with it.
      if (f.tagline.trim()) {
        await api("/api/artist/design", {
          method: "POST",
          body: JSON.stringify({ tagline: f.tagline.trim() }),
        }).catch(() => null);
      }
      await refresh();
      notify("Profile live! You're visible in discovery now.");
      nav(`/artist/${artist.slug}`);
    } catch (e) {
      notify(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap section" style={{ maxWidth: 820 }}>
      <div className="kicker">Artist onboarding — step {step} of {quoteMode ? 2 : 3}</div>
      <h2>Go live in minutes</h2>

      <div className="tabs mt-2">
        {(quoteMode ? ["Identity & skills", "Languages & reach"] : ["Identity & skills", "Languages & reach", "Packages"]).map((t, i) => (
          <button key={t} className={step === i + 1 ? "on" : ""} onClick={() => step > i + 1 && setStep(i + 1)}>
            {i + 1}. {t}
          </button>
        ))}
      </div>

      {step === 1 && (
        <div className="card form-grid">
          <div className="field full">
            <label>Stage name</label>
            <input className="input" placeholder="e.g. DJ Arjun / Neon Qisse" value={f.stage_name} onChange={set("stage_name")} />
          </div>
          <div className="field">
            <label>Category</label>
            <select className="select" value={f.category} onChange={set("category")}>
              {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Home city</label>
            <input className="input" value={f.city} onChange={set("city")} />
          </div>
          <div className="field">
            <label>Area / locality (optional)</label>
            <input className="input" value={f.area} onChange={set("area")} placeholder="Koregaon Park" />
          </div>
          <div className="field full">
            <label>How do you want to be hired?</label>
            <div className="row wrapline" style={{ gap: 8 }}>
              <span className={`chip ${quoteMode ? "on" : ""}`} onClick={() => { setQuoteMode(true); setStep(1); }}>
                ⚡ Quote per gig — fastest, no prices needed
              </span>
              <span className={`chip ${!quoteMode ? "on" : ""}`} onClick={() => setQuoteMode(false)}>
                💳 Fixed-price packages
              </span>
            </div>
            <span className="field-hint">
              Quote mode publishes immediately and lets hosts send briefs you can accept. Add packages later whenever you want.
            </span>
          </div>
          <div className="field full">
            <label>Sub-skills / genres — pick at least one</label>
            <div className="row wrapline" style={{ gap: 7 }}>
              {SUB_SKILLS[f.category].map((s) => (
                <span key={s} className={`chip ${f.sub_skills.includes(s) ? "on" : ""}`} onClick={() => toggle("sub_skills", s)}>
                  {s}
                </span>
              ))}
            </div>
          </div>
          <div className="field full">
            <label>Tagline (optional) — one line hosts remember</label>
            <input className="input" maxLength={140} placeholder="Bollywood acoustic sets that turn dinners into dance floors" value={f.tagline} onChange={set("tagline")} />
            <span className="field-hint">Shown on your profile page and in the quick-match deck. Editable anytime from the Artist desk.</span>
          </div>
          <div className="field full">
            <label>Bio</label>
            <textarea className="textarea" placeholder="What you play, where you've played, what a gig with you feels like" value={f.bio} onChange={set("bio")} />
          </div>
          <div className="full row between">
            <span className="small muted">KYC (PAN) comes after your first booking request.</span>
            <button className="btn btn-primary" disabled={!step1Ok} onClick={() => setStep(2)}>Next →</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card form-grid">
          <div className="field full">
            <label>Languages you perform in</label>
            <div className="row wrapline" style={{ gap: 7 }}>
              {LANGS.map((l) => (
                <span key={l} className={`chip ${f.languages.includes(l) ? "on" : ""}`} onClick={() => toggle("languages", l)}>
                  {l}
                </span>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Years performing</label>
            <input type="number" min="0" max="60" className="input" value={f.experience_years} onChange={set("experience_years")} />
          </div>
          <div className="field">
            <label>Travel radius (km)</label>
            <input type="number" min="0" max="500" className="input" value={f.travel_radius_km} onChange={set("travel_radius_km")} />
          </div>
          <div className="field">
            <label>Cancellation policy</label>
            <select className="select" value={f.cancellation_policy} onChange={set("cancellation_policy")}>
              <option value="flexible">Flexible — attract more bookings</option>
              <option value="moderate">Moderate — balanced</option>
              <option value="strict">Strict — protect your dates</option>
            </select>
            <span className="field-hint">Shown to hosts before they pay.</span>
          </div>
          <div className="field">
            <label>Instagram (optional)</label>
            <input className="input" placeholder="@handle" value={f.instagram} onChange={set("instagram")} />
          </div>
          <div className="field">
            <label>YouTube (optional)</label>
            <input className="input" placeholder="@handle" value={f.youtube} onChange={set("youtube")} />
          </div>
          <div className="field">
            <label>Portfolio / website (optional)</label>
            <input className="input" placeholder="https://your-work.example" value={f.portfolio_url} onChange={set("portfolio_url")} />
          </div>
          <div className="full row between">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>← Back</button>
            <button
              className="btn btn-primary"
              disabled={!f.languages.length || (quoteMode && busy)}
              onClick={() => (quoteMode ? submit() : setStep(3))}
            >
              {quoteMode ? (busy ? "Publishing…" : "Publish profile →") : "Next →"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="note">
            <strong>Fixed-price packages are the wedge:</strong> "DJ 3 hrs + basic sound, ₹12,000"
            books itself while quote-and-wait competitors sleep.
          </div>
          {pkgs.map((p, i) => (
            <div key={i} className="card form-grid">
              <div className="field full row" style={{ justifyContent: "space-between" }}>
                <label>Package {i + 1}</label>
                {pkgs.length > 1 && (
                  <button className="btn btn-danger btn-sm" onClick={() => setPkgs((ps) => ps.filter((_, idx) => idx !== i))}>
                    Remove
                  </button>
                )}
              </div>
              <div className="field">
                <label>Name</label>
                <input className="input" placeholder="House Party Starter" value={p.name} onChange={(e) => setPkg(i, "name", e.target.value)} />
              </div>
              <div className="field">
                <label>Price (₹)</label>
                <input type="number" min="1" className="input" placeholder="12000" value={p.price_inr} onChange={(e) => setPkg(i, "price_inr", e.target.value)} />
              </div>
              <div className="field">
                <label>Duration (hrs)</label>
                <input type="number" min="0.5" step="0.5" className="input" value={p.duration_hours} onChange={(e) => setPkg(i, "duration_hours", e.target.value)} />
              </div>
              <div className="field">
                <label>Short description</label>
                <input className="input" placeholder="What's included, best for what" value={p.description} onChange={(e) => setPkg(i, "description", e.target.value)} />
              </div>
              <div className="field full">
                <label>Inclusions — comma separated</label>
                <input className="input" placeholder="Own controller, up to 3 hrs play, breaks managed" onChange={(e) => setPkg(i, "inclusions", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
              </div>
            </div>
          ))}
          <div className="row between">
            <button className="btn btn-ghost" onClick={() => setStep(2)}>← Back</button>
            <div className="row" style={{ gap: 10 }}>
              {pkgs.length < 4 && (
                <button className="btn btn-ghost" onClick={() => setPkgs((ps) => [...ps, { name: "", price_inr: "", duration_hours: 3, description: "", inclusions: [] }])}>
                  + Add package
                </button>
              )}
              <button className="btn btn-primary btn-lg" disabled={!step3Ok || busy} onClick={submit}>
                {busy ? "Publishing…" : "Publish profile →"}
              </button>
            </div>
          </div>
          {!step3Ok && <p className="tiny muted center mb-0">Every package needs a name and a price.</p>}
        </div>
      )}
    </div>
  );
}
