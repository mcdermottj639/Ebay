#!/usr/bin/env python3
"""Build a visual dashboard of your whole collection — one HTML page.

Reads your inventory.csv (plus anything already in output/) and writes
output/dashboard.html. Double-click that file to open it in your web browser.
No internet, no server, no login — it's your at-a-glance view of everything.

Run it with:   python3 dashboard.py
"""

import json
import sys
from html import escape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import catalog  # noqa: E402

OUTPUT = Path(__file__).parent / "output"


def _money(cards, field):
    total = 0.0
    for c in cards:
        val = getattr(c, field).replace("$", "").replace(",", "").strip()
        try:
            total += float(val)
        except ValueError:
            pass
    return total


def _listed_skus():
    """SKUs that were actually published (from a previous 'live' run)."""
    path = OUTPUT / "listing_results.json"
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return set()
    return {r.get("sku") for r in data if isinstance(r, dict) and not r.get("dry_run")}


def _load_deals():
    """Deals found by find_deals.py, if any."""
    path = OUTPUT / "deals.json"
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return []


def _deals_section():
    deals = _load_deals()
    if not deals:
        return ""
    rows = []
    for d in deals[:25]:
        snipe = '<span class="flag" style="background:#d1495b">SNIPE</span>' if d.get("snipe") else ""
        kind = "Auction" if d.get("buying_option") == "AUCTION" else "Buy It Now"
        disc = d.get("discount_pct", 0)
        rows.append(
            f"<tr>"
            f"<td><b>{escape(str(d.get('label','')))}</b> {snipe}</td>"
            f"<td>{escape(d.get('item_title','')[:60])}</td>"
            f"<td class='num'>${d.get('price',0):.2f}</td>"
            f"<td class='num muted'>${d.get('reference',0):.0f}</td>"
            f"<td class='num'><span class='status ok'>{disc:+.0f}%</span></td>"
            f"<td>{kind}</td>"
            f"<td><a href='{escape(d.get('url',''))}' target='_blank'>view</a></td>"
            f"</tr>"
        )
    return (
        "<section><h2>🎯 Buy Radar — deals under market</h2>"
        "<table><thead><tr><th>Watch</th><th>Listing</th><th class='num'>Price</th>"
        "<th class='num'>Market</th><th class='num'>Disc.</th><th>Type</th><th></th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table></section>"
    )


def _status(card, listed):
    if card.sku in listed:
        return ("Listed", "ok")
    if card.asking_price.strip():
        return ("Priced", "warn")
    return ("Needs price", "todo")


def build_html(cards):
    listed = _listed_skus()
    total_cost = _money(cards, "cost")
    total_value = _money(cards, "asking_price")
    profit = total_value - total_cost
    qty = sum(int(c.quantity) for c in cards if c.quantity.isdigit())

    by_sport = {}
    for c in cards:
        if c.sport:
            by_sport[c.sport] = by_sport.get(c.sport, 0) + 1
    sport_rows = "".join(
        f'<div class="bar"><span>{escape(s)}</span>'
        f'<div class="track"><div class="fill" style="width:{(n/len(cards)*100):.0f}%"></div></div>'
        f'<b>{n}</b></div>'
        for s, n in sorted(by_sport.items(), key=lambda x: -x[1])
    )

    rows = []
    for c in cards:
        label, cls = _status(c, listed)
        flags = " ".join(
            f'<span class="flag">{f}</span>'
            for f, on in [("RC", c.is_rookie()), ("AUTO", c.is_auto()),
                          (f"{c.grader} {c.grade}".strip(), c.is_graded())]
            if on and f.strip()
        )
        rows.append(
            f"<tr>"
            f"<td class='mono'>{escape(c.sku)}</td>"
            f"<td>{escape(c.year)} {escape(c.brand)} {escape(c.set)}</td>"
            f"<td><b>{escape(c.player)}</b> {flags}</td>"
            f"<td>{escape(c.sport)}</td>"
            f"<td class='num'>{escape(c.cost)}</td>"
            f"<td class='num'>{escape(c.asking_price)}</td>"
            f"<td><span class='status {cls}'>{label}</span></td>"
            f"</tr>"
        )

    priced = sum(1 for c in cards if c.asking_price.strip())
    return TEMPLATE.format(
        total_rows=len(cards),
        qty=qty,
        total_cost=f"${total_cost:,.2f}",
        total_value=f"${total_value:,.2f}",
        profit=f"${profit:,.2f}",
        profit_cls="ok" if profit >= 0 else "todo",
        priced=priced,
        listed=len(listed),
        sport_rows=sport_rows or "<p class='muted'>No sports recorded yet.</p>",
        deals_section=_deals_section(),
        table_rows="".join(rows) or "<tr><td colspan='7' class='muted'>No cards yet — add rows to data/inventory.csv.</td></tr>",
    )


TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My eBay Card Collection</title>
<style>
  :root {{ color-scheme: light dark; }}
  * {{ box-sizing: border-box; }}
  body {{ font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0;
    background: #f4f5f7; color: #1a1a2e; }}
  @media (prefers-color-scheme: dark) {{
    body {{ background: #14151a; color: #e8e8ea; }}
    .card, thead th, .bar .track {{ background: #1e2028 !important; }}
    tbody tr:hover td {{ background: #23252f !important; }}
    table {{ background: #1a1c22 !important; }}
  }}
  header {{ padding: 28px 24px 8px; }}
  h1 {{ margin: 0 0 4px; font-size: 22px; }}
  .muted {{ color: #8a8a99; font-size: 13px; }}
  .wrap {{ max-width: 1100px; margin: 0 auto; padding: 0 24px 40px; }}
  .tiles {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px,1fr));
    gap: 12px; margin: 16px 0 8px; }}
  .card {{ background: #fff; border-radius: 12px; padding: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08); }}
  .card .k {{ font-size: 12px; color: #8a8a99; text-transform: uppercase; letter-spacing: .04em; }}
  .card .v {{ font-size: 24px; font-weight: 700; margin-top: 4px; }}
  .ok {{ color: #1a9e5f; }} .todo {{ color: #d1495b; }} .warn {{ color: #c77d0a; }}
  section {{ margin-top: 24px; }}
  h2 {{ font-size: 15px; margin: 0 0 10px; }}
  .bar {{ display: grid; grid-template-columns: 110px 1fr 32px; align-items: center;
    gap: 10px; margin: 6px 0; font-size: 13px; }}
  .track {{ background: #e6e7eb; border-radius: 6px; height: 10px; overflow: hidden; }}
  .fill {{ background: #4361ee; height: 100%; }}
  table {{ width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px;
    overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); font-size: 13px; }}
  th, td {{ text-align: left; padding: 10px 12px; border-bottom: 1px solid rgba(128,128,128,.15); }}
  thead th {{ background: #eef0f4; font-size: 11px; text-transform: uppercase;
    letter-spacing: .04em; color: #6a6a7a; }}
  .num, .num.header {{ text-align: right; }}
  .mono {{ font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #8a8a99; }}
  .status {{ padding: 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 600; }}
  .status.ok {{ background: rgba(26,158,95,.15); color: #1a9e5f; }}
  .status.warn {{ background: rgba(199,125,10,.15); color: #c77d0a; }}
  .status.todo {{ background: rgba(209,73,91,.15); color: #d1495b; }}
  .flag {{ display: inline-block; background: #4361ee; color: #fff; font-size: 10px;
    font-weight: 700; padding: 1px 6px; border-radius: 4px; margin-left: 4px; }}
</style></head>
<body>
<header class="wrap">
  <h1>🃏 My eBay Card Collection</h1>
  <div class="muted">Snapshot of everything in your catalog. Re-run <b>python3 dashboard.py</b> to refresh.</div>
</header>
<div class="wrap">
  <div class="tiles">
    <div class="card"><div class="k">Unique cards</div><div class="v">{total_rows}</div></div>
    <div class="card"><div class="k">Physical cards</div><div class="v">{qty}</div></div>
    <div class="card"><div class="k">Total cost</div><div class="v">{total_cost}</div></div>
    <div class="card"><div class="k">Est. value</div><div class="v">{total_value}</div></div>
    <div class="card"><div class="k">Potential profit</div><div class="v {profit_cls}">{profit}</div></div>
    <div class="card"><div class="k">Priced / Listed</div><div class="v">{priced} / {listed}</div></div>
  </div>

  {deals_section}

  <section>
    <h2>By sport</h2>
    {sport_rows}
  </section>

  <section>
    <h2>All cards</h2>
    <table>
      <thead><tr>
        <th>SKU</th><th>Year / Set</th><th>Player</th><th>Sport</th>
        <th class="num">Cost</th><th class="num">Asking</th><th>Status</th>
      </tr></thead>
      <tbody>{table_rows}</tbody>
    </table>
  </section>
</div>
</body></html>"""


def main() -> int:
    try:
        cards = catalog.load()
    except FileNotFoundError as e:
        print(e)
        return 1
    OUTPUT.mkdir(exist_ok=True)
    out = OUTPUT / "dashboard.html"
    out.write_text(build_html(cards), encoding="utf-8")
    print(f"Dashboard built: {out}")
    print("Open it: double-click the file, or drag it into your web browser.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
