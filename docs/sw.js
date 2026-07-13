/* Card Vault service worker — offline app shell, fresh data.
   App shell is cache-first (fast, works offline). data.json is network-first
   (always try for the latest, fall back to cache when offline). */

var CACHE = "card-vault-v6";
var SHELL = ["./", "./index.html", "./styles.css?v=6", "./app.js?v=6",
             "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var url = e.request.url;
  if (e.request.method !== "GET") return;

  if (url.indexOf("data.json") !== -1) {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () { return caches.match(e.request); })
    );
    return;
  }

  e.respondWith(caches.match(e.request).then(function (hit) { return hit || fetch(e.request); }));
});
