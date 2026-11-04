import copy
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_web_v64', ROOT / 'build_web.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class ChangeChipHonestyTests(unittest.TestCase):
    """A change chip answers "did the market move?" (v51). When a card's value
    comes from sold prices the owner recorded, price_history still tracks the
    older estimate, so the build must not hand the app a baseline from it."""

    def test_recorded_sale_values_never_carry_an_old_source_baseline(self):
        cards = build.catalog.load()
        plain = build.build_data(copy.deepcopy(cards))
        overlaid = {c['sku'] for c in plain['cards'] if c['est_price'] not in ('', None)}
        self.assertTrue(overlaid, 'expected at least one card valued from recorded sales')
        every_sku = {c.sku: {'prev': 1.0, 'since': '3d'} for c in cards}
        with patch.object(build, '_price_changes', return_value=every_sku):
            data = build.build_data(copy.deepcopy(cards))
        for c in data['cards']:
            if c['sku'] in overlaid:
                self.assertEqual(c['prev_price'], '', c['sku'])
            else:
                self.assertEqual(c['prev_price'], 1.0, c['sku'])

    def test_preview_inlines_the_v64_assets(self):
        for name in ('vault.css', 'selling.js', 'charts.js', 'app.js'):
            self.assertTrue((ROOT / 'docs' / name).exists(), name)
        self.assertFalse((ROOT / 'docs' / 'styles.css').exists())
        self.assertFalse((ROOT / 'docs' / 'workspace.css').exists())


if __name__ == '__main__':
    unittest.main()


class SaleCostsTests(unittest.TestCase):
    """Checks the rules, not today's numbers: every recorded label reaches its
    sold card unchanged and nothing else carries one. Adding a new label email
    to data/sale_costs.json must never require editing this test."""

    def test_recorded_label_costs_reach_only_sold_cards_and_need_a_source(self):
        import json, tempfile
        spec = importlib.util.spec_from_file_location("bw68", ROOT / "build_web.py")
        bw = importlib.util.module_from_spec(spec); spec.loader.exec_module(bw)
        costs = bw._sale_costs()
        self.assertTrue(costs, "expected at least one recorded sale cost")
        for sku, rec in costs.items():
            for key in ("label", "fees"):
                if key in rec:
                    self.assertGreaterEqual(rec[key], 0, sku)
                    self.assertTrue(rec[key + "_source"].strip(), sku)
        for path in (None, ROOT / "docs" / "data.json"):
            data = (bw.build_data(bw.catalog.load()) if path is None
                    else json.loads(path.read_text()))
            seen = set()
            for c in data["cards"]:
                if c["sold"] and c["sku"] in costs:
                    self.assertEqual(c["sale_costs"], costs[c["sku"]], c["sku"])
                    seen.add(c["sku"])
                else:
                    self.assertIsNone(c.get("sale_costs"), c["sku"])
            self.assertTrue(seen, "no recorded cost reached a sold card")
        with tempfile.TemporaryDirectory() as d:
            bad = Path(d) / "sale_costs.json"
            bad.write_text(json.dumps({"schema_version": 1, "sales": {"CARD-0001": {"label": 5}}}))
            with patch.object(bw, "DATA", Path(d)):
                with self.assertRaises(ValueError):
                    bw._sale_costs()
