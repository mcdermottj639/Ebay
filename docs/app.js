/* Card Vault — client-side app. Reads inlined window.__CARD_DATA__ (preview)
   or fetches ./data.json (on GitHub Pages). Renders a tabbed, card-based PWA. */

(function () {
  "use strict";

  var APP_VERSION = "v12";
  var state = { tab: "collection", filter: "All", data: null, bucket: "Cards",
                collapsed: {}, q: "", sort: "tier" };

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
    v.appendChild({ collection: viewCollection, value: viewValue, targets: viewTargets,
                    drafts: viewDrafts, about: viewAbout }[state.tab]());
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

  // sold-vs-asking pill: green SOLD (real sold comps) vs gold ASKING (active listings)
  function basisPill(c) {
    if (c.status !== "priced" || !c.price_basis) return "";
    var sold = c.price_basis === "sold";
    return '<span class="basis ' + (sold ? "b-sold" : "b-ask") + '">' + (sold ? "SOLD" : "ASKING") + "</span>";
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
    var profitCls = s.profit >= 0 ? "pos" : "neg";
    [["Total cost", money(s.total_cost), ""],
     ["Est. profit", money(s.profit), profitCls],
     ["Cards", s.total_cards, ""],
     ["Priced", s.priced + " / " + (s.total_cards - (s.sold || 0)), ""],
     ["Graded", s.graded, ""],
     ["Autographs", s.autos, ""]].forEach(function (t) {
      tiles.appendChild(el('<div class="tile"><div class="k">' + t[0] + '</div><div class="v tnum ' + t[2] + '">' + t[1] + "</div></div>"));
    });
    wrap.appendChild(tiles);

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
      ["Est. value", c.asking_price ? money(c.asking_price) : ""],
      ["Price basis", c.price_basis === "sold" ? "Real eBay sold comps"
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
          compsBox(c) +
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
