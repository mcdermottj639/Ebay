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
| `reprice.py [--dry-run]` | safely refresh asking prices from comps + log history | yes |
| `find_deals.py` | Buy Radar: watchlist deals under market | yes |
| `radar.py` | Buy Radar snapshot for the app's 🔎 tab (writes `data/radar_snapshot.json`) | yes |
| `search_deals.py "query" [price]` | Alt-style value search | yes |
| `create_listings.py [live]` | preview / publish listings | yes (live) |
| `check_ebay_login.py` | verify the SELLING user token works (lists nothing) | yes |

## Architecture
- `data/inventory.csv` — the catalog (one row per card). Master source of truth.
  Sales-tracking columns (v11): `listed` (yes = live on eBay), `sold_price`
  (filling it marks the item SOLD and moves it from inventory value to
  revenue), `sold_date`. `Card.is_listed()`/`is_sold()` in catalog.py.
- `data/watchlist.csv` — cards the owner wants to BUY (feeds Buy Radar AND the
  app's Targets tab via `build_web._targets`). Columns: label, query,
  fair_value, alert_below, notes, **`sport`** (football/baseball/… — Buy Radar
  sorts football-first). Owner preference: premium **$100–$1000** cards,
  **football preferred**, baseball OK — so rows target graded/parallel/auto
  versions that naturally list in that band (raw base RCs are too cheap).
- `data/price_history.csv` — per-SKU price observations appended by
  `reprice.py` (date, price, basis, median, count, applied). Committed, so the
  app's Movers panel + week-over-week ▲▼ chips (`build_web._price_changes`,
  card `prev_price`) survive rebuilds. Doesn't exist until the first reprice.
- `reprice.py` — conservative auto-repricing: exact-match comps only, ≥3
  listings, moves >35% are flagged not applied, <1% ignored; never touches
  merch, sold items, or the hand-priced broad-match SKUs in `SKIP_SKUS`.
  Exits 1 with a plain message when keys are missing (safe under cron).
  **A weekly Routine (Mondays ~9am ET, fresh session) runs it, then `radar.py`
  (folded in 2026-07-23 — before that no radar Routine existed and the Buy Radar
  snapshot went stale), rebuilds, and merges to main — it needs
  EBAY_APP_ID/EBAY_CERT_ID/EBAY_ENV as environment variables in the Claude Code
  environment settings (there's no .env in fresh cloud containers; config.py
  reads os.environ, so env vars just work). ⚠️ The 2026-07-20 firing produced
  no branch/PR/data — a silent failure; the prompt now tells the run to always
  end with an explicit note on failure. If a Monday passes with no "Weekly
  reprice" PR on main, check `list_triggers` last_fired and re-run by hand.**
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
- Top-level `*.py` = thin owner-facing commands. `run.py` = menu (menu option
  **9** = `check_ebay_login.py`, **0** = quit).
- `check_ebay_login.py` — owner-facing check for the **user token** (selling).
  Mints a user access token from `EBAY_USER_REFRESH_TOKEN` via
  `ebay_auth.user_token()` and reports ✅/❌ in plain English; also flags any
  missing business-policy IDs needed for a real listing. Lists nothing. This is
  the "did my one-time consent work?" button after minting the token per
  docs/01 Step 3. NOTE: the eBay App ID/Cert/ENV are already present as env vars
  in this cloud environment, so adding `EBAY_USER_REFRESH_TOKEN` as an env var
  here is enough to enable listing from the cloud (no local .env needed).
