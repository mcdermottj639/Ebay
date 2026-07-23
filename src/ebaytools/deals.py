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
MIN_BUCKET = 3           # a grade bucket needs ≥3 comps to trust its median

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


# Not a real card: reprints, display/dummy cards, customs, digital, and the
# Kaboom "advent calendar / countdown" box that keeps sneaking into results.
# These pollute both the deal list and the market median, so drop them.
_JUNK = re.compile(
    r"\b("
    r"reprint|rp|display|custom|aceo|facsimile|novelty|proxy|digital|"
    r"calendar|countdown|you\s*pick|u\s*pick|pick\s*your|choose"
    r")\b",
    re.IGNORECASE,
)


def _is_junk(title: str) -> bool:
    """True for reprints / display cards / calendars / customs / 'you pick'."""
    return bool(_JUNK.search(title or ""))


# ---- Relevance gate: does a listing title actually match the search query? ----
# eBay keyword search matches loosely, so a "Jayden Daniels Kaboom" query returns
# Deebo Samuel Kabooms, a "Prizm PSA 10" query returns Score/Select cards, etc.
# We require every meaningful query token to appear as a WHOLE token in the title.

# Tokens that don't have to appear in the title — brand/format noise a buyer may
# omit. Everything else in the query (player, set, parallel, year, grade) is
# required.
_FILLER_TOKENS = {"panini", "card", "football", "1st"}

# Synonym groups: any member in the title satisfies a query token from the group.
_SYNONYMS = [
    {"rookie", "rc"},
    {"auto", "autograph", "autographed"},
]

# Flagship single-card BASE SETS are mutually exclusive — a card is a Prizm OR a
# Select OR a Score, never two. But Panini reuses the word "Prizm" as a parallel/
# finish inside other sets ("Select … Shock Prizm"), so the plain token gate lets
# a Select card through a Prizm query. When the query names one of these base sets
# and the title names a DIFFERENT one, it's the wrong card — reject it. Deliberately
# excludes donruss/optic/absolute so the Downtown/Kaboom category queries (which
# legitimately span Donruss + Optic + Absolute) are untouched.
_BASE_SETS = {"prizm", "select", "mosaic", "score", "chronicles", "phoenix", "certified"}


def _base_set_conflict(query_tokens: set, title_tokens: set) -> bool:
    """True if the title's base set contradicts the query's (Select under Prizm)."""
    q_sets = query_tokens & _BASE_SETS
    if not q_sets:
        return False  # query doesn't pin a base set — don't over-filter
    t_sets = title_tokens & _BASE_SETS
    # A base set in the title that the query didn't ask for = wrong product.
    return bool(t_sets - q_sets)


def _norm_tokens(text: str) -> list[str]:
    """Lowercase, drop periods/apostrophes (so 'C.J.' == 'CJ'), split on
    non-alphanumerics into whole tokens."""
    text = (text or "").lower().replace(".", "").replace("'", "").replace("’", "")
    return [t for t in re.split(r"[^a-z0-9]+", text) if t]


def _synonyms_for(token: str) -> set[str]:
    """All tokens that should count as a match for this query token."""
    for group in _SYNONYMS:
        if token in group:
            return group
    return {token}


def _matches_query(query: str, title: str) -> bool:
    """True only if the title contains every meaningful token of the query.

    Whole-token equality, never substring — so 'prizm' does NOT match
    'prizmatic', and the '10' of 'psa 10' is required. Filler brand/format
    tokens (panini, card, football, 1st) are not required; synonym groups
    (rookie/rc, auto/autograph) count as a match.
    """
    title_tokens = set(_norm_tokens(title))
    if not title_tokens:
        return False
    query_tokens = _norm_tokens(query)
    for tok in query_tokens:
        if tok in _FILLER_TOKENS:
            continue
        if not (_synonyms_for(tok) & title_tokens):
            return False
    # Right words, wrong product (a Select card under a Prizm query) → reject.
    if _base_set_conflict(set(query_tokens), title_tokens):
        return False
    return True


# Oversized / jumbo / box-topper cards (esp. oversized Downtowns) are a SEPARATE
# market priced very differently from the standard 2.5x3.5 single — mixing them
# into a standard-size median gives a bogus discount. Detect them so scan() can
# drop them from a standard query (but keep them when the query hunts oversized).
_OVERSIZED = re.compile(
    r"\b("
    r"oversized?|jumbo|box\s*topper|boxtopper|blow\s*up|giant|"
    r"5\s*[x×]\s*7|3\s*[x×]\s*5|\d{2,}\s*[x×]\s*\d{2,}"
    r")\b",
    re.IGNORECASE,
)


def _is_oversized(title: str) -> bool:
    return bool(_OVERSIZED.search(title or ""))


