/* Card Vault — client-side app. Reads inlined window.__CARD_DATA__ (preview)
   or fetches ./data.json (on GitHub Pages). Renders a tabbed, card-based PWA. */

(function () {
  "use strict";

  var APP_VERSION = "v28";
  var state = { tab: "collection", filter: "All", data: null, bucket: "Cards",
                collapsed: {}, q: "", sort: "tier",
                radarFilter: { type: "all", sport: "all", graded: "all", grade: "all" } };

  // ---------- helpers ----------
  function el(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function money(n) { return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(n) { return "$" + Math.round(Number(n || 0)).toLocaleString(); }
  function num(v) { var n = parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? 0 : n; }
  function copyText(t) { try { if (navigator.clipboard) navigator.clipboard.writeText(t); } catch (e) {} }
  function flashBtn(btn, msg) { var o = btn.innerHTML; btn.textContent = msg; setTimeout(function () { btn.innerHTML = o; }, 1900); }

  // ---------- shell ----------
  function shell() {
    document.body.innerHTML = "";
    document.body.appendChild(el(
      '<div class="appbar">' +
        '<div class="logo">🃏</div>' +
        '<div class="brand"><b>Card Vault</b><small id="gen">your collection</small></div>' +
        '<div class="spacer"></div>' +
        '<span class="ver" id="verpill" title="App version — check this to confirm the latest build loaded">' + APP_VERSION + '</span>' +
        '<span class="pill" id="livepill">Local</span>' +
        '<button class="iconbtn" id="themebtn" title="Light / dark">🌙</button>' +
      "</div>"
    ));
    document.body.appendChild(el('<main id="view"></main>'));
    document.body.appendChild(el(
      '<div class="modal-wrap" id="modalWrap"><div class="modal" id="modal"></div></div>'
    ));
    document.body.appendChild(el(
      '<div class="modal-wrap" id="filterWrap"><div class="modal"></div></div>'
    ));
    var nav = el('<nav class="nav"></nav>');
    // rail-only brand (desktop sidebar); hidden on phones via CSS
    nav.appendChild(el('<div class="navbrand"><span class="logo">🃏</span>Card Vault</div>'));
    [["collection", "🗃️", "Collection"],
     ["value", "💰", "Value"],
     ["salesmap", "🗺️", "Sales Map"],
     ["radar", "🔎", "Buy Radar"],
     ["targets", "🎯", "Targets"],
     ["drafts", "🏷️", "Drafts"],
     ["about", "ℹ️", "About"]].forEach(function (t) {
      var b = el('<button data-tab="' + t[0] + '"><span class="i">' + t[1] + '</span>' + t[2] + "</button>");
      b.onclick = function () { setTab(t[0]); };
      nav.appendChild(b);
    });
    nav.appendChild(el('<div class="navfoot"><small>Collection value</small><b class="tnum">' +
      money0(state.data.summary.total_value) + "</b></div>"));
    document.body.appendChild(nav);

    document.getElementById("themebtn").onclick = toggleTheme;
    document.getElementById("modalWrap").onclick = function (e) {
      if (e.target.id === "modalWrap") closeModal();
    };
    document.getElementById("filterWrap").onclick = function (e) {
      if (e.target.id === "filterWrap") closeFilter();
    };
    // PC keyboard: "/" jumps to search, Esc closes any sheet
    document.addEventListener("keydown", function (e) {
      var typing = /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || "");
      if (e.key === "/" && !typing) {
        var s = document.querySelector(".search input");
        if (s) { e.preventDefault(); s.focus(); }
      } else if (e.key === "Escape") { closeModal(); closeFilter(); }
    });
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
    v.appendChild({ collection: viewCollection, value: viewValue, salesmap: viewSalesMap,
                    radar: viewRadar, targets: viewTargets, drafts: viewDrafts,
                    about: viewAbout }[state.tab]());
    v.scrollTop = 0; window.scrollTo(0, 0);
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
  function teamColors(team) { return TEAM_COLORS[team] || ["#1d3a2f", "#0e1310"]; }
  function initials(name) {
    if (!name) return "🃏";
    var parts = String(name).replace(/[^A-Za-z ]/g, " ").trim().split(/\s+/);
    var s = (parts[0] ? parts[0][0] : "") + (parts[1] ? parts[1][0] : "");
    return s ? s.toUpperCase() : "🃏";
  }

  // photo thumbnail — or a smart team-colored placeholder with the player's
  // initials when there's no photo yet.
  function thumb(c, cls) {
    if (c.image) return '<div class="thumb ' + (cls || "") + '"><img src="' + esc(c.image) + '" alt="" loading="lazy"></div>';
    var col = teamColors(c.team);
    var style = "background:linear-gradient(140deg," + col[0] + "," + col[1] + ")";
    return '<div class="thumb ph ' + (cls || "") + '" style="' + style + '">' +
      '<span class="ini">' + esc(initials(c.player)) + "</span></div>";
  }

  // price-basis pill: green SOLD (real sold comps), blue EST (asking comps
  // haircut to estimate market — eBay denied us the sold-comp API), gold ASKING
  // (raw active listings).
  function basisPill(c) {
    if (c.status !== "priced" || !c.price_basis) return "";
    var map = { sold: ["b-sold", "SOLD"], est_sold: ["b-est", "EST"], asking: ["b-ask", "ASKING"] };
    var p = map[c.price_basis] || map.asking;
    return '<span class="basis ' + p[0] + '">' + p[1] + "</span>";
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

  // one card/merch row
  function crowEl(c) {
    var val, status;
    if (c.sold) {
      val = '<div class="val tnum soldval">' + money0(c.sold_price) + "</div>";
      status = '<div class="st">Sold' + (c.sold_date ? " " + esc(c.sold_date) : "") + "</div>";
    } else {
      val = c.asking_price ? '<div class="val tnum">' + money0(c.asking_price) + changeChip(c) + "</div>"
                           : '<div class="val none">—</div>';
      status = c.status === "priced" ? basisPill(c) : '<div class="st">Needs price</div>';
    }
    var row = el(
      '<button class="crow s-' + c.status + '">' +
        '<div class="stripe"></div>' +
        thumb(c) +
        '<div class="m"><div class="p">' + esc(c.player) + badges(c) + "</div>" +
          '<div class="sub">' + esc(c.line || "") + "</div></div>" +
        '<div class="r">' + val + status + "</div>" +
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

  // instant search: every word must hit somewhere in the card's text
  function matchQuery(c) {
    if (!state.q) return true;
    var hay = [c.player, c.team, c.set, c.brand, c.year, c.sku, c.parallel,
               c.insert, c.sport, c.item_type, c.grader, c.grade]
              .join(" ").toLowerCase();
    return state.q.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  var SORTS = [["tier", "Price tiers"], ["val-desc", "Value: high → low"],
               ["val-asc", "Value: low → high"], ["az", "Player A–Z"], ["new", "Newest added"]];
  function sortCards(arr, mode) {
    var a = arr.slice();
    if (mode === "val-asc") a.sort(function (x, y) { return num(x.asking_price) - num(y.asking_price); });
    else if (mode === "az") a.sort(function (x, y) { return String(x.player).localeCompare(String(y.player)); });
    else if (mode === "new") a.sort(function (x, y) { return String(y.sku).localeCompare(String(x.sku), undefined, { numeric: true }); });
    else a.sort(function (x, y) { return num(y.asking_price) - num(x.asking_price); });
    return a;
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

    // search + sort toolbar (typing re-renders only the results below,
    // so the input keeps focus)
    var bar = el('<div class="toolbar">' +
      '<label class="search"><span class="si">🔎</span>' +
      '<input type="search" placeholder="Search players, teams, sets…" value="' + esc(state.q) + '">' +
      "<kbd>/</kbd></label>" +
      '<select class="sortsel" title="Sort">' +
        SORTS.map(function (s) {
          return '<option value="' + s[0] + '"' + (state.sort === s[0] ? " selected" : "") + ">" + s[1] + "</option>";
        }).join("") +
      "</select></div>");
    var results = el("<div></div>");
    bar.querySelector("input").oninput = function () { state.q = this.value.trim(); renderResults(); };
    bar.querySelector("select").onchange = function () { state.sort = this.value; renderResults(); };
    wrap.appendChild(bar);
    wrap.appendChild(results);

    function renderResults() {
      results.innerHTML = "";
      var inBucket = cards.filter(function (c) { return state.bucket === "Merch" ? c.is_merch : !c.is_merch; });

      if (state.bucket === "Cards") {
        var sports = [];
        inBucket.forEach(function (c) { if (c.sport && sports.indexOf(c.sport) < 0) sports.push(c.sport); });
        results.appendChild(filterBar(sports));

        var shown = inBucket.filter(matchFilter).filter(matchQuery);
        if (state.q || state.sort !== "tier") {
          // searching or custom sort → one flat, sorted grid
          results.appendChild(el('<div class="rescount">' + shown.length +
            (shown.length === 1 ? " card" : " cards") + (state.q ? " matching “" + esc(state.q) + "”" : "") + "</div>"));
          var list = el('<div class="list"></div>');
          sortCards(shown, state.sort).forEach(function (c) { list.appendChild(crowEl(c)); });
          results.appendChild(list);
        } else {
          var groups = {};
          shown.forEach(function (c) {
            var t = tierOf(c);
            (groups[t.label] = groups[t.label] || { items: [], t: t }).items.push(c);
          });
          var ordered = Object.keys(groups).map(function (k) { return groups[k]; })
            .sort(function (a, b) { return a.t.order - b.t.order; });
          ordered.forEach(function (g) {
            g.items.sort(function (a, b) { return num(b.asking_price) - num(a.asking_price); });
            results.appendChild(sectionEl(g.t.label, g.items, g.t.collapse));
          });
        }
        if (!shown.length) results.appendChild(el('<p class="muted">No cards match.</p>'));
      } else {
        // Merch grouped by item type (Jersey, Helmet, Ball, …)
        var inMerch = inBucket.filter(matchQuery);
        var byType = {};
        inMerch.forEach(function (c) { var k = c.item_type || "Merch"; (byType[k] = byType[k] || []).push(c); });
        var keys = Object.keys(byType).sort();
        keys.forEach(function (k) {
          byType[k].sort(function (a, b) { return num(b.asking_price) - num(a.asking_price); });
          results.appendChild(sectionEl(k, byType[k], false));
        });
        if (!keys.length) results.appendChild(el('<p class="muted">' +
          (state.q ? "No merch matches." : "No merch yet — add jerseys, helmets, balls, photos…") + "</p>"));
      }
    }
    renderResults();
    return wrap;
  }

  // Filter bar: a single button showing the active filter, opens a popup sheet.
  function filterBar(sports) {
    var bar = el('<div class="filterbar"></div>');
    var active = state.filter !== "All";
    var btn = el('<button class="filterbtn' + (active ? " on" : "") + '">' +
      '<span class="fi">☰</span><span class="flabel">Filter</span>' +
      '<span class="fcur">' + esc(state.filter) + "</span></button>");
    btn.onclick = function () { openFilter(sports); };
    bar.appendChild(btn);
    if (active) {
      var clr = el('<button class="fclear">Clear</button>');
      clr.onclick = function () { state.filter = "All"; render(); };
      bar.appendChild(clr);
    }
    return bar;
  }

  function openFilter(sports) {
    var groups = [
      ["Sport", sports.slice().sort()],
      ["Type", ["Graded", "Raw", "Autos", "Non-Autos", "Rookie", "Numbered"]],
      ["Status", ["Listed", "Sold"]]
    ];
    var html = '<div class="fgroup"><div class="fchips">' +
      '<button class="fchip' + (state.filter === "All" ? " on" : "") + '" data-f="All">All cards</button></div></div>';
    html += groups.map(function (g) {
      if (!g[1].length) return "";
      var chips = g[1].map(function (f) {
        return '<button class="fchip' + (state.filter === f ? " on" : "") + '" data-f="' + esc(f) + '">' + esc(f) + "</button>";
      }).join("");
      return '<div class="fgroup"><div class="flab">' + g[0] + '</div><div class="fchips">' + chips + "</div></div>";
    }).join("");
    var wrap = document.getElementById("filterWrap");
    var sheet = wrap.querySelector(".modal");
    sheet.innerHTML = '<button class="close" id="fClose">✕</button><h3>Filter cards</h3>' + html;
    sheet.querySelectorAll(".fchip").forEach(function (b) {
      b.onclick = function () { state.filter = b.getAttribute("data-f"); closeFilter(); render(); };
    });
    sheet.querySelector("#fClose").onclick = closeFilter;
    wrap.classList.add("open");
  }
  function closeFilter() { document.getElementById("filterWrap").classList.remove("open"); }

  function matchFilter(c) {
    switch (state.filter) {
      case "All": return true;
      case "Graded": return c.graded;
      case "Raw": return !c.graded;
      case "Autos": return c.auto;
      case "Non-Autos": return !c.auto;
      case "Rookie": return c.rookie;
      case "Numbered": return !!c.serial_run;
      case "Listed": return c.listed;
      case "Sold": return c.sold;
      default: return c.sport === state.filter;
    }
  }

  // value-over-time line chart (SVG, no libraries). One point per daily
  // snapshot in data.history; needs 2+ points to draw a line.
  function trendChart(history) {
    var panel = el('<div class="panel trend"><div class="ptitle">Value over time</div></div>');
    var h = (history || []).filter(function (p) { return p && typeof p.v === "number"; });
    if (h.length < 2) {
      var v = h.length ? money0(h[0].v) : "";
      panel.appendChild(el('<p class="muted" style="font-size:13px;margin:4px 0 2px">Tracking started ' +
        (h.length ? "— today’s snapshot: <b>" + v + "</b>. " : ". ") +
        "The chart draws itself as daily snapshots build up.</p>"));
      return panel;
    }
    var W = 600, H = 200, PL = 46, PR = 10, PT = 14, PB = 22;
    var vals = h.map(function (p) { return p.v; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var X = function (i) { return PL + (W - PL - PR) * (h.length === 1 ? 0 : i / (h.length - 1)); };
    var Y = function (v) { return PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo)); };
    var pts = h.map(function (p, i) { return X(i).toFixed(1) + "," + Y(p.v).toFixed(1); });
    var area = "M" + pts.join(" L") + " L" + X(h.length - 1).toFixed(1) + "," + (H - PB) +
               " L" + PL + "," + (H - PB) + " Z";
    var dots = h.length <= 40 ? h.map(function (p, i) {
      return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) +
        '" r="3" fill="var(--gold)"><title>' + esc(p.d) + " — " + money0(p.v) + "</title></circle>";
    }).join("") : "";
    var mdy = function (d) { var p = String(d).split("-"); return p.length === 3 ? p[1] + "/" + p[2] : d; };
    panel.appendChild(el(
      '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Collection value over time">' +
        '<defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="var(--gold)" stop-opacity=".28"/>' +
          '<stop offset="1" stop-color="var(--gold)" stop-opacity="0"/></linearGradient></defs>' +
        '<line x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) + '" stroke="var(--border)"/>' +
        '<text class="tx" x="4" y="' + (Y(hi - pad) + 4) + '">' + money0(hi - pad) + "</text>" +
        '<text class="tx" x="4" y="' + (Y(lo + pad) + 4) + '">' + money0(lo + pad) + "</text>" +
        '<text class="tx" x="' + PL + '" y="' + (H - 6) + '">' + esc(mdy(h[0].d)) + "</text>" +
        '<text class="tx" x="' + (W - PR) + '" y="' + (H - 6) + '" text-anchor="end">' + esc(mdy(h[h.length - 1].d)) + "</text>" +
        '<path d="' + area + '" fill="url(#tg)"/>' +
        '<polyline points="' + pts.join(" ") + '" fill="none" stroke="var(--gold)" stroke-width="2.5" ' +
          'stroke-linejoin="round" stroke-linecap="round"/>' + dots +
      "</svg>"));
    return panel;
  }

  function viewValue() {
    var s = state.data.summary;
    var wrap = el('<div class="view"></div>');
    wrap.appendChild(el('<div class="eyebrow">Collection value</div>'));
    var tiles = el('<div class="tiles"></div>');
    tiles.appendChild(el('<div class="tile hero"><div class="k">Estimated value</div><div class="v tnum">' + money(s.total_value) + "</div></div>"));
    // profit/cost only read once a cost is entered (else blank cost = $0 makes
    // profit == full value, which isn't true).
    var hasCost = (s.cost_count || 0) > 0;
    var profitCls = hasCost ? (s.profit >= 0 ? "pos" : "neg") : "";
    [["Total cost", hasCost ? money(s.total_cost) : "—", ""],
     ["Est. profit", hasCost ? money(s.profit) : "—", profitCls],
     ["Cards", s.total_cards, ""],
     ["Priced", s.priced + " / " + (s.total_cards - (s.sold || 0)), ""],
     ["Graded", s.graded, ""],
     ["Autographs", s.autos, ""]].forEach(function (t) {
      tiles.appendChild(el('<div class="tile"><div class="k">' + t[0] + '</div><div class="v tnum ' + t[2] + '">' + t[1] + "</div></div>"));
    });
    wrap.appendChild(tiles);
    if (!hasCost) {
      wrap.appendChild(el('<p class="muted" style="font-size:12.5px;margin:8px 2px 0">' +
        "💡 Add what you paid (the <b>cost</b> column in your sheet) to turn on profit — " +
        "it’ll show here and on the Sales Map.</p>"));
    }

    // the business row — only once something is listed or sold
    if (s.listed || s.sold) {
      wrap.appendChild(el('<div class="eyebrow">Business</div>'));
      var biz = el('<div class="tiles biz"></div>');
      var rCls = s.realized_profit >= 0 ? "pos" : "neg";
      [["Revenue", money(s.revenue), "pos"],
       ["Realized profit", money(s.realized_profit), rCls],
       ["Listed now", s.listed, ""],
       ["Sold", s.sold, ""]].forEach(function (t) {
        biz.appendChild(el('<div class="tile"><div class="k">' + t[0] + '</div><div class="v tnum ' + t[2] + '">' + t[1] + "</div></div>"));
      });
      wrap.appendChild(biz);
    }

    // $-weighted bar panel used for By-sport and By-grade
    function statPanel(title, stats) {
      var panel = el('<div class="panel"><div class="ptitle">' + title + "</div></div>");
      var bars = el('<div class="bars"></div>');
      var max = stats.length ? Math.max.apply(null, stats.map(function (g) { return g.value; })) || 1 : 1;
      stats.forEach(function (g) {
        bars.appendChild(el('<div class="barrow"><span>' + esc(g.name) + '</span>' +
          '<div class="track"><div class="fill" style="width:' + (g.value / max * 100) + '%"></div></div>' +
          '<b class="tnum">' + money0(g.value) + " · " + g.count + "</b></div>"));
      });
      if (!stats.length) bars.appendChild(el('<p class="muted" style="font-size:13px">Nothing here yet.</p>'));
      panel.appendChild(bars);
      return panel;
    }

    // movers: biggest week-over-week price changes (fed by reprice runs)
    function moversPanel() {
      var panel = el('<div class="panel"><div class="ptitle">Movers · this week</div></div>');
      var movers = state.data.cards.filter(function (c) {
        return !c.sold && c.prev_price && num(c.asking_price) &&
               Math.abs(num(c.asking_price) - num(c.prev_price)) / num(c.prev_price) >= 0.005;
      }).sort(function (a, b) {
        var pa = Math.abs(num(a.asking_price) - num(a.prev_price)) / num(a.prev_price);
        var pb = Math.abs(num(b.asking_price) - num(b.prev_price)) / num(b.prev_price);
        return pb - pa;
      }).slice(0, 6);
      if (!movers.length) {
        panel.appendChild(el('<p class="muted" style="font-size:13px;margin:4px 0 2px">No price moves yet — ' +
          "movers show up here after the weekly eBay re-price runs.</p>"));
        return panel;
      }
      var list = el('<div class="movers"></div>');
      movers.forEach(function (c) {
        var row = el('<button class="mover"><span class="mp">' + esc(c.player) +
          '</span><span class="ms">' + esc(c.line || "") + '</span>' +
          '<span class="mr tnum">' + money0(c.asking_price) + changeChip(c) + "</span></button>");
        row.onclick = function () { openModal(c); };
        list.appendChild(row);
      });
      panel.appendChild(list);
      return panel;
    }

    // panel grid: 2×2 on PC, stacked on phones
    var vgrid = el('<div class="vgrid"></div>');
    vgrid.appendChild(statPanel("Value by sport", s.sport_stats || []));
    vgrid.appendChild(trendChart(state.data.history));
    vgrid.appendChild(moversPanel());
    vgrid.appendChild(statPanel("Value by grade", s.grade_stats || []));
    wrap.appendChild(vgrid);

    wrap.appendChild(el('<div class="eyebrow">Top cards by value</div>'));
    var top = state.data.cards.slice().filter(function (c) { return num(c.asking_price) > 0; })
                .sort(function (a, b) { return num(b.asking_price) - num(a.asking_price); }).slice(0, 6);
    var list = el('<div class="list"></div>');
    top.forEach(function (c) { list.appendChild(crowEl(c)); });
    wrap.appendChild(top.length ? list : el('<p class="muted">No priced cards yet.</p>'));
    return wrap;
  }

  // ---------- Sales Map ----------
  // Which held cards are in the best position to sell, plus price-change
  // analytics. All signals come from fields already in data.json, so the tab
  // works today and sharpens automatically as weekly re-price runs add history.

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

    // 3) Price confidence — how much we trust the number we'd list at.
    score += c.price_basis === "sold" ? 10 : c.price_basis === "est_sold" ? 6 : c.price_basis === "asking" ? 3 : 0;

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

  var SELL_RATING = { 3: ["Prime to sell", "great"], 2: ["Good to sell", "good"],
                      1: ["Fair", "fair"], 0: ["Hold", "over"] };

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
    return m && m.count >= 5 && cur > 0 && cur < m.median && cur >= m.median * 0.5;
  }

  // Profit from the owner's recorded cost (gross, before eBay/shipping fees).
  // null when no cost is entered yet, so the UI can leave a labelled spot to
  // add it rather than pretending profit == full value.
  function profitOf(c) {
    var cost = num(c.cost), est = num(c.asking_price);
    if (cost <= 0 || est <= 0) return null;
    return { cost: cost, est: est, profit: est - cost, margin: (est - cost) / cost * 100 };
  }

  // compact profit chip for a sell row — the number when we have cost, or a
  // dashed "add cost" placeholder (the spot to fill) when we don't.
  function profitChip(c) {
    var pf = profitOf(c);
    if (!pf) return '<div class="rpf addcost">＋ add cost</div>';
    var up = pf.profit >= 0;
    return '<div class="rpf ' + (up ? "up" : "down") + '">' + (up ? "+" : "−") +
      money0(Math.abs(pf.profit)) + " profit</div>";
  }

  // compact market line under a sell row: typical price + listing count, and
  // (only when solid) the room up toward that typical price.
  function marketLine(c) {
    var m = goingFor(c);
    if (!m) return "";
    var room = marketSolid(c, m) ? ' · <span class="room">room to ~' + money0(m.median) + "</span>" : "";
    var thin = (m.count && m.count < 5) ? ' · <span class="thin">thin data</span>' : "";
    return '<div class="smkt">Usually ~' + money0(m.median) +
      (m.count ? " · " + m.count + " on eBay" : "") + room + thin + "</div>";
  }

  // Tiny inline price-history sparkline (SVG, no libraries). Reused in sell
  // rows and the card modal. Needs 2+ points; returns "" otherwise.
  function sparkline(series, w, h) {
    var pts = (series || []).filter(function (p) { return p && typeof p.p === "number"; });
    if (pts.length < 2) return "";
    w = w || 88; h = h || 26;
    var vals = pts.map(function (p) { return p.p; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    var X = function (i) { return (w - 2) * (i / (pts.length - 1)) + 1; };
    var Y = function (v) { return (h - 3) * (1 - (v - lo) / (hi - lo)) + 1.5; };
    var up = vals[vals.length - 1] >= vals[0];
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(p.p).toFixed(1); }).join(" ");
    return '<svg class="spark ' + (up ? "up" : "down") + '" viewBox="0 0 ' + w + " " + h +
      '" width="' + w + '" height="' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + d + '" fill="none" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + X(pts.length - 1).toFixed(1) + '" cy="' + Y(vals[vals.length - 1]).toFixed(1) + '" r="1.9"/></svg>';
  }

  // The map: a Value × Sell-readiness scatter. Top-right = big-ticket, ready to
  // sell. Dots colour by rating, tap to open the card.
  function quadrantMap(scored) {
    var panel = el('<div class="panel"><div class="ptitle">Sell map · value × readiness</div></div>');
    if (scored.length < 2) {
      panel.appendChild(el('<p class="muted" style="font-size:13px;margin:4px 0 2px">Add a few priced cards and the map fills in.</p>'));
      return panel;
    }
    var W = 600, H = 300, PL = 40, PR = 14, PT = 16, PB = 30;
    var vlog = scored.map(function (s) { return Math.log(Math.max(num(s.c.asking_price), 1)); });
    var lo = Math.min.apply(null, vlog), hi = Math.max.apply(null, vlog);
    if (hi === lo) { hi += 1; lo -= 1; }
    var X = function (lg) { return PL + (W - PL - PR) * (lg - lo) / (hi - lo); };
    var Y = function (sc) { return PT + (H - PT - PB) * (1 - sc / 100); };
    var midX = X((lo + hi) / 2), midY = Y(50);
    var dots = scored.map(function (s) {
      var r = SELL_RATING[s.bars] || SELL_RATING[0];
      var rad = 4 + Math.min(7, num(s.c.asking_price) > 0 ? Math.log(num(s.c.asking_price) + 1) : 0);
      return '<circle class="qd ' + r[1] + '" data-sku="' + esc(s.c.sku) + '" cx="' + X(Math.log(Math.max(num(s.c.asking_price), 1))).toFixed(1) +
        '" cy="' + Y(s.score).toFixed(1) + '" r="' + rad.toFixed(1) + '"><title>' + esc(s.c.player) +
        " · " + money0(s.c.asking_price) + " · " + r[0] + " (" + s.score + ")</title></circle>";
    }).join("");
    var svg = el(
      '<svg class="qmap" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Sell map: value versus readiness">' +
        '<rect class="qquad" x="' + midX + '" y="' + PT + '" width="' + (W - PR - midX) + '" height="' + (midY - PT) + '"/>' +
        '<line class="qax" x1="' + midX + '" y1="' + PT + '" x2="' + midX + '" y2="' + (H - PB) + '"/>' +
        '<line class="qax" x1="' + PL + '" y1="' + midY + '" x2="' + (W - PR) + '" y2="' + midY + '"/>' +
        '<line class="qbord" x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) + '"/>' +
        '<text class="qlab hot" x="' + (W - PR - 4) + '" y="' + (PT + 14) + '" text-anchor="end">▲ prime to sell</text>' +
        '<text class="tx" x="' + (PL) + '" y="' + (H - 10) + '">lower value</text>' +
        '<text class="tx" x="' + (W - PR) + '" y="' + (H - 10) + '" text-anchor="end">higher value →</text>' +
        '<text class="tx" x="6" y="' + (PT + 6) + '">ready</text>' +
        dots +
      "</svg>");
    svg.querySelectorAll(".qd").forEach(function (dot) {
      dot.style.cursor = "pointer";
      dot.onclick = function () {
        var sku = dot.getAttribute("data-sku");
        var card = state.data.cards.filter(function (c) { return c.sku === sku; })[0];
        if (card) openModal(card);
      };
    });
    panel.appendChild(svg);
    panel.appendChild(el('<p class="muted qcap">Each dot is a card — right = worth more, up = readier to sell. ' +
      'Tap a dot to open it. Colour = Prime / Good / Fair / Hold.</p>'));
    return panel;
  }

  // one ranked sell-candidate row
  function sellRowEl(s) {
    var c = s.c, r = SELL_RATING[s.bars] || SELL_RATING[0];
    var reasons = s.reasons.slice(0, 3).map(function (x) { return '<span class="rchip">' + esc(x) + "</span>"; }).join("");
    var spark = sparkline(c.price_series, 74, 24);
    var row = el(
      '<button class="srow">' +
        thumb(c) +
        '<div class="m"><div class="p">' + esc(c.player) +
          (c.listed ? ' <span class="badge b-listed">LISTED</span>' : "") + "</div>" +
          '<div class="sub">' + esc(c.line || "") + "</div>" +
          '<div class="rchips">' + reasons + "</div>" + marketLine(c) + "</div>" +
        '<div class="r">' +
          '<div class="val tnum">' + money0(c.asking_price) + changeChip(c) + "</div>" +
          profitChip(c) +
          (spark ? '<div class="sparkwrap">' + spark + "</div>" : "") +
          '<div class="drate ' + r[1] + '">' + ratingBars(s.bars) + '<span class="rlabel">' + r[0] + "</span></div>" +
        "</div>" +
      "</button>");
    row.onclick = function () { openModal(c); };
    return row;
  }

  function viewSalesMap() {
    var wrap = el('<div class="view salesmap"></div>');
    wrap.appendChild(el('<div class="eyebrow">Sales Map</div>'));
    wrap.appendChild(el('<p class="muted" style="font-size:13px;margin:0 2px 12px">Which of your cards are in the best ' +
      "position to sell — scored on value, how fast the type moves, and price momentum — plus how prices are changing over time.</p>"));

    // held, priced cards → scored & ranked
    var held = state.data.cards.filter(function (c) { return !c.sold && num(c.asking_price) > 0; });
    var scored = held.map(function (c) { var s = sellScore(c); s.c = c; return s; })
      .sort(function (a, b) { return b.score - a.score; });

    if (!scored.length) {
      wrap.appendChild(el('<div class="card"><p class="muted" style="margin:0">No priced cards to map yet. ' +
        "Price your cards (weekly eBay re-price does this automatically) and they’ll rank here.</p></div>"));
      return wrap;
    }

    // headline tiles: how many are prime / good / worth listing + est. profit
    var sm = state.data.summary;
    var prime = scored.filter(function (s) { return s.bars >= 3; });
    var good = scored.filter(function (s) { return s.bars === 2; });
    var topVal = scored.reduce(function (a, s) { return a + num(s.c.asking_price); }, 0);
    var costCount = sm.cost_count || 0, pricedM = sm.priced || scored.length;
    var tiles = el('<div class="tiles"></div>');
    tiles.appendChild(el('<div class="tile hero"><div class="k">Prime to sell now</div><div class="v tnum">' +
      prime.length + ' <small class="hsub">of ' + scored.length + " priced</small></div></div>"));
    [["Good to sell", good.length, ""],
     ["Value in play", money0(topVal), ""]].forEach(function (t) {
      tiles.appendChild(el('<div class="tile"><div class="k">' + t[0] + '</div><div class="v tnum ' + t[2] + '">' + t[1] + "</div></div>"));
    });
    // Est. profit — only meaningful over cards with a cost entered; otherwise a
    // gentle prompt to add cost (the "spot to fill").
    var pVal = costCount ? ((sm.profit >= 0 ? "+" : "−") + money0(Math.abs(sm.profit))) : "—";
    var pCls = costCount ? (sm.profit >= 0 ? "pos" : "neg") : "";
    var pSub = costCount ? "on " + costCount + " of " + pricedM + " with cost" : "add cost to unlock";
    tiles.appendChild(el('<div class="tile"><div class="k">Est. profit</div><div class="v tnum ' + pCls +
      '">' + pVal + ' <small class="tsub">' + pSub + "</small></div></div>"));
    wrap.appendChild(tiles);

    // Dashboard grid. DOM order (map → list → price changes) is the phone
    // stack; on PC the grid re-flows to map+analytics on the left, ranked
    // list spanning the right — so phones keep the order the owner liked.
    var grid = el('<div class="smgrid"></div>');

    var mapcol = el('<div class="smmap"></div>');
    mapcol.appendChild(quadrantMap(scored));
    grid.appendChild(mapcol);

    var listcol = el('<div class="smlist"></div>');
    listcol.appendChild(el('<div class="eyebrow">Best positioned to sell</div>'));
    var list = el('<div class="list sellist"></div>');
    scored.slice(0, 12).forEach(function (s) { list.appendChild(sellRowEl(s)); });
    listcol.appendChild(list);
    grid.appendChild(listcol);

    // price-change analytics: value trend + weekly gainers / decliners
    var trendcol = el('<div class="smtrends"></div>');
    trendcol.appendChild(el('<div class="eyebrow">Price changes</div>'));
    var vgrid = el('<div class="vgrid"></div>');
    vgrid.appendChild(trendChart(state.data.history));
    vgrid.appendChild(moversSplitPanel());
    trendcol.appendChild(vgrid);
    grid.appendChild(trendcol);

    wrap.appendChild(grid);
    return wrap;
  }

  // Gainers (sell into strength) vs decliners (sell before further slide),
  // from week-over-week price moves. Populates once re-price history builds.
  function moversSplitPanel() {
    var panel = el('<div class="panel"><div class="ptitle">This week · gainers &amp; decliners</div></div>');
    var moved = state.data.cards.filter(function (c) {
      return !c.sold && num(c.prev_price) > 0 && num(c.asking_price) > 0 &&
             Math.abs(num(c.asking_price) - num(c.prev_price)) / num(c.prev_price) >= 0.005;
    }).map(function (c) {
      return { c: c, pct: (num(c.asking_price) - num(c.prev_price)) / num(c.prev_price) * 100 };
    });
    if (!moved.length) {
      panel.appendChild(el('<p class="muted" style="font-size:13px;margin:4px 0 2px">No price moves yet — ' +
        "gainers and decliners appear once the weekly eBay re-price has two snapshots to compare.</p>"));
      return panel;
    }
    var up = moved.filter(function (m) { return m.pct > 0; }).sort(function (a, b) { return b.pct - a.pct; }).slice(0, 4);
    var down = moved.filter(function (m) { return m.pct < 0; }).sort(function (a, b) { return a.pct - b.pct; }).slice(0, 4);
    function group(title, arr, cls) {
      if (!arr.length) return "";
      var rows = arr.map(function (m) {
        return '<button class="mover" data-sku="' + esc(m.c.sku) + '"><span class="mp">' + esc(m.c.player) +
          '</span><span class="ms">' + esc(m.c.line || "") + '</span>' +
          '<span class="mr tnum">' + money0(m.c.asking_price) + changeChip(m.c) + "</span></button>";
      }).join("");
      return '<div class="mgroup ' + cls + '"><div class="mglab">' + title + "</div>" + rows + "</div>";
    }
    var box = el('<div class="movers split">' + group("▲ Gainers", up, "g-up") + group("▼ Decliners", down, "g-down") + "</div>");
    box.querySelectorAll(".mover").forEach(function (b) {
      b.onclick = function () {
        var card = state.data.cards.filter(function (c) { return c.sku === b.getAttribute("data-sku"); })[0];
        if (card) openModal(card);
      };
    });
    panel.appendChild(box);
    return panel;
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

  function viewRadar() {
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
            '<a class="mbtn" href="' + dealSearchUrl(d, true) + '" target="_blank" rel="noopener">✅ Recent sold prices</a>' +
          "</div>" +
        "</div>" +
      "</div>";
    m.querySelector("#mClose").onclick = closeModal;
    document.getElementById("modalWrap").classList.add("open");
  }

  function viewTargets() {
    var wrap = el('<div class="view"></div>');
    wrap.appendChild(el('<div class="eyebrow">Buy targets</div>'));
    wrap.appendChild(el('<p class="muted" style="font-size:13px;margin:0 2px 12px">Cards you’re hunting. ' +
      "Buy Radar scans eBay for these — deals land here once the eBay connection unlocks in-app.</p>"));
    var targets = state.data.targets || [];
    if (!targets.length) {
      wrap.appendChild(el('<p class="muted">No targets yet — add rows to data/watchlist.csv ' +
        "(label, search query, fair value, alert-below price).</p>"));
      return wrap;
    }
    var list = el('<div class="list targets"></div>');
    targets.forEach(function (t) {
      var right = "";
      if (t.alert_below) right += '<span class="talert tnum">BUY &lt; ' + money0(t.alert_below) + "</span>";
      if (t.fair_value) right += '<span class="tfair tnum">fair ' + money0(t.fair_value) + "</span>";
      list.appendChild(el('<div class="trow"><div class="tm"><div class="tp">🎯 ' + esc(t.label) +
        '</div><div class="ts">' + esc(t.query) + (t.notes ? " · " + esc(t.notes) : "") + "</div></div>" +
        '<div class="tr">' + (right || '<span class="muted" style="font-size:12px">no price set</span>') +
        "</div></div>"));
    });
    wrap.appendChild(list);
    return wrap;
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
      (sold ? "Recent eBay sales" : "On eBay now (asking)") +
      (c.comps.broad ? " · broad match" : "") + "</div>" + rows +
      '<div class="cfoot">as of ' + esc(c.comps.as_of || "") +
      (sold ? " · real sold prices" : " · sold prices unlock with eBay approval") + "</div></div>";
  }

  function ebaySearchUrl(c, soldOnly) {
    return "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(c.title) +
      (soldOnly ? "&LH_Sold=1&LH_Complete=1" : "");
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
    var m = goingFor(c);
    if (!m) {
      // Priced but no comps captured (e.g. a niche insert/auto the auto-pricer
      // found zero matches for) — explain instead of silently showing nothing.
      if (num(c.asking_price) <= 0) return "";
      return '<div class="compsbox nomarket"><div class="lab">What it’s going for</div>' +
        '<div class="addcostrow">No eBay comps captured for this exact card yet — the value here is hand-set.</div>' +
        '<div class="cfoot">Niche inserts/autos often return no match on the weekly auto-price run. ' +
        "Tap “Live listings” / “Sold on eBay” below to check the market yourself.</div></div>";
    }
    var cur = num(c.asking_price);
    var prices = ((c.comps && c.comps.items) || []).map(function (it) { return num(it.p); })
      .filter(function (p) { return p > 0; });
    var range = prices.length >= 2
      ? money0(Math.min.apply(null, prices)) + "–" + money0(Math.max.apply(null, prices)) : "";
    var basisTxt = c.price_basis === "sold" ? "real eBay sold comps"
      : c.price_basis === "est_sold" ? "estimated — typical asking − 12%"
      : "active eBay listings";
    var rows =
      '<div class="mkrow"><span>Usually going for</span><b class="tnum">~' + money0(m.median) +
        (m.count ? ' <small>· ' + m.count + " listed</small>" : "") + "</b></div>" +
      (range ? '<div class="mkrow"><span>Live range now</span><b class="tnum">' + range + "</b></div>" : "") +
      '<div class="mkrow"><span>Card Vault value</span><b class="tnum">' + money0(cur) + "</b></div>";
    if (marketSolid(c, m)) {
      var pct = Math.round((m.median - cur) / cur * 100);
      rows += '<div class="mkrow up"><span>Room up to typical</span><b class="tnum">+' +
        money0(m.median - cur) + " · " + pct + "%</b></div>";
    }
    return '<div class="compsbox market"><div class="lab">What it’s going for</div>' + rows +
      '<div class="cfoot">Typical = eBay <b>asking</b> median (' + basisTxt + "). " +
      "Real sold prices need eBay approval — tap “Sold on eBay” below for actuals.</div></div>";
  }

  // Cost & profit box for the modal — the real numbers when a cost is entered,
  // or a labelled prompt (the spot to add it) when it isn't.
  function costProfitBox(c) {
    var pf = profitOf(c);
    if (pf) {
      var cls = pf.profit >= 0 ? "up" : "down";
      return '<div class="compsbox cprofit"><div class="lab">Cost &amp; profit</div>' +
        '<div class="mkrow"><span>You paid</span><b class="tnum">' + money0(pf.cost) + "</b></div>" +
        '<div class="mkrow"><span>Card Vault value</span><b class="tnum">' + money0(pf.est) + "</b></div>" +
        '<div class="mkrow ' + cls + '"><span>Est. profit if sold</span><b class="tnum">' +
          (pf.profit >= 0 ? "+" : "−") + money0(Math.abs(pf.profit)) + " · " + Math.round(pf.margin) + "%</b></div>" +
        '<div class="cfoot">Gross — before eBay &amp; shipping fees.</div></div>';
    }
    return '<div class="compsbox addcostbox"><div class="lab">Cost &amp; profit</div>' +
      '<div class="addcostrow">＋ No cost recorded yet — add what you paid to unlock profit for this card.</div>' +
      '<div class="cfoot">Put it in the <b>cost</b> column of data/inventory.csv (or just tell me the amount).</div></div>';
  }

  // Per-card price-over-time box for the modal — a sparkline of the SKU's
  // re-price snapshots, with first→latest change. Hidden until 2+ snapshots.
  function priceHistoryBox(c) {
    var pts = (c.price_series || []).filter(function (p) { return p && typeof p.p === "number"; });
    if (pts.length < 2) return "";
    var first = pts[0].p, last = pts[pts.length - 1].p;
    var pct = first ? (last - first) / first * 100 : 0;
    var up = last >= first;
    var chg = (Math.abs(pct) < 0.5) ? '<span class="muted">flat</span>'
      : '<span class="chg ' + (up ? "up" : "down") + '">' + (up ? "▲" : "▼") + Math.abs(pct).toFixed(pct >= 10 ? 0 : 1) + "%</span>";
    return '<div class="compsbox phist"><div class="lab">Price history · ' + pts.length + " snapshots</div>" +
      '<div class="phrow">' + sparkline(pts, 200, 44) +
      '<div class="phmeta"><span class="tnum">' + money0(first) + " → " + money0(last) + "</span>" + chg + "</div></div>" +
      '<div class="cfoot">' + esc(pts[0].d) + " → " + esc(pts[pts.length - 1].d) + " · from weekly eBay re-price</div></div>";
  }

  function openModal(c) {
    var m = document.getElementById("modal");
    var rows = [
      ["Item type", c.is_merch ? c.item_type : ""],
      ["Player", c.player], ["Year", c.year], ["Brand", c.brand], ["Set", c.set],
      ["Card #", c.card_number], ["Parallel", c.parallel], ["Insert", c.insert],
      ["Team", c.team], ["Grade", c.graded ? (c.grader + " " + c.grade) : ""],
      ["Authentication", c.is_merch ? c.authentication : ""],
      ["Condition", c.graded ? "" : c.condition], ["Serial", c.serial_run ? "/" + c.serial_run : ""],
      ["Sport", c.sport], ["SKU", c.sku],
      ["Card Vault value", c.asking_price ? money(c.asking_price) : ""],
      ["Price basis", c.price_basis === "sold" ? "Real eBay sold comps"
                    : c.price_basis === "est_sold" ? "Estimated market (asking comps − haircut)"
                    : c.price_basis === "asking" ? "Active listings (asking)" : ""],
      ["Notes", c.notes]
    ].filter(function (r) { return r[1]; });
    var kv = rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
    m.innerHTML =
      '<button class="close" id="mClose">✕</button>' +
      '<div class="mgrid">' +
        '<div class="mhero">' + thumb(c, "big") + "</div>" +
        '<div class="mbody">' +
          "<h3>" + esc(c.player) + badges(c) + basisPill(c) + "</h3>" +
          '<div class="muted" style="font-size:13px">' + esc(c.line || "") + "</div>" +
          '<dl class="kv">' + kv + "</dl>" +
          '<div class="titlebox"><div class="lab">eBay title</div><div class="val">' + esc(c.title) + "</div></div>" +
          marketBox(c) +
          costProfitBox(c) +
          priceHistoryBox(c) +
          compsBox(c) +
          '<div class="listbar"><div class="lblab">🏷️ List this card</div>' +
            '<div class="lbbtns">' +
              '<button class="mbtn prime" id="mListEbay">List on eBay</button>' +
              '<button class="mbtn" id="mListClaude">✨ Draft in Claude</button>' +
            "</div>" +
            '<div class="lbfoot">eBay opens the sell page (title copied to paste). Claude opens a chat to draft the title, specifics &amp; description.</div>' +
          "</div>" +
          '<div class="mbtns">' +
            '<a class="mbtn" href="' + ebaySearchUrl(c, false) + '" target="_blank" rel="noopener">🛒 Live listings</a>' +
            '<a class="mbtn" href="' + ebaySearchUrl(c, true) + '" target="_blank" rel="noopener">✅ Sold on eBay</a>' +
            '<button class="mbtn" id="mShare">🔗 Share card</button>' +
            (c.cert && /psa/i.test(c.grader || "") ?
              '<a class="mbtn" href="https://www.psacard.com/cert/' + esc(c.cert) +
              '" target="_blank" rel="noopener">🔍 PSA cert ' + esc(c.cert) + "</a>" : "") +
          "</div>" +
        "</div>" +
      "</div>";
    m.querySelector("#mClose").onclick = closeModal;
    // quick-list widget: eBay sell page (title on clipboard) or draft in Claude
    var listEbay = m.querySelector("#mListEbay");
    listEbay.onclick = function () {
      copyText(c.title);
      window.open("https://www.ebay.com/sl/sell", "_blank", "noopener");
      flashBtn(listEbay, "✓ Title copied — paste on eBay");
    };
    var listClaude = m.querySelector("#mListClaude");
    listClaude.onclick = function () {
      var q = listPrompt(c);
      copyText(q);
      window.open("https://claude.ai/new?q=" + encodeURIComponent(q), "_blank", "noopener");
      flashBtn(listClaude, "✓ Prompt copied — paste in Claude");
    };
    var share = m.querySelector("#mShare");
    share.onclick = function () {
      var url = location.href.split("#")[0] + "#sku=" + encodeURIComponent(c.sku);
      var done = function () { share.textContent = "✓ Link copied"; setTimeout(function () { share.innerHTML = "🔗 Share card"; }, 1600); };
      if (navigator.share) navigator.share({ title: c.title, url: url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done);
      else done();
    };
    // deep-linkable: #sku=CARD-0022 reopens this exact card
    if (history.replaceState) history.replaceState(null, "", "#sku=" + encodeURIComponent(c.sku));
    document.getElementById("modalWrap").classList.add("open");
  }
  function closeModal() {
    document.getElementById("modalWrap").classList.remove("open");
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
  }
  function openFromHash() {
    var m = location.hash.match(/^#sku=(.+)$/);
    if (!m || !state.data) return;
    var sku = decodeURIComponent(m[1]);
    var card = state.data.cards.filter(function (c) { return c.sku === sku; })[0];
    if (card) openModal(card);
  }

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
    openFromHash();               // shared link straight to a card
    window.addEventListener("hashchange", openFromHash);
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
