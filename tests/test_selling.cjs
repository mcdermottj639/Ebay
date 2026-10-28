const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../docs/selling.js');
const base = {sku:'C1',player:'Player One',year:'2025',sport:'Football',set:'Prizm',asking_price:'12',cost:'',sold:false,listed:false};
test('cheap purchase never sends an expensive, graded, rare, listed or sold card to a lot', () => {
  assert.equal(S.batchEligible(base,25),true);
  for(const edit of [{cost:'70'},{asking_price:'200',cost:'2'},{graded:true},{auto:true},{serial_run:'99'},{listed:'yes'},{listed:true},{sold:true},{is_merch:true},{asking_price:''},{asking_price:'-10'}]) assert.equal(S.batchEligible({...base,...edit},25),false,JSON.stringify(edit));
});
test('unknown acquisition costs never turn into zero-cost profit', () => {
  const form={price:50,shipping:8,supplies:2,feeRate:13.25,orderFee:.4,promotion:2,buyerTax:8,feeThreshold:7500,feeRateAbove:2.35};
  const q=S.lotQuote([base],form);
  assert.equal(q.profit,null); assert.equal(q.costCount,0); assert.equal(q.proceeds,31.44);
  assert.equal(S.lotQuote([{...base,cost:'10'}],form).profit,21.44);
  assert.equal(S.lotQuote([{...base,cost:'0'}],form).profit,31.44);
  assert.equal(S.lotQuote([base],{...form,price:''}).proceeds,null);
});
test('fee calculation applies the high-price tier and preserves negative proceeds', () => {
  const q=S.lotQuote([{...base,cost:100}],{price:8000,shipping:8,supplies:2,feeRate:13.25,orderFee:.4,promotion:0,buyerTax:0,feeThreshold:7500,feeRateAbove:2.35});
  assert.equal(q.fees,1005.90); assert.equal(q.profit,6884.10);
  const loss=S.lotQuote([base],{price:1,shipping:8,supplies:2,feeRate:13.25,orderFee:.4,promotion:0,buyerTax:0});
  assert.equal(loss.proceeds,-9.53);
});
test('sales evidence excludes future, invalid, stale, duplicate and pre-card dates', () => {
  const c={...base,my_sales:[{d:'2024-10-27',p:100},{d:'2026-10-28',p:100},{d:'2026-02-30',p:100},{d:'2026-07-01',p:100},{d:'2026-10-20',p:12},{d:'2026-10-20',p:12}]};
  assert.deepEqual(S.soldEvidence(c,'2026-10-27'),{count:1,newest:'2026-10-20',fresh:false});
  assert.equal(S.daysSince('2026-10-28','2026-10-27'),null);
});
test('listing age comes from listing events, never the rebuild or email refresh date', () => {
  assert.equal(S.listingAge({...base,listed:true,owner_listing:{confirmed_at:'2026-10-27'}},'2026-10-27'),null);
  assert.equal(S.listingAge({...base,owner_listing:{events:[{type:'listed',occurred_at:'2026-10-01T20:00:00-04:00'}]}},'2026-10-27'),26);
});
test('date-only records keep the correct calendar day in New York', () => {
  assert.equal(S.formatDate('2026-10-27','2026-10-27'),'Oct 27');
  assert.equal(S.formatDate('Oct 28, 2026 · 03:38 UTC','2026-10-27'),'Oct 27');
});
test('timing asks for evidence and respects explicit hold/review choices', () => {
  assert.equal(S.planFor(base,{},'2026-10-27').key,'research');
  assert.equal(S.planFor(base,{action:'hold',reviewDate:'2026-11-01'},'2026-10-27').key,'hold');
  assert.equal(S.planFor(base,{action:'hold',reviewDate:'2026-10-27'},'2026-10-27').key,'due');
  assert.equal(S.planFor({...base,asking_price:100},{target:90},'2026-10-27').label,'Check your target');
});
test('lots group related inventory without duplicate or protected inclusions', () => {
  const groups=S.groups([base,{...base,sku:'C2',player:'Player Two'},{...base,sku:'C3',graded:true},{...base,sku:'C4',sport:'Basketball'}],25);
  assert.equal(groups[0].cards.length,2); assert.equal(groups[0].value,24);
  assert.equal(groups.flatMap(g=>g.cards).length,3);
  assert.ok(S.lotTitle(Array(10).fill(base)).length<=80);
});
test('results keep gross and verified net separate, including actual losses', () => {
  assert.equal(S.results([{...base,sold:true,sold_price:50}]).gross,null);
  assert.equal(S.results([{...base,sold:true,sold_price:50,cost:10}]).gross,40);
  assert.equal(S.results([{...base,sold:true,sold_price:50,cost:10}]).net,null);
  assert.equal(S.results([{...base,sold:true,sold_price:50,cost:100,owner_listing:{net_profit:-62}}]).net,-62);
});

test('explicit special-card opt-in still protects valuable, listed and higher-cost items',()=>{
 assert.equal(S.batchEligible({...base,graded:true},25,true),true);
 assert.equal(S.batchEligible({...base,graded:true,cost:100},25,true),false);
 assert.equal(S.batchEligible({...base,graded:true,asking_price:100},25,true),false);
 assert.equal(S.batchEligible({...base,auto:true,listed:true},25,true),false);
});

test('an individual hold or target protects a cheap card from bulk selling',()=>{
 for(const plan of [{action:'hold'},{action:'list'},{target:100},{reviewDate:'2026-11-01'}])assert.equal(S.batchEligible(base,25,false,plan),false);
 assert.equal(S.batchEligible(base,25,false,{action:'review',target:'',reviewDate:''}),true);
});
test('due reviews outrank expensive cards and a new listing does not force an urgent sale',()=>{
 const cards=[{...base,sku:'HIGH',graded:true,asking_price:900,listed:true},{...base,sku:'DUE',graded:true,asking_price:30}];
 assert.equal(S.premium(cards,{DUE:{reviewDate:'2026-10-27'}},25,'2026-10-27')[0].card.sku,'DUE');
});
