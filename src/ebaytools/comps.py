"""Pulls recent prices for a card so you price from data, not guesses.

Two eBay APIs are relevant:

  - Browse API (findItemsByKeywords style): returns ACTIVE listings. Available
    to everyone with basic keys. Good for "what are people ASKING?"

  - Marketplace Insights API: returns SOLD/completed items (true comps). This
    is gated — you must apply for access. Better data, more setup.

This module uses the Browse API by default (works with basic keys) and will use
Marketplace Insights automatically if you've been granted access. Either way it
returns a simple price summary you can eyeball.
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

    prices, titles, source = _search_active(query, limit)
    if not prices:
        return CompResult(query, source, 0, None, None, None, [])

    prices.sort()
    return CompResult(
        query=query,
        source=source,
        count=len(prices),
        low=min(prices),
        median=statistics.median(prices),
        high=max(prices),
        sample_titles=titles[:5],
    )


def _search_active(query: str, limit: int) -> tuple[list[float], list[str], str]:
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
    for item in data.get("itemSummaries", []):
        titles.append(item.get("title", ""))
        price = item.get("price", {}).get("value")
        if price is not None:
            try:
                prices.append(float(price))
            except (TypeError, ValueError):
                pass
    return prices, titles, "active"
