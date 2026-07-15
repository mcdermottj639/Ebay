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

# Price band the owner wants to shop in: the more expensive, premium end.
# We pass this to the eBay search so both the listings AND the market
# reference stay inside the window (no cheap base cards muddying it), and we
# keep only deals whose asking price lands here.
MIN_PRICE = 100.0
MAX_PRICE = 1000.0

# Premium inserts the owner specifically hunts (Downtowns + Kabooms). These run
# well over $1000, and the owner says that's fine WHEN the savings are big — so
# we widen their band and keep the pricey ones only if the discount is meaty.
PREMIUM_TERMS = ("downtown", "kaboom")
PREMIUM_MAX_PRICE = 5000.0
PREMIUM_MIN_DISCOUNT = 25.0   # over $1000, only flag a real bargain

# Owner preference: surface football first, then everything else (baseball etc.).
SPORT_ORDER = {"football": 0}


def _is_premium(item) -> bool:
    """True for Downtown/Kaboom-style premium inserts (by label or query)."""
    hay = f"{item.label} {item.query}".lower()
    return any(term in hay for term in PREMIUM_TERMS)


def _keep(d) -> bool:
    """Is this deal believable and in the owner's price rules?"""
    if not (MIN_DISCOUNT <= d.discount_pct <= MAX_DISCOUNT):
        return False
    if d.price < MIN_PRICE:
        return False
    if d.price <= MAX_PRICE:
        return True
    # Above $1000: only Downtowns/Kabooms, and only with big savings.
    return bool(d.premium and d.price <= PREMIUM_MAX_PRICE
                and d.discount_pct >= PREMIUM_MIN_DISCOUNT)


def _curate(found):
    """Keep believable, in-band deals; football first, premium next, then best
    discount. Returns (kept, dropped)."""
    kept = [d for d in found if _keep(d)]
    # Sort: football (0) before other sports, Downtowns/Kabooms before base,
    # then biggest discount.
    kept.sort(key=lambda d: (SPORT_ORDER.get(d.sport, 1), 0 if d.premium else 1,
                             -d.discount_pct))
    return kept[:TOP_N], len(found) - len(kept[:TOP_N])


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

    # Downtowns/Kabooms can run past $1000 — the owner wants those too, so give
    # them a wider band and flag them premium.
    premium_n = 0
    for it in items:
        if _is_premium(it):
            it.premium = True
            it.price_max = PREMIUM_MAX_PRICE
            premium_n += 1

    band = f"${MIN_PRICE:.0f}–${MAX_PRICE:.0f}"
    if premium_n:
        band += f" (Downtowns/Kabooms up to ${PREMIUM_MAX_PRICE:.0f})"
    print(f"Scanning eBay for {len(items)} watchlist item(s) "
          f"({band}, football first)...\n")
    found = deals.scan(items, price_min=MIN_PRICE, price_max=MAX_PRICE)
    kept, dropped = _curate(found)

    payload = {
        "as_of": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "watch_count": len(items),
        "price_min": MIN_PRICE,     # the band we shopped in
        "price_max": MAX_PRICE,
        "scanned": len(found),      # total under-market listings eBay returned
        "shown": len(kept),         # believable deals we kept
        "deals": [asdict(d) for d in kept],
    }
    DATA.mkdir(exist_ok=True)
    SNAPSHOT.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    if not kept:
        print(f"Scanned {len(found)} under-market listing(s), but none in the believable "
              f"{MIN_DISCOUNT:.0f}–{MAX_DISCOUNT:.0f}% range and ${MIN_PRICE:.0f}–${MAX_PRICE:.0f} "
              f"band right now.")
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
