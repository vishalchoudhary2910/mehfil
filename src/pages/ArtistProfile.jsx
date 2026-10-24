import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../session.jsx";
import { useSession } from "../session.jsx";
import { INR, CATS, Stars, Badge, Avatar, Empty, SignInLink } from "../ui.jsx";

function SampleRow({ label, kind }) {
  const icons = { video: "🎬", audio: "🎧", post: "📸" };
  return (
    <div className="row" style={{ padding: "9px 0", borderTop: "1px dashed var(--line)" }}>
      <span style={{ fontSize: 19 }}>{icons[kind] || "🎵"}</span>
      <span className="grow small" style={{ fontWeight: 500 }}>{label}</span>
      <span className="tag">{kind}</span>
      <button className="btn btn-ghost btn-sm" onClick={() => alert("Samples open on the live site — this demo ships with written set histories.")}>
        ▶ Play
      </button>
    </div>
  );
}

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

  const { artist: a, packages, reviews, contact_visible } = data;
  const isOwner = session?.artist?.id === a.id;

  const bookNow = () => {
    if (!session?.user) {
      nav(`/artist/${a.slug}`); // stay; sign-in link handles it
      return;
    }
    nav(`/book/${sel.id}`);
  };

  return (
    <>
      <section className="profile-hero">
        <div className="wrap">
          <div className="who">
            <Avatar name={a.stage_name} hue={a.hue} size="avatar-xl" />
            <div className="grow">
              <div className="row wrapline" style={{ gap: 8 }}>
                <h1>{a.stage_name}</h1>
                {a.verified && <Badge kind="verified" />}
                {a.founding_artist && <Badge kind="founding" />}
                {Number(a.available_now) ? <span className="badge badge-new">● Available now</span> : null}
                {Number(a.accepting_requests) === 0 ? <span className="tag">Not taking requests</span> : null}
              </div>
              <div className="meta mt-1">
                {CATS[a.category]?.label} · {a.city} · travels {a.travel_radius_km} km ·
                replies in ~{a.response_mins} min · {a.experience_years} yrs exp
              </div>
              <div className="row wrapline mt-1" style={{ gap: 8 }}>
                {a.languages.map((l) => <span key={l} className="pill" style={{ border: "1px solid rgba(255,255,255,0.25)", borderRadius: 999, padding: "3px 11px", fontSize: 12.5, color: "#e8ddf8" }}>{l}</span>)}
              </div>
            </div>
          </div>
          <div className="profile-stats">
            <div><div className="n">{a.rating ? a.rating.toFixed(1) : "—"}</div><div className="l">rating ({a.reviews_count})</div></div>
            <div><div className="n">{a.gigs_done}</div><div className="l">gigs done</div></div>
            <div>
              <div className="n" style={{ fontSize: a.base_price_inr > 0 ? undefined : 18 }}>
                {a.base_price_inr > 0 ? INR(a.base_price_inr) : "Quote"}
              </div>
              <div className="l">{a.base_price_inr > 0 ? "starting from" : "per gig, on request"}</div>
            </div>
            <div><div className="n" style={{ textTransform: "capitalize" }}>{a.cancellation_policy}</div><div className="l">cancellation policy</div></div>
          </div>
        </div>
      </section>

      <div className="wrap section" style={{ paddingTop: 26 }}>
        <div className="layout-2">
          <div className="stack" style={{ gap: 26 }}>
            <div className="card">
              <h3>About</h3>
              <p className="muted" style={{ marginTop: 8 }}>{a.bio}</p>
              <div className="row wrapline" style={{ gap: 7 }}>
                {a.sub_skills.map((s) => <span key={s} className="tag">{s}</span>)}
              </div>
              {(a.instagram || a.youtube || a.portfolio_url) && (
                <p className="small muted mt-2 mb-0">
                  {a.instagram && <>Instagram: {a.instagram.startsWith("http") ? <a href={a.instagram} target="_blank" rel="noreferrer">{a.instagram}</a> : a.instagram}</>}
                  {a.youtube && <> · YouTube: {a.youtube}</>}
                  {a.portfolio_url && <> · <a href={a.portfolio_url} target="_blank" rel="noreferrer">Portfolio</a></>}
                </p>
              )}
            </div>

            <div className="card">
              <div className="row between">
                <h3>{packages.length ? "Packages" : "Booking"}</h3>
                <span className="small muted">
                  {packages.length ? "Fixed prices — no quote-and-wait" : "Freelance — quotes per brief"}
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
                    style={{ borderColor: sel?.id === p.id ? "var(--marigold)" : undefined, boxShadow: sel?.id === p.id ? "0 0 0 3px rgba(245,166,35,0.18)" : undefined }}
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
            </div>

            <div className="card">
              <h3>Samples & past work</h3>
              <div className="mt-1">
                <SampleRow label={`Live at a ${a.city} ${a.category === "dj" ? "club night" : "private event"} — full set`} kind="video" />
                <SampleRow label={`${a.sub_skills[0] || "Signature"} medley excerpt`} kind="audio" />
                <SampleRow label={`Crowd reel from ${a.gigs_done}+ booked gigs`} kind="post" />
              </div>
            </div>

            <div className="card">
              <div className="row between">
                <h3>Reviews</h3>
                <Stars value={a.rating} count={a.reviews_count} />
              </div>
              <div className="mt-2">
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
            </div>
          </div>

          <div className="side sticky-side stack" style={{ gap: 14 }}>
            <div className="card">
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
              </div>
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
    </>
  );
}
