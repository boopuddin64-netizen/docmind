/* DocuMind service worker: offline shell + Web Push notifications. */
const CACHE_NAME = "docmind-pwa-v3";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/offline.html",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.png",
  "/docmind_logo.jpg"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Add one by one so a single missing asset does not abort the whole precache.
      await Promise.all(
        ASSETS_TO_CACHE.map((url) =>
          cache.add(url).catch((err) => console.warn("SW precache skipped", url, err && err.message))
        )
      );
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME && n !== "docmind-fired").map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function isCacheableStatic(url) {
  return url.pathname.startsWith("/assets/") || ASSETS_TO_CACHE.includes(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Page navigations: network first, then cached shell, then the offline page. Always resolves to a Response.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put("/", copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          return (
            (await caches.match("/")) ||
            (await caches.match("/index.html")) ||
            (await caches.match("/offline.html")) ||
            new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
          );
        })
    );
    return;
  }

  // Built assets / icons: stale-while-revalidate. Everything else (e.g. Vite dev modules) is left to the network.
  if (!isCacheableStatic(url)) return;
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});

// ───────────── Web Push ─────────────

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "DocuMind", body: event.data ? event.data.text() : "You have a reminder." };
  }
  const title = data.title || "DocuMind reminder";
  const reminderId = data.reminderId || "";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/favicon.png",
    // tag == reminder id: a later "due" push replaces the earlier heads-up for the same reminder instead of stacking,
    // and also replaces the identical alert shown by the open page.
    tag: data.tag || reminderId || "docmind-reminder",
    renotify: true,
    requireInteraction: true,
    data: { reminderId, url: data.url || "/", dueAt: data.dueAt || null },
    actions: reminderId
      ? [
          { action: "snooze", title: "Snooze 1h" },
          { action: "done", title: "Mark done" }
        ]
      : []
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Remember the event so the page does not show the same alert again when it is reopened.
      data.eventKey
        ? caches
            .open("docmind-fired")
            .then((c) => c.put("/__fired/" + encodeURIComponent(data.eventKey), new Response("1")))
            .catch(() => {})
        : Promise.resolve()
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  n.close();
  const d = n.data || {};
  const action = event.action === "snooze" || event.action === "done" ? event.action : "open";
  const id = d.reminderId || "";

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const msg = { type: "docmind-notification-action", action, reminderId: id };
      if (clientsList.length > 0) {
        const c = clientsList.find((x) => x.focused) || clientsList[0];
        // Actions (snooze / done) are applied by the app itself; focus only for a plain open.
        c.postMessage(msg);
        if (action === "open" && "focus" in c) await c.focus();
        return;
      }
      // App is closed: open it; it applies the action from the URL on start-up.
      const base = d.url || "/";
      const u = new URL(base, self.location.origin);
      if (action !== "open" && id) {
        u.searchParams.set("dm_action", action);
        u.searchParams.set("dm_id", id);
      }
      await self.clients.openWindow(u.pathname + u.search);
    })()
  );
});
