import { useEffect, useState, useCallback } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { INR, catOptions, categoryLabel, categoryIcon, Empty, qs, usePageMeta } from "../ui.jsx";
import { KNOWN_CITIES } from "../../shared/categories.js";

const EVENT_TYPES = ["Cafe / bar night", "House party", "Birthday", "Wedding / Sangeet", "Corporate", "College fest", "Poetry night", "Comedy night", "Festival", "Other"];
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_STYLE = {
  available: ["#16a34a", "rgba(22,163,74,.12)", "Available"],
  maybe: ["#d97706", "rgba(217,119,6,.12)", "Maybe"],
  confirmed: ["#16a34a", "rgba(22,163,74,.12)", "Confirmed"],
  unavailable: ["#dc2626", "rgba(220,38,38,.12)", "Unavailable"],
  invited: ["#64748b", "rgba(100,116,139,.12)", "Invited"],
  viewed: ["#2563eb", "rgba(37,99,235,.12)", "Seen"],
  expired: ["#94a3b8", "rgba(148,163,184,.16)", "No reply"],
  closed: ["#94a3b8", "rgba(148,163,184,.16)", "Closed"],
};

function StatusPill({ status }) {
  const [c, bg, label] = STATUS_STYLE[status] || ["#64748b", "rgba(100,116,139,.12)", status];
  return <span className="tag" style={{ color: c, background: bg, fontWeight: 700 }}>{label}</span>;
}

