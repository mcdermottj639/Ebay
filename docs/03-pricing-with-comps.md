# 03 — Pricing with comps

"Comps" = comparable sales. The golden rule of card pricing: **price off what
cards actually SELL for, not what people are asking.** This step pulls real
eBay data so you're not guessing.

Requires your API keys (see [`01-getting-ebay-api-keys.md`](01-getting-ebay-api-keys.md)).

---

## Run it

```bash
python3 get_comps.py
```

For each card in your catalog it searches eBay and prints something like:

```
"2018 Panini Prizm Luka Doncic #280 Silver RC PSA 10 Mavericks"
  23 active (asking) listings
  low $70.00  |  median $92.00  |  high $150.00
```

It also saves everything to **`output/comps.csv`** — open that in a spreadsheet.

---

## Active vs. sold prices

There are two kinds of comp data:

- **Active listings** (what this tool uses by default): what cards are listed
  *for* right now. Available with basic API keys. Asking prices run a bit high
  — people list optimistically.
- **Sold listings** (true comps): what cards *actually sold* for. This is the
  gold standard, but eBay gates it behind the **Marketplace Insights API**,
  which you apply for separately. Once you're granted access, this tool uses it
  automatically.

**Rule of thumb until you have sold data:** take the active **median** and
shave ~10–15% to land near real sold prices. The tool shows low/median/high so
you can judge.

---

## Turning comps into prices

1. Open `output/comps.csv` next to `data/inventory.csv`.
2. For each card, decide your `asking_price`:
   - **Want it gone fast?** Price at or just below the median.
   - **Patient / rare card?** Price toward the high end, accept offers.
   - **Auction instead?** (not automated yet) Start low, let bidding work —
     best for hot/scarce cards.
3. Type the number into the `asking_price` column in `data/inventory.csv` and
   save.

> Pricing tip for cards specifically: **condition and grade swing price
> enormously.** A raw Near-Mint rookie and a PSA 10 of the same card are
> different markets — make sure your search (title) reflects the exact version,
> which it does automatically when your catalog row is accurate.

---

## Sanity checks

- If `count` is 0, your card details might be too specific or misspelled. Check
  the `query` column in `output/comps.csv` — that's exactly what was searched.
- Wildly high `high` values are often graded/rare parallels mixed in. The
  **median** is the number to trust, not the extremes.
- Re-run anytime prices move (hot rookie, playoff run, etc.). Card prices are
  seasonal.

Once prices are filled in, move on to drafting and listing.

Next: [`04-creating-listings.md`](04-creating-listings.md)
