import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { INR, StatusPill, Avatar, Stars, Empty, SignInLink } from "../ui.jsx";

const TL_CLASS = {
  booked: "warn", escrow_held: "warn", confirmed: "ok", checked_in: "ok",
  completed: "ok", escrow_released: "ok", cancelled: "bad", refunded: "ok",
  disputed: "bad", review_left: "ok",
};
const TL_LABEL = {
  booked: "Booked & escrow funded", escrow_held: "Escrow held", confirmed: "Artist confirmed",
  checked_in: "Checked in at venue", completed: "Host confirmed performance",
  escrow_released: "Escrow released", cancelled: "Cancelled", refunded: "Refund issued",
  disputed: "Dispute raised", review_left: "Review left",
};

export default function BookingDetail() {
  const { id } = useParams();
  const { session, notify, refresh } = useSession();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState({ rating: 5, comment: "" });
  const [showReview, setShowReview] = useState(false);

  const load = () => api(`/api/bookings/${id}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line

  if (err) return <div className="wrap section"><Empty icon="🔒" title={err}><Link to="/bookings">Back to bookings</Link></Empty></div>;
  if (!d) return <div className="wrap section"><div className="skeleton" style={{ height: 320 }} /></div>;

  const { booking: b, events, contract, viewer } = d;
  const asHost = viewer === "host";
  const canReview = b.status === "completed" && ((asHost && !b.host_reviewed) || (!asHost && !b.artist_reviewed));

  const act = async (action) => {
    setBusy(true);
    try {
      await api(`/api/bookings/${b.id}/action`, { method: "POST", body: JSON.stringify({ action }) });
      notify(action === "complete" ? "Confirmed — escrow released to the artist." : "Updated.");
      await load();
      await refresh();
    } catch (e) {
      notify(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const submitReview = async () => {
    setBusy(true);
    try {
      await api(`/api/bookings/${b.id}/review`, { method: "POST", body: JSON.stringify(review) });
      notify("Review published — it counts toward verified reputation.");
      setShowReview(false);
      await load();
    } catch (e) {
      notify(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const hostActions = [];
  const artistActions = [];
  if (asHost) {
    if (["pending", "confirmed"].includes(b.status)) hostActions.push(["cancel", "Cancel booking", "btn-danger"]);
    if (b.status === "confirmed") hostActions.push(["complete", "Confirm performance & release escrow", "btn-primary"]);
    if (["pending", "confirmed"].includes(b.status) && b.event_date <= new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10))
      hostActions.push(["dispute", "Raise dispute", "btn-danger"]);
  } else {
    if (b.status === "pending") artistActions.push(["accept", "Accept booking", "btn-primary"], ["decline", "Decline", "btn-danger"]);
    if (b.status === "confirmed") artistActions.push(["checkin", "Check in at venue", "btn-primary"], ["cancel", "Cancel (full refund to host)", "btn-danger"]);
  }

  return (
    <div className="wrap section" style={{ maxWidth: 960 }}>
      <div className="row between wrapline">
        <div className="row">
          <Avatar name={b.artist_name} hue={b.artist_hue} size="avatar-lg" />
          <div>
            <div className="kicker">{asHost ? "Your booking" : "Incoming request"} · {b.event_type}</div>
            <h2>{b.package_name}</h2>
            <div className="small muted">
              with <Link to={`/artist/${b.artist_slug || ""}`}>{b.artist_name}</Link> · {b.event_date} {b.start_time} · {b.venue || b.city}
            </div>
          </div>
        </div>
        <StatusPill status={b.status} escrow={b.escrow} />
      </div>

      <div className="layout-2 mt-3">
        <div className="stack" style={{ gap: 20 }}>
          <div className="escrow-box">
            <div className="lbl">Escrow status</div>
            <div className="amount">
              {b.escrow === "held" ? `${INR(b.advance_inr)} held` :
               b.escrow === "released" ? "Released to artist" :
               b.escrow === "refunded" ? "Refunded to host" :
               b.escrow === "frozen" ? "Frozen — dispute open" : "No escrow"}
            </div>
            <p className="small" style={{ color: "#cbbde0", margin: "6px 0 0" }}>
              {b.escrow === "held" && "Mehfil holds the advance. It moves only when the show is confirmed (or per the cancellation policy)."}
              {b.escrow === "released" && `Advance released after the event; balance ${INR(b.amount_inr - b.advance_inr)} per agreement.`}
              {b.escrow === "refunded" && "Returned to the host under the cancellation policy."}
              {b.escrow === "frozen" && "Ops is reviewing the timeline; funds move neither way until resolved."}
            </p>
          </div>

          <div className="card">
            <div className="row between">
              <h3>Timeline</h3>
              <span className="small muted">Contract auto-generated at booking</span>
            </div>
            <div className="timeline mt-2">
              {events.map((e) => (
                <div key={e.id} className={`tl-item ${TL_CLASS[e.type] || ""}`}>
                  <div className="what">{TL_LABEL[e.type] || e.type}</div>
                  {e.note && <div className="note">{e.note}</div>}
                  <div className="when">{e.created_at}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>Event brief</h3>
            <div className="grid grid-2 mt-2" style={{ gap: 10 }}>
              {Object.entries({
                "Sound": b.brief?.sound, "Power": b.brief?.power,
                "Must-plays": b.brief?.songs, "Dress": b.brief?.dress,
                "Guests": String(b.guest_count), "Notes": b.brief?.notes,
              }).map(([k, v]) => v && (
                <div key={k} className="card-flat" style={{ padding: 12 }}>
                  <div className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>{k}</div>
                  <div className="small">{v}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>Contract terms</h3>
            <div className="small muted stack mt-1" style={{ gap: 7 }}>
              <div><strong>Scope:</strong> {contract.scope}</div>
              <div><strong>Payment:</strong> {contract.payment}</div>
              <div><strong>Cancellation:</strong> {contract.cancellation}</div>
              <div><strong>Liability:</strong> {contract.liability}</div>
              <div><strong>Disputes:</strong> {contract.dispute}</div>
            </div>
          </div>
        </div>

        <div className="side sticky-side stack" style={{ gap: 14 }}>
          <div className="card">
            <div className="row between">
              <span className="small muted">Total</span>
              <span className="price" style={{ fontSize: 20 }}>{INR(b.amount_inr)}</span>
            </div>
            <div className="row between small muted">
              <span>Advance in escrow</span><span>{INR(b.advance_inr)}</span>
            </div>
            <div className="row between small muted">
              <span>Platform fee</span><span>{INR(b.fee_inr)}</span>
            </div>
            <div className="row between small muted">
              <span>Policy</span><span style={{ textTransform: "capitalize" }}>{b.policy}</span>
            </div>
          </div>

          {(hostActions.length > 0 || artistActions.length > 0) && (
            <div className="card stack">
              <strong className="small">{asHost ? "Your move" : "Artist actions"}</strong>
              {(asHost ? hostActions : artistActions).map(([action, label, cls]) => (
                <button key={action} className={`btn btn-block ${cls}`} disabled={busy} onClick={() => act(action)}>
                  {label}
                </button>
              ))}
              {!asHost && b.status === "confirmed" && (
                <p className="tiny muted" style={{ margin: 0 }}>
                  Check in on arrival — it's the host's trigger to release escrow.
                </p>
              )}
            </div>
          )}

          {canReview && !showReview && (
            <button className="btn btn-primary btn-block" onClick={() => setShowReview(true)}>
              Leave a review
            </button>
          )}

          {showReview && (
            <div className="card stack">
              <strong className="small">Rate this {asHost ? "artist" : "host"}</strong>
              <div className="row" style={{ gap: 4, fontSize: 26 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setReview((r) => ({ ...r, rating: n }))}
                    style={{ border: "none", background: "none", color: n <= review.rating ? "var(--marigold-deep)" : "#d8d0c4", fontSize: 26 }}
                    aria-label={`${n} stars`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <textarea className="textarea" placeholder="What stood out?" value={review.comment} onChange={(e) => setReview((r) => ({ ...r, comment: e.target.value }))} />
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={submitReview}>Publish review</button>
            </div>
          )}

          {(b.host_reviewed || b.artist_reviewed) && b.status === "completed" && (
            <div className="note note-info small">
              Reviews exchanged ✓ — reputation updated on both sides.
            </div>
          )}

          <Link to="/bookings" className="btn btn-ghost btn-block">← All bookings</Link>
        </div>
      </div>
    </div>
  );
}
