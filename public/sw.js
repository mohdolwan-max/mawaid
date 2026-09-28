// Receives appointment-reminder pushes and opens the booking page on tap
// (registered from ReminderOptIn.tsx), and serves a branded offline page
// instead of Chrome's bare dinosaur when there is no connection — needed
// for the Android app wrapper (a TWA has no browser chrome to fall back
// on, so a failed navigation with nothing cached looks like a crash, not
// a missed connection). See developer.chrome.com/docs/android/trusted-
// web-activity, "Handling network failures".
//
// Deliberately caches ONLY the offline page and the notification icon —
// never the app shell or its JS/CSS, which are rebuilt (new hashed
// filenames) on every deploy. Caching those would risk serving a stale,
// broken bundle after an update; this worker only steps in when there is
// no network at all, so a stale app shell is worse than none.
const CACHE = "maw3ed-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/icon-192.png"])).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Only page navigations: an intercepted API/RSC fetch would surface a
  // cached offline page as if it were real data instead of a network
  // error the app already knows how to show.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL).then((res) => res || Response.error()))
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "موعد", body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "موعد", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      dir: "rtl",
      lang: "ar",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
