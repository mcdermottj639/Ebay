#!/usr/bin/env python3
"""Generate the web app's data from your catalog.

Writes:
  docs/data.json      — the live data the Card Vault PWA reads (served by GitHub Pages)
  output/preview.html — a single self-contained file (data + CSS + JS inlined) so
                        you can preview the exact app look locally or via a shared link

Run it with:   python3 build_web.py
"""

import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import catalog, titles  # noqa: E402

ROOT = Path(__file__).parent
DOCS = ROOT / "docs"
OUTPUT = ROOT / "output"
DATA = ROOT / "data"


def _num(v: str) -> float:
    try:
        return float(str(v).replace("$", "").replace(",", "").strip())
    except ValueError:
        return 0.0


def _money(cards, field):
    return sum(_num(getattr(c, field)) for c in cards)


def _status(card):
    return "priced" if card.asking_price.strip() else "needs_price"


# Image types we recognize in docs/img/, best-quality first.
_IMG_EXTS = ("jpg", "jpeg", "png", "webp")


def _image_for(sku):
    """Relative path to a card's photo if one exists in docs/img/<sku>.<ext>.

    Owner just drops a photo named after the SKU — no spreadsheet edit. Returns
    "" when there's no photo, so the app falls back to a themed placeholder.
    """
    for ext in _IMG_EXTS:
        if (DOCS / "img" / f"{sku}.{ext}").exists():
            return f"./img/{sku}.{ext}"
    return ""


def _price_basis(card):
    """'sold' (real sold comps), 'est_sold' (asking comps, haircut to estimate
    market), 'asking' (active listings), or '' if unpriced."""
    basis = card.price_basis.strip().lower()
    if basis in ("sold", "est_sold", "asking"):
        return basis
    return "asking" if card.asking_price.strip() else ""


def _line(card):
    """The grey subtitle line shown under the player name in the app."""
    if card.is_merch():
        return " · ".join([p for p in [card.team, card.item_type] if p])
    num = ("#" + card.card_number) if card.card_number else ""
    return " ".join([p for p in [card.year, card.brand, card.set, num, card.parallel] if p])


# "PSA cert 83143720" / "cert #1W622369" in the notes → cert number for links.
_CERT_RE = re.compile(r"cert(?:ificate)?\s*#?\s*([A-Za-z0-9]{6,})", re.IGNORECASE)


def _cert_for(card):
    m = _CERT_RE.search(card.notes or "")
    return m.group(1) if m else ""


def _price_changes():
    """Per-SKU price movement from data/price_history.csv (written by
    reprice.py). Compares today's price to the oldest snapshot within the
    last ~8 days (so weekly runs show week-over-week movement)."""
    path = DATA / "price_history.csv"
    if not path.exists():
        return {}
    today = datetime.now(timezone.utc).date()
    per_sku: dict[str, list] = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                d = datetime.strptime(row["date"], "%Y-%m-%d").date()
            except (KeyError, ValueError):
                continue
            age = (today - d).days
            price = _num(row.get("price", ""))
            if price > 0 and 0 < age <= 8:
                per_sku.setdefault(row.get("sku", ""), []).append((age, price))
    changes = {}
    for sku, obs in per_sku.items():
        obs.sort(reverse=True)          # oldest (largest age) first
        changes[sku] = {"prev": obs[0][1], "since": f"{obs[0][0]}d"}
    return changes


def _price_series():
    """Per-SKU price-over-time series from data/price_history.csv (written by
    reprice.py). Returns {sku: [{d, p}, ...]} sorted oldest→newest, one point
    per date (last write wins for a day), capped to the most recent ~60 so the
    Sales Map sparklines stay light. Grows automatically as weekly reprice runs
    append snapshots — with <2 points a card just shows 'tracking started'."""
    path = DATA / "price_history.csv"
    if not path.exists():
        return {}
    per_sku: dict[str, dict] = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            sku = (row.get("sku") or "").strip()
            date = (row.get("date") or "").strip()
            price = _num(row.get("price", ""))
            if not sku or not date or price <= 0:
                continue
            per_sku.setdefault(sku, {})[date] = price  # last write per day wins
    series = {}
    for sku, by_date in per_sku.items():
        pts = [{"d": d, "p": round(by_date[d], 2)} for d in sorted(by_date)]
        series[sku] = pts[-60:]
    return series


