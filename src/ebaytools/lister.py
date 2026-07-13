"""Pushes listings live to eBay using the modern Inventory + Offer API.

The flow eBay wants (all via the Sell APIs):

  1. createOrReplaceInventoryItem  – describe the card (title, specifics, condition, photos)
  2. createOffer                   – attach a price + business policies to that item
  3. publishOffer                  – make it go live and get a listing ID

This module wraps those three steps. It is SAFE by default: it runs in
"dry run" mode unless you explicitly pass dry_run=False, so you can see exactly
what would be sent before anything goes live.

Going live for real requires:
  - EBAY_USER_REFRESH_TOKEN (account consent — see docs/01)
  - Business policy IDs in .env (payment/shipping/return)
  - Production API access approved by eBay
"""

from __future__ import annotations

import json

import requests

from . import config, ebay_auth
from .catalog import Card
from .titles import build_description, build_item_specifics, build_title

# eBay condition codes for trading cards.
CONDITION_GRADED = "2750"      # "Graded"
CONDITION_UNGRADED = "4000"    # "Ungraded" / used

# Card photos live in docs/img/<SKU>.<ext> and are served publicly by GitHub
# Pages, so eBay can fetch them as listing images. Override the base with the
# SITE_IMAGE_BASE env var if the site URL ever changes.
_DEFAULT_IMAGE_BASE = "https://mcdermottj639.github.io/Ebay/img"
_IMG_EXTS = ("jpg", "jpeg", "png", "webp")


def image_urls_for(card: Card) -> list[str]:
    """Public HTTPS image URL(s) for a card, if a photo exists in docs/img/.

    eBay requires listing images to be publicly reachable; the live PWA already
    hosts them, so we reuse those exact URLs. Returns [] when there's no photo.
    """
    base = (config.get("SITE_IMAGE_BASE") or _DEFAULT_IMAGE_BASE).rstrip("/")
    for ext in _IMG_EXTS:
        if (config.PROJECT_ROOT / "docs" / "img" / f"{card.sku}.{ext}").exists():
            return [f"{base}/{card.sku}.{ext}"]
    return []


def build_inventory_item(card: Card, image_urls: list[str] | None = None) -> dict:
    """The JSON body for step 1 (createOrReplaceInventoryItem)."""
    specifics = build_item_specifics(card)
    condition = CONDITION_GRADED if card.is_graded() else CONDITION_UNGRADED
    quantity = int(card.quantity) if card.quantity.isdigit() else 1

    return {
        "product": {
            "title": build_title(card),
            "description": build_description(card),
            "aspects": specifics,
            "imageUrls": image_urls or [],
        },
        "condition": condition,
        "availability": {"shipToLocationAvailability": {"quantity": quantity}},
    }


def build_offer(card: Card) -> dict:
    """The JSON body for step 2 (createOffer)."""
    price = card.asking_price.replace("$", "").replace(",", "").strip() or "0"
    return {
        "sku": card.sku,
        "marketplaceId": "EBAY_US",
        "format": "FIXED_PRICE",
        "availableQuantity": int(card.quantity) if card.quantity.isdigit() else 1,
        "categoryId": _category_for(card),
        "listingDescription": build_description(card),
        "pricingSummary": {"price": {"currency": "USD", "value": price}},
        "listingPolicies": {
            "fulfillmentPolicyId": config.get("EBAY_FULFILLMENT_POLICY_ID"),
            "paymentPolicyId": config.get("EBAY_PAYMENT_POLICY_ID"),
            "returnPolicyId": config.get("EBAY_RETURN_POLICY_ID"),
        },
        "merchantLocationKey": config.get("EBAY_MERCHANT_LOCATION_KEY"),
    }


def publish_card(card: Card, image_urls: list[str] | None = None, dry_run: bool = True) -> dict:
    """Run all three steps for one card.

    dry_run=True (default) prints the exact requests without sending them.
    dry_run=False actually creates the live listing (needs full setup).
    """
    if not card.sku:
        raise ValueError("Card has no SKU — every card needs a unique SKU to list.")
    if not card.asking_price:
        raise ValueError(f"{card.sku}: no asking_price set. Add one before listing.")

    # Auto-attach the card's live-site photo(s) when the caller didn't specify.
    if image_urls is None:
        image_urls = image_urls_for(card)

    inv_body = build_inventory_item(card, image_urls)
    offer_body = build_offer(card)

    if dry_run:
        return {
            "sku": card.sku,
            "dry_run": True,
            "would_send": {
                "1_inventory_item": inv_body,
                "2_offer": offer_body,
                "3_publish": f"POST /sell/inventory/v1/offer/<offerId>/publish",
            },
        }

    _require_live_setup()
    token = ebay_auth.user_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Content-Language": "en-US",
    }
    base = config.api_base()

    # Step 1: create/replace the inventory item (keyed by SKU)
    r1 = requests.put(
        f"{base}/sell/inventory/v1/inventory_item/{card.sku}",
        headers=headers, data=json.dumps(inv_body), timeout=30,
    )
    _check(r1, "createOrReplaceInventoryItem")

    # Step 2: create the offer
    r2 = requests.post(
        f"{base}/sell/inventory/v1/offer",
        headers=headers, data=json.dumps(offer_body), timeout=30,
    )
    _check(r2, "createOffer")
    offer_id = r2.json().get("offerId")

    # Step 3: publish
    r3 = requests.post(
        f"{base}/sell/inventory/v1/offer/{offer_id}/publish",
        headers=headers, timeout=30,
    )
    _check(r3, "publishOffer")

    return {"sku": card.sku, "dry_run": False, "offerId": offer_id, "result": r3.json()}


def _require_live_setup() -> None:
    needed = {
        "EBAY_USER_REFRESH_TOKEN": "account consent token",
        "EBAY_FULFILLMENT_POLICY_ID": "shipping policy",
        "EBAY_PAYMENT_POLICY_ID": "payment policy",
        "EBAY_RETURN_POLICY_ID": "return policy",
        "EBAY_MERCHANT_LOCATION_KEY": "inventory location",
    }
    missing = [f"{k} ({why})" for k, why in needed.items() if not config.get(k)]
    if missing:
        raise RuntimeError(
            "Can't go live yet — still missing:\n  - " + "\n  - ".join(missing)
            + "\nSee docs/04-creating-listings.md. Use dry_run=True to preview meanwhile."
        )


def _category_for(card: Card) -> str:
    """eBay leaf category ID (US site). Cards vs. autographed memorabilia differ.

    Merch IDs are approximate defaults — confirm the exact leaf category at
    listing time (once keys are in) with eBay's getCategorySuggestions.
    """
    if card.is_merch():
        return {              # Sports Mem > Autographs-Original > by sport
            "Football": "1521",   # Football-NFL autographs
            "Basketball": "2926",
            "Baseball": "1525",
            "Hockey": "2870",
        }.get(card.sport.strip().title(), "64482")  # 64482 = Sports Mem/Fan Shop
    return {
        "Baseball": "213",
        "Basketball": "214",
        "Football": "215",
        "Hockey": "216",
        "Soccer": "183444",
    }.get(card.sport.strip().title(), "212")  # 212 = Sports Trading Cards (general)


def _check(resp: requests.Response, step: str) -> None:
    if resp.status_code >= 400:
        raise RuntimeError(f"eBay {step} failed ({resp.status_code}): {resp.text[:500]}")
