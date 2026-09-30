/* DocuMind service worker: offline shell + Web Push notifications. */
const CACHE_NAME = "docmind-pwa-v11";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/offline.html",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.png",
  "/badge-96.png",
  "/docmind_logo.jpg"
];

// Update policy: a new version installs in the background and WAITS. It takes over on the next cold start (all tabs / the
// installed app closed) or when the page asks for it (the user tapped "Refresh" in the update banner -> SKIP_WAITING).
// There is deliberately NO automatic skipWaiting() here: it would swap caches and code under a page that is in use.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", (event) => {
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
//
// Everything that makes a phone show a push as a heads-up banner (not just a silent tray entry):
//  - the sender uses urgency "high" (see push-server/core.ts), so the device wakes and delivers immediately;
//  - silent:false + vibrate: Android plays the channel sound and vibrates (a notification without vibrate/sound is demoted to "silent");
//  - requireInteraction: stays on screen until the user reacts;
//  - a per-reminder tag + renotify:true: a repeat / snooze wake-up alerts again instead of silently replacing the old one;
//  - a monochrome badge (status bar) and a coloured icon.
// Keep in step with src/lib/notificationOptions.ts (tests/notificationOptions.test.ts runs this handler and checks both).
const VIBRATE_PATTERN = [300, 150, 300, 150, 600];
const ICON = "/icon-192.png";
const BADGE = "/badge-96.png";

// Display-side safety net (the server already formats: title = "[Category: ]reminder title", body = 2-3 short lines such as
// "Due: Thu, 15 Oct 2026 at 9:30 AM (in 1 hour)" + key detail). Here we only strip control characters, keep at most
// 3 lines and cut over-long text on a character boundary with an ellipsis so a bad payload can never flood the tray.
// Keep in step with cleanText / truncateText in src/lib/notificationText.ts.
function clipLine(text, max) {
  const chars = Array.from(String(text).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim());
  return chars.length <= max ? chars.join("") : chars.slice(0, max - 1).join("").trimEnd() + "\u2026";
}
function clipTitle(text) {
  return clipLine(text, 80);
}
function clipBody(text) {
  return String(text)
    .split(/\r\n|\r|\n/)
    .map((l) => clipLine(l, 90))
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "DocuMind reminder", body: event.data ? event.data.text() : "" };
  }
  if (!data || typeof data !== "object") data = {};
  const title = (typeof data.title === "string" && clipTitle(data.title)) || "DocuMind reminder";
  const body = (typeof data.body === "string" && clipBody(data.body)) || "You have a reminder due. Open DocuMind for details.";
  const reminderId = typeof data.reminderId === "string" ? data.reminderId : "";
  const isTest = data.test === true;
  const options = {
    body,
    icon: ICON,
    badge: BADGE,
    // tag == reminder id: the "due" / snooze push for a reminder replaces its earlier heads-up instead of stacking,
    // and renotify makes that replacement alert (sound + vibration + banner) again. Tests use a unique tag.
    tag: data.tag || reminderId || "docmind-reminder-" + Date.now(),
    renotify: true,
    silent: false,
    requireInteraction: true,
    vibrate: VIBRATE_PATTERN,
    timestamp: Date.now(),
    data: { reminderId, url: data.url || "/", dueAt: data.dueAt || null, test: isTest },
    actions: reminderId
      ? [
          { action: "snooze", title: "Snooze…" },
          { action: "done", title: "Mark done" }
        ]
      : []
  };
  event.waitUntil(
    (async () => {
      // Show first; only afterwards remember the event, so an alert that failed to show is never treated as delivered.
      await self.registration.showNotification(title, options);
      if (data.eventKey) {
        try {
          const c = await caches.open("docmind-fired");
          await c.put("/__fired/" + encodeURIComponent(data.eventKey), new Response("1"));
        } catch (e) {
          /* best effort */
        }
      }
    })()
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
        // The app applies the action itself. "snooze" opens the snooze picker (six choices), so it needs the app in front.
        c.postMessage(msg);
        if (action !== "done" && "focus" in c) await c.focus();
        return;
      }
      // App is closed: open it; it applies the action from the URL on start-up.
      const u = new URL(d.url || "/", self.location.origin);
      if (id) {
        if (action === "snooze") u.searchParams.set("snooze", id); // deep link: /?snooze=<reminderId>
        else if (action === "done") {
          u.searchParams.set("dm_action", "done");
          u.searchParams.set("dm_id", id);
        }
      }
      await self.clients.openWindow(u.pathname + u.search);
    })()
  );
});
