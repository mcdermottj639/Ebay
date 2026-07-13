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
   don't just defer to Alt or other apps. Show the owner a rendered preview when
   you change how something looks — **always via the Artifact tool (a hosted URL
   they tap), NEVER as a sent .html file.** The owner's phone previews raw HTML
   files without running JavaScript, so an attached preview shows only a blank
   dark screen. `output/preview.html` carries a `<title>`, so it publishes as an
   Artifact directly (republish the same path to refresh the same URL).
3. **Always update this CLAUDE.md** as part of any change — treat it as part of
   the definition of done, same as committing code.
4. **You (Claude) do the merges.** The owner does not merge PRs — when work is
   ready, take it all the way to `main` yourself (open the PR and merge it),
   then tell the owner it's live. Don't leave a PR waiting on the owner to click
   Merge. (Standing permission to merge to `main`.)

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
  - `comps.py` — pricing. Prefers real SOLD comps via Marketplace Insights
    (`_search_sold`), auto-detecting access with `_sold_available()` (probed once
    per run) and transparently falling back to active Browse listings when the
    scope isn't granted. Public `sold_available()` lets owner-facing scripts show
    which source is live. `broad_query_for` widens niche queries that return 0.
  - `deals.py` — Buy Radar `scan()` + Alt-style `search()`; `value_rating()`
    maps discount→Great/Good/Fair/Over-market (3/2/1/0 bars).
  - App Collection tab: a **Cards / Merch** segmented toggle, then Cards group
    into collapsible **price tiers** ($100+, $25–100, $5–25, $1–5, Under $1,
    Unpriced) with Under-$1 + Unpriced collapsed by default (keeps bulk commons
    out of the way); Merch groups by `item_type`. Filtering within Cards is a
    **Filter popup** (a bottom-sheet, `openFilter`/`#filterWrap`, not a scrolling
    chip row) with single-select facets: All, Sport, Graded, Raw, Autos,
    Non-Autos, Rookie, Numbered (`matchFilter`). The `.filterbtn` shows the
    active filter + a Clear. `state.bucket`/`state.collapsed`/`state.filter` drive it.
  - Dashboard/search HTML: theme-aware via CSS variables. Light default,
    dark via `@media prefers-color-scheme` (auto) or a manual sun/moon toggle
    (`data-theme` attr + localStorage). Keep both themes working on any UI edit.
    Dashboard can be published as a private URL with the Artifact tool (a
    snapshot — republish to the same file path to update; external image
    thumbnails are blocked by the Artifact CSP, so live Buy Radar images only
    show in the local file).
  - `lister.py` — 3-step publish (inventory item → offer → publish), dry-run default.
    `image_urls_for(card)` auto-attaches the card's live-site photo
    (`docs/img/<SKU>.*` → `https://…github.io/Ebay/img/<SKU>.jpg`, base overridable
    via `SITE_IMAGE_BASE`) so eBay listings carry images. Cards without a photo
    list with no image — eBay requires ≥1 photo, so photograph before going live.
