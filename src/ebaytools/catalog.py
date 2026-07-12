"""Reads your inventory.csv and checks it for common mistakes.

Your inventory is just a spreadsheet. Each row = one card (or one lot of
identical cards). This module turns that spreadsheet into Python objects the
rest of the toolkit can use, and warns you about rows that look off.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path

from . import config

# Every column we understand. Extra columns in your CSV are kept in `extra`.
COLUMNS = [
    "sku", "sport", "year", "brand", "set", "player", "card_number",
    "parallel", "insert", "team", "league", "rookie", "autograph",
    "serial_run", "graded", "grader", "grade", "condition",
    "quantity", "cost", "asking_price", "notes",
]

# The bare minimum a row needs before we'll try to make a listing from it.
REQUIRED = ["sku", "sport", "year", "brand", "player"]

TRUTHY = {"yes", "y", "true", "1", "x"}


@dataclass
class Card:
    sku: str = ""
    sport: str = ""
    year: str = ""
    brand: str = ""
    set: str = ""
    player: str = ""
    card_number: str = ""
    parallel: str = ""
    insert: str = ""
    team: str = ""
    league: str = ""
    rookie: str = ""
    autograph: str = ""
    serial_run: str = ""
    graded: str = ""
    grader: str = ""
    grade: str = ""
    condition: str = ""
    quantity: str = ""
    cost: str = ""
    asking_price: str = ""
    notes: str = ""
    extra: dict = field(default_factory=dict)
    row_number: int = 0  # line in the spreadsheet, for error messages

    def is_rookie(self) -> bool:
        return self.rookie.strip().lower() in TRUTHY

    def is_auto(self) -> bool:
        return self.autograph.strip().lower() in TRUTHY

    def is_graded(self) -> bool:
        return self.graded.strip().lower() in TRUTHY

    def is_relic(self) -> bool:
        """True if this looks like a memorabilia/patch/jersey card.

        Only reads the structured set/insert fields — not freeform notes, which
        can contain questions like "confirm if it has a patch".
        """
        text = f"{self.insert} {self.set}".lower()
        return any(w in text for w in
                   ("relic", "patch", "jersey", "memorabilia", "materials"))


def load(path: Path | None = None) -> list[Card]:
    """Read the inventory CSV into a list of Card objects."""
    path = path or config.INVENTORY_CSV
    if not path.exists():
        raise FileNotFoundError(
            f"Couldn't find your inventory file at {path}.\n"
            "Create it by copying data/inventory_template_BLANK.csv, or use "
            "the example data/inventory.csv to start."
        )

    cards: list[Card] = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for i, raw in enumerate(reader, start=2):  # row 1 is the header
            known = {c: (raw.get(c) or "").strip() for c in COLUMNS}
            extra = {k: v for k, v in raw.items() if k not in COLUMNS and k}
            cards.append(Card(**known, extra=extra, row_number=i))
    return cards


def check(cards: list[Card]) -> list[str]:
    """Return a list of human-readable problems. Empty list = all good."""
    problems: list[str] = []
    seen_skus: dict[str, int] = {}

    for card in cards:
        where = f"Row {card.row_number}"

        # Missing must-have fields
        for req in REQUIRED:
            if not getattr(card, req):
                problems.append(f"{where}: missing '{req}'.")

        # Duplicate SKUs would collide on eBay
        if card.sku:
            if card.sku in seen_skus:
                problems.append(
                    f"{where}: SKU '{card.sku}' is also used on row "
                    f"{seen_skus[card.sku]}. Each card needs a unique SKU."
                )
            else:
                seen_skus[card.sku] = card.row_number

        # Year sanity
        if card.year and not (card.year.isdigit() and len(card.year) == 4):
            problems.append(f"{where}: year '{card.year}' should be 4 digits like 2021.")

        # Graded cards should say who graded them and the grade
        if card.is_graded() and not (card.grader and card.grade):
            problems.append(
                f"{where}: marked graded but missing grader (PSA/BGS/SGC) or grade."
            )

        # Numbers should be numbers
        for money in ("cost", "asking_price"):
            val = getattr(card, money)
            if val and not _looks_like_number(val):
                problems.append(f"{where}: {money} '{val}' doesn't look like a price.")

    return problems


def _looks_like_number(value: str) -> bool:
    try:
        float(value.replace("$", "").replace(",", ""))
        return True
    except ValueError:
        return False


def summarize(cards: list[Card]) -> str:
    """One-line-per-stat summary of the whole catalog."""
    total = len(cards)
    qty = sum(int(c.quantity) for c in cards if c.quantity.isdigit())
    rookies = sum(1 for c in cards if c.is_rookie())
    autos = sum(1 for c in cards if c.is_auto())
    graded = sum(1 for c in cards if c.is_graded())
    sports: dict[str, int] = {}
    for c in cards:
        if c.sport:
            sports[c.sport] = sports.get(c.sport, 0) + 1

    lines = [
        f"Rows (unique cards/lots): {total}",
        f"Total physical cards:     {qty}",
        f"Rookies:                  {rookies}",
        f"Autographs:               {autos}",
        f"Graded:                   {graded}",
    ]
    if sports:
        by_sport = ", ".join(f"{s} ({n})" for s, n in sorted(sports.items()))
        lines.append(f"By sport:                 {by_sport}")
    return "\n".join(lines)
