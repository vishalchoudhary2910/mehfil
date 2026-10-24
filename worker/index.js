// Mehfil — artist hiring & collaboration API.
// Hono on Cloudflare Workers + D1, wrapped with Sign in with Freebuff.
import { createFreebuffAuth, isSameOriginRequest } from "@freebuff/auth";
import { Hono } from "hono";
import { mountSeo } from "./seo.js";
import { mountExtraRoutes, ensureSchemaOnce } from "./extra.js";
import { mountLeadRoutes, ensureLeadsSchema } from "./leads.js";
import { mountTalentRoutes, ensureTalentSchema } from "./talent.js";
import { mountShowFeedRoutes, ensureShowSchema } from "./showfeed.js";
import { mountRequestRoutes } from "./requests.js";
import { mountJamRoutes, ensureJamSchema, runJamSweep } from "./jam.js";
import { mountSearchRoutes } from "./search.js";
import { mountEngineRoutes, runDailyEngines, runFrequentEngines } from "./engines.js";

// Web Crypto's randomUUID is global in Workers — no node:crypto import.
const randomUUID = () => crypto.randomUUID();

// ---------------------------------------------------------------- helpers --

const json = (data, init = {}) =>
  Response.json(data, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...(init.headers || {}) },
  });

const err = (status, error) => json({ error }, { status });

