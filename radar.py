#!/usr/bin/env python3
"""Profit-first Buy Radar. Public research: --evidence-only; keyed discovery: default.
Reviewed sources: data/buy_research.json. No purchases or inventory/listing writes.
"""
import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from ebaytools.buy_radar import snapshot

def check_connection():
    """Read-only readiness/probe; never print credentials or token responses."""
    from ebaytools import config
    result = {"production_configured": config.env() == "production",
              "credentials_present": config.have_api_keys(),
              "browse": "not_tested", "sold_history": "not_tested"}
    if not result["credentials_present"]:
        result["browse"] = "credentials_unavailable"
        return result
    if not result["production_configured"]:
        result["browse"] = "production_not_configured"
        return result
    try:
        from ebaytools import deals, ebay_auth
    except ImportError:
        result["browse"] = "dependencies_unavailable"
        return result
    try:
        token = ebay_auth.application_token()
        deals._search(token, "2021 Prizm Cade Cunningham Pink Ice 282 PSA 10", 1)
        result["browse"] = "connected"
    except Exception:
        result["browse"] = "connection_failed"
    # A general API announcement does not prove permission for sold-price data.
    result["sold_history"] = "separate_access_required_unverified"
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-only", action="store_true", help="Evaluate saved research; no API discovery")
    parser.add_argument("--check-connection", action="store_true", help="Read-only production Browse readiness/probe; no snapshot writes")
    args = parser.parse_args()
    if args.check_connection:
        result = check_connection()
        print(json.dumps(result, indent=2))
        return 0 if result["browse"] == "connected" else 1
    data = ROOT / "data"
    policy = json.loads((data / "buy_policy.json").read_text())
    research = json.loads((data / "buy_research.json").read_text()) if (data / "buy_research.json").exists() else {"candidates": []}
    with (data / "watchlist.csv").open() as f:
        targets = list(csv.DictReader(f))
    candidates = list(research.get("candidates", []))
    coverage = {"mode": "reviewed public research", "notes": research.get("coverage_notes", ""),
                "researched_at": research.get("researched_at"), "queries_run": research.get("queries_run", []),
                "api_queries": 0, "api_errors": [], "complete_market_coverage": False,
                "api_access": research.get("api_access", {}), "run_log": research.get("run_log", [])}
    now = datetime.now(timezone.utc)
    if not args.evidence_only:
        try:
            from ebaytools import config, deals, ebay_auth
        except ImportError:
            print("API dependencies unavailable. Install requirements.txt or use --evidence-only. Snapshot unchanged.")
            return 1
        if not config.have_api_keys():
            print("eBay API keys unavailable. Snapshot unchanged. Public research: --evidence-only.")
            return 1
        if config.env() != "production":
            print("Production eBay environment is not configured. Sandbox data cannot enter Buy Radar. Snapshot unchanged.")
            return 1
        try:
            token = ebay_auth.application_token()
        except Exception:
            print("eBay authentication failed. Snapshot unchanged; check authorized configuration privately.")
            return 1
        coverage["mode"] = "Browse discovery plus reviewed evidence"
        by_url = {c["url"]: c for c in candidates if c.get("url")}
        fresh = []
        for target in targets:
            try:
                listings = deals._search(token, target["query"], 50, price_min=25,
                                         price_max=float(target.get("price_max") or 1000))
                coverage["api_queries"] += 1
            except Exception:
                coverage["api_errors"].append(target["label"])
                continue
            for item in listings:
                title = item["title"]
                if not deals._is_single_card(title) or deals._is_junk(title) or deals._is_oversized(title):
                    continue
                if not deals._matches_query(target["query"], title):
                    continue
                old = by_url.get(item["url"], {})
                reviewed = dict(old) if old.get("item_title") == title else {}
                reviewed.update(item)
                reviewed.update({"item_title": title, "label": target["label"], "category": target.get("category", "rookies"),
                                 "sport": target.get("sport", ""), "query": target["query"],
                                 "checked_at": now.isoformat(), "page_state": "active",
                                 "listing_id": deals._item_id(item["url"]), "currency": item.get("currency", "USD")})
                fresh.append(reviewed)
        if not coverage["api_queries"]:
            print("All Browse searches failed. Snapshot unchanged.")
            return 1
        fresh_ids = {c.get("listing_id") for c in fresh}
        candidates = fresh + [c for c in candidates if c.get("listing_id") not in fresh_ids]
    result = snapshot(candidates, policy, len(targets), coverage, now)
    path = data / "radar_snapshot.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, indent=2) + "\n")
    temporary.replace(path)
    print(json.dumps({"mode": coverage["mode"], "targets": len(targets), "listings_evaluated": result["scanned"],
                      "summary": result["summary"], "api_errors": coverage["api_errors"]}, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

