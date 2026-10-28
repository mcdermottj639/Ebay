"""Evidence-gated card sourcing. Standard library; never buys or reprices inventory."""
from __future__ import annotations

import math
import statistics
from datetime import datetime, timezone

IDENTITY_FIELDS = ("year", "set", "player", "number", "parallel", "print_run",
                   "autograph", "relic", "grader", "grade")


def instant(value):
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None


def identity_key(identity):
    # Explicit 'base', 'none', and 'raw' are required; absent means unknown.
    if not isinstance(identity, dict) or any(identity.get(k) in (None, "") for k in IDENTITY_FIELDS):
        return None
    return tuple(str(identity[k]).strip().lower() for k in IDENTITY_FIELDS)


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def requirements(cost, days, policy):
    tier = next(t for t in policy["tiers"] if t["below"] is None or cost < t["below"])
    slower = days > 60
    return tier["profit"] * (1.5 if slower else 1), tier["roi"] + (0.10 if slower else 0)


def economics(resale, all_in, days, policy):
    """All-in already includes purchase tax/shipping. No duplicate acquisition fee."""
    fee_base = resale * (1 + policy["resale_buyer_tax_rate"])
    fee = (min(fee_base, policy["fee_threshold"]) * policy["fee_rate"]
           + max(0, fee_base - policy["fee_threshold"]) * policy["fee_rate_above"]
           + policy["per_order_fee"])
    promotion = fee_base * policy["promotion_reserve_rate"]
    shipping = policy["outbound_shipping_premium"] if resale > 500 else policy["outbound_shipping"]
    reserve = max(policy["contingency_min"], resale * policy["contingency_rate"])
    labor = policy["labor_hours"] * policy["hourly_value"]
    capital = all_in * policy["annual_capital_hurdle"] * days / 365
    cash = resale - all_in - fee - promotion - shipping - policy["supplies"]
    adjusted = cash - reserve - labor - capital
    minimum, roi = requirements(all_in, days, policy)
    return {
        "resale": resale, "acquisition": all_in, "selling_fee": fee,
        "promotion_reserve": promotion, "outbound_shipping": shipping,
        "supplies": policy["supplies"], "contingency": reserve,
        "labor_allowance": labor, "capital_allowance": capital,
        "cash_margin": cash, "adjusted_profit": adjusted,
        "roi": adjusted / all_in if all_in else 0,
        "minimum_profit": minimum, "minimum_roi": roi,
        "passes": adjusted >= minimum and adjusted >= all_in * roi,
    }


def max_buy(resale, days, policy):
    # Integer-cent search handles tier jumps conservatively (e.g. $99.99/$100).
    lo, hi = 0, int(resale * 100)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if economics(resale, mid / 100, days, policy)["passes"]:
            lo = mid
        else:
            hi = mid - 1
    return lo / 100


def sale_evidence(candidate, now, policy):
    key = identity_key(candidate.get("identity"))
    used, excluded, seen = [], [], set()
    for s in candidate.get("sales", []):
        dt = instant(s.get("date"))
        sale_id = s.get("sale_id")
        reason = None
        if not key or identity_key(s.get("identity")) != key or not s.get("exact_match_reviewed"):
            reason = "identity/grade/parallel not an exact reviewed match"
        elif s.get("price_type") != "sold" or not s.get("amount_confirmed"):
            reason = "asking/guide or unknown accepted amount"
        elif s.get("currency") != "USD" or not finite(s.get("price")) or s["price"] <= 0:
            reason = "invalid price/currency"
        elif not dt or not 0 <= (now - dt).total_seconds() / 86400 <= policy["sales_window_days"]:
            reason = "outside evidence window"
        elif not sale_id or not s.get("url"):
            reason = "missing sale provenance"
        elif sale_id in seen:
            reason = "duplicate sale"
        if reason:
            excluded.append({"sale_id": sale_id, "reason": reason})
            continue
        seen.add(sale_id)
        used.append(s)
    used.sort(key=lambda s: instant(s["date"]), reverse=True)
    primary_sales = [s for s in used if s.get("source_type") == "primary"]
    primary = len(primary_sales)
    age = (now - instant(used[0]["date"])).total_seconds() / 86400 if used else None
    primary_age = (now - instant(primary_sales[0]["date"])).total_seconds() / 86400 if primary_sales else None
    confidence = "medium" if primary >= policy["min_primary_sales"] and primary_age <= policy["freshest_sale_days"] else "low"
    # Secondary data cannot inflate a qualified valuation or refresh old primary sales.
    valuation_sales = primary_sales if confidence == "medium" else used
    prices = sorted(s["price"] for s in valuation_sales)
    # Two prices support only a provisional research scenario; never a qualified buy.
    resale = min(prices[math.floor((len(prices) - 1) * .25)], statistics.median(prices) * .9) if len(prices) >= 2 else None
    return {"sales": used, "excluded": excluded, "count": len(used), "primary_count": primary,
            "freshest_days": round(age, 1) if age is not None else None,
            "freshest_primary_days": round(primary_age, 1) if primary_age is not None else None,
            "valuation_basis": "primary only" if confidence == "medium" else "provisional reported sales",
            "range": [min(prices), max(prices)] if prices else None,
            "median": statistics.median(prices) if prices else None,
            "conservative_resale": round(resale, 2) if resale is not None else None,
            "confidence": confidence}


