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
    def test_recorded_label_costs_reach_only_sold_cards_and_need_a_source(self):
        import json, tempfile
        spec = importlib.util.spec_from_file_location("bw68", Path(__file__).resolve().parent.parent / "build_web.py")
        bw = importlib.util.module_from_spec(spec); spec.loader.exec_module(bw)
        costs = bw._sale_costs()
        self.assertEqual(costs["CARD-0021"]["label"], 7.08)
        data = json.loads((Path(__file__).resolve().parent.parent / "docs" / "data.json").read_text())
        by = {c["sku"]: c for c in data["cards"]}
        self.assertEqual(by["MERCH-0003"]["sale_costs"]["label"], 32.2)
        self.assertEqual(by["CARD-0026"]["sale_costs"]["label"], 7.08)
        self.assertIsNone(by["CARD-0033"]["sale_costs"])  # sold, no label email on file
        for c in data["cards"]:
            if not c["sold"]:
                self.assertIsNone(c.get("sale_costs"))
        with tempfile.TemporaryDirectory() as d:
            bad = Path(d) / "sale_costs.json"
            bad.write_text(json.dumps({"schema_version": 1, "sales": {"CARD-0001": {"label": 5}}}))
            with patch.object(bw, "DATA", Path(d)):
                with self.assertRaises(ValueError):
                    bw._sale_costs()
