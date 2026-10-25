// Quick-match: two-sided swipe deck + mutual-match chat.
//
// Hirers swipe talent cards (artist profiles); artists swipe gig cards
// (open booking requests). A match forms only when BOTH sides liked each
// other — the host liked the artist profile AND the artist liked one of
// that host's open gigs. The pair then gets a chat thread.
//
// Design rules from the market research baked in:
//   - swipe is an interest signal, not the hiring system: every card links
//     to a full detail view and match → conversation is one click away;
//   - no match expiry — stale availability ages out via the request sweep,
//     the relationship itself never silently dies;
//   - rate-limited, same-origin guarded, contact stays in-app until both
//     sides choose to share it.
import { isSameOriginRequest } from "@freebuff/auth";
import { json, err, uid, parseJson, resolveUser } from "./util.js";
import { sendEmail } from "./mail.js";

// Same guard index.js uses for state-changing routes.
const sameOrigin = (c) => isSameOriginRequest(c.req.raw, c.env.APP_ORIGIN);

const DAILY_SWIPE_LIMIT = 150;
const MAX_MESSAGE_LEN = 2000;

export async function ensureDeckSchema(env) {
  const db = env.DB;
  await db.prepare(`CREATE TABLE IF NOT EXISTS deck_swipes (
    id TEXT PRIMARY KEY,
    swiper_id TEXT NOT NULL,
    side TEXT NOT NULL,
    target_key TEXT NOT NULL,
    pair_key TEXT NOT NULL,
    dir TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (swiper_id, side, target_key))`).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_deck_swipes_pair ON deck_swipes(swiper_id, pair_key, dir)"
  ).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS deck_matches (
    id TEXT PRIMARY KEY,
    host_user TEXT NOT NULL,
    artist_user TEXT NOT NULL,
    request_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (host_user, artist_user))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS chat_threads (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL UNIQUE,
    user_a TEXT NOT NULL,
    user_b TEXT NOT NULL,
    a_read_at TEXT,
    b_read_at TEXT,
    last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at TEXT)`).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_chat_messages ON chat_messages(thread_id, created_at)"
  ).run();
}

// ------------------------------------------------------------- internals ---

const cardOf = (a) => ({
  id: a.id,
  slug: a.slug,
  stage_name: a.stage_name,
  category: a.category,
  sub_skills: parseJson(a.sub_skills, []),
  languages: parseJson(a.languages, []),
  city: a.city,
  area: a.area || "",
  hue: a.hue,
  bio: String(a.bio || "").slice(0, 220),
  base_price_inr: a.base_price_inr,
  rating: a.rating,
  reviews_count: a.reviews_count,
  gigs_done: a.gigs_done,
  response_mins: a.response_mins,
  experience_years: a.experience_years,
  travel_radius_km: a.travel_radius_km,
  verified: !!a.verified,
  available_now: !!a.available_now,
  portfolio_url: a.portfolio_url || "",
  tagline: a.tagline || "",
  link: `/artist/${a.slug}`,
});

const gigCardOf = (r) => ({
  id: r.id,
  token: r.token,
  event_type: r.event_type,
  category: r.category,
  city: r.city,
  area: r.area || "",
  date: r.date,
  start_time: r.start_time,
  duration_hours: r.duration_hours,
  guest_count: r.guest_count,
  budget_inr: r.budget_inr,
  brief: String(r.brief || "").slice(0, 260),
  host_name: r.host_name || "Host",
  host_user: r.host_id,
  link: `/request/${r.token}`,
  days_until: Math.round(
    (new Date(r.date + "T12:00:00Z").getTime() - Date.now()) / 86400000
  ),
});

const meOr401 = async (c, auth) => {
  const fb = await auth.getUser(c.req.raw).catch(() => null);
  if (!fb) return { error: err(401, "Sign in required") };
  const me = await resolveUser(c.env.DB, fb);
  return { me };
};

// Thread participant helper: returns { thread, me, other } or null.
async function threadFor(db, threadId, me) {
  const t = await db.prepare("SELECT * FROM chat_threads WHERE id = ?").bind(threadId).first();
  if (!t) return null;
  if (t.user_a !== me.id && t.user_b !== me.id) return null;
  const otherId = t.user_a === me.id ? t.user_b : t.user_a;
  const other = await db.prepare("SELECT * FROM users WHERE id = ?").bind(otherId).first();
  const artist = await db
    .prepare("SELECT * FROM artist_profiles WHERE user_id = ?")
    .bind(otherId)
    .first();
  return { thread: t, me, other, artist };
}

function composeMatchEmail({ name, other, origin, threadId }) {
  const who = other.stage_name || other.name || "Someone";
  const subject = `It's a match — ${who} liked you back on Mehfil`;
  const text =
    `Hi ${name},\n\n` +
    `Good news: ${who} swiped right too. You two are matched and the chat is open.\n\n` +
    `Open the conversation: ${origin}/messages/${threadId}\n\n` +
    `Quick replies get the booking: acts that answer within the first hour are far more\n` +
    `likely to lock the gig. Introduce yourself, confirm the date, take it from there.\n\n` +
    `— Mehfil quick match`;
  return { subject, text };
}

