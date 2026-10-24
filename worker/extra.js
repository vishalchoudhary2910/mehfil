// Phase-2 feature routes: teams with split payouts, tips, invoices, follows,
// smart match, plus once-per-isolate schema hydration for the phase-2 tables.
// Mounted from index.js after the core routes.
//
// Money invariant (verified by the billing unit tests): escrow release writes
// payouts rows whose net sums to amount - fee, split across active team
// members by their percentages. Tips add zero-fee rows split the same way.
// Nothing here moves real money — payouts is a ledger, the plan's manual UPI
// step sits behind it.

import { distributeNet, payoutPlanForBooking, tipPlanForBooking, smartMatch, renderInvoice } from "./billing.js";
import { resolveUser, inr, shapeArtist } from "./util.js";
import { isSameOriginRequest } from "@freebuff/auth";

const idp = (p) => p + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

// Phase-2 DDL, applied once per isolate only when the teams table is absent.
// The full marketplace schema lives in schema.sql (deployed with
// `wrangler d1 execute --file=schema.sql`); this string keeps a dev server
// booting against an older local D1 without a manual migration step.
const PHASE2_DDL = `
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, genre TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '', about TEXT NOT NULL DEFAULT '',
  leader_id TEXT NOT NULL REFERENCES users(id),
  profile_id TEXT REFERENCES artist_profiles(id) ON DELETE SET NULL,
  hue INTEGER NOT NULL DEFAULT 200,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  split_pct INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS team_invites (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invitee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member', split_pct INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (team_id, invitee_id)
);
CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'gig',
  gross_inr INTEGER NOT NULL, fee_inr INTEGER NOT NULL DEFAULT 0,
  net_inr INTEGER NOT NULL, split_pct INTEGER NOT NULL DEFAULT 100,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS follows (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_payouts_booking ON payouts(booking_id);
CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_invites_invitee ON team_invites(invitee_id);
CREATE INDEX IF NOT EXISTS idx_follows_artist ON follows(artist_id);
`;

let SCHEMA_READY = false;