- Top-level `*.py` = thin owner-facing commands. `run.py` = menu.
- `docs/` (also holds the web app) — **Card Vault PWA**, the "real app" (à la
  the owner's Sports-Hub). Static HTML/CSS/vanilla-JS, no build step, deploys
  via GitHub Pages. `index.html` shell, `app.js` (renders tabs: Collection /
  Value / Drafts / About, card-detail modal, theme toggle, SW registration),
  `styles.css` (card-hobby theme: felt-green/charcoal + foil-gold, dark default
  + light via tokens), `manifest.webmanifest` + `sw.js` (installable, offline),
  `icon.svg`, `.nojekyll`, `img/` (card photos). Reads `docs/data.json`.
- Card rows + the detail modal show a **photo thumbnail** (big image in the
  modal), falling back to a **smart placeholder** when there's no photo — a
  team-colored gradient (`TEAM_COLORS` map in app.js, keyed by `c.team`) with the
  player's initials, so the collection looks designed even with zero photos.
  Photos are auto-detected: drop `docs/img/<SKU>.{jpg,jpeg,png,webp}` (e.g.
  `CARD-0019.jpg`) and `build_web._image_for` wires it in — no spreadsheet edit.
  NOTE: this env's network is locked to eBay's API only — PSA/other web hosts are
  proxy-blocked, so we CANNOT auto-fetch card/cert images here. For graded cards
  the owner opens psacard.com/cert/<n>, saves the slab image, and sends it; also
  note reusing PSA's images on listings is a copyright gray area — real photos are
  safest for anything actually listed. Each priced item
  also shows a **price-basis pill**: gold **ASKING** (active-listing comps, the
  default today) or green **SOLD** (real sold comps). Basis comes from the
  `price_basis` CSV column (`asking`/`sold`), surfaced by `build_web._price_basis`;
  flip rows to `sold` when Marketplace Insights is granted and re-priced.
- `build_web.py` — regenerates `docs/data.json` from the catalog (incl. per-card
  `image` + `price_basis`) AND a self-contained `output/preview.html` (CSS+JS+data
  inlined) for previewing. Run it after any catalog change so the app reflects it.
  NOTE: the Artifact CSP blocks images, so photos only show on the live Pages
  site, not in the Artifact preview (placeholders show there).
- PWA release ritual (on any `docs/` frontend edit, à la Sports-Hub): bump the
  `?v=N` on styles.css + app.js in `index.html`, bump `CACHE`/SHELL `?v=N` in
  `sw.js`, run `node --check docs/app.js`, rebuild, then ship to main. Skipping
  this makes the service worker serve stale CSS/JS. Current: v9. The live
  version also shows as a tag in the top bar (`.ver` / `#verpill`, driven by
  `APP_VERSION` in app.js) so the owner can verify the loaded build at a glance
  — keep `APP_VERSION` in lockstep with the `?v=N` bump on every frontend ship.
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
  15 graded (PSA), 9 autos (incl. merch), 1 patch, several numbered.
  **All 34 now priced** from live eBay comps (catalog value ≈ $2,702). Merch:
  jersey $124.99, helmet $349.99. All validate clean + drafted. App: v9
  (version tag now shown in the top bar for at-a-glance build verification).
  (Helmet: confirm full-size vs mini.)
- **eBay Production API is LIVE** (2026-07). Keys approved and in `.env`
  (`EBAY_ENV=production`, git-ignored). OAuth app token works against
  `api.ebay.com`. Pricing / Buy Radar / value search all pull real data.
  If an HTTPS call fails TLS/proxy verify in this env, prefix commands with
  `REQUESTS_CA_BUNDLE=/root/.ccr/ca-bundle.crt`.
- Pricing method used: comps are **active/asking** medians (Browse API), which
  run ABOVE actual sold — so `asking_price` set at/just-under median for clean
  comps. Refine down once real SOLD comps are available.
- **Marketplace Insights (real SOLD comps): code built + wired, APPLIED — awaiting
  eBay review.** Tested the production keyset (2026-07) — the
  `buy.marketplace.insights` scope returns `invalid_scope`, i.e. eBay has NOT yet
  granted this app the gated Limited-Release API. `comps.py` already prefers sold
  and auto-falls-back to active, so the day access is granted, `get_comps.py`
  switches to real sold with no code change (it prints "✓ Using REAL SOLD prices"
  vs the active-fallback notice). STATUS: owner activated Developer Support and
  submitted the Application Growth Check requesting the "MIP" (Marketplace Insights
  Program) product on 2026-07-13. Now pending eBay's approval (days–weeks). When
  the owner says "check sold comps", re-probe `comps.sold_available()`; if True,
  re-run `get_comps.py` and refine every `asking_price` off real sold medians.
- Comp-query fallback added (`comps.broad_query_for`): when the exact-title
  search returns 0 (niche inserts/autos w/ odd card #s), it retries with a
  broadened query (year+brand+player+grade/AUTO/RELIC/serial). These are marked
  "(broad match)" in output and are NOISY (sweep in the player's other cards) —
  treat as ballpark only. Broad-matched SKUs whose price is a judgment call, not
  the raw median: CARD-0001/0011/0013/0014/0016/0023/0030/0032 — verify these.
- Fixed a latent bug in the value search: `deals.search()` emitted result key
  `title` but `search_deals.py` (console/CSV/HTML) read `item_title` — the
  ad-hoc search 500'd on first real run. `search()` now emits `item_title` to
  match the `Deal` dataclass. `search_deals.py "2024 donruss downtown"` works.
- Dashboard published to a private Artifact URL (owner bookmarks it). Republish
  `output/dashboard_web.html` to the same conversation path to refresh it.
- **Card Vault PWA (Phase 1) is LIVE** at https://mcdermottj639.github.io/Ebay/
  — card-hobby themed, tabbed, installable. Deployed via GitHub Actions
  (`.github/workflows/pages.yml`), which auto-enabled Pages (configure-pages
  enablement:true) and rebuilds `docs/data.json` from the catalog on every push
  to `main`. So: edit `data/inventory.csv` → merge to `main` → site updates
  itself (no manual Pages steps, no manual rebuild). Deploy status via the
  Actions tab / `pages.yml` runs.
- Next: mint a user token (consent flow) to enable live listing + Marketplace
  Insights (sold comps), then refine prices off SOLD data and list the best
  cards. Consider a PSA cert/pop lookup.
