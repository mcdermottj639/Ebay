"""Loads your settings and secret keys from the .env file.

Nothing here is secret on its own — the actual secrets live in your local
.env file, which is never committed to GitHub.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - friendly message if deps not installed
    load_dotenv = None

# Project root = two folders up from this file (src/ebaytools/config.py -> project root)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "output"
INVENTORY_CSV = DATA_DIR / "inventory.csv"

# Load .env (if present) so os.environ has your keys.
if load_dotenv is not None:
    load_dotenv(PROJECT_ROOT / ".env")

# eBay API hostnames differ between the practice ("sandbox") and real ("production") sites.
_HOSTS = {
    "sandbox": {
        "api": "https://api.sandbox.ebay.com",
        "auth": "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    },
    "production": {
        "api": "https://api.ebay.com",
        "auth": "https://api.ebay.com/identity/v1/oauth2/token",
    },
}


def env() -> str:
    """Return 'sandbox' or 'production' (defaults to sandbox for safety)."""
    value = os.environ.get("EBAY_ENV", "sandbox").strip().lower()
    return value if value in _HOSTS else "sandbox"


def api_base() -> str:
    return _HOSTS[env()]["api"]


def auth_url() -> str:
    return _HOSTS[env()]["auth"]


def get(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def have_api_keys() -> bool:
    """True only if the minimum keys needed to talk to eBay are present."""
    return bool(get("EBAY_APP_ID") and get("EBAY_CERT_ID"))


def missing_keys() -> list[str]:
    """List which important keys are still blank, so we can tell the user."""
    needed = ["EBAY_APP_ID", "EBAY_CERT_ID"]
    return [k for k in needed if not get(k)]
