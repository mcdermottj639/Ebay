"""ebaytools — a small toolkit for running a sports-card business on eBay.

Modules:
    config   – loads your settings/keys from the .env file
    catalog  – reads and checks your inventory.csv
    titles   – builds eBay-optimized titles, item specifics, descriptions (works offline)
    ebay_auth– gets an access token from eBay (needs your API keys)
    comps    – pulls recent SOLD prices for a card (needs your API keys)
    lister   – pushes listings live to eBay (needs your API keys + approval)
"""

__version__ = "0.1.0"