function composeMessageEmail({ name, otherName, preview, origin, threadId }) {
  const subject = `${otherName} replied on Mehfil`;
  const text =
    `Hi ${name},\n\n` +
    `${otherName} sent you a message:\n\n` +
    `"${preview}"\n\n` +
    `Reply here: ${origin}/messages/${threadId}\n\n` +
    `— Mehfil`;
  return { subject, text };
}

// Create the match + its chat thread. Returns { match, thread }.
async function createMatch(env, { hostUser, artistUser, requestId }) {
  const db = env.DB;
  const id = uid("m");
  await db
    .prepare(
      "INSERT INTO deck_matches (id, host_user, artist_user, request_id) VALUES (?,?,?,?)"
    )
    .bind(id, hostUser, artistUser, requestId || null)
    .run();
  const threadId = uid("t");
  await db
    .prepare(
      "INSERT INTO chat_threads (id, match_id, user_a, user_b) VALUES (?,?,?,?)"
    )
    .bind(threadId, id, hostUser, artistUser)
    .run();
  const match = await db.prepare("SELECT * FROM deck_matches WHERE id = ?").bind(id).first();
  return { match, thread: { id: threadId } };
}

// Email both sides of a fresh match (best-effort; Resend may be unconfigured).
async function notifyMatch(env, { hostUser, artistUser, threadId }) {
  const db = env.DB;
  const origin = String(env.APP_ORIGIN || "").replace(/\/$/, "");
  if (!origin) return;
  const [host, artist] = await Promise.all([
    db.prepare("SELECT * FROM users WHERE id = ?").bind(hostUser).first(),
    db.prepare("SELECT * FROM users WHERE id = ?").bind(artistUser).first(),
  ]);
  const artistProfile = await db
    .prepare("SELECT * FROM artist_profiles WHERE user_id = ?")
    .bind(artistUser)
    .first();
  const jobs = [];
  if (host?.email) {
    const mail = composeMatchEmail({
      name: host.name,
      other: artistProfile || artist || {},
      origin,
      threadId,
    });
    jobs.push(sendEmail(env, { to: host.email, ...mail }));
  }
  if (artist?.email) {
    const mail = composeMatchEmail({
      name: artist.name,
      other: host || {},
      origin,
      threadId,
    });
    jobs.push(sendEmail(env, { to: artist.email, ...mail }));
  }
  await Promise.allSettled(jobs);
}

// ---------------------------------------------------------------- routes ---

