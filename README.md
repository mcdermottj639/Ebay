# eBay Sports Cards Business

A simple, spreadsheet-driven toolkit for selling sports cards (and other merch)
on eBay — catalog what you have, price it from real eBay data, generate
optimized listings, and push them live. Built to be run by a **non-technical
seller**: you mostly edit a spreadsheet, and the tools do the rest.

---

## The 30-second picture

```
  data/inventory.csv          →   you fill this in (your cards)
        │
        ▼
  check_catalog.py            →   catches typos & missing info
        │
        ▼
  get_comps.py                →   pulls recent eBay prices  (needs API keys)
        │
        ▼
  make_drafts.py              →   writes optimized titles + descriptions
        │
        ▼
  create_listings.py          →   previews, then lists for real  (needs API keys)
```

You never have to touch the code. You edit **one spreadsheet** and run simple
commands (or use the menu).

---

## First-time setup (once)

1. **Install Python packages** (one time):
   ```bash
   pip install -r requirements.txt
   ```

2. **Copy the secrets template** (you'll fill it in later, see the docs):
   ```bash
   cp .env.example .env
   ```

That's it to start cataloging. API keys are only needed for pricing and listing
— see [`docs/01-getting-ebay-api-keys.md`](docs/01-getting-ebay-api-keys.md)
when you're ready.

---

## The easiest way to use it: the menu

```bash
python3 run.py
```

You'll get a numbered menu — just type a number:

```
  1) Check my catalog for mistakes
  2) Make listing drafts (titles + descriptions)
  3) Look up prices/comps on eBay
  4) Preview listings (safe, nothing goes live)
  5) LIST FOR REAL on eBay
```

---

## Or run the steps directly

| I want to…                          | Command                          | Needs API keys? |
|-------------------------------------|----------------------------------|:---------------:|
| Check my spreadsheet for mistakes   | `python3 check_catalog.py`       | No              |
| Generate titles & descriptions      | `python3 make_drafts.py`         | No              |
| Look up prices for my cards         | `python3 get_comps.py`           | Yes             |
| Preview what would be listed        | `python3 create_listings.py`     | No              |
| Actually list on eBay               | `python3 create_listings.py live`| Yes             |
| See everything in a visual dashboard| `python3 dashboard.py`           | No              |

Anything you generate lands in the `output/` folder as spreadsheets you can
open in Excel or Google Sheets.

---

## Your workflow, start to finish

1. **Catalog** — open `data/inventory.csv`, add a row per card. See
   [`docs/02-cataloging-your-cards.md`](docs/02-cataloging-your-cards.md).
2. **Check** — run `check_catalog.py`, fix anything it flags.
3. **Price** — run `get_comps.py`, copy the median prices into your
   `asking_price` column. See [`docs/03-pricing-with-comps.md`](docs/03-pricing-with-comps.md).
4. **Draft** — run `make_drafts.py`, eyeball the titles in `output/drafts.csv`.
5. **Preview** — run `create_listings.py` (safe), then when happy,
   `create_listings.py live`. See [`docs/04-creating-listings.md`](docs/04-creating-listings.md).
6. **Grow** — repricing, reporting, more sales channels. See
   [`docs/05-roadmap-and-expansion.md`](docs/05-roadmap-and-expansion.md).

---

## What still needs a human (and eBay)

- **Photos.** eBay buyers won't buy a card they can't see. Photos are uploaded
  from your phone/computer or hosted online; this toolkit leaves a spot for
  image URLs but doesn't take the pictures for you.
- **eBay developer keys.** Free, but you sign up at developer.ebay.com with
  your existing seller account. Walkthrough in `docs/01`.
- **Production approval.** eBay reviews new apps before letting them create
  real listings. You can build and preview everything while you wait.

---

## Folder map

```
Ebay/
├── README.md                 ← you are here
├── run.py                    ← the friendly menu
├── check_catalog.py          ← the 5 simple commands
├── get_comps.py
├── make_drafts.py
├── create_listings.py
├── requirements.txt          ← Python packages to install
├── .env.example              ← copy to .env, put your keys here
├── data/
│   ├── inventory.csv         ← YOUR CARDS GO HERE (has 3 examples to copy)
│   └── inventory_template_BLANK.csv
├── docs/                     ← step-by-step guides
└── src/ebaytools/            ← the engine (you don't need to touch this)
```

Start with [`docs/02-cataloging-your-cards.md`](docs/02-cataloging-your-cards.md).
