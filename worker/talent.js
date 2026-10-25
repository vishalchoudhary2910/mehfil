// Talent Radar — the daily artist-discovery engine.
//
// What it does (compliantly):
//   1. Pulls *public* artist metadata from sources that permit it:
//      MusicBrainz (open, no key), YouTube Data API (key), venue/collective
//      iCal feeds (performers named on public event pages), CSV imports the
//      operator owns, and self-registrations.
//   2. Stores them as unclaimed directory entries with attribution + links.
//   3. Lets the artist claim the entry in one click, which creates their
//      Mehfil profile with no packages required (quote-per-gig freelancing).
//   4. Refreshes `last_seen_at` daily; stale entries are archived and bad
//      ones removed, so the directory stays clean without manual work.
//
// It deliberately does NOT scrape private phone numbers/emails. Contact data
// is only stored when the artist or the operator supplied it.

import {
  CATEGORY_KEYS,
  PUBLIC_CATEGORY_KEYS,
  inferCategoryFromTags,
  inferCity,
  normalizeCategory,
  categoryLabel,
} from "../shared/categories.js";
import { parseCsv } from "./leadsource.js";
import { ensureLeadsSchema, upsertLead } from "./leads.js";
import { mapWikiPage, wikiRefreshPages, wikiSearchPeople, WIKI_CATEGORY_KEYS } from "./wikisource.js";
import { notify } from "./notify.js";
import { resolveUser, isWorkspaceOwner } from "./util.js";
import { isSameOriginRequest } from "@freebuff/auth";

const uid = (p) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export const talentKey = (t) =>
  t.external_id ? `x:${t.source || "src"}:${t.external_id}` : `n:${slugify(t.name)}|${slugify(t.city)}`;

// Cross-source identity: "Dream Note (Indian band)" and "Dream Note" are the
// same act. Strip a trailing disambiguator and compare the remaining name, but
// keep Unicode letters so Hindi/Urdu stage names do not collapse to "unknown".
export function nameKey(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const jsonOr = (value, fallback) => {
  try {
    const parsed = JSON.parse(value ?? "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

// Public shape of a directory profile. Contact details are deliberately never
// returned here: an unclaimed profile must not leak an email or phone number,
// and hosts reach artists through the platform until the artist replies or
// claims the profile.
export const shapeTalent = (t) => {
  const { email, phone, ...rest } = t || {};
  return {
    ...rest,
    links: jsonOr(rest.links, {}),
    genres: jsonOr(rest.genres, []),
    languages: jsonOr(rest.languages, []),
    open_to_work: !!rest.open_to_work,
    has_contact: !!(email || phone),
  };
};

const parseList = (v) =>
  (Array.isArray(v) ? v : String(v || "").split(/[,;/|]/))
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 8);

export function normalizeLinks(links = {}) {
  const out = {};
  for (const k of ["instagram", "youtube", "website", "spotify", "facebook", "soundcloud", "portfolio", "url"]) {
    const v = String(links[k] || "").trim();
    if (!v) continue;
    if (k === "instagram") out.instagram = v.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "");
    else out[k] = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  }
  return out;
}

const DDL = `
CREATE TABLE IF NOT EXISTS talent_directory (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  genres TEXT NOT NULL DEFAULT '[]',
  languages TEXT NOT NULL DEFAULT '[]',
  city TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '{}',
  image_url TEXT NOT NULL DEFAULT '',
  followers INTEGER NOT NULL DEFAULT 0,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT NOT NULL DEFAULT '',
  external_id TEXT,
  dedupe_key TEXT NOT NULL DEFAULT '',
  match_key TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT 'unverified',
  open_to_work INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  claimed_by TEXT,
  claimed_artist_id TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_talent_dedupe ON talent_directory(dedupe_key) WHERE dedupe_key != '';
CREATE INDEX IF NOT EXISTS idx_talent_city ON talent_directory(city);
CREATE INDEX IF NOT EXISTS idx_talent_cat ON talent_directory(category);
CREATE INDEX IF NOT EXISTS idx_talent_status ON talent_directory(status);
CREATE INDEX IF NOT EXISTS idx_talent_seen ON talent_directory(last_seen_at);

CREATE TABLE IF NOT EXISTS talent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL DEFAULT 'cron',
  queries INTEGER DEFAULT 0,
  fetched INTEGER DEFAULT 0,
  created INTEGER DEFAULT 0,
  refreshed INTEGER DEFAULT 0,
  stale INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  removed INTEGER DEFAULT 0,
  sources TEXT NOT NULL DEFAULT '{}',
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS talent_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const READY_DBS = new WeakSet();

const PROFILE_COLUMNS = [
  ["area", "TEXT NOT NULL DEFAULT ''"],
  ["available_now", "INTEGER NOT NULL DEFAULT 1"],
  ["accepting_requests", "INTEGER NOT NULL DEFAULT 1"],
  ["directory_id", "TEXT"],
  ["portfolio_url", "TEXT"],
  // Profile v2 (editorial): presentation + portfolio fields.
  ["tagline", "TEXT NOT NULL DEFAULT ''"],
  ["layout_variant", "TEXT NOT NULL DEFAULT 'editorial'"],
  ["website", "TEXT"],
  ["portfolio_items", "TEXT NOT NULL DEFAULT '[]'"],
  ["rider_note", "TEXT NOT NULL DEFAULT ''"],
  ["press_note", "TEXT NOT NULL DEFAULT ''"],
  ["accent_hue", "INTEGER NOT NULL DEFAULT 0"],
];

// Directory columns added after the first release. D1 has no
// "ADD COLUMN IF NOT EXISTS", so the ALTER is attempted once per isolate.
const DIRECTORY_COLUMNS = [
  ["open_to_work", "INTEGER NOT NULL DEFAULT 0"],
  ["match_key", "TEXT NOT NULL DEFAULT ''"],
];

// Adds the marketplace-profile columns once. Returns false when artist_profiles
// does not exist yet (fresh database) so the caller can retry next request.
export async function ensureArtistColumns(db) {
  const info = await db.prepare("PRAGMA table_info(artist_profiles)").all().catch(() => null);
  const cols = new Set((info?.results ?? []).map((c) => c.name));
  if (!cols.size) return false;
  for (const [name, decl] of PROFILE_COLUMNS) {
    if (!cols.has(name)) await addColumn(db, "artist_profiles", name, decl);
  }
  return true;
}

export async function ensureTalentSchema(env) {
  if (READY_DBS.has(env.DB)) return;
  for (const stmt of DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await env.DB.prepare(stmt).run();
  }
  for (const [name, decl] of DIRECTORY_COLUMNS) {
    await addColumn(env.DB, "talent_directory", name, decl);
  }
  // Create this index only after the migration above has added match_key;
  // indexing a missing column would abort boot on older databases.
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_talent_match ON talent_directory(match_key)").run().catch(() => {});
  await backfillTalentMatchKeys(env.DB);
  if (await ensureArtistColumns(env.DB)) READY_DBS.add(env.DB);
}

// Older rows predate cross-source matching. Fill their identity key once so
// the dedupe pass can see that a MusicBrainz and a Wikipedia row are one act.
async function backfillTalentMatchKeys(db) {
  const rows = await db
    .prepare("SELECT id, name FROM talent_directory WHERE match_key = '' LIMIT 500")
    .all()
    .catch(() => null);
  for (const row of rows?.results ?? []) {
    await db
      .prepare("UPDATE talent_directory SET match_key = ? WHERE id = ?")
      .bind(nameKey(row.name) || row.id, row.id)
      .run();
  }
}

// D1 has no "ADD COLUMN IF NOT EXISTS"; a duplicate-column error is expected
// when an un-cached boot races another one.
export async function addColumn(db, table, column, decl) {
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`).run();
  } catch {
    /* already exists */
  }
}

