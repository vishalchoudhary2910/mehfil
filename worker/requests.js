// Gig Request engine — "I need an artist today", end to end.
//
//   brief → ranked matches (bookable artists + directory entries) → automatic
//   tokenized invitations (email / in-app / share link) → availability or a
//   counter-quote → host confirms → date held and both sides connected →
//   automatic nudges, expiry and post-request alerts.
//
// Everything is token based, so a performer can answer without creating an
// account; claiming their directory profile afterwards takes one click.

import { categoryLabel, cityCoords, distanceKm, normalizeCategory } from "../shared/categories.js";
import { ensureLeadsSchema, upsertLead } from "./leads.js";
import { ensureTalentSchema } from "./talent.js";
import { notify } from "./notify.js";
import {
  emailConfigured,
  sendAlertEmail,
  sendHostUpdate,
  sendReminder,
  sendRequestInvite,
  sendThreadMessage,
} from "./mail.js";
import { resolveUser, isWorkspaceOwner } from "./util.js";
import { ensureJamSchema } from "./jam.js";
import { isSameOriginRequest } from "@freebuff/auth";
import { enforceRateLimit, honeypotTripped } from "./security.js";

const uid = (p) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
export const newToken = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().slice(0, 8);
export const requestUrl = (env, token) => `${String(env.APP_ORIGIN || "http://127.0.0.1:8787").replace(/\/$/, "")}/respond/${token}`;
export const hostUrl = (env, token) => `${String(env.APP_ORIGIN || "http://127.0.0.1:8787").replace(/\/$/, "")}/request/${token}`;

const DDL = `
CREATE TABLE IF NOT EXISTS booking_requests (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  host_id TEXT,
  host_name TEXT NOT NULL DEFAULT '',
  host_email TEXT NOT NULL DEFAULT '',
  host_phone TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '20:00',
  duration_hours REAL NOT NULL DEFAULT 3,
  event_type TEXT NOT NULL DEFAULT '',
  guest_count INTEGER NOT NULL DEFAULT 50,
  budget_inr INTEGER NOT NULL DEFAULT 0,
  brief TEXT NOT NULL DEFAULT '',
  urgency TEXT NOT NULL DEFAULT 'soon',
  auto_invite INTEGER NOT NULL DEFAULT 1,
  radius_km INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'open',
  matched INTEGER NOT NULL DEFAULT 0,
  invited INTEGER NOT NULL DEFAULT 0,
  filled_target_id TEXT,
  filled_artist_id TEXT,
  lead_id TEXT,
  ip TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_req_token ON booking_requests(token);
CREATE INDEX IF NOT EXISTS idx_req_status ON booking_requests(status);
CREATE INDEX IF NOT EXISTS idx_req_host ON booking_requests(host_id);
CREATE INDEX IF NOT EXISTS idx_req_date ON booking_requests(date);

CREATE TABLE IF NOT EXISTS request_targets (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  artist_id TEXT,
  directory_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'link',
  status TEXT NOT NULL DEFAULT 'invited',
  quote_inr INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  reasons TEXT NOT NULL DEFAULT '[]',
  nudges INTEGER NOT NULL DEFAULT 0,
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_nudge_at TEXT,
  responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_target_token ON request_targets(token);
CREATE INDEX IF NOT EXISTS idx_target_request ON request_targets(request_id);
CREATE INDEX IF NOT EXISTS idx_target_artist ON request_targets(artist_id);
CREATE INDEX IF NOT EXISTS idx_target_status ON request_targets(status);

CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_request_events ON request_events(request_id);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'artists',
  city TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  max_price INTEGER NOT NULL DEFAULT 0,
  q TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  last_fired_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artist_booked_dates (
  artist_id TEXT NOT NULL, date TEXT NOT NULL, booking_id TEXT NOT NULL,
  PRIMARY KEY (artist_id, date, booking_id)
);

CREATE TABLE IF NOT EXISTS request_messages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  target_id TEXT,
  role TEXT NOT NULL DEFAULT 'host',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_request_messages ON request_messages(request_id);

CREATE TABLE IF NOT EXISTS request_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL DEFAULT 'cron',
  requests INTEGER DEFAULT 0, nudged INTEGER DEFAULT 0, expired INTEGER DEFAULT 0,
  alerts INTEGER DEFAULT 0, fired INTEGER DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1, error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);
`;

const READY_DBS = new WeakSet();

export async function ensureRequestSchema(env) {
  if (READY_DBS.has(env.DB)) return;
  for (const stmt of DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await env.DB.prepare(stmt).run();
  }
  READY_DBS.add(env.DB);
}

export const sqliteMs = (s) => {
  if (!s) return 0;
  const t = String(s).includes("T") ? String(s) : String(s).replace(" ", "T") + "Z";
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? 0 : ms;
};
export const sqliteNow = (d = new Date()) => d.toISOString().slice(0, 19).replace("T", " ");

// A request must close before the event starts, not at midnight. Event times
// are wall-clock IST, so the comparison is explicit about +05:30.
export function eventStartMs({ date, start_time } = {}) {
  if (!date) return 0;
  const time = /^\d{2}:\d{2}$/.test(String(start_time || "")) ? start_time : "20:00";
  const ms = Date.parse(`${date}T${time}:00+05:30`);
  return Number.isNaN(ms) ? 0 : ms;
}

export function expiryFor({ urgency, date, start_time }, now = new Date()) {
  const hours = urgency === "today" ? 4 : urgency === "soon" ? 48 : 120;
  let exp = now.getTime() + hours * 3600 * 1000;
  const start = eventStartMs({ date, start_time });
  // Stop taking replies 90 minutes before doors; a host needs time to brief.
  if (start) exp = Math.min(exp, start - 90 * 60 * 1000);
  if (exp < now.getTime() + 30 * 60 * 1000) exp = now.getTime() + 30 * 60 * 1000;
  return sqliteNow(new Date(exp));
}

