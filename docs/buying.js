/* Read-only buying presentation helpers. The Python evaluator owns buy policy. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Buying = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var finite = function (n) { return typeof n === 'number' && isFinite(n); };
  var norm = function (s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); };
  function key(c) { return String(c.listing_id || c.url || ''); }
  function fresh(c, now) {
    var age = (now == null ? Date.now() : now) - Date.parse(c.checked_at || '');
    return isFinite(age) && age >= 0 && age <= 48 * 3600000;
  }
  function inScope(c) {
    var i = c.identity || {};
    return (c.grade_scope === 'exception' && c.status === 'qualified') || (c.grade_scope !== 'outside_focus' && String(i.grader).toUpperCase() === 'PSA' && String(i.grade) === '10');
  }
  function rows(candidates, now) {
    return (candidates || []).map(function (c) {
      if (c.status !== 'qualified' || fresh(c, now)) return c;
      return Object.assign({}, c, {status:'research', grade_scope:c.grade_scope === 'exception' ? 'outside_focus' : c.grade_scope,
        reasons:['Listing observation expired; recheck before acting'].concat(c.reasons || [])});
    }).filter(inScope);
  }
  // Search-family membership only. Never implies the card/parallel is verified.
  function forTarget(c, t) {
    return !!t && ((norm(t.query) && norm(c.query) === norm(t.query)) || (norm(t.label) && norm(c.label) === norm(t.label)));
  }
  function metrics(c) {
    var e = c.economics || {}, ev = c.evidence || {};
    return {ask: finite(c.price) ? c.price : null, total:finite(c.all_in) ? c.all_in : null,
      resale:finite(e.resale) ? e.resale : finite(ev.conservative_resale) ? ev.conservative_resale : null,
      cash:finite(e.cash_margin) ? e.cash_margin : null, adjusted:finite(e.adjusted_profit) ? e.adjusted_profit : null};
  }
  function image(c) { return /^https:\/\//i.test(c.image || '') ? c.image : ''; }
  function select(rows, filters, tracked, target) {
    filters = filters || {}; tracked = tracked || [];
    var q = norm(filters.q).split(' ').filter(Boolean);
    return rows.filter(function (c) {
      var s = filters.status || 'qualified';
      var status = s === 'all' || c.status === s || (s === 'tracked' && tracked.indexOf(key(c)) >= 0) || (s === 'rejected' && ['pass','excluded'].indexOf(c.status) >= 0);
      var hay = norm([c.label,c.item_title,c.query,c.listing_id,JSON.stringify(c.identity || {})].join(' '));
      return status && (!filters.category || filters.category === 'all' || c.category === filters.category) && (!target || forTarget(c,target)) && q.every(function (word) { return hay.indexOf(word) >= 0; });
    }).sort(function (a,b) {
      var field = filters.sort === 'profit' ? 'cash' : filters.sort === 'cost' ? 'total' : null;
      if (field) {
        var av=metrics(a)[field], bv=metrics(b)[field];
        if(av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
        if(av !== bv) return field === 'cash' ? bv-av : av-bv;
      }
      return (Date.parse(b.checked_at)||0)-(Date.parse(a.checked_at)||0) || key(a).localeCompare(key(b));
    });
  }
  function prefs(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var one = function (value, options, fallback) { return options.indexOf(value) >= 0 ? value : fallback; };
    var categories = ['all','rookies','autos','inserts','established','downtown_kaboom'];
    return {mode:one(raw.mode,['radar','targets'],'radar'),status:one(raw.status,['qualified','research','rejected','all','tracked'],'qualified'),
      category:one(raw.category,categories,'all'),q:typeof raw.q === 'string' ? raw.q.slice(0,160) : '',
      sort:one(raw.sort,['recent','profit','cost'],'recent'),targetQuery:typeof raw.targetQuery === 'string' ? raw.targetQuery.slice(0,500) : '',
      targetCategory:one(raw.targetCategory,categories,'all'),targetSport:one(raw.targetSport,['all','football','basketball','baseball'],'all'),
      targetSearch:typeof raw.targetSearch === 'string' ? raw.targetSearch.slice(0,160) : '',
      tracked:Array.isArray(raw.tracked) ? Array.from(new Set(raw.tracked.filter(function (x) { return typeof x === 'string' && x.length > 0 && x.length < 600; }))).slice(0,500) : []};
  }
  return {key:key,fresh:fresh,inScope:inScope,rows:rows,forTarget:forTarget,metrics:metrics,image:image,select:select,prefs:prefs};
});