const getSetting = async (db, key, fallback = null) => {
  const r = await db.prepare("SELECT value FROM talent_settings WHERE key = ?").bind(key).first();
  return r ? r.value : fallback;
};
const setSetting = async (db, key, value) => {
  await db
    .prepare("INSERT INTO talent_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, String(value))
    .run();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------- sources ----

const MB_BASE = "https://musicbrainz.org/ws/2";
const MB_UA = "MehfilTalentRadar/1.0 ( https://mehfil.app )";

// MusicBrainz rate-limits hard and occasionally answers 503. Retry those and
// transient network errors with a short backoff, but never retry a 4xx.
async function mbGet(url, { fetchImpl = fetch, tries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetchImpl(url, { headers: { "User-Agent": MB_UA, Accept: "application/json" } });
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) { await sleep(1200 * (i + 1)); continue; }
      throw e;
    }
    if (res.ok) return res.json();
    lastErr = new Error(`MusicBrainz ${res.status}`);
    if ((res.status === 429 || res.status === 503) && i < tries - 1) {
      await sleep(1500 * (i + 1));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

// MusicBrainz text search for artists whose area matches a city. `tag` narrows
// it when the tag exists; an empty result falls back to the city alone.
export async function mbSearchArtists({ city, tag, limit = 20, fetchImpl = fetch }) {
  const run = async (q) => {
    const url = `${MB_BASE}/artist?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
    const data = await mbGet(url, { fetchImpl });
    return data.artists || [];
  };
  const q = `area:"${city}"` + (tag ? ` AND tag:"${tag}"` : "");
  const withTag = await run(q);
  if (withTag.length || !tag) return { artists: withTag, matched: !!tag && withTag.length > 0 };
  const fallback = await run(`area:"${city}"`);
  // The artists are still real and still from the city — only the genre
  // match is unproven, so the caller must not assume the requested category.
  return { artists: fallback, matched: false };
}

// URLs/relations for one artist. MusicBrainz asks for <= 1 request/second.
export async function mbArtistDetail(mbid, { fetchImpl = fetch } = {}) {
  return mbGet(`${MB_BASE}/artist/${mbid}?inc=url-rels+tags&fmt=json`, { fetchImpl });
}

export function linksFromMbRelations(relations = []) {
  const links = {};
  for (const rel of relations) {
    const u = rel?.url?.resource;
    if (!u) continue;
    if (/instagram\.com/i.test(u)) links.instagram = u;
    else if (/youtube\.com|youtu\.be/i.test(u)) links.youtube = u;
    else if (/facebook\.com/i.test(u)) links.facebook = u;
    else if (/spotify\.com/i.test(u)) links.spotify = u;
    else if (/soundcloud\.com/i.test(u)) links.soundcloud = u;
    else if (rel.type === "official homepage" && !links.website) links.website = u;
  }
  return normalizeLinks(links);
}

// Catalogue tags carry a lot of noise ("asian", "female") that is not a genre.
const TAG_NOISE = new Set(["asian", "female", "male", "seen live", "favorite", "favourite", "awesome", "love"]);
const genreTags = (tags) =>
  [...new Set(tags.map((t) => String(t).toLowerCase()).filter((t) => t && !TAG_NOISE.has(t)))]
    .filter((t) => t !== "indian")
    .slice(0, 8);

// Map one MusicBrainz artist (+ optional detail) into a directory entry.
export function mapMbArtist(mb, { city, detail, hintCategory = "" } = {}) {
  const tags = (detail?.tags || mb.tags || []).map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean);
  // The catalogue's own one-line description ("Indian guitarist", "lo-fi
  // beatmaker") is as strong a signal as a tag, and is often the only one.
  const desc = String(mb.disambiguation || "").trim();
  let category = inferCategoryFromTags([...tags, ...(desc ? [desc] : [])], mb.name, mb.type);
  // The search tag only stands in when the catalogue has no genre tags at all,
  // and only when MusicBrainz actually matched that tag (never on a city fallback).
  if (category === "other" && hintCategory) category = normalizeCategory(hintCategory);
  const begin = Number(String(mb["life-span"]?.begin || "").slice(0, 4)) || null;
  const where = mb.area?.name || city || "";
  const label = categoryLabel(category).split(" / ")[0];
  const bits = [desc || (where ? `${label} from ${where}` : label)];
  if (where && desc && !desc.toLowerCase().includes(where.toLowerCase())) bits.push(`based in ${where}`);
  // life-span.begin is a birth year for people and a formation year for groups.
  if (begin) bits.push(mb.type === "Group" ? `formed ${begin}` : `born ${begin}`);
  const links = linksFromMbRelations(detail?.relations || []);
  return {
    name: mb.name,
    category,
    city: city || where,
    area: mb.area?.name && mb.area.name !== city ? mb.area.name : "",
    genres: genreTags(tags),
    languages: [],
    bio: bits.join(", ").replace(/^./, (c) => c.toUpperCase()) + ".",
    links,
    source: "musicbrainz",
    source_url: `https://musicbrainz.org/artist/${mb.id}`,
    external_id: mb.id,
    verification: Object.keys(links).length ? "verified" : "listed",
    followers: 0,
  };
}

// YouTube channel search — real public channels for a city/category query.
export async function ytSearchChannels({ q, key, limit = 8, fetchImpl = fetch }) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=${Math.min(limit, 25)}&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`YouTube ${res.status}`);
  return (await res.json()).items || [];
}

export async function ytChannelStats(ids, { key, fetchImpl = fetch }) {
  if (!ids.length) return {};
  const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${ids.join(",")}&key=${encodeURIComponent(key)}`;
  const res = await fetchImpl(url);
  if (!res.ok) return {};
  const items = (await res.json()).items || [];
  return Object.fromEntries(items.map((i) => [i.id, Number(i.statistics?.subscriberCount) || 0]));
}

export function mapYtChannel(item, { city, category, followers = 0 } = {}) {
  const sn = item.snippet || {};
  const id = item.id?.channelId || item.id;
  return {
    name: sn.title || "",
    category: normalizeCategory(category, sn.title || ""),
    city: inferCity(`${sn.title} ${sn.description}`, city || ""),
    genres: [],
    bio: String(sn.description || "").replace(/\s+/g, " ").slice(0, 300),
    links: { youtube: `https://www.youtube.com/channel/${id}` },
    image_url: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || "",
    followers,
    source: "youtube",
    source_url: `https://www.youtube.com/channel/${id}`,
    external_id: id,
    verification: "verified",
  };
}

