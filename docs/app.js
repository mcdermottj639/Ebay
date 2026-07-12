/* Card Vault — client-side app. Reads inlined window.__CARD_DATA__ (preview)
   or fetches ./data.json (on GitHub Pages). Renders a tabbed, card-based PWA. */

(function () {
  "use strict";

  var APP_VERSION = "v1";
  var state = { tab: "collection", filter: "All", data: null, bucket: "Cards", collapsed: {} };

  // ---------- helpers ----------
  function el(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function money(n) { return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(n) { return "$" + Math.round(Number(n || 0)).toLocaleString(); }
  function num(v) { var n = parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? 0 : n; }

  // ---------- shell ----------
  function shell() {
    document.body.innerHTML = "";
    document.body.appendChild(el(
      '<div class="appbar">' +
        '<div class="logo">🃏</div>' +
        '<div class="brand"><b>Card Vault</b><small id="gen">your collection</small></div>' +
        '<div class="spacer"></div>' +
        '<span class="pill" id="livepill">Local</span>' +
        '<button class="iconbtn" id="themebtn" title="Light / dark">🌙</button>' +
      "</div>"
    ));
    document.body.appendChild(el('<main id="view"></main>'));
    document.body.appendChild(el(
      '<div class="modal-wrap" id="modalWrap"><div class="modal" id="modal"></div></div>'
    ));
    var nav = el('<nav class="nav"></nav>');
    [["collection", "🗃️", "Collection"],
     ["value", "💰", "Value"],
     ["drafts", "🏷️", "Drafts"],
     ["about", "ℹ️", "About"]].forEach(function (t) {
      var b = el('<button data-tab="' + t[0] + '"><span class="i">' + t[1] + '</span>' + t[2] + "</button>");
      b.onclick = function () { setTab(t[0]); };
      nav.appendChild(b);
    });
    document.body.appendChild(nav);

    document.getElementById("themebtn").onclick = toggleTheme;
    document.getElementById("modalWrap").onclick = function (e) {
      if (e.target.id === "modalWrap") closeModal();
    };
    syncThemeIcon();
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".nav button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-tab") === tab);
    });
    render();
  }

  // ---------- views ----------
  function render() {
    var v = document.getElementById("view");
    v.innerHTML = "";
    v.appendChild({ collection: viewCollection, value: viewValue, drafts: viewDrafts, about: viewAbout }[state.tab]());
    v.scrollTop = 0; window.scrollTo(0, 0);
  }

  function badges(c) {
    var out = "";
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

  // one card/merch row
  function crowEl(c) {
    var val = c.asking_price ? '<div class="val tnum">' + money0(c.asking_price) + "</div>"
                             : '<div class="val none">—</div>';
    var st = c.status === "priced" ? "Priced" : "Needs price";
    var row = el(
      '<button class="crow s-' + c.status + '">' +
        '<div class="stripe"></div>' +
        '<div class="m"><div class="p">' + esc(c.player) + badges(c) + "</div>" +
          '<div class="sub">' + esc(c.line || "") + "</div></div>" +
        '<div class="r">' + val + '<div class="st">' + st + "</div></div>" +
      "</button>"
    );
    row.onclick = function () { openModal(c); };
    return row;
  }

  // price tier for a card (keeps cheap commons collapsed out of the way)
  function tierOf(c) {
    if (!c.asking_price || num(c.asking_price) <= 0) return { label: "Unpriced", order: 5, collapse: true };
    var v = num(c.asking_price);
    if (v >= 100) return { label: "$100+", order: 0 };
    if (v >= 25) return { label: "$25 – $100", order: 1 };
    if (v >= 5) return { label: "$5 – $25", order: 2 };
    if (v >= 1) return { label: "$1 – $5", order: 3 };
    return { label: "Under $1", order: 4, collapse: true };
  }

  // a collapsible titled section
  function sectionEl(label, items, defaultCollapsed) {
    var collapsed = state.collapsed[label];
    if (collapsed === undefined) collapsed = !!defaultCollapsed;
    var sec = el('<div class="section"></div>');
    var head = el('<button class="section-head"><span class="sh-l">' + esc(label) +
      '</span><span class="sh-c">' + items.length + '</span><span class="sh-x">' +
      (collapsed ? "▸" : "▾") + "</span></button>");
    head.onclick = function () { state.collapsed[label] = !collapsed; render(); };
    sec.appendChild(head);
    if (!collapsed) {
      var list = el('<div class="list"></div>');
      items.forEach(function (c) { list.appendChild(crowEl(c)); });
      sec.appendChild(list);
    }
    return sec;
  }

  function viewCollection() {
    var wrap = el('<div class="view"></div>');
    var cards = state.data.cards;
    var nCards = cards.filter(function (c) { return !c.is_merch; }).length;
    var nMerch = cards.filter(function (c) { return c.is_merch; }).length;

    // primary split: Cards | Merch
    var seg = el('<div class="seg"></div>');
    [["Cards", nCards], ["Merch", nMerch]].forEach(function (b) {
      var btn = el('<button class="' + (state.bucket === b[0] ? "on" : "") + '">' + b[0] + ' <em>' + b[1] + "</em></button>");
      btn.onclick = function () { if (state.bucket !== b[0]) { state.bucket = b[0]; state.filter = "All"; render(); } };
      seg.appendChild(btn);
    });
    wrap.appendChild(seg);

    var inBucket = cards.filter(function (c) { return state.bucket === "Merch" ? c.is_merch : !c.is_merch; });

    if (state.bucket === "Cards") {
      var sports = [];
      inBucket.forEach(function (c) { if (c.sport && sports.indexOf(c.sport) < 0) sports.push(c.sport); });
      var filters = ["All"].concat(sports.sort()).concat(["Graded", "Autos"]);
      wrap.appendChild(chipRow(filters));

      var shown = inBucket.filter(matchFilter);
      var groups = {};
      shown.forEach(function (c) {
        var t = tierOf(c);
        (groups[t.label] = groups[t.label] || { items: [], t: t }).items.push(c);
      });
      var ordered = Object.keys(groups).map(function (k) { return groups[k]; })
        .sort(function (a, b) { return a.t.order - b.t.order; });
      ordered.forEach(function (g) {
        g.items.sort(function (a, b) { return num(b.asking_price) - num(a.asking_price); });
        wrap.appendChild(sectionEl(g.t.label, g.items, g.t.collapse));
      });
      if (!shown.length) wrap.appendChild(el('<p class="muted">No cards match this filter.</p>'));
    } else {
      // Merch grouped by item type (Jersey, Helmet, Ball, …)
      var byType = {};
      inBucket.forEach(function (c) { var k = c.item_type || "Merch"; (byType[k] = byType[k] || []).push(c); });
      var keys = Object.keys(byType).sort();
      keys.forEach(function (k) {
        byType[k].sort(function (a, b) { return num(b.asking_price) - num(a.asking_price); });
        wrap.appendChild(sectionEl(k, byType[k], false));
      });
      if (!keys.length) wrap.appendChild(el('<p class="muted">No merch yet — add jerseys, helmets, balls, photos…</p>'));
    }
    return wrap;
  }

  function chipRow(filters) {
    var chips = el('<div class="chips"></div>');
    filters.forEach(function (f) {
      var c = el('<button class="chip' + (state.filter === f ? " on" : "") + '">' + esc(f) + "</button>");
      c.onclick = function () { state.filter = f; render(); };
      chips.appendChild(c);
    });
    return chips;
  }

  function matchFilter(c) {
    if (state.filter === "All") return true;
    if (state.filter === "Graded") return c.graded;
    if (state.filter === "Autos") return c.auto;
    return c.sport === state.filter;
  }

  function viewValue() {
    var s = state.data.summary;
    var wrap = el('<div class="view"></div>');
    wrap.appendChild(el('<div class="eyebrow">Collection value</div>'));
    var tiles = el('<div class="tiles"></div>');
    tiles.appendChild(el('<div class="tile hero"><div class="k">Estimated value</div><div class="v tnum">' + money(s.total_value) + "</div></div>"));
    var profitCls = s.profit >= 0 ? "pos" : "neg";
    [["Total cost", money(s.total_cost), ""],
     ["Est. profit", money(s.profit), profitCls],
     ["Cards", s.total_cards, ""],
     ["Priced", s.priced + " / " + s.total_cards, ""],
     ["Graded", s.graded, ""],
     ["Autographs", s.autos, ""]].forEach(function (t) {
      tiles.appendChild(el('<div class="tile"><div class="k">' + t[0] + '</div><div class="v tnum ' + t[2] + '">' + t[1] + "</div></div>"));
    });
    wrap.appendChild(tiles);

    wrap.appendChild(el('<div class="eyebrow">By sport</div>'));
    var bars = el('<div class="bars"></div>');
    var entries = Object.keys(s.by_sport).map(function (k) { return [k, s.by_sport[k]]; })
                    .sort(function (a, b) { return b[1] - a[1]; });
    var max = entries.length ? entries[0][1] : 1;
    entries.forEach(function (e) {
      bars.appendChild(el('<div class="barrow"><span>' + esc(e[0]) + '</span>' +
        '<div class="track"><div class="fill" style="width:' + (e[1] / max * 100) + '%"></div></div>' +
        "<b>" + e[1] + "</b></div>"));
    });
    wrap.appendChild(bars);

    wrap.appendChild(el('<div class="eyebrow">Top cards by value</div>'));
    var top = state.data.cards.slice().filter(function (c) { return num(c.asking_price) > 0; })
                .sort(function (a, b) { return num(b.asking_price) - num(a.asking_price); }).slice(0, 6);
    var list = el('<div class="list"></div>');
    top.forEach(function (c) {
      var row = el('<button class="crow s-' + c.status + '"><div class="stripe"></div>' +
        '<div class="m"><div class="p">' + esc(c.player) + badges(c) + "</div>" +
        '<div class="sub">' + esc(c.line || "") + "</div></div>" +
        '<div class="r"><div class="val tnum">' + money0(c.asking_price) + "</div></div></button>");
      row.onclick = function () { openModal(c); };
      list.appendChild(row);
    });
    wrap.appendChild(top.length ? list : el('<p class="muted">No priced cards yet.</p>'));
    return wrap;
  }

  function viewDrafts() {
    var wrap = el('<div class="view"></div>');
    wrap.appendChild(el('<div class="eyebrow">eBay listing titles</div>'));
    wrap.appendChild(el('<p class="muted" style="font-size:13px;margin:0 2px 12px">Optimized, ready to paste. Tap Copy to grab a title.</p>'));
    var list = el('<div class="list"></div>');
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

  function viewAbout() {
    var s = state.data.summary;
    var wrap = el('<div class="view about"></div>');
    wrap.appendChild(el('<div class="eyebrow">About</div>'));
    wrap.appendChild(el('<div class="card"><p><b>Card Vault</b> is your personal home base for the card business — every card you own, its estimated value, and its listing status, in one place you can check daily.</p>' +
      '<p class="muted" style="font-size:13px">Data generated ' + esc(state.data.generated) + ' · ' + s.total_cards + ' cards · app ' + APP_VERSION + "</p></div>"));
    wrap.appendChild(el('<div class="eyebrow">What’s next</div>'));
    wrap.appendChild(el('<div class="card"><p>Live pricing, the Buy Radar deal-finder, value search, and one-tap listing arrive once the eBay connection is approved — they’ll show up here as new tabs. This view (your collection + value) works fully offline.</p></div>'));
    return wrap;
  }

  // ---------- modal ----------
  function openModal(c) {
    var m = document.getElementById("modal");
    var rows = [
      ["Item type", c.is_merch ? c.item_type : ""],
      ["Player", c.player], ["Year", c.year], ["Brand", c.brand], ["Set", c.set],
      ["Card #", c.card_number], ["Parallel", c.parallel], ["Insert", c.insert],
      ["Team", c.team], ["Grade", c.graded ? (c.grader + " " + c.grade) : ""],
      ["Authentication", c.is_merch ? c.authentication : ""],
      ["Condition", c.graded ? "" : c.condition], ["Serial", c.serial_run ? "/" + c.serial_run : ""],
      ["Sport", c.sport], ["SKU", c.sku], ["Est. value", c.asking_price ? money(c.asking_price) : ""],
      ["Notes", c.notes]
    ].filter(function (r) { return r[1]; });
    var kv = rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
    m.innerHTML =
      '<button class="close" id="mClose">✕</button>' +
      "<h3>" + esc(c.player) + badges(c) + "</h3>" +
      '<div class="muted" style="font-size:13px">' + esc(c.line || "") + "</div>" +
      '<dl class="kv">' + kv + "</dl>" +
      '<div class="titlebox"><div class="lab">eBay title</div><div class="val">' + esc(c.title) + "</div></div>";
    m.querySelector("#mClose").onclick = closeModal;
    document.getElementById("modalWrap").classList.add("open");
  }
  function closeModal() { document.getElementById("modalWrap").classList.remove("open"); }

  // ---------- theme ----------
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  }
  function syncThemeIcon() {
    var b = document.getElementById("themebtn");
    if (b) b.textContent = currentTheme() === "dark" ? "🌙" : "☀️";
  }
  function toggleTheme() {
    var next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("cv-theme", next); } catch (e) {}
    syncThemeIcon();
  }

  // ---------- boot ----------
  function boot(data) {
    state.data = data;
    shell();
    document.getElementById("gen").textContent = data.summary.total_cards + " cards · " + money0(data.summary.total_value);
    setTab("collection");
  }

  try { var t = localStorage.getItem("cv-theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch (e) {}

  if (window.__CARD_DATA__) {
    boot(window.__CARD_DATA__);
  } else {
    fetch("./data.json?v=" + Date.now()).then(function (r) { return r.json(); }).then(boot).catch(function () {
      document.body.innerHTML = '<main style="padding:40px;text-align:center;color:#94a08b">Could not load your collection data. Run <b>python3 build_web.py</b> and reload.</main>';
    });
  }

  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("./sw.js").catch(function () {}); });
  }
})();
