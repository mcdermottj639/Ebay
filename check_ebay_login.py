#!/usr/bin/env python3
"""Check your eBay SELLING connection (the user token for listing).

This does NOT list anything. It just asks eBay for a fresh access token using
the refresh token you set up, and tells you plainly whether it worked — so you
can confirm the one-time consent step before you ever try to go live.

Run it with:   python3 check_ebay_login.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import config, ebay_auth  # noqa: E402

# The extra bits (beyond the token) that a real "go live" listing also needs.
POLICY_KEYS = {
    "EBAY_FULFILLMENT_POLICY_ID": "Shipping policy",
    "EBAY_PAYMENT_POLICY_ID": "Payment policy",
    "EBAY_RETURN_POLICY_ID": "Return policy",
    "EBAY_MERCHANT_LOCATION_KEY": "Item location",
}


def main() -> int:
    print("Checking your eBay selling connection...\n")
    print(f"  Environment: {config.env()}")

    if not config.have_api_keys():
        print("\n❌ Your basic eBay keys (App ID / Cert ID) aren't set yet.")
        print("   Do Step 2 in docs/01-getting-ebay-api-keys.md first.")
        return 1

    if not config.get("EBAY_USER_REFRESH_TOKEN"):
        print("\n❌ No selling token yet (EBAY_USER_REFRESH_TOKEN is blank).")
        print("   This is the one-time consent step — follow Step 3 in")
        print("   docs/01-getting-ebay-api-keys.md, then run this again.")
        return 1

    try:
        token = ebay_auth.user_token()
    except ebay_auth.EbayAuthError as e:
        print("\n❌ eBay rejected the selling token.")
        print(f"   {e}")
        print("\n   Most common causes: the refresh token was copied wrong, it")
        print("   was minted in a different environment (sandbox vs production),")
        print("   or it has expired. Re-do Step 3 to get a fresh one.")
        return 1

    print(f"\n✅ Your eBay selling connection works — token minted ({len(token)} chars).")
    print("   The app can now act on your account (create listings).")

    # Listings also reference your business policies — flag any that are missing
    # so "go live" doesn't fail later for a separate reason.
    missing = [name for key, name in POLICY_KEYS.items() if not config.get(key)]
    if missing:
        print("\n⚠️  Before a REAL listing will publish, you still need:")
        for name in missing:
            print(f"     • {name}")
        print("   These are your eBay business policies (Step 4 in docs/01).")
        print("   Tip: once the token works, just ask Claude to fetch these for you.")
    else:
        print("\n✅ Business policies are set too — you're ready to try a live listing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
