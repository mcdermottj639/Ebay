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
# `item_type` distinguishes cards from merch (jersey, ball, photo, etc.). Blank
# or "card" = a trading card; anything else = merch. For merch, the card-only
# columns (brand/set/card_number/parallel/grade...) are simply left blank, and
# `grader` doubles as the autograph authenticator (Beckett/JSA/PSA/DNA/Fanatics).
COLUMNS = [
    "sku", "item_type", "sport", "year", "brand", "set", "player", "card_number",
    "parallel", "insert", "team", "league", "rookie", "autograph",
    "serial_run", "graded", "grader", "grade", "condition",
    "quantity", "cost", "asking_price", "notes", "price_basis",
    "listed", "sold_price", "sold_date",
]

# The bare minimum a row needs, by kind.
REQUIRED_CARD = ["sku", "sport", "year", "brand", "player"]
REQUIRED_MERCH = ["sku", "player", "item_type"]

TRUTHY = {"yes", "y", "true", "1", "x"}
CARD_TYPES = {"", "card", "trading card"}


@dataclass
class Card:
    sku: str = ""
    item_type: str = ""
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
    price_basis: str = ""   # "sold" (real sold comps), "est_sold" (asking comps
                            # minus a haircut to estimate market), or "asking"
    listed: str = ""        # yes = live on eBay right now
    sold_price: str = ""    # actual sale price — filling this marks the item SOLD
    sold_date: str = ""     # when it sold (YYYY-MM-DD)
    extra: dict = field(default_factory=dict)
    row_number: int = 0  # line in the spreadsheet, for error messages

    def is_merch(self) -> bool:
        """True if this is memorabilia/merch rather than a trading card."""
        return self.item_type.strip().lower() not in CARD_TYPES

    def is_card(self) -> bool:
        return not self.is_merch()

    def is_authenticated(self) -> bool:
        """Merch with a COA/authenticator recorded (in `grader`)."""
        return self.is_merch() and bool(self.grader.strip())

    def is_rookie(self) -> bool:
        return self.rookie.strip().lower() in TRUTHY

    def is_auto(self) -> bool:
        return self.autograph.strip().lower() in TRUTHY

    def is_graded(self) -> bool:
        return self.graded.strip().lower() in TRUTHY

    def is_sold(self) -> bool:
        """True once a sale price is recorded — the item has left inventory."""
        return bool(self.sold_price.strip())

    def is_listed(self) -> bool:
        """True if live on eBay right now (and not yet sold)."""
        return (not self.is_sold()) and self.listed.strip().lower() in TRUTHY

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

        # Missing must-have fields (cards and merch need different basics)
        required = REQUIRED_MERCH if card.is_merch() else REQUIRED_CARD
        for req in required:
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
        for money in ("cost", "asking_price", "sold_price"):
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
    merch = sum(1 for c in cards if c.is_merch())
    qty = sum(int(c.quantity) for c in cards if c.quantity.isdigit())
    rookies = sum(1 for c in cards if c.is_rookie())
    autos = sum(1 for c in cards if c.is_auto())
    graded = sum(1 for c in cards if c.is_graded())
    sports: dict[str, int] = {}
    for c in cards:
        if c.sport:
            sports[c.sport] = sports.get(c.sport, 0) + 1

    lines = [
        f"Items (cards + merch):    {total}",
        f"Cards / Merch:            {total - merch} / {merch}",
        f"Total physical items:     {qty}",
        f"Rookies:                  {rookies}",
        f"Autographs:               {autos}",
        f"Graded:                   {graded}",
    ]
    if sports:
        by_sport = ", ".join(f"{s} ({n})" for s, n in sorted(sports.items()))
        lines.append(f"By sport:                 {by_sport}")
    return "\n".join(lines)
