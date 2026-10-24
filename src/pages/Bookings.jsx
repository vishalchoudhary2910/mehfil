import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../session.jsx";
import { INR, CATS, StatusPill, Empty, Avatar } from "../ui.jsx";

export default function Bookings() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api("/api/bookings").then((d) => setData(d.bookings)).catch(() => setData([]));
  }, []);

  if (data === null) return <div className="wrap section"><div className="skeleton" style={{ height: 240 }} /></div>;

  const upcoming = data.filter((b) => ["pending", "confirmed"].includes(b.status) && b.event_date >= new Date().toISOString().slice(0, 10));
  const past = data.filter((b) => !upcoming.includes(b));

  const Row = ({ b }) => (
    <Link to={`/bookings/${b.id}`} className="booking-row" style={{ color: "inherit" }}>
      <Avatar name={b.artist_name} hue={b.artist_hue} />
      <div className="grow">
        <div style={{ fontWeight: 650 }}>{b.package_name} · {b.artist_name}</div>
        <div className="small muted">
          {b.event_type} · {b.event_date} at {b.start_time} · {b.venue || b.city}
        </div>
      </div>
      <div className="stack" style={{ alignItems: "flex-end", gap: 4 }}>
        <span className="price">{INR(b.amount_inr)}</span>
        <StatusPill status={b.status} escrow={b.escrow} />
      </div>
      <span className="btn btn-ghost btn-sm">Open →</span>
    </Link>
  );

  return (
    <div className="wrap section" style={{ maxWidth: 900 }}>
      <div className="section-head">
        <div>
          <div className="kicker">Host view</div>
          <h2>My bookings</h2>
        </div>
        <Link to="/discover" className="btn btn-primary btn-sm">+ Book another artist</Link>
      </div>

      {!data.length ? (
        <Empty title="No bookings yet">
          Browse DJs, singers and anchors with fixed prices — first booking takes under 5 minutes.
          <div className="mt-2"><Link to="/discover" className="btn btn-primary btn-sm">Find talent</Link></div>
        </Empty>
      ) : (
        <div className="stack" style={{ gap: 26 }}>
          <div className="card">
            <h3>Upcoming</h3>
            <div className="mt-1">
              {upcoming.length ? upcoming.map((b) => <Row key={b.id} b={b} />) : (
                <p className="small muted" style={{ margin: "8px 0 0" }}>Nothing scheduled — your confirmed and pending bookings appear here.</p>
              )}
            </div>
          </div>
          <div className="card">
            <h3>Past & closed</h3>
            <div className="mt-1">
              {past.length ? past.map((b) => <Row key={b.id} b={b} />) : (
                <p className="small muted" style={{ margin: "8px 0 0" }}>Completed and cancelled bookings will collect here.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
