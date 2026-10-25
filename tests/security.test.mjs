import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers.mjs";
import {
  securityHeaders,
  applySecurityHeaders,
  hitRateLimit,
  enforceRateLimit,
  honeypotTripped,
  isSafeRemoteUrl,
  ldJson,
} from "../worker/security.js";
import { ingestIcalFeeds } from "../worker/showfeed.js";

// ---------------------------------------------------------------- headers --

test("security headers lock the app down over plain http", () => {
  const h = securityHeaders({ APP_ORIGIN: "http://127.0.0.1:8787" }, { html: true });
  assert.match(h["Content-Security-Policy"], /default-src 'self'/);
  assert.match(h["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(h["Content-Security-Policy"], /object-src 'none'/);
  assert.equal(h["X-Frame-Options"], "DENY");
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.equal(h["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(h["X-Robots-Tag"], "index, follow");
  assert.equal(h["Strict-Transport-Security"], undefined, "no HSTS on http dev");
});

test("HSTS is added only when the origin is https", () => {
  const h = securityHeaders({ APP_ORIGIN: "https://mehfil.example" });
  assert.match(h["Strict-Transport-Security"], /max-age=\d+/);
  assert.match(h["Strict-Transport-Security"], /includeSubDomains/);
});

test("applySecurityHeaders leaves a route's own headers alone", async () => {
  const original = new Response("hi", {
    headers: { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'none'" },
  });
  const out = applySecurityHeaders(original, { APP_ORIGIN: "https://mehfil.example" });
  assert.equal(out.headers.get("Content-Security-Policy"), "default-src 'none'");
  assert.equal(out.headers.get("X-Frame-Options"), "DENY");
  assert.equal(out.headers.get("X-Robots-Tag"), "index, follow");
  assert.equal(await out.text(), "hi");

  const json = applySecurityHeaders(
    Response.json({ ok: true }),
    { APP_ORIGIN: "https://mehfil.example" }
  );
  assert.equal(json.headers.get("X-Robots-Tag"), null, "JSON is not tagged as an indexable page");
  assert.equal(json.headers.get("X-Frame-Options"), "DENY");
  assert.equal(json.headers.get("Cache-Control"), "private, no-store");

  // A route that deliberately chose a cache policy keeps it.
  const cached = applySecurityHeaders(
    Response.json({ ok: true }, { headers: { "Cache-Control": "public, max-age=60" } }),
    { APP_ORIGIN: "https://mehfil.example" }
  );
  assert.equal(cached.headers.get("Cache-Control"), "public, max-age=60");
});

// -------------------------------------------------------------- rate limit --

test("fixed-window limit allows the budget then answers 429", async () => {
  const env = makeEnv();
  const now = 1_800_000_000_000;
  const key = "probe:abc";
  const opts = { key, limit: 2, windowSec: 60, now };

  assert.equal((await hitRateLimit(env, opts)).ok, true);
  assert.equal((await hitRateLimit(env, opts)).ok, true);
  const blocked = await hitRateLimit(env, opts);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= 60);

  // The next window starts clean.
  assert.equal((await hitRateLimit(env, { ...opts, now: now + 61_000 })).ok, true);
});

test("enforceRateLimit returns a 429 with Retry-After, hashed per client", async () => {
  const env = makeEnv({ APP_ORIGIN: "https://mehfil.example" });
  const call = (ip) =>
    enforceRateLimit(
      {
        env,
        req: { raw: new Request("https://mehfil.example/api/need", { headers: { "cf-connecting-ip": ip } }) },
      },
      { scope: "gig-brief", limit: 1, windowSec: 3600 }
    );

  assert.equal(await call("203.0.113.9"), null);
  const blocked = await call("203.0.113.9");
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  assert.equal(blocked.headers.get("Cache-Control"), "no-store");

  // A different client has its own bucket.
  assert.equal(await call("198.51.100.4"), null);
});

test("honeypot catches autofilled bait but not blank or absent fields", () => {
  assert.equal(honeypotTripped({ name: "Riya", website: "   " }), false);
  assert.equal(honeypotTripped({ name: "Riya" }), false);
  assert.equal(honeypotTripped({ name: "Riya", website: "https://spam.example" }), true);
  assert.equal(honeypotTripped({ fax: "12345" }), true);
});

test("JSON-LD cannot close its script tag from user data", () => {
  const html = ldJson({ name: "</script><img src=x onerror=alert(1)>", city: "Pune" });
  assert.equal(html.includes("</script><img"), false);
  assert.match(html, /\\u003c\/script/);
  assert.match(html, /^<script type="application\/ld\+json">/);
  assert.match(html, /<\/script>$/);
});

// -------------------------------------------------------------------- SSRF --

test("feed URLs must be public http(s) addresses", () => {
  for (const good of [
    "https://example.com/events.ics",
    "http://feeds.bbci.co.uk/news/rss.xml",
    "https://venue.example:443/calendar",
  ]) {
    assert.equal(isSafeRemoteUrl(good), true, good);
  }

  for (const bad of [
    "ftp://example.com/feed",
    "https://user:pass@example.com/feed",
    "https://example.com:8080/feed",
    "http://localhost:8787/api/me",
    "http://localhost./api/me",
    "http://127.0.0.1/",
    "http://2130706433/", // decimal 127.0.0.1
    "http://0x7f000001/", // hex 127.0.0.1
    "http://10.1.2.3/",
    "http://172.16.0.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "not a url",
    "",
  ]) {
    assert.equal(isSafeRemoteUrl(bad), false, bad);
  }
});

test("the feed fetcher refuses a redirect into private space", async () => {
  let calls = 0;
  const stats = await ingestIcalFeeds(
    {},
    ["https://feeds.example/calendar.ics"],
    {
      fetchImpl: async () => {
        calls++;
        return new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest" } });
      },
    }
  );
  assert.equal(calls, 1, "did not follow the redirect");
  assert.equal(stats.fetched, 0);
  assert.equal(stats.created, 0);
  assert.match(stats.errors.join(" "), /Unsafe feed URL/);
});

test("the feed fetcher never calls out to a blocked URL at all", async () => {
  let calls = 0;
  const stats = await ingestIcalFeeds(
    {},
    ["http://127.0.0.1:8787/secret"],
    {
      fetchImpl: async () => {
        calls++;
        return new Response("BEGIN:VCALENDAR", { status: 200 });
      },
    }
  );
  assert.equal(calls, 0);
  assert.match(stats.errors.join(" "), /Unsafe feed URL/);
});
