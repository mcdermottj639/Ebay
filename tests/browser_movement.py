"""Render and exercise the value-movement journey in an isolated browser.

Run: python tests/browser_movement.py
Requires Playwright + Chromium. Never writes catalog or marketplace data.
"""
import copy
import functools
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'artifacts' / 'movement'
ARTIFACTS.mkdir(parents=True, exist_ok=True)
checks = []


def check(condition, label):
    assert condition, label
    checks.append(label)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0),
                            functools.partial(QuietHandler, directory=str(ROOT / 'docs')))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}/'
real = json.loads((ROOT / 'docs/data.json').read_text())
fixture = copy.deepcopy(real)
template = copy.deepcopy(next(c for c in real['cards'] if not c['sold'] and not c['my_sales']))
fixture['cards'] = []
for sku, player, value, overlay, history in [
        ('UI-UP', 'Fixture Riser', 120, '', True),
        ('UI-DOWN', 'Fixture Faller', 80, '', True),
        ('UI-NEW', 'Fixture New Card', 50, '', False),
        ('UI-SOURCE', 'Fixture New Source', 400, '100', True)]:
    c = copy.deepcopy(template)
    c.update(sku=sku, player=player, asking_price=str(value), est_price=overlay,
             price_basis='est_sold', reviewed_price=False, sold=False, listed=False,
             my_sales=[], owner_listing=None, image='', cost='100',
             price_series=[{'d': d, 'p': 100 if d != '2026-11-07' or overlay else value,
                            'b': 'est_sold', 'applied': d == '2026-11-07'}
                           for d in ['2026-10-03', '2026-10-10', '2026-10-17',
                                     '2026-10-24', '2026-10-31', '2026-11-07']] if history else [])
    fixture['cards'].append(c)
fixture['summary'].update(total_cards=4, physical=4, sold=0, listed=0,
                          total_value=650, total_cost=400, revenue=0, realized_profit=0)


def overflow(page, label):
    check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), label)


