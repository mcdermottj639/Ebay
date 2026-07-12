"""Buy Radar — scans eBay's active listings for cards you want to buy and
flags the ones priced below market, plus auctions ending soon (snipe targets).

You keep a watchlist (data/watchlist.csv). For each row this:
  1. searches eBay's ACTIVE listings (Browse API)
  2. figures out a reference "market" price — your fair_value if you set one,
     otherwise the median of what's currently listed
  3. flags any listing at/under your alert price (or 85% of market by default)
  4. marks auctions ending within 24h as snipe candidates

Honest limit: eBay's API doesn't let outside apps place last-second bids, so
this finds the deals and you place the bid (manually or via a sniping service).
"""

from __future__ import annotations

import csv
import statistics
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

import requests

from . import config, ebay_auth

SNIPE_WINDOW_HOURS = 24
DEFAULT_DISCOUNT = 0.15  # flag listings 15%+ under market when no alert price set


@dataclass
class WatchItem:
    label: str
    query: str
    fair_value: str = ""
    alert_below: str = ""
    notes: str = ""


@dataclass
class Deal:
    label: str
    item_title: str
    price: float
    buying_option: str      # "FIXED_PRICE" or "AUCTION"
    ends: str               # auction end time (ISO) or ""
    reference: float        # the market price we compared against
    discount_pct: float     # how far under market
    snipe: bool             # auction ending soon?
    url: str


def load_watchlist(path: Path | None = None) -> list[WatchItem]:
    path = path or (config.DATA_DIR / "watchlist.csv")
    if not path.exists():
        return []
    items = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        for raw in csv.DictReader(f):
            if (raw.get("query") or "").strip():
                items.append(WatchItem(
                    label=(raw.get("label") or "").strip(),
                    query=(raw.get("query") or "").strip(),
                    fair_value=(raw.get("fair_value") or "").strip(),
                    alert_below=(raw.get("alert_below") or "").strip(),
                    notes=(raw.get("notes") or "").strip(),
                ))
    return items


def _num(value: str) -> float | None:
    try:
        return float(value.replace("$", "").replace(",", ""))
    except (ValueError, AttributeError):
        return None


def scan(items: list[WatchItem], per_item_limit: int = 50) -> list[Deal]:
    if not config.have_api_keys():
        raise RuntimeError(
            "Buy Radar needs eBay API keys (same ones as pricing). "
            "See docs/01-getting-ebay-api-keys.md."
        )
    token = ebay_auth.application_token()
    deals: list[Deal] = []
    for item in items:
        listings = _search(token, item.query, per_item_limit)
        if not listings:
            continue
        prices = [l["price"] for l in listings if l["price"] is not None]
        if not prices:
            continue
        reference = _num(item.fair_value) or statistics.median(prices)
        alert = _num(item.alert_below) or reference * (1 - DEFAULT_DISCOUNT)

        for l in listings:
            if l["price"] is None or l["price"] > alert:
                continue
            discount = (reference - l["price"]) / reference * 100 if reference else 0
            deals.append(Deal(
                label=item.label or item.query,
                item_title=l["title"],
                price=l["price"],
                buying_option=l["buying_option"],
                ends=l["ends"],
                reference=round(reference, 2),
                discount_pct=round(discount, 1),
                snipe=l["snipe"],
                url=l["url"],
            ))
    # Best deals first
    deals.sort(key=lambda d: d.discount_pct, reverse=True)
    return deals


def _search(token: str, query: str, limit: int) -> list[dict]:
    resp = requests.get(
        f"{config.api_base()}/buy/browse/v1/item_summary/search",
        headers={
            "Authorization": f"Bearer {token}",
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
        params={"q": query, "limit": min(limit, 200), "filter": "buyingOptions:{FIXED_PRICE|AUCTION}"},
        timeout=30,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"eBay Browse API error ({resp.status_code}): {resp.text[:300]}")

    out = []
    for it in resp.json().get("itemSummaries", []):
        options = it.get("buyingOptions", []) or []
        is_auction = "AUCTION" in options
        ends = it.get("itemEndDate", "") if is_auction else ""
        image = (it.get("image", {}) or {}).get("imageUrl", "")
        if not image and it.get("thumbnailImages"):
            image = it["thumbnailImages"][0].get("imageUrl", "")
        out.append({
            "title": it.get("title", ""),
            "price": _num(str(it.get("price", {}).get("value", ""))),
            "buying_option": "AUCTION" if is_auction else "FIXED_PRICE",
            "ends": ends,
            "snipe": bool(is_auction and _ends_soon(ends)),
            "url": it.get("itemWebUrl", ""),
            "image": image,
        })
    return out


# ---- Ad-hoc search (Alt-style): type any query, rank results by value --------

def value_rating(discount_pct: float) -> tuple[str, int]:
    """Map a % discount vs market to a label + bar count (like Alt's green bars)."""
    if discount_pct >= 20:
        return ("Great Value", 3)
    if discount_pct >= 8:
        return ("Good Value", 2)
    if discount_pct >= -8:
        return ("Fair Price", 1)
    return ("Over Market", 0)


def search(query: str, fair_value: str = "", limit: int = 60) -> dict:
    """Search eBay for any query and rank every result by value vs market.

    Returns {'query', 'reference', 'count', 'results': [...]} where each result
    carries a discount_pct, value label, and bar count.
    """
    if not config.have_api_keys():
        raise RuntimeError(
            "Search needs eBay API keys (same ones as pricing/Buy Radar). "
            "See docs/01-getting-ebay-api-keys.md."
        )
    token = ebay_auth.application_token()
    listings = _search(token, query, limit)
    prices = [l["price"] for l in listings if l["price"] is not None]
    if not prices:
        return {"query": query, "reference": 0.0, "count": 0, "results": []}

    reference = _num(fair_value) or statistics.median(prices)
    results = []
    for l in listings:
        if l["price"] is None:
            continue
        discount = (reference - l["price"]) / reference * 100 if reference else 0
        label, bars = value_rating(discount)
        results.append({**l, "discount_pct": round(discount, 1),
                        "value_label": label, "bars": bars})
    results.sort(key=lambda r: r["discount_pct"], reverse=True)
    return {"query": query, "reference": round(reference, 2),
            "count": len(results), "results": results}


def _ends_soon(iso_end: str) -> bool:
    """True if an auction ends within SNIPE_WINDOW_HOURS from now."""
    if not iso_end:
        return False
    try:
        end = datetime.fromisoformat(iso_end.replace("Z", "+00:00"))
    except ValueError:
        return False
    hours_left = (end - datetime.now(timezone.utc)).total_seconds() / 3600
    return 0 <= hours_left <= SNIPE_WINDOW_HOURS


def deals_to_dicts(deals: list[Deal]) -> list[dict]:
    return [asdict(d) for d in deals]
