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

const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(OFFLINE_URL))
      .catch(() => {}) // don't fail install if this one fetch hiccups
      .then(() => self.skipWaiting()),
  );
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

// Reads the same "mavik-settings" IndexedDB store src/lib/quiet-hours.ts
// writes to. Duplicated here (rather than imported) because this is a
// classic, not module, service worker — see its registration in
// main.tsx. Never throws: any failure here just means "don't suppress",
// which is the safe default (a missed notification is worse than an
// unwanted one).
function getQuietHours() {
  return new Promise((resolve) => {
    const fallback = { enabled: false, startHour: 21, endHour: 7 };
    let req;
    try {
      req = indexedDB.open("mavik-settings", 1);
    } catch {
      return resolve(fallback);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("prefs")) {
        req.result.createObjectStore("prefs");
      }
    };
    req.onerror = () => resolve(fallback);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction("prefs", "readonly");
        const getReq = tx.objectStore("prefs").get("quietHours");
        getReq.onsuccess = () => {
          db.close();
          resolve(getReq.result || fallback);
        };
        getReq.onerror = () => {
          db.close();
          resolve(fallback);
        };
      } catch {
        resolve(fallback);
      }
    };
  });
}

function isWithinQuietHours(quietHours) {
  if (!quietHours.enabled) return false;
  const hour = new Date().getHours();
  const { startHour, endHour } = quietHours;
  if (startHour === endHour) return false;
  // Wraps past midnight, e.g. 21 -> 7.
  if (startHour > endHour) return hour >= startHour || hour < endHour;
  return hour >= startHour && hour < endHour;
}

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

  event.waitUntil(
    (async () => {
      // Calls always ring through — quiet hours only ever suppress
      // ordinary message pushes.
      if (payload.type !== "call") {
        const quietHours = await getQuietHours();
        if (isWithinQuietHours(quietHours)) return;
      }

      const title = payload.title || "Mavik Connect";
      return self.registration.showNotification(title, {
        body: payload.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url: payload.url || "/app" },
        tag: payload.url, // collapses repeat notifications for the same conversation
      });
    })(),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "mavik-outbox-flush") return;
  // The actual send happens in page context (src/hooks/use-offline-outbox.ts)
  // since it already has the app's authenticated API client wired up —
  // simplest to have every open client just run its own flush rather than
  // duplicating the send logic here. If no client is open, this is a
  // no-op; the online-event listener picks it up next time a tab opens.
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        client.postMessage({ type: "mavik-outbox-flush-requested" });
      }
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
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = await caches.match(
            new URL(".", self.registration.scope).href,
          );
          if (shell) return shell;
          return caches.match(OFFLINE_URL);
        }),
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
