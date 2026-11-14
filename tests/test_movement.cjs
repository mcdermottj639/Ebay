const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../docs/movement.js');

function item(price, points, extra = {}) {
  return {sku: 'CARD-TEST', asking_price: price, price_basis: 'est_sold', est_price: '', price_series: points, ...extra};
}
function pt(d, p, extra = {}) { return {d, p, b: 'est_sold', ...extra}; }
const NOW = '2026-11-14';

test('weekly returns end at the last observation and expose actual dates and source', () => {
  const r = M.card(item(120, [pt('2026-10-31', 100), pt('2026-11-07', 120)]), '1W', NOW);
  assert.equal(r.status, 'ok'); assert.equal(r.pct, 20); assert.equal(r.delta, 20);
  assert.equal(r.asOf, '2026-11-07'); assert.equal(r.observedFrom, '2026-10-31');
  assert.equal(r.ageDays, 7); assert.equal(r.stale, false); assert.equal(r.direction, 'up');
  assert.equal(r.sourceLabel, 'Estimate from asking prices');
  assert.deepEqual(r.points.map(p => p.d), ['2026-10-31', '2026-11-07']);
});

test('stale history remains a historical return with an explicit age warning', () => {
  const r = M.card(item(80, [pt('2026-10-31', 100), pt('2026-11-07', 80)]), '1W', '2026-11-25');
  assert.equal(r.pct, -20); assert.equal(r.stale, true); assert.equal(r.ageDays, 18);
  assert.equal(r.direction, 'down'); assert.match(r.reason, /Historical/);
});

test('unknown, unpriced, sold, and owner-sold overlays never become zero returns', () => {
  const points = [pt('2026-10-31', 100), pt('2026-11-07', 120)];
  for (const c of [item('', points), item(120, []), item(120, points, {sold:true}), item(120, points, {est_price:100})]) {
    const r = M.card(c, '1W', NOW);
    assert.equal(r.available, false); assert.equal(r.pct, null); assert.equal(r.direction, 'unavailable');
  }
  assert.equal(M.card(item(120, points, {est_price:100}), '1W', NOW).points.length, 0);
});

test('current value and basis must match the dated endpoint', () => {
  const points = [pt('2026-10-31', 100), pt('2026-11-07', 120)];
  assert.equal(M.card(item(900, points), '1W', NOW).status, 'value_mismatch');
  assert.equal(M.card(item(120.02, points), '1W', NOW).available, false);
  assert.equal(M.card(item(120.03, points), '1W', NOW).available, false);
  assert.equal(M.card(item(120.000000001, points), '1W', NOW).available, true);
  assert.equal(M.card(item(120, points, {price_basis:'sold'}), '1W', NOW).status, 'source_changed');
});

test('missing endpoint basis cannot conceal an earlier source mismatch or unknown provenance', () => {
  const unknownEnd = [pt('2026-10-31', 100, {b:'asking'}), {d:'2026-11-07',p:1000}];
  const r = M.card(item(1000, unknownEnd, {price_basis:'sold'}), '1W', NOW);
  assert.equal(r.status, 'source_changed'); assert.equal(r.pct, null); assert.deepEqual(r.points, []);
  assert.equal(M.portfolio([item(1000, unknownEnd, {price_basis:'sold'})], '1W', NOW).eligible, 0);
  const unknown = [{d:'2026-10-31',p:100},{d:'2026-11-07',p:1000}];
  assert.equal(M.card(item(1000, unknown, {price_basis:'sold'}), '1W', NOW).available, false);
  const unknownCorrection = [pt('2026-10-31',100),{d:'2026-11-07',p:1000,c:1}];
  assert.equal(M.card(item(1000, unknownCorrection), 'ALL', NOW).available, false);
  const unknownBeginning = [{d:'2026-10-31',p:100},pt('2026-11-07',1000)];
  assert.equal(M.card(item(1000, unknownBeginning), '1W', NOW).available, false);
  const sameKnownSource = [pt('2026-10-31',100),{d:'2026-11-07',p:120}];
  assert.equal(M.card(item(120,sameKnownSource),'1W',NOW).pct,20);
});

test('a one-cent endpoint mismatch cannot reverse a low-dollar card return', () => {
  const points = [pt('2026-10-31',1),pt('2026-11-07',1.01)];
  const r = M.card(item(0.99,points),'1W',NOW);
  assert.equal(r.status,'value_mismatch');assert.equal(r.pct,null);assert.equal(r.direction,'unavailable');
  assert.equal(M.card(item(1,points),'1W',NOW).available,false);
  assert.equal(M.card(item(1.01,points),'1W',NOW).available,true);
  assert.equal(M.portfolio([item(0.99,points)],'1W',NOW).eligible,0);
});

test('correction and source changes reset history and cannot be counted as gains', () => {
  const points = [pt('2026-09-30', 100), pt('2026-10-31', 500, {c:1}), pt('2026-11-07', 550)];
  const monthly = M.card(item(550, points), '1M', NOW);
  assert.equal(monthly.status, 'rebased'); assert.equal(monthly.pct, null);
  assert.equal(monthly.points[0].p, 500);
  assert.equal(M.card(item(550, points), '1W', NOW).pct, 10);
  const all = M.card(item(550, points), 'ALL', NOW);
  assert.equal(all.pct, 10); assert.equal(all.resetDate, '2026-10-31');
  assert.equal(all.observedFrom, '2026-10-31');
  const changedBasis = points.map(p => ({...p, c:undefined, b:p.d < '2026-10-31' ? 'asking' : 'est_sold'}));
  assert.equal(M.card(item(550, changedBasis), '1M', NOW).status, 'rebased');
  assert.equal(M.card(item(550, changedBasis), 'ALL', NOW).pct, 10);
});

