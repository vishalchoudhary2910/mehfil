import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { INR, CATS, Empty } from "../ui.jsx";

const FEE_PCT = 11; // 5% host + 6% artist
const ADVANCE_PCT = 40;

export default function BookFlow() {
  const { packageId } = useParams();
  const nav = useNavigate();
  const { notify } = useSession();
  const [pkg, setPkg] = useState(null);
  const [artist, setArtist] = useState(null);
  const [err, setErr] = useState(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    event_type: "Birthday",
    event_date: "",
    start_time: "20:00",
    venue: "",
    city: "",
    guest_count: 100,
    sound: "",
    power: "",
    songs: "",
    dress: "",
    notes: "",
  });

  useEffect(() => {
    // Resolve the package through the artist list (packages live on profiles).
    api("/api/artists")
      .then(async (d) => {
        for (const a of d.artists) {
          const det = await api(`/api/artists/${a.slug}`);
          const hit = det.packages.find((p) => p.id === packageId);
          if (hit) { setPkg(hit); setArtist(det.artist); setForm((f) => ({ ...f, city: det.artist.city })); return; }
        }
        setErr("Package not found");
      })
      .catch((e) => setErr(e.message));
  }, [packageId]);

  if (err) return <div className="wrap section"><Empty icon="🔍" title={err} /></div>;
  if (!pkg) return <div className="wrap section"><div className="skeleton" style={{ height: 300 }} /></div>;

  const amount = pkg.price_inr;
  const fee = Math.round((amount * FEE_PCT) / 100);
  const advance = Math.round((amount * ADVANCE_PCT) / 100);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    try {
      const { booking } = await api("/api/bookings", {
        method: "POST",
        body: JSON.stringify({ package_id: pkg.id, ...form, guest_count: Number(form.guest_count) }),
      });
      notify("Booked! Advance held in escrow — track it in My bookings.");
      nav(`/bookings/${booking.id}`);
    } catch (e) {
      notify(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap section" style={{ maxWidth: 880 }}>
      <div className="row between wrapline">
        <div>
          <div className="kicker">Booking — step {step} of 3</div>
          <h2>{pkg.name} · {artist.stage_name}</h2>
        </div>
        <Link to={`/artist/${artist.slug}`} className="btn btn-ghost btn-sm">← Back to profile</Link>
      </div>

      <div className="tabs mt-2">
        {["Event brief", "Escrow payment", "Contract"].map((t, i) => (
          <button key={t} className={step === i + 1 ? "on" : ""} onClick={() => step > i + 1 && setStep(i + 1)}>
            {i + 1}. {t}
          </button>
        ))}
      </div>

      {step === 1 && (
        <div className="card">
          <p className="small muted">A good brief is why quotes come back in minutes, not days.</p>
          <div className="form-grid">
            <div className="field">
              <label>Event type</label>
              <select className="select" value={form.event_type} onChange={set("event_type")}>
                {["Birthday", "Kitty Party", "Sangeet", "Wedding", "House Party", "Corporate", "College Fest", "Club Night"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Date</label>
              <input type="date" className="input" min={new Date().toISOString().slice(0, 10)} value={form.event_date} onChange={set("event_date")} required />
            </div>
            <div className="field">
              <label>Start time</label>
              <input type="time" className="input" value={form.start_time} onChange={set("start_time")} />
            </div>
            <div className="field">
              <label>Guest count</label>
              <input type="number" min="1" className="input" value={form.guest_count} onChange={set("guest_count")} />
            </div>
            <div className="field full">
              <label>Venue</label>
              <input className="input" placeholder="e.g. Sanskriti Lawns, Baner" value={form.venue} onChange={set("venue")} />
            </div>
            <div className="field">
              <label>City</label>
              <input className="input" value={form.city} onChange={set("city")} />
            </div>
            <div className="field">
              <label>Sound available?</label>
              <input className="input" placeholder='e.g. "Venue PA with 2 handhelds"' value={form.sound} onChange={set("sound")} />
            </div>
            <div className="field">
              <label>Power on stage</label>
              <input className="input" placeholder='e.g. "3 points, generator backup"' value={form.power} onChange={set("power")} />
            </div>
            <div className="field">
              <label>Dress code</label>
              <input className="input" placeholder="e.g. Formal Indian" value={form.dress} onChange={set("dress")} />
            </div>
            <div className="field full">
              <label>Must-play songs / notes</label>
              <textarea className="textarea" placeholder="Comma-separated must-plays, run-of-show notes, anything the artist should know" value={form.songs} onChange={set("songs")} />
            </div>
          </div>
          <div className="row between mt-3">
            <span className="small muted">Availability checked on submit — no double-booking.</span>
            <button className="btn btn-primary" disabled={!form.event_date || !form.city} onClick={() => setStep(2)}>
              Continue to payment →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="stack" style={{ gap: 16 }}>
          <div className="escrow-box">
            <div className="lbl">Due now — held in escrow</div>
            <div className="amount">{INR(advance)}</div>
            <p className="small" style={{ color: "#cbbde0", margin: "6px 0 0" }}>
              {ADVANCE_PCT}% of {INR(amount)} for <strong>{pkg.name}</strong>. Mehfil holds this —
              the artist only gets paid after the show is confirmed. Demo build: no real charge.
            </p>
          </div>
          <div className="card">
            <table className="compare-table">
              <tbody>
                <tr><td>Package — {pkg.name} ({pkg.duration_hours} hrs)</td><td className="price" style={{ textAlign: "right" }}>{INR(amount)}</td></tr>
                <tr><td>Platform fee ({FEE_PCT}% split host 5% / artist 6%)</td><td className="price" style={{ textAlign: "right" }}>{INR(fee)}</td></tr>
                <tr><td><strong>Advance into escrow now</strong></td><td className="price" style={{ textAlign: "right", color: "var(--marigold-deep)" }}>{INR(advance)}</td></tr>
                <tr><td>Balance to artist after the event</td><td className="price" style={{ textAlign: "right" }}>{INR(amount - advance)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="note">
            {artist.stage_name}'s <strong>{artist.cancellation_policy}</strong> cancellation policy
            applies: {artist.cancellation_policy === "flexible" ? "full refund 7+ days out" : artist.cancellation_policy === "moderate" ? "full refund 14+ days out" : "50% refund 21+ days out"}.
          </div>
          <div className="row between">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>← Edit brief</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => setStep(3)}>
              {busy ? "Processing…" : `Pay ${INR(advance)} (demo) →`}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="stack" style={{ gap: 16 }}>
          <div className="card">
            <div className="row between">
              <h3>Auto-generated booking agreement</h3>
              <span className="badge badge-verified">Accepts on booking</span>
            </div>
            <div className="mt-2 small stack" style={{ gap: 10 }}>
              <div><strong>Parties:</strong> Host (you) ↔ {artist.stage_name}, {artist.city}</div>
              <div><strong>Scope:</strong> {pkg.name} — {form.event_type} on {form.event_date} at {form.start_time}, {form.venue || form.city}</div>
              <div><strong>Payment:</strong> {INR(amount)} total; {INR(advance)} advance held in escrow; {INR(fee)} platform fee; balance {INR(amount - advance)} as per agreement.</div>
              <div><strong>Cancellation:</strong> {artist.cancellation_policy} policy — {artist.cancellation_policy === "flexible" ? "full refund 7+ days out, 50% within a week" : artist.cancellation_policy === "moderate" ? "full refund 14+ days out, 50% 7–14 days" : "50% refund 21+ days out"}. Artist cancellation always refunds the advance in full.</div>
              <div><strong>Liability & conduct:</strong> Artist carries own equipment insurance; venue sound/power per the brief; community conduct rules apply.</div>
              <div><strong>Disputes:</strong> 48-hour window after the event; payout frozen while ops reviews the timeline.</div>
            </div>
          </div>
          <div className="row between">
            <button className="btn btn-ghost" onClick={() => setStep(2)}>← Back</button>
            <button className="btn btn-primary btn-lg" disabled={busy} onClick={submit}>
              {busy ? "Booking…" : `Confirm & pay ${INR(advance)} into escrow`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