def _market():
    """Latest market reference per SKU from data/price_history.csv — the comps
    median reprice.py saw and how many listings backed it. This is the "usually
    going for" number. NOTE: eBay denied us real SOLD comps (Marketplace
    Insights), so this is the ASKING market (active listings); our est_sold
    asking_price already haircuts it. Count matters — a thin count (few
    listings) means the median is noisy, so the app shows it and holds back the
    'room to' suggestion."""
    path = DATA / "price_history.csv"
    if not path.exists():
        return {}
    latest: dict[str, tuple] = {}  # sku -> (date, median, count)
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            sku = (row.get("sku") or "").strip()
            date = (row.get("date") or "").strip()
            median = _num(row.get("median", ""))
            try:
                count = int(float(row.get("count", "") or 0))
            except ValueError:
                count = 0
            if not sku or median <= 0:
                continue
            if sku not in latest or date > latest[sku][0]:
                latest[sku] = (date, median, count)
    return {sku: {"median": round(m, 2), "count": c} for sku, (d, m, c) in latest.items()}


def _comps_snapshot():
    """Per-SKU comp listings saved by reprice.py (data/comps_snapshot.json).
    Returns ({sku: {source, broad, items}}, as_of_date)."""
    path = DATA / "comps_snapshot.json"
    if not path.exists():
        return {}, ""
    try:
        snap = json.loads(path.read_text(encoding="utf-8"))
        return snap.get("cards", {}), snap.get("as_of", "")
    except ValueError:
        return {}, ""


def _radar_snapshot():
    """Buy Radar deals saved by radar.py (data/radar_snapshot.json).
    Returns {as_of, watch_count, deals:[...]} — the app's 🔎 Buy Radar tab.
    Absent until the first keyed radar run, so the tab shows a friendly note."""
    path = DATA / "radar_snapshot.json"
    empty = {"as_of": "", "watch_count": 0, "scanned": 0, "shown": 0, "deals": []}
    if not path.exists():
        return empty
    try:
        snap = json.loads(path.read_text(encoding="utf-8"))
        deals = snap.get("deals", [])
        return {
            "as_of": snap.get("as_of", ""),
            "watch_count": snap.get("watch_count", 0),
            "price_min": snap.get("price_min", 0),
            "price_max": snap.get("price_max", 0),
            "scanned": snap.get("scanned", len(deals)),
            "shown": snap.get("shown", len(deals)),
            "deals": deals,
        }
    except ValueError:
        return empty


def _targets():
    """The owner's buy watchlist (data/watchlist.csv) for the Targets tab."""
    path = DATA / "watchlist.csv"
    if not path.exists():
        return []
    out = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            label = (row.get("label") or "").strip()
            if not label:
                continue
            out.append({
                "label": label,
                "query": (row.get("query") or "").strip(),
                "fair_value": _num(row.get("fair_value", "")) or "",
                "alert_below": _num(row.get("alert_below", "")) or "",
                "notes": (row.get("notes") or "").strip(),
            })
    return out


def _grade_bucket(card):
    if card.is_merch():
        return ""
    if card.is_graded() and card.grader and card.grade:
        return f"{card.grader.upper()} {card.grade}"
    return "Raw"


def _history(total_value: float, n_cards: int) -> list:
    """Daily value snapshots, carried forward from the previous data.json.

    One entry per day ({d, v, n}); rebuilding on the same day updates that
    day's entry. Feeds the app's value-trend chart. Because data.json is
    committed, the GitHub Actions rebuild carries history forward too.
    """
    try:
        history = json.loads((DOCS / "data.json").read_text(encoding="utf-8")).get("history", [])
    except (OSError, ValueError):
        history = []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    entry = {"d": today, "v": round(total_value, 2), "n": n_cards}
    if history and history[-1].get("d") == today:
        history[-1] = entry
    else:
        history.append(entry)
    return history[-730:]  # keep ~2 years of dailies


