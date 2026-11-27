const CACHE_NAME = "my-day-tracker-cloud-v7";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=1.2.3",
  "./app.js?v=1.2.3",
  "./day-plan.js?v=1.2.3",
  "./supabase-config.js",
  "./manifest.webmanifest",
  "./icons/checklist-180.png",
  "./icons/checklist-192.png",
  "./icons/checklist-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("my-day-tracker-cloud-") && key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
