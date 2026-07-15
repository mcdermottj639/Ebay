#!/usr/bin/env python3
"""Buy Radar snapshot — scan eBay for watchlist deals and save them for the app.

This is the app-facing sibling of find_deals.py. It scans eBay's active
listings for the cards on your watchlist (data/watchlist.csv), keeps the ones
priced under market, rates each Great / Good / Fair, and writes the results to
data/radar_snapshot.json. That file is committed, so build_web.py bakes it into
the app and the 🔎 Buy Radar tab shows the latest deals — no live server needed.

A scheduled Routine runs this every morning, rebuilds, and ships to main, so the
tab refreshes itself. You can also run it by hand any time:

    python3 radar.py

Needs your eBay API keys (same ones as pricing — see docs/01-getting-ebay-api-keys.md).
"""

import json
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import config, deals  # noqa: E402

DATA = Path(__file__).parent / "data"
SNAPSHOT = DATA / "radar_snapshot.json"

# Curation: watchlist queries are broad, so the "market" median gets dragged up
# by premium parallels/autos in the same search — which makes cheap base cards
# look like 90%+ "steals" that aren't real. We keep only believable discounts
# and cap the list, so the tab shows trustworthy deals, not a wall of noise.
# (An owner-set fair_value/alert_below on a watchlist row makes that item's
# deals reliable regardless — those are the sharpest ones.)
MIN_DISCOUNT = 15.0   # below this isn't worth flagging as a deal
MAX_DISCOUNT = 65.0   # above this the reference is almost certainly polluted
TOP_N = 24            # show the best two dozen


def _curate(found):
    """Drop implausible discounts, keep the best TOP_N. Returns (kept, dropped)."""
    believable = [d for d in found if MIN_DISCOUNT <= d.discount_pct <= MAX_DISCOUNT]
    believable.sort(key=lambda d: d.discount_pct, reverse=True)
    return believable[:TOP_N], len(found) - len(believable[:TOP_N])


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
    kept, dropped = _curate(found)

    payload = {
        "as_of": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "watch_count": len(items),
        "scanned": len(found),      # total under-market listings eBay returned
        "shown": len(kept),         # believable deals we kept
        "deals": [asdict(d) for d in kept],
    }
    DATA.mkdir(exist_ok=True)
    SNAPSHOT.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    if not kept:
        print(f"Scanned {len(found)} under-market listing(s), but none in the believable "
              f"{MIN_DISCOUNT:.0f}–{MAX_DISCOUNT:.0f}% range right now.")
        print(f"Saved an empty snapshot → {SNAPSHOT.name}. Run build_web.py to refresh the app.")
        return 0

    print(f"Kept {len(kept)} believable deal(s) (filtered out {dropped} as noise/over-market):\n")
    for d in kept:
        tag = "  SNIPE" if d.snipe else ""
        print(f"  [{d.discount_pct:+.0f}% vs ${d.reference:.0f}] ${d.price:.2f} {d.buying_option}{tag}")
        print(f"     {d.item_title[:70]}")
    print(f"\nSaved {len(kept)} deal(s) → {SNAPSHOT.name}. Now run: python3 build_web.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
