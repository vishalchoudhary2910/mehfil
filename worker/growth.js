// Growth toolkit: artist referral loop + venue/occasion demand capture.
//
// Two cold-start problems from the market research, solved as product:
//   1. Supply — recognized artists invite the unlisted ones they know.
//      Two invites that complete a listing unlock the Founding Artist badge
//      (an existing, already-styled trust signal), so the loop rewards real
//      recruitment instead of vanity shares.
//   2. Demand — cafés, bars, restaurants, house parties, weddings and
//      festivals get a low-friction "tell us your night" capture that lands
//      as a structured lead for the outreach engines.
import { isSameOriginRequest } from "@freebuff/auth";
import { json, err, uid, resolveUser } from "./util.js";
import { sendEmail } from "./mail.js";
import { ensureLifecycleSchema, recordConsent, startVenueSequence } from "./lifecycle.js";
import { enforceRateLimit, honeypotTripped } from "./security.js";

const sameOrigin = (c) => isSameOriginRequest(c.req.raw, c.env.APP_ORIGIN);

export async function ensureGrowthSchema(env) {
  const db = env.DB;
  await db.prepare(`CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    inviter_user TEXT NOT NULL,
    invitee_user TEXT,
    status TEXT NOT NULL DEFAULT 'sent',
    channel TEXT NOT NULL DEFAULT 'link',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    joined_at TEXT)`).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals(inviter_user, status)"
  ).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS venue_interest (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    venue TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'venue',
    need TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
}

// The invite code IS the user id — reversible, stable, no lookup table.
const codeFor = (userId) => String(userId || "").slice(0, 24);

const VENUE_KINDS = [
  "cafe", "bar", "restaurant", "house-party", "birthday",
  "wedding", "festival", "corporate", "other",
];