// Pull performer names out of a public event listing. Conservative: only
// explicit "with / ft. / lineup" segments, never guessed from prose.
const GENERIC_NAME =
  /^(tba|tbc|various( artists)?|open mic( night)?|open signup|lineup|djs?|live music|special guests?|all welcome|guest|entry|free entry|sold out|tickets?)$/i;

export function extractPerformers(text, { max = 6 } = {}) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  const m = s.match(/(?:ft\.?|feat\.?|with|lineup:?|performed by|live:?|presenting)\s+(.{3,160})/i);
  const raw = m ? m[1] : s;
  const out = [];
  for (let part of raw.split(/[,;|•·]|\s+\/\s+|\s+&\s+|\s+and\s+|\s+plus\s+|\s+x\s+/i)) {
    const p = part
      .replace(/^(and|with|ft\.?|feat\.?)\s+/i, "")
      .replace(/\s*[-–—]\s*.*$/, "")
      .replace(/\s*\(.*?\)\s*/g, " ")
      .trim();
    if (p.length < 3 || p.length > 60) continue;
    if (!/[a-z]/i.test(p) || GENERIC_NAME.test(p) || /^\d/.test(p)) continue;
    out.push(p);
  }
  return [...new Set(out)].slice(0, max);
}

export function talentFromShow(show) {
  const text = `${show.title || ""}. ${show.performers || ""}. ${show.description || ""}`;
  const names = extractPerformers(show.performers || show.title || "", { max: 3 });
  const category = normalizeCategory(text, show.title || "");
  return names.map((name) => ({
    name,
    category,
    city: show.city || "",
    area: show.area || "",
    bio: `Seen on a public listing: ${show.title}${show.venue ? ` at ${show.venue}` : ""}, ${show.city || ""}.`,
    links: show.url ? { url: show.url } : {},
    source: "events",
    source_url: show.url || "",
    verification: "listed",
  }));
}

const pick = (row, keys) => {
  for (const k of keys) if (row[k]) return row[k];
  for (const hk of Object.keys(row)) {
    if (keys.some((k) => hk.includes(k)) && row[hk]) return row[hk];
  }
  return "";
};

export function talentFromRow(row, source = "csv") {
  const name = pick(row, ["stage_name", "artist", "name", "act", "performer", "channel"]);
  return {
    name: String(name || "").trim(),
    category: normalizeCategory(pick(row, ["category", "type", "genre", "art"])),
    city: String(pick(row, ["city", "location", "based_in"]) || "").trim(),
    area: String(pick(row, ["area", "locality", "neighbourhood", "neighborhood"]) || "").trim(),
    genres: String(pick(row, ["genres", "style", "sub_skills"]) || "")
      .split(/[,;/|]/).map((s) => s.trim()).filter(Boolean).slice(0, 8),
    bio: String(pick(row, ["bio", "about", "description", "notes"]) || "").slice(0, 500),
    links: normalizeLinks({
      instagram: pick(row, ["instagram", "ig", "insta", "handle"]),
      youtube: pick(row, ["youtube", "channel"]),
      website: pick(row, ["website", "portfolio", "url", "site", "link"]),
      spotify: pick(row, ["spotify"]),
    }),
    email: String(pick(row, ["email", "mail"]) || "").trim().toLowerCase(),
    phone: String(pick(row, ["phone", "mobile", "whatsapp"]) || "").replace(/\D/g, ""),
    source,
    verification: "listed",
  };
}

// --------------------------------------------------------------- storage ----