test('a correction-only endpoint is unavailable, never a flat move', () => {
  const r = M.card(item(30, [pt('2026-10-31',25),pt('2026-11-10',30,{c:1})]), 'ALL', NOW);
  assert.equal(r.status, 'rebased'); assert.equal(r.pct, null); assert.equal(r.points.length, 1);
});

test('weekly observations can supply a nearby period baseline but not a distant one', () => {
  const points = [pt('2026-10-03', 100), pt('2026-10-31', 115), pt('2026-11-07', 120)];
  const monthly = M.card(item(120, points), '1M', NOW);
  assert.equal(monthly.pct, 20); assert.equal(monthly.approximate, true);
  assert.equal(monthly.requestedStart, '2026-10-08'); assert.equal(monthly.baselineDate, '2026-10-03');
  const tooEarly = M.card(item(120, [pt('2026-09-20',100),pt('2026-11-07',120)]), '1M', NOW);
  assert.equal(tooEarly.available, false); assert.equal(tooEarly.pct, null);
  assert.equal(tooEarly.points.length, 2, 'available history remains for an explicitly longer preview');
});

test('normalization validates dates and values, excludes future rows, and preserves same-day corrections', () => {
  const raw = [pt('2026-11-07',120),pt('2026-10-31',100,{c:1}),pt('2026-10-31',105),
    pt('2026-02-30',40),pt('not-a-date',40),pt('2026-11-30',200),pt('2026-10-30',null),
    pt('2026-10-29',Infinity),pt('2026-10-28',-10),pt('2026-10-27',0)];
  const before = JSON.stringify(raw);
  assert.deepEqual(M.normalizeSeries(raw,NOW),[pt('2026-10-31',105,{c:1}),pt('2026-11-07',120)]);
  assert.equal(JSON.stringify(raw),before,'caller data is not mutated');
});

test('a UTC-stamped evening observation is valid before New York midnight', () => {
  const now = '2026-11-14T01:00:00Z'; // Nov 13, 8 p.m. in New York.
  const points = [pt('2026-11-07',100),pt('2026-11-14',120),pt('2026-11-15',999)];
  const r = M.card(item(120,points),'1W',now);
  assert.equal(r.available,true);assert.equal(r.pct,20);assert.equal(r.asOf,'2026-11-14');
  assert.equal(r.ageDays,0);assert.equal(r.stale,false);
  assert.deepEqual(r.points.map(p=>p.d),['2026-11-07','2026-11-14']);
  const p = M.portfolio([item(120,points)],'1W',now);
  assert.equal(p.available,true);assert.equal(p.asOf,'2026-11-14');assert.equal(p.pct,20);
  assert.equal(p.stale,false);
});

test('carried-forward values are identifiable and an observed flat line can be zero', () => {
  const r = M.card(item(100,[pt('2026-10-31',100),pt('2026-11-07',100,{applied:false})]),'1W',NOW);
  assert.equal(r.pct,0);assert.equal(r.direction,'flat');assert.equal(r.carriedForward,true);
  assert.equal(r.applied,false);
});

test('portfolio uses a fixed matched cohort with a value-weighted return, excluding new and sold cards', () => {
  const a = item(120,[pt('2026-10-31',100),pt('2026-11-07',120)],{sku:'a'});
  const b = item(270,[pt('2026-10-31',300),pt('2026-11-07',270)],{sku:'b'});
  const added = item(1000,[pt('2026-11-07',1000)],{sku:'new'});
  const sold = item(1000,[pt('2026-10-31',500),pt('2026-11-07',1000)],{sku:'sold',sold:true});
  const r=M.portfolio([a,b,added,sold],'1W',NOW);
  assert.equal(r.count,3);assert.equal(r.eligible,2);assert.equal(r.individualEligible,2);
  assert.equal(r.totalValue,1390);assert.equal(r.trackedValue,390);
  assert.equal(r.delta,-10);assert.equal(r.pct,-2.5);assert.equal(r.coverage,2/3);
  assert.deepEqual(r.points,[{d:'2026-10-31',v:400},{d:'2026-11-07',v:390}]);
  assert.equal(r.risers[0].card.sku,'a');assert.equal(r.fallers[0].card.sku,'b');
  assert.equal(r.unavailable[0].card.sku,'new');
});

test('portfolio selects a shared modal endpoint and does not interpolate unmatched dates', () => {
  const a=item(120,[pt('2026-10-31',100),pt('2026-11-07',120)],{sku:'a'});
  const b=item(80,[pt('2026-10-31',100),pt('2026-11-07',80)],{sku:'b'});
  const later=item(500,[pt('2026-11-03',300),pt('2026-11-10',500)],{sku:'later'});
  const r=M.portfolio([a,b,later],'1W',NOW);
  assert.equal(r.asOf,'2026-11-07');assert.equal(r.eligible,2);assert.equal(r.pct,0);
  assert.equal(r.risers.length,2,'individual mover cards retain their own explicit as-of dates');
  const mismatch=item(80,[pt('2026-10-30',100),pt('2026-11-07',80)],{sku:'different-date'});
  const bad=M.portfolio([a,mismatch],'1W',NOW);
  assert.equal(bad.available,false);assert.equal(bad.pct,null);assert.deepEqual(bad.points,[]);
});

test('period defaults to month and the one-year period cannot pretend short history is a year', () => {
  const c=item(120,[pt('2026-10-03',100),pt('2026-10-31',110),pt('2026-11-07',120)]);
  assert.equal(M.card(c,undefined,NOW).period,'1M');
  assert.equal(M.card(c,'1Y',NOW).pct,null);
  assert.equal(M.card(c,'ALL',NOW).pct,20);
  assert.deepEqual(M.periods.map(p=>p.key),['1W','1M','3M','1Y','ALL']);
});
