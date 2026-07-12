"""Builds eBay-optimized listing content from a Card. Works 100% offline.

eBay gives you an 80-character title, and buyers search by typing card details
into that search box. So the title should front-load the exact words a buyer
types: year, brand, set, player, card number, parallel, rookie, grade.

This module produces three things per card:
    - title:        <= 80 chars, keyword-ordered, auto-trimmed
    - item_specifics: the structured fields eBay shows in the "specifics" box
    - description:  a clean, readable HTML/text blurb
"""

from __future__ import annotations

from .catalog import Card

TITLE_MAX = 80


def build_title(card: Card) -> str:
    """Assemble an 80-char title, keeping the highest-value keywords first.

    Priority order (buyers search these first, so we keep these when trimming):
      year -> brand -> set -> player -> card# -> parallel -> insert
      -> RC -> AUTO -> serial -> grade -> team
    """
    number = card.card_number.strip()
    if number and not number.startswith("#"):
        number = f"#{number}"

    grade = ""
    if card.is_graded() and card.grader and card.grade:
        grade = f"{card.grader.upper()} {card.grade}"

    # Ordered from most to least important. We drop from the END until it fits.
    parts = [
        card.year,
        card.brand,
        card.set,
        card.player,
        number,
        card.parallel,
        card.insert,
        "RC" if card.is_rookie() else "",
        "AUTO" if card.is_auto() else "",
        f"/{card.serial_run}" if card.serial_run else "",
        grade,
        card.team,
    ]
    parts = [p.strip() for p in parts if p and p.strip()]

    title = " ".join(parts)
    if len(title) <= TITLE_MAX:
        return title

    # Too long: drop trailing (lowest-priority) parts until it fits.
    while parts and len(" ".join(parts)) > TITLE_MAX:
        parts.pop()
    return " ".join(parts)


def build_item_specifics(card: Card) -> dict[str, list[str]]:
    """The structured fields eBay's Trading Card category expects.

    Values are lists because eBay's API takes a list of values per aspect.
    Only non-empty fields are included.
    """
    features = []
    if card.is_rookie():
        features.append("Rookie")
    if card.is_auto():
        features.append("Autograph")
    if card.serial_run:
        features.append("Serial Numbered")

    raw = {
        "Sport": card.sport,
        "Player/Athlete": card.player,
        "Season": card.year,
        "Manufacturer": card.brand,
        "Set": card.set,
        "Insert/Set": card.insert,
        "Parallel/Variety": card.parallel,
        "Card Number": card.card_number,
        "Team": card.team,
        "League": card.league,
        "Features": ", ".join(features) if features else "",
        "Grade": card.grade if card.is_graded() else "",
        "Professional Grader": card.grader if card.is_graded() else "",
        "Card Condition": card.condition if not card.is_graded() else "",
    }
    return {k: [v] for k, v in raw.items() if v and v.strip()}


def build_description(card: Card) -> str:
    """A readable, honest description. Kept simple and truthful on purpose."""
    specifics = build_item_specifics(card)
    rows = "".join(
        f"<li><strong>{k}:</strong> {v[0]}</li>" for k, v in specifics.items()
    )
    condition_line = (
        f"Graded {card.grader.upper()} {card.grade}."
        if card.is_graded()
        else f"Condition: {card.condition or 'see photos'}. Ungraded — grade your own opinion from the pictures."
    )
    note = f"<p>{card.notes}</p>" if card.notes else ""

    return (
        f"<h2>{build_title(card)}</h2>"
        f"<p>{condition_line}</p>"
        f"<ul>{rows}</ul>"
        f"{note}"
        "<p>Shipped securely in a penny sleeve + top loader (or graded slab), "
        "team bagged, inside a bubble mailer or box. Combined shipping on "
        "multiple wins — buy more, save on shipping. Thanks for looking!</p>"
    )


def draft_for(card: Card) -> dict:
    """Everything for one card in a single dict, ready to display or upload."""
    title = build_title(card)
    return {
        "sku": card.sku,
        "title": title,
        "title_length": len(title),
        "item_specifics": build_item_specifics(card),
        "description": build_description(card),
        "asking_price": card.asking_price,
    }
