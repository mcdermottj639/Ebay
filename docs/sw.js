/* Card Vault service worker.
   HTML navigations + data.json are network-first (so a new build's CSS/JS and
   the latest data load immediately when online, with a cached fallback when
   offline). Versioned assets (styles.css?v=N, app.js?v=N, icons) are
   cache-first — they're immutable per version, so a fresh build busts them via
   the bumped ?v and the always-fresh index.html that references them. */

var CACHE = "card-vault-v23";
var SHELL = ["./", "./index.html", "./styles.css?v=23", "./app.js?v=23",
             "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(e, fallback) {
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) { return hit || (fallback && caches.match(fallback)); });
    })
  );
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = req.url;

  // Latest data on every online load.
  if (url.indexOf("data.json") !== -1) { networkFirst(e); return; }

  // HTML shell: network-first so a new build's asset versions load right away
  // when online (no stale-CSS-after-ship), cached index.html when offline.
  if (req.mode === "navigate" || url.indexOf("index.html") !== -1 || url.replace(/[?#].*$/, "").endsWith("/")) {
    networkFirst(e, "./index.html");
    return;
  }

  // Versioned assets + icons: cache-first (fast, offline).
  e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
});
