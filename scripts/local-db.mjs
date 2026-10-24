// D1-compatible shim over a local SQLite file.
//
// `wrangler dev --persist-to <dir>` keeps its data in a Miniflare SQLite file.
// This lets the real engine code (worker/talent.js, showfeed.js, …) run
// against that same file from Node — useful for backfilling a local demo or
// repairing a directory without a deploy.
import { DatabaseSync } from "node:sqlite";

const norm = (v) => {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
};

export function openD1(path, { readOnly = false } = {}) {
  const raw = new DatabaseSync(path, { readOnly });
  raw.exec("PRAGMA busy_timeout = 5000");
  const DB = {
    raw,
    prepare(sql) {
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async run() {
          const r = raw.prepare(sql).run(...args.map(norm));
          return {
            success: true,
            changes: Number(r.changes || 0),
            meta: { changes: Number(r.changes || 0), last_rowid: Number(r.lastInsertRowid || 0) },
          };
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
    close() { raw.close(); },
  };
  return DB;
}
