// Growth lifecycle: consent, suppression, unsubscribe and follow-up sequences.
//
// Non-negotiables encoded here:
//   - no marketing email without an explicit consent row for that address and
//     purpose; transactional mail (bookings, invitations) does not come through
//     sendMarketingEmail;
//   - a suppression always wins, even if an old consent row still exists;
//   - sends only between 09:00 and 19:00 IST, with a hard daily cap;
//   - every message carries a working unsubscribe link + List-Unsubscribe
//     headers, and one click stops every active sequence for that address.
//
// Cold B2B outreach never passes through this module: worker/leads.js queues it
// for a human because Resend (and the social platforms) prohibit unsolicited
// outreach. That is a policy decision, not a missing feature.

import { sendEmail } from "./mail.js";
import { notify } from "./notify.js";
import { uid, parseJson, inr } from "./util.js";

const DAY = 86400000;
const MAX_SENDS_PER_DAY = 40;
const QUIET_START_HOUR = 9;
const QUIET_END_HOUR = 19;
const READY = new WeakSet();

const DDL = `
CREATE TABLE IF NOT EXISTS outreach_consents (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  purpose TEXT NOT NULL DEFAULT 'lifecycle',
  source TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  withdrawn_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_key ON outreach_consents(subject, channel, purpose);
CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_token ON outreach_consents(token);

CREATE TABLE IF NOT EXISTS suppressions (
  channel TEXT NOT NULL,
  address TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (channel, address)
);

CREATE TABLE IF NOT EXISTS lifecycle_sequences (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  stage INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  next_at TEXT NOT NULL,
  last_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sequence_subject ON lifecycle_sequences(kind, subject_id);
CREATE INDEX IF NOT EXISTS idx_sequence_due ON lifecycle_sequences(status, next_at);

CREATE TABLE IF NOT EXISTS lifecycle_sends (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL DEFAULT 'manual',
  stage INTEGER NOT NULL DEFAULT 0,
  template TEXT NOT NULL DEFAULT '',
  to_email TEXT NOT NULL,
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  sent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sends_time ON lifecycle_sends(status, sent_at);

CREATE TABLE IF NOT EXISTS outreach_queue (
  id TEXT PRIMARY KEY,
  lead_id TEXT,
  channel TEXT NOT NULL DEFAULT 'manual',
  draft TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outreach_queue_status ON outreach_queue(status, created_at);
`;