// Runs once per isolate after index.js's base ensureSchema. Two guarded
// ALTERs (SQLite has no ADD COLUMN IF NOT EXISTS) add the columns the phase-2
// routes read, then each CREATE runs as its own statement — never one
// multi-line .exec, which D1 splits badly (the observed exec/line-splitting
// gotcha). Statements here contain no semicolons inside string literals, so
// splitting PHASE2_DDL on ";" is safe.
export async function ensureSchemaOnce(env) {
  if (SCHEMA_READY) return;
  const db = env.DB;
  const cols = async (table) => {
    const r = await db.prepare(`PRAGMA table_info(${table})`).all();
    return new Set((r.results ?? []).map((x) => x.name));
  };
  if (!(await cols("artist_profiles")).has("team_id")) {
    await db.prepare("ALTER TABLE artist_profiles ADD COLUMN team_id TEXT").run();
  }
  if (!(await cols("bookings")).has("tip_inr")) {
    await db.prepare("ALTER TABLE bookings ADD COLUMN tip_inr INTEGER NOT NULL DEFAULT 0").run();
  }
  for (const stmt of PHASE2_DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
  SCHEMA_READY = true;
}

// Payment recipients for an artist: the team's active members with a split,
// or the solo artist at 100%. Used at release and tip time.
export async function paymentRecipients(db, artist) {
  if (!artist.team_id) return [{ user_id: artist.user_id, split_pct: 100 }];
  const ms = await db
    .prepare("SELECT user_id, split_pct FROM team_members WHERE team_id = ? AND status = 'active' AND split_pct > 0")
    .bind(artist.team_id)
    .all();
  return ms.results ?? [];
}

// Enrich booking rows (dashboard + lists) with artist name, team, rating and
// package info so the client renders cards without N+1 round trips.
export async function decorateBookingCards(db, rows) {
  const artistIds = [...new Set(rows.map((r) => r.artist_id).filter(Boolean))];
  const pkgIds = [...new Set(rows.map((r) => r.package_id).filter(Boolean))];
  const artists = new Map();
  const pkgs = new Map();
  const teams = new Map();
  if (artistIds.length) {
    const res = await db
      .prepare(`SELECT id, user_id, stage_name, city, hue, team_id, verified FROM artist_profiles WHERE id IN (${artistIds.map(() => "?").join(",")})`)
      .bind(...artistIds).all();
    for (const a of res.results ?? []) artists.set(a.id, a);
    const teamIds = [...new Set([...artists.values()].map((a) => a.team_id).filter(Boolean))];
    if (teamIds.length) {
      const tres = await db
        .prepare(`SELECT id, name, hue FROM teams WHERE id IN (${teamIds.map(() => "?").join(",")})`)
        .bind(...teamIds).all();
      for (const t of tres.results ?? []) teams.set(t.id, t);
    }
  }
  if (pkgIds.length) {
    const res = await db
      .prepare(`SELECT id, name, price_inr FROM packages WHERE id IN (${pkgIds.map(() => "?").join(",")})`)
      .bind(...pkgIds).all();
    for (const p of res.results ?? []) pkgs.set(p.id, p);
  }
  for (const r of rows) {
    const a = artists.get(r.artist_id);
    const t = a?.team_id ? teams.get(a.team_id) : null;
    r.artist = a
      ? { name: t ? t.name : a.stage_name, hue: t ? t.hue : a.hue, city: a.city, team_id: a.team_id || null, verified: !!a.verified }
      : null;
    const p = pkgs.get(r.package_id);
    r.package = p ? { name: p.name || r.package_name, price_inr: p.price_inr } : (r.package_name ? { name: r.package_name, price_inr: r.amount_inr } : null);
  }
  return rows;
}

// Write payout rows for a booking. Idempotent: skips if rows already exist
// for this booking + kind (a double-tapped release must not double-pay).
export async function writePayouts(db, { booking, artist, recipients, kind = "gig" }) {
  const existing = await db.prepare("SELECT 1 FROM payouts WHERE booking_id = ? AND kind = ? LIMIT 1").bind(booking.id, kind).first();
  if (existing) return { written: false };
  const gross = kind === "tip" ? booking.tip_inr : booking.amount_inr;
  const plan = kind === "tip" ? tipPlanForBooking({ amount: gross, recipients }) : payoutPlanForBooking({ booking, recipients });
  for (const row of plan.rows) {
    await db
      .prepare(`INSERT INTO payouts (id, booking_id, user_id, kind, gross_inr, fee_inr, net_inr, split_pct, note)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(idp("po"), booking.id, row.user_id, kind, row.gross, row.fee, row.net, row.split_pct,
        kind === "tip" ? "Host tip" : `Gig payout — ${booking.package_name || "performance"}`)
      .run();
  }
  return { written: true, rows: plan.rows, fee: plan.fee, net: plan.net };
}

export async function userTeam(db, userId) {
  return db.prepare("SELECT team_id FROM team_members WHERE user_id = ? AND status = 'active'").bind(userId).first();
}

const SPLIT_SUM_ERR = "Splits must be whole numbers summing to exactly 100%";

export function mountExtraRoutes(app, auth) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const err = (status, error) => json({ error }, status);
  const sameOrigin = (c) => isSameOriginRequest(c.req.raw, c.env.APP_ORIGIN);

  const teamWithMembers = async (db, teamId) => {
    const team = await db
      .prepare(`SELECT t.*, u.name AS leader_name FROM teams t JOIN users u ON u.id = t.leader_id WHERE t.id = ?`)
      .bind(teamId).first();
    if (!team) return null;
    const m = await db
      .prepare(`SELECT tm.user_id, tm.role, tm.split_pct, tm.joined_at, u.name, u.email
                FROM team_members tm JOIN users u ON u.id = tm.user_id
                WHERE tm.team_id = ? AND tm.status = 'active' ORDER BY tm.role = 'leader' DESC, tm.split_pct DESC`)
      .bind(teamId).all();
    const invites = await db
      .prepare(`SELECT ti.id, ti.role, ti.split_pct, ti.status, u.name AS invitee_name, u.email AS invitee_email
                FROM team_invites ti JOIN users u ON u.id = ti.invitee_id
                WHERE ti.team_id = ? ORDER BY ti.created_at DESC`)
      .bind(teamId).all();
    const followers = await db
      .prepare("SELECT COUNT(*) AS n FROM follows WHERE artist_id = ?")
      .bind(team.profile_id ?? "").first();
    return { ...team, members: m.results ?? [], invites: invites.results ?? [], followers: Number(followers?.n ?? 0) };
  };

  // ---- teams ---------------------------------------------------------------

  app.get("/api/teams/mine", async (c) => {
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return err(401, "Sign in required");
    const db = c.env.DB;
    const me = await resolveUser(db, fbUser);
    const link = await userTeam(db, me.id);
    if (!link) return json({ team: null });
    return json({ team: await teamWithMembers(db, link.team_id) });
  });

  app.post("/api/teams", async (c) => {
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return err(401, "Sign in required");
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const db = c.env.DB;
    const me = await resolveUser(db, fbUser);
    const existing = await userTeam(db, me.id);
    if (existing) return err(409, "You are already in a band — one per member keeps splits honest");
    const b = await c.req.json().catch(() => ({}));
    if (!b.name || String(b.name).trim().length < 2) return err(400, "Band name is required");
    const profile = await db.prepare("SELECT id FROM artist_profiles WHERE user_id = ?").bind(me.id).first();
    if (profile?.team_id) return err(409, "Your artist profile already belongs to a band");
    const id = idp("tm");
    const hue = 190 + (String(b.name).length * 37) % 130;
    await db
      .prepare("INSERT INTO teams (id, name, genre, city, about, leader_id, hue) VALUES (?,?,?,?,?,?,?)")
      .bind(id, String(b.name).trim(), String(b.genre || "").trim(), String(b.city || "").trim(),
        String(b.about || "").trim(), me.id, hue)
      .run();
    await db
      .prepare("INSERT INTO team_members (team_id, user_id, role, split_pct) VALUES (?,?,?,?)")
      .bind(id, me.id, "leader", 100)
      .run();
    if (profile) await db.prepare("UPDATE artist_profiles SET team_id = ? WHERE id = ?").bind(id, profile.id).run();
    return json({ team: await teamWithMembers(db, id) }, 201);
  });

  app.get("/api/teams/:id", async (c) => {
    const db = c.env.DB;
    const team = await teamWithMembers(db, c.req.param("id"));
    if (!team) return err(404, "Band not found");
    const fbUser = await auth.getUser(c.req.raw);
    let isMember = false;
    if (fbUser) {
      const me = await resolveUser(db, fbUser);
      isMember = team.members.some((m) => m.user_id === me.id);
    }
    // Public page: mask member emails unless you are in the band.
    const pub = { ...team, members: team.members.map(({ email, ...m }) => (isMember ? { ...m, email } : m)) };
    return json({ team: pub, is_member: isMember });
  });

  app.patch("/api/teams/:id", async (c) => {
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return err(401, "Sign in required");
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const db = c.env.DB;
    const me = await resolveUser(db, fbUser);
    const team = await db.prepare("SELECT * FROM teams WHERE id = ?").bind(c.req.param("id")).first();
    if (!team) return err(404, "Band not found");
    if (team.leader_id !== me.id) return err(403, "Only the band leader can edit the profile");
    const b = await c.req.json().catch(() => ({}));
    await db
      .prepare("UPDATE teams SET name = ?, genre = ?, city = ?, about = ? WHERE id = ?")
      .bind(String(b.name ?? team.name).trim() || team.name, String(b.genre ?? team.genre).trim(),
        String(b.city ?? team.city).trim(), String(b.about ?? team.about).trim(), team.id)
      .run();
    return json({ team: await teamWithMembers(db, team.id) });
  });

  app.patch("/api/teams/:id/splits", async (c) => {
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return err(401, "Sign in required");
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const db = c.env.DB;
    const me = await resolveUser(db, fbUser);
    const team = await db.prepare("SELECT * FROM teams WHERE id = ?").bind(c.req.param("id")).first();
    if (!team) return err(404, "Band not found");
    if (team.leader_id !== me.id) return err(403, "Only the band leader can change splits");
    const { splits } = await c.req.json().catch(() => ({}));
    if (!Array.isArray(splits) || !splits.length) return err(400, "splits[] required");
    const members = await db
      .prepare("SELECT user_id FROM team_members WHERE team_id = ? AND status = 'active'")
      .bind(team.id).all();
    const memberIds = new Set((members.results ?? []).map((m) => m.user_id));
    const seen = new Set();
    let total = 0;
    for (const s of splits) {
      const pct = Math.round(Number(s.split_pct));
      if (!Number.isFinite(pct) || pct < 0) return err(400, "Split percentages must be 0 or more");
      if (!memberIds.has(s.user_id)) return err(400, "Splits can only cover current members");
      if (seen.has(s.user_id)) return err(400, "Duplicate member in splits");
      seen.add(s.user_id);
      total += pct;
    }
    for (const s of splits) {
      await db.prepare("UPDATE team_members SET split_pct = ? WHERE team_id = ? AND user_id = ?")
        .bind(Math.round(Number(s.split_pct)), team.id, s.user_id).run();
    }
    const check = await db
      .prepare("SELECT COALESCE(SUM(split_pct),0) AS total FROM team_members WHERE team_id = ? AND status = 'active'")
      .bind(team.id).first();
    if (Number(check?.total) !== 100) {
      // Roll back to the previous state rather than persist a broken split.
      const prev = await db.prepare("SELECT user_id, split_pct FROM team_members WHERE team_id = ?").bind(team.id).all();
      for (const m of prev.results ?? []) {
        await db.prepare("UPDATE team_members SET split_pct = ? WHERE team_id = ? AND user_id = ?")
          .bind(m.split_pct, team.id, m.user_id).run();
      }
      return err(400, SPLIT_SUM_ERR + ` (got ${check?.total}%)`);
    }
    return json({ team: await teamWithMembers(db, team.id) });
  });

  app.get("/api/teams/:id/payouts", async (c) => {
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return err(401, "Sign in required");
    const db = c.env.DB;
    const me = await resolveUser(db, fbUser);
    const team = await db.prepare("SELECT * FROM teams WHERE id = ?").bind(c.req.param("id")).first();
    if (!team) return err(404, "Band not found");
    const isMember = await db
      .prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'")
      .bind(team.id, me.id).first();
    if (!isMember && team.leader_id !== me.id) return err(403, "Band payouts are visible to members only");
    const res = await db
      .prepare(`SELECT p.*, b.event_type, b.event_date, b.status AS booking_status, u.name AS member_name
                FROM payouts p JOIN bookings b ON b.id = p.booking_id JOIN users u ON u.id = p.user_id
                WHERE b.artist_id = (SELECT profile_id FROM teams WHERE id = ?)
                ORDER BY p.created_at DESC, p.kind`)
      .bind(team.id).all();
    const totals = await db
      .prepare(`SELECT COALESCE(SUM(p.net_inr),0) AS earned, COALESCE(SUM(CASE WHEN p.kind='gig' THEN p.net_inr ELSE 0 END),0) AS gig
                FROM payouts p JOIN bookings b ON b.id = p.booking_id
                WHERE b.artist_id = (SELECT profile_id FROM teams WHERE id = ?)`)
      .bind(team.id).first();
    return json({ payouts: res.results ?? [], totals: { earned: Number(totals?.earned ?? 0), gig: Number(totals?.gig ?? 0) } });
  });

  // ---- invites -------------------------------------------------------------

  app.post("/api/teams/:id/invites", async (c) => {
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return err(401, "Sign in required");
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const db = c.env.DB;
    const me = await resolveUser(db, fbUser);
    const team = await db.prepare("SELECT * FROM teams WHERE id = ?").bind(c.req.param("id")).first();
    if (!team) return err(404, "Band not found");
    if (team.leader_id !== me.id) return err(403, "Only the band leader sends invites");
    const b = await c.req.json().catch(() => ({}));
    const email = String(b.email || "").trim().toLowerCase();
    if (!email) return err(400, "Email is required");
    const invitee = await db.prepare("SELECT id, name FROM users WHERE email = ?").bind(email).first();
    if (!invitee) return err(404, "No Mehfil account with that email yet — ask them to sign in first");
    if (invitee.id === me.id) return err(400, "You are already in this band");
    const inTeam = await db.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?").bind(team.id, invitee.id).first();
    if (inTeam) return err(409, "Already a member");
    const pending = await db.prepare("SELECT id, status FROM team_invites WHERE team_id = ? AND invitee_id = ?").bind(team.id, invitee.id).first();
    if (pending) {
      if (pending.status === "pending") return err(409, "Invite already pending");
      await db.prepare("UPDATE team_invites SET status = 'pending', split_pct = ?, created_at = datetime('now') WHERE id = ?")
        .bind(Math.round(Number(b.split_pct) || 0), pending.id).run();
      return json({ invite: { id: pending.id, status: "pending" } }, 201);
    }
    const id = idp("inv");
    await db
      .prepare("INSERT INTO team_invites (id, team_id, invitee_id, invited_by, role, split_pct) VALUES (?,?,?,?,?,?)")
      .bind(id, team.id, invitee.id, me.id, "member", Math.round(Number(b.split_pct) || 0))
      .run();
    return json({ invite: { id, status: "pending", invitee: invitee.name } }, 201);
  });

  app.get("/api/invites/mine", async (c) => {
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return err(401, "Sign in required");
    const db = c.env.DB;
    const me = await resolveUser(db, fbUser);
    const res = await db
      .prepare(`SELECT ti.*, t.name AS team_name, t.genre, t.city, t.hue, u.name AS leader_name
                FROM team_invites ti JOIN teams t ON t.id = ti.team_id JOIN users u ON u.id = t.leader_id
                WHERE ti.invitee_id = ? AND ti.status = 'pending' ORDER BY ti.created_at DESC`)
      .bind(me.id).all();
    return json({ invites: res.results ?? [] });
  });

  const respondInvite = (decision) => async (c) => {
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return err(401, "Sign in required");
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const db = c.env.DB;
    const me = await resolveUser(db, fbUser);
    const inv = await db.prepare("SELECT * FROM team_invites WHERE id = ?").bind(c.req.param("id")).first();
    if (!inv || inv.invitee_id !== me.id) return err(404, "Invite not found");
    if (inv.status !== "pending") return err(409, `Invite already ${inv.status}`);
    if (decision === "declined") {
      await db.prepare("UPDATE team_invites SET status = 'declined' WHERE id = ?").bind(inv.id).run();
      return json({ ok: true, status: "declined" });
    }
    const existing = await userTeam(db, me.id);
    if (existing) return err(409, "You are already in a band — leave it before joining another");
    const profile = await db.prepare("SELECT id, team_id FROM artist_profiles WHERE user_id = ?").bind(me.id).first();
    if (profile?.team_id) return err(409, "Your artist profile already belongs to a band");
    const memberCount = await db
      .prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND status = 'active'")
      .bind(inv.team_id).first();
    const split = memberCount?.n >= 5 ? 0 : Math.max(0, Math.round(Number(inv.split_pct) || 0));
    await db.prepare("UPDATE team_invites SET status = 'accepted' WHERE id = ?").bind(inv.id).run();
    await db
      .prepare("INSERT INTO team_members (team_id, user_id, role, split_pct) VALUES (?,?,?,?)")
      .bind(inv.team_id, me.id, "member", split).run();
    if (profile) await db.prepare("UPDATE artist_profiles SET team_id = ? WHERE id = ?").bind(inv.team_id, profile.id).run();
    return json({ ok: true, status: "accepted", team_id: inv.team_id, split_pct: split });
  };
  app.post("/api/invites/:id/accept", respondInvite("accepted"));
  app.post("/api/invites/:id/decline", respondInvite("declined"));

  // ---- payouts ledger ------------------------------------------------------

  app.get("/api/payouts", async (c) => {
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return err(401, "Sign in required");
    const db = c.env.DB;
    const me = await resolveUser(db, fbUser);
    const res = await db
      .prepare(`SELECT p.*, b.event_type, b.event_date, b.status AS booking_status, b.city, ap.stage_name, ap.team_id
                FROM payouts p
                JOIN bookings b ON b.id = p.booking_id
                JOIN artist_profiles ap ON ap.id = b.artist_id
                WHERE p.user_id = ?
                ORDER BY p.created_at DESC, p.kind`)
      .bind(me.id)
      .all();
    const totals = await db
      .prepare("SELECT COALESCE(SUM(net_inr),0) AS earned, COALESCE(SUM(CASE WHEN kind='gig' THEN net_inr ELSE 0 END),0) AS gig FROM payouts WHERE user_id = ?")
      .bind(me.id).first();
    return json({ payouts: res.results ?? [], totals: { earned: Number(totals?.earned ?? 0), gig: Number(totals?.gig ?? 0) } });
  });

  // Host tips after completion — zero platform fee, split like the gig.
  app.post("/api/bookings/:id/tip", async (c) => {
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return err(401, "Sign in required");
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const db = c.env.DB;
    const me = await resolveUser(db, fbUser);
    const booking = await db.prepare("SELECT * FROM bookings WHERE id = ?").bind(c.req.param("id")).first();
    if (!booking) return err(404, "Booking not found");
    if (booking.host_id !== me.id) return err(403, "Only the host can tip");
    if (booking.status !== "completed") return err(409, "Tips unlock after the booking is completed");
    const { amount } = await c.req.json().catch(() => ({}));
    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt < 100 || amt > 10000) return err(400, "Tip must be between ₹100 and ₹10,000");
    const artist = await db.prepare("SELECT * FROM artist_profiles WHERE id = ?").bind(booking.artist_id).first();
    if (!artist) return err(404, "Artist not found");
    const recipients = await paymentRecipients(db, artist);
    const tipBooking = { ...booking, tip_inr: amt };
    const result = await writePayouts(db, { booking: tipBooking, artist, recipients, kind: "tip" });
    if (!result.written) return err(409, "A tip was already recorded for this booking");
    await db.prepare("UPDATE bookings SET tip_inr = COALESCE(tip_inr,0) + ? WHERE id = ?").bind(amt, booking.id).run();
    await db
      .prepare("INSERT INTO booking_events (booking_id, type, actor_id, note) VALUES (?,?,?,?)")
      .bind(booking.id, "tipped", me.id, `${inr(amt)} tipped — ${recipients.length > 1 ? `split ${recipients.map((r) => `${r.split_pct}%`).join(" / ")} across the band` : `all ${inr(amt)} to ${artist.stage_name}`}.`)
      .run();
    return json({ ok: true, tip_inr: amt, recipients: result.rows }, 201);
  });

  // ---- follows -------------------------------------------------------------

  app.post("/api/artists/:id/follow", async (c) => {
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return err(401, "Sign in required");
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const db = c.env.DB;
    const me = await resolveUser(db, fbUser);
    const artist = await db.prepare("SELECT id, user_id FROM artist_profiles WHERE id = ?").bind(c.req.param("id")).first();
    if (!artist) return err(404, "Artist not found");
    if (artist.user_id === me.id) return err(400, "You cannot follow yourself");
    const existing = await db.prepare("SELECT 1 FROM follows WHERE user_id = ? AND artist_id = ?").bind(me.id, artist.id).first();
    if (existing) {
      await db.prepare("DELETE FROM follows WHERE user_id = ? AND artist_id = ?").bind(me.id, artist.id).run();
    } else {
      await db.prepare("INSERT INTO follows (user_id, artist_id) VALUES (?,?)").bind(me.id, artist.id).run();
    }
    const count = await db.prepare("SELECT COUNT(*) AS n FROM follows WHERE artist_id = ?").bind(artist.id).first();
    return json({ following: !existing, followers: Number(count?.n ?? 0) });
  });

  // ---- smart match ---------------------------------------------------------

  app.get("/api/match", async (c) => {
    const db = c.env.DB;
    const brief = String(c.req.query("brief") || "").trim();
    if (brief.length < 8) return err(400, "Tell us a bit more — a one-line brief works");
    const city = (c.req.query("city") || "").trim();
    const budget = Math.round(Number(c.req.query("budget")) || 0);
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return json({ matches: [], needs_auth: true, count: 0 });
    const dbRows = await db
      .prepare(`SELECT ap.*, COALESCE(r.avg_rating, 0) AS rating, COALESCE(r.n, 0) AS reviews_count
                FROM artist_profiles ap
                LEFT JOIN (SELECT artist_id, ROUND(AVG(rating),1) AS avg_rating, COUNT(*) AS n
                           FROM reviews GROUP BY artist_id) r ON r.artist_id = ap.id`)
      .all();
    const artists = (dbRows.results ?? []).map(shapeArtist);
    const matches = smartMatch(artists, { brief, city, budget });
    return json({ matches, needs_auth: false, count: matches.length });
  });

  // ---- misc ----------------------------------------------------------------

  app.get("/api/packages/:id", async (c) => {
    const pkg = await c.env.DB.prepare("SELECT * FROM packages WHERE id = ?").bind(c.req.param("id")).first();
    if (!pkg) return err(404, "Package not found");
    return json({ package: pkg });
  });

  // Invoice: host, band members, or the artist owner can read it.
  app.get("/api/invoice/:id", async (c) => {
    const fbUser = await auth.getUser(c.req.raw);
    if (!fbUser) return err(401, "Sign in required");
    const db = c.env.DB;
    const me = await resolveUser(db, fbUser);
    const booking = await db.prepare("SELECT * FROM bookings WHERE id = ?").bind(c.req.param("id")).first();
    if (!booking) return err(404, "Booking not found");
    const artist = await db.prepare("SELECT * FROM artist_profiles WHERE id = ?").bind(booking.artist_id).first();
    if (!artist) return err(404, "Artist not found");
    const team = artist.team_id ? await db.prepare("SELECT * FROM teams WHERE id = ?").bind(artist.team_id).first() : null;
    const memberRows = await db
      .prepare(`SELECT tm.user_id, tm.split_pct, u.name FROM team_members tm JOIN users u ON u.id = tm.user_id
                WHERE tm.team_id = ? AND tm.status = 'active'`)
      .bind(artist.team_id ?? "")
      .all();
    const members = memberRows.results ?? [];
    const allowed =
      booking.host_id === me.id ||
      artist.user_id === me.id ||
      members.some((m) => m.user_id === me.id);
    if (!allowed) return err(403, "Not your booking");
    const payRows = await db
      .prepare("SELECT p.*, u.name AS member_name FROM payouts p JOIN users u ON u.id = p.user_id WHERE p.booking_id = ? ORDER BY p.kind, p.split_pct DESC")
      .bind(booking.id).all();
    const payouts = (payRows.results ?? []).map((p) => ({
      kind: p.kind, gross: Number(p.gross_inr), fee: Number(p.fee_inr), net: Number(p.net_inr),
      split_pct: Number(p.split_pct), name: p.member_name,
    }));
    const host = await db.prepare("SELECT name, email FROM users WHERE id = ?").bind(booking.host_id).first();
    const settled = booking.status === "completed";
    const html = renderInvoice({ booking, artist, host: host ?? { name: "", email: "" }, team, payouts, members });
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="mehfil-invoice-${booking.id}${settled ? "" : "-draft"}.html"`,
      },
    });
  });
}
