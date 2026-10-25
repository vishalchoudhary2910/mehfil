import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { Avatar, Empty, INR, categoryLabel } from "../ui.jsx";

const CITIES = ["Pune", "Mumbai", "Jaipur", "Delhi", "Bengaluru", "Hyderabad", "Ahmedabad", "Indore"];

// ---------------------------------------------------------------- card ----

function TalentFace({ card }) {
  return (
    <>
      <div className="swipe-cover" style={{ ["--h"]: card.hue }}>
        <div className="swipe-kicker">{categoryLabel(card.category)}</div>
        <div className="swipe-name">{card.stage_name}</div>
        <div className="swipe-where">
          {card.area ? card.area + ", " : ""}
          {card.city}
          {card.verified && <span className="badge badge-verified" style={{ marginLeft: 8 }}>✓ Verified</span>}
        </div>
        {card.tagline && <div className="swipe-tagline">“{card.tagline}”</div>}
      </div>
      <div className="swipe-body">
        {card.bio && <p className="muted swipe-bio">{card.bio}</p>}
        {!!card.sub_skills?.length && (
          <div className="row wrapline" style={{ gap: 6 }}>
            {card.sub_skills.slice(0, 5).map((s) => <span key={s} className="tag">{s}</span>)}
          </div>
        )}
        <div className="swipe-stats">
          <div><b>{card.rating ? card.rating.toFixed(1) : "—"}</b><span>rating</span></div>
          <div><b>{card.gigs_done}</b><span>gigs</span></div>
          <div><b>{card.response_mins < 60 ? `${card.response_mins}m` : "1h+"}</b><span>replies in</span></div>
          <div>
            <b>{card.base_price_inr ? INR(card.base_price_inr) : "Quote"}</b>
            <span>{card.base_price_inr ? "from" : "on request"}</span>
          </div>
        </div>
        <div className="row between tiny muted">
          <span>{card.languages?.slice(0, 3).join(" · ") || "Languages on profile"}</span>
          <span>{card.available_now ? "● Available now" : "Schedule-based"}</span>
        </div>
      </div>
    </>
  );
}

