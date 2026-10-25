// Security middleware: response headers, abuse limits and bot traps.
//
// Everything here is deliberately dependency-free and D1-backed so a fresh
// clone behaves the same in local workerd and on the deployed Worker.

// ---------------------------------------------------------------- headers --

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://freebuff.com https://*.freebuff.com",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self' https://freebuff.com https://*.freebuff.com",
].join("; ");

// Keep in sync with the media features the app may ask for later (jam
// broadcasts use camera/mic); everything else is denied outright.
const PERMISSIONS = [
  "camera=(self)",
  "microphone=(self)",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
  "interest-cohort=()",
].join(", ");

export function securityHeaders(env, { html = false } = {}) {
  const origin = String(env.APP_ORIGIN || "");
  const headers = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS,
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Permitted-Cross-Domain-Policies": "none",
  };
  // Upgrade only where HTTPS actually exists: on localhost this header would
  // brick the dev preview for the next 6 months.
  if (origin.startsWith("https://")) {
    headers["Strict-Transport-Security"] = "max-age=15552000; includeSubDomains";
  }
  if (html) headers["X-Robots-Tag"] = "index, follow";
  return headers;
}

export function applySecurityHeaders(response, env) {
  if (!(response instanceof Response)) return response;
  // 304s must not gain a body; cloning the status and headers is enough.
  const out = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  const contentType = out.headers.get("Content-Type") || "";
  // Every JSON response is per-session data unless a route says otherwise;
  // this closes the gap left by routers with their own local json() helper.
  if (contentType.includes("application/json") && !out.headers.has("Cache-Control")) {
    out.headers.set("Cache-Control", "private, no-store");
  }
  for (const [key, value] of Object.entries(
    securityHeaders(env, { html: contentType.includes("text/html") })
  )) {
    // Never overwrite a route's deliberate choice (e.g. a route-level CSP).
    if (!out.headers.has(key)) out.headers.set(key, value);
  }
  return out;
}

// --------------------------------------------------------------- rate limit --

const DDL = `CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
)`;

// One CREATE TABLE per database instance, not per request. A WeakSet keeps
// separate environments (tests, preview, production) independent.
const schemaReady = new WeakSet();
export async function ensureRateLimitSchema(env) {
  if (schemaReady.has(env.DB)) return;
  await env.DB.prepare(DDL).run();
  schemaReady.add(env.DB);
}

// A pseudonymous, salted key: limits work without storing client IPs.
export async function clientKey(request, scope, env) {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "local";
  const bytes = new TextEncoder().encode(`${ip}|${env.APP_ORIGIN || ""}|${scope}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Fixed-window counter. One row per client+scope; increment is atomic.
export async function hitRateLimit(env, { key, limit, windowSec, now = Date.now() }) {
  await ensureRateLimitSchema(env);
  const bucket = Math.floor(now / 1000 / windowSec) * windowSec;
  let row = null;
  try {
    row = await env.DB.prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = excluded.window_start
                      THEN rate_limits.count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count, window_start`
    )
      .bind(key, bucket)
      .first();
  } catch {
    // Older SQLite builds without upsert-returning: plain read/write.
    const current = await env.DB.prepare("SELECT count, window_start FROM rate_limits WHERE key = ?")
      .bind(key)
      .first();
    const count = current && Number(current.window_start) === bucket ? Number(current.count) + 1 : 1;
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count = ?, window_start = ?"
    )
      .bind(key, bucket, count, count, bucket)
      .run();
    row = { count, window_start: bucket };
  }
  const count = Number(row?.count || 1);
  const start = Number(row?.window_start || bucket);
  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.max(1, start + windowSec - Math.floor(now / 1000)),
  };
}

// Returns a 429 Response when the caller is over budget, else null.
export async function enforceRateLimit(c, { scope, limit, windowSec }) {
  const key = `${scope}:${await clientKey(c.req.raw, scope, c.env)}`;
  const r = await hitRateLimit(c.env, { key, limit, windowSec });
  if (r.ok) return null;
  return Response.json(
    { error: "Too many attempts — please try again shortly." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(r.retryAfter),
      },
    }
  );
}

// JSON-LD is embedded in server-rendered HTML. Escaping `<` (as \u003c) keeps
// a user-supplied stage name from closing the script tag or injecting markup,
// even though CSP already refuses inline script.
export function ldJson(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

// ------------------------------------------------------------------- SSRF --

// The shows engine fetches feed URLs supplied through the console, so a feed
// URL is an outbound request we make on someone else's behalf. Only plain
// http(s) on standard ports, no credentials, and never a loopback, private,
// link-local or cloud-metadata host.
const PRIVATE_HOST =
  /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[0-2]\d)\.)/;

const BLOCKED_NAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "0.0.0.0",
]);

export function isSafeRemoteUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;

  // URL lowercases and resolves numeric/alternative IP spellings, so the
  // hostname here is already canonicalised.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || BLOCKED_NAMES.has(host)) return false;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  if (host === "::" || host === "::1") return false;
  // IPv4-mapped IPv6 literals would otherwise smuggle 127.0.0.1 past the
  // dotted-quad check.
  if (host.startsWith("::ffff:")) return false;
  if (/^(fc|fd|fe80|ff)[0-9a-f:]*$/i.test(host)) return false; // ULA, link-local, multicast
  if (PRIVATE_HOST.test(host)) return false;
  return true;
}

// Windows older than a day can never accept a request again; prune them so a
// long-lived deployment does not accumulate one row per client and scope.
export async function purgeRateLimits(env, olderThanSec = 86_400) {
  try {
    await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?")
      .bind(Math.floor(Date.now() / 1000) - olderThanSec)
      .run();
  } catch {
    // Table not created yet (or a read-only replica): nothing to prune.
  }
}

// ---------------------------------------------------------------- bot traps --

// Hidden form field humans never fill. Bots that autofill every input do.
// Deliberately checks a few common bait names.
export const honeypotTripped = (body) =>
  Boolean(
    String(body?.website || body?.company_url || body?.fax || "")
      .trim()
  );