- `docs/` (also holds the web app) — **Card Vault PWA**, the "real app" (à la
  the owner's Sports-Hub). Static HTML/CSS/vanilla-JS, no build step, deploys
  via GitHub Pages. `index.html` shell, `app.js` (renders tabs: Collection /
  Value / Sales Map / Buy Radar / Targets / Drafts / About, card-detail modal,
  theme toggle, SW registration),
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
- **PC / widescreen layout (v10)**: at ≥1000px the same DOM reshapes into a
  "Command Center" — bottom tab bar becomes a left sidebar rail (`.navbrand`
  brand + `.navfoot` live collection-value card, hidden on phones), the appbar
  slims down (brand hidden), `.list` rows become a display-case **card grid**
  (`.crow` flex-column tiles, big photo top, foil-shine sweep + gold-glow hover
  via `.crow::after`), the Value tab lays out as a dashboard (hero banner, 6-up
  stat row, side-by-side `.vgrid` panels), and the detail sheet becomes a
  centered two-pane dialog (`.mgrid`: photo | specs). All in one
  `@media (min-width:1000px)` block in styles.css — the phone layout above it
  is untouched. Keep `.crow { align-items: stretch }` in that block (base rule
  centers, which double-clips overflowing tile text).
- **Search + sort (v10)**: Collection toolbar with instant search (`state.q`,
  every word must match player/team/set/brand/year/SKU/etc — `matchQuery`) and
  a sort select (`state.sort`: tier default, value ↑↓, A–Z, newest). Typing
  re-renders only the results container so the input keeps focus; pressing `/`
  focuses search (PC), Esc closes sheets. Search + non-tier sorts show a flat
  grid with a result count; the tier sections return when cleared.
- **Value-over-time (v10)**: `build_web.py` carries a `history` array forward
  in `docs/data.json` (one `{d,v,n}` snapshot per day, updated in place on
  same-day rebuilds, capped ~2yr). Since data.json is committed, the Pages
  Action carries it too. The Value tab renders it as a dependency-free SVG
  line chart (`trendChart`); with <2 points it shows a "tracking started" note.
- **🗺️ Sales Map tab (v21).** Owner wanted "a tab that's a sales map — which
  cards I own are in a good position to sell, with analytics of price change
  over time." Pure client-side over data already in `data.json` (no new keys):
  `app.js viewSalesMap` scores every held, priced card with a **Sell Score
  (0–100)** = value(34, log) + liquidity/desirability(36: graded/auto/numbered/
  rookie/football) + price-confidence(10: sold/est_sold/asking basis) +
  momentum(20, centred on week-over-week `prev_price`). `sellScore`/
  `sellMomentum`/`SELL_RATING` → 0–3 rating bars (Prime / Good to sell / Fair /
  Hold). The tab has: headline tiles (how many are Prime to sell), a **Sell map**
  SVG scatter (`quadrantMap`: x = value log, y = readiness, top-right =
  prime-to-sell, dots colour by rating, tap → card modal), a **Best positioned
  to sell** ranked list (`sellRowEl`, reason chips + a price sparkline), and a
  **Price changes** section (reuses `trendChart` + a `moversSplitPanel` of
  weekly gainers vs decliners). Works today off value+liquidity; momentum,
  sparklines, and gainers/decliners fill in automatically as weekly re-price
  runs accumulate `price_history.csv`. `build_web._price_series` now bakes each
  SKU's price-over-time series (`price_series`: [{d,p}], last-per-day, capped 60)
  into each card, feeding the Sales Map sparklines AND a new **Price history**
  box in the card modal (`priceHistoryBox`, shows first→latest change; hidden
  until 2+ snapshots). Sparklines (`sparkline`) are dependency-free SVG. The
  tab wraps its content in `.smgrid` (map=`.smmap`, list=`.smlist`,
  analytics=`.smtrends`) — a plain stack on phones, a 2-column dashboard on PC
  (v22): DOM order stays map→list→analytics so phones are untouched, while the
  `@media (min-width:1000px)` `.salesmap` rules use grid-row/column placement to
  put map+analytics in the left column and the ranked list spanning the right.
- `build_web.py` — regenerates `docs/data.json` from the catalog (incl. per-card
  `image` + `price_basis` + `price_series` + `market` {median,count}, plus the
  `history` snapshots above) AND a self-contained
  `output/preview.html` (CSS+JS+data
  inlined) for previewing. Run it after any catalog change so the app reflects it.
  NOTE: the Artifact CSP blocks images, so photos only show on the live Pages
  site, not in the Artifact preview (placeholders show there).
- PWA release ritual (on any `docs/` frontend edit, à la Sports-Hub): bump the
  `?v=N` on styles.css + app.js in `index.html`, bump `CACHE`/SHELL `?v=N` in
  `sw.js`, run `node --check docs/app.js`, rebuild, then ship to main. Skipping
  this makes the service worker serve stale CSS/JS. Current: v27. The live
  version also shows as a tag in the top bar (`.ver` / `#verpill`, driven by
  `APP_VERSION` in app.js) so the owner can verify the loaded build at a glance
  — keep `APP_VERSION` in lockstep with the `?v=N` bump on every frontend ship.
  Current: v27. **`sw.js` is network-first for HTML navigations + data.json
  (v23):** the shell used to be pure cache-first, so after a ship the app kept
  loading the OLD `index.html` (→ old `?v=N` CSS/JS) until the SW fully cycled —
  a fix could be live yet still look broken on the owner's screen. Now
  `networkFirst()` serves `index.html`/`data.json` from the network when online
  (cached fallback offline), so a new build's asset versions load on the very
  next open. Versioned assets (`styles.css?v=N`, `app.js?v=N`, icons) stay
  cache-first (immutable per version). If the owner ever still sees a stale
  build, one full close-and-reopen of the app clears it.
- App v11 additions: **Targets tab** (🎯 watchlist with fair/buy-under chips),
  **Business row** on Value (revenue/realized profit/listed/sold — only shows
  once something is listed or sold), **Movers · this week** panel + ▲▼ chips
  (need price_history), Value-by-sport and Value-by-grade $ panels
  (`summary.sport_stats`/`grade_stats`), LISTED/SOLD badges + Status filter
  facets, sold items excluded from estimated value (Priced tile denominator is
  total−sold), **share deep-links** (`#sku=CARD-000N` opens that card's modal;
  Share button copies/shares the URL) and a PSA cert lookup link in the modal
  (cert parsed from notes by `build_web._cert_for`).
- App v12: **comps in the card view.** `comps.py` search functions also return
  `sample_items` [{t,p,u}] with listing URLs; `reprice.py` saves the top 5 per
  card to `data/comps_snapshot.json` (committed; it now queries EVERYTHING
  unsold — merch + SKIP_SKUS included — but still only auto-applies where
  safe; those are "held"). `build_web._comps_snapshot` attaches them as card
  `comps` → the modal shows an "On eBay now (asking)" / "Recent eBay sales"
  box (auto-relabels when source=sold) with an as-of date. Modal also has
  always-available **Live listings / Sold on eBay** buttons (public eBay
  search URLs built from the card title — no API needed). The snapshot file
  doesn't exist until the first keyed reprice run; the box just hides.
- App v14: **🔎 Buy Radar tab (in-app, no backend).** The owner wanted the
  deal-finder *inside* the app, not just as a terminal tool. Since eBay's API
  can't run client-side, `radar.py` runs the scan server-side (reuses
  `deals.scan(watchlist)`) and writes `data/radar_snapshot.json` (committed);
  `build_web._radar_snapshot` bakes it into `data.json` as top-level `radar`
  ({as_of, watch_count, scanned, shown, deals[]}); `app.js` `viewRadar()`
  renders deal rows with Alt-style green **value bars** (Great/Good/Fair via
  `ratingBars`), photo/placeholder thumb, ▼ %-under chip, market ref, snipe
  badge, tap-to-open-on-eBay. **Curation matters:** broad watchlist queries
  pull a median polluted by premium parallels/autos, so raw `scan()` flags
  cheap base cards as "90% off." `radar._curate` keeps only believable
  discounts (`MIN_DISCOUNT` 15% – `MAX_DISCOUNT` 65%) and caps to `TOP_N` (24),
  recording `scanned`/`shown` so the UI honestly says "showing N strongest of
  M." Refresh: `radar.py` runs inside the SAME weekly Monday reprice Routine
  (added to its prompt 2026-07-23 — previously no Routine ran radar, so the
  snapshot sat stale from 07-16). This is the
  free "Option A" — the always-on backend for live type-anything search +
  one-tap listing (Option B) is still Phase 2.
