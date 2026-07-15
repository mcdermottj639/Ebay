#!/usr/bin/env python3
"""Refresh your asking prices from live eBay comps — safely.

Made to run unattended (the weekly auto-reprice job) or by hand:

    python3 reprice.py            # apply safe updates
    python3 reprice.py --dry-run  # show what would change, touch nothing

What it does, per card:
  1. Pulls fresh comps via ebaytools.comps (real SOLD comps when eBay has
     granted Marketplace Insights; active/asking otherwise).
  2. Applies the new median as asking_price ONLY when it's safe:
       - exact-title match (broad "(broad match)" results are never applied)
       - at least MIN_COMPS listings behind the number
       - move is under MAX_SWING (big jumps are flagged for a human, not applied)
  3. Records every observation in data/price_history.csv — that file feeds
     the app's "Movers" panel and per-card trend.

Never touches: merch, sold items, or the judgment-call SKUs in SKIP_SKUS
(their prices were set by hand from noisy broad comps — see CLAUDE.md).
"""

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import catalog, comps, config  # noqa: E402

ROOT = Path(__file__).parent
SNAPSHOT = ROOT / "data" / "comps_snapshot.json"
HISTORY = ROOT / "data" / "price_history.csv"
HISTORY_COLS = ["date", "sku", "price", "basis", "median", "count", "source", "applied"]

MIN_COMPS = 3        # need at least this many listings to trust a median
MAX_SWING = 0.35     # >35% move → flag for review instead of auto-applying
MIN_MOVE = 0.01      # <1% move → leave the price alone (no churn)

# eBay denied us the real SOLD-comp API (Marketplace Insights), so our comps are
# ACTIVE/asking listings — which sit ABOVE what cards actually sell for. To land
# closer to true market we shave a conservative haircut off the asking median to
# ESTIMATE the sold price. Only used when real sold comps aren't granted; the day
# they are, we price off the raw sold median with no haircut. Tune here (0.12 =
# 12% under asking). Rows priced this way are tagged basis "est_sold" so the app
# shows a distinct EST pill — an estimate, never passed off as a real sold comp.
SOLD_DISCOUNT = 0.12

# Prices set by hand from noisy broad-match comps — never auto-reprice these.
SKIP_SKUS = {"CARD-0001", "CARD-0011", "CARD-0013", "CARD-0014",
             "CARD-0016", "CARD-0023", "CARD-0030", "CARD-0032"}


def _num(v: str) -> float:
    try:
        return float(str(v).replace("$", "").replace(",", "").strip())
    except ValueError:
        return 0.0


def _append_history(rows):
    HISTORY.parent.mkdir(exist_ok=True)
    new_file = not HISTORY.exists()
    with HISTORY.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HISTORY_COLS)
        if new_file:
            w.writeheader()
        w.writerows(rows)


def _save_inventory(updates):
    """Rewrite inventory.csv with new asking_price/price_basis for `updates`
    (sku → (price, basis)), preserving every other column untouched."""
    path = config.INVENTORY_CSV
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)
    for row in rows:
        upd = updates.get(row.get("sku", ""))
        if upd:
            row["asking_price"] = f"{upd[0]:.2f}"
            row["price_basis"] = upd[1]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def main() -> int:
    dry = "--dry-run" in sys.argv
    if not config.have_api_keys():
        print("No eBay API keys available (need EBAY_APP_ID + EBAY_CERT_ID in the")
        print("environment or .env) — cannot reprice. Nothing was changed.")
        return 1

    cards = catalog.load()
    sold_comps = comps.sold_available()
    basis = "sold" if sold_comps else "est_sold"
    print(("✓ Using REAL SOLD prices (Marketplace Insights)." if sold_comps
           else f"Using ACTIVE/asking prices (Browse API), minus a {SOLD_DISCOUNT:.0%} "
                "haircut to estimate true sold value.") + "\n")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    history, applied, flagged, skipped, held = [], [], [], [], []
    updates = {}
    snapshot = {"as_of": today, "cards": {}}

    for c in cards:
        current = _num(c.asking_price)
        if c.is_sold() or current <= 0:
            skipped.append(c.sku)
            continue
        # merch + hand-priced SKUs still get queried (their comps feed the
        # app's card view) — their price is just never auto-changed.
        can_apply = not (c.is_merch() or c.sku in SKIP_SKUS)
        try:
            r = comps.get_comps(c)
        except Exception as e:
            print(f"  {c.sku}: error — {e}")
            continue

        broad = "(broad match)" in r.query
        if r.sample_items:
            snapshot["cards"][c.sku] = {
                "source": r.source, "broad": broad,
                "items": r.sample_items[:5],
            }
        rec = {"date": today, "sku": c.sku, "price": f"{current:.2f}",
               "basis": c.price_basis or "asking",
               "median": f"{r.median:.2f}" if r.median else "",
               "count": r.count, "source": r.source, "applied": "no"}

        if not can_apply:
            held.append(c.sku)
            history.append(rec)
            continue

        ok = r.median and r.count >= MIN_COMPS and not broad
        if ok:
            # Real sold comps → use as-is. Active/asking comps → haircut to
            # estimate the true sold price (see SOLD_DISCOUNT above).
            target = r.median if sold_comps else round(r.median * (1 - SOLD_DISCOUNT), 2)
            move = abs(target - current) / current
            if move > MAX_SWING:
                flagged.append(f"{c.sku} {c.player}: ${current:.2f} → ${target:.2f} "
                               f"({move * 100:+.0f}% — too big, review by hand)")
            elif move >= MIN_MOVE:
                updates[c.sku] = (target, basis)
                rec["price"], rec["applied"] = f"{target:.2f}", "yes"
                applied.append(f"{c.sku} {c.player}: ${current:.2f} → ${target:.2f} "
                               f"({(target - current) / current * 100:+.1f}%, {r.count} comps)")
        history.append(rec)

    if dry:
        print(f"DRY RUN — would apply {len(applied)}, flag {len(flagged)}.")
    else:
        if updates:
            _save_inventory(updates)
        _append_history(history)
        if snapshot["cards"]:
            SNAPSHOT.write_text(json.dumps(snapshot, indent=1), encoding="utf-8")
            print(f"Saved {len(snapshot['cards'])} cards' comp listings → {SNAPSHOT.name}")

    print(f"\nApplied {len(applied)} price update(s):")
    for line in applied or ["  (none)"]:
        print("  " + line if not line.startswith("  ") else line)
    if flagged:
        print(f"\nFlagged {len(flagged)} for human review (NOT applied):")
        for line in flagged:
            print("  " + line)
    print(f"\nHeld {len(held)} at their hand-set price (merch / judgment-call SKUs);"
          f" skipped {len(skipped)} (sold / unpriced).")
    if not dry:
        print(f"History → {HISTORY}. Now run: python3 build_web.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
