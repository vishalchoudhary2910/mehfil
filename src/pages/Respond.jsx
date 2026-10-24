import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { INR, categoryLabel, categoryIcon, Empty, SignInLink } from "../ui.jsx";

const LABEL = {
  available: "Available ✓",
  maybe: "Maybe",
  unavailable: "Not available",
  confirmed: "Confirmed",
  invited: "Awaiting your reply",
  viewed: "Awaiting your reply",
  expired: "Closed — no reply",
  closed: "Closed",
};

export default function Respond() {
  const { token } = useParams();
  const { notify } = useSession();
  const [view, setView] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [msgBody, setMsgBody] = useState("");
  const [sending, setSending] = useState(false);
  const [f, setF] = useState({ decision: "", quote_inr: "", message: "", email: "", phone: "", name: "" });

  useEffect(() => {
    api(`/api/respond/${token}`)
      .then((d) => {
        setView(d);
        setF((s) => ({ ...s, email: d.target.email || "", phone: d.target.phone || "", name: d.target.name || "", quote_inr: d.target.quote_inr || "", message: d.target.message || "" }));
      })
      .catch((e) => setErr(e.message));
  }, [token]);

  const submit = async (decision) => {
    if (!decision) return;
    setBusy(true);
    try {
      await api(`/api/respond/${token}`, {
        method: "POST",
        body: JSON.stringify({ ...f, decision, quote_inr: Number(f.quote_inr) || 0 }),
      });
      setSent(decision);
      notify(decision === "available" ? "Availability sent — the host sees it instantly." : "Response sent.");
      const d = await api(`/api/respond/${token}`);
      setView(d);
    } catch (e) {
      notify(e.message, "err");
    }
    setBusy(false);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!msgBody.trim()) return;
    setSending(true);
    try {
      await api(`/api/respond/${token}/message`, { method: "POST", body: JSON.stringify({ body: msgBody }) });
      setMsgBody("");
      notify("Message sent to the host.");
      const d = await api(`/api/respond/${token}`);
      setView(d);
    } catch (ex) {
      notify(ex.message, "err");
    }
    setSending(false);
  };

  if (err) {
    return (
      <div className="wrap section">
        <Empty icon="🔗" title={err}>
          <Link to="/need" style={{ textDecoration: "underline" }}>Post your own gig request</Link>
        </Empty>
      </div>
    );
  }
  if (!view) return <div className="wrap section"><div className="skeleton" style={{ height: 300 }} /></div>;

  const { request: r, target: t, directory } = view;
  const answered = ["available", "maybe", "unavailable"].includes(t.status) && !sent;
  const closed = ["confirmed", "closed", "expired"].includes(t.status) || r.status !== "open";
  const justSent = sent && ["available", "maybe", "unavailable"].includes(sent) && !closed;
  const claimable = directory && !directory.claimed_artist_id && directory.status !== "archived";

  return (
    <div className="wrap section" style={{ maxWidth: 720 }}>
      <div className="kicker">Mehfil gig request</div>
      <h2>{categoryIcon(r.category)} {categoryLabel(r.category)} needed in {r.city}</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        {r.date} at {r.start_time} · {r.event_type || "Live act"} · {r.guest_count} guests
        {r.budget_inr ? ` · budget ${INR(r.budget_inr)}` : " · budget open"}
      </p>

      {r.brief && <div className="note mt-2"><strong>Brief:</strong> {r.brief}</div>}

      {closed ? (
        <div className="card mt-3 center" style={{ padding: 28 }}>
          <div style={{ fontSize: 38 }}>{t.status === "confirmed" ? "🎉" : "📪"}</div>
          <h3 style={{ marginTop: 8 }}>{LABEL[t.status] || "This request is closed"}</h3>
          {t.status === "confirmed" ? (
            <p className="muted">
              You're confirmed for {r.date}. Host contact: {[r.host_name, r.host_email, r.host_phone].filter(Boolean).join(" · ")}
            </p>
          ) : (
            <p className="muted">This request has been filled or closed. New gigs land in your inbox as they come.</p>
          )}
          {claimable && (
            <div className="note note-info" style={{ textAlign: "left", marginTop: 12 }}>
              <strong>Is this your act?</strong> Claim your free Mehfil profile so future gigs reach you directly.
              You'll be signed in with one click and can add rates later.
              <div className="mt-2">
                <SignInLink returnTo={`/talent/${directory.slug}`} className="btn btn-primary btn-sm">Claim my profile →</SignInLink>
              </div>
            </div>
          )}
        </div>
      ) : justSent ? (
        <div className="card mt-3 center" style={{ padding: 28 }}>
          <div style={{ fontSize: 38 }}>{justSent === "available" ? "✅" : justSent === "maybe" ? "🕒" : "👍"}</div>
          <h3 style={{ marginTop: 8 }}>
            {justSent === "available" ? "You're marked available" : justSent === "maybe" ? "Host knows you might be free" : "Host has been told you can't make it"}
          </h3>
          <p className="muted" style={{ maxWidth: 460, margin: "6px auto 0" }}>
            {justSent === "unavailable"
              ? "Thanks for replying quickly — that's what keeps hosts coming back to performers who answer."
              : `The host sees this instantly${f.quote_inr ? ` with your quote of ${INR(Number(f.quote_inr) || 0)}` : ""}. If they confirm, you get their contact details right here and by email.`}
          </p>
          <div className="note mt-3" style={{ textAlign: "left" }}>
            <strong>What happens next:</strong> the host compares replies and confirms one performer. You're only booked
            when they confirm — until then it's an expression of interest, not a commitment.
          </div>
          <div className="row mt-3" style={{ gap: 8, justifyContent: "center" }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setSent(null)}>Change my answer</button>
            {claimable && (
              <SignInLink returnTo={`/talent/${directory.slug}`} className="btn btn-primary btn-sm">Claim this profile →</SignInLink>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="card mt-3 form-grid">
            <div className="field full">
              <label>Are you available?</label>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className={`btn ${f.decision === "available" ? "btn-primary" : ""}`} onClick={() => setF((s) => ({ ...s, decision: "available" }))}>✓ Available</button>
                <button className={`btn ${f.decision === "maybe" ? "btn-primary" : ""}`} onClick={() => setF((s) => ({ ...s, decision: "maybe" }))}>Maybe</button>
                <button className={`btn ${f.decision === "unavailable" ? "btn-primary" : ""}`} onClick={() => setF((s) => ({ ...s, decision: "unavailable" }))}>Not available</button>
              </div>
            </div>
            <div className="field">
              <label>Your quote (₹, optional)</label>
              <input type="number" min="0" className="input" value={f.quote_inr} onChange={(e) => setF((s) => ({ ...s, quote_inr: e.target.value }))} placeholder="8000" />
            </div>
            <div className="field">
              <label>Your name</label>
              <input className="input" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Stage or full name" />
            </div>
            <div className="field">
              <label>Email (for the host)</label>
              <input type="email" className="input" value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} placeholder="you@email.com" />
            </div>
            <div className="field">
              <label>Phone / WhatsApp</label>
              <input className="input" value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} placeholder="98765 43210" />
            </div>
            <div className="field full">
              <label>Note to the host</label>
              <textarea className="textarea" value={f.message} onChange={(e) => setF((s) => ({ ...s, message: e.target.value }))} placeholder="I can do a 90-minute set; own mic + acoustic guitar. Sound system needed." />
            </div>
            <div className="full row between">
              <span className="small muted">One tap. No account needed — the host only sees your details after they confirm.</span>
              <button className="btn btn-primary btn-lg" disabled={busy || !f.decision} onClick={() => submit(f.decision)}>
                {busy ? "Sending…" : "Send availability →"}
              </button>
            </div>
            {answered && (
              <div className="full small muted">
                You already replied <strong>{LABEL[t.status]}</strong>. Sending again updates your answer.
              </div>
            )}
          </div>

          {claimable && (
            <div className="note note-info mt-3">
              <strong>Get gigs directly, not through a link.</strong> {directory.name} is in the Mehfil directory but
              unclaimed. Claim it in one click (Google/Freebuff sign-in) and future requests reach your inbox automatically.
              <div className="mt-2">
                <SignInLink returnTo={`/talent/${directory.slug}`} className="btn btn-primary btn-sm">Claim my profile →</SignInLink>
              </div>
            </div>
          )}
        </>
      )}

      {(view.messages || []).length > 0 || r.status === "open" || t.status === "confirmed" ? (
        <div className="card mt-3">
          <h3>Conversation with the host</h3>
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            {(view.messages || []).length === 0 && (
              <span className="small muted">No messages yet. Ask about the set length, sound or a quote.</span>
            )}
            {(view.messages || []).map((m) => (
              <div
                key={m.id}
                className="small"
                style={{
                  padding: "6px 9px", borderRadius: 10, maxWidth: "88%",
                  marginLeft: m.role === "performer" ? "auto" : 0,
                  background: m.role === "performer" ? "rgba(245,166,35,.12)" : "rgba(120,120,140,.1)",
                }}
              >
                <strong>{m.role === "performer" ? "You" : r.host_name || "Host"}</strong> · {m.body}
              </div>
            ))}
          </div>
          {["cancelled", "expired"].includes(r.status) ? null : (
            <form className="row mt-2" style={{ gap: 8 }} onSubmit={sendMessage}>
              <input
                className="input"
                value={msgBody}
                onChange={(e) => setMsgBody(e.target.value)}
                placeholder="Message the host — a question, a set idea, your quote…"
                maxLength={1000}
              />
              <button className="btn btn-primary btn-sm" disabled={sending || !msgBody.trim()}>
                {sending ? "Sending…" : "Send"}
              </button>
            </form>
          )}
        </div>
      ) : null}

      <div className="note mt-3">
        Availability is not a booking until the host confirms. You'll get an update at the contact you shared.
      </div>
    </div>
  );
}