- **Buy Radar price band + sport preference (v15).** Owner wants pricier cards,
  football-first. `radar.MIN_PRICE`/`MAX_PRICE` (default **$100–$1000**) are
  passed into `deals.scan(price_min, price_max)` → `_search` adds an eBay
  Browse `price:[min..max],priceCurrency:USD` filter, so both the listings AND
  the market-median reference stay in-band (cheap base cards no longer pollute
  the median). `radar._curate` also drops any kept deal outside the band and
  sorts **football first** (`SPORT_ORDER`) then by discount. `sport` flows
  watchlist row → `WatchItem` → `Deal` → snapshot; `app.js viewRadar` shows a
  🏈 on football rows and notes the "$100–$1000, football first" focus.
  Snapshot now carries `price_min`/`price_max`. `scan()` band args default to
  None, so `find_deals.py` is unchanged. Tune the band in `radar.py`.
- **Buy Radar deal popup + Downtowns/Kabooms (v16).** Tapping a deal now opens
  a **popup** (`app.js openDeal`, reuses the modal shell) instead of jumping
  straight to eBay: shows the listing + rating/discount, a **"Currently on eBay
  · cheapest"** box (the 6 cheapest live listings `radar.py` captured per card,
  attached as `Deal.samples` = [{t,p,u}]), and three buttons — **Open this
  listing**, **All live listings**, **Recent sold prices** (the last two are
  public eBay search URLs built from `Deal.query`; sold = `&LH_Sold=1&LH_Complete=1`,
  our only path to sold since Marketplace Insights is denied). Deal rows are now
  `<div role=button>` (click/Enter), not `<a>`.
  **Premium inserts:** the owner specifically hunts **Downtowns** (Donruss
  Downtown SSPs) and **Kabooms** (Panini Kaboom) and will pay **>$1000 when the
  savings are big**. `radar._is_premium` flags a watchlist row when its
  label/query contains "downtown"/"kaboom"; those get a wider band
  (`PREMIUM_MAX_PRICE` $5000) via per-item `WatchItem.price_max`, and `_keep`
  admits an over-$1000 deal only if it's premium AND `discount ≥
  PREMIUM_MIN_DISCOUNT` (25%). Curation sorts premium ahead of base within each
  sport; rows/popup show a 💥 badge. Watchlist gained football Downtown/Kaboom
  rows for the QBs/stars.
  **Single-card filter:** broad Kaboom/Downtown queries pull sealed wax, box
  lots, and breaks that poison the median — `deals._is_single_card`
  (`_NON_SINGLE` regex) drops those in `scan()` (Buy Radar only; the ad-hoc
  `search()` is left alone so box lookups still work).
- **Buy Radar filters (v17–v18).** The 🔎 tab has a client-side filter bar
  (`app.js viewRadar`, `.radartools`) — native `<select>`s for **Type**
  (Downtown / Kaboom / **No Kaboom/Downtown**), **Sport**, **Graded**
  (all/graded/raw), and **PSA grade** (10, 9.5, …). Facets are derived per-deal
  from the listing title/query (`dealType`/`dealGrader`/`dealGrade`) since the
  snapshot has no explicit grade field, and each select is only shown when the
  current deals actually contain those values (no empty facets).
  `state.radarFilter` ({type,sport,graded,grade}) + `matchRadar` filter the
  list; changing a select re-renders only the results (inner `renderResults`,
  no page jump), with a "Showing N of M · Clear filters" line. Purely
  presentational over the snapshot.
  **v18 — reserve slots for non-premium (`radar.OTHER_SLOTS`):** Downtowns/
  Kabooms sort to the top, so they used to fill all `TOP_N` slots and the "No
  Kaboom/Downtown" filter showed nothing. `_curate` now holds back up to
  `OTHER_SLOTS` (12) slots for non-premium deals (premium fills the rest of
  `TOP_N`, now 30) via `_order`, so that filter always has cards. The type
  value for those is `"other"` (dealType = neither kaboom nor downtown),
  labelled **"No Kaboom/Downtown"**.
  **v27 — relevance gate + grade buckets + seller guard + honest refs (the big
  accuracy fix).** The owner reported Buy Radar showing fake "Great Values" —
  wrong-player / wrong-set listings rated against a polluted median. Root cause:
  eBay keyword search matches loosely and we computed the market reference from
  that same loose pool, so garbage rated garbage. Four fixes, all in
  `deals.py`/`radar.py`, plus the app labels:
  - **Relevance gate (`_matches_query`)** — normalizes both sides (lowercase,
    strip `.`/`'` so "C.J."=="CJ", tokenize on non-alphanumerics) and requires
    EVERY meaningful query token to appear as a WHOLE token in the title (token
    equality, never substring — so "prizm" ≠ "prizmatic", and the "10" of
    "psa 10" is required). `_FILLER_TOKENS` (panini/card/football/1st) are not
    required; `_SYNONYMS` (rookie↔rc, auto↔autograph) count as matches. Plus a
    **base-set conflict guard** (`_BASE_SETS` = prizm/select/mosaic/score/
    chronicles/phoenix/certified): if the query pins one base set and the title
    names a DIFFERENT one, reject — this is what stops a "Select … Shock Prizm"
    card matching a Prizm query (Panini reuses "Prizm" as a parallel word).
    Deliberately excludes donruss/optic/absolute so Downtown/Kaboom CATEGORY
    queries (which span Donruss+Optic+Absolute) aren't over-filtered.
  - **Junk filter (`_is_junk`)** — drops reprint/rp/display/custom/aceo/
    facsimile/novelty/proxy/digital/calendar/countdown/"you pick"/choose (kills
    the Kaboom advent-CALENDAR box and "RP … DISPLAY CARD" reprints).
  - **Grade buckets (`_grade_key`: psa10/psa9/graded_other/raw)** — in `scan()`
    the gate+junk filters run BEFORE the median (un-polluting the reference),
    then each listing is rated ONLY against the median of its OWN grade bucket,
    and only when that bucket has ≥`MIN_BUCKET` (3) comps. Kills raw-vs-PSA10
    and PSA9-vs-mixed fake deals. Popup samples come from the deal's own bucket.
  - **Dedup** (`_item_id` from the itemWebUrl, falling back to title+price) so a
    listing can't appear twice. **Seller guard** — `_search` now captures
    `seller.feedbackScore`/`feedbackPercentage`; `radar._keep` drops deals from
    sellers with a real-but-poor record (score <10 or pct <95; score 0 = eBay
    returned no seller block = unknown, kept). Scam guard for the misspelled
    "Dunruss … Gem Rare" $700-type listings.
  - **Honest reference labels** — `Deal` gained `ref_count`/`grade_key`/
    `seller_score`/`seller_pct` (flow through `asdict`→snapshot→`build_web`
    unchanged). `app.js` `refLine`/`poolLabel`/`thinChip` show "vs ~$980 · 7
    comps · PSA 10 pool" in rows + popup, with a gold **thin data** chip when
    ref_count <5. Result on the 2026-07-23 snapshot: same 30 shown, but the
    junk (Deebo under Jayden, Warren Moon under Mahomes, the calendar box, 4
    Select-under-Prizm) is gone; 0 set-conflicts, 0 dups, buckets isolated.
  - **Same gate fixes owner-card PRICING too:** `comps.py get_comps` now filters
    the exact-match pool by `_matches_query` before the median (broad-match
    fallback only requires the player tokens, `_player_tokens`). This ended the
    recurring bogus reprice flags — CARD-0021 Tony Pollard's median dropped from
    a polluted ~$779 (+312% flag) to a sane $150 (held, broad match); Mbappe
    went from a flagged +64% to a clean +20%. `deals.search()` (ad-hoc value
    search) is left loose on purpose.
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
  jersey $124.99, helmet $349.99. All validate clean + drafted. App: **v27**
  (v27 = **Buy Radar accuracy fix — relevance gate + grade buckets + seller
  guard + honest reference labels** — the owner reported false "Great Values"
  from wrong-player/wrong-set listings; the same missing-relevance flaw also
  polluted the repricer's comps. Now every comp (Buy Radar AND own-card pricing)
  must actually match the searched card before it counts toward the median, and
  cards are only rated within their own grade bucket. Full detail in the Buy
  Radar architecture section above. Fixed the recurring Tony Pollard +312%
  bogus flag as a side effect;
  v26 = **oversized-Downtown guard + "Card Vault value" relabel** — (a) owner
  flagged that **oversized/jumbo Downtowns are a different market priced
  differently**, so `deals.py` now has `_is_oversized`/`_query_wants_oversized`
  and `scan()` drops oversized/jumbo/box-topper/5x7 listings from a standard
  query (so they can't skew the standard-size median) UNLESS the watchlist
  query itself hunts oversized; `radar._keep` carries the same guard as
  belt-and-suspenders on the committed snapshot. (Buy Radar shows a SAVED
  snapshot, so the fix only shows once radar re-scans — an oversized Jayden
  Daniels Downtown still showed "64% under mkt ~$980 / Great Value" off the
  2026-07-15 snapshot; re-ran `radar.py` 2026-07-16, live snapshot is clean.)
  (b) owner objected to the label "Your estimate"
  ("I don't have any estimates") — the value is the app's estimate from eBay
  asking comps, not something they entered, so the modal now says **"Card Vault
  value"** (kv row + What-it's-going-for + Cost & profit boxes); price basis
  still spells out "Estimated market (asking comps − haircut)";
  v25 = **profit column + quick-list widget + honest fills** — three owner
  asks: (1) **Profit** from cost — Sales Map rows show a profit chip when a
  card has a `cost`, else a dashed **"＋ add cost"** placeholder (the spot to
  fill); the card modal has a **Cost & profit** box (you paid / est. value /
  est. profit · margin, or an add-cost prompt); an **Est. profit** tile
  (`summary.profit`/`cost_count`, computed ONLY over cards with a cost — fixed a
  bug where blank cost made profit == full value, e.g. the Value tab showed
  $2,724 "profit"). Nothing has a cost yet, so it all shows the add-cost state
  until the owner fills `cost` in inventory.csv. (2) **Why some cards show a
  market price and others don't** — a priced card with no captured comps (niche
  inserts/autos the auto-pricer found 0 matches for, e.g. Bijan Robinson
  #TC-BRO) now says so in the modal ("No eBay comps captured … value is
  hand-set") instead of showing nothing. (3) **Quick-list widget** — the modal
  has a **List this card** bar: **List on eBay** (copies the title, opens
  eBay's sell page) and **✨ Draft in Claude** (copies a filled prompt +
  opens claude.ai/new?q=… to draft the title/specifics/description). Helpers:
  `profitOf`/`profitChip`/`costProfitBox`, `listPrompt`/`copyText`/`flashBtn`,
  marketBox null-note. NOTE: real API listing (`lister.py`) is still Phase 2
  (needs a user token); this widget is the no-backend copy-and-open path;
  v24 = **Sales Map "what it's going for"** — every repriced card now surfaces
  the market reference the owner asked for: sell rows show "Usually ~$median ·
  N on eBay", and the card modal has a **What it's going for** box (typical
  asking · live range · your estimate · room up to typical). `build_web._market`
  bakes the latest comps median+count per SKU into a card `market` field;
  `app.js goingFor`/`marketSolid`/`marketLine`/`marketBox` render it. Honest by
  design: it's the ASKING median (eBay denied real SOLD comps), thin counts are
  flagged "thin data" and the "room to" suggestion is withheld unless the read
  is solid (count ≥5 and our price 0–50% under median) so noisy comps like the
  flagged Tony Pollard $189-vs-$885 don't imply a bogus upside. Also fixed a
  latent PC modal bug — `.mgrid` used `320px 1fr`, whose `1fr` min-content let
  long comp titles widen the dialog and push values off-screen; now
  `320px minmax(0,1fr)` + `.mbody{min-width:0}` so titles ellipsize;
  v23 = **comp-price never clips + network-first SW** — the "On eBay now" box
  rows are now a CSS **grid** (`minmax(0,1fr) auto`) so the price column always
  sizes to its content and can't be pushed off/clipped (the earlier flex fix was
  right but the owner kept seeing the old clip because the cache-first SW served
  a stale `index.html`/CSS); `sw.js` is now **network-first for HTML +
  data.json** so a shipped fix loads on the next app open instead of after a
  full SW cycle;
  v22 = **Sales Map PC layout** — on ≥1000px the tab reflows into a Command-
  Center dashboard: hero + 3 stat tiles, then a 2-column grid with the sell map
  **and** the price-change analytics (value trend + gainers/decliners) stacked
  in the left column and the ranked "best positioned to sell" leaderboard
  spanning the right. DOM order is unchanged so the phone stack (map → list →
  price changes) the owner liked is untouched; the map no longer balloons to
  full width on widescreen. Verified both themes at 1920×1080 via headless
  Chromium;
  v21 = new **🗺️ Sales Map tab** — scores every held card on how well-positioned
  it is to sell (value + liquidity + price momentum → Prime/Good/Fair/Hold), a
  value×readiness scatter map, a ranked "best positioned to sell" list, and a
  price-changes section (value trend + weekly gainers/decliners); `build_web`
  now bakes a per-card `price_series` that also drives a Price-history sparkline
  in the card modal;
  v20 = **modal close-button fix** — the popup ✕ used `float:right`, so the
  grid/photo content (later in the DOM) painted over it and swallowed the tap,
  making the card popup feel un-closable. `.modal .close` is now
  `position:absolute; top/right; z-index:3` on a `position:relative` `.modal`
  (h3 gets `padding-right` so it doesn't run under it) — reliably closes the
  card modal, deal popup, and filter sheet;
  v19 = **comp-row alignment fix** — the "On eBay now"/"Currently on eBay"
  boxes (`.comp`/`.ct`) had a flexbox truncation bug: the title had
  `white-space:nowrap` but no `min-width:0`, so it refused to shrink and shoved
  the price off the row, clipping it. `.ct` is now `flex:1;min-width:0` and the
  price `<b>` is `flex:0 0 auto;white-space:nowrap`, so the title ellipsizes and
  the price always shows — fixes both the card modal and the Buy Radar popup;
  v18 = Buy Radar filter gained a **"No Kaboom/Downtown"** type option, and
  `radar.py` reserves slots (`OTHER_SLOTS`) for non-premium deals so that
  filter always has cards to show;
  v17 = Buy Radar **filters** — Type (Downtown/Kaboom/Other), Sport, Graded,
  PSA grade selects at the top of the 🔎 tab, facets derived per-deal from the
  listing title, filters the list in place with a Showing-N-of-M + Clear line;
  v16 = Buy Radar **deal popup + Downtowns/Kabooms** — tapping a deal opens a
  popup with the current cheapest live listings + Open-listing / All-live /
  Recent-sold eBay buttons; premium Downtown/Kaboom inserts get a wider band
  (up to $5000) and are kept over $1000 only on big savings (≥25% off); a
  single-card filter strips sealed wax/box-lot noise;
  v15 = Buy Radar **$100–$1000 price band + football-first** — owner wants
  pricier cards; `radar.py` passes the band into the eBay search so listings +
  market median stay in-band, curation drops out-of-band deals and sorts
  football before baseball, watchlist gained a `sport` column and was
  retargeted to premium graded/parallel/auto cards, deal rows show a 🏈;
  v14 = in-app **🔎 Buy Radar tab** — watchlist deals with Alt-style value
  bars, curated from live eBay via `radar.py` → `data/radar_snapshot.json`,
  free/no-backend "Option A"; v13 = `est_sold` price basis — a conservative
  haircut on asking comps to estimate true market after eBay denied real
  sold-comp access — shown as a blue EST pill; v12 = eBay comps inside the card
  view + Live/Sold eBay search buttons) —
  v10 was the PC Command Center upgrade (sidebar layout, card-grid display
  case, dashboard Value tab, search + sort, daily value-history chart, first
  snapshot 2026-07-14 $2,701.75); v11 added the business layer: sales tracking
  (listed/sold columns), Targets tab, Movers + $-analytics panels, share
  deep-links + PSA cert links, and `reprice.py` + a **weekly Monday Routine**
  that auto-reprices from live comps and ships to main. ⚠️ The Routine is a
  no-op until the owner adds EBAY_APP_ID / EBAY_CERT_ID / EBAY_ENV=production
  as environment variables in the Claude Code environment settings — fresh
  cloud containers have no .env. (Helmet: confirm full-size vs mini.)
