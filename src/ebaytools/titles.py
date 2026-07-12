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

    Cards and merch (jerseys, balls, framed items) search very differently, so
    they get different title shapes.
    """
    if card.is_merch():
        return _merch_title(card)

    """Card title priority (buyers search these first, kept when trimming):
      year -> brand -> set -> player -> card# -> grade/AUTO/RELIC/serial ...
    """
    number = card.card_number.strip()
    if number and not number.startswith("#"):
        number = f"#{number}"

    grade = ""
    if card.is_graded() and card.grader and card.grade:
        grade = f"{card.grader.upper()} {card.grade}"

    # Ordered from most to least important. We drop from the END until it fits.
    # Value flags (grade, AUTO, RELIC, /serial) sit high so they survive trimming
    # even when the set name is long — buyers filter searches on exactly these.
    parts = [
        card.year,
        card.brand,
        card.set,
        card.player,
        number,
        grade,
        "AUTO" if card.is_auto() else "",
        "RELIC" if card.is_relic() else "",
        f"/{card.serial_run}" if card.serial_run else "",
        "RC" if card.is_rookie() else "",
        card.parallel,
        card.insert,
        card.team,
    ]
    parts = [p.strip() for p in parts if p and p.strip()]

    title = _assemble(parts)
    if len(title) <= TITLE_MAX:
        return title

    # Too long: drop trailing (lowest-priority) parts until it fits.
    while parts and len(_assemble(parts)) > TITLE_MAX:
        parts.pop()
    return _assemble(parts)


def _merch_title(card: Card) -> str:
    """Title for memorabilia: player + Autographed + item + team + COA + year.

    e.g. 'Kyren Williams Autographed Los Angeles Rams Jersey Beckett COA'.
    """
    auth = (card.grader.strip() + " COA") if card.grader.strip() else ""
    parts = [
        card.player,
        "Autographed" if card.is_auto() else "",
        card.item_type,          # e.g. "Framed Jersey"
        card.team,
        auth,
        card.year,
    ]
    parts = [p.strip() for p in parts if p and p.strip()]
    title = _assemble(parts)
    if len(title) <= TITLE_MAX:
        return title
    while parts and len(_assemble(parts)) > TITLE_MAX:
        parts.pop()
    return _assemble(parts)


def _assemble(parts: list[str]) -> str:
    """Join parts into a title, collapsing repeated adjacent words."""
    return _collapse_words(" ".join(parts))


def _collapse_words(text: str) -> str:
    """Remove a word that repeats the immediately preceding word.

    Handles brand 'Panini' + set 'Panini Prizm' -> 'Panini Prizm', or a
    parallel/insert that duplicates. Word-level (not substring) so it never
    strips a flag like 'RC' because those letters sit inside another word.
    """
    out: list[str] = []
    for word in text.split():
        if out and out[-1].lower() == word.lower():
            continue
        out.append(word)
    return " ".join(out)


def build_item_specifics(card: Card) -> dict[str, list[str]]:
    """The structured fields eBay expects for this item (card OR merch).

    Values are lists because eBay's API takes a list of values per aspect.
    Only non-empty fields are included.
    """
    if card.is_merch():
        raw = {
            "Product": card.item_type,
            "Player/Athlete": card.player,
            "Team": card.team,
            "Sport": card.sport,
            "League": card.league,
            "Season": card.year,
            "Autographed": "Yes" if card.is_auto() else "",
            "Authentication": card.grader,   # Beckett / JSA / PSA-DNA / Fanatics
            "Condition": card.condition,
        }
        return {k: [v] for k, v in raw.items() if v and v.strip()}

    features = []
    if card.is_rookie():
        features.append("Rookie")
    if card.is_auto():
        features.append("Autograph")
    if card.is_relic():
        features.append("Patch/Relic")
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
    if card.is_merch():
        auth = f" Authenticated by {card.grader} (COA included)." if card.grader else ""
        condition_line = f"Autographed {card.item_type.lower()}.{auth} Condition: {card.condition or 'see photos'}."
    elif card.is_graded():
        condition_line = f"Graded {card.grader.upper()} {card.grade}."
    else:
        condition_line = f"Condition: {card.condition or 'see photos'}. Ungraded — grade your own opinion from the pictures."
    note = f"<p>{card.notes}</p>" if card.notes else ""
    shipping = (
        "<p>Carefully packed and shipped fully insured with tracking. Comes with "
        "the pictured authentication/COA. Thanks for looking!</p>"
        if card.is_merch() else
        "<p>Shipped securely in a penny sleeve + top loader (or graded slab), "
        "team bagged, inside a bubble mailer or box. Combined shipping on "
        "multiple wins — buy more, save on shipping. Thanks for looking!</p>"
    )

    return (
        f"<h2>{build_title(card)}</h2>"
        f"<p>{condition_line}</p>"
        f"<ul>{rows}</ul>"
        f"{note}"
        + shipping
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
