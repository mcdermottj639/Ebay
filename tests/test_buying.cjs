const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../docs/buying.js');
const now = Date.parse('2026-11-11T12:00:00Z');
function card(extra={}) { return {listing_id:'one',status:'qualified',grade_scope:'psa10',identity:{grader:'PSA',grade:10},checked_at:'2026-11-11T11:00:00Z',...extra}; }

test('expired, future and undated buys are demoted without mutating evidence',()=>{
  for(const checked_at of ['2026-11-08T11:00:00Z','2026-11-12T11:00:00Z','invalid']) {
    const c=card({checked_at}); assert.equal(B.rows([c],now)[0].status,'research'); assert.equal(c.status,'qualified');
  }
  assert.equal(B.rows([card({checked_at:'2026-11-09T12:00:00Z'})],now)[0].status,'qualified');
});
test('PSA 10 only, with fresh qualified exceptions preserved and stale exceptions hidden',()=>{
  assert.equal(B.rows([card({identity:{grader:'PSA',grade:9}})],now).length,0);
  const c=card({grade_scope:'exception',identity:{grader:'PSA',grade:9}});
  assert.equal(B.rows([c],now).length,1);
  assert.equal(B.rows([{...c,checked_at:'2026-11-01'}],now).length,0);
  for(const status of ['research','pass','excluded']) assert.equal(B.rows([{...c,status}],now).length,0);
});
test('cash and adjusted profit remain distinct; unknown amounts stay unknown',()=>{
  assert.deepEqual(B.metrics(card()),{ask:null,total:null,resale:null,cash:null,adjusted:null});
  assert.deepEqual(B.metrics(card({price:100,all_in:112,economics:{resale:200,cash_margin:45,adjusted_profit:-3}})),{ask:100,total:112,resale:200,cash:45,adjusted:-3});
  assert.equal(B.metrics(card({economics:{cash_margin:0,adjusted_profit:NaN}})).cash,0);
});
test('target association requires exact saved family query or label, not fuzzy player match',()=>{
  const t={label:'CJ Stroud Prizm PSA 10',query:'2023 Prizm CJ Stroud PSA 10'};
  assert.ok(B.forTarget({query:' 2023 PRIZM CJ Stroud PSA 10 '},t));
  assert.ok(!B.forTarget({query:'2023 Optic CJ Stroud PSA 10'},t));
});
test('tracked filter never promotes research and combined filters retain only matches',()=>{
  const rows=[card({status:'research',category:'rookies',item_title:'CJ Stroud Prizm'}),card({listing_id:'two',item_title:'CJ Stroud Optic',category:'inserts'})];
  const shown=B.select(rows,{status:'tracked',category:'rookies',q:'stroud prizm'},['one']);
  assert.equal(shown.length,1);assert.equal(shown[0].status,'research');
  assert.equal(B.select(rows,{status:'qualified'},['one']).length,1);
});
test('sorts use cash profit and put unknown numbers last',()=>{
  const rows=[card({listing_id:'unknown'}),card({listing_id:'loss',economics:{cash_margin:-10}}),card({listing_id:'gain',economics:{cash_margin:20}})];
  assert.deepEqual(B.select(rows,{status:'all',sort:'profit'}).map(B.key),['gain','loss','unknown']);
});
test('saved preferences recover safely and only HTTPS listing images render',()=>{
  assert.equal(B.prefs(null).status,'qualified');assert.equal(B.prefs({status:'buy',sort:'garbage'}).sort,'recent');
  assert.deepEqual(B.prefs({tracked:['one','one',null,3]}).tracked,['one']);
  assert.equal(B.image({image:'javascript:alert(1)'}),'');
  assert.equal(B.image({image:'https://i.ebayimg.com/card.jpg'}),'https://i.ebayimg.com/card.jpg');
});
