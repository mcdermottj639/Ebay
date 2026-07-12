#!/usr/bin/env python3
"""Check your inventory.csv for mistakes and show a summary.

Run it with:   python3 check_catalog.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import catalog  # noqa: E402


def main() -> int:
    try:
        cards = catalog.load()
    except FileNotFoundError as e:
        print(e)
        return 1

    print("=" * 60)
    print("YOUR CATALOG")
    print("=" * 60)
    print(catalog.summarize(cards))
    print()

    problems = catalog.check(cards)
    if not problems:
        print("No problems found. Your catalog is ready to draft. ✔")
        print("Next:  python3 make_drafts.py")
        return 0

    print(f"Found {len(problems)} thing(s) to fix:")
    for p in problems:
        print(f"  - {p}")
    print("\nFix these in data/inventory.csv (open it in Excel or Google Sheets), then run again.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
