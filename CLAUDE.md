# CLAUDE.md — working notes for this repo

Guidance for Claude Code when working in this project. Keep this file current.

## What this is
A spreadsheet-driven toolkit for running a **sports-card + merch business on
eBay**, built for a **non-technical owner**. The owner mostly edits a CSV and
sends card photos; Claude does the rest (cataloging, pricing, drafting,
listing, deal-finding). Python 3, standard-library-first, no framework.

## Standing rules (owner-set — always follow)
1. **Be the efficiency tracker.** Proactively fix minor title/logic/data issues
   the moment you notice them — don't wait to be asked. Note what you fixed.
2. **Our visuals lead.** Make our own dashboard / Buy Radar / search look great;
   don't just defer to Alt or other apps. Offer to show the owner a rendered
   preview (send the HTML file) when you change how something looks.
3. **Always update this CLAUDE.md** as part of any change — treat it as part of
   the definition of done, same as committing code.

## Also remember
- Owner is **non-technical**: keep commands simple, explain plainly, avoid jargon.
- **Never commit secrets.** `.env` holds eBay keys and is git-ignored. Keys/tokens
  go in `.env` only, never in chat, code, or commits.
- Cataloging + drafting + dashboards work with **no eBay connection**. Only
  pricing, listing, Buy Radar, and search need API keys.
- Prefer **eBay's own data** as the price source of truth (Browse for active,
  Marketplace Insights for sold). Card Ladder / Alt have no usable public API.
- After changing anything the owner sees, rebuild affected output
  (`make_drafts.py`, `dashboard.py`) and, when useful, send a preview.
- Commit + push to the working branch after meaningful changes.

## How to run (owner-facing)
`python3 run.py` = friendly menu. Or individual commands:
| Command | Does | Needs keys |
|---|---|---|
| `check_catalog.py` | validate + summarize inventory | no |
| `make_drafts.py` | build eBay titles/specifics/descriptions | no |
| `dashboard.py` | build `output/dashboard.html` | no |
| `get_comps.py` | pull eBay prices per card | yes |
| `find_deals.py` | Buy Radar: watchlist deals under market | yes |
| `search_deals.py "query" [price]` | Alt-style value search | yes |
| `create_listings.py [live]` | preview / publish listings | yes (live) |

## Architecture
- `data/inventory.csv` — the catalog (one row per card). Master source of truth.
- `data/watchlist.csv` — cards the owner wants to BUY (feeds Buy Radar).
- `src/ebaytools/`
  - `config.py` — loads `.env`, sandbox/production hosts, key checks.
  - `catalog.py` — load/validate/summarize inventory; `Card` model + flags
    (`is_rookie/is_auto/is_graded/is_relic`).
  - `titles.py` — offline title/specifics/description builder. Title priority:
    year, brand, set, player, #, **grade, AUTO, RELIC, /serial** (value flags
    kept high so they survive the 80-char trim), RC, parallel, insert, team.
    `_dedupe` drops exact repeated tokens.
  - `ebay_auth.py` — OAuth app token (public) + user token (selling).
  - `comps.py` — Browse API pricing (active). Marketplace Insights (sold) TODO.
  - `deals.py` — Buy Radar `scan()` + Alt-style `search()`; `value_rating()`
    maps discount→Great/Good/Fair/Over-market (3/2/1/0 bars).
  - `lister.py` — 3-step publish (inventory item → offer → publish), dry-run default.
- Top-level `*.py` = thin owner-facing commands. `run.py` = menu.
- `output/` — generated (git-ignored): drafts, comps, dashboard.html, search.html.
- `docs/` — 5 step-by-step guides (01 keys, 02 catalog, 03 pricing, 04 listing,
  05 roadmap).

## Conventions
- Standard library first; only deps are `requests`, `python-dotenv`.
- Every owner-facing script guards missing keys with a plain-English message and
  points to `docs/01`.
- Anything destructive/live is dry-run or confirmation-gated by default.
- SKUs are `CARD-000N`, unique. New batches continue the numbering.

## Current status (update me)
- Catalog: **18 cards** (16 football rookies + a PSA 10 basketball; 2 autos,
  1 patch, several numbered). All validate clean and are drafted.
- eBay developer account: **registered, pending approval** (~1 business day).
  No keys in `.env` yet → pricing/listing/Buy Radar/search are built but idle.
- Next when keys land: plug into `.env`, pull comps, price the 18, run first
  live searches, list best cards. Consider applying for Marketplace Insights
  (sold comps) and adding a PSA cert/pop lookup.
