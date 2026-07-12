#!/usr/bin/env python3
"""Friendly menu for the whole toolkit — no commands to memorize.

Run it with:   python3 run.py
Then type a number and press Enter.
"""

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent

MENU = """
========================================
  eBay Sports Cards — Control Panel
========================================
  1) Check my catalog for mistakes
  2) Make listing drafts (titles + descriptions)
  3) Look up prices/comps on eBay   (needs API keys)
  4) Preview listings (safe, nothing goes live)
  5) LIST FOR REAL on eBay          (needs full setup)
  6) Quit
========================================
"""

ACTIONS = {
    "1": ["check_catalog.py"],
    "2": ["make_drafts.py"],
    "3": ["get_comps.py"],
    "4": ["create_listings.py"],
    "5": ["create_listings.py", "live"],
}


def main() -> int:
    while True:
        print(MENU)
        choice = input("Pick a number: ").strip()
        if choice == "6":
            print("Bye! Happy selling.")
            return 0
        if choice == "5":
            confirm = input("This lists REAL cards on eBay. Type YES to continue: ")
            if confirm.strip() != "YES":
                print("Cancelled.")
                continue
        args = ACTIONS.get(choice)
        if not args:
            print("Please type a number from the menu.")
            continue
        print()
        subprocess.run([sys.executable, str(HERE / args[0]), *args[1:]])
        input("\nPress Enter to return to the menu...")


if __name__ == "__main__":
    raise SystemExit(main())