export async function upsertTalent(db, t, { source } = {}) {
  const name = String(t.name || "").trim().slice(0, 160);
  if (!name) return { created: false, skipped: true };
  const category = normalizeCategory(t.category, name);
  const city = String(t.city || "").trim().slice(0, 80);
  const src = t.source || source || "manual";
  const external_id = t.external_id ? String(t.external_id) : null;
  const key = talentKey({ name, city, source: src, external_id });
  const mk = nameKey(name) || key;
  const links = normalizeLinks(t.links || {});
  let existing = await db
    .prepare("SELECT * FROM talent_directory WHERE dedupe_key = ? OR (external_id IS NOT NULL AND external_id = ?) LIMIT 1")
    .bind(key, external_id || "")
    .first();

  // Same act from a different source (MusicBrainz vs Wikipedia vs a local
  // self-registration). Match on the disambiguator-free name and only when the
  // location is compatible, so two same-named acts in different cities stay
  // separate.
  if (!existing) {
    const sql = ["SELECT * FROM talent_directory WHERE match_key = ? AND claimed_by IS NULL AND claimed_artist_id IS NULL"];
    const args = [mk];
    if (city) {
      sql.push("AND (city = '' OR city = 'India' OR lower(city) = lower(?))");
      args.push(city);
    } else {
      sql.push("AND city = ''");
    }
    sql.push("ORDER BY CASE source WHEN 'claim' THEN 0 WHEN 'wikipedia' THEN 1 WHEN 'musicbrainz' THEN 2 ELSE 3 END, updated_at DESC LIMIT 1");
    existing = await db.prepare(sql.join(" ")).bind(...args).first();
  }

  if (existing) {
    if (existing.status === "claimed") {
      await db.prepare("UPDATE talent_directory SET last_seen_at = datetime('now') WHERE id = ?").bind(existing.id).run();
      return { created: false, claimed: true, talent: existing };
    }
    const mergedLinks = { ...(JSON.parse(existing.links || "{}") || {}), ...links };
    // A catalogue re-read is authoritative: if it no longer supports a
    // category, "other" is the honest answer. Imports stay conservative and
    // never wipe a category they don't know about.
    const nextCategory = category === "other" && src !== "musicbrainz" ? existing.category : category;
    const nextVerification = ["verified", "self"].includes(String(t.verification || ""))
      ? String(t.verification)
      : existing.verification;
    await db
      .prepare(`UPDATE talent_directory SET
        category = ?,
        match_key = ?,
        city = CASE WHEN ? != '' THEN ? ELSE city END,
        area = CASE WHEN ? != '' THEN ? ELSE area END,
        bio = CASE WHEN ? != '' THEN ? ELSE bio END,
        genres = CASE WHEN ? != '[]' THEN ? ELSE genres END,
        languages = CASE WHEN ? != '[]' THEN ? ELSE languages END,
        links = ?, image_url = CASE WHEN ? != '' THEN ? ELSE image_url END,
        followers = MAX(followers, ?),
        open_to_work = MAX(open_to_work, ?),
        email = CASE WHEN ? != '' THEN ? ELSE email END,
        phone = CASE WHEN ? != '' THEN ? ELSE phone END,
        source_url = CASE WHEN source = ? AND ? != '' THEN ? ELSE source_url END,
        verification = ?,
        status = 'active', last_seen_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`)
      .bind(
        nextCategory, mk,
        city, city, String(t.area || ""), String(t.area || ""),
        String(t.bio || ""), String(t.bio || ""),
        JSON.stringify(t.genres || []), JSON.stringify(t.genres || []),
        JSON.stringify(t.languages || []), JSON.stringify(t.languages || []),
        JSON.stringify(mergedLinks), String(t.image_url || ""), String(t.image_url || ""),
        Number(t.followers) || 0, t.open_to_work ? 1 : 0,
        String(t.email || ""), String(t.email || ""), String(t.phone || ""), String(t.phone || ""),
        src, String(t.source_url || ""), String(t.source_url || ""),
        nextVerification, existing.id
      )
      .run();
    const fresh = await db.prepare("SELECT * FROM talent_directory WHERE id = ?").bind(existing.id).first();
    return { created: false, claimed: false, talent: fresh };
  }

  let slug = slugify(name) || "artist";
  const clash = await db.prepare("SELECT 1 FROM talent_directory WHERE slug = ?").bind(slug).first();
  if (clash) slug = `${slug}-${crypto.randomUUID().slice(0, 4)}`;
  const id = uid("td");
  await db
    .prepare(`INSERT INTO talent_directory (id, slug, name, category, genres, languages, city, area, bio, links,
        image_url, followers, email, phone, source, source_url, external_id, dedupe_key, match_key, verification, open_to_work)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      id, slug, name, category, JSON.stringify(t.genres || []), JSON.stringify(t.languages || []),
      city, String(t.area || ""), String(t.bio || ""), JSON.stringify(links),
      String(t.image_url || ""), Number(t.followers) || 0, String(t.email || ""), String(t.phone || ""),
      src, String(t.source_url || ""), external_id, key, mk, t.verification || "unverified",
      t.open_to_work ? 1 : 0
    )
    .run();
  const fresh = await db.prepare("SELECT * FROM talent_directory WHERE id = ?").bind(id).first();
  return { created: true, claimed: false, talent: fresh };
}

// Sources can disagree about spelling ("Dream Note" vs "Dream Note (Indian
// band)") but still describe one act. Keep the richest row, merge its facts and
// archive the duplicate instead of deleting it, so old links never 404.
export async function dedupeTalent(db) {
  const rows = (
    await db
      .prepare(`SELECT * FROM talent_directory
        WHERE status IN ('active','stale') AND claimed_by IS NULL AND claimed_artist_id IS NULL
        ORDER BY updated_at DESC LIMIT 1000`)
      .all()
  ).results ?? [];
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.match_key || nameKey(row.name)}|${String(row.city || "").trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const sourceRank = { claim: 6, wikipedia: 5, musicbrainz: 4, events: 3, csv: 2, manual: 1 };
  const richness = (row) =>
    (sourceRank[row.source] || 0) * 10 +
    (row.bio ? 2 : 0) +
    (row.image_url ? 2 : 0) +
    (Object.keys(jsonOr(row.links, {})).length ? 1 : 0) +
    (row.open_to_work ? 1 : 0) +
    (row.email || row.phone ? 1 : 0);

  let archived = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => richness(b) - richness(a) || String(a.created_at).localeCompare(String(b.created_at)));
    const keeper = sorted[0];
    const links = jsonOr(keeper.links, {});
    const genres = new Set(jsonOr(keeper.genres, []));
    const languages = new Set(jsonOr(keeper.languages, []));
    let bio = keeper.bio || "";
    let image = keeper.image_url || "";
    let open = Number(keeper.open_to_work) || 0;
    let followers = Number(keeper.followers) || 0;
    let email = keeper.email || "";
    let phone = keeper.phone || "";

    for (const other of sorted.slice(1)) {
      Object.assign(links, jsonOr(other.links, {}));
      for (const g of jsonOr(other.genres, [])) genres.add(g);
      for (const l of jsonOr(other.languages, [])) languages.add(l);
      if (String(other.bio || "").length > bio.length) bio = other.bio;
      if (!image && other.image_url) image = other.image_url;
      open = Math.max(open, Number(other.open_to_work) || 0);
      followers = Math.max(followers, Number(other.followers) || 0);
      if (!email && other.email) email = other.email;
      if (!phone && other.phone) phone = other.phone;
      await db
        .prepare("UPDATE talent_directory SET status='archived', updated_at=datetime('now') WHERE id=?")
        .bind(other.id)
        .run();
      archived++;
    }

    await db
      .prepare(`UPDATE talent_directory SET match_key=?, links=?, genres=?, languages=?, bio=?,
        image_url=?, open_to_work=?, followers=?, email=?, phone=?, updated_at=datetime('now')
        WHERE id=?`)
      .bind(
        nameKey(keeper.name) || keeper.match_key || keeper.id,
        JSON.stringify(links), JSON.stringify([...genres]), JSON.stringify([...languages]),
        bio, image, open, followers, email, phone, keeper.id
      )
      .run();
  }
  return archived;
}

// ------------------------------------------------------------ radar run -----

const MB_TAGS = {
  singer: "singer",
  band: "band",
  poet: "poetry",
  comedian: "comedy",
  dancer: "dance",
  dj: "dj",
  instrumentalist: "instrumental",
  rapper: "hip hop",
  storyteller: "spoken word",
};

export async function runTalentRadar(env, opts = {}) {
  await ensureTalentSchema(env);
  const {
    fetchImpl = fetch,
    trigger = "cron",
    maxQueries = 3,
    detailLimit = 3,
    detailDelayMs = 1100,
    wiki = true,
    wikiRefreshLimit = 20,
    silent = false,
  } = opts;
  const db = env.DB;
  const summary = {
    trigger, queries: 0, fetched: 0, created: 0, refreshed: 0,
    stale: 0, archived: 0, removed: 0, sources: {}, ok: true, pairs: [],
  };
  if (wiki) summary.wiki = true;
  const runRow = await db.prepare("INSERT INTO talent_runs (trigger) VALUES (?)").bind(trigger).run();
  const runId = Number(runRow?.meta?.last_rowid || 0) || null;

  try {
    const cities = String(opts.cities || (await getSetting(db, "radar_cities", "Pune,Mumbai,Jaipur,Delhi,Bengaluru,Hyderabad")))
      .split(",").map((s) => s.trim()).filter(Boolean);
    const cats = String(opts.categories || (await getSetting(db, "radar_categories", "poet,comedian,singer,rapper,band,dj,dancer,anchor,instrumentalist")))
      .split(",").map((s) => s.trim()).filter((c) => CATEGORY_KEYS.includes(c));
    const useCats = cats.length ? cats : ["poet", "comedian", "singer", "rapper"];
    const ci = Number(await getSetting(db, "radar_city_i", "0")) || 0;
    const ki = Number(await getSetting(db, "radar_cat_i", "0")) || 0;

    const pairs = [];
    for (let i = 0; i < Math.max(1, maxQueries); i++) {
      pairs.push({ city: cities[(ci + i) % cities.length], category: useCats[(ki + i) % useCats.length] });
    }
    summary.pairs = pairs;

    // 1) MusicBrainz — real, open, keyless.
    for (const { city, category } of pairs) {
      summary.queries++;
      try {
        const found = await mbSearchArtists({ city, tag: MB_TAGS[category], fetchImpl });
        const artists = found.artists;
        summary.fetched += artists.length;
        const picked = artists.slice(0, detailLimit);
        for (let i = 0; i < picked.length; i++) {
          const mb = picked[i];
          let detail = null;
          try {
            detail = await mbArtistDetail(mb.id, { fetchImpl });
          } catch {
            detail = null;
          }
          const mapped = mapMbArtist(mb, { city, detail, hintCategory: found.matched ? category : "" });
          const r = await upsertTalent(db, mapped, { source: "musicbrainz" });
          r.created ? summary.created++ : summary.refreshed++;
          if (detailDelayMs && i < picked.length - 1) await sleep(detailDelayMs);
        }
        summary.sources.musicbrainz = (summary.sources.musicbrainz || 0) + 1;
      } catch (e) {
        summary.sources.musicbrainz_error = String(e?.message || e).slice(0, 120);
      }
    }
    await setSetting(db, "radar_city_i", (ci + pairs.length) % Math.max(1, cities.length));
    await setSetting(db, "radar_cat_i", (ki + pairs.length) % Math.max(1, useCats.length));

    // 2) Wikipedia — the only open source with real poets, shayars, comics
    // and anchors (MusicBrainz is music-only). Every profile keeps its
    // article link as attribution; intros are refreshed daily below.
    if (wiki) {
      let wikiRows = 0;
      for (const { city, category } of pairs) {
        try {
          const found = await wikiSearchPeople({ city, category, limit: 8, fetchImpl });
          if (found.matched) summary.sources.wikipedia = (summary.sources.wikipedia || 0) + 1;
          for (const page of found.pages) {
            const mapped = mapWikiPage(page, { city, cityFromCategory: found.cityFromCategory, category, matchedCategory: found.matchedCategory });
            if (!mapped) continue;
            summary.fetched++;
            const r = await upsertTalent(db, mapped, { source: "wikipedia" });
            r.created ? summary.created++ : summary.refreshed++;
            wikiRows++;
          }
        } catch (e) {
          summary.sources.wikipedia_error = String(e?.message || e).slice(0, 120);
        }
      }
      summary.sources.wikipedia_pages = wikiRows;
    }

    // 2b) YouTube — real public channels, only when a key is configured.
    if (env.YOUTUBE_API_KEY) {
      try {
        const { city, category } = pairs[0];
        const items = await ytSearchChannels({ q: `${categoryLabel(category)} ${city}`, key: env.YOUTUBE_API_KEY, fetchImpl });
        const ids = items.map((i) => i.id?.channelId).filter(Boolean);
        const stats = await ytChannelStats(ids, { key: env.YOUTUBE_API_KEY, fetchImpl });
        for (const item of items) {
          const mapped = mapYtChannel(item, { city, category, followers: stats[item.id?.channelId] || 0 });
          if (!mapped.name) continue;
          summary.fetched++;
          const r = await upsertTalent(db, mapped, { source: "youtube" });
          r.created ? summary.created++ : summary.refreshed++;
        }
        summary.sources.youtube = items.length;
      } catch (e) {
        summary.sources.youtube_error = String(e?.message || e).slice(0, 120);
      }
    }

    // 2c) Re-read a rotating batch of Wikipedia profiles so the copy, photo
    // and links stay current (and genuine profiles are not marked stale just
    // because their turn in the city rotation has not come up).
    if (wiki && Number(opts.wikiRefreshLimit ?? 20) > 0) {
      const limit = Math.max(0, Math.min(Number(opts.wikiRefreshLimit ?? 20) || 0, 20));
      const rows = (
        await db
          .prepare(`SELECT name, city, category FROM talent_directory
            WHERE source = 'wikipedia' AND status IN ('active','stale') AND claimed_by IS NULL
            ORDER BY updated_at ASC LIMIT ?`)
          .bind(limit)
          .all()
      ).results ?? [];
      if (rows.length) {
        try {
          const pages = await wikiRefreshPages(rows.map((r) => r.name), { fetchImpl });
          const byTitle = new Map(pages.map((p) => [p.title, p]));
          let refreshed = 0;
          for (const row of rows) {
            const page = byTitle.get(row.name);
            if (!page) continue;
            const mapped = mapWikiPage(page, { category: row.category });
            if (!mapped) {
              // The source now says this person is deceased, a list page, or
              // no longer matches the discipline. Retire the stale profile.
              await db.prepare("UPDATE talent_directory SET status='archived', updated_at=datetime('now') WHERE name = ? AND source = 'wikipedia' AND claimed_by IS NULL")
                .bind(row.name).run();
              summary.archived++;
              continue;
            }
            const r = await upsertTalent(db, mapped, { source: "wikipedia" });
            r.created ? summary.created++ : summary.refreshed++;
            refreshed++;
          }
          summary.sources.wiki_refreshed = refreshed;
        } catch (e) {
          summary.sources.wiki_refresh_error = String(e?.message || e).slice(0, 120);
        }
      }
    }

    // 3) Performer names from public event listings already ingested.
    try {
      const shows = (
        await db
          .prepare("SELECT * FROM shows WHERE date >= date('now','-14 day') AND source != 'manual' ORDER BY created_at DESC LIMIT 40")
          .all()
      ).results ?? [];
      let fromShows = 0;
      for (const show of shows) {
        for (const t of talentFromShow(show)) {
          const r = await upsertTalent(db, t, { source: "events" });
          if (r.created) summary.created++;
          else summary.refreshed++;
          fromShows++;
        }
      }
      summary.sources.events = fromShows;
    } catch {
      /* shows table may not have source columns yet */
    }

    // 3b) Keep existing entries honest: re-read a rotating batch of catalogue
    // entries so bios, links and categories don't rot between scans.
    const refreshLimit = Math.max(0, Math.min(Number(opts.refreshLimit ?? 4) || 0, 20));
    if (refreshLimit) {
      const staleBatch =
        (
          await db
            .prepare(`SELECT external_id, city FROM talent_directory
              WHERE source = 'musicbrainz' AND external_id IS NOT NULL AND claimed_by IS NULL
                AND status IN ('active','stale')
              ORDER BY updated_at ASC LIMIT ?`)
            .bind(refreshLimit)
            .all()
        ).results ?? [];
      let detailsRefreshed = 0;
      for (const row of staleBatch) {
        try {
          const detail = await mbArtistDetail(row.external_id, { fetchImpl });
          if (!detail?.name) continue;
          const mapped = mapMbArtist(detail, { city: row.city, detail });
          const r = await upsertTalent(db, mapped, { source: "musicbrainz" });
          r.created ? summary.created++ : summary.refreshed++;
          detailsRefreshed++;
          if (detailDelayMs) await sleep(detailDelayMs);
        } catch {
          /* one unreachable entry never stops the batch */
        }
      }
      summary.sources.details_refreshed = detailsRefreshed;
    }

    // 3c) Collapse cross-source duplicates so one act has one canonical row.
    try {
      summary.duplicates = await dedupeTalent(db);
      if (summary.duplicates) summary.archived += summary.duplicates;
    } catch (e) {
      summary.sources.dedupe_error = String(e?.message || e).slice(0, 120);
    }

    // 4) Lifecycle: stale → archived → removed. Claimed profiles are exempt.
    const stale = await db
      .prepare("UPDATE talent_directory SET status='stale', updated_at=datetime('now') WHERE status='active' AND claimed_by IS NULL AND last_seen_at < datetime('now','-45 day')")
      .run();
    const archived = await db
      .prepare("UPDATE talent_directory SET status='archived', updated_at=datetime('now') WHERE status IN ('active','stale') AND claimed_by IS NULL AND last_seen_at < datetime('now','-120 day')")
      .run();
    const removed = await db
      .prepare("DELETE FROM talent_directory WHERE status='archived' AND claimed_by IS NULL AND last_seen_at < datetime('now','-365 day')")
      .run();
    summary.stale = stale.meta?.changes || 0;
    summary.archived = (archived.meta?.changes || 0) + (summary.duplicates || 0);
    summary.removed = removed.meta?.changes || 0;

    if (runId) {
      await db
        .prepare("UPDATE talent_runs SET queries=?, fetched=?, created=?, refreshed=?, stale=?, archived=?, removed=?, sources=?, ok=1, finished_at=datetime('now') WHERE id=?")
        .bind(summary.queries, summary.fetched, summary.created, summary.refreshed, summary.stale, summary.archived, summary.removed, JSON.stringify(summary.sources), runId)
        .run();
    }
  } catch (e) {
    summary.ok = false;
    summary.error = String(e?.message || e);
    if (runId) {
      await db.prepare("UPDATE talent_runs SET ok=0, error=?, finished_at=datetime('now') WHERE id=?").bind(summary.error.slice(0, 300), runId).run();
    }
  }

  if (!silent) {
    const lines = [
      "<b>Mehfil Talent Radar</b>",
      `🔎 ${summary.queries} searches · ${summary.fetched} seen · 🆕 ${summary.created} new · ♻️ ${summary.refreshed} refreshed`,
      summary.stale || summary.archived || summary.removed
        ? `🧹 ${summary.stale} stale · ${summary.archived} archived · ${summary.removed} removed`
        : "🧹 nothing stale today",
    ];
    if (summary.pairs.length) lines.push(summary.pairs.map((p) => `${categoryLabel(p.category)} · ${p.city}`).join(" | "));
    await notify(env, lines.join("\n"), "talent-radar");
  }
  return summary;
}

// ----------------------------------------------------------------- claim -----

export async function claimTalent(db, me, slug) {
  const row = await db
    .prepare("SELECT * FROM talent_directory WHERE slug = ? OR id = ?")
    .bind(slug, slug)
    .first();
  if (!row) return { error: [404, "Profile not found"] };
  if (row.status === "archived") return { error: [410, "This listing was archived as stale"] };
  if (row.claimed_artist_id) {
    const existing = await db.prepare("SELECT slug FROM artist_profiles WHERE id = ?").bind(row.claimed_artist_id).first();
    return { error: [409, `Already claimed${existing ? ` — ${existing.slug}` : ""}`, existing?.slug] };
  }
  const links = jsonOr(row.links, {});
  const mine = await db.prepare("SELECT * FROM artist_profiles WHERE user_id = ?").bind(me.id).first();
  let artist;
  if (mine) {
    await db
      .prepare(`UPDATE artist_profiles SET
        instagram = COALESCE(NULLIF(instagram,''), ?),
        youtube = COALESCE(NULLIF(youtube,''), ?),
        directory_id = COALESCE(directory_id, ?)
        WHERE id = ?`)
      .bind(links.instagram || null, links.youtube || null, row.id, mine.id)
      .run();
    artist = mine;
  } else {
    let artistSlug = slugify(row.name) || "artist";
    const clash = await db.prepare("SELECT 1 FROM artist_profiles WHERE slug = ?").bind(artistSlug).first();
    if (clash) artistSlug = `${artistSlug}-${crypto.randomUUID().slice(0, 4)}`;
    const id = uid("a");
    const hue = 100 + (Math.abs([...row.name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)) % 260);
    await db
      .prepare(`INSERT INTO artist_profiles (id, user_id, slug, stage_name, category, sub_skills, city, area, languages, bio,
        experience_years, travel_radius_km, base_price_inr, cancellation_policy, hue, instagram, youtube, directory_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        id, me.id, artistSlug, row.name, row.category, row.genres || "[]", row.city, row.area || "",
        row.languages || "[]", row.bio || "", 1, 25, 0, "moderate", hue,
        links.instagram || null, links.youtube || null, row.id
      )
      .run();
    await db.prepare("UPDATE users SET kind = 'artist', city = COALESCE(city, ?) WHERE id = ?").bind(row.city, me.id).run();
    artist = await db.prepare("SELECT * FROM artist_profiles WHERE id = ?").bind(id).first();
  }
  await db
    .prepare("UPDATE talent_directory SET status='claimed', claimed_by=?, claimed_artist_id=?, last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
    .bind(me.id, artist.id, row.id)
    .run();
  return { artist, directory: { ...row, status: "claimed", claimed_artist_id: artist.id } };
}

// --------------------------------------------------------------- routes -----

export function mountTalentRoutes(app, auth) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const err = (status, error) => json({ error }, status);
  const sameOrigin = (c) => isSameOriginRequest(c.req.raw, c.env.APP_ORIGIN);

  const authed = async (c) => {
    const fb = await auth.getUser(c.req.raw);
    if (!fb) return { error: err(401, "Sign in required") };
    await ensureTalentSchema(c.env);
    return { me: await resolveUser(c.env.DB, fb), db: c.env.DB };
  };

  // Curation (import/edit/scan/settings) can be restricted to the operator.
  // Claiming a profile stays available to every signed-in artist.
  const ownerOnly = async (c) => {
    const r = await authed(c);
    if (r.error) return r;
    if (!isWorkspaceOwner(c.env, r.me)) {
      return { error: err(403, "This action is limited to the workspace owner") };
    }
    return r;
  };

  app.get("/api/talent", async (c) => {
    await ensureTalentSchema(c.env);
    const db = c.env.DB;
    const q = c.req.query();
    const where = ["status IN ('active','stale')", "claimed_artist_id IS NULL"];
    const params = [];
    if (q.city) { where.push("city = ?"); params.push(q.city); }
    if (q.category) { where.push("category = ?"); params.push(q.category); }
    if (q.status) { where.push("status = ?"); params.push(q.status); }
    if (q.open_to_work === "1") where.push("open_to_work = 1");
    if (q.q) {
      const term = String(q.q).trim();
      const like = `%${term}%`;
      // "shayari", "stand-up" and "dhol" are intents, not words that every
      // biography repeats. Resolve them through the shared taxonomy so a poet
      // listed from Wikipedia still answers a search for "shayari".
      const qcat = normalizeCategory(term);
      const textMatch = "name LIKE ? OR bio LIKE ? OR genres LIKE ? OR languages LIKE ? OR area LIKE ? OR city LIKE ?";
      if (qcat !== "other") {
        where.push(`(${textMatch} OR category = ?)`);
        params.push(like, like, like, like, like, like, qcat);
      } else {
        where.push(`(${textMatch})`);
        params.push(like, like, like, like, like, like);
      }
    }
    const limit = Math.min(Number(q.limit) || 24, 100);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const rows = await db
      .prepare(`SELECT * FROM talent_directory WHERE ${where.join(" AND ")}
        ORDER BY open_to_work DESC, followers DESC, last_seen_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset)
      .all();
    const total = await db.prepare(`SELECT COUNT(*) n FROM talent_directory WHERE ${where.join(" AND ")}`).bind(...params).first();
    return json({
      talent: (rows.results ?? []).map((row) => shapeTalent(row)),
      total: Number(total?.n || 0), limit, offset,
    });
  });

  app.get("/api/talent/meta", async (c) => {
    await ensureTalentSchema(c.env);
    const db = c.env.DB;
    const [counts, byCity, byCat, bySource, lastRun, claimed] = await Promise.all([
      db.prepare("SELECT COUNT(*) total, SUM(status='active') active, SUM(status='stale') stale, SUM(status='claimed') claimed, SUM(status='archived') archived FROM talent_directory").first(),
      db.prepare("SELECT city, COUNT(*) n FROM talent_directory WHERE status IN ('active','stale') AND city != '' GROUP BY city ORDER BY n DESC").all(),
      db.prepare("SELECT category, COUNT(*) n FROM talent_directory WHERE status IN ('active','stale') GROUP BY category ORDER BY n DESC").all(),
      db.prepare("SELECT source, COUNT(*) n FROM talent_directory GROUP BY source ORDER BY n DESC").all(),
      db.prepare("SELECT * FROM talent_runs ORDER BY id DESC LIMIT 1").first(),
      db.prepare("SELECT COUNT(*) n FROM talent_directory WHERE claimed_artist_id IS NOT NULL").first(),
    ]);
    return json({
      counts: {
        total: Number(counts?.total || 0), active: Number(counts?.active || 0), stale: Number(counts?.stale || 0),
        claimed: Number(claimed?.n || 0), archived: Number(counts?.archived || 0),
      },
      cities: byCity.results ?? [], categories: byCat.results ?? [], sources: bySource.results ?? [],
      last_run: lastRun ?? null,
      configured: { musicbrainz: true, youtube: !!c.env.YOUTUBE_API_KEY },
    });
  });

  app.get("/api/talent/profile/:slug", async (c) => {
    await ensureTalentSchema(c.env);
    const row = await c.env.DB.prepare("SELECT * FROM talent_directory WHERE slug = ? OR id = ?")
      .bind(c.req.param("slug"), c.req.param("slug")).first();
    if (!row) return err(404, "Profile not found");
    if (row.status === "archived") return json({ error: "This profile was retired as stale", archived: true }, 410);
    let claimed_slug = null;
    if (row.claimed_artist_id) {
      const a = await c.env.DB.prepare("SELECT slug FROM artist_profiles WHERE id = ?").bind(row.claimed_artist_id).first();
      claimed_slug = a?.slug || null;
    }
    return json({ talent: shapeTalent(row), claimed_slug });
  });

  // One-click claim: creates a quote-per-gig profile, no packages needed.
  app.post("/api/talent/:slug/claim", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, me, db } = await authed(c);
    if (error) return error;
    const r = await claimTalent(db, me, c.req.param("slug"));
    if (r.error) return json({ error: r.error[1], artist_slug: r.error[2] || null }, r.error[0]);
    return json({ ok: true, artist: r.artist, artist_slug: r.artist.slug }, 201);
  });

  app.post("/api/talent", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, me, db } = await ownerOnly(c);
    if (error) return error;
    const b = await c.req.json().catch(() => ({}));
    if (!b.name || !b.city) return err(400, "name and city are required");
    const r = await upsertTalent(db, { ...b, source: b.source || "manual", verification: "listed" }, { source: "manual" });
    return json(r, r.created ? 201 : 200);
  });

  // Public, minimal self-registration: one name, one city, one way to reach
  // you. The profile is live immediately (no approval queue), and signing in
  // later claims it in one click to take bookings.
  app.post("/api/talent/self", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    await ensureTalentSchema(c.env);
    const db = c.env.DB;
    const b = await c.req.json().catch(() => ({}));
    const name = String(b.name || "").trim().slice(0, 120);
    const city = String(b.city || "").trim().slice(0, 80);
    if (name.length < 2) return err(400, "Add your stage or act name");
    if (!city) return err(400, "Add the city you perform in");
    const email = String(b.email || "").trim().toLowerCase().slice(0, 160);
    if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return err(400, "That email doesn't look right");
    const phone = String(b.phone || "").replace(/\D/g, "").slice(0, 15);
    const links = normalizeLinks({
      instagram: b.instagram, youtube: b.youtube, website: b.website,
      portfolio: b.portfolio, spotify: b.spotify, url: b.portfolio,
    });
    if (!email && !phone && !Object.keys(links).length) {
      return err(400, "Add an Instagram, portfolio, email or phone so we can reach you");
    }
    const category = normalizeCategory(String(b.category || ""));
    const r = await upsertTalent(
      db,
      {
        name, category, city, area: String(b.area || "").trim().slice(0, 80),
        bio: String(b.bio || "").slice(0, 500), links, email, phone,
        genres: parseList(b.genres), languages: parseList(b.languages),
        source: "claim", verification: "self",
        open_to_work: b.freelance === false ? 0 : 1,
      },
      { source: "claim" }
    );
    // Put the same person in the operator's lead pipeline so outreach and
    // discovery (Places/CSV/claim) stay in one place.
    try {
      await ensureLeadsSchema(c.env);
      await upsertLead(
        db,
        {
          kind: "artist", name, category: categoryLabel(category), city,
          area: String(b.area || "").trim(), email, phone,
          instagram: links.instagram || "", website: links.website || links.portfolio || "",
          notes: String(b.bio || "").slice(0, 300), source: "claim", wants_artists: 1,
        },
        { createdBy: "self-serve" }
      );
    } catch { /* the directory profile is the primary record */ }
    return json({
      ok: true, created: r.created,
      profile_url: `/talent/${r.talent.slug}`,
      talent: shapeTalent(r.talent),
    }, r.created ? 201 : 200);
  });

  app.post("/api/talent/import", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, db } = await ownerOnly(c);
    if (error) return error;
    const b = await c.req.json().catch(() => ({}));
    const rows = parseCsv(b.csv || "").slice(0, 4000);
    let created = 0, updated = 0;
    for (const row of rows) {
      const t = talentFromRow(row, "csv");
      if (!t.name) continue;
      const r = await upsertTalent(db, t, { source: "csv" });
      r.created ? created++ : updated++;
    }
    return json({ imported: rows.length, created, updated });
  });

  // Manual curation: hide a wrong entry, or edit its category/city.
  app.patch("/api/talent/:id", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, db } = await ownerOnly(c);
    if (error) return error;
    const id = c.req.param("id");
    const row = await db.prepare("SELECT * FROM talent_directory WHERE id = ? OR slug = ?").bind(id, id).first();
    if (!row) return err(404, "Profile not found");
    const b = await c.req.json().catch(() => ({}));
    const set = [], params = [];
    const put = (col, v) => { set.push(`${col} = ?`); params.push(v); };
    if (b.category != null && CATEGORY_KEYS.includes(b.category)) put("category", b.category);
    if (b.city != null) put("city", String(b.city));
    if (b.area != null) put("area", String(b.area));
    if (b.status != null && ["active", "stale", "archived"].includes(b.status)) put("status", b.status);
    if (b.name != null) put("name", String(b.name));
    if (!set.length) return err(400, "Nothing to update");
    await db.prepare(`UPDATE talent_directory SET ${set.join(", ")}, updated_at=datetime('now') WHERE id = ?`).bind(...params, row.id).run();
    const fresh = await db.prepare("SELECT * FROM talent_directory WHERE id = ?").bind(row.id).first();
    return json({ talent: fresh });
  });

  app.post("/api/talent/radar/run", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error } = await ownerOnly(c);
    if (error) return error;
    const b = await c.req.json().catch(() => ({}));
    return json(await runTalentRadar(c.env, {
      trigger: "manual",
      maxQueries: Math.min(Number(b.max_queries) || 2, 6),
      detailLimit: Math.min(Number(b.detail_limit) || 4, 10),
      detailDelayMs: 1100,
    }));
  });

  app.post("/api/talent/settings", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, db } = await ownerOnly(c);
    if (error) return error;
    const b = await c.req.json().catch(() => ({}));
    if (b.radar_cities) await setSetting(db, "radar_cities", String(b.radar_cities));
    if (b.radar_categories) await setSetting(db, "radar_categories", String(b.radar_categories));
    return json({
      ok: true,
      radar_cities: await getSetting(db, "radar_cities", "Pune,Mumbai,Jaipur"),
      radar_categories: await getSetting(db, "radar_categories", "singer,poet,comedian,band,dj,instrumentalist"),
    });
  });
}

export { PUBLIC_CATEGORY_KEYS };
