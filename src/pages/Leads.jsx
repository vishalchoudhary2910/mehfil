import { useEffect, useState, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { Empty, qs } from "../ui.jsx";

const VERIF = {
  verified: { c: "#16a34a", bg: "rgba(22,163,74,.12)", label: "Verified" },
  unverified: { c: "#d97706", bg: "rgba(217,119,6,.12)", label: "Unverified" },
  invalid: { c: "#dc2626", bg: "rgba(220,38,38,.12)", label: "Invalid" },
  checking: { c: "#2563eb", bg: "rgba(37,99,235,.12)", label: "Checking" },
};
function VerifPill({ v }) {
  const s = VERIF[v] || VERIF.unverified;
  return (
    <span className="tag" style={{ color: s.c, background: s.bg, fontWeight: 700 }}>
      {s.label}
    </span>
  );
}
const KIND_ICON = { venue: "📍", artist: "🎤", client: "💼" };

function Contact({ l }) {
  const bits = [
    l.phone && <span key="p">📞 {l.phone}</span>,
    l.website && <a key="w" href={l.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>🌐 {l.website.replace(/^https?:\/\//, "")}</a>,
    l.email && <span key="e">✉️ {l.email}</span>,
    l.instagram && <span key="i">📸 @{l.instagram}</span>,
  ].filter(Boolean);
  return <div className="small muted row" style={{ gap: 10, flexWrap: "wrap" }}>{bits.length ? bits : "no contact yet"}</div>;
}

function LeadRow({ l, onAct, busy }) {
  return (
    <div className="card" style={{ padding: "12px 15px" }}>
      <div className="row between" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
            <strong>{KIND_ICON[l.kind] || "•"} {l.name}</strong>
            <VerifPill v={l.verification} />
            {l.status !== "new" && <span className="tag">{l.status}</span>}
            {l.rating ? <span className="small muted">★ {Number(l.rating).toFixed(1)}</span> : null}
          </div>
          <div className="small muted" style={{ margin: "3px 0" }}>
            {[l.category, l.area, l.city].filter(Boolean).join(" · ") || "—"}
            <span className="tag" style={{ marginLeft: 8 }}>{l.source}</span>
            {l.wants_artists ? <span className="tag" style={{ marginLeft: 4 }}>wants artists</span> : null}
          </div>
          <Contact l={l} />
        </div>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          {l.verification !== "verified" && (
            <button className="btn btn-sm" disabled={busy} onClick={() => onAct("verify", l)}>Verify</button>
          )}
          {l.status !== "contacted" && l.verification === "verified" && (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onAct("approve", l)}>Approve</button>
          )}
          {l.verification === "unverified" && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAct("invalid", l)} title="Mark invalid">✕</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Leads() {
  const { notify } = useSession();
  const [params, setParams] = useSearchParams();
  const [meta, setMeta] = useState(null);
  const [data, setData] = useState(null);
  const [matches, setMatches] = useState(null);
  const [tab, setTab] = useState("leads");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [importText, setImportText] = useState("");
  const [add, setAdd] = useState({ name: "", kind: "venue", category: "", city: "", area: "", phone: "", website: "", email: "" });

  const f = {
    city: params.get("city") || "", area: params.get("area") || "", category: params.get("category") || "",
    kind: params.get("kind") || "", verification: params.get("verification") || "", status: params.get("status") || "",
    source: params.get("source") || "", q: params.get("q") || "", verified_only: params.get("verified_only") || "",
  };
  const set = (k, v) => { const n = new URLSearchParams(params); v ? n.set(k, v) : n.delete(k); setParams(n, { replace: true }); };

  const loadMeta = useCallback(() => api("/api/leads/meta").then(setMeta).catch(() => {}), []);
  const load = useCallback(() => {
    setData(null);
    api(`/api/leads${qs({ ...f, limit: 100 })}`).then(setData).catch((e) => { notify(e.message, "err"); setData({ leads: [], total: 0 }); });
  }, [params.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMatches = useCallback(() => api("/api/leads/matches").then((d) => setMatches(d.pending || [])).catch(() => setMatches([])), []);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "matches") loadMatches(); }, [tab, loadMatches]);

  const act = async (type, l) => {
    setBusy(true);
    try {
      if (type === "verify") { await api(`/api/leads/${l.id}/verify`, { method: "POST" }); notify(`Checked ${l.name}`); }
      else if (type === "approve") {
        const r = await api(`/api/leads/${l.id}/approve`, { method: "POST" });
        notify(r.queued ? `Queued for one-to-one outreach — no cold email sent` : `Outreach emailed to ${l.name}`);
      }
      else if (type === "invalid") { await api(`/api/leads/${l.id}`, { method: "PATCH", body: JSON.stringify({ verification: "invalid" }) }); notify(`Marked ${l.name} invalid`); }
      load(); loadMeta();
    } catch (e) { notify(e.message, "err"); }
    setBusy(false);
  };

  const runPipeline = async () => {
    setBusy(true);
    try { const r = await api("/api/leads/run", { method: "POST" }); setRun(r); notify(`Pipeline: ${r.verified} verified, ${r.invalid} invalid, ${r.outreach} emailed, ${r.queued || 0} queued`); load(); loadMeta(); }
    catch (e) { notify(e.message, "err"); }
    setBusy(false);
  };
  const syncPlaces = async () => {
    setBusy(true);
    try { const r = await api("/api/leads/sync/places", { method: "POST", body: JSON.stringify({}) }); notify(`Places: ${r.created} new, ${r.updated} updated${r.errors?.length ? ` (${r.errors.length} errors)` : ""}`); load(); loadMeta(); }
    catch (e) { notify(e.message, "err"); }
    setBusy(false);
  };
  const doImport = async () => {
    if (!importText.trim()) return;
    setBusy(true);
    try { const r = await api("/api/leads/import/csv", { method: "POST", body: JSON.stringify({ csv: importText }) }); notify(`Imported ${r.created} new, ${r.updated} updated`); setImportText(""); setShowImport(false); load(); loadMeta(); }
    catch (e) { notify(e.message, "err"); }
    setBusy(false);
  };
  const doAdd = async () => {
    if (!add.name || !add.city) return notify("Name and city required", "err");
    setBusy(true);
    try { await api("/api/leads", { method: "POST", body: JSON.stringify(add) }); notify("Lead added"); setAdd({ ...add, name: "", phone: "", website: "", email: "", area: "" }); setShowAdd(false); load(); loadMeta(); }
    catch (e) { notify(e.message, "err"); }
    setBusy(false);
  };
  const setMode = async (mode) => {
    try { await api("/api/leads/settings", { method: "POST", body: JSON.stringify({ outreach_mode: mode }) }); setMeta((m) => ({ ...m, outreach_mode: mode })); notify(`Outreach mode: ${mode === "auto" ? "auto-queue" : "human-approved"}`); }
    catch (e) { notify(e.message, "err"); }
  };

  const unverified = (data?.leads || []).filter((l) => l.verification === "unverified");
  const openLeads = (data?.leads || []).filter((l) => l.wants_artists && (l.kind === "venue" || l.kind === "client"));
  const opt = (v, list, key) => (list || []).map((x) => (
    <option key={x[key ?? "city"] ?? x} value={x[key ?? "city"] ?? x}>{(x[key ?? "city"] ?? x)}{x.n != null ? ` (${x.n})` : ""}</option>
  ));
  const filterActive = Object.values(f).some(Boolean);

  return (
    <div className="wrap section" style={{ paddingTop: 26 }}>
      <div className="section-head" style={{ marginBottom: 14 }}>
        <div>
          <div className="kicker">Lead Engine</div>
          <h2>Leads &amp; automation</h2>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Venues from Places, artists who self-register, and client enquiries — verified, filtered, and matched. Cold outreach is never emailed: it is queued for one-to-one contact, or emailed only when that address has explicit consent.
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-sm" disabled={busy} onClick={runPipeline}>▶ Run pipeline</button>
          <button className="btn btn-sm" disabled={busy || !meta?.places} onClick={syncPlaces} title={meta?.places ? "" : "Set GOOGLE_PLACES_API_KEY"}>📍 Sync Places</button>
          <button className="btn btn-sm" onClick={() => { setShowImport((s) => !s); setShowAdd(false); }}>⬇ Import CSV</button>
          <button className="btn btn-sm" onClick={() => { setShowAdd((s) => !s); setShowImport(false); }}>＋ Add lead</button>
          <a className="btn btn-ghost btn-sm" href={`/api/leads/export.csv${qs(f)}`}>⬆ Export</a>
        </div>
      </div>

      {!meta?.telegram && (
        <div className="note note-info" style={{ marginBottom: 14 }}>
          <strong>Telegram not configured.</strong> Add <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code> in Sites → Secrets (or <code>.dev.vars</code> locally) to get real-time + daily-digest alerts. Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>.
        </div>
      )}

      {showImport && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="field">
            <label>Paste CSV (headers: name, city, phone, website, email, category, area)</label>
            <textarea className="textarea" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={"name,city,phone,website,category\nToast & Co,Pune,9876543210,toastandco.in,cafe"} />
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={doImport}>Import</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowImport(false)}>Cancel</button>
          </div>
        </div>
      )}
      {showAdd && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="grid grid-4" style={{ gap: 10 }}>
            {[["name", "Name"], ["category", "Category (cafe/dj/singer…)"], ["city", "City"], ["area", "Area"], ["phone", "Phone"], ["website", "Website"], ["email", "Email"]].map(([k, lbl]) => (
              <div className="field" key={k}><label>{lbl}</label>
                <input className="input" value={add[k]} onChange={(e) => setAdd({ ...add, [k]: e.target.value })} />
              </div>
            ))}
            <div className="field"><label>Kind</label>
              <select className="select" value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value })}>
                <option value="venue">venue</option><option value="client">client</option><option value="artist">artist</option>
              </select>
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={doAdd}>Add</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="n">{meta?.counts?.total ?? "—"}</div><div className="l">Total leads</div></div>
        <div className="kpi"><div className="n">{meta?.counts?.verified ?? "—"}</div><div className="l">Verified</div></div>
        <div className="kpi"><div className="n">{openLeads.length}</div><div className="l">Open to artists</div></div>
        <div className="kpi"><div className="n">{(matches || []).length}</div><div className="l">Artist interests</div></div>
        <div className="kpi"><div className="n">{meta?.last_run ? (meta.last_run.ok ? "✓" : "✗") : "—"}</div><div className="l">{meta?.last_run ? `Last run ${meta.last_run.verified ?? 0}✓/${meta.last_run.invalid ?? 0}✗` : "No runs yet"}</div></div>
      </div>

      <div className="row between" style={{ gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div className="filters" style={{ flex: 1 }}>
          <select className="select" style={{ width: "auto" }} value={f.kind} onChange={(e) => set("kind", e.target.value)} aria-label="Kind">
            <option value="">All kinds</option>{opt(null, meta?.kinds, "kind")}
          </select>
          <select className="select" style={{ width: "auto" }} value={f.city} onChange={(e) => set("city", e.target.value)} aria-label="City">
            <option value="">All cities</option>{opt(null, meta?.cities)}
          </select>
          <select className="select" style={{ width: "auto" }} value={f.category} onChange={(e) => set("category", e.target.value)} aria-label="Category">
            <option value="">All categories</option>{opt(null, meta?.categories, "category")}
          </select>
          <select className="select" style={{ width: "auto" }} value={f.verification} onChange={(e) => set("verification", e.target.value)} aria-label="Verification">
            <option value="">Any verification</option>{opt(null, meta?.verifications, "verification")}
          </select>
          <select className="select" style={{ width: "auto" }} value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
            <option value="">Any status</option>{opt(null, meta?.statuses, "status")}
          </select>
          <select className="select" style={{ width: "auto" }} value={f.source} onChange={(e) => set("source", e.target.value)} aria-label="Source">
            <option value="">Any source</option>{["places", "csv", "claim", "manual"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className={`chip ${f.verified_only ? "on" : ""}`} onClick={() => set("verified_only", f.verified_only ? "" : "1")}>Verified only</button>
          <div className="field" style={{ minWidth: 160 }}>
            <input className="input" placeholder="Search…" defaultValue={f.q} onBlur={(e) => set("q", e.target.value)} onKeyDown={(e) => e.key === "Enter" && set("q", e.currentTarget.value)} />
          </div>
          {filterActive && <button className="btn btn-ghost btn-sm" onClick={() => setParams({}, { replace: true })}>Clear ✕</button>}
        </div>
        <div className="field" style={{ minWidth: 190 }}>
          <label>Outreach mode</label>
          <select className="select" value={meta?.outreach_mode || "manual"} onChange={(e) => setMode(e.target.value)}>
            <option value="manual">Human-approved (one-to-one)</option>
            <option value="auto">Auto-queue verified leads</option>
          </select>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 12 }}>
        {[[`leads`, `All leads (${data?.total ?? "…"})`], ["review", `Review queue (${unverified.length})`], ["matches", `Artist interests (${(matches || []).length})`]].map(([k, lbl]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{lbl}</button>
        ))}
      </div>

      {tab === "leads" && (
        data === null ? <div className="skeleton" style={{ height: 200 }} /> :
          data.leads.length === 0 ? <Empty title="No leads match">Import a CSV, sync Places, or add one to get started.</Empty> :
            <div className="grid" style={{ gap: 10 }}>
              {data.leads.map((l) => <LeadRow key={l.id} l={l} onAct={act} busy={busy} />)}
            </div>
      )}
      {tab === "review" && (
        unverified.length === 0 ? <Empty title="Review queue clear">Every lead has been checked. New unverified leads land here.</Empty> :
          <div className="grid" style={{ gap: 10 }}>
            {unverified.map((l) => <LeadRow key={l.id} l={l} onAct={act} busy={busy} />)}
          </div>
      )}
      {tab === "matches" && (
        matches === null ? <div className="skeleton" style={{ height: 120 }} /> :
          matches.length === 0 ? <Empty title="No artist interests yet">When an artist raises interest in a venue/client lead, it shows here.</Empty> :
            <div className="grid" style={{ gap: 10 }}>
              {matches.map((m) => (
                <div key={m.id} className="card" style={{ padding: "12px 15px" }}>
                  <div className="row between">
                    <div>
                      <strong>{m.artist_name || "An artist"}</strong> wants to play at <strong>{m.lead_name}</strong>
                      <div className="small muted">{[m.category, m.city].filter(Boolean).join(" · ")}{m.phone ? ` · 📞 ${m.phone}` : ""}</div>
                      {m.message && <div className="small" style={{ marginTop: 4 }}>“{m.message}”</div>}
                    </div>
                    <span className="tag">{m.status}</span>
                  </div>
                </div>
              ))}
            </div>
      )}

      {run && (
        <div className="note mt-3">
          <strong>Last manual run:</strong> {run.verified} verified · {run.invalid} invalid · {run.outreach} contacted · {run.places_new || 0} new from Places
          {run.error ? <span className="bad"> · error: {run.error}</span> : null}
        </div>
      )}

      <div className="note mt-3">
        <strong>How this stays compliant:</strong> leads come from Google Places (public business listings), CSVs you own, or artists who self-register at{" "}
        <Link to="/list-your-act" style={{ textDecoration: "underline" }}>/list-your-act</Link>. No private personal data is scraped. Cold outreach is logged and human-approved by default.
      </div>
    </div>
  );
}
