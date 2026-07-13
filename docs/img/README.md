# Card photos

Drop a photo here named after the card's **SKU** and it shows up in the app
automatically — a thumbnail on the card row and a big image in the detail view.

- Name it exactly the SKU, any common image type:
  `CARD-0019.jpg`, `CARD-0019.jpeg`, `CARD-0019.png`, or `CARD-0019.webp`
  (merch too: `MERCH-0001.jpg`).
- Then merge to `main` — the site rebuilds and the photo appears.
- No photo yet? The card shows a themed placeholder, so nothing looks broken.

`build_web.py` scans this folder and matches files to SKUs; there's nothing to
edit in a spreadsheet.
