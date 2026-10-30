/* Card Vault — client-side app. Reads inlined window.__CARD_DATA__ (preview)
   or fetches ./data.json (on GitHub Pages). Renders a tabbed, card-based PWA. */

(function () {
  "use strict";

  var APP_VERSION = "v66";
  var state = { tab: "today", data: null, bucket: "All",
                q: "", sort: "val-desc", sellMode: "plan", buyMode: "radar", planFilter: "all", inventoryStatus: "all", inventorySport: "all", inventoryType: "all", inventoryTier: "all", inventoryLayout: "grid",
                radarFilter: { type: "all", sport: "all", graded: "all", grade: "all" } };

  // ---------- helpers ----------
  function el(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function money(n) { return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(n) { return "$" + Math.round(Number(n || 0)).toLocaleString(); }
  function num(v) { var n = parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? 0 : n; }
  function copyText(t) { try { if (navigator.clipboard) navigator.clipboard.writeText(t); } catch (e) {} }
  function flashBtn(btn, msg) { var o = btn.innerHTML; btn.textContent = msg; setTimeout(function () { btn.innerHTML = o; }, 1900); }

  // ---------- My numbers (owner-entered cost + real sold prices) ----------
  // eBay denied us the sold-comps API, so the truest data is what the owner
  // records themself: what a card actually cost, and real sold prices seen on
  // Terapeak / Product Research first, then eBay sold search as fallback. Entries save instantly on this
  // device (localStorage) and merge with entries already baked into the sheet
  // (card.my_sales from data.json). "Send to Claude" makes device entries
  // permanent in the spreadsheet — then they show on every device.
  var MYDATA_KEY = "cv-mydata";
  function loadMyData() {
    try {
      var d = JSON.parse(localStorage.getItem(MYDATA_KEY) || "{}");
      return { costs: d.costs || {}, sales: d.sales || {}, sold: d.sold || {},
               touched: d.touched || 0, synced: d.synced || 0 };
    } catch (e) { return { costs: {}, sales: {}, sold: {}, touched: 0, synced: 0 }; }
  }
  function saveMyData() { try { localStorage.setItem(MYDATA_KEY, JSON.stringify(myData)); } catch (e) {} }
  // A real edit by the owner: marks this phone's copy newer than the sheet's,
  // which is what tells the box whether there is anything left to save.
  function touchMyData() { myData.touched = Date.now(); saveMyData(); }
  var myData = loadMyData();

  // Merge device entries into the loaded data. Idempotent: raw sheet values
  // are kept on the card (_csvCost/_bakedSales) so re-running after an edit
  // can't double-apply. Also prunes device entries that have since been baked
  // into the sheet, so the "send to Claude" count stays honest.
  function recalcMyData() {
    var data = state.data;
    if (!data) return;
    var dirty = false;
    data.cards.forEach(function (c) {
      if (c._csvCost === undefined) c._csvCost = c.cost;
      if (!c._bakedSales) c._bakedSales = (c.my_sales || []).slice();
      // cost: the sheet wins; a device-entered cost fills a blank sheet cost
      if (num(c._csvCost) > 0 && myData.costs[c.sku]) { delete myData.costs[c.sku]; dirty = true; }
      // A sale the owner marked on THIS device has to retire the card right
      // away. v38 stored it but only ever PRUNED it here, so `c.sold` stayed
      // false until the sheet caught up — and every `!c.sold` filter kept the
      // card in the Collection for those ~2 minutes. That is precisely the
      // "marked sold but still sitting in my collection" report. Remember the
      // baked values first so this stays idempotent and undo can restore them.
      if (c._csvSold === undefined) {
        c._csvSold = !!c.sold; c._csvSoldPrice = c.sold_price;
        c._csvSoldDate = c.sold_date; c._csvListed = c.listed;
      }
      // NB: test the BAKED flag, never the live one — after the block below
      // `c.sold` may be true because of the device entry we are about to sync,
      // and pruning on that would delete it before it ever reached the sheet.
      if (c._csvSold && myData.sold[c.sku]) { delete myData.sold[c.sku]; dirty = true; }
      var mineSale = myData.sold[c.sku];
      if (!c._csvSold && mineSale && num(mineSale.p) > 0) {
        c.sold = true; c.sold_price = String(num(mineSale.p));
        c.sold_date = mineSale.d || ""; c.listed = ""; c.sold_local = true;
      } else {
        c.sold = c._csvSold; c.sold_price = c._csvSoldPrice;
        c.sold_date = c._csvSoldDate; c.listed = c._csvListed; c.sold_local = false;
      }
      var localCost = num(myData.costs[c.sku]);
      c.cost = num(c._csvCost) > 0 ? c._csvCost : (localCost > 0 ? String(localCost) : c._csvCost);
      c.cost_local = num(c._csvCost) <= 0 && localCost > 0;
      // sales: sheet entries + device entries, deduped on date|price
      var baked = {};
      c._bakedSales.forEach(function (s) { baked[(s.d || "") + "|" + s.p] = 1; });
      var local = (myData.sales[c.sku] || []).filter(function (s) { return !baked[(s.d || "") + "|" + s.p]; });
      if (local.length !== (myData.sales[c.sku] || []).length) {
        if (local.length) myData.sales[c.sku] = local; else delete myData.sales[c.sku];
        dirty = true;
      }
      c.my_sales_all = c._bakedSales.map(function (s) { return { d: s.d, p: s.p, n: s.n || "" }; })
        .concat(local.map(function (s) { return { d: s.d, p: s.p, n: s.n || "", local: true }; }))
        .sort(function (a, b) { return String(a.d).localeCompare(String(b.d)); });
    });
    if (dirty) saveMyData();
    // profit tiles react to device-entered costs too (same rule as the build:
    // only cards with a known cost count toward profit).
    // The money has to move with the card, or it disappears from the
    // Collection without turning up in revenue. Recomputed from a one-time
    // snapshot of the baked summary, so repeat calls (and undo) are exact.
    var sm = data.summary;
    if (!data._baseSummary) {
      data._baseSummary = { total_value: num(sm.total_value), revenue: num(sm.revenue),
        realized_profit: num(sm.realized_profit), sold: sm.sold | 0, listed: sm.listed | 0 };
    }
    var bs = data._baseSummary, dVal = 0, dRev = 0, dReal = 0, dSold = 0, dList = 0;
    data.cards.forEach(function (c) {
      if (!c.sold_local) return;
      dVal -= num(c.asking_price);
      dRev += num(c.sold_price);
      dReal += num(c.sold_price) - num(c.cost);
      dSold += 1;
      if (String(c._csvListed || "").toLowerCase() === "yes") dList -= 1;
    });
    sm.total_value = Math.round((bs.total_value + dVal) * 100) / 100;
    sm.revenue = Math.round((bs.revenue + dRev) * 100) / 100;
    sm.realized_profit = Math.round((bs.realized_profit + dReal) * 100) / 100;
    sm.sold = bs.sold + dSold;
    sm.listed = Math.max(0, bs.listed + dList);

    var costed = data.cards.filter(function (c) { return !c.sold && num(c.asking_price) > 0 && num(c.cost) > 0; });
    data.summary.cost_count = costed.length;
    // Held cards only — must match build_web and the Est. profit tile beside it.
    data.summary.total_cost = Math.round(data.cards.reduce(
      function (a, c) { return c.sold ? a : a + num(c.cost); }, 0) * 100) / 100;
    data.summary.profit = Math.round(costed.reduce(function (a, c) { return a + num(c.asking_price) - num(c.cost); }, 0) * 100) / 100;
  }

  // Real SOLD reference from the owner's tracked sales — median of the most
  // recent 5. null when nothing is tracked for this card.
  function mySold(c) {
    var s = c.my_sales_all || c.my_sales || [];
    if (!s.length) return null;
    var vals = s.slice(-5).map(function (x) { return num(x.p); })
      .filter(function (p) { return p > 0; }).sort(function (a, b) { return a - b; });
    if (!vals.length) return null;
    var mid = Math.floor(vals.length / 2);
    var med = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    return { median: med, count: s.length, last: s[s.length - 1].d || "" };
  }

  // how many device entries haven't made it into the sheet yet
  function pendingCount() {
    var n = 0;
    Object.keys(myData.costs).forEach(function (k) { if (num(myData.costs[k]) > 0) n++; });
    Object.keys(myData.sales).forEach(function (k) { n += (myData.sales[k] || []).length; });
    Object.keys(myData.sold).forEach(function (k) { if (num((myData.sold[k] || {}).p) > 0) n++; });
    return n;
  }

  // ---- One-tap save: the app commits data/my_numbers.json to the repo ----
  // With a GitHub key saved (once, on this device), "Save to my sheet" writes
  // entries straight to GitHub — the Pages build then bakes them into
  // data.json for every device. No Claude step needed. The key never leaves
  // this device (localStorage only).
  var GHTOKEN_KEY = "cv-gh-token";
  var GH_API = "https://api.github.com/repos/mcdermottj639/Ebay/contents/data/my_numbers.json";
  function ghToken() { try { return localStorage.getItem(GHTOKEN_KEY) || ""; } catch (e) { return ""; } }
  function b64utf8(s) { return btoa(unescape(encodeURIComponent(s))); }
  function ghHeaders() {
    return { "Authorization": "Bearer " + ghToken(), "Accept": "application/vnd.github+json",
             "Content-Type": "application/json" };
  }
  // Read the current file (sha + other devices' entries), merge ours in, PUT.
  function ghSaveMyNumbers(done) {
    fetch(GH_API + "?ref=main", { headers: ghHeaders() })
      .then(function (r) {
        if (r.status === 404) return { sha: null, json: { costs: {}, sales: {}, sold: {} }, text: null };
        if (!r.ok) throw new Error("GitHub said " + r.status);
        return r.json().then(function (f) {
          var json = {};
          try { json = JSON.parse(decodeURIComponent(escape(atob(String(f.content || "").replace(/\n/g, ""))))); }
          catch (e) {}
          var was = { costs: json.costs || {}, sales: json.sales || {}, sold: json.sold || {} };
          return { sha: f.sha, json: was, text: JSON.stringify(was, null, 2) + "\n" };
        });
      })
      .then(function (cur) {
        var out = cur.json;
        Object.keys(myData.costs).forEach(function (sku) {
          if (num(myData.costs[sku]) > 0) out.costs[sku] = num(myData.costs[sku]);
        });
        Object.keys(myData.sold).forEach(function (sku) {
          if (num(myData.sold[sku].p) > 0) out.sold[sku] = myData.sold[sku];
        });
        Object.keys(myData.sales).forEach(function (sku) {
          var have = (out.sales[sku] = out.sales[sku] || []);
          (myData.sales[sku] || []).forEach(function (s) {
            var dup = have.some(function (x) { return (x.d || "") === (s.d || "") && num(x.p) === num(s.p); });
            if (!dup) have.push({ d: s.d || "", p: s.p });
          });
        });
        var text = JSON.stringify(out, null, 2) + "\n";
        // already identical in the sheet — a PUT here just makes an empty commit
        if (text === cur.text) return null;
        var body = { message: "Card Vault app: save my numbers",
                     content: b64utf8(text), branch: "main" };
        if (cur.sha) body.sha = cur.sha;
        return fetch(GH_API, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
      })
      .then(function (r) {
        if (r && !r.ok) throw new Error("GitHub said " + r.status);
        myData.synced = Date.now();
        saveMyData();
        done(null);
      })
      .catch(function (e) { done(e); });
  }

  // the message "Send to Claude" ships — Claude writes it into the sheet
  function syncMessage() {
    var lines = [];
    Object.keys(myData.costs).sort().forEach(function (sku) {
      if (num(myData.costs[sku]) > 0) lines.push(sku + " — cost $" + myData.costs[sku]);
    });
    Object.keys(myData.sold).sort().forEach(function (sku) {
      var s = myData.sold[sku];
      if (num(s.p) > 0) lines.push(sku + " — I SOLD IT for $" + s.p + (s.d ? " on " + s.d : ""));
    });
    Object.keys(myData.sales).sort().forEach(function (sku) {
      (myData.sales[sku] || []).forEach(function (s) {
        lines.push(sku + " — comp: someone else sold one for $" + s.p +
                   (s.d ? " on " + s.d : "") + (s.n ? " (" + s.n + ")" : ""));
      });
    });
    return "Save these numbers into my Card Vault sheet, then rebuild and ship the app.\n" +
      "· “cost” → the cost column of data/inventory.csv\n" +
      "· “I SOLD IT” → MY OWN sale: set sold_price + sold_date and clear listed in " +
      "data/inventory.csv, so it leaves the collection and lands in revenue\n" +
      "· “comp” → someone else's sale, for data/manual_sales.csv — it prices the card, " +
      "I still own it\n\n" + lines.join("\n");
  }

  // ---------- Sell-first workspace ----------
  var Selling = window.CardVaultSelling;
  function readWorkspace() {
    try { var d=JSON.parse(localStorage.getItem('cv-selling-v1')||'{}'); return {limit:[5,10,25,50].indexOf(d.limit)>=0?d.limit:25,includeSpecial:d.includeSpecial===true,plans:d.plans||{},lots:Array.isArray(d.lots)?d.lots:[]}; }
    catch(e) { return {limit:25,includeSpecial:false,plans:{},lots:[]}; }
  }
  var workspace=readWorkspace(), selectedLot={}, modalFocus=null;
  function saveWorkspace() {
    try { localStorage.setItem('cv-selling-v1',JSON.stringify(workspace)); return true; }
    catch(e) { toast('Could not save on this device. Your browser storage may be full.'); return false; }
  }
  // =====================================================================
  // v64 — Gold vault. Every number travels with a visual, and everything
  // is tappable for the detail behind it. Charts are drawn at their real
  // pixel width (hydrate) so their text stays legible on any screen.
  // =====================================================================
  var Charts = window.CardVaultCharts;
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var TIERS = { t1: { label: "$100+", cls: "tier-1" }, t2: { label: "$25–$99", cls: "tier-2" }, t3: { label: "Under $25", cls: "tier-3" } };
  var BASIS = { real: { label: "Sold prices", cls: "conf-1" }, psa: { label: "PSA", cls: "conf-2" }, est: { label: "Estimated", cls: "conf-3" }, ask: { label: "Asking", cls: "conf-4" } };

  function icon(name) {
    var paths = {
      today: '<rect x="3" y="3.5" width="18" height="17" rx="3"/><circle cx="12" cy="12" r="4.2"/><path d="M12 7.8v1.4M12 14.8v1.4M7.8 12h1.4M14.8 12h1.4"/>',
      sell: '<path d="M20 13l-7 7a2 2 0 0 1-3 0l-7-7V3h10l7 7a2 2 0 0 1 0 3Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
      collection: '<rect x="8" y="3" width="12" height="16" rx="2"/><path d="M5 6.5v12A2.5 2.5 0 0 0 7.5 21H15"/>',
      radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
      value: '<path d="M4 20h16"/><path d="M5 15.5 9.5 11l3.5 3 6-7"/><path d="M15 7h4v4"/>',
      arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
      chevron: '<path d="m9 6 6 6-6 6"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.4"/>',
      settings: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.4"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
      moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
      stack: '<rect x="6" y="3" width="12" height="16" rx="2"/><path d="M3 7v13a2 2 0 0 0 2 2h10"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
      list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.5M3.5 12h.5M3.5 18h.5"/>',
      share: '<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
      external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
      pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>'
    };
    return '<svg class="cv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (paths[name] || paths.arrow) + "</svg>";
  }

  // ---------- small data helpers ----------
  function heldCards() { return state.data.cards.filter(Selling.held); }
  function pricedHeld() { return heldCards().filter(function (c) { return (Selling.reference(c) || 0) > 0; }); }
  function findCard(sku) { return state.data.cards.filter(function (c) { return c.sku === sku; })[0]; }
  function series(c) { return (c.price_series || []).filter(function (p) { return p && typeof p.p === "number"; }); }
  // A card whose value now comes from sold prices the owner recorded carries
  // the older estimate's history, so that line describes a different number.
  function overlaid(c) { return c.est_price !== "" && c.est_price != null; }
  // Trend lines on tiles and rows: only the stretch since the last
  // re-pricing, so a correction is never drawn as the card rising or falling.
  function trendSeries(c) {
    if (c.sold || overlaid(c)) return [];
    var s = series(c), cut = 0;
    s.forEach(function (p, i) { if (p.c) cut = i; });
    return s.slice(cut);
  }
  function tierKey(c) { var v = Selling.reference(c) || 0; return v >= 100 ? "t1" : v >= 25 ? "t2" : "t3"; }
  function sumRef(cards) { return Math.round(cards.reduce(function (n, c) { return n + (Selling.reference(c) || 0); }, 0) * 100) / 100; }
  function tierSegments(cards) {
    return ["t1", "t2", "t3"].map(function (k) {
      var list = cards.filter(function (c) { return (Selling.reference(c) || 0) > 0 && tierKey(c) === k; });
      return { key: k, label: TIERS[k].label, cls: TIERS[k].cls, value: sumRef(list), count: list.length };
    });
  }
  function basisKey(c) {
    if (c.reviewed_price || c.price_basis === "sold") return "real";
    if (c.price_basis === "psa") return "psa";
    if (c.price_basis === "est_sold") return "est";
    return "ask";
  }
  function basisSegments(cards) {
    return ["real", "psa", "est", "ask"].map(function (k) {
      var list = cards.filter(function (c) { return basisKey(c) === k; });
      return { key: k, label: BASIS[k].label, cls: BASIS[k].cls, value: sumRef(list), count: list.length };
    });
  }
  function shortName(c) {
    var p = String(c.player || "");
    if (p.indexOf("/") >= 0) return p.split("/").map(function (x) { var w = x.trim().split(/\s+/); return w[w.length - 1]; }).join(" / ");
    var w = p.trim().split(/\s+/);
    return w.length > 1 && !/^(jr|sr|ii|iii)\.?$/i.test(w[w.length - 1]) ? w[w.length - 1] : p;
  }
  function subline(c) {
    if (c.is_merch) return [c.item_type, c.team].filter(Boolean).join(", ") || "Memorabilia";
    return String(c.line || "").replace(/^(\d{4}) Panini /, "$1 ");
  }
  function moverCards() {
    return heldCards().filter(function (c) {
      return num(c.prev_price) > 0 && num(c.asking_price) > 0 && Math.abs(num(c.asking_price) - num(c.prev_price)) / num(c.prev_price) >= 0.005;
    }).sort(function (a, b) {
      return Math.abs(num(b.asking_price) / num(b.prev_price) - 1) - Math.abs(num(a.asking_price) / num(a.prev_price) - 1);
    });
  }
  function historyPoints() {
    return (state.data.history || []).filter(function (p) { return p && typeof p.v === "number"; })
      .map(function (p) { return { d: p.d, v: p.v, c: p.c }; });
  }
  function sparkline(s, w, h, o) { return Charts.sparkline(s, w, h, o); }

  // ---------- charts in the DOM ----------
  function chartSlot(cls, draw) { var s = el('<div class="js-chart ' + (cls || "") + '"></div>'); s._draw = draw; return s; }
  function hydrate(root) {
    (root || document).querySelectorAll(".js-chart").forEach(function (s) {
      if (typeof s._draw !== "function") return;
      var w = Math.floor(s.clientWidth);
      if (w < 40 || s._w === w) return;
      var first = s._w === undefined;
      s._w = w;
      var out = s._draw(w);
      s.innerHTML = typeof out === "string" ? out : "";
      if (out && typeof out !== "string") s.appendChild(out);
      if (first && !reduceMotion && s.classList.contains("animate")) { var svg = s.querySelector("svg"); if (svg) svg.classList.add("drawing"); }
      if (s._after) s._after(s);
    });
  }
  var resizeTimer = null;
  window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { hydrate(document); }, 140); });

  function areaSlot(points, o) {
    o = o || {};
    var s = chartSlot("area-slot" + (o.cls ? " " + o.cls : "") + (o.animate ? " animate" : ""), function (w) {
      var r = Charts.areaChart(points, { w: w, h: o.h || 180, label: o.label, padL: o.padL, tickFmt: o.tickFmt });
      s._pts = r.points;
      return r.svg || '<p class="ch-empty">' + esc(o.empty || "The line starts once there are two snapshots.") + "</p>";
    });
    s._after = function () { wireCrosshair(s, o); };
    return s;
  }
  // Crosshair + tooltip: tap or drag across the line, or use the arrow keys.
  // The tooltip only adds precision; every value is also in the table twin.
  function wireCrosshair(s, o) {
    var svg = s.querySelector("svg"), pts = s._pts || [];
    if (!svg || pts.length < 2) return;
    var cross = svg.querySelector(".ch-cross"), line = cross.querySelector("line"), dot = cross.querySelector("circle");
    var tip = el('<div class="ch-tip" hidden></div>');
    s.appendChild(tip);
    var fmt = o.fmt || money0, cur = -1;
    s.tabIndex = 0;
    s.setAttribute("role", "group");
    s.setAttribute("aria-label", (o.label || "Chart") + ". Use the left and right arrow keys to read each point.");
    function show(i) {
      if (i < 0 || i >= pts.length) return;
      cur = i;
      var p = pts[i];
      cross.style.display = "";
      line.setAttribute("x1", p.x); line.setAttribute("x2", p.x);
      dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y);
      tip.innerHTML = "";
      var b = document.createElement("b"); b.textContent = fmt(p.v);
      var sp = document.createElement("span"); sp.textContent = Charts.shortDate(p.d) + (p.c ? ", re-priced" : "");
      tip.appendChild(b); tip.appendChild(sp);
      tip.hidden = false;
      tip.style.left = Math.max(48, Math.min(s.clientWidth - 48, p.x)) + "px";
      tip.style.top = Math.max(20, p.y) + "px";
    }
    function hide() { cross.style.display = "none"; tip.hidden = true; cur = -1; }
    function at(e) { var r = svg.getBoundingClientRect(); show(Charts.nearest(pts, e.clientX - r.left)); }
    svg.addEventListener("pointermove", at);
    svg.addEventListener("pointerdown", at);
    svg.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") hide(); });
    s.onkeydown = function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        show(cur < 0 ? pts.length - 1 : Math.max(0, Math.min(pts.length - 1, cur + (e.key === "ArrowRight" ? 1 : -1))));
      } else if (e.key === "Home") { e.preventDefault(); show(0); }
      else if (e.key === "End") { e.preventDefault(); show(pts.length - 1); }
    };
    s.onblur = hide;
  }
  function twinTable(hist, valueHead, summary) {
    var d = el('<details class="twin"><summary></summary><table class="twin-table"><thead><tr><th>Date</th><th></th></tr></thead><tbody></tbody></table></details>');
    d.querySelector("summary").textContent = summary || "See the numbers";
    d.querySelectorAll("th")[1].textContent = valueHead || "Vault value";
    var tb = d.querySelector("tbody");
    hist.slice().reverse().forEach(function (p) {
      var tr = document.createElement("tr"), a = document.createElement("td"), b = document.createElement("td");
      a.textContent = savedDate(p.d) + (p.c ? " (re-priced)" : "");
      b.textContent = money0(p.v);
      tr.appendChild(a); tr.appendChild(b); tb.appendChild(tr);
    });
    return d;
  }
  // Numbers count up once when a screen opens (skipped for reduced motion).
  function countUp(root) {
    if (reduceMotion || document.visibilityState === "hidden") return;
    root.querySelectorAll("[data-count]").forEach(function (n) {
      var to = Number(n.getAttribute("data-count")), fmt = n.getAttribute("data-fmt") || "money0", final = n.textContent;
      if (!isFinite(to) || to <= 0) return;
      var t0 = null;
      function f(v) { return fmt === "int" ? String(Math.round(v)) : money0(v); }
      function step(ts) {
        if (t0 === null) t0 = ts;
        var k = Math.min(1, (ts - t0) / 950), e = 1 - Math.pow(1 - k, 3);
        n.textContent = k < 1 ? f(to * e) : final;
        if (k < 1) requestAnimationFrame(step);
      }
      n.textContent = f(0);
      requestAnimationFrame(step);
    });
  }
  function openInfo(title, sub, body) {
    var m = showWorkspaceModal('<div class="sheet-head"><h2 id="workspaceTitle">' + esc(title) + "</h2>" + (sub ? "<p>" + esc(sub) + "</p>" : "") + '</div><div class="sheet-body"></div>');
    m.className = "modal info-modal";
    var b = m.querySelector(".sheet-body");
    (Array.isArray(body) ? body : [body]).forEach(function (x) {
      if (!x) return;
      if (typeof x === "string") b.insertAdjacentHTML("beforeend", x); else b.appendChild(x);
    });
    hydrate(m);
    return m;
  }

  // ---------- card art, slabs, tiles ----------
  function teamColors(team) { return TEAM_COLORS[team] || ["#6b4f1b", "#1a1206"]; }
  function artFace(c) {
    var col = teamColors(c.team);
    var meta = c.is_merch ? (c.item_type || "Memorabilia") : [c.year, c.set].filter(Boolean).join(" ");
    return '<span class="art-face" aria-hidden="true" style="--team1:' + col[0] + ";--team2:" + col[1] + '"><span class="art-ini">' + esc(initials(c.player)) + "</span>" + (meta ? '<span class="art-meta">' + esc(meta) + "</span>" : "") + "</span>";
  }
  function thumb(c, cls) {
    return '<span class="thumb ' + (c.image ? "has-photo" : "ph") + (cls ? " " + cls : "") + '">' + artFace(c) +
      (c.image ? '<img src="' + esc(c.image) + '" alt="' + esc((c.player || "") + " card photo") + '" loading="lazy" decoding="async">' : "") + "</span>";
  }
  function gradeWord(g) {
    var n = parseFloat(g);
    return n >= 9.5 ? "Gem Mt" : n === 9 ? "Mint" : n >= 8 ? "NM-Mt" : n >= 7 ? "NM" : "";
  }
  // Graded cards sit in a slab with a label plate, raw cards in a toploader,
  // memorabilia in a frame. Autos and numbered cards get a refractor edge.
  function slab(c, size) {
    var kind = c.is_merch ? "merch" : c.graded ? "graded" : "raw";
    var chase = !c.is_merch && (c.auto || c.serial_run), photoSlab = kind === "graded" && !!c.image;
    var plate = kind === "graded" && !photoSlab ? '<span class="slab-plate"><span class="sp-l"><span>' + esc([c.year, c.set || c.brand].filter(Boolean).join(" ")) + "</span><small>" + esc(c.player || "") + '</small></span><span class="sp-r"><small>' + esc([c.grader, gradeWord(c.grade)].filter(Boolean).join(" ")) + "</small><b>" + esc(c.grade || "") + "</b></span></span>" : "";
    return '<span class="slab slab-' + kind + (photoSlab ? " photo-slab" : "") + " slab-" + (size || "md") + " " + tierKey(c) + (chase ? " chase" : "") + '">' + plate + '<span class="slab-window">' + thumb(c) + "</span></span>";
  }
  function slabTile(c) {
    var ref = Selling.reference(c), o = c.owner_listing || {}, listed = Selling.listed(c), sp = Charts.sparkline(trendSeries(c), 76, 20);
    var b = el('<button class="slab-tile" type="button" aria-label="' + esc((c.player || "Card") + ", " + (ref == null ? "no saved value" : displayPrice(ref))) + '"><span class="slab-stage">' + slab(c) + "</span>" +
      '<span class="tile-meta"><span class="tile-name">' + esc(c.player) + '</span><span class="tile-set">' + esc(subline(c)) + "</span>" +
      '<span class="tile-money"><b>' + displayPrice(ref) + "</b>" + changeChip(c) + "</span>" + (sp ? '<span class="tile-spark">' + sp + "</span>" : "") +
      (listed ? '<span class="tile-flag"><i class="live-dot" aria-hidden="true"></i>On eBay' + (o.asking_price ? " at " + money0(o.asking_price) : "") + "</span>" : "") +
      "</span></button>");
    b.onclick = function () { openModal(c); };
    return b;
  }
  function cardRow(c) {
    var ref = Selling.reference(c), sp = Charts.sparkline(trendSeries(c), 56, 18);
    var b = el('<button class="card-row" type="button">' + slab(c, "sm") + '<span class="row-main"><b>' + esc(c.player) + "</b><small>" + esc(subline(c)) + "</small>" + badges(c) + '</span><span class="row-money"><b>' + displayPrice(ref) + "</b>" + changeChip(c) + (sp || "") + "</span></button>");
    b.onclick = function () { openModal(c); };
    return b;
  }

  // ---------- page pieces ----------
  function pageHead(title, sub) { return el('<header class="page-head"><h1>' + esc(title) + "</h1>" + (sub ? "<p>" + esc(sub) + "</p>" : "") + "</header>"); }
  function sectionHead(title, sub, button, fn) {
    var frag = document.createDocumentFragment();
    var h = el('<div class="section-head"><h2 class="section-title">' + esc(title) + "</h2>" + (button ? '<button class="link-btn" type="button">' + esc(button) + icon("chevron") + "</button>" : "") + "</div>");
    if (fn && button) h.querySelector("button").onclick = fn;
    frag.appendChild(h);
    if (sub) frag.appendChild(el('<p class="section-sub">' + esc(sub) + "</p>"));
    return frag;
  }
  function segment(options, selected, fn) {
    var s = el('<div class="cv-segments" role="group" aria-label="Choose view"></div>');
    options.forEach(function (o) {
      var on = selected === o[0];
      var b = el('<button type="button" class="' + (on ? "on" : "") + '" aria-pressed="' + on + '">' + esc(o[1]) + (o[2] != null ? " <b>" + esc(o[2]) + "</b>" : "") + "</button>");
      b.onclick = function () { fn(o[0]); };
      s.appendChild(b);
    });
    return s;
  }
  function goInventory(filter) {
    state.inventoryType = "all"; state.inventoryStatus = "all"; state.inventoryTier = "all"; state.inventorySport = "all";
    state.q = ""; state.bucket = "All";
    if (filter === "listed") state.inventoryStatus = "listed";
    else if (filter === "t1" || filter === "t2" || filter === "t3") state.inventoryTier = filter;
    else if (filter && filter !== "all") state.inventoryType = filter;
    setTab("collection");
  }

  // ---------- Today ----------
  function guilloche() {
    var p = "";
    for (var i = 0; i < 12; i++) { var y = 12 + i * 10; p += '<path d="M0 ' + y + " C70 " + (y - 16) + " 130 " + (y + 16) + " 200 " + y + " S330 " + (y - 16) + " 400 " + y + " S530 " + (y + 16) + " 600 " + y + '"/>'; }
    return '<svg class="guilloche" viewBox="0 0 600 140" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + p + "</svg>";
  }
  function vaultHero() {
    var d = state.data, held = heldCards(), total = num(d.summary.total_value), hist = historyPoints();
    var graded = held.filter(function (c) { return c.graded && !c.is_merch; }).length;
    var autos = held.filter(function (c) { return !!c.auto; }).length, listed = held.filter(Selling.listed).length;
    var asOf = hist.length ? savedDate(hist[hist.length - 1].d) : "";
    var sec = el('<section class="vault-hero" aria-label="Vault value">' +
      '<button class="hero-plate" type="button" aria-label="Open the vault value breakdown"><span class="plate-l"><b>CARD VAULT</b><small>THE COLLECTION</small></span><span class="plate-r"><small>IN THE<br>VAULT</small><b>' + held.length + '</b></span><span class="plate-glint" aria-hidden="true"></span></button>' +
      '<div class="hero-body">' + guilloche() +
      '<button class="hero-tap" type="button" aria-label="Open the vault value breakdown"><span class="hero-label">Vault value' + icon("chevron") + '</span><span class="hero-value foil-text shine" data-count="' + total + '">' + money0(total) + "</span></button>" +
      '<p class="hero-sub">Saved values' + (asOf ? " as of " + esc(asOf) : "") + ". Tap for the breakdown.</p></div></section>");
    var body = sec.querySelector(".hero-body");
    body.appendChild(areaSlot(hist, { h: 150, cls: "hero-chart", animate: true, label: "Vault value over time", padL: 42 }));
    body.appendChild(el('<p class="chart-note">The line moves when cards are added, sold or re-priced, so it is not market performance.</p>'));
    var chips = el('<div class="hero-chips"></div>');
    [["graded", graded, "graded"], ["auto", autos, "autographs"], ["listed", listed, "on eBay"]].forEach(function (x) {
      var b = el('<button class="stat-chip" type="button"><b>' + x[1] + "</b><span>" + x[2] + "</span></button>");
      b.onclick = function () { goInventory(x[0]); };
      chips.appendChild(b);
    });
    body.appendChild(chips);
    sec.querySelector(".hero-plate").onclick = openVaultBreakdown;
    sec.querySelector(".hero-tap").onclick = openVaultBreakdown;
    return sec;
  }
  function openVaultBreakdown() {
    var held = pricedHeld(), total = sumRef(held), hist = historyPoints();
    var tiers = '<section class="sheet-section"><h3>By price tier</h3>' + Charts.stackedBar(tierSegments(held), { label: "Vault value by price tier" }) + "</section>";
    var segs = basisSegments(held), strong = segs[0].value + segs[1].value;
    var conf = '<section class="sheet-section"><h3>How sure the values are</h3><p class="insight"><b>' + (total ? Math.round(strong / total * 100) : 0) + "%</b> comes from real sold prices or PSA.</p>" + Charts.stackedBar(segs, { label: "Vault value by pricing source" }) + "</section>";
    var sports = '<section class="sheet-section"><h3>By sport</h3>' + Charts.barList((state.data.summary.sport_stats || []).map(function (g) { return { label: g.name, note: g.count + (g.count === 1 ? " item" : " items"), value: g.value }; })) + "</section>";
    var over = el('<section class="sheet-section"><h3>Over time</h3><p class="section-note">Cards added, sold and re-priced all move this line. Hollow dots mark re-pricing days.</p></section>');
    over.appendChild(areaSlot(hist, { h: 190, label: "Vault value over time" }));
    over.appendChild(twinTable(hist));
    openInfo("Vault value", money0(total) + " across " + held.length + " priced cards and pieces", [tiers, conf, sports, over]);
  }
  // The tape: real, dated things that happened — your sales, your live asks,
  // sold prices you recorded in the last 90 days, and genuine value moves.
  // Nothing on it is a forecast, and it skips anything it cannot price.
  function tapeEvents() {
    var ev = [];
    state.data.cards.forEach(function (c) {
      var o = c.owner_listing || {};
      if (c.sold && num(c.sold_price) > 0) ev.push({ d: String(c.sold_date || ""), k: "Sold", cls: "k-sold", c: c, text: money0(c.sold_price) });
      if (Selling.listed(c) && Selling.amount(o.asking_price)) {
        var when = (o.events || []).filter(function (e) { return e.type === "listed"; }).map(function (e) { return String(e.occurred_at || "").slice(0, 10); }).sort().pop() || "";
        ev.push({ d: when, k: "Listed", cls: "k-listed", c: c, text: money0(o.asking_price) });
      }
      var recent = Selling.soldRows(c).filter(function (r) { return r.recent; });
      if (recent.length) {
        var day = recent[0].d, same = recent.filter(function (r) { return r.d === day; }).map(function (r) { return r.p; });
        var lo = Math.min.apply(null, same), hi = Math.max.apply(null, same);
        ev.push({ d: day, k: same.length > 1 ? same.length + " comps" : "Comp", cls: "k-comp", c: c, text: lo === hi ? money0(lo) : money0(lo) + "–" + money0(hi) });
      }
    });
    ev.sort(function (a, b) { return b.d.localeCompare(a.d); });
    return moverCards().slice(0, 4).map(function (c) { return { d: "", k: "Moved", cls: "k-moved", c: c, text: money0(c.asking_price), chip: true }; }).concat(ev).slice(0, 12);
  }
  function ticker() {
    var events = tapeEvents();
    if (events.length < 2) return null;
    var reel = events.slice();
    while (reel.length < 10) reel = reel.concat(events);
    function items(hiddenSet) {
      return reel.map(function (e, i) {
        var hidden = hiddenSet || i >= events.length;
        return '<button class="tick" type="button" data-sku="' + esc(e.c.sku) + '"' + (hidden ? ' tabindex="-1" aria-hidden="true"' : "") + '><span class="tick-k ' + e.cls + '">' + esc(e.k) + "</span>" + esc(shortName(e.c)) + " <b>" + e.text + "</b>" + (e.chip ? changeChip(e.c) : e.d ? "<small>" + esc(savedDate(e.d)) + "</small>" : "") + "</button>";
      }).join("");
    }
    var sec = el('<section class="ticker" aria-label="Latest activity"><span class="ticker-label">' + icon("pulse") + 'Latest</span><div class="ticker-track"><div class="ticker-run"><div class="ticker-set">' + items(false) + '</div><div class="ticker-set" aria-hidden="true">' + items(true) + "</div></div></div></section>");
    sec.querySelectorAll(".tick").forEach(function (b) { b.onclick = function () { var c = findCard(b.getAttribute("data-sku")); if (c) openModal(c); }; });
    sec.addEventListener("touchstart", function () { sec.classList.add("paused"); }, { passive: true });
    sec.addEventListener("touchend", function () { setTimeout(function () { sec.classList.remove("paused"); }, 1500); }, { passive: true });
    return sec;
  }
  // v66: the ticker is pinned under the top bar on every tab (sticky
  // .masthead). Rebuilt only when its content changes, so switching tabs does
  // not restart the scroll.
  function pinTicker() {
    var slot = document.getElementById("tickerSlot");
    if (!slot) return;
    var t = ticker(), key = t ? t.textContent : "";
    if (slot.getAttribute("data-key") === key) return;
    slot.innerHTML = "";
    slot.setAttribute("data-key", key);
    if (t) slot.appendChild(t);
  }
  function actionTile(label, value, unit, visual, foot, fn) {
    var b = el('<button class="action-tile" type="button"><span class="at-label">' + esc(label) + '</span><span class="at-value"><span data-count="' + value + '" data-fmt="int">' + value + "</span>" + (unit ? "<small>" + esc(unit) + "</small>" : "") + '</span><span class="at-visual">' + visual + '</span><span class="at-foot">' + esc(foot) + "</span></button>");
    b.onclick = fn;
    return b;
  }
  function reviewWeek() {
    var today = Selling.today(), base = Date.parse(today + "T12:00:00Z"), cells = [], next = null;
    var dates = Object.keys(workspace.plans).map(function (k) { return (workspace.plans[k] || {}).reviewDate; }).filter(Boolean).sort();
    for (var i = 0; i < 7; i++) {
      var dt = new Date(base + i * 86400000), iso = dt.toISOString().slice(0, 10);
      cells.push("<span><i" + (dates.indexOf(iso) >= 0 ? ' class="on"' : "") + "></i>" + "SMTWTFS".charAt(dt.getUTCDay()) + "</span>");
    }
    dates.forEach(function (d) { if (!next && d >= today) next = savedDate(d); });
    return { html: '<span class="week" aria-hidden="true">' + cells.join("") + "</span>", next: next };
  }
  function radarMini(n) {
    var blips = "";
    for (var i = 0; i < Math.min(n, 5); i++) { var a = (i * 72 + 30) * Math.PI / 180, r = 9 + i * 2.5; blips += '<circle class="blip" cx="' + (23 + Math.cos(a) * r).toFixed(1) + '" cy="' + (23 + Math.sin(a) * r).toFixed(1) + '" r="3"/>'; }
    return '<svg class="radar-mini" viewBox="0 0 46 46" aria-hidden="true" focusable="false"><circle cx="23" cy="23" r="21"/><circle cx="23" cy="23" r="13"/><circle cx="23" cy="23" r="5"/><path d="M23 23 39 9"/>' + blips + "</svg>";
  }
  function nextMoves() {
    var batch = eligibleCards(), listed = heldCards().filter(Selling.listed);
    var asks = listed.reduce(function (n, c) { return n + (Selling.amount((c.owner_listing || {}).asking_price) || 0); }, 0);
    var premium = Selling.premium(state.data.cards, workspace.plans, workspace.limit, null, workspace.includeSpecial);
    var due = premium.filter(function (x) { return x.plan.key === "due" || x.plan.key === "offer"; }).length, buys = qualifiedBuys().length, targets = (state.data.targets || []).length;
    var sec = el('<section class="moves-section" aria-label="Next moves"></section>');
    sec.appendChild(sectionHead("Next moves"));
    var grid = el('<div class="action-grid"></div>');
    var fan = "";
    for (var i = 0; i < Math.min(5, batch.length); i++) fan += '<i style="--i:' + i + '"></i>';
    grid.appendChild(actionTile(batch.length >= 2 ? "Ready to bundle" : "Bundle candidates", batch.length, batch.length === 1 ? "card" : "cards", '<span class="fan" aria-hidden="true">' + fan + "</span>", batch.length >= 2 ? money(sumRef(batch)) + " in saved values" : "Raise the lot limit to find more", function () { goSell("lots"); }));
    var dots = "";
    for (var j = 0; j < Math.min(8, listed.length); j++) dots += "<i></i>";
    grid.appendChild(actionTile("On eBay now", listed.length, listed.length === 1 ? "listing" : "listings", listed.length ? '<span class="dotrow" aria-hidden="true">' + dots + "</span>" : "", listed.length ? "Your asks total " + money0(asks) : "Nothing listed yet", function () { goSell("listings"); }));
    var week = reviewWeek();
    grid.appendChild(actionTile("Reviews due", due, "", week.html, due ? "Open your plans" : week.next ? "Next review " + week.next : "No review dates set", function () { goSell("plan"); }));
    grid.appendChild(actionTile("Buy radar", buys, "ready", radarMini(buys), targets + " targets watched", function () { state.buyMode = buys ? "radar" : "targets"; setTab("radar"); }));
    sec.appendChild(grid);
    var offerImport = el('<button class="text-button offer-import-shortcut" type="button">Import a private offer plan ' + icon("arrow") + "</button>");
    offerImport.onclick = openOfferImport;
    sec.appendChild(offerImport);
    return sec;
  }
  function showcase() {
    var top = pricedHeld().sort(function (a, b) { return (Selling.reference(b) || 0) - (Selling.reference(a) || 0) || String(a.sku).localeCompare(String(b.sku)); }).slice(0, 8);
    if (!top.length) return null;
    var sec = el('<section class="showcase" aria-label="Top of the vault"></section>');
    sec.appendChild(sectionHead("Top of the vault", null, "All cards", function () { goInventory("all"); }));
    var rail = el('<div class="showcase-rail"></div>');
    top.forEach(function (c) { rail.appendChild(slabTile(c)); });
    sec.appendChild(rail);
    return sec;
  }
  function valueTwin(cards) {
    var total = sumRef(cards) || 1;
    var d = el('<details class="twin"><summary>See every card by value</summary><table class="twin-table"><thead><tr><th>Card</th><th>Share</th><th>Saved value</th></tr></thead><tbody></tbody></table></details>');
    var tb = d.querySelector("tbody");
    cards.slice().sort(function (a, b) { return (Selling.reference(b) || 0) - (Selling.reference(a) || 0); }).forEach(function (c) {
      var tr = document.createElement("tr"), a = document.createElement("td"), s = document.createElement("td"), v = document.createElement("td");
      a.textContent = c.player; s.textContent = Math.round((Selling.reference(c) || 0) / total * 100) + "%"; v.textContent = displayPrice(Selling.reference(c));
      tr.appendChild(a); tr.appendChild(s); tr.appendChild(v); tb.appendChild(tr);
    });
    return d;
  }
  function moneyMap() {
    var held = pricedHeld();
    if (held.length < 2) return null;
    var vals = held.map(function (c) { return Selling.reference(c) || 0; }), share = Charts.cumulativeShare(vals), total = sumRef(held);
    var k = Math.min(3, share.length), topShare = share[k - 1] ? share[k - 1].cumulative : 0;
    var sec = el('<section class="money-map" aria-label="Where the money is"></section>');
    sec.appendChild(sectionHead("Where the money is"));
    sec.appendChild(el('<p class="insight">Your top ' + k + " cards hold <b>" + Math.round(topShare * 100) + "%</b> of the vault value. Each block is sized by its saved value; tap one to open it.</p>"));
    var tm = chartSlot("tm-slot", function (w) {
      var h = w < 520 ? Math.round(w * 0.82) : Math.round(Math.min(400, w * 0.52));
      var rects = Charts.treemapLayout(held.map(function (c) { return { id: c.sku, value: Selling.reference(c) || 0 }; }), 0, 0, w, h);
      return '<div class="tm" style="height:' + h + 'px">' + rects.map(function (r) {
        var c = findCard(r.id), x = r.x + 1, y = r.y + 1, ww = Math.max(0, r.w - 2), hh = Math.max(0, r.h - 2), label = "";
        if (ww >= 84 && hh >= 50) label = '<span class="tm-name">' + esc(shortName(c)) + '</span><span class="tm-val">' + money0(r.value) + "</span>";
        else if (ww >= 46 && hh >= 26) label = '<span class="tm-val">' + Charts.compact(r.value) + "</span>";
        var img = c.image && ww >= 130 && hh >= 150 ? '<span class="tm-img"><img src="' + esc(c.image) + '" alt="" loading="lazy" decoding="async"></span>' : "";
        return '<button class="tm-tile ' + TIERS[tierKey(c)].cls + '" type="button" data-sku="' + esc(c.sku) + '" style="left:' + x.toFixed(1) + "px;top:" + y.toFixed(1) + "px;width:" + ww.toFixed(1) + "px;height:" + hh.toFixed(1) + 'px" aria-label="' + esc(c.player + ", " + money0(r.value) + ", " + Math.round(r.value / total * 100) + "% of the vault") + '">' + img + label + "</button>";
      }).join("") + "</div>";
    });
    tm._after = function (s) { s.querySelectorAll(".tm-tile").forEach(function (b) { b.onclick = function () { var c = findCard(b.getAttribute("data-sku")); if (c) openModal(c); }; }); };
    sec.appendChild(tm);
    var legend = el('<div class="tm-legend">' + Charts.stackedBar(tierSegments(held), { interactive: true, label: "Vault value by price tier" }) + "</div>");
    legend.querySelectorAll(".legend-item").forEach(function (b) { b.onclick = function () { goInventory(b.getAttribute("data-key")); }; });
    sec.appendChild(legend);
    sec.appendChild(valueTwin(held));
    return sec;
  }
  function soldStrip() {
    var sold = state.data.cards.filter(function (c) { return c.sold; }).sort(function (a, b) { return String(b.sold_date).localeCompare(String(a.sold_date)); });
    if (!sold.length) return null;
    var r = Selling.results(state.data.cards), cost = sold.reduce(function (n, c) { return n + (Selling.cost(c) || 0); }, 0);
    var sec = el('<section class="sold-section" aria-label="Sold so far"></section>');
    sec.appendChild(sectionHead("Sold so far", null, "Results", function () { setTab("value"); }));
    var p = el('<div class="panel sold-panel"><div class="sold-top"><div><p class="big-label">Sales</p><p class="big" data-count="' + r.revenue + '">' + money0(r.revenue) + '</p></div><div class="row-money"><b class="up-text">' + (r.gross == null ? "—" : "+" + money0(r.gross)) + "</b><small>" + (r.gross == null ? "profit needs every cost" : "gross profit") + "</small></div></div></div>");
    if (r.gross != null && r.gross >= 0 && r.revenue > 0) {
      p.appendChild(el('<div class="sold-split"><div class="stack" role="img" aria-label="' + esc("You paid " + money0(cost) + ", profit " + money0(r.gross)) + '"><span class="stack-seg seg-cost" style="flex-grow:' + cost + '"></span><span class="stack-seg seg-profit" style="flex-grow:' + r.gross + '"></span></div><div class="split-legend"><span><i class="seg-cost"></i>You paid ' + money0(cost) + '</span><span><i class="seg-profit"></i>Profit ' + money0(r.gross) + "</span></div></div>"));
    }
    sold.slice(0, 3).forEach(function (c) {
      var cst = Selling.cost(c), pr = cst == null ? null : num(c.sold_price) - cst;
      var row = el('<button class="sale-row" type="button">' + thumb(c) + "<span><b>" + esc(c.player) + "</b><small>" + esc(savedDate(c.sold_date)) + '</small></span><span class="row-money"><b>' + money0(c.sold_price) + "</b><small>" + (pr == null ? "cost unknown" : (pr >= 0 ? "+" : "−") + money0(Math.abs(pr)) + " profit") + "</small></span></button>");
      row.onclick = function () { openModal(c); };
      p.appendChild(row);
    });
    sec.appendChild(p);
    return sec;
  }
  function viewToday() {
    var w = el('<div class="view today"></div>');
    [vaultHero(), nextMoves(), showcase(), moneyMap(), soldStrip()].forEach(function (x) { if (x) w.appendChild(x); });
    w.appendChild(el('<p class="fineprint">Values are saved references from recorded sold prices, PSA and eBay listings. They are estimates, not live quotes, and your eBay asks stay separate from them.</p>'));
    return w;
  }

  // ---------- Inventory ----------
  function viewCollection() {
    var held = heldCards(), total = sumRef(held);
    var w = el('<div class="view inventory"></div>');
    w.appendChild(pageHead("Inventory", held.length + " items worth " + money0(total) + " in saved values."));
    var tb = el('<div class="tier-bar">' + Charts.stackedBar(tierSegments(held), { interactive: true, label: "Value by price tier" }) + "</div>");
    w.appendChild(tb);
    var cardsN = held.filter(function (c) { return !c.is_merch; }).length;
    w.appendChild(segment([["All", "All", held.length], ["Cards", "Cards", cardsN], ["Merch", "Merch", held.length - cardsN]], state.bucket, function (x) { state.bucket = x; render(); }));
    var sports = Array.from(new Set(held.map(function (c) { return c.sport; }).filter(Boolean))).sort();
    var tools = el('<div class="inv-tools"><label class="search">' + icon("search") + '<input type="search" aria-label="Search inventory" placeholder="Player, set, team or number" value="' + esc(state.q) + '"></label><select aria-label="Sort inventory">' + SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (state.sort === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + '</select><div class="layout-toggle" role="group" aria-label="Layout"><button type="button" aria-label="Card grid" aria-pressed="' + (state.inventoryLayout !== "list") + '" class="' + (state.inventoryLayout !== "list" ? "on" : "") + '">' + icon("grid") + '</button><button type="button" aria-label="List" aria-pressed="' + (state.inventoryLayout === "list") + '" class="' + (state.inventoryLayout === "list" ? "on" : "") + '">' + icon("list") + "</button></div></div>");
    w.appendChild(tools);
    var CHIPS = [["all", "All"], ["graded", "Graded"], ["raw", "Raw"], ["auto", "Autos"], ["numbered", "Numbered"], ["rookie", "Rookies"], ["listed", "On eBay"], ["lot", "Lot ready"], ["missing", "No cost yet"]].concat(sports.map(function (s) { return ["sport:" + s, s]; }));
    var chipRow = el('<div class="chip-row" role="group" aria-label="Filter inventory"></div>');
    w.appendChild(chipRow);
    var count = el('<p class="inv-count" aria-live="polite"></p>'), results = el("<div></div>");
    w.appendChild(count); w.appendChild(results);
    function chipOn(k) {
      if (k === "all") return state.inventoryType === "all" && state.inventoryStatus === "all" && state.inventorySport === "all" && state.inventoryTier === "all";
      if (k.indexOf("sport:") === 0) return state.inventorySport === k.slice(6);
      if (["listed", "lot", "missing"].indexOf(k) >= 0) return state.inventoryStatus === k;
      return state.inventoryType === k;
    }
    function drawChips() {
      chipRow.innerHTML = "";
      CHIPS.forEach(function (ch) {
        var on = chipOn(ch[0]);
        var b = el('<button type="button" class="fchip' + (on ? " on" : "") + '" aria-pressed="' + on + '">' + esc(ch[1]) + "</button>");
        b.onclick = function () {
          var k = ch[0];
          if (k === "all") { state.inventoryType = "all"; state.inventoryStatus = "all"; state.inventorySport = "all"; state.inventoryTier = "all"; }
          else if (k.indexOf("sport:") === 0) state.inventorySport = chipOn(k) ? "all" : k.slice(6);
          else if (["listed", "lot", "missing"].indexOf(k) >= 0) state.inventoryStatus = chipOn(k) ? "all" : k;
          else state.inventoryType = chipOn(k) ? "all" : k;
          saveViewPrefs(); drawChips(); drawTier(); update();
        };
        chipRow.appendChild(b);
      });
    }
    function drawTier() {
      tb.querySelectorAll(".legend-item").forEach(function (b) { var on = state.inventoryTier === b.getAttribute("data-key"); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    }
    tb.querySelectorAll(".legend-item").forEach(function (b) {
      b.onclick = function () { var k = b.getAttribute("data-key"); state.inventoryTier = state.inventoryTier === k ? "all" : k; drawTier(); drawChips(); update(); };
    });
    function matches(c) {
      var st = state.inventoryStatus, ty = state.inventoryType;
      return (state.bucket === "Merch" ? c.is_merch : state.bucket === "Cards" ? !c.is_merch : true) && matchQuery(c) &&
        (state.inventorySport === "all" || c.sport === state.inventorySport) &&
        (state.inventoryTier === "all" || ((Selling.reference(c) || 0) > 0 && tierKey(c) === state.inventoryTier)) &&
        (st === "all" || st === "listed" && Selling.listed(c) || st === "unlisted" && !Selling.listed(c) || st === "lot" && Selling.batchEligible(c, workspace.limit, workspace.includeSpecial, workspace.plans[c.sku]) || st === "missing" && Selling.cost(c) === null) &&
        (ty === "all" || ty === "graded" && c.graded || ty === "raw" && !c.graded && !c.is_merch || ty === "auto" && c.auto || ty === "numbered" && c.serial_run || ty === "rookie" && c.rookie);
    }
    function update() {
      var shown = held.filter(matches);
      results.innerHTML = "";
      count.innerHTML = "<b>" + shown.length + "</b> " + (shown.length === 1 ? "item" : "items") + (state.q ? " matching “" + esc(state.q) + "”" : "") + ", " + money0(sumRef(shown)) + " in saved values";
      if (!shown.length) {
        var empty = emptyPanel("No matching cards", "Clear the filters or try another player, team or set.");
        var clear = el('<button class="button secondary" type="button">Clear filters</button>');
        clear.onclick = function () { state.q = ""; state.inventoryStatus = "all"; state.inventorySport = "all"; state.inventoryType = "all"; state.inventoryTier = "all"; render(); };
        empty.appendChild(clear); results.appendChild(empty); return;
      }
      var list = sortCards(shown, state.sort);
      if (state.inventoryLayout === "list") { var box = el('<div class="inv-list"></div>'); list.forEach(function (c) { box.appendChild(cardRow(c)); }); results.appendChild(box); }
      else { var grid = el('<div class="inv-grid' + (list.every(function (c) { return c.is_merch; }) ? " flat" : "") + '"></div>'); list.forEach(function (c) { grid.appendChild(slabTile(c)); }); results.appendChild(grid); }
    }
    tools.querySelector("input").oninput = function () { state.q = this.value; update(); };
    tools.querySelector("select").onchange = function () { state.sort = this.value; saveViewPrefs(); update(); };
    tools.querySelectorAll(".layout-toggle button").forEach(function (b, i) {
      b.onclick = function () {
        state.inventoryLayout = i ? "list" : "grid";
        tools.querySelectorAll(".layout-toggle button").forEach(function (x) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
        saveViewPrefs(); update();
      };
    });
    drawChips(); drawTier(); update();
    return w;
  }
  function saveViewPrefs() { try { localStorage.setItem("cv-view-v60", JSON.stringify({ v: 64, sort: state.sort, inventoryLayout: state.inventoryLayout, inventoryStatus: state.inventoryStatus, inventorySport: state.inventorySport, inventoryType: state.inventoryType })); } catch (e) {} }

  // ---------- Sell ----------
  function miniLadder(c, ask) {
    var rows = Selling.soldRows(c), ref = Selling.reference(c), vals = rows.map(function (r) { return r.p; });
    if (ref) vals.push(ref);
    if (ask) vals.push(ask);
    if (!rows.length || vals.length < 2) return "";
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.06 || 1;
    lo -= pad; hi += pad;
    var W = 220, H = 22, X = function (v) { return (6 + (W - 12) * (v - lo) / (hi - lo)).toFixed(1); };
    var prices = rows.map(function (r) { return r.p; });
    var dots = rows.slice().reverse().map(function (r) { return '<circle class="ml-sale' + (r.recent ? "" : " old") + '" cx="' + X(r.p) + '" cy="11" r="4"/>'; }).join("");
    return '<svg class="mini-ladder" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(rows.length + " recorded sales between " + money0(Math.min.apply(null, prices)) + " and " + money0(Math.max.apply(null, prices)) + (ref ? ", saved value " + money0(ref) : "") + (ask ? ", your ask " + money0(ask) : "")) + '"><line class="ml-axis" x1="4" x2="' + (W - 4) + '" y1="11" y2="11"/>' + dots +
      (ref ? '<line class="ml-ref" x1="' + X(ref) + '" x2="' + X(ref) + '" y1="2" y2="20"/>' : "") + (ask ? '<line class="ml-ask" x1="' + X(ask) + '" x2="' + X(ask) + '" y1="2" y2="20"/>' : "") + "</svg>";
  }
  function premiumRow(item) {
    var c = item.card, p = item.plan, o = c.owner_listing || {}, ask = Selling.listed(c) ? Selling.amount(o.asking_price) : null;
    var offer = (workspace.plans[c.sku] || {}).offer, offerAmt = offer ? Selling.amount(offer.amount) : null;
    var ml = miniLadder(c, ask);
    var row = el('<article class="review-card"><span class="review-photo">' + slab(c, "sm") + '</span><div class="review-top"><h3>' + esc(c.player) + '</h3><span class="row-money"><b>' + displayPrice(offerAmt != null ? offerAmt : Selling.reference(c)) + "</b><small>" + esc(offerAmt != null ? "Private offer" : referenceLabel(c)) + '</small></span></div><p class="card-spec">' + esc(subline(c)) + '</p><div class="review-meta"><span class="signal ' + p.tone + '">' + esc(p.label) + "</span>" + (ask != null ? '<span class="signal green">Ask ' + money0(ask) + "</span>" : "") + "</div>" + (ml ? '<div class="review-viz">' + ml + "</div>" : "") + '<p class="review-reason">' + esc(p.reason) + '</p><div class="review-buttons"><button class="button small" type="button">Plan this card</button><button class="text-button" type="button" data-details>Card details</button></div></article>');
    row.querySelector(".button").onclick = function () { openSellPlan(c); };
    row.querySelector("[data-details]").onclick = function () { openModal(c); };
    return row;
  }
  function listingCard(c) {
    var o = c.owner_listing || {}, age = Selling.listingAge(c), ask = Selling.amount(o.asking_price), ref = Selling.reference(c);
    var prem = ask != null && ref ? (ask - ref) / ref : null;
    var p = el('<article class="listing-card">' + thumb(c) + '<div><span class="signal green">' + (age === null ? "Listed" : "Listed " + age + (age === 1 ? " day" : " days")) + "</span><h3>" + esc(c.player) + '</h3><p class="card-spec">' + esc(subline(c)) + '</p></div><div class="listing-prices"><div><span>Your ask</span><b>' + displayPrice(ask) + "</b></div><div><span>Saved value</span><b>" + displayPrice(ref) + "</b></div></div>" +
      (prem != null ? '<div class="premium"><div class="premium-line"><span>' + (prem >= 0 ? "Saved value is " + Math.round(ref / ask * 100) + "% of your ask" : "Your ask is below the saved value") + "</span><b>" + (prem >= 0 ? "+" : "−") + Math.abs(Math.round(prem * 100)) + "%</b></div>" + Charts.meter(Math.min(ref, ask), Math.max(ref, ask), { label: "Saved value versus your ask" }) + "</div>" : "") +
      '<p class="section-note">' + (o.confirmed_at ? "Last confirmed " + esc(savedDate(o.confirmed_at)) + ". " : "") + 'Check eBay for offers and watchers.</p><div class="button-row"><button class="button small" type="button">Price plan</button>' + (o.url ? '<a class="button secondary small" href="' + safeBuyLink(o.url) + '" target="_blank" rel="noopener">Open listing' + icon("external") + "</a>" : "") + "</div></article>");
    p.querySelector("button").onclick = function () { openSellPlan(c); };
    return p;
  }
  function viewSell() {
    var wrap = el('<div class="view sell-view"></div>'), mode = state.sellMode || "plan";
    var items = Selling.premium(state.data.cards, workspace.plans, workspace.limit, null, workspace.includeSpecial), batch = eligibleCards(), listed = state.data.cards.filter(Selling.listed);
    wrap.appendChild(pageHead("Sell", "Bundle the small cards into lots. Plan the valuable ones one at a time."));
    var exchange = el('<div class="offer-exchange-entry"><span>Got an offer plan from Jarvis or your assistant?</span><button class="button secondary small" type="button">Import offer plan</button></div>');
    exchange.querySelector("button").onclick = openOfferImport;
    wrap.appendChild(exchange);
    wrap.appendChild(segment([["plan", "Plans", items.length], ["lots", "Lots", batch.length], ["listings", "On eBay", listed.length], ["drafts", "Drafts", workspace.lots.length]], mode, function (x) { state.sellMode = x; render(); }));
    if (mode === "lots") { wrap.appendChild(lotBuilder()); return wrap; }
    if (mode === "drafts") { wrap.appendChild(savedLotDrafts()); return wrap; }
    if (mode === "listings") {
      listed.sort(function (a, b) { return (Selling.listingAge(b) || 0) - (Selling.listingAge(a) || 0) || (Selling.reference(b) || 0) - (Selling.reference(a) || 0); });
      var grid = el('<div class="listing-grid"></div>');
      listed.forEach(function (c) { grid.appendChild(listingCard(c)); });
      wrap.appendChild(listed.length ? grid : emptyPanel("No recorded listings", "Your confirmed eBay listings will appear here."));
      return wrap;
    }
    var KEYS = [["all", "All"], ["offer", "Offers"], ["due", "Review due"], ["target", "Check target"], ["list", "Ready to list"], ["listed", "On eBay"], ["research", "Needs comps"], ["hold", "Holding"]];
    var countOf = function (k) { return k === "all" ? items.length : items.filter(function (x) { return x.plan.key === k; }).length; };
    var filter = state.planFilter || "all";
    if (filter !== "all" && !countOf(filter)) filter = state.planFilter = "all";
    var chips = el('<div class="chip-row state-chips" role="group" aria-label="Filter plans"></div>');
    var search = el('<label class="search plan-search">' + icon("search") + '<input type="search" placeholder="Find a card to plan" aria-label="Search selling plans"></label>');
    var key = el('<div class="mini-key" aria-hidden="true"><span><i class="mk-sale"></i>Recorded sales</span><span><i class="mk-ref"></i>Saved value</span><span><i class="mk-ask"></i>Your ask</span></div>');
    var list = el('<div class="review-list"></div>');
    function drawChips() {
      chips.innerHTML = "";
      KEYS.forEach(function (k) {
        var n = countOf(k[0]);
        if (k[0] !== "all" && !n) return;
        var b = el('<button type="button" class="fchip' + (filter === k[0] ? " on" : "") + '" aria-pressed="' + (filter === k[0]) + '">' + esc(k[1]) + " <b>" + n + "</b></button>");
        b.onclick = function () { filter = state.planFilter = k[0]; drawChips(); update(); };
        chips.appendChild(b);
      });
    }
    function update() {
      var q = search.querySelector("input").value.toLowerCase().trim();
      list.innerHTML = "";
      var shown = items.filter(function (x) { return (!q || (x.card.player + " " + x.card.line).toLowerCase().indexOf(q) >= 0) && (filter === "all" || x.plan.key === filter); });
      shown.forEach(function (x) { list.appendChild(premiumRow(x)); });
      if (!shown.length) list.appendChild(emptyPanel("Nothing in this view", "Try another filter or search."));
    }
    search.querySelector("input").oninput = update;
    wrap.appendChild(chips); wrap.appendChild(search); wrap.appendChild(key); wrap.appendChild(list);
    drawChips(); update();
    return wrap;
  }

  // ---------- Buy ----------
  function viewBuy() {
    var w = el('<div class="view buy-view"></div>'), buys = qualifiedBuys().length, targets = (state.data.targets || []).length;
    w.appendChild(pageHead("Buy", "Only cards that clear your profit rules count as buys. Targets are what the radar watches."));
    w.appendChild(segment([["radar", "Buy radar", buys], ["targets", "Targets", targets]], state.buyMode || "radar", function (x) { state.buyMode = x; render(); }));
    w.appendChild(state.buyMode === "targets" ? viewTargets() : viewRadar());
    return w;
  }

  // ---------- Results ----------
  function wfCol(label, val, cls, bottom, height) {
    return '<div class="wf-col"><span class="wf-val">' + val + '</span><span class="wf-plot"><span class="wf-bar ' + cls + '" style="bottom:' + bottom.toFixed(1) + "%;height:" + Math.max(1, height).toFixed(1) + '%"></span></span><span class="wf-label">' + esc(label) + "</span></div>";
  }
  function pnlPanel(r, sold) {
    var cost = sold.reduce(function (n, c) { return n + (Selling.cost(c) || 0); }, 0);
    var p = el('<section class="panel pnl-hero wide"><p class="big-label">Sold so far</p><p class="big foil-text shine" data-count="' + r.revenue + '">' + money0(r.revenue) + '</p><p class="sub">' + r.sold + " " + (r.sold === 1 ? "sale" : "sales") + ", before eBay fees and shipping</p></section>");
    if (!r.sold) { p.appendChild(el('<p class="panel-note">Your first recorded sale will start this page.</p>')); return p; }
    if (r.gross != null && r.gross >= 0) {
      var max = Math.max(r.revenue, 1), pc = cost / max * 100, pg = r.gross / max * 100;
      p.appendChild(el('<div class="waterfall" role="img" aria-label="' + esc("Sales " + money0(r.revenue) + ", minus what you paid " + money0(cost) + ", equals gross profit " + money0(r.gross)) + '">' + wfCol("Sales", money0(r.revenue), "", 0, 100) + wfCol("You paid", "−" + money0(cost), "neg", pg, pc) + wfCol("Gross profit", money0(r.gross), "pos", 0, pg) + "</div>"));
    } else if (r.gross != null) {
      p.appendChild(el('<p class="panel-note">Your sales so far are ' + money0(Math.abs(r.gross)) + " below what you paid for them.</p>"));
    } else {
      p.appendChild(el('<p class="panel-note">Gross profit appears once every sold card has its purchase cost. ' + r.knownSoldCosts + " of " + r.sold + " recorded.</p>"));
    }
    var margin = r.gross != null && r.revenue ? r.gross / r.revenue : null;
    var best = sold.slice().sort(function (a, b) { return num(b.sold_price) - num(a.sold_price); })[0];
    p.appendChild(el('<div class="kpi-row"><div class="kpi"><span>Gross margin</span><b>' + (margin == null ? "—" : Math.round(margin * 100) + "%") + "</b>" + (margin == null ? "" : Charts.meter(Math.max(0, margin) * 100, 100, { label: "Gross margin" })) + '</div><div class="kpi"><span>Average sale</span><b>' + money0(r.revenue / r.sold) + "</b><small>" + r.sold + " " + (r.sold === 1 ? "sale" : "sales") + '</small></div><div class="kpi"><span>Best sale</span><b>' + money0(best.sold_price) + "</b><small>" + esc(best.player) + '</small></div><div class="kpi"><span>Net profit</span><b>' + (r.net == null ? "—" : money0(r.net)) + "</b><small>" + (r.net == null ? "Needs fees and shipping" : "After selling costs") + "</small></div></div>"));
    return p;
  }
  function ledgerPanel(sold) {
    var p = el('<section class="panel"><h3>Your sales</h3><p class="section-note">The solid dot is what it sold for. The hollow dot is what you paid.</p></section>');
    if (!sold.length) { p.appendChild(emptyPanel("No sales yet", "Your first recorded sale will show here.")); return p; }
    var max = Math.max.apply(null, sold.map(function (c) { return Math.max(num(c.sold_price), Selling.cost(c) || 0); })) || 1;
    sold.forEach(function (c) {
      var cost = Selling.cost(c), price = num(c.sold_price), profit = cost == null ? null : price - cost;
      var lo = cost == null ? price : Math.min(cost, price), span = cost == null ? 0 : Math.abs(price - cost);
      var db = '<span class="dumbbell" aria-hidden="true"><span class="db-track"></span>' + (cost != null ? '<span class="db-span' + (profit < 0 ? " neg" : "") + '" style="left:' + (lo / max * 100).toFixed(1) + "%;width:" + (span / max * 100).toFixed(1) + '%"></span><span class="db-a" style="left:' + (cost / max * 100).toFixed(1) + '%"></span>' : "") + '<span class="db-b" style="left:' + (price / max * 100).toFixed(1) + '%"></span></span>';
      var row = el('<button class="ledger-row" type="button">' + thumb(c) + '<span class="ledger-main"><b>' + esc(c.player) + "</b><small>" + esc(savedDate(c.sold_date)) + (cost != null ? ", paid " + money0(cost) : "") + "</small>" + db + '</span><span class="ledger-money"><b>' + money0(price) + "</b>" + (profit == null ? '<small class="na">cost unknown</small>' : '<small class="' + (profit < 0 ? "loss" : "") + '">' + (profit >= 0 ? "+" : "−") + money0(Math.abs(profit)) + "</small>") + "</span></button>");
      row.onclick = function () { openModal(c); };
      p.appendChild(row);
    });
    return p;
  }
  function concentrationPanel(held) {
    var vals = held.map(function (c) { return Selling.reference(c) || 0; }), share = Charts.cumulativeShare(vals);
    var p = el('<section class="panel"><h3>How concentrated the vault is</h3></section>');
    if (share.length < 2) { p.appendChild(el('<p class="ch-empty">Needs at least two priced cards.</p>')); return p; }
    var top = held.slice().sort(function (a, b) { return (Selling.reference(b) || 0) - (Selling.reference(a) || 0); })[0];
    var half = share.filter(function (r) { return r.cumulative >= 0.5; })[0];
    p.appendChild(el('<p class="insight"><b>' + esc(top.player) + "</b> alone is " + Math.round(share[0].share * 100) + "% of the vault. Half the value sits in your top <b>" + half.rank + "</b> " + (half.rank === 1 ? "card" : "cards") + ".</p>"));
    p.appendChild(chartSlot("pareto-slot", function (w) { return Charts.paretoChart(vals, { w: w, h: 180, marks: [1, 3, 10] }); }));
    p.appendChild(el('<p class="panel-note">Cards ranked from most to least valuable. The line adds up their share of the total.</p>'));
    return p;
  }
  function confidencePanel(held) {
    var segs = basisSegments(held), total = segs.reduce(function (n, s) { return n + s.value; }, 0), strong = segs[0].value + segs[1].value;
    return el('<section class="panel"><h3>How sure the values are</h3><p class="insight"><b>' + (total ? Math.round(strong / total * 100) : 0) + "%</b> of the vault value comes from real sold prices or PSA. The rest comes from eBay listings or hand-set prices.</p>" + Charts.stackedBar(segs, { label: "Vault value by pricing source" }) + "</section>");
  }
  function compositionPanel() {
    var s = state.data.summary, rows = function (list) { return (list || []).map(function (g) { return { label: g.name, note: g.count + (g.count === 1 ? " item" : " items"), value: g.value }; }); };
    return el('<section class="panel"><h3>What the vault is made of</h3><p class="sub-label">By sport</p>' + Charts.barList(rows(s.sport_stats)) + '<p class="sub-label">By grade</p>' + Charts.barList(rows(s.grade_stats)) + "</section>");
  }
  function listingsPanel() {
    var listed = heldCards().filter(Selling.listed);
    if (!listed.length) return null;
    var rows = listed.map(function (c) {
      var ask = Selling.amount((c.owner_listing || {}).asking_price), ref = Selling.reference(c), age = Selling.listingAge(c);
      if (ask == null || !ref) return { label: shortName(c), note: "Ask not recorded", value: 0, valueText: "—" };
      var prem = (ask - ref) / ref;
      return { label: shortName(c), note: "Value " + money0(ref) + (age != null ? ", " + age + (age === 1 ? " day" : " days") + " listed" : ""), sub: "Ask " + money0(ask), value: prem * 100, valueText: (prem >= 0 ? "+" : "−") + Math.abs(Math.round(prem * 100)) + "%", tone: prem < 0 ? "neg" : "" };
    }).sort(function (a, b) { return b.value - a.value; });
    return el('<section class="panel"><h3>Your asks vs saved values</h3><p class="section-note">How far each eBay asking price sits above the card’s saved value. Asks are not sales.</p>' + Charts.barList(rows) + "</section>");
  }
  function moversPanel() {
    var movers = moverCards().slice(0, 6);
    if (!movers.length) return null;
    var p = el('<section class="panel"><h3>Value moves</h3><p class="section-note">Largest changes from each card’s previous saved value.</p></section>');
    movers.forEach(function (c) {
      var row = el('<button class="mover-row" type="button">' + thumb(c) + '<span class="mv-name"><b>' + esc(c.player) + "</b><small>" + esc(subline(c)) + "</small></span><span>" + Charts.sparkline(trendSeries(c), 76, 26, { area: true }) + '</span><span class="mv-val"><b>' + money0(c.asking_price) + "</b>" + changeChip(c) + "<small>was " + money0(c.prev_price) + "</small></span></button>");
      row.onclick = function () { openModal(c); };
      p.appendChild(row);
    });
    return p;
  }
  function mapPanel(held) {
    if (held.length < 3) return null;
    var scored = held.map(function (c) { return { c: c, s: sellScore(c), v: Selling.reference(c) || 1 }; });
    var pts = scored.map(function (x) {
      return { id: x.c.sku, x: x.v, y: x.s.score, r: 4 + Math.min(6, Math.log(x.v + 1)), cls: "sc-" + x.s.bars, label: x.c.player + ", " + money0(x.v) + ", readiness " + x.s.score };
    });
    var p = el('<section class="panel"><h3>Collection map</h3><p class="section-note">Right is a higher saved value. Up is a readiness score built from grade, autograph, serial number, rookie status, sport and how the value was sourced. It sorts cards; it does not predict when they sell.</p></section>');
    var s = chartSlot("map-slot", function (w) { return Charts.scatterChart(pts, { w: w, h: 240, xLog: true, zoneLabel: "More ready", label: "Collection map" }); });
    s._after = function (slot) {
      slot.querySelectorAll(".sc-pt").forEach(function (g) {
        var open = function () { var c = findCard(g.getAttribute("data-id")); if (c) openModal(c); };
        g.addEventListener("click", open);
        g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      });
    };
    p.appendChild(s);
    p.appendChild(el('<div class="map-legend"><span><i class="conf-1"></i>Strong</span><span><i class="conf-2"></i>Good</span><span><i class="conf-3"></i>Fair</span><span><i class="conf-4"></i>Low</span></div>'));
    var d = el('<details class="twin"><summary>See every readiness score</summary><table class="twin-table"><thead><tr><th>Card</th><th>Readiness</th><th>Saved value</th></tr></thead><tbody></tbody></table></details>');
    scored.sort(function (a, b) { return b.s.score - a.s.score; }).forEach(function (x) {
      var tr = document.createElement("tr");
      [x.c.player, String(x.s.score), displayPrice(x.v)].forEach(function (t) { var td = document.createElement("td"); td.textContent = t; tr.appendChild(td); });
      d.querySelector("tbody").appendChild(tr);
    });
    p.appendChild(d);
    return p;
  }
  function historyPanel() {
    var hist = historyPoints();
    var p = el('<section class="panel wide"><h3>Vault value over time</h3><p class="section-note">The saved value of everything in the vault on each snapshot day. Cards added, sold and re-priced all move this line; hollow dots mark re-pricing days.</p></section>');
    p.appendChild(areaSlot(hist, { h: 220, label: "Vault value over time" }));
    p.appendChild(twinTable(hist));
    return p;
  }
  function costsPanel(r) {
    var missing = heldCards().filter(function (c) { return Selling.cost(c) === null; }).sort(function (a, b) { return (Selling.reference(b) || 0) - (Selling.reference(a) || 0); });
    var p = el('<section class="panel"><h3>Purchase costs</h3><p class="insight"><b>' + r.heldCostCount + " of " + r.held + "</b> items have what you paid recorded. Profit tracking needs the rest.</p>" + Charts.meter(r.heldCostCount, r.held, { label: "Costs recorded" }) + "</section>");
    if (missing.length) {
      var d = el('<details class="twin"><summary>Add missing costs (' + missing.length + ')</summary><div class="cost-gap-list"></div></details>');
      missing.forEach(function (c) {
        var b = el('<button type="button"><span>' + esc(c.player) + "</span><b>Add cost</b></button>");
        b.onclick = function () { openModal(c); setTimeout(function () { var i = document.getElementById("myCost"); if (i) { i.scrollIntoView({ block: "center" }); i.focus(); } }, 80); };
        d.querySelector(".cost-gap-list").appendChild(b);
      });
      p.appendChild(d);
    }
    return p;
  }
  function viewResults() {
    var cards = state.data.cards, r = Selling.results(cards), held = pricedHeld();
    var sold = cards.filter(function (c) { return c.sold; }).sort(function (a, b) { return String(b.sold_date).localeCompare(String(a.sold_date)); });
    var w = el('<div class="view results"></div>');
    w.appendChild(pageHead("Results", "What you sold, what you made, and what the vault is made of."));
    var grid = el('<div class="results-grid"></div>');
    w.appendChild(grid);
    [pnlPanel(r, sold), ledgerPanel(sold), concentrationPanel(held), confidencePanel(held), compositionPanel(), listingsPanel(), moversPanel(), mapPanel(held), historyPanel(), costsPanel(r)]
      .forEach(function (x) { if (x) grid.appendChild(x); });
    return w;
  }

  // ---------- About ----------
  function viewAbout() {
    var s = state.data.summary, w = el('<div class="view about"></div>');
    w.appendChild(pageHead("About", "Card Vault " + APP_VERSION + ". Your collection, values, selling plans and buying rules in one place."));
    w.appendChild(el('<div class="about-grid"><section class="panel"><h3>Where values come from</h3><div class="basis-key"><div><span class="basis b-sold">REAL</span>Sold prices you recorded, or a reviewed median of reported sales</div><div><span class="basis b-psaval">PSA</span>PSA’s estimate for the card at that grade</div><div><span class="basis b-est">EST</span>eBay asking prices discounted toward sold</div><div><span class="basis b-ask">ASKING</span>What sellers ask on eBay, or a hand-set price</div></div></section>' +
      '<section class="panel"><h3>Research order</h3><p>Check Terapeak / Product Research first. Use eBay sold results only when Product Research is unavailable or has no exact match.</p></section>' +
      '<section class="panel"><h3>This copy</h3><p>Data built ' + esc(state.data.generated) + ". " + s.total_cards + " items tracked, including sold ones.</p><p>Values are saved references, not live quotes. Selling plans and lot drafts save on this device only.</p></section></div>"));
    return w;
  }

  // ---------- card detail sheet ----------
  function basisText(c, ms) {
    return c.reviewed_price ? "Reviewed median of reported sales" : ms ? "From " + ms.count + " sold price" + (ms.count === 1 ? "" : "s") + " you recorded"
      : c.price_basis === "sold" ? "From real eBay sold prices" : c.price_basis === "psa" ? "PSA estimate for this card and grade"
      : c.price_basis === "est_sold" ? "Estimated from eBay asking prices" : "From eBay asking prices or hand-set";
  }
  function valueBlock(c) {
    var ref = Selling.reference(c), cost = Selling.cost(c), ms = mySold(c), o = c.owner_listing || {}, ask = Selling.listed(c) ? Selling.amount(o.asking_price) : null;
    var lab, big, sub;
    if (c.sold) { lab = "Sold for"; big = money(num(c.sold_price)); sub = c.sold_date ? "On " + savedDate(c.sold_date) : ""; }
    else { lab = "Saved value"; big = ref ? displayPrice(ref) : "—"; sub = ref ? basisText(c, ms) : "No value yet. Check Product Research."; }
    var base = c.sold ? num(c.sold_price) : ref, profit = cost != null && base ? base - cost : null;
    var t1 = '<div class="stat-tile"><span class="st-k">You paid</span>' + (cost != null ? '<span class="st-v">' + money0(cost) + "</span>" + (base ? Charts.meter(Math.min(cost, base), base, { label: "Cost as a share of value" }) + '<span class="st-n">' + Math.round(cost / base * 100) + "% of value</span>" : "") : '<button class="mhadd" id="mhAddCost" type="button">+ Add</button><span class="st-n">Unlocks profit</span>') + "</div>";
    var t2 = '<div class="stat-tile"><span class="st-k">' + (c.sold ? "Profit" : "Profit if sold") + '</span><span class="st-v ' + (profit == null ? "" : profit >= 0 ? "up" : "down") + '">' + (profit == null ? "—" : (profit >= 0 ? "+" : "−") + money0(Math.abs(profit))) + '</span><span class="st-n">' + (profit == null ? "Needs your cost" : cost ? Math.round(profit / cost * 100) + "% on cost" : "Before fees") + "</span></div>";
    var ev = Selling.soldEvidence(c);
    var t3 = ask != null
      ? '<div class="stat-tile"><span class="st-k">Your eBay ask</span><span class="st-v">' + money0(ask) + "</span>" + (ref ? Charts.meter(Math.min(ref, ask), Math.max(ref, ask), { label: "Saved value versus your ask" }) + '<span class="st-n">' + (ask >= ref ? "+" : "−") + Math.abs(Math.round((ask - ref) / ref * 100)) + "% vs value</span>" : "") + "</div>"
      : '<div class="stat-tile"><span class="st-k">Sales, 90 days</span><span class="st-v">' + ev.count + '</span><span class="st-n">' + (ev.newest ? "Latest " + esc(savedDate(ev.newest)) : "None recorded") + "</span></div>";
    return '<div class="value-block"><p class="vb-label">' + lab + '</p><p class="vb-value"><span class="foil-text">' + big + "</span>" + changeChip(c) + '</p><p class="vb-sub">' + esc(sub) + '</p><div class="stat-tiles">' + t1 + t2 + t3 + "</div>" + (c.cost_local ? '<p class="vb-sub">Cost saved on this phone.</p>' : "") + (profit != null ? '<p class="vb-sub">Profit is before eBay fees and shipping.</p>' : "") + "</div>";
  }
  function historyMeta(pts) {
    var first = pts[0].v, last = pts[pts.length - 1].v, corr = null;
    pts.forEach(function (p, i) { if (p.c && i > 0) corr = p; });
    var pct = first ? (last - first) / first * 100 : 0;
    var chg = corr ? '<span class="muted">re-priced ' + esc(savedDate(corr.d)) + "</span>" : Math.abs(pct) < 0.5 ? '<span class="muted">flat</span>' : '<span class="chg ' + (pct > 0 ? "up" : "down") + '">' + (pct > 0 ? "▲" : "▼") + Math.abs(pct).toFixed(Math.abs(pct) >= 10 ? 0 : 1) + "%</span>";
    return '<div class="history-meta"><span><b>' + money0(first) + "</b> to <b>" + money0(last) + "</b> since " + esc(savedDate(pts[0].d)) + "</span>" + chg + "</div>";
  }
  function compResearchLinks(query, soldUrl) {
    return '<div class="comp-research"><span class="research-eyebrow">Check the market</span><a class="research-primary" href="' + esc(terapeakUrl(query || "")) + '" target="_blank" rel="noopener"><span class="step">1</span>Terapeak / Product Research' + icon("external") + '</a><details class="research-fallback"><summary><span class="step">2</span>eBay sold results, the fallback</summary><p>Use this if Product Research is unavailable or has no exact matches.</p><a href="' + esc(soldUrl) + '" target="_blank" rel="noopener">Open eBay sold results</a></details><small>Match the year, set, parallel and grade. Product Research opens in your eBay seller account.</small></div>';
  }
  function openModal(c) {
    modalFocus = document.activeElement;
    var m = document.getElementById("modal");
    m.className = "modal card-detail-modal";
    m.removeAttribute("aria-labelledby");
    m.setAttribute("aria-label", c.player + " card details");
    var rows = [
      ["Item type", c.is_merch ? c.item_type : ""], ["Player", c.player], ["Year", c.year], ["Brand", c.brand], ["Set", c.set],
      ["Card #", c.card_number], ["Parallel", c.parallel], ["Insert", c.insert], ["Team", c.team],
      ["Grade", c.graded ? (c.grader + " " + c.grade) : ""], ["Authentication", c.is_merch ? c.authentication : ""],
      ["Condition", c.graded ? "" : c.condition], ["Serial", c.serial_run ? "/" + c.serial_run : ""],
      ["Sport", c.sport], ["SKU", c.sku], ["Notes", c.notes]
    ].filter(function (r) { return r[1]; });
    var kv = rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
    var pts = series(c).map(function (p) { return { d: p.d, v: p.p, c: p.c }; });
    var hasPicture = Selling.soldRows(c).length || Selling.reference(c);
    var histNote = overlaid(c) ? '<p class="chart-note">This line tracks the earlier ' + (c.est_basis === "psa" ? "PSA estimate" : "listing-based estimate") + ". The value above now comes from sold prices you recorded.</p>" : "";
    m.innerHTML = '<button class="close" id="mClose" type="button" aria-label="Close card details">×</button>' +
      '<div class="detail"><div class="detail-side"><div class="detail-media">' + slab(c, "lg") + "</div>" +
      '<div class="detail-head"><p class="detail-line">' + esc(subline(c)) + '</p><h2 class="detail-title">' + esc(c.player) + '</h2><div class="detail-tags">' + badges(c) + basisPill(c) + "</div></div>" +
      valueBlock(c) +
      '<div class="detail-actions">' + (!c.sold ? '<button class="button" id="cardSellPlan" type="button">' + icon("sell") + "Selling plan</button>" : "") + '<a class="button secondary" href="' + esc(terapeakUrl(c.title)) + '" target="_blank" rel="noopener">' + icon("search") + "Terapeak</a></div></div>" +
      '<div class="detail-main">' +
      (hasPicture ? '<section class="dsec"><h3>Price picture</h3>' + priceLadder(c, (workspace.plans[c.sku] || {}).target, { noHistory: true }) + "</section>" : "") +
      (pts.length >= 2 ? '<section class="dsec" id="histSec"><h3>Value history</h3>' + historyMeta(pts) + "</section>" : "") +
      ownerListingBox(c) + marketBox(c) + myNumbersBox(c) + compsBox(c) +
      '<section class="dsec listbar"><h3>List this card</h3><div class="lbbtns"><button class="button small" id="mListEbay" type="button">List on eBay</button><button class="button secondary small" id="mListClaude" type="button">Draft in Claude</button></div><p class="lbfoot">List on eBay opens the sell page with the title copied. Draft in Claude writes the title, item specifics and description.</p></section>' +
      '<div class="links-row"><a class="button secondary small" href="' + ebaySearchUrl(c, false) + '" target="_blank" rel="noopener">Live listings' + icon("external") + '</a><button class="button secondary small" id="mShare" type="button">' + icon("share") + "Share card</button>" +
      (c.cert && /psa/i.test(c.grader || "") ? '<a class="button secondary small" href="https://www.psacard.com/cert/' + esc(c.cert) + '" target="_blank" rel="noopener">PSA cert ' + esc(c.cert) + "</a>" : "") + "</div>" +
      '<details class="dsec cardspecs"><summary>Card details and eBay title</summary><dl class="kv">' + kv + '</dl><div class="titlebox"><div class="lab">eBay title</div><div class="val">' + esc(c.title) + "</div></div></details>" +
      "</div></div>";
    if (pts.length >= 2) {
      var hs = m.querySelector("#histSec");
      hs.appendChild(areaSlot(pts, { h: 170, label: c.player + " saved value over time", padL: 42 }));
      if (histNote) hs.insertAdjacentHTML("beforeend", histNote);
    }
    m.querySelector("#mClose").onclick = closeModal;
    wireMyNumbers(m, c);
    var sellPlanButton = m.querySelector("#cardSellPlan");
    if (sellPlanButton) sellPlanButton.onclick = function () { openSellPlan(c); };
    var listEbay = m.querySelector("#mListEbay");
    listEbay.onclick = function () { copyText(c.title); window.open("https://www.ebay.com/sl/sell", "_blank", "noopener"); flashBtn(listEbay, "Title copied"); };
    var listClaude = m.querySelector("#mListClaude");
    listClaude.onclick = function () { var q = listPrompt(c); copyText(q); window.open("https://claude.ai/new?q=" + encodeURIComponent(q), "_blank", "noopener"); flashBtn(listClaude, "Prompt copied"); };
    var share = m.querySelector("#mShare");
    share.onclick = function () {
      var url = location.href.split("#")[0] + "#sku=" + encodeURIComponent(c.sku);
      var label = share.innerHTML, done = function () { share.textContent = "Link copied"; setTimeout(function () { share.innerHTML = label; }, 1600); };
      if (navigator.share) navigator.share({ title: c.title, url: url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done);
      else done();
    };
    if (history.replaceState) history.replaceState(null, "", "#sku=" + encodeURIComponent(c.sku));
    document.getElementById("modalWrap").classList.add("open");
    document.body.classList.add("sheet-open");
    m.scrollTop = 0;
    hydrate(m);
    m.querySelector("#mClose").focus();
  }

  // ---------- shell ----------
  function coinSvg() {
    return '<svg class="coin" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><defs><linearGradient id="cvCoin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1c2"/><stop offset=".38" stop-color="#e2b858"/><stop offset=".62" stop-color="#9c7020"/><stop offset="1" stop-color="#f0cf78"/></linearGradient></defs><circle cx="20" cy="20" r="19" fill="url(#cvCoin)"/><circle cx="20" cy="20" r="15.6" fill="none" stroke="#5a3f0c" stroke-opacity=".6"/><text x="20" y="25.6" text-anchor="middle" font-family="Big Shoulders, Arial Narrow, sans-serif" font-weight="900" font-size="15.5" fill="#3a2805">CV</text></svg>';
  }
  function shell() {
    document.body.innerHTML = "";
    document.body.appendChild(el('<div class="masthead" id="masthead"><header class="topbar"><a href="#tab=today" class="brand-home" aria-label="Card Vault home">' + coinSvg() + '<span class="wordmark foil-text">Card Vault</span></a><div class="topbar-actions"><span class="ver" id="verpill" title="App version">' + APP_VERSION + '</span><button class="iconbtn" id="themebtn" type="button"></button><button class="iconbtn" id="settingsbtn" type="button" aria-label="About this app">' + icon("info") + '</button></div></header><div id="tickerSlot"></div></div>'));
    document.body.appendChild(el('<main id="view"></main>'));
    var nav = el('<nav class="nav dock" aria-label="Main navigation"></nav>');
    [["today", "Today"], ["sell", "Sell"], ["collection", "Inventory"], ["radar", "Buy"], ["value", "Results"]].forEach(function (t) {
      var b = el('<button type="button" data-tab="' + t[0] + '">' + icon(t[0]) + "<span>" + t[1] + "</span></button>");
      b.onclick = function () { setTab(t[0]); };
      nav.appendChild(b);
    });
    document.body.appendChild(nav);
    document.body.appendChild(el('<div class="modal-wrap" id="modalWrap"><div class="modal" id="modal" role="dialog" aria-modal="true" tabindex="-1"></div></div>'));
    document.body.appendChild(el('<div class="cv-toast" id="cvToast" role="status" aria-live="polite"></div>'));
    document.getElementById("themebtn").onclick = toggleTheme;
    document.getElementById("settingsbtn").onclick = function () { setTab("about"); };
    document.querySelector(".brand-home").onclick = function (e) { e.preventDefault(); setTab("today"); };
    document.getElementById("modalWrap").onclick = function (e) { if (e.target.id === "modalWrap") closeModal(); };
    document.addEventListener("keydown", function (e) {
      var typing = /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || "");
      if (e.key === "/" && !typing) { var search = document.querySelector(".search input"); if (search) { e.preventDefault(); search.focus(); } }
      if (e.key === "Escape") closeModal();
      if (e.key === "Tab") {
        var dialog = document.querySelector(".modal-wrap.open .modal");
        if (dialog) {
          var focus = Array.from(dialog.querySelectorAll("button:not([disabled]),a[href],input:not([disabled]),select,textarea,summary,[tabindex='0']")).filter(function (x) { return x.getClientRects().length; });
          var first = focus[0], last = focus[focus.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    });
    document.addEventListener("error", function (e) {
      if (e.target.tagName === "IMG" && e.target.closest(".thumb")) { e.target.style.display = "none"; e.target.closest(".thumb").classList.add("photo-missing"); }
    }, true);
    syncThemeIcon();
  }
  function render() {
    var v = document.getElementById("view");
    v.innerHTML = "";
    v.appendChild(({ today: viewToday, sell: viewSell, collection: viewCollection, value: viewResults, radar: viewBuy, about: viewAbout }[state.tab] || viewToday)());
    document.body.dataset.page = state.tab;
    pinTicker();
    window.scrollTo(0, 0);
    hydrate(v);
    countUp(v);
  }

  // ---------- theme ----------
  // Gold reads best on black, so dark is the default whatever the phone's
  // system setting; the sun button switches to the ivory light theme.
  var THEME_KEY = "cv-theme-v64";
  function currentTheme() { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; }
  function syncThemeIcon() {
    var dark = currentTheme() === "dark", b = document.getElementById("themebtn");
    if (b) { b.innerHTML = icon(dark ? "sun" : "moon"); b.setAttribute("aria-label", dark ? "Switch to the light theme" : "Switch to the dark theme"); }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#050404" : "#f4eee1");
  }
  function toggleTheme() {
    var next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    syncThemeIcon();
  }
  function toast(message) { var t=document.getElementById('cvToast'); if(t){t.textContent=message;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(function(){t.classList.remove('show');},3500);} }
  function copyAndReport(text,button,label) {
    if(!navigator.clipboard){toast('Copy is unavailable here. Select the draft text to copy it.');return;}
    navigator.clipboard.writeText(text).then(function(){if(button)flashBtn(button,label||'Copied');else toast('Copied');},function(){toast('Could not copy. Select the draft text instead.');});
  }
  function displayPrice(n) { return n==null?'—':n<100?money(n):money0(n); }
  function goSell(mode) {state.sellMode=mode||'plan';setTab('sell');}
  function eligibleCards() {var reserved={};workspace.lots.forEach(function(l){(l.skus||[]).forEach(function(sku){reserved[sku]=true;});});return state.data.cards.filter(function(c){return !reserved[c.sku]&&Selling.batchEligible(c,workspace.limit,workspace.includeSpecial,workspace.plans[c.sku]);});}
  function validSelection() {return eligibleCards().filter(function(c){return selectedLot[c.sku];});}
  function qualifiedBuys() {return ((state.data.radar||{}).candidates||[]).filter(function(c){var age=Date.now()-Date.parse(c.checked_at||'');return c.status==='qualified'&&age>=0&&age<=48*3600000&&(c.grade_scope==='exception'||(String((c.identity||{}).grader).toUpperCase()==='PSA'&&String((c.identity||{}).grade)==='10'));});}
  function savedDate(d) {return Selling.formatDate(d);}
  function referenceLabel(c) {return c.reviewed_price?'Reviewed value':c.price_basis==='asking'?'Asking-price value':c.price_basis==='psa'?'PSA value':'Saved value';}
  function emptyPanel(title,body){return el('<div class="empty-panel"><span class="empty-symbol">'+icon('check')+'</span><h3>'+esc(title)+'</h3><p>'+esc(body)+'</p></div>');}
  function lotBuilder() {
    var wrap=el('<div class="lot-builder"></div>'),rows=eligibleCards(),groups=Selling.groups(eligibleCards(),workspace.limit,workspace.includeSpecial,workspace.plans);
    var intro=el('<div class="cv-panel lot-intro"><div><span class="cv-kicker">Small cards, one shipment</span><h2>Build a better bundle</h2><p>Pick related cards, prepare one draft, and check the proceeds before you list.</p></div><label>Per-card value limit<select aria-label="Lot value limit">'+[5,10,25,50].map(function(n){return '<option value="'+n+'"'+(workspace.limit===n?' selected':'')+'>'+money0(n)+'</option>';}).join('')+'</select></label></div>');intro.querySelector('select').onchange=function(){workspace.limit=Number(this.value);saveWorkspace();render();};wrap.appendChild(intro);
    var special=el('<label class="special-toggle"><input type="checkbox"'+(workspace.includeSpecial?' checked':'')+'><span>Include graded, autographed & numbered cards below this cutoff<small>Listed items, memorabilia, individual plans and higher-cost cards remain excluded.</small></span></label>');special.querySelector('input').onchange=function(){workspace.includeSpecial=this.checked;saveWorkspace();render();};wrap.appendChild(special);
    wrap.appendChild(el('<p class="section-note">'+rows.length+' eligible cards. The cutoff checks both the saved value and any known purchase cost. Cards in saved lots are reserved, and cards without a price need an individual review.</p>'));
    var list=el('<div class="lot-groups"></div>'),summary=el('<div class="selection-bar"><div><b></b><span></span></div><button class="button" type="button">Prepare lot</button></div>');
    function sync(){var chosen=validSelection();summary.querySelector('b').textContent=chosen.length+' cards selected';summary.querySelector('span').textContent=chosen.length?money(chosen.reduce(function(n,c){return n+Selling.reference(c);},0))+' in saved values, not a lot price':'Select at least two cards';summary.querySelector('button').disabled=chosen.length<2;list.querySelectorAll('input[type="checkbox"]').forEach(function(c){c.checked=!!selectedLot[c.value];});}
    groups.forEach(function(g){var section=el('<section class="cv-panel lot-group"><div class="lot-group-head"><div><h3>'+esc(g.label)+'</h3><span>'+g.cards.length+' card'+(g.cards.length===1?'':'s')+', '+money(g.value)+' in saved values</span></div><button class="text-button" type="button">Select group</button></div><div class="lot-options"></div></section>');section.querySelector('button').onclick=function(){var all=g.cards.every(function(c){return selectedLot[c.sku];});g.cards.forEach(function(c){selectedLot[c.sku]=!all;});sync();};g.cards.forEach(function(c){var row=el('<label class="lot-option"><input type="checkbox" value="'+esc(c.sku)+'" aria-label="Add '+esc(c.player)+' '+esc(c.sku)+' to lot">'+thumb(c)+'<span><b>'+esc(c.player)+'</b><small>'+esc(c.line)+(c.graded?' · '+esc(c.grader+' '+c.grade):'')+(c.auto?' · AUTO':'')+(c.serial_run?' · /'+esc(c.serial_run):'')+'</small></span><strong>'+displayPrice(Selling.reference(c))+'</strong></label>');row.querySelector('input').onchange=function(){selectedLot[c.sku]=this.checked;sync();};section.querySelector('.lot-options').appendChild(row);});list.appendChild(section);});
    wrap.appendChild(list);if(!groups.length)wrap.appendChild(emptyPanel('No cards fit this cutoff','Raise the reference limit, or use an individual selling plan.'));wrap.appendChild(summary);summary.querySelector('button').onclick=function(){openLotDraft(validSelection());};sync();return wrap;
  }
  function showWorkspaceModal(html) {
    if(!document.getElementById('modalWrap').classList.contains('open'))modalFocus=document.activeElement;var m=document.getElementById('modal');m.className='modal workspace-modal';m.innerHTML='<button class="close" id="mClose" type="button" aria-label="Close dialog">×</button>'+html;m.scrollTop=0;m.setAttribute('aria-labelledby','workspaceTitle');m.querySelector('#mClose').onclick=closeModal;document.getElementById('modalWrap').classList.add('open');document.body.classList.add('sheet-open');m.querySelector('#mClose').focus();return m;
  }
  // v63 price ladder: every number the owner is weighing, on one axis.
  // Recorded sales are dots (filled = inside the 90-day evidence window,
  // hollow = older context). Reference, listing, target, cost and the active
  // asking median are labelled markers. Purely descriptive — no recommendation.
  function priceLadder(c, target, opts) {
    opts = opts || {};
    var rows = Selling.soldRows(c), recent = rows.filter(function (r) { return r.recent; });
    var o = c.owner_listing || {}, marks = [];
    var ref = Selling.reference(c), listing = Selling.listed(c) ? Selling.amount(o.asking_price) : null;
    var cost = Selling.cost(c), tgt = Selling.amount(target), asks = c.market && Selling.amount(c.market.median);
    if (ref) marks.push({k:'ref', label:'REF', name:referenceLabel(c), v:ref});
    if (listing) marks.push({k:'list', label:'LIST', name:'Your listing', v:listing});
    if (tgt) marks.push({k:'tgt', label:'TARGET', name:'Your target', v:tgt});
    if (cost) marks.push({k:'cost', label:'COST', name:'Your cost', v:cost});
    if (asks) marks.push({k:'asks', label:'ASKS', name:'Last saved asking median' + (c.market.count ? ' (' + c.market.count + ' listings)' : ''), v:asks});
    var vals = rows.map(function (r) { return r.p; }).concat(marks.map(function (m) { return m.v; }));
    if (vals.length < 2) return '<div class="price-ladder empty"><p>Not enough recorded prices to chart yet. Check Product Research first.</p></div>';
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = Math.max((hi - lo) * 0.08, hi * 0.03, 1);
    lo = Math.max(0, lo - pad); hi += pad;
    var W = 340, L = 10, R = 10, AX = 62;
    var X = function (v) { return L + (W - L - R) * (v - lo) / (hi - lo); };
    var lanes = [];
    var dots = rows.slice().reverse().map(function (r) {
      var x = X(r.p), lane = 0;
      while ((lanes[lane] || []).some(function (px) { return Math.abs(px - x) < 9; })) lane++;
      (lanes[lane] = lanes[lane] || []).push(x);
      var y = AX - 9 - lane * 9;
      return '<circle class="pl-sale' + (r.recent ? ' recent' : '') + '" cx="' + x.toFixed(1) + '" cy="' + y + '" r="4"><title>' + esc(savedDate(r.d)) + ' · ' + esc(money(r.p)) + (r.recent ? '' : ' (older than 90 days)') + '</title></circle>';
    }).join('');
    var used = [];
    var markers = marks.map(function (m) {
      var x = X(m.v), row = 0;
      while ((used[row] || []).some(function (px) { return Math.abs(px - x) < 46; })) row++;
      (used[row] = used[row] || []).push(x);
      var ty = AX + 18 + row * 13, anchor = x < 40 ? 'start' : x > W - 40 ? 'end' : 'middle';
      return '<g class="pl-mark k-' + m.k + '"><line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + (AX - 30) + '" y2="' + (ty - 9) + '"/>' +
        '<text x="' + x.toFixed(1) + '" y="' + ty + '" text-anchor="' + anchor + '">' + m.label + '</text></g>';
    }).join('');
    // Range labels sit on their own row under the marker labels, so a
    // marker near either end can never collide with them.
    var endY = AX + 18 + Math.max(1, used.length) * 13, h = endY + 6;
    var svg = '<svg class="pl-svg" viewBox="0 0 ' + W + ' ' + h + '" role="img" aria-label="Price ladder: recorded sales and your saved prices">' +
      '<line class="pl-axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + AX + '" y2="' + AX + '"/>' +
      '<text class="pl-end" x="' + L + '" y="' + endY + '">' + esc(money0(lo)) + '</text>' +
      '<text class="pl-end" x="' + (W - R) + '" y="' + endY + '" text-anchor="end">' + esc(money0(hi)) + '</text>' +
      markers + dots + '</svg>';
    var legend = marks.map(function (m) { return '<span class="pl-key k-' + m.k + '"><i></i>' + esc(m.name) + ' <b>' + esc(displayPrice(m.v)) + '</b></span>'; }).join('') +
      (rows.length ? '<span class="pl-key k-sale"><i></i>Recorded sales, 90 days <b>' + recent.length + '</b></span>' + (rows.length > recent.length ? '<span class="pl-key k-old"><i></i>Older sales <b>' + (rows.length - recent.length) + '</b></span>' : '') : '');
    var fact = '';
    if (recent.length) {
      var rlo = Math.min.apply(null, recent.map(function (r) { return r.p; })), rhi = Math.max.apply(null, recent.map(function (r) { return r.p; }));
      var range = recent.length === 1 ? money0(rlo) : money0(rlo) + '–' + money0(rhi);
      var who = listing ? ['Your listing', listing] : tgt ? ['Your target', tgt] : null;
      if (who) fact = who[0] + ' ' + money0(who[1]) + (who[1] > rhi ? ' is above every' : who[1] < rlo ? ' is below every' : ' sits inside the range of the') +
        ' recorded sale in the last 90 days (' + range + ', ' + recent.length + ' sale' + (recent.length === 1 ? '' : 's') + ').';
      else fact = recent.length + ' recorded sale' + (recent.length === 1 ? '' : 's') + ' in the last 90 days: ' + range + '.';
    } else if (rows.length) fact = 'No recorded sales in the last 90 days; hollow dots are older sales shown for context only.';
    // Same rule as the tile trend lines: only the stretch since the last
    // re-pricing, and nothing when the value now comes from recorded sales.
    var series = trendSeries(c);
    var hist = series.length >= 2 && !opts.noHistory ? '<div class="pl-history"><span>Saved value history</span>' + sparkline(series, 200, 34) +
      '<small>' + esc(savedDate(series[0].d)) + ' ' + esc(money0(series[0].p)) + ' → ' + esc(savedDate(series[series.length - 1].d)) + ' ' + esc(money0(series[series.length - 1].p)) + '</small></div>' : '';
    return '<div class="price-ladder">' + (fact ? '<div class="pl-head"><p>' + esc(fact) + '</p></div>' : '') + svg +
      '<div class="pl-legend">' + legend + '</div>' + hist + '<small class="pl-note">Recorded sales and saved values, not live quotes. Asking prices are not sales.</small></div>';
  }
  // v65 private offer plans (ported from ChatGPT/dot's generic package onto v64).
  // Offer terms live only in this device's selling workspace (cv-selling-v1),
  // never in my_numbers, data.json or the public comparison feed. An import is a
  // preview until the owner ticks the review box and saves.
  function defaultOfferAssumptions() {
    var p=(state.data.radar||{}).policy||{};
    return {shipping:p.outbound_shipping==null?8:p.outbound_shipping,supplies:p.supplies==null?2:p.supplies,feeRate:(p.fee_rate==null?.1325:p.fee_rate)*100,orderFee:p.per_order_fee==null?.4:p.per_order_fee,promotion:(p.promotion_reserve_rate==null?.02:p.promotion_reserve_rate)*100,buyerTax:(p.resale_buyer_tax_rate==null?.08:p.resale_buyer_tax_rate)*100,feeThreshold:p.fee_threshold||7500,feeRateAbove:(p.fee_rate_above==null?.0235:p.fee_rate_above)*100};
  }
  function openOfferImport() {
    var m=showWorkspaceModal('<span class="cv-kicker">Private offer plan</span><h2 id="workspaceTitle">Review an offer plan</h2><p class="section-note">Choose the private JSON file or paste its contents. Nothing is uploaded. It only matches a card you still own, and nothing saves until you review it.</p><label class="field">Choose JSON file<input id="offerImportFile" type="file" accept=".json,application/json"></label><label class="field">Or paste the offer-plan JSON<textarea id="offerImportText" rows="8" maxlength="20000" spellcheck="false" placeholder="card-vault-offer-plan, schema 1"></textarea></label><p id="offerImportError" class="warning-text" role="alert"></p><div class="button-row"><button class="button" id="offerImportReview" type="button">Review matched card</button><button class="button secondary" id="offerImportCancel" type="button">Cancel</button></div><p class="section-note">Never include buyer details, order IDs or passwords. Closing this discards the preview.</p>');
    var input=m.querySelector('#offerImportText'),error=m.querySelector('#offerImportError'),review=m.querySelector('#offerImportReview'),fileRevision=0;
    input.oninput=function(){fileRevision++;review.disabled=false;};
    m.querySelector('#offerImportFile').onchange=function(){var file=this.files[0],revision=++fileRevision;error.textContent='';input.value='';review.disabled=false;if(!file)return;if(file.size>20000){error.textContent='File is too large. Use one offer plan under 20 KB.';return;}review.disabled=true;file.text().then(function(text){if(revision===fileRevision&&document.contains(input)){input.value=text;review.disabled=false;}},function(){if(revision===fileRevision&&document.contains(error)){error.textContent='Could not read this file. Try pasting its JSON instead.';review.disabled=false;}});};
    review.onclick=function(){try{var result=Selling.parseOfferExchange(input.value,state.data.cards);openSellPlan(result.card,result.offer);}catch(e){error.textContent=e.message;}};
    m.querySelector('#offerImportCancel').onclick=closeModal;
  }
  function offerFields(offer,enabled,imported) {
    function field(key,label,extra){return '<label>'+label+'<input data-offer="'+key+'" '+(extra||'type="number" min="0" step="0.01" inputmode="decimal"')+' value="'+esc(offer[key]==null?'':offer[key])+'"></label>';}
    var costs=[['shipping','Shipping and insurance you pay ($)'],['supplies','Packaging ($)'],['feeRate','Base selling fee (%)'],['orderFee','Per-order fee ($)'],['promotion','Promotion reserve (%)'],['buyerTax','Buyer tax allowance (%)'],['feeThreshold','Fee tier threshold ($)'],['feeRateAbove','Fee above threshold (%)']];
    return '<details class="offer-plan"'+(enabled?' open':'')+'><summary>Offer decision<span>Private, saved on this device only</span></summary><label class="offer-enable"><input id="offerEnabled" type="checkbox"'+(enabled?' checked':'')+(imported?' disabled':'')+'> Include an offer in this plan</label><p class="section-note">Recommendations are notes, not approval. Nothing here accepts, counters or messages anyone on eBay. Untick and save to remove the offer; your card records stay unchanged.</p><fieldset id="offerFields"><div class="form-grid">'+
      field('amount','Offer amount (USD)','type="number" required min="0.01" step="0.01" inputmode="decimal"')+field('counterAmount','Counter scenario (USD)')+
      field('minimumNet','Your minimum net ($)')+field('acquisitionCost','Scenario cost basis ($)')+
      '<label class="full">Recommendation to review<select data-offer="recommendation"><option value="review">Review before deciding</option><option value="accept">Consider accepting</option><option value="counter">Consider a counter</option><option value="hold">Hold, do not act yet</option></select></label><label class="full">Decision notes<textarea data-offer="rationale" rows="4" maxlength="2000" placeholder="Why accept, counter or hold? What still needs checking?">'+esc(offer.rationale)+'</textarea></label><label class="full">Basis and evidence notes<textarea data-offer="basisNote" rows="3" maxlength="1000" placeholder="Source and limits. Not a ledger update.">'+esc(offer.basisNote)+'</textarea></label></div><p class="section-note">The minimum is your own optional floor and is never inferred from a recommendation. The scenario cost changes only this estimate, not your recorded cost.</p><div id="offerQuote" class="quote-panel" aria-live="polite"></div><p id="offerScenarioNote" class="section-note"></p><details class="cost-assumptions"><summary>Selling cost assumptions</summary><div class="form-grid">'+
      costs.map(function(f){return '<label>'+f[1]+'<input data-offer-cost="'+f[0]+'" type="number" min="0" '+(/Rate|promotion|buyerTax/.test(f[0])?'max="99.99" ':'')+'step="0.01" inputmode="decimal" value="'+esc(offer.assumptions[f[0]]==null?'':offer.assumptions[f[0]])+'"></label>';}).join('')+
      '</div><p class="section-note">Planning assumptions, not verified account fees. While any box is blank the net and profit stay unknown. Free shipping to the buyer; the fee basis includes the buyer-tax allowance. Before income tax.</p><button class="text-button" id="offerUseDefaults" type="button">Fill blanks with my saved selling costs</button></details><details class="offer-timing"'+(offer.expiryNote||offer.expiresAt?' open':'')+'><summary>Expiration and timing</summary><div id="offerDeadline" class="evidence-note" aria-live="polite"></div><div class="form-grid"><label class="full">Original expiration wording<textarea data-offer="expiryNote" rows="2" maxlength="500" placeholder="Keep the source wording. Say if the timezone is unknown.">'+esc(offer.expiryNote)+'</textarea></label>'+
      field('expiresAt','Confirmed expiry with timezone','type="text" placeholder="2026-10-29T20:40:00-04:00" autocomplete="off" spellcheck="false"')+field('receivedAt','Received time with timezone','type="text" placeholder="2026-10-29T03:40:34Z" autocomplete="off" spellcheck="false"')+
      '</div><p class="section-note">Leave the confirmed expiry blank until the timezone is verified in eBay. Wording alone never becomes a countdown, and the app sends no reminders.</p></details><div class="button-row"><button class="text-button" id="offerExportPrepare" type="button">Prepare private JSON</button></div><div id="offerExport" hidden><label class="field">Private offer-plan JSON<textarea id="offerExportText" rows="6" readonly spellcheck="false"></textarea></label><div class="button-row"><button class="button secondary small" id="offerExportCopy" type="button">Copy JSON</button><button class="button secondary small" id="offerExportDownload" type="button">Download JSON</button></div><p class="section-note">Contains private negotiation terms. Share it only through your private Jarvis handoff, never a public repository or the pricing feed. Exporting does not save changes.</p></div></fieldset></details>';
  }
  function openSellPlan(c,incomingOffer) {
    var p=workspace.plans[c.sku]||{},signal=Selling.planFor(c,p),o=c.owner_listing||{},e=Selling.soldEvidence(c),imported=!!incomingOffer;
    var offer,enabled=!!(incomingOffer||p.offer),offerWarning='';
    try{offer=Selling.normalizeOffer(incomingOffer||p.offer||{assumptions:defaultOfferAssumptions()});}catch(error){offer=Selling.normalizeOffer({assumptions:defaultOfferAssumptions()});enabled=false;offerWarning='This saved offer cannot be read: '+error.message+' It stays untouched until you save. Tick the box and enter corrected terms, or leave it unticked and save to remove only the offer.';}
    var reviewBox=imported?'<div class="offer-import-review"><b>Imported preview, not saved yet</b><p>Check the card, the offer, the deadline and every cost. Saving replaces only this card’s offer'+(p.offer?' ('+displayPrice(p.offer.amount)+' saved now)':'')+'; your other plan details and card records stay the same.</p><label><input id="offerReviewed" type="checkbox" required> I checked the matched card and the private terms</label></div>':'';
    var m=showWorkspaceModal('<div class="modal-heading">'+slab(c,'sm')+'<div><span class="cv-kicker">Selling plan</span><h2 id="workspaceTitle">'+esc(c.player)+'</h2><p>'+esc(c.line)+'</p><small class="plan-ids">'+esc(c.sku)+(o.item_id?', listing '+esc(o.item_id):'')+'</small></div></div>'+reviewBox+'<div class="plan-price"><div><span>'+esc(referenceLabel(c))+'</span><b>'+displayPrice(Selling.reference(c))+'</b></div><div><span>'+(Selling.listed(c)?'Your listing':'Recorded cost')+'</span><b>'+displayPrice(Selling.listed(c)?Selling.amount(o.asking_price):Selling.cost(c))+'</b></div></div>'+(offerWarning?'<p class="warning-text" role="alert">'+esc(offerWarning)+'</p>':'')+offerFields(offer,enabled,imported)+'<section class="sheet-section plan-picture"><h3>Price picture</h3><div id="planLadder">'+priceLadder(c,p.target)+'</div></section><div class="evidence-note"><span class="signal '+signal.tone+'">'+esc(signal.label)+'</span><p>'+esc(signal.reason)+'</p><small>'+e.count+' recorded sales in the last 90 days'+(e.newest?', newest '+esc(savedDate(e.newest)):'')+'. Confirm the exact card, parallel and grade. Saved values are not live market quotes.</small></div>'+compResearchLinks(c.title,ebaySearchUrl(c,true))+'<div class="form-grid"><label class="full">Your plan<select id="planAction"><option value="review">Review before deciding</option><option value="hold">Hold for my price</option><option value="list">Prepare to list</option></select></label><label>Target sale price ($)<input id="planTarget" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Your target" value="'+esc(p.target==null?'':p.target)+'"></label><label>Review on<input id="planDate" type="date" value="'+esc(p.reviewDate||'')+'"></label><label class="full">Your notes<textarea id="planNote" rows="3" maxlength="800" placeholder="What would make you sell?">'+esc(p.note||'')+'</textarea></label></div><p id="offerError" class="warning-text" role="alert"></p><div class="button-row"><button class="button" id="planSave" type="button">Save selling plan</button><button class="button secondary" id="planCancel" type="button">Cancel</button></div><p class="section-note">Saved on this device only. Offer reviews appear on Today when you open the app. Nothing here accepts, counters, messages a buyer, changes a listing or records a sale, and private offers are never included in Send to Claude or the one-tap sheet save.</p>');
    var error=m.querySelector('#offerError');
    m.querySelector('#planAction').value=p.action||'review';m.querySelector('[data-offer="recommendation"]').value=offer.recommendation;
    m.querySelector('#planTarget').addEventListener('input',function(){m.querySelector('#planLadder').innerHTML=priceLadder(c,this.value);});
    function readOffer(){var row={currency:'USD',assumptions:{}};m.querySelectorAll('[data-offer]').forEach(function(i){row[i.dataset.offer]=i.value;});m.querySelectorAll('[data-offer-cost]').forEach(function(i){row.assumptions[i.dataset.offerCost]=i.value;});return Selling.normalizeOffer(row);}
    function validate(){var invalid=Array.from(m.querySelectorAll('input,textarea,select')).find(function(i){return !i.disabled&&!i.checkValidity();});if(invalid){var d=invalid.closest('details');while(d){d.open=true;d=d.parentElement.closest('details');}invalid.reportValidity();return false;}return true;}
    function updateOffer(){
      var active=m.querySelector('#offerEnabled').checked;m.querySelector('#offerFields').disabled=!active;m.querySelector('#offerExport').hidden=true;error.textContent='';if(!active)return;
      try{var value=readOffer(),q=Selling.offerQuote(c,value),deadline=Selling.offerDeadline(value),counter=value.counterAmount===null?null:Selling.offerQuote(c,Object.assign({},value,{amount:value.counterAmount}));
        var costNote=value.acquisitionCost!==null?'Uses your scenario cost basis':q.costCount?'Uses your recorded cost':'Cost unknown';
        m.querySelector('#offerQuote').innerHTML='<div><span>Offer '+money(value.amount)+', est. net</span><strong class="'+(q.proceeds<0?'neg':'')+'">'+(q.proceeds===null?'—':money(q.proceeds))+'</strong><small>'+(q.proceeds===null?'Fill in the cost assumptions':'After modeled selling costs')+'</small></div><div><span>Offer, est. profit</span><strong class="'+(q.profit<0?'neg':'')+'">'+(q.profit===null?'—':money(q.profit))+'</strong><small>'+costNote+'</small></div>'+(counter?'<div><span>Counter '+money(value.counterAmount)+', est. net</span><strong>'+(counter.proceeds===null?'—':money(counter.proceeds))+'</strong><small>Scenario only</small></div><div><span>Counter, est. profit</span><strong>'+(counter.profit===null?'—':money(counter.profit))+'</strong><small>Same assumptions</small></div>':'')+(value.minimumNet!==null?'<p>Your minimum net is '+money(value.minimumNet)+'. '+(q.proceeds===null?'Fill in the costs to compare.':q.proceeds>=value.minimumNet?'The offer clears it. That is not approval to accept.':'The offer is below it.')+'</p>':'');
        m.querySelector('#offerScenarioNote').textContent='Recorded cost: '+(Selling.cost(c)===null?'unknown':money(Selling.cost(c)))+'. '+(value.acquisitionCost!==null?'Scenario cost basis: '+money(value.acquisitionCost)+'. ':'')+'Net is not profit, and neither is a settled payout.';
        m.querySelector('#offerDeadline').textContent=deadline.label+(value.expiresAt?'. '+value.expiresAt:'')+(value.expiryNote?'. '+value.expiryNote:'');
      }catch(e){m.querySelector('#offerQuote').textContent='Complete valid offer details to see a scenario.';m.querySelector('#offerDeadline').textContent='No confirmed countdown. Check the timestamp and timezone.';m.querySelector('#offerScenarioNote').textContent=e.message;}
    }
    m.querySelectorAll('[data-offer],[data-offer-cost],#offerEnabled').forEach(function(i){i.addEventListener('input',updateOffer);i.addEventListener('change',updateOffer);});
    m.querySelector('#offerUseDefaults').onclick=function(){var d=defaultOfferAssumptions();m.querySelectorAll('[data-offer-cost]').forEach(function(i){if(i.value.trim()==='')i.value=d[i.dataset.offerCost];});updateOffer();};
    m.querySelector('#offerExportPrepare').onclick=function(){try{if(!validate())return;m.querySelector('#offerExportText').value=JSON.stringify(Selling.exportOfferExchange(c,readOffer()),null,2);m.querySelector('#offerExport').hidden=false;}catch(e){error.textContent=e.message;}};
    m.querySelector('#offerExportCopy').onclick=function(){copyAndReport(m.querySelector('#offerExportText').value,this,'JSON copied');};
    m.querySelector('#offerExportDownload').onclick=function(){var url=URL.createObjectURL(new Blob([m.querySelector('#offerExportText').value],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='private-offer-plan-'+c.sku+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);};
    m.querySelector('#planCancel').onclick=closeModal;
    m.querySelector('#planSave').onclick=function(){
      error.textContent='';if(!validate())return;if(!Selling.held(c)){error.textContent='This card is recorded sold. Recheck its status before saving an offer.';return;}
      var next=Object.assign({},p,{action:m.querySelector('#planAction').value,target:m.querySelector('#planTarget').value,reviewDate:m.querySelector('#planDate').value,note:m.querySelector('#planNote').value.trim()});
      try{if(m.querySelector('#offerEnabled').checked)next.offer=readOffer();else delete next.offer;}catch(e){error.textContent=e.message;return;}
      var old=workspace.plans[c.sku];workspace.plans[c.sku]=next;if(saveWorkspace()){closeModal();render();toast('Selling plan saved on this device');}else{if(old===undefined)delete workspace.plans[c.sku];else workspace.plans[c.sku]=old;}
    };
    updateOffer();
  }
  function openLotDraft(cards,existing) {
    if(cards.length<2){toast('Select at least two eligible cards to build a lot.');return;}
    var d=existing||{},policy=(state.data.radar||{}).policy||{},title=d.title||Selling.lotTitle(cards),description=d.description||Selling.lotDescription(cards);
    var form=Object.assign({price:'',shipping:policy.outbound_shipping==null?8:policy.outbound_shipping,supplies:policy.supplies==null?2:policy.supplies,feeRate:(policy.fee_rate==null?.1325:policy.fee_rate)*100,orderFee:policy.per_order_fee==null?.4:policy.per_order_fee,promotion:(policy.promotion_reserve_rate==null?.02:policy.promotion_reserve_rate)*100,buyerTax:(policy.resale_buyer_tax_rate==null?.08:policy.resale_buyer_tax_rate)*100,feeThreshold:policy.fee_threshold||7500,feeRateAbove:(policy.fee_rate_above==null?.0235:policy.fee_rate_above)*100},d.form||{});
    var m=showWorkspaceModal('<div class="cv-kicker">Lot draft, '+cards.length+' cards</div><h2 id="workspaceTitle">One listing, ready to prepare.</h2><p class="section-note">'+money(cards.reduce(function(n,c){return n+Selling.reference(c);},0))+' in saved values. You choose the lot price; this total is not a recommended asking price.</p><label class="field">Listing title <span id="titleLength"></span><input id="lotTitle" maxlength="80" value="'+esc(title)+'"></label><div class="lot-selected">'+cards.map(function(c){return '<span>'+esc(c.player)+'</span>';}).join('')+'</div><div class="form-grid"><label>Lot asking price ($)<input id="lotPrice" data-quote="price" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Set your price" value="'+esc(form.price)+'"></label><label>Shipping you pay ($)<input data-quote="shipping" type="number" min="0" step="0.01" inputmode="decimal" value="'+esc(form.shipping)+'"></label></div><div id="lotQuote" class="quote-panel" aria-live="polite"></div><details class="cost-assumptions"><summary>Adjust selling cost assumptions</summary><div class="form-grid">'+[['supplies','Packaging ($)'],['feeRate','Base selling fee (%)'],['orderFee','Per-order fee ($)'],['promotion','Promotion reserve (%)'],['buyerTax','Buyer tax allowance (%)'],['feeThreshold','Fee tier threshold ($)'],['feeRateAbove','Fee above threshold (%)']].map(function(f){return '<label>'+f[1]+'<input type="number" data-quote="'+f[0]+'" min="0" '+(/Rate|promotion|buyerTax/.test(f[0])?'max="99.99" ':'')+'step="0.01" inputmode="decimal" value="'+esc(form[f[0]])+'"></label>';}).join('')+'</div><p class="section-note">Planning assumptions from your saved buying policy. Free shipping to the buyer; fees include the buyer-tax allowance. Verify your seller plan, final package and actual costs. No promotion is enabled. Before income tax.</p></details><details class="draft-description"><summary>Listing description & preparation checklist</summary><textarea id="lotDescription" rows="11">'+esc(description)+'</textarea><button class="text-button" id="copyDescription">Copy description</button></details><div class="button-row"><button class="button" id="saveLot">Save lot draft</button><button class="button secondary" id="copyTitle">Copy title</button></div><a class="ebay-draft-link" href="https://www.ebay.com/sl/sell" target="_blank" rel="noopener">Open eBay’s listing form'+icon('external')+'</a><p class="section-note">Draft only, saved on this device. Photograph every card and remove the seller checklist before publishing. Inventory stays unchanged until you record a sale.</p>');
    function update(){m.querySelectorAll('[data-quote]').forEach(function(i){form[i.dataset.quote]=i.value;});var q=Selling.lotQuote(cards,form);m.querySelector('#titleLength').textContent=m.querySelector('#lotTitle').value.length+'/80';m.querySelector('#lotQuote').innerHTML='<div><span>Est. net proceeds</span><strong class="'+(q.proceeds<0?'neg':'')+'">'+(q.proceeds===null?'—':money(q.proceeds))+'</strong><small>After modeled selling costs</small></div><div><span>Est. profit</span><strong class="'+(q.profit<0?'neg':'')+'">'+(q.profit===null?'—':money(q.profit))+'</strong><small>'+q.costCount+'/'+q.count+' acquisition costs recorded</small></div>'+(q.costCount<q.count?'<p>Profit needs the missing purchase costs. Proceeds are not profit.</p>':'');}
    m.querySelectorAll('input').forEach(function(i){i.addEventListener('input',update);});m.querySelector('#copyDescription').onclick=function(){copyAndReport(m.querySelector('#lotDescription').value,this);};m.querySelector('#copyTitle').onclick=function(){copyAndReport(m.querySelector('#lotTitle').value,this);};
    m.querySelector('#saveLot').onclick=function(){if(!m.querySelector('#lotTitle').value.trim()){m.querySelector('#lotTitle').focus();return;}var invalid=Array.from(m.querySelectorAll('input')).find(function(i){return !i.checkValidity();});if(invalid){invalid.reportValidity();return;}if(cards.some(function(c){return !Selling.batchEligible(c,workspace.limit,workspace.includeSpecial,workspace.plans[c.sku]);})){toast('Inventory changed. Recheck your selected cards.');return;}var row={id:d.id||'lot-'+Date.now(),title:m.querySelector('#lotTitle').value.trim(),description:m.querySelector('#lotDescription').value,skus:cards.map(function(c){return c.sku;}),form:form,updated:new Date().toISOString()};var ix=workspace.lots.findIndex(function(x){return x.id===row.id;});if(ix<0)workspace.lots.unshift(row);else workspace.lots[ix]=row;if(saveWorkspace()){selectedLot={};closeModal();state.sellMode='drafts';render();toast('Lot draft saved on this device');}};update();
  }
  function savedLotDrafts() {
    var wrap=el('<div class="saved-lots"></div>');wrap.appendChild(sectionHead('Your lot drafts','Saved on this device. Nothing has been listed automatically.','Build another',function(){goSell('lots');}));
    workspace.lots.forEach(function(d){var cards=state.data.cards.filter(function(c){return d.skus.indexOf(c.sku)>=0&&Selling.batchEligible(c,workspace.limit,workspace.includeSpecial,workspace.plans[c.sku]);}),changed=cards.length!==d.skus.length,row=el('<article class="cv-panel saved-lot"><span class="signal '+(changed?'amber':'green')+'">'+(changed?'Recheck selection':'Draft')+'</span><h3>'+esc(d.title)+'</h3><p>'+d.skus.length+' selected cards, updated '+esc(savedDate(d.updated))+'</p>'+(changed?'<p class="warning-text">Some cards are sold, listed, or outside the current lot rules. Rebuild this draft before using it.</p>':'')+'<div class="button-row"><button class="button small" data-open'+(changed?' disabled':'')+'>Continue draft</button><button class="text-button" data-remove>Remove draft</button></div></article>');row.querySelector('[data-open]').onclick=function(){openLotDraft(cards,d);};row.querySelector('[data-remove]').onclick=function(){var old=workspace.lots.slice();workspace.lots=workspace.lots.filter(function(x){return x.id!==d.id;});if(saveWorkspace()){render();toast('Draft removed; your cards are unchanged');}else workspace.lots=old;};wrap.appendChild(row);});
    if(!workspace.lots.length)wrap.appendChild(emptyPanel('Your next lot starts here','Choose a related group of lower-value cards, then save its title, checklist and selling-cost scenario.'));
    var single=el('<details class="single-drafts"><summary>Individual card listing drafts</summary></details>');single.appendChild(viewDrafts());wrap.appendChild(single);return wrap;
  }



  function setTab(tab) {
    var openSheet=document.getElementById('modalWrap');if(openSheet&&openSheet.classList.contains('open'))closeModal();
    if(tab==='targets'){state.buyMode='targets';tab='radar';}
    if(tab==='drafts'){state.sellMode='drafts';tab='sell';}
    if(tab==='salesmap'){state.sellMode='plan';tab='sell';}
    state.tab=tab;
    document.querySelectorAll('.nav button').forEach(function(b){var on=b.dataset.tab===tab;b.classList.toggle('on',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    if(history.replaceState)history.replaceState(null,'','#tab='+tab);
    render();
  }

  function badges(c) {
    var out = "";
    if (c.sold) out += '<span class="badge b-soldtag">SOLD</span>';
    else if (c.listed) out += '<span class="badge b-listed">LISTED</span>';
    if (c.is_merch) {
      if (c.auto) out += '<span class="badge b-auto">AUTO</span>';
      if (c.authentication) out += '<span class="badge b-psa">' + esc(c.authentication) + " COA</span>";
      if (/fram/i.test(c.item_type)) out += '<span class="badge b-num">FRAMED</span>';
      return out ? '<span class="badges">' + out + "</span>" : "";
    }
    if (c.graded && c.grader && c.grade) out += '<span class="badge b-psa">' + esc(c.grader.toUpperCase() + " " + c.grade) + "</span>";
    if (c.rookie) out += '<span class="badge b-rc">RC</span>';
    if (c.auto) out += '<span class="badge b-auto">AUTO</span>';
    if (c.relic) out += '<span class="badge b-relic">RELIC</span>';
    if (c.serial_run) out += '<span class="badge b-num">/' + esc(c.serial_run) + "</span>";
    return out ? '<span class="badges">' + out + "</span>" : "";
  }

  // team colors [primary, secondary] for the smart placeholder gradient.
  var TEAM_COLORS = {
    // NFL
    "Texans": ["#03202F", "#A71930"], "Dolphins": ["#008E97", "#FC4C02"],
    "Giants": ["#0B2265", "#A71930"], "Ravens": ["#241773", "#9E7C0C"],
    "Commanders": ["#5A1414", "#FFB612"], "Bills": ["#00338D", "#C60C30"],
    "Falcons": ["#A71930", "#000000"], "Raiders": ["#0B0B0B", "#A5ACAF"],
    "Chiefs": ["#E31837", "#FFB81C"], "Cardinals": ["#97233F", "#000000"],
    "Lions": ["#0076B6", "#B0B7BC"], "Colts": ["#002C5F", "#A2AAAD"],
    "Cowboys": ["#041E42", "#869397"], "49ers": ["#AA0000", "#B3995D"],
    "Los Angeles Rams": ["#003594", "#FFA300"], "Rams": ["#003594", "#FFA300"],
    "Tampa Bay Buccaneers": ["#D50A0A", "#34302B"], "Buccaneers": ["#D50A0A", "#34302B"],
    // NBA
    "Warriors": ["#1D428A", "#FFC72C"], "Pistons": ["#C8102E", "#1D42BA"],
    // MLB
    "Reds": ["#C6011F", "#000000"],
    // NHL
    "Rangers": ["#0038A8", "#CE1126"],
    // Soccer / College
    "PSG": ["#004170", "#DA291C"], "Alabama": ["#9E1B32", "#828A8F"]
  };
  function initials(name) {
    if (!name) return "🃏";
    var parts = String(name).replace(/[^A-Za-z ]/g, " ").trim().split(/\s+/);
    var s = (parts[0] ? parts[0][0] : "") + (parts[1] ? parts[1][0] : "");
    return s ? s.toUpperCase() : "🃏";
  }


  // price-basis pill: green REAL (sold prices the owner recorded), violet PSA
  // (PSA's own market estimate for this card+grade), blue EST (asking comps
  // haircut to estimate market — eBay denied us the sold-comp API), gold ASKING
  // (raw active listings).
  function basisPill(c) {
    if (c.sold) return "";   // the SOLD badge + real price say it better
    if (c.status !== "priced" || !c.price_basis) return "";
    // "REAL", not "SOLD": this pill says where the PRICE came from, and a
    // green SOLD here sat inches from the red SOLD status badge on cards the
    // owner still owns — which is exactly the "does it think I sold it?"
    // confusion. The status badge owns the word "sold".
    var map = { sold: ["b-sold", "REAL", "Priced from real sold prices you recorded"],
                psa: ["b-psaval", "PSA", "PSA’s own market estimate for this card at this grade"],
                est_sold: ["b-est", "EST", "Estimated: eBay asking prices, discounted toward sold"],
                asking: ["b-ask", "ASKING", "From what sellers are asking on eBay right now"] };
    var p = c.reviewed_price
      ? ["b-sold", "REVIEWED", "Reviewed median of source-reported sold prices"]
      : map[c.price_basis] || map.asking;
    return '<span class="basis ' + p[0] + '" title="' + p[2] + '">' + p[1] + "</span>";
  }

  // ▲/▼ week-over-week movement chip (needs a prior price from reprice runs)
  function changeChip(c) {
    var cur = num(c.asking_price), prev = num(c.prev_price);
    if (c.sold || !cur || !prev) return "";
    var pct = (cur - prev) / prev * 100;
    if (Math.abs(pct) < 0.5) return "";
    var up = pct > 0;
    return '<span class="chg ' + (up ? "up" : "down") + '">' + (up ? "▲" : "▼") +
      Math.abs(pct).toFixed(Math.abs(pct) >= 10 ? 0 : 1) + "%</span>";
  }


  // instant search: every word must hit somewhere in the card's text
  function matchQuery(c) {
    if (!state.q) return true;
    var hay = [c.player, c.team, c.set, c.brand, c.year, c.sku, c.parallel,
               c.insert, c.sport, c.item_type, c.grader, c.grade, c.card_number, c.line]
              .join(" ").toLowerCase();
    return state.q.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  var SORTS = [["val-desc","Value: high to low"],["val-asc","Value: low to high"],["az","Player A–Z"],["cost-desc","Cost: high to low"],["listed","On eBay first"],["new","Recently added"]];
  function sortCards(arr,mode) {
    return arr.slice().sort(function(a,b){
      var result=0,av,bv;
      if(mode==='az')result=String(a.player).localeCompare(String(b.player));
      else if(mode==='new')result=String(b.sku).localeCompare(String(a.sku),undefined,{numeric:true});
      else if(mode==='cost-desc'){av=Selling.cost(a);bv=Selling.cost(b);result=av===null?(bv===null?0:1):bv===null?-1:bv-av;}
      else if(mode==='listed')result=Number(Selling.listed(b))-Number(Selling.listed(a))||(Selling.reference(b)||0)-(Selling.reference(a)||0);
      else{av=Selling.reference(a);bv=Selling.reference(b);result=av===null?(bv===null?0:1):bv===null?-1:mode==='val-asc'?av-bv:bv-av;}
      return result||String(a.sku).localeCompare(String(b.sku));
    });
  }



  // ---------- readiness score (Results -> Collection map) ----------
  // A sorting aid built from fields already in data.json. It is never a
  // sale-timing forecast and never says "sell now".

  // % price move vs the prior weekly snapshot (null when we have no prior).
  function sellMomentum(c) {
    var cur = num(c.asking_price), prev = num(c.prev_price);
    if (!cur || !prev) return null;
    return (cur - prev) / prev * 100;
  }

  // Sell-readiness score 0–100 = value(34) + liquidity(36) + confidence(10) +
  // momentum(20, centred). Returns the score, 0–3 rating bars, and plain
  // reasons so a non-technical owner sees WHY a card ranks where it does.
  function sellScore(c) {
    var v = num(c.asking_price), reasons = [], score = 0;

    // 1) Value — bigger tickets are worth the listing effort (log scale).
    score += Math.max(0, Math.min(34, (Math.log(Math.max(v, 1)) / Math.log(1000)) * 34));
    if (v >= 100) reasons.push("premium value");

    // 2) Liquidity / desirability — what makes a card sell fast.
    var liq = 0;
    if (c.graded) { liq += 14; reasons.push(((c.grader || "graded").toUpperCase() + (c.grade ? " " + c.grade : "")).trim()); }
    if (c.auto) { liq += 10; reasons.push("auto"); }
    if (c.serial_run) { liq += 6; reasons.push("/" + c.serial_run); }
    if (c.rookie) { liq += 4; reasons.push("rookie"); }
    if (/football/i.test(c.sport || "")) { liq += 6; reasons.push("football"); }
    score += Math.min(36, liq);

    // 3) Price confidence — how much we trust the number we'd list at. The
    // owner's own tracked REAL sold prices are the strongest signal we have.
    if (mySold(c)) { score += 10; reasons.push("real sold ✓"); }
    else score += c.price_basis === "sold" ? 10 : c.price_basis === "psa" ? 9
      : c.price_basis === "est_sold" ? 6 : c.price_basis === "asking" ? 3 : 0;

    // 4) Momentum — rising price = sell into strength (neutral when unknown).
    var pct = sellMomentum(c);
    if (pct == null) { score += 10; }
    else {
      score += 10 + Math.max(-10, Math.min(10, pct));
      if (pct >= 3) reasons.push("▲ up " + Math.round(pct) + "% this wk");
      else if (pct <= -3) reasons.push("▼ down " + Math.abs(Math.round(pct)) + "% this wk");
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    var bars = score >= 70 ? 3 : score >= 45 ? 2 : score >= 22 ? 1 : 0;
    return { score: score, bars: bars, reasons: reasons };
  }

  // "Usually going for" — the asking-comps median reprice.py captured (with the
  // listing count it was based on). eBay denied us real SOLD comps, so this is
  // the typical ASKING price; our est_sold value already haircuts it. null when
  // we have no market read yet for this card.
  function goingFor(c) {
    return (c.market && num(c.market.median) > 0)
      ? { median: num(c.market.median), count: c.market.count | 0 } : null;
  }

  // Is the market read solid enough to suggest headroom? Needs a real sample
  // and our price sitting sensibly below the median (guards the noisy, thin
  // comps that reprice.py flags — e.g. a $189 card whose 3 comps median $885).
  function marketSolid(c, m) {
    var cur = num(c.asking_price);
    // Never suggest headroom against the asking median on a card priced from
    // real sold data (PSA's estimate, or sold prices the owner recorded). The
    // gap between the two is asking-price inflation, not money left on the
    // table — reading it as upside is how the collection got 51% overvalued.
    if (c.price_basis === "psa" || c.price_basis === "sold") return false;
    return m && m.count >= 5 && cur > 0 && cur < m.median && cur >= m.median * 0.5;
  }

  // value rating (like Alt's green bars): 3 Great / 2 Good / 1 Fair / 0 Over
  var RATINGS = { 3: ["Great Value", "great"], 2: ["Good Value", "good"],
                  1: ["Fair Price", "fair"], 0: ["Over Market", "over"] };
  function ratingBars(bars) {
    var n = Math.max(0, Math.min(3, bars | 0));
    var out = "";
    for (var i = 0; i < 3; i++) out += '<span class="vb' + (i < n ? " on" : "") + '"></span>';
    return '<span class="vbars">' + out + "</span>";
  }

  var BUY_CATEGORIES = { downtown_kaboom: "Downtown / Kaboom", autos: "Numbered & rookie autos", rookies: "Graded rookies", inserts: "Other chase inserts", established: "Stars & legends" };
  function radarMoney(n) { return typeof n === "number" ? money(n) : "Not established"; }
  function safeBuyLink(url) { return /^https:\/\//i.test(url || "") ? esc(url) : "#"; }
  function radarHasNumber(n) { return typeof n === "number" && isFinite(n); }
  function radarDisplayPrice(n, exact) {
    if (!radarHasNumber(n)) return '—';
    return exact && Math.abs(n - Math.round(n)) > .001 ? money(n) : money0(n);
  }
  function profitResearchRow(c) {
    var e = c.economics, ev = c.evidence || {}, specs = c.identity || {};
    var resale = e ? e.resale : ev.conservative_resale;
    var priced = radarHasNumber(resale), hasProfit = e && radarHasNumber(e.adjusted_profit);
    var supported = ev.confidence === 'medium';
    var status = {qualified:c.grade_scope === 'exception' ? '★ RARE EXCEPTION' : '✓ BUY CANDIDATE', research:'RESEARCH ONLY', pass:'✕ DO NOT BUY', excluded:'— REJECTED'}[c.status] || 'RESEARCH ONLY';
    var player = specs.player || c.label;
    var initials = player.split(/\s+/).filter(Boolean).slice(0,2).map(function(x){return x[0];}).join('');
    var specLine = [specs.year, specs.set, specs.number ? '#' + specs.number : '', specs.parallel && specs.parallel !== 'base' ? specs.parallel : '', specs.print_run && specs.print_run !== 'none' ? '/' + specs.print_run : ''].filter(Boolean).join(' · ');
    var grade = specs.grader && specs.grade ? specs.grader + ' ' + specs.grade : 'Grade unconfirmed';
    var unavailable = c.page_state === 'sold' || c.page_state === 'ended';
    var askLabel = c.buying_option === 'AUCTION' ? 'Current bid' : unavailable ? 'Past listing' : c.page_state === 'mismatch' ? 'Wrong-grade ask' : 'Listed for';
    var buyNote = c.buying_option === 'AUCTION' ? 'Auction · price can rise' : unavailable ? 'No longer available' : c.page_state === 'mismatch' ? 'Not the target card' : radarHasNumber(c.all_in) ? 'Est. total ' + money0(c.all_in) : 'Shipping / tax unknown';
    var resaleNote = priced ? (supported ? 'Based on sold comps' : 'Low-confidence estimate') : 'Need sold comps';
    var profitText = hasProfit ? (e.adjusted_profit >= 0 ? '+' : '−') + money0(Math.abs(e.adjusted_profit)) : '—';
    var profitTone = hasProfit ? (e.adjusted_profit < 0 ? 'loss' : c.status === 'qualified' ? 'gain' : 'pending') : 'pending';
    var profitLabel = hasProfit && e.adjusted_profit < 0 ? 'Loss incl. time & risk' : 'Profit after all costs';
    var profitNote = hasProfit ? 'Cash result: ' + (e.cash_margin >= 0 ? '+' : '−') + money0(Math.abs(e.cash_margin)) : unavailable || c.page_state === 'mismatch' ? 'No eligible listing' : priced ? 'Purchase costs unknown' : 'Resale estimate needed';
    var shortReason = c.status === 'qualified' ? 'Clears your buying rules' : c.status === 'pass' ? 'Too expensive at this price' : c.page_state === 'mismatch' ? 'Wrong card or grade' : unavailable ? 'Unavailable' : c.buying_option === 'AUCTION' ? 'Auction · wait for final price' : c.all_in > 1000 ? 'Above your buying budget' : !priced ? 'Wait for sold comparisons' : 'Verify before buying';
    if (c.status === 'research' && c.page_state === 'unverified') shortReason = 'Availability needs a recheck';
    var soldRows = (ev.sales || []).map(function(s) {
      return '<a class="pr-sale" target="_blank" rel="noopener" href="' + safeBuyLink(s.url) + '"><span>' + esc(s.date) + ' · ' + esc(s.source_type) + '</span><b>' + money(s.price) + '</b></a>';
    }).join('');
    var math = e ? '<div class="pr-math">' + [
      ['Expected resale', e.resale], ['Your total purchase cost', -e.acquisition],
      ['eBay fees', -e.selling_fee], ['Promotion allowance', -e.promotion_reserve],
      ['Shipping + supplies', -e.outbound_shipping-e.supplies],
      ['Cash margin before reserves', e.cash_margin], ['Risk reserve', -e.contingency],
      ['Your time', -e.labor_allowance], ['Cost of holding cash', -e.capital_allowance],
      ['Adjusted profit · before income tax', e.adjusted_profit]
    ].map(function(x){return '<div><span>' + esc(x[0]) + '</span><b>' + money(x[1]) + '</b></div>';}).join('') +
      '<p class="muted">Your minimum: ' + money(e.minimum_profit) + ' profit AND ' + Math.round(e.minimum_roi*100) + '% return. This scenario: ' + Math.round(e.roi*100) + '% return. If resale drops 15% and the hold takes 60 days longer: ' + money(c.stress_profit) + ' profit.</p></div>' :
      '<p class="muted">We do not have enough sold-price evidence to estimate resale and profit. Asking prices and unverified guide values are not resale estimates.</p>';
    return '<article class="pr-card pr-decision pr-decision-' + esc(c.status) + '">' +
      '<div class="pr-cardhead"><span class="pr-status pr-' + esc(c.status) + '">' + status + '</span><span class="pr-grade">' + esc(grade) + '</span></div>' +
      '<div class="pr-identity"><div class="pr-monogram" aria-hidden="true">' + esc(initials) + '</div><div><h3>' + esc(player) + '</h3><p class="pr-spec">' + esc(specLine || c.item_title) + (specs.autograph ? ' · AUTO' : '') + '</p></div></div>' +
      '<div class="pr-priceflow"><div class="pr-pricebox"><span>' + askLabel + '</span><strong>' + radarDisplayPrice(c.price,true) + '</strong><small>' + buyNote + '</small></div><span class="pr-flowarrow" aria-hidden="true">→</span>' +
      '<div class="pr-pricebox pr-resale ' + (!priced ? 'pr-unknown' : '') + '"><span>Expected resale</span><strong>' + (priced ? '~' : '') + radarDisplayPrice(resale) + '</strong><small>' + resaleNote + '</small></div></div>' +
      '<div class="pr-profit pr-profit-' + profitTone + '"><div><span>' + profitLabel + '</span><small>' + profitNote + '</small></div><strong>' + profitText + '</strong></div>' +
      '<div class="pr-bottomline"><span>' + shortReason + '</span><span>' + esc(c.hold_days) + '-day plan</span></div>' +
      '<details class="pr-detail"><summary>Price breakdown & sources</summary><p>' + esc(c.item_title) + '</p><p class="muted">' + esc(c.ceiling_label || '') + '. ' + ev.count + ' reported sales; ' + ev.primary_count + ' primary confirmations. Estimates are before income tax. Large figures are rounded; exact amounts are below.</p>' +
      '<div class="pr-math"><div><span>' + askLabel + '</span><b>' + radarMoney(c.price) + '</b></div><div><span>Incoming shipping</span><b>' + radarMoney(c.shipping) + '</b></div><div><span>Estimated total with tax</span><b>' + radarMoney(c.all_in) + '</b></div></div>' +
      '<p>' + esc(c.hold_days) + '-day hold: ' + esc(c.hold_basis) + '.</p>' +
      (radarHasNumber(c.max_all_in) ? '<p>Maximum total buy cost at this resale: <b>' + (c.max_all_in > 0 ? money(c.max_all_in) : 'No viable price') + '</b>.' + (!supported ? ' Unverified scenario only.' : '') + '</p>' : '') +
      (c.max_offer > 0 ? '<p>Item-price ceiling: <b>' + money(c.max_offer) + '</b>. Opening-offer scenario: ' + money(c.opening_offer) + '. No offer sent.</p>' : '') +
      math + '<ul>' + (c.reasons || []).map(function(r){return '<li>' + esc(r) + '</li>';}).join('') + '</ul>' + soldRows +
      '<p class="muted">Observed ' + esc(c.checked_at || 'unknown') + '. Recheck availability, checkout tax and shipping. Source-reported sales are not proof of settlement.</p>' + compResearchLinks(c.query||c.item_title||c.label,dealSearchUrl(c,true)) + '</details>' +
      '<a class="pr-listing" target="_blank" rel="noopener" href="' + safeBuyLink(c.url) + '">' + (unavailable || c.page_state === 'mismatch' ? 'View original source' : 'View listing') + ' <span aria-hidden="true">↗</span></a></article>';
  }
  function viewProfitRadar(radar) {
    var wrap = el('<div class="view profit-radar"></div>');
    var rows = (radar.candidates || []).map(function(c) {
      if (c.status !== 'qualified') return c;
      var age = Date.now() - Date.parse(c.checked_at || '');
      if (isFinite(age) && age >= 0 && age <= 48*3600000) return c;
      return Object.assign({}, c, {status:'research', grade_scope:c.grade_scope === 'exception' ? 'outside_focus' : c.grade_scope, reasons:['Listing observation expired; recheck before acting'].concat(c.reasons || [])});
    });
    var allRows = rows;
    rows = allRows.filter(function(c){return c.grade_scope === 'exception' || (c.grade_scope !== 'outside_focus' && String((c.identity || {}).grader).toUpperCase() === 'PSA' && String((c.identity || {}).grade) === '10');});
    rows.sort(function(a,b){var rank=function(c){return c.status==='qualified'?0:c.status==='excluded'?3:c.economics?1:2;};return rank(a)-rank(b);});
    var counts = {}, policy = radar.policy || {}, coverage = radar.coverage || {};
    ['qualified','research','pass','excluded'].forEach(function(k){counts[k]=rows.filter(function(c){return c.status===k;}).length;});
    wrap.appendChild(el('<div class="pr-overview"><div class="pr-overviewtop"><div><span class="pr-kicker">PSA 10 buy radar</span><h2>' + counts.qualified + ' ready to buy</h2></div><span class="pr-partial">Partial scan</span></div><div class="pr-counts">' +
      [['research','Research'],['pass','Pass'],['excluded','Excluded']].map(function(x){return '<div><i class="pr-dot pr-dot-' + x[0] + '" aria-hidden="true"></i><b>' + counts[x[0]] + '</b><span>' + x[1] + '</span></div>';}).join('') +
      '</div><div class="pr-overviewfoot">' + rows.length + ' cards in view, ' + radar.watch_count + ' PSA 10 targets</div></div>'));
    var diagnostic = radar.diagnostics || {};
    var rules = '<details class="pr-policy"><summary>Buying rules & scan details</summary><p><b>PSA 10s first.</b> Other grades only appear if fully verified with at least $300 adjusted profit AND 50% return, and a supported hold of 30 days or less. Otherwise they stay out of this view.</p><p>Both minimums must pass after all fees, costs, time and holding allowances.</p><div class="pr-tier">';
    (policy.hold_tiers || []).forEach(function(t,i){var prev=i?policy.hold_tiers[i-1].through_days+1:1;rules+='<div><span>'+prev+'–'+t.through_days+' days</span><b>'+money0(t.profit)+' AND '+Math.round(t.roi*100)+'% return</b></div>';});
    rules += '</div><p>Normal total buy budget: $500. $500–$1,000 needs individual review; above $1,000 is research only. Unknown hold: 90 days. Shorter holds need supporting evidence. Over 120 days: research only.</p><p class="muted">' + esc(policy.assumptions || '') + '</p><a target="_blank" rel="noopener" href="' + safeBuyLink(policy.fee_source) + '">eBay fee schedule ↗</a>' +
      '<p class="muted">' + esc(coverage.mode || 'Research snapshot') + ' · evaluated ' + esc((radar.as_of || '').slice(0,16).replace('T',' ')) + ' UTC. ' + esc(coverage.notes || 'Partial scan.') + '</p>';
    rules += '<p>' + (allRows.length-rows.length) + ' other-grade observations are hidden. Original evidence is preserved.</p>';
    if(typeof diagnostic.sales_supported==='number') rules += '<p>' + diagnostic.sales_supported + ' of ' + radar.scanned + ' observations have the required primary sold records. ' + diagnostic.priced_scenarios + ' have a resale scenario.</p>';
    if((coverage.api_access||{}).browse==='credentials_unavailable') rules += '<p class="muted">This run used public pages. Live eBay API access was unavailable in this research runner.</p>';
    rules += '</details>'; wrap.appendChild(el(rules));
    var stale = rows.some(function(c){var age=Date.now()-Date.parse(c.checked_at||'');return !isFinite(age)||age<0||age>48*3600000;});
    if(stale) wrap.appendChild(el('<div class="pr-warning">Older prices — recheck listings before buying.</div>'));
    var toolbar = el('<div class="pr-toolbar"><label>Show<select id="profitStatus"><option value="qualified">Buy opportunities '+counts.qualified+'</option><option value="research">Research only '+counts.research+'</option><option value="rejected">Rejected '+(counts.pass+counts.excluded)+'</option><option value="all">All checked '+rows.length+'</option></select></label><label>Type<select id="profitCategory"><option value="all">All cards</option>'+Object.keys(BUY_CATEGORIES).map(function(k){return '<option value="'+k+'">'+BUY_CATEGORIES[k]+'</option>';}).join('')+'</select></label></div>');
    wrap.appendChild(toolbar);
    var viewLabel=el('<p class="pr-viewlabel"></p>');wrap.appendChild(viewLabel);
    var list=el('<div class="pr-grid"></div>');wrap.appendChild(list);
    function update(){
      var status=toolbar.querySelector('#profitStatus').value,category=toolbar.querySelector('#profitCategory').value;
      var shown=rows.filter(function(c){return(status==='all'||c.status===status||(status==='rejected'&&(c.status==='pass'||c.status==='excluded')))&&(category==='all'||c.category===category);});
      viewLabel.textContent={qualified:'BUY OPPORTUNITIES',research:'RESEARCH ONLY · NOT READY TO BUY',rejected:'REJECTED · DO NOT BUY',all:'RESEARCH LOG · INCLUDES REJECTED CARDS'}[status] || '';
      list.innerHTML=shown.length?shown.map(profitResearchRow).join(''):status==='qualified'?'<div class="pr-empty"><span aria-hidden="true">⌕</span><h3>No verified buys yet</h3><p>Only cards meeting your profit rules appear here.</p></div>':'<div class="card"><p>No cards in this view yet.</p></div>';
    }
    toolbar.querySelectorAll('select').forEach(function(s){s.onchange=update;});update();
    return wrap;
  }

  function viewRadar() {
    if ((state.data.radar || {}).schema_version === 2) return viewProfitRadar(state.data.radar);
    var wrap = el('<div class="view"></div>');
    var radar = state.data.radar || { as_of: "", watch_count: 0, deals: [] };
    var deals = radar.deals || [];
    wrap.appendChild(el('<div class="eyebrow">Buy Radar</div>'));
    var extra = (radar.scanned && radar.scanned > deals.length)
      ? " Showing the " + deals.length + " strongest of " + radar.scanned + " under-market finds."
      : "";
    var band = (radar.price_min && radar.price_max)
      ? " Focused on " + money0(radar.price_min) + "–" + money0(radar.price_max) +
        " cards, football first."
      : "";
    var sub = radar.as_of
      ? "Live eBay deals on your watchlist, priced under market. Rated Great / Good / Fair." +
        band + " Last checked " + esc(radar.as_of) + " · refreshes automatically." + extra
      : "Scans eBay for deals on your watchlist and rates them Great / Good / Fair." + band +
        " Runs on a schedule and refreshes here — nothing to do.";
    wrap.appendChild(el('<p class="muted" style="font-size:13px;margin:0 2px 12px">' + sub + "</p>"));

    if (!deals.length) {
      var msg = radar.as_of
        ? "No deals under your targets right now — inventory turns over fast, so Buy Radar re-checks on its next run."
        : "Buy Radar hasn’t run yet. Once it does (it’s scheduled), the best under-market deals on your watchlist show up here.";
      wrap.appendChild(el('<div class="card"><p class="muted" style="margin:0">' + msg +
        '</p></div>'));
      wrap.appendChild(el('<p class="muted" style="font-size:12px;margin:12px 2px">' +
        "Edit your watchlist in data/watchlist.csv (add a fair value or an alert-below price to sharpen the deals)." +
        "</p>"));
      return wrap;
    }

    // ---- Filter bar: Type (Downtown/Kaboom/Other), Sport, Graded, PSA grade.
    // Options are built from what's actually in the current deals, so we never
    // show an empty facet.
    var TYPE_LABEL = { downtown: "Downtown", kaboom: "Kaboom", other: "No Kaboom/Downtown" };
    var typesPresent = ["downtown", "kaboom", "other"].filter(function (t) {
      return deals.some(function (d) { return dealType(d) === t; });
    });
    var sportsPresent = deals.map(function (d) { return (d.sport || "").toLowerCase(); })
      .filter(function (s, i, a) { return s && a.indexOf(s) === i; });
    var gradesPresent = deals.map(dealGrade).filter(function (g, i, a) {
      return g && a.indexOf(g) === i;
    }).sort(function (a, b) { return parseFloat(b) - parseFloat(a); });
    var hasGraded = deals.some(function (d) { return dealGrader(d); });

    function sel(name, opts) {
      var cur = state.radarFilter[name];
      var o = opts.map(function (op) {
        return '<option value="' + op[0] + '"' + (cur === op[0] ? " selected" : "") +
          ">" + esc(op[1]) + "</option>";
      }).join("");
      return '<select class="sortsel" data-rf="' + name + '">' + o + "</select>";
    }

    var controls = "";
    controls += sel("type", [["all", "All types"]].concat(typesPresent.map(function (t) {
      return [t, TYPE_LABEL[t]]; })));
    if (sportsPresent.length) {
      controls += sel("sport", [["all", "All sports"]].concat(sportsPresent.map(function (s) {
        return [s, s.charAt(0).toUpperCase() + s.slice(1)]; })));
    }
    if (hasGraded) {
      controls += sel("graded", [["all", "Graded: all"], ["graded", "Graded only"], ["raw", "Raw only"]]);
    }
    if (gradesPresent.length) {
      controls += sel("grade", [["all", "Any PSA grade"]].concat(gradesPresent.map(function (g) {
        return [g, "PSA " + g]; })));
    }
    var bar = el('<div class="radartools">' + controls + "</div>");
    bar.querySelectorAll("select").forEach(function (s) {
      s.onchange = function () {
        state.radarFilter[s.getAttribute("data-rf")] = s.value;
        renderResults();
      };
    });
    wrap.appendChild(bar);

    var results = el("<div></div>");
    wrap.appendChild(results);

    function renderResults() {
      results.innerHTML = "";
      var f = state.radarFilter;
      var shown = deals.filter(function (d) { return matchRadar(d, f); });
      var active = f.type !== "all" || f.sport !== "all" || f.graded !== "all" || f.grade !== "all";
      var head = el('<div class="rescount">Showing ' + shown.length + " of " + deals.length +
        " deals" + (active ? ' · <a href="#" class="clearf">Clear filters</a>' : "") + "</div>");
      results.appendChild(head);
      var clr = head.querySelector(".clearf");
      if (clr) clr.onclick = function (e) {
        e.preventDefault();
        state.radarFilter = { type: "all", sport: "all", graded: "all", grade: "all" };
        render();
      };

      if (!shown.length) {
        results.appendChild(el('<div class="card"><p class="muted" style="margin:0">' +
          "No deals match these filters right now. Try clearing one — inventory changes on every scan." +
          "</p></div>"));
        return;
      }

      var list = el('<div class="list radar"></div>');
      shown.forEach(function (d) {
        var r = RATINGS[Math.max(0, Math.min(3, d.bars | 0))] || RATINGS[0];
        var auction = /AUCTION/i.test(d.buying_option || "");
        var kind = auction ? "Auction" : "Buy Now";
        var ph = { image: d.image, player: d.label, team: "" };
        var sportBadge = /^football$/i.test(d.sport || "") ? ' <span class="sportbadge">🏈</span>' : "";
        var premiumBadge = d.premium ? ' <span class="badge b-num">💥</span>' : "";
        var row = el('<div class="drow" role="button" tabindex="0">' +
          thumb(ph, "dthumb") +
          '<div class="dm">' +
            '<div class="dp">' + esc(d.label) + sportBadge + premiumBadge + "</div>" +
            '<div class="ds">' + esc(d.item_title) + "</div>" +
            '<div class="drate ' + r[1] + '">' + ratingBars(d.bars) +
              '<span class="rlabel">' + r[0] + "</span>" +
              (d.snipe ? '<span class="snipe">⏱ ENDS SOON</span>' : "") +
            "</div>" +
            '<div class="dmeta">' + kind + " · vs " + refLine(d) + thinChip(d) + "</div>" +
          "</div>" +
          '<div class="dr">' +
            '<div class="dprice tnum">' + money(d.price) + "</div>" +
            '<div class="ddisc tnum">▼ ' + Math.abs(Math.round(d.discount_pct)) + "% under</div>" +
          "</div></div>");
        row.onclick = function () { openDeal(d); };
        row.onkeydown = function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDeal(d); }
        };
        list.appendChild(row);
      });
      results.appendChild(list);
      results.appendChild(el('<p class="muted" style="font-size:12px;margin:14px 2px">' +
        "Tap a deal to see what’s on eBay now + recent sold prices, then open the listing. " +
        "Prices are live from eBay’s active listings; “mkt” is the market reference we compared against." + "</p>"));
    }

    renderResults();
    return wrap;
  }

  // ---- Honest reference labels: how many comps, which grade pool, thin-data --
  var POOL_LABEL = { psa10: "PSA 10 pool", psa9: "PSA 9 pool",
    graded_other: "graded pool", raw: "raw pool" };
  function poolLabel(d) {
    return POOL_LABEL[d.grade_key] || "";
  }
  // "~$980 · 7 comps · PSA 10 pool" — the reference, made honest.
  function refLine(d) {
    var out = "~" + money0(d.reference);
    if (d.ref_count) out += " · " + d.ref_count + " comp" + (d.ref_count === 1 ? "" : "s");
    var pool = poolLabel(d);
    if (pool) out += " · " + pool;
    return out;
  }
  // A small caution chip when the reference came from very few comps.
  function thinChip(d) {
    return (d.ref_count && d.ref_count < 5)
      ? ' <span class="thinchip" title="Market reference from few listings — treat as a rough guide">thin data</span>'
      : "";
  }

  // ---- Buy Radar deal facets, derived from each deal's title/query ----------
  function dealType(d) {
    var s = ((d.query || "") + " " + (d.item_title || "")).toLowerCase();
    if (s.indexOf("kaboom") >= 0) return "kaboom";
    if (s.indexOf("downtown") >= 0) return "downtown";
    return "other";
  }
  function dealGrader(d) {
    var m = (d.item_title || "").match(/\b(PSA|BGS|BVG|SGC|CGC|CSG|HGA)\b/i);
    return m ? m[1].toUpperCase() : "";
  }
  function dealGrade(d) {
    // PSA grade specifically (owner asked "what PSA grade").
    var m = (d.item_title || "").match(/\bPSA\s*(10|9\.5|9|8\.5|8|7|6|5)\b/i);
    return m ? m[1] : "";
  }
  function matchRadar(d, f) {
    if (f.type !== "all" && dealType(d) !== f.type) return false;
    if (f.sport !== "all" && (d.sport || "").toLowerCase() !== f.sport) return false;
    if (f.graded === "graded" && !dealGrader(d)) return false;
    if (f.graded === "raw" && dealGrader(d)) return false;
    if (f.grade !== "all" && dealGrade(d) !== f.grade) return false;
    return true;
  }

  // eBay public search URL for a deal — live listings, or completed/sold.
  function dealSearchUrl(d, soldOnly) {
    var q = d.query || d.item_title || d.label;
    return "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(q) +
      (soldOnly ? "&LH_Sold=1&LH_Complete=1" : "");
  }

  // "Currently on eBay" box — the cheapest live listings radar.py captured.
  function samplesBox(d) {
    if (!d.samples || !d.samples.length) return "";
    var rows = d.samples.map(function (s) {
      var inner = '<span class="ct">' + esc(s.t) + '</span><b class="tnum">' + money0(s.p) + "</b>";
      return s.u ? '<a class="comp" href="' + esc(s.u) + '" target="_blank" rel="noopener">' + inner + "</a>"
                 : '<span class="comp">' + inner + "</span>";
    }).join("");
    return '<div class="compsbox"><div class="lab">Currently on eBay · cheapest</div>' + rows +
      '<div class="cfoot">live active listings · tap one to open it on eBay</div></div>';
  }

  // Buy Radar deal popup: the listing, current market, what’s on eBay now, and
  // buttons to the listing / all live listings / recent sold prices.
  function openDeal(d) {
    var m = document.getElementById("modal");
    var r = RATINGS[Math.max(0, Math.min(3, d.bars | 0))] || RATINGS[0];
    var auction = /AUCTION/i.test(d.buying_option || "");
    var kind = auction ? "Auction" : "Buy Now";
    var ph = { image: d.image, player: d.label, team: "" };
    var sportBadge = /^football$/i.test(d.sport || "") ? ' <span class="sportbadge">🏈</span>' : "";
    var premiumBadge = d.premium ? ' <span class="badge b-num">💥 Premium insert</span>' : "";
    m.innerHTML =
      '<button class="close" id="mClose">✕</button>' +
      '<div class="mgrid">' +
        '<div class="mhero">' + thumb(ph, "big") + "</div>" +
        '<div class="mbody">' +
          "<h3>" + esc(d.label) + sportBadge + premiumBadge + "</h3>" +
          '<div class="muted" style="font-size:13px">' + esc(d.item_title) + "</div>" +
          '<div class="dealhead">' +
            '<span class="dhprice tnum">' + money(d.price) + "</span>" +
            '<span class="dhkind"> · ' + kind +
              (d.snipe ? " · ⏱ ends soon" : "") + "</span>" +
          "</div>" +
          '<div class="drate ' + r[1] + '" style="margin:2px 0 4px">' + ratingBars(d.bars) +
            '<span class="rlabel">' + r[0] + "</span>" +
            '<span class="dhdisc"> · ▼ ' + Math.abs(Math.round(d.discount_pct)) +
            "% under · vs " + refLine(d) + thinChip(d) + "</span>" +
          "</div>" +
          samplesBox(d) +
          '<div class="mbtns">' +
            '<a class="mbtn prime" href="' + esc(d.url) + '" target="_blank" rel="noopener">🛒 Open this listing on eBay</a>' +
            '<a class="mbtn" href="' + dealSearchUrl(d, false) + '" target="_blank" rel="noopener">🔎 All live listings</a>' +
            compResearchLinks(d.query || d.item_title || d.label,dealSearchUrl(d,true)) +
          "</div>" +
        "</div>" +
      "</div>";
    m.querySelector("#mClose").onclick = closeModal;
    document.getElementById("modalWrap").classList.add("open");
  }

  function viewTargets() {
    var targets=state.data.targets||[],wrap=el('<div class="view profit-radar target-view"></div>');
    var cats={rookies:['◆','Rookies'],autos:['✎','Autographs'],inserts:['✦','Chase inserts'],established:['★','Stars & legends'],downtown_kaboom:['◈','Downtown / Kaboom']};
    wrap.appendChild(el('<div class="pr-overview"><div class="pr-overviewtop"><div><span class="pr-kicker">PSA 10 targets</span><h2>Find the next flip</h2></div><span class="tg-total">'+targets.length+'<small>targets</small></span></div><div class="tg-budget"><div><span>Core search</span><b>$100–$400</b></div><div><span>Total buy budget</span><b>$500</b></div></div></div>'));
    var chips=el('<div class="tg-categories" aria-label="Target categories"><button class="active" data-cat="all" aria-pressed="true"><span>◎</span><b>All cards</b><small>'+targets.length+'</small></button>'+Object.keys(cats).map(function(k){return '<button data-cat="'+k+'" aria-pressed="false"><span>'+cats[k][0]+'</span><b>'+cats[k][1]+'</b><small>'+targets.filter(function(t){return t.category===k;}).length+'</small></button>';}).join('')+'</div>');wrap.appendChild(chips);
    var controls=el('<div class="tg-controls"><input type="search" aria-label="Find a target" placeholder="Find a player or set…"><select aria-label="Target sport"><option value="all">All sports</option><option value="football">Football</option><option value="basketball">Basketball</option><option value="baseball">Baseball</option></select></div>');wrap.appendChild(controls);
    var count=el('<p class="pr-viewlabel"></p>');wrap.appendChild(count);var grid=el('<div class="tg-grid"></div>');wrap.appendChild(grid);var selected='all';
    function update(){var q=controls.querySelector('input').value.toLowerCase().trim(),sport=controls.querySelector('select').value;var rows=targets.filter(function(t){return(selected==='all'||t.category===selected)&&(sport==='all'||t.sport===sport)&&((t.label+' '+t.query).toLowerCase().indexOf(q)>=0);});count.textContent=rows.length+' search targets. These are not buy recommendations.';
      grid.innerHTML=rows.length?rows.map(function(t){var cat=cats[t.category]||['◆','Card'],label=t.label.replace(/ PSA 10/g,'');return '<article class="tg-card tg-'+esc(t.category)+'"><div class="tg-top"><span class="tg-symbol" aria-hidden="true">'+cat[0]+'</span><span class="tg-grade">PSA 10</span></div><h3>'+esc(label)+'</h3><div class="tg-meta"><span>'+esc(t.sport)+'</span><span>'+cat[1]+'</span></div><a class="pr-listing" target="_blank" rel="noopener" href="'+dealSearchUrl(t,false)+'">Find listings <span>↗</span></a><details><summary>Search details</summary><p>'+esc(t.query)+'</p><p>Search ceiling '+money0(t.price_max)+'. This is a search filter, not a buy price. Buy price requires exact sold comparisons and your profit minimums.</p>'+compResearchLinks(t.query||t.label,dealSearchUrl(t,true))+'</details></article>';}).join(''):'<div class="pr-empty"><h3>No matching targets</h3><p>Try another player, sport or category.</p></div>';}
    chips.querySelectorAll('button').forEach(function(btn){btn.onclick=function(){selected=btn.getAttribute('data-cat');chips.querySelectorAll('button').forEach(function(x){var active=x===btn;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active));});update();};});controls.querySelector('input').oninput=update;controls.querySelector('select').onchange=update;update();return wrap;
  }

  function viewDrafts() {
    var wrap = el('<div class="view"></div>');
    wrap.appendChild(el('<div class="eyebrow">eBay listing titles</div>'));
    wrap.appendChild(el('<p class="muted" style="font-size:13px;margin:0 2px 12px">Optimized, ready to paste. Tap Copy to grab a title.</p>'));
    var list = el('<div class="list drafts"></div>');
    state.data.cards.forEach(function (c) {
      var d = el('<div class="draft"><div class="t">' + esc(c.title) + "</div>" +
        '<div class="foot"><span class="len">' + c.title.length + "/80 chars</span>" +
        '<button class="copybtn">Copy</button></div></div>');
      var btn = d.querySelector(".copybtn");
      btn.onclick = function () {
        var done = function () { btn.textContent = "Copied"; btn.classList.add("done"); setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1400); };
        if (navigator.clipboard) navigator.clipboard.writeText(c.title).then(done, done); else done();
      };
      list.appendChild(d);
    });
    wrap.appendChild(list);
    return wrap;
  }


  // ---------- modal ----------
  // "Recent eBay comps" — the top matching listings saved by the weekly
  // comp run. Sold comps once eBay grants Marketplace Insights; asking today.
  function compsBox(c) {
    if (!c.comps || !c.comps.items || !c.comps.items.length) return "";
    var sold = c.comps.source === "sold";
    var rows = c.comps.items.map(function (it) {
      var inner = '<span class="ct">' + esc(it.t) + '</span><b class="tnum">' + money0(it.p) + "</b>";
      return it.u ? '<a class="comp" href="' + esc(it.u) + '" target="_blank" rel="noopener">' + inner + "</a>"
                  : '<span class="comp">' + inner + "</span>";
    }).join("");
    return '<div class="compsbox"><div class="lab">' +
      (sold ? "Recent eBay sales" : "On eBay now") + "</div>" + rows +
      '<div class="cfoot">' + (sold ? "Real sold prices" : "Asking prices") + (c.comps.broad ? " from a broad search" : "") +
      (c.comps.as_of ? ", as of " + esc(savedDate(c.comps.as_of)) : "") + "." +
      (sold ? "" : " Asking prices are not sales.") + "</div></div>";
  }

  // How much to trust this card's number, from the comp tier that produced it.
  // Levels come from comps.get_comps' query ladder (see comps.py).
  var MATCH_TRUST = {
    exact:       ["good",  "Matched this exact card"],
    focused:     ["good",  "Matched this card (minus the card number, which sellers rarely list)"],
    focused_raw: ["weak",  "Matched ungraded copies of this card — a graded one is usually worth more"],
    broad:       ["weak",  "No listing of this exact card found — estimated from other cards of this player, so treat it as a ballpark"]
  };
  function trustNote(c) {
    // Entries still only on this phone haven't reached the price yet — the
    // value is set by the rebuild, so say where they are in that journey.
    var local = (c.my_sales_all || []).filter(function (s) { return s.local; }).length;
    if (local) {
      return '<div class="trust weak">⏳ ' + local + " comp" + (local === 1 ? "" : "s") +
        " added on this phone — save below and they set this card’s value in ~2 min</div>";
    }
    // A card-specific note outranks every generic line — including the green
    // "priced off real sold prices" one. It exists for the cases the basis
    // alone cannot describe honestly: PSA's only sale being a LOWER grade than
    // the card we own (CARD-0032), a single 20-month-old comp (CARD-0021), or
    // comps that are near-misses on the parallel (CARD-0018). Gold, not green:
    // the price is anchored to real data but the read is thin.
    if (c.basis_note) {
      return '<div class="trust weak">⚠ ' + esc(c.basis_note) + "</div>";
    }
    // A real sold price the owner recorded beats any asking comp — and since
    // build_web now prices the card off it, say so first.
    var mine = (c.my_sales || []).length;
    if (c.price_basis === "sold" && mine) {
      return '<div class="trust good">✓ Priced off ' + mine + " real sold price" +
        (mine === 1 ? "" : "s") + " you recorded for this card — the best data we have" +
        (mine === 1 ? " (add a couple more and it steadies out)" : "") + "</div>";
    }
    // PSA prices off their own recorded sales for this exact card AND grade —
    // better than anything our asking-comp ladder can reach, so it outranks
    // the match level.
    if (c.price_basis === "psa") {
      var slab = c.graded && c.grader && c.grade
        ? " in a " + esc((c.grader + " " + c.grade).toUpperCase()) + " holder" : "";
      return '<div class="trust good">✓ PSA’s own price for this card' + slab +
        " — from their recorded sales, not our eBay guess</div>";
    }
    var lv = (c.comps && c.comps.level) || "";
    var t = MATCH_TRUST[lv];
    var n = (c.market && c.market.count) || 0;
    if (!t) {
      return num(c.asking_price) > 0
        ? '<div class="trust weak">⚠ No eBay listings captured for this card — the price is hand-set, not measured.</div>' : "";
    }
    var thin = n && n < 5 ? " · only " + n + " listing" + (n === 1 ? "" : "s") + " to go on" : "";
    return '<div class="trust ' + t[0] + '">' + (t[0] === "good" ? "✓ " : "⚠ ") + t[1] + thin + "</div>";
  }

  function ebaySearchUrl(c, soldOnly) {
    return "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(c.title) +
      (soldOnly ? "&LH_Sold=1&LH_Complete=1" : "");
  }

  // Terapeak product research (eBay Seller Hub) pre-searched for this card —
  // Manual source lookup, not an automated or verified data import.
  // Start with a 90-day sold window; exact identity/date/accepted-price review
  // happens in the owner's authorized Seller Hub session.
  function terapeakUrl(q) {
    return "https://www.ebay.com/sh/research?marketplace=EBAY-US&tabName=SOLD&dayRange=90&keywords=" +
      encodeURIComponent(q);
  }


  // A ready-to-paste prompt for drafting the eBay listing in Claude chat.
  function listPrompt(c) {
    var d = [c.year, c.brand, c.set, c.player, c.card_number ? "#" + c.card_number : "",
             c.parallel, c.insert, c.graded ? (c.grader + " " + c.grade) : "",
             c.serial_run ? "/" + c.serial_run : "", c.team].filter(Boolean).join(" ");
    return "Help me create and post an eBay listing for this sports card.\n\n" +
      "Card: " + d + "\nSuggested title: " + c.title +
      (num(c.asking_price) > 0 ? "\nMy asking price: " + money0(c.asking_price) : "") +
      "\n\nPlease give me an optimized 80-character title, eBay item specifics, and a short " +
      "description I can paste — then remind me to add photos before publishing.";
  }

  // "What it's going for" box for the modal — the typical asking price, the
  // live range, our estimate, and (when the read is solid) the room up toward
  // typical. Honest about the ASKING-vs-SOLD gap eBay left us with.
  function marketBox(c) {
    var m = goingFor(c), ms = mySold(c);
    var soldRow = ms
      ? '<div class="mkrow up"><span>Real sold — comps you added</span><b class="tnum">~' + money0(ms.median) +
        ' <small>· ' + ms.count + " tracked</small></b></div>"
      : "";
    if (!m) {
      // No comps captured. If the owner has tracked real sales, show those —
      // they're the truest read we have. Otherwise explain the gap (e.g. a
      // niche insert/auto the auto-pricer found zero matches for).
      if (ms) {
        return '<div class="compsbox market"><div class="lab">What it’s going for</div>' + soldRow +
          (num(c.asking_price) > 0
            ? '<div class="mkrow"><span>' + (c.sold ? "Was valued at" : "Saved value") +
              '</span><b class="tnum">' + money0(num(c.asking_price)) + "</b></div>" : "") +
          '<div class="cfoot">Real sold prices you recorded in “My numbers” below — what other copies ' +
          "actually sold for, not what you got.</div></div>";
      }
      if (num(c.asking_price) <= 0) return "";
      return '<div class="compsbox nomarket"><div class="lab">What it’s going for</div>' +
        '<div class="addcostrow">No eBay comps captured for this exact card yet — the value here is hand-set.</div>' +
        '<div class="cfoot">Niche inserts/autos often return no match on the weekly auto-price run. ' +
        "Start with “Terapeak / Product Research” below to check actual sold comparisons — and record what it sold for in “My numbers” below.</div></div>";
    }
    var cur = num(c.asking_price);
    var prices = ((c.comps && c.comps.items) || []).map(function (it) { return num(it.p); })
      .filter(function (p) { return p > 0; });
    var range = prices.length >= 2
      ? money0(Math.min.apply(null, prices)) + "–" + money0(Math.max.apply(null, prices)) : "";
    var basisTxt = c.price_basis === "sold" ? "real eBay sold comps"
      : c.price_basis === "psa" ? "PSA’s own market estimate for this card at this grade"
      : c.price_basis === "est_sold" ? "estimated — typical asking, discounted toward real sold"
      : "active eBay listings";
    var rows =
      soldRow +
      '<div class="mkrow"><span>Usually going for</span><b class="tnum">~' + money0(m.median) +
        (m.count ? ' <small>· ' + m.count + " listed</small>" : "") + "</b></div>" +
      (range ? '<div class="mkrow"><span>Live range now</span><b class="tnum">' + range + "</b></div>" : "") +
      '<div class="mkrow"><span>' + (c.sold ? "Was valued at" : "Saved value") +
        '</span><b class="tnum">' + money0(cur) + "</b></div>" +
      (num(c.est_price) > 0 && num(c.est_price) !== cur
        ? '<div class="mkrow"><span>' +
          (c.est_basis === "psa" ? "PSA’s estimate was" : "Our comp estimate was") +
          '</span><b class="tnum">' + money0(num(c.est_price)) + "</b></div>" : "");
    if (!c.sold && marketSolid(c, m)) {
      var pct = Math.round((m.median - cur) / cur * 100);
      rows += '<div class="mkrow up"><span>Room up to typical</span><b class="tnum">+' +
        money0(m.median - cur) + " · " + pct + "%</b></div>";
    } else if (!c.sold && c.price_basis === "psa" && m.median > cur) {
      rows += '<div class="mkrow"><span>Sellers ask above this</span><b class="tnum">+' +
        Math.round((m.median - cur) / cur * 100) + "%</b></div>";
    }
    return '<div class="compsbox market"><div class="lab">What it’s going for</div>' + rows + trustNote(c) +
      '<div class="cfoot">Typical = eBay <b>asking</b> median. ' +
      (c.reviewed_price
        ? "Value uses the reviewed reported-sale median; older recorded comps remain as history."
        : (c.price_basis === "sold" && (c.my_sales || []).length)
        // priced off the owner's own recorded sales — don't nag about eBay
        // approval here, they already have better data than eBay would give us
        ? "This card’s value is your recorded sold prices, not our estimate."
        : c.price_basis === "psa"
        ? "This card’s value comes from the PSA app, not from these asking listings — " +
          "PSA reads real sales, so where the two disagree, trust PSA."
        : "This card’s value: " + basisTxt +
          ". Start with Terapeak / Product Research below for actual sold comparisons; eBay sold search is the fallback.") +
      "</div></div>";
  }

  function ownerListingBox(c) {
    var l = c.owner_listing;
    if (!l) return "";
    var paid = l.status === "sold_paid" && c.sold;
    var active = l.status === "listed" && c.listed && !c.sold;
    var label = paid ? "Your eBay sale · buyer paid" : active ? "Your eBay asking price" : "Previous eBay listing";
    var amount = paid ? l.sold_price : l.asking_price;
    var detail = paid ? "Gross sale; fees and shipping still need reconciliation. Payment confirmation is not payout settlement."
      : "Separate from the market estimate. Last confirmed by email " + (l.confirmed_at || "").slice(0,10) + ".";
    var validUrl = /^https:\/\/www\.ebay\.com\/itm\/[0-9]{12}$/.test(l.url || "");
    return '<div class="compsbox"><div class="lab">' + label + '</div>' +
      '<div class="val tnum">' + money(amount) + (active && l.best_offer ? " · Best Offer" : "") + '</div>' +
      '<div class="cfoot">' + esc(detail) + '</div>' +
      (validUrl ? '<a class="mbtn" href="' + esc(l.url) + '" target="_blank" rel="noopener">View eBay listing</a>' : "") + '</div>';
  }

  // "My numbers" — the owner's own data entry, right in the card popup: what
  // the card cost, and real prices it has sold for (look them up with the
  // Terapeak / Product Research first, then eBay sold search as fallback). Saves
  // instantly on this device; "Send to Claude" writes it into the sheet.
  function myNumbersBox(c) {
    var today = new Date().toISOString().slice(0, 10);
    var sheetCost = num(c._csvCost) > 0;
    var sales = c.my_sales_all || [];
    var rows = sales.map(function (s, i) {
      return '<div class="myrow"><span class="tnum">' + money(s.p) + "</span>" +
        '<span class="myd">' + esc(s.d || "") + (s.n ? " · " + esc(s.n) : "") + "</span>" +
        (s.local ? '<button class="mydel" data-i="' + i + '" title="Remove">✕</button>'
                 : '<span class="myok" title="Saved in your sheet">✓ in sheet</span>') +
        "</div>";
    }).join("");
    var pend = pendingCount();
    var mineSold = myData.sold[c.sku];
    return '<div class="compsbox mydata"><div class="lab">Your numbers</div>' +
      compResearchLinks(c.title,ebaySearchUrl(c,true)) +
      '<div class="mdform"><label>What you paid ($)' +
        '<input type="number" inputmode="decimal" min="0" step="0.01" id="myCost" placeholder="e.g. 45" value="' +
        (num(c.cost) > 0 ? esc(num(c.cost)) : "") + '"' + (sheetCost ? " disabled" : "") + "></label>" +
        (sheetCost ? '<span class="myok">✓ in sheet</span>' : '<button class="mbtn sm" id="myCostSave">Save</button>') +
      "</div>" +
      // 1) what OTHERS got — a comp. Sets this card's value; you keep the card.
      '<div class="mysec">Prices other people got' +
        '<span class="myhint">Sets what this card is worth. You still own it.</span></div>' +
      '<div class="mdform"><label>Someone else sold one for ($)' +
        '<input type="number" inputmode="decimal" min="0" step="0.01" id="mySalePrice" placeholder="e.g. 120"></label>' +
        '<label>When<input type="date" id="mySaleDate" value="' + today + '"></label>' +
        '<button class="mbtn sm" id="mySaleAdd">Add comp</button>' +
      "</div>" +
      (rows ? '<div class="mylist">' + rows + "</div>" : "") +
      // 2) YOUR sale — retires the card into revenue.
      ((c.sold && !c.sold_local)
        ? '<div class="mysec sold">You sold this on ' + esc(c.sold_date || "") +
          " for " + money(num(c.sold_price)) +
          '<span class="myhint">It\u2019s out of your collection and counted in revenue.</span></div>'
        : (mineSold
            ? '<div class="mysec sold">Marked sold for ' + money(num(mineSold.p)) +
              (mineSold.d ? " on " + esc(mineSold.d) : "") +
              '<span class="myhint">Already out of your collection on this phone. ' +
              'Save below so every device sees it (~2 min). ' +
              '<a href="#" id="myUnsell">undo</a></span></div>'
            : '<div class="mysec mine">Did you sell this card?' +
              '<span class="myhint">Moves it out of your collection and into revenue.</span></div>' +
              '<div class="mdform"><label>I sold it for ($)' +
                '<input type="number" inputmode="decimal" min="0" step="0.01" id="myMinePrice" placeholder="what you got"></label>' +
                '<label>When<input type="date" id="myMineDate" value="' + today + '"></label>' +
                '<button class="mbtn sm warn" id="myMineAdd">Mark sold</button>' +
              "</div>")) +
      syncSection(pend) +
      '<div class="cfoot">Tap a lookup button above — Terapeak (in your eBay Seller Hub, free) shows real ' +
      "sold prices — then type what you see. Everything saves on this phone instantly" +
      (ghToken() ? "; “Save to my sheet” backs it up to every device." : "; sending backs it up to every device.") +
      " A sold price you record becomes this card’s value on the next rebuild (~2 min after saving)." +
      "</div></div>";
  }

  // The backup row of the My-numbers box. With one-tap save ON: a direct
  // 💾 save button. Without: the Send-to-Claude button + a setup link that
  // reveals the paste-your-GitHub-key form.
  function syncSection(pend) {
    var n = pend === 1 ? "1 entry" : pend + " entries";
    if (ghToken()) {
      // everything on this phone is already in the sheet (it just hasn't been
      // baked into data.json yet, which takes the site a couple of minutes)
      var saved = pend > 0 && myData.synced && myData.synced >= (myData.touched || 0);
      return (saved
        ? '<div class="mdsync mdsaved">Saved to your sheet. Every device picks it up in about 2 minutes. ' +
          '<a href="#" id="myGhAgain">Save again</a></div>'
        : (pend ? '<div class="mdsync"><button class="mbtn prime" id="myGhSave" type="button">Save ' + n +
                  " to my sheet</button></div>" : "")) +
        '<div class="mdsetup">One-tap save is on. <a href="#" id="ghTokenDrop">Turn it off</a></div>';
    }
    return (pend ? '<div class="mdsync"><button class="mbtn" id="mySync" type="button">Send ' + n +
                   " to Claude to save them</button></div>" : "") +
      '<div class="mdsetup"><a href="#" id="mdSetup">Set up one-tap save</a> to skip the Claude step.</div>' +
      '<div class="mdtoken" id="mdTokenForm" hidden><label>GitHub key' +
        '<input type="password" id="ghTokenInput" placeholder="github_pat_…" autocomplete="off"></label>' +
        '<button class="mbtn sm" id="ghTokenSave">Turn on</button>' +
        '<div class="cfoot">One-time setup — ask Claude for the 2-minute walkthrough. ' +
        "The key stays on this phone only (never in the sheet or the app).</div></div>";
  }

  function wireMyNumbers(m, c) {
    // A number typed into a box but never "Save"d/"Add"ed is invisible to the
    // sync — fold anything sitting in the boxes in first, so tapping save
    // means what the owner thinks it means.
    function flushTyped() {
      var costEl = m.querySelector("#myCost");
      if (costEl && !costEl.disabled) {
        var cv = num(costEl.value);
        if (cv > 0 && cv !== num(myData.costs[c.sku])) {
          myData.costs[c.sku] = Math.round(cv * 100) / 100;
          touchMyData();
        }
      }
      var mineEl = m.querySelector("#myMinePrice");
      var mv = mineEl ? num(mineEl.value) : 0;
      if (mv > 0) {
        var mdEl = m.querySelector("#myMineDate");
        myData.sold[c.sku] = { d: (mdEl && mdEl.value) || "", p: Math.round(mv * 100) / 100 };
        touchMyData();
      }
      var priceEl = m.querySelector("#mySalePrice");
      var pv = priceEl ? num(priceEl.value) : 0;
      if (pv > 0) {
        var dateEl = m.querySelector("#mySaleDate");
        var d = (dateEl && dateEl.value) || "";
        var p = Math.round(pv * 100) / 100;
        var have = (myData.sales[c.sku] = myData.sales[c.sku] || []);
        var dup = have.some(function (x) { return (x.d || "") === d && num(x.p) === p; });
        if (!dup) { have.push({ d: d, p: p }); touchMyData(); }
        priceEl.value = "";
      }
      recalcMyData();
    }
    // leaving the cost box also banks it — no lost typing if Save is missed
    var costBox = m.querySelector("#myCost");
    if (costBox && !costBox.disabled) costBox.onchange = flushTyped;
    // the money headline's "＋ add" jumps down to the cost field and focuses it
    var mhAdd = m.querySelector("#mhAddCost");
    if (mhAdd) mhAdd.onclick = function () {
      var input = m.querySelector("#myCost");
      if (!input) return;
      input.scrollIntoView({ block: "center" });
      input.focus();
    };
    var costSave = m.querySelector("#myCostSave");
    if (costSave) costSave.onclick = function () {
      var v = num(m.querySelector("#myCost").value);
      if (v > 0) myData.costs[c.sku] = Math.round(v * 100) / 100;
      else delete myData.costs[c.sku];
      touchMyData();
      refreshAfterMyData(c);
    };
    // "I sold it" — retires the card. Confirm, because it changes what the
    // collection is, not just what a number says.
    var mineAdd = m.querySelector("#myMineAdd");
    if (mineAdd) mineAdd.onclick = function () {
      var p = num(m.querySelector("#myMinePrice").value);
      if (p <= 0) { flashBtn(mineAdd, "How much?"); return; }
      if (!window.confirm("Mark this as SOLD for " + money(p) +
          "?\n\nIt leaves your collection value and moves into revenue.")) return;
      myData.sold[c.sku] = { d: m.querySelector("#myMineDate").value || "",
                             p: Math.round(p * 100) / 100 };
      touchMyData();
      refreshAfterMyData(c);
    };
    var unsell = m.querySelector("#myUnsell");
    if (unsell) unsell.onclick = function (e) {
      e.preventDefault();
      delete myData.sold[c.sku];
      touchMyData();
      refreshAfterMyData(c);
    };
    var add = m.querySelector("#mySaleAdd");
    if (add) add.onclick = function () {
      var p = num(m.querySelector("#mySalePrice").value);
      if (p <= 0) { flashBtn(add, "Price?"); return; }
      (myData.sales[c.sku] = myData.sales[c.sku] || []).push({
        d: m.querySelector("#mySaleDate").value || "", p: Math.round(p * 100) / 100 });
      touchMyData();
      refreshAfterMyData(c);
    };
    m.querySelectorAll(".mydel").forEach(function (b) {
      b.onclick = function () {
        var s = (c.my_sales_all || [])[Number(b.getAttribute("data-i"))];
        if (!s) return;
        var arr = (myData.sales[c.sku] || []).filter(function (x) {
          return !((x.d || "") === (s.d || "") && x.p === s.p);
        });
        if (arr.length) myData.sales[c.sku] = arr; else delete myData.sales[c.sku];
        touchMyData();
        refreshAfterMyData(c);
      };
    });
    var sync = m.querySelector("#mySync");
    if (sync) sync.onclick = function () {
      flushTyped();
      var q = syncMessage();
      copyText(q);
      window.open("https://claude.ai/new?q=" + encodeURIComponent(q), "_blank", "noopener");
      flashBtn(sync, "Copied. Paste it in Claude if it isn’t filled in.");
    };
    // one-tap GitHub save + its setup form
    var ghBtn = m.querySelector("#myGhSave");
    if (ghBtn) ghBtn.onclick = function () {
      var label = ghBtn.innerHTML;   // grab the REAL label before overwriting it
      flushTyped();
      ghBtn.disabled = true;
      ghBtn.textContent = "Saving…";
      ghSaveMyNumbers(function (err) {
        ghBtn.disabled = false;
        ghBtn.innerHTML = label;     // never leave it stuck reading "Saving…"
        if (err) flashBtn(ghBtn, "Couldn’t save. Check the key, or ask Claude.");
        else refreshAfterMyData(c);  // repaints the box as "✓ Saved to your sheet"
      });
    };
    var ghAgain = m.querySelector("#myGhAgain");
    if (ghAgain) ghAgain.onclick = function (e) {
      e.preventDefault();
      flushTyped();
      touchMyData();
      refreshAfterMyData(c);
    };
    var setup = m.querySelector("#mdSetup");
    if (setup) setup.onclick = function (e) {
      e.preventDefault();
      var f = m.querySelector("#mdTokenForm");
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector("input").focus();
    };
    var tokSave = m.querySelector("#ghTokenSave");
    if (tokSave) tokSave.onclick = function () {
      var v = (m.querySelector("#ghTokenInput").value || "").trim();
      if (!v) { flashBtn(tokSave, "Paste it first"); return; }
      try { localStorage.setItem(GHTOKEN_KEY, v); } catch (e) {}
      refreshAfterMyData(c);
    };
    var tokDrop = m.querySelector("#ghTokenDrop");
    if (tokDrop) tokDrop.onclick = function (e) {
      e.preventDefault();
      try { localStorage.removeItem(GHTOKEN_KEY); } catch (err) {}
      refreshAfterMyData(c);
    };
  }

  // after any My-numbers edit: re-merge, repaint the view behind the popup
  // (profit tiles, Sales Map chips), and repaint the popup itself.
  function refreshAfterMyData(c) {
    recalcMyData();
    render();
    openModal(c);
  }

  function closeModal() {
    document.getElementById("modalWrap").classList.remove("open");
    document.body.classList.remove("sheet-open");
    if(modalFocus && document.contains(modalFocus))modalFocus.focus();
    if (history.replaceState) history.replaceState(null, "", "#tab="+state.tab);
  }
  function openFromHash() {
    var m = location.hash.match(/^#sku=(.+)$/);
    if (!m || !state.data) return;
    var sku;try{sku=decodeURIComponent(m[1]);}catch(e){return;}
    var card = state.data.cards.filter(function (c) { return c.sku === sku; })[0];
    if (card) openModal(card);
  }

  // ---------- boot ----------
  // A shipped fix is worthless if the phone keeps serving the old build. The
  // service worker is network-first for data.json, so even a stale shell gets
  // the fresh file — and the version baked into it tells us the running app.js
  // is behind. One tap then clears every cache, drops the old service worker
  // and reloads, which is the thing that actually works on an installed iOS
  // PWA (a plain reload often doesn't).
  function updateBanner(want) {
    var bar = el('<div class="updbar" role="button" tabindex="0">' +
      "New version ready (" + esc(want) + "). Tap to load it." +
      '<span class="updsub">You’re on ' + APP_VERSION + "</span></div>");
    function go() {
      bar.textContent = "Updating…";
      var jobs = [];
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (ks) {
          return Promise.all(ks.map(function (k) { return caches.delete(k); }));
        }));
      }
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        }));
      }
      Promise.all(jobs).catch(function () {}).then(function () {
        location.replace(location.pathname + "?u=" + Date.now() + location.hash);
      });
    }
    bar.onclick = go;
    bar.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") go(); };
    document.body.appendChild(bar);
    // Sit clear of the tab bar, whose height varies (it wraps to two rows on
    // narrow phones and becomes a side rail on desktop) — measure, don't guess.
    function place() {
      var nav = document.querySelector(".nav");
      // offsetHeight already includes the nav's safe-area padding — adding
      // env() again would float the bar a home-indicator's height too high.
      var h = nav && window.innerWidth < 1000 ? nav.offsetHeight : 0;
      bar.style.bottom = (h + 12) + "px";
    }
    place();
    window.addEventListener("resize", place);
  }

  function checkVersion(shipped) {
    if (shipped && shipped !== APP_VERSION && !document.querySelector(".updbar")) {
      updateBanner(shipped);
    }
  }

  // The tab bar's height isn't knowable from CSS: 7 tabs in a 4-wide grid wrap
  // to two rows on a phone, one row on a wide screen, and it carries the home
  // indicator inset. Publish the real height so the page can reserve exactly
  // that much room underneath.
  function measureNav() {
    var nav = document.querySelector(".nav");
    if (!nav) return;
    var pos = getComputedStyle(nav).position;
    var overlaysBottom = pos === "sticky" || (pos === "fixed" && window.innerWidth < 1000);   // fixed = the desktop side rail
    document.documentElement.style.setProperty("--navh", (overlaysBottom ? nav.offsetHeight : 0) + "px");
  }

  function boot(data) {
    state.data = data;
    recalcMyData();               // merge this device's costs + sold entries
    shell();
    var initialHash=location.hash;
    try{var prefs=JSON.parse(localStorage.getItem("cv-view-v60")||"{}");["sort","inventoryStatus","inventorySport","inventoryType"].forEach(function(k){if(typeof prefs[k]==="string")state[k]=prefs[k];});if(prefs.v===64&&(prefs.inventoryLayout==="list"||prefs.inventoryLayout==="grid"))state.inventoryLayout=prefs.inventoryLayout;}catch(e){}
    if(!SORTS.some(function(s){return s[0]===state.sort;}))state.sort="val-desc";
    if(state.inventoryStatus==="unlisted")state.inventoryStatus="all";
    var wanted=initialHash.match(/^#tab=(today|sell|collection|radar|value|about)$/);
    setTab(wanted?wanted[1]:"today");
    if(initialHash.indexOf("#sku=")===0&&history.replaceState)history.replaceState(null,"",initialHash);
    measureNav();
    window.addEventListener("resize", measureNav);
    window.addEventListener("orientationchange", measureNav);
    openFromHash();               // shared link straight to a card
    window.addEventListener("hashchange", function(){var t=location.hash.match(/^#tab=(today|sell|collection|radar|value|about)$/);if(t)setTab(t[1]);else openFromHash();});
    checkVersion(data.app_version);
    // A phone app is resumed far more often than cold-started, and a ship that
    // lands while it sits in the background would otherwise go unnoticed until
    // the next full launch. Re-check whenever it comes back to the foreground.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden || document.querySelector(".updbar")) return;
      fetch("./data.json?v=" + Date.now())
        .then(function (r) { return r.json(); })
        .then(function (d) { checkVersion(d && d.app_version); })
        .catch(function () {});
    });
  }

  // Always set the theme explicitly, so a host page that pre-sets data-theme
  // cannot override the owner's choice. Dark unless they picked light.
  (function () { var t = ""; try { t = localStorage.getItem(THEME_KEY) || ""; } catch (e) {} document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "dark"); })();

  if (window.__CARD_DATA__) {
    boot(window.__CARD_DATA__);
  } else {
    fetch("./data.json?v=" + Date.now()).then(function (r) { return r.json(); }).then(boot).catch(function () {
      document.body.innerHTML = '<main style="padding:40px;text-align:center;color:#c9bda2">Could not load your collection data. Check your connection and reopen the app.</main>';
    });
  }

  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("./sw.js").catch(function () {}); });
  }
})();


