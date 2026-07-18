// Deliberately minimal service worker.
//
// Goals: make the app installable and let the shell load offline/on a flaky
// connection. Non-goals: caching anything dynamic. It must never make the
// app show stale data — messages, groups, auth state, etc. always come
// straight from the network exactly as if this file didn't exist.
//
// Bump CACHE_VERSION if you ever need to force every client to drop its
// cache (e.g. after a big static-asset restructuring). Ordinary deploys
// don't need this: Vite content-hashes JS/CSS filenames, so a new deploy
// simply requests new URLs the old cache never had.
const CACHE_VERSION = "v1";
const CACHE_NAME = `mavik-connect-${CACHE_VERSION}`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever handle simple GETs. Never touch the API — auth, messages,
  // key exchange, everything under /api/ (including the /api/ws upgrade)
  // must hit the network untouched.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.includes("/api/")) return;

  // App shell navigations: network-first, so a signed-in user always gets
  // the latest build when online. Falls back to a cached shell if offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(
          () =>
            caches.match(request).then((cached) => cached) ||
            caches.match(new URL(".", self.registration.scope).href),
        ),
    );
    return;
  }

  // Static assets: cache-first. Safe because Vite content-hashes filenames
  // — a cached response for a given URL is never stale for that URL.
  if (["style", "script", "image", "font"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      }),
    );
  }
});
