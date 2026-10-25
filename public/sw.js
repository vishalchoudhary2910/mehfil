// Mehfil service worker — offline shell + static assets.
//
// Rules that keep a booking marketplace safe:
//   - /api, /auth, /cdn-cgi and any non-GET never touch the cache (sessions,
//     prices and messages are private; the API already sends no-store);
//   - navigations are network-first with the SPA shell as the offline
//     fallback, so users always land on the React router;
//   - hashed /assets/* are cache-first (immutable by URL) and trimmed so the
//     cache cannot grow without bound; cross-origin requests are left alone.
const SHELL = "mehfil-shell-v1";
const STATIC = "mehfil-static-v1";
const MAX_STATIC = 160;

const isAPI = (url) =>
  url.pathname.startsWith("/api/") ||
  url.pathname.startsWith("/auth/") ||
  url.pathname.startsWith("/cdn-cgi/");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add("/").catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== STATIC).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET" || isAPI(url) || url.origin !== self.location.origin) return;

  // Navigations: network first, offline falls back to the cached SPA shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only a healthy shell may become the offline fallback.
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((cache) => cache.put("/", copy)).catch(() => null);
          }
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error()))
    );
    return;
  }

  // Static assets: cache first, fill on miss, trim to MAX_STATIC.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (!res || res.status !== 200 || !res.ok) return res;
        const copy = res.clone();
        caches
          .open(STATIC)
          .then(async (cache) => {
            await cache.put(req, copy);
            const keys = await cache.keys();
            if (keys.length > MAX_STATIC) await cache.delete(keys[0]);
          })
          .catch(() => null);
        return res;
      });
    })
  );
});