// Follow-up clock. Same-day requests get compressed windows.
export function followupAction(target, request, nowMs = Date.now()) {
  if (!target || !["invited", "viewed"].includes(target.status)) return null;
  if (request?.status && request.status !== "open") return null;
  const invited = sqliteMs(target.invited_at);
  if (!invited) return null;
  const sameDay = request?.urgency === "today" || request?.date === new Date(nowMs).toISOString().slice(0, 10);
  const steps = sameDay ? [2, 6, 12] : [6, 24, 48];
  const age = (nowMs - invited) / 3600000;
  const nudges = Number(target.nudges) || 0;
  if (nudges === 0 && age >= steps[0]) return "nudge";
  if (nudges === 1 && age >= steps[1]) return "nudge";
  if (nudges >= 2 && age >= steps[2]) return "expire";
  return null;
}

// Fit score for one candidate (artist profile or directory entry). Pure.
export function scoreCandidate(c, req) {
  if (!c || !req) return { score: 0, reasons: [] };
  if (c.kind === "artist" && Number(c.accepting_requests) === 0) return { score: 0, reasons: ["not taking requests"] };
  const cat = normalizeCategory(c.category, c.name || c.stage_name || "");
  if (req.category && cat !== req.category) return { score: 0, reasons: ["category mismatch"] };
  if (c.booked) return { score: 0, reasons: ["already booked"] };

  const reasons = [];
  let score = 0;
  const sameCity = req.city && c.city && req.city.toLowerCase() === c.city.toLowerCase();
  if (sameCity) { score += 40; reasons.push("same city"); }
  else {
    const km = distanceKm(cityCoords(c.city), cityCoords(req.city));
    const radius = Number(req.radius_km) || 50;
    if (km == null || km > Math.max(radius, Number(c.travel_radius_km) || radius)) {
      return { score: 0, reasons: ["out of range"] };
    }
    score += Math.max(4, Math.round(28 - km / 4));
    reasons.push(`${km} km away`);
  }
  if (req.area && c.area && req.area.toLowerCase() === c.area.toLowerCase()) {
    score += 8; reasons.push("same area");
  }
  const price = Number(c.base_price_inr) || 0;
  const budget = Number(req.budget_inr) || 0;
  if (budget > 0) {
    if (price > 0 && price > budget * 1.2) return { score: 0, reasons: ["over budget"] };
    if (price > 0 && price <= budget) { score += 10; reasons.push("within budget"); }
    else if (price === 0) { score += 6; reasons.push("quotes on request"); }
    else { score += 2; reasons.push("near budget"); }
  } else {
    score += 4;
  }
  if (c.kind === "directory") {
    score += 10 + Math.min(4, Math.round(Math.log10((Number(c.followers) || 0) + 1)));
    reasons.push("discovered act");
  } else {
    if (Number(c.available_now)) { score += 5; reasons.push("available now"); }
    if (Number(c.verified)) { score += 4; reasons.push("verified"); }
    score += Math.round((Number(c.rating) || 0) * 3);
    const mins = Number(c.response_mins);
    if (mins && mins <= 30) score += 6;
    else if (mins && mins <= 120) score += 3;
  }
  return { score: Math.round(score), reasons };
}

