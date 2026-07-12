# 02 — Cataloging your cards

Everything starts here. Your catalog is a single spreadsheet:
`data/inventory.csv`. Open it in **Excel, Numbers, or Google Sheets** — one row
per card (or per lot of identical cards).

There are 3 example rows already in it. The easiest way to start: copy an
example row and edit the values.

---

## The columns

**You only NEED five** to generate a listing: `sku`, `sport`, `year`, `brand`,
`player`. Everything else makes the listing better and more findable — fill in
what you can.

| Column          | What it is                              | Example            | Needed? |
|-----------------|-----------------------------------------|--------------------|:-------:|
| `sku`           | Your own unique ID for the card         | `CARD-0001`        | ✅ yes  |
| `sport`         | Sport                                   | `Basketball`       | ✅ yes  |
| `year`          | Card year (4 digits)                    | `2018`             | ✅ yes  |
| `brand`         | Manufacturer                            | `Panini`, `Topps`  | ✅ yes  |
| `player`        | Player name                             | `Luka Doncic`      | ✅ yes  |
| `set`           | Product/set name                        | `Prizm`, `Chrome`  | strong  |
| `card_number`   | Number on the card                      | `280` or `#280`    | strong  |
| `parallel`      | Color/parallel variety                  | `Silver`, `Red`    | if any  |
| `insert`        | Insert/subset name                      | `Rated Rookie`     | if any  |
| `team`          | Team                                    | `Mavericks`        | nice    |
| `league`        | League                                  | `NBA`              | nice    |
| `rookie`        | Rookie card? `yes`/`no`                 | `yes`              | if RC   |
| `autograph`     | Autographed? `yes`/`no`                 | `no`               | if auto |
| `serial_run`    | Serial numbered out of…                 | `99` (means /99)   | if any  |
| `graded`        | Professionally graded? `yes`/`no`       | `yes`              | —       |
| `grader`        | Who graded it                           | `PSA`,`BGS`,`SGC`  | if graded |
| `grade`         | The grade                               | `10`, `9.5`        | if graded |
| `condition`     | Condition if NOT graded                 | `Near Mint`        | if raw  |
| `quantity`      | How many identical copies               | `1`                | ✅ yes  |
| `cost`          | What you paid (for your own tracking)   | `40`               | optional |
| `asking_price`  | Your list price (fill after comps)      | `85`               | later   |
| `notes`         | Anything for yourself                   | `check comps`      | optional |

> **Leave a cell blank if it doesn't apply.** A base card with no parallel just
> leaves `parallel` empty. The tools skip blank fields automatically.

---

## Good habits

- **SKUs must be unique.** `CARD-0001`, `CARD-0002`, … is fine. The check tool
  yells if two rows share a SKU.
- **`yes`/`no` columns**: `yes`, `y`, `x`, `1`, `true` all count as yes.
- **Graded cards**: set `graded=yes`, fill `grader` and `grade`, leave
  `condition` blank. The title will read like `... PSA 10`.
- **Raw (ungraded) cards**: leave `graded` blank, set `condition` (Near Mint,
  Excellent, etc.).
- **Lots**: selling 5 identical base cards as one listing? One row,
  `quantity=5`.

---

## Check your work

After editing, always run:
```bash
python3 check_catalog.py
```
It gives you a summary (how many cards, rookies, autos, graded) and a list of
anything to fix — duplicate SKUs, bad years, graded cards missing a grade, etc.
Fix, save, run again until it says **"No problems found."**

---

## Cataloging a few hundred cards efficiently

- Do it in batches. Even 20 rows at a sitting adds up.
- Sort your physical cards into piles by set first — you'll fly through rows
  when the year/brand/set repeat.
- Enter your rough `cost` now while you remember it; leave `asking_price` blank
  — you'll fill that from real comps in the next step.

Next: [`03-pricing-with-comps.md`](03-pricing-with-comps.md)
