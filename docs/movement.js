/* Card Vault saved-value movement. No live quotes, synthetic observations,
   owner transactions, or source corrections are treated as market returns. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CardVaultMovement = factory();
}(typeof window === 'undefined' ? this : window, function () {
  'use strict';

  var DAY = 86400000;
  var BASELINE_TOLERANCE = 8;
  var FRESH_DAYS = 8;
  var PERIODS = [
    { key: '1W', label: '1W', days: 7 },
    { key: '1M', label: '1M', days: 30 },
    { key: '3M', label: '3M', days: 90 },
    { key: '1Y', label: '1Y', days: 365 },
    { key: 'ALL', label: 'All', days: null }
  ];
  var SOURCES = {
    sold: 'Recorded sold-based value',
    psa: 'PSA estimate',
    est_sold: 'Estimate from asking prices',
    asking: 'Asking or hand-set value'
  };

  function finite(n) { return typeof n === 'number' && isFinite(n); }
  function number(n) {
    if (typeof n === 'string') {
      if (!n.trim() || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(n.trim())) return null;
      n = Number(n);
    }
    return finite(n) ? n : null;
  }
  function positive(n) { n = number(n); return n !== null && n > 0 ? n : null; }
  function cents(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function date(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var t = Date.parse(s + 'T00:00:00Z');
    return finite(t) && new Date(t).toISOString().slice(0, 10) === s ? t : null;
  }
  function dateString(t) { return new Date(t).toISOString().slice(0, 10); }
  function nowDay(now) {
    var exact = date(now);
    if (exact !== null) return exact;
    var d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    if (!finite(d.getTime())) d = new Date();
    // Pricing dates are day-granular. Age warnings follow Jack's local day.
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(d), byType = {};
      parts.forEach(function (p) { byType[p.type] = p.value; });
      return date(byType.year + '-' + byType.month + '-' + byType.day);
    } catch (e) { return date(d.toISOString().slice(0, 10)); }
  }
  function producerDay(now) {
    var exact = date(now);
    if (exact !== null) return exact;
    var d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    if (!finite(d.getTime())) d = new Date();
    return date(d.toISOString().slice(0, 10));
  }
  function period(key) {
    return PERIODS.filter(function (p) { return p.key === String(key || '').toUpperCase(); })[0] || PERIODS[1];
  }
  function basis(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }

  function normalizeSeries(points, now) {
    // reprice.py stamps rows with a UTC date. In the New York evening, a
    // valid producer row can already be dated tomorrow on Jack's calendar.
    // Use the producer's day for future validation, local day only for age.
    var byDay = {}, today = producerDay(now);
    (Array.isArray(points) ? points : []).forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      var t = date(p.d), price = positive(p.p);
      if (t === null || t > today || price === null) return;
      var rounded = cents(price);
      if (!finite(rounded) || rounded <= 0) return;
      var previous = byDay[p.d], correction = !!p.c || !!(previous && previous.c);
      var row = { d: p.d, p: rounded };
      if (correction) row.c = 1;
      var b = basis(p.b || p.basis);
      if (b) row.b = b;
      if (p.applied === true || p.applied === 'yes') row.applied = true;
      else if (p.applied === false || p.applied === 'no') row.applied = false;
      byDay[p.d] = row;
    });
    return Object.keys(byDay).sort().map(function (d) { return byDay[d]; });
  }

  function analyze(c, key, now) {
    c = c || {};
    var p = period(key), b = basis(c.price_basis), ref = positive(c.asking_price);
    var result = {
      sku: c.sku || '', available: false, status: 'no_history', reason: '',
      period: p.key, periodLabel: p.label, pct: null, delta: null,
      direction: 'unavailable', points: [], baseline: null, current: ref,
      baselineDate: null, currentDate: null, startDate: null, endDate: null,
      asOf: null, observedFrom: null, observedTo: null, requestedStart: null,
      ageDays: null, stale: false, resetDate: null, basis: b,
      sourceLabel: SOURCES[b] || 'Saved value', approximate: false,
      applied: null, carriedForward: false
    };
    function unavailable(status, reason, series) {
      result.status = status; result.reason = reason;
      return { result: result, series: series || [] };
    }
    if (c.sold || c.status === 'sold') return unavailable('sold', 'Sold items are outside the held collection.');
    if (ref === null) return unavailable('unpriced', 'Add a saved value to start tracking.');
    if (c.est_price !== '' && c.est_price !== undefined && c.est_price !== null) {
      return unavailable('source_changed', 'The saved value uses sold comps; its older estimate history is a different source.');
    }

    var all = normalizeSeries(c.price_series, now);
    if (!all.length) return unavailable('no_history', 'No dated saved values yet.');
    var latest = all[all.length - 1], reset = 0, previousBasis = '';
    result.asOf = result.currentDate = result.endDate = result.observedTo = latest.d;
    result.ageDays = Math.max(0, Math.floor((nowDay(now) - date(latest.d)) / DAY));
    result.stale = result.ageDays > FRESH_DAYS;
    result.applied = latest.applied === undefined ? null : latest.applied;
    result.carriedForward = latest.applied === false;
    all.forEach(function (point, i) {
      // An omitted tag cannot erase the last known source. A correction is
      // different: its source must be established again before comparing.
      // Likewise, do not join untagged early history to the first known basis.
      if (point.c || (point.b && point.b !== previousBasis && i > 0)) {
        reset = i; result.resetDate = point.d;
      }
      if (point.c && !point.b) previousBasis = '';
      if (point.b) previousBasis = point.b;
    });
    var series = all.slice(reset);
    result.points = series.slice();
    result.observedFrom = result.startDate = series[0].d;
    if (cents(ref) !== latest.p) {
      result.points = [];
      return unavailable('value_mismatch', 'The current saved value has no matching dated observation.', []);
    }
    if (!b || !previousBasis || previousBasis !== b) {
      result.points = [];
      return unavailable('source_changed', !b || !previousBasis
        ? 'Pricing-source information is needed before these values can be compared.'
        : 'The current value and dated history use different pricing sources.', []);
    }
    var target = p.days === null ? date(series[0].d) : date(latest.d) - p.days * DAY;
    result.requestedStart = dateString(target);
    var candidates = series.filter(function (point) { return date(point.d) <= target; });
    var baseline = p.days === null ? series[0] : candidates[candidates.length - 1];
    if (!baseline || series.length < 2 || baseline.d === latest.d ||
        (p.days !== null && target - date(baseline.d) > BASELINE_TOLERANCE * DAY)) {
      var rebased = result.resetDate && date(result.resetDate) > target;
      if (series.length < 2 && result.resetDate) rebased = true;
      return unavailable(rebased ? 'rebased' : 'insufficient_history', rebased
        ? 'History restarted after a value or source correction on ' + result.resetDate + '.'
        : 'More dated values are needed for this period.', series);
    }
    result.points = series.filter(function (point) { return point.d >= baseline.d; });
    result.baseline = baseline.p;
    result.baselineDate = result.startDate = result.observedFrom = baseline.d;
    result.current = latest.p;
    result.delta = cents(latest.p - baseline.p);
    result.pct = (latest.p - baseline.p) / baseline.p * 100;
    result.approximate = date(baseline.d) !== target;
    result.direction = result.delta > 0 ? 'up' : result.delta < 0 ? 'down' : 'flat';
    result.available = true; result.status = 'ok';
    result.reason = result.stale ? 'Historical saved values; latest observation is ' + result.ageDays + ' days old.' : '';
    return { result: result, series: series };
  }

  function card(c, key, now) { return analyze(c, key, now).result; }

  function portfolio(cards, key, now) {
    var p = period(key);
    var held = (Array.isArray(cards) ? cards : []).filter(function (c) { return c && !c.sold && c.status !== 'sold'; });
    var analyzed = held.map(function (c) { return { card: c, data: analyze(c, p.key, now) }; });
    var rows = analyzed.map(function (r) { return { card: r.card, movement: r.data.result }; });
    var eligible = analyzed.filter(function (r) { return r.data.result.available; });
    var groups = {};
    eligible.forEach(function (r) { var d = r.data.result.asOf; (groups[d] || (groups[d] = [])).push(r); });
    var dates = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length || b.localeCompare(a); });
    var end = dates[0] || null, cohort = end ? groups[end] : [], common = [];
    if (cohort.length) {
      common = cohort[0].data.series.map(function (point) { return point.d; }).filter(function (d) {
        return cohort.every(function (r) { return r.data.series.some(function (point) { return point.d === d; }); });
      });
    }
    var cutoff = end && p.days !== null ? date(end) - p.days * DAY : null;
    var baselines = common.filter(function (d) { return cutoff === null || date(d) <= cutoff; });
    var start = p.days === null ? common[0] : baselines[baselines.length - 1];
    var valid = !!(end && start && start < end && (cutoff === null || cutoff - date(start) <= BASELINE_TOLERANCE * DAY));
    var points = valid ? common.filter(function (d) { return d >= start && d <= end; }).map(function (d) {
      return { d: d, v: cents(cohort.reduce(function (sum, r) {
        return sum + r.data.series.filter(function (point) { return point.d === d; })[0].p;
      }, 0)) };
    }) : [];
    // The denominator is the very same fixed cohort as the endpoint. Never
    // divide a total including newly added cards by an earlier, smaller vault.
    var baselineValue = points.length ? points[0].v : null;
    var currentValue = points.length ? points[points.length - 1].v : null;
    var total = cents(held.reduce(function (sum, c) { return sum + (positive(c.asking_price) || 0); }, 0));
    var tracked = valid ? currentValue : 0;
    var rising = rows.filter(function (r) { return r.movement.direction === 'up'; }).sort(function (a, b) { return b.movement.pct - a.movement.pct; });
    var falling = rows.filter(function (r) { return r.movement.direction === 'down'; }).sort(function (a, b) { return a.movement.pct - b.movement.pct; });
    var flat = rows.filter(function (r) { return r.movement.direction === 'flat'; });
    var unavailable = rows.filter(function (r) { return !r.movement.available; });
    return {
      available: valid, status: valid ? 'ok' : 'insufficient_history',
      reason: valid ? '' : 'No common dated baseline for a comparable group yet.',
      period: p.key, periodLabel: p.label, count: held.length,
      eligible: valid ? cohort.length : 0, individualEligible: eligible.length,
      coverage: held.length && valid ? cohort.length / held.length : 0,
      valueCoverage: total && valid ? tracked / total : 0,
      totalValue: total, trackedValue: tracked, baselineValue: baselineValue,
      currentValue: currentValue, delta: valid ? cents(currentValue - baselineValue) : null,
      pct: valid ? (currentValue - baselineValue) / baselineValue * 100 : null,
      points: points, asOf: end, observedFrom: valid ? start : null, observedTo: end,
      startDate: valid ? start : null, endDate: end,
      approximate: valid && cutoff !== null ? date(start) !== cutoff : false,
      stale: !!end && nowDay(now) - date(end) > FRESH_DAYS * DAY,
      rows: rows, entries: rows, risers: rising, fallers: falling, flat: flat,
      unavailable: unavailable,
      cohort: valid ? cohort.map(function (r) { return { card: r.card, movement: r.data.result }; }) : []
    };
  }

  return {
    PERIODS: PERIODS, periods: PERIODS, card: card, portfolio: portfolio,
    normalizeSeries: normalizeSeries
  };
}));
