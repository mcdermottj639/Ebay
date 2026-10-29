const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../docs/charts.js');

test('ticks enclose the data with clean, evenly spaced values', () => {
  const t = C.ticks(2443, 2949, 3);
  assert.ok(t.lo <= 2443 && t.hi >= 2949, JSON.stringify(t));
  for (let i = 1; i < t.values.length; i++) assert.ok(Math.abs(t.values[i] - t.values[i - 1] - t.step) < 1e-6);
  const flat = C.ticks(100, 100, 3);
  assert.ok(flat.lo < 100 && flat.hi > 100);
});

test('compact money labels stay short and exact enough to read', () => {
  assert.equal(C.compact(950), '$950');
  assert.equal(C.compact(2700.39), '$2.7K');
  assert.equal(C.compact(12400), '$12K');
  assert.equal(C.compact(1250000), '$1.3M');
  assert.equal(C.money0(-82.4), '−$82');
});

test('treemap fills the rectangle exactly, in bounds, with no overlap', () => {
  const items = [900, 338, 232, 196.76, 152.49, 101, 96, 69, 53, 34, 25, 23.95, 21, 12, 9, 6.99, 3.51, 1.4].map((v, i) => ({ id: 'c' + i, value: v }));
  const W = 358, H = 260;
  const out = C.treemapLayout(items, 0, 0, W, H);
  assert.equal(out.length, items.length);
  const area = out.reduce((n, r) => n + r.w * r.h, 0);
  assert.ok(Math.abs(area - W * H) < 0.5, 'area ' + area);
  const total = items.reduce((n, i) => n + i.value, 0);
  for (const r of out) {
    assert.ok(r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= W + 1e-6 && r.y + r.h <= H + 1e-6, JSON.stringify(r));
    assert.ok(Math.abs(r.w * r.h - r.value / total * W * H) < 0.5, 'tile area proportional to value');
  }
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    const a = out[i], b = out[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    assert.ok(!(ox > 0.01 && oy > 0.01), 'overlap ' + a.id + ' ' + b.id);
  }
  assert.deepEqual(C.treemapLayout([{ id: 'x', value: 0 }], 0, 0, 10, 10), []);
});

test('cumulative share reaches 100% and ranks high to low', () => {
  const rows = C.cumulativeShare([10, 30, 60, 0, -5]);
  assert.deepEqual(rows.map(r => r.value), [60, 30, 10]);
  assert.equal(rows[0].share, 0.6);
  assert.ok(Math.abs(rows[2].cumulative - 1) < 1e-9);
});

test('area chart uses calendar time and keeps re-pricing days marked', () => {
  const r = C.areaChart([{ d: '2026-07-14', v: 2700 }, { d: '2026-07-15', v: 2724 }, { d: '2026-10-28', v: 2700, c: 1 }, { d: 'bad', v: 5 }], { w: 400, h: 200 });
  assert.equal(r.points.length, 3);
  assert.ok(r.points[0].x < r.points[1].x && r.points[1].x < r.points[2].x);
  // Jul 14 -> Jul 15 is one day of a 106-day span, so it must be a short step.
  assert.ok(r.points[1].x - r.points[0].x < 10);
  assert.match(r.svg, /ch-corr/);
  assert.equal(C.nearest(r.points, r.points[2].x - 1), 2);
  assert.equal(C.areaChart([{ d: '2026-07-14', v: 1 }], {}).svg, '');
});

test('sparkline direction follows first versus last point', () => {
  assert.match(C.sparkline([{ p: 1 }, { p: 3 }]), /sp-up/);
  assert.match(C.sparkline([{ p: 3 }, { p: 1 }]), /sp-down/);
  assert.match(C.sparkline([{ p: 3 }, { p: 3 }]), /sp-flat/);
  assert.equal(C.sparkline([{ p: 3 }]), '');
});

test('bar and stack markup escapes labels and keeps shares', () => {
  const html = C.barList([{ label: '<b>x</b>', value: 50 }, { label: 'y', value: 100 }]);
  assert.ok(!html.includes('<b>x</b>'));
  assert.match(html, /width:100\.0%/);
  const stack = C.stackedBar([{ label: 'A', value: 3, cls: 't1' }, { label: 'B', value: 1, cls: 't2' }]);
  assert.match(stack, /75%/);
  assert.match(stack, /25%/);
  assert.match(C.meter(2, 33), /width:6\.1%/);
});
