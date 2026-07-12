#!/usr/bin/env python3
"""Create eBay listings from your catalog.

SAFE BY DEFAULT: this previews (dry run) what would be sent to eBay and does
NOT list anything. Only when you add the word "live" does it actually publish,
and even then only if your full account setup is in place.

Run a safe preview:   python3 create_listings.py
Actually go live:     python3 create_listings.py live
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import catalog, lister  # noqa: E402

OUTPUT = Path(__file__).parent / "output"


def main() -> int:
    go_live = len(sys.argv) > 1 and sys.argv[1].lower() == "live"

    try:
        cards = catalog.load()
    except FileNotFoundError as e:
        print(e)
        return 1

    # Only list cards that have a price set.
    ready = [c for c in cards if c.asking_price.strip()]
    skipped = [c for c in cards if not c.asking_price.strip()]

    if go_live:
        print("!! LIVE MODE — this will create real eBay listings. !!\n")
    else:
        print("PREVIEW MODE (dry run) — nothing will be listed.")
        print("Add the word 'live' to actually list:  python3 create_listings.py live\n")

    OUTPUT.mkdir(exist_ok=True)
    results = []
    for card in ready:
        try:
            res = lister.publish_card(card, dry_run=not go_live)
            state = "PUBLISHED" if not res.get("dry_run") else "would list"
            print(f"  {card.sku}: {state} @ ${card.asking_price}")
            results.append(res)
        except Exception as e:
            print(f"  {card.sku}: SKIPPED — {e}")

    (OUTPUT / "listing_results.json").open("w", encoding="utf-8").write(
        json.dumps(results, indent=2, default=str)
    )

    if skipped:
        print(f"\n{len(skipped)} card(s) skipped for having no asking_price. "
              "Run get_comps.py to price them.")
    print(f"\nDetails saved to output/listing_results.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