def _query_wants_oversized(query: str) -> bool:
    return bool(re.search(r"oversized?|jumbo|box\s*topper|boxtopper", query or "", re.IGNORECASE))


# ---- Grade bucketing: a raw card and a PSA 10 are different markets ----------
# Rating a raw "Lazer Prizm" against a PSA-10 median gives a fake 60%-off deal,
# and a PSA 9 against a median mixing 10s and raw looks like a steal when it's
# just normal PSA-9 pricing. So we compare each listing only against others in
# its own grade bucket.
_PSA10 = re.compile(r"\bpsa\s*10\b", re.IGNORECASE)
_PSA9 = re.compile(r"\bpsa\s*9(?:\.0)?\b", re.IGNORECASE)
_ANY_GRADE = re.compile(r"\b(psa|bgs|bvg|sgc|cgc|csg|hga)\s*\d", re.IGNORECASE)


def _grade_key(title: str) -> str:
    """Bucket a listing by grade: psa10 / psa9 / graded_other / raw."""
    t = title or ""
    if _PSA10.search(t):
        return "psa10"
    if _PSA9.search(t):
        return "psa9"
    if _ANY_GRADE.search(t):
        return "graded_other"
    return "raw"


def _item_id(url: str) -> str:
    """eBay item id parsed from an itemWebUrl (…/itm/1234567890…), for dedup."""
    m = re.search(r"/itm/(?:[^/]+/)?(\d{9,})", url or "")
    return m.group(1) if m else ""


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
    ref_count: int = 0      # how many comps the reference median came from
    grade_key: str = ""     # grade bucket this deal was rated within
    seller_score: int = 0   # seller feedbackScore (scam guard)
    seller_pct: float = 0.0 # seller feedbackPercentage
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
        # Drop reprints / display cards / calendars / customs / "you pick".
        listings = [l for l in listings if not _is_junk(l["title"])]
        # Relevance gate: the title must actually be the card we searched for
        # (right player, set, parallel, year, grade) — kills the loose keyword
        # matches (Deebo under a Jayden query, Score under a Prizm query, …).
        # This runs BEFORE the median so the reference isn't polluted either.
        listings = [l for l in listings if _matches_query(item.query, l["title"])]
        # Oversized/jumbo Downtowns price differently — drop them so they don't
        # skew a standard-size median, unless this watchlist row hunts oversized.
        if not _query_wants_oversized(item.query):
            listings = [l for l in listings if not _is_oversized(l["title"])]
        # Drop listings with no price, then dedup by eBay item id (falling back
        # to a title+price key) so the same listing can't appear twice.
        seen: set = set()
        deduped = []
        for l in listings:
            if l["price"] is None:
                continue
            key = _item_id(l["url"]) or (l["title"], l["price"])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(l)
        listings = deduped
        if not listings:
            continue

        # Grade-bucket the pool: a listing is only ever rated against comps in
        # its own bucket (psa10 / psa9 / graded_other / raw), and only when that
        # bucket has at least MIN_BUCKET prices — so a raw card is never rated
        # against a PSA-10 median, and a PSA 9 never against a mixed one.
        buckets: dict = {}
        for l in listings:
            buckets.setdefault(_grade_key(l["title"]), []).append(l)

        for gkey, group in buckets.items():
            prices = [l["price"] for l in group]
            # An owner-set fair_value overrides the median for every bucket.
            fair = _num(item.fair_value)
            if fair is None and len(prices) < MIN_BUCKET:
                continue  # too few comps in this grade to trust a reference
            reference = fair or statistics.median(prices)
            alert = _num(item.alert_below) or reference * (1 - DEFAULT_DISCOUNT)

            # Cheapest listings in THIS bucket — shown in the app popup so the
            # owner eyeballs the going rate for the same grade before buying.
            samples = sorted(
                ({"t": l["title"], "p": l["price"], "u": l["url"]} for l in group),
                key=lambda s: s["p"])[:6]

            for l in group:
                if l["price"] > alert:
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
                    ref_count=len(prices),
                    grade_key=gkey,
                    seller_score=l.get("seller_score", 0),
                    seller_pct=l.get("seller_pct", 0.0),
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
        seller = it.get("seller", {}) or {}
        try:
            seller_score = int(seller.get("feedbackScore") or 0)
        except (TypeError, ValueError):
            seller_score = 0
        try:
            seller_pct = float(seller.get("feedbackPercentage") or 0)
        except (TypeError, ValueError):
            seller_pct = 0.0
        out.append({
            "title": it.get("title", ""),
            "price": _num(str(it.get("price", {}).get("value", ""))),
            "buying_option": "AUCTION" if is_auction else "FIXED_PRICE",
            "ends": ends,
            "snipe": bool(is_auction and _ends_soon(ends)),
            "url": it.get("itemWebUrl", ""),
            "image": image,
            "seller_score": seller_score,
            "seller_pct": seller_pct,
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
