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
    (`is_rookie/is_auto/is_graded/is_relic`, and for merch `is_merch/is_card/
    is_authenticated`). The `item_type` column splits cards from merch: blank/
    "card" = trading card; anything else (Jersey, Framed Jersey, Ball, Photo…)
    = merch. Merch reuses `grader` as the COA authenticator (Beckett/JSA/etc.)
    and leaves card-only columns blank. Validation requires different fields
    per kind (REQUIRED_CARD vs REQUIRED_MERCH).
  - `titles.py` — offline title/specifics/description builder, branches on
    card vs merch. Card title priority: year, brand, set, player, #, **grade,
    AUTO, RELIC, /serial** (value flags kept high so they survive the 80-char
    trim), RC, parallel, insert, team. Merch title: player, Autographed,
    item_type, team, "<authenticator> COA", year. `_collapse_words` drops
    repeated adjacent words.
  - `ebay_auth.py` — OAuth app token (public) + user token (selling).
  - `comps.py` — Browse API pricing (active). Marketplace Insights (sold) TODO.
  - `deals.py` — Buy Radar `scan()` + Alt-style `search()`; `value_rating()`
    maps discount→Great/Good/Fair/Over-market (3/2/1/0 bars).
  - App Collection tab: a **Cards / Merch** segmented toggle, then Cards group
    into collapsible **price tiers** ($100+, $25–100, $5–25, $1–5, Under $1,
    Unpriced) with Under-$1 + Unpriced collapsed by default (keeps bulk commons
    out of the way); Merch groups by `item_type`. Sport + Graded/Autos chips
    filter within Cards. `state.bucket`/`state.collapsed` drive it.
  - Dashboard/search HTML: theme-aware via CSS variables. Light default,
    dark via `@media prefers-color-scheme` (auto) or a manual sun/moon toggle
    (`data-theme` attr + localStorage). Keep both themes working on any UI edit.
    Dashboard can be published as a private URL with the Artifact tool (a
    snapshot — republish to the same file path to update; external image
    thumbnails are blocked by the Artifact CSP, so live Buy Radar images only
    show in the local file).
  - `lister.py` — 3-step publish (inventory item → offer → publish), dry-run default.
- Top-level `*.py` = thin owner-facing commands. `run.py` = menu.
- `docs/` (also holds the web app) — **Card Vault PWA**, the "real app" (à la
  the owner's Sports-Hub). Static HTML/CSS/vanilla-JS, no build step, deploys
  via GitHub Pages. `index.html` shell, `app.js` (renders tabs: Collection /
  Value / Drafts / About, card-detail modal, theme toggle, SW registration),
  `styles.css` (card-hobby theme: felt-green/charcoal + foil-gold, dark default
  + light via tokens), `manifest.webmanifest` + `sw.js` (installable, offline),
  `icon.svg`, `.nojekyll`. Reads `docs/data.json`.
- `build_web.py` — regenerates `docs/data.json` from the catalog AND a
  self-contained `output/preview.html` (CSS+JS+data inlined) for previewing.
  Run it after any catalog change so the app reflects it.
- PWA release ritual (on any `docs/` frontend edit, à la Sports-Hub): bump the
  `?v=N` on styles.css + app.js in `index.html`, bump `CACHE`/SHELL `?v=N` in
  `sw.js`, run `node --check docs/app.js`, rebuild, then ship to main. Skipping
  this makes the service worker serve stale CSS/JS. Current: v2.
- iOS: the app uses `viewport-fit=cover` + `env(safe-area-inset-*)` on the
  appbar/main/nav/modal so it respects the Dynamic Island, rounded corners, and
  home indicator. Preserve these on any layout change.
- ARCHITECTURE NOTE: eBay's APIs are CORS-blocked + secret-gated, so live
  features (comps/search/Buy Radar/listing) CANNOT run client-side — they need
  a small backend (Phase 2, mirroring Sports-Hub's Railway server exception).
  The static app covers view/track (collection, value, drafts) with no backend.
- `output/` — generated (git-ignored): drafts, comps, dashboard.html,
  search.html, preview.html. NOTE: `docs/` is committed (it's the live app);
  `output/` is not.
- `docs/` — 5 step-by-step guides (01 keys, 02 catalog, 03 pricing, 04 listing,
  05 roadmap).

## Conventions
- Standard library first; only deps are `requests`, `python-dotenv`.
- Every owner-facing script guards missing keys with a plain-English message and
  points to `docs/01`.
- Anything destructive/live is dry-run or confirmation-gated by default.
- SKUs: cards `CARD-000N`, merch `MERCH-000N`, unique. Continue the numbering.

## Current status (update me)
- Catalog: **34 items** — 32 cards + **2 merch** (`MERCH-0001` Kyren Williams
  framed signed Rams jersey, Beckett COA; `MERCH-0002` Baker Mayfield signed
  Bucs Flash helmet, Beckett Witness cert 1W622369). Cards span 5 sports;
  15 graded (PSA), 9 autos (incl. merch), 1 patch, several numbered. Graded
  cards carry PSA-app value estimates as a starting `asking_price` (refine with
  real eBay comps). Merch unpriced pending comps. All validate clean + drafted.
  Current app: v4. (Helmet: confirm full-size vs mini.)
- Dashboard published to a private Artifact URL (owner bookmarks it). Republish
  `output/dashboard_web.html` to the same conversation path to refresh it.
- **Card Vault PWA (Phase 1) built** in `docs/` — card-hobby themed, tabbed,
  installable. Previewed via Artifact. NOT yet live on GitHub Pages: needs the
  owner to (1) merge `docs/` to `main` and (2) enable Pages (Settings → Pages →
  main / `/docs`). Then live at https://mcdermottj639.github.io/Ebay/ .
- eBay developer account: **registered, pending approval** (~1 business day).
  No keys in `.env` yet → pricing/listing/Buy Radar/search are built but idle.
- Next when keys land: plug into `.env`, pull comps, refine prices, run first
  live searches, list best cards. Consider applying for Marketplace Insights
  (sold comps) and adding a PSA cert/pop lookup.
