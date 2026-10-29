/* Card Vault service worker.
   HTML navigations + data.json are network-first (so a new build's CSS/JS and
   the latest data load immediately when online, with a cached fallback when
   offline). Versioned assets (vault.css?v=N, app.js?v=N, icons) are
   cache-first — they're immutable per version, so a fresh build busts them via
   the bumped ?v and the always-fresh index.html that references them.
   Google Fonts are kept in their own cache so the vault keeps its type
   offline; that cache survives version bumps. */

var CACHE = "card-vault-v65";
var FONT_CACHE = "card-vault-fonts";
var SHELL = ["./", "./index.html", "./vault.css?v=65", "./selling.js?v=65", "./charts.js?v=65",
             "./app.js?v=65", "./manifest.webmanifest?v=65", "./icon.svg?v=65"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== FONT_CACHE; }).map(function (k) { return caches.delete(k); }));
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

  // Fonts: serve the saved copy, refresh it in the background.
  if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) {
    e.respondWith(caches.open(FONT_CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    }));
    return;
  }

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
