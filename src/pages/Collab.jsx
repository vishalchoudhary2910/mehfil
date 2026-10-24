import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { INR, Empty, Avatar, SignInLink, qs } from "../ui.jsx";

const dateFmt = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

export default function Collab() {
  const [params, setParams] = useSearchParams();
  const { session, notify } = useSession();
  const [posts, setPosts] = useState(null);
  const [applied, setApplied] = useState({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "", role_needed: "", city: "Pune",
    date: "", pay_inr: "", details: "",
  });

  const city = params.get("city") || "";

  const load = () =>
    api(`/api/collab${qs({ city })}`).then((d) => setPosts(d.posts)).catch(() => setPosts([]));

  useEffect(() => { load(); }, [city]); // eslint-disable-line

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/collab", { method: "POST", body: JSON.stringify({ ...form, pay_inr: Number(form.pay_inr) || 0 }) });
      notify("Posted — members with the right instrument will see it.");
      setOpen(false);
      setForm({ title: "", role_needed: "", city: "Pune", date: "", pay_inr: "", details: "" });
      await load();
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (id) => {
    if (!session?.user) return;
    setBusy(true);
    try {
      await api(`/api/collab/${id}/apply`, { method: "POST", body: JSON.stringify({ note: "Interested — available for this date." }) });
      setApplied((a) => ({ ...a, [id]: true }));
      notify("Application sent to the poster.");
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap section" style={{ maxWidth: 940 }}>
      <div className="section-head">
        <div>
          <div className="kicker">Find a collaborator</div>
          <h2>Need a tabla player for Saturday?</h2>
          <p className="muted mb-0" style={{ maxWidth: 560 }}>
            The board nobody else in India runs: gigs that need a body, musicians looking for a
            stage. Post a slot, split the pay, done.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select
            className="select"
            style={{ width: "auto" }}
            value={city}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              e.target.value ? next.set("city", e.target.value) : next.delete("city");
              setParams(next, { replace: true });
            }}
          >
            <option value="">All cities</option>
            {["Pune", "Mumbai", "Jaipur"].map((c) => <option key={c}>{c}</option>)}
          </select>
          {session?.user ? (
            <button className="btn btn-primary" onClick={() => setOpen((o) => !o)}>
              {open ? "Close" : "+ Post a slot"}
            </button>
          ) : (
            <SignInLink returnTo="/collab" className="btn btn-primary">Sign in to post</SignInLink>
          )}
        </div>
      </div>

      {open && (
        <form className="card form-grid mt-2" onSubmit={create}>
          <div className="field full">
            <label>Title</label>
            <input className="input" required placeholder="Need a bassist for a wedding weekend" value={form.title} onChange={set("title")} />
          </div>
          <div className="field">
            <label>Role needed</label>
            <input className="input" required placeholder="Bassist / Tabla / Emcee / Second vocalist…" value={form.role_needed} onChange={set("role_needed")} />
          </div>
          <div className="field">
            <label>City</label>
            <input className="input" required value={form.city} onChange={set("city")} />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" className="input" required min={new Date().toISOString().slice(0, 10)} value={form.date} onChange={set("date")} />
          </div>
          <div className="field">
            <label>Pay (₹)</label>
            <input type="number" min="0" className="input" placeholder="3000" value={form.pay_inr} onChange={set("pay_inr")} />
          </div>
          <div className="field full">
            <label>Details</label>
            <textarea className="textarea" placeholder="Set length, rehearsal, travel, what the gig is" value={form.details} onChange={set("details")} />
          </div>
          <div className="full row between">
            <span className="small muted">Applications land in your notifications.</span>
            <button className="btn btn-primary" disabled={busy}>Post slot</button>
          </div>
        </form>
      )}

      <div className="stack mt-3" style={{ gap: 12 }}>
        {posts === null ? (
          <div className="card"><div className="skeleton" style={{ height: 90 }} /></div>
        ) : !posts.length ? (
          <Empty icon="🎸" title="No open slots here">Be the first — post a slot above.</Empty>
        ) : (
          posts.map((p) => (
            <div key={p.id} className="card">
              <div className="row between wrapline">
                <div className="row" style={{ gap: 12 }}>
                  <Avatar name={p.author_stage || p.author_name} hue={140} />
                  <div>
                    <strong>{p.title}</strong>
                    <div className="small muted">
                      {p.author_stage || p.author_name} · {p.city} · {dateFmt(p.date)} · {p.applicants} applied
                    </div>
                  </div>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  {p.pay_inr > 0 && <span className="price">{INR(p.pay_inr)}</span>}
                  <span className="tag">{p.role_needed}</span>
                  {session?.user ? (
                    <button
                      className={`btn btn-sm ${applied[p.id] ? "btn-ghost" : "btn-primary"}`}
                      disabled={busy || applied[p.id]}
                      onClick={() => apply(p.id)}
                    >
                      {applied[p.id] ? "✓ Applied" : "Apply"}
                    </button>
                  ) : (
                    <SignInLink returnTo="/collab" className="btn btn-sm">Apply</SignInLink>
                  )}
                </div>
              </div>
              {p.details && <p className="small muted mt-1 mb-0">{p.details}</p>}
            </div>
          ))
        )}
      </div>

      <div className="note mt-3">
        <strong>Teams, not just gigs:</strong> form a band once, split payouts automatically when
        someone books the whole lineup — network effects live here.
      </div>
    </div>
  );
}
