import copy
import json
import sys
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from ebaytools.buy_radar import economics, evaluate, max_buy, requirements, sale_evidence, snapshot

class ProfitRadarTests(unittest.TestCase):
    def setUp(self):
        self.p = json.loads((ROOT / 'data/buy_policy.json').read_text())
        self.now = datetime(2026, 10, 28, 1, tzinfo=timezone.utc)
        ident = dict(year=2020, set='Prizm', player='Test player', number='1',
                     parallel='Silver', print_run='none', autograph=False,
                     relic=False, grader='PSA', grade=9)
        self.c = dict(label='test', listing_id='1', url='https://www.ebay.com/itm/1',
                      identity=ident, identity_reviewed=True, condition_reviewed=True,
                      price=100, shipping=5, currency='USD', seller_score=500,
                      seller_pct=100, buying_option='FIXED_PRICE', page_state='active',
                      checked_at=self.now.isoformat(), hold_days=60, sales=[])
        for i, price in enumerate([500, 520, 540]):
            self.c['sales'].append(dict(identity=ident.copy(), exact_match_reviewed=True,
                date=(self.now-timedelta(days=i+1)).isoformat(), price=price, currency='USD',
                price_type='sold', amount_confirmed=True, sale_id=str(i+10),
                url='https://www.ebay.com/itm/'+str(i+10), source_type='primary'))

    def test_fee_includes_tax_and_order_fee(self):
        r = economics(400, 200, 60, self.p)
        self.assertAlmostEqual(r['selling_fee'], 400*1.08*.1325+.4)
        self.assertAlmostEqual(r['promotion_reserve'], 400*1.08*.02)
        self.assertAlmostEqual(r['capital_allowance'], 200*.12*60/365)
        self.assertEqual(r['labor_allowance'],25)

    def test_cash_and_economic_profit_not_conflated(self):
        r=economics(400,200,60,self.p)
        self.assertAlmostEqual(r['adjusted_profit'], r['cash_margin']-r['contingency']-25-r['capital_allowance'])

    def test_tiers_have_explicit_boundaries(self):
        self.assertEqual(requirements(99.99,60,self.p),(50,.4))
        self.assertEqual(requirements(100,60,self.p),(100,.35))
        self.assertEqual(requirements(250,60,self.p),(175,.35))
        self.assertEqual(requirements(500,60,self.p),(300,.3))
        self.assertEqual(requirements(1000,60,self.p),(500,.3))

    def test_slow_hold_hurdle_and_capital(self):
        self.assertEqual(requirements(200,90,self.p)[0],150)
        self.assertAlmostEqual(requirements(200,90,self.p)[1],.45)
        self.assertLess(max_buy(400,90,self.p),max_buy(400,60,self.p))

    def test_maximum_is_conservative_at_every_tier(self):
        for resale in [50,200,400,600,1000,1700,3000,10000]:
            for days in [30,60,90,120]:
                cap=max_buy(resale,days,self.p)
                if cap:
                    self.assertTrue(economics(resale,cap,days,self.p)['passes'])
                self.assertFalse(economics(resale,cap+.01,days,self.p)['passes'])

    def test_qualified_requires_evidence_and_economics(self):
        r=evaluate(self.c,self.p,self.now)
        self.assertEqual(r['status'],'qualified')
        self.assertEqual(r['all_in'],112.35)
        self.assertEqual(r['evidence']['conservative_resale'],468)

    def test_unknown_shipping_never_free(self):
        self.c['shipping']=None
        r=evaluate(self.c,self.p,self.now)
        self.assertEqual(r['status'],'research');self.assertIsNone(r['all_in'])
        self.assertIsNone(r['max_offer'])

    def test_secondary_is_provisional(self):
        for s in self.c['sales']: s['source_type']='secondary'
        r=evaluate(self.c,self.p,self.now)
        self.assertEqual(r['status'],'research');self.assertEqual(r['evidence']['primary_count'],0)

    def test_active_asking_prices_not_sold(self):
        for s in self.c['sales']: s['price_type']='asking'
        r=evaluate(self.c,self.p,self.now)
        self.assertIsNone(r['economics']);self.assertIsNone(r['max_all_in'])

    def test_wrong_grade_and_parallel_rejected(self):
        self.c['sales'][0]['identity']['grade']=10
        self.c['sales'][1]['identity']['parallel']='Blue'
        r=evaluate(self.c,self.p,self.now)
        self.assertEqual(r['evidence']['count'],1);self.assertIsNone(r['max_all_in'])

    def test_ambiguous_best_offer_excluded(self):
        for s in self.c['sales']:s['amount_confirmed']=False
        self.assertEqual(sale_evidence(self.c,self.now,self.p)['count'],0)

    def test_duplicate_sales_do_not_inflate_confidence(self):
        self.c['sales']=[self.c['sales'][0]]*4
        self.assertEqual(sale_evidence(self.c,self.now,self.p)['count'],1)

    def test_expired_and_future_sales_excluded(self):
        self.c['sales'][0]['date']='2025-01-01'
        self.c['sales'][1]['date']='2027-01-01'
        self.assertEqual(sale_evidence(self.c,self.now,self.p)['count'],1)

    def test_stale_listing_never_qualifies(self):
        self.c['checked_at']='2026-10-01'
        self.assertNotEqual(evaluate(self.c,self.p,self.now)['status'],'qualified')

    def test_sold_and_auction_not_executable(self):
        self.c['page_state']='sold'
        self.assertEqual(evaluate(self.c,self.p,self.now)['status'],'excluded')
        self.c['page_state']='active';self.c['buying_option']='AUCTION'
        self.assertEqual(evaluate(self.c,self.p,self.now)['status'],'research')

    def test_missing_seller_or_condition_is_not_green(self):
        self.c['seller_score']=0
        self.assertEqual(evaluate(self.c,self.p,self.now)['status'],'research')
        self.c['seller_score']=500;self.c['condition_reviewed']=False
        self.assertEqual(evaluate(self.c,self.p,self.now)['status'],'research')

    def test_long_hold_stays_research(self):
        self.c['hold_days']=121
        self.assertNotEqual(evaluate(self.c,self.p,self.now)['status'],'qualified')

    def test_all_in_limit_requires_exception(self):
        self.c['price']=510
        for s in self.c['sales']:s['price']=2000
        self.assertEqual(evaluate(self.c,self.p,self.now)['status'],'research')

    def test_output_deduplicates_and_does_not_mutate_inputs(self):
        before=copy.deepcopy(self.c)
        r=snapshot([self.c,self.c],self.p,36,{},self.now)
        self.assertEqual(r['scanned'],1);self.assertEqual(self.c,before)

    def test_primary_sales_must_be_recent(self):
        for s in self.c['sales']:s['date']='2026-09-01'
        self.assertEqual(evaluate(self.c,self.p,self.now)['status'],'research')

    def test_secondary_cannot_refresh_stale_primary_sales(self):
        secondary=copy.deepcopy(self.c['sales'][0])
        secondary.update(sale_id='secondary-new',source_type='secondary')
        for s in self.c['sales']:s['date']='2026-09-01'
        self.c['sales'].append(secondary)
        self.assertEqual(evaluate(self.c,self.p,self.now)['status'],'research')

    def test_secondary_cannot_inflate_qualified_valuation(self):
        for i in range(10):
            secondary=copy.deepcopy(self.c['sales'][0])
            secondary.update(sale_id='secondary-'+str(i),source_type='secondary',price=10000)
            self.c['sales'].append(secondary)
        r=evaluate(self.c,self.p,self.now)
        self.assertEqual(r['evidence']['conservative_resale'],468)
        self.assertEqual(r['evidence']['valuation_basis'],'primary only')

if __name__=='__main__':unittest.main()
