import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { INR, CATS, Stars, Badge, Avatar, Empty, SignInLink, ShareRow, usePageMeta } from "../ui.jsx";

const KIND_ICONS = { video: "🎬", music: "🎧", press: "📰", image: "📸", link: "🔗" };
const KIND_LABELS = { video: "Video", music: "Audio", press: "Press", image: "Gallery", link: "Link" };

// Section order per layout variant — same content, different editorial voice.
const VARIANT_ORDER = {
  editorial: ["about", "portfolio", "packages", "credits", "reviews"],
  showreel: ["portfolio", "about", "packages", "reviews", "credits"],
  gallery: ["portfolio", "about", "packages", "reviews", "credits"],
  credits: ["credits", "about", "portfolio", "packages", "reviews"],
  service: ["packages", "about", "portfolio", "credits", "reviews"],
};

const instagramUrl = (v) => {
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://instagram.com/${v.replace(/^@/, "")}`;
};
const youtubeUrl = (v) => {
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://youtube.com/@${v.replace(/^[@/]/, "")}`;
};

export default function ArtistProfile() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(null);

  useEffect(() => {
    setData(null);
    api(`/api/artists/${slug}`)
      .then((d) => { setData(d); setSel(d.packages[0] || null); })
      .catch((e) => setErr(e.message));
  }, [slug]);

  const a = data?.artist;
  const accentHue = Number(a?.accent_hue) > 0 ? Number(a.accent_hue) : Number(a?.hue || 265);
  usePageMeta(
    a ? `${a.stage_name} — ${CATS[a.category]?.label || "Artist"} in ${a.city} | Mehfil` : null,
    a
      ? `Book ${a.stage_name} for your event in ${a.city}. ${a.base_price_inr ? `Packages from ${INR(a.base_price_inr)}. ` : ""}Verified profile, escrow-protected booking and real availability.`
      : null
  );

  // Portfolio: real items the act added, videos first. Empty → nothing invented.
  const items = useMemo(() => {
    const list = Array.isArray(a?.portfolio_items) ? a.portfolio_items.filter((p) => p?.title || p?.url) : [];
    const rank = { video: 0, music: 1, press: 2, image: 3, link: 4 };
    return [...list].sort((x, y) => (rank[x.kind] ?? 5) - (rank[y.kind] ?? 5));
  }, [a]);

  if (err) {
    return (
      <div className="wrap section">
        <Empty icon="🔍" title={err}>
          <Link to="/discover" style={{ textDecoration: "underline" }}>Back to discovery</Link>
        </Empty>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="wrap section">
        <div className="skeleton" style={{ height: 200, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }

  const { packages, reviews, contact_visible } = data;
  const isOwner = session?.artist?.id === a.id;
  const variant = VARIANT_ORDER[a.layout_variant] ? a.layout_variant : "editorial";

  const links = [
    a.website && { label: "Website", href: a.website, icon: "🌐" },
    instagramUrl(a.instagram) && { label: "Instagram", href: instagramUrl(a.instagram), icon: "📸" },
    youtubeUrl(a.youtube) && { label: "YouTube", href: youtubeUrl(a.youtube), icon: "🎬" },
    a.portfolio_url && { label: "Portfolio", href: a.portfolio_url, icon: "🗂️" },
  ].filter(Boolean);

  const bookNow = () => {
    if (!session?.user) return; // SignInLink handles it
    nav(`/book/${sel.id}`);
  };

  const Section = ({ name, children }) => (
    <div className="pf-section" id={name}>{children}</div>
  );

  const about = (
    <Section name="about">
      <h3>About</h3>
      <p className="muted" style={{ margin: "10px 0 0", whiteSpace: "pre-line" }}>{a.bio || "No bio yet."}</p>
      {a.sub_skills.length > 0 && (
        <div className="row wrapline mt-2" style={{ gap: 7 }}>
          {a.sub_skills.map((s) => <span key={s} className="tag">{s}</span>)}
        </div>
      )}
      {a.press_note && (
        <p className="small mt-2 mb-0" style={{ color: "var(--text-2)" }}>
          <b>In their words:</b> {a.press_note}
        </p>
      )}
    </Section>
  );

  const portfolio = (
    <Section name="portfolio">
      <div className="row between wrapline">
        <h3>Selected work</h3>
        {a.portfolio_url && (
          <a className="small" style={{ color: "var(--accent)", fontWeight: 600 }} href={a.portfolio_url} target="_blank" rel="noreferrer">
            Full portfolio ↗
          </a>
        )}
      </div>
      {items.length ? (
        <div className="pf-portfolio mt-2">
          {items.map((p, i) => {
            const inner = (
              <>
                <span className="k">{KIND_LABELS[p.kind] || "Work"} {KIND_ICONS[p.kind] || ""}</span>
                <span className="t">{p.title || p.url}</span>
                {p.note && <span className="n">{p.note}</span>}
                {p.url && <span className="go">Open ↗</span>}
              </>
            );
            return p.url ? (
              <a key={i} className="pf-item" href={p.url} target="_blank" rel="noreferrer">{inner}</a>
            ) : (
              <div key={i} className="pf-item">{inner}</div>
            );
          })}
        </div>
      ) : (
        <p className="small muted mt-2 mb-0">
          {isOwner
            ? "No work items yet — add videos, tracks, press links or a gallery from the Artist desk. Real work is what converts a host."
            : "This act hasn't added portfolio items yet."}
        </p>
      )}
    </Section>
  );

  const credits = (
    <Section name="credits">
      <h3>Credits & facts</h3>
      <div className="pf-credits mt-2">
        <div className="pf-credit"><div className="n">{a.gigs_done}</div><div className="l">gigs performed</div></div>
        <div className="pf-credit"><div className="n">{a.experience_years} yrs</div><div className="l">performing</div></div>
        <div className="pf-credit"><div className="n">{a.rating ? a.rating.toFixed(1) : "—"}</div><div className="l">rating ({a.reviews_count})</div></div>
        <div className="pf-credit"><div className="n">~{a.response_mins < 60 ? `${a.response_mins}m` : "1h"}</div><div className="l">reply time</div></div>
      </div>
      {a.rider_note && (
        <p className="small muted mt-2 mb-0"><b>Rider:</b> {a.rider_note}</p>
      )}
    </Section>
  );

  const packagesSection = (
    <Section name="packages">
      <div className="row between wrapline">
        <h3>{packages.length ? "Packages" : "Booking"}</h3>
        <span className="small muted">
          {packages.length ? "Fixed prices — no quote-and-wait" : "Quotes per brief"}
        </span>
      </div>
      {!packages.length && (
        <div className="note note-info mt-2">
          This act takes gigs by request: send the date, city and brief, and they reply with availability and a quote.
          <div className="mt-2">
            <Link to={`/need?artist=${a.slug}`} className="btn btn-primary btn-sm">Send a gig request →</Link>
          </div>
        </div>
      )}
      <div className="stack mt-2">
        {packages.map((p) => (
          <div
            key={p.id}
            className="package"
            style={{ borderColor: sel?.id === p.id ? "var(--accent)" : undefined, boxShadow: sel?.id === p.id ? `hsla(${accentHue}, 62%, 46%, 0.16) 0 0 0 3px` : undefined }}
            onClick={() => setSel(p)}
          >
            <div className="row between">
              <strong>{p.name}</strong>
              <span className="price" style={{ fontSize: 19 }}>{INR(p.price_inr)}</span>
            </div>
            <div className="small muted">{p.description} · {p.duration_hours} hrs</div>
            <ul className="inclusions">
              {p.inclusions.map((i) => <li key={i}>{i}</li>)}
            </ul>
            <div className="mt-2">
              <button
                className={`btn btn-sm ${sel?.id === p.id ? "btn-primary" : "btn-ghost"}`}
                onClick={(e) => { e.stopPropagation(); setSel(p); }}
              >
                {sel?.id === p.id ? "✓ Selected" : "Select"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );

  const reviewsSection = (
    <Section name="reviews">
      <div className="row between">
        <h3>Reviews</h3>
        <Stars value={a.rating} count={a.reviews_count} />
      </div>
      <div className="mt-1">
        {reviews.map((r) => (
          <div key={r.id} className="review">
            <div className="row between">
              <strong className="small">{r.reviewer_name}</strong>
              <Stars value={r.rating} />
            </div>
            <p className="small muted" style={{ margin: "5px 0 0" }}>{r.comment}</p>
            <div className="tiny muted">{r.created_at.slice(0, 10)}</div>
          </div>
        ))}
        {!reviews.length && <Empty title="No reviews yet" />}
      </div>
    </Section>
  );

  const SECTIONS = { about, portfolio: portfolio, credits, packages: packagesSection, reviews: reviewsSection };

  return (
    <div className="pf wrap section" style={{ ["--accent"]: `hsl(${accentHue}, 62%, 46%)`, ["--accent-h"]: accentHue }}>
      {isOwner && (
        <div className="pf-owner">
          <span>🎨 <b>This is your public page.</b> Make it yours — layout, accent, tagline, portfolio.</span>
          <Link to="/dashboard?tab=design" className="btn btn-primary btn-sm">Customize profile</Link>
        </div>
      )}

      <div className="layout-2">
        <div className="pf-paper">
          <div className="pf-stripe" />
          <div className="pf-head">
            <Avatar name={a.stage_name} hue={accentHue} size="avatar-xl" />
            <div className="grow">
              <div className="row wrapline" style={{ gap: 8 }}>
                <h1>{a.stage_name}</h1>
                {a.verified && <Badge kind="verified" />}
                {a.founding_artist && <Badge kind="founding" />}
                {Number(a.available_now) ? <span className="badge badge-new">● Available now</span> : null}
                {Number(a.accepting_requests) === 0 ? <span className="tag">Not taking requests</span> : null}
              </div>
              {a.tagline && <div className="pf-tagline">“{a.tagline}”</div>}
              <div className="small muted mt-1">
                {CATS[a.category]?.label} · {a.area ? `${a.area}, ` : ""}{a.city} · travels {a.travel_radius_km} km ·{" "}
                {a.languages.join(", ")}
              </div>
              {links.length > 0 && (
                <div className="pf-links mt-2">
                  {links.map((l) => (
                    <a key={l.label} className="pf-link" href={l.href} target="_blank" rel="noreferrer">
                      <span>{l.icon}</span> {l.label} ↗
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="pf-factbar">
            <div><div className="n">{a.rating ? a.rating.toFixed(1) : "—"}</div><div className="l">rating</div></div>
            <div><div className="n">{a.gigs_done}</div><div className="l">gigs done</div></div>
            <div>
              <div className="n" style={{ fontSize: a.base_price_inr > 0 ? undefined : 15 }}>
                {a.base_price_inr > 0 ? INR(a.base_price_inr) : "On request"}
              </div>
              <div className="l">{a.base_price_inr > 0 ? "starting from" : "quote per gig"}</div>
            </div>
            <div><div className="n">~{a.response_mins < 60 ? `${a.response_mins}m` : "1h"}</div><div className="l">replies in</div></div>
            <div><div className="n" style={{ textTransform: "capitalize" }}>{a.cancellation_policy}</div><div className="l">cancellation</div></div>
          </div>
          {VARIANT_ORDER[variant].map((name) => <div key={name}>{SECTIONS[name]}</div>)}
        </div>

        <div className="side sticky-side stack" style={{ gap: 14 }}>
          <div className="card">
            {/* Mobile puts the booking card above the profile, so it carries
                its own identity strip — never show a price for a stranger. */}
            <div className="side-id">
              <Avatar name={a.stage_name} hue={accentHue} size="avatar-lg" />
              <div className="grow">
                <div className="row wrapline" style={{ gap: 6 }}>
                  <h2 style={{ fontSize: "1.15rem", margin: 0 }}>{a.stage_name}</h2>
                  {a.verified && <Badge kind="verified" />}
                </div>
                <div className="small muted">
                  {CATS[a.category]?.label} · {a.city}
                </div>
              </div>
            </div>
            <div className="row between">
              <span className="small muted">{sel ? "Selected package" : "Booking"}</span>
              <span className="small muted">{sel ? `${sel.duration_hours} hrs` : ""}</span>
            </div>
            <div className="mt-1" style={{ fontWeight: 700 }}>{sel?.name || "Ask for a quote"}</div>
            <div className="price" style={{ fontSize: sel ? 30 : 20 }}>
              {sel ? INR(sel.price_inr) : "Availability + quote"}
            </div>
            <div className="small muted mb-0">
              {sel ? (
                <>
                  + {INR(Math.round(sel.price_inr * 0.11))} platform fee (5% host + 6% artist).
                  {" "}{INR(Math.round(sel.price_inr * 0.4))} advance goes into escrow today.
                </>
              ) : (
                <>Send one brief — the act replies with availability and a price. No fee to ask.</>
              )}
            </div>
            <div className="mt-2 stack">
              {isOwner ? (
                <Link to="/dashboard" className="btn btn-primary btn-block">This is you — open Artist desk</Link>
              ) : sel ? (
                session?.user ? (
                  <button className="btn btn-primary btn-block" onClick={bookNow}>Instant book</button>
                ) : (
                  <SignInLink returnTo={`/artist/${a.slug}`} className="btn btn-primary btn-block">Sign in to book</SignInLink>
                )
              ) : (
                <Link to={`/need?artist=${a.slug}`} className="btn btn-primary btn-block">Send a gig request →</Link>
              )}
              <Link to={`/discover?category=${a.category}&city=${a.city}`} className="btn btn-ghost btn-block">
                Similar {CATS[a.category]?.label}s in {a.city}
              </Link>
              <Link to={`/match`} className="btn btn-ghost btn-block">
                ⚡ Quick-match deck
              </Link>
            </div>
            <ShareRow
              path={`/artist/${a.slug}`}
              text={`${a.stage_name} — ${CATS[a.category]?.label || "Artist"} in ${a.city} on Mehfil`}
            />
          </div>

          <div className="card">
            <strong className="small">Contact</strong>
            <p className="small muted" style={{ margin: "6px 0 0" }}>
              {contact_visible ? (
                <>Number unlocked — you have a paid booking with this artist.</>
              ) : (
                <>Phone stays <strong>masked until a booking is paid</strong> — that protection is the point.</>
              )}
            </p>
          </div>

          <div className="note">
            <strong>Protection only on-platform:</strong> escrow, contracts and dispute cover apply
            to bookings paid through Mehfil. Deals taken outside the app aren't covered.
          </div>

          <div className="card card-flat">
            <strong className="small">Cancellation — {a.cancellation_policy}</strong>
            <p className="small muted" style={{ margin: "6px 0 0" }}>
              {a.cancellation_policy === "flexible" && "Full refund 7+ days out, 50% within a week."}
              {a.cancellation_policy === "moderate" && "Full refund 14+ days out, 50% from 7–14 days, none inside a week."}
              {a.cancellation_policy === "strict" && "50% refund 21+ days out, none inside three weeks."}
              {" "}Artist cancellations always refund the advance in full.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