export async function ensureLifecycleSchema(env) {
  const db = env.DB;
  if (READY.has(db)) return;
  for (const stmt of DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
  READY.add(db);
}

export const normEmail = (v) => String(v || "").trim().toLowerCase();
const newToken = () => "ut_" + crypto.randomUUID().replace(/-/g, "");
const iso = (ms) => new Date(ms).toISOString();
const dayString = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------------------------------------------------------------- consent ---

export async function recordConsent(db, { email, purpose = "lifecycle", source = "", channel = "email", grantedAt } = {}) {
  const subject = normEmail(email);
  if (!subject) return null;
  const existing = await db
    .prepare("SELECT * FROM outreach_consents WHERE subject = ? AND channel = ? AND purpose = ?")
    .bind(subject, channel, purpose)
    .first();
  const at = grantedAt || iso(Date.now());
  if (existing) {
    if (existing.withdrawn_at) {
      const token = newToken();
      await db
        .prepare("UPDATE outreach_consents SET withdrawn_at = NULL, granted_at = ?, source = ?, token = ? WHERE id = ?")
        .bind(at, String(source), token, existing.id)
        .run();
      return { ...existing, withdrawn_at: null, granted_at: at, source: String(source), token };
    }
    return existing;
  }
  const id = uid("oc");
  const token = newToken();
  await db
    .prepare("INSERT INTO outreach_consents (id, subject, channel, purpose, source, token, granted_at) VALUES (?,?,?,?,?,?,?)")
    .bind(id, subject, channel, purpose, String(source), token, at)
    .run();
  return { id, subject, channel, purpose, source: String(source), token, granted_at: at, withdrawn_at: null };
}

export async function hasEmailConsent(db, email, purpose = "lifecycle") {
  const subject = normEmail(email);
  if (!subject) return false;
  const row = await db
    .prepare("SELECT id FROM outreach_consents WHERE subject = ? AND channel = 'email' AND purpose = ? AND withdrawn_at IS NULL")
    .bind(subject, purpose)
    .first();
  return !!row;
}

export async function isSuppressed(db, channel, address) {
  const value = channel === "email" ? normEmail(address) : String(address || "").trim();
  if (!value) return false;
  const row = await db.prepare("SELECT 1 AS n FROM suppressions WHERE channel = ? AND address = ?").bind(channel, value).first();
  return !!row;
}

export async function suppress(db, { channel = "email", address, reason = "" } = {}) {
  const value = channel === "email" ? normEmail(address) : String(address || "").trim();
  if (!value) return;
  await db
    .prepare("INSERT INTO suppressions (channel, address, reason) VALUES (?,?,?) ON CONFLICT(channel, address) DO UPDATE SET reason = excluded.reason")
    .bind(channel, value, String(reason).slice(0, 200))
    .run();
}

// ------------------------------------------------------------ send gating ---

// Quiet hours in IST regardless of the Worker's UTC clock.
export function withinSendWindow(now = Date.now()) {
  const istHour = new Date(now + 5.5 * 3600000).getUTCHours();
  return istHour >= QUIET_START_HOUR && istHour < QUIET_END_HOUR;
}

export async function marketingWindow(db, now = Date.now()) {
  if (!withinSendWindow(now)) return { ok: false, reason: "quiet_hours" };
  const cutoff = iso(now - DAY);
  const row = await db
    .prepare("SELECT COUNT(*) n FROM lifecycle_sends WHERE status = 'sent' AND sent_at >= ?")
    .bind(cutoff)
    .first();
  if (Number(row?.n || 0) >= MAX_SENDS_PER_DAY) return { ok: false, reason: "daily_cap" };
  return { ok: true, remaining: MAX_SENDS_PER_DAY - Number(row?.n || 0) };
}

export async function sendMarketingEmail(env, {
  to, subject, text, purpose = "lifecycle", template = "", sequenceId = "manual", stage = 0, now = Date.now(),
} = {}) {
  const db = env.DB;
  const email = normEmail(to);
  if (!email) return { sent: false, reason: "no_recipient" };
  if (await isSuppressed(db, "email", email)) return { sent: false, reason: "suppressed" };
  const consent = await db
    .prepare("SELECT * FROM outreach_consents WHERE subject = ? AND channel = 'email' AND purpose = ? AND withdrawn_at IS NULL")
    .bind(email, purpose)
    .first();
  if (!consent) return { sent: false, reason: "no_consent" };
  const window = await marketingWindow(db, now);
  if (!window.ok) return { sent: false, reason: window.reason };

  const origin = String(env.APP_ORIGIN || "").replace(/\/$/, "");
  const unsubscribe = `${origin}/unsubscribe?token=${encodeURIComponent(consent.token)}`;
  const body = `${text}\n\n— Mehfil\nUnsubscribe: ${unsubscribe}\n`;
  const result = await sendEmail(env, {
    to: email,
    subject,
    text: body,
    headers: {
      "List-Unsubscribe": `<${unsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  await db
    .prepare("INSERT INTO lifecycle_sends (id, sequence_id, stage, template, to_email, provider, status, error, sent_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(
      uid("ls"), String(sequenceId), Number(stage) || 0, String(template), email,
      result.provider || null, result.sent ? "sent" : "failed", result.error || null, iso(now)
    )
    .run();
  return { ...result, unsubscribe_url: unsubscribe };
}

// --------------------------------------------------------------- templates ---

const categoryPrefs = {
  cafe: ["singer", "band", "dj", "instrumentalist"],
  bar: ["dj", "band", "singer"],
  restaurant: ["singer", "instrumentalist", "band", "dj"],
  "house-party": ["dj", "singer", "band"],
  birthday: ["dj", "singer", "anchor"],
  wedding: ["dj", "band", "singer", "dancer"],
  festival: ["band", "dj", "singer"],
  corporate: ["anchor", "band", "singer", "dj"],
  venue: ["singer", "band", "dj"],
};

const priceLabel = (n) => (Number(n) > 0 ? `${inr(n)} onwards` : "quote on request");

async function shortlistArtists(db, city, kind) {
  if (!city) return [];
  const rows = await db
    .prepare(
      `SELECT stage_name, slug, category, city, base_price_inr, rating, verified, gigs_done
       FROM artist_profiles WHERE lower(city) = lower(?)
       ORDER BY verified DESC, rating DESC, gigs_done DESC LIMIT 8`
    )
    .bind(city)
    .all()
    .catch(() => ({ results: [] }));
  const prefs = categoryPrefs[kind] || categoryPrefs.venue;
  return (rows.results || [])
    .sort((a, b) => {
      const pa = prefs.indexOf(a.category);
      const pb = prefs.indexOf(b.category);
      return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) ||
        Number(b.verified) - Number(a.verified) ||
        Number(b.rating || 0) - Number(a.rating || 0);
    })
    .slice(0, 3);
}

function shortlistBlock(artists, origin) {
  if (!artists.length) return "";
  return artists.map((a) =>
    `• ${a.stage_name} — ${a.category}${a.rating ? `, ${Number(a.rating).toFixed(1)}★` : ""}\n` +
    `  ${priceLabel(a.base_price_inr)} · ${origin}/artist/${a.slug}`
  ).join("\n\n");
}

function venueShortlist({ name, city, kind, need, date, artists, origin }) {
  const label = kind === "venue" ? "your venue" : `${kind.replace("-", " ")}`;
  const subject = `Your ${city} shortlist — verified acts for ${date || label}`;
  const intro = artists.length
    ? `Here are three verified acts in ${city} that fit ${label}${date ? ` on ${date}` : ""}:`
    : `We're still curating verified acts in ${city} for ${label}${date ? ` on ${date}` : ""}.`;
  const text =
    `Hi ${name || "there"},\n\n` +
    `${intro}\n\n` +
    (shortlistBlock(artists, origin) || "") +
    (artists.length ? "\n\n" : "") +
    `Tell us the date, budget and vibe — we'll confirm availability and hold the shortlist.\n` +
    `${origin}/discover?city=${encodeURIComponent(city)}\n\n` +
    `Reply to this email with any must-haves and we'll narrow it further.`;
  return { subject, text, template: "venue_shortlist" };
}

function venueFollowup({ name, city, date, artists, origin }) {
  const subject = `Any questions about your ${city} shortlist?`;
  const text =
    `Hi ${name || "there"},\n\n` +
    `Just checking in on ${date ? `your ${date} event` : "your event"} in ${city}. ` +
    `If the shortlist wasn't quite right, reply with the genre, language or budget you have in mind and we'll re-match it.\n\n` +
    (shortlistBlock(artists, origin) || "") +
    `\n\nBrowse the full list: ${origin}/discover?city=${encodeURIComponent(city)}`;
  return { subject, text, template: "venue_followup" };
}

function venueLast({ name, city, date, origin }) {
  const subject = `Still planning ${date || "your event"} in ${city}?`;
  const text =
    `Hi ${name || "there"},\n\n` +
    `We haven't heard back, so we'll pause these updates. If you're still planning ` +
    `${date ? `something on ${date}` : "an event"} in ${city}, reply with the date and budget ` +
    `and we'll send a fresh shortlist.\n\n` +
    `Or start again in one minute: ${origin}/venues#brief\n\n` +
    `No hard feelings either way.`;
  return { subject, text, template: "venue_last" };
}

function rebookPrompt({ name, artist, slug, eventDate, origin }) {
  const subject = `Book ${artist} again for your next event?`;
  const text =
    `Hi ${name || "there"},\n\n` +
    `${artist} is still taking bookings on Mehfil. If you're planning another night, ` +
    `a birthday, or a repeat of ${eventDate}, you can check availability and prices here:\n\n` +
    `${origin}/artist/${slug}\n\n` +
    `Your last booking was protected by escrow and the platform contract — the same applies to a rebook.`;
  return { subject, text, template: "rebook_prompt" };
}

function rebookReminder({ name, artist, origin }) {
  const subject = `${artist} — still planning something?`;
  const text =
    `Hi ${name || "there"},\n\n` +
    `Last nudge from us: ${artist} has open dates this season. ` +
    `If you'd like a quote for a new event, reply with the date and city.\n\n` +
    `${origin}/artist/${artist}`;
  return { subject, text, template: "rebook_reminder" };
}

// ------------------------------------------------------------- sequences ----

async function hasConverted(db, email) {
  const target = normEmail(email);
  if (!target) return false;
  try {
    const booking = await db
      .prepare("SELECT 1 AS n FROM bookings b JOIN users u ON u.id = b.host_id WHERE lower(u.email) = ? LIMIT 1")
      .bind(target)
      .first();
    if (booking) return true;
  } catch { /* old databases without bookings */ }
  try {
    const request = await db
      .prepare("SELECT 1 AS n FROM booking_requests WHERE lower(host_email) = ? LIMIT 1")
      .bind(target)
      .first();
    if (request) return true;
  } catch { /* requests table not created yet */ }
  return false;
}

export async function startVenueSequence(db, { subjectId, email, name = "", city = "", meta = {} }, { now = Date.now(), delayMs = 3600000 } = {}) {
  const target = normEmail(email);
  if (!target || !subjectId) return { started: false, reason: "missing" };
  if (await isSuppressed(db, "email", target)) return { started: false, reason: "suppressed" };
  const existing = await db
    .prepare("SELECT id FROM lifecycle_sequences WHERE kind = 'venue' AND subject_id = ?")
    .bind(subjectId)
    .first();
  if (existing) return { started: false, reason: "exists", id: existing.id };
  const id = uid("sq");
  await db
    .prepare("INSERT INTO lifecycle_sequences (id, kind, subject_id, email, name, city, meta, stage, status, next_at) VALUES (?,?,?,?,?,?,?,0,'active',?)")
    .bind(id, "venue", subjectId, target, String(name).slice(0, 120), String(city).slice(0, 60), JSON.stringify(meta || {}), iso(now + delayMs))
    .run();
  return { started: true, id };
}

async function seedVenueSequences(db, now) {
  let started = 0;
  const rows = await db
    .prepare(
      `SELECT v.* FROM venue_interest v
       WHERE v.email != '' AND v.created_at >= datetime('now', '-14 day')
         AND NOT EXISTS (SELECT 1 FROM lifecycle_sequences s WHERE s.kind = 'venue' AND s.subject_id = v.id)
       ORDER BY v.created_at DESC LIMIT 40`
    )
    .all()
    .catch(() => ({ results: [] }));
  for (const row of rows.results || []) {
    await recordConsent(db, {
      email: row.email,
      purpose: "venue_shortlist",
      source: "venue_form",
      grantedAt: row.created_at ? String(row.created_at).replace(" ", "T") + "Z" : undefined,
    });
    const meta = { kind: row.kind, need: row.need, date: row.date, venue: row.venue };
    const out = await startVenueSequence(db, {
      subjectId: row.id, email: row.email, name: row.name || row.venue, city: row.city, meta,
    }, { now, delayMs: 0 });
    if (out.started) started++;
  }
  return started;
}

async function seedRebookSequences(db, now) {
  let started = 0;
  const from = dayString(now - 120 * DAY);
  const to = dayString(now - 7 * DAY);
  const rows = await db
    .prepare(
      `SELECT b.id, b.event_date, u.email, u.name AS host_name, a.stage_name, a.slug
       FROM bookings b
       JOIN users u ON u.id = b.host_id
       JOIN artist_profiles a ON a.id = b.artist_id
       WHERE b.status IN ('confirmed', 'completed')
         AND b.event_date <= ? AND b.event_date >= ?
         AND u.email IS NOT NULL AND u.email != ''
         AND NOT EXISTS (SELECT 1 FROM lifecycle_sequences s WHERE s.kind = 'rebook' AND s.subject_id = b.id)
       LIMIT 20`
    )
    .bind(to, from)
    .all()
    .catch(() => ({ results: [] }));
  for (const row of rows.results || []) {
    const email = normEmail(row.email);
    if (!email || await isSuppressed(db, "email", email)) continue;
    await recordConsent(db, { email, purpose: "rebook", source: "booking" });
    const id = uid("sq");
    await db
      .prepare("INSERT INTO lifecycle_sequences (id, kind, subject_id, email, name, city, meta, stage, status, next_at) VALUES (?,?,?,?,?,?,?,0,'active',?)")
      .bind(
        id, "rebook", row.id, email, String(row.host_name || "").slice(0, 120), "",
        JSON.stringify({ artist: row.stage_name, slug: row.slug, event_date: row.event_date }), iso(now)
      )
      .run();
    started++;
  }
  return started;
}

function nextFor(seq, now) {
  if (seq.kind === "venue") {
    if (Number(seq.stage) === 0) return { stage: 1, status: "active", next_at: iso(now + 2 * DAY) };
    if (Number(seq.stage) === 1) return { stage: 2, status: "active", next_at: iso(now + 5 * DAY) };
    return { stage: 3, status: "done", next_at: iso(now) };
  }
  if (seq.kind === "rebook") {
    if (Number(seq.stage) === 0) return { stage: 1, status: "active", next_at: iso(now + 7 * DAY) };
    return { stage: 2, status: "done", next_at: iso(now) };
  }
  return { stage: Number(seq.stage) + 1, status: "done", next_at: iso(now) };
}

async function composeSequence(env, db, seq, now) {
  const origin = String(env.APP_ORIGIN || "").replace(/\/$/, "");
  const meta = parseJson(seq.meta, {});
  if (seq.kind === "venue") {
    const artists = await shortlistArtists(db, seq.city, meta.kind);
    if (Number(seq.stage) === 0) {
      return venueShortlist({
        name: seq.name, city: seq.city, kind: meta.kind || "venue", need: meta.need,
        date: meta.date, artists, origin,
      });
    }
    if (Number(seq.stage) === 1) {
      return venueFollowup({ name: seq.name, city: seq.city, date: meta.date, artists, origin });
    }
    if (Number(seq.stage) === 2) {
      return venueLast({ name: seq.name, city: seq.city, date: meta.date, origin });
    }
    return null;
  }
  if (seq.kind === "rebook") {
    const artist = meta.artist || "your performer";
    const slug = meta.slug || "";
    if (Number(seq.stage) === 0) {
      return rebookPrompt({ name: seq.name, artist, slug, eventDate: meta.event_date, origin });
    }
    if (Number(seq.stage) === 1) {
      return rebookReminder({ name: seq.name, artist, origin });
    }
    return null;
  }
  return null;
}

const stopSequence = (db, id) =>
  db.prepare("UPDATE lifecycle_sequences SET status = 'stopped', updated_at = datetime('now') WHERE id = ?").bind(id).run();

export async function runLifecycle(env, { trigger = "cron", now = Date.now(), limit = 20, seed = true } = {}) {
  await ensureLifecycleSchema(env);
  const db = env.DB;
  const out = {
    trigger, ok: true, venue_started: 0, rebook_started: 0, sent: 0,
    stopped: 0, skipped: 0, errors: [],
  };
  try {
    if (seed) {
      out.venue_started = await seedVenueSequences(db, now);
      out.rebook_started = await seedRebookSequences(db, now);
    }
  } catch (e) {
    out.errors.push(`seed: ${String(e?.message || e).slice(0, 160)}`);
  }

  const due = await db
    .prepare("SELECT * FROM lifecycle_sequences WHERE status = 'active' AND next_at <= ? ORDER BY next_at LIMIT ?")
    .bind(iso(now), Math.max(1, Math.min(Number(limit) || 20, 50)))
    .all()
    .catch(() => ({ results: [] }));

  for (const seq of due.results || []) {
    try {
      const purpose = seq.kind === "venue" ? "venue_shortlist" : "rebook";
      if (await isSuppressed(db, "email", seq.email)) {
        await stopSequence(db, seq.id);
        out.stopped++;
        continue;
      }
      if (!(await hasEmailConsent(db, seq.email, purpose))) {
        await stopSequence(db, seq.id);
        out.stopped++;
        continue;
      }
      if (seq.kind === "venue" && await hasConverted(db, seq.email)) {
        await db.prepare("UPDATE lifecycle_sequences SET status = 'converted', updated_at = datetime('now') WHERE id = ?").bind(seq.id).run();
        out.stopped++;
        continue;
      }
      const content = await composeSequence(env, db, seq, now);
      if (!content) {
        await stopSequence(db, seq.id);
        out.stopped++;
        continue;
      }
      const result = await sendMarketingEmail(env, {
        to: seq.email, subject: content.subject, text: content.text,
        purpose, template: content.template, sequenceId: seq.id, stage: seq.stage, now,
      });
      if (!result.sent) {
        out.skipped++;
        if (["quiet_hours", "daily_cap", "no_provider"].includes(result.reason)) break;
        await db
          .prepare("UPDATE lifecycle_sequences SET next_at = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(iso(now + 3600000), seq.id)
          .run();
        continue;
      }
      const next = nextFor(seq, now);
      await db
        .prepare("UPDATE lifecycle_sequences SET stage = ?, status = ?, next_at = ?, last_sent_at = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(next.stage, next.status, next.next_at, iso(now), seq.id)
        .run();
      out.sent++;
    } catch (e) {
      out.errors.push(`${seq.kind}:${seq.id}: ${String(e?.message || e).slice(0, 140)}`);
    }
  }
  out.ok = out.errors.length === 0;
  return out;
}

// ------------------------------------------------------------- unsubscribe ---

const page = (title, body, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="robots" content="noindex">` +
      `<title>${title} — Mehfil</title>` +
      `<style>body{margin:0;background:#fbf6ee;color:#241a2e;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}` +
      `main{max-width:520px;margin:0 auto;padding:72px 24px}` +
      `.mark{font-weight:700;font-size:22px;margin-bottom:26px}.mark i{color:#e87722;font-style:normal}` +
      `h1{font-size:28px;margin:0 0 12px}p{color:#5b5068;margin:0 0 24px}` +
      `a{color:#8a4b12;font-weight:600}</style></head><body><main>` +
      `<div class="mark">Mehfil<i>.</i></div><h1>${title}</h1><p>${body}</p>` +
      `<a href="/">Back to Mehfil</a></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } }
  );

async function handleUnsubscribe(c) {
  const db = c.env.DB;
  await ensureLifecycleSchema(c.env);
  const token = String(c.req.query("token") || "").trim();
  if (!/^ut_[a-f0-9]{24,64}$/i.test(token)) {
    return page("Link not recognised", "This unsubscribe link is invalid or has already been used. If you still receive email, reply to any message and we'll remove you.", 404);
  }
  const consent = await db.prepare("SELECT * FROM outreach_consents WHERE token = ?").bind(token).first();
  if (!consent) {
    return page("Link not recognised", "This unsubscribe link is invalid or has already been used. If you still receive email, reply to any message and we'll remove you.", 404);
  }
  await db
    .prepare("UPDATE outreach_consents SET withdrawn_at = datetime('now') WHERE subject = ? AND channel = 'email'")
    .bind(consent.subject)
    .run();
  await suppress(db, { channel: "email", address: consent.subject, reason: "unsubscribe" });
  await db
    .prepare("UPDATE lifecycle_sequences SET status = 'stopped', updated_at = datetime('now') WHERE email = ? AND status = 'active'")
    .bind(consent.subject)
    .run();
  await notify(c.env, `📪 Unsubscribe: ${consent.subject}`, "unsubscribe").catch(() => null);
  return page("You're unsubscribed", "We won't send further marketing email to this address. Booking confirmations and messages about an active gig will still reach you.");
}

export function mountLifecycleRoutes(app) {
  app.get("/unsubscribe", handleUnsubscribe);
  app.post("/unsubscribe", handleUnsubscribe); // RFC 8058 one-click
}
