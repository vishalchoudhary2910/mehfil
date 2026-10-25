// Run the real discovery engines against a local persisted D1 file.
//
//   npm run engines:local -- --db C:/path/to/miniflare.sqlite --scope talent
//   npm run engines:local -- --db … --scope all --queries 4 --details 8
//
// `--persist-to` (wrangler) stores data in
//   <dir>/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite
// With no --db the script looks there and in .wrangler/state.
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openD1 } from "./local-db.mjs";
import { ensureTalentSchema, runTalentRadar } from "../worker/talent.js";
import { ensureShowSchema, runShowFeed } from "../worker/showfeed.js";
import { ensureLeadsSchema, runLeadCron } from "../worker/leads.js";
import { ensureRequestSchema, runRequestFollowups } from "../worker/requests.js";
import { ensureJamSchema, runJamSweep } from "../worker/jam.js";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

function findDb() {
  const explicit = flag("db") || process.env.MEHFIL_SQLITE;
  if (explicit) return explicit;
  const roots = [
    process.env.MEHFIL_STATE && join(process.env.MEHFIL_STATE, "v3/d1/miniflare-D1DatabaseObject"),
    ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
    join(homedir(), ".mehfil", "state", "v3/d1/miniflare-D1DatabaseObject"),
    "C:/mehfil-state/v3/d1/miniflare-D1DatabaseObject", // legacy Windows shortcut
  ].filter(Boolean);
  for (const root of roots) {
    try {
      const hit = readdirSync(root).filter((f) => f.endsWith(".sqlite")).map((f) => join(root, f))
        .find((p) => statSync(p).size > 0);
      if (hit) return hit;
    } catch { /* try the next root */ }
  }
  return null;
}

const dbPath = findDb();
if (!dbPath) {
  console.error("No SQLite file found. Pass --db <path> (see README: local engine runs).");
  process.exit(1);
}

const env = { DB: openD1(dbPath), APP_ORIGIN: flag("origin", "http://127.0.0.1:8787") };
const scopes = String(flag("scope", "all")).split(",").map((s) => s.trim()).filter(Boolean);
const only = (s) => scopes.includes("all") || scopes.includes(s);

console.log(`Using ${dbPath}`);
const out = {};

if (only("talent")) {
  await ensureTalentSchema(env);
  out.talent = await runTalentRadar(env, {
    trigger: "local",
    maxQueries: Math.max(1, Math.min(Number(flag("queries", 2)) || 2, 8)),
    detailLimit: Math.max(1, Math.min(Number(flag("details", 4)) || 4, 10)),
    refreshLimit: Math.max(0, Math.min(Number(flag("refresh", 4)) || 0, 20)),
    detailDelayMs: 1100,
    silent: true,
  });
  console.log("talent:", JSON.stringify(out.talent));
}

if (only("shows")) {
  await ensureShowSchema(env);
  out.shows = await runShowFeed(env, { trigger: "local", silent: true });
  console.log("shows:", JSON.stringify(out.shows));
}

if (only("leads")) {
  await ensureLeadsSchema(env);
  out.leads = await runLeadCron(env, { trigger: "local", digest: false });
  console.log("leads:", JSON.stringify(out.leads));
}

if (only("requests")) {
  await ensureRequestSchema(env);
  out.requests = await runRequestFollowups(env, { trigger: "local", silent: true });
  console.log("requests:", JSON.stringify(out.requests));
}

if (only("jams")) {
  await ensureJamSchema(env);
  out.jams = await runJamSweep(env, { trigger: "local" });
  console.log("jams:", JSON.stringify(out.jams));
}

env.DB.close();
if (Object.values(out).some((r) => r && r.ok === false)) process.exitCode = 1;
