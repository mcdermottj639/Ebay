# 04 — Creating listings

Now we turn catalog rows into real eBay listings. Two commands:

1. `make_drafts.py` — writes the titles + descriptions (no keys needed).
2. `create_listings.py` — previews, then publishes (keys + setup needed).

---

## Step 1 — Make drafts

```bash
python3 make_drafts.py
```

Creates:
- **`output/drafts.csv`** — every card's title, its character count, and price.
- **`output/drafts.json`** — full detail (item specifics + description) per card.

**Open `output/drafts.csv` and read the titles.** This is the single biggest
lever on whether your cards sell — buyers find cards by typing words into
eBay's search box, and the title is what they match against.

### How titles are built
The toolkit front-loads the words buyers actually search, in this order, then
trims to eBay's 80-character limit:

```
year  brand  set  player  #card  parallel  insert  RC  AUTO  /serial  grade  team
```

Example:
```
2018 Panini Prizm Luka Doncic #280 Silver RC PSA 10 Mavericks   (61 chars)
```

If a title is too long, the **least important words drop off the end first**
(team, then grade, …) so the crucial search terms always survive. If you want a
different title for a specific card, you can tweak the card's fields — better
data in, better title out.

---

## Step 2 — Preview (always safe)

```bash
python3 create_listings.py
```

This is **dry run** — it shows exactly what *would* be sent to eBay and lists
nothing. It skips any card without an `asking_price`. Details go to
`output/listing_results.json` so you can inspect the full payload.

Do this first, every time. There's no way to accidentally list here.

---

## Step 3 — Photos

eBay listings need images. This toolkit has a spot for image URLs but does not
take photos for you. Your options:

- **Upload in eBay's listing screen** after the API creates the draft (simplest
  to start).
- **Host images** (eBay Picture Manager, or any public image URL) and pass the
  URLs in — ask Claude to wire your photo folder in when you're ready.

Good card photos: bright even light, straight-on, no glare, front and back,
fill the frame. Photos sell cards more than words do.

---

## Step 4 — Go live

When previews look right, your keys work, and your business-policy IDs are in
`.env` (see [`01-getting-ebay-api-keys.md`](01-getting-ebay-api-keys.md)):

```bash
python3 create_listings.py live
```

This runs eBay's three-step publish for each priced card:
1. **createOrReplaceInventoryItem** — the card's details
2. **createOffer** — price + your shipping/payment/return policies
3. **publishOffer** — it goes live; you get a listing ID

Results (including live listing IDs) are saved to
`output/listing_results.json`.

> **Start small.** List 2–3 cards live first, confirm they look right on eBay,
> then do the rest. In `sandbox` mode nothing is real, so it's a perfect place
> to rehearse the whole flow.

---

## If something errors

The tool prints a clear reason per card and keeps going. Common ones:
- *"no asking_price"* — price the card first (comps step).
- *"missing EBAY_… policy"* — finish Step 4 of the keys guide.
- *eBay 400 error* — usually a missing required item specific for that category;
  paste the message to Claude and it'll tell you exactly what to add.

Next: [`05-roadmap-and-expansion.md`](05-roadmap-and-expansion.md)
