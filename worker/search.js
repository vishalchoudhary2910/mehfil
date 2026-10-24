// One search across the whole supply side.
//
// Discovery used to be two disconnected lists (bookable artists + the raw
// directory). This module ranks both together by what the visitor typed, what
// is actually in demand right now (open gig requests and venue leads), how
// fresh the profile is, and whether the act is open to freelance gigs.
//
// The ranking is pure and exported so the console, tests and the API agree.

import { normalizeCategory } from "../shared/categories.js";

const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
const parse = (s, fallback) => {
  try {
    return JSON.parse(s ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};

// Scores a free-text query against a profile. Name matches dominate; genre,
// language, area and bio matches fill in the long tail.
export function textScore(q, item) {
  const needle = norm(q);
  if (!needle) return 0;
  const name = norm(item?.name || item?.stage_name);
  const hay = [
    item?.bio,
    ...(item?.genres || []),
    ...(item?.languages || []),
    item?.area,
    item?.city,
    item?.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 0;
  if (name === needle) score += 120;
  else if (name.startsWith(needle)) score += 100;
  else if (name.includes(needle)) score += 80;
  for (const token of needle.split(/\s+/).filter((t) => t.length > 1)) {
    if (name.includes(token)) score += 18;
    else if (hay.includes(token)) score += 8;
  }
  if (!score && hay.includes(needle)) score += 25;
  // Intent words ("shayari", "stand-up", "dhol") may never appear in a bio
  // written by Wikipedia, but they still identify the category the visitor
  // wants. Resolve them through the same taxonomy the rest of the app uses.
  const qcat = normalizeCategory(needle);
  if (qcat !== "other" && normalizeCategory(item?.category, name) === qcat) score += 14;
  return score;
}

export const demandKey = (category, city) =>
  `${normalizeCategory(category)}|${norm(city)}`;

// Merge request + lead demand into one map keyed by category|city.
export function buildDemand(requests = [], leads = []) {
  const out = {};
  const add = (category, city, n) => {
    const key = demandKey(category, city);
    out[key] = (out[key] || 0) + Number(n || 0);
  };
  for (const r of requests) add(r.category, r.city, r.n || 1);
  for (const l of leads) add(l.category, l.city, l.n || 1);
  return out;
}

const daysSince = (s) => {
  if (!s) return Infinity;
  const ms = Date.parse(String(s).includes("T") ? String(s) : String(s).replace(" ", "T") + "Z");
  return Number.isNaN(ms) ? Infinity : (Date.now() - ms) / 86400000;
};

export function shapeItem(row, kind) {
  const links = kind === "directory"
    ? parse(row.links, {})
    : {
        instagram: row.instagram || "",
        youtube: row.youtube || "",
        website: row.portfolio_url || "",
      };
  return {
    kind,
    id: row.id,
    slug: row.slug,
    name: kind === "directory" ? row.name : row.stage_name,
    category: normalizeCategory(row.category, row.name || row.stage_name || ""),
    city: row.city || "",
    area: row.area || "",
    bio: row.bio || "",
    genres: kind === "directory" ? parse(row.genres, []) : parse(row.sub_skills, []),
    languages: kind === "artist" ? parse(row.languages, []) : parse(row.languages, []),
    links,
    image_url: row.image_url || "",
    source: kind === "directory" ? row.source : "mehfil",
    verification: kind === "directory" ? row.verification : row.verified ? "verified" : "listed",
    rating: Number(row.rating) || 0,
    reviews_count: Number(row.reviews_count) || 0,
    base_price_inr: Number(row.base_price_inr) || 0,
    available_now: !!row.available_now,
    followers: Number(row.followers) || 0,
    open_to_work: kind === "directory" ? !!row.open_to_work : !!row.accepting_requests,
    last_seen_at: row.last_seen_at || row.created_at || "",
    hue: row.hue,
  };
}

// Pure ranking. Returns null for anything the filters exclude.
export function scoreItem(item, { q = "", city = "", category = "", demand = {} } = {}) {
  const cat = normalizeCategory(item.category, item.name);
  if (category && cat !== category) return null;
  if (city && norm(item.city) !== norm(city)) return null;
  const text = textScore(q, item);
  if (q && text <= 0) return null;

  const reasons = [];
  let score = text + 10;
  const want = demand[demandKey(cat, item.city)] || 0;
  if (want) {
    score += Math.min(24, want * 6);
    reasons.push(`${want} open request${want === 1 ? "" : "s"}`);
  }
  if (item.open_to_work) {
    score += 10;
    reasons.push("open to gigs");
  }
  if (item.available_now) {
    score += 8;
    reasons.push("available now");
  }
  if (item.verification === "verified") score += 6;
  if (item.kind === "artist") score += 6 + Math.round((Number(item.rating) || 0) * 2);
  if (item.followers > 0) score += Math.min(8, Math.log10(item.followers + 1) * 2);
  if (daysSince(item.last_seen_at) <= 7) {
    score += 5;
    reasons.push("fresh");
  }
  if (!reasons.length) reasons.push(item.kind === "artist" ? "bookable now" : "new discovery");
  return { ...item, category: cat, score: Math.round(score), reasons };
}

export function rankItems(artists = [], directory = [], opts = {}) {
  const { limit = 36 } = opts;
  const items = [
    ...artists.map((a) => shapeItem(a, "artist")),
    ...directory.map((d) => shapeItem(d, "directory")),
  ];
  const seen = new Map();
  for (const item of items) {
    const scored = scoreItem(item, opts);
    if (!scored) continue;
    const key = `${norm(scored.name)}|${norm(scored.city)}`;
    const prev = seen.get(key);
    if (!prev || scored.kind === "artist" && prev.kind !== "artist") seen.set(key, scored);
  }
  return [...seen.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(Number(limit) || 36, 60)));
}

export function interestSummary(demand = {}, limit = 6) {
  return Object.entries(demand)
    .map(([key, n]) => {
      const [category, city] = key.split("|");
      return { category, city, n };
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, limit);
}

// --------------------------------------------------------------- routes -----

export function mountSearchRoutes(app) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  app.get("/api/search", async (c) => {
    const db = c.env.DB;
    const q = String(c.req.query("q") || "").slice(0, 100);
    const city = String(c.req.query("city") || "").slice(0, 60);
    const category = String(c.req.query("category") || "").slice(0, 40);
    const limit = Math.min(Number(c.req.query("limit")) || 36, 60);

    const [artists, directory, reqDemand, leadDemand] = await Promise.all([
      db.prepare(`SELECT a.* FROM artist_profiles a ORDER BY a.rating DESC LIMIT 500`)
        .all().catch(() => ({ results: [] })),
      db.prepare(`SELECT * FROM talent_directory
          WHERE status IN ('active','stale') AND claimed_artist_id IS NULL
          ORDER BY open_to_work DESC, last_seen_at DESC LIMIT 600`)
        .all().catch(() => ({ results: [] })),
      db.prepare(`SELECT category, city, COUNT(*) n FROM booking_requests
          WHERE status = 'open' AND date >= date('now') GROUP BY category, city`)
        .all().catch(() => ({ results: [] })),
      db.prepare(`SELECT category, city, COUNT(*) n FROM leads
          WHERE wants_artists = 1 AND status NOT IN ('expired') GROUP BY category, city`)
        .all().catch(() => ({ results: [] })),
    ]);

    const demand = buildDemand(reqDemand.results ?? [], leadDemand.results ?? []);
    const results = rankItems(artists.results ?? [], directory.results ?? [], {
      q, city, category, demand, limit,
    });
    return json({
      q, city, category,
      results,
      total: results.length,
      interest: interestSummary(demand),
      checked_at: new Date().toISOString(),
    });
  });
}
