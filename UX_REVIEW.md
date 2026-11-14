# Cross-app UX research and continuation record

Updated November 13, 2026. This is Jack's shared research reference for the
one-app-at-a-time review. Keep it available to each succeeding chat.

## Goal and order

### Card Vault movement follow-up — November 13

Jack's Inventory screenshot exposed a gap in v71: movement was not visible in
the owned collection. This follow-up adds dated period controls, a fixed-cohort
value chart, visual risers/fallers, percentage and dollar changes beside each
card, richer image/list layouts and matching detail charts. Less-used filters
fold into one section. Black/gold stays; teal and coral identify direction.

| Primary source checked Nov 13 | Documented pattern | Applied here | Limit |
| --- | --- | --- | --- |
| [Collectr tracking](https://www.getcollectr.com/track) | Period charts, portfolio changes, valuable/trending items | Chart and movers directly in Inventory | Marketing/public page, not an authenticated test |
| [Card Ladder valuation methods](https://cardladder.zendesk.com/hc/en-us/articles/12047139141655-Estimate-the-Value-of-any-Card-in-Your-Collection) | Source-specific estimation, dated graphs and underlying sales | Source changes reset comparisons; evidence stays accessible | Card Vault does not inherit its data feed or estimates |
| [Alt confidence levels](https://support.alt.xyz/en/articles/9213564-alt-value-confidence-levels) | Data coverage affects valuation confidence | Visible dates/coverage; unavailable stays unavailable | No new confidence score or automatic price claim |

Calculation contract: 1W/1M/3M/1Y end at the latest compatible saved observation,
not the current wall-clock moment. A baseline can precede the period cutoff by
at most eight days, flagged approximate with actual dates. All begins after the
latest correction/source reset. Aggregates require a fixed cohort and common
dated observations; show its tracked value separately from the entire vault.
No new cards, sales, source changes or price corrections count as appreciation.
An unchanged saved value can be carried forward; it is not a verified flat
market. Missing photos use labeled placeholders, never another card's image.

Independent review recomputed the existing CSV weekly/monthly results and
caught endpoint-cent and missing-basis edge cases, now covered by regressions.
The repricer's UTC date convention is preserved; freshness uses New York days.
Checks include exact cents, source resets, day boundaries, cohort weighting,
history metadata, source-write provenance, navigation, reload and narrow layouts.
Publication and observed-live evidence are recorded in the canonical handoff.

Improve both presentation and the complete progression through each app:
understand the situation → inspect evidence → decide → continue with context.
Jack wants compact phone layouts, clear numbers, useful images, fewer repeated
steps and less scrolling, with every useful detail still accessible.

| App | Status for this review | Main journey |
| --- | --- | --- |
| Sports Hub | Prior chat verified v369, including 437 tests and live navigation checks; preserve that baseline | Today → game → Matchup Lab → evidence/model comparison → Back |
| Card Vault / eBay | v71 implementation and checks below; publication evidence belongs in the current shared handoff | Target → saved research → exact comps/costs → track; owned card → plan → listing draft → results |
| Portfolio Dashboard | NEXT; start from latest main and its current handoff | Holding → what changed → research → account-specific decision |
| Caddie HQ | After Portfolio Dashboard | Course → prep → hole guide → score → recap |
| Jarvis | Last | Needs attention → evidence → complete / dismiss / revisit |

Do one app thoroughly before moving to the next. Do not reopen a completed app
unless a concrete regression or dependency needs attention. A verified baseline
reduces risk; it cannot promise that future releases will never regress.

## Research provenance

The earlier chat, **Research Best App UX** (November 11), supplied the benchmark
set: Apple Sports, Sofascore, Linear, Robinhood Legend / TradingView, eBay Price
Guide, Airbnb, Uber and Duolingo. Its recommendations were recovered from the
conversation record, then supplemented with marketplace research for Card Vault.
This document preserves that reusable synthesis; it is not a claim to contain
every word of the original chat. Sources below were inspected during this pass,
except the explicitly identified carried-forward Apple Sports reference.

| Source | Useful pattern | Application, not a claim of copied design |
| --- | --- | --- |
| [eBay Product Research](https://www.ebay.com/help/selling/selling-tools/product-research?id=4853) | Search/filter sold evidence, including accepted Best Offer prices | Product Research first; match year, set, parallel and grade before estimating resale |
| [eBay Price Guide](https://pages.ebay.com/price-guide/) | Move between grade comparisons, value and transaction preparation | Keep evidence and the next action near the card |
| [Fanatics Collect app](https://www.fanaticscollect.com/app) | Sales history, watchlists and the shop/vault/sell journey | Visual discovery with a track action and a continuous selling flow |
| [Card Ladder: single-card sales](https://cardladder.zendesk.com/hc/en-us/articles/19095828773655-View-Sales-of-a-Single-Card-in-Sales-History) | Filter history to the card and grade | Search-family membership is not exact-comp verification |
| [Linear custom views](https://linear.app/docs/custom-views) | Reusable filtered views | Remember filters, sorting and context when navigating |
| [Robinhood Legend widget linking](https://robinhood.com/us/en/support/articles/widget-linking-on-legend/) | Connected views follow the same asset | Carry the selected asset from overview to research and decision |
| [TradingView selected chart synchronization](https://www.tradingview.com/support/solutions/43000761094-how-to-sync-selected-charts/) | Keep related views synchronized | Use consistent context without conflating accounts or data sources |
| [Sofascore home screen](https://www.sofascore.com/news/sofascores-new-home-screen-a-smarter-faster-way-to-follow-sports) | Personal relevance and access to nearby events | Show the user's useful next destination early |
| [Airbnb fall 2026 update](https://news.airbnb.com/airbnb-2026-fall-update) | Search/filter and compare saved choices | Compact comparisons with important differences visible |
| [Uber iOS Live Activity](https://www.uber.com/us/en/blog/live-activity-on-ios/) | Glanceable progress and state | Make current status, freshness and next step understandable |
| [Duolingo home-screen design](https://blog.duolingo.com/new-duolingo-home-screen-design/) | A clear next action in a progression | Guide the next step without hiding optional depth |
| [Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Primary information first, secondary detail on demand | Fold rules, assumptions and long evidence while preserving access |
| [Nielsen Norman Group: three-click rule](https://www.nngroup.com/articles/3-click-rule/) | Click count alone does not measure usability | Reduce effort and confusion; do not impose a fake three-tap ceiling |
| [Apple buttons guidance](https://developer.apple.com/design/human-interface-guidelines/buttons) | Clear labels and usable interaction regions | Target about 44px touch controls while keeping layouts compact |
| [Apple Sports](https://support.apple.com/en-us/116979) | Carried-forward benchmark: concise sports entry experience | Original benchmark retained; this pass's source fetch was rate-limited |

## Common design rules

1. Answer **what matters, what changed, what next**. Keep the primary action
   close to the information required to use it.
2. Use the app's own visual identity. Consistent navigation does not mean making
   every app look like Golf Hub or another app.
3. Reduce duplicate entry. Carry the selected game, card, holding or course
   forward. Prefill known facts; keep assumptions editable and named.
4. Remember filters, sort, subview and position where useful. Back, Close and
   refresh must preserve understandable context, including direct links.
5. Prefer compact summaries and expandable details over long default pages.
   No evidence, control or important limitation should disappear for compactness.
6. Show exact identity, source, observation date and uncertainty. Unknown is
   different from zero. A saved snapshot is not a live quote. Gross, net and
   adjusted values must use distinct labels.
7. Make loading, empty, stale, partial and error states useful. Explain a next
   action and give a recovery path. Do not create fake positive results.
8. Keep controls comfortable for phone and Steam Deck; check text wrapping,
   focus, keyboard operation, overlays, bottom navigation and dark/light themes.

## Card Vault v70 / v71 implementation

- Buy Radar now uses compact photo cards: ask, estimated total purchase cost,
  resale estimate, cash profit after selling costs, and the separate adjusted
  result after time/risk/holding allowances. Full exact amounts and sources stay
  in Review card. Unsupported resale/profit remains unknown.
- Targets have images when a saved search provides them, search/sport/category
  filters, research counts and a local review route before leaving the app.
  A search-sample image is labeled **identity unverified**. It never qualifies a
  listing or establishes the exact card/grade.
- Track saves a device-local shortlist. It does not buy, import inventory, send
  an offer or promote a research card into a qualified opportunity.
- The read-only `docs/buying.js` helper maintains the PSA 10 view, demotes expired
  qualified observations after 48 hours and hides nonqualifying grade exceptions.
  The Python evaluator and all owner-approved thresholds remain authoritative.
- Filters persist in `cv-buy-v1`; session navigation uses `cv-journey-v1`.
  Existing owner numbers, private offer plans and ledger stores are preserved.
- An owned, unlisted card can continue from a selling plan into an editable
  individual listing draft, carrying the owner's target price. Drafts reuse the
  existing `Selling.lotQuote` estimates and save within `cv-selling-v1`. Blank
  acquisition cost does not become zero-cost profit. Drafts are BIN + Best Offer;
  the app does not post a listing. Listed/sold cards use their existing records.
- Saved individual drafts appear first and count in the Drafts badge. Existing
  lot drafts, private offers, Today, Inventory and Results remain accessible.
- Card details now explicitly label the before-fee figure **Gross profit** and
  call the stored comparison listings/range **saved**, avoiding false freshness.
- Release files and offline shell move together to v71, including `buying.js`
  in the cached shell and standalone build.

v70 was deployed and live-checked. That check caught a rapid Close → next card
race; v71 keeps the backdrop until Back completes. The reproduced sequence and
refreshed-card Back check both pass with the fix.

### Verification and limits

- [Phone layout evidence](research/card-vault-v70-mobile.png): 390px target view
  and 320px research view. The v70 layout is unchanged in v71. These are browser
  frames, not physical phones.
- Automated: 39 Python and 36 Node tests; JS syntax; catalog validation; rebuilt
  data; diff/whitespace checks. Seven new helper tests cover freshness, grade
  exceptions, unknown values, target matching, tracking, sorting and preferences.
- Browser: 320px and 390px frames and desktop; dark/light layouts; no horizontal
  page overflow in the narrow frames. Checked target discovery/review, tracking,
  remembered filters, Back, card deep links/refresh, plan-to-draft prefilling,
  saved draft reopening, and Today / Sell / Inventory / Results navigation.
- Draft test used only the preview's local browser storage. No purchase,
  marketplace listing, offer, trade or owner ledger update was performed.
- A real iPhone / Steam Deck was not available. Browser viewport checks are not
  a claim of physical-device testing. Tracking and drafts are device-local.
- Existing catalog and market evidence were preserved: 44 catalog items and the
  893-observation radar snapshot. Zero qualified buys remains a legitimate
  evidence outcome, not a UX failure to fill with unverified opportunities.
- Operational backlog stays separate: fresh exact sold comps, some owner costs
  and photos, source/API access limitations and proof of the separate offer
  relay's first successful run. Consult current handoff for changes to those.

## Start and finish procedure for each remaining app

Read **00 — Claudex coordination**, this document and the app's latest shared
handoff, then inspect latest main, open PRs and repository instructions. A past
version is a baseline, not permission to overwrite newer work. Claim a bounded
scope in the handoff and preserve other assistants' work.

Audit the entire journey, implement relevant research patterns, run meaningful
tests and browser checks, then publish within Jack's authorized scope. Verify
remote commit, deployment and served UI separately. If a real access/approval
block occurs, report the concrete finished work and the exact remaining action;
do not claim publication or ask for speculative approval in advance.

Update the app handoff with the research link, implementation, test evidence,
publication/live status, remaining operational gaps and released claim. Give
Jack a copy-ready prompt for the **next app in the sequence**, carrying these
same instructions and links. At the end of Jarvis, provide a final completion
and unresolved-items list instead of another app prompt.

### Handoff links

- [00 — Claudex coordination](https://docs.google.com/document/d/1oyJS2uyoBF8-TET3fLxU-hvlke9U805GXNhFjMb4k8Q/edit)
- [Card Vault / eBay](https://docs.google.com/document/d/1Qpg8aLmv-BR1tKX554_JXNegompKGVeRunsJsXxzNSo/edit)
- [Sports Hub](https://docs.google.com/document/d/1Ayh9Sfaff1hXQ2aVK4vreLPpdrHqoZSHebPrJLk79lo/edit)
- [Portfolio Dashboard](https://docs.google.com/document/d/1tRDoWPVmd8HhEV7-rqPoqG1cYe7Yp9lAXAasEMos5xw/edit)
- [Caddie HQ](https://docs.google.com/document/d/10TzWts8Im5hGWAcYKpHSUhuiOwJYrUii2g2TLiZtShc/edit)
- [Jarvis](https://docs.google.com/document/d/1rS1uTgGb3GvaiADqUaqbKajcztb29WMJUzDlM1Qii-E/edit)

## Portfolio Dashboard continuation brief

Continue Jack's research-based UI/UX review, one app at a time. Portfolio
Dashboard is next, followed by Caddie HQ and Jarvis. Use the sources and common
rules in this file; supplement them with current primary product documentation
when needed. Research is guidance, not a template to blindly copy.

Start from `mcdermottj639/portfolio-dashboard` latest main and current shared
handoff. At this review's handoff read, Apex v216 / PR194 and the agentic retry
fix / PR193 were already merged. Re-verify the current state. Preserve account
separation, entry-versus-held-exit logic, source/freshness controls, privacy,
owner-managed exceptions and the existing confirmation flow. The UX task does
not authorize trades or changes to strategy/risk thresholds.

Review the whole progression: overview/holding → changes and relevant research
→ clear account-specific action → context-preserving return. Prioritize phone
scannability, numbers/charts, compact spacing, progressive detail, remembered
state and readable navigation. Retain all useful information. Verify the
changed UI and existing producer/model/account/privacy regressions, including
320/390px, Back, refresh, selection and expandable evidence.

Finish, record publication and live verification honestly, update the shared
handoff, state what remains, then give Jack the next copy-ready **Caddie HQ**
prompt. That prompt must pass along this research and require a **Jarvis** prompt
after Caddie is finished; Jarvis ends with the overall completion checklist.
