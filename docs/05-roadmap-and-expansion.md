# 05 — Roadmap & expansion

You now have the core loop: **catalog → price → draft → list.** Here's how the
business grows from a shoebox side hustle into something bigger, and what we
build at each stage. Nothing here is required — it's the menu of what's next.

---

## Stage 1 — Get the first listings live (you are here)
- [ ] Catalog your few hundred cards in `data/inventory.csv`
- [ ] Get eBay API keys, test in **sandbox**
- [ ] Pull comps, set prices
- [ ] Preview, then list your best 10–20 cards for real
- [ ] Take good photos — this is the real bottleneck, start now

**Goal:** prove the pipeline end-to-end with real sales.

---

## Stage 2 — Sell smarter (build when you have ~50+ live listings)
- **Sold-comps upgrade** — apply for eBay's **Marketplace Insights API** so
  pricing uses true *sold* prices instead of asking prices.
- **Repricer** — a script that re-pulls comps weekly and flags listings that
  are now over- or under-priced, or auto-adjusts within limits you set.
- **Best Offer automation** — auto-accept offers above a floor, auto-decline
  lowballs, counter in between.
- **Sell-through report** — which sports/sets/price-bands actually move, so you
  buy more of what sells.

---

## Stage 3 — Scale the operation (build when volume hurts)
- **Photo pipeline** — a phone-photo folder that auto-attaches images to the
  right SKU by filename (e.g. `CARD-0001_front.jpg`).
- **Bulk relist / end-and-sell-similar** — recycle unsold inventory
  automatically.
- **Shipping helper** — generate packing lists and pick the cheapest service
  (PWE vs. bubble mailer vs. graded box) by card value.
- **Inventory sync** — when a card sells, mark it sold in your catalog and in
  any other channel automatically.
- **Accounting export** — cost vs. sale vs. fees per card → a clean profit
  spreadsheet for taxes.

---

## Stage 4 — Multi-channel (build when eBay caps you out)
- **COMC / Card Ladder** for bulk lower-value cards.
- **Whatnot** live-auction integration for breaks and hot singles.
- **Your own storefront** (Shopify) fed from the same `inventory.csv`.
- One catalog, many channels — the `inventory.csv` you're building now stays
  the single source of truth for all of them.

---

## Guardrails as you grow

- **eBay rate limits** — the Sell APIs cap how many listings you can create per
  day. Volume tooling should throttle and retry; we'll build that in when you
  hit it.
- **Fees** — eBay final-value fees (~13%+) and any store subscription. Factor
  them into `asking_price` so your `cost` column tells the true profit.
- **Sales tax / 1099-K** — high volume means tax paperwork. The accounting
  export (Stage 3) is designed to make this painless.
- **Card-specific risk** — authenticity and grading disputes. Photograph
  everything, describe condition honestly, keep records.

---

## How to ask for the next build

Just come back to Claude Code in this repo and say what you want, e.g.:
> "Build the weekly repricer from Stage 2."
> "Wire up my photo folder so pictures attach to the right card."
> "Fetch my eBay business policy IDs and put them in .env."

Everything you've set up — the catalog, the modules, the docs — is the
foundation those features snap onto.