def evaluate(candidate, policy, now=None):
    now = now or datetime.now(timezone.utc)
    c = dict(candidate)
    evidence = sale_evidence(c, now, policy)
    c["evidence"] = evidence
    reasons = list(c.get("warnings", []))
    days = c.get("hold_days", policy["default_hold_days"])
    if not finite(days) or days < 1:
        days = policy["default_hold_days"]
    c["hold_days"] = days
    c["hold_basis"] = c.get("hold_basis") or "Planning scenario; sale time is not established"
    listing_age = instant(c.get("checked_at"))
    if not listing_age or not 0 <= (now - listing_age).total_seconds() / 3600 <= policy["listing_max_age_hours"]:
        reasons.append("Listing observation is stale or undated")
    if c.get("page_state") != "active":
        reasons.append("Listing is sold/ended or current availability is unverified")
    if c.get("buying_option") != "FIXED_PRICE":
        reasons.append("Auction bid is not a buy-now acquisition price")
    if not identity_key(c.get("identity")) or not c.get("identity_reviewed"):
        reasons.append("Exact card identity needs review")
    if not c.get("condition_reviewed"):
        reasons.append("Card/slab condition needs photo review")
    if (c.get("seller_score") or 0) < 100 or (c.get("seller_pct") or 0) < 99:
        reasons.append("Seller track record is missing or below screening minimum")
    if evidence["confidence"] != "medium":
        reasons.append("Need 3 exact primary sold prices within 90 days, including one within 30 days")
    if days > 120:
        reasons.append("Planned hold exceeds 120 days")
    shipping = c.get("shipping")
    price = c.get("price")
    if not finite(price) or price <= 0 or c.get("currency") != "USD":
        reasons.append("USD acquisition price is missing")
    if not finite(shipping) or shipping < 0:
        reasons.append("Incoming shipping is unknown")
    all_in = (price + shipping) * (1 + policy["purchase_tax_rate"]) + c.get("grading_cost", 0) if finite(price) and finite(shipping) and price > 0 and shipping >= 0 else None
    c["all_in"] = round(all_in, 2) if all_in is not None else None
    c["economics"] = None
    c["max_all_in"] = None
    c["max_offer"] = None
    c["opening_offer"] = None
    if evidence["conservative_resale"] is not None:
        resale = evidence["conservative_resale"]
        ceiling = max_buy(resale, days, policy)
        c["max_all_in"] = ceiling
        if finite(shipping) and shipping >= 0:
            offer = max(0, (ceiling - c.get("grading_cost", 0)) / (1 + policy["purchase_tax_rate"]) - shipping)
            c["max_offer"] = math.floor(offer * 100) / 100
            c["opening_offer"] = math.floor(offer * .85)
        if all_in is not None:
            result = economics(resale, all_in, days, policy)
            c["economics"] = {k: round(v, 2) if isinstance(v, float) else v for k, v in result.items()}
            stress = economics(resale * .85, all_in, min(180, days + 60), policy)
            c["stress_profit"] = round(stress["adjusted_profit"], 2)
    if all_in and all_in > policy["default_max_all_in"]:
        reasons.append("Above $500 normal all-in limit; individual exception review")
    if all_in and all_in > policy["exception_max_all_in"]:
        reasons.append("Premium watchlist only")
    if not reasons and c["economics"] and c["economics"]["passes"]:
        c["status"] = "qualified"
    elif c.get("page_state") in ("sold", "ended", "mismatch"):
        c["status"] = "excluded"
    elif c["economics"] and not c["economics"]["passes"]:
        c["status"] = "pass"
        reasons.insert(0, "Fails net-profit and/or return hurdle at this asking price")
    else:
        c["status"] = "research"
    c["reasons"] = list(dict.fromkeys(reasons))
    c["ceiling_label"] = "Evidence-backed ceiling" if evidence["confidence"] == "medium" else "Provisional scenario only — not a buy recommendation"
    return c


def snapshot(candidates, policy, watch_count, coverage, now=None):
    now = now or datetime.now(timezone.utc)
    seen, rows = set(), []
    for c in candidates:
        key = c.get("listing_id") or c.get("url")
        if not key or key in seen:
            continue
        seen.add(key)
        rows.append(evaluate(c, policy, now))
    order = {"qualified": 0, "research": 1, "pass": 2, "excluded": 3}
    rows.sort(key=lambda r: (order[r["status"]], -((r.get("economics") or {}).get("adjusted_profit", -99999) / r["hold_days"])))
    qualified = [r for r in rows if r["status"] == "qualified"]
    return {"schema_version": 2, "as_of": now.isoformat(), "watch_count": watch_count,
            "scanned": len(rows), "shown": len(qualified), "deals": qualified,
            "candidates": rows, "coverage": coverage, "policy": policy,
            "price_min": 25, "price_max": policy["default_max_all_in"],
            "summary": {s: sum(r["status"] == s for r in rows) for s in order}}