export function mountGrowthRoutes(app, auth) {
  // ----- my referral code + progress ---------------------------------------
  app.get("/api/referral", async (c) => {
    const fb = await auth.getUser(c.req.raw).catch(() => null);
    if (!fb) return err(401, "Sign in required");
    const db = c.env.DB;
    await ensureGrowthSchema(c.env);
    const me = await resolveUser(db, fb);
    const code = codeFor(me.id);
    const stats = await db
      .prepare(
        `SELECT COUNT(*) sent,
                SUM(status = 'joined') joined,
                SUM(status = 'listed') listed
         FROM referrals WHERE inviter_user = ?`
      )
      .bind(me.id)
      .first();
    const origin = String(c.env.APP_ORIGIN || "").replace(/\/$/, "");
    const url = `${origin}/join?ref=${code}`;
    const waText = encodeURIComponent(
      `Perform live? Mehfil is where artists in India get booked for cafes, weddings and gigs. Make your profile: ${url}`
    );
    return json({
      code,
      url,
      whatsapp_url: `https://wa.me/?text=${waText}`,
      sent: Number(stats?.sent || 0),
      joined: Number(stats?.joined || 0),
      listed: Number(stats?.listed || 0),
      goal: 2,
      unlocked: Number(stats?.listed || 0) >= 2,
    });
  });

  // Redeem an invite code (called from /join?ref=CODE after sign-in).
  app.post("/api/referral/claim", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const fb = await auth.getUser(c.req.raw).catch(() => null);
    if (!fb) return err(401, "Sign in required");
    const db = c.env.DB;
    await ensureGrowthSchema(c.env);
    const me = await resolveUser(db, fb);
    const { code, channel } = await c.req.json().catch(() => ({}));
    const raw = String(code || "").slice(0, 24);
    if (!/^[a-z0-9_:-]{4,24}$/i.test(raw)) return err(400, "Invalid invite code");
    if (raw === me.id) return err(409, "That's your own invite link");
    const inviterUser = await db
      .prepare("SELECT id FROM users WHERE id = ?")
      .bind(raw)
      .first();
    if (!inviterUser) return err(404, "Invite code not found");
    const inviterId = raw;

    const existing = await db
      .prepare("SELECT * FROM referrals WHERE inviter_user = ? AND invitee_user = ?")
      .bind(inviterId, me.id)
      .first();
    if (existing) return json({ ok: true, already: true });
    await db
      .prepare(
        "INSERT INTO referrals (id, code, inviter_user, invitee_user, status, channel) VALUES (?,?,?,?,?,?)"
      )
      .bind(uid("rf"), codeFor(inviterId), inviterId, me.id, "joined",
        String(channel || "link").slice(0, 24))
      .run();
    return json({ ok: true });
  });

  // ----- venue / occasion demand capture -----------------------------------
  app.post("/api/venues", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const db = c.env.DB;
    await ensureGrowthSchema(c.env);
    const b = await c.req.json().catch(() => ({}));
    // Bots get a believable success and nothing is written; humans never see
    // this field. Then a tight per-connection budget stops scripted briefs.
    if (honeypotTripped(b)) return json({ ok: true, id: "received" }, 201);
    const limited = await enforceRateLimit(c, { scope: "venue-brief", limit: 6, windowSec: 900 });
    if (limited) return limited;
    await ensureLifecycleSchema(c.env);
    const email = String(b.email || "").trim().toLowerCase();
    const phone = String(b.phone || "").trim().slice(0, 20);
    if (!email && !phone) return err(400, "Add an email or phone so we can reach you");
    const city = String(b.city || "").trim().slice(0, 60);
    if (!city) return err(400, "City is required");
    const kind = VENUE_KINDS.includes(b.kind) ? b.kind : "venue";
    const id = uid("vi");
    await db
      .prepare(
        `INSERT INTO venue_interest (id, name, venue, city, kind, need, date, email, phone)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        id,
        String(b.name || "").slice(0, 80),
        String(b.venue || "").slice(0, 120),
        city, kind,
        String(b.need || "").slice(0, 400),
        String(b.date || "").slice(0, 40),
        email, phone
      )
      .run();

    // The form is an explicit request for a shortlist: record that consent and
    // queue the shortlist sequence. Marketing email still carries an
    // unsubscribe link, and suppression always wins.
    if (email) {
      await recordConsent(db, { email, purpose: "venue_shortlist", source: "venue_form" });
      await startVenueSequence(db, {
        subjectId: id,
        email,
        name: String(b.name || "").slice(0, 80),
        city,
        meta: { kind, need: String(b.need || "").slice(0, 400), date: String(b.date || "") },
      }, { delayMs: 60 * 60 * 1000 });
    }

    // Confirm to the venue immediately (best-effort; Resend may be off).
    const origin = String(c.env.APP_ORIGIN || "").replace(/\/$/, "");
    if (email && origin) {
      const subject = "We're on it — your performer shortlist is coming";
      const text =
        `Hi ${b.name || "there"}${b.venue ? ` (${b.venue})` : ""},\n\n` +
        `Thanks — we've got your ${kind.replace("-", " ")} requirement in ${city}` +
        `${b.date ? ` for ${b.date}` : ""}.\n\n` +
        `A curated shortlist of verified local performers — with rates, clips and\n` +
        `availability — is on its way. You can also browse and swipe shortlist-ready\n` +
        `acts right now: ${origin}/discover?city=${encodeURIComponent(city)}\n\n` +
        `Reply to this email with any must-haves (genre, budget, timing) and we'll\n` +
        `narrow it further.\n\n` +
        `— Mehfil, live talent for venues & occasions`;
      await sendEmail(c.env, { to: email, subject, text }).catch(() => null);
    }
    return json({ ok: true, id }, 201);
  });

  // Public stats for the venues page (how much supply we can promise).
  app.get("/api/venues/meta", async (c) => {
    const db = c.env.DB;
    await ensureGrowthSchema(c.env);
    const [artists, cities, pending] = await Promise.all([
      db.prepare("SELECT COUNT(*) n FROM artist_profiles").first().catch(() => ({ n: 0 })),
      db.prepare("SELECT COUNT(DISTINCT city) n FROM artist_profiles").first().catch(() => ({ n: 0 })),
      db.prepare("SELECT COUNT(*) n FROM venue_interest WHERE created_at >= datetime('now','-30 day')").first().catch(() => ({ n: 0 })),
    ]);
    return json({
      artists: Number(artists?.n || 0),
      cities: Number(cities?.n || 0),
      recent_requests: Number(pending?.n || 0),
      kinds: VENUE_KINDS,
    });
  });
}

// Reward loop: called when an invitee completes their artist listing.
export async function markListed(db, userId) {
  const rows = await db
    .prepare("SELECT * FROM referrals WHERE invitee_user = ? AND status = 'joined'")
    .bind(userId)
    .all()
    .catch(() => ({ results: [] }));
  if (!rows.results?.length) return { listed: 0, unlocked: false };
  await db
    .prepare("UPDATE referrals SET status = 'listed' WHERE invitee_user = ? AND status = 'joined'")
    .bind(userId)
    .run();
  for (const r of rows.results) {
    const stat = await db
      .prepare(
        "SELECT SUM(status = 'listed') listed FROM referrals WHERE inviter_user = ?"
      )
      .bind(r.inviter_user)
      .first();
    const listed = Number(stat?.listed || 0);
    if (listed >= 2) {
      // Only upgrade — never silently strip the badge later.
      await db
        .prepare(
          "UPDATE artist_profiles SET founding_artist = 1 WHERE user_id = ? AND founding_artist = 0"
        )
        .bind(r.inviter_user)
        .run();
      await db
        .prepare("UPDATE users SET kind = kind WHERE id = ?")
        .bind(r.inviter_user)
        .run()
        .catch(() => null);
    }
  }
  return { listed: rows.results.length, unlocked: true };
}
