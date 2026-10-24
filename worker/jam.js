// Jam Circles — casual, free hangouts and live "need an audience" broadcasts.
//
//   plan a jam → city feed + share link → RSVPs → host goes live →
//   nearby subscribers and attendees get the broadcast → sweep retires it.
//
// No money moves here: jams are free by design, which is what separates
// them from gig requests (paid) and shows (ticketed or free listings).

import { notify } from "./notify.js";
import { emailConfigured, sendEmail } from "./mail.js";
import { resolveUser } from "./util.js";
import { isSameOriginRequest } from "@freebuff/auth";

const uid = (p) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
export const newJamToken = () =>
  crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().slice(0, 8);
export const jamUrl = (env, token) =>
  `${String(env.APP_ORIGIN || "http://127.0.0.1:8787").replace(/\/$/, "")}/jam/${token}`;

export const JAM_KINDS = ["jam", "vibe", "hangout"];
export const KIND_LABELS = { jam: "Jam session", vibe: "Performing — need an audience", hangout: "Just hanging" };

const DDL = `
CREATE TABLE IF NOT EXISTS jam_sessions (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  host_id TEXT,
  host_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'jam',
  city TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '19:00',
  instruments TEXT NOT NULL DEFAULT '',
  genres TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'open',
  broadcasts INTEGER NOT NULL DEFAULT 0,
  last_broadcast_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jam_status ON jam_sessions(status);
CREATE INDEX IF NOT EXISTS idx_jam_date ON jam_sessions(date);
CREATE INDEX IF NOT EXISTS idx_jam_city ON jam_sessions(city);

CREATE TABLE IF NOT EXISTS jam_rsvps (
  jam_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (jam_id, user_id)
);

CREATE TABLE IF NOT EXISTS jam_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL DEFAULT 'cron',
  expired INTEGER DEFAULT 0, purged INTEGER DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1, error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
`;

const READY_DBS = new WeakSet();

export async function ensureJamSchema(env) {
  if (READY_DBS.has(env.DB)) return;
  for (const stmt of DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await env.DB.prepare(stmt).run();
  }
  READY_DBS.add(env.DB);
}

const changes = (r) => Number(r?.meta?.changes ?? r?.changes ?? 0);
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const clean = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

// ------------------------------------------------------------------ create --

