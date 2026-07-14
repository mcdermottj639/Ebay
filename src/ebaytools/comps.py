"""Pulls recent prices for a card so you price from data, not guesses.

Two eBay APIs are relevant:

  - Browse API (findItemsByKeywords style): returns ACTIVE listings. Available
    to everyone with basic keys. Good for "what are people ASKING?"

  - Marketplace Insights API: returns SOLD/completed items (true comps). This
    is gated — you must apply for access. Better data, more setup.

This module uses the Browse API by default (works with basic keys) and will use
Marketplace Insights automatically if you've been granted access. Either way it
returns a simple price summary you can eyeball.

Marketplace Insights is a GATED "Limited Release" API — a standard production
keyset does NOT include it. Until eBay grants your app the
`buy.marketplace.insights` scope, `_sold_available()` returns False and we
transparently fall back to active/asking listings. The moment access lands,
sold comps switch on with no further code changes. To apply, see:
https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

import requests

from . import config, ebay_auth
from .catalog import Card
from .titles import build_title


@dataclass
class CompResult:
    query: str
    source: str          # "active" or "sold"
    count: int
    low: float | None
    median: float | None
    high: float | None
    sample_titles: list[str]
    # top matching listings [{"t": title, "p": price, "u": url}] — powers the
    # app's "Recent eBay comps" section in the card view.
    sample_items: list = None

    def pretty(self) -> str:
        if self.count == 0:
            return f'No matches found for: "{self.query}"'
        kind = "SOLD" if self.source == "sold" else "active (asking)"
        return (
            f'"{self.query}"\n'
            f"  {self.count} {kind} listings\n"
            f"  low ${self.low:.2f}  |  median ${self.median:.2f}  |  high ${self.high:.2f}"
        )


def query_for(card: Card) -> str:
    """A search string tuned to find this exact card."""
    # The title is already keyword-ordered; it doubles as a great search query.
    return build_title(card)


def broad_query_for(card: Card) -> str:
    """A looser fallback search for when the exact-title query finds nothing.

    Niche inserts/autos (odd card numbers like #S-WAJ, long insert names) are
    over-specific, so eBay's keyword search returns zero. This keeps only the
    words a buyer would still type — year, brand, player, and the value flags
    (grade, AUTO, RELIC, /serial) — dropping the card number and insert/parallel
    that cause the miss.
    """
    if card.is_merch():
        # For merch, drop the "COA" wording and year; keep player+item+team.
        parts = [card.player, "Autographed" if card.is_auto() else "",
                 card.item_type, card.team]
        return _collapse(" ".join(p.strip() for p in parts if p and p.strip()))

    grade = f"{card.grader.upper()} {card.grade}" if (card.is_graded() and card.grader and card.grade) else ""
    parts = [
        card.year, card.brand, card.player,
        grade,
        "AUTO" if card.is_auto() else "",
        "RELIC" if card.is_relic() else "",
        f"/{card.serial_run}" if card.serial_run else "",
        "RC" if card.is_rookie() else "",
    ]
    return _collapse(" ".join(p.strip() for p in parts if p and p.strip()))


def _collapse(text: str) -> str:
    """Drop a word that repeats the immediately preceding word (Panini Panini)."""
    out: list[str] = []
    for word in text.split():
        if out and out[-1].lower() == word.lower():
            continue
        out.append(word)
    return " ".join(out)


def get_comps(card_or_query, limit: int = 50) -> CompResult:
    """Look up comps for a Card object OR a raw search string."""
    query = card_or_query if isinstance(card_or_query, str) else query_for(card_or_query)

    if not config.have_api_keys():
        missing = ", ".join(config.missing_keys())
        raise RuntimeError(
            f"Can't pull comps yet — missing {missing} in your .env file.\n"
            "See docs/01-getting-ebay-api-keys.md. (Everything else in this "
            "toolkit works without keys — you can catalog and draft first.)"
        )

    prices, titles, items, source = _search_best(query, limit)

    # If the exact-title query found nothing and we have a Card, retry with a
    # broadened query so niche inserts/autos still get a ballpark comp.
    if not prices and not isinstance(card_or_query, str):
        broad = broad_query_for(card_or_query)
        if broad and broad != query:
            prices, titles, items, source = _search_best(broad, limit)
            if prices:
                query = f"{broad}  (broad match)"

    if not prices:
        return CompResult(query, source, 0, None, None, None, [], [])

    prices.sort()
    return CompResult(
        query=query,
        source=source,
        count=len(prices),
        low=min(prices),
        median=statistics.median(prices),
        high=max(prices),
        sample_titles=titles[:5],
        sample_items=items[:8],
    )


# Probed once per run: None = unknown, True/False = whether this app has been
# granted Marketplace Insights (sold-comps) access. Avoids re-hitting the token
# endpoint (and eating a failed request) for every one of the 34 cards.
_MI_AVAILABLE: bool | None = None


def _sold_available() -> bool:
    """True only if eBay has granted this app the Marketplace Insights scope."""
    global _MI_AVAILABLE
    if _MI_AVAILABLE is None:
        try:
            ebay_auth.application_token(ebay_auth.SCOPE_MARKETPLACE_INSIGHTS)
            _MI_AVAILABLE = True
        except ebay_auth.EbayAuthError:
            # invalid_scope / not granted — fall back to active listings.
            _MI_AVAILABLE = False
    return _MI_AVAILABLE


def sold_available() -> bool:
    """Public: has eBay granted this app real SOLD-comp (Marketplace Insights)
    access? Owner-facing scripts use this to tell you which data they're on."""
    return _sold_available()


def _search_best(query: str, limit: int) -> tuple[list[float], list[str], list, str]:
    """Prefer real SOLD comps; fall back to active/asking when sold is
    unavailable (not granted) or returns nothing for this query."""
    if _sold_available():
        try:
            prices, titles, items, source = _search_sold(query, limit)
            if prices:
                return prices, titles, items, source
        except RuntimeError:
            pass  # transient sold-search error — use active instead
    return _search_active(query, limit)


def _search_sold(query: str, limit: int) -> tuple[list[float], list[str], list, str]:
    """Search SOLD/completed items via the Marketplace Insights API (gated)."""
    token = ebay_auth.application_token(ebay_auth.SCOPE_MARKETPLACE_INSIGHTS)
    resp = requests.get(
        f"{config.api_base()}/buy/marketplace_insights/v1_beta/item_sales/search",
        headers={
            "Authorization": f"Bearer {token}",
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
        params={"q": query, "limit": min(limit, 200)},
        timeout=30,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"eBay Marketplace Insights error ({resp.status_code}): {resp.text[:300]}")

    data = resp.json()
    prices: list[float] = []
    titles: list[str] = []
    items: list[dict] = []
    for item in data.get("itemSales", []):
        titles.append(item.get("title", ""))
        # Sold price lives in lastSoldPrice; fall back to price for safety.
        price = (item.get("lastSoldPrice") or item.get("price") or {}).get("value")
        if price is not None:
            try:
                p = float(price)
            except (TypeError, ValueError):
                continue
            prices.append(p)
            items.append({"t": item.get("title", ""), "p": p,
                          "u": item.get("itemWebUrl", "")})
    return prices, titles, items, "sold"


def _search_active(query: str, limit: int) -> tuple[list[float], list[str], list, str]:
    """Search ACTIVE listings via the Browse API."""
    token = ebay_auth.application_token()
    resp = requests.get(
        f"{config.api_base()}/buy/browse/v1/item_summary/search",
        headers={
            "Authorization": f"Bearer {token}",
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
        params={"q": query, "limit": min(limit, 200)},
        timeout=30,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"eBay Browse API error ({resp.status_code}): {resp.text[:300]}")

    data = resp.json()
    prices: list[float] = []
    titles: list[str] = []
    items: list[dict] = []
    for item in data.get("itemSummaries", []):
        titles.append(item.get("title", ""))
        price = item.get("price", {}).get("value")
        if price is not None:
            try:
                p = float(price)
            except (TypeError, ValueError):
                continue
            prices.append(p)
            items.append({"t": item.get("title", ""), "p": p,
                          "u": item.get("itemWebUrl", "")})
    return prices, titles, items, "active"
