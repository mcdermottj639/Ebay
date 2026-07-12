#!/usr/bin/env python3
"""Generate the web app's data from your catalog.

Writes:
  docs/data.json      — the live data the Card Vault PWA reads (served by GitHub Pages)
  output/preview.html — a single self-contained file (data + CSS + JS inlined) so
                        you can preview the exact app look locally or via a shared link

Run it with:   python3 build_web.py
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import catalog, titles  # noqa: E402

ROOT = Path(__file__).parent
DOCS = ROOT / "docs"
OUTPUT = ROOT / "output"


def _money(cards, field):
    total = 0.0
    for c in cards:
        v = getattr(c, field).replace("$", "").replace(",", "").strip()
        try:
            total += float(v)
        except ValueError:
            pass
    return total


def _status(card):
    return "priced" if card.asking_price.strip() else "needs_price"


def build_data(cards) -> dict:
    by_sport: dict[str, int] = {}
    for c in cards:
        if c.sport:
            by_sport[c.sport] = by_sport.get(c.sport, 0) + 1

    total_cost = _money(cards, "cost")
    total_value = _money(cards, "asking_price")

    return {
        "generated": datetime.now(timezone.utc).strftime("%b %d, %Y · %H:%M UTC"),
        "summary": {
            "total_cards": len(cards),
            "physical": sum(int(c.quantity) for c in cards if c.quantity.isdigit()),
            "rookies": sum(1 for c in cards if c.is_rookie()),
            "autos": sum(1 for c in cards if c.is_auto()),
            "graded": sum(1 for c in cards if c.is_graded()),
            "priced": sum(1 for c in cards if c.asking_price.strip()),
            "total_cost": round(total_cost, 2),
            "total_value": round(total_value, 2),
            "profit": round(total_value - total_cost, 2),
            "by_sport": by_sport,
        },
        "cards": [
            {
                "sku": c.sku, "sport": c.sport, "year": c.year, "brand": c.brand,
                "set": c.set, "player": c.player, "card_number": c.card_number,
                "parallel": c.parallel, "insert": c.insert, "team": c.team,
                "league": c.league, "rookie": c.is_rookie(), "auto": c.is_auto(),
                "graded": c.is_graded(), "relic": c.is_relic(), "grader": c.grader,
                "grade": c.grade, "serial_run": c.serial_run, "condition": c.condition,
                "cost": c.cost, "asking_price": c.asking_price, "notes": c.notes,
                "title": titles.build_title(c), "status": _status(c),
            }
            for c in cards
        ],
    }


def main() -> int:
    try:
        cards = catalog.load()
    except FileNotFoundError as e:
        print(e)
        return 1

    data = build_data(cards)
    DOCS.mkdir(exist_ok=True)
    (DOCS / "data.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Wrote {DOCS/'data.json'} ({data['summary']['total_cards']} cards)")

    # Self-contained preview: inline the same CSS + JS + data into one file.
    css = (DOCS / "styles.css").read_text(encoding="utf-8") if (DOCS / "styles.css").exists() else ""
    appjs = (DOCS / "app.js").read_text(encoding="utf-8") if (DOCS / "app.js").exists() else ""
    if css and appjs:
        preview = (
            "<style>\n" + css + "\n</style>\n<div id=\"root\"></div>\n"
            "<script>window.__CARD_DATA__=" + json.dumps(data) + ";\n" + appjs + "\n</script>"
        )
        OUTPUT.mkdir(exist_ok=True)
        (OUTPUT / "preview.html").write_text(preview, encoding="utf-8")
        print(f"Wrote {OUTPUT/'preview.html'} (self-contained preview)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
