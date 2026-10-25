// Mehfil service worker — offline shell + immutable assets.
//
// Rules that keep a booking marketplace safe and cheap:
//   - /api, /auth, /cdn-cgi and any non-GET never touch the cache (sessions,
//     prices and messages are private; the API already sends no-store);
//   - navigations are network-first, and only the homepage shell becomes the
//     offline fallback — per-profile SSR HTML must never replace it;
//   - only same-origin /assets/* (hashed, immutable), icons and images are
//     cache-first; everything else uses the network;
//   - the static cache is trimmed so storage stays bounded.
const SHELL = "mehfil-shell-v2";
const STATIC = "mehfil-static-v2";
const MAX_STATIC = 120;

const isAPI = (url) =>
  url.pathname.startsWith("/api/") ||
  url.pathname.startsWith("/auth/") ||
  url.pathname.startsWith("/cdn-cgi/");

const isCacheableAsset = (url) =>
  url.pathname.startsWith("/assets/") ||
  /\.(png|jpe?g|webp|avif|svg|ico|woff2?)$/i.test(url.pathname);

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
          // Only the canonical shell may become the offline fallback. A
          // /artist/:slug response carries that act's title and must not
          // overwrite it (and would otherwise churn storage on every visit).
          if (res.ok && (url.pathname === "/" || url.pathname === "/index.html")) {
            const copy = res.clone();
            caches.open(SHELL).then((cache) => cache.put("/", copy)).catch(() => null);
          }
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error()))
    );
    return;
  }

  if (!isCacheableAsset(url)) return;

  // Static assets: cache first, fill on miss, trim to MAX_STATIC.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then(async (res) => {
        if (!res || res.status !== 200 || !res.ok) return res;
        if (res.headers.get("cache-control") === "no-store") return res;
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
