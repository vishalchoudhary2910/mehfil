// Shows engine — real event feeds, daily.
//
// Keyless, works today: iCal and RSS feeds published by venues, collectives
// and city culture pages (you add the URLs once; the engine re-reads them
// every day, updates changed events, retires past ones).
// Key-gated adapters: Bandsintown (registered app id) and Eventbrite (token).
//
// Pure parsers/mappers are exported so the whole ingestion path is testable
// without a network or a database.

import { extractPerformers } from "./talent.js";
import { ensureLeadsSchema, upsertLead } from "./leads.js";
import { inferCity } from "../shared/categories.js";
import { notify } from "./notify.js";
import { resolveUser } from "./util.js";
import { isSameOriginRequest } from "@freebuff/auth";

const uid = (p) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// ---------------------------------------------------------------- parsing ---

const decodeIcal = (s) =>
  String(s || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();

const decodeHtml = (s) =>
  String(s || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

// RFC 5545-ish: unfold continuation lines, then read VEVENT properties.
export function parseIcal(text) {
  // RFC unfolding removes CRLF + leading WSP. Many calendars fold at a word
  // boundary, so join with a space to avoid gluing "VaniFree entry" together.
  const unfolded = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]+/g, " ");
  const lines = unfolded.split("\n");
  const events = [];
  let cur = null;
  for (const line of lines) {
    const l = line.trimEnd();
    if (/^BEGIN:VEVENT$/i.test(l)) { cur = []; continue; }
    if (/^END:VEVENT$/i.test(l)) {
      if (cur) {
        const prop = (name) => {
          const hit = cur.find((p) => p.name === name);
          return hit ? hit : null;
        };
        const val = (name) => prop(name)?.value ?? "";
        const params = (name) => prop(name)?.params ?? "";
        events.push({
          uid: val("UID"),
          summary: val("SUMMARY"),
          description: val("DESCRIPTION"),
          location: val("LOCATION"),
          url: val("URL"),
          organizer: val("ORGANIZER"),
          categories: val("CATEGORIES"),
          status: val("STATUS"),
          dtstart: val("DTSTART"),
          dtstartParams: params("DTSTART"),
          dtend: val("DTEND"),
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = l.indexOf(":");
    if (idx < 0) continue;
    const left = l.slice(0, idx);
    const value = l.slice(idx + 1);
    const [name, ...ps] = left.split(";");
    cur.push({ name: name.toUpperCase(), params: ps.join(";"), value: decodeIcal(value) });
  }
  return events;
}

// DTSTART → { date: YYYY-MM-DD, time: HH:MM }. UTC stamps are converted to
// IST so a 19:00Z show doesn't show up as 1 AM tomorrow.
export function icalDate(value) {
  const s = String(value || "").trim();
  if (!s) return { date: "", time: "" };
  if (/^\d{8}$/.test(s)) return { date: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`, time: "" };
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (m) {
    if (m[7]) {
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
      d.setUTCMinutes(d.getUTCMinutes() + 330);
      return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
    }
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
  return { date: "", time: "" };
}

export function inferPrice(text) {
  const s = String(text || "");
  if (/\b(free entry|entry free|free show|free admission|no cover|complimentary|rsvp free)\b/i.test(s)) {
    return { is_free: 1, price_inr: 0 };
  }
  const m = s.match(/(?:₹|rs\.?|inr)\s*([\d,]{2,6})/i) || s.match(/\b(?:tickets?|entry|cover|passes?)\s*(?:from|at|:)?\s*([\d,]{2,6})/i);
  if (m) return { is_free: 0, price_inr: Number(String(m[1]).replace(/,/g, "")) || 0 };
  return { is_free: 0, price_inr: 0 };
}

function splitLocation(location, defaultCity) {
  const raw = String(location || "").replace(/\s+/g, " ").trim();
  const city = inferCity(raw, defaultCity || "");
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const venue = parts[0] || "";
  const area = parts.slice(1).find((p) => p.toLowerCase() !== String(city).toLowerCase()) || "";
  return { venue, area: area || "", city };
}

// Map one VEVENT to a shows row. Returns null when there is no usable date.
export function mapIcalEvent(ev, { defaultCity = "", sourceUrl = "", feedName = "" } = {}) {
  const title = decodeHtml(ev.summary || "").trim();
  const { date, time } = icalDate(ev.dtstart);
  if (!title || !date) return null;
  const description = decodeHtml(ev.description || "").slice(0, 1200);
  const loc = splitLocation(decodeHtml(ev.location || ""), defaultCity);
  const hay = `${title} ${description} ${ev.location || ""}`;
  const { is_free, price_inr } = inferPrice(hay);
  const performers = extractPerformers(description || ev.summary || "", { max: 4 }).join(", ");
  const key = ev.uid ? `ical:${ev.uid}` : `k:${slug(title)}|${date}|${slug(loc.venue)}`;
  return {
    title: title.slice(0, 180),
    performers: performers.slice(0, 240),
    venue: loc.venue.slice(0, 140) || loc.city,
    area: loc.area,
    city: loc.city || defaultCity,
    date,
    start_time: time || "20:00",
    is_free,
    price_inr,
    capacity: 0,
    description,
    source: "ical",
    source_url: sourceUrl,
    external_id: ev.uid || null,
    dedupe_key: key,
    url: ev.url || sourceUrl,
    organizer: decodeHtml(ev.organizer || "").replace(/^mailto:/i, "").slice(0, 120) || feedName,
    status: "active",
  };
}

// RSS/Atom event feeds: only items whose title/description carry an explicit
// date become shows — a publish date is not an event date.
export function parseRss(xml) {
  const out = [];
  const blocks = String(xml || "").match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const val = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? decodeHtml(m[1]) : "";
    };
    const link = (b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || val("link");
    out.push({
      title: val("title"),
      description: val("description") || val("summary") || val("content"),
      link,
      pubDate: val("pubDate") || val("updated") || val("published"),
    });
  }
  return out;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function extractEventDate(text) {
  const s = String(text || "");
  let m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(20\d{2})?\b/i);
  if (m) {
    const now = new Date();
    const year = m[3] ? Number(m[3]) : now.getFullYear();
    const mm = String(MONTHS[m[2].toLowerCase().slice(0, 3)]).padStart(2, "0");
    return `${year}-${mm}-${String(m[1]).padStart(2, "0")}`;
  }
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(20\d{2})?\b/i);
  if (m) {
    const now = new Date();
    const year = m[3] ? Number(m[3]) : now.getFullYear();
    const mm = String(MONTHS[m[1].toLowerCase().slice(0, 3)]).padStart(2, "0");
    return `${year}-${mm}-${String(m[2]).padStart(2, "0")}`;
  }
  return "";
}

export function mapRssItem(item, { defaultCity = "", sourceUrl = "" } = {}) {
  const text = `${item.title || ""}\n${item.description || ""}`;
  const date = extractEventDate(text);
  if (!item.title || !date) return null;
  const { is_free, price_inr } = inferPrice(text);
  const city = inferCity(text, defaultCity || "");
  const venueMatch = text.match(/\b(?:at|@|venue:?)\s+([A-Z][\w'&. -]{2,48})/);
  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  let time = "20:00";
  if (timeMatch) {
    let h = Number(timeMatch[1]) % 12;
    if (/pm/i.test(timeMatch[3])) h += 12;
    time = `${String(h).padStart(2, "0")}:${timeMatch[2] || "00"}`;
  }
  return {
    title: decodeHtml(item.title).slice(0, 180),
    performers: extractPerformers(text, { max: 4 }).join(", "),
    venue: (venueMatch?.[1] || "").trim() || city,
    area: "",
    city,
    date,
    start_time: time,
    is_free,
    price_inr,
    capacity: 0,
    description: String(item.description || "").slice(0, 1200),
    source: "rss",
    source_url: sourceUrl,
    external_id: item.link || null,
    dedupe_key: item.link ? `rss:${item.link}` : `k:${slug(item.title)}|${date}`,
    url: item.link || sourceUrl,
    organizer: "",
    status: "active",
  };
}

// ---------------------------------------------------------------- storage ---

const SHOW_COLUMNS = [
  ["source", "TEXT NOT NULL DEFAULT 'manual'"],
  ["source_url", "TEXT NOT NULL DEFAULT ''"],
  ["external_id", "TEXT"],
  ["dedupe_key", "TEXT NOT NULL DEFAULT ''"],
  ["url", "TEXT NOT NULL DEFAULT ''"],
  ["image_url", "TEXT NOT NULL DEFAULT ''"],
  ["organizer", "TEXT NOT NULL DEFAULT ''"],
  ["area", "TEXT NOT NULL DEFAULT ''"],
  ["status", "TEXT NOT NULL DEFAULT 'active'"],
  ["last_seen_at", "TEXT"],
  ["updated_at", "TEXT"],
];

const READY_DBS = new WeakSet();

export async function ensureShowSchema(env) {
  if (READY_DBS.has(env.DB)) return;
  const db = env.DB;
  await db.prepare(`CREATE TABLE IF NOT EXISTS shows (
    id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, title TEXT NOT NULL,
    performers TEXT NOT NULL DEFAULT '', venue TEXT NOT NULL, city TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '20:00',
    is_free INTEGER NOT NULL DEFAULT 1, price_inr INTEGER NOT NULL DEFAULT 0,
    capacity INTEGER NOT NULL DEFAULT 100, description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual', source_url TEXT NOT NULL DEFAULT '', external_id TEXT,
    dedupe_key TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '',
    organizer TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
    last_seen_at TEXT, updated_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  const info = await db.prepare("PRAGMA table_info(shows)").all().catch(() => null);
  const cols = new Set((info?.results ?? []).map((c) => c.name));
  for (const [name, decl] of SHOW_COLUMNS) {
    if (!cols.has(name)) {
      try { await db.prepare(`ALTER TABLE shows ADD COLUMN ${name} ${decl}`).run(); } catch { /* exists */ }
    }
  }
  try {
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_shows_dedupe ON shows(dedupe_key) WHERE dedupe_key != ''").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_shows_status ON shows(status)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_shows_date ON shows(date)").run();
  } catch { /* index already exists */ }
  await db.prepare(`CREATE TABLE IF NOT EXISTS show_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger TEXT NOT NULL DEFAULT 'cron',
    feeds INTEGER DEFAULT 0, fetched INTEGER DEFAULT 0, created INTEGER DEFAULT 0, updated INTEGER DEFAULT 0,
    past INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, removed INTEGER DEFAULT 0,
    ok INTEGER NOT NULL DEFAULT 1, error TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT
  )`).run();
  await db.prepare("CREATE TABLE IF NOT EXISTS show_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  READY_DBS.add(env.DB);
}

const getSetting = async (db, key, fallback = "") => {
  const r = await db.prepare("SELECT value FROM show_settings WHERE key = ?").bind(key).first();
  return r ? r.value : fallback;
};
const setSetting = async (db, key, value) => {
  await db.prepare("INSERT INTO show_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, String(value)).run();
};

export async function upsertShow(db, s, { source, lastSeen = true } = {}) {
  if (!s?.title || !s?.date) return { created: false, skipped: true };
  const key = s.dedupe_key || `k:${slug(s.title)}|${s.date}|${slug(s.venue || "")}`;
  let existing = await db.prepare("SELECT * FROM shows WHERE dedupe_key = ? OR (external_id IS NOT NULL AND external_id = ?) LIMIT 1")
    .bind(key, s.external_id || "").first();
  // A feed may list a show a host already created by hand: match it and leave
  // the host's copy authoritative instead of creating a duplicate.
  if (!existing) {
    existing = await db.prepare("SELECT * FROM shows WHERE source = 'manual' AND lower(title) = lower(?) AND date = ? AND lower(city) = lower(?) LIMIT 1")
      .bind(s.title, s.date, s.city || "").first();
  }
  if (existing && existing.source === "manual" && source !== "manual") {
    await db.prepare("UPDATE shows SET last_seen_at = datetime('now') WHERE id = ?").bind(existing.id).run();
    return { created: false, show: existing, manual: true };
  }
  if (existing) {
    await db.prepare(`UPDATE shows SET
        title = COALESCE(NULLIF(?, ''), title),
        performers = CASE WHEN ? != '' THEN ? ELSE performers END,
        venue = COALESCE(NULLIF(?, ''), venue),
        city = COALESCE(NULLIF(?, ''), city),
        area = CASE WHEN ? != '' THEN ? ELSE area END,
        date = COALESCE(NULLIF(?, ''), date),
        start_time = COALESCE(NULLIF(?, ''), start_time),
        is_free = ?, price_inr = ?, description = CASE WHEN ? != '' THEN ? ELSE description END,
        url = CASE WHEN ? != '' THEN ? ELSE url END,
        organizer = CASE WHEN ? != '' THEN ? ELSE organizer END,
        source = COALESCE(NULLIF(?, ''), source),
        source_url = CASE WHEN ? != '' THEN ? ELSE source_url END,
        last_seen_at = datetime('now'), updated_at = datetime('now'),
        status = CASE WHEN date < date('now') THEN 'past' ELSE 'active' END
      WHERE id = ?`).bind(
      s.title, s.performers || "", s.performers || "", s.venue || "", s.city || "",
      s.area || "", s.area || "", s.date || "", s.start_time || "", s.is_free == null ? 0 : (s.is_free ? 1 : 0),
      Number(s.price_inr) || 0, s.description || "", s.description || "", s.url || "", s.url || "",
      s.organizer || "", s.organizer || "", s.source || source || "", s.source_url || "", s.source_url || "",
      existing.id
    ).run();
    const fresh = await db.prepare("SELECT * FROM shows WHERE id = ?").bind(existing.id).first();
    return { created: false, show: fresh };
  }
  const id = uid("s");
  await db.prepare(`INSERT INTO shows (id, creator_id, title, performers, venue, city, area, date, start_time,
      is_free, price_inr, capacity, description, source, source_url, external_id, dedupe_key, url, image_url,
      organizer, status, last_seen_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).bind(
    id, "feed", s.title, s.performers || "", s.venue || "", s.city || "", s.area || "", s.date,
    s.start_time || "20:00", s.is_free ? 1 : 0, Number(s.price_inr) || 0, Number(s.capacity) || 0,
    s.description || "", s.source || source || "feed", s.source_url || "", s.external_id || null, key,
    s.url || "", s.image_url || "", s.organizer || "",
    s.date < new Date().toISOString().slice(0, 10) ? "past" : "active"
  ).run();
  const fresh = await db.prepare("SELECT * FROM shows WHERE id = ?").bind(id).first();
  return { created: true, show: fresh };
}

// ---------------------------------------------------------------- adapters --

// Every imported show is also a demand lead for the venue/organizer, so the
// Leads console can qualify it and the outreach engine has something to work
// on. Manual shows created by a signed-in host are already attributed to them
// and are skipped here.
export function leadFromShow(show) {
  if (!show || show.source === "manual") return null;
  const name = String(show.organizer || show.venue || "").trim();
  if (!name) return null;
  return {
    kind: "show",
    name,
    category: "venue/show",
    city: show.city || "",
    area: show.area || "",
    website: show.source_url || show.url || "",
    notes: `${show.title} · ${show.date} ${show.start_time || ""} · ${show.venue || ""}, ${show.city || ""}`,
    source: "shows",
    external_id: `show:${show.id}`,
    wants_artists: 1,
  };
}

export function feedUrls(env, dbValue = "", envKey = "FEED_ICAL_URLS") {
  const raw = `${env[envKey] || ""}\n${dbValue || ""}`;
  return [...new Set(String(raw).split(/[\n,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)))];
}

async function fetchText(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "MehfilShows/1.0 (+https://mehfil.app)", Accept: "text/calendar, application/rss+xml, application/xml, text/xml, */*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Feed ${res.status}`);
  return res.text();
}

export async function ingestIcalFeeds(env, urls, { fetchImpl = fetch, defaultCity = "" } = {}) {
  const stats = { feeds: 0, fetched: 0, created: 0, updated: 0, errors: [] };
  for (const url of urls.slice(0, 12)) {
    stats.feeds++;
    try {
      const text = await fetchText(url, fetchImpl);
      const events = parseIcal(text);
      for (const ev of events) {
        const mapped = mapIcalEvent(ev, { defaultCity, sourceUrl: url, feedName: new URL(url).hostname });
        if (!mapped) continue;
        stats.fetched++;
        const r = await upsertShow(env.DB, mapped, { source: "ical" });
        r.created ? stats.created++ : stats.updated++;
      }
    } catch (e) {
      stats.errors.push(`${url.slice(0, 40)}: ${String(e?.message || e).slice(0, 80)}`);
    }
  }
  return stats;
}

export async function ingestRssFeeds(env, { fetchImpl = fetch, defaultCity = "" } = {}) {
  const urls = feedUrls(env, await getSetting(env.DB, "rss_urls", env.FEED_RSS_URLS || ""), "FEED_RSS_URLS");
  const stats = { feeds: 0, fetched: 0, created: 0, updated: 0, errors: [] };
  for (const url of urls.slice(0, 12)) {
    stats.feeds++;
    try {
      const items = parseRss(await fetchText(url, fetchImpl));
      for (const item of items) {
        const mapped = mapRssItem(item, { defaultCity, sourceUrl: url });
        if (!mapped) continue;
        stats.fetched++;
        const r = await upsertShow(env.DB, mapped, { source: "rss" });
        r.created ? stats.created++ : stats.updated++;
      }
    } catch (e) {
      stats.errors.push(`${url.slice(0, 40)}: ${String(e?.message || e).slice(0, 80)}`);
    }
  }
  return stats;
}

export function mapBandsintownEvent(e, { artistName = "" } = {}) {
  const venue = e.venue || {};
  const dt = String(e.datetime || "");
  if (!dt) return null;
  const date = dt.slice(0, 10);
  const time = dt.slice(11, 16) || "20:00";
  const lineup = (e.lineup || []).filter(Boolean);
  const title = `${artistName || lineup[0] || "Live show"}${venue.name ? ` — live at ${venue.name}` : ""}`;
  const { is_free, price_inr } = inferPrice(`${title} ${e.description || ""} ${e.free ? "free entry" : ""}`);
  return {
    title: title.slice(0, 180),
    performers: (lineup.length ? lineup : [artistName]).filter(Boolean).join(", ").slice(0, 240),
    venue: String(venue.name || "").slice(0, 140),
    area: String(venue.region || ""),
    city: String(venue.city || ""),
    date,
    start_time: time,
    is_free,
    price_inr,
    capacity: 0,
    description: decodeHtml(e.description || "").slice(0, 1200),
    source: "bandsintown",
    source_url: e.url || "",
    external_id: e.id ? `bit:${e.id}` : null,
    dedupe_key: e.id ? `bit:${e.id}` : `k:${slug(title)}|${date}`,
    url: e.url || "",
    organizer: artistName,
    status: "active",
  };
}

async function ingestBandsintown(env, { fetchImpl = fetch } = {}) {
  const stats = { artists: 0, fetched: 0, created: 0, updated: 0, errors: [] };
  const appId = env.BANDSINTOWN_APP_ID;
  if (!appId) return stats;
  let roster = [];
  try {
    roster = (await env.DB.prepare("SELECT stage_name, city FROM artist_profiles LIMIT 12").all()).results ?? [];
  } catch { roster = []; }
  for (const artist of roster) {
    stats.artists++;
    try {
      const res = await fetchImpl(
        `https://rest.bandsintown.com/artists/${encodeURIComponent(artist.stage_name)}/events?app_id=${encodeURIComponent(appId)}&date=upcoming`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) throw new Error(`Bandsintown ${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        const mapped = mapBandsintownEvent(e, { artistName: artist.stage_name });
        if (!mapped) continue;
        stats.fetched++;
        const r = await upsertShow(env.DB, mapped, { source: "bandsintown" });
        r.created ? stats.created++ : stats.updated++;
      }
    } catch (e) {
      stats.errors.push(`${artist.stage_name}: ${String(e?.message || e).slice(0, 70)}`);
    }
  }
  return stats;
}

// Eventbrite v3 (token-gated; the public search endpoint was retired upstream,
// so a 404 is reported rather than treated as a crash).
async function ingestEventbrite(env, { fetchImpl = fetch, cities = ["Pune"] } = {}) {
  const stats = { cities: 0, fetched: 0, created: 0, updated: 0, errors: [] };
  const token = env.EVENTBRITE_TOKEN;
  if (!token) return stats;
  for (const city of cities.slice(0, 4)) {
    stats.cities++;
    try {
      const start = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      const url = `https://www.eventbriteapi.com/v3/events/search/?location.address=${encodeURIComponent(city)}&location.within=40km&start_date.range_start=${start}&expand=venue&page_size=20`;
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (!res.ok) throw new Error(`Eventbrite ${res.status}`);
      const data = await res.json();
      for (const e of data.events || []) {
        const name = e.name?.text || "";
        const start = e.start?.local || "";
        if (!name || !start) continue;
        stats.fetched++;
        const mapped = {
          title: name.slice(0, 180),
          performers: "",
          venue: e.venue?.name || "",
          area: "",
          city: e.venue?.city || inferCity(e.venue?.address?.localized_address_display || "", city),
          date: start.slice(0, 10),
          start_time: start.slice(11, 16) || "20:00",
          is_free: !!e.is_free,
          price_inr: 0,
          capacity: Number(e.capacity) || 0,
          description: decodeHtml(e.description?.text || "").slice(0, 1200),
          source: "eventbrite",
          source_url: e.url || "",
          external_id: e.id,
          dedupe_key: `eb:${e.id}`,
          url: e.url || "",
          organizer: e.organizer?.name || "",
          status: "active",
        };
        const r = await upsertShow(env.DB, mapped, { source: "eventbrite" });
        r.created ? stats.created++ : stats.updated++;
      }
    } catch (e) {
      stats.errors.push(`${city}: ${String(e?.message || e).slice(0, 70)}`);
    }
  }
  return stats;
}

// ------------------------------------------------------------------ run -----

export async function runShowFeed(env, opts = {}) {
  await ensureShowSchema(env);
  const { fetchImpl = fetch, trigger = "cron", silent = false, cities = ["Pune", "Mumbai", "Jaipur"] } = opts;
  const db = env.DB;
  const summary = {
    trigger, feeds: 0, fetched: 0, created: 0, updated: 0, past: 0, archived: 0, removed: 0,
    errors: [], ok: true, bandsintown: false, eventbrite: false,
  };
  const runRow = await db.prepare("INSERT INTO show_runs (trigger) VALUES (?)").bind(trigger).run();
  const runId = Number(runRow?.meta?.last_rowid || 0) || null;

  try {
    const icalUrls = feedUrls(env, await getSetting(db, "ical_urls", env.FEED_ICAL_URLS || ""));
    const ical = await ingestIcalFeeds(env, icalUrls, { fetchImpl, defaultCity: cities[0] });
    const rss = await ingestRssFeeds(env, { fetchImpl, defaultCity: cities[0] });
    const bit = await ingestBandsintown(env, { fetchImpl });
    const eb = await ingestEventbrite(env, { fetchImpl, cities });

    for (const s of [ical, rss, bit, eb]) {
      summary.feeds += s.feeds || s.artists || s.cities || 0;
      summary.fetched += s.fetched || 0;
      summary.created += s.created || 0;
      summary.updated += s.updated || 0;
      summary.errors.push(...(s.errors || []));
    }
    summary.bandsintown = !!env.BANDSINTOWN_APP_ID;
    summary.eventbrite = !!env.EVENTBRITE_TOKEN;

    // Turn upcoming imported shows into venue leads (idempotent, deduped by
    // the lead engine). This is the "connect shows to the pipeline" step.
    try {
      await ensureLeadsSchema(env);
      const upcoming = (
        await db.prepare(`SELECT * FROM shows
          WHERE source != 'manual' AND status = 'active' AND date >= date('now')
          ORDER BY updated_at DESC LIMIT 50`).all()
      ).results ?? [];
      let linked = 0;
      for (const show of upcoming) {
        const lead = leadFromShow(show);
        if (!lead) continue;
        const r = await upsertLead(db, lead, { createdBy: "shows" });
        if (r.created) linked++;
      }
      summary.leads_linked = linked;
    } catch (e) {
      summary.errors.push(`leads: ${String(e?.message || e).slice(0, 80)}`);
    }

    const past = await db.prepare("UPDATE shows SET status='past', updated_at=datetime('now') WHERE date < date('now') AND status='active'").run();
    const archived = await db
      .prepare("UPDATE shows SET status='archived', updated_at=datetime('now') WHERE source != 'manual' AND status IN ('active','past') AND last_seen_at < datetime('now','-45 day')")
      .run();
    const removed = await db
      .prepare("DELETE FROM shows WHERE source != 'manual' AND status='archived' AND date < date('now','-90 day')")
      .run();
    summary.past = past.meta?.changes || 0;
    summary.archived = archived.meta?.changes || 0;
    summary.removed = removed.meta?.changes || 0;

    if (runId) {
      await db.prepare("UPDATE show_runs SET feeds=?, fetched=?, created=?, updated=?, past=?, archived=?, removed=?, ok=1, finished_at=datetime('now') WHERE id=?")
        .bind(summary.feeds, summary.fetched, summary.created, summary.updated, summary.past, summary.archived, summary.removed, runId).run();
    }
  } catch (e) {
    summary.ok = false;
    summary.error = String(e?.message || e);
    if (runId) {
      await db.prepare("UPDATE show_runs SET ok=0, error=?, finished_at=datetime('now') WHERE id=?").bind(summary.error.slice(0, 300), runId).run();
    }
  }

  if (!silent) {
    const lines = [
      "<b>Mehfil Shows feed</b>",
      `📅 ${summary.feeds} sources · ${summary.fetched} events seen · 🆕 ${summary.created} new · ♻️ ${summary.updated} updated`,
      summary.past ? `⌛ ${summary.past} marked past` : "",
      summary.removed ? `🧹 ${summary.removed} old listings removed` : "",
      !summary.feeds ? "Add iCal/RSS feed URLs in the Engines console to pull real venue calendars." : "",
      summary.errors.length ? `⚠️ ${summary.errors.length} source error(s)` : "",
    ].filter(Boolean);
    await notify(env, lines.join("\n"), "shows-feed");
  }
  return summary;
}

// ---------------------------------------------------------------- routes ----

export function mountShowFeedRoutes(app, auth) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const err = (status, error) => json({ error }, status);
  const sameOrigin = (c) => isSameOriginRequest(c.req.raw, c.env.APP_ORIGIN);

  const authed = async (c) => {
    const fb = await auth.getUser(c.req.raw);
    if (!fb) return { error: err(401, "Sign in required") };
    await ensureShowSchema(c.env);
    return { me: await resolveUser(c.env.DB, fb), db: c.env.DB };
  };

  app.get("/api/shows/feed/status", async (c) => {
    const { error, db } = await authed(c);
    if (error) return error;
    const [counts, lastRun, icalSetting, rssSetting, sources] = await Promise.all([
      db.prepare("SELECT COUNT(*) total, SUM(status='active') active, SUM(status='past') past, SUM(status='archived') archived, SUM(source != 'manual') imported FROM shows").first(),
      db.prepare("SELECT * FROM show_runs ORDER BY id DESC LIMIT 1").first(),
      getSetting(db, "ical_urls", ""),
      getSetting(db, "rss_urls", ""),
      db.prepare("SELECT source, COUNT(*) n FROM shows GROUP BY source ORDER BY n DESC").all(),
    ]);
    return json({
      counts: {
        total: Number(counts?.total || 0), active: Number(counts?.active || 0),
        past: Number(counts?.past || 0), archived: Number(counts?.archived || 0),
        imported: Number(counts?.imported || 0),
      },
      sources: sources.results ?? [],
      last_run: lastRun ?? null,
      feeds: {
        ical: feedUrls(c.env, icalSetting),
        rss: feedUrls(c.env, rssSetting, "FEED_RSS_URLS"),
        rss_hint: rssSetting,
      },
      configured: {
        bandsintown: !!c.env.BANDSINTOWN_APP_ID,
        eventbrite: !!c.env.EVENTBRITE_TOKEN,
        ical_count: feedUrls(c.env, icalSetting).length,
      },
    });
  });

  app.post("/api/shows/feed/run", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error } = await authed(c);
    if (error) return error;
    return json(await runShowFeed(c.env, { trigger: "manual" }));
  });

  app.post("/api/shows/feeds", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, db } = await authed(c);
    if (error) return error;
    const b = await c.req.json().catch(() => ({}));
    const kind = b.kind === "rss" ? "rss" : "ical";
    const url = String(b.url || "").trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return err(400, "A valid http(s) feed URL is required");
    const key = kind === "rss" ? "rss_urls" : "ical_urls";
    const current = feedUrls(c.env, await getSetting(db, key, ""), kind === "rss" ? "FEED_RSS_URLS" : "FEED_ICAL_URLS");
    if (!current.includes(url)) current.push(url);
    await setSetting(db, key, current.join("\n"));
    return json({ ok: true, kind, feeds: current });
  });

  app.delete("/api/shows/feeds", async (c) => {
    if (!sameOrigin(c)) return err(403, "Bad origin");
    const { error, db } = await authed(c);
    if (error) return error;
    const url = c.req.query("url");
    const kind = c.req.query("kind") === "rss" ? "rss" : "ical";
    const key = kind === "rss" ? "rss_urls" : "ical_urls";
    const current = feedUrls(c.env, await getSetting(db, key, "")).filter((u) => u !== url);
    await setSetting(db, key, current.join("\n"));
    return json({ ok: true, feeds: current });
  });
}
