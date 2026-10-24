// Lead Engine: schema, sourcing (Places + CSV + claim), verification,
// filtering, matchmaking, outreach (half/full auto) and the daily cron.
// Mounted from index.js via mountLeadRoutes; the scheduled handler calls
// runLeadCron. Money-free: this is a pipeline over a `leads` table.
//
// Data-compliance stance: leads are (a) business listings from Google Places,
// (b) lists the operator imports with rights to use, or (c) artists who
// self-register. Cold outbound is human-approved by default (half-auto) and
// can be switched to full-auto per the operator's own risk appetite.

import { parseCsv, rowToLead, dedupeKey, placesSearchAll, mapPlace, matchScore } from "./leadsource.js";
import { verifyLead } from "./verify.js";
import { notify, leadMessage, digestMessage, telegramConfigured } from "./notify.js";
import { sendOutreachEmail, emailConfigured } from "./mail.js";
import { resolveUser, isWorkspaceOwner } from "./util.js";
import { isSameOriginRequest } from "@freebuff/auth";

const idp = (p) => p + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const VERIFIED_TTL_DAYS = 7; // re-verify leads older than this

// A lead we can actually reach on at least one channel.
export function hasContact(lead) {
  return !!(lead.phone || lead.email || lead.website || lead.instagram);
}

// Run fn over items with at most `limit` in flight — speeds up the verify
// batch without stampeding the network or D1.
export async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 0)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

const DDL = `
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'venue',
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  dedupe_key TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT 'unverified',
  verify_detail TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new',
  wants_artists INTEGER NOT NULL DEFAULT 1,
  rating REAL,
  reviews_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_dedupe ON leads(dedupe_key) WHERE dedupe_key != '';
CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city);
CREATE INDEX IF NOT EXISTS idx_leads_city_cat ON leads(city, category);
CREATE INDEX IF NOT EXISTS idx_leads_kind ON leads(kind);
CREATE INDEX IF NOT EXISTS idx_leads_verif ON leads(verification);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_checked ON leads(last_checked_at);

CREATE TABLE IF NOT EXISTS lead_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events(lead_id);

CREATE TABLE IF NOT EXISTS lead_interests (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  artist_id TEXT,
  user_id TEXT,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (lead_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_interests_lead ON lead_interests(lead_id);

CREATE TABLE IF NOT EXISTS notify_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL DEFAULT 'telegram',
  chat_id TEXT,
  topic TEXT,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL DEFAULT 'cron',
  places_fetched INTEGER DEFAULT 0, places_new INTEGER DEFAULT 0, places_updated INTEGER DEFAULT 0,
  verified INTEGER DEFAULT 0, invalid INTEGER DEFAULT 0, matches INTEGER DEFAULT 0, outreach INTEGER DEFAULT 0,
  notified INTEGER DEFAULT 0, ok INTEGER DEFAULT 1, error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
);

CREATE TABLE IF NOT EXISTS lead_settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
`;

