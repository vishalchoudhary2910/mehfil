import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useSession } from "../session.jsx";
import { categoryLabel, Empty, qs } from "../ui.jsx";
import { CATEGORIES } from "../../shared/categories.js";

const fmt = (s) => (s ? String(s).replace("T", " ").slice(0, 16) : "—");
const ago = (s) => {
  if (!s) return "never";
  const d = new Date(String(s).replace(" ", "T") + (String(s).includes("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return String(s).slice(0, 16);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const ConfigChip = ({ on, label, hint }) => (
  <span className="tag" title={hint} style={{ color: on ? "#16a34a" : "#94a3b8", background: on ? "rgba(22,163,74,.1)" : "rgba(148,163,184,.12)" }}>
    {on ? "●" : "○"} {label}
  </span>
);

export default function Engines() {
  const { notify } = useSession();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState("");
  const [last, setLast] = useState(null);
  const [feed, setFeed] = useState({ kind: "ical", url: "" });
  const [settings, setSettings] = useState({ radar_cities: "", radar_categories: "" });
  const [act, setAct] = useState({ name: "", category: "poet", city: "", area: "", instagram: "", website: "", email: "", phone: "" });
  const [csvText, setCsvText] = useState("");
  const [showManual, setShowManual] = useState(false);

  const load = useCallback(() => {
    api("/api/engines/status")
      .then((d) => {
        setS(d);
        setSettings((x) => ({
          radar_cities: x.radar_cities || "Pune,Mumbai,Jaipur",
          radar_categories: x.radar_categories || "singer,poet,comedian,band,dj,instrumentalist",
        }));
      })
      .catch((e) => notify(e.message, "err"));
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const run = async (scope) => {
    setBusy(scope);
    try {
      const r = await api("/api/engines/run", { method: "POST", body: JSON.stringify({ scope }) });
      setLast(r);
      const bits = [];
      if (r.talent) bits.push(`radar +${r.talent.created || 0}`);
      if (r.shows) bits.push(`shows +${r.shows.created || 0}`);
      if (r.leads) bits.push(`leads ${r.leads.new_leads || 0} new`);
      if (r.followups) bits.push(`${r.followups.nudged || 0} nudges`);
      if (r.jams) bits.push(`jams ${r.jams.expired || 0} retired`);
      notify(bits.length ? `Run complete — ${bits.join(" · ")}` : "Run complete");
      load();
    } catch (e) { notify(e.message, "err"); }
    setBusy("");
  };

  const addFeed = async () => {
    if (!feed.url.trim()) return;
    setBusy("feed");
    try {
      await api("/api/shows/feeds", { method: "POST", body: JSON.stringify(feed) });
      notify("Feed added — it will be read on the next show run.");
      setFeed({ ...feed, url: "" });
      load();
    } catch (e) { notify(e.message, "err"); }
    setBusy("");
  };

  const removeFeed = async (url, kind) => {
    setBusy("feed");
    try {
      await api(`/api/shows/feeds${qs({ url, kind })}`, { method: "DELETE" });
      notify("Feed removed");
      load();
    } catch (e) { notify(e.message, "err"); }
    setBusy("");
  };

  const addAct = async () => {
    if (!act.name.trim() || !act.city.trim()) return notify("Name and city are required", "err");
    setBusy("act");
    try {
      await api("/api/talent", {
        method: "POST",
        body: JSON.stringify({ ...act, links: { instagram: act.instagram, website: act.website } }),
      });
      notify(`${act.name} added to the directory`);
      setAct({ ...act, name: "", instagram: "", website: "", email: "", phone: "", area: "" });
      load();
    } catch (e) { notify(e.message, "err"); }
    setBusy("");
  };

  const importActs = async () => {
    if (!csvText.trim()) return;
    setBusy("csv");
    try {
      const r = await api("/api/talent/import", { method: "POST", body: JSON.stringify({ csv: csvText }) });
      notify(`Imported ${r.created} new, ${r.updated} updated`);
      setCsvText("");
      load();
    } catch (e) { notify(e.message, "err"); }
    setBusy("");
  };

  const saveRadar = async () => {
    setBusy("settings");
    try {
      const r = await api("/api/talent/settings", { method: "POST", body: JSON.stringify(settings) });
      notify("Radar rotation saved");
      setSettings({ radar_cities: r.radar_cities, radar_categories: r.radar_categories });
    } catch (e) { notify(e.message, "err"); }
    setBusy("");
  };

  if (!s) return <div className="wrap section"><div className="skeleton" style={{ height: 300 }} /></div>;

  const t = s.talent, sh = s.shows, rq = s.requests, ld = s.leads;

  return (
    <div className="wrap section" style={{ maxWidth: 1040 }}>
      <div className="section-head" style={{ marginBottom: 14 }}>
        <div>
          <div className="kicker">Automation</div>
          <h2>Engine room</h2>
          <p className="small muted" style={{ margin: "4px 0 0", maxWidth: 620 }}>
            Four engines run every day at 03:00 IST and keep updating what they own: artists are discovered and retired,
            show feeds are re-read, leads are verified, gig requests are nudged and expired — plus a Jam Circles sweep
            that retires finished hangouts. Everything here is manual-runnable too.
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => run("all")}>
            {busy === "all" ? "Running…" : "▶ Run all engines"}
          </button>
          <Link to="/leads" className="btn btn-ghost btn-sm">Leads console</Link>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="n">{t.active}</div><div className="l">Artists in directory</div></div>
        <div className="kpi"><div className="n">{t.claimed}</div><div className="l">Profiles claimed</div></div>
        <div className="kpi"><div className="n">{sh.upcoming}</div><div className="l">Upcoming shows</div></div>
        <div className="kpi"><div className="n">{sh.free_upcoming}</div><div className="l">Free shows</div></div>
        <div className="kpi"><div className="n">{rq.open}</div><div className="l">Open gig requests</div></div>
        <div className="kpi"><div className="n">{s.jams?.upcoming || 0}</div><div className="l">Upcoming jams</div></div>
        <div className="kpi"><div className="n">{ld.total}</div><div className="l">Demand leads</div></div>
      </div>

      <div className="grid grid-2" style={{ alignItems: "start", gap: 14 }}>
        <div className="card">
          <div className="row between">
            <h3>🎯 Talent Radar</h3>
            <span className="small muted">{ago(t.last_run?.started_at)}</span>
          </div>
          <p className="small muted">Real performers from Wikipedia (poets, comics, rappers…), MusicBrainz, public YouTube channels, event listings, CSV, one-click claims and local self-registrations. Profiles refresh daily and stale rows retire automatically.</p>
          <div className="row wrapline" style={{ gap: 6 }}>
            <ConfigChip on label="Wikipedia (open)" hint="Real bios, photos and source links — no key needed" />
            <ConfigChip on label="MusicBrainz (open)" />
            <ConfigChip on={s.configured.youtube} label="YouTube key" hint="Set YOUTUBE_API_KEY for local channel discovery" />
            <ConfigChip on label="Event listings" />
          </div>
          <div className="small muted mt-2">
            {t.last_run ? `Last: ${t.last_run.created || 0} new · ${t.last_run.refreshed || 0} refreshed · ${(t.last_run.stale || 0) + (t.last_run.archived || 0)} cleaned` : "No radar run yet"}
            {t.source_breakdown ? "" : ""}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn btn-sm" disabled={!!busy} onClick={() => run("talent")}>{busy === "talent" ? "Scanning…" : "Scan now"}</button>
            <Link to="/discover?view=directory" className="btn btn-ghost btn-sm">Browse directory</Link>
            <Link to="/list-your-act" className="btn btn-ghost btn-sm">Claim link</Link>
          </div>
          <div className="form-grid mt-2">
            <div className="field">
              <label>Scan cities (comma separated)</label>
              <input className="input" value={settings.radar_cities} onChange={(e) => setSettings((x) => ({ ...x, radar_cities: e.target.value }))} />
            </div>
            <div className="field">
              <label>Categories to scan</label>
              <input className="input" value={settings.radar_categories} onChange={(e) => setSettings((x) => ({ ...x, radar_categories: e.target.value }))} />
            </div>
            <div className="full row between">
              <span className="tiny muted">Rotates two city×category searches per run.</span>
              <button className="btn btn-ghost btn-sm" disabled={busy === "settings"} onClick={saveRadar}>Save</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="row between">
            <h3>📅 Shows feed</h3>
            <span className="small muted">{ago(sh.last_run?.started_at)}</span>
          </div>
          <p className="small muted">Real venue/collective calendars (iCal + RSS) are re-read daily. Free/paid and city are detected from the listing.</p>
          <div className="row wrapline" style={{ gap: 6 }}>
            <ConfigChip on={s.configured.ical_count > 0} label={`${s.configured.ical_count} iCal feed(s)`} />
            <ConfigChip on={s.configured.rss_count > 0} label={`${s.configured.rss_count} RSS feed(s)`} />
            <ConfigChip on={s.configured.bandsintown} label="Bandsintown" hint="Set BANDSINTOWN_APP_ID (registered app id)" />
            <ConfigChip on={s.configured.eventbrite} label="Eventbrite" hint="Set EVENTBRITE_TOKEN" />
          </div>
          <div className="small muted mt-2">
            {sh.last_run ? `Last: ${sh.last_run.fetched || 0} seen · ${sh.last_run.created || 0} new · ${sh.last_run.updated || 0} updated · ${sh.last_run.past || 0} past` : "No show run yet"}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn btn-sm" disabled={!!busy} onClick={() => run("shows")}>{busy === "shows" ? "Reading…" : "Refresh feeds"}</button>
            <Link to="/shows" className="btn btn-ghost btn-sm">Open shows</Link>
          </div>
          <div className="stack mt-2" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              <select className="select" style={{ width: 90 }} value={feed.kind} onChange={(e) => setFeed((f) => ({ ...f, kind: e.target.value }))}>
                <option value="ical">iCal</option>
                <option value="rss">RSS</option>
              </select>
              <input className="input" placeholder="https://venue.example/events.ics" value={feed.url} onChange={(e) => setFeed((f) => ({ ...f, url: e.target.value }))} />
              <button className="btn btn-sm" disabled={busy === "feed"} onClick={addFeed}>Add</button>
            </div>
            {(sh.feeds?.ical || []).map((u) => (
              <div key={u} className="row between small" style={{ gap: 8 }}>
                <span className="muted" style={{ wordBreak: "break-all" }}>{u}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => removeFeed(u, "ical")}>✕</button>
              </div>
            ))}
            {(sh.feeds?.rss || []).map((u) => (
              <div key={u} className="row between small" style={{ gap: 8 }}>
                <span className="muted" style={{ wordBreak: "break-all" }}>{u}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => removeFeed(u, "rss")}>✕</button>
              </div>
            ))}
            <span className="tiny muted">Find the “subscribe / iCal / RSS” link on a venue or collective's events page and paste it here.</span>
          </div>
        </div>

        <div className="card">
          <div className="row between">
            <h3>🤝 Lead engine</h3>
            <span className="small muted">{ago(ld.last_run?.started_at)}</span>
          </div>
          <p className="small muted">Places venues, CSV + claims, verification, outreach and matchmaking — with automatic stale/expiry cleanup.</p>
          <div className="row wrapline" style={{ gap: 6 }}>
            <ConfigChip on={s.configured.places} label="Google Places" hint="Set GOOGLE_PLACES_API_KEY" />
            <ConfigChip on={s.configured.telegram} label="Telegram alerts" />
            <ConfigChip on={s.configured.email} label="Resend email" hint="Set RESEND_API_KEY + RESEND_FROM" />
          </div>
          <div className="small muted mt-2">
            {ld.total} leads · {ld.verified} verified · {ld.fresh24} added today · {ld.contacted} contacted
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn btn-sm" disabled={!!busy} onClick={() => run("leads")}>{busy === "leads" ? "Running…" : "Run leads"}</button>
            <Link to="/leads" className="btn btn-ghost btn-sm">Open console</Link>
          </div>
        </div>

        <div className="card">
          <div className="row between">
            <h3>📨 Gig requests</h3>
            <span className="small muted">{ago(rq.last_run?.started_at)}</span>
          </div>
          <p className="small muted">Auto-invites, availability replies, counter-quotes, nudges, expiry and downtime alerts. Runs every 4 hours.</p>
          <div className="small muted mt-1">
            {rq.total} total · {rq.open} open · {rq.filled} confirmed · {rq.expired} expired · {s.alerts.active} active alert(s)
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn btn-sm" disabled={!!busy} onClick={() => run("requests")}>{busy === "requests" ? "Following up…" : "Run follow-ups"}</button>
            <Link to="/need" className="btn btn-ghost btn-sm">New request</Link>
          </div>
        </div>

        <div className="card">
          <div className="row between">
            <h3>🎸 Jam Circles</h3>
            <span className="small muted">{ago(s.jams?.last_run?.started_at)}</span>
          </div>
          <p className="small muted">Free, casual hangouts and live “need an audience” broadcasts. Finished jams are retired and old rows purged on every tick.</p>
          <div className="small muted mt-1">
            {s.jams?.upcoming || 0} upcoming · {s.jams?.open || 0} open · {s.jams?.full || 0} full · {s.jams?.broadcasted || 0} broadcast
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn btn-sm" disabled={!!busy} onClick={() => run("jams")}>{busy === "jams" ? "Sweeping…" : "Run sweep"}</button>
            <Link to="/jams" className="btn btn-ghost btn-sm">Open jams</Link>
          </div>
        </div>
      </div>

      <div className="card mt-3">
        <div className="row between wrapline" style={{ gap: 8 }}>
          <div>
            <h3>＋ Add acts by hand</h3>
            <p className="small muted" style={{ margin: 0 }}>
              Local talent the engines can't find — a shayar you met at an open mic, a dhol troupe, a comic friend.
              Add one, or paste a CSV of acts you already know.
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowManual((v) => !v)}>{showManual ? "Close" : "Open"}</button>
        </div>
        {showManual && (
          <div className="mt-2 stack" style={{ gap: 14 }}>
            <div className="form-grid">
              <div className="field"><label>Act name *</label><input className="input" value={act.name} onChange={(e) => setAct({ ...act, name: e.target.value })} placeholder="Awaaz Shayari Collective" /></div>
              <div className="field"><label>Category</label>
                <select className="select" value={act.category} onChange={(e) => setAct({ ...act, category: e.target.value })}>
                  {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
              </div>
              <div className="field"><label>City *</label><input className="input" value={act.city} onChange={(e) => setAct({ ...act, city: e.target.value })} placeholder="Pune" /></div>
              <div className="field"><label>Area</label><input className="input" value={act.area} onChange={(e) => setAct({ ...act, area: e.target.value })} placeholder="Kothrud" /></div>
              <div className="field"><label>Instagram</label><input className="input" value={act.instagram} onChange={(e) => setAct({ ...act, instagram: e.target.value })} placeholder="@handle" /></div>
              <div className="field"><label>Portfolio / website</label><input className="input" value={act.website} onChange={(e) => setAct({ ...act, website: e.target.value })} placeholder="https://…" /></div>
              <div className="field"><label>Email (if they gave you one)</label><input className="input" value={act.email} onChange={(e) => setAct({ ...act, email: e.target.value })} placeholder="you@email.com" /></div>
              <div className="field"><label>Phone / WhatsApp</label><input className="input" value={act.phone} onChange={(e) => setAct({ ...act, phone: e.target.value })} placeholder="98765 43210" /></div>
            </div>
            <div className="row between">
              <span className="tiny muted">Only add contact details the act has agreed to share. They get a claim link from their profile.</span>
              <button className="btn btn-primary btn-sm" disabled={busy === "act"} onClick={addAct}>{busy === "act" ? "Adding…" : "Add to directory"}</button>
            </div>
            <div className="field">
              <label>Or import a CSV (headers: stage_name, category, city, area, instagram, youtube, website, email, phone)</label>
              <textarea className="textarea" value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder={"stage_name,category,city,instagram\nAwaaz Shayari Collective,poet,Pune,@awaaz.shayari"} />
            </div>
            <div className="row">
              <button className="btn btn-sm" disabled={busy === "csv"} onClick={importActs}>{busy === "csv" ? "Importing…" : "Import acts"}</button>
            </div>
          </div>
        )}
      </div>

      <div className="card mt-3">
        <div className="row between">
          <h3>Recent gig requests</h3>
          <Link to="/need" className="btn btn-ghost btn-sm">＋ New</Link>
        </div>
        {rq.recent.length === 0 ? (
          <Empty icon="📭" title="No requests yet">Every public request creates a demand lead and invites matching performers automatically.</Empty>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {rq.recent.map((r) => (
              <div key={r.id} className="row between" style={{ gap: 8 }}>
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <strong>{categoryLabel(r.category)}</strong>
                    <span className="tag">{r.status}</span>
                    {r.responses ? <span className="tag">{r.responses} reply</span> : null}
                  </div>
                  <div className="small muted">{[r.city, r.date].filter(Boolean).join(" · ")} · {r.host_name || "Guest"} · invited {r.invited}</div>
                </div>
                <Link to={`/request/${r.token}`} className="btn btn-ghost btn-sm">Open</Link>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card mt-3">
        <h3>Recent engine runs</h3>
        {s.runs.length === 0 ? <p className="small muted">No runs recorded yet.</p> : (
          <div className="stack" style={{ gap: 6 }}>
            {s.runs.map((r) => (
              <div key={r.id} className="row between small">
                <span><span className="tag">{r.trigger}</span> {fmt(r.started_at)}</span>
                <span className="muted">
                  artists +{r.talent_created || 0} · shows +{r.shows_created || 0} · leads {r.leads_new || 0} · {r.ok ? "ok" : `error: ${String(r.error || "").slice(0, 60)}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {last && (
        <div className="note mt-3">
          <strong>Last manual run:</strong>{" "}
          {last.talent ? `radar ${last.talent.created} new / ${last.talent.refreshed} refreshed · ` : ""}
          {last.shows ? `shows ${last.shows.created} new / ${last.shows.updated} updated · ` : ""}
          {last.leads ? `leads ${last.leads.new_leads} new / ${last.leads.verified} verified` : ""}
          {last.errors?.length ? <span className="bad"> · {last.errors.join(" | ")}</span> : null}
        </div>
      )}

      <div className="note mt-3">
        <strong>What needs a key:</strong> Places (venue demand), YouTube (channel discovery), Bandsintown/Eventbrite (extra show feeds),
        Resend (real email), Telegram (alerts). Wikipedia, MusicBrainz, iCal/RSS feeds and the whole request/claim loop work with none of them.
      </div>
    </div>
  );
}
