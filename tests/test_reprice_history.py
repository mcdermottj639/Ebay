"""A repriced amount and its source must travel together into history."""
import contextlib
import importlib.util
import io
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('reprice_history', ROOT / 'reprice.py')
reprice = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reprice)


class RepriceHistoryTests(unittest.TestCase):
    def test_applied_value_carries_new_basis_without_changing_held_values(self):
        cards = [SimpleNamespace(sku='TEST-UP', asking_price='100', price_basis='asking',
                                 player='Test', is_sold=lambda: False, is_merch=lambda: False),
                 SimpleNamespace(sku='TEST-HOLD', asking_price='100', price_basis='psa',
                                 player='Held', is_sold=lambda: False, is_merch=lambda: False)]
        result = SimpleNamespace(median=125, count=5, source='active',
                                 match_level='exact', sample_items=[])
        with patch.object(reprice.config, 'have_api_keys', return_value=True), \
                patch.object(reprice.catalog, 'load', return_value=cards), \
                patch.object(reprice.comps, 'sold_available', return_value=False), \
                patch.object(reprice.comps, 'get_comps', return_value=result), \
                patch.object(reprice, '_save_inventory') as save, \
                patch.object(reprice, '_append_history') as history, \
                patch.object(reprice.sys, 'argv', ['reprice.py']), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(reprice.main(), 0)
        save.assert_called_once_with({'TEST-UP': (110, 'est_sold')})
        applied, held = history.call_args.args[0]
        self.assertEqual((applied['price'], applied['basis'], applied['applied']),
                         ('110.00', 'est_sold', 'yes'))
        self.assertEqual((held['price'], held['basis'], held['applied']),
                         ('100.00', 'psa', 'no'))
