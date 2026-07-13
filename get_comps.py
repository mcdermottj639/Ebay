#!/usr/bin/env python3
"""Look up recent eBay prices for each card in your catalog.

Needs your eBay API keys in .env (see docs/01-getting-ebay-api-keys.md).
Writes output/comps.csv with a low/median/high price per card so you can set
smart asking prices.

Run it with:   python3 get_comps.py
"""

import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import catalog, comps, config  # noqa: E402

OUTPUT = Path(__file__).parent / "output"


def main() -> int:
    if not config.have_api_keys():
        print("You don't have eBay API keys set up yet.")
        print(f"Missing: {', '.join(config.missing_keys())} in your .env file.")
        print("See docs/01-getting-ebay-api-keys.md — takes about 15 minutes.")
        print("\n(Everything else works without keys: check_catalog.py and make_drafts.py.)")
        return 1

    try:
        cards = catalog.load()
    except FileNotFoundError as e:
        print(e)
        return 1

    OUTPUT.mkdir(exist_ok=True)
    rows = []
    if comps.sold_available():
        print("✓ Using REAL SOLD prices (Marketplace Insights).")
    else:
        print("Using ACTIVE/asking prices (Browse API). These run ABOVE actual")
        print("sold — real sold comps need Marketplace Insights access, which")
        print("eBay hasn't granted this app yet. Apply: https://developer.ebay.com/")
        print("api-docs/buy/marketplace-insights/overview.html")
    print(f"\nLooking up comps for {len(cards)} card(s) on eBay ({config.env()})...\n")
    for card in cards:
        try:
            result = comps.get_comps(card)
        except Exception as e:  # keep going even if one card errors
            print(f"  {card.sku}: error — {e}")
            continue
        print("  " + result.pretty().replace("\n", "\n  "))
        rows.append({
            "sku": card.sku,
            "query": result.query,
            "source": result.source,
            "count": result.count,
            "low": result.low or "",
            "median": result.median or "",
            "high": result.high or "",
        })

    with (OUTPUT / "comps.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["sku", "query", "source", "count", "low", "median", "high"]
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nSaved to output/comps.csv. Use the medians to fill 'asking_price' in your catalog.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
