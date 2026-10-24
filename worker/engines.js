// Engine orchestrator — one clock, four engines, one digest.
//
//   Talent Radar   finds real artists from public/open sources daily
//   Shows          pulls real event feeds daily
//   Lead Engine    refreshes, verifies, matches and retires demand leads
//   Gig Requests   invites, nudges, expires and alerts (also every 4h)
//
// Each engine fails independently: one bad feed never stops the others.

import { ensureLeadsSchema, runLeadCron } from "./leads.js";
import { ensureTalentSchema, runTalentRadar } from "./talent.js";
import { ensureShowSchema, feedUrls, runShowFeed } from "./showfeed.js";
import { ensureRequestSchema, runAlerts, runRequestFollowups } from "./requests.js";
import { ensureJamSchema, runJamSweep } from "./jam.js";
import { notify, telegramConfigured } from "./notify.js";
import { resolveUser, isWorkspaceOwner } from "./util.js";
import { isSameOriginRequest } from "@freebuff/auth";

let READY = false;

export async function ensureEngineSchema(env) {
  if (READY) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS engine_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger TEXT NOT NULL DEFAULT 'cron',
    scopes TEXT NOT NULL DEFAULT '[]',
    talent_created INTEGER DEFAULT 0, shows_created INTEGER DEFAULT 0,
    leads_new INTEGER DEFAULT 0, invites INTEGER DEFAULT 0, responses INTEGER DEFAULT 0,
    ok INTEGER NOT NULL DEFAULT 1, error TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  )`).run();
  READY = true;
}

async function ensureAll(env) {
  await ensureLeadsSchema(env);
  await ensureTalentSchema(env);
  await ensureShowSchema(env);
  await ensureRequestSchema(env);
  await ensureJamSchema(env);
  await ensureEngineSchema(env);
}

const changes = (r) => Number(r?.meta?.changes ?? r?.changes ?? 0);

export async function runDailyEngines(env, { trigger = "cron", silent = false, scopes = ["talent", "shows", "leads", "requests", "jams"] } = {}) {
  await ensureAll(env);
  const db = env.DB;
  const out = {
    trigger, ok: true, errors: [], talent: null, shows: null, leads: null, followups: null,
    started_at: new Date().toISOString(),
  };
  const runRow = await db.prepare("INSERT INTO engine_runs (trigger, scopes) VALUES (?,?)").bind(trigger, JSON.stringify(scopes)).run();
  const runId = Number(runRow?.meta?.last_rowid || 0) || null;

  const attempt = async (name, fn) => {
    try {
      return await fn();
    } catch (e) {
      out.errors.push(`${name}: ${String(e?.message || e).slice(0, 160)}`);
      return null;
    }
  };

  if (scopes.includes("talent")) {
    out.talent = await attempt("talent", () => runTalentRadar(env, { trigger, silent: true }));
  }
  if (scopes.includes("shows")) {
    out.shows = await attempt("shows", () => runShowFeed(env, { trigger, silent: true }));
  }
  if (scopes.includes("leads")) {
    out.leads = await attempt("leads", () => runLeadCron(env, { trigger, digest: false }));
  }
  if (scopes.includes("requests")) {
    out.followups = await attempt("requests", () => runRequestFollowups(env, { trigger, silent: true }));
  }
  if (scopes.includes("jams")) {
    out.jams = await attempt("jams", () => runJamSweep(env, { trigger }));
  }
  out.ok = out.errors.length === 0;

  if (!silent) await notify(env, engineDigest(out, env), "engines");
  if (runId) {
    await db.prepare(`UPDATE engine_runs SET talent_created=?, shows_created=?, leads_new=?, invites=?, responses=?, ok=?, error=?, finished_at=datetime('now') WHERE id=?`)
      .bind(
        Number(out.talent?.created || 0), Number(out.shows?.created || 0), Number(out.leads?.new_leads || 0),
        Number(out.leads?.outreach || 0), Number(out.followups?.nudged || 0),
        out.ok ? 1 : 0, out.errors.join(" | ").slice(0, 500) || null, runId
      ).run();
  }
  return out;
}

// Cheap tick every few hours: nudges, expiries and alert delivery.
export async function runFrequentEngines(env, { trigger = "cron", silent = false } = {}) {
  await ensureAll(env);
  const out = await runRequestFollowups(env, { trigger, silent });
  return out;
}

export function engineDigest(out, env = {}) {
  const t = out.talent || {};
  const s = out.shows || {};
  const l = out.leads || {};
  const f = out.followups || {};
  const lines = [
    "<b>Mehfil engines — daily run</b>",
    t.error
      ? `🎯 Talent radar: failed — ${String(t.error).slice(0, 90)}`
      : `🎯 Talent radar: 🆕 ${t.created || 0} artists · ♻️ ${t.refreshed || 0} refreshed · 🧹 ${(t.stale || 0) + (t.archived || 0)} stale/archived`,
    s.error
      ? `📅 Shows: failed — ${String(s.error).slice(0, 90)}`
      : `📅 Shows: 🆕 ${s.created || 0} · ♻️ ${s.updated || 0} updated · ⌛ ${s.past || 0} past`,
    l.error
      ? `🤝 Leads: failed — ${String(l.error).slice(0, 90)}`
      : `🤝 Leads: ${l.new_leads || 0} new · ✅ ${l.verified || 0} verified · 📣 ${l.outreach || 0} contacted`,
    `📨 Gig requests: ${f.requests || 0} open · ${f.nudged || 0} nudged · ${f.expired || 0} expired · 🔔 ${f.fired || 0} alerts fired`,
    out.jams ? `🎸 Jam circles: ${out.jams.expired || 0} retired · ${out.jams.purged || 0} purged` : "",
    !telegramConfigured(env) && !env.RESEND_API_KEY ? "⚙️ Add Telegram or RESEND keys to receive these outside the console." : "",
  ].filter(Boolean);
  if (out.errors?.length) lines.push("", ...out.errors.slice(0, 4).map((e) => `⚠️ ${e}`));
  return lines.join("\n");
}

// ------------------------------------------------------------------ status --

const safe = async (p, fallback) => {
  try { return await p; } catch { return fallback; }
};

export async function engineStatus(env) {
  await ensureAll(env);
  const db = env.DB;
  const [talent, talentRun, shows, showRun, requests, requestRun, alerts, leads, leadRun, jams, jamRun, recentRequests, recentRuns] = await Promise.all([
    safe(db.prepare(`SELECT COUNT(*) total, SUM(status='active') active, SUM(status='stale') stale,
        SUM(status='claimed') claimed, SUM(status='archived') archived,
        SUM(source='musicbrainz') mb, SUM(source='youtube') yt, SUM(source='events') events,
        SUM(source='manual') manual, SUM(source='csv') csv, SUM(source='wikipedia') wiki, SUM(source='claim') claims
      FROM talent_directory`).first(), null),
    safe(db.prepare("SELECT * FROM talent_runs ORDER BY id DESC LIMIT 1").first(), null),
    safe(db.prepare(`SELECT COUNT(*) total, SUM(status='active') active, SUM(date >= date('now')) upcoming,
        SUM(source != 'manual') imported, SUM(is_free=1 AND date >= date('now')) free_upcoming FROM shows`).first(), null),
    safe(db.prepare("SELECT * FROM show_runs ORDER BY id DESC LIMIT 1").first(), null),
    safe(db.prepare(`SELECT COUNT(*) total, SUM(status='open') open, SUM(status='filled') filled, SUM(status='expired') expired FROM booking_requests`).first(), null),
    safe(db.prepare("SELECT * FROM request_runs ORDER BY id DESC LIMIT 1").first(), null),
    safe(db.prepare("SELECT COUNT(*) total, SUM(active=1) active FROM alerts").first(), null),
    safe(db.prepare(`SELECT COUNT(*) total, SUM(verification='verified') verified,
        SUM(created_at >= datetime('now','-1 day')) fresh24, SUM(status='contacted') contacted, SUM(kind='show') show_leads FROM leads`).first(), null),
    safe(db.prepare("SELECT * FROM lead_runs ORDER BY id DESC LIMIT 1").first(), null),
    safe(db.prepare(`SELECT COUNT(*) total, SUM(status='open') open, SUM(status='full') full, SUM(broadcasts > 0) broadcasted FROM jam_sessions WHERE date >= date('now')`).first(), null),
    safe(db.prepare("SELECT * FROM jam_runs ORDER BY id DESC LIMIT 1").first(), null),
    safe(db.prepare(`SELECT r.id, r.token, r.category, r.city, r.date, r.status, r.invited, r.host_name, r.created_at,
        (SELECT COUNT(*) FROM request_targets t WHERE t.request_id = r.id AND t.status IN ('available','maybe','confirmed')) AS responses
      FROM booking_requests r ORDER BY r.id DESC LIMIT 8`).all(), { results: [] }),
    safe(db.prepare("SELECT * FROM engine_runs ORDER BY id DESC LIMIT 8").all(), { results: [] }),
  ]);

  const feedIcal = await safe(db.prepare("SELECT value FROM show_settings WHERE key='ical_urls'").first(), null);
  const feedRss = await safe(db.prepare("SELECT value FROM show_settings WHERE key='rss_urls'").first(), null);
  const num = (o, k) => Number(o?.[k] || 0);

  return {
    talent: {
      total: num(talent, "total"), active: num(talent, "active"), stale: num(talent, "stale"),
      claimed: num(talent, "claimed"), archived: num(talent, "archived"),
      sources: { musicbrainz: num(talent, "mb"), youtube: num(talent, "yt"), events: num(talent, "events"), wikipedia: num(talent, "wiki"), claims: num(talent, "claims"), manual: num(talent, "manual"), csv: num(talent, "csv") },
      last_run: talentRun,
    },
    shows: {
      total: num(shows, "total"), active: num(shows, "active"), upcoming: num(shows, "upcoming"),
      free_upcoming: num(shows, "free_upcoming"), imported: num(shows, "imported"),
      last_run: showRun,
      feeds: { ical: feedUrls(env, feedIcal?.value || ""), rss: feedUrls(env, feedRss?.value || "", "FEED_RSS_URLS") },
    },
    requests: {
      total: num(requests, "total"), open: num(requests, "open"), filled: num(requests, "filled"),
      expired: num(requests, "expired"), last_run: requestRun, recent: recentRequests.results ?? [],
    },
    alerts: { total: num(alerts, "total"), active: num(alerts, "active") },
    leads: {
      total: num(leads, "total"), verified: num(leads, "verified"), fresh24: num(leads, "fresh24"),
      contacted: num(leads, "contacted"), show_leads: num(leads, "show_leads"), last_run: leadRun,
    },
    jams: {
      upcoming: num(jams, "total"), open: num(jams, "open"), full: num(jams, "full"),
      broadcasted: num(jams, "broadcasted"), last_run: jamRun,
    },
    runs: recentRuns.results ?? [],
    configured: {
      musicbrainz: true,
      youtube: !!env.YOUTUBE_API_KEY,
      places: !!env.GOOGLE_PLACES_API_KEY,
      telegram: telegramConfigured(env),
      email: !!(env.RESEND_API_KEY && env.RESEND_FROM),
      bandsintown: !!env.BANDSINTOWN_APP_ID,
      eventbrite: !!env.EVENTBRITE_TOKEN,
      ical_count: feedUrls(env, feedIcal?.value || "").length,
      rss_count: feedUrls(env, feedRss?.value || "", "FEED_RSS_URLS").length,
    },
    checked_at: new Date().toISOString(),
  };
}

// ----------------------------------------------------------------- routes ---

export function mountEngineRoutes(app, auth) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const err = (status, error) => json({ error }, status);
  const sameOrigin = (c) => isSameOriginRequest(c.req.raw, c.env.APP_ORIGIN);
  const authed = async (c) => {
    const fb = await auth.getUser(c.req.raw);
    if (!fb) return { error: err(401, "Sign in required") };
    await ensureAll(c.env);
    const me = await resolveUser(c.env.DB, fb);
    if (!isWorkspaceOwner(c.env, me)) {
      return { error: err(403, "This console is limited to the workspace owner") };
    }
    return { me, db: c.env.DB };
  };

  app.get("/api/engines/status", async (c) => {
    const { error } = await authed(c);
    if (error) return error;
    return json(await engineStatus(c.env));
  });

  app.post("/api/engines/run", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error } = await authed(c);
    if (error) return error;
    const b = await c.req.json().catch(() => ({}));
    const scope = b.scope || "all";
    const scopes = scope === "all" ? ["talent", "shows", "leads", "requests", "jams"]
      : scope === "requests" ? ["requests"] : [scope];
    if (!["all", "talent", "shows", "leads", "requests", "jams"].includes(scope)) return err(400, "Unknown scope");
    return json(await runDailyEngines(c.env, { trigger: "manual", scopes }));
  });
}

export { changes };