def build_data(cards) -> dict:
    unsold = [c for c in cards if not c.is_sold()]
    sold = [c for c in cards if c.is_sold()]

    by_sport: dict[str, int] = {}
    sport_value: dict[str, float] = {}
    for c in unsold:
        if c.sport:
            by_sport[c.sport] = by_sport.get(c.sport, 0) + 1
            sport_value[c.sport] = sport_value.get(c.sport, 0.0) + _num(c.asking_price)
    sport_stats = sorted(
        ({"name": k, "count": by_sport[k], "value": round(sport_value.get(k, 0.0), 2)}
         for k in by_sport),
        key=lambda s: -s["value"])

    grades: dict[str, dict] = {}
    for c in unsold:
        b = _grade_bucket(c)
        if not b:
            continue
        g = grades.setdefault(b, {"name": b, "count": 0, "value": 0.0})
        g["count"] += 1
        g["value"] = round(g["value"] + _num(c.asking_price), 2)
    grade_stats = sorted(grades.values(), key=lambda g: -g["value"])

    total_cost = _money(cards, "cost")
    total_value = _money(unsold, "asking_price")   # estimated value of what you still HOLD
    revenue = _money(sold, "sold_price")
    realized = revenue - _money(sold, "cost")

    # Unrealized profit only over the cards where we actually KNOW the cost —
    # otherwise a blank cost reads as $0 and profit == full value (misleading).
    costed = [c for c in unsold if c.asking_price.strip() and _num(c.cost) > 0]
    profit_known = _money(costed, "asking_price") - _money(costed, "cost")
    changes = _price_changes()
    series_by_sku = _price_series()
    market_by_sku = _market()
    comps_by_sku, comps_as_of = _comps_snapshot()

    return {
        "history": _history(total_value, len(unsold)),
        "generated": datetime.now(timezone.utc).strftime("%b %d, %Y · %H:%M UTC"),
        "targets": _targets(),
        "radar": _radar_snapshot(),
        "summary": {
            "total_cards": len(cards),
            "merch": sum(1 for c in cards if c.is_merch()),
            "physical": sum(int(c.quantity) for c in cards if c.quantity.isdigit()),
            "rookies": sum(1 for c in cards if c.is_rookie()),
            "autos": sum(1 for c in cards if c.is_auto()),
            "graded": sum(1 for c in cards if c.is_graded()),
            "priced": sum(1 for c in unsold if c.asking_price.strip()),
            "total_cost": round(total_cost, 2),
            "total_value": round(total_value, 2),
            "profit": round(profit_known, 2),          # only over cards with a cost
            "cost_count": len(costed),                 # how many priced cards have cost
            "listed": sum(1 for c in cards if c.is_listed()),
            "sold": len(sold),
            "revenue": round(revenue, 2),
            "realized_profit": round(realized, 2),
            "by_sport": by_sport,
            "sport_stats": sport_stats,
            "grade_stats": grade_stats,
        },
        "cards": [
            {
                "sku": c.sku, "item_type": c.item_type or "Card",
                "is_merch": c.is_merch(), "sport": c.sport, "year": c.year,
                "brand": c.brand, "set": c.set, "player": c.player,
                "card_number": c.card_number, "parallel": c.parallel,
                "insert": c.insert, "team": c.team, "league": c.league,
                "rookie": c.is_rookie(), "auto": c.is_auto(), "graded": c.is_graded(),
                "relic": c.is_relic(), "grader": c.grader, "grade": c.grade,
                "serial_run": c.serial_run, "condition": c.condition,
                "authentication": c.grader if c.is_merch() else "",
                "cost": c.cost, "asking_price": c.asking_price, "notes": c.notes,
                "price_basis": _price_basis(c), "image": _image_for(c.sku),
                "line": _line(c), "title": titles.build_title(c), "status": _status(c),
                "listed": c.is_listed(), "sold": c.is_sold(),
                "sold_price": _num(c.sold_price) if c.is_sold() else "",
                "sold_date": c.sold_date, "cert": _cert_for(c),
                "prev_price": changes.get(c.sku, {}).get("prev", ""),
                "price_series": series_by_sku.get(c.sku, []),
                "market": market_by_sku.get(c.sku),
                "comps": ({"as_of": comps_as_of,
                           "source": comps_by_sku[c.sku].get("source", "active"),
                           "broad": comps_by_sku[c.sku].get("broad", False),
                           "items": comps_by_sku[c.sku].get("items", [])[:5]}
                          if c.sku in comps_by_sku else None),
            }
            for c in cards
        ],
    }


def main() -> int:
    try:
        cards = catalog.load()
    except FileNotFoundError as e:
        print(e)
        return 1

    data = build_data(cards)
    DOCS.mkdir(exist_ok=True)
    (DOCS / "data.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Wrote {DOCS/'data.json'} ({data['summary']['total_cards']} cards)")

    # Self-contained preview: inline the same CSS + JS + data into one file.
    css = (DOCS / "styles.css").read_text(encoding="utf-8") if (DOCS / "styles.css").exists() else ""
    appjs = (DOCS / "app.js").read_text(encoding="utf-8") if (DOCS / "app.js").exists() else ""
    if css and appjs:
        # A <title> makes the file publishable as an Artifact (a hosted page the
        # owner can actually open — raw HTML files preview without running JS).
        preview = (
            "<title>Card Vault — Preview</title>\n"
            "<style>\n" + css + "\n</style>\n<div id=\"root\"></div>\n"
            "<script>window.__CARD_DATA__=" + json.dumps(data) + ";\n" + appjs + "\n</script>"
        )
        OUTPUT.mkdir(exist_ok=True)
        (OUTPUT / "preview.html").write_text(preview, encoding="utf-8")
        print(f"Wrote {OUTPUT/'preview.html'} (self-contained preview)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