const parseJson = (s, fallback) => {
  try {
    return JSON.parse(s ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

// Days between an event date and now (negative = past).
const daysUntil = (dateStr) =>
  (new Date(dateStr + "T12:00:00Z").getTime() - Date.now()) / 86400000;

// Refund % by artist-chosen cancellation policy (plan: 3 policies).
const refundPct = (policy, days) => {
  if (policy === "flexible") return days >= 7 ? 100 : 50;
  if (policy === "strict") return days >= 21 ? 50 : 0;
  if (days >= 14) return 100;
  if (days >= 7) return 50;
  return 0;
};

const HOST_FEE_PCT = 5;   // plan: 5% host fee
const ARTIST_FEE_PCT = 6; // plan: 5-8% artist fee
const ADVANCE_PCT = 40;   // advance held in escrow until the event

// --------------------------------------------------------------- schema ----

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, auth_sub TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    email TEXT, phone TEXT, city TEXT,
    kind TEXT NOT NULL DEFAULT 'host',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS artist_profiles (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
    stage_name TEXT NOT NULL, category TEXT NOT NULL,
    sub_skills TEXT NOT NULL DEFAULT '[]', city TEXT NOT NULL,
    languages TEXT NOT NULL DEFAULT '[]', bio TEXT NOT NULL DEFAULT '',
    experience_years INTEGER NOT NULL DEFAULT 1,
    travel_radius_km INTEGER NOT NULL DEFAULT 25,
    base_price_inr INTEGER NOT NULL DEFAULT 0,
    rating REAL NOT NULL DEFAULT 0, reviews_count INTEGER NOT NULL DEFAULT 0,
    gigs_done INTEGER NOT NULL DEFAULT 0, response_mins INTEGER NOT NULL DEFAULT 60,
    verified INTEGER NOT NULL DEFAULT 0, founding_artist INTEGER NOT NULL DEFAULT 0,
    cancellation_policy TEXT NOT NULL DEFAULT 'moderate',
    hue INTEGER NOT NULL DEFAULT 265, instagram TEXT, youtube TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS packages (
    id TEXT PRIMARY KEY, artist_id TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', price_inr INTEGER NOT NULL,
    duration_hours REAL NOT NULL DEFAULT 3,
    inclusions TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS artist_booked_dates (
    artist_id TEXT NOT NULL, date TEXT NOT NULL, booking_id TEXT NOT NULL,
    PRIMARY KEY (artist_id, date, booking_id))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, host_id TEXT NOT NULL, artist_id TEXT NOT NULL,
    package_id TEXT, package_name TEXT NOT NULL,
    amount_inr INTEGER NOT NULL, advance_inr INTEGER NOT NULL, fee_inr INTEGER NOT NULL,
    event_type TEXT NOT NULL, event_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '20:00',
    venue TEXT NOT NULL DEFAULT '', city TEXT NOT NULL,
    guest_count INTEGER NOT NULL DEFAULT 100,
    brief TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    escrow TEXT NOT NULL DEFAULT 'none',
    policy TEXT NOT NULL DEFAULT 'moderate',
    host_reviewed INTEGER NOT NULL DEFAULT 0, artist_reviewed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS booking_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id TEXT NOT NULL,
    type TEXT NOT NULL, actor_id TEXT, note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, reviewer_id TEXT NOT NULL,
    artist_id TEXT NOT NULL, for_host INTEGER NOT NULL DEFAULT 1,
    rating INTEGER NOT NULL, comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (booking_id, reviewer_id, for_host))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS collab_posts (
    id TEXT PRIMARY KEY, author_id TEXT NOT NULL, artist_id TEXT,
    title TEXT NOT NULL, role_needed TEXT NOT NULL, city TEXT NOT NULL,
    date TEXT NOT NULL, pay_inr INTEGER NOT NULL DEFAULT 0,
    details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS collab_applications (
    id TEXT PRIMARY KEY, post_id TEXT NOT NULL, applicant_id TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'applied',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (post_id, applicant_id))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS shows (
    id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, title TEXT NOT NULL,
    performers TEXT NOT NULL DEFAULT '', venue TEXT NOT NULL, city TEXT NOT NULL,
    date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '20:00',
    is_free INTEGER NOT NULL DEFAULT 1, price_inr INTEGER NOT NULL DEFAULT 0,
    capacity INTEGER NOT NULL DEFAULT 100, description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS rsvps (
    show_id TEXT NOT NULL, user_id TEXT NOT NULL,
    PRIMARY KEY (show_id, user_id))`).run();
}

// On first sign-in, adopt the seeded "You" persona so the demo account opens
// with real booking history. Every later account gets a fresh, isolated user.
async function resolveUser(db, fbUser) {
  let row = await db
    .prepare("SELECT * FROM users WHERE auth_sub = ?")
    .bind(fbUser.sub)
    .first();
  if (row) return row;
  const adopted = await db
    .prepare(
      "UPDATE users SET auth_sub = ?, name = COALESCE(?, name), email = COALESCE(?, email) WHERE auth_sub = 'seed:host:me' RETURNING *"
    )
    .bind(fbUser.sub, fbUser.name || null, fbUser.email || null)
    .first();
  if (adopted) return adopted;
  row = {
    id: "u_" + randomUUID().slice(0, 8),
    auth_sub: fbUser.sub,
    name: fbUser.name || "Host",
    email: fbUser.email || null,
    phone: null,
    city: null,
    kind: "host",
  };
  await db
    .prepare(
      "INSERT INTO users (id, auth_sub, name, email, city, kind) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(row.id, row.auth_sub, row.name, row.email, row.city, row.kind)
    .run();
  return row;
}

async function artistForUser(db, userId) {
  return db
    .prepare("SELECT * FROM artist_profiles WHERE user_id = ?")
    .bind(userId)
    .first();
}

const shapeArtist = (a) => ({
  ...a,
  sub_skills: parseJson(a.sub_skills, []),
  languages: parseJson(a.languages, []),
  verified: !!a.verified,
  founding_artist: !!a.founding_artist,
});

const shapePackage = (p) => ({ ...p, inclusions: parseJson(p.inclusions, []) });

// Auto-generated contract terms (plan: booking agreement accepted by both sides).
function contractFor(b, artist) {
  const policyText = {
    flexible: "Full refund if cancelled 7+ days before the event, 50% within a week.",
    moderate: "Full refund 14+ days out, 50% from 7-14 days, no refund inside a week.",
    strict: "50% refund 21+ days out, no refund inside three weeks.",
  }[b.policy];
  return {
    parties: { host: b.host_name || "Host", artist: artist.stage_name },
    scope: `${b.package_name} — ${b.event_type} on ${b.event_date} at ${b.start_time}, ${b.venue || b.city}`,
    payment: `${inr(b.amount_inr)} total; ${inr(b.advance_inr)} advance held in escrow (${ADVANCE_PCT}%); ${inr(
      b.fee_inr
    )} platform fee. Balance ${inr(b.amount_inr - b.advance_inr)} as per agreement.`,
    cancellation: policyText + " Artist cancellation always refunds the advance in full.",
    liability: "Artist carries own equipment insurance. Venue sound/power confirmed in the event brief. Conduct per platform community rules.",
    dispute: "Disputes accepted within 48 hours of the event; payouts frozen while ops reviews the booking timeline.",
  };
}

// ---------------------------------------------------------------- routes ---

export default {
  // Cloudflare Cron Triggers:
  //   03:00 daily  → Talent Radar + Shows + Leads + Requests + digest
  //   every 4h     → nudges, expiry and alert delivery
  async scheduled(event, env) {
    await ensureSchema(env.DB);
    await ensureSchemaOnce(env);
    await ensureLeadsSchema(env);
    await ensureTalentSchema(env);
    await ensureShowSchema(env);
    await ensureJamSchema(env);
    // Retire finished jams on every tick so stale rows never linger.
    await runJamSweep(env, { trigger: "cron" });
    if (String(event.cron || "") === "0 */4 * * *") {
      await runFrequentEngines(env, { trigger: "cron" });
    } else {
      await runDailyEngines(env, { trigger: "cron" });
    }
  },

  async fetch(request, env) {
    // Auth is optional at boot: a fresh clone with no FREEBUFF_CLIENT_ID must
    // still serve the public site (discovery, shows, jams, SEO pages) instead
    // of 500ing on every route. The shim makes every protected route answer
    // 401 honestly — nobody can sign in until the client ID is provisioned.
    const auth = (globalThis.__mehfilAuth ??= env.FREEBUFF_CLIENT_ID
      ? createFreebuffAuth({
          clientId: env.FREEBUFF_CLIENT_ID,
          issuer: env.FREEBUFF_ISSUER,
          baseUrl: env.APP_ORIGIN,
          // Loopback-only escape hatch for local wrangler dev; never true in prod.
          allowInsecureLocalhost: /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(env.APP_ORIGIN || ""),
        })
      : { getUser: async () => null, wrap: (handler) => handler });

    const app = new Hono();
    await ensureSchema(env.DB);
    await ensureSchemaOnce(env);
    await ensureLeadsSchema(env);
    await ensureTalentSchema(env);
    await ensureShowSchema(env);
    await ensureJamSchema(env);
    const db = env.DB;

    // Server-rendered SEO landing pages: /in/:city/:category/:event, hub, sitemap.
    mountSeo(app);

    // ----- public: filter metadata
    app.get("/api/meta", async (c) => {
      const cats = await db
        .prepare(
          "SELECT category, COUNT(*) AS n, MIN(base_price_inr) AS from_price FROM artist_profiles GROUP BY category ORDER BY n DESC"
        )
        .all();
      const cities = await db
        .prepare(
          "SELECT city, COUNT(*) AS n FROM artist_profiles GROUP BY city ORDER BY n DESC"
        )
        .all();
      // Discovery is two supplies in one search: bookable profiles and the
      // daily-discovered directory. Filters must offer both, or a city with
      // only discovered poets looks empty.
      const talentCats = await db
        .prepare("SELECT category, COUNT(*) AS n FROM talent_directory WHERE status IN ('active','stale') AND claimed_artist_id IS NULL GROUP BY category")
        .all()
        .catch(() => ({ results: [] }));
      const talentCities = await db
        .prepare("SELECT city, COUNT(*) AS n FROM talent_directory WHERE status IN ('active','stale') AND claimed_artist_id IS NULL AND city != '' GROUP BY city")
        .all()
        .catch(() => ({ results: [] }));
      const catMap = new Map();
      for (const c of cats.results || []) catMap.set(c.category, { ...c, n: Number(c.n) });
      for (const c of talentCats.results || []) {
        const row = catMap.get(c.category) || { category: c.category, from_price: 0, n: 0 };
        row.n = Number(row.n || 0) + Number(c.n || 0);
        catMap.set(c.category, row);
      }
      const cityMap = new Map();
      for (const c of cities.results || []) cityMap.set(c.city, { ...c, n: Number(c.n) });
      for (const c of talentCities.results || []) {
        const row = cityMap.get(c.city) || { city: c.city, n: 0 };
        row.n = Number(row.n || 0) + Number(c.n || 0);
        cityMap.set(c.city, row);
      }
      const merged = [...catMap.values()].sort((a, b) => b.n - a.n);
      return json({
        categories: merged,
        cities: [...cityMap.values()].sort((a, b) => b.n - a.n),
        directory_total: (talentCats.results || []).reduce((s, c) => s + Number(c.n || 0), 0),
        event_types: ["Birthday", "Kitty Party", "Sangeet", "Wedding", "House Party", "Corporate", "College Fest", "Club Night"],
        languages: ["Hindi", "English", "Marathi", "Punjabi", "Gujarati", "Bengali", "Sanskrit"],
      });
    });

    // ----- public: artist discovery with plan's P1 filters
    app.get("/api/artists", async (c) => {
      const q = c.req.query();
      const where = [];
      const params = [];
      if (q.city) { where.push("a.city = ?"); params.push(q.city); }
      if (q.category) { where.push("a.category = ?"); params.push(q.category); }
      if (q.available_now === "1") where.push("a.available_now = 1");
      if (q.quote === "1") where.push("a.base_price_inr = 0");
      if (q.max_price) { where.push("a.base_price_inr > 0 AND a.base_price_inr <= ?"); params.push(Number(q.max_price)); }
      if (q.language) { where.push("a.languages LIKE ?"); params.push(`%${q.language}%`); }
      if (q.min_rating) { where.push("a.rating >= ?"); params.push(Number(q.min_rating)); }
      if (q.q) {
        where.push("(a.stage_name LIKE ? OR a.sub_skills LIKE ? OR a.bio LIKE ? OR a.area LIKE ?)");
        params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
      }
      if (q.date) {
        where.push(
          "NOT EXISTS (SELECT 1 FROM artist_booked_dates d WHERE d.artist_id = a.id AND d.date = ?)"
        );
        params.push(q.date);
      }
      const sort = q.sort === "price" ? "CASE WHEN a.base_price_inr = 0 THEN 1 ELSE 0 END, a.base_price_inr ASC"
        : q.sort === "gigs" ? "a.gigs_done DESC"
        : q.sort === "available" ? "a.available_now DESC, a.rating DESC"
        : "a.rating DESC, a.reviews_count DESC";
      const rows = await db
        .prepare(
          `SELECT a.* FROM artist_profiles a ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${sort} LIMIT 60`
        )
        .bind(...params)
        .all();
      return json({ artists: rows.results.map(shapeArtist) });
    });

    // ----- public: full profile + packages + reviews
    app.get("/api/artists/:slug", async (c) => {
      const artist = await db
        .prepare("SELECT * FROM artist_profiles WHERE slug = ?")
        .bind(c.req.param("slug"))
        .first();
      if (!artist) return err(404, "Artist not found");
      const [pkgs, revs] = await Promise.all([
        db.prepare("SELECT * FROM packages WHERE artist_id = ? AND active = 1 ORDER BY price_inr").bind(artist.id).all(),
        db.prepare(
          `SELECT r.*, u.name AS reviewer_name FROM reviews r JOIN users u ON u.id = r.reviewer_id
           WHERE r.artist_id = ? AND r.for_host = 1 ORDER BY r.created_at DESC LIMIT 20`
        ).bind(artist.id).all(),
      ]);
      // Contact info stays masked until a paid booking links the two parties.
      let contact_visible = false;
      const fbUser = await auth.getUser(c.req.raw);
      if (fbUser) {
        const me = await resolveUser(db, fbUser);
        const link = await db
          .prepare(
            "SELECT 1 FROM bookings WHERE host_id = ? AND artist_id = ? AND status IN ('confirmed','completed') LIMIT 1"
          )
          .bind(me.id, artist.id)
          .first();
        contact_visible = !!link || me.id === artist.user_id;
      }
      return json({
        artist: shapeArtist(artist),
        packages: pkgs.results.map(shapePackage),
        reviews: revs.results,
        contact_visible,
      });
    });

    // ----- session: who am I, and am I also an artist?
    app.get("/api/me", async (c) => {
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      const artist = await artistForUser(db, me.id);
      return json({
        user: { id: me.id, name: me.name, email: me.email, city: me.city, kind: artist ? "artist" : me.kind },
        artist: artist ? shapeArtist(artist) : null,
      });
    });

    app.post("/api/me/city", async (c) => {
      if (!isSameOriginRequest(c.req.raw, env.APP_ORIGIN)) return err(403, "Cross-origin");
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      const { city } = await c.req.json().catch(() => ({}));
      if (!city) return err(400, "city required");
      await db.prepare("UPDATE users SET city = ? WHERE id = ?").bind(city, me.id).run();
      return json({ ok: true });
    });

    // ----- artist onboarding: live profile in minutes (plan flow A)
    app.post("/api/artist/profile", async (c) => {
      if (!isSameOriginRequest(c.req.raw, env.APP_ORIGIN)) return err(403, "Cross-origin");
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      if (await artistForUser(db, me.id)) return err(409, "You already have an artist profile");
      const body = await c.req.json().catch(() => ({}));
      const { stage_name, category, sub_skills, city, languages, bio, experience_years, travel_radius_km, cancellation_policy, instagram, youtube, area, portfolio_url } = body;
      const packages = Array.isArray(body.packages) ? body.packages : [];
      const quoteOnRequest = body.quote_on_request === true || body.quote_on_request === 1 || body.quote_on_request === "1";
      if (!stage_name || !category || !city) return err(400, "stage_name, category and city are required");
      if (!quoteOnRequest && (!packages.length || !packages.every((p) => p.name && p.price_inr > 0)))
        return err(400, "Add at least one package with a name and price, or choose quote-per-gig");
      let slug = slugify(stage_name);
      const clash = await db.prepare("SELECT 1 FROM artist_profiles WHERE slug = ?").bind(slug).first();
      if (clash) slug = slug + "-" + randomUUID().slice(0, 4);
      const id = "a_" + randomUUID().slice(0, 8);
      const base = quoteOnRequest ? 0 : Math.min(...packages.map((p) => Number(p.price_inr)));
      const hue = 100 + (Math.abs([...stage_name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)) % 260);
      await db
        .prepare(
          `INSERT INTO artist_profiles (id, user_id, slug, stage_name, category, sub_skills, city, area, languages, bio,
             experience_years, travel_radius_km, base_price_inr, cancellation_policy, hue, instagram, youtube, portfolio_url,
             available_now, accepting_requests)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .bind(id, me.id, slug, stage_name, category, JSON.stringify(sub_skills || []), city, area || "",
          JSON.stringify(languages || []), bio || "", Number(experience_years) || 1,
          Number(travel_radius_km) || 25, base, cancellation_policy || "moderate", hue, instagram || null, youtube || null,
          portfolio_url || null, 1, 1)
        .run();
      for (const p of packages.slice(0, 6)) {
        await db
          .prepare(
            "INSERT INTO packages (id, artist_id, name, description, price_inr, duration_hours, inclusions) VALUES (?,?,?,?,?,?,?)"
        )
          .bind("p_" + randomUUID().slice(0, 8), id, p.name, p.description || "",
            Number(p.price_inr), Number(p.duration_hours) || 3, JSON.stringify(p.inclusions || []))
          .run();
      }
      await db.prepare("UPDATE users SET kind = 'artist', city = COALESCE(city, ?) WHERE id = ?").bind(city, me.id).run();
      const created = await db.prepare("SELECT * FROM artist_profiles WHERE id = ?").bind(id).first();
      return json({ artist: shapeArtist(created) });
    });

    // ----- booking creation: instant-book a package, advance into escrow (plan flow B)
    app.post("/api/bookings", async (c) => {
      if (!isSameOriginRequest(c.req.raw, env.APP_ORIGIN)) return err(403, "Cross-origin");
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      const b = await c.req.json().catch(() => ({}));
      const pkg = await db.prepare("SELECT * FROM packages WHERE id = ? AND active = 1").bind(b.package_id).first();
      if (!pkg) return err(400, "Pick a package");
      const artist = await db.prepare("SELECT * FROM artist_profiles WHERE id = ?").bind(pkg.artist_id).first();
      if (!artist) return err(400, "Artist not found");
      if (!b.event_date || !b.event_type || !b.city) return err(400, "event_date, event_type and city are required");
      if (daysUntil(b.event_date) < 0) return err(400, "Event date is in the past");
      const clash = await db
        .prepare("SELECT 1 FROM artist_booked_dates WHERE artist_id = ? AND date = ?")
        .bind(artist.id, b.event_date)
        .first();
      if (clash) return err(409, `${artist.stage_name} is already booked on ${b.event_date} — try another date`);
      const amount = Number(pkg.price_inr);
      const advance = Math.round((amount * ADVANCE_PCT) / 100);
      const fee = Math.round((amount * (HOST_FEE_PCT + ARTIST_FEE_PCT)) / 100);
      const id = "b_" + randomUUID().slice(0, 10);
      const policy = artist.cancellation_policy;
      await db
        .prepare(
          `INSERT INTO bookings (id, host_id, artist_id, package_id, package_name, amount_inr, advance_inr, fee_inr,
             event_type, event_date, start_time, venue, city, guest_count, brief, status, escrow, policy)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .bind(id, me.id, artist.id, pkg.id, pkg.name, amount, advance, fee,
          b.event_type, b.event_date, b.start_time || "20:00", b.venue || "",
          b.city, Number(b.guest_count) || 100,
          JSON.stringify({
            sound: b.sound || "", power: b.power || "",
            songs: b.songs || "", dress: b.dress || "", notes: b.notes || "",
          }),
          "pending", "held", policy)
        .run();
      await db
        .prepare("INSERT INTO artist_booked_dates (artist_id, date, booking_id) VALUES (?,?,?)")
        .bind(artist.id, b.event_date, id)
        .run();
      await db
        .prepare("INSERT INTO booking_events (booking_id, type, actor_id, note) VALUES (?,?,?,?)")
        .bind(id, "booked", me.id, `Advance of ${inr(advance)} held in escrow. Contract auto-generated under the ${policy} policy.`)
        .run();
      const booking = await db.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first();
      return json({ booking, contract: contractFor({ ...booking, host_name: me.name }, artist) });
    });

    // ----- my bookings as a host
    app.get("/api/bookings", async (c) => {
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      const rows = await db
        .prepare(
          `SELECT b.*, a.stage_name AS artist_name, a.slug AS artist_slug, a.hue AS artist_hue, a.category AS artist_category
           FROM bookings b JOIN artist_profiles a ON a.id = b.artist_id
           WHERE b.host_id = ? ORDER BY b.event_date DESC`
        )
        .bind(me.id)
        .all();
      return json({ bookings: rows.results.map((r) => ({ ...r, brief: parseJson(r.brief, {}), contract: contractFor(r, { stage_name: r.artist_name }) })) });
    });

    // ----- bookings against my artist profile (artist dashboard)
    app.get("/api/artist/bookings", async (c) => {
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      const artist = await artistForUser(db, me.id);
      if (!artist) return err(403, "No artist profile");
      const rows = await db
        .prepare(
          `SELECT b.*, u.name AS host_name FROM bookings b JOIN users u ON u.id = b.host_id
           WHERE b.artist_id = ? ORDER BY b.event_date DESC`
        )
        .bind(artist.id)
        .all();
      const stats = await db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN status='completed' THEN amount_inr - ? ELSE 0 END),0) AS earned,
             COALESCE(SUM(CASE WHEN status IN ('pending','confirmed') THEN advance_inr ELSE 0 END),0) AS in_escrow,
             SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS requests,
             SUM(CASE WHEN status='confirmed' AND date(event_date) >= date('now') THEN 1 ELSE 0 END) AS upcoming
           FROM bookings WHERE artist_id = ?`
        )
        .bind(Math.round((artist.base_price_inr * ARTIST_FEE_PCT) / 100), artist.id)
        .first();
      const reviews = await db
        .prepare(
          "SELECT * FROM reviews WHERE artist_id = ? AND for_host = 1 ORDER BY created_at DESC LIMIT 5"
        )
        .bind(artist.id)
        .all();
      return json({
        artist: shapeArtist(artist),
        bookings: rows.results.map((r) => ({ ...r, brief: parseJson(r.brief, {}) })),
        stats: { ...stats, fee_note: "After platform commission" },
        reviews: reviews.results,
      });
    });

    // ----- booking state machine: accept/decline/check-in/complete/cancel/dispute
    app.post("/api/bookings/:id/action", async (c) => {
      if (!isSameOriginRequest(c.req.raw, env.APP_ORIGIN)) return err(403, "Cross-origin");
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      const { action, note } = await c.req.json().catch(() => ({}));
      const booking = await db.prepare("SELECT * FROM bookings WHERE id = ?").bind(c.req.param("id")).first();
      if (!booking) return err(404, "Booking not found");
      const artist = await db.prepare("SELECT * FROM artist_profiles WHERE id = ?").bind(booking.artist_id).first();
      const isHost = booking.host_id === me.id;
      const isArtist = artist.user_id === me.id;
      if (!isHost && !isArtist) return err(403, "Not your booking");
      const days = daysUntil(booking.event_date);
      const touch = async (status, escrow, event, eventNote) => {
        await db
          .prepare("UPDATE bookings SET status = ?, escrow = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(status, escrow, booking.id)
          .run();
        await db
          .prepare("INSERT INTO booking_events (booking_id, type, actor_id, note) VALUES (?,?,?,?)")
          .bind(booking.id, event, me.id, eventNote || note || "")
          .run();
      };
      if (action === "accept") {
        if (!isArtist || booking.status !== "pending") return err(409, "Cannot accept");
        await touch("confirmed", "held", "confirmed", note || "Accepted the booking. Advance stays in escrow until the event.");
      } else if (action === "decline") {
        if (!isArtist || booking.status !== "pending") return err(409, "Cannot decline");
        await touch("cancelled", "refunded", "cancelled", "Artist declined — advance refunded in full.");
        await db.prepare("DELETE FROM artist_booked_dates WHERE booking_id = ?").bind(booking.id).run();
      } else if (action === "checkin") {
        if (!isArtist || booking.status !== "confirmed") return err(409, "Check-in opens once the booking is confirmed");
        await db.prepare("INSERT INTO booking_events (booking_id, type, actor_id, note) VALUES (?,?,?,?)")
          .bind(booking.id, "checked_in", me.id, note || `Checked in at ${booking.venue || booking.city}`).run();
      } else if (action === "complete") {
        if (!isHost || booking.status !== "confirmed") return err(409, "Only the host confirms completion, and only after confirmation");
        await touch("completed", "released", "completed", note || "Host confirmed the performance.");
        await db.prepare("INSERT INTO booking_events (booking_id, type, note) VALUES (?,?,?)")
          .bind(booking.id, "escrow_released", `${inr(booking.advance_inr)} released to ${artist.stage_name}; balance ${inr(booking.amount_inr - booking.advance_inr)} per agreement.`).run();
      } else if (action === "cancel") {
        if (booking.status === "completed" || booking.status === "cancelled") return err(409, "Booking already closed");
        if (!isHost && !isArtist) return err(403, "Not your booking");
        const pct = isArtist ? 100 : refundPct(booking.policy, days);
        const refund = Math.round((booking.advance_inr * pct) / 100);
        await touch("cancelled", "refunded", "cancelled",
          `${isArtist ? "Artist" : "Host"} cancelled with ${days.toFixed(0)} days to go — ${pct}% refund (${inr(refund)}) per the ${booking.policy} policy.`);
        await db.prepare("DELETE FROM artist_booked_dates WHERE booking_id = ?").bind(booking.id).run();
      } else if (action === "dispute") {
        if (booking.status === "completed" || booking.status === "cancelled") return err(409, "Booking already closed");
        if (days > 2) return err(409, "Disputes open within 48 hours of the event");
        await touch("disputed", "frozen", "disputed", note || "Dispute raised — payout frozen while ops reviews the timeline.");
      } else {
        return err(400, "Unknown action");
      }
      const fresh = await db.prepare("SELECT * FROM bookings WHERE id = ?").bind(booking.id).first();
      return json({ booking: fresh });
    });

    // ----- booking detail with timeline + contract
    app.get("/api/bookings/:id", async (c) => {
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      const booking = await db
        .prepare(
          `SELECT b.*, a.stage_name AS artist_name, a.slug AS artist_slug, a.hue AS artist_hue, u.name AS host_name
           FROM bookings b JOIN artist_profiles a ON a.id = b.artist_id JOIN users u ON u.id = b.host_id
           WHERE b.id = ?`
        )
        .bind(c.req.param("id"))
        .first();
      if (!booking) return err(404, "Booking not found");
      const artist = await db.prepare("SELECT * FROM artist_profiles WHERE id = ?").bind(booking.artist_id).first();
      if (booking.host_id !== me.id && artist.user_id !== me.id) return err(403, "Not your booking");
      const events = await db
        .prepare("SELECT * FROM booking_events WHERE booking_id = ? ORDER BY created_at, id")
        .bind(booking.id)
        .all();
      return json({
        booking: { ...booking, brief: parseJson(booking.brief, {}) },
        events: events.results,
        contract: contractFor(booking, artist),
        viewer: booking.host_id === me.id ? "host" : "artist",
      });
    });

    // ----- two-way reviews after completion (plan: both sides rate)
    app.post("/api/bookings/:id/review", async (c) => {
      if (!isSameOriginRequest(c.req.raw, env.APP_ORIGIN)) return err(403, "Cross-origin");
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      const { rating, comment } = await c.req.json().catch(() => ({}));
      const booking = await db.prepare("SELECT * FROM bookings WHERE id = ?").bind(c.req.param("id")).first();
      if (!booking) return err(404, "Booking not found");
      if (booking.status !== "completed") return err(409, "Reviews open after the event completes");
      const isHost = booking.host_id === me.id;
      const artist = await db.prepare("SELECT * FROM artist_profiles WHERE id = ?").bind(booking.artist_id).first();
      if (!isHost && artist.user_id !== me.id) return err(403, "Not your booking");
      const forHost = isHost ? 1 : 0;
      const flag = isHost ? "host_reviewed" : "artist_reviewed";
      if (booking[flag]) return err(409, "You already reviewed this booking");
      const r = Math.min(5, Math.max(1, Number(rating) || 5));
      await db
        .prepare("INSERT INTO reviews (id, booking_id, reviewer_id, artist_id, for_host, rating, comment) VALUES (?,?,?,?,?,?,?)")
        .bind("r_" + randomUUID().slice(0, 8), booking.id, me.id, booking.artist_id, forHost, r, String(comment || "").slice(0, 1000))
        .run();
      // D1 can't bind column names; flag is a fixed internal set, not user input.
      await db
        .prepare(`UPDATE bookings SET ${flag} = 1, updated_at = datetime('now') WHERE id = ?`)
        .bind(booking.id)
        .run();
      await db
        .prepare(
          `UPDATE artist_profiles SET rating = (SELECT ROUND(AVG(rating),1) FROM reviews WHERE artist_id = ? AND for_host = 1),
             reviews_count = (SELECT COUNT(*) FROM reviews WHERE artist_id = ? AND for_host = 1) WHERE id = ?`
        )
        .bind(booking.artist_id, booking.artist_id, booking.artist_id)
        .run();
      await db.prepare("INSERT INTO booking_events (booking_id, type, actor_id, note) VALUES (?,?,?,?)")
        .bind(booking.id, "review_left", me.id, `Left a ${r}-star review.`).run();
      return json({ ok: true });
    });

    // ----- collaborator board (the differentiation wedge)
    app.get("/api/collab", async (c) => {
      const where = ["p.status = 'open'"];
      const params = [];
      if (c.req.query("city")) { where.push("p.city = ?"); params.push(c.req.query("city")); }
      if (c.req.query("role")) { where.push("p.role_needed LIKE ?"); params.push(`%${c.req.query("role")}%`); }
      const rows = await db
        .prepare(
          `SELECT p.*, u.name AS author_name, a.stage_name AS author_stage,
             (SELECT COUNT(*) FROM collab_applications ca WHERE ca.post_id = p.id) AS applicants
           FROM collab_posts p JOIN users u ON u.id = p.author_id
           LEFT JOIN artist_profiles a ON a.id = p.artist_id
           WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT 50`
        )
        .bind(...params)
        .all();
      return json({ posts: rows.results });
    });

    app.post("/api/collab", async (c) => {
      if (!isSameOriginRequest(c.req.raw, env.APP_ORIGIN)) return err(403, "Cross-origin");
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      const b = await c.req.json().catch(() => ({}));
      if (!b.title || !b.role_needed || !b.city || !b.date) return err(400, "title, role_needed, city and date are required");
      const artist = await artistForUser(db, me.id);
      const id = "c_" + randomUUID().slice(0, 8);
      await db
        .prepare("INSERT INTO collab_posts (id, author_id, artist_id, title, role_needed, city, date, pay_inr, details) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(id, me.id, artist?.id || null, b.title, b.role_needed, b.city, b.date, Number(b.pay_inr) || 0, b.details || "")
        .run();
      return json({ id });
    });

    app.post("/api/collab/:id/apply", async (c) => {
      if (!isSameOriginRequest(c.req.raw, env.APP_ORIGIN)) return err(403, "Cross-origin");
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      const post = await db.prepare("SELECT * FROM collab_posts WHERE id = ?").bind(c.req.param("id")).first();
      if (!post || post.status !== "open") return err(404, "Post not open");
      if (post.author_id === me.id) return err(409, "That's your own post");
      const { note } = await c.req.json().catch(() => ({}));
      await db
        .prepare("INSERT INTO collab_applications (id, post_id, applicant_id, note) VALUES (?,?,?,?)")
        .bind("ca_" + randomUUID().slice(0, 8), post.id, me.id, note || "")
        .run();
      return json({ ok: true });
    });

    // ----- public shows + RSVPs (plan flow D, simplified)
    app.get("/api/shows", async (c) => {
      const q = c.req.query();
      const where = ["s.status != 'archived'"];
      const params = [];
      if (q.include === "past") { where.push("s.date < date('now')"); }
      else { where.push("s.date >= date('now')"); where.push("s.status = 'active'"); }
      if (q.city) { where.push("s.city = ?"); params.push(q.city); }
      if (q.source) { where.push("s.source = ?"); params.push(q.source); }
      if (q.free === "1") where.push("s.is_free = 1");
      if (q.paid === "1") where.push("s.is_free = 0");
      if (q.q) {
        where.push("(s.title LIKE ? OR s.performers LIKE ? OR s.venue LIKE ?)");
        const like = `%${q.q}%`; params.push(like, like, like);
      }
      const rows = await db
        .prepare(
          `SELECT s.*, COALESCE(NULLIF(s.organizer,''), u.name, 'Community listing') AS organizer,
             (SELECT COUNT(*) FROM rsvps r WHERE r.show_id = s.id) AS rsvps
           FROM shows s LEFT JOIN users u ON u.id = s.creator_id
           WHERE ${where.join(" AND ")}
           ORDER BY s.date ASC, s.start_time ASC LIMIT 80`
        )
        .bind(...params)
        .all();
      return json({ shows: rows.results });
    });

    app.post("/api/shows", async (c) => {
      if (!isSameOriginRequest(c.req.raw, env.APP_ORIGIN)) return err(403, "Cross-origin");
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      const b = await c.req.json().catch(() => ({}));
      if (!b.title || !b.venue || !b.city || !b.date) return err(400, "title, venue, city and date are required");
      const id = "s_" + randomUUID().slice(0, 8);
      await db
        .prepare(
          "INSERT INTO shows (id, creator_id, title, performers, venue, city, date, start_time, is_free, price_inr, capacity, description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
        )
        .bind(id, me.id, b.title, b.performers || "", b.venue, b.city, b.date, b.start_time || "20:00",
          b.is_free === false ? 0 : 1, Number(b.price_inr) || 0, Number(b.capacity) || 100, b.description || "")
        .run();
      return json({ id });
    });

    app.post("/api/shows/:id/rsvp", async (c) => {
      if (!isSameOriginRequest(c.req.raw, env.APP_ORIGIN)) return err(403, "Cross-origin");
      const fbUser = await auth.getUser(c.req.raw);
      if (!fbUser) return err(401, "Sign in required");
      const me = await resolveUser(db, fbUser);
      const show = await db.prepare("SELECT 1 FROM shows WHERE id = ?").bind(c.req.param("id")).first();
      if (!show) return err(404, "Show not found");
      const existing = await db.prepare("SELECT 1 FROM rsvps WHERE show_id = ? AND user_id = ?").bind(c.req.param("id"), me.id).first();
      if (existing) {
        await db.prepare("DELETE FROM rsvps WHERE show_id = ? AND user_id = ?").bind(c.req.param("id"), me.id).run();
        return json({ rsvping: false });
      }
      await db.prepare("INSERT INTO rsvps (show_id, user_id) VALUES (?,?)").bind(c.req.param("id"), me.id).run();
      return json({ rsvping: true });
    });

    // everything else: auth routes, then SPA/assets.
    // Only genuine route-miss 404s fall through to assets — an API handler's
    // own JSON 404 ("Artist not found") must reach the client as-is.
    mountLeadRoutes(app, auth);
    mountTalentRoutes(app, auth);
    mountShowFeedRoutes(app, auth);
    mountRequestRoutes(app, auth);
    mountJamRoutes(app, auth);
    mountSearchRoutes(app);
    mountEngineRoutes(app, auth);
    mountExtraRoutes(app, auth);
    const handler = auth.wrap(app.fetch);
    const res = await handler(request, env);
    const p = new URL(request.url).pathname;
    const owns404 = p.startsWith("/api/") || p === "/in" || p.startsWith("/in/") ||
      p === "/sitemap.xml" || p === "/robots.txt";
    if (res.status === 404 && !owns404) {
      return env.ASSETS.fetch(request);
    }
    return res;
  },
};
