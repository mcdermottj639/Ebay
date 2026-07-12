#!/usr/bin/env python3
"""Buy Radar — scan eBay for underpriced cards on your watchlist.

Edit data/watchlist.csv with cards you want to buy, then run this. It finds
active listings priced below market and flags auctions ending soon. Results
show in your dashboard (run dashboard.py after) and in output/deals.csv.

Needs your eBay API keys (see docs/01-getting-ebay-api-keys.md).

Run it with:   python3 find_deals.py
"""

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import config, deals  # noqa: E402

OUTPUT = Path(__file__).parent / "output"


def main() -> int:
    items = deals.load_watchlist()
    if not items:
        print("Your watchlist is empty. Add cards you want to buy to data/watchlist.csv.")
        return 1

    if not config.have_api_keys():
        print("Buy Radar needs eBay API keys yet to be set up.")
        print(f"Missing: {', '.join(config.missing_keys())} in your .env file.")
        print("See docs/01-getting-ebay-api-keys.md.")
        return 1

    print(f"Scanning eBay for {len(items)} watchlist item(s)...\n")
    found = deals.scan(items)

    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT / "deals.json").write_text(json.dumps(deals.deals_to_dicts(found), indent=2))
    with (OUTPUT / "deals.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["label", "price", "reference", "discount_pct", "type", "snipe", "title", "url"])
        for d in found:
            w.writerow([d.label, d.price, d.reference, d.discount_pct,
                        d.buying_option, "YES" if d.snipe else "", d.item_title, d.url])

    if not found:
        print("No deals under your thresholds right now. Try again later — inventory turns over fast.")
        return 0

    print(f"Found {len(found)} deal(s):\n")
    for d in found:
        tag = "  SNIPE" if d.snipe else ""
        print(f"  [{d.discount_pct:+.0f}% vs ${d.reference:.0f}] ${d.price:.2f} {d.buying_option}{tag}")
        print(f"     {d.item_title[:70]}")
        print(f"     {d.url}")
    print("\nSaved to output/deals.csv. Run 'python3 dashboard.py' to see them on your dashboard.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