const READY_DBS = new WeakSet();
export async function ensureLeadsSchema(env) {
  if (READY_DBS.has(env.DB)) return;
  const db = env.DB;
  for (const stmt of DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
  // Retention counters (added in place so existing deployments upgrade).
  for (const [col, decl] of [["expired_at", "TEXT"], ["fail_count", "INTEGER NOT NULL DEFAULT 0"]]) {
    try { await db.prepare(`ALTER TABLE leads ADD COLUMN ${col} ${decl}`).run(); } catch { /* exists */ }
  }
  READY_DBS.add(env.DB);
}

const getSetting = async (db, key, fallback = null) => {
  const r = await db.prepare("SELECT value FROM lead_settings WHERE key = ?").bind(key).first();
  return r ? r.value : fallback;
};
const setSetting = async (db, key, value) => {
  await db.prepare("INSERT INTO lead_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, String(value)).run();
};

async function logEvent(db, leadId, type, note, actor = "system") {
  await db.prepare("INSERT INTO lead_events (lead_id, type, actor, note) VALUES (?,?,?,?)")
    .bind(leadId, type, actor, String(note || "").slice(0, 500)).run();
}

// Dedupe-aware insert-or-update. Never clobbers operator-set verification,
// status or notes on refresh — only fills/refreshes sourced contact fields.
// Returns { created, changed, lead }.
export async function upsertLead(db, lead, { createdBy = "system" } = {}) {
  const key = dedupeKey(lead) || "";
  const existing = key ? await db.prepare("SELECT * FROM leads WHERE dedupe_key = ?").bind(key).first() : null;
  const fields = {
    name: String(lead.name || "").trim(),
    category: String(lead.category || "").trim(),
    city: String(lead.city || "").trim(),
    area: String(lead.area || "").trim(),
    address: String(lead.address || "").trim(),
    phone: String(lead.phone || "").trim(),
    website: String(lead.website || "").trim(),
    instagram: String(lead.instagram || "").replace(/^@/, "").trim(),
    email: String(lead.email || "").trim(),
  };
  if (existing) {
    const changed = ["category", "city", "area", "address", "phone", "website", "instagram", "email"]
      .some((f) => fields[f] && fields[f] !== existing[f]) || (!!fields.name && fields.name !== existing.name);
    if (changed || (lead.rating != null && Number(existing.rating || 0) !== Number(lead.rating))) {
      await db.prepare(`UPDATE leads SET
          name = CASE WHEN ? != '' THEN ? ELSE name END,
          category = CASE WHEN ? != '' THEN ? ELSE category END,
          city = CASE WHEN ? != '' THEN ? ELSE city END,
          area = CASE WHEN ? != '' THEN ? ELSE area END,
          address = CASE WHEN ? != '' THEN ? ELSE address END,
          phone = CASE WHEN ? != '' THEN ? ELSE phone END,
          website = CASE WHEN ? != '' THEN ? ELSE website END,
          instagram = CASE WHEN ? != '' THEN ? ELSE instagram END,
          email = CASE WHEN ? != '' THEN ? ELSE email END,
          rating = COALESCE(?, rating),
          reviews_count = MAX(reviews_count, ?),
          external_id = COALESCE(NULLIF(?, ''), external_id),
          updated_at = datetime('now')
        WHERE id = ?`).bind(
        fields.name, fields.name, fields.category, fields.category, fields.city, fields.city,
        fields.area, fields.area, fields.address, fields.address, fields.phone, fields.phone,
        fields.website, fields.website, fields.instagram, fields.instagram, fields.email, fields.email,
        lead.rating ?? null, Number(lead.reviews_count) || 0, lead.external_id || null, existing.id
      ).run();
      await logEvent(db, existing.id, "refreshed", `Updated from ${lead.source || "source"}`);
    }
    const fresh = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(existing.id).first();
    return { created: false, changed, lead: fresh };
  }
  const id = idp("ld");
  await db.prepare(`INSERT INTO leads (id, kind, name, category, city, area, address, phone, website, instagram, email,
      source, external_id, dedupe_key, rating, reviews_count, wants_artists, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    id, lead.kind || "venue", fields.name, fields.category, fields.city, fields.area, fields.address,
    fields.phone, fields.website, fields.instagram, fields.email, lead.source || "manual",
    lead.external_id || null, key, lead.rating ?? null, Number(lead.reviews_count) || 0,
    lead.wants_artists == null ? 1 : (lead.wants_artists ? 1 : 0), createdBy
  ).run();
  await logEvent(db, id, "imported", `Added via ${lead.source || "manual"}`, createdBy);
  const fresh = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first();
  return { created: true, changed: true, lead: fresh };
}

export function mountLeadRoutes(app, auth) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const err = (status, error) => json({ error }, status);
  const sameOrigin = (c) => isSameOriginRequest(c.req.raw, c.env.APP_ORIGIN);

  // Owner guard for the leads console (401 when signed out; keeps public claim open).
  const owner = async (c) => {
    const fb = await auth.getUser(c.req.raw);
    if (!fb) return { error: err(401, "Sign in required") };
    const db = c.env.DB;
    await ensureLeadsSchema(c.env);
    const me = await resolveUser(db, fb);
    if (!isWorkspaceOwner(c.env, me)) {
      return { error: err(403, "This console is limited to the workspace owner") };
    }
    return { me, db };
  };

  const buildFilter = (q) => {
    const where = [], params = [];
    if (q.kind) { where.push("kind = ?"); params.push(q.kind); }
    if (q.city) { where.push("city = ?"); params.push(q.city); }
    if (q.area) { where.push("area = ?"); params.push(q.area); }
    if (q.category) { where.push("category = ?"); params.push(q.category); }
    if (q.verification) { where.push("verification = ?"); params.push(q.verification); }
    if (q.status) { where.push("status = ?"); params.push(q.status); }
    if (q.source) { where.push("source = ?"); params.push(q.source); }
    if (q.verified_only === "1" || q.verified_only === "true") where.push("verification = 'verified'");
    if (q.q) {
      where.push("(name LIKE ? OR city LIKE ? OR area LIKE ? OR phone LIKE ? OR website LIKE ? OR email LIKE ?)");
      const like = `%${q.q}%`;
      params.push(like, like, like, like, like, like);
    }
    return { sql: where.length ? "WHERE " + where.join(" AND ") : "", params };
  };

  // ---- list + facets --------------------------------------------------------
  app.get("/api/leads", async (c) => {
    const { error, db } = await owner(c);
    if (error) return error;
    const q = c.req.query();
    const { sql, params } = buildFilter(q);
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const sort = q.sort === "recent"
      ? "updated_at DESC"
      : "(verification = 'verified') DESC, rating DESC, reviews_count DESC, updated_at DESC";
    const [rows, total] = await Promise.all([
      db.prepare(`SELECT * FROM leads ${sql} ORDER BY ${sort} LIMIT ? OFFSET ?`).bind(...params, limit, offset).all(),
      db.prepare(`SELECT COUNT(*) AS n FROM leads ${sql}`).bind(...params).first(),
    ]);
    return json({ leads: rows.results ?? [], total: Number(total?.n ?? 0), limit, offset });
  });

  app.get("/api/leads/meta", async (c) => {
    const { error, db } = await owner(c);
    if (error) return error;
    const [cities, cats, kinds, verifs, statuses, counts, lastRun] = await Promise.all([
      db.prepare("SELECT city, COUNT(*) n, SUM(verification='verified') v FROM leads WHERE city != '' GROUP BY city ORDER BY n DESC").all(),
      db.prepare("SELECT category, COUNT(*) n FROM leads WHERE category != '' GROUP BY category ORDER BY n DESC").all(),
      db.prepare("SELECT kind, COUNT(*) n FROM leads GROUP BY kind").all(),
      db.prepare("SELECT verification, COUNT(*) n FROM leads GROUP BY verification").all(),
      db.prepare("SELECT status, COUNT(*) n FROM leads GROUP BY status").all(),
      db.prepare("SELECT COUNT(*) total, SUM(verification='verified') verified, SUM(status='new') fresh FROM leads").first(),
      db.prepare("SELECT * FROM lead_runs ORDER BY id DESC LIMIT 1").first(),
    ]);
    return json({
      cities: cities.results ?? [], categories: cats.results ?? [], kinds: kinds.results ?? [],
      verifications: verifs.results ?? [], statuses: statuses.results ?? [],
      counts: {
        total: Number(counts?.total ?? 0), verified: Number(counts?.verified ?? 0), fresh: Number(counts?.fresh ?? 0),
      },
      telegram: telegramConfigured(c.env),
      places: !!(c.env.GOOGLE_PLACES_API_KEY),
      email: emailConfigured(c.env),
      outreach_mode: await getSetting(db, "outreach_mode", "manual"),
      last_run: lastRun ?? null,
    });
  });

  // ---- detail ---------------------------------------------------------------
  app.get("/api/leads/:id", async (c) => {
    const { error, db } = await owner(c);
    if (error) return error;
    const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(c.req.param("id")).first();
    if (!lead) return err(404, "Lead not found");
    const [events, interests] = await Promise.all([
      db.prepare("SELECT * FROM lead_events WHERE lead_id = ? ORDER BY id DESC LIMIT 50").bind(lead.id).all(),
      db.prepare("SELECT li.*, u.name AS artist_user FROM lead_interests li LEFT JOIN users u ON u.id = li.user_id WHERE li.lead_id = ? ORDER BY li.created_at DESC").bind(lead.id).all(),
    ]);
    return json({ lead, events: events.results ?? [], interests: interests.results ?? [] });
  });

  // ---- create / update ------------------------------------------------------
  app.post("/api/leads", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, me, db } = await owner(c);
    if (error) return error;
    const b = await c.req.json().catch(() => ({}));
    if (!b.name) return err(400, "name is required");
    const r = await upsertLead(db, { ...b, source: b.source || "manual" }, { createdBy: me.id });
    return json(r, r.created ? 201 : 200);
  });

  app.patch("/api/leads/:id", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, me, db } = await owner(c);
    if (error) return error;
    const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(c.req.param("id")).first();
    if (!lead) return err(404, "Lead not found");
    const b = await c.req.json().catch(() => ({}));
    const set = [], params = [];
    const put = (col, val) => { set.push(`${col} = ?`); params.push(val); };
    if (b.name != null) put("name", String(b.name).trim());
    if (b.category != null) put("category", String(b.category).trim().toLowerCase());
    if (b.city != null) put("city", String(b.city).trim());
    if (b.area != null) put("area", String(b.area).trim());
    if (b.address != null) put("address", String(b.address).trim());
    if (b.phone != null) put("phone", String(b.phone).replace(/\D/g, ""));
    if (b.website != null) put("website", String(b.website).trim());
    if (b.instagram != null) put("instagram", String(b.instagram).replace(/^@/, "").trim());
    if (b.email != null) put("email", String(b.email).trim().toLowerCase());
    if (b.notes != null) put("notes", String(b.notes));
    if (b.kind != null) put("kind", String(b.kind));
    if (b.wants_artists != null) put("wants_artists", b.wants_artists ? 1 : 0);
    if (b.verification != null) { put("verification", String(b.verification)); await logEvent(db, lead.id, "verified", `Marked ${b.verification} manually`, me.id); }
    if (b.status != null) { put("status", String(b.status)); await logEvent(db, lead.id, "status", `Status → ${b.status}`, me.id); }
    if (!set.length) return err(400, "Nothing to update");
    await db.prepare(`UPDATE leads SET ${set.join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...params, lead.id).run();
    const fresh = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(lead.id).first();
    return json({ lead: fresh });
  });

  // ---- CSV import -----------------------------------------------------------
  app.post("/api/leads/import/csv", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, me, db } = await owner(c);
    if (error) return error;
    const body = await c.req.json().catch(() => ({}));
    const text = body.csv || "";
    if (!text.trim()) return err(400, "csv text required");
    const rows = parseCsv(text).slice(0, 5000);
    let created = 0, updated = 0;
    for (const row of rows) {
      const lead = rowToLead(row, "csv");
      if (!lead.name) continue;
      const r = await upsertLead(db, lead, { createdBy: me.id });
      r.created ? created++ : updated++;
    }
    return json({ imported: rows.length, created, updated });
  });

  app.get("/api/leads/export.csv", async (c) => {
    const { error, db } = await owner(c);
    if (error) return error;
    const { sql, params } = buildFilter(c.req.query());
    const rows = (await db.prepare(`SELECT * FROM leads ${sql} ORDER BY (verification='verified') DESC, name`).bind(...params).all()).results ?? [];
    const cols = ["name", "kind", "category", "city", "area", "phone", "website", "email", "instagram", "verification", "status", "source", "rating"];
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...rows.map((r) => cols.map((k) => esc(r[k])).join(","))].join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="mehfil-leads.csv"' } });
  });

  // ---- Google Places sync ---------------------------------------------------
  app.post("/api/leads/sync/places", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, me, db } = await owner(c);
    if (error) return error;
    const key = c.env.GOOGLE_PLACES_API_KEY;
    if (!key) return err(400, "GOOGLE_PLACES_API_KEY not set — add it in Sites → Secrets (or .dev.vars locally)");
    const b = await c.req.json().catch(() => ({}));
    const cities = (b.cities && b.cities.length ? b.cities : ["Pune", "Mumbai", "Jaipur"]).slice(0, 6);
    const cats = (b.categories && b.categories.length ? b.categories : ["cafe", "night club", "restaurant"]).slice(0, 6);
    const summary = { fetched: 0, created: 0, updated: 0, errors: [] };
    for (const city of cities) {
      for (const cat of cats) {
        try {
          const data = await placesSearchAll({ text: `${cat} in ${city}`, key });
          for (const place of data.places || []) {
            const lead = mapPlace(place, city, cat);
            if (!lead.name) continue;
            summary.fetched++;
            const r = await upsertLead(db, lead, { createdBy: me.id });
            r.created ? summary.created++ : summary.updated++;
          }
        } catch (e) {
          summary.errors.push(`${city}/${cat}: ${String(e.message || e).slice(0, 120)}`);
        }
      }
    }
    return json(summary);
  });

  // ---- verification ---------------------------------------------------------
  app.post("/api/leads/:id/verify", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, db } = await owner(c);
    if (error) return error;
    const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(c.req.param("id")).first();
    if (!lead) return err(404, "Lead not found");
    const result = await verifyLead(lead, { fetchImpl: fetch, dohFetch: fetch });
    await db.prepare("UPDATE leads SET verification = ?, verify_detail = ?, last_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .bind(result.verification, JSON.stringify(result.detail), lead.id).run();
    await logEvent(db, lead.id, result.verification === "verified" ? "verified" : "checked", `Auto-check → ${result.verification}`);
    const fresh = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(lead.id).first();
    return json({ lead: fresh, detail: result.detail });
  });

  app.post("/api/leads/verify", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, db } = await owner(c);
    if (error) return error;
    const body = await c.req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 25, 100);
    const rows = (await db.prepare(`SELECT * FROM leads
        WHERE last_checked_at IS NULL OR last_checked_at < datetime('now', '-${VERIFIED_TTL_DAYS} days')
        ORDER BY last_checked_at IS NULL DESC, updated_at DESC LIMIT ?`).bind(limit).all()).results ?? [];
    let verified = 0, invalid = 0;
    await mapPool(rows, 4, async (lead) => {
      const result = await verifyLead(lead, { fetchImpl: fetch, dohFetch: fetch });
      await db.prepare("UPDATE leads SET verification = ?, verify_detail = ?, last_checked_at = datetime('now') WHERE id = ?")
        .bind(result.verification, JSON.stringify(result.detail), lead.id).run();
      result.verification === "verified" ? verified++ : result.verification === "invalid" ? invalid++ : 0;
    });
    return json({ checked: rows.length, verified, invalid });
  });

  // ---- matchmaking ----------------------------------------------------------
  // ?artist_id=X -> ranked venue/client leads for that artist; else owner's
  // pending artist-interest queue.
  app.get("/api/leads/matches", async (c) => {
    const { error, db } = await owner(c);
    if (error) return error;
    const artistId = c.req.query("artist_id");
    if (artistId) {
      const artist = await db.prepare("SELECT * FROM artist_profiles WHERE id = ?").bind(artistId).first();
      if (!artist) return err(404, "Artist not found");
      const leads = (await db.prepare("SELECT * FROM leads WHERE wants_artists = 1 AND kind IN ('venue','client') AND verification != 'invalid'").all()).results ?? [];
      const scored = leads
        .map((l) => ({ lead: l, ...matchScore(l, artist) }))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 30);
      return json({ matches: scored, artist: { stage_name: artist.stage_name, city: artist.city, category: artist.category } });
    }
    const rows = (await db.prepare(`SELECT li.*, l.name AS lead_name, l.city, l.category, l.phone, l.verification, u.name AS artist_name
        FROM lead_interests li JOIN leads l ON l.id = li.lead_id LEFT JOIN users u ON u.id = li.user_id
        WHERE li.status = 'pending' ORDER BY li.created_at DESC LIMIT 100`).all()).results ?? [];
    return json({ pending: rows });
  });

  // Artist raises interest in a client/venue lead (supply → demand signal).
  app.post("/api/leads/:id/interest", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const fb = await auth.getUser(c.req.raw);
    if (!fb) return err(401, "Sign in required");
    const db = c.env.DB;
    await ensureLeadsSchema(c.env);
    const me = await resolveUser(db, fb);
    const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(c.req.param("id")).first();
    if (!lead) return err(404, "Lead not found");
    if (lead.verification === "invalid") return err(409, "This lead failed verification");
    const artist = await db.prepare("SELECT * FROM artist_profiles WHERE user_id = ?").bind(me.id).first();
    if (!artist) return err(403, "Only artists can raise interest — create a profile first");
    const b = await c.req.json().catch(() => ({}));
    const existing = await db.prepare("SELECT 1 FROM lead_interests WHERE lead_id = ? AND artist_id = ?").bind(lead.id, artist.id).first();
    if (existing) return err(409, "Interest already raised");
    const iid = idp("li");
    await db.prepare("INSERT INTO lead_interests (id, lead_id, artist_id, user_id, message) VALUES (?,?,?,?,?)")
      .bind(iid, lead.id, artist.id, me.id, String(b.message || "").slice(0, 400)).run();
    if (lead.status === "new") await db.prepare("UPDATE leads SET status = 'interested' WHERE id = ?").bind(lead.id).run();
    await logEvent(db, lead.id, "interested", `${artist.stage_name} wants this gig`, me.id);
    await notify(c.env,
      `${leadMessage(lead, "artist interest")}\n\n🎤 <b>${artist.stage_name}</b> (${artist.category}, ${artist.city}) wants this gig${b.message ? `: ${String(b.message).slice(0, 160)}` : ""}`,
      "interest");
    return json({ ok: true, interest_id: iid }, 201);
  });

  // ---- outreach (the human step in half-auto; cron does this in full-auto) --
  app.post("/api/leads/:id/approve", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, db } = await owner(c);
    if (error) return error;
    const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(c.req.param("id")).first();
    if (!lead) return err(404, "Lead not found");
    if (lead.status === "contacted") return err(409, "Already contacted");
    if (!hasContact(lead)) return err(400, "This lead has no phone, email or website to reach");
    const out = await contactLead(db, c.env, lead, "owner-approve");
    const fresh = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(lead.id).first();
    return json({ lead: fresh, channel: out.channel || null });
  });

  // ---- settings -------------------------------------------------------------
  app.post("/api/leads/settings", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, db } = await owner(c);
    if (error) return error;
    const b = await c.req.json().catch(() => ({}));
    if (b.outreach_mode) await setSetting(db, "outreach_mode", b.outreach_mode === "auto" ? "auto" : "manual");
    if (b.sync_cities) await setSetting(db, "sync_cities", String(b.sync_cities));
    if (b.sync_categories) await setSetting(db, "sync_categories", String(b.sync_categories));
    return json({ ok: true, outreach_mode: await getSetting(db, "outreach_mode", "manual") });
  });

  // ---- manual pipeline run (half-manual: run the automation on demand) ------
  app.post("/api/leads/run", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error } = await owner(c);
    if (error) return error;
    return json(await runLeadCron(c.env, { trigger: "manual" }));
  });

  // ---- public self-serve claim (no auth): artists register themselves ------
  app.post("/api/leads/claim", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    await ensureLeadsSchema(c.env);
    const db = c.env.DB;
    const b = await c.req.json().catch(() => ({}));
    if (!b.name || !b.city) return err(400, "name and city are required");
    const lead = {
      kind: "artist", source: "claim", name: String(b.name).trim(),
      category: String(b.category || "other").trim().toLowerCase(), city: String(b.city).trim(),
      area: String(b.area || "").trim(), phone: String(b.phone || "").replace(/\D/g, ""),
      email: String(b.email || "").trim().toLowerCase(), instagram: String(b.instagram || "").replace(/^@/, "").trim(),
      website: String(b.website || "").trim(), wants_artists: 1, notes: String(b.bio || "").slice(0, 400),
    };
    const r = await upsertLead(db, lead, { createdBy: "claim" });
    await notify(c.env, leadMessage(r.lead, r.created ? "new artist claim" : "artist re-claim (updated)"), "claim");
    return json({ ok: true, created: r.created, lead_id: r.lead.id }, r.created ? 201 : 200);
  });
}

