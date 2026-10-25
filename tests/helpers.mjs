// Minimal D1-compatible shim over node:sqlite, so the real engine code runs in
// tests without a Worker. Supports .prepare().bind().run/first/all.
import { DatabaseSync } from "node:sqlite";

const norm = (v) => {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
};

export function makeEnv(extra = {}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = OFF");
  const DB = {
    raw,
    prepare(sql) {
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async run() {
          const r = raw.prepare(sql).run(...args.map(norm));
          return { success: true, changes: Number(r.changes || 0), meta: { changes: Number(r.changes || 0), last_rowid: Number(r.lastInsertRowid || 0) } };
        },
        async first() {
          const row = raw.prepare(sql).get(...args.map(norm));
          return row == null ? null : { ...row };
        },
        async all() {
          return { results: raw.prepare(sql).all(...args.map(norm)).map((r) => ({ ...r })) };
        },
      };
      return api;
    },
    exec(sql) { raw.exec(sql); },
  };
  return { DB, APP_ORIGIN: "http://127.0.0.1:8787", ...extra };
}

// Route table: [[regex, handler(url, init) => Response], ...]
export function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    for (const [re, handler] of routes) {
      if (re.test(u)) return handler(u, init);
    }
    return new Response("not found", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export const ARTIST_DDL = `CREATE TABLE IF NOT EXISTS artist_profiles (
  id TEXT PRIMARY KEY, user_id TEXT, slug TEXT UNIQUE, stage_name TEXT NOT NULL,
  category TEXT NOT NULL, sub_skills TEXT NOT NULL DEFAULT '[]', city TEXT NOT NULL,
  languages TEXT NOT NULL DEFAULT '[]', bio TEXT NOT NULL DEFAULT '',
  experience_years INTEGER NOT NULL DEFAULT 1, travel_radius_km INTEGER NOT NULL DEFAULT 25,
  base_price_inr INTEGER NOT NULL DEFAULT 0, rating REAL NOT NULL DEFAULT 0,
  reviews_count INTEGER NOT NULL DEFAULT 0, gigs_done INTEGER NOT NULL DEFAULT 0,
  response_mins INTEGER NOT NULL DEFAULT 60, verified INTEGER NOT NULL DEFAULT 0,
  founding_artist INTEGER NOT NULL DEFAULT 0, cancellation_policy TEXT NOT NULL DEFAULT 'moderate',
  hue INTEGER NOT NULL DEFAULT 265, instagram TEXT, youtube TEXT,
  area TEXT NOT NULL DEFAULT '', available_now INTEGER NOT NULL DEFAULT 1,
  accepting_requests INTEGER NOT NULL DEFAULT 1, directory_id TEXT, portfolio_url TEXT,
  tagline TEXT NOT NULL DEFAULT '', layout_variant TEXT NOT NULL DEFAULT 'editorial',
  website TEXT, portfolio_items TEXT NOT NULL DEFAULT '[]', rider_note TEXT NOT NULL DEFAULT '',
  press_note TEXT NOT NULL DEFAULT '', accent_hue INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, auth_sub TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  email TEXT, phone TEXT, city TEXT, kind TEXT NOT NULL DEFAULT 'host',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

export const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