export default function Need() {
  usePageMeta(
    "Post a gig brief and get performers — Mehfil",
    "One 60-second brief reaches every matched performer in your city. Performers reply with availability and a quote — no fee to post."
  );
  const [params] = useSearchParams();
  const { session, notify } = useSession();
  const [form, setForm] = useState({
    category: params.get("category") || "singer",
    city: params.get("city") || session?.user?.city || "Pune",
    area: "", date: params.get("date") || today(), start_time: "20:00",
    event_type: "Cafe / bar night", budget_inr: "", guest_count: 50, brief: "",
    host_name: session?.user?.name || "", host_email: session?.user?.email || "", host_phone: "",
    auto_invite: true, alert: true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const [view, setView] = useState(null);
  const [specific, setSpecific] = useState(null);
  const artistParam = params.get("artist");

  // Session arrives after the first render; fill the host details once without
  // overwriting anything the visitor has already typed.
  useEffect(() => {
    if (!session?.user) return;
    setForm((f) => ({
      ...f,
      city: !params.get("city") && f.city === "Pune" ? session.user.city || f.city : f.city,
      host_name: f.host_name || session.user.name || "",
      host_email: f.host_email || session.user.email || "",
    }));
  }, [session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!artistParam) return;
    api(`/api/artists/${artistParam}`)
      .then((d) => {
        setSpecific(d.artist);
        setForm((f) => ({ ...f, category: d.artist.category, city: d.artist.city, area: d.artist.area || f.area }));
      })
      .catch(() => {});
  }, [artistParam]);

  const load = useCallback(() => {
    if (!done?.token) return;
    api(`/api/request/${done.token}`)
      .then((d) => { setView(d); })
      .catch(() => {});
  }, [done?.token]);

  useEffect(() => {
    if (!done?.token) return;
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [done?.token, load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!form.city.trim()) return setErr("Add the city for the gig.");
    if (!form.date) return setErr("Pick a date.");
    if (!form.host_email && !form.host_phone) return setErr("Add an email or phone so performers can reach you.");
    setBusy(true);
    try {
      const r = await api("/api/requests", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          budget_inr: Number(form.budget_inr) || 0,
          guest_count: Number(form.guest_count) || 50,
        }),
      });
      setDone(r);
      if (form.alert) {
        await api("/api/alerts", {
          method: "POST",
          body: JSON.stringify({ kind: "artists", city: form.city, category: form.category, email: form.host_email }),
        }).catch(() => {});
      }
      notify(r.invite?.invited ? `${r.invite.invited} performer(s) invited` : "Request posted");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const r = view?.request || done.request;
    const targets = view?.targets || [];
    return (
      <div className="wrap section" style={{ maxWidth: 820 }}>
        <div className="kicker">Gig request live</div>
        <h2>{categoryLabel(r.category)} in {r.city} · {r.date}</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          We {done.invite?.invited ? `invited ${done.invite.invited} performer${done.invite.invited === 1 ? "" : "s"}` : "saved your brief"}.
          {done.invite?.emailed ? ` ${done.invite.emailed} got an email;` : ""} the rest see it in their artist desk.
          {" "}Availability replies appear below automatically.
        </p>

        <div className="kpi-grid mt-2">
          <div className="kpi"><div className="n">{r.invited}</div><div className="l">Invited</div></div>
          <div className="kpi"><div className="n">{targets.filter((t) => ["available", "maybe"].includes(t.status)).length}</div><div className="l">Replied</div></div>
          <div className="kpi"><div className="n">{targets.filter((t) => t.status === "confirmed").length}</div><div className="l">Confirmed</div></div>
          <div className="kpi"><div className="n" style={{ fontSize: 18 }}>{String(r.expires_at || "").slice(0, 16)}</div><div className="l">Closes</div></div>
        </div>

        <div className="card mt-2">
          <div className="row between wrapline" style={{ gap: 8 }}>
            <strong>Share this request</strong>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(done.host_url); notify("Link copied"); }}>
                Copy link
              </button>
              <Link to={`/request/${done.token}`} className="btn btn-primary btn-sm">Open live status →</Link>
            </div>
          </div>
          <p className="small muted" style={{ margin: "8px 0 0", wordBreak: "break-all" }}>{done.host_url}</p>
          <p className="tiny muted mb-0" style={{ marginTop: 6 }}>
            Send it to a performer you already know — they can accept without creating an account.
          </p>
        </div>

        <div className="tabs mt-3">
          <button className="on">Responses ({targets.length})</button>
        </div>
        <div className="card">
          {targets.length === 0 ? (
            <Empty icon="📨" title="No performers matched yet">
              The radar keeps adding artists daily. Your alert is saved{done.invite?.invited ? "" : " — we'll ping you when a match joins"}.
            </Empty>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {targets.map((t) => (
                <div key={t.id} className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
                  <div>
                    <div className="row" style={{ gap: 8 }}>
                      <strong>{t.name || "Performer"}</strong>
                      <StatusPill status={t.status} />
                    </div>
                    <div className="small muted">
                      {t.channel === "email" ? "Emailed" : t.channel === "inapp" ? "In artist desk" : "Share link ready"}
                      {t.quote_inr ? ` · quote ${INR(t.quote_inr)}` : ""}
                      {t.reasons?.length ? ` · ${t.reasons.slice(0, 2).join(", ")}` : ""}
                    </div>
                    {t.message && <div className="small" style={{ marginTop: 3 }}>“{t.message}”</div>}
                  </div>
                  <Link to={`/request/${done.token}`} className="btn btn-ghost btn-sm">View</Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="wrap section" style={{ maxWidth: 860 }}>
      <div className="kicker">Gig requests</div>
      <h2>Need an artist? Send one brief, reach everyone.</h2>
      <p className="muted" style={{ maxWidth: 640 }}>
        Tell us who you need and when. We auto-match performers by city, category, budget and date, invite
        them in one go, then collect availability and quotes here. Same-day requests work too.
      </p>

      {specific && (
        <div className="note note-info mt-2">
          Requesting <strong>{specific.stage_name}</strong> directly — the brief also goes to similar acts so you
          always get a backup. <Link to={`/artist/${specific.slug}`} style={{ textDecoration: "underline" }}>Back to profile</Link>
        </div>
      )}

      <form className="card form-grid mt-3" onSubmit={submit}>
        <div className="field full">
          <label>Who do you need?</label>
          <div className="row wrapline" style={{ gap: 7 }}>
            {catOptions(true).map((c) => (
              <span key={c.key} className={`chip ${form.category === c.key ? "on" : ""}`} onClick={() => setForm((f) => ({ ...f, category: c.key }))}>
                {c.icon} {c.label}
              </span>
            ))}
          </div>
        </div>
        <div className="field">
          <label>City *</label>
          <input className="input" list="mehfil-cities" value={form.city} onChange={set("city")} placeholder="Pune" required />
          <datalist id="mehfil-cities">{KNOWN_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="field">
          <label>Area / locality</label>
          <input className="input" value={form.area} onChange={set("area")} placeholder="Koregaon Park" />
        </div>
        <div className="field">
          <label>Date *</label>
          <div className="row" style={{ gap: 6 }}>
            <input type="date" className="input" min={today()} value={form.date} onChange={set("date")} required />
            <button type="button" className={`chip ${form.date === today() ? "on" : ""}`} onClick={() => setForm((f) => ({ ...f, date: today() }))}>
              ⚡ Today
            </button>
          </div>
          <span className="field-hint">Same-day requests remind performers every 2 hours.</span>
        </div>
        <div className="field">
          <label>Start time</label>
          <input type="time" className="input" value={form.start_time} onChange={set("start_time")} />
        </div>
        <div className="field">
          <label>Occasion</label>
          <select className="select" value={form.event_type} onChange={set("event_type")}>
            {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Budget (₹, optional)</label>
          <input type="number" min="0" className="input" value={form.budget_inr} onChange={set("budget_inr")} placeholder="8000" />
        </div>
        <div className="field">
          <label>Guests</label>
          <input type="number" min="1" className="input" value={form.guest_count} onChange={set("guest_count")} />
        </div>
        <div className="field full">
          <label>Brief</label>
          <textarea className="textarea" value={form.brief} onChange={set("brief")} placeholder="Sufi shayari + acoustic set for 40 guests, 90 minutes, indoor. Sound system available." />
        </div>
        <div className="field">
          <label>Your name</label>
          <input className="input" value={form.host_name} onChange={set("host_name")} placeholder="Radhika" />
        </div>
        <div className="field">
          <label>Email *</label>
          <input type="email" className="input" value={form.host_email} onChange={set("host_email")} placeholder="you@email.com" />
        </div>
        <div className="field">
          <label>Phone / WhatsApp</label>
          <input className="input" value={form.host_phone} onChange={set("host_phone")} placeholder="98765 43210" />
        </div>
        <div className="field" style={{ alignSelf: "end" }}>
          <label>&nbsp;</label>
          <span className="small muted">At least one of email or phone.</span>
        </div>
        <div className="full stack" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.auto_invite} onChange={(e) => setForm((f) => ({ ...f, auto_invite: e.target.checked }))} />
            <span className="small">Automatically invite every matched performer (recommended)</span>
          </label>
          <label className="row" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.alert} onChange={(e) => setForm((f) => ({ ...f, alert: e.target.checked }))} />
            <span className="small">Alert me when new matching artists or shows appear</span>
          </label>
        </div>
        {err && <div className="bad small full">{err}</div>}
        <div className="full row between">
          <span className="small muted">No fee to post. Performers reply with availability and a quote.</span>
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? "Matching & inviting…" : "Send gig request →"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function RequestStatus() {
  const { token } = useParams();
  const { notify } = useSession();
  const [view, setView] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgFor, setMsgFor] = useState(null);
  const [msgBody, setMsgBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    api(`/api/request/${token}`).then(setView).catch((e) => setErr(e.message));
  }, [token]);
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const act = async (target) => {
    if (!confirm(`Confirm ${target.name} for this gig?`)) return;
    setBusy(true);
    try {
      await api(`/api/request/${token}/confirm`, { method: "POST", body: JSON.stringify({ target_id: target.id }) });
      notify(`${target.name} confirmed — contact details unlocked.`);
      load();
    } catch (e) { notify(e.message, "err"); }
    setBusy(false);
  };
  const cancel = async () => {
    if (!confirm("Cancel this request? Invited performers will be informed by their links closing.")) return;
    setBusy(true);
    try { await api(`/api/request/${token}/cancel`, { method: "POST", body: "{}" }); notify("Request cancelled"); load(); }
    catch (e) { notify(e.message, "err"); }
    setBusy(false);
  };

  const invite = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/request/${token}/invite`, { method: "POST", body: "{}" });
      notify(r.invited ? `${r.invited} more performer${r.invited === 1 ? "" : "s"} invited` : "No new matches yet — the radar keeps growing daily.");
      load();
    } catch (e) { notify(e.message, "err"); }
    setBusy(false);
  };

  const send = async (e, target) => {
    e.preventDefault();
    if (!msgBody.trim()) return;
    setSending(true);
    try {
      await api(`/api/request/${token}/message`, {
        method: "POST",
        body: JSON.stringify({ target_id: target.id, body: msgBody }),
      });
      setMsgBody("");
      notify("Message sent.");
      load();
    } catch (ex) { notify(ex.message, "err"); }
    setSending(false);
  };

  if (err) {
    return <div className="wrap section"><Empty icon="🔍" title={err}><Link to="/need" style={{ textDecoration: "underline" }}>Post a new request</Link></Empty></div>;
  }
  if (!view) return <div className="wrap section"><div className="skeleton" style={{ height: 260 }} /></div>;

  const { request: r, targets, counts } = view;
  return (
    <div className="wrap section" style={{ maxWidth: 860 }}>
      <div className="row between wrapline">
        <div>
          <div className="kicker">Gig request · {r.status}</div>
          <h2>{categoryIcon(r.category)} {categoryLabel(r.category)} in {r.city}</h2>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {r.date} at {r.start_time} · {r.event_type || "Live act"} · {r.guest_count} guests
            {r.budget_inr ? ` · budget ${INR(r.budget_inr)}` : " · budget open"}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {r.status === "open" && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={invite}>Invite more matches</button>
          )}
          {r.status === "open" && <button className="btn btn-danger btn-sm" disabled={busy} onClick={cancel}>Cancel request</button>}
          <Link to="/need" className="btn btn-ghost btn-sm">New request</Link>
        </div>
      </div>

      {r.brief && <div className="note mt-2"><strong>Brief:</strong> {r.brief}</div>}

      <div className="kpi-grid mt-2">
        <div className="kpi"><div className="n">{r.invited}</div><div className="l">Invited</div></div>
        <div className="kpi"><div className="n">{(counts.available || 0) + (counts.maybe || 0)}</div><div className="l">Available / maybe</div></div>
        <div className="kpi"><div className="n">{counts.confirmed || 0}</div><div className="l">Confirmed</div></div>
        <div className="kpi"><div className="n">{counts.unavailable || 0}</div><div className="l">Unavailable</div></div>
        <div className="kpi"><div className="n" style={{ fontSize: 15 }}>{String(r.expires_at || "").slice(5, 16)}</div><div className="l">Closes</div></div>
      </div>

      <div className="card mt-2">
        {targets.length === 0 ? (
          <Empty icon="🎯" title="Nobody invited yet">
            No matching performer was available to invite. We keep scanning daily — post an alert so you hear first.
          </Empty>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {targets.map((t) => {
              const thread = (view.messages || []).filter((m) => m.target_id === t.id);
              return (
              <div key={t.id} className="stack" style={{ gap: 8, borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
                <div className="row between" style={{ gap: 12, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
                      <strong>{t.artist_slug ? <Link to={`/artist/${t.artist_slug}`} style={{ textDecoration: "underline" }}>{t.name}</Link> : t.name}</strong>
                      <StatusPill status={t.status} />
                      {t.quote_inr ? <span className="price" style={{ fontSize: 15 }}>{INR(t.quote_inr)}</span> : null}
                    </div>
                    <div className="small muted">
                      {t.artist_rating ? `★ ${Number(t.artist_rating).toFixed(1)} · ` : ""}
                      {t.channel === "email" ? "Emailed" : t.channel === "inapp" ? "Seen in artist desk" : "Share link"}
                      {t.status === "confirmed" && t.email ? ` · ${t.email}` : ""}
                      {t.status === "confirmed" && t.phone ? ` · ${t.phone}` : ""}
                    </div>
                    {t.message && <div className="small" style={{ marginTop: 4 }}>“{t.message}”</div>}
                  </div>
                  <div className="row wrapline" style={{ gap: 6 }}>
                    {r.status === "open" && ["available", "maybe"].includes(t.status) && (
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(t)}>Confirm</button>
                    )}
                    {r.status !== "cancelled" && (
                      <button className="btn btn-ghost btn-sm" onClick={() => { setMsgFor(msgFor === t.id ? null : t.id); setMsgBody(""); }}>
                        💬 Message
                      </button>
                    )}
                    <span className="tag">{t.nudges ? `${t.nudges} reminder${t.nudges > 1 ? "s" : ""}` : "1 invite"}</span>
                  </div>
                </div>

                {thread.length > 0 && (
                  <div className="stack" style={{ gap: 6 }}>
                    {thread.map((m) => (
                      <div
                        key={m.id}
                        className="small"
                        style={{
                          padding: "6px 9px", borderRadius: 10, maxWidth: "88%",
                          marginLeft: m.role === "host" ? "auto" : 0,
                          background: m.role === "host" ? "rgba(245,166,35,.12)" : "rgba(120,120,140,.1)",
                        }}
                      >
                        <strong>{m.role === "host" ? "You" : t.name}</strong> · {m.body}
                      </div>
                    ))}
                  </div>
                )}

                {msgFor === t.id && (
                  <form className="row" style={{ gap: 8 }} onSubmit={(e) => send(e, t)}>
                    <input
                      className="input"
                      value={msgBody}
                      onChange={(e) => setMsgBody(e.target.value)}
                      placeholder={`Message ${t.name || "performer"} — availability, set length, sound…`}
                      maxLength={1000}
                      autoFocus
                    />
                    <button className="btn btn-primary btn-sm" disabled={sending || !msgBody.trim()}>
                      {sending ? "Sending…" : "Send"}
                    </button>
                  </form>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="note note-info mt-3">
        <strong>How confirmation works:</strong> availability is not a booking until you confirm someone here.
        Confirming holds their date, closes the other invitations politely and unlocks both sides' contact details.
      </div>
    </div>
  );
}
