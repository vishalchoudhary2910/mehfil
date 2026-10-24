import { useEffect, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../session.jsx";
import { INR, CATS, catOptions, categoryLabel, categoryIcon, Stars, Badge, Empty, qs, SourceBadge } from "../ui.jsx";

const hueFor = (s) =>
  100 + (Math.abs([...String(s || "act")].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)) % 260);

function ArtistCard({ a }) {
  return (
    <Link to={`/artist/${a.slug}`} className="card card-hover artist-card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="cover"
        style={{ background: `linear-gradient(135deg, hsl(${a.hue} 62% 42%), hsl(${(a.hue + 52) % 360} 70% 54%))` }}
      >
        <div className="who">
          <div className="name">{a.stage_name}</div>
          <div className="meta">
            {CATS[a.category]?.label || "Performer"} · {a.city} · replies ~{a.response_mins}m
          </div>
        </div>
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 2, display: "grid", gap: 4, justifyItems: "end" }}>
          {a.verified ? <Badge kind="verified" /> : a.founding_artist ? <Badge kind="founding" /> : null}
          {Number(a.available_now) ? <span className="badge badge-new">● Available now</span> : null}
        </div>
      </div>
      <div className="body" style={{ padding: "12px 15px 15px" }}>
        <div className="row wrapline" style={{ gap: 6 }}>
          {a.sub_skills.slice(0, 3).map((s) => (
            <span key={s} className="tag">{s}</span>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {a.bio}
        </p>
        <Stars value={a.rating} count={a.reviews_count} />
        <div className="foot">
          <span className="price">
            {a.base_price_inr > 0 ? (
              <>
                {INR(a.base_price_inr)}
                <span className="small muted" style={{ fontWeight: 400 }}> onwards</span>
              </>
            ) : (
              <span style={{ fontSize: 14 }}>Quote on request</span>
            )}
          </span>
          <span className="tag">{a.gigs_done} gigs</span>
        </div>
      </div>
    </Link>
  );
}

function DirectoryCard({ t }) {
  const hue = hueFor(t.name + t.city);
  return (
    <Link to={`/talent/${t.slug}`} className="card card-hover artist-card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="cover"
        style={{
          background: t.image_url
            ? `linear-gradient(180deg, rgba(18,12,28,.12) 0%, rgba(18,12,28,.86) 100%), url(${t.image_url}) center/cover`
            : `linear-gradient(135deg, hsl(${hue} 46% 32%), hsl(${(hue + 48) % 360} 52% 44%))`,
        }}
      >
        <div className="who">
          <div className="name">{t.name}</div>
          <div className="meta">
            {categoryIcon(t.category)} {categoryLabel(t.category)} · {[t.area, t.city].filter(Boolean).join(", ") || "India"}
          </div>
        </div>
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 2, display: "grid", gap: 4, justifyItems: "end" }}>
          <span className="badge badge-new">Unclaimed</span>
          {t.open_to_work ? <span className="badge badge-verified">Open to gigs</span> : null}
        </div>
      </div>
      <div className="body" style={{ padding: "12px 15px 15px" }}>
        <div className="row wrapline" style={{ gap: 6 }}>
          {(t.genres || []).slice(0, 3).map((g) => <span key={g} className="tag">{g}</span>)}
          <SourceBadge source={t.source} />
        </div>
        <p className="small muted" style={{ margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {t.bio || "Discovered from a public listing. Claim this profile to add your rates and availability."}
        </p>
        <div className="foot">
          <span className="small muted">
            {t.followers > 0 ? `${Number(t.followers).toLocaleString("en-IN")} followers` : t.verification === "verified" ? "Verified source" : "Public listing"}
          </span>
          <span className="tag">Claim it →</span>
        </div>
      </div>
    </Link>
  );
}

// One card for mixed results: a bookable artist or a discovered directory act.
function MatchCard({ r }) {
  const to = r.kind === "artist" ? `/artist/${r.slug}` : `/talent/${r.slug}`;
  const hue = hueFor(r.name + r.city);
  const tags = (r.genres || []).slice(0, 3);
  return (
    <Link to={to} className="card card-hover artist-card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="cover"
        style={{
          background: r.image_url
            ? `linear-gradient(180deg, rgba(18,12,28,.12) 0%, rgba(18,12,28,.86) 100%), url(${r.image_url}) center/cover`
            : `linear-gradient(135deg, hsl(${hue} 52% 38%), hsl(${(hue + 48) % 360} 60% 50%))`,
        }}
      >
        <div className="who">
          <div className="name">{r.name}</div>
          <div className="meta">
            {categoryIcon(r.category)} {categoryLabel(r.category)} · {[r.area, r.city].filter(Boolean).join(", ") || "India"}
          </div>
        </div>
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 2, display: "grid", gap: 4, justifyItems: "end" }}>
          <span className={`badge ${r.kind === "artist" ? "badge-verified" : "badge-new"}`}>
            {r.kind === "artist" ? "Bookable" : "Discovered"}
          </span>
          {r.open_to_work ? <span className="badge badge-verified">Open to gigs</span> : null}
        </div>
      </div>
      <div className="body" style={{ padding: "12px 15px 15px" }}>
        <div className="row wrapline" style={{ gap: 6 }}>
          {tags.map((g) => <span key={g} className="tag">{g}</span>)}
          {(r.reasons || []).slice(0, 2).map((x) => <span key={x} className="tag">{x}</span>)}
        </div>
        <p className="small muted" style={{ margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {r.bio || "Public profile — claim it to add rates and availability."}
        </p>
        <div className="foot">
          <span className="price">
            {r.kind === "artist" && r.base_price_inr > 0
              ? <>{INR(r.base_price_inr)}<span className="small muted" style={{ fontWeight: 400 }}> onwards</span></>
              : <span style={{ fontSize: 14 }}>{r.kind === "artist" ? "Quote on request" : "Unclaimed profile"}</span>}
          </span>
          <span className="tag">View →</span>
        </div>
      </div>
    </Link>
  );
}

export default function Discover() {
  const [params, setParams] = useSearchParams();
  const [meta, setMeta] = useState(null);
  const [artists, setArtists] = useState(null);
  const [directory, setDirectory] = useState(null);
  const [dirTotal, setDirTotal] = useState(0);
  const [matches, setMatches] = useState(null);
  const [searchBusy, setSearchBusy] = useState(false);

  const view = params.get("view") === "directory" ? "directory" : "bookable";
  const f = {
    city: params.get("city") || "",
    category: params.get("category") || "",
    max_price: params.get("max_price") || "",
    language: params.get("language") || "",
    date: params.get("date") || "",
    q: params.get("q") || "",
    sort: params.get("sort") || "rating",
    available_now: params.get("available_now") || "",
    quote: params.get("quote") || "",
    open_to_work: params.get("open_to_work") || "",
  };

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };
  const setView = (v) => {
    const next = new URLSearchParams(params);
    if (v === "directory") next.set("view", "directory");
    else next.delete("view");
    setParams(next, { replace: true });
  };

  useEffect(() => { api("/api/meta").then(setMeta).catch(() => {}); }, []);

  const loadArtists = useCallback(() => {
    setArtists(null);
    api(`/api/artists${qs({ city: f.city, category: f.category, max_price: f.max_price, language: f.language, date: f.date, q: f.q, sort: f.sort, available_now: f.available_now, quote: f.quote })}`)
      .then((d) => setArtists(d.artists))
      .catch(() => setArtists([]));
  }, [params.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDirectory = useCallback(() => {
    setDirectory(null);
    api(`/api/talent${qs({ city: f.city, category: f.category, q: f.q, open_to_work: f.open_to_work, limit: 100 })}`)
      .then((d) => { setDirectory(d.talent); setDirTotal(d.total); })
      .catch(() => setDirectory([]));
  }, [params.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  // The "Find your artist" box searches both supplies at once, ranked by
  // demand, freshness and whether the act is open to freelance gigs.
  useEffect(() => {
    if (!f.q) { setMatches(null); return; }
    setSearchBusy(true);
    api(`/api/search${qs({ q: f.q, city: f.city, category: f.category, limit: 12 })}`)
      .then((d) => setMatches(d.results))
      .catch(() => setMatches([]))
      .finally(() => setSearchBusy(false));
  }, [f.q, f.city, f.category]);

  useEffect(() => { if (view === "bookable") loadArtists(); }, [view, loadArtists]);
  useEffect(() => { if (view === "directory") loadDirectory(); }, [view, loadDirectory]);

  const activeChips = Object.entries(f).filter(([k, v]) =>
    v && k !== "sort" && !(k === "sort" && v === "rating")
  );
  const cats = catOptions(true);
  const loading = view === "bookable" ? artists === null : directory === null;

  return (
    <div className="wrap section" style={{ paddingTop: 26 }}>
      <div className="section-head" style={{ marginBottom: 14 }}>
        <div>
          <div className="kicker">Discovery</div>
          <h2>Find your artist</h2>
          <p className="small muted" style={{ margin: "4px 0 0", maxWidth: 560 }}>
            Fixed-price acts ready to book, plus a live directory of real performers discovered from
            Wikipedia, MusicBrainz and public event listings — poets, shayars, comics, rappers, dancers,
            dhol, bands and anchors. Each profile links to its source and can be claimed by the artist.
          </p>
        </div>
        <form
          className="row"
          style={{ gap: 8, minWidth: 260, alignItems: "center" }}
          onSubmit={(e) => { e.preventDefault(); set("q", e.currentTarget.q.value.trim()); }}
        >
          <input
            name="q"
            className="input"
            placeholder="Name, genre, vibe… (shayari, sufi, stand-up)"
            defaultValue={f.q}
            aria-label="Search artists"
          />
          <button className="btn btn-primary btn-sm" type="submit">Search</button>
          {f.q && <button className="btn btn-ghost btn-sm" type="button" onClick={() => set("q", "")}>✕</button>}
        </form>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Link to="/need" className="btn btn-primary btn-sm">⚡ Need someone today — send a gig request</Link>
        <Link to="/list-your-act" className="btn btn-ghost btn-sm">I'm an artist / poet — get gig leads</Link>
      </div>

      {f.q && (
        <div className="mt-2" style={{ marginBottom: 18 }}>
          <div className="row between wrapline" style={{ gap: 8, marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Best matches for “{f.q}”</h3>
            <span className="small muted">
              {searchBusy ? "Searching both the roster and the directory…" : `${matches?.length || 0} result${matches?.length === 1 ? "" : "s"}`}
            </span>
          </div>
          {searchBusy || matches === null ? (
            <div className="grid grid-3">
              {[...Array(3)].map((_, i) => <div key={i} className="card" style={{ height: 240 }}><div className="skeleton" style={{ height: 90 }} /></div>)}
            </div>
          ) : matches.length ? (
            <div className="grid grid-3">{matches.map((r) => <MatchCard key={`${r.kind}-${r.id}`} r={r} />)}</div>
          ) : (
            <Empty icon="🔍" title="No match in the roster or directory yet">
              Try a broader word like “sufi”, “shayari” or “comedy” — or{" "}
              <Link to="/need" style={{ textDecoration: "underline" }}>send a gig request</Link>{" "}
              and we will invite the closest acts.
            </Empty>
          )}
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={view === "bookable" ? "on" : ""} onClick={() => setView("bookable")}>
          Bookable acts {artists !== null && view === "bookable" ? `(${artists.length})` : ""}
        </button>
        <button className={view === "directory" ? "on" : ""} onClick={() => setView("directory")}>
          Directory {directory !== null ? `(${dirTotal})` : ""}
        </button>
      </div>

      <div className="filters">
        <select className="select" style={{ width: "auto" }} value={f.city} onChange={(e) => set("city", e.target.value)} aria-label="City">
          <option value="">All cities</option>
          {(meta?.cities || []).map((c) => <option key={c.city} value={c.city}>{c.city} ({c.n})</option>)}
        </select>
        <select className="select" style={{ width: "auto" }} value={f.category} onChange={(e) => set("category", e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
        </select>
        {view === "directory" && (
          <button className={`chip ${f.open_to_work ? "on" : ""}`} onClick={() => set("open_to_work", f.open_to_work ? "" : "1")}>
            ● Open to gigs
          </button>
        )}
        {view === "bookable" && (
          <>
            <select className="select" style={{ width: "auto" }} value={f.max_price} onChange={(e) => set("max_price", e.target.value)} aria-label="Budget">
              <option value="">Any budget</option>
              <option value="10000">Under {INR(10000)}</option>
              <option value="15000">Under {INR(15000)}</option>
              <option value="30000">Under {INR(30000)}</option>
              <option value="50000">Under {INR(50000)}</option>
            </select>
            <select className="select" style={{ width: "auto" }} value={f.language} onChange={(e) => set("language", e.target.value)} aria-label="Language">
              <option value="">Any language</option>
              {(meta?.languages || []).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <div className="field">
              <input
                type="date"
                className="input"
                style={{ width: "auto" }}
                value={f.date}
                onChange={(e) => set("date", e.target.value)}
                aria-label="Event date"
                title="Only shows artists free on this date"
              />
            </div>
            <button className={`chip ${f.available_now ? "on" : ""}`} onClick={() => set("available_now", f.available_now ? "" : "1")}>
              ● Available now
            </button>
            <button className={`chip ${f.quote ? "on" : ""}`} onClick={() => set("quote", f.quote ? "" : "1")}>
              Quote on request
            </button>
            <select className="select" style={{ width: "auto" }} value={f.sort} onChange={(e) => set("sort", e.target.value)} aria-label="Sort">
              <option value="rating">Top rated</option>
              <option value="price">Price: low first</option>
              <option value="available">Available first</option>
              <option value="gigs">Most gigs</option>
            </select>
          </>
        )}
        {activeChips.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setParams({}, { replace: true })}>Clear ✕</button>
        )}
      </div>

      <div className="row between mt-2" style={{ marginBottom: 12 }}>
        <span className="small muted">
          {loading
            ? "Searching…"
            : view === "bookable"
              ? `${artists.length} act${artists.length === 1 ? "" : "s"}${f.date ? ` free on ${f.date}` : ""}`
              : `${dirTotal} unclaimed profile${dirTotal === 1 ? "" : "s"} in the directory`}
        </span>
        <span className="small muted">
          {view === "bookable"
            ? "Every listing shows fixed packages — or quote-per-gig."
            : "Sourced from Wikipedia, MusicBrainz and public event listings. Contact details stay private until the artist claims or replies."}
        </span>
      </div>

      {loading ? (
        <div className="grid grid-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card" style={{ height: 250 }}>
              <div className="skeleton" style={{ height: 90, marginBottom: 14 }} />
              <div className="skeleton" style={{ width: "60%", marginBottom: 9 }} />
              <div className="skeleton" style={{ width: "90%", marginBottom: 9 }} />
              <div className="skeleton" style={{ width: "40%" }} />
            </div>
          ))}
        </div>
      ) : view === "bookable" ? (
        artists.length === 0 ? (
          <Empty title="No acts match those filters">
            Try a wider budget or clear the date — or{" "}
            <Link to="/need" style={{ textDecoration: "underline" }}>post a gig request</Link>{" "}
            and we'll invite the best matches for you.
          </Empty>
        ) : (
          <div className="grid grid-3">
            {artists.map((a) => <ArtistCard key={a.id} a={a} />)}
          </div>
        )
      ) : directory.length === 0 ? (
        <Empty title="No discovered acts match yet">
          The Talent Radar runs daily at 03:00 and adds performers from public sources.{" "}
          <Link to="/list-your-act" style={{ textDecoration: "underline" }}>List your act</Link> to be found immediately.
        </Empty>
      ) : (
        <div className="grid grid-3">
          {directory.map((t) => <DirectoryCard key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}
