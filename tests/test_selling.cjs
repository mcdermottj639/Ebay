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
test('price ladder rows keep older valid sales as context but count only the 90-day window', () => {
  const c={...base,my_sales:[{d:'2024-10-27',p:100},{d:'2026-10-28',p:100},{d:'2026-02-30',p:100},{d:'2026-07-01',p:90},{d:'2026-10-20',p:12},{d:'2026-10-20',p:12}]};
  const rows=S.soldRows(c,'2026-10-27');
  assert.deepEqual(rows.map(r=>[r.d,r.p,r.recent]),[['2026-10-20',12,true],['2026-07-01',90,false]]);
  assert.equal(S.soldEvidence(c,'2026-10-27').count,rows.filter(r=>r.recent).length);
});

// Synthetic private-offer fixtures only: no owner offer, floor or buyer data.
const offerAssumptions={shipping:8,supplies:2,feeRate:13.25,orderFee:.4,promotion:2,buyerTax:8,feeThreshold:7500,feeRateAbove:2.35};
const sampleOffer={amount:50,currency:'USD',receivedAt:'2030-01-15T10:00:00-05:00',expiresAt:'2030-01-16T10:00:00-05:00',expiryNote:'',counterAmount:60,minimumNet:null,recommendation:'counter',rationale:'Review exact sold evidence before deciding.',basisNote:'Planning example, not a listing action.',assumptions:offerAssumptions};
const sampleEnvelope={format:'card-vault-offer-plan',schema:1,sku:'C1',offer:sampleOffer};
test('offer normalization keeps unknown amounts and assumptions distinct from explicit zero', () => {
 const empty=S.normalizeOffer({});
 assert.equal(empty.amount,null);assert.equal(empty.minimumNet,null);assert.equal(empty.acquisitionCost,null);
 assert.equal(empty.currency,'USD');assert.equal(empty.recommendation,'review');assert.equal(empty.expiresAt,'');
 assert.ok(Object.values(empty.assumptions).every(v=>v===null));
 const explicit=S.normalizeOffer({...sampleOffer,acquisitionCost:'0',minimumNet:0,assumptions:{...offerAssumptions,shipping:'0'}});
 assert.equal(explicit.acquisitionCost,0);assert.equal(explicit.minimumNet,0);assert.equal(explicit.assumptions.shipping,0);
 assert.equal(S.normalizeOffer({...sampleOffer,amount:'50.25'}).amount,50.25);
 assert.equal(S.normalizeOffer({...sampleOffer,amount:'.5'}).amount,.5);
 assert.equal(S.normalizeOffer({...sampleOffer,minimumNet:' '}).minimumNet,null);
});
test('invalid offer fields, numbers, currencies and private metadata are rejected', () => {
 for(const edit of [{amount:-1},{amount:0},{amount:Infinity},{amount:true},{amount:[]},{amount:'0x20'},{currency:'EUR'},{counterAmount:0},{minimumNet:-1},{acquisitionCost:-2},{recommendation:'send'},{rationale:'x'.repeat(2001)},{buyerId:'not-allowed'},{gmailId:'not-allowed'},{orderId:'not-allowed'},{assumptions:[]},{assumptions:{buyerTax:100}},{assumptions:{feeRateAbove:100}},{assumptions:{feeThreshold:0}},{assumptions:{extra:1}}]) assert.throws(()=>S.normalizeOffer({...sampleOffer,...edit}),JSON.stringify(edit));
 assert.throws(()=>S.normalizeOffer(JSON.parse('{"__proto__":{"polluted":true}}')),/unsupported field/);
 assert.throws(()=>S.normalizeOffer(Object.create({amount:10})),/must be an object/);
 assert.throws(()=>S.normalizeOffer({...sampleOffer,assumptions:JSON.parse('{"constructor":{}}')}),/unsupported field/);
 assert.equal({}.polluted,undefined);
});
test('offer time requires a valid explicit offset and never guesses a timezone', () => {
 for(const expiresAt of ['2030-01-16T10:00','2030-01-16','2030-02-30T10:00:00Z','2030-01-16T24:00:00Z','2030-01-16T10:00:00+14:01','2030-01-16T10:61:00Z','2030-01-16T10:00:00-00:00','tomorrow']) assert.throws(()=>S.normalizeOffer({...sampleOffer,expiresAt}),/explicit UTC offset/);
 assert.throws(()=>S.normalizeOffer({...sampleOffer,expiresAt:'2030-01-14T10:00:00-05:00'}),/before the received/);
 assert.equal(S.normalizeOffer({...sampleOffer,expiresAt:'2030-01-16T15:00:00Z'}).expiresAt,'2030-01-16T15:00:00Z');
 const unknown={...sampleOffer,expiresAt:'',expiryNote:'Jan 16 at 10 AM; timezone not confirmed'};
 assert.equal(S.offerDeadline(unknown).key,'unconfirmed');
 assert.equal(S.offerDeadline({...unknown,expiryNote:''}).key,'unknown');
 assert.equal(S.offerDeadline({...sampleOffer,expiresAt:'2030-01-16T10:00'}).key,'unconfirmed');
 assert.equal(S.offerDeadline(sampleOffer,'2030-01-16T14:59:59.999Z').key,'upcoming');
 assert.equal(S.offerDeadline(sampleOffer,'2030-01-16T15:00:00Z').key,'expired');
 assert.equal(S.offerDeadline(sampleOffer,'2030-01-16T10:00:00-05:00').at,Date.parse('2030-01-16T15:00:00Z'));
 assert.match(S.offerDeadline(sampleOffer,'2030-01-15T00:00:00Z').label,/UTC/);
});
test('offer scenario reuses lot quote without changing acquisition cost or inventory', () => {
 const card=Object.freeze({...base}), offer=Object.freeze({...sampleOffer,assumptions:Object.freeze({...offerAssumptions})});
 const expected=S.lotQuote([card],{...offerAssumptions,price:50}), actual=S.offerQuote(card,offer);
 assert.deepEqual(actual,{...expected,costSource:'recorded cost'});assert.equal(actual.profit,null);
 assert.equal(S.offerQuote(card,{...offer,acquisitionCost:10}).profit,21.44);
 assert.equal(S.offerQuote(card,{...offer,acquisitionCost:0}).profit,31.44);
 assert.equal(S.offerQuote(card,{...offer,acquisitionCost:10}).costSource,'offer scenario');
 assert.equal(card.cost,'');assert.equal(card.sold,false);assert.equal(card.listed,false);
 assert.equal(S.offerQuote({...base,cost:15},offer).profit,16.44);
 assert.equal(S.offerQuote({...base,cost:15},{...offer,acquisitionCost:10}).profit,21.44);
 for(const key of Object.keys(offerAssumptions)) assert.equal(S.offerQuote(card,{...offer,assumptions:{...offerAssumptions,[key]:null}}).proceeds,null,key);
 assert.equal(S.offerQuote(card,{...offer,amount:1}).proceeds,-9.56);
});
test('private offer JSON round-trips an exact card and does not touch its plan or ledger', () => {
 const card=Object.freeze({...base,owner_listing:Object.freeze({item_id:'LISTING-EXAMPLE'})});
 const original=JSON.stringify(card), normalized=S.normalizeOffer(sampleOffer);
 const exported=S.exportOfferExchange(card,sampleOffer);
 assert.equal(exported.format,'card-vault-offer-plan');assert.equal(exported.schema,1);assert.equal(exported.listingId,'LISTING-EXAMPLE');
 const parsed=S.parseOfferExchange(JSON.stringify(exported),[card]);
 assert.equal(parsed.card,card);assert.deepEqual(parsed.offer,normalized);assert.equal(JSON.stringify(card),original);
 assert.equal(S.parseOfferExchange(JSON.stringify(sampleEnvelope),[base]).card,base);
});
test('offer import rejects invalid, stale-identity, sold, unsupported and comparison payloads', () => {
 const card={...base,owner_listing:{item_id:'LISTING-EXAMPLE'}};
 for(const payload of [{...sampleEnvelope,schema:2},{...sampleEnvelope,format:'claudex-card-pricing',mode:'comparison_only'},{...sampleEnvelope,sku:'MISSING'},{...sampleEnvelope,listingId:'OTHER-LISTING'},{...sampleEnvelope,listingId:null},{...sampleEnvelope,buyerId:'not-allowed'},{...sampleEnvelope,offer:{...sampleOffer,amount:null}},{...sampleEnvelope,offer:{...sampleOffer,gmailId:'not-allowed'}},null,[]]) assert.throws(()=>S.parseOfferExchange(JSON.stringify(payload),[card]));
 assert.throws(()=>S.parseOfferExchange(JSON.stringify(sampleEnvelope),[{...card,sold:true}]),/recorded sold/);
 assert.throws(()=>S.parseOfferExchange(JSON.stringify(sampleEnvelope),[card,card]),/exactly one/);
 assert.throws(()=>S.parseOfferExchange('{bad',[card]),/not valid/);
 assert.throws(()=>S.parseOfferExchange(' '.repeat(20001),[card]),/20,000/);
 assert.throws(()=>S.parseOfferExchange('{"__proto__":{}}',[card]),/unsupported field/);
 assert.throws(()=>S.exportOfferExchange({...card,sold:true},sampleOffer),/recorded sold/);
 assert.throws(()=>S.exportOfferExchange(card,{}),/positive offer amount/);
});
test('saved offers protect lots and lead the review queue without recording a sale', () => {
 const plans={C1:{offer:sampleOffer,action:'hold'},DUE:{reviewDate:'2030-01-15'}};
 const cards=[base,{...base,sku:'DUE',asking_price:900,graded:true}];
 assert.equal(S.batchEligible(base,25,false,plans.C1),false);
 assert.equal(S.premium(cards,plans,25,'2030-01-15')[0].card.sku,'C1');
 assert.equal(S.planFor(base,plans.C1,'2030-01-15').key,'offer');
 assert.equal(S.planFor({...base,sold:true},plans.C1,'2030-01-15').key,'sold');
 assert.equal(S.planFor(base,plans.C1,'2030-01-17').label,'Offer deadline passed');
 assert.equal(S.results(cards).sold,0);assert.equal(S.results(cards).revenue,0);
});
