import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_web', ROOT / 'build_web.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class OwnerListingsTests(unittest.TestCase):
    def test_listing_asks_never_change_valuation_or_comp_history(self):
        cards = build.catalog.load()
        with patch.object(build, '_owner_listings', return_value={}):
            baseline = build.build_data(copy.deepcopy(cards))
        actual = build.build_data(copy.deepcopy(cards))
        self.assertEqual(actual['summary'], baseline['summary'])
        for before, after in zip(baseline['cards'], actual['cards']):
            after = dict(after)
            after['owner_listing'] = None
            self.assertEqual(before, after)
        by_sku = {c['sku']: c for c in actual['cards']}
        saved = json.loads((ROOT / 'data/owner_listings.json').read_text())
        ask = saved['listings']['CARD-0032']['asking_price']  # whatever the latest email says
        self.assertEqual(by_sku['CARD-0032']['owner_listing']['asking_price'], ask)
        self.assertNotEqual(float(by_sku['CARD-0032']['asking_price']), ask)

    def test_owner_sale_is_retired_and_not_inserted_as_comparison(self):
        data = build.build_data(build.catalog.load())
        c = next(c for c in data['cards'] if c['sku'] == 'CARD-0021')
        self.assertTrue(c['sold'])
        self.assertFalse(c['listed'])
        self.assertEqual(c['sold_price'], 100)
        self.assertEqual(float(c['cost']), 63.04)  # eBay purchase receipt (2026-11-02)
        self.assertEqual(c['sold_date'], '2026-10-27')
        self.assertFalse(any(float(s['p']) == 100 for s in c['my_sales']))
        self.assertIsNone(c['owner_listing']['net_profit'])

    def test_offer_events_carry_amount_and_timing_only(self):
        saved = json.loads((ROOT / 'data/owner_listings.json').read_text())
        offers = [e for r in saved['listings'].values() for e in r['events'] if e['type'] == 'offer_received']
        self.assertTrue(offers)
        for mode in ('buyer', 'price'):
            data = copy.deepcopy(saved)
            event = next(e for e in data['listings']['CARD-0029']['events'] if e['type'] == 'offer_received')
            if mode == 'buyer':
                event['buyer'] = 'someone'
            else:
                event['price'] = 0
            with tempfile.TemporaryDirectory() as td:
                Path(td, 'owner_listings.json').write_text(json.dumps(data))
                with patch.object(build, 'DATA', Path(td)):
                    with self.assertRaises(ValueError):
                        build._owner_listings()

    def test_duplicate_events_and_external_urls_fail_closed(self):
        saved = json.loads((ROOT / 'data/owner_listings.json').read_text())
        for mode in ('duplicate', 'url'):
            data = copy.deepcopy(saved)
            rec = data['listings']['CARD-0032']
            if mode == 'duplicate':
                rec['events'].append(rec['events'][0])
            else:
                rec['url'] = 'https://example.com/336866450901'
            with tempfile.TemporaryDirectory() as td:
                Path(td, 'owner_listings.json').write_text(json.dumps(data))
                with patch.object(build, 'DATA', Path(td)):
                    with self.assertRaises(ValueError):
                        build._owner_listings()


if __name__ == '__main__':
    unittest.main()