export function mountDeckRoutes(app, auth) {
  // ----- deck: cards for one side -----------------------------------------
  app.get("/api/deck", async (c) => {
    const { error, me } = await meOr401(c, auth);
    if (error) return error;
    const db = c.env.DB;
    await ensureDeckSchema(c.env);
    const side = c.req.query("side") === "gig" ? "gig" : "talent";
    const city = c.req.query("city") || "";
    const category = c.req.query("category") || "";
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 18, 1), 30);

    const swipedToday = await db
      .prepare("SELECT COUNT(*) n FROM deck_swipes WHERE swiper_id = ? AND created_at >= datetime('now','-1 day')")
      .bind(me.id)
      .first();

    if (side === "talent") {
      const where = ["a.user_id != ?", "a.id NOT IN (SELECT target_key FROM deck_swipes WHERE swiper_id = ? AND side = 'talent')"];
      const params = [me.id, me.id];
      if (city) { where.push("a.city = ?"); params.push(city); }
      if (category) { where.push("a.category = ?"); params.push(category); }
      const rows = await db
        .prepare(
          `SELECT a.* FROM artist_profiles a WHERE ${where.join(" AND ")}
           ORDER BY a.verified DESC, a.available_now DESC, a.rating DESC, a.reviews_count DESC
           LIMIT ?`
        )
        .bind(...params, limit)
        .all();
      const total = await db
        .prepare(
          `SELECT COUNT(*) n FROM artist_profiles a WHERE ${where.join(" AND ")}`
        )
        .bind(...params)
        .first();
      return json({
        side,
        cards: (rows.results || []).map(cardOf),
        remaining: Number(total?.n || 0),
        swiped_today: Number(swipedToday?.n || 0),
        limit: DAILY_SWIPE_LIMIT,
      });
    }

    // gig side — the swiper needs an artist profile to be matchable.
    const myProfile = await db
      .prepare("SELECT id FROM artist_profiles WHERE user_id = ?")
      .bind(me.id)
      .first();
    if (!myProfile) {
      return json({
        side,
        cards: [],
        remaining: 0,
        need_profile: true,
        swiped_today: Number(swipedToday?.n || 0),
        limit: DAILY_SWIPE_LIMIT,
      });
    }
    const where = [
      "r.status = 'open'",
      "r.date >= date('now')",
      "r.host_id IS NOT NULL AND r.host_id != ''",
      "r.host_id != ?",
      "(r.expires_at IS NULL OR r.expires_at = '' OR r.expires_at > datetime('now'))",
      "r.id NOT IN (SELECT target_key FROM deck_swipes WHERE swiper_id = ? AND side = 'gig')",
    ];
    const params = [me.id, me.id];
    if (city) { where.push("r.city = ?"); params.push(city); }
    if (category) { where.push("(r.category = ? OR r.event_type = ?)"); params.push(category, category); }
    const rows = await db
      .prepare(
        `SELECT r.*, u.name AS host_name FROM booking_requests r
         LEFT JOIN users u ON u.id = r.host_id
         WHERE ${where.join(" AND ")}
         ORDER BY r.urgency = 'asap' DESC, r.date ASC LIMIT ?`
      )
      .bind(...params, limit)
      .all();
    const total = await db
      .prepare(`SELECT COUNT(*) n FROM booking_requests r WHERE ${where.join(" AND ")}`)
      .bind(...params)
      .first();
    return json({
      side,
      cards: (rows.results || []).map(gigCardOf),
      remaining: Number(total?.n || 0),
      swiped_today: Number(swipedToday?.n || 0),
      limit: DAILY_SWIPE_LIMIT,
    });
  });

  // ----- swipe: like / pass, mutual interest becomes a match ---------------
  app.post("/api/deck/swipe", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, me } = await meOr401(c, auth);
    if (error) return error;
    const db = c.env.DB;
    await ensureDeckSchema(c.env);
    const body = await c.req.json().catch(() => ({}));
    const side = body.side === "gig" ? "gig" : "talent";
    const dir = body.dir === "like" ? "like" : "pass";
    const target = String(body.target || "");
    if (!target) return err(400, "target is required");

    const today = await db
      .prepare("SELECT COUNT(*) n FROM deck_swipes WHERE swiper_id = ? AND created_at >= datetime('now','-1 day')")
      .bind(me.id)
      .first();
    if (Number(today?.n || 0) >= DAILY_SWIPE_LIMIT) {
      return err(429, `Daily limit of ${DAILY_SWIPE_LIMIT} swipes reached — come back tomorrow`);
    }

    // Validate the target and resolve the OTHER side's user id.
    let pairKey = "";
    let request = null;
    if (side === "talent") {
      const artist = await db
        .prepare("SELECT * FROM artist_profiles WHERE id = ?")
        .bind(target)
        .first();
      if (!artist) return err(404, "Artist not found");
      if (artist.user_id === me.id) return err(409, "That's your own profile");
      pairKey = artist.user_id;
    } else {
      request = await db
        .prepare("SELECT * FROM booking_requests WHERE id = ?")
        .bind(target)
        .first();
      if (!request) return err(404, "Gig not found");
      if (request.host_id === me.id) return err(409, "That's your own gig");
      if (request.status !== "open") return err(409, "This gig is no longer open");
      pairKey = request.host_id;
      const myProfile = await db
        .prepare("SELECT id FROM artist_profiles WHERE user_id = ?")
        .bind(me.id)
        .first();
      if (!myProfile) return err(403, "Create your artist profile to swipe gigs");
    }

    const existing = await db
      .prepare("SELECT * FROM deck_swipes WHERE swiper_id = ? AND side = ? AND target_key = ?")
      .bind(me.id, side, target)
      .first();
    let swipeId = "";
    if (existing) {
      if (existing.dir === dir) return json({ swipe: { id: existing.id, dir }, match: null });
      swipeId = existing.id;
      await db
        .prepare("UPDATE deck_swipes SET dir = ?, created_at = datetime('now') WHERE id = ?")
        .bind(dir, existing.id)
        .run();
    } else {
      swipeId = uid("s");
      await db
        .prepare(
          "INSERT INTO deck_swipes (id, swiper_id, side, target_key, pair_key, dir) VALUES (?,?,?,?,?,?)"
        )
        .bind(swipeId, me.id, side, target, pairKey, dir)
        .run();
    }
    if (dir === "pass") return json({ swipe: { id: swipeId, dir }, match: null });

    // Did the other side already like us?
    let match = null;
    if (side === "talent") {
      // I (host) liked artist profile → has that artist liked one of my gigs?
      const theirLike = await db
        .prepare(
          `SELECT s.* FROM deck_swipes s
           WHERE s.swiper_id = ? AND s.side = 'gig' AND s.dir = 'like' AND s.pair_key = ?
           ORDER BY s.created_at DESC LIMIT 1`
        )
        .bind(pairKey, me.id)
        .first();
      if (theirLike) {
        const created = await createMatch(c.env, {
          hostUser: me.id,
          artistUser: pairKey,
          requestId: theirLike.target_key,
        });
        match = created;
        await notifyMatch(c.env, {
          hostUser: me.id,
          artistUser: pairKey,
          threadId: created.thread.id,
        });
      }
    } else {
      // I (artist) liked a gig → has its host already liked my profile?
      const myProfile = await db
        .prepare("SELECT id FROM artist_profiles WHERE user_id = ?")
        .bind(me.id)
        .first();
      const theirLike = await db
        .prepare(
          `SELECT * FROM deck_swipes
           WHERE swiper_id = ? AND side = 'talent' AND dir = 'like' AND target_key = ?`
        )
        .bind(pairKey, myProfile.id)
        .first();
      if (theirLike) {
        const created = await createMatch(c.env, {
          hostUser: pairKey,
          artistUser: me.id,
          requestId: request.id,
        });
        match = created;
        await notifyMatch(c.env, {
          hostUser: pairKey,
          artistUser: me.id,
          threadId: created.thread.id,
        });
      }
    }

    let out = null;
    if (match) {
      const otherId = side === "talent" ? pairKey : pairKey;
      const otherUser = await db.prepare("SELECT * FROM users WHERE id = ?").bind(otherId).first();
      const otherArtist = await db
        .prepare("SELECT * FROM artist_profiles WHERE user_id = ?")
        .bind(otherId)
        .first();
      out = {
        id: match.match.id,
        thread_id: match.thread.id,
        other: {
          name: otherUser?.name || "New match",
          hue: otherArtist?.hue || 265,
          stage_name: otherArtist?.stage_name || "",
          category: otherArtist?.category || "",
          slug: otherArtist?.slug || "",
        },
      };
    }
    return json({ swipe: { id: swipeId, dir }, match: out });
  });

  // ----- undo a swipe (blocked once it became a match) ---------------------
  app.post("/api/deck/undo", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, me } = await meOr401(c, auth);
    if (error) return error;
    const db = c.env.DB;
    const { swipe_id } = await c.req.json().catch(() => ({}));
    const swipe = await db
      .prepare("SELECT * FROM deck_swipes WHERE id = ? AND swiper_id = ?")
      .bind(String(swipe_id || ""), me.id)
      .first();
    if (!swipe) return err(404, "Swipe not found");
    // A mutual like sealed into a match can't be quietly walked back.
    const matched = await db
      .prepare(
        "SELECT 1 FROM deck_matches WHERE status = 'active' AND ((host_user = ? AND artist_user = ?) OR (host_user = ? AND artist_user = ?))"
      )
      .bind(me.id, swipe.pair_key, swipe.pair_key, me.id)
      .first();
    if (matched) return err(409, "You matched — say hi instead of unmatching");
    await db.prepare("DELETE FROM deck_swipes WHERE id = ?").bind(swipe.id).run();
    return json({ ok: true, side: swipe.side, target: swipe.target_key });
  });

  // ----- matches + inbox ---------------------------------------------------
  app.get("/api/deck/matches", async (c) => {
    const { error, me } = await meOr401(c, auth);
    if (error) return error;
    const db = c.env.DB;
    await ensureDeckSchema(c.env);
    const rows = await db
      .prepare(
        `SELECT m.*, t.id AS thread_id, t.last_message_at, t.a_read_at, t.b_read_at,
                (SELECT COUNT(*) FROM chat_messages msg WHERE msg.thread_id = t.id
                   AND msg.sender_id != ? AND msg.read_at IS NULL) AS unread
         FROM deck_matches m JOIN chat_threads t ON t.match_id = m.id
         WHERE m.status = 'active' AND (m.host_user = ? OR m.artist_user = ?)
         ORDER BY t.last_message_at DESC`
      )
      .bind(me.id, me.id, me.id)
      .all();
    const matches = [];
    for (const r of rows.results || []) {
      const otherId = r.host_user === me.id ? r.artist_user : r.host_user;
      const [otherUser, otherArtist, last] = await Promise.all([
        db.prepare("SELECT id, name FROM users WHERE id = ?").bind(otherId).first(),
        db.prepare("SELECT * FROM artist_profiles WHERE user_id = ?").bind(otherId).first(),
        db
          .prepare(
            "SELECT body, sender_id, created_at FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
          )
          .bind(r.thread_id)
          .first(),
      ]);
      matches.push({
        id: r.id,
        thread_id: r.thread_id,
        created_at: r.created_at,
        last_message_at: r.last_message_at,
        unread: Number(r.unread || 0),
        last_message: last || null,
        i_am: r.host_user === me.id ? "host" : "artist",
        other: {
          id: otherId,
          name: otherUser?.name || "Match",
          stage_name: otherArtist?.stage_name || "",
          category: otherArtist?.category || "",
          hue: otherArtist?.hue || 265,
          slug: otherArtist?.slug || "",
          verified: !!otherArtist?.verified,
          profile_link: otherArtist?.slug ? `/artist/${otherArtist.slug}` : "",
        },
      });
    }
    const totalUnread = matches.reduce((s, m) => s + m.unread, 0);
    return json({ matches, unread_total: totalUnread });
  });

  // ----- thread messages (polled) -----------------------------------------
  app.get("/api/deck/threads/:id", async (c) => {
    const { error, me } = await meOr401(c, auth);
    if (error) return error;
    const db = c.env.DB;
    const t = await threadFor(db, c.req.param("id"), me);
    if (!t) return err(404, "Conversation not found");
    const after = Number(c.req.query("after")) || 0;
    const rows = await db
      .prepare(
        `SELECT rowid AS seq, * FROM chat_messages WHERE thread_id = ? AND rowid > ?
         ORDER BY created_at ASC, rowid ASC LIMIT 200`
      )
      .bind(t.thread.id, after)
      .all();
    const unreadRow = await db
      .prepare(
        "SELECT COUNT(*) n FROM chat_messages WHERE thread_id = ? AND sender_id != ? AND read_at IS NULL"
      )
      .bind(t.thread.id, me.id)
      .first();
    return json({
      unread: Number(unreadRow?.n || 0),
      thread: {
        id: t.thread.id,
        other: {
          id: t.other?.id || "",
          name: t.other?.name || "Match",
          stage_name: t.artist?.stage_name || "",
          category: t.artist?.category || "",
          hue: t.artist?.hue || 265,
          slug: t.artist?.slug || "",
          profile_link: t.artist?.slug ? `/artist/${t.artist.slug}` : "",
          response_mins: t.artist?.response_mins || null,
        },
      },
      messages: rows.results || [],
      cursor: (rows.results || []).reduce((m, r) => Math.max(m, Number(r.seq || 0)), after),
    });
  });

  // ----- send a message ----------------------------------------------------
  app.post("/api/deck/threads/:id/messages", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, me } = await meOr401(c, auth);
    if (error) return error;
    const db = c.env.DB;
    const t = await threadFor(db, c.req.param("id"), me);
    if (!t) return err(404, "Conversation not found");
    const body = await c.req.json().catch(() => ({}));
    const text = String(body.body || "").trim().slice(0, MAX_MESSAGE_LEN);
    if (!text) return err(400, "Message is empty");

    // Light spam brake: >8 messages inside a minute is a bot, not a booker.
    const flood = await db
      .prepare(
        "SELECT COUNT(*) n FROM chat_messages WHERE thread_id = ? AND sender_id = ? AND created_at >= datetime('now','-1 minute')"
      )
      .bind(t.thread.id, me.id)
      .first();
    if (Number(flood?.n || 0) >= 8) return err(429, "Slow down a moment before sending more");

    const id = uid("msg");
    await db
      .prepare(
        "INSERT INTO chat_messages (id, thread_id, sender_id, body) VALUES (?,?,?,?)"
      )
      .bind(id, t.thread.id, me.id, text)
      .run();
    await db
      .prepare(
        `UPDATE chat_threads SET last_message_at = datetime('now'),
           ${t.thread.user_a === me.id ? "a_read_at" : "b_read_at"} = datetime('now')
         WHERE id = ?`
      )
      .bind(t.thread.id)
      .run();

    // Email the other side (they're away until they reopen the poll).
    const origin = String(c.env.APP_ORIGIN || "").replace(/\/$/, "");
    if (t.other?.email && origin) {
      const mail = composeMessageEmail({
        name: t.other.name,
        otherName: t.artist?.stage_name || me.name || "Your match",
        preview: text.slice(0, 160),
        origin,
        threadId: t.thread.id,
      });
      await sendEmail(c.env, { to: t.other.email, ...mail }).catch(() => null);
    }

    const msg = await db
      .prepare("SELECT rowid AS seq, * FROM chat_messages WHERE id = ?")
      .bind(id)
      .first();
    return json({ message: msg }, 201);
  });

  // ----- mark read (called by the open thread on every poll) --------------
  app.post("/api/deck/threads/:id/read", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, me } = await meOr401(c, auth);
    if (error) return error;
    const db = c.env.DB;
    const t = await threadFor(db, c.req.param("id"), me);
    if (!t) return err(404, "Conversation not found");
    await db
      .prepare("UPDATE chat_messages SET read_at = datetime('now') WHERE thread_id = ? AND sender_id != ?")
      .bind(t.thread.id, me.id)
      .run();
    const col = t.thread.user_a === me.id ? "a_read_at" : "b_read_at";
    // col is a fixed internal column name chosen above, never user input.
    await db
      .prepare(`UPDATE chat_threads SET ${col} = datetime('now') WHERE id = ?`)
      .bind(t.thread.id)
      .run();
    return json({ ok: true });
  });
}
