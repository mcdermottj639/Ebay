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
                     relic=False, grader='PSA', grade=10)
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

    def test_hold_tiers_have_explicit_boundaries(self):
        self.assertEqual(requirements(300,30,self.p),(75,.25))
        self.assertEqual(requirements(300,31,self.p),(100,.30))
        self.assertEqual(requirements(300,90,self.p),(100,.30))
        self.assertEqual(requirements(300,91,self.p),(150,.35))
        self.assertEqual(requirements(300,120,self.p),(150,.35))

    def test_no_purchase_price_cliffs(self):
        for cost in [99.99,100,249.99,250,499.99,500,1000]:
            self.assertEqual(requirements(cost,90,self.p),(100,.3))

    def test_approved_example_passes_without_ignoring_costs(self):
        r=economics(450,200,90,self.p)
        self.assertAlmostEqual(r['adjusted_profit'],121.07,places=2)
        self.assertTrue(r['passes'])

    def test_dollar_and_roi_floors_both_required(self):
        cheap=economics(275,100,90,self.p)
        larger=economics(850,500,90,self.p)
        self.assertGreater(cheap['roi'],.3)
        self.assertFalse(cheap['passes'])
        self.assertGreater(larger['adjusted_profit'],100)
        self.assertFalse(larger['passes'])

    def test_short_hold_without_support_defaults_to_90(self):
        self.c['hold_days']=30
        r=evaluate(self.c,self.p,self.now)
        self.assertEqual(r['hold_days'],90)
        self.assertEqual(r['economics']['minimum_profit'],100)

    def test_short_hold_with_reviewed_sources_uses_approved_floor(self):
        self.c.update(hold_days=30,hold_reviewed=True,
                      hold_basis='Reviewed listing-to-sale observations',
                      hold_sources=['https://www.ebay.com/itm/10'])
        r=evaluate(self.c,self.p,self.now)
        self.assertEqual(r['hold_days'],30)
        self.assertEqual(r['economics']['minimum_profit'],75)

    def test_slow_hold_hurdle_and_capital(self):
        self.assertEqual(requirements(200,90,self.p)[0],100)
        self.assertAlmostEqual(requirements(200,90,self.p)[1],.30)
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
        self.c['sales'][0]['identity']['grade']=9
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
        self.assertEqual(max_buy(1000,121,self.p),0)

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

    def other_grade(self, grade=9, grader='PSA'):
        self.c['identity'].update(grade=grade,grader=grader)
        for sale in self.c['sales']:
            sale['identity'].update(grade=grade,grader=grader)
        self.c.update(hold_days=30,hold_reviewed=True,
                      hold_basis='Reviewed listing-to-sale observations',
                      hold_sources=['https://www.ebay.com/itm/10'])

    def test_psa10_is_normal_focus(self):
        result=evaluate(self.c,self.p,self.now)
        self.assertEqual(result['grade_scope'],'psa10')
        self.assertEqual(result['status'],'qualified')

    def test_other_grade_normal_profit_does_not_qualify(self):
        self.other_grade()
        result=evaluate(self.c,self.p,self.now)
        self.assertGreater(result['economics']['adjusted_profit'],100)
        self.assertEqual(result['economics']['minimum_profit'],300)
        self.assertEqual(result['economics']['minimum_roi'],.5)
        self.assertEqual(result['grade_scope'],'outside_focus')
        self.assertNotEqual(result['status'],'qualified')

    def test_other_grade_can_qualify_only_as_large_profit_exception(self):
        self.other_grade()
        for sale in self.c['sales']:sale['price']=800
        result=evaluate(self.c,self.p,self.now)
        self.assertGreaterEqual(result['economics']['adjusted_profit'],300)
        self.assertGreaterEqual(result['economics']['roi'],.5)
        self.assertEqual(result['grade_scope'],'exception')
        self.assertEqual(result['status'],'qualified')

    def test_other_grader_10_and_unknown_hold_are_not_psa10(self):
        self.other_grade(10,'SGC')
        for sale in self.c['sales']:sale['price']=800
        self.c['hold_reviewed']=False
        result=evaluate(self.c,self.p,self.now)
        self.assertEqual(result['hold_days'],90)
        self.assertEqual(result['grade_scope'],'outside_focus')
        self.assertEqual(result['max_all_in'],0)

    def test_other_grade_exception_still_requires_primary_sales(self):
        self.other_grade()
        for sale in self.c['sales']:
            sale.update(price=800,source_type='secondary')
        result=evaluate(self.c,self.p,self.now)
        self.assertTrue(result['economics']['passes'])
        self.assertEqual(result['grade_scope'],'outside_focus')
        self.assertNotEqual(result['status'],'qualified')

if __name__=='__main__':unittest.main()
