#!/usr/bin/env python3
"""Turn every card in your catalog into an eBay-ready draft.

Creates:
  output/drafts.csv   – a spreadsheet: SKU, title, title length, price
  output/drafts.json  – full detail (item specifics + description) for each card

Nothing is sent to eBay. This just prepares the content so you can review it.

Run it with:   python3 make_drafts.py
"""

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import catalog, titles  # noqa: E402

OUTPUT = Path(__file__).parent / "output"


def main() -> int:
    try:
        cards = catalog.load()
    except FileNotFoundError as e:
        print(e)
        return 1

    OUTPUT.mkdir(exist_ok=True)
    drafts = [titles.draft_for(c) for c in cards]

    # Human-friendly spreadsheet
    with (OUTPUT / "drafts.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["sku", "title", "title_length", "asking_price"])
        for d in drafts:
            writer.writerow([d["sku"], d["title"], d["title_length"], d["asking_price"]])

    # Full detail
    (OUTPUT / "drafts.json").open("w", encoding="utf-8").write(
        json.dumps(drafts, indent=2)
    )

    print(f"Drafted {len(drafts)} listing(s).")
    print(f"  Review the titles:  output/drafts.csv")
    print(f"  Full detail:        output/drafts.json\n")

    long = [d for d in drafts if d["title_length"] > 80]
    if long:
        print(f"Note: {len(long)} title(s) hit the 80-char limit and were trimmed.")
    print("\nA few titles so you can eyeball them:")
    for d in drafts[:5]:
        print(f"  [{d['title_length']:>2}] {d['title']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