export async function createJam(env, body, { me = null, now = Date.now() } = {}) {
  await ensureJamSchema(env);
  const db = env.DB;
  if (!me) return { error: [401, "Sign in to host a jam"] };
  const title = clean(body.title, 120);
  const city = clean(body.city, 60);
  const date = String(body.date || "").slice(0, 10);
  if (!title) return { error: [400, "Give the jam a title"] };
  if (!city) return { error: [400, "city is required"] };
  if (!date || Number.isNaN(Date.parse(date))) return { error: [400, "A valid date is required"] };
  if (date < today(now)) return { error: [400, "That date has passed"] };
  const kind = JAM_KINDS.includes(body.kind) ? body.kind : "jam";
  const capacity = Math.min(200, Math.max(2, Number(body.capacity) || 20));

  // Hosts get a small ceiling so the feed never fills with abandoned drafts.
  const open = await db
    .prepare("SELECT COUNT(*) n FROM jam_sessions WHERE host_id = ? AND status IN ('open','full') AND date >= ?")
    .bind(me.id, today(now))
    .first();
  if (Number(open?.n || 0) >= 5) return { error: [429, "You already have 5 upcoming jams — finish one first"] };

  const token = newJamToken();
  const id = uid("jm");
  await db
    .prepare(`INSERT INTO jam_sessions
      (id, token, host_id, host_name, title, kind, city, area, venue, date, start_time,
       instruments, genres, description, capacity)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      id, token, me.id, clean(me.name, 60) || "Host", title, kind, city,
      clean(body.area, 80), clean(body.venue, 120), date,
      /^\d{2}:\d{2}$/.test(String(body.start_time || "")) ? body.start_time : "19:00",
      clean(body.instruments, 200), clean(body.genres, 120),
      clean(body.description, 800), capacity
    )
    .run();

  const jam = await db.prepare("SELECT * FROM jam_sessions WHERE id = ?").bind(id).first();
  await notify(env, [
    `🎸 <b>New jam</b> · ${title}`,
    `${city}${jam.area ? `, ${jam.area}` : ""} · ${date} ${jam.start_time} · ${kind}`,
    jamUrl(env, token),
  ].join("\n"), "jam-created");
  return { jam };
}

// -------------------------------------------------------------------- list --

// Upcoming jams, live ones first, optional city/kind/keyword filters.
// `meId` marks rows the viewer has already joined.
export async function listJams(db, { city = "", kind = "", q = "", meId = "", now = Date.now(), limit = 60 } = {}) {
  const where = ["j.status IN ('open','full')", "j.date >= ?"];
  const params = [today(now)];
  if (city) { where.push("j.city = ?"); params.push(city); }
  if (kind && JAM_KINDS.includes(kind)) { where.push("j.kind = ?"); params.push(kind); }
  if (q) {
    where.push("(j.title LIKE ? OR j.genres LIKE ? OR j.instruments LIKE ? OR j.description LIKE ? OR j.venue LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  const rows = await db
    .prepare(`SELECT j.*,
        (SELECT COUNT(*) FROM jam_rsvps r WHERE r.jam_id = j.id) AS going,
        ${meId ? "(SELECT COUNT(*) FROM jam_rsvps r WHERE r.jam_id = j.id AND r.user_id = ?) AS joined" : "0 AS joined"},
        CASE WHEN j.date = date('now') AND j.broadcasts > 0 THEN 1 ELSE 0 END AS live
      FROM jam_sessions j
      WHERE ${where.join(" AND ")}
      ORDER BY live DESC, j.date ASC, j.start_time ASC
      LIMIT ?`)
    .bind(...(meId ? [meId, ...params] : params), Math.min(limit, 120))
    .all();
  return (rows.results ?? []).map((r) => ({ ...r, joined: !!r.joined, live: !!r.live }));
}

export async function jamDetail(db, token, { meId = "" } = {}) {
  const jam = await db.prepare("SELECT * FROM jam_sessions WHERE token = ?").bind(token).first();
  if (!jam) return null;
  const going = (
    await db.prepare("SELECT user_id, name FROM jam_rsvps WHERE jam_id = ? ORDER BY created_at").bind(jam.id).all()
  ).results ?? [];
  const todayStr = today();
  return {
    jam: {
      ...jam,
      going_count: going.length,
      joined: meId ? going.some((g) => g.user_id === meId) : false,
      live: jam.date === todayStr && Number(jam.broadcasts) > 0 && jam.status === "open",
    },
    attendees: going.map((g) => g.name || "Guest"),
  };
}

// ------------------------------------------------------------------- rsvp --

export async function rsvpJam(env, token, me) {
  await ensureJamSchema(env);
  const db = env.DB;
  if (!me) return { error: [401, "Sign in to join"] };
  const jam = await db.prepare("SELECT * FROM jam_sessions WHERE token = ?").bind(token).first();
  if (!jam) return { error: [404, "Jam not found"] };
  if (!["open", "full"].includes(jam.status)) return { error: [409, "This jam is closed"] };
  if (jam.date < today()) return { error: [409, "This jam already happened"] };

  const existing = await db
    .prepare("SELECT 1 FROM jam_rsvps WHERE jam_id = ? AND user_id = ?")
    .bind(jam.id, me.id)
    .first();
  if (existing) {
    await db.prepare("DELETE FROM jam_rsvps WHERE jam_id = ? AND user_id = ?").bind(jam.id, me.id).run();
    if (jam.status === "full") {
      await db.prepare("UPDATE jam_sessions SET status = 'open', updated_at = datetime('now') WHERE id = ?").bind(jam.id).run();
    }
    const n = await db.prepare("SELECT COUNT(*) n FROM jam_rsvps WHERE jam_id = ?").bind(jam.id).first();
    return { joined: false, going: Number(n?.n || 0) };
  }
  if (jam.status === "full") return { error: [409, "This jam is full"] };

  await db
    .prepare("INSERT INTO jam_rsvps (jam_id, user_id, name) VALUES (?,?,?)")
    .bind(jam.id, me.id, clean(me.name, 60) || "Guest")
    .run();
  const n = await db.prepare("SELECT COUNT(*) n FROM jam_rsvps WHERE jam_id = ?").bind(jam.id).first();
  const going = Number(n?.n || 0);
  if (going >= Number(jam.capacity)) {
    await db.prepare("UPDATE jam_sessions SET status = 'full', updated_at = datetime('now') WHERE id = ?").bind(jam.id).run();
  }
  return { joined: true, going };
}

// -------------------------------------------------------------- broadcast --

// "We're performing right now — come join." Only the host, only on the day,
// and at most once every 30 minutes so the feed can't be spammed.
export async function broadcastJam(env, token, me, { now = Date.now() } = {}) {
  await ensureJamSchema(env);
  const db = env.DB;
  if (!me) return { error: [401, "Sign in required"] };
  const jam = await db.prepare("SELECT * FROM jam_sessions WHERE token = ?").bind(token).first();
  if (!jam) return { error: [404, "Jam not found"] };
  if (jam.host_id !== me.id) return { error: [403, "Only the host can broadcast"] };
  if (jam.status !== "open") return { error: [409, "This jam is closed"] };
  if (jam.date !== today(now)) return { error: [409, "Broadcasts are for the day of the jam" ] };
  if (jam.last_broadcast_at) {
    const last = Date.parse(String(jam.last_broadcast_at).replace(" ", "T") + "Z");
    if (!Number.isNaN(last) && now - last < 30 * 60 * 1000) {
      const mins = Math.ceil((30 * 60 * 1000 - (now - last)) / 60000);
      return { error: [429, `Wait ${mins} minute(s) before broadcasting again`] };
    }
  }

  await db
    .prepare("UPDATE jam_sessions SET broadcasts = broadcasts + 1, last_broadcast_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .bind(jam.id)
    .run();

  const url = jamUrl(env, token);
  await notify(env, [
    `🔴 <b>Live now</b> · ${jam.title}`,
    `${[jam.venue, jam.area, jam.city].filter(Boolean).join(", ")} · from ${jam.start_time}`,
    jam.instruments ? `Bring: ${jam.instruments}` : "",
    url,
  ].filter(Boolean).join("\n"), "jam-live");

  // Attendees get an email so the broadcast reaches beyond the tab they have open.
  let emailed = 0;
  if (emailConfigured(env)) {
    const people = (
      await db
        .prepare(`SELECT u.email, u.name FROM jam_rsvps r JOIN users u ON u.id = r.user_id
          WHERE r.jam_id = ? AND u.email IS NOT NULL AND u.email != ''`)
        .bind(jam.id)
        .all()
    ).results ?? [];
    for (const p of people) {
      const r = await sendEmail(env, {
        to: p.email,
        subject: `Live now: ${jam.title} in ${jam.city} — Mehfil Jam Circles`,
        text:
          `Hi ${p.name || "there"},\n\n${jam.host_name} is going live at "${jam.title}" right now — ` +
          `${[jam.venue, jam.area, jam.city].filter(Boolean).join(", ")}.\n` +
          (jam.instruments ? `Instruments wanted: ${jam.instruments}\n` : "") +
          `\nJoin in: ${url}\n\n— Mehfil Jam Circles`,
      });
      if (r.sent) emailed++;
    }
  }
  const fresh = await db.prepare("SELECT * FROM jam_sessions WHERE id = ?").bind(jam.id).first();
  return { ok: true, jam: fresh, emailed };
}

export async function cancelJam(env, token, me) {
  await ensureJamSchema(env);
  const db = env.DB;
  if (!me) return { error: [401, "Sign in required"] };
  const jam = await db.prepare("SELECT * FROM jam_sessions WHERE token = ?").bind(token).first();
  if (!jam) return { error: [404, "Jam not found"] };
  if (jam.host_id !== me.id) return { error: [403, "Only the host can cancel"] };
  if (!["open", "full"].includes(jam.status)) return { error: [409, "This jam is already closed"] };
  await db.prepare("UPDATE jam_sessions SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").bind(jam.id).run();
  await notify(env, `🚫 <b>Jam cancelled</b> · ${jam.title} · ${jam.city}`, "jam-cancelled");
  return { ok: true };
}

// ------------------------------------------------------------------ sweep --

// The lifecycle engine: retire jams whose day is over, then purge rows that
// have been dead for 30 days so the tables stay small on their own.
export async function runJamSweep(env, { trigger = "cron", now = Date.now() } = {}) {
  await ensureJamSchema(env);
  const db = env.DB;
  const summary = { trigger, expired: 0, purged: 0, ok: true };
  const runRow = await db.prepare("INSERT INTO jam_runs (trigger) VALUES (?)").bind(trigger).run();
  const runId = Number(runRow?.meta?.last_rowid || 0) || null;
  try {
    const day = today(now);
    // Jams from earlier days are over.
    summary.expired += changes(
      await db
        .prepare("UPDATE jam_sessions SET status = 'expired', updated_at = datetime('now') WHERE status IN ('open','full') AND date < ?")
        .bind(day)
        .run()
    );
    // Same-day jams end four hours after the posted start time.
    summary.expired += changes(
      await db
        .prepare(`UPDATE jam_sessions SET status = 'expired', updated_at = datetime('now')
          WHERE status IN ('open','full') AND date = ? AND time(start_time, '+4 hours') < time('now')`)
        .bind(day)
        .run()
    );
    // Dead rows older than 30 days disappear with their RSVPs.
    const stale = (
      await db
        .prepare("SELECT id FROM jam_sessions WHERE status IN ('expired','cancelled') AND date < date('now','-30 days')")
        .all()
    ).results ?? [];
    for (const row of stale) {
      await db.prepare("DELETE FROM jam_rsvps WHERE jam_id = ?").bind(row.id).run();
      await db.prepare("DELETE FROM jam_sessions WHERE id = ?").bind(row.id).run();
      summary.purged++;
    }
    if (runId) {
      await db
        .prepare("UPDATE jam_runs SET expired=?, purged=?, ok=1, finished_at=datetime('now') WHERE id=?")
        .bind(summary.expired, summary.purged, runId)
        .run();
    }
  } catch (e) {
    summary.ok = false;
    summary.error = String(e?.message || e);
    if (runId) {
      await db
        .prepare("UPDATE jam_runs SET ok=0, error=?, finished_at=datetime('now') WHERE id=?")
        .bind(summary.error.slice(0, 300), runId)
        .run();
    }
  }
  return summary;
}

// ----------------------------------------------------------------- routes --

export function mountJamRoutes(app, auth) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const err = (status, error) => json({ error }, status);
  const sameOrigin = (c) => isSameOriginRequest(c.req.raw, c.env.APP_ORIGIN);

  const me = async (c) => {
    const fb = await auth.getUser(c.req.raw).catch(() => null);
    if (!fb) return null;
    return resolveUser(c.env.DB, fb);
  };

  app.get("/api/jams", async (c) => {
    await ensureJamSchema(c.env);
    const user = await me(c);
    const jams = await listJams(c.env.DB, {
      city: c.req.query("city") || "",
      kind: c.req.query("kind") || "",
      q: c.req.query("q") || "",
      meId: user?.id || "",
    });
    return json({ jams });
  });

  app.get("/api/jams/:token", async (c) => {
    await ensureJamSchema(c.env);
    const user = await me(c);
    const view = await jamDetail(c.env.DB, c.req.param("token"), { meId: user?.id || "" });
    if (!view) return err(404, "Jam not found");
    return json({ ...view, share_url: jamUrl(c.env, c.req.param("token")) });
  });

  app.post("/api/jams", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const user = await me(c);
    if (!user) return err(401, "Sign in to host a jam");
    const body = await c.req.json().catch(() => ({}));
    const r = await createJam(c.env, body, { me: user });
    if (r.error) return err(r.error[0], r.error[1]);
    return json({ ok: true, jam: r.jam, share_url: jamUrl(c.env, r.jam.token) }, 201);
  });

  app.post("/api/jams/:token/rsvp", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const user = await me(c);
    if (!user) return err(401, "Sign in to join");
    const r = await rsvpJam(c.env, c.req.param("token"), user);
    if (r.error) return err(r.error[0], r.error[1]);
    return json(r);
  });

  app.post("/api/jams/:token/broadcast", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const user = await me(c);
    if (!user) return err(401, "Sign in required");
    const r = await broadcastJam(c.env, c.req.param("token"), user);
    if (r.error) return err(r.error[0], r.error[1]);
    return json(r);
  });

  app.post("/api/jams/:token/cancel", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const user = await me(c);
    if (!user) return err(401, "Sign in required");
    const r = await cancelJam(c.env, c.req.param("token"), user);
    if (r.error) return err(r.error[0], r.error[1]);
    return json(r);
  });
}