- **Reprice + radar run 2026-07-23 (manual catch-up):** the 07-20 scheduled
  Routine fired but silently produced nothing, so this run made up for it.
  `reprice.py` applied **10** updates (biggest: CARD-0019 CJ Stroud $136.40 →
  $158.40, CARD-0031 CJ Stroud $57.20 → $43.99), re-flagged the same 2 for hand
  review (CARD-0021 Tony Pollard +312%, CARD-0028 Mbappe +64%), held 10.
  `radar.py` refreshed 30 deals. Routine prompt updated: now also runs
  `radar.py`, commits `radar_snapshot.json`, and must report failures loudly.
- **Reprice run 2026-07-15 (owner-approved, applied):** `reprice.py` against
  live eBay comps applied **17** price updates (est_sold basis, 12% haircut),
  **flagged 2** as too-big-to-auto-apply for hand review — **CARD-0021 Tony
  Pollard** ($189 → ~$779, +312%) and **CARD-0028 Kylian Mbappe** ($99 → ~$157,
  +59%) — and **held 10** at hand-set prices. Refreshed `price_history.csv` +
  `comps_snapshot.json`, rebuilt `docs/data.json`. Keys confirmed live.
- **eBay Production API is LIVE** (2026-07). Keys approved and in `.env`
  (`EBAY_ENV=production`, git-ignored). OAuth app token works against
  `api.ebay.com`. Pricing / Buy Radar / value search all pull real data.
  If an HTTPS call fails TLS/proxy verify in this env, prefix commands with
  `REQUESTS_CA_BUNDLE=/root/.ccr/ca-bundle.crt`.
