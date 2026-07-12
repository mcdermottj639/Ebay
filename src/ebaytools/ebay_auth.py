"""Gets an access token from eBay so we can call their APIs.

eBay uses OAuth. There are two kinds of token:

  1. Application token  – for public, read-only data like searching sold items.
                          Needs only your App ID + Cert ID. Easy.
  2. User token         – for acting on YOUR account (creating listings).
                          Needs a one-time consent + a refresh token. See
                          docs/01-getting-ebay-api-keys.md.

This module handles both and caches tokens in memory so we don't ask eBay for
a new one on every call.
"""

from __future__ import annotations

import base64
import time

import requests

from . import config

# eBay OAuth "scopes" describe what the token is allowed to do.
SCOPE_PUBLIC = "https://api.ebay.com/oauth/api_scope"
SCOPE_SELL_INVENTORY = "https://api.ebay.com/oauth/api_scope/sell.inventory"

_cache: dict[str, tuple[str, float]] = {}  # key -> (token, expires_at_epoch)


class EbayAuthError(RuntimeError):
    pass


def _basic_auth_header() -> str:
    app_id = config.get("EBAY_APP_ID")
    cert_id = config.get("EBAY_CERT_ID")
    if not (app_id and cert_id):
        raise EbayAuthError(
            "Missing EBAY_APP_ID or EBAY_CERT_ID in your .env file. "
            "See docs/01-getting-ebay-api-keys.md."
        )
    raw = f"{app_id}:{cert_id}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def application_token(scope: str = SCOPE_PUBLIC) -> str:
    """Token for public/read-only calls (e.g. searching sold comps)."""
    cache_key = f"app::{scope}"
    cached = _cache.get(cache_key)
    if cached and cached[1] > time.time() + 60:
        return cached[0]

    resp = requests.post(
        config.auth_url(),
        headers={
            "Authorization": _basic_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={"grant_type": "client_credentials", "scope": scope},
        timeout=30,
    )
    _raise_for_ebay(resp)
    payload = resp.json()
    token = payload["access_token"]
    _cache[cache_key] = (token, time.time() + int(payload.get("expires_in", 7200)))
    return token


def user_token(scope: str = SCOPE_SELL_INVENTORY) -> str:
    """Token for acting on your account (creating/updating listings).

    Uses the refresh token you stored in .env to mint a fresh access token.
    """
    refresh = config.get("EBAY_USER_REFRESH_TOKEN")
    if not refresh:
        raise EbayAuthError(
            "Missing EBAY_USER_REFRESH_TOKEN in your .env file. This is the "
            "one-time consent step in docs/01-getting-ebay-api-keys.md — you "
            "only need it to CREATE listings, not to look up comps."
        )

    cache_key = f"user::{scope}"
    cached = _cache.get(cache_key)
    if cached and cached[1] > time.time() + 60:
        return cached[0]

    resp = requests.post(
        config.auth_url(),
        headers={
            "Authorization": _basic_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={"grant_type": "refresh_token", "refresh_token": refresh, "scope": scope},
        timeout=30,
    )
    _raise_for_ebay(resp)
    payload = resp.json()
    token = payload["access_token"]
    _cache[cache_key] = (token, time.time() + int(payload.get("expires_in", 7200)))
    return token


def _raise_for_ebay(resp: requests.Response) -> None:
    if resp.status_code >= 400:
        raise EbayAuthError(
            f"eBay auth failed ({resp.status_code}): {resp.text[:400]}"
        )
