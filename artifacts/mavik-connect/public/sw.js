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
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Push notifications. The payload is always generic, never message
// content — see lib/push.ts on the server: messages are E2E encrypted, so
// the server never has plaintext to put here even if it wanted to, and
// wouldn't display it in an OS notification tray regardless.
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const title = payload.title || "Mavik Connect";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url || "/app" },
      tag: payload.url, // collapses repeat notifications for the same conversation
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    event.notification.data?.url || "/app",
    self.registration.scope,
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url === url && "focus" in client) return client.focus();
        }
        // Focus any existing app window and navigate it, rather than
        // always opening a new tab.
        for (const client of clients) {
          if ("navigate" in client && "focus" in client) {
            return client.navigate(url).then(() => client.focus());
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
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
