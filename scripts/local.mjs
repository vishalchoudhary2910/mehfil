// Cross-platform local runner for the Worker and its demo database.
//
//   npm run seed:local     -> node scripts/local.mjs seed
//   npm run start          -> build, then node scripts/local.mjs dev
//   npm run dev:worker     -> node scripts/local.mjs dev
//
// One persist directory is chosen for both commands, so a fresh clone does not
// seed one database and start a different one. The old Windows shortcut
// (C:/mehfil-state) is gone; MEHFIL_STATE still overrides the location.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

// Windows still enforces MAX_PATH for some D1 side files. Long Freebuff-style
// checkout paths fall back to a short home-directory location; a normal clone
// keeps its state inside .wrangler/state as before.
function resolveState() {
  const override = (process.env.MEHFIL_STATE || "").trim();
  if (override) return path.resolve(override);
  const local = path.join(root, ".wrangler", "state");
  if (process.platform === "win32" && local.length > 150) {
    // Preserve the state created by the old hard-coded Windows shortcut, so an
    // existing checkout keeps its demo data instead of silently starting empty.
    const legacy = "C:/mehfil-state";
    if (existsSync(path.join(legacy, "v3"))) return legacy;
    return path.join(os.homedir(), ".mehfil", "state");
  }
  return local;
}

const state = resolveState();
const [command = "dev", ...args] = process.argv.slice(2);

const persistFlags = () => {
  const supplied = args.some((a) => a === "--persist-to" || a.startsWith("--persist-to="));
  return supplied ? [] : ["--persist-to", state];
};

function runWrangler(argv, { inherit = true } = {}) {
  return spawn(process.execPath, [wrangler, ...argv], {
    cwd: root,
    stdio: inherit ? "inherit" : "pipe",
    env: process.env,
  });
}

function fail(message) {
  console.error(`[mehfil] ${message}`);
  process.exit(1);
}

if (command === "state") {
  console.log(state);
  process.exit(0);
}

if (command === "seed") {
  console.log(`[mehfil] local state: ${state}`);
  for (const file of ["schema.sql", "seed.sql"]) {
    const filePath = path.join(root, file);
    console.log(`[mehfil] applying ${file}`);
    const result = spawnSync(
      process.execPath,
      [wrangler, "d1", "execute", "mehfil", "--local", "--persist-to", state, `--file=${filePath}`],
      { cwd: root, stdio: "inherit", env: process.env }
    );
    if (result.error) fail(result.error.message);
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log("[mehfil] local database ready — run `npm start` (or `npm run dev:worker`).");
  process.exit(0);
}

if (command === "dev") {
  const portIndex = args.findIndex((a) => a === "--port");
  const explicitPort =
    (portIndex >= 0 && args[portIndex + 1]) ||
    (args.find((a) => a.startsWith("--port=")) || "").split("=")[1];
  const devArgs = ["dev", ...persistFlags(), ...(explicitPort ? [] : ["--port", "8787"]), ...args];
  console.log(`[mehfil] local state: ${state}`);
  console.log(`[mehfil] http://127.0.0.1:${explicitPort || "8787"}`);
  const child = runWrangler(devArgs);
  child.on("error", (err) => fail(err.message));
  const forward = (signal) => {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
} else {
  console.error("Usage: node scripts/local.mjs <seed|dev|state> [...wrangler args]");
  process.exit(1);
}
