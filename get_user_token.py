#!/usr/bin/env python3
"""Get a NEW eBay refresh token (the 'let Claude use my selling account' key).

You only need this if listing/revising from the app stops working. Run it and
follow the two steps it prints. Takes about a minute.

    python3 get_user_token.py

WHAT THIS IS
------------
eBay gives out two different things and they are easy to mix up:

  * an ACCESS token  — lasts 2 hours. The "Get a User Token Here" button on
                       eBay's developer site gives you THIS one. It is not
                       what we need; it expires the same afternoon.
  * a REFRESH token  — lasts about 18 months. This is the one we need. The
                       only way to get it is the consent link below.

The refresh token is a PASSWORD for your eBay selling account. Never paste it
into a chat, a code file, or a commit — it goes in the environment settings
only. This script prints it once, to your screen, and saves it nowhere.
"""

from __future__ import annotations

import sys
import urllib.parse

sys.path.insert(0, "src")

import requests  # noqa: E402

from ebaytools import config, ebay_auth  # noqa: E402

# Set up when the keyset was created. If eBay ever makes you redo the keyset,
# the new RuName is on the developer site under "User tokens" > "Get a Token
# from eBay via Your Application".
RUNAME = "Jack_McDermott-JackMcDe-CardVa-nawpzdw"

SCOPES = [
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.account",
]


def consent_url() -> str:
    app_id = config.get("EBAY_APP_ID")
    if not app_id:
        print("\n❌ I can't find your eBay App ID.")
        print("   Add EBAY_APP_ID (and EBAY_CERT_ID) first — see docs/01.\n")
        raise SystemExit(1)
    query = urllib.parse.urlencode(
        {
            "client_id": app_id,
            "redirect_uri": RUNAME,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "prompt": "login",
        }
    )
    return "https://auth.ebay.com/oauth2/authorize?" + query


def code_from(pasted: str) -> str:
    """Pull the ?code=... out of whatever the owner pasted back."""
    pasted = pasted.strip()
    if not pasted:
        return ""
    # They may paste the whole redirect URL, or just the code itself.
    if "code=" in pasted:
        query = urllib.parse.urlparse(pasted).query or pasted.split("?", 1)[-1]
        found = urllib.parse.parse_qs(query).get("code", [""])[0]
        # eBay URL-encodes the code; parse_qs already decoded it once.
        return found.strip()
    return pasted


def exchange(code: str) -> dict:
    resp = requests.post(
        config.auth_url(),
        headers={
            "Authorization": ebay_auth._basic_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": RUNAME,
        },
        timeout=30,
    )
    if resp.status_code >= 400:
        print(f"\n❌ eBay said no ({resp.status_code}):")
        print("   " + resp.text[:300])
        print("\n   The most common cause is that the code expired — it is only")
        print("   good for a few minutes. Just run this script again.\n")
        raise SystemExit(1)
    return resp.json()


def main() -> None:
    print("\n" + "=" * 68)
    print("GET A NEW EBAY REFRESH TOKEN")
    print("=" * 68)
    print("\nSTEP 1 — Open this link and sign in to eBay, then click Agree:\n")
    print(consent_url())
    print("\n  After you agree, eBay bounces you to a page that may look broken")
    print("  or say 'success'. That is fine and expected.")
    print("\nSTEP 2 — Copy the FULL web address of that page from your browser's")
    print("  address bar and paste it below. It is long and has 'code=' in it.\n")

    try:
        pasted = input("Paste the address here: ")
    except (EOFError, KeyboardInterrupt):
        print("\n\nStopped. Nothing changed.\n")
        raise SystemExit(1)

    code = code_from(pasted)
    if not code:
        print("\n❌ I couldn't find a code in that. It should contain 'code='.")
        print("   Run the script again and paste the whole address.\n")
        raise SystemExit(1)

    payload = exchange(code)
    refresh = payload.get("refresh_token", "")
    if not refresh:
        print("\n❌ eBay didn't return a refresh token. Try again.\n")
        raise SystemExit(1)

    months = round(int(payload.get("refresh_token_expires_in", 0)) / 2_592_000)
    print("\n" + "=" * 68)
    print("✅ DONE — here is your new refresh token")
    print("=" * 68)
    print(f"\n{refresh}\n")
    print(f"Good for about {months} months.")
    print("\nNOW SAVE IT:")
    print("  1. Open your Claude Code environment settings.")
    print("  2. Find EBAY_USER_REFRESH_TOKEN (or add it).")
    print("  3. Paste the whole thing above, WRAPPED IN DOUBLE QUOTES:")
    print('       EBAY_USER_REFRESH_TOKEN="v^1.1#i^1#..."')
    print("     The quotes matter. Without them the '#' cuts it short and")
    print("     nothing works — that is exactly what broke it last time.")
    print("\n  4. Check it worked:  python3 check_ebay_login.py")
    print("\nTreat this like a password. Don't paste it into a chat or a file.\n")


if __name__ == "__main__":
    main()
