/* Card Vault chart kit (v64).
   Pure functions that return SVG or HTML strings at an exact pixel width, so
   chart text renders at its real size on every screen and the geometry can be
   unit-tested in Node (tests/test_charts.cjs). No dependencies.

   Marks follow one rule set: 2px lines, ~10% area washes, hairline solid
   grids, >= 8px end dots with a surface ring, bars no thicker than 24px with a
   rounded data end and a square baseline. Colour comes from CSS classes so the
   light and dark themes stay in one place (vault.css). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CardVaultCharts = factory();
}(typeof window === "undefined" ? this : window, function () {
  "use strict";

  var DAY = 86400000;
  var uid = 0;
  function nextId(prefix) { uid += 1; return (prefix || "ch") + uid; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fin(n) { return typeof n === "number" && isFinite(n); }
  function fix(n) { return Math.round(n * 10) / 10; }
  function money0(n) {
    if (!fin(n)) return "—";
    return (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
  }
  // 950 -> $950, 2,700 -> $2.7K, 12,400 -> $12K, 1,250,000 -> $1.3M
  function compact(n) {
    if (!fin(n)) return "—";
    var a = Math.abs(n), s = n < 0 ? "−$" : "$";
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return s + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
    return s + Math.round(a);
  }
  function pct(n, digits) { return fin(n) ? (n * 100).toFixed(digits || 0) + "%" : "—"; }
  function day(s) {
    var m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return new Date(t).toISOString().slice(0, 10) === m[0] ? t : null;
  }
  function shortDate(s) {
    var t = day(s);
    if (t === null) return "";
    return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }

  // ---- scales --------------------------------------------------------------
  function niceStep(span, count) {
    var raw = span / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }
  // Clean, evenly spaced tick values that enclose [lo, hi].
  function ticks(lo, hi, count) {
    if (!fin(lo) || !fin(hi)) return { lo: 0, hi: 1, step: 1, values: [0, 1] };
    if (hi < lo) { var tmp = lo; lo = hi; hi = tmp; }
    if (hi === lo) { var p = Math.abs(lo) * 0.1 || 1; lo -= p; hi += p; }
    var step = niceStep(hi - lo, count || 3);
    var a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, out = [];
    for (var v = a; v <= b + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return { lo: a, hi: b, step: step, values: out };
  }

  // ---- area / line over time -------------------------------------------
  // series: [{d:"YYYY-MM-DD", v:number, c?:1 (a re-pricing day)}]. X is true
  // calendar time, so uneven snapshot gaps are not drawn as even steps.
  function areaChart(series, o) {
    o = o || {};
    var W = Math.max(160, Math.round(o.w || 640)), H = Math.round(o.h || 200);
    var L = o.padL == null ? 46 : o.padL, R = o.padR == null ? 14 : o.padR;
    var T = o.padT == null ? 12 : o.padT, B = o.padB == null ? 26 : o.padB;
    var pts = (series || []).map(function (p) { return { t: day(p.d), v: p.v, d: p.d, c: !!p.c }; })
      .filter(function (p) { return p.t !== null && fin(p.v); })
      .sort(function (a, b) { return a.t - b.t; });
    if (pts.length < 2) return { svg: "", points: [], w: W, h: H };
    var vals = pts.map(function (p) { return p.v; });
    var tk = ticks(o.zero ? Math.min(0, Math.min.apply(null, vals)) : Math.min.apply(null, vals), Math.max.apply(null, vals), o.ticks || 3);
    var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    if (t1 === t0) t1 = t0 + DAY;
    var X = function (t) { return L + (W - L - R) * (t - t0) / (t1 - t0); };
    var Y = function (val) { return T + (H - T - B) * (1 - (val - tk.lo) / (tk.hi - tk.lo)); };
    var gid = o.id || nextId("area");
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + fix(X(p.t)) + " " + fix(Y(p.v)); }).join(" ");
    var area = line + " L" + fix(X(t1)) + " " + (H - B) + " L" + fix(X(t0)) + " " + (H - B) + " Z";
    var fmt = o.tickFmt || compact;
    var grid = tk.values.map(function (val) {
      var y = fix(Y(val));
      return '<line class="ch-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/>' +
        '<text class="ch-tick" x="' + (L - 8) + '" y="' + y + '" dy="0.32em" text-anchor="end">' + esc(fmt(val)) + "</text>";
    }).join("");
    var corr = pts.map(function (p, i) {
      return p.c && i > 0 ? '<circle class="ch-corr" cx="' + fix(X(p.t)) + '" cy="' + fix(Y(p.v)) + '" r="4"/>' : "";
    }).join("");
    var last = pts[pts.length - 1];
    var svg = '<svg class="ch ch-area" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H +
      '" role="img" aria-label="' + esc(o.label || "Value over time") + '">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" class="ch-wash-top"/><stop offset="1" class="ch-wash-bottom"/></linearGradient></defs>' +
      grid +
      '<text class="ch-tick" x="' + L + '" y="' + (H - 7) + '">' + esc(o.firstLabel || shortDate(pts[0].d)) + "</text>" +
      '<text class="ch-tick" x="' + (W - R) + '" y="' + (H - 7) + '" text-anchor="end">' + esc(o.lastLabel || shortDate(last.d)) + "</text>" +
      '<path class="ch-fill" fill="url(#' + gid + ')" d="' + area + '"/>' +
      '<path class="ch-line" pathLength="1" d="' + line + '"/>' + corr +
      '<circle class="ch-end" cx="' + fix(X(last.t)) + '" cy="' + fix(Y(last.v)) + '" r="4.5"/>' +
      '<g class="ch-cross" style="display:none"><line class="ch-cross-line" y1="' + T + '" y2="' + (H - B) + '"/>' +
      '<circle class="ch-cross-dot" r="5"/></g></svg>';
    return {
      svg: svg, w: W, h: H,
      points: pts.map(function (p) { return { x: X(p.t), y: Y(p.v), d: p.d, v: p.v, c: p.c }; })
    };
  }

  // Index of the point whose x is nearest to px (points sorted by x).
  function nearest(points, px) {
    var best = -1, dist = Infinity;
    for (var i = 0; i < points.length; i++) {
      var d = Math.abs(points[i].x - px);
      if (d < dist) { dist = d; best = i; }
    }
    return best;
  }

  // ---- sparkline ------------------------------------------------------------
  // Tiny trend line, no text. Direction class compares the last point with the
  // first so the colour matches what the eye reads.
  function sparkline(series, w, h, o) {
    o = o || {};
    var pts = (series || []).filter(function (p) { return p && fin(p.p); });
    if (pts.length < 2) return "";
    w = w || 88; h = h || 26;
    var vals = pts.map(function (p) { return p.p; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    var X = function (i) { return 2 + (w - 6) * (i / (pts.length - 1)); };
    var Y = function (v) { return 3 + (h - 6) * (1 - (v - lo) / (hi - lo)); };
    var first = vals[0], lastV = vals[vals.length - 1];
    var dir = Math.abs(lastV - first) < Math.max(0.005 * Math.abs(first), 0.005) ? "flat" : lastV > first ? "up" : "down";
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + fix(X(i)) + " " + fix(Y(p.p)); }).join(" ");
    var area = o.area ? '<path class="sp-fill" d="' + d + " L" + fix(X(pts.length - 1)) + " " + h + " L" + fix(X(0)) + " " + h + ' Z"/>' : "";
    return '<svg class="spark sp-' + dir + '" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
      '" aria-hidden="true" focusable="false">' + area + '<path class="sp-line" d="' + d + '"/>' +
      '<circle class="sp-end" cx="' + fix(X(pts.length - 1)) + '" cy="' + fix(Y(lastV)) + '" r="2.4"/></svg>';
  }

  // ---- squarified treemap (Bruls, Huizing & van Wijk) -----------------------
  // items: [{id, value}] -> [{id, value, x, y, w, h}] filling the rectangle.
  function treemapLayout(items, x, y, w, h) {
    var data = (items || []).filter(function (it) { return fin(it.value) && it.value > 0; })
      .slice().sort(function (a, b) { return b.value - a.value || String(a.id).localeCompare(String(b.id)); });
    var total = data.reduce(function (n, it) { return n + it.value; }, 0);
    if (!total || w <= 0 || h <= 0) return [];
    var k = (w * h) / total;
    var nodes = data.map(function (it) { return { id: it.id, value: it.value, area: it.value * k }; });
    var out = [], rect = { x: x, y: y, w: w, h: h }, row = [], i = 0;
    function worst(r, len) {
      if (!r.length) return Infinity;
      var s = 0, mx = 0, mn = Infinity;
      r.forEach(function (n) { s += n.area; if (n.area > mx) mx = n.area; if (n.area < mn) mn = n.area; });
      return Math.max(len * len * mx / (s * s), (s * s) / (len * len * mn));
    }
    function place(r) {
      var s = r.reduce(function (n, it) { return n + it.area; }, 0);
      if (rect.w >= rect.h) {
        var colW = s / rect.h, cy = rect.y;
        r.forEach(function (n, j) {
          var hh = j === r.length - 1 ? rect.y + rect.h - cy : n.area / colW;
          out.push({ id: n.id, value: n.value, x: rect.x, y: cy, w: colW, h: hh });
          cy += hh;
        });
        rect = { x: rect.x + colW, y: rect.y, w: Math.max(0, rect.w - colW), h: rect.h };
      } else {
        var rowH = s / rect.w, cx = rect.x;
        r.forEach(function (n, j) {
          var ww = j === r.length - 1 ? rect.x + rect.w - cx : n.area / rowH;
          out.push({ id: n.id, value: n.value, x: cx, y: rect.y, w: ww, h: rowH });
          cx += ww;
        });
        rect = { x: rect.x, y: rect.y + rowH, w: rect.w, h: Math.max(0, rect.h - rowH) };
      }
    }
    while (i < nodes.length) {
      var len = Math.min(rect.w, rect.h);
      if (!row.length || worst(row.concat([nodes[i]]), len) <= worst(row, len)) { row.push(nodes[i]); i++; }
      else { place(row); row = []; }
    }
    if (row.length) place(row);
    return out;
  }

  // ---- cumulative share (concentration / Pareto) ---------------------------
  // values -> [{rank, value, share, cumulative}] sorted high to low.
  function cumulativeShare(values) {
    var v = (values || []).filter(function (n) { return fin(n) && n > 0; }).sort(function (a, b) { return b - a; });
    var total = v.reduce(function (n, x) { return n + x; }, 0), run = 0;
    return v.map(function (x, i) { run += x; return { rank: i + 1, value: x, share: total ? x / total : 0, cumulative: total ? run / total : 0 }; });
  }

  function paretoChart(values, o) {
    o = o || {};
    var rows = cumulativeShare(values);
    var W = Math.max(160, Math.round(o.w || 600)), H = Math.round(o.h || 190);
    var L = 38, R = 14, T = 12, B = 26;
    if (rows.length < 2) return "";
    var n = rows.length;
    var X = function (rank) { return L + (W - L - R) * (rank - 1) / (n - 1); };
    var Y = function (s) { return T + (H - T - B) * (1 - s); };
    var line = rows.map(function (r, i) { return (i ? "L" : "M") + fix(X(r.rank)) + " " + fix(Y(r.cumulative)); }).join(" ");
    var area = line + " L" + fix(X(n)) + " " + (H - B) + " L" + fix(X(1)) + " " + (H - B) + " Z";
    var grid = [0, 0.5, 1].map(function (s) {
      var y = fix(Y(s));
      return '<line class="ch-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/>' +
        '<text class="ch-tick" x="' + (L - 7) + '" y="' + y + '" dy="0.32em" text-anchor="end">' + Math.round(s * 100) + "%</text>";
    }).join("");
    var marks = (o.marks || [1, 3, 10]).filter(function (r) { return r <= n; }).map(function (r) {
      var row = rows[r - 1], cx = fix(X(r)), cy = fix(Y(row.cumulative));
      var anchor = cx > W - 70 ? "end" : "start";
      return '<circle class="ch-mark" cx="' + cx + '" cy="' + cy + '" r="4.5"/>' +
        '<text class="ch-note" x="' + (anchor === "end" ? cx - 8 : cx + 8) + '" y="' + (cy + 15) + '" text-anchor="' + anchor + '">Top ' + r + ": " + Math.round(row.cumulative * 100) + "%</text>";
    }).join("");
    return '<svg class="ch ch-pareto" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H +
      '" role="img" aria-label="' + esc(o.label || "Share of value held by your top cards") + '">' + grid +
      '<text class="ch-tick" x="' + L + '" y="' + (H - 7) + '">#1</text>' +
      '<text class="ch-tick" x="' + (W - R) + '" y="' + (H - 7) + '" text-anchor="end">#' + n + "</text>" +
      '<path class="ch-fill ch-fill-flat" d="' + area + '"/><path class="ch-line" pathLength="1" d="' + line + '"/>' + marks + "</svg>";
  }

  // ---- scatter --------------------------------------------------------------
  // points: [{id, x, y, r?, cls?, label}] ; o.xLog for value axes.
  function scatterChart(points, o) {
    o = o || {};
    var W = Math.max(160, Math.round(o.w || 600)), H = Math.round(o.h || 240);
    var L = 30, R = 12, T = 18, B = 28;
    var ps = (points || []).filter(function (p) { return fin(p.x) && fin(p.y); });
    if (ps.length < 2) return "";
    var tx = function (v) { return o.xLog ? Math.log(Math.max(v, 1)) : v; };
    var xs = ps.map(function (p) { return tx(p.x); });
    var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
    if (hi === lo) { hi += 1; lo -= 1; }
    var ylo = o.yMin == null ? 0 : o.yMin, yhi = o.yMax == null ? 100 : o.yMax;
    var X = function (v) { return L + (W - L - R) * (tx(v) - lo) / (hi - lo); };
    var Y = function (v) { return T + (H - T - B) * (1 - (v - ylo) / (yhi - ylo)); };
    var midX = fix(L + (W - L - R) / 2), midY = fix(Y((ylo + yhi) / 2));
    var dots = ps.map(function (p) {
      var cx = fix(X(p.x)), cy = fix(Y(p.y)), r = p.r || 5;
      return '<g class="sc-pt ' + esc(p.cls || "") + '" data-id="' + esc(p.id) + '" tabindex="0" role="button" aria-label="' + esc(p.label || "") + '">' +
        '<circle class="sc-hit" cx="' + cx + '" cy="' + cy + '" r="' + Math.max(12, r + 6) + '"/>' +
        '<circle class="sc-dot" cx="' + cx + '" cy="' + cy + '" r="' + r + '"/></g>';
    }).join("");
    return '<svg class="ch ch-scatter" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H +
      '" role="img" aria-label="' + esc(o.label || "Scatter chart") + '">' +
      '<rect class="sc-zone" x="' + midX + '" y="' + T + '" width="' + fix(W - R - midX) + '" height="' + fix(midY - T) + '"/>' +
      '<line class="ch-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + midY + '" y2="' + midY + '"/>' +
      '<line class="ch-grid" x1="' + midX + '" x2="' + midX + '" y1="' + T + '" y2="' + (H - B) + '"/>' +
      '<line class="ch-axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>' +
      '<text class="ch-tick" x="' + L + '" y="' + (H - 8) + '">' + esc(o.xLowLabel || "Lower value") + "</text>" +
      '<text class="ch-tick" x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">' + esc(o.xHighLabel || "Higher value") + "</text>" +
      '<text class="ch-note" x="' + fix(midX + 8) + '" y="' + (T + 15) + '">' + esc(o.zoneLabel || "") + "</text>" +
      dots + "</svg>";
  }

  // ---- HTML bar forms ---------------------------------------------------------
  // rows: [{label, value, note?, valueText?, id?}] ; one hue, length = value.
  function barList(rows, o) {
    o = o || {};
    var list = (rows || []).filter(function (r) { return fin(r.value); });
    if (!list.length) return '<p class="ch-empty">' + esc(o.empty || "Nothing to chart yet.") + "</p>";
    var max = Math.max.apply(null, list.map(function (r) { return Math.abs(r.value); }).concat([o.max || 0])) || 1;
    return '<div class="bars' + (o.cls ? " " + esc(o.cls) : "") + '" role="list">' + list.map(function (r) {
      var w = Math.max(r.value > 0 ? 1.5 : 0, Math.abs(r.value) / max * 100);
      var tone = r.tone ? " " + esc(r.tone) : "";
      return '<div class="bar-row' + tone + '" role="listitem"' + (r.id ? ' data-id="' + esc(r.id) + '"' : "") + '>' +
        '<span class="bar-label">' + esc(r.label) + (r.note ? "<small>" + esc(r.note) + "</small>" : "") + "</span>" +
        '<span class="bar-track"><i style="width:' + w.toFixed(1) + '%"></i></span>' +
        '<b class="bar-value">' + esc(r.valueText || money0(r.value)) + (r.sub ? "<small>" + esc(r.sub) + "</small>" : "") + "</b></div>";
    }).join("") + "</div>";
  }

  // segments: [{key, label, value, cls}] -> one horizontal stack + legend.
  function stackedBar(segments, o) {
    o = o || {};
    var segs = (segments || []).filter(function (s) { return fin(s.value) && s.value > 0; });
    var total = segs.reduce(function (n, s) { return n + s.value; }, 0);
    if (!total) return '<p class="ch-empty">' + esc(o.empty || "Nothing to chart yet.") + "</p>";
    var fmt = o.fmt || money0;
    var bar = '<div class="stack" role="img" aria-label="' + esc(o.label || "Share of total") + '">' + segs.map(function (s) {
      var share = s.value / total * 100;
      return '<span class="stack-seg ' + esc(s.cls || "") + '" style="flex-grow:' + share.toFixed(3) + '" title="' + esc(s.label + ": " + fmt(s.value) + " (" + Math.round(share) + "%)") + '"></span>';
    }).join("") + "</div>";
    var legend = '<div class="stack-legend">' + segs.map(function (s) {
      var share = s.value / total * 100;
      var tag = o.interactive ? "button" : "div";
      return "<" + tag + ' class="legend-item" data-key="' + esc(s.key || s.label) + '"' + (o.interactive ? ' type="button"' : "") + '>' +
        '<i class="swatch ' + esc(s.cls || "") + '"></i><span class="legend-label">' + esc(s.label) + "</span>" +
        '<b>' + esc(fmt(s.value)) + "</b><small>" + Math.round(share) + "%" + (s.count != null ? ", " + s.count + (s.count === 1 ? " card" : " cards") : "") + "</small></" + tag + ">";
    }).join("") + "</div>";
    return bar + legend;
  }

  // A single ratio against its limit: fill = part, track = same hue, lighter.
  function meter(part, whole, o) {
    o = o || {};
    var share = whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 0;
    return '<div class="meter' + (o.cls ? " " + esc(o.cls) : "") + '" role="meter" aria-valuemin="0" aria-valuemax="' + whole + '" aria-valuenow="' + part + '" aria-label="' + esc(o.label || "") + '">' +
      '<i style="width:' + (share * 100).toFixed(1) + '%"></i></div>';
  }

  return {
    esc: esc, money0: money0, compact: compact, pct: pct, day: day, shortDate: shortDate,
    ticks: ticks, areaChart: areaChart, nearest: nearest, sparkline: sparkline,
    treemapLayout: treemapLayout, cumulativeShare: cumulativeShare, paretoChart: paretoChart,
    scatterChart: scatterChart, barList: barList, stackedBar: stackedBar, meter: meter
  };
}));