async function candidatesFor(db, req) {
  const booked = new Set(
    ((await db.prepare("SELECT artist_id FROM artist_booked_dates WHERE date = ?").bind(req.date).all()).results ?? []).map(
      (r) => r.artist_id
    )
  );
  const artists = (
    await db.prepare(`SELECT a.*, u.email AS user_email, u.name AS user_name
      FROM artist_profiles a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.accepting_requests = 1`).all()
  ).results ?? [];
  const directory = (
    await db
      .prepare("SELECT * FROM talent_directory WHERE status IN ('active','stale') AND claimed_artist_id IS NULL LIMIT 400")
      .all()
  ).results ?? [];

  const out = [];
  for (const a of artists) {
    const scored = scoreCandidate({ ...a, kind: "artist", booked: booked.has(a.id) }, req);
    if (scored.score > 0) {
      out.push({
        kind: "artist", artist: a, score: scored.score, reasons: scored.reasons,
        name: a.stage_name, artist_id: a.id, email: a.user_email || "", phone: "",
        price: Number(a.base_price_inr) || 0,
      });
    }
  }
  for (const t of directory) {
    const scored = scoreCandidate({ ...t, kind: "directory" }, req);
    if (scored.score > 0) {
      out.push({
        kind: "directory", directory: t, score: scored.score, reasons: scored.reasons,
        name: t.name, directory_id: t.id, email: t.email || "", phone: t.phone || "",
        price: 0,
      });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

// Store a pseudonym, never the raw client IP: the gig-request throttle is the
// only reason we need a stable per-connection key at all.
const hashIp = async (env, ip) => {
  if (!ip) return "";
  const bytes = new TextEncoder().encode(`${ip}|${env.APP_ORIGIN || "mehfil"}|request`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// Internal columns never belong in an API response.
const withoutIp = ({ ip, ...rest }) => rest;

async function logRequestEvent(db, requestId, type, note, actor = "system") {
  await db.prepare("INSERT INTO request_events (request_id, type, actor, note) VALUES (?,?,?,?)")
    .bind(requestId, type, actor, String(note || "").slice(0, 500)).run();
}

// --------------------------------------------------------------- creation ---

export async function createRequest(env, body, { me = null, ip = "" } = {}) {
  await ensureRequestSchema(env);
  await ensureLeadsSchema(env);
  await ensureTalentSchema(env);
  const db = env.DB;
  // An empty category means "any act" — it must not become the literal
  // category "other", which would silently match only the leftovers.
  const category = body.category ? normalizeCategory(body.category) : "";
  const city = String(body.city || "").trim();
  const date = String(body.date || "").slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (!city) return { error: [400, "city is required"] };
  if (!date || Number.isNaN(Date.parse(date))) return { error: [400, "A valid event date is required"] };
  if (date < today) return { error: [400, "Event date is in the past"] };
  const host_email = String(body.host_email || me?.email || "").trim().toLowerCase();
  const host_phone = String(body.host_phone || "").replace(/\D/g, "");
  const host_name = String(body.host_name || me?.name || "").trim();
  if (!me && !host_email && !host_phone) {
    return { error: [400, "Add an email or phone so performers can reach you"] };
  }
  ip = await hashIp(env, ip);
  if (ip) {
    const recent = await db.prepare("SELECT COUNT(*) n FROM booking_requests WHERE ip = ? AND created_at >= datetime('now','-1 hour')").bind(ip).first();
    if (Number(recent?.n || 0) >= 5) return { error: [429, "Too many requests from this connection — try again later"] };
  }

  const urgency = ["today", "soon", "planned"].includes(body.urgency)
    ? body.urgency
    : date === today
      ? "today"
      : Date.parse(date) - Date.parse(today) <= 3 * 86400000
        ? "soon"
        : "planned";
  const token = newToken();
  const id = uid("rq");
  const start_time = String(body.start_time || "20:00");
  const expires_at = expiryFor({ urgency, date, start_time });

  // Demand side: the same brief becomes a client lead for the Lead Engine.
  let lead_id = null;
  try {
    const lead = await upsertLead(db, {
      kind: "client",
      name: host_name || host_email || "Event enquiry",
      category: String(body.event_type || category || "event"),
      city, area: String(body.area || "").trim(),
      email: host_email, phone: host_phone,
      notes: `Gig request ${date} ${body.start_time || ""} · ${categoryLabel(category)} · ₹${Number(body.budget_inr) || 0} · ${String(body.brief || "").slice(0, 200)}`,
      source: "request", wants_artists: 1,
    }, { createdBy: me?.id || "request" });
    lead_id = lead.lead?.id || null;
  } catch { /* lead engine is optional for a request */ }

  await db.prepare(`INSERT INTO booking_requests (id, token, host_id, host_name, host_email, host_phone, category, city, area,
      date, start_time, duration_hours, event_type, guest_count, budget_inr, brief, urgency, auto_invite, radius_km,
      status, lead_id, ip, expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    id, token, me?.id || null, host_name, host_email, host_phone, category, city, String(body.area || "").trim(),
    date, start_time, Number(body.duration_hours) || 3,
    String(body.event_type || "").slice(0, 80), Number(body.guest_count) || 50,
    Number(body.budget_inr) || 0, String(body.brief || "").slice(0, 1200), urgency,
    body.auto_invite === false ? 0 : 1, Number(body.radius_km) || 50,
    "open", lead_id, ip, expires_at
  ).run();
  await logRequestEvent(db, id, "created", `${categoryLabel(category)} · ${city} · ${date}`, me?.name || "public");

  const request = await db.prepare("SELECT * FROM booking_requests WHERE id = ?").bind(id).first();
  let invite = { invited: 0, emailed: 0, links: [] };
  if (request.auto_invite) {
    invite = await fanOut(env, request);
  }
  const fresh = await db.prepare("SELECT * FROM booking_requests WHERE id = ?").bind(id).first();
  return { request: withoutIp(fresh), invite };
}

// Invite everyone who fits, automatically. Email when we have an address,
// in-app for claimed artists, and a share link for discovered acts.
export async function fanOut(env, request) {
  const db = env.DB;
  if (request.status && request.status !== "open") return { invited: 0, emailed: 0, matched: 0, links: [] };
  // Calling fanOut twice (host clicks "invite more" after the radar grows)
  // must never create duplicate invitations for the same performer.
  const already = (await db.prepare("SELECT artist_id, directory_id FROM request_targets WHERE request_id = ?").bind(request.id).all()).results ?? [];
  const have = new Set(already.flatMap((r) => [r.artist_id, r.directory_id]).filter(Boolean));
  const cands = (await candidatesFor(db, request))
    .filter((c) => !have.has(c.artist_id) && !have.has(c.directory_id))
    .slice(0, 12);
  let invited = 0, emailed = 0;
  const links = [];
  for (const c of cands) {
    const tToken = newToken();
    const channel = c.email ? "email" : c.kind === "artist" ? "inapp" : "link";
    await db.prepare(`INSERT INTO request_targets (id, request_id, token, artist_id, directory_id, name, email, phone, channel, score, reasons)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
      uid("rt"), request.id, tToken, c.artist_id || null, c.directory_id || null,
      c.name || "", c.email || "", c.phone || "", channel, c.score, JSON.stringify(c.reasons || [])
    ).run();
    invited++;
    const url = requestUrl(env, tToken);
    if (c.email && emailConfigured(env)) {
      const r = await sendRequestInvite(env, { to: c.email, artistName: c.name, request, url });
      if (r.sent) emailed++;
    }
    links.push({ name: c.name, url, channel, score: c.score });
  }
  const totals = await db.prepare("SELECT COUNT(*) n FROM request_targets WHERE request_id = ?").bind(request.id).first();
  await db.prepare("UPDATE booking_requests SET matched = ?, invited = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(Number(totals?.n || invited), Number(totals?.n || invited), request.id).run();
  if (invited) await logRequestEvent(db, request.id, "invited", `${invited} new performer(s) invited, ${emailed} by email`, "engine");
  if (cands.length) {
    const lines = [
      `<b>Gig request</b> · ${categoryLabel(request.category)} · ${[request.area, request.city].filter(Boolean).join(", ")}`,
      `📅 ${request.date} ${request.start_time}${request.budget_inr ? ` · ₹${Number(request.budget_inr).toLocaleString("en-IN")}` : ""}`,
      `📣 Auto-invited ${invited} performer(s)${emailed ? ` · ${emailed} emailed` : ""}`,
      `Host: ${request.host_name || "Guest"}${request.host_email ? ` (${request.host_email})` : ""}`,
      "",
      ...links.slice(0, 5).map((l) => `• ${l.name} — ${l.url}`),
      ...(cands.length > 5 ? [`…and ${cands.length - 5} more in the console`] : []),
    ];
    await notify(env, lines.join("\n"), "gig-request");
  }
  return { invited, emailed, matched: cands.length, links };
}

// ------------------------------------------------------------------ views ---

export async function hostView(db, token) {
  const request = await db.prepare("SELECT * FROM booking_requests WHERE token = ?").bind(token).first();
  if (!request) return null;
  const [targets, events, messages] = await Promise.all([
    db.prepare(`SELECT rt.*, a.slug AS artist_slug, a.hue, a.category AS artist_category, a.rating AS artist_rating,
        a.reviews_count
      FROM request_targets rt LEFT JOIN artist_profiles a ON a.id = rt.artist_id
      WHERE rt.request_id = ? ORDER BY
        CASE rt.status WHEN 'confirmed' THEN 0 WHEN 'available' THEN 1 WHEN 'maybe' THEN 2 WHEN 'viewed' THEN 3
          WHEN 'invited' THEN 4 WHEN 'unavailable' THEN 5 ELSE 6 END,
        rt.score DESC`).bind(request.id).all().catch(async () =>
      db.prepare("SELECT * FROM request_targets WHERE request_id = ? ORDER BY score DESC").bind(request.id).all()
    ),
    db.prepare("SELECT * FROM request_events WHERE request_id = ? ORDER BY id DESC LIMIT 30").bind(request.id).all(),
    db.prepare("SELECT * FROM request_messages WHERE request_id = ? ORDER BY created_at ASC, rowid ASC").bind(request.id).all().catch(() => ({ results: [] })),
  ]);
  const rows = (targets.results ?? []).map((t) => ({
    ...t,
    reasons: JSON.parse(t.reasons || "[]"),
    email: t.status === "confirmed" ? t.email : "",
    phone: t.status === "confirmed" ? t.phone : "",
  }));
  const counts = rows.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});
  return {
    request: withoutIp(request),
    targets: rows,
    events: events.results ?? [],
    messages: messages.results ?? [],
    counts,
  };
}

export async function targetView(db, token) {
  const t = await db.prepare("SELECT * FROM request_targets WHERE token = ?").bind(token).first();
  if (!t) return null;
  const request = await db.prepare("SELECT * FROM booking_requests WHERE id = ?").bind(t.request_id).first();
  if (!request) return null;
  const visible = t.status === "confirmed";
  let directory = null;
  if (t.directory_id) {
    directory = await db.prepare("SELECT slug, name, status, claimed_artist_id FROM talent_directory WHERE id = ?").bind(t.directory_id).first();
  }
  const messages = await db
    .prepare("SELECT * FROM request_messages WHERE request_id = ? AND (target_id = ? OR target_id IS NULL) ORDER BY created_at ASC, rowid ASC")
    .bind(request.id, t.id)
    .all()
    .catch(() => ({ results: [] }));
  // Never leak the host token, IP or other performers' details to a target.
  return {
    target: { ...t, reasons: JSON.parse(t.reasons || "[]") },
    directory,
    messages: messages.results ?? [],
    request: {
      id: request.id,
      category: request.category,
      city: request.city,
      area: request.area,
      date: request.date,
      start_time: request.start_time,
      duration_hours: request.duration_hours,
      event_type: request.event_type,
      guest_count: request.guest_count,
      budget_inr: request.budget_inr,
      brief: request.brief,
      urgency: request.urgency,
      status: request.status,
      host_name: request.host_name,
      host_phone: visible ? request.host_phone : "",
      host_email: visible ? request.host_email : "",
      expires_at: request.expires_at,
    },
  };
}

// ------------------------------------------------------------- messaging ---

const messageBody = (body) => String(body || "").replace(/\s+/g, " ").trim().slice(0, 1000);

// Host → one performer. Kept per-target so performers never see each other's
// threads or contact details.
export async function postHostMessage(env, requestToken, { target_id, body } = {}) {
  await ensureRequestSchema(env);
  const db = env.DB;
  const text = messageBody(body);
  if (!text) return { error: [400, "Write a message first"] };
  const request = await db.prepare("SELECT * FROM booking_requests WHERE token = ?").bind(requestToken).first();
  if (!request) return { error: [404, "Request not found"] };
  if (["cancelled", "expired"].includes(request.status)) return { error: [409, "This request is closed"] };
  const target = await db
    .prepare("SELECT * FROM request_targets WHERE id = ? AND request_id = ?")
    .bind(String(target_id || ""), request.id)
    .first();
  if (!target) return { error: [404, "Invitation not found"] };
  await db.prepare("INSERT INTO request_messages (id, request_id, target_id, role, body) VALUES (?,?,?,?,?)")
    .bind(uid("rm"), request.id, target.id, "host", text).run();
  await logRequestEvent(db, request.id, "message", `Host messaged ${target.name}`, "host");
  if (target.email) {
    await sendThreadMessage(env, {
      to: target.email, request, from: "host", body: text, url: requestUrl(env, target.token),
    });
  }
  await notify(env, `💬 <b>Host message</b> · ${target.name}\n${text.slice(0, 240)}\n${requestUrl(env, target.token)}`, "gig-message");
  return { ok: true };
}

// Performer → host from their tokenised link, no account needed.
export async function postTargetMessage(env, targetToken, { body } = {}) {
  await ensureRequestSchema(env);
  const db = env.DB;
  const text = messageBody(body);
  if (!text) return { error: [400, "Write a message first"] };
  const target = await db.prepare("SELECT * FROM request_targets WHERE token = ?").bind(targetToken).first();
  if (!target) return { error: [404, "This invitation link is not valid"] };
  const request = await db.prepare("SELECT * FROM booking_requests WHERE id = ?").bind(target.request_id).first();
  if (!request) return { error: [404, "Request not found"] };
  if (["cancelled", "expired"].includes(request.status)) return { error: [409, "This request is closed"] };
  await db.prepare("INSERT INTO request_messages (id, request_id, target_id, role, body) VALUES (?,?,?,?,?)")
    .bind(uid("rm"), request.id, target.id, "performer", text).run();
  await logRequestEvent(db, request.id, "message", `${target.name || "Performer"} replied`, target.name || "performer");
  await sendThreadMessage(env, {
    to: request.host_email, request, from: "performer", body: text, url: hostUrl(env, request.token),
  });
  await notify(env, [
    `💬 <b>Performer reply</b> · ${request.city} · ${request.date}`,
    `${target.name || "Performer"}: ${text.slice(0, 240)}`,
    hostUrl(env, request.token),
  ].join("\n"), "gig-message");
  return { ok: true };
}

// "Invite more" — after a new artist joins or the radar finds more matches.
export async function inviteMore(env, requestToken) {
  await ensureRequestSchema(env);
  const request = await env.DB.prepare("SELECT * FROM booking_requests WHERE token = ?").bind(requestToken).first();
  if (!request) return { error: [404, "Request not found"] };
  if (request.status !== "open") return { error: [409, "This request is closed"] };
  const r = await fanOut(env, request);
  return { ok: true, ...r };
}

export async function respondToTarget(env, token, { decision, quote_inr, message, email, phone, name } = {}) {
  const db = env.DB;
  const t = await db.prepare("SELECT * FROM request_targets WHERE token = ?").bind(token).first();
  if (!t) return { error: [404, "This invitation link is not valid"] };
  const request = await db.prepare("SELECT * FROM booking_requests WHERE id = ?").bind(t.request_id).first();
  if (!request) return { error: [404, "Request not found"] };
  if (!["invited", "viewed", "available", "maybe"].includes(t.status)) {
    return { error: [409, "You already answered this request"] };
  }
  if (request.status !== "open") return { error: [409, "This request is already closed"] };
  if (request.expires_at && sqliteMs(request.expires_at) < Date.now()) {
    return { error: [409, "This request has expired"] };
  }
  const d = String(decision || "").toLowerCase();
  if (!["available", "maybe", "unavailable"].includes(d)) return { error: [400, "decision must be available, maybe or unavailable"] };

  const replyEmail = String(email || t.email || "").trim().toLowerCase();
  const replyPhone = String(phone || t.phone || "").replace(/\D/g, "");
  await db.prepare(`UPDATE request_targets SET status = ?, quote_inr = ?, message = ?, email = CASE WHEN ? != '' THEN ? ELSE email END,
      phone = CASE WHEN ? != '' THEN ? ELSE phone END, name = CASE WHEN ? != '' THEN ? ELSE name END,
      responded_at = datetime('now') WHERE id = ?`).bind(
    d, Math.max(0, Number(quote_inr) || 0), String(message || "").slice(0, 800),
    replyEmail, replyEmail, replyPhone, replyPhone, String(name || "").trim(), String(name || "").trim(), t.id
  ).run();
  await logRequestEvent(db, request.id, "response", `${t.name || "Performer"} → ${d}${quote_inr ? ` (₹${Number(quote_inr)})` : ""}`, t.name || "performer");

  if (d !== "unavailable") {
    const hostMail = await sendHostUpdate(env, {
      to: request.host_email, request, event: "response",
      target: { name: t.name, quote_inr: Number(quote_inr) || 0, message: String(message || "") },
      url: hostUrl(env, request.token),
    });
    await notify(env, [
      `<b>Gig response</b> · ${categoryLabel(request.category)} · ${request.city} · ${request.date}`,
      `${t.name || "Performer"} is <b>${d}</b>${quote_inr ? ` · quote ₹${Number(quote_inr).toLocaleString("en-IN")}` : ""}`,
      message ? `“${String(message).slice(0, 160)}”` : "",
      `Host: ${request.host_name || "Guest"}${request.host_email ? ` (${request.host_email})` : ""}`,
      hostMail.sent ? "Host emailed." : "",
    ].filter(Boolean).join("\n"), "gig-response");
  }
  const fresh = await db.prepare("SELECT * FROM request_targets WHERE id = ?").bind(t.id).first();
  return { ok: true, target: fresh };
}

export async function confirmTarget(env, requestToken, targetId) {
  const db = env.DB;
  const request = await db.prepare("SELECT * FROM booking_requests WHERE token = ?").bind(requestToken).first();
  if (!request) return { error: [404, "Request not found"] };
  if (request.status === "cancelled") return { error: [409, "This request was cancelled"] };
  if (request.status === "expired") return { error: [409, "This request expired — create a new one"] };
  if (request.status === "filled" && request.filled_target_id !== targetId) {
    return { error: [409, "Another performer is already confirmed"] };
  }
  const target = await db.prepare("SELECT * FROM request_targets WHERE id = ? AND request_id = ?").bind(targetId, request.id).first();
  if (!target) return { error: [404, "Invitation not found"] };
  if (!["available", "maybe", "invited", "viewed"].includes(target.status)) {
    return { error: [409, "This performer is not available to confirm"] };
  }
  await db.prepare("UPDATE request_targets SET status='confirmed' WHERE id = ?").bind(target.id).run();
  await db.prepare(`UPDATE request_targets SET status='closed' WHERE request_id = ? AND id != ? AND status IN ('invited','viewed','available','maybe')`)
    .bind(request.id, target.id).run();
  await db.prepare("UPDATE booking_requests SET status='filled', filled_target_id=?, filled_artist_id=?, updated_at=datetime('now') WHERE id = ?")
    .bind(target.id, target.artist_id || null, request.id).run();
  if (target.artist_id) {
    try {
      await db.prepare("INSERT OR IGNORE INTO artist_booked_dates (artist_id, date, booking_id) VALUES (?,?,?)")
        .bind(target.artist_id, request.date, `req:${request.id}`).run();
    } catch { /* held by another booking already */ }
  }
  await logRequestEvent(db, request.id, "confirmed", `${target.name} confirmed for ${request.date}`, "host");
  const updated = await db.prepare("SELECT * FROM booking_requests WHERE id = ?").bind(request.id).first();
  await sendHostUpdate(env, {
    to: updated.host_email, request: updated, event: "confirmed",
    target, url: hostUrl(env, updated.token),
  });
  await notify(env, [
    `<b>Gig confirmed</b> · ${categoryLabel(updated.category)} · ${updated.city} · ${updated.date}`,
    `${target.name}${target.quote_inr ? ` · ₹${Number(target.quote_inr).toLocaleString("en-IN")}` : ""}`,
    target.email ? `✉️ ${target.email}` : "",
    target.phone ? `📞 ${target.phone}` : "",
    `Host: ${updated.host_name || "Guest"}${updated.host_email ? ` (${updated.host_email})` : ""}`,
  ].filter(Boolean).join("\n"), "gig-confirmed");
  return { ok: true, view: await hostView(db, requestToken) };
}

export async function cancelRequest(env, requestToken) {
  const db = env.DB;
  const request = await db.prepare("SELECT * FROM booking_requests WHERE token = ?").bind(requestToken).first();
  if (!request) return { error: [404, "Request not found"] };
  if (request.status === "filled") return { error: [409, "Already confirmed — contact the performer directly"] };
  await db.prepare("UPDATE booking_requests SET status='cancelled', updated_at=datetime('now') WHERE id = ?").bind(request.id).run();
  await db.prepare("UPDATE request_targets SET status='closed' WHERE request_id = ? AND status IN ('invited','viewed','available','maybe')").bind(request.id).run();
  if (request.filled_artist_id) {
    await db.prepare("DELETE FROM artist_booked_dates WHERE booking_id = ?").bind(`req:${request.id}`).run();
  }
  await logRequestEvent(db, request.id, "cancelled", "Host cancelled the request", "host");
  return { ok: true };
}

// -------------------------------------------------------------- sequences ---

export async function runRequestFollowups(env, { trigger = "cron", now = Date.now(), silent = true } = {}) {
  await ensureRequestSchema(env);
  const db = env.DB;
  const summary = { trigger, requests: 0, nudged: 0, expired: 0, alerts: 0, fired: 0, ok: true };
  const runRow = await db.prepare("INSERT INTO request_runs (trigger) VALUES (?)").bind(trigger).run();
  const runId = Number(runRow?.meta?.last_rowid || 0) || null;
  try {
    const open = (await db.prepare("SELECT * FROM booking_requests WHERE status = 'open'").all()).results ?? [];
    summary.requests = open.length;
    for (const req of open) {
      const expired = req.expires_at && sqliteMs(req.expires_at) < now;
      const targets = (await db.prepare("SELECT * FROM request_targets WHERE request_id = ? AND status IN ('invited','viewed')").bind(req.id).all()).results ?? [];
      let nudgedHere = 0;
      const links = [];
      for (const t of targets) {
        const act = followupAction(t, req, now);
        if (!act) continue;
        if (act === "nudge") {
          const url = requestUrl(env, t.token);
          if (t.email && emailConfigured(env)) {
            await sendReminder(env, { to: t.email, artistName: t.name, request: req, url, urgent: Number(t.nudges) > 0 });
          }
          await db.prepare("UPDATE request_targets SET nudges = nudges + 1, last_nudge_at = datetime('now') WHERE id = ?").bind(t.id).run();
          await logRequestEvent(db, req.id, "nudged", `Reminder ${Number(t.nudges) + 1} to ${t.name}`, "engine");
          nudgedHere++; summary.nudged++;
          links.push(`${t.name} — ${url}`);
        } else if (act === "expire") {
          await db.prepare("UPDATE request_targets SET status='expired' WHERE id = ?").bind(t.id).run();
          await logRequestEvent(db, req.id, "no_reply", `${t.name} did not respond`, "engine");
          summary.expired++;
        }
      }
      if (nudgedHere) {
        await notify(env, [
          `<b>Follow-up sent</b> · ${categoryLabel(req.category)} · ${req.city} · ${req.date}`,
          `${nudgedHere} performer(s) reminded${req.urgency === "today" ? " — same-day request" : ""}`,
          ...links.slice(0, 4),
        ].join("\n"), "gig-followup");
      }
      if (expired) {
        await db.prepare("UPDATE booking_requests SET status='expired', updated_at=datetime('now') WHERE id = ?").bind(req.id).run();
        await logRequestEvent(db, req.id, "expired", "No performer confirmed before the deadline", "engine");
        await sendHostUpdate(env, { to: req.host_email, request: req, event: "expired", url: hostUrl(env, req.token) });
        await notify(env, [
          `<b>Gig request expired</b> · ${categoryLabel(req.category)} · ${req.city} · ${req.date}`,
          `No confirmation from ${req.invited} invited performer(s).`,
          `Host: ${req.host_name || "Guest"}${req.host_email ? ` (${req.host_email})` : ""}`,
        ].join("\n"), "gig-expired");
      }
    }
    // Alerts ride the same frequent tick.
    const alerts = await runAlerts(env, { now, silent });
    summary.alerts = alerts.checked;
    summary.fired = alerts.fired;
    if (runId) {
      await db.prepare("UPDATE request_runs SET requests=?, nudged=?, expired=?, alerts=?, fired=?, ok=1, finished_at=datetime('now') WHERE id=?")
        .bind(summary.requests, summary.nudged, summary.expired, summary.alerts, summary.fired, runId).run();
    }
  } catch (e) {
    summary.ok = false;
    summary.error = String(e?.message || e);
    if (runId) await db.prepare("UPDATE request_runs SET ok=0, error=?, finished_at=datetime('now') WHERE id=?").bind(summary.error.slice(0, 300), runId).run();
  }
  return summary;
}

// ------------------------------------------------------------------ alerts --

export async function runAlerts(env, { now = Date.now(), silent = true } = {}) {
  await ensureRequestSchema(env);
  const db = env.DB;
  const summary = { checked: 0, fired: 0, items: 0, ok: true };
  const alerts = (await db.prepare("SELECT * FROM alerts WHERE active = 1").all()).results ?? [];
  summary.checked = alerts.length;
  const today = new Date(now).toISOString().slice(0, 10);
  for (const a of alerts) {
    const since = a.last_fired_at || a.created_at;
    // Strictly after the last delivery once one has happened, so rows created
    // in the same second as the previous digest are not sent twice.
    const cmp = a.last_fired_at ? ">" : ">=";
    const items = [];
    try {
      if (a.kind === "artists") {
        const where = ["status IN ('active','stale')", "claimed_artist_id IS NULL", `first_seen_at ${cmp} ?`];
        const params = [since];
        if (a.city) { where.push("city = ?"); params.push(a.city); }
        if (a.category) { where.push("category = ?"); params.push(a.category); }
        if (a.q) { where.push("(name LIKE ? OR genres LIKE ? OR bio LIKE ?)"); params.push(`%${a.q}%`, `%${a.q}%`, `%${a.q}%`); }
        const rows = (await db.prepare(`SELECT * FROM talent_directory WHERE ${where.join(" AND ")} ORDER BY last_seen_at DESC LIMIT 5`).bind(...params).all()).results ?? [];
        for (const r of rows) items.push({ title: r.name, meta: [categoryLabel(r.category), r.city].filter(Boolean).join(" · "), url: `/talent/${r.slug}` });
      } else if (a.kind === "shows") {
        const where = ["date >= ?", `created_at ${cmp} ?`];
        const params = [today, since];
        if (a.city) { where.push("city = ?"); params.push(a.city); }
        if (a.q) { where.push("(title LIKE ? OR performers LIKE ? OR venue LIKE ?)"); params.push(`%${a.q}%`, `%${a.q}%`, `%${a.q}%`); }
        const rows = (await db.prepare(`SELECT * FROM shows WHERE ${where.join(" AND ")} ORDER BY date ASC LIMIT 5`).bind(...params).all()).results ?? [];
        for (const r of rows) items.push({ title: r.title, meta: `${r.date} · ${[r.venue, r.city].filter(Boolean).join(", ")}`, url: "/shows" });
      } else if (a.kind === "jams") {
        // Jam Circles: free, casual sessions — new ones in your city.
        await ensureJamSchema(env);
        const where = ["status IN ('open','full')", `created_at ${cmp} ?`];
        const params = [since];
        if (a.city) { where.push("city = ?"); params.push(a.city); }
        if (a.q) { where.push("(title LIKE ? OR genres LIKE ? OR instruments LIKE ?)"); params.push(`%${a.q}%`, `%${a.q}%`, `%${a.q}%`); }
        const rows = (await db.prepare(`SELECT * FROM jam_sessions WHERE ${where.join(" AND ")} ORDER BY date ASC LIMIT 5`).bind(...params).all()).results ?? [];
        for (const r of rows) items.push({ title: r.title, meta: `${r.date} ${r.start_time} · ${[r.venue, r.city].filter(Boolean).join(", ")}`, url: `/jam/${r.token}` });
      } else {
        const where = [`created_at ${cmp} ?`];
        const params = [since];
        if (a.city) { where.push("city = ?"); params.push(a.city); }
        if (a.category) { where.push("category = ?"); params.push(String(a.category)); }
        if (a.q) { where.push("name LIKE ?"); params.push(`%${a.q}%`); }
        const rows = (await db.prepare(`SELECT * FROM leads WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 5`).bind(...params).all()).results ?? [];
        for (const r of rows) items.push({ title: r.name, meta: [r.category, r.city].filter(Boolean).join(" · "), url: "/leads" });
      }
    } catch { /* an alert over a missing table is simply empty */ }
    if (items.length) {
      const msg = [
        `<b>Mehfil alert</b> · ${a.kind}`,
        items.map((i) => `• ${i.title}${i.meta ? ` — ${i.meta}` : ""}`).join("\n"),
      ].join("\n");
      if (!silent) await notify(env, msg, "alert");
      if (a.email) await sendAlertEmail(env, { to: a.email, kind: a.kind, city: a.city, items });
      await db.prepare("UPDATE alerts SET last_fired_at = datetime('now') WHERE id = ?").bind(a.id).run();
      summary.fired++;
      summary.items += items.length;
    } else {
      await db.prepare("UPDATE alerts SET last_fired_at = COALESCE(last_fired_at, created_at) WHERE id = ?").bind(a.id).run();
    }
  }
  return summary;
}

// ----------------------------------------------------------------- routes ---

export function mountRequestRoutes(app, auth) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const err = (status, error) => json({ error }, status);
  const sameOrigin = (c) => isSameOriginRequest(c.req.raw, c.env.APP_ORIGIN);
  const ipOf = (c) => c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "";

  const authed = async (c) => {
    const fb = await auth.getUser(c.req.raw);
    if (!fb) return { error: err(401, "Sign in required") };
    await ensureRequestSchema(c.env);
    await ensureTalentSchema(c.env);
    return { me: await resolveUser(c.env.DB, fb), db: c.env.DB };
  };

  // The all-requests console contains hosts' contact details, so production
  // defaults to closed; loopback development stays open for setup.
  const ownerOnly = async (c) => {
    const r = await authed(c);
    if (r.error) return r;
    if (!isWorkspaceOwner(c.env, r.me)) {
      return { error: err(403, "This console is limited to the workspace owner") };
    }
    return r;
  };

  app.post("/api/requests", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const body = await c.req.json().catch(() => ({}));
    if (honeypotTripped(body)) return err(400, "Could not post this brief — check your details");
    const limited = await enforceRateLimit(c, { scope: "gig-brief", limit: 10, windowSec: 3600 });
    if (limited) return limited;
    const fb = await auth.getUser(c.req.raw).catch(() => null);
    const me = fb ? await resolveUser(c.env.DB, fb) : null;
    const r = await createRequest(c.env, body, { me, ip: ipOf(c) });
    if (r.error) return err(r.error[0], r.error[1]);
    return json({
      ok: true,
      token: r.request.token,
      request: r.request,
      invite: r.invite,
      host_url: hostUrl(c.env, r.request.token),
    }, 201);
  });

  app.get("/api/request/:token", async (c) => {
    await ensureRequestSchema(c.env);
    const view = await hostView(c.env.DB, c.req.param("token"));
    if (!view) return err(404, "Request not found");
    return json(view);
  });

  app.post("/api/request/:token/confirm", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const b = await c.req.json().catch(() => ({}));
    if (!b.target_id) return err(400, "target_id is required");
    const r = await confirmTarget(c.env, c.req.param("token"), String(b.target_id));
    if (r.error) return err(r.error[0], r.error[1]);
    return json(r);
  });

  app.post("/api/request/:token/cancel", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const r = await cancelRequest(c.env, c.req.param("token"));
    if (r.error) return err(r.error[0], r.error[1]);
    return json(r);
  });

  app.post("/api/request/:token/invite", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const r = await inviteMore(c.env, c.req.param("token"));
    if (r.error) return err(r.error[0], r.error[1]);
    return json(r);
  });

  app.post("/api/request/:token/message", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const b = await c.req.json().catch(() => ({}));
    const r = await postHostMessage(c.env, c.req.param("token"), b);
    if (r.error) return err(r.error[0], r.error[1]);
    return json(r, 201);
  });

  app.get("/api/respond/:token", async (c) => {
    await ensureRequestSchema(c.env);
    const view = await targetView(c.env.DB, c.req.param("token"));
    if (!view) return err(404, "This invitation link is not valid");
    if (view.target.status === "invited") {
      await c.env.DB.prepare("UPDATE request_targets SET status='viewed' WHERE id = ?").bind(view.target.id).run();
      await logRequestEvent(c.env.DB, view.request.id, "viewed", `${view.target.name} opened the invitation`, view.target.name);
      view.target.status = "viewed";
    }
    return json(view);
  });

  app.post("/api/respond/:token", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const b = await c.req.json().catch(() => ({}));
    const r = await respondToTarget(c.env, c.req.param("token"), b);
    if (r.error) return err(r.error[0], r.error[1]);
    return json(r);
  });

  app.post("/api/respond/:token/message", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const b = await c.req.json().catch(() => ({}));
    const r = await postTargetMessage(c.env, c.req.param("token"), b);
    if (r.error) return err(r.error[0], r.error[1]);
    return json(r, 201);
  });

  app.get("/api/requests/mine", async (c) => {
    const { error, me, db } = await authed(c);
    if (error) return error;
    const rows = (await db.prepare(`SELECT r.*,
        (SELECT COUNT(*) FROM request_targets t WHERE t.request_id = r.id) AS target_count,
        (SELECT COUNT(*) FROM request_targets t WHERE t.request_id = r.id AND t.status IN ('available','maybe','confirmed')) AS responses
      FROM booking_requests r WHERE r.host_id = ? ORDER BY r.created_at DESC LIMIT 50`).bind(me.id).all()).results ?? [];
    return json({ requests: rows.map((r) => ({ ...withoutIp(r), host_url: hostUrl(c.env, r.token) })) });
  });

  // Performer inbox: invitations addressed to my claimed profile.
  app.get("/api/request-invites", async (c) => {
    const { error, me, db } = await authed(c);
    if (error) return error;
    const artist = await db.prepare("SELECT * FROM artist_profiles WHERE user_id = ?").bind(me.id).first();
    if (!artist) return json({ invites: [], artist: null });
    const rows = (await db.prepare(`SELECT rt.*, r.category AS request_category, r.city AS request_city, r.area AS request_area,
        r.date AS request_date, r.start_time AS request_time, r.budget_inr, r.event_type, r.brief AS request_brief,
        r.status AS request_status, r.urgency, r.host_name
      FROM request_targets rt JOIN booking_requests r ON r.id = rt.request_id
      WHERE rt.artist_id = ? ORDER BY rt.created_at DESC LIMIT 50`).bind(artist.id).all()).results ?? [];
    return json({
      artist: { id: artist.id, available_now: !!artist.available_now, accepting_requests: !!artist.accepting_requests },
      invites: rows.map((r) => ({ ...r, respond_url: `/respond/${r.token}` })),
    });
  });

  app.post("/api/artist/availability", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, me, db } = await authed(c);
    if (error) return error;
    const artist = await db.prepare("SELECT * FROM artist_profiles WHERE user_id = ?").bind(me.id).first();
    if (!artist) return err(403, "Create an artist profile first");
    const b = await c.req.json().catch(() => ({}));
    if (b.available_now != null) await db.prepare("UPDATE artist_profiles SET available_now = ? WHERE id = ?").bind(b.available_now ? 1 : 0, artist.id).run();
    if (b.accepting_requests != null) await db.prepare("UPDATE artist_profiles SET accepting_requests = ? WHERE id = ?").bind(b.accepting_requests ? 1 : 0, artist.id).run();
    if (b.area != null) await db.prepare("UPDATE artist_profiles SET area = ? WHERE id = ?").bind(String(b.area).slice(0, 80), artist.id).run();
    const fresh = await db.prepare("SELECT available_now, accepting_requests, area FROM artist_profiles WHERE id = ?").bind(artist.id).first();
    return json({ ok: true, artist: fresh });
  });

  // Owner console: every request + response counters.
  app.get("/api/requests", async (c) => {
    const { error, db } = await ownerOnly(c);
    if (error) return error;
    const rows = (await db.prepare(`SELECT r.*,
        (SELECT COUNT(*) FROM request_targets t WHERE t.request_id = r.id) AS target_count,
        (SELECT COUNT(*) FROM request_targets t WHERE t.request_id = r.id AND t.status IN ('available','maybe')) AS responses,
        (SELECT COUNT(*) FROM request_targets t WHERE t.request_id = r.id AND t.status = 'confirmed') AS confirmed
      FROM booking_requests r ORDER BY r.created_at DESC LIMIT 100`).all()).results ?? [];
    return json({
      requests: rows.map((r) => ({ ...r, host_url: hostUrl(c.env, r.token) })),
      email: emailConfigured(c.env),
    });
  });

  app.post("/api/requests/run", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error } = await ownerOnly(c);
    if (error) return error;
    return json(await runRequestFollowups(c.env, { trigger: "manual", silent: false }));
  });

  app.get("/api/alerts", async (c) => {
    const { error, me, db } = await authed(c);
    if (error) return error;
    const rows = (await db.prepare("SELECT * FROM alerts WHERE user_id = ? OR email = ? ORDER BY created_at DESC").bind(me.id, me.email || "").all()).results ?? [];
    return json({ alerts: rows });
  });

  app.post("/api/alerts", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const body = await c.req.json().catch(() => ({}));
    const fb = await auth.getUser(c.req.raw).catch(() => null);
    const me = fb ? await resolveUser(c.env.DB, fb) : null;
    await ensureRequestSchema(c.env);
    const kind = ["artists", "shows", "leads", "jams"].includes(body.kind) ? body.kind : "artists";
    const email = String(body.email || me?.email || "").trim().toLowerCase();
    if (!me && !email) return err(400, "Add an email to receive this alert");
    if (!body.city && !body.category && !body.q && !email) return err(400, "Pick a city, category or keyword");
    const id = uid("al");
    await c.env.DB.prepare("INSERT INTO alerts (id, user_id, email, kind, city, category, max_price, q) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, me?.id || null, email, kind, String(body.city || "").slice(0, 60), String(body.category || "").slice(0, 40),
        Number(body.max_price) || 0, String(body.q || "").slice(0, 80)).run();
    return json({ ok: true, id }, 201);
  });

  app.delete("/api/alerts/:id", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, me, db } = await authed(c);
    if (error) return error;
    await db.prepare("DELETE FROM alerts WHERE id = ? AND (user_id = ? OR email = ?)").bind(c.req.param("id"), me.id, me.email || "").run();
    return json({ ok: true });
  });
}
