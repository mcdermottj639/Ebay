#!/usr/bin/env python3
"""Search eBay for any card and rank the listings by value — like the Alt app.

Type a search and it pulls live eBay listings, compares each to the market
price, and rates them Great / Good / Fair / Over market. Writes a visual page
you open in your browser (output/search.html) plus output/search.csv.

Needs your eBay API keys (see docs/01-getting-ebay-api-keys.md).

Run it with:
    python3 search_deals.py "2024 donruss downtown"
    python3 search_deals.py "cj stroud optic pink" 55     (55 = your market estimate)
"""

import csv
import sys
from html import escape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import config, deals  # noqa: E402

OUTPUT = Path(__file__).parent / "output"

BARS = {3: "🟩🟩🟩", 2: "🟩🟩⬜", 1: "🟩⬜⬜", 0: "🟥⬜⬜"}


def main() -> int:
    args = [a for a in sys.argv[1:]]
    if not args:
        print('Type what to search, e.g.:  python3 search_deals.py "2024 donruss downtown"')
        return 1

    # Last arg is a market-price estimate if it's a number.
    fair_value = ""
    if len(args) > 1 and args[-1].replace(".", "").isdigit():
        fair_value = args.pop()
    query = " ".join(args)

    if not config.have_api_keys():
        print("Search needs eBay API keys set up first.")
        print(f"Missing: {', '.join(config.missing_keys())} in your .env file.")
        print("See docs/01-getting-ebay-api-keys.md.")
        return 1

    print(f'Searching eBay for: "{query}"...\n')
    data = deals.search(query, fair_value=fair_value)
    results = data["results"]
    if not results:
        print("No listings found. Try different search words.")
        return 0

    print(f'{data["count"]} items on eBay  |  market ≈ ${data["reference"]:.0f}\n')
    for r in results[:15]:
        print(f'  {BARS[r["bars"]]} {r["value_label"]:11}  ${r["price"]:>7.2f}  '
              f'{r["buying_option"]:11}  {r["item_title"][:55]}')

    OUTPUT.mkdir(exist_ok=True)
    _write_csv(results)
    page = _write_html(data)
    print(f'\nVisual results: {page}')
    print("Open it in your browser to see thumbnails, prices, and BUY links.")
    return 0


def _write_csv(results):
    with (OUTPUT / "search.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["value", "discount_pct", "price", "type", "title", "url"])
        for r in results:
            w.writerow([r["value_label"], r["discount_pct"], r["price"],
                        r["buying_option"], r["item_title"], r["url"]])


def _write_html(data) -> Path:
    cards = []
    for r in data["results"]:
        color = {3: "#1a9e5f", 2: "#5a9e1a", 1: "#c77d0a", 0: "#d1495b"}[r["bars"]]
        kind = "Auction" if r["buying_option"] == "AUCTION" else "Buy It Now"
        snipe = '<span class="snipe">ENDING SOON</span>' if r.get("snipe") else ""
        img = (f'<img src="{escape(r["image"])}" alt="">' if r.get("image")
               else '<div class="noimg">no image</div>')
        cards.append(f"""
        <a class="row" href="{escape(r['url'])}" target="_blank">
          <div class="thumb">{img}</div>
          <div class="mid">
            <div class="t">{escape(r['item_title'])}</div>
            <div class="meta">{kind} {snipe}</div>
          </div>
          <div class="right">
            <div class="price">${r['price']:.2f}</div>
            <div class="val" style="color:{color}">{r['value_label']} {r['discount_pct']:+.0f}%</div>
          </div>
        </a>""")

    return _save(data["query"], data["count"], data["reference"], "".join(cards))


def _save(query, count, reference, cards_html) -> Path:
    html = f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Search: {escape(query)}</title><style>
  :root {{ color-scheme: light dark; }}
  body {{ font-family:-apple-system,Segoe UI,Roboto,sans-serif; margin:0; background:#f4f5f7; color:#1a1a2e; }}
  @media (prefers-color-scheme: dark) {{ body {{ background:#14151a; color:#e8e8ea; }} .row {{ background:#1e2028 !important; }} }}
  header {{ padding:20px 16px; }}
  h1 {{ font-size:18px; margin:0; }} .sub {{ color:#8a8a99; font-size:13px; margin-top:4px; }}
  .list {{ max-width:820px; margin:0 auto; padding:0 12px 40px; }}
  .row {{ display:flex; gap:12px; align-items:center; background:#fff; border-radius:12px; padding:10px 14px;
    margin:8px 0; text-decoration:none; color:inherit; box-shadow:0 1px 3px rgba(0,0,0,.08); }}
  .thumb img,.noimg {{ width:64px; height:64px; object-fit:contain; border-radius:8px; background:#eee; }}
  .noimg {{ display:flex; align-items:center; justify-content:center; font-size:10px; color:#999; }}
  .mid {{ flex:1; min-width:0; }}
  .t {{ font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; display:-webkit-box;
    -webkit-line-clamp:2; -webkit-box-orient:vertical; }}
  .meta {{ font-size:12px; color:#8a8a99; margin-top:2px; }}
  .snipe {{ background:#d1495b; color:#fff; font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px; }}
  .right {{ text-align:right; white-space:nowrap; }}
  .price {{ font-size:16px; font-weight:700; }}
  .val {{ font-size:12px; font-weight:700; margin-top:2px; }}
</style></head><body>
<header class="list"><h1>🔎 {escape(query)}</h1>
<div class="sub">{count} items on eBay &nbsp;•&nbsp; market ≈ ${reference:.0f} &nbsp;•&nbsp; ranked best value first</div></header>
<div class="list">{cards_html}</div>
</body></html>"""
    path = OUTPUT / "search.html"
    path.write_text(html, encoding="utf-8")
    return path


if __name__ == "__main__":
    raise SystemExit(main())