// Human-approved (or cron-auto) outreach. No email/SMS provider is wired, so
// "sending" records the outreach + pings the operator on Telegram; a real
// provider adapter can slot in here later without touching callers.
export async function contactLead(db, env, lead, actor) {
  if (!hasContact(lead)) {
    await logEvent(db, lead.id, "skipped", "No contact channel to reach", actor);
    return { sent: false, reason: "no_contact" };
  }
  const mail = await sendOutreachEmail(env, lead, actor);
  const channel = mail.sent ? "email" : "telegram";
  await db.prepare("UPDATE leads SET status = 'contacted', updated_at = datetime('now') WHERE id = ?").bind(lead.id).run();
  await logEvent(db, lead.id, "contacted", `Outreach sent (${actor}) via ${channel}${mail.error ? ` — ${mail.error}` : ""}`, actor);
  await notify(env, leadMessage(lead, `outreach sent (${actor}) via ${channel}`), "outreach");
  return { sent: true, channel, mail };
}

// The daily automation: refresh from Places, verify stale leads, run outreach
// per the configured mode, nudge on matches, and send a Telegram digest.
export async function runLeadCron(env, { trigger = "cron", digest = true } = {}) {
  await ensureLeadsSchema(env);
  const db = env.DB;
  const summary = {
    trigger, new_leads: 0, verified: 0, invalid: 0, matches: 0, outreach: 0, notified: 0, match_pairs: [],
    places_new: 0, places_updated: 0, places_key: !!env.GOOGLE_PLACES_API_KEY, top: [], expired: 0, removed: 0,
  };
  const runRow = await db.prepare("INSERT INTO lead_runs (trigger) VALUES (?)").bind(trigger).run();
  const runId = Number(runRow?.meta?.last_rowid || 0) || null;
  try {
    // 1) Places refresh (only when a key + cities are configured)
    if (env.GOOGLE_PLACES_API_KEY) {
      const cities = String(await getSetting(db, "sync_cities", "Pune,Mumbai,Jaipur")).split(",").map((s) => s.trim()).filter(Boolean);
      const cats = String(await getSetting(db, "sync_categories", "cafe,night club,restaurant")).split(",").map((s) => s.trim()).filter(Boolean);
      for (const city of cities.slice(0, 4)) {
        for (const cat of cats.slice(0, 4)) {
          try {
            const data = await placesSearchAll({ text: `${cat} in ${city}`, key: env.GOOGLE_PLACES_API_KEY });
            for (const place of data.places || []) {
              const r = await upsertLead(db, mapPlace(place, city, cat), { createdBy: "cron" });
              r.created ? summary.places_new++ : summary.places_updated++;
            }
          } catch { /* one bad query must not abort the run */ }
        }
      }
    }
    // 2) verify stale / unverified leads (bounded batch)
    const stale = (await db.prepare(`SELECT * FROM leads
        WHERE (last_checked_at IS NULL OR last_checked_at < datetime('now', '-${VERIFIED_TTL_DAYS} days')) AND verification != 'invalid'
        ORDER BY last_checked_at IS NULL DESC LIMIT 20`).all()).results ?? [];
    const newlyVerified = [];
    await mapPool(stale, 4, async (lead) => {
      const result = await verifyLead(lead, { fetchImpl: fetch, dohFetch: fetch });
      await db.prepare("UPDATE leads SET verification = ?, verify_detail = ?, last_checked_at = datetime('now') WHERE id = ?")
        .bind(result.verification, JSON.stringify(result.detail), lead.id).run();
      if (result.verification === "verified") { summary.verified++; newlyVerified.push(lead); }
      else if (result.verification === "invalid") summary.invalid++;
    });
    // digest payload: leads added in the last 24h
    summary.new_leads = Number((await db.prepare("SELECT COUNT(*) n FROM leads WHERE created_at >= datetime('now', '-1 day')").first())?.n ?? 0);
    summary.top = (await db.prepare("SELECT * FROM leads WHERE created_at >= datetime('now', '-1 day') ORDER BY (verification = 'verified') DESC, rating DESC LIMIT 5").all()).results ?? [];
    // 3) outreach by mode
    const mode = await getSetting(db, "outreach_mode", "manual");
    if (mode === "auto") {
      const targets = (await db.prepare("SELECT * FROM leads WHERE verification = 'verified' AND wants_artists = 1 AND status = 'new' AND kind IN ('venue','client') ORDER BY rating DESC LIMIT 5").all()).results ?? [];
      for (const lead of targets) { const sent = await contactLead(db, env, lead, "cron-auto"); if (sent.sent) summary.outreach++; }
    } else if (newlyVerified.length) {
      for (const lead of newlyVerified.slice(0, 3)) await notify(env, leadMessage(lead, "newly verified — approve to contact"), "verified");
    }
    // 4) auto-match open venue/client leads to artists (city + category affinity)
    const openLeads = (await db.prepare("SELECT * FROM leads WHERE wants_artists = 1 AND kind IN ('venue','client') AND verification != 'invalid' ORDER BY (verification = 'verified') DESC, updated_at DESC LIMIT 25").all()).results ?? [];
    let roster = [];
    try { roster = (await db.prepare("SELECT * FROM artist_profiles").all()).results ?? []; } catch { roster = []; }
    const pairs = [];
    for (const lead of openLeads.slice(0, 10)) {
      const best = roster
        .map((a) => ({ artist: a, ...matchScore(lead, a) }))
        .filter((m) => m.score >= 40)
        .sort((x, y) => y.score - x.score)
        .slice(0, 3);
      if (best.length) {
        pairs.push({ lead, names: best.map((b) => b.artist.stage_name) });
        await logEvent(db, lead.id, "matched", `Matches ${best.length} artists: ${best.map((b) => b.artist.stage_name).join(", ")}`, "cron");
      }
    }
    summary.matches = pairs.length;
    summary.match_pairs = pairs.slice(0, 4);
    // 5) retention: retire leads that keep failing, then purge very old ones.
    //    Contacted leads are never auto-retired (a reply may still land).
    const expired = await db.prepare(`UPDATE leads SET status='expired', updated_at=datetime('now')
        WHERE verification='invalid' AND status NOT IN ('contacted','expired')
        AND updated_at < datetime('now','-14 day')`).run();
    const removed = await db.prepare(`DELETE FROM leads WHERE status='expired' AND verification='invalid'
        AND updated_at < datetime('now','-180 day')`).run();
    summary.expired = expired.meta?.changes || 0;
    summary.removed = removed.meta?.changes || 0;
    // 6) digest
    if (digest) {
      const sent = await notify(env, digestMessage(summary), "digest");
      if (sent.sent) summary.notified = 1;
    }
    if (runId) await db.prepare("UPDATE lead_runs SET places_new=?, places_updated=?, verified=?, invalid=?, matches=?, outreach=?, notified=?, ok=1, finished_at=datetime('now') WHERE id=?")
      .bind(summary.places_new, summary.places_updated, summary.verified, summary.invalid, summary.matches, summary.outreach, summary.notified, runId).run();
  } catch (e) {
    summary.error = String(e && e.message ? e.message : e);
    if (runId) await db.prepare("UPDATE lead_runs SET ok=0, error=?, finished_at=datetime('now') WHERE id=?").bind(summary.error.slice(0, 300), runId).run();
  }
  return summary;
}
