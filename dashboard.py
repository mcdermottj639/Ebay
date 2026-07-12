#!/usr/bin/env python3
"""Build a visual dashboard of your whole collection — one HTML page.

Reads your inventory.csv (plus anything already in output/) and writes
output/dashboard.html. Double-click that file to open it in your web browser.
No internet, no server, no login — it's your at-a-glance view of everything.

Run it with:   python3 dashboard.py
"""

import json
import sys
from html import escape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
from ebaytools import catalog  # noqa: E402

OUTPUT = Path(__file__).parent / "output"


def _money(cards, field):
    total = 0.0
    for c in cards:
        val = getattr(c, field).replace("$", "").replace(",", "").strip()
        try:
            total += float(val)
        except ValueError:
            pass
    return total


def _listed_skus():
    """SKUs that were actually published (from a previous 'live' run)."""
    path = OUTPUT / "listing_results.json"
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return set()
    return {r.get("sku") for r in data if isinstance(r, dict) and not r.get("dry_run")}


def _load_deals():
    """Deals found by find_deals.py, if any."""
    path = OUTPUT / "deals.json"
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return []


def _bars(n):
    """Value bars like Alt's — filled green up to n, hollow after."""
    return "".join(
        f'<i class="bar {"on" if i < n else ""}"></i>' for i in range(3)
    )


def _deals_section():
    deals = _load_deals()
    if not deals:
        return ""
    colors = {3: "#1a9e5f", 2: "#5a9e1a", 1: "#c77d0a", 0: "#d1495b"}
    rows = []
    for d in deals[:25]:
        snipe = '<span class="snipe">ENDING SOON</span>' if d.get("snipe") else ""
        kind = "Auction" if d.get("buying_option") == "AUCTION" else "Buy It Now"
        disc = d.get("discount_pct", 0)
        bars = d.get("bars", 0)
        color = colors.get(bars, "#8a8a99")
        img = (f'<img src="{escape(d["image"])}" alt="">' if d.get("image")
               else '<div class="noimg"></div>')
        rows.append(f"""
        <a class="deal" href="{escape(d.get('url',''))}" target="_blank">
          <div class="thumb">{img}</div>
          <div class="mid">
            <div class="dl">{escape(str(d.get('label','')))} {snipe}</div>
            <div class="dt">{escape(d.get('item_title','')[:66])}</div>
            <div class="dm">{kind} · market ${d.get('reference',0):.0f}</div>
          </div>
          <div class="dr">
            <div class="dp">${d.get('price',0):.2f}</div>
            <div class="bars">{_bars(bars)}</div>
            <div class="dd" style="color:{color}">{disc:+.0f}%</div>
          </div>
        </a>""")
    return (
        '<section><h2>🎯 Buy Radar — deals under market</h2>'
        f'<div class="deals">{"".join(rows)}</div></section>'
    )


def _status(card, listed):
    if card.sku in listed:
        return ("Listed", "ok")
    if card.asking_price.strip():
        return ("Priced", "warn")
    return ("Needs price", "todo")


def build_html(cards, template=None):
    listed = _listed_skus()
    total_cost = _money(cards, "cost")
    total_value = _money(cards, "asking_price")
    profit = total_value - total_cost
    qty = sum(int(c.quantity) for c in cards if c.quantity.isdigit())

    by_sport = {}
    for c in cards:
        if c.sport:
            by_sport[c.sport] = by_sport.get(c.sport, 0) + 1
    sport_rows = "".join(
        f'<div class="bar"><span>{escape(s)}</span>'
        f'<div class="track"><div class="fill" style="width:{(n/len(cards)*100):.0f}%"></div></div>'
        f'<b>{n}</b></div>'
        for s, n in sorted(by_sport.items(), key=lambda x: -x[1])
    )

    rows = []
    for c in cards:
        label, cls = _status(c, listed)
        flags = " ".join(
            f'<span class="flag">{f}</span>'
            for f, on in [("RC", c.is_rookie()), ("AUTO", c.is_auto()),
                          (f"{c.grader} {c.grade}".strip(), c.is_graded())]
            if on and f.strip()
        )
        rows.append(
            f"<tr>"
            f"<td class='mono'>{escape(c.sku)}</td>"
            f"<td>{escape(c.year)} {escape(c.brand)} {escape(c.set)}</td>"
            f"<td><b>{escape(c.player)}</b> {flags}</td>"
            f"<td>{escape(c.sport)}</td>"
            f"<td class='num'>{escape(c.cost)}</td>"
            f"<td class='num'>{escape(c.asking_price)}</td>"
            f"<td><span class='status {cls}'>{label}</span></td>"
            f"</tr>"
        )

    priced = sum(1 for c in cards if c.asking_price.strip())
    return (template or TEMPLATE).format(
        total_rows=len(cards),
        qty=qty,
        total_cost=f"${total_cost:,.2f}",
        total_value=f"${total_value:,.2f}",
        profit=f"${profit:,.2f}",
        profit_cls="ok" if profit >= 0 else "todo",
        priced=priced,
        listed=len(listed),
        sport_rows=sport_rows or "<p class='muted'>No sports recorded yet.</p>",
        deals_section=_deals_section(),
        table_rows="".join(rows) or "<tr><td colspan='7' class='muted'>No cards yet — add rows to data/inventory.csv.</td></tr>",
    )