function GigFace({ card }) {
  const days = card.days_until;
  return (
    <>
      <div className="swipe-cover" style={{ ["--h"]: 265 }}>
        <div className="swipe-kicker">
          {categoryLabel(card.category)} · {card.event_type || "Gig"}
        </div>
        <div className="swipe-name">{card.event_type || "Live gig"}</div>
        <div className="swipe-where">
          {card.area ? card.area + ", " : ""}
          {card.city} · {card.date} {card.start_time}
        </div>
        <div className="swipe-tagline">
          {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`} ·{" "}
          {card.host_name}
        </div>
      </div>
      <div className="swipe-body">
        {card.brief && <p className="muted swipe-bio">{card.brief}</p>}
        <div className="swipe-stats">
          <div>
            <b>{card.budget_inr ? INR(card.budget_inr) : "Open"}</b>
            <span>{card.budget_inr ? "budget" : "to quote"}</span>
          </div>
          <div><b>{card.guest_count}</b><span>guests</span></div>
          <div><b>{card.duration_hours}h</b><span>set</span></div>
          <div><b>{card.start_time}</b><span>doors</span></div>
        </div>
        <div className="row between tiny muted">
          <span className="tag">{card.category}</span>
          <span>Open request · host is watching</span>
        </div>
      </div>
    </>
  );
}

// -------------------------------------------------------------- deck ------

export default function Match() {
  const { notify } = useSession();
  const navigate = useNavigate();
  const [side, setSide] = useState("talent");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [cards, setCards] = useState([]);
  const [i, setI] = useState(0);
  const [meta, setMeta] = useState({ remaining: 0, swiped_today: 0, limit: 150, need_profile: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState(null);
  const [lastSwipe, setLastSwipe] = useState(null);
  const [drag, setDrag] = useState({ on: false, x: 0 });
  const dragRef = useRef({ startX: 0, moved: false });
  const navigateRef = navigate;

  const load = useCallback(async (sideKey, c, cat) => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set("side", sideKey);
      if (c) q.set("city", c);
      if (cat) q.set("category", cat);
      const res = await api(`/api/deck?${q}`);
      setCards(res.cards || []);
      setI(0);
      setMeta({
        remaining: res.remaining ?? 0,
        swiped_today: res.swiped_today ?? 0,
        limit: res.limit ?? 150,
        need_profile: !!res.need_profile,
      });
    } catch (e) {
      if (e.status !== 401) notify(e.message, "err");
    }
    setLoading(false);
  }, [notify]);

  useEffect(() => { load(side, city, category); }, [load, side, city, category]);

  const swipe = useCallback(async (dir) => {
    const card = cards[i];
    if (!card || busy) return;
    setBusy(true);
    try {
      const res = await api("/api/deck/swipe", {
        method: "POST",
        body: JSON.stringify({ side, target: card.id, dir }),
      });
      setLastSwipe(res.swipe?.id || null);
      setMeta((m) => ({ ...m, swiped_today: m.swiped_today + 1, remaining: Math.max(0, m.remaining - 1) }));
      setI((n) => n + 1);
      if (res.match) setMatch(res.match);
      // Pre-load the next batch before the stack runs dry.
      if (i + 3 >= cards.length) {
        const q = new URLSearchParams();
        q.set("side", side);
        if (city) q.set("city", city);
        if (category) q.set("category", category);
        api(`/api/deck?${q}`).then((r) => {
          setCards((prev) => [...prev, ...(r.cards || [])]);
          setMeta((m) => ({ ...m, remaining: r.remaining ?? m.remaining }));
        }).catch(() => null);
      }
    } catch (e) {
      notify(e.message, "err");
    }
    setBusy(false);
  }, [cards, i, busy, side, city, category, notify]);

  const undo = useCallback(async () => {
    if (!lastSwipe || busy) return;
    setBusy(true);
    try {
      await api("/api/deck/undo", { method: "POST", body: JSON.stringify({ swipe_id: lastSwipe }) });
      setLastSwipe(null);
      await load(side, city, category);
      notify("Swipe undone");
    } catch (e) {
      notify(e.message, "err");
    }
    setBusy(false);
  }, [lastSwipe, busy, side, city, category, load, notify]);

  // Keyboard: ← pass, → interested, u undo, Enter open detail.
  useEffect(() => {
    const onKey = (e) => {
      if (match) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "ArrowLeft") { e.preventDefault(); swipe("pass"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); swipe("like"); }
      else if (e.key === "u" || e.key === "z") { undo(); }
      else if (e.key === "Enter") {
        const card = cards[i];
        if (card?.link) navigateRef(card.link);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swipe, undo, cards, i, match, navigateRef]);

  // Pointer drag on the top card.
  const onDown = (e) => {
    if (busy || match) return;
    dragRef.current = { startX: e.clientX, moved: false };
    setDrag({ on: true, x: 0 });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag.on) return;
    const dx = e.clientX - dragRef.current.startX;
    if (Math.abs(dx) > 6) dragRef.current.moved = true;
    setDrag({ on: true, x: dx });
  };
  const onUp = () => {
    if (!drag.on) return;
    const dx = drag.x;
    setDrag({ on: false, x: 0 });
    if (Math.abs(dx) > 110) swipe(dx > 0 ? "like" : "pass");
  };

  const card = cards[i];
  const next1 = cards[i + 1];
  const next2 = cards[i + 2];
  const out = i >= cards.length;
  const tilt = drag.on ? Math.max(-14, Math.min(14, drag.x / 16)) : 0;

  return (
    <div className="wrap section match-page">
      <div className="section-head">
        <div>
          <div className="kicker">Quick match</div>
          <h2>Swipe into your next gig</h2>
          <p className="muted mb-0">
            Right (or →) to show interest, left (or ←) to pass, <b>u</b> to undo.
            A match opens a chat the moment you're both in.
          </p>
        </div>
        <div className="row wrapline" style={{ gap: 8 }}>
          <div className="role-switch">
            <button className={side === "talent" ? "on" : ""} onClick={() => setSide("talent")}>
              I'm hiring
            </button>
            <button className={side === "gig" ? "on" : ""} onClick={() => setSide("gig")}>
              I want gigs
            </button>
          </div>
        </div>
      </div>

      <div className="row wrapline match-filters">
        <select className="select" value={city} onChange={(e) => setCity(e.target.value)} style={{ maxWidth: 170 }}>
          <option value="">All cities</option>
          {CITIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 190 }}>
          <option value="">All acts</option>
          {["singer", "dj", "band", "dancer", "poet", "anchor", "instrumentalist"].map((k) => (
            <option key={k} value={k}>{categoryLabel(k)}</option>
          ))}
        </select>
        <span className="small muted tnum">
          {Math.min(meta.swiped_today, meta.limit)} / {meta.limit} swipes today · {meta.remaining} left in deck
        </span>
        {lastSwipe && (
          <button className="btn btn-ghost btn-sm" onClick={undo} disabled={busy}>↺ Undo</button>
        )}
        <Link to="/messages" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }}>
          💬 Matches
        </Link>
      </div>

      <div className="deck-zone">
        {loading ? (
          <div className="swipe-card skeleton-card"><div className="skeleton" style={{ height: 200 }} /></div>
        ) : meta.need_profile ? (
          <div className="swipe-card">
            <Empty icon="🎤" title="Set up your artist profile first">
              To swipe gigs you need a live profile — it's what hirers see when you match.
            </Empty>
            <div className="center mt-2">
              <Link to="/join" className="btn btn-primary">Create my profile</Link>
            </div>
          </div>
        ) : out ? (
          <div className="swipe-card">
            <Empty icon="✨" title={cards.length ? "That's everyone for now" : "No cards match these filters"}>
              {cards.length
                ? "New gigs and acts drop every day — widen your filters or check back soon."
                : "Try removing the city or act filter — or post your own gig brief so artists can swipe YOU."}
            </Empty>
            <div className="row center" style={{ justifyContent: "center", gap: 10, marginTop: 6 }}>
              <button className="btn btn-ghost" onClick={() => { setCity(""); setCategory(""); load(side, "", ""); }}>
                Reset filters
              </button>
              {side === "talent"
                ? <Link to="/need" className="btn btn-primary">Post a 60-second gig brief</Link>
                : <Link to="/discover" className="btn btn-primary">Browse talent instead</Link>}
            </div>
          </div>
        ) : (
          <>
            {next2 && (
              <div className="swipe-card behind-2" aria-hidden>
                {side === "talent" ? <TalentFace card={next2} /> : <GigFace card={next2} />}
              </div>
            )}
            {next1 && (
              <div className="swipe-card behind-1" aria-hidden>
                {side === "talent" ? <TalentFace card={next1} /> : <GigFace card={next1} />}
              </div>
            )}
            <div
              className={`swipe-card top ${drag.on ? "dragging" : ""}`}
              style={{ transform: `translateX(${drag.x}px) rotate(${tilt}deg)` }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <div className={`swipe-stamp like ${drag.x > 20 ? "show" : ""}`}>INTERESTED</div>
              <div className={`swipe-stamp pass ${drag.x < -20 ? "show" : ""}`}>PASS</div>
              <button
                className="swipe-open"
                title="Open full detail"
                onClick={(e) => {
                  if (dragRef.current.moved) return;
                  e.stopPropagation();
                  if (card?.link) navigate(card.link);
                }}
              />
              {side === "talent" ? <TalentFace card={card} /> : <GigFace card={card} />}
            </div>

            <div className="deck-actions">
              <button className="deck-btn pass" onClick={() => swipe("pass")} disabled={busy} aria-label="Pass">
                ✕
              </button>
              <button className="deck-btn info" onClick={() => card?.link && navigate(card.link)} aria-label="Open detail">
                ⓘ
              </button>
              <button className="deck-btn like" onClick={() => swipe("like")} disabled={busy} aria-label="Interested">
                ♥
              </button>
            </div>
            <p className="tiny muted center" style={{ marginTop: 10 }}>
              Buttons work, drag works, arrows work — interest is private until it's mutual.
            </p>
          </>
        )}
      </div>

      {match && (
        <div className="match-overlay" role="dialog" aria-modal="true">
          <div className="match-card">
            <div className="match-burst" aria-hidden>✦</div>
            <h2>It's a match!</h2>
            <p className="muted">
              You and <b>{match.other.stage_name || match.other.name}</b> liked each other.
              The chat is open — the first reply within the hour books the gig.
            </p>
            <div className="row center" style={{ justifyContent: "center", gap: 10, marginTop: 8 }}>
              <Avatar name={match.other.stage_name || match.other.name} hue={match.other.hue} size="avatar-xl" />
            </div>
            <div className="row center match-cta" style={{ justifyContent: "center", gap: 10, marginTop: 18 }}>
              <button
                className="btn btn-primary"
                onClick={() => { setMatch(null); navigate(`/messages/${match.thread_id}`); }}
              >
                Say hi now
              </button>
              {match.other.slug && (
                <Link to={`/artist/${match.other.slug}`} className="btn btn-ghost" onClick={() => setMatch(null)}>
                  View profile
                </Link>
              )}
              <button className="btn btn-ghost" onClick={() => setMatch(null)}>Keep swiping</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
