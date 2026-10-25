import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { Avatar, CATS, Empty, SignInLink, SourceBadge, categoryLabel, ShareRow, usePageMeta } from "../ui.jsx";

const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(String(s).replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? String(s).slice(0, 10) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

export default function TalentProfile() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { session, refresh, notify } = useSession();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setData(null);
    api(`/api/talent/profile/${slug}`).then(setData).catch((e) => setErr(e.message));
  }, [slug]);

  const listed = data?.talent;
  usePageMeta(
    listed ? `${listed.name} — ${categoryLabel(listed.category)} in ${listed.city || "India"} | Mehfil` : null,
    listed
      ? `${listed.name} on Mehfil${listed.city ? `, ${listed.city}` : ""}. ${listed.bio ? listed.bio.slice(0, 120) : "Claim this profile free to add rates, a showreel and gig requests."}`
      : null
  );

  const claim = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/talent/${slug}/claim`, { method: "POST", body: "{}" });
      await refresh();
      notify("Profile claimed — add your rates or keep it quote-per-gig.");
      nav(`/artist/${r.artist_slug}`);
    } catch (e) {
      notify(e.message, "err");
    }
    setBusy(false);
  };

  if (err) return <div className="wrap section"><Empty icon="🔍" title={err}><Link to="/discover?view=directory" style={{ textDecoration: "underline" }}>Back to the directory</Link></Empty></div>;
  if (!data) return <div className="wrap section"><div className="skeleton" style={{ height: 220, marginBottom: 16 }} /><div className="skeleton" style={{ height: 300 }} /></div>;

  const { talent: t, claimed_slug } = data;
  const links = t.links || {};
  const hue = 100 + (Math.abs([...String(t.name + t.city)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)) % 260);

  return (
    <div className="wrap section" style={{ maxWidth: 900 }}>
      <div className="row between wrapline" style={{ gap: 16, alignItems: "flex-start" }}>
        <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
          {t.image_url ? (
            <img
              src={t.image_url}
              alt={t.name}
              loading="lazy"
              style={{ width: 86, height: 86, borderRadius: 18, objectFit: "cover", border: "1px solid var(--line)" }}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          ) : (
            <Avatar name={t.name} hue={hue} size="avatar-lg" />
          )}
          <div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <h1 style={{ margin: 0 }}>{t.name}</h1>
              <SourceBadge source={t.source} />
              {claimed_slug ? <span className="badge badge-verified">✓ Claimed</span> : <span className="badge badge-new">Unclaimed</span>}
              {t.open_to_work ? <span className="badge badge-verified">Open to gigs</span> : null}
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              {CATS[t.category]?.icon} {categoryLabel(t.category)} · {[t.area, t.city].filter(Boolean).join(", ") || "India"}
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              First listed {fmtDate(t.first_seen_at)} · Last confirmed {fmtDate(t.last_seen_at)}
              {t.followers > 0 ? ` · ${Number(t.followers).toLocaleString("en-IN")} followers` : ""}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {claimed_slug ? (
            <>
              <Link to={`/artist/${claimed_slug}`} className="btn btn-primary btn-sm">View bookable profile →</Link>
              <Link to={`/need?artist=${claimed_slug}`} className="btn btn-ghost btn-sm">Send a gig request</Link>
            </>
          ) : (
            <Link to={`/need?category=${t.category}&city=${encodeURIComponent(t.city || "")}`} className="btn btn-ghost btn-sm">
              Invite to a gig →
            </Link>
          )}
          {!claimed_slug && (session?.user ? (
            <button className="btn btn-primary" disabled={busy} onClick={claim}>
              {busy ? "Claiming…" : "Claim this profile →"}
            </button>
          ) : (
            <SignInLink returnTo={`/talent/${t.slug}`} className="btn btn-primary">Claim with one click</SignInLink>
          ))}
        </div>
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <ShareRow
          path={`/talent/${t.slug}`}
          text={`${t.name} — ${categoryLabel(t.category)}${t.city ? ` in ${t.city}` : ""} on Mehfil`}
          label="Share this listing"
        />
      </div>

      {!claimed_slug && (
        <div className="note note-info mt-3">
          <strong>Is this you?</strong>{" "}
          {t.source === "claim"
            ? "You added this profile without an account. Claim it (one click, no packages needed) to control the details, turn gig requests on or off and reply from your own inbox."
            : "This profile was assembled from a public, attributed source — never a private phone book. Claim it (one click, no packages needed) to control the details and receive gig requests directly. Until it is claimed we show public info only: no contact details, no cold messages."}
        </div>
      )}

      <div className="layout-2 mt-3" style={{ alignItems: "start" }}>
        <div className="stack" style={{ gap: 18 }}>
          <div className="card">
            <h3>About</h3>
            <p className="muted" style={{ marginTop: 8 }}>{t.bio || "No bio in the source yet."}</p>
            <div className="row wrapline" style={{ gap: 6 }}>
              {(t.genres || []).map((g) => <span key={g} className="tag">{g}</span>)}
            </div>
          </div>

          <div className="card">
            <h3>Listen &amp; verify</h3>
            <p className="small muted" style={{ marginTop: 6 }}>
              Public links attached to this listing. Claim the profile to add your own rates, showreel and availability.
            </p>
            <div className="row wrapline mt-2" style={{ gap: 8 }}>
              {links.instagram && (
                <a className="btn btn-ghost btn-sm" href={links.instagram.startsWith("http") ? links.instagram : `https://instagram.com/${links.instagram}`} target="_blank" rel="noreferrer">📸 Instagram</a>
              )}
              {links.youtube && <a className="btn btn-ghost btn-sm" href={links.youtube} target="_blank" rel="noreferrer">▶ YouTube</a>}
              {links.spotify && <a className="btn btn-ghost btn-sm" href={links.spotify} target="_blank" rel="noreferrer">🎧 Spotify</a>}
              {links.soundcloud && <a className="btn btn-ghost btn-sm" href={links.soundcloud} target="_blank" rel="noreferrer">☁ SoundCloud</a>}
              {links.website && <a className="btn btn-ghost btn-sm" href={links.website} target="_blank" rel="noreferrer">🌐 Website</a>}
              {links.portfolio && <a className="btn btn-ghost btn-sm" href={links.portfolio} target="_blank" rel="noreferrer">🗂 Portfolio</a>}
              {links.url && <a className="btn btn-ghost btn-sm" href={links.url} target="_blank" rel="noreferrer">🔗 Source listing</a>}
              {!Object.keys(links).length && <span className="small muted">No public links in the source.</span>}
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 18 }}>
          <div className="card">
            <h3>Directory entry</h3>
            <div className="small muted stack" style={{ gap: 6, marginTop: 8 }}>
              <div>Source: <strong>{t.source}</strong>{t.source_url ? <> · <a href={t.source_url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>original listing</a></> : null}</div>
              <div>Verification: <strong>{t.verification}</strong></div>
              <div>Open to freelance gigs: <strong>{t.open_to_work ? "yes" : "not marked"}</strong></div>
              <div>Status: <strong>{t.status}</strong></div>
              <div>Refresh: re-seen on every daily scan; archived after 120 days unseen.</div>
            </div>
          </div>
          {!claimed_slug && (
            <div className="card">
              <h3>Not ready to claim?</h3>
              <p className="small muted">Post a gig request and we'll invite this act if they fit — they can reply from a link.</p>
              <Link to="/need" className="btn btn-sm btn-block">Post a gig request</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
