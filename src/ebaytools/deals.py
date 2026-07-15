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
import re
import statistics
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path

import requests

from . import config, ebay_auth

SNIPE_WINDOW_HOURS = 24
DEFAULT_DISCOUNT = 0.15  # flag listings 15%+ under market when no alert price set

# We hunt SINGLE cards. Broad queries (esp. Kaboom/Downtown) drag in sealed wax,
# box lots, and case breaks — those aren't the card and they poison the median.
# Drop any listing whose title looks like sealed product / a lot / a break.
_NON_SINGLE = re.compile(
    r"\b("
    r"sealed|mega\s*box|hobby\s*box|blaster|retail\s*box|value\s*box|cello|"
    r"boxes|bundle|hunt(?:ing)?|break|repack|packs?|"
    r"lot\s*of|box\s*lot|case\s*hit\s*lot|\d+\s*x\b|\bx\s*\d+\b"
    r")\b",
    re.IGNORECASE,
)


def _is_single_card(title: str) -> bool:
    """False for sealed wax / box lots / breaks — we only want single cards."""
    return not _NON_SINGLE.search(title or "")


@dataclass
class WatchItem:
    label: str
    query: str
    fair_value: str = ""
    alert_below: str = ""
    notes: str = ""
    sport: str = ""         # "football", "baseball", etc. — used to prefer football
    # Optional per-item price band + premium flag, set programmatically by the
    # caller (radar.py) — e.g. Downtowns/Kabooms get a wider band. None = use
    # the band passed to scan().
    price_min: float | None = None
    price_max: float | None = None
    premium: bool = False


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
    image: str = ""         # thumbnail URL
    bars: int = 0           # value rating 0-3 (like Alt's green bars)
    sport: str = ""         # from the watchlist row (football preferred)
    query: str = ""         # the watchlist query (for eBay live/sold search URLs)
    premium: bool = False   # a Downtown/Kaboom-style premium insert
    # A few of the cheapest current listings for this card, for the app popup:
    # [{"t": title, "p": price, "u": url}].
    samples: list = field(default_factory=list)


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
                    sport=(raw.get("sport") or "").strip().lower(),
                ))
    return items


def _num(value: str) -> float | None:
    try:
        return float(value.replace("$", "").replace(",", ""))
    except (ValueError, AttributeError):
        return None


def scan(items: list[WatchItem], per_item_limit: int = 50,
         price_min: float | None = None, price_max: float | None = None) -> list[Deal]:
    if not config.have_api_keys():
        raise RuntimeError(
            "Buy Radar needs eBay API keys (same ones as pricing). "
            "See docs/01-getting-ebay-api-keys.md."
        )
    token = ebay_auth.application_token()
    deals: list[Deal] = []
    for item in items:
        # Per-item band override (premium inserts get a wider one) falls back to
        # the band passed to scan().
        band_min = item.price_min if item.price_min is not None else price_min
        band_max = item.price_max if item.price_max is not None else price_max
        listings = _search(token, item.query, per_item_limit,
                           price_min=band_min, price_max=band_max)
        # Keep single cards only — no sealed wax / box lots / breaks.
        listings = [l for l in listings if _is_single_card(l["title"])]
        if not listings:
            continue
        prices = [l["price"] for l in listings if l["price"] is not None]
        if not prices:
            continue
        reference = _num(item.fair_value) or statistics.median(prices)
        alert = _num(item.alert_below) or reference * (1 - DEFAULT_DISCOUNT)

        # The cheapest current listings — shown in the app popup as "currently
        # on eBay" so the owner can eyeball the going rate before buying.
        samples = sorted(
            ({"t": l["title"], "p": l["price"], "u": l["url"]}
             for l in listings if l["price"] is not None),
            key=lambda s: s["p"])[:6]

        for l in listings:
            if l["price"] is None or l["price"] > alert:
                continue
            discount = (reference - l["price"]) / reference * 100 if reference else 0
            _, bars = value_rating(discount)
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
                image=l.get("image", ""),
                bars=bars,
                sport=item.sport,
                query=item.query,
                premium=item.premium,
                samples=samples,
            ))
    # Best deals first
    deals.sort(key=lambda d: d.discount_pct, reverse=True)
    return deals


def _search(token: str, query: str, limit: int,
            price_min: float | None = None, price_max: float | None = None) -> list[dict]:
    # eBay Browse filters are comma-joined. Add a price band when asked so both
    # the returned listings AND the median "market" reference stay in the band
    # the owner cares about (e.g. the $100–$1000 premium-card window).
    filters = ["buyingOptions:{FIXED_PRICE|AUCTION}"]
    if price_min is not None or price_max is not None:
        lo = "" if price_min is None else f"{price_min:g}"
        hi = "" if price_max is None else f"{price_max:g}"
        filters.append(f"price:[{lo}..{hi}]")
        filters.append("priceCurrency:USD")
    resp = requests.get(
        f"{config.api_base()}/buy/browse/v1/item_summary/search",
        headers={
            "Authorization": f"Bearer {token}",
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
        params={"q": query, "limit": min(limit, 200), "filter": ",".join(filters)},
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
        # Normalize "title" -> "item_title" to match the Deal dataclass and the
        # console/CSV/HTML consumers in search_deals.py.
        results.append({**l, "item_title": l["title"],
                        "discount_pct": round(discount, 1),
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
