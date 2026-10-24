import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { INR, CATS, StatusPill, Empty, Stars, Avatar } from "../ui.jsx";

export default function Dashboard() {
  const { session, notify } = useSession();
  const [d, setD] = useState(null);
  const [invites, setInvites] = useState(null);
  const [avail, setAvail] = useState(null);
  const [tab, setTab] = useState("requests");
  const [busy, setBusy] = useState(false);

  const load = () => api("/api/artist/bookings").then(setD).catch(() => setD({ error: true }));
  const loadInvites = () =>
    api("/api/request-invites")
      .then((r) => { setInvites(r.invites); setAvail(r.artist); })
      .catch(() => { setInvites([]); setAvail(null); });
  useEffect(() => { load(); loadInvites(); }, []); // eslint-disable-line

  const toggleAvail = async (key) => {
    setBusy(true);
    try {
      const next = { ...avail, [key]: !avail?.[key] };
      const r = await api("/api/artist/availability", { method: "POST", body: JSON.stringify({ [key]: next[key] }) });
      setAvail((a) => ({ ...a, ...r.artist }));
      notify(key === "available_now" ? (next.available_now ? "You're marked available for gigs now." : "Availability hidden.") : (next.accepting_requests ? "Accepting gig requests." : "Requests paused."));
    } catch (e) { notify(e.message, "err"); }
    setBusy(false);
  };

  if (!session?.artist) {
    return (
      <div className="wrap section center" style={{ maxWidth: 560 }}>
        <h2>Artist desk</h2>
        <p className="muted">You need an artist profile first — it takes under 10 minutes.</p>
        <Link to="/join" className="btn btn-primary">Create my artist profile</Link>
      </div>
    );
  }
  if (d?.error) return <div className="wrap section"><Empty title="Couldn't load the desk" /></div>;
  if (!d) return <div className="wrap section"><div className="skeleton" style={{ height: 260 }} /></div>;

  const { artist: a, bookings, stats, reviews } = d;
  const incoming = bookings.filter((b) => b.status === "pending");
  const upcoming = bookings.filter((b) => b.status === "confirmed");
  const done = bookings.filter((b) => ["completed", "cancelled", "disputed"].includes(b.status));

  const act = async (id, action) => {
    setBusy(true);
    try {
      await api(`/api/bookings/${id}/action`, { method: "POST", body: JSON.stringify({ action }) });
      notify(action === "accept" ? "Accepted — the host will see it immediately." : "Declined — advance refunded to the host.");
      await load();
    } catch (e) {
      notify(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ b, actions }) => (
    <div className="booking-row">
      <Avatar name={b.host_name || "Host"} hue={210} />
      <div className="grow">
        <div style={{ fontWeight: 650 }}>{b.package_name} · {b.host_name || "Host"}</div>
        <div className="small muted">{b.event_type} · {b.event_date} {b.start_time} · {b.venue || b.city} · {b.guest_count} guests</div>
      </div>
      <div className="stack" style={{ alignItems: "flex-end", gap: 5 }}>
        <span className="price">{INR(b.amount_inr)}</span>
        <StatusPill status={b.status} escrow={b.escrow} />
      </div>
      <div className="row" style={{ gap: 7 }}>
        {actions}
        <Link to={`/bookings/${b.id}`} className="btn btn-ghost btn-sm">Open</Link>
      </div>
    </div>
  );

  return (
    <div className="wrap section" style={{ maxWidth: 980 }}>
      <div className="row between wrapline">
        <div className="row">
          <Avatar name={a.stage_name} hue={a.hue} size="avatar-lg" />
          <div>
            <div className="kicker">Artist desk</div>
            <h2>{a.stage_name}</h2>
            <div className="small muted">
              {CATS[a.category]?.label} · {a.city} ·{" "}
              <Link to={`/artist/${a.slug}`} style={{ textDecoration: "underline" }}>view public profile →</Link>
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {a.verified === false && <span className="badge badge-new">Pending KYC</span>}
          <Link to="/collab" className="btn btn-ghost btn-sm">Collab board</Link>
        </div>
      </div>

      <div className="kpi-grid mt-3">
        <div className="kpi"><div className="n">{INR(stats.earned)}</div><div className="l">Earned (after 6% fee)</div></div>
        <div className="kpi"><div className="n">{INR(stats.in_escrow)}</div><div className="l">In escrow for you</div></div>
        <div className="kpi"><div className="n">{Number(stats.requests || 0)}</div><div className="l">New requests</div></div>
        <div className="kpi"><div className="n">{Number(stats.upcoming || 0)}</div><div className="l">Upcoming gigs</div></div>
        <div className="kpi"><div className="n">{a.rating ? a.rating.toFixed(1) : "—"}</div><div className="l">Rating ({a.reviews_count})</div></div>
      </div>

      <div className="tabs mt-3">
        {[["requests", `Requests (${incoming.length})`], ["gigs", `Gig requests (${(invites || []).length})`], ["upcoming", `Upcoming (${upcoming.length})`], ["done", `History (${done.length})`], ["reviews", "Reviews"]].map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === "gigs" && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="card">
            <div className="row between wrapline" style={{ gap: 8 }}>
              <div>
                <strong>Availability</strong>
                <div className="small muted">
                  {avail?.available_now ? "● Visible as available now" : "○ Not shown as available now"} ·{" "}
                  {avail?.accepting_requests ? "accepting gig requests" : "requests paused"}
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className={`btn btn-sm ${avail?.available_now ? "btn-primary" : "btn-ghost"}`} disabled={busy} onClick={() => toggleAvail("available_now")}>
                  {avail?.available_now ? "Available now ✓" : "Mark available now"}
                </button>
                <button className={`btn btn-sm ${avail?.accepting_requests ? "" : "btn-ghost"}`} disabled={busy} onClick={() => toggleAvail("accepting_requests")}>
                  {avail?.accepting_requests ? "Pause requests" : "Accept requests"}
                </button>
              </div>
            </div>
          </div>

          {invites === null ? <div className="skeleton" style={{ height: 120 }} /> : invites.length === 0 ? (
            <div className="card">
              <Empty icon="📨" title="No gig requests yet">
                When a host needs your act, the brief lands here with a one-tap availability reply. Keep "Available now" on to be matched first.
              </Empty>
            </div>
          ) : (
            invites.map((i) => (
              <div key={i.id} className="card">
                <div className="row between wrapline" style={{ gap: 10 }}>
                  <div>
                    <div className="row" style={{ gap: 8 }}>
                      <strong>{CATS[i.request_category]?.label || "Gig"} · {i.request_city}</strong>
                      <span className="tag">{i.status === "invited" || i.status === "viewed" ? "needs reply" : i.status}</span>
                      {i.quote_inr ? <span className="tag">₹{Number(i.quote_inr).toLocaleString("en-IN")}</span> : null}
                    </div>
                    <div className="small muted">
                      {i.request_date} {i.request_time} · {i.event_type || "live act"} · {i.request_area || i.request_city}
                      {i.budget_inr ? ` · budget ₹${Number(i.budget_inr).toLocaleString("en-IN")}` : " · budget open"}
                    </div>
                    {i.request_brief && <div className="small" style={{ marginTop: 4 }}>{i.request_brief}</div>}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <Link to={i.respond_url} className="btn btn-primary btn-sm">
                      {["invited", "viewed"].includes(i.status) ? "Reply availability" : "Update reply"}
                    </Link>
                    <Link to="/leads" className="btn btn-ghost btn-sm">Leads</Link>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "requests" && (
        <div className="card">
          {incoming.length ? incoming.map((b) => (
            <Row key={b.id} b={b} actions={
              <>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(b.id, "accept")}>Accept</button>
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => act(b.id, "decline")}>Decline</button>
              </>
            } />
          )) : (
            <Empty icon="📭" title="No new requests">
              Bookings routed to your profile land here. Share your profile link on Instagram to pull in your own clients.
            </Empty>
          )}
        </div>
      )}

      {tab === "upcoming" && (
        <div className="card">
          {upcoming.length ? upcoming.map((b) => (
            <Row key={b.id} b={b} actions={
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(b.id, "checkin")}>Check in</button>
            } />
          )) : (
            <Empty icon="🗓️" title="Nothing confirmed yet">Accept a request to lock the date.</Empty>
          )}
        </div>
      )}

      {tab === "done" && (
        <div className="card">
          {done.length ? done.map((b) => <Row key={b.id} b={b} actions={null} />) : (
            <Empty icon="🏁" title="No past gigs">Completed shows build your rebook rate and badge eligibility.</Empty>
          )}
        </div>
      )}

      {tab === "reviews" && (
        <div className="card">
          {reviews.length ? reviews.map((r) => (
            <div key={r.id} className="review">
              <div className="row between"><strong className="small">Host review</strong><Stars value={r.rating} /></div>
              <p className="small muted" style={{ margin: "5px 0 0" }}>{r.comment}</p>
            </div>
          )) : <Empty icon="💬" title="No reviews yet">Two-way reviews open after each completed gig.</Empty>}
        </div>
      )}

      <div className="note mt-3">
        <strong>Anti-leakage by design:</strong> escrow, contracts and review counts only accrue on
        bookings paid inside Mehfil. Clients who see your profile link in your Instagram bio land
        here — run them through it and your rating compounds.
      </div>
    </div>
  );
}