try:
    with sync_playwright() as pw:
        kwargs = {'headless': True}
        if os.environ.get('CHROMIUM_PATH'):
            kwargs['executable_path'] = os.environ['CHROMIUM_PATH']
        browser = pw.chromium.launch(**kwargs)
        # Real catalog: screenshots and full-page layouts in both themes.
        for width, height, theme in [(320, 740, 'dark'), (390, 844, 'dark'),
                                     (390, 844, 'light'), (1280, 900, 'dark'),
                                     (1280, 900, 'light')]:
            page = browser.new_page(viewport={'width': width, 'height': height})
            errors = []
            page.on('pageerror', lambda err: errors.append(str(err)))
            page.add_init_script("localStorage.setItem('cv-theme-v64'," + json.dumps(theme) + ");")
            page.goto(base + '#tab=collection', wait_until='networkidle')
            check(page.locator('.value-overview').is_visible(), f'{width}/{theme}: overview renders')
            overflow(page, f'{width}/{theme}: Inventory fits')
            page.screenshot(path=str(ARTIFACTS / f'inventory-{width}-{theme}.png'), animations='disabled')
            if width == 390 and theme == 'dark':
                page.get_by_role('button', name='1W', exact=True).click()
                page.get_by_role('button', name='List', exact=True).click()
                page.get_by_label('Sort inventory').select_option('drop')
                page.locator('.inv-list').scroll_into_view_if_needed()
                page.screenshot(path=str(ARTIFACTS / 'inventory-weekly-list.png'), animations='disabled')
            for name in ['Today', 'Sell', 'Buy', 'Results', 'Inventory']:
                page.get_by_role('navigation').get_by_role('button', name=name, exact=True).click()
                overflow(page, f'{width}/{theme}: {name} fits')
            check(not errors, f'{width}/{theme}: no JavaScript errors: {errors}')
            page.close()

        # Deterministic behavior fixtures: known +20%, -20%, new/changed sources.
        page = browser.new_page(viewport={'width': 390, 'height': 844})
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.add_init_script('window.__CARD_DATA__=' + json.dumps(fixture) + ';' +
            "const RealDate=Date;window.Date=class extends RealDate{constructor(...a){super(...(a.length?a:['2026-11-14T02:00:00Z']));}static now(){return new RealDate('2026-11-14T02:00:00Z').getTime();}};" +
            "if(!localStorage.getItem('cv-selling-v1'))localStorage.setItem('cv-selling-v1',JSON.stringify({limit:25,plans:{},lots:[],preserve:'fixture'}));")
        page.goto(base + '#tab=collection', wait_until='networkidle')
        unchanged_store = page.evaluate("localStorage.getItem('cv-selling-v1')")
        page.get_by_role('button', name='1W', exact=True).click()
        check('+20.0%' in page.locator('.leader-card.up').inner_text(), 'weekly riser is +20%')
        check('−20.0%' in page.locator('.leader-card.down').inner_text(), 'weekly faller is -20%')
        check('Oct 31–Nov 7' in page.locator('.movement-coverage').inner_text(), 'weekly actual dates visible')
        page.get_by_role('button', name='Show Rising inventory', exact=True).click()
        check(page.locator('.inv-grid .slab-tile').count() == 1, 'Rising filter keeps only rising card')
        page.locator('.inv-grid [data-sku="UI-UP"]').click()
        check(page.locator('#modal .detail-title').inner_text() == 'Fixture Riser', 'exact card opens')
        check('+20.0%' in page.locator('.card-movement-value').inner_text(), 'detail shares selected week')
        page.locator('.card-movement [data-period="1M"]').click()
        check(page.locator('.card-movement [data-period="1M"]').get_attribute('aria-pressed') == 'true', 'detail month selected')
        page.get_by_role('button', name='Close card details', exact=True).click()
        page.locator('.modal-wrap.open').wait_for(state='hidden')
        check(page.locator('#view [data-period="1M"]').get_attribute('aria-pressed') == 'true', 'Close updates background period')
        check(page.locator('.inv-grid .slab-tile').count() == 1, 'Close retains movement filter')
        page.reload(wait_until='networkidle')
        check(page.locator('#view [data-period="1M"]').get_attribute('aria-pressed') == 'true', 'period survives reload')
        check(page.locator('.inv-grid .slab-tile').count() == 1, 'movement filter survives reload')
        page.get_by_role('button', name='Show All inventory', exact=True).click()
        page.get_by_role('button', name='List', exact=True).click()
        page.get_by_label('Sort inventory').select_option('gain')
        check(page.locator('.inv-list .card-row').first.get_attribute('data-sku') == 'UI-UP', 'gain sort puts unavailable last')
        page.get_by_label('Sort inventory').select_option('drop')
        check(page.locator('.inv-list .card-row').first.get_attribute('data-sku') == 'UI-DOWN', 'fall sort puts unavailable last')
        page.get_by_label('Search inventory').fill('Fixture New Source')
        check(page.locator('.inv-list .card-row').count() == 1, 'search filters exact card')
        check('New price source' in page.locator('.inv-list').inner_text(), 'source change is not a return')
        page.get_by_label('Search inventory').fill('no-match')
        page.get_by_role('button', name='Clear filters', exact=True).click()
        check(page.locator('.inv-list .card-row').count() == 4, 'clear restores all holdings')
        page.get_by_role('button', name='1Y', exact=True).click()
        check(page.locator('.movement-result strong').inner_text() == '—', 'insufficient year never becomes zero')
        check(page.locator('.inv-list .value-trend.unavailable').count() == 4, 'each missing year is explicit')
        page.get_by_role('button', name='1W', exact=True).click()
        page.locator('.inv-list [data-sku="UI-UP"]').click()
        page.reload(wait_until='networkidle')
        check(page.locator('#modal .detail-title').inner_text() == 'Fixture Riser', 'card deep link survives refresh')
        page.get_by_role('button', name='Close card details', exact=True).click()
        page.locator('.modal-wrap.open').wait_for(state='hidden')
        check(page.locator('.inventory').is_visible(), 'refreshed card returns to Inventory')
        check(page.evaluate("localStorage.getItem('cv-selling-v1')") == unchanged_store, 'owner plans untouched')
        check(not errors, f'fixture no JavaScript errors: {errors}')
        page.close()
        browser.close()
finally:
    server.shutdown()
    (ARTIFACTS / 'checks.json').write_text(json.dumps(checks, indent=2))

print(json.dumps({'passed': len(checks), 'screenshots': len(list(ARTIFACTS.glob('*.png')))}, indent=2))
