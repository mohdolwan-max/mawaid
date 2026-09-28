// Receives appointment-reminder pushes and opens the booking page on tap
// (registered from ReminderOptIn.tsx), and serves a branded offline page
// instead of Chrome's bare dinosaur when there is no connection — needed
// for the Android app wrapper (a TWA has no browser chrome to fall back
// on, so a failed navigation with nothing cached looks like a crash, not
// a missed connection). See developer.chrome.com/docs/android/trusted-
// web-activity, "Handling network failures".
//
// Deliberately caches ONLY the offline page and a few fixed brand images —
// never the app shell or its JS/CSS, which are rebuilt (new hashed
// filenames) on every deploy. Caching those would risk serving a stale,
// broken bundle after an update; this worker only steps in when there is
// no network at all, so a stale app shell is worse than none.
//
// The brand images are served cache-first because the launch intro
// (SplashIntro) repeats the native splash and must have its picture on the
// very first frame, even on a slow connection. Their names carry no hash,
// so replacing any of them means bumping CACHE.
const CACHE = "maw3ed-offline-v4"; // v4: wordmark lit like the symbol
const OFFLINE_URL = "/offline.html";
const BRAND_ASSETS = [
  "/brand/splash-symbol.webp",
  "/brand/wordmark-ar-teal.png",
  "/brand/symbol-128.png",
  "/brand/badge-96.png",
  "/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, ...BRAND_ASSETS])).then(() => self.skipWaiting())
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
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && BRAND_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
    return;
  }
  // Otherwise only page navigations: an intercepted API/RSC fetch would surface a
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
      // Android draws the badge as a one-colour silhouette; the full-colour
      // icon came out as a solid blob.
      badge: "/brand/badge-96.png",
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