- Pricing method used: comps are **active/asking** medians (Browse API), which
  run ABOVE actual sold. Auto-repricing (`reprice.py`) now shaves a conservative
  **`SOLD_DISCOUNT`** haircut (default 12%) off the asking median to ESTIMATE the
  true sold price, and tags those rows `price_basis = "est_sold"` (app shows a
  blue **EST** pill — distinct from gold ASKING / green SOLD, never passed off as
  a real sold comp). Tune the haircut via `SOLD_DISCOUNT` in `reprice.py`. If real
  SOLD comps are ever granted, the haircut is skipped and rows tag `sold` (green).
- **Marketplace Insights (real SOLD comps): DENIED by eBay (final, 2026-07-15).**
  eBay Developer Support (ticket 260713-000007, Vartika Singh) reviewed the
  Application Growth Check with the eBay business unit and declined: the API is a
  gated Limited-Release scope "highly limited and generally reserved for eBay's
  approved partners only." Our request was clean (first-party pricing of own ~34
  items, no data sharing, categories 212/213/214/215/216/183444 + 64482/1521, eBay
  UserID MichaelScarn, not EPN) — it was a blanket door-policy "no," not a fault in
  the application. The ticket can be reopened within 10 days but a different answer
  is unlikely; worth reapplying later with a stronger selling/listing track record.
  The `buy.marketplace.insights` scope returns `invalid_scope`. **Workaround in
  place:** the `est_sold` haircut above approximates market from asking comps; for
  the few high-value cards the owner can eyeball real sold prices via the modal's
  **Sold on eBay** button (public eBay search, no API). The plumbing is unchanged —
  `comps.py` still prefers sold + auto-falls-back, so if access is ever granted
  later, `get_comps.py`/`reprice.py` switch to real sold with no code change.
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
- **User token (selling) is LIVE (2026-07-16).** The one-time consent flow is
  done — `check_ebay_login.py` passes ✅ against production. The earlier token
  failed with `invalid_grant` "issued to another client" because it had been
  minted under a different App ID; re-consented against the current keyset
  (App ID `JackMcDe-CardVaul-PRD-…`, RuName `Jack_McDermott-JackMcDe-CardVa-nawpzdw`,
  scopes sell.inventory + sell.account) via the authorization-code flow and
  exchanged the code for a fresh refresh token (valid ~18 mo). Owner saved it as
  the `EBAY_USER_REFRESH_TOKEN` **environment variable** in the Claude Code
  environment settings (not a committed .env). NOTE for future token issues: the
  developer-site "Get a User Token Here" quick tool only returns a 2-hour ACCESS
  token — for the long-lived REFRESH token you must run the real consent link
  (`auth.ebay.com/oauth2/authorize?...&response_type=code`) with the RuName, then
  POST the returned `code` to `identity/v1/oauth2/token` with
  `grant_type=authorization_code`.