# Body-content only (style + markup + script). Used directly when publishing to
# a URL, where the host supplies <!doctype>/<head>/<body>. Wrapped into a full
# document below for the local double-click file.
CONTENT = """<style>
  :root {{
    color-scheme: light dark;
    --bg:#f4f5f7; --fg:#1a1a2e; --card:#fff; --muted:#8a8a99; --track:#e6e7eb;
    --thead:#eef0f4; --thead-fg:#6a6a7a; --border:rgba(128,128,128,.15);
    --dt:#555; --barbg:#d6d8de; --accent:#4361ee; --shadow:0 1px 3px rgba(0,0,0,.08);
  }}
  /* Dark palette — applied by system pref (when no manual choice) OR by toggle */
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme]) {{
      --bg:#14151a; --fg:#e8e8ea; --card:#1e2028; --track:#2a2c34;
      --thead:#23252f; --thead-fg:#9a9aa8; --border:rgba(255,255,255,.08);
      --dt:#b8b8c0; --barbg:#3a3c44; --accent:#5a78ff;
    }}
  }}
  :root[data-theme="dark"] {{
    --bg:#14151a; --fg:#e8e8ea; --card:#1e2028; --track:#2a2c34;
    --thead:#23252f; --thead-fg:#9a9aa8; --border:rgba(255,255,255,.08);
    --dt:#b8b8c0; --barbg:#3a3c44; --accent:#5a78ff;
  }}
  * {{ box-sizing: border-box; }}
  body {{ font-family:-apple-system,Segoe UI,Roboto,sans-serif; margin:0;
    background:var(--bg); color:var(--fg); transition:background .2s,color .2s; }}
  header {{ padding:28px 24px 8px; }}
  h1 {{ margin:0 0 4px; font-size:22px; }}
  .muted {{ color:var(--muted); font-size:13px; }}
  .wrap {{ max-width:1100px; margin:0 auto; padding:0 24px 40px; }}
  .themebtn {{ position:fixed; top:16px; right:16px; z-index:10; cursor:pointer;
    border:1px solid var(--border); background:var(--card); color:var(--fg);
    border-radius:20px; padding:6px 12px; font-size:15px; box-shadow:var(--shadow); }}
  .tiles {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
    gap:12px; margin:16px 0 8px; }}
  .card {{ background:var(--card); border-radius:12px; padding:16px; box-shadow:var(--shadow); }}
  .card .k {{ font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }}
  .card .v {{ font-size:24px; font-weight:700; margin-top:4px; }}
  .ok {{ color:#1a9e5f; }} .todo {{ color:#d1495b; }} .warn {{ color:#c77d0a; }}
  section {{ margin-top:24px; }}
  h2 {{ font-size:15px; margin:0 0 10px; }}
  .bar {{ display:grid; grid-template-columns:110px 1fr 32px; align-items:center;
    gap:10px; margin:6px 0; font-size:13px; }}
  .track {{ background:var(--track); border-radius:6px; height:10px; overflow:hidden; }}
  .fill {{ background:var(--accent); height:100%; }}
  table {{ width:100%; border-collapse:collapse; background:var(--card); border-radius:12px;
    overflow:hidden; box-shadow:var(--shadow); font-size:13px; }}
  th, td {{ text-align:left; padding:10px 12px; border-bottom:1px solid var(--border); }}
  thead th {{ background:var(--thead); font-size:11px; text-transform:uppercase;
    letter-spacing:.04em; color:var(--thead-fg); }}
  .num {{ text-align:right; }}
  .mono {{ font-family:ui-monospace,Menlo,monospace; font-size:12px; color:var(--muted); }}
  .status {{ padding:3px 9px; border-radius:20px; font-size:11px; font-weight:600; }}
  .status.ok {{ background:rgba(26,158,95,.15); color:#1a9e5f; }}
  .status.warn {{ background:rgba(199,125,10,.15); color:#c77d0a; }}
  .status.todo {{ background:rgba(209,73,91,.15); color:#d1495b; }}
  .flag {{ display:inline-block; background:var(--accent); color:#fff; font-size:10px;
    font-weight:700; padding:1px 6px; border-radius:4px; margin-left:4px; }}
  .deals {{ display:flex; flex-direction:column; gap:8px; }}
  .deal {{ display:flex; gap:12px; align-items:center; background:var(--card); border-radius:12px;
    padding:10px 14px; text-decoration:none; color:inherit; box-shadow:var(--shadow); }}
  .thumb img, .noimg {{ width:56px; height:56px; object-fit:contain; border-radius:8px; background:var(--track); }}
  .deal .mid {{ flex:1; min-width:0; }}
  .deal .dl {{ font-size:13px; font-weight:700; }}
  .deal .dt {{ font-size:13px; color:var(--dt); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }}
  .deal .dm {{ font-size:11px; color:var(--muted); margin-top:2px; }}
  .deal .dr {{ text-align:right; white-space:nowrap; }}
  .deal .dp {{ font-size:16px; font-weight:700; }}
  .deal .dd {{ font-size:12px; font-weight:700; }}
  .bars {{ display:inline-flex; gap:3px; margin:3px 0; }}
  .bars .bar {{ width:7px; height:12px; border-radius:2px; background:var(--barbg); display:inline-block; }}
  .bars .bar.on {{ background:#1a9e5f; }}
  .snipe {{ background:#d1495b; color:#fff; font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px; }}
</style></head>
<body>
<button id="themebtn" class="themebtn" onclick="toggleTheme()" title="Toggle light/dark">🌙</button>
<header class="wrap">
  <h1>🃏 My eBay Card Collection</h1>
  <div class="muted">Snapshot of everything in your catalog. Re-run <b>python3 dashboard.py</b> to refresh.</div>
</header>
<div class="wrap">
  <div class="tiles">
    <div class="card"><div class="k">Unique cards</div><div class="v">{total_rows}</div></div>
    <div class="card"><div class="k">Physical cards</div><div class="v">{qty}</div></div>
    <div class="card"><div class="k">Total cost</div><div class="v">{total_cost}</div></div>
    <div class="card"><div class="k">Est. value</div><div class="v">{total_value}</div></div>
    <div class="card"><div class="k">Potential profit</div><div class="v {profit_cls}">{profit}</div></div>
    <div class="card"><div class="k">Priced / Listed</div><div class="v">{priced} / {listed}</div></div>
  </div>

  {deals_section}

  <section>
    <h2>By sport</h2>
    {sport_rows}
  </section>

  <section>
    <h2>All cards</h2>
    <table>
      <thead><tr>
        <th>SKU</th><th>Year / Set</th><th>Player</th><th>Sport</th>
        <th class="num">Cost</th><th class="num">Asking</th><th>Status</th>
      </tr></thead>
      <tbody>{table_rows}</tbody>
    </table>
  </section>
</div>
<script>
(function(){{
  var root=document.documentElement;
  var saved=localStorage.getItem('theme');
  if(saved){{ root.setAttribute('data-theme', saved); }}
  function current(){{
    return root.getAttribute('data-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }}
  function setIcon(){{
    var b=document.getElementById('themebtn');
    if(b) b.textContent = current()==='dark' ? '☀️' : '🌙';
  }}
  window.toggleTheme=function(){{
    var next = current()==='dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    setIcon();
  }};
  setIcon();
}})();
</script>"""

# Full standalone document for the local file (double-click to open).
TEMPLATE = (
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<title>My eBay Card Collection</title></head>\n<body>\n'
    + CONTENT + '\n</body></html>'
)


def main() -> int:
    try:
        cards = catalog.load()
    except FileNotFoundError as e:
        print(e)
        return 1
    OUTPUT.mkdir(exist_ok=True)
    out = OUTPUT / "dashboard.html"
    out.write_text(build_html(cards), encoding="utf-8")
    # Publish-ready fragment (no doctype/head/body — the web host supplies those).
    (OUTPUT / "dashboard_web.html").write_text(build_html(cards, CONTENT), encoding="utf-8")
    print(f"Dashboard built: {out}")
    print("Open it: double-click the file, or drag it into your web browser.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