- **Business policies + item location are LIVE (2026-07-16).** Created via the
  Sell **Account API** (needs the `sell.account` scope the new token carries).
  First had to opt the account into eBay's Business Policies program
  (`POST /sell/account/v1/program/opt_in` `{"programType":"SELLING_POLICY_MANAGEMENT"}`)
  — before that, policy calls 400'd with "User is not eligible for Business
  Policy." Then created three policies + one inventory location:
    - Fulfillment (shipping): **free standard shipping, 3-day handling** —
      id `274028114016`. NOTE: `USPSGroundAdvantage` 400'd with an LSAS
      "LOGISTICS_INFO_IS_MISSING" ship-eligibility error on this fresh account;
      the generic **`ShippingMethodStandard`** service code worked (same free
      standard shipping to the buyer). Use that generic code for new policies.
    - Payment: immediate pay (managed payments) — id `274028107016`.
    - Return: **30-day, buyer pays** return shipping — id `274028109016`.
    - Location: `STAMFORD-CT` (Stamford, CT 06901, ENABLED).
  Owner saves these as env vars in the Claude Code environment settings (they're
  not secret): `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`,
  `EBAY_RETURN_POLICY_ID`, `EBAY_MERCHANT_LOCATION_KEY` (read by `lister.py` +
  `check_ebay_login.py`). With these + the user token, `check_ebay_login.py`
  reports "✅ you're ready to try a live listing."
- Next: live listing is now fully unblocked — pick the best cards and publish
  with `create_listings.py` / `lister.py` (dry-run first, then `live`).
  Photograph cards first (eBay requires ≥1 photo; `lister.image_urls_for`
  auto-attaches `docs/img/<SKU>.jpg`). Consider a PSA cert/pop lookup.
  (Marketplace Insights / real SOLD comps remain DENIED by eBay — see the note
  above.)
- Backlog (post-v27, not yet built): (a) after the cleaned comps, hand-set or
  add to `SKIP_SKUS` the two remaining outliers — CARD-0021 Tony Pollard
  (broad-match median ~$150, currently held at hand-set) and CARD-0028 Mbappe
  (now a clean +20%, no longer flagged); also eyeball CARD-0027 Deshaun Watson,
  which flags +124% on thin data (only 3 exact comps). (b) Seed
  `watchlist.csv` `fair_value` from the new clean per-grade medians so premium
  rows rate against a fixed reference, not a per-run median. (c) Auction/snipe
  alerts are underused — everything surfacing is FIXED_PRICE; consider weighting
  or a dedicated ending-soon view. (d) Photograph cards for listing (above).
