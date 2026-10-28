/* Card Vault — client-side app. Reads inlined window.__CARD_DATA__ (preview)
   or fetches ./data.json (on GitHub Pages). Renders a tabbed, card-based PWA. */

(function () {
  "use strict";

  var APP_VERSION = "v60";
  var state = { tab: "today", filter: "All", data: null, bucket: "Cards",
                collapsed: {}, q: "", sort: "val-desc", sellMode: "plan", buyMode: "radar", inventoryStatus: "all", inventorySport: "all", inventoryType: "all", inventoryLayout: "list",
                radarFilter: { type: "all", sport: "all", graded: "all", grade: "all" } };

  // ---------- helpers ----------
  function el(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function money(n) { return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(n) { return "$" + Math.round(Number(n || 0)).toLocaleString(); }
  function num(v) { var n = parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? 0 : n; }
  function copyText(t) { try { if (navigator.clipboard) navigator.clipboard.writeText(t); } catch (e) {} }
  function flashBtn(btn, msg) { var o = btn.innerHTML; btn.textContent = msg; setTimeout(function () { btn.innerHTML = o; }, 1900); }

  // ---------- My numbers (owner-entered cost + real sold prices) ----------
  // eBay denied us the sold-comps API, so the truest data is what the owner
  // records themself: what a card actually cost, and real sold prices seen on
  // eBay's sold search / Terapeak / 130point. Entries save instantly on this
  // device (localStorage) and merge with entries already baked into the sheet
  // (card.my_sales from data.json). "Send to Claude" makes device entries
  // permanent in the spreadsheet — then they show on every device.
  var MYDATA_KEY = "cv-mydata";
  function loadMyData() {
    try {
      var d = JSON.parse(localStorage.getItem(MYDATA_KEY) || "{}");
      return { costs: d.costs || {}, sales: d.sales || {}, sold: d.sold || {},
               touched: d.touched || 0, synced: d.synced || 0 };
    } catch (e) { return { costs: {}, sales: {}, sold: {}, touched: 0, synced: 0 }; }
  }
  function saveMyData() { try { localStorage.setItem(MYDATA_KEY, JSON.stringify(myData)); } catch (e) {} }
  // A real edit by the owner: marks this phone's copy newer than the sheet's,
  // which is what tells the box whether there is anything left to save.
  function touchMyData() { myData.touched = Date.now(); saveMyData(); }
  var myData = loadMyData();

  // Merge device entries into the loaded data. Idempotent: raw sheet values
  // are kept on the card (_csvCost/_bakedSales) so re-running after an edit
  // can't double-apply. Also prunes device entries that have since been baked
  // into the sheet, so the "send to Claude" count stays honest.
  function recalcMyData() {
    var data = state.data;
    if (!data) return;
    var dirty = false;
    data.cards.forEach(function (c) {
      if (c._csvCost === undefined) c._csvCost = c.cost;
      if (!c._bakedSales) c._bakedSales = (c.my_sales || []).slice();
      // cost: the sheet wins; a device-entered cost fills a blank sheet cost
      if (num(c._csvCost) > 0 && myData.costs[c.sku]) { delete myData.costs[c.sku]; dirty = true; }
      // A sale the owner marked on THIS device has to retire the card right
      // away. v38 stored it but only ever PRUNED it here, so `c.sold` stayed
      // false until the sheet caught up — and every `!c.sold` filter kept the
      // card in the Collection for those ~2 minutes. That is precisely the
      // "marked sold but still sitting in my collection" report. Remember the
      // baked values first so this stays idempotent and undo can restore them.
      if (c._csvSold === undefined) {
        c._csvSold = !!c.sold; c._csvSoldPrice = c.sold_price;
        c._csvSoldDate = c.sold_date; c._csvListed = c.listed;
      }
      // NB: test the BAKED flag, never the live one — after the block below
      // `c.sold` may be true because of the device entry we are about to sync,
      // and pruning on that would delete it before it ever reached the sheet.
      if (c._csvSold && myData.sold[c.sku]) { delete myData.sold[c.sku]; dirty = true; }
      var mineSale = myData.sold[c.sku];
      if (!c._csvSold && mineSale && num(mineSale.p) > 0) {
        c.sold = true; c.sold_price = String(num(mineSale.p));
        c.sold_date = mineSale.d || ""; c.listed = ""; c.sold_local = true;
      } else {
        c.sold = c._csvSold; c.sold_price = c._csvSoldPrice;
        c.sold_date = c._csvSoldDate; c.listed = c._csvListed; c.sold_local = false;
      }
      var localCost = num(myData.costs[c.sku]);
      c.cost = num(c._csvCost) > 0 ? c._csvCost : (localCost > 0 ? String(localCost) : c._csvCost);
      c.cost_local = num(c._csvCost) <= 0 && localCost > 0;
      // sales: sheet entries + device entries, deduped on date|price
      var baked = {};
      c._bakedSales.forEach(function (s) { baked[(s.d || "") + "|" + s.p] = 1; });
      var local = (myData.sales[c.sku] || []).filter(function (s) { return !baked[(s.d || "") + "|" + s.p]; });
      if (local.length !== (myData.sales[c.sku] || []).length) {
        if (local.length) myData.sales[c.sku] = local; else delete myData.sales[c.sku];
        dirty = true;
      }
      c.my_sales_all = c._bakedSales.map(function (s) { return { d: s.d, p: s.p, n: s.n || "" }; })
        .concat(local.map(function (s) { return { d: s.d, p: s.p, n: s.n || "", local: true }; }))
        .sort(function (a, b) { return String(a.d).localeCompare(String(b.d)); });
    });
    if (dirty) saveMyData();
    // profit tiles react to device-entered costs too (same rule as the build:
    // only cards with a known cost count toward profit).
    // The money has to move with the card, or it disappears from the
    // Collection without turning up in revenue. Recomputed from a one-time
    // snapshot of the baked summary, so repeat calls (and undo) are exact.
    var sm = data.summary;
    if (!data._baseSummary) {
      data._baseSummary = { total_value: num(sm.total_value), revenue: num(sm.revenue),
        realized_profit: num(sm.realized_profit), sold: sm.sold | 0, listed: sm.listed | 0 };
    }
    var bs = data._baseSummary, dVal = 0, dRev = 0, dReal = 0, dSold = 0, dList = 0;
    data.cards.forEach(function (c) {
      if (!c.sold_local) return;
      dVal -= num(c.asking_price);
      dRev += num(c.sold_price);
      dReal += num(c.sold_price) - num(c.cost);
      dSold += 1;
      if (String(c._csvListed || "").toLowerCase() === "yes") dList -= 1;
    });
    sm.total_value = Math.round((bs.total_value + dVal) * 100) / 100;
    sm.revenue = Math.round((bs.revenue + dRev) * 100) / 100;
    sm.realized_profit = Math.round((bs.realized_profit + dReal) * 100) / 100;
    sm.sold = bs.sold + dSold;
    sm.listed = Math.max(0, bs.listed + dList);

    var costed = data.cards.filter(function (c) { return !c.sold && num(c.asking_price) > 0 && num(c.cost) > 0; });
    data.summary.cost_count = costed.length;
    // Held cards only — must match build_web and the Est. profit tile beside it.
    data.summary.total_cost = Math.round(data.cards.reduce(
      function (a, c) { return c.sold ? a : a + num(c.cost); }, 0) * 100) / 100;
    data.summary.profit = Math.round(costed.reduce(function (a, c) { return a + num(c.asking_price) - num(c.cost); }, 0) * 100) / 100;
  }

  // Real SOLD reference from the owner's tracked sales — median of the most
  // recent 5. null when nothing is tracked for this card.
  function mySold(c) {
    var s = c.my_sales_all || c.my_sales || [];
    if (!s.length) return null;
    var vals = s.slice(-5).map(function (x) { return num(x.p); })
      .filter(function (p) { return p > 0; }).sort(function (a, b) { return a - b; });
    if (!vals.length) return null;
    var mid = Math.floor(vals.length / 2);
    var med = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    return { median: med, count: s.length, last: s[s.length - 1].d || "" };
  }

  // how many device entries haven't made it into the sheet yet
  function pendingCount() {
    var n = 0;
    Object.keys(myData.costs).forEach(function (k) { if (num(myData.costs[k]) > 0) n++; });
    Object.keys(myData.sales).forEach(function (k) { n += (myData.sales[k] || []).length; });
    Object.keys(myData.sold).forEach(function (k) { if (num((myData.sold[k] || {}).p) > 0) n++; });
    return n;
  }

  // ---- One-tap save: the app commits data/my_numbers.json to the repo ----
  // With a GitHub key saved (once, on this device), "Save to my sheet" writes
  // entries straight to GitHub — the Pages build then bakes them into
  // data.json for every device. No Claude step needed. The key never leaves
  // this device (localStorage only).
  var GHTOKEN_KEY = "cv-gh-token";
  var GH_API = "https://api.github.com/repos/mcdermottj639/Ebay/contents/data/my_numbers.json";
  function ghToken() { try { return localStorage.getItem(GHTOKEN_KEY) || ""; } catch (e) { return ""; } }
  function b64utf8(s) { return btoa(unescape(encodeURIComponent(s))); }
  function ghHeaders() {
    return { "Authorization": "Bearer " + ghToken(), "Accept": "application/vnd.github+json",
             "Content-Type": "application/json" };
  }
  // Read the current file (sha + other devices' entries), merge ours in, PUT.
  function ghSaveMyNumbers(done) {
    fetch(GH_API + "?ref=main", { headers: ghHeaders() })
      .then(function (r) {
        if (r.status === 404) return { sha: null, json: { costs: {}, sales: {}, sold: {} }, text: null };
        if (!r.ok) throw new Error("GitHub said " + r.status);
        return r.json().then(function (f) {
          var json = {};
          try { json = JSON.parse(decodeURIComponent(escape(atob(String(f.content || "").replace(/\n/g, ""))))); }
          catch (e) {}
          var was = { costs: json.costs || {}, sales: json.sales || {}, sold: json.sold || {} };
          return { sha: f.sha, json: was, text: JSON.stringify(was, null, 2) + "\n" };
        });
      })
      .then(function (cur) {
        var out = cur.json;
        Object.keys(myData.costs).forEach(function (sku) {
          if (num(myData.costs[sku]) > 0) out.costs[sku] = num(myData.costs[sku]);
        });
        Object.keys(myData.sold).forEach(function (sku) {
          if (num(myData.sold[sku].p) > 0) out.sold[sku] = myData.sold[sku];
        });
        Object.keys(myData.sales).forEach(function (sku) {
          var have = (out.sales[sku] = out.sales[sku] || []);
          (myData.sales[sku] || []).forEach(function (s) {
            var dup = have.some(function (x) { return (x.d || "") === (s.d || "") && num(x.p) === num(s.p); });
            if (!dup) have.push({ d: s.d || "", p: s.p });
          });
        });
        var text = JSON.stringify(out, null, 2) + "\n";
        // already identical in the sheet — a PUT here just makes an empty commit
        if (text === cur.text) return null;
        var body = { message: "Card Vault app: save my numbers",
                     content: b64utf8(text), branch: "main" };
        if (cur.sha) body.sha = cur.sha;
        return fetch(GH_API, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
      })
      .then(function (r) {
        if (r && !r.ok) throw new Error("GitHub said " + r.status);
        myData.synced = Date.now();
        saveMyData();
        done(null);
      })
      .catch(function (e) { done(e); });
  }

  // the message "Send to Claude" ships — Claude writes it into the sheet
  function syncMessage() {
    var lines = [];
    Object.keys(myData.costs).sort().forEach(function (sku) {
      if (num(myData.costs[sku]) > 0) lines.push(sku + " — cost $" + myData.costs[sku]);
    });
    Object.keys(myData.sold).sort().forEach(function (sku) {
      var s = myData.sold[sku];
      if (num(s.p) > 0) lines.push(sku + " — I SOLD IT for $" + s.p + (s.d ? " on " + s.d : ""));
    });
    Object.keys(myData.sales).sort().forEach(function (sku) {
      (myData.sales[sku] || []).forEach(function (s) {
        lines.push(sku + " — comp: someone else sold one for $" + s.p +
                   (s.d ? " on " + s.d : "") + (s.n ? " (" + s.n + ")" : ""));
      });
    });
    return "Save these numbers into my Card Vault sheet, then rebuild and ship the app.\n" +
      "· “cost” → the cost column of data/inventory.csv\n" +
      "· “I SOLD IT” → MY OWN sale: set sold_price + sold_date and clear listed in " +
      "data/inventory.csv, so it leaves the collection and lands in revenue\n" +
      "· “comp” → someone else's sale, for data/manual_sales.csv — it prices the card, " +
      "I still own it\n\n" + lines.join("\n");
  }

  // ---------- Sell-first workspace ----------
  var Selling = window.CardVaultSelling;
  function readWorkspace() {
    try { var d=JSON.parse(localStorage.getItem('cv-selling-v1')||'{}'); return {limit:[5,10,25,50].indexOf(d.limit)>=0?d.limit:25,includeSpecial:d.includeSpecial===true,plans:d.plans||{},lots:Array.isArray(d.lots)?d.lots:[]}; }
    catch(e) { return {limit:25,includeSpecial:false,plans:{},lots:[]}; }
  }
  var workspace=readWorkspace(), selectedLot={}, modalFocus=null;
  function saveWorkspace() {
    try { localStorage.setItem('cv-selling-v1',JSON.stringify(workspace)); return true; }
    catch(e) { toast('Could not save on this device. Your browser storage may be full.'); return false; }
  }
  function icon(name) {
    var paths={today:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 17h7m-3.5-3.5v7"/>',sell:'<path d="M20 13l-7 7a2 2 0 0 1-3 0l-7-7V3h10l7 7a2 2 0 0 1 0 3Z"/><circle cx="7.5" cy="7.5" r="1"/>',collection:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h3"/>',radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12l7-7"/>',value:'<path d="M4 20V10m8 10V4m8 16v-7"/>',arrow:'<path d="M5 12h14m-5-5l5 5-5 5"/>',check:'<path d="m5 12 4 4L19 6"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="var(--bg)"/><circle cx="16" cy="12" r="2" fill="var(--bg)"/><circle cx="9" cy="18" r="2" fill="var(--bg)"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',stack:'<rect x="6" y="3" width="12" height="16" rx="2"/><path d="M3 7v13a2 2 0 0 0 2 2h10"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1"/>'};
    return '<svg class="cv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.arrow)+'</svg>';
  }
  function toast(message) { var t=document.getElementById('cvToast'); if(t){t.textContent=message;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(function(){t.classList.remove('show');},3500);} }
  function copyAndReport(text,button,label) {
    if(!navigator.clipboard){toast('Copy is unavailable here. Select the draft text to copy it.');return;}
    navigator.clipboard.writeText(text).then(function(){if(button)flashBtn(button,label||'Copied');else toast('Copied');},function(){toast('Could not copy. Select the draft text instead.');});
  }
  function displayPrice(n) { return n==null?'—':n<100?money(n):money0(n); }
  function pageHead(kicker,title,sub) { return el('<header class="page-head"><div><div class="cv-kicker">'+esc(kicker)+'</div><h1>'+esc(title)+'</h1>'+(sub?'<p>'+esc(sub)+'</p>':'')+'</div></header>'); }
  function sectionHead(title,sub,button,fn) { var h=el('<div class="cv-section-head"><div><h2>'+esc(title)+'</h2>'+(sub?'<p>'+esc(sub)+'</p>':'')+'</div>'+(button?'<button class="text-button">'+esc(button)+icon('arrow')+'</button>':'')+'</div>'); if(fn)h.querySelector('button').onclick=fn; return h; }
  function segment(options,selected,fn) { var s=el('<div class="cv-segments" aria-label="Choose view"></div>');options.forEach(function(o){var b=el('<button class="'+(selected===o[0]?'on':'')+'" aria-pressed="'+(selected===o[0])+'">'+esc(o[1])+'</button>');b.onclick=function(){fn(o[0]);};s.appendChild(b);});return s; }
  function goSell(mode) {state.sellMode=mode||'plan';setTab('sell');}
  function eligibleCards() {var reserved={};workspace.lots.forEach(function(l){(l.skus||[]).forEach(function(sku){reserved[sku]=true;});});return state.data.cards.filter(function(c){return !reserved[c.sku]&&Selling.batchEligible(c,workspace.limit,workspace.includeSpecial,workspace.plans[c.sku]);});}
  function validSelection() {return eligibleCards().filter(function(c){return selectedLot[c.sku];});}
  function qualifiedBuys() {return ((state.data.radar||{}).candidates||[]).filter(function(c){var age=Date.now()-Date.parse(c.checked_at||'');return c.status==='qualified'&&age>=0&&age<=48*3600000&&(c.grade_scope==='exception'||(String((c.identity||{}).grader).toUpperCase()==='PSA'&&String((c.identity||{}).grade)==='10'));});}
  function savedDate(d) {return Selling.formatDate(d);}
  function referenceLabel(c) {return c.reviewed_price?'Reviewed reference':c.price_basis==='asking'?'Asking-price reference':c.price_basis==='psa'?'PSA reference':'Saved reference';}
  function premiumRow(item) {
    var c=item.card,p=item.plan,o=c.owner_listing||{},row=el('<article class="review-card">'+thumb(c,'review-photo')+'<div class="review-body"><div class="review-top"><span class="signal '+p.tone+'">'+esc(p.label)+'</span></div><h3>'+esc(c.player)+'</h3><p class="card-spec">'+esc(c.line)+'</p><div class="review-money"><b>'+displayPrice(Selling.reference(c))+'</b><span>'+esc(referenceLabel(c))+'</span>'+(Selling.listed(c)&&o.asking_price?'<em>Your listing '+money0(o.asking_price)+'</em>':'')+'</div><p class="review-reason">'+esc(p.reason)+'</p><div class="review-buttons"><button class="button small">Review plan '+icon('arrow')+'</button><button class="text-button" data-details>Card details</button></div></div></article>');
    row.querySelector('.button').onclick=function(){openSellPlan(c);};row.querySelector('[data-details]').onclick=function(){openModal(c);};return row;
  }
  function viewToday() {
    var cards=state.data.cards,stats=Selling.results(cards),batch=eligibleCards(),premium=Selling.premium(cards,workspace.plans,workspace.limit,null,workspace.includeSpecial),buys=qualifiedBuys(),wrap=el('<div class="view today-view"></div>');
    wrap.appendChild(pageHead(new Date().toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric',timeZone:'America/New_York'}),'Today','Your collection, put to work.'));
    var hero=el('<section class="today-hero"><div class="hero-copy"><span class="cv-kicker">YOUR RESALE DESK</span><h2>Sell with a plan.<br>Make room for what’s next.</h2><p>Move the small cards together.<br>Give your best cards the right attention.</p><button class="button hero-button">Open your selling plan '+icon('arrow')+'</button></div><div class="hero-art" aria-hidden="true">'+cards.filter(function(c){return !c.sold&&c.image;}).slice(-3).map(function(c){return thumb(c,'hero-slab');}).join('')+'</div><div class="hero-stats"><div><strong>'+stats.held+'</strong><span>Items held</span></div><div><strong>'+stats.listed+'</strong><span>Listed</span></div><div><strong>'+money0(state.data.summary.total_value)+'</strong><span>Saved reference value</span></div></div></section>');hero.querySelector('button').onclick=function(){goSell('plan');};wrap.appendChild(hero);
    var columns=el('<div class="today-columns"><div class="today-main"></div><aside class="today-side"></aside></div>'),main=columns.querySelector('.today-main'),aside=columns.querySelector('.today-side');
    main.appendChild(sectionHead('Your next moves','Selling comes first.'));
    if(batch.length>=2){var groupValue=batch.reduce(function(n,c){return n+Selling.reference(c);},0);var lot=el('<article class="batch-feature"><div class="feature-icon">'+icon('stack')+'</div><div><span class="cv-kicker">01 · CLEAR THE SMALL STUFF</span><h3>One lot. Fewer listings.</h3><p>'+batch.length+' lower-value cards can be grouped into sensible lots.</p><div class="feature-meta"><span>'+money(groupValue)+' combined reference</span><span>Under '+money0(workspace.limit)+' each</span></div><button class="button">Build a lot '+icon('arrow')+'</button></div></article>');lot.querySelector('button').onclick=function(){goSell('lots');};main.appendChild(lot);}
    main.appendChild(sectionHead('Give these a closer look','Individual plans for your better cards.','See all',function(){goSell('plan');}));
    var spotlight=el('<div class="review-list"></div>');premium.slice(0,2).forEach(function(x){spotlight.appendChild(premiumRow(x));});main.appendChild(spotlight);
    var due=premium.filter(function(x){return x.plan.key==='due';}).length;
    var pulse=el('<section class="cv-panel business-pulse"><span class="cv-kicker">AT A GLANCE</span><h2>Keep things moving</h2><button data-action="listings"><span>'+icon('sell')+' Active listings</span><b>'+stats.listed+' →</b></button><button data-action="plan"><span>'+icon('clock')+' Planned reviews due</span><b>'+due+' →</b></button><button data-action="cost"><span>'+icon('value')+' Costs recorded</span><b>'+stats.heldCostCount+'/'+stats.held+' →</b></button><p>Reference values are saved estimates. Actual listing prices and sale proceeds stay separate.</p></section>');pulse.querySelectorAll('button').forEach(function(b){b.onclick=function(){var a=b.dataset.action;if(a==='cost')setTab('value');else goSell(a);};});aside.appendChild(pulse);
    var buy=el('<section class="cv-panel buy-quiet"><span class="cv-kicker">BUY SECOND · BUY WELL</span><div class="buy-number">'+buys.length+'<span>qualified opportunities</span></div><p>'+(buys.length?'These pass your saved profit and evidence rules.':'Nothing clears your buying rules right now. Your money can wait.')+'</p><button class="text-button">'+(buys.length?'Review opportunities':'Explore targets')+icon('arrow')+'</button></section>');buy.querySelector('button').onclick=function(){state.buyMode=buys.length?'radar':'targets';setTab('radar');};aside.appendChild(buy);
    if(workspace.lots.length){var drafts=el('<section class="cv-panel"><span class="cv-kicker">READY WHEN YOU ARE</span><h2>'+workspace.lots.length+' saved lot draft'+(workspace.lots.length===1?'':'s')+'</h2><p>Your titles, selected cards and price scenarios, saved on this device.</p><button class="text-button">Continue a draft '+icon('arrow')+'</button></section>');drafts.querySelector('button').onclick=function(){goSell('drafts');};aside.appendChild(drafts);}
    var sold=cards.filter(function(c){return c.sold;}).sort(function(a,b){return String(b.sold_date).localeCompare(String(a.sold_date));});
    if(sold.length){aside.appendChild(sectionHead('Recent sales','','All results',function(){setTab('value');}));var activity=el('<div class="cv-panel activity-list"></div>');sold.slice(0,3).forEach(function(c){var row=el('<button class="activity-row">'+thumb(c)+'<span><b>'+esc(c.player)+'</b><small>'+esc(savedDate(c.sold_date))+'</small></span><strong>'+money0(c.sold_price)+'</strong></button>');row.onclick=function(){openModal(c);};activity.appendChild(row);});aside.appendChild(activity);}
    wrap.appendChild(columns);return wrap;
  }
  function viewSell() {
    var wrap=el('<div class="view sell-view"></div>'),mode=state.sellMode||'plan';
    wrap.appendChild(pageHead('SELL FIRST','Your selling desk','Move lower-value cards in lots. Manage better cards individually.'));
    wrap.appendChild(segment([['plan','Individual plans'],['lots','Build a lot'],['listings','Listings'],['drafts','Drafts']],mode,function(x){state.sellMode=x;render();}));
    if(mode==='lots'){wrap.appendChild(lotBuilder());return wrap;}
    if(mode==='drafts'){wrap.appendChild(savedLotDrafts());return wrap;}
    if(mode==='listings'){
      var listed=state.data.cards.filter(Selling.listed).sort(function(a,b){return (Selling.listingAge(b)||0)-(Selling.listingAge(a)||0)||(Selling.reference(b)||0)-(Selling.reference(a)||0);});
      wrap.appendChild(el('<p class="section-note">'+listed.length+' recorded listings · check eBay for current availability, offers and watchers.</p>'));
      var list=el('<div class="listing-grid"></div>');listed.forEach(function(c){var o=c.owner_listing||{},age=Selling.listingAge(c),p=el('<article class="listing-card">'+thumb(c)+'<div><span class="signal green">Listed</span><h3>'+esc(c.player)+'</h3><p class="card-spec">'+esc(c.line)+'</p></div><div class="listing-prices"><div><span>Your listing</span><b>'+displayPrice(Selling.amount(o.asking_price))+'</b></div><div><span>Saved reference</span><b>'+displayPrice(Selling.reference(c))+'</b></div></div><p class="section-note">'+(age===null?'Listing date not recorded':age+' days since listing')+' · '+(o.confirmed_at?'Last confirmed '+savedDate(o.confirmed_at):'Status from catalog')+'</p><div class="button-row"><button class="button small">Review price plan</button>'+(o.url?'<a class="button secondary small" href="'+safeBuyLink(o.url)+'" target="_blank" rel="noopener">Open listing ↗</a>':'')+'</div></article>');p.querySelector('button').onclick=function(){openSellPlan(c);};list.appendChild(p);});wrap.appendChild(list);if(!listed.length)wrap.appendChild(emptyPanel('No recorded listings','Your confirmed listings will appear here.'));return wrap;
    }
    var items=Selling.premium(state.data.cards,workspace.plans,workspace.limit,null,workspace.includeSpecial),batch=eligibleCards();
    var intro=el('<div class="plan-summary"><div><b>'+items.length+'</b><span>Individual reviews</span></div><div><b>'+batch.length+'</b><span>Lot candidates</span></div><p>Set a target and review date. A reminder to check the market is never a prediction of the best selling time.</p></div>');wrap.appendChild(intro);
    var controls=el('<div class="plan-controls"><label class="search">'+icon('search')+'<input type="search" placeholder="Find a card to plan…" aria-label="Search selling plans"></label><select aria-label="Plan filter"><option value="all">All individual cards</option><option value="due">Reviews due</option><option value="hold">Holding</option><option value="unlisted">Not listed</option></select></div>'),list=el('<div class="review-list plan-grid"></div>');
    function update(){var q=controls.querySelector('input').value.toLowerCase().trim(),f=controls.querySelector('select').value;list.innerHTML='';var shown=items.filter(function(x){return(!q||(x.card.player+' '+x.card.line).toLowerCase().includes(q))&&(f==='all'||f==='unlisted'&&!Selling.listed(x.card)||x.plan.key===f);});shown.forEach(function(x){list.appendChild(premiumRow(x));});if(!shown.length)list.appendChild(emptyPanel('Nothing in this view','Try another filter or search.'));}
    controls.querySelector('input').oninput=update;controls.querySelector('select').onchange=update;wrap.appendChild(controls);wrap.appendChild(list);update();return wrap;
  }
  function emptyPanel(title,body){return el('<div class="empty-panel"><span class="empty-symbol">'+icon('check')+'</span><h3>'+esc(title)+'</h3><p>'+esc(body)+'</p></div>');}
  function lotBuilder() {
    var wrap=el('<div class="lot-builder"></div>'),rows=eligibleCards(),groups=Selling.groups(eligibleCards(),workspace.limit,workspace.includeSpecial,workspace.plans);
    var intro=el('<div class="cv-panel lot-intro"><div><span class="cv-kicker">SMALL CARDS, ONE SHIPMENT</span><h2>Build a better bundle</h2><p>Pick related cards, prepare one draft, and check the proceeds before you list.</p></div><label>Per-card reference limit<select aria-label="Lot value limit">'+[5,10,25,50].map(function(n){return '<option value="'+n+'"'+(workspace.limit===n?' selected':'')+'>'+money0(n)+'</option>';}).join('')+'</select></label></div>');intro.querySelector('select').onchange=function(){workspace.limit=Number(this.value);saveWorkspace();render();};wrap.appendChild(intro);
    var special=el('<label class="special-toggle"><input type="checkbox"'+(workspace.includeSpecial?' checked':'')+'><span>Include graded, autographed & numbered cards below this cutoff<small>Listed items, memorabilia, individual plans and higher-cost cards remain excluded.</small></span></label>');special.querySelector('input').onchange=function(){workspace.includeSpecial=this.checked;saveWorkspace();render();};wrap.appendChild(special);
    wrap.appendChild(el('<p class="section-note">'+rows.length+' eligible cards · cutoff uses both saved reference value and known purchase cost. Cards in saved lots are reserved. Missing prices need an individual review.</p>'));
    var list=el('<div class="lot-groups"></div>'),summary=el('<div class="selection-bar"><div><b></b><span></span></div><button class="button">Prepare lot '+icon('arrow')+'</button></div>');
    function sync(){var chosen=validSelection();summary.querySelector('b').textContent=chosen.length+' cards selected';summary.querySelector('span').textContent=chosen.length?money(chosen.reduce(function(n,c){return n+Selling.reference(c);},0))+' combined reference · not a lot price':'Select at least two cards';summary.querySelector('button').disabled=chosen.length<2;list.querySelectorAll('input[type="checkbox"]').forEach(function(c){c.checked=!!selectedLot[c.value];});}
    groups.forEach(function(g){var section=el('<section class="cv-panel lot-group"><div class="lot-group-head"><div><h3>'+esc(g.label)+'</h3><span>'+g.cards.length+' card'+(g.cards.length===1?'':'s')+' · '+money(g.value)+' reference total</span></div><button class="text-button">Select group</button></div><div class="lot-options"></div></section>');section.querySelector('button').onclick=function(){var all=g.cards.every(function(c){return selectedLot[c.sku];});g.cards.forEach(function(c){selectedLot[c.sku]=!all;});sync();};g.cards.forEach(function(c){var row=el('<label class="lot-option"><input type="checkbox" value="'+esc(c.sku)+'" aria-label="Add '+esc(c.player)+' '+esc(c.sku)+' to lot">'+thumb(c)+'<span><b>'+esc(c.player)+'</b><small>'+esc(c.line)+(c.graded?' · '+esc(c.grader+' '+c.grade):'')+(c.auto?' · AUTO':'')+(c.serial_run?' · /'+esc(c.serial_run):'')+'</small></span><strong>'+displayPrice(Selling.reference(c))+'</strong></label>');row.querySelector('input').onchange=function(){selectedLot[c.sku]=this.checked;sync();};section.querySelector('.lot-options').appendChild(row);});list.appendChild(section);});
    wrap.appendChild(list);if(!groups.length)wrap.appendChild(emptyPanel('No cards fit this cutoff','Raise the reference limit, or use an individual selling plan.'));wrap.appendChild(summary);summary.querySelector('button').onclick=function(){openLotDraft(validSelection());};sync();return wrap;
  }
  function showWorkspaceModal(html) {
    modalFocus=document.activeElement;var m=document.getElementById('modal');m.className='modal workspace-modal';m.innerHTML='<button class="close" id="mClose" aria-label="Close dialog">×</button>'+html;m.setAttribute('aria-labelledby','workspaceTitle');m.querySelector('#mClose').onclick=closeModal;document.getElementById('modalWrap').classList.add('open');document.body.classList.add('sheet-open');m.querySelector('#mClose').focus();return m;
  }
  function openSellPlan(c) {
    var p=workspace.plans[c.sku]||{},signal=Selling.planFor(c,p),o=c.owner_listing||{},e=Selling.soldEvidence(c),m=showWorkspaceModal('<div class="modal-heading">'+thumb(c)+'<div><span class="cv-kicker">INDIVIDUAL SELLING PLAN</span><h2 id="workspaceTitle">'+esc(c.player)+'</h2><p>'+esc(c.line)+'</p></div></div><div class="plan-price"><div><span>'+esc(referenceLabel(c))+'</span><b>'+displayPrice(Selling.reference(c))+'</b></div><div><span>'+(Selling.listed(c)?'Your listing':'Recorded cost')+'</span><b>'+displayPrice(Selling.listed(c)?Selling.amount(o.asking_price):Selling.cost(c))+'</b></div></div><div class="evidence-note"><span class="signal '+signal.tone+'">'+esc(signal.label)+'</span><p>'+esc(signal.reason)+'</p><small>'+e.count+' recorded sales in the last 90 days'+(e.newest?' · newest '+esc(e.newest):'')+'. Confirm exact card, parallel and grade. Saved references are not live market quotes.</small></div><div class="form-grid"><label>Your plan<select id="planAction"><option value="review">Review before deciding</option><option value="hold">Hold for my price</option><option value="list">Prepare to list</option></select></label><label>Target sale price ($)<input id="planTarget" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Your target" value="'+esc(p.target||'')+'"></label><label>Review on<input id="planDate" type="date" value="'+esc(p.reviewDate||'')+'"></label><label class="full">Your notes<textarea id="planNote" rows="3" maxlength="800" placeholder="What would make you sell?">'+esc(p.note||'')+'</textarea></label></div><div class="button-row"><button class="button" id="planSave">Save selling plan</button><a class="button secondary" href="'+ebaySearchUrl(c,true)+'" target="_blank" rel="noopener">Check sold comps ↗</a></div><p class="section-note">Saved on this device. Review dates appear on Today when you open the app. This plan does not change your eBay listing.</p>');
    m.querySelector('#planAction').value=p.action||'review';m.querySelector('#planSave').onclick=function(){var target=m.querySelector('#planTarget');if(!target.reportValidity())return;workspace.plans[c.sku]={action:m.querySelector('#planAction').value,target:target.value,reviewDate:m.querySelector('#planDate').value,note:m.querySelector('#planNote').value.trim()};if(saveWorkspace()){closeModal();render();toast('Selling plan saved on this device');}};
  }
  function openLotDraft(cards,existing) {
    if(cards.length<2){toast('Select at least two eligible cards to build a lot.');return;}
    var d=existing||{},policy=(state.data.radar||{}).policy||{},title=d.title||Selling.lotTitle(cards),description=d.description||Selling.lotDescription(cards);
    var form=Object.assign({price:'',shipping:policy.outbound_shipping==null?8:policy.outbound_shipping,supplies:policy.supplies==null?2:policy.supplies,feeRate:(policy.fee_rate==null?.1325:policy.fee_rate)*100,orderFee:policy.per_order_fee==null?.4:policy.per_order_fee,promotion:(policy.promotion_reserve_rate==null?.02:policy.promotion_reserve_rate)*100,buyerTax:(policy.resale_buyer_tax_rate==null?.08:policy.resale_buyer_tax_rate)*100,feeThreshold:policy.fee_threshold||7500,feeRateAbove:(policy.fee_rate_above==null?.0235:policy.fee_rate_above)*100},d.form||{});
    var m=showWorkspaceModal('<div class="cv-kicker">LOT DRAFT · '+cards.length+' CARDS</div><h2 id="workspaceTitle">One listing, ready to prepare.</h2><p class="section-note">'+money(cards.reduce(function(n,c){return n+Selling.reference(c);},0))+' combined saved references. Choose your lot price; this total is not a recommended asking price.</p><label class="field">Listing title <span id="titleLength"></span><input id="lotTitle" maxlength="80" value="'+esc(title)+'"></label><div class="lot-selected">'+cards.map(function(c){return '<span>'+esc(c.player)+'</span>';}).join('')+'</div><div class="form-grid"><label>Lot asking price ($)<input id="lotPrice" data-quote="price" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Set your price" value="'+esc(form.price)+'"></label><label>Shipping you pay ($)<input data-quote="shipping" type="number" min="0" step="0.01" inputmode="decimal" value="'+esc(form.shipping)+'"></label></div><div id="lotQuote" class="quote-panel" aria-live="polite"></div><details class="cost-assumptions"><summary>Adjust selling cost assumptions</summary><div class="form-grid">'+[['supplies','Packaging ($)'],['feeRate','Base selling fee (%)'],['orderFee','Per-order fee ($)'],['promotion','Promotion reserve (%)'],['buyerTax','Buyer tax allowance (%)'],['feeThreshold','Fee tier threshold ($)'],['feeRateAbove','Fee above threshold (%)']].map(function(f){return '<label>'+f[1]+'<input type="number" data-quote="'+f[0]+'" min="0" '+(/Rate|promotion|buyerTax/.test(f[0])?'max="99.99" ':'')+'step="0.01" inputmode="decimal" value="'+esc(form[f[0]])+'"></label>';}).join('')+'</div><p class="section-note">Planning assumptions from your saved buying policy. Free shipping to the buyer; fees include the buyer-tax allowance. Verify your seller plan, final package and actual costs. No promotion is enabled. Before income tax.</p></details><details class="draft-description"><summary>Listing description & preparation checklist</summary><textarea id="lotDescription" rows="11">'+esc(description)+'</textarea><button class="text-button" id="copyDescription">Copy description</button></details><div class="button-row"><button class="button" id="saveLot">Save lot draft</button><button class="button secondary" id="copyTitle">Copy title</button></div><a class="ebay-draft-link" href="https://www.ebay.com/sl/sell" target="_blank" rel="noopener">Open eBay’s listing form ↗</a><p class="section-note">Draft only, saved on this device. Photograph every card and remove the seller checklist before publishing. Inventory stays unchanged until you record a sale.</p>');
    function update(){m.querySelectorAll('[data-quote]').forEach(function(i){form[i.dataset.quote]=i.value;});var q=Selling.lotQuote(cards,form);m.querySelector('#titleLength').textContent=m.querySelector('#lotTitle').value.length+'/80';m.querySelector('#lotQuote').innerHTML='<div><span>Est. net proceeds</span><strong class="'+(q.proceeds<0?'neg':'')+'">'+(q.proceeds===null?'—':money(q.proceeds))+'</strong><small>After modeled selling costs</small></div><div><span>Est. profit</span><strong class="'+(q.profit<0?'neg':'')+'">'+(q.profit===null?'—':money(q.profit))+'</strong><small>'+q.costCount+'/'+q.count+' acquisition costs recorded</small></div>'+(q.costCount<q.count?'<p>Profit needs the missing purchase costs. Proceeds are not profit.</p>':'');}
    m.querySelectorAll('input').forEach(function(i){i.addEventListener('input',update);});m.querySelector('#copyDescription').onclick=function(){copyAndReport(m.querySelector('#lotDescription').value,this);};m.querySelector('#copyTitle').onclick=function(){copyAndReport(m.querySelector('#lotTitle').value,this);};
    m.querySelector('#saveLot').onclick=function(){if(!m.querySelector('#lotTitle').value.trim()){m.querySelector('#lotTitle').focus();return;}var invalid=Array.from(m.querySelectorAll('input')).find(function(i){return !i.checkValidity();});if(invalid){invalid.reportValidity();return;}if(cards.some(function(c){return !Selling.batchEligible(c,workspace.limit,workspace.includeSpecial,workspace.plans[c.sku]);})){toast('Inventory changed. Recheck your selected cards.');return;}var row={id:d.id||'lot-'+Date.now(),title:m.querySelector('#lotTitle').value.trim(),description:m.querySelector('#lotDescription').value,skus:cards.map(function(c){return c.sku;}),form:form,updated:new Date().toISOString()};var ix=workspace.lots.findIndex(function(x){return x.id===row.id;});if(ix<0)workspace.lots.unshift(row);else workspace.lots[ix]=row;if(saveWorkspace()){selectedLot={};closeModal();state.sellMode='drafts';render();toast('Lot draft saved on this device');}};update();
  }
  function savedLotDrafts() {
    var wrap=el('<div class="saved-lots"></div>');wrap.appendChild(sectionHead('Your lot drafts','Saved on this device. Nothing has been listed automatically.','Build another',function(){goSell('lots');}));
    workspace.lots.forEach(function(d){var cards=state.data.cards.filter(function(c){return d.skus.indexOf(c.sku)>=0&&Selling.batchEligible(c,workspace.limit,workspace.includeSpecial,workspace.plans[c.sku]);}),changed=cards.length!==d.skus.length,row=el('<article class="cv-panel saved-lot"><span class="signal '+(changed?'amber':'green')+'">'+(changed?'Recheck selection':'Draft')+'</span><h3>'+esc(d.title)+'</h3><p>'+d.skus.length+' selected cards · updated '+esc(savedDate(d.updated))+'</p>'+(changed?'<p class="warning-text">Some cards are sold, listed, or outside the current lot rules. Rebuild this draft before using it.</p>':'')+'<div class="button-row"><button class="button small" data-open'+(changed?' disabled':'')+'>Continue draft '+icon('arrow')+'</button><button class="text-button" data-remove>Remove draft</button></div></article>');row.querySelector('[data-open]').onclick=function(){openLotDraft(cards,d);};row.querySelector('[data-remove]').onclick=function(){var old=workspace.lots.slice();workspace.lots=workspace.lots.filter(function(x){return x.id!==d.id;});if(saveWorkspace()){render();toast('Draft removed; your cards are unchanged');}else workspace.lots=old;};wrap.appendChild(row);});
    if(!workspace.lots.length)wrap.appendChild(emptyPanel('Your next lot starts here','Choose a related group of lower-value cards, then save its title, checklist and selling-cost scenario.'));
    var single=el('<details class="single-drafts"><summary>Individual card listing drafts</summary></details>');single.appendChild(viewDrafts());wrap.appendChild(single);return wrap;
  }
  function viewBuy() {var w=el('<div class="view buy-view"></div>');w.appendChild(pageHead('BUY WITH DISCIPLINE','Find your next opportunity','Profitable buys, backed by evidence.'));w.appendChild(segment([['radar','Buy opportunities'],['targets','Explore targets']],state.buyMode||'radar',function(x){state.buyMode=x;render();}));w.appendChild(state.buyMode==='targets'?viewTargets():viewRadar());return w;}
  function viewResults() {
    var cards=state.data.cards,s=Selling.results(cards),w=el('<div class="view results-view"></div>');w.appendChild(pageHead('KNOW YOUR NUMBERS','Results','Sale proceeds, costs and profit — kept separate.'));
    w.appendChild(el('<div class="result-tiles"><div class="result-tile accent"><span>Recorded sales</span><strong>'+money0(s.revenue)+'</strong><small>'+s.sold+' items sold · before selling costs</small></div><div class="result-tile"><span>Gross profit</span><strong>'+(s.gross===null?'—':money0(s.gross))+'</strong><small>Before fees and shipping · '+s.knownSoldCosts+'/'+s.sold+' costs known</small></div><div class="result-tile"><span>Confirmed net profit</span><strong>'+(s.net===null?'—':money0(s.net))+'</strong><small>'+(s.net===null?'Actual selling costs are incomplete':'After recorded selling costs')+'</small></div></div>'));
    var ledger=el('<section class="cv-panel sales-ledger"><div class="cv-section-head"><div><h2>Your sales</h2><p>Actual sale prices. Estimated values are excluded.</p></div></div></section>');cards.filter(function(c){return c.sold;}).sort(function(a,b){return String(b.sold_date).localeCompare(String(a.sold_date));}).forEach(function(c){var cost=Selling.cost(c),row=el('<button class="ledger-row">'+thumb(c)+'<span><b>'+esc(c.player)+'</b><small>'+esc(savedDate(c.sold_date))+'</small></span><span><b>'+money(c.sold_price)+'</b><small>'+(cost===null?'Cost unknown':money(cost)+' cost')+'</small></span><span class="ledger-profit"><b>'+(cost===null?'—':money(num(c.sold_price)-cost))+'</b><small>Gross profit</small></span></button>');row.onclick=function(){openModal(c);};ledger.appendChild(row);});w.appendChild(ledger);
    w.appendChild(sectionHead('Your inventory picture','Saved references describe the collection; they are not sale proceeds.'));
    w.appendChild(el('<div class="result-tiles"><div class="result-tile"><span>Saved reference value</span><strong>'+money0(state.data.summary.total_value)+'</strong><small>'+s.held+' held items</small></div><div class="result-tile"><span>Recorded purchase costs</span><strong>'+money0(s.knownCapital)+'</strong><small>Known costs only · '+s.heldCostCount+'/'+s.held+' items</small></div><div class="result-tile"><span>Missing purchase costs</span><strong>'+(s.held-s.heldCostCount)+'</strong><small>Add costs to unlock complete profit tracking</small></div></div>'));
    var missing=cards.filter(function(c){return Selling.held(c)&&Selling.cost(c)===null;}).sort(function(a,b){return (Selling.reference(b)||0)-(Selling.reference(a)||0);});if(missing.length){var gaps=el('<details class="cv-panel data-gaps"><summary>Add your missing costs ('+missing.length+')</summary><p class="section-note">Start with higher-value cards. Enter what you paid in the card details.</p><div class="compact-card-list"></div></details>');missing.forEach(function(c){var b=el('<button><span>'+esc(c.player)+'</span><b>Add cost +</b></button>');b.onclick=function(){openModal(c);var input=document.getElementById('myCost');if(input){input.scrollIntoView({block:'center'});input.focus();}};gaps.querySelector('.compact-card-list').appendChild(b);});w.appendChild(gaps);}
    var history=el('<section class="cv-panel reference-history"><h2>Reference value over time</h2><p class="section-note">Includes inventory changes and valuation corrections; this is not investment performance.</p>'+trendChart(state.data.history||[])+'</section>');w.appendChild(history);return w;
  }


  // ---------- shell ----------
  function shell() {
    document.body.innerHTML='';
    document.body.appendChild(el('<div class="appbar"><a href="#tab=today" class="brand-home" aria-label="Card Vault Today"><span class="logo">'+icon('stack')+'</span><span class="brand"><b>Card Vault</b><small id="gen">Your resale desk</small></span></a><div class="spacer"></div><span class="ver" id="verpill">'+APP_VERSION+'</span><span class="pill" id="livepill">Saved data</span><button class="iconbtn" id="themebtn" aria-label="Toggle light or dark theme" title="Light / dark">'+icon('sun')+'</button><button class="iconbtn" id="settingsbtn" aria-label="App information" title="App information">'+icon('settings')+'</button></div>'));
    document.body.appendChild(el('<main id="view"></main>'));
    document.body.appendChild(el('<div class="modal-wrap" id="modalWrap"><div class="modal" id="modal" role="dialog" aria-modal="true" tabindex="-1"></div></div>'));
    document.body.appendChild(el('<div class="modal-wrap" id="filterWrap"><div class="modal" role="dialog" aria-modal="true" aria-label="Filter cards"></div></div>'));
    var nav=el('<nav class="nav" aria-label="Main navigation"><div class="navbrand"><span class="logo">'+icon('stack')+'</span><span>Card Vault<small>YOUR RESALE DESK</small></span></div><div class="nav-section">WORKSPACE</div></nav>');
    [['today','Today'],['sell','Sell'],['collection','Inventory'],['radar','Buy'],['value','Results']].forEach(function(t){var b=el('<button data-tab="'+t[0]+'"><span class="i">'+icon(t[0])+'</span><span>'+t[1]+'</span></button>');b.onclick=function(){setTab(t[0]);};nav.appendChild(b);});
    nav.appendChild(el('<div class="navfoot"><small>SELL FIRST. BUY WELL.</small><p>A plan for every card.</p><span>'+APP_VERSION+' · Personal workspace</span></div>'));document.body.appendChild(nav);
    document.body.appendChild(el('<div class="cv-toast" id="cvToast" role="status" aria-live="polite"></div>'));
    document.getElementById('themebtn').onclick=toggleTheme;document.getElementById('settingsbtn').onclick=function(){setTab('about');};
    document.querySelector('.brand-home').onclick=function(e){e.preventDefault();setTab('today');};
    document.getElementById('modalWrap').onclick=function(e){if(e.target.id==='modalWrap')closeModal();};
    document.getElementById('filterWrap').onclick=function(e){if(e.target.id==='filterWrap')closeFilter();};
    document.addEventListener('keydown',function(e){
      var typing=/INPUT|SELECT|TEXTAREA/.test((document.activeElement||{}).tagName||'');
      if(e.key==='/'&&!typing){var search=document.querySelector('.search input');if(search){e.preventDefault();search.focus();}}
      if(e.key==='Escape'){closeModal();closeFilter();}
      if(e.key==='Tab'){var dialog=document.querySelector('.modal-wrap.open .modal');if(dialog){var focus=Array.from(dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select,textarea,summary')).filter(function(x){return x.getClientRects().length;});var first=focus[0],last=focus[focus.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}
    });
    document.addEventListener('error',function(e){if(e.target.tagName==='IMG'&&e.target.closest('.thumb')){e.target.style.display='none';e.target.closest('.thumb').classList.add('photo-missing');}},true);
    syncThemeIcon();
  }

  function setTab(tab) {
    if(tab==='targets'){state.buyMode='targets';tab='radar';}
    if(tab==='drafts'){state.sellMode='drafts';tab='sell';}
    if(tab==='salesmap'){state.sellMode='plan';tab='sell';}
    state.tab=tab;
    document.querySelectorAll('.nav button').forEach(function(b){var on=b.dataset.tab===tab;b.classList.toggle('on',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    if(history.replaceState)history.replaceState(null,'','#tab='+tab);
    render();
  }
  function render() {
    var v=document.getElementById('view');v.innerHTML='';
    v.appendChild(({today:viewToday,sell:viewSell,collection:viewCollection,value:viewResults,radar:viewBuy,about:viewAbout}[state.tab]||viewToday)());
    document.getElementById('gen').textContent=state.data.cards.filter(Selling.held).length+' items · Your resale desk';
    document.getElementById('livepill').textContent='Updated '+savedDate(state.data.generated);
    v.scrollTop=0;window.scrollTo(0,0);
  }

  function badges(c) {
    var out = "";
    if (c.sold) out += '<span class="badge b-soldtag">SOLD</span>';
    else if (c.listed) out += '<span class="badge b-listed">LISTED</span>';
    if (c.is_merch) {
      if (c.auto) out += '<span class="badge b-auto">AUTO</span>';
      if (c.authentication) out += '<span class="badge b-psa">' + esc(c.authentication) + " COA</span>";
      if (/fram/i.test(c.item_type)) out += '<span class="badge b-num">FRAMED</span>';
      return out ? '<span class="badges">' + out + "</span>" : "";
    }
    if (c.graded && c.grader && c.grade) out += '<span class="badge b-psa">' + esc(c.grader.toUpperCase() + " " + c.grade) + "</span>";
    if (c.rookie) out += '<span class="badge b-rc">RC</span>';
    if (c.auto) out += '<span class="badge b-auto">AUTO</span>';
    if (c.relic) out += '<span class="badge b-relic">RELIC</span>';
    if (c.serial_run) out += '<span class="badge b-num">/' + esc(c.serial_run) + "</span>";
    return out ? '<span class="badges">' + out + "</span>" : "";
  }

  // team colors [primary, secondary] for the smart placeholder gradient.
  var TEAM_COLORS = {
    // NFL
    "Texans": ["#03202F", "#A71930"], "Dolphins": ["#008E97", "#FC4C02"],
    "Giants": ["#0B2265", "#A71930"], "Ravens": ["#241773", "#9E7C0C"],
    "Commanders": ["#5A1414", "#FFB612"], "Bills": ["#00338D", "#C60C30"],
    "Falcons": ["#A71930", "#000000"], "Raiders": ["#0B0B0B", "#A5ACAF"],
    "Chiefs": ["#E31837", "#FFB81C"], "Cardinals": ["#97233F", "#000000"],
    "Lions": ["#0076B6", "#B0B7BC"], "Colts": ["#002C5F", "#A2AAAD"],
    "Cowboys": ["#041E42", "#869397"], "49ers": ["#AA0000", "#B3995D"],
    "Los Angeles Rams": ["#003594", "#FFA300"], "Rams": ["#003594", "#FFA300"],
    "Tampa Bay Buccaneers": ["#D50A0A", "#34302B"], "Buccaneers": ["#D50A0A", "#34302B"],
    // NBA
    "Warriors": ["#1D428A", "#FFC72C"], "Pistons": ["#C8102E", "#1D42BA"],
    // MLB
    "Reds": ["#C6011F", "#000000"],
    // NHL
    "Rangers": ["#0038A8", "#CE1126"],
    // Soccer / College
    "PSG": ["#004170", "#DA291C"], "Alabama": ["#9E1B32", "#828A8F"]
  };
  function teamColors(team) { return TEAM_COLORS[team] || ["#1d3a2f", "#0e1310"]; }
  function initials(name) {
    if (!name) return "🃏";
    var parts = String(name).replace(/[^A-Za-z ]/g, " ").trim().split(/\s+/);
    var s = (parts[0] ? parts[0][0] : "") + (parts[1] ? parts[1][0] : "");
    return s ? s.toUpperCase() : "🃏";
  }

  // photo thumbnail — or a smart team-colored placeholder with the player's
  // initials when there's no photo yet.
  function thumb(c, cls) {
    var col=teamColors(c.team),style='background:linear-gradient(145deg,'+col[0]+','+col[1]+')';
    return '<div class="thumb '+(c.image?'has-photo':'ph')+' '+(cls||'')+'" style="'+style+'"><span class="photo-fallback" aria-hidden="true"><span class="ini">'+esc(initials(c.player))+'</span><small>'+(c.image?'PHOTO UNAVAILABLE':'PHOTO NEEDED')+'</small></span>'+(c.image?'<img src="'+esc(c.image)+'" alt="'+esc(c.player)+' card" loading="lazy">':'')+'</div>';
  }

  // price-basis pill: green REAL (sold prices the owner recorded), violet PSA
  // (PSA's own market estimate for this card+grade), blue EST (asking comps
  // haircut to estimate market — eBay denied us the sold-comp API), gold ASKING
  // (raw active listings).
  function basisPill(c) {
    if (c.sold) return "";   // the SOLD badge + real price say it better
    if (c.status !== "priced" || !c.price_basis) return "";
    // "REAL", not "SOLD": this pill says where the PRICE came from, and a
    // green SOLD here sat inches from the red SOLD status badge on cards the
    // owner still owns — which is exactly the "does it think I sold it?"
    // confusion. The status badge owns the word "sold".
    var map = { sold: ["b-sold", "REAL", "Priced from real sold prices you recorded"],
                psa: ["b-psaval", "PSA", "PSA’s own market estimate for this card at this grade"],
                est_sold: ["b-est", "EST", "Estimated: eBay asking prices, discounted toward sold"],
                asking: ["b-ask", "ASKING", "From what sellers are asking on eBay right now"] };
    var p = c.reviewed_price
      ? ["b-sold", "REVIEWED", "Reviewed median of source-reported sold prices"]
      : map[c.price_basis] || map.asking;
    return '<span class="basis ' + p[0] + '" title="' + p[2] + '">' + p[1] + "</span>";
  }

  // ▲/▼ week-over-week movement chip (needs a prior price from reprice runs)
  function changeChip(c) {
    var cur = num(c.asking_price), prev = num(c.prev_price);
    if (c.sold || !cur || !prev) return "";
    var pct = (cur - prev) / prev * 100;
    if (Math.abs(pct) < 0.5) return "";
    var up = pct > 0;
    return '<span class="chg ' + (up ? "up" : "down") + '">' + (up ? "▲" : "▼") +
      Math.abs(pct).toFixed(Math.abs(pct) >= 10 ? 0 : 1) + "%</span>";
  }

  // one card/merch row
  function crowEl(c) {
    var val, status;
    if (c.sold) {
      val = '<div class="val tnum soldval">' + money0(c.sold_price) + "</div>";
      status = '<div class="st">Sold' + (c.sold_date ? " " + esc(c.sold_date) : "") + "</div>";
    } else {
      val = c.asking_price ? '<div class="val tnum">' + money0(c.asking_price) + changeChip(c) + "</div>"
                           : '<div class="val none">—</div>';
      status = c.status === "priced" ? basisPill(c) : '<div class="st">Needs price</div>';
    }
    var row = el(
      '<button class="crow s-' + c.status + '">' +
        '<div class="stripe"></div>' +
        thumb(c) +
        '<div class="m"><div class="p">' + esc(c.player) + badges(c) + "</div>" +
          '<div class="sub">' + esc(c.line || "") + "</div></div>" +
        '<div class="r">' + val + status + "</div>" +
      "</button>"
    );
    row.onclick = function () { openModal(c); };
    return row;
  }

  // price tier for a card (keeps cheap commons collapsed out of the way)
  function tierOf(c) {
    if (!c.asking_price || num(c.asking_price) <= 0) return { label: "Unpriced", order: 5, collapse: true };
    var v = num(c.asking_price);
    if (v >= 100) return { label: "$100+", order: 0 };
    if (v >= 25) return { label: "$25 – $100", order: 1 };
    if (v >= 5) return { label: "$5 – $25", order: 2 };
    if (v >= 1) return { label: "$1 – $5", order: 3 };
    return { label: "Under $1", order: 4, collapse: true };
  }

  // a collapsible titled section
  function sectionEl(label, items, defaultCollapsed) {
    var collapsed = state.collapsed[label];
    if (collapsed === undefined) collapsed = !!defaultCollapsed;
    var sec = el('<div class="section"></div>');
    var head = el('<button class="section-head"><span class="sh-l">' + esc(label) +
      '</span><span class="sh-c">' + items.length + '</span><span class="sh-x">' +
      (collapsed ? "▸" : "▾") + "</span></button>");
    head.onclick = function () { state.collapsed[label] = !collapsed; render(); };
    sec.appendChild(head);
    if (!collapsed) {
      var list = el('<div class="list"></div>');
      items.forEach(function (c) { list.appendChild(crowEl(c)); });
      sec.appendChild(list);
    }
    return sec;
  }

  // instant search: every word must hit somewhere in the card's text
  function matchQuery(c) {
    if (!state.q) return true;
    var hay = [c.player, c.team, c.set, c.brand, c.year, c.sku, c.parallel,
               c.insert, c.sport, c.item_type, c.grader, c.grade, c.card_number, c.line]
              .join(" ").toLowerCase();
    return state.q.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  var SORTS = [["val-desc","Reference: high to low"],["val-asc","Reference: low to high"],["az","Player A–Z"],["cost-desc","Cost: high to low"],["listed","Listed first"],["new","Recently added"],["tier","Price tiers"]];
  function sortCards(arr,mode) {
    return arr.slice().sort(function(a,b){
      var result=0,av,bv;
      if(mode==='az')result=String(a.player).localeCompare(String(b.player));
      else if(mode==='new')result=String(b.sku).localeCompare(String(a.sku),undefined,{numeric:true});
      else if(mode==='cost-desc'){av=Selling.cost(a);bv=Selling.cost(b);result=av===null?(bv===null?0:1):bv===null?-1:bv-av;}
      else if(mode==='listed')result=Number(Selling.listed(b))-Number(Selling.listed(a))||(Selling.reference(b)||0)-(Selling.reference(a)||0);
      else{av=Selling.reference(a);bv=Selling.reference(b);result=av===null?(bv===null?0:1):bv===null?-1:mode==='val-asc'?av-bv:bv-av;}
      return result||String(a.sku).localeCompare(String(b.sku));
    });
  }

  function viewCollection() {
    var wrap=el('<div class="view inventory-view"></div>'),held=state.data.cards.filter(Selling.held);
    wrap.appendChild(pageHead('YOUR COLLECTION','Inventory',held.length+' held items. Find the right card, then make your move.'));
    wrap.appendChild(segment([['Cards','Cards · '+held.filter(function(c){return !c.is_merch;}).length],['Merch','Merch · '+held.filter(function(c){return c.is_merch;}).length]],state.bucket,function(x){state.bucket=x;render();}));
    var toolbar=el('<div class="inventory-toolbar"><label class="search">'+icon('search')+'<input type="search" aria-label="Search inventory" placeholder="Player, set, team or card number…" value="'+esc(state.q)+'"></label><div class="inventory-tools"><select class="sortsel" aria-label="Sort inventory">'+SORTS.map(function(s){return '<option value="'+s[0]+'"'+(state.sort===s[0]?' selected':'')+'>'+s[1]+'</option>';}).join('')+'</select><div class="layout-toggle"><button aria-label="List layout" class="'+(state.inventoryLayout==='list'?'on':'')+'">'+icon('list')+'</button><button aria-label="Grid layout" class="'+(state.inventoryLayout==='grid'?'on':'')+'">'+icon('grid')+'</button></div></div></div>');wrap.appendChild(toolbar);
    var sports=Array.from(new Set(held.map(function(c){return c.sport;}).filter(Boolean))).sort();
    var filters=el('<div class="inventory-filters"><label><span>Status</span><select aria-label="Inventory status"><option value="all">All held items</option><option value="unlisted">Not listed</option><option value="listed">Listed</option><option value="lot">Lot eligible</option><option value="missing">Missing cost</option></select></label><label><span>Sport</span><select aria-label="Inventory sport"><option value="all">All sports</option>'+sports.map(function(s){return '<option>'+esc(s)+'</option>';}).join('')+'</select></label><label><span>Card type</span><select aria-label="Inventory type"><option value="all">All types</option><option value="graded">Graded</option><option value="raw">Raw</option><option value="auto">Autographs</option><option value="numbered">Numbered</option><option value="rookie">Rookies</option></select></label></div>');
    var fs=filters.querySelectorAll('select');fs[0].value=state.inventoryStatus;fs[1].value=state.inventorySport;fs[2].value=state.inventoryType;wrap.appendChild(filters);
    var count=el('<div class="inventory-count"></div>'),results=el('<div></div>');wrap.appendChild(count);wrap.appendChild(results);
    function update(){var shown=held.filter(function(c){return(state.bucket==='Merch'?c.is_merch:!c.is_merch)&&matchQuery(c)&&(state.inventorySport==='all'||c.sport===state.inventorySport)&&(state.inventoryStatus==='all'||state.inventoryStatus==='listed'&&Selling.listed(c)||state.inventoryStatus==='unlisted'&&!Selling.listed(c)||state.inventoryStatus==='lot'&&Selling.batchEligible(c,workspace.limit,workspace.includeSpecial,workspace.plans[c.sku])||state.inventoryStatus==='missing'&&Selling.cost(c)===null)&&(state.inventoryType==='all'||state.inventoryType==='graded'&&c.graded||state.inventoryType==='raw'&&!c.graded||state.inventoryType==='auto'&&c.auto||state.inventoryType==='numbered'&&c.serial_run||state.inventoryType==='rookie'&&c.rookie);});
      results.innerHTML='';results.className='inventory-results '+state.inventoryLayout;count.textContent=shown.length+' '+(shown.length===1?'item':'items')+(state.q?' matching “'+state.q+'”':'')+' · '+money(shown.reduce(function(n,c){return n+(Selling.reference(c)||0);},0))+' saved references';
      if(!shown.length){var empty=emptyPanel('No matching cards','Clear the filters or try another player, team or set.');var clear=el('<button class="button secondary">Clear filters</button>');clear.onclick=function(){state.q='';state.inventoryStatus='all';state.inventorySport='all';state.inventoryType='all';render();};empty.appendChild(clear);results.appendChild(empty);return;}
      if(state.sort==='tier'){var by={};shown.forEach(function(c){var t=tierOf(c);(by[t.label]=by[t.label]||{tier:t,cards:[]}).cards.push(c);});Object.keys(by).sort(function(a,b){return by[a].tier.order-by[b].tier.order;}).forEach(function(k){var g=el('<section class="inventory-tier"><h2>'+esc(k)+' <span>'+by[k].cards.length+'</span></h2><div class="inventory-tier-cards"></div></section>');sortCards(by[k].cards,'val-desc').forEach(function(c){g.querySelector('div').appendChild(inventoryCard(c));});results.appendChild(g);});}
      else sortCards(shown,state.sort).forEach(function(c){results.appendChild(inventoryCard(c));});
    }
    toolbar.querySelector('input').oninput=function(){state.q=this.value;update();};toolbar.querySelector('select').onchange=function(){state.sort=this.value;saveViewPrefs();update();};toolbar.querySelectorAll('.layout-toggle button').forEach(function(b,i){b.onclick=function(){state.inventoryLayout=i?'grid':'list';toolbar.querySelectorAll('.layout-toggle button').forEach(function(x){x.classList.toggle('on',x===b);});saveViewPrefs();update();};});
    fs.forEach(function(s,i){s.onchange=function(){state[['inventoryStatus','inventorySport','inventoryType'][i]]=this.value;saveViewPrefs();update();};});update();return wrap;
  }
  function inventoryCard(c) {
    var o=c.owner_listing||{},row=el('<button class="inventory-card">'+thumb(c)+'<div class="inventory-card-body"><div class="inventory-card-top"><span class="inventory-status '+(Selling.listed(c)?'listed':'')+'">'+(Selling.listed(c)?'Listed':'Not listed')+'</span><span class="inventory-sku">'+esc(c.sku)+'</span></div><h3>'+esc(c.player)+'</h3><p>'+esc(c.line)+'</p>'+badges(c)+'<div class="inventory-card-money"><div><strong>'+displayPrice(Selling.reference(c))+'</strong><span>'+esc(referenceLabel(c))+'</span></div>'+(Selling.listed(c)&&o.asking_price?'<div><b>'+money0(o.asking_price)+'</b><span>Your listing</span></div>':'<span class="inventory-arrow">'+icon('arrow')+'</span>')+'</div></div></button>');row.onclick=function(){openModal(c);};return row;
  }
  function saveViewPrefs() {try{localStorage.setItem('cv-view-v60',JSON.stringify({sort:state.sort,inventoryLayout:state.inventoryLayout,inventoryStatus:state.inventoryStatus,inventorySport:state.inventorySport,inventoryType:state.inventoryType}));}catch(e){}}

  // Filter bar: a single button showing the active filter, opens a popup sheet.
  function filterBar(sports) {
    var bar = el('<div class="filterbar"></div>');
    var active = state.filter !== "All";
    var btn = el('<button class="filterbtn' + (active ? " on" : "") + '">' +
      '<span class="fi">☰</span><span class="flabel">Filter</span>' +
      '<span class="fcur">' + esc(state.filter) + "</span></button>");
    btn.onclick = function () { openFilter(sports); };
    bar.appendChild(btn);
    if (active) {
      var clr = el('<button class="fclear">Clear</button>');
      clr.onclick = function () { state.filter = "All"; render(); };
      bar.appendChild(clr);
    }
    return bar;
  }

  function openFilter(sports) {
    var groups = [
      ["Sport", sports.slice().sort()],
      ["Type", ["Graded", "Raw", "Autos", "Non-Autos", "Rookie", "Numbered"]],
      ["Status", ["Listed"]]
    ];
    var html = '<div class="fgroup"><div class="fchips">' +
      '<button class="fchip' + (state.filter === "All" ? " on" : "") + '" data-f="All">All cards</button></div></div>';
    html += groups.map(function (g) {
      if (!g[1].length) return "";
      var chips = g[1].map(function (f) {
        return '<button class="fchip' + (state.filter === f ? " on" : "") + '" data-f="' + esc(f) + '">' + esc(f) + "</button>";
      }).join("");
      return '<div class="fgroup"><div class="flab">' + g[0] + '</div><div class="fchips">' + chips + "</div></div>";
    }).join("");
    var wrap = document.getElementById("filterWrap");
    var sheet = wrap.querySelector(".modal");
    sheet.innerHTML = '<button class="close" id="fClose">✕</button><h3>Filter cards</h3>' + html;
    sheet.querySelectorAll(".fchip").forEach(function (b) {
      b.onclick = function () { state.filter = b.getAttribute("data-f"); closeFilter(); render(); };
    });
    sheet.querySelector("#fClose").onclick = closeFilter;
    wrap.classList.add("open");
  }
  function closeFilter() { document.getElementById("filterWrap").classList.remove("open"); }

  function matchFilter(c) {
    switch (state.filter) {
      case "All": return true;
      case "Graded": return c.graded;
      case "Raw": return !c.graded;
      case "Autos": return c.auto;
      case "Non-Autos": return !c.auto;
      case "Rookie": return c.rookie;
      case "Numbered": return !!c.serial_run;
      case "Listed": return c.listed;
      default: return c.sport === state.filter;
    }
  }

  // value-over-time line chart (SVG, no libraries). One point per daily
  // snapshot in data.history; needs 2+ points to draw a line.
  function trendChart(history) {
    var panel = el('<div class="panel trend"><div class="ptitle">Value over time</div></div>');
    var h = (history || []).filter(function (p) { return p && typeof p.v === "number"; });
    if (h.length < 2) {
      var v = h.length ? money0(h[0].v) : "";
      panel.appendChild(el('<p class="muted" style="font-size:13px;margin:4px 0 2px">Tracking started ' +
        (h.length ? "— today’s snapshot: <b>" + v + "</b>. " : ". ") +
        "The chart draws itself as daily snapshots build up.</p>"));
      return panel;
    }
    var W = 600, H = 200, PL = 46, PR = 10, PT = 14, PB = 22;
    var vals = h.map(function (p) { return p.v; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var X = function (i) { return PL + (W - PL - PR) * (h.length === 1 ? 0 : i / (h.length - 1)); };
    var Y = function (v) { return PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo)); };
    var pts = h.map(function (p, i) { return X(i).toFixed(1) + "," + Y(p.v).toFixed(1); });
    var area = "M" + pts.join(" L") + " L" + X(h.length - 1).toFixed(1) + "," + (H - PB) +
               " L" + PL + "," + (H - PB) + " Z";
    var dots = h.length <= 40 ? h.map(function (p, i) {
      return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) +
        '" r="3" fill="var(--gold)"><title>' + esc(p.d) + " — " + money0(p.v) + "</title></circle>";
    }).join("") : "";
    var mdy = function (d) { var p = String(d).split("-"); return p.length === 3 ? p[1] + "/" + p[2] : d; };
    panel.appendChild(el(
      '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Collection value over time">' +
        '<defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="var(--gold)" stop-opacity=".28"/>' +
          '<stop offset="1" stop-color="var(--gold)" stop-opacity="0"/></linearGradient></defs>' +
        '<line x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) + '" stroke="var(--border)"/>' +
        '<text class="tx" x="4" y="' + (Y(hi - pad) + 4) + '">' + money0(hi - pad) + "</text>" +
        '<text class="tx" x="4" y="' + (Y(lo + pad) + 4) + '">' + money0(lo + pad) + "</text>" +
        '<text class="tx" x="' + PL + '" y="' + (H - 6) + '">' + esc(mdy(h[0].d)) + "</text>" +
        '<text class="tx" x="' + (W - PR) + '" y="' + (H - 6) + '" text-anchor="end">' + esc(mdy(h[h.length - 1].d)) + "</text>" +
        '<path d="' + area + '" fill="url(#tg)"/>' +
        '<polyline points="' + pts.join(" ") + '" fill="none" stroke="var(--gold)" stroke-width="2.5" ' +
          'stroke-linejoin="round" stroke-linecap="round"/>' + dots +
      "</svg>"));

    // A day flagged `c` is one where we RE-PRICED cards on better data. The
    // step in the line is our own correction, not the collection gaining or
    // losing value, and reading it as performance is exactly backwards — so
    // the chart says which it was instead of leaving the drop to speak.
    var last = h[h.length - 1], prevPt = h[h.length - 2];
    if (last && last.c && prevPt) {
      var delta = last.v - prevPt.v, up = delta >= 0;
      panel.appendChild(el('<p class="trendnote">↺ The ' + (up ? "rise" : "drop") + " of " +
        money0(Math.abs(delta)) + " on " + esc(mdy(last.d)) +
        " is a <b>re-pricing onto better data</b>, not a market move — cards were " +
        "re-valued from PSA and real eBay sold prices.</p>"));
    }
    return panel;
  }

  function viewValue() {
    var s = state.data.summary;
    var wrap = el('<div class="view"></div>');
    wrap.appendChild(el('<div class="eyebrow">Collection value</div>'));
    var tiles = el('<div class="tiles"></div>');
    tiles.appendChild(el('<div class="tile hero"><div class="k">Estimated value</div><div class="v tnum">' + money(s.total_value) + "</div></div>"));
    // profit/cost only read once a cost is entered (else blank cost = $0 makes
    // profit == full value, which isn't true).
    var hasCost = (s.cost_count || 0) > 0;
    var profitCls = hasCost ? (s.profit >= 0 ? "pos" : "neg") : "";
    [["Total cost", hasCost ? money(s.total_cost) : "—", ""],
     ["Est. profit", hasCost ? money(s.profit) : "—", profitCls],
     ["Cards", s.total_cards - (s.sold || 0), ""],
     ["Priced", s.priced + " / " + (s.total_cards - (s.sold || 0)), ""],
     ["Graded", s.graded, ""],
     ["Autographs", s.autos, ""]].forEach(function (t) {
      tiles.appendChild(el('<div class="tile"><div class="k">' + t[0] + '</div><div class="v tnum ' + t[2] + '">' + t[1] + "</div></div>"));
    });
    wrap.appendChild(tiles);
    if (!hasCost) {
      wrap.appendChild(el('<p class="muted" style="font-size:12.5px;margin:8px 2px 0">' +
        "💡 Add what you paid (the <b>cost</b> column in your sheet) to turn on profit — " +
        "it’ll show here and on the Sales Map.</p>"));
    }

    // the business row — only once something is listed or sold
    if (s.listed || s.sold) {
      wrap.appendChild(el('<div class="eyebrow">Business · all time</div>'));
      var biz = el('<div class="tiles biz"></div>');
      var rCls = s.realized_profit >= 0 ? "pos" : "neg";
      [["Revenue", money(s.revenue), "pos"],
       ["Gross profit · before fees", money(s.realized_profit), rCls],
       ["Listed now", s.listed, ""],
       ["Sold", s.sold, ""]].forEach(function (t) {
        biz.appendChild(el('<div class="tile"><div class="k">' + t[0] + '</div><div class="v tnum ' + t[2] + '">' + t[1] + "</div></div>"));
      });
      wrap.appendChild(biz);

      // Sales don't all belong to the same year — the Jalen Hurts card sold in
      // Sept 2025 and the Jefferson jersey in Sept 2026, and a single "Revenue
      // $655" tile silently merged them. Break it out whenever more than one
      // year is represented, so the all-time tiles above stay honest and this
      // year is still readable at a glance. Computed off c.sold_date rather
      // than the baked summary, so a sale marked on this device (v48) lands
      // here immediately too.
      var byYear = {};
      state.data.cards.forEach(function (c) {
        if (!c.sold) return;
        var y = String(c.sold_date || "").slice(0, 4) || "—";
        var b = byYear[y] || (byYear[y] = { rev: 0, cost: 0, n: 0 });
        b.rev += num(c.sold_price); b.cost += num(c.cost); b.n += 1;
      });
      var years = Object.keys(byYear).sort().reverse();
      if (years.length > 1) {
        var yl = el('<div class="yearrows"></div>');
        years.forEach(function (y) {
          var b = byYear[y], profit = b.rev - b.cost;
          yl.appendChild(el('<div class="yearrow"><span class="yy">' + esc(y) + "</span>" +
            '<span class="yn">' + b.n + " sold</span>" +
            '<b class="tnum">' + money0(b.rev) + "</b>" +
            '<span class="tnum ' + (profit >= 0 ? "pos" : "neg") + '">' +
              (profit >= 0 ? "+" : "−") + money0(Math.abs(profit)) + "</span></div>"));
        });
        wrap.appendChild(yl);
      }

      // The sold items themselves — they left the Collection tab, so this is
      // where the owner sees what they've actually sold and for how much.
      var soldCards = state.data.cards.filter(function (c) { return c.sold; })
        .sort(function (a, b) { return String(b.sold_date).localeCompare(String(a.sold_date)); });
      if (soldCards.length) {
        wrap.appendChild(el('<div class="eyebrow">Sold · out of the collection</div>'));
        var slist = el('<div class="list"></div>');
        soldCards.forEach(function (c) { slist.appendChild(crowEl(c)); });
        wrap.appendChild(slist);
      }
    }

    // $-weighted bar panel used for By-sport and By-grade
    function statPanel(title, stats) {
      var panel = el('<div class="panel"><div class="ptitle">' + title + "</div></div>");
      var bars = el('<div class="bars"></div>');
      var max = stats.length ? Math.max.apply(null, stats.map(function (g) { return g.value; })) || 1 : 1;
      stats.forEach(function (g) {
        bars.appendChild(el('<div class="barrow"><span>' + esc(g.name) + '</span>' +
          '<div class="track"><div class="fill" style="width:' + (g.value / max * 100) + '%"></div></div>' +
          '<b class="tnum">' + money0(g.value) + " · " + g.count + "</b></div>"));
      });
      if (!stats.length) bars.appendChild(el('<p class="muted" style="font-size:13px">Nothing here yet.</p>'));
      panel.appendChild(bars);
      return panel;
    }

    // movers: biggest week-over-week price changes (fed by reprice runs)
    function moversPanel() {
      var panel = el('<div class="panel"><div class="ptitle">Movers · this week</div></div>');
      var movers = state.data.cards.filter(function (c) {
        return !c.sold && c.prev_price && num(c.asking_price) &&
               Math.abs(num(c.asking_price) - num(c.prev_price)) / num(c.prev_price) >= 0.005;
      }).sort(function (a, b) {
        var pa = Math.abs(num(a.asking_price) - num(a.prev_price)) / num(a.prev_price);
        var pb = Math.abs(num(b.asking_price) - num(b.prev_price)) / num(b.prev_price);
        return pb - pa;
      }).slice(0, 6);
      if (!movers.length) {
        panel.appendChild(el('<p class="muted" style="font-size:13px;margin:4px 0 2px">No price moves yet — ' +
          "movers show up here after the weekly eBay re-price runs.</p>"));
        return panel;
      }
      var list = el('<div class="movers"></div>');
      movers.forEach(function (c) {
        var row = el('<button class="mover"><span class="mp">' + esc(c.player) +
          '</span><span class="ms">' + esc(c.line || "") + '</span>' +
          '<span class="mr tnum">' + money0(c.asking_price) + changeChip(c) + "</span></button>");
        row.onclick = function () { openModal(c); };
        list.appendChild(row);
      });
      panel.appendChild(list);
      return panel;
    }

    // panel grid: 2×2 on PC, stacked on phones
    var vgrid = el('<div class="vgrid"></div>');
    vgrid.appendChild(statPanel("Value by sport", s.sport_stats || []));
    vgrid.appendChild(trendChart(state.data.history));
    vgrid.appendChild(moversPanel());
    vgrid.appendChild(statPanel("Value by grade", s.grade_stats || []));
    wrap.appendChild(vgrid);

    wrap.appendChild(el('<div class="eyebrow">Top cards by value</div>'));
    var top = state.data.cards.slice()
                .filter(function (c) { return !c.sold && num(c.asking_price) > 0; })
                .sort(function (a, b) { return num(b.asking_price) - num(a.asking_price); }).slice(0, 6);
    var list = el('<div class="list"></div>');
    top.forEach(function (c) { list.appendChild(crowEl(c)); });
    wrap.appendChild(top.length ? list : el('<p class="muted">No priced cards yet.</p>'));
    return wrap;
  }

  // ---------- Sales Map ----------
  // Which held cards are in the best position to sell, plus price-change
  // analytics. All signals come from fields already in data.json, so the tab
  // works today and sharpens automatically as weekly re-price runs add history.

  // % price move vs the prior weekly snapshot (null when we have no prior).
  function sellMomentum(c) {
    var cur = num(c.asking_price), prev = num(c.prev_price);
    if (!cur || !prev) return null;
    return (cur - prev) / prev * 100;
  }

  // Sell-readiness score 0–100 = value(34) + liquidity(36) + confidence(10) +
  // momentum(20, centred). Returns the score, 0–3 rating bars, and plain
  // reasons so a non-technical owner sees WHY a card ranks where it does.
  function sellScore(c) {
    var v = num(c.asking_price), reasons = [], score = 0;

    // 1) Value — bigger tickets are worth the listing effort (log scale).
    score += Math.max(0, Math.min(34, (Math.log(Math.max(v, 1)) / Math.log(1000)) * 34));
    if (v >= 100) reasons.push("premium value");

    // 2) Liquidity / desirability — what makes a card sell fast.
    var liq = 0;
    if (c.graded) { liq += 14; reasons.push(((c.grader || "graded").toUpperCase() + (c.grade ? " " + c.grade : "")).trim()); }
    if (c.auto) { liq += 10; reasons.push("auto"); }
    if (c.serial_run) { liq += 6; reasons.push("/" + c.serial_run); }
    if (c.rookie) { liq += 4; reasons.push("rookie"); }
    if (/football/i.test(c.sport || "")) { liq += 6; reasons.push("football"); }
    score += Math.min(36, liq);

    // 3) Price confidence — how much we trust the number we'd list at. The
    // owner's own tracked REAL sold prices are the strongest signal we have.
    if (mySold(c)) { score += 10; reasons.push("real sold ✓"); }
    else score += c.price_basis === "sold" ? 10 : c.price_basis === "psa" ? 9
      : c.price_basis === "est_sold" ? 6 : c.price_basis === "asking" ? 3 : 0;

    // 4) Momentum — rising price = sell into strength (neutral when unknown).
    var pct = sellMomentum(c);
    if (pct == null) { score += 10; }
    else {
      score += 10 + Math.max(-10, Math.min(10, pct));
      if (pct >= 3) reasons.push("▲ up " + Math.round(pct) + "% this wk");
      else if (pct <= -3) reasons.push("▼ down " + Math.abs(Math.round(pct)) + "% this wk");
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    var bars = score >= 70 ? 3 : score >= 45 ? 2 : score >= 22 ? 1 : 0;
    return { score: score, bars: bars, reasons: reasons };
  }

  var SELL_RATING = { 3: ["Prime to sell", "great"], 2: ["Good to sell", "good"],
                      1: ["Fair", "fair"], 0: ["Hold", "over"] };

  // "Usually going for" — the asking-comps median reprice.py captured (with the
  // listing count it was based on). eBay denied us real SOLD comps, so this is
  // the typical ASKING price; our est_sold value already haircuts it. null when
  // we have no market read yet for this card.
  function goingFor(c) {
    return (c.market && num(c.market.median) > 0)
      ? { median: num(c.market.median), count: c.market.count | 0 } : null;
  }

  // Is the market read solid enough to suggest headroom? Needs a real sample
  // and our price sitting sensibly below the median (guards the noisy, thin
  // comps that reprice.py flags — e.g. a $189 card whose 3 comps median $885).
  function marketSolid(c, m) {
    var cur = num(c.asking_price);
    // Never suggest headroom against the asking median on a card priced from
    // real sold data (PSA's estimate, or sold prices the owner recorded). The
    // gap between the two is asking-price inflation, not money left on the
    // table — reading it as upside is how the collection got 51% overvalued.
    if (c.price_basis === "psa" || c.price_basis === "sold") return false;
    return m && m.count >= 5 && cur > 0 && cur < m.median && cur >= m.median * 0.5;
  }

  // Profit from the owner's recorded cost (gross, before eBay/shipping fees).
  // null when no cost is entered yet, so the UI can leave a labelled spot to
  // add it rather than pretending profit == full value.
  function profitOf(c) {
    var cost = num(c.cost), est = num(c.asking_price);
    if (cost <= 0 || est <= 0) return null;
    return { cost: cost, est: est, profit: est - cost, margin: (est - cost) / cost * 100 };
  }

  // compact profit chip for a sell row — the number when we have cost, or a
  // dashed "add cost" placeholder (the spot to fill) when we don't.
  function profitChip(c) {
    var pf = profitOf(c);
    if (!pf) return '<div class="rpf addcost">＋ add cost</div>';
    var up = pf.profit >= 0;
    return '<div class="rpf ' + (up ? "up" : "down") + '">' + (up ? "+" : "−") +
      money0(Math.abs(pf.profit)) + " profit</div>";
  }

  // compact market line under a sell row: the owner's tracked REAL sold price
  // first (when they have one), then typical asking + listing count, and
  // (only when solid) the room up toward that typical price.
  function marketLine(c) {
    var m = goingFor(c), ms = mySold(c);
    if (!m && !ms) return "";
    var bits = [];
    if (ms) bits.push('<span class="room">real sold ~' + money0(ms.median) + " (your comps)</span>");
    if (m) {
      var t = "Usually ~" + money0(m.median) + (m.count ? " · " + m.count + " on eBay" : "");
      if (marketSolid(c, m)) t += ' · <span class="room">room to ~' + money0(m.median) + "</span>";
      if (m.count && m.count < 5) t += ' · <span class="thin">thin data</span>';
      bits.push(t);
    }
    return '<div class="smkt">' + bits.join(" · ") + "</div>";
  }

  // Tiny inline price-history sparkline (SVG, no libraries). Reused in sell
  // rows and the card modal. Needs 2+ points; returns "" otherwise.
  function sparkline(series, w, h) {
    var pts = (series || []).filter(function (p) { return p && typeof p.p === "number"; });
    if (pts.length < 2) return "";
    w = w || 88; h = h || 26;
    var vals = pts.map(function (p) { return p.p; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    var X = function (i) { return (w - 2) * (i / (pts.length - 1)) + 1; };
    var Y = function (v) { return (h - 3) * (1 - (v - lo) / (hi - lo)) + 1.5; };
    var up = vals[vals.length - 1] >= vals[0];
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(p.p).toFixed(1); }).join(" ");
    return '<svg class="spark ' + (up ? "up" : "down") + '" viewBox="0 0 ' + w + " " + h +
      '" width="' + w + '" height="' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + d + '" fill="none" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + X(pts.length - 1).toFixed(1) + '" cy="' + Y(vals[vals.length - 1]).toFixed(1) + '" r="1.9"/></svg>';
  }

  // The map: a Value × Sell-readiness scatter. Top-right = big-ticket, ready to
  // sell. Dots colour by rating, tap to open the card.
  function quadrantMap(scored) {
    var panel = el('<div class="panel"><div class="ptitle">Sell map · value × readiness</div></div>');
    if (scored.length < 2) {
      panel.appendChild(el('<p class="muted" style="font-size:13px;margin:4px 0 2px">Add a few priced cards and the map fills in.</p>'));
      return panel;
    }
    var W = 600, H = 300, PL = 40, PR = 14, PT = 16, PB = 30;
    var vlog = scored.map(function (s) { return Math.log(Math.max(num(s.c.asking_price), 1)); });
    var lo = Math.min.apply(null, vlog), hi = Math.max.apply(null, vlog);
    if (hi === lo) { hi += 1; lo -= 1; }
    var X = function (lg) { return PL + (W - PL - PR) * (lg - lo) / (hi - lo); };
    var Y = function (sc) { return PT + (H - PT - PB) * (1 - sc / 100); };
    var midX = X((lo + hi) / 2), midY = Y(50);
    var dots = scored.map(function (s) {
      var r = SELL_RATING[s.bars] || SELL_RATING[0];
      var rad = 4 + Math.min(7, num(s.c.asking_price) > 0 ? Math.log(num(s.c.asking_price) + 1) : 0);
      return '<circle class="qd ' + r[1] + '" data-sku="' + esc(s.c.sku) + '" cx="' + X(Math.log(Math.max(num(s.c.asking_price), 1))).toFixed(1) +
        '" cy="' + Y(s.score).toFixed(1) + '" r="' + rad.toFixed(1) + '"><title>' + esc(s.c.player) +
        " · " + money0(s.c.asking_price) + " · " + r[0] + " (" + s.score + ")</title></circle>";
    }).join("");
    var svg = el(
      '<svg class="qmap" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Sell map: value versus readiness">' +
        '<rect class="qquad" x="' + midX + '" y="' + PT + '" width="' + (W - PR - midX) + '" height="' + (midY - PT) + '"/>' +
        '<line class="qax" x1="' + midX + '" y1="' + PT + '" x2="' + midX + '" y2="' + (H - PB) + '"/>' +
        '<line class="qax" x1="' + PL + '" y1="' + midY + '" x2="' + (W - PR) + '" y2="' + midY + '"/>' +
        '<line class="qbord" x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) + '"/>' +
        '<text class="qlab hot" x="' + (W - PR - 4) + '" y="' + (PT + 14) + '" text-anchor="end">▲ prime to sell</text>' +
        '<text class="tx" x="' + (PL) + '" y="' + (H - 10) + '">lower value</text>' +
        '<text class="tx" x="' + (W - PR) + '" y="' + (H - 10) + '" text-anchor="end">higher value →</text>' +
        '<text class="tx" x="6" y="' + (PT + 6) + '">ready</text>' +
        dots +
      "</svg>");
    svg.querySelectorAll(".qd").forEach(function (dot) {
      dot.style.cursor = "pointer";
      dot.onclick = function () {
        var sku = dot.getAttribute("data-sku");
        var card = state.data.cards.filter(function (c) { return c.sku === sku; })[0];
        if (card) openModal(card);
      };
    });
    panel.appendChild(svg);
    panel.appendChild(el('<p class="muted qcap">Each dot is a card — right = worth more, up = readier to sell. ' +
      'Tap a dot to open it. Colour = Prime / Good / Fair / Hold.</p>'));
    return panel;
  }

  // one ranked sell-candidate row
  function sellRowEl(s) {
    var c = s.c, r = SELL_RATING[s.bars] || SELL_RATING[0];
    var reasons = s.reasons.slice(0, 3).map(function (x) { return '<span class="rchip">' + esc(x) + "</span>"; }).join("");
    var spark = sparkline(c.price_series, 74, 24);
    var row = el(
      '<button class="srow">' +
        thumb(c) +
        '<div class="m"><div class="p">' + esc(c.player) +
          (c.listed ? ' <span class="badge b-listed">LISTED</span>' : "") + "</div>" +
          '<div class="sub">' + esc(c.line || "") + "</div>" +
          '<div class="rchips">' + reasons + "</div>" + marketLine(c) + "</div>" +
        '<div class="r">' +
          '<div class="val tnum">' + money0(c.asking_price) + changeChip(c) + "</div>" +
          profitChip(c) +
          (spark ? '<div class="sparkwrap">' + spark + "</div>" : "") +
          '<div class="drate ' + r[1] + '">' + ratingBars(s.bars) + '<span class="rlabel">' + r[0] + "</span></div>" +
        "</div>" +
      "</button>");
    row.onclick = function () { openModal(c); };
    return row;
  }

  function viewSalesMap() {
    var wrap = el('<div class="view salesmap"></div>');
    wrap.appendChild(el('<div class="eyebrow">Sales Map</div>'));
    wrap.appendChild(el('<p class="muted" style="font-size:13px;margin:0 2px 12px">Which of your cards are in the best ' +
      "position to sell — scored on value, how fast the type moves, and price momentum — plus how prices are changing over time.</p>"));

    // held, priced cards → scored & ranked
    var held = state.data.cards.filter(function (c) { return !c.sold && num(c.asking_price) > 0; });
    var scored = held.map(function (c) { var s = sellScore(c); s.c = c; return s; })
      .sort(function (a, b) { return b.score - a.score; });

    if (!scored.length) {
      wrap.appendChild(el('<div class="card"><p class="muted" style="margin:0">No priced cards to map yet. ' +
        "Price your cards (weekly eBay re-price does this automatically) and they’ll rank here.</p></div>"));
      return wrap;
    }

    // headline tiles: how many are prime / good / worth listing + est. profit
    var sm = state.data.summary;
    var prime = scored.filter(function (s) { return s.bars >= 3; });
    var good = scored.filter(function (s) { return s.bars === 2; });
    var topVal = scored.reduce(function (a, s) { return a + num(s.c.asking_price); }, 0);
    var costCount = sm.cost_count || 0, pricedM = sm.priced || scored.length;
    var tiles = el('<div class="tiles"></div>');
    tiles.appendChild(el('<div class="tile hero"><div class="k">Prime to sell now</div><div class="v tnum">' +
      prime.length + ' <small class="hsub">of ' + scored.length + " priced</small></div></div>"));
    [["Good to sell", good.length, ""],
     ["Value in play", money0(topVal), ""]].forEach(function (t) {
      tiles.appendChild(el('<div class="tile"><div class="k">' + t[0] + '</div><div class="v tnum ' + t[2] + '">' + t[1] + "</div></div>"));
    });
    // Est. profit — only meaningful over cards with a cost entered; otherwise a
    // gentle prompt to add cost (the "spot to fill").
    var pVal = costCount ? ((sm.profit >= 0 ? "+" : "−") + money0(Math.abs(sm.profit))) : "—";
    var pCls = costCount ? (sm.profit >= 0 ? "pos" : "neg") : "";
    var pSub = costCount ? "on " + costCount + " of " + pricedM + " with cost" : "add cost to unlock";
    tiles.appendChild(el('<div class="tile"><div class="k">Est. profit</div><div class="v tnum ' + pCls +
      '">' + pVal + ' <small class="tsub">' + pSub + "</small></div></div>"));
    wrap.appendChild(tiles);

    // Dashboard grid. DOM order (map → list → price changes) is the phone
    // stack; on PC the grid re-flows to map+analytics on the left, ranked
    // list spanning the right — so phones keep the order the owner liked.
    var grid = el('<div class="smgrid"></div>');

    var mapcol = el('<div class="smmap"></div>');
    mapcol.appendChild(quadrantMap(scored));
    grid.appendChild(mapcol);

    var listcol = el('<div class="smlist"></div>');
    listcol.appendChild(el('<div class="eyebrow">Best positioned to sell</div>'));
    var list = el('<div class="list sellist"></div>');
    scored.slice(0, 12).forEach(function (s) { list.appendChild(sellRowEl(s)); });
    listcol.appendChild(list);
    grid.appendChild(listcol);

    // price-change analytics: value trend + weekly gainers / decliners
    var trendcol = el('<div class="smtrends"></div>');
    trendcol.appendChild(el('<div class="eyebrow">Price changes</div>'));
    var vgrid = el('<div class="vgrid"></div>');
    vgrid.appendChild(trendChart(state.data.history));
    vgrid.appendChild(moversSplitPanel());
    trendcol.appendChild(vgrid);
    grid.appendChild(trendcol);

    wrap.appendChild(grid);
    return wrap;
  }

  // Gainers (sell into strength) vs decliners (sell before further slide),
  // from week-over-week price moves. Populates once re-price history builds.
  function moversSplitPanel() {
    var panel = el('<div class="panel"><div class="ptitle">This week · gainers &amp; decliners</div></div>');
    var moved = state.data.cards.filter(function (c) {
      return !c.sold && num(c.prev_price) > 0 && num(c.asking_price) > 0 &&
             Math.abs(num(c.asking_price) - num(c.prev_price)) / num(c.prev_price) >= 0.005;
    }).map(function (c) {
      return { c: c, pct: (num(c.asking_price) - num(c.prev_price)) / num(c.prev_price) * 100 };
    });
    if (!moved.length) {
      panel.appendChild(el('<p class="muted" style="font-size:13px;margin:4px 0 2px">No price moves yet — ' +
        "gainers and decliners appear once the weekly eBay re-price has two snapshots to compare.</p>"));
      return panel;
    }
    var up = moved.filter(function (m) { return m.pct > 0; }).sort(function (a, b) { return b.pct - a.pct; }).slice(0, 4);
    var down = moved.filter(function (m) { return m.pct < 0; }).sort(function (a, b) { return a.pct - b.pct; }).slice(0, 4);
    function group(title, arr, cls) {
      if (!arr.length) return "";
      var rows = arr.map(function (m) {
        return '<button class="mover" data-sku="' + esc(m.c.sku) + '"><span class="mp">' + esc(m.c.player) +
          '</span><span class="ms">' + esc(m.c.line || "") + '</span>' +
          '<span class="mr tnum">' + money0(m.c.asking_price) + changeChip(m.c) + "</span></button>";
      }).join("");
      return '<div class="mgroup ' + cls + '"><div class="mglab">' + title + "</div>" + rows + "</div>";
    }
    var box = el('<div class="movers split">' + group("▲ Gainers", up, "g-up") + group("▼ Decliners", down, "g-down") + "</div>");
    box.querySelectorAll(".mover").forEach(function (b) {
      b.onclick = function () {
        var card = state.data.cards.filter(function (c) { return c.sku === b.getAttribute("data-sku"); })[0];
        if (card) openModal(card);
      };
    });
    panel.appendChild(box);
    return panel;
  }

  // value rating (like Alt's green bars): 3 Great / 2 Good / 1 Fair / 0 Over
  var RATINGS = { 3: ["Great Value", "great"], 2: ["Good Value", "good"],
                  1: ["Fair Price", "fair"], 0: ["Over Market", "over"] };
  function ratingBars(bars) {
    var n = Math.max(0, Math.min(3, bars | 0));
    var out = "";
    for (var i = 0; i < 3; i++) out += '<span class="vb' + (i < n ? " on" : "") + '"></span>';
    return '<span class="vbars">' + out + "</span>";
  }

  var BUY_CATEGORIES = { downtown_kaboom: "Downtown / Kaboom", autos: "Numbered & rookie autos", rookies: "Graded rookies", inserts: "Other chase inserts", established: "Stars & legends" };
  function radarMoney(n) { return typeof n === "number" ? money(n) : "Not established"; }
  function safeBuyLink(url) { return /^https:\/\//i.test(url || "") ? esc(url) : "#"; }
  function radarHasNumber(n) { return typeof n === "number" && isFinite(n); }
  function radarDisplayPrice(n, exact) {
    if (!radarHasNumber(n)) return '—';
    return exact && Math.abs(n - Math.round(n)) > .001 ? money(n) : money0(n);
  }
  function profitResearchRow(c) {
    var e = c.economics, ev = c.evidence || {}, specs = c.identity || {};
    var resale = e ? e.resale : ev.conservative_resale;
    var priced = radarHasNumber(resale), hasProfit = e && radarHasNumber(e.adjusted_profit);
    var supported = ev.confidence === 'medium';
    var status = {qualified:c.grade_scope === 'exception' ? '★ RARE EXCEPTION' : '✓ BUY CANDIDATE', research:'RESEARCH ONLY', pass:'✕ DO NOT BUY', excluded:'— REJECTED'}[c.status] || 'RESEARCH ONLY';
    var player = specs.player || c.label;
    var initials = player.split(/\s+/).filter(Boolean).slice(0,2).map(function(x){return x[0];}).join('');
    var specLine = [specs.year, specs.set, specs.number ? '#' + specs.number : '', specs.parallel && specs.parallel !== 'base' ? specs.parallel : '', specs.print_run && specs.print_run !== 'none' ? '/' + specs.print_run : ''].filter(Boolean).join(' · ');
    var grade = specs.grader && specs.grade ? specs.grader + ' ' + specs.grade : 'Grade unconfirmed';
    var unavailable = c.page_state === 'sold' || c.page_state === 'ended';
    var askLabel = c.buying_option === 'AUCTION' ? 'Current bid' : unavailable ? 'Past listing' : c.page_state === 'mismatch' ? 'Wrong-grade ask' : 'Listed for';
    var buyNote = c.buying_option === 'AUCTION' ? 'Auction · price can rise' : unavailable ? 'No longer available' : c.page_state === 'mismatch' ? 'Not the target card' : radarHasNumber(c.all_in) ? 'Est. total ' + money0(c.all_in) : 'Shipping / tax unknown';
    var resaleNote = priced ? (supported ? 'Based on sold comps' : 'Low-confidence estimate') : 'Need sold comps';
    var profitText = hasProfit ? (e.adjusted_profit >= 0 ? '+' : '−') + money0(Math.abs(e.adjusted_profit)) : '—';
    var profitTone = hasProfit ? (e.adjusted_profit < 0 ? 'loss' : c.status === 'qualified' ? 'gain' : 'pending') : 'pending';
    var profitLabel = hasProfit && e.adjusted_profit < 0 ? 'Loss incl. time & risk' : 'Profit after all costs';
    var profitNote = hasProfit ? 'Cash result: ' + (e.cash_margin >= 0 ? '+' : '−') + money0(Math.abs(e.cash_margin)) : unavailable || c.page_state === 'mismatch' ? 'No eligible listing' : priced ? 'Purchase costs unknown' : 'Resale estimate needed';
    var shortReason = c.status === 'qualified' ? 'Clears your buying rules' : c.status === 'pass' ? 'Too expensive at this price' : c.page_state === 'mismatch' ? 'Wrong card or grade' : unavailable ? 'Unavailable' : c.buying_option === 'AUCTION' ? 'Auction · wait for final price' : c.all_in > 1000 ? 'Above your buying budget' : !priced ? 'Wait for sold comparisons' : 'Verify before buying';
    if (c.status === 'research' && c.page_state === 'unverified') shortReason = 'Availability needs a recheck';
    var soldRows = (ev.sales || []).map(function(s) {
      return '<a class="pr-sale" target="_blank" rel="noopener" href="' + safeBuyLink(s.url) + '"><span>' + esc(s.date) + ' · ' + esc(s.source_type) + '</span><b>' + money(s.price) + '</b></a>';
    }).join('');
    var math = e ? '<div class="pr-math">' + [
      ['Expected resale', e.resale], ['Your total purchase cost', -e.acquisition],
      ['eBay fees', -e.selling_fee], ['Promotion allowance', -e.promotion_reserve],
      ['Shipping + supplies', -e.outbound_shipping-e.supplies],
      ['Cash margin before reserves', e.cash_margin], ['Risk reserve', -e.contingency],
      ['Your time', -e.labor_allowance], ['Cost of holding cash', -e.capital_allowance],
      ['Adjusted profit · before income tax', e.adjusted_profit]
    ].map(function(x){return '<div><span>' + esc(x[0]) + '</span><b>' + money(x[1]) + '</b></div>';}).join('') +
      '<p class="muted">Your minimum: ' + money(e.minimum_profit) + ' profit AND ' + Math.round(e.minimum_roi*100) + '% return. This scenario: ' + Math.round(e.roi*100) + '% return. If resale drops 15% and the hold takes 60 days longer: ' + money(c.stress_profit) + ' profit.</p></div>' :
      '<p class="muted">We do not have enough sold-price evidence to estimate resale and profit. Asking prices and unverified guide values are not resale estimates.</p>';
    return '<article class="pr-card pr-decision pr-decision-' + esc(c.status) + '">' +
      '<div class="pr-cardhead"><span class="pr-status pr-' + esc(c.status) + '">' + status + '</span><span class="pr-grade">' + esc(grade) + '</span></div>' +
      '<div class="pr-identity"><div class="pr-monogram" aria-hidden="true">' + esc(initials) + '</div><div><h3>' + esc(player) + '</h3><p class="pr-spec">' + esc(specLine || c.item_title) + (specs.autograph ? ' · AUTO' : '') + '</p></div></div>' +
      '<div class="pr-priceflow"><div class="pr-pricebox"><span>' + askLabel + '</span><strong>' + radarDisplayPrice(c.price,true) + '</strong><small>' + buyNote + '</small></div><span class="pr-flowarrow" aria-hidden="true">→</span>' +
      '<div class="pr-pricebox pr-resale ' + (!priced ? 'pr-unknown' : '') + '"><span>Expected resale</span><strong>' + (priced ? '~' : '') + radarDisplayPrice(resale) + '</strong><small>' + resaleNote + '</small></div></div>' +
      '<div class="pr-profit pr-profit-' + profitTone + '"><div><span>' + profitLabel + '</span><small>' + profitNote + '</small></div><strong>' + profitText + '</strong></div>' +
      '<div class="pr-bottomline"><span>' + shortReason + '</span><span>' + esc(c.hold_days) + '-day plan</span></div>' +
      '<details class="pr-detail"><summary>Price breakdown & sources</summary><p>' + esc(c.item_title) + '</p><p class="muted">' + esc(c.ceiling_label || '') + '. ' + ev.count + ' reported sales; ' + ev.primary_count + ' primary confirmations. Estimates are before income tax. Large figures are rounded; exact amounts are below.</p>' +
      '<div class="pr-math"><div><span>' + askLabel + '</span><b>' + radarMoney(c.price) + '</b></div><div><span>Incoming shipping</span><b>' + radarMoney(c.shipping) + '</b></div><div><span>Estimated total with tax</span><b>' + radarMoney(c.all_in) + '</b></div></div>' +
      '<p>' + esc(c.hold_days) + '-day hold: ' + esc(c.hold_basis) + '.</p>' +
      (radarHasNumber(c.max_all_in) ? '<p>Maximum total buy cost at this resale: <b>' + (c.max_all_in > 0 ? money(c.max_all_in) : 'No viable price') + '</b>.' + (!supported ? ' Unverified scenario only.' : '') + '</p>' : '') +
      (c.max_offer > 0 ? '<p>Item-price ceiling: <b>' + money(c.max_offer) + '</b>. Opening-offer scenario: ' + money(c.opening_offer) + '. No offer sent.</p>' : '') +
      math + '<ul>' + (c.reasons || []).map(function(r){return '<li>' + esc(r) + '</li>';}).join('') + '</ul>' + soldRows +
      '<p class="muted">Observed ' + esc(c.checked_at || 'unknown') + '. Recheck availability, checkout tax and shipping. Source-reported sales are not proof of settlement.</p><a class="pr-soldlink" target="_blank" rel="noopener" href="' + dealSearchUrl(c,true) + '">Check sold listings ↗</a></details>' +
      '<a class="pr-listing" target="_blank" rel="noopener" href="' + safeBuyLink(c.url) + '">' + (unavailable || c.page_state === 'mismatch' ? 'View original source' : 'View listing') + ' <span aria-hidden="true">↗</span></a></article>';
  }
  function viewProfitRadar(radar) {
    var wrap = el('<div class="view profit-radar"></div>');
    var rows = (radar.candidates || []).map(function(c) {
      if (c.status !== 'qualified') return c;
      var age = Date.now() - Date.parse(c.checked_at || '');
      if (isFinite(age) && age >= 0 && age <= 48*3600000) return c;
      return Object.assign({}, c, {status:'research', grade_scope:c.grade_scope === 'exception' ? 'outside_focus' : c.grade_scope, reasons:['Listing observation expired; recheck before acting'].concat(c.reasons || [])});
    });
    var allRows = rows;
    rows = allRows.filter(function(c){return c.grade_scope === 'exception' || (c.grade_scope !== 'outside_focus' && String((c.identity || {}).grader).toUpperCase() === 'PSA' && String((c.identity || {}).grade) === '10');});
    rows.sort(function(a,b){var rank=function(c){return c.status==='qualified'?0:c.status==='excluded'?3:c.economics?1:2;};return rank(a)-rank(b);});
    var counts = {}, policy = radar.policy || {}, coverage = radar.coverage || {};
    ['qualified','research','pass','excluded'].forEach(function(k){counts[k]=rows.filter(function(c){return c.status===k;}).length;});
    wrap.appendChild(el('<div class="pr-overview"><div class="pr-overviewtop"><div><span class="pr-kicker">BUY RADAR · PSA 10s</span><h2>' + counts.qualified + ' ready to buy</h2></div><span class="pr-partial">Partial scan</span></div><div class="pr-counts">' +
      [['research','Research'],['pass','Pass'],['excluded','Excluded']].map(function(x){return '<div><i class="pr-dot pr-dot-' + x[0] + '" aria-hidden="true"></i><b>' + counts[x[0]] + '</b><span>' + x[1] + '</span></div>';}).join('') +
      '</div><div class="pr-overviewfoot">' + rows.length + ' cards in view <span>·</span> ' + radar.watch_count + ' PSA 10 targets</div></div>'));
    var diagnostic = radar.diagnostics || {};
    var rules = '<details class="pr-policy"><summary>Buying rules & scan details</summary><p><b>PSA 10s first.</b> Other grades only appear if fully verified with at least $300 adjusted profit AND 50% return, and a supported hold of 30 days or less. Otherwise they stay out of this view.</p><p>Both minimums must pass after all fees, costs, time and holding allowances.</p><div class="pr-tier">';
    (policy.hold_tiers || []).forEach(function(t,i){var prev=i?policy.hold_tiers[i-1].through_days+1:1;rules+='<div><span>'+prev+'–'+t.through_days+' days</span><b>'+money0(t.profit)+' AND '+Math.round(t.roi*100)+'% return</b></div>';});
    rules += '</div><p>Normal total buy budget: $500. $500–$1,000 needs individual review; above $1,000 is research only. Unknown hold: 90 days. Shorter holds need supporting evidence. Over 120 days: research only.</p><p class="muted">' + esc(policy.assumptions || '') + '</p><a target="_blank" rel="noopener" href="' + safeBuyLink(policy.fee_source) + '">eBay fee schedule ↗</a>' +
      '<p class="muted">' + esc(coverage.mode || 'Research snapshot') + ' · evaluated ' + esc((radar.as_of || '').slice(0,16).replace('T',' ')) + ' UTC. ' + esc(coverage.notes || 'Partial scan.') + '</p>';
    rules += '<p>' + (allRows.length-rows.length) + ' other-grade observations are hidden. Original evidence is preserved.</p>';
    if(typeof diagnostic.sales_supported==='number') rules += '<p>' + diagnostic.sales_supported + ' of ' + radar.scanned + ' observations have the required primary sold records. ' + diagnostic.priced_scenarios + ' have a resale scenario.</p>';
    if((coverage.api_access||{}).browse==='credentials_unavailable') rules += '<p class="muted">This run used public pages. Live eBay API access was unavailable in this research runner.</p>';
    rules += '</details>'; wrap.appendChild(el(rules));
    var stale = rows.some(function(c){var age=Date.now()-Date.parse(c.checked_at||'');return !isFinite(age)||age<0||age>48*3600000;});
    if(stale) wrap.appendChild(el('<div class="pr-warning">Older prices — recheck listings before buying.</div>'));
    var toolbar = el('<div class="pr-toolbar"><label>Show<select id="profitStatus"><option value="qualified">Buy opportunities '+counts.qualified+'</option><option value="research">Research only '+counts.research+'</option><option value="rejected">Rejected '+(counts.pass+counts.excluded)+'</option><option value="all">All checked '+rows.length+'</option></select></label><label>Type<select id="profitCategory"><option value="all">All cards</option>'+Object.keys(BUY_CATEGORIES).map(function(k){return '<option value="'+k+'">'+BUY_CATEGORIES[k]+'</option>';}).join('')+'</select></label></div>');
    wrap.appendChild(toolbar);
    var viewLabel=el('<p class="pr-viewlabel"></p>');wrap.appendChild(viewLabel);
    var list=el('<div class="pr-grid"></div>');wrap.appendChild(list);
    function update(){
      var status=toolbar.querySelector('#profitStatus').value,category=toolbar.querySelector('#profitCategory').value;
      var shown=rows.filter(function(c){return(status==='all'||c.status===status||(status==='rejected'&&(c.status==='pass'||c.status==='excluded')))&&(category==='all'||c.category===category);});
      viewLabel.textContent={qualified:'BUY OPPORTUNITIES',research:'RESEARCH ONLY · NOT READY TO BUY',rejected:'REJECTED · DO NOT BUY',all:'RESEARCH LOG · INCLUDES REJECTED CARDS'}[status] || '';
      list.innerHTML=shown.length?shown.map(profitResearchRow).join(''):status==='qualified'?'<div class="pr-empty"><span aria-hidden="true">⌕</span><h3>No verified buys yet</h3><p>Only cards meeting your profit rules appear here.</p></div>':'<div class="card"><p>No cards in this view yet.</p></div>';
    }
    toolbar.querySelectorAll('select').forEach(function(s){s.onchange=update;});update();
    return wrap;
  }

  function viewRadar() {
    if ((state.data.radar || {}).schema_version === 2) return viewProfitRadar(state.data.radar);
    var wrap = el('<div class="view"></div>');
    var radar = state.data.radar || { as_of: "", watch_count: 0, deals: [] };
    var deals = radar.deals || [];
    wrap.appendChild(el('<div class="eyebrow">Buy Radar</div>'));
    var extra = (radar.scanned && radar.scanned > deals.length)
      ? " Showing the " + deals.length + " strongest of " + radar.scanned + " under-market finds."
      : "";
    var band = (radar.price_min && radar.price_max)
      ? " Focused on " + money0(radar.price_min) + "–" + money0(radar.price_max) +
        " cards, football first."
      : "";
    var sub = radar.as_of
      ? "Live eBay deals on your watchlist, priced under market. Rated Great / Good / Fair." +
        band + " Last checked " + esc(radar.as_of) + " · refreshes automatically." + extra
      : "Scans eBay for deals on your watchlist and rates them Great / Good / Fair." + band +
        " Runs on a schedule and refreshes here — nothing to do.";
    wrap.appendChild(el('<p class="muted" style="font-size:13px;margin:0 2px 12px">' + sub + "</p>"));

    if (!deals.length) {
      var msg = radar.as_of
        ? "No deals under your targets right now — inventory turns over fast, so Buy Radar re-checks on its next run."
        : "Buy Radar hasn’t run yet. Once it does (it’s scheduled), the best under-market deals on your watchlist show up here.";
      wrap.appendChild(el('<div class="card"><p class="muted" style="margin:0">' + msg +
        '</p></div>'));
      wrap.appendChild(el('<p class="muted" style="font-size:12px;margin:12px 2px">' +
        "Edit your watchlist in data/watchlist.csv (add a fair value or an alert-below price to sharpen the deals)." +
        "</p>"));
      return wrap;
    }

    // ---- Filter bar: Type (Downtown/Kaboom/Other), Sport, Graded, PSA grade.
    // Options are built from what's actually in the current deals, so we never
    // show an empty facet.
    var TYPE_LABEL = { downtown: "Downtown", kaboom: "Kaboom", other: "No Kaboom/Downtown" };
    var typesPresent = ["downtown", "kaboom", "other"].filter(function (t) {
      return deals.some(function (d) { return dealType(d) === t; });
    });
    var sportsPresent = deals.map(function (d) { return (d.sport || "").toLowerCase(); })
      .filter(function (s, i, a) { return s && a.indexOf(s) === i; });
    var gradesPresent = deals.map(dealGrade).filter(function (g, i, a) {
      return g && a.indexOf(g) === i;
    }).sort(function (a, b) { return parseFloat(b) - parseFloat(a); });
    var hasGraded = deals.some(function (d) { return dealGrader(d); });

    function sel(name, opts) {
      var cur = state.radarFilter[name];
      var o = opts.map(function (op) {
        return '<option value="' + op[0] + '"' + (cur === op[0] ? " selected" : "") +
          ">" + esc(op[1]) + "</option>";
      }).join("");
      return '<select class="sortsel" data-rf="' + name + '">' + o + "</select>";
    }

    var controls = "";
    controls += sel("type", [["all", "All types"]].concat(typesPresent.map(function (t) {
      return [t, TYPE_LABEL[t]]; })));
    if (sportsPresent.length) {
      controls += sel("sport", [["all", "All sports"]].concat(sportsPresent.map(function (s) {
        return [s, s.charAt(0).toUpperCase() + s.slice(1)]; })));
    }
    if (hasGraded) {
      controls += sel("graded", [["all", "Graded: all"], ["graded", "Graded only"], ["raw", "Raw only"]]);
    }
    if (gradesPresent.length) {
      controls += sel("grade", [["all", "Any PSA grade"]].concat(gradesPresent.map(function (g) {
        return [g, "PSA " + g]; })));
    }
    var bar = el('<div class="radartools">' + controls + "</div>");
    bar.querySelectorAll("select").forEach(function (s) {
      s.onchange = function () {
        state.radarFilter[s.getAttribute("data-rf")] = s.value;
        renderResults();
      };
    });
    wrap.appendChild(bar);

    var results = el("<div></div>");
    wrap.appendChild(results);

    function renderResults() {
      results.innerHTML = "";
      var f = state.radarFilter;
      var shown = deals.filter(function (d) { return matchRadar(d, f); });
      var active = f.type !== "all" || f.sport !== "all" || f.graded !== "all" || f.grade !== "all";
      var head = el('<div class="rescount">Showing ' + shown.length + " of " + deals.length +
        " deals" + (active ? ' · <a href="#" class="clearf">Clear filters</a>' : "") + "</div>");
      results.appendChild(head);
      var clr = head.querySelector(".clearf");
      if (clr) clr.onclick = function (e) {
        e.preventDefault();
        state.radarFilter = { type: "all", sport: "all", graded: "all", grade: "all" };
        render();
      };

      if (!shown.length) {
        results.appendChild(el('<div class="card"><p class="muted" style="margin:0">' +
          "No deals match these filters right now. Try clearing one — inventory changes on every scan." +
          "</p></div>"));
        return;
      }

      var list = el('<div class="list radar"></div>');
      shown.forEach(function (d) {
        var r = RATINGS[Math.max(0, Math.min(3, d.bars | 0))] || RATINGS[0];
        var auction = /AUCTION/i.test(d.buying_option || "");
        var kind = auction ? "Auction" : "Buy Now";
        var ph = { image: d.image, player: d.label, team: "" };
        var sportBadge = /^football$/i.test(d.sport || "") ? ' <span class="sportbadge">🏈</span>' : "";
        var premiumBadge = d.premium ? ' <span class="badge b-num">💥</span>' : "";
        var row = el('<div class="drow" role="button" tabindex="0">' +
          thumb(ph, "dthumb") +
          '<div class="dm">' +
            '<div class="dp">' + esc(d.label) + sportBadge + premiumBadge + "</div>" +
            '<div class="ds">' + esc(d.item_title) + "</div>" +
            '<div class="drate ' + r[1] + '">' + ratingBars(d.bars) +
              '<span class="rlabel">' + r[0] + "</span>" +
              (d.snipe ? '<span class="snipe">⏱ ENDS SOON</span>' : "") +
            "</div>" +
            '<div class="dmeta">' + kind + " · vs " + refLine(d) + thinChip(d) + "</div>" +
          "</div>" +
          '<div class="dr">' +
            '<div class="dprice tnum">' + money(d.price) + "</div>" +
            '<div class="ddisc tnum">▼ ' + Math.abs(Math.round(d.discount_pct)) + "% under</div>" +
          "</div></div>");
        row.onclick = function () { openDeal(d); };
        row.onkeydown = function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDeal(d); }
        };
        list.appendChild(row);
      });
      results.appendChild(list);
      results.appendChild(el('<p class="muted" style="font-size:12px;margin:14px 2px">' +
        "Tap a deal to see what’s on eBay now + recent sold prices, then open the listing. " +
        "Prices are live from eBay’s active listings; “mkt” is the market reference we compared against." + "</p>"));
    }

    renderResults();
    return wrap;
  }

  // ---- Honest reference labels: how many comps, which grade pool, thin-data --
  var POOL_LABEL = { psa10: "PSA 10 pool", psa9: "PSA 9 pool",
    graded_other: "graded pool", raw: "raw pool" };
  function poolLabel(d) {
    return POOL_LABEL[d.grade_key] || "";
  }
  // "~$980 · 7 comps · PSA 10 pool" — the reference, made honest.
  function refLine(d) {
    var out = "~" + money0(d.reference);
    if (d.ref_count) out += " · " + d.ref_count + " comp" + (d.ref_count === 1 ? "" : "s");
    var pool = poolLabel(d);
    if (pool) out += " · " + pool;
    return out;
  }
  // A small caution chip when the reference came from very few comps.
  function thinChip(d) {
    return (d.ref_count && d.ref_count < 5)
      ? ' <span class="thinchip" title="Market reference from few listings — treat as a rough guide">thin data</span>'
      : "";
  }

  // ---- Buy Radar deal facets, derived from each deal's title/query ----------
  function dealType(d) {
    var s = ((d.query || "") + " " + (d.item_title || "")).toLowerCase();
    if (s.indexOf("kaboom") >= 0) return "kaboom";
    if (s.indexOf("downtown") >= 0) return "downtown";
    return "other";
  }
  function dealGrader(d) {
    var m = (d.item_title || "").match(/\b(PSA|BGS|BVG|SGC|CGC|CSG|HGA)\b/i);
    return m ? m[1].toUpperCase() : "";
  }
  function dealGrade(d) {
    // PSA grade specifically (owner asked "what PSA grade").
    var m = (d.item_title || "").match(/\bPSA\s*(10|9\.5|9|8\.5|8|7|6|5)\b/i);
    return m ? m[1] : "";
  }
  function matchRadar(d, f) {
    if (f.type !== "all" && dealType(d) !== f.type) return false;
    if (f.sport !== "all" && (d.sport || "").toLowerCase() !== f.sport) return false;
    if (f.graded === "graded" && !dealGrader(d)) return false;
    if (f.graded === "raw" && dealGrader(d)) return false;
    if (f.grade !== "all" && dealGrade(d) !== f.grade) return false;
    return true;
  }

  // eBay public search URL for a deal — live listings, or completed/sold.
  function dealSearchUrl(d, soldOnly) {
    var q = d.query || d.item_title || d.label;
    return "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(q) +
      (soldOnly ? "&LH_Sold=1&LH_Complete=1" : "");
  }

  // "Currently on eBay" box — the cheapest live listings radar.py captured.
  function samplesBox(d) {
    if (!d.samples || !d.samples.length) return "";
    var rows = d.samples.map(function (s) {
      var inner = '<span class="ct">' + esc(s.t) + '</span><b class="tnum">' + money0(s.p) + "</b>";
      return s.u ? '<a class="comp" href="' + esc(s.u) + '" target="_blank" rel="noopener">' + inner + "</a>"
                 : '<span class="comp">' + inner + "</span>";
    }).join("");
    return '<div class="compsbox"><div class="lab">Currently on eBay · cheapest</div>' + rows +
      '<div class="cfoot">live active listings · tap one to open it on eBay</div></div>';
  }

  // Buy Radar deal popup: the listing, current market, what’s on eBay now, and
  // buttons to the listing / all live listings / recent sold prices.
  function openDeal(d) {
    var m = document.getElementById("modal");
    var r = RATINGS[Math.max(0, Math.min(3, d.bars | 0))] || RATINGS[0];
    var auction = /AUCTION/i.test(d.buying_option || "");
    var kind = auction ? "Auction" : "Buy Now";
    var ph = { image: d.image, player: d.label, team: "" };
    var sportBadge = /^football$/i.test(d.sport || "") ? ' <span class="sportbadge">🏈</span>' : "";
    var premiumBadge = d.premium ? ' <span class="badge b-num">💥 Premium insert</span>' : "";
    m.innerHTML =
      '<button class="close" id="mClose">✕</button>' +
      '<div class="mgrid">' +
        '<div class="mhero">' + thumb(ph, "big") + "</div>" +
        '<div class="mbody">' +
          "<h3>" + esc(d.label) + sportBadge + premiumBadge + "</h3>" +
          '<div class="muted" style="font-size:13px">' + esc(d.item_title) + "</div>" +
          '<div class="dealhead">' +
            '<span class="dhprice tnum">' + money(d.price) + "</span>" +
            '<span class="dhkind"> · ' + kind +
              (d.snipe ? " · ⏱ ends soon" : "") + "</span>" +
          "</div>" +
          '<div class="drate ' + r[1] + '" style="margin:2px 0 4px">' + ratingBars(d.bars) +
            '<span class="rlabel">' + r[0] + "</span>" +
            '<span class="dhdisc"> · ▼ ' + Math.abs(Math.round(d.discount_pct)) +
            "% under · vs " + refLine(d) + thinChip(d) + "</span>" +
          "</div>" +
          samplesBox(d) +
          '<div class="mbtns">' +
            '<a class="mbtn prime" href="' + esc(d.url) + '" target="_blank" rel="noopener">🛒 Open this listing on eBay</a>' +
            '<a class="mbtn" href="' + dealSearchUrl(d, false) + '" target="_blank" rel="noopener">🔎 All live listings</a>' +
            '<a class="mbtn" href="' + dealSearchUrl(d, true) + '" target="_blank" rel="noopener">✅ Recent sold prices</a>' +
            '<a class="mbtn" href="' + terapeakUrl(d.query || d.item_title || d.label) + '" target="_blank" rel="noopener">📊 Terapeak sold data</a>' +
          "</div>" +
        "</div>" +
      "</div>";
    m.querySelector("#mClose").onclick = closeModal;
    document.getElementById("modalWrap").classList.add("open");
  }

  function viewTargets() {
    var targets=state.data.targets||[],wrap=el('<div class="view profit-radar target-view"></div>');
    var cats={rookies:['◆','Rookies'],autos:['✎','Autographs'],inserts:['✦','Chase inserts'],established:['★','Stars & legends'],downtown_kaboom:['◈','Downtown / Kaboom']};
    wrap.appendChild(el('<div class="pr-overview"><div class="pr-overviewtop"><div><span class="pr-kicker">TARGETS · PSA 10 ONLY</span><h2>Find the next flip</h2></div><span class="tg-total">'+targets.length+'<small>targets</small></span></div><div class="tg-budget"><div><span>Core search</span><b>$100–$400</b></div><div><span>Total buy budget</span><b>$500</b></div></div></div>'));
    var chips=el('<div class="tg-categories" aria-label="Target categories"><button class="active" data-cat="all" aria-pressed="true"><span>◎</span><b>All cards</b><small>'+targets.length+'</small></button>'+Object.keys(cats).map(function(k){return '<button data-cat="'+k+'" aria-pressed="false"><span>'+cats[k][0]+'</span><b>'+cats[k][1]+'</b><small>'+targets.filter(function(t){return t.category===k;}).length+'</small></button>';}).join('')+'</div>');wrap.appendChild(chips);
    var controls=el('<div class="tg-controls"><input type="search" aria-label="Find a target" placeholder="Find a player or set…"><select aria-label="Target sport"><option value="all">All sports</option><option value="football">Football</option><option value="basketball">Basketball</option><option value="baseball">Baseball</option></select></div>');wrap.appendChild(controls);
    var count=el('<p class="pr-viewlabel"></p>');wrap.appendChild(count);var grid=el('<div class="tg-grid"></div>');wrap.appendChild(grid);var selected='all';
    function update(){var q=controls.querySelector('input').value.toLowerCase().trim(),sport=controls.querySelector('select').value;var rows=targets.filter(function(t){return(selected==='all'||t.category===selected)&&(sport==='all'||t.sport===sport)&&((t.label+' '+t.query).toLowerCase().indexOf(q)>=0);});count.textContent=rows.length+' SEARCH TARGETS · NOT BUY RECOMMENDATIONS';
      grid.innerHTML=rows.length?rows.map(function(t){var cat=cats[t.category]||['◆','Card'],label=t.label.replace(/ PSA 10/g,'');return '<article class="tg-card tg-'+esc(t.category)+'"><div class="tg-top"><span class="tg-symbol" aria-hidden="true">'+cat[0]+'</span><span class="tg-grade">PSA 10</span></div><h3>'+esc(label)+'</h3><div class="tg-meta"><span>'+esc(t.sport)+'</span><span>'+cat[1]+'</span></div><a class="pr-listing" target="_blank" rel="noopener" href="'+dealSearchUrl(t,false)+'">Find listings <span>↗</span></a><details><summary>Search details</summary><p>'+esc(t.query)+'</p><p>Search ceiling '+money0(t.price_max)+'. This is a search filter, not a buy price. Buy price requires exact sold comparisons and your profit minimums.</p><a target="_blank" rel="noopener" href="'+dealSearchUrl(t,true)+'">Check sold prices ↗</a></details></article>';}).join(''):'<div class="pr-empty"><h3>No matching targets</h3><p>Try another player, sport or category.</p></div>';}
    chips.querySelectorAll('button').forEach(function(btn){btn.onclick=function(){selected=btn.getAttribute('data-cat');chips.querySelectorAll('button').forEach(function(x){var active=x===btn;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active));});update();};});controls.querySelector('input').oninput=update;controls.querySelector('select').onchange=update;update();return wrap;
  }

  function viewDrafts() {
    var wrap = el('<div class="view"></div>');
    wrap.appendChild(el('<div class="eyebrow">eBay listing titles</div>'));
    wrap.appendChild(el('<p class="muted" style="font-size:13px;margin:0 2px 12px">Optimized, ready to paste. Tap Copy to grab a title.</p>'));
    var list = el('<div class="list drafts"></div>');
    state.data.cards.forEach(function (c) {
      var d = el('<div class="draft"><div class="t">' + esc(c.title) + "</div>" +
        '<div class="foot"><span class="len">' + c.title.length + "/80 chars</span>" +
        '<button class="copybtn">Copy</button></div></div>');
      var btn = d.querySelector(".copybtn");
      btn.onclick = function () {
        var done = function () { btn.textContent = "Copied"; btn.classList.add("done"); setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1400); };
        if (navigator.clipboard) navigator.clipboard.writeText(c.title).then(done, done); else done();
      };
      list.appendChild(d);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function viewAbout() {
    var s = state.data.summary;
    var wrap = el('<div class="view about"></div>');
    wrap.appendChild(el('<div class="eyebrow">About</div>'));
    wrap.appendChild(el('<div class="card"><p><b>Card Vault</b> is your personal home base for the card business — every card you own, its estimated value, and its listing status, in one place you can check daily.</p>' +
      '<p class="muted" style="font-size:13px">Data generated ' + esc(state.data.generated) + ' · ' + s.total_cards + ' cards · app ' + APP_VERSION + "</p></div>"));
    wrap.appendChild(el('<div class="eyebrow">What’s next</div>'));
    wrap.appendChild(el('<div class="card"><p>Live pricing, the Buy Radar deal-finder, value search, and one-tap listing arrive once the eBay connection is approved — they’ll show up here as new tabs. This view (your collection + value) works fully offline.</p></div>'));
    return wrap;
  }

  // ---------- modal ----------
  // "Recent eBay comps" — the top matching listings saved by the weekly
  // comp run. Sold comps once eBay grants Marketplace Insights; asking today.
  function compsBox(c) {
    if (!c.comps || !c.comps.items || !c.comps.items.length) return "";
    var sold = c.comps.source === "sold";
    var rows = c.comps.items.map(function (it) {
      var inner = '<span class="ct">' + esc(it.t) + '</span><b class="tnum">' + money0(it.p) + "</b>";
      return it.u ? '<a class="comp" href="' + esc(it.u) + '" target="_blank" rel="noopener">' + inner + "</a>"
                  : '<span class="comp">' + inner + "</span>";
    }).join("");
    return '<div class="compsbox"><div class="lab">' +
      (sold ? "Recent eBay sales" : "On eBay now (asking)") +
      (c.comps.broad ? " · broad match" : "") + "</div>" + rows +
      '<div class="cfoot">as of ' + esc(c.comps.as_of || "") +
      (sold ? " · real sold prices" : " · sold prices unlock with eBay approval") + "</div></div>";
  }

  // How much to trust this card's number, from the comp tier that produced it.
  // Levels come from comps.get_comps' query ladder (see comps.py).
  var MATCH_TRUST = {
    exact:       ["good",  "Matched this exact card"],
    focused:     ["good",  "Matched this card (minus the card number, which sellers rarely list)"],
    focused_raw: ["weak",  "Matched ungraded copies of this card — a graded one is usually worth more"],
    broad:       ["weak",  "No listing of this exact card found — estimated from other cards of this player, so treat it as a ballpark"]
  };
  function trustNote(c) {
    // Entries still only on this phone haven't reached the price yet — the
    // value is set by the rebuild, so say where they are in that journey.
    var local = (c.my_sales_all || []).filter(function (s) { return s.local; }).length;
    if (local) {
      return '<div class="trust weak">⏳ ' + local + " comp" + (local === 1 ? "" : "s") +
        " added on this phone — save below and they set this card’s value in ~2 min</div>";
    }
    // A card-specific note outranks every generic line — including the green
    // "priced off real sold prices" one. It exists for the cases the basis
    // alone cannot describe honestly: PSA's only sale being a LOWER grade than
    // the card we own (CARD-0032), a single 20-month-old comp (CARD-0021), or
    // comps that are near-misses on the parallel (CARD-0018). Gold, not green:
    // the price is anchored to real data but the read is thin.
    if (c.basis_note) {
      return '<div class="trust weak">⚠ ' + esc(c.basis_note) + "</div>";
    }
    // A real sold price the owner recorded beats any asking comp — and since
    // build_web now prices the card off it, say so first.
    var mine = (c.my_sales || []).length;
    if (c.price_basis === "sold" && mine) {
      return '<div class="trust good">✓ Priced off ' + mine + " real sold price" +
        (mine === 1 ? "" : "s") + " you recorded for this card — the best data we have" +
        (mine === 1 ? " (add a couple more and it steadies out)" : "") + "</div>";
    }
    // PSA prices off their own recorded sales for this exact card AND grade —
    // better than anything our asking-comp ladder can reach, so it outranks
    // the match level.
    if (c.price_basis === "psa") {
      var slab = c.graded && c.grader && c.grade
        ? " in a " + esc((c.grader + " " + c.grade).toUpperCase()) + " holder" : "";
      return '<div class="trust good">✓ PSA’s own price for this card' + slab +
        " — from their recorded sales, not our eBay guess</div>";
    }
    var lv = (c.comps && c.comps.level) || "";
    var t = MATCH_TRUST[lv];
    var n = (c.market && c.market.count) || 0;
    if (!t) {
      return num(c.asking_price) > 0
        ? '<div class="trust weak">⚠ No eBay listings captured for this card — the price is hand-set, not measured.</div>' : "";
    }
    var thin = n && n < 5 ? " · only " + n + " listing" + (n === 1 ? "" : "s") + " to go on" : "";
    return '<div class="trust ' + t[0] + '">' + (t[0] === "good" ? "✓ " : "⚠ ") + t[1] + thin + "</div>";
  }

  function ebaySearchUrl(c, soldOnly) {
    return "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(c.title) +
      (soldOnly ? "&LH_Sold=1&LH_Complete=1" : "");
  }

  // Terapeak product research (eBay Seller Hub) pre-searched for this card —
  // REAL sold data, free for sellers. No API exists, so this deep-link + the
  // "My numbers" box IS the integration: look it up, type it in, done.
  // 90-day window, sold tab. Needs the owner's eBay seller login (they have one).
  function terapeakUrl(q) {
    return "https://www.ebay.com/sh/research?marketplace=EBAY-US&tabName=SOLD&dayRange=90&keywords=" +
      encodeURIComponent(q);
  }

  // A ready-to-paste prompt for drafting the eBay listing in Claude chat.
  function listPrompt(c) {
    var d = [c.year, c.brand, c.set, c.player, c.card_number ? "#" + c.card_number : "",
             c.parallel, c.insert, c.graded ? (c.grader + " " + c.grade) : "",
             c.serial_run ? "/" + c.serial_run : "", c.team].filter(Boolean).join(" ");
    return "Help me create and post an eBay listing for this sports card.\n\n" +
      "Card: " + d + "\nSuggested title: " + c.title +
      (num(c.asking_price) > 0 ? "\nMy asking price: " + money0(c.asking_price) : "") +
      "\n\nPlease give me an optimized 80-character title, eBay item specifics, and a short " +
      "description I can paste — then remind me to add photos before publishing.";
  }

  // "What it's going for" box for the modal — the typical asking price, the
  // live range, our estimate, and (when the read is solid) the room up toward
  // typical. Honest about the ASKING-vs-SOLD gap eBay left us with.
  function marketBox(c) {
    var m = goingFor(c), ms = mySold(c);
    var soldRow = ms
      ? '<div class="mkrow up"><span>Real sold — comps you added</span><b class="tnum">~' + money0(ms.median) +
        ' <small>· ' + ms.count + " tracked</small></b></div>"
      : "";
    if (!m) {
      // No comps captured. If the owner has tracked real sales, show those —
      // they're the truest read we have. Otherwise explain the gap (e.g. a
      // niche insert/auto the auto-pricer found zero matches for).
      if (ms) {
        return '<div class="compsbox market"><div class="lab">What it’s going for</div>' + soldRow +
          (num(c.asking_price) > 0
            ? '<div class="mkrow"><span>' + (c.sold ? "Was valued at" : "Card Vault value") +
              '</span><b class="tnum">' + money0(num(c.asking_price)) + "</b></div>" : "") +
          '<div class="cfoot">Real sold prices you recorded in “My numbers” below — what other copies ' +
          "actually sold for, not what you got.</div></div>";
      }
      if (num(c.asking_price) <= 0) return "";
      return '<div class="compsbox nomarket"><div class="lab">What it’s going for</div>' +
        '<div class="addcostrow">No eBay comps captured for this exact card yet — the value here is hand-set.</div>' +
        '<div class="cfoot">Niche inserts/autos often return no match on the weekly auto-price run. ' +
        "Tap “Live listings” / “Sold on eBay” below to check the market yourself — and record what it sold for in “My numbers” below.</div></div>";
    }
    var cur = num(c.asking_price);
    var prices = ((c.comps && c.comps.items) || []).map(function (it) { return num(it.p); })
      .filter(function (p) { return p > 0; });
    var range = prices.length >= 2
      ? money0(Math.min.apply(null, prices)) + "–" + money0(Math.max.apply(null, prices)) : "";
    var basisTxt = c.price_basis === "sold" ? "real eBay sold comps"
      : c.price_basis === "psa" ? "PSA’s own market estimate for this card at this grade"
      : c.price_basis === "est_sold" ? "estimated — typical asking, discounted toward real sold"
      : "active eBay listings";
    var rows =
      soldRow +
      '<div class="mkrow"><span>Usually going for</span><b class="tnum">~' + money0(m.median) +
        (m.count ? ' <small>· ' + m.count + " listed</small>" : "") + "</b></div>" +
      (range ? '<div class="mkrow"><span>Live range now</span><b class="tnum">' + range + "</b></div>" : "") +
      '<div class="mkrow"><span>' + (c.sold ? "Was valued at" : "Card Vault value") +
        '</span><b class="tnum">' + money0(cur) + "</b></div>" +
      (num(c.est_price) > 0 && num(c.est_price) !== cur
        ? '<div class="mkrow"><span>' +
          (c.est_basis === "psa" ? "PSA’s estimate was" : "Our comp estimate was") +
          '</span><b class="tnum">' + money0(num(c.est_price)) + "</b></div>" : "");
    if (!c.sold && marketSolid(c, m)) {
      var pct = Math.round((m.median - cur) / cur * 100);
      rows += '<div class="mkrow up"><span>Room up to typical</span><b class="tnum">+' +
        money0(m.median - cur) + " · " + pct + "%</b></div>";
    } else if (!c.sold && c.price_basis === "psa" && m.median > cur) {
      rows += '<div class="mkrow"><span>Sellers ask above this</span><b class="tnum">+' +
        Math.round((m.median - cur) / cur * 100) + "%</b></div>";
    }
    return '<div class="compsbox market"><div class="lab">What it’s going for</div>' + rows + trustNote(c) +
      '<div class="cfoot">Typical = eBay <b>asking</b> median. ' +
      (c.reviewed_price
        ? "Value uses the reviewed reported-sale median; older recorded comps remain as history."
        : (c.price_basis === "sold" && (c.my_sales || []).length)
        // priced off the owner's own recorded sales — don't nag about eBay
        // approval here, they already have better data than eBay would give us
        ? "This card’s value is your recorded sold prices, not our estimate."
        : c.price_basis === "psa"
        ? "This card’s value comes from the PSA app, not from these asking listings — " +
          "PSA reads real sales, so where the two disagree, trust PSA."
        : "This card’s value: " + basisTxt +
          ". Real sold prices need eBay approval — tap “Sold on eBay” below for actuals.") +
      "</div></div>";
  }

  // ---- The money headline: first thing in the card popup ------------------
  // Owner's ask (2026-07-31): opening a card should lead with what it could
  // sell for right now, what they paid, and the profit — not a spec sheet.
  // Big number + three stats + the price-history sparkline, all above the fold.
  function ownerListingBox(c) {
    var l = c.owner_listing;
    if (!l) return "";
    var paid = l.status === "sold_paid" && c.sold;
    var active = l.status === "listed" && c.listed && !c.sold;
    var label = paid ? "Your eBay sale · buyer paid" : active ? "Your eBay asking price" : "Previous eBay listing";
    var amount = paid ? l.sold_price : l.asking_price;
    var detail = paid ? "Gross sale; fees and shipping still need reconciliation. Payment confirmation is not payout settlement."
      : "Separate from the market estimate. Last confirmed by email " + (l.confirmed_at || "").slice(0,10) + ".";
    var validUrl = /^https:\/\/www\.ebay\.com\/itm\/[0-9]{12}$/.test(l.url || "");
    return '<div class="compsbox"><div class="lab">' + label + '</div>' +
      '<div class="val tnum">' + money(amount) + (active && l.best_offer ? " · Best Offer" : "") + '</div>' +
      '<div class="cfoot">' + esc(detail) + '</div>' +
      (validUrl ? '<a class="mbtn" href="' + esc(l.url) + '" target="_blank" rel="noopener">View eBay listing</a>' : "") + '</div>';
  }

  function moneyHero(c) {
    var pf = profitOf(c), ms = mySold(c);
    var pts = (c.price_series || []).filter(function (p) { return p && typeof p.p === "number"; });

    // SOLD cards report what actually happened instead of an estimate.
    var big, lab, sub;
    if (c.sold) {
      lab = "Sold for";
      big = money(c.sold_price);
      sub = c.sold_date ? "on " + esc(c.sold_date) : "";
    } else {
      lab = "Could sell for now";
      big = num(c.asking_price) > 0 ? money(c.asking_price) : "—";
      sub = num(c.asking_price) > 0
        ? (c.reviewed_price ? "reviewed reported-sale median · medium confidence"
              : ms ? "real sold ~" + money0(ms.median) + " · " + ms.count + " comps you added"
              : c.price_basis === "sold" ? "from real eBay sold comps"
              : c.price_basis === "psa" ? "PSA app estimate · their sold data for this card + grade"
              : c.price_basis === "est_sold" ? "estimated market · typical asking, discounted toward real sold"
              : "from active eBay listings (asking)")
        : "no price yet — the weekly eBay re-price sets this";
    }

    // Three stats: paid / profit / margin. "＋ add" jumps to the entry box.
    var paidCell = pf ? money0(pf.cost)
      : '<button class="mhadd" id="mhAddCost">＋ add</button>';
    var realized = c.sold && pf ? num(c.sold_price) - pf.cost : null;
    var shown = c.sold ? realized : (pf ? pf.profit : null);
    var base = c.sold ? (pf ? pf.cost : 0) : (pf ? pf.cost : 0);
    var profitCell = shown == null ? "—"
      : '<span class="' + (shown >= 0 ? "up" : "down") + '">' + (shown >= 0 ? "+" : "−") +
        money0(Math.abs(shown)) + "</span>";
    var marginCell = (shown == null || !base) ? "—"
      : '<span class="' + (shown >= 0 ? "up" : "down") + '">' + Math.round(shown / base * 100) + "%</span>";

    return '<div class="mhero-money' + (c.sold ? " issold" : "") + '">' +
      '<div class="mhtop">' +
        '<div class="mhbig"><span class="mhlab">' + lab + "</span>" +
          '<span class="mhval tnum">' + big + changeChip(c) + "</span>" +
          (sub ? '<span class="mhsub">' + sub + "</span>" : "") + "</div>" +
        (pts.length >= 2 ? '<div class="mhspark">' + sparkline(pts, 96, 40) +
          '<span class="mhsparklab">' + pts.length + " snapshots</span></div>" : "") +
      "</div>" +
      '<div class="mhstats">' +
        '<div class="mhstat"><span class="k">You paid</span><span class="v tnum">' + paidCell + "</span></div>" +
        '<div class="mhstat"><span class="k">' + (c.sold ? "Profit" : "Est. profit") +
          '</span><span class="v tnum">' + profitCell + "</span></div>" +
        '<div class="mhstat"><span class="k">Margin</span><span class="v tnum">' + marginCell + "</span></div>" +
      "</div>" +
      '<div class="mhfoot">' + (pf ? "Gross — before eBay &amp; shipping fees." :
        "Add what you paid to see profit and margin.") +
        (c.cost_local ? " Saved on this phone." : "") + "</div>" +
    "</div>";
  }

  // Cost & profit box for the modal — the real numbers when a cost is entered,
  // or a labelled prompt (the spot to add it) when it isn't.
  function costProfitBox(c) {
    var pf = profitOf(c);
    if (pf) {
      var cls = pf.profit >= 0 ? "up" : "down";
      return '<div class="compsbox cprofit"><div class="lab">Cost &amp; profit</div>' +
        '<div class="mkrow"><span>You paid</span><b class="tnum">' + money0(pf.cost) + "</b></div>" +
        '<div class="mkrow"><span>Card Vault value</span><b class="tnum">' + money0(pf.est) + "</b></div>" +
        '<div class="mkrow ' + cls + '"><span>Est. profit if sold</span><b class="tnum">' +
          (pf.profit >= 0 ? "+" : "−") + money0(Math.abs(pf.profit)) + " · " + Math.round(pf.margin) + "%</b></div>" +
        '<div class="cfoot">Gross — before eBay &amp; shipping fees.' +
        (c.cost_local ? " Cost saved on this phone — “Send to Claude” below makes it permanent." : "") +
        "</div></div>";
    }
    return '<div class="compsbox addcostbox"><div class="lab">Cost &amp; profit</div>' +
      '<div class="addcostrow">＋ No cost recorded yet — add what you paid to unlock profit for this card.</div>' +
      '<div class="cfoot">Type it in <b>✍️ My numbers</b> right below — it saves instantly.</div></div>';
  }

  // "My numbers" — the owner's own data entry, right in the card popup: what
  // the card cost, and real prices it has sold for (look them up with the
  // “Sold on eBay” button below, or Terapeak in eBay Seller Hub). Saves
  // instantly on this device; "Send to Claude" writes it into the sheet.
  function myNumbersBox(c) {
    var today = new Date().toISOString().slice(0, 10);
    var sheetCost = num(c._csvCost) > 0;
    var sales = c.my_sales_all || [];
    var rows = sales.map(function (s, i) {
      return '<div class="myrow"><span class="tnum">' + money(s.p) + "</span>" +
        '<span class="myd">' + esc(s.d || "") + (s.n ? " · " + esc(s.n) : "") + "</span>" +
        (s.local ? '<button class="mydel" data-i="' + i + '" title="Remove">✕</button>'
                 : '<span class="myok" title="Saved in your sheet">✓ in sheet</span>') +
        "</div>";
    }).join("");
    var pend = pendingCount();
    var mineSold = myData.sold[c.sku];
    return '<div class="compsbox mydata"><div class="lab">✍️ My numbers</div>' +
      '<div class="mdlookup">' +
        '<a class="mbtn sm" href="' + terapeakUrl(c.title) + '" target="_blank" rel="noopener">📊 Terapeak sold data</a>' +
        '<a class="mbtn sm" href="' + ebaySearchUrl(c, true) + '" target="_blank" rel="noopener">✅ eBay sold search</a>' +
      "</div>" +
      '<div class="mdform"><label>What you paid ($)' +
        '<input type="number" inputmode="decimal" min="0" step="0.01" id="myCost" placeholder="e.g. 45" value="' +
        (num(c.cost) > 0 ? esc(num(c.cost)) : "") + '"' + (sheetCost ? " disabled" : "") + "></label>" +
        (sheetCost ? '<span class="myok">✓ in sheet</span>' : '<button class="mbtn sm" id="myCostSave">Save</button>') +
      "</div>" +
      // 1) what OTHERS got — a comp. Sets this card's value; you keep the card.
      '<div class="mysec">📈 Prices you saw <b>other people</b> get' +
        '<span class="myhint">Sets what this card is worth. You still own it.</span></div>' +
      '<div class="mdform"><label>Someone else sold one for ($)' +
        '<input type="number" inputmode="decimal" min="0" step="0.01" id="mySalePrice" placeholder="e.g. 120"></label>' +
        '<label>When<input type="date" id="mySaleDate" value="' + today + '"></label>' +
        '<button class="mbtn sm" id="mySaleAdd">Add comp</button>' +
      "</div>" +
      (rows ? '<div class="mylist">' + rows + "</div>" : "") +
      // 2) YOUR sale — retires the card into revenue.
      ((c.sold && !c.sold_local)
        ? '<div class="mysec sold">✅ You sold this on ' + esc(c.sold_date || "") +
          " for " + money(num(c.sold_price)) +
          '<span class="myhint">It\u2019s out of your collection and counted in revenue.</span></div>'
        : (mineSold
            ? '<div class="mysec sold">✅ Marked sold for ' + money(num(mineSold.p)) +
              (mineSold.d ? " on " + esc(mineSold.d) : "") +
              '<span class="myhint">Already out of your collection on this phone. ' +
              'Save below so every device sees it (~2 min). ' +
              '<a href="#" id="myUnsell">undo</a></span></div>'
            : '<div class="mysec mine">💰 Did <b>you</b> sell this card?' +
              '<span class="myhint">Moves it out of your collection and into revenue.</span></div>' +
              '<div class="mdform"><label>I sold it for ($)' +
                '<input type="number" inputmode="decimal" min="0" step="0.01" id="myMinePrice" placeholder="what you got"></label>' +
                '<label>When<input type="date" id="myMineDate" value="' + today + '"></label>' +
                '<button class="mbtn sm warn" id="myMineAdd">Mark sold</button>' +
              "</div>")) +
      syncSection(pend) +
      '<div class="cfoot">Tap a lookup button above — Terapeak (in your eBay Seller Hub, free) shows real ' +
      "sold prices — then type what you see. Everything saves on this phone instantly" +
      (ghToken() ? "; “Save to my sheet” backs it up to every device." : "; sending backs it up to every device.") +
      " A sold price you record becomes this card’s value on the next rebuild (~2 min after saving)." +
      "</div></div>";
  }

  // The backup row of the My-numbers box. With one-tap save ON: a direct
  // 💾 save button. Without: the Send-to-Claude button + a setup link that
  // reveals the paste-your-GitHub-key form.
  function syncSection(pend) {
    var n = pend === 1 ? "1 entry" : pend + " entries";
    if (ghToken()) {
      // everything on this phone is already in the sheet (it just hasn't been
      // baked into data.json yet, which takes the site a couple of minutes)
      var saved = pend > 0 && myData.synced && myData.synced >= (myData.touched || 0);
      return (saved
        ? '<div class="mdsync mdsaved">✓ Saved to your sheet · every device picks it up in ~2 min' +
          ' · <a href="#" id="myGhAgain">save again</a></div>'
        : (pend ? '<div class="mdsync"><button class="mbtn prime" id="myGhSave">💾 Save ' + n +
                  " to my sheet</button></div>" : "")) +
        '<div class="mdsetup"><a href="#" id="ghTokenDrop">⚙️ One-tap save is on · turn off</a></div>';
    }
    return (pend ? '<div class="mdsync"><button class="mbtn" id="mySync">📤 Send ' + n +
                   " to Claude → saves to your sheet</button></div>" : "") +
      '<div class="mdsetup"><a href="#" id="mdSetup">⚙️ Set up one-tap save (skip the Claude step)</a></div>' +
      '<div class="mdtoken" id="mdTokenForm" hidden><label>GitHub key' +
        '<input type="password" id="ghTokenInput" placeholder="github_pat_…" autocomplete="off"></label>' +
        '<button class="mbtn sm" id="ghTokenSave">Turn on</button>' +
        '<div class="cfoot">One-time setup — ask Claude for the 2-minute walkthrough. ' +
        "The key stays on this phone only (never in the sheet or the app).</div></div>";
  }

  function wireMyNumbers(m, c) {
    // A number typed into a box but never "Save"d/"Add"ed is invisible to the
    // sync — fold anything sitting in the boxes in first, so tapping save
    // means what the owner thinks it means.
    function flushTyped() {
      var costEl = m.querySelector("#myCost");
      if (costEl && !costEl.disabled) {
        var cv = num(costEl.value);
        if (cv > 0 && cv !== num(myData.costs[c.sku])) {
          myData.costs[c.sku] = Math.round(cv * 100) / 100;
          touchMyData();
        }
      }
      var mineEl = m.querySelector("#myMinePrice");
      var mv = mineEl ? num(mineEl.value) : 0;
      if (mv > 0) {
        var mdEl = m.querySelector("#myMineDate");
        myData.sold[c.sku] = { d: (mdEl && mdEl.value) || "", p: Math.round(mv * 100) / 100 };
        touchMyData();
      }
      var priceEl = m.querySelector("#mySalePrice");
      var pv = priceEl ? num(priceEl.value) : 0;
      if (pv > 0) {
        var dateEl = m.querySelector("#mySaleDate");
        var d = (dateEl && dateEl.value) || "";
        var p = Math.round(pv * 100) / 100;
        var have = (myData.sales[c.sku] = myData.sales[c.sku] || []);
        var dup = have.some(function (x) { return (x.d || "") === d && num(x.p) === p; });
        if (!dup) { have.push({ d: d, p: p }); touchMyData(); }
        priceEl.value = "";
      }
      recalcMyData();
    }
    // leaving the cost box also banks it — no lost typing if Save is missed
    var costBox = m.querySelector("#myCost");
    if (costBox && !costBox.disabled) costBox.onchange = flushTyped;
    // the money headline's "＋ add" jumps down to the cost field and focuses it
    var mhAdd = m.querySelector("#mhAddCost");
    if (mhAdd) mhAdd.onclick = function () {
      var input = m.querySelector("#myCost");
      if (!input) return;
      input.scrollIntoView({ block: "center" });
      input.focus();
    };
    var costSave = m.querySelector("#myCostSave");
    if (costSave) costSave.onclick = function () {
      var v = num(m.querySelector("#myCost").value);
      if (v > 0) myData.costs[c.sku] = Math.round(v * 100) / 100;
      else delete myData.costs[c.sku];
      touchMyData();
      refreshAfterMyData(c);
    };
    // "I sold it" — retires the card. Confirm, because it changes what the
    // collection is, not just what a number says.
    var mineAdd = m.querySelector("#myMineAdd");
    if (mineAdd) mineAdd.onclick = function () {
      var p = num(m.querySelector("#myMinePrice").value);
      if (p <= 0) { flashBtn(mineAdd, "How much?"); return; }
      if (!window.confirm("Mark this as SOLD for " + money(p) +
          "?\n\nIt leaves your collection value and moves into revenue.")) return;
      myData.sold[c.sku] = { d: m.querySelector("#myMineDate").value || "",
                             p: Math.round(p * 100) / 100 };
      touchMyData();
      refreshAfterMyData(c);
    };
    var unsell = m.querySelector("#myUnsell");
    if (unsell) unsell.onclick = function (e) {
      e.preventDefault();
      delete myData.sold[c.sku];
      touchMyData();
      refreshAfterMyData(c);
    };
    var add = m.querySelector("#mySaleAdd");
    if (add) add.onclick = function () {
      var p = num(m.querySelector("#mySalePrice").value);
      if (p <= 0) { flashBtn(add, "Price?"); return; }
      (myData.sales[c.sku] = myData.sales[c.sku] || []).push({
        d: m.querySelector("#mySaleDate").value || "", p: Math.round(p * 100) / 100 });
      touchMyData();
      refreshAfterMyData(c);
    };
    m.querySelectorAll(".mydel").forEach(function (b) {
      b.onclick = function () {
        var s = (c.my_sales_all || [])[Number(b.getAttribute("data-i"))];
        if (!s) return;
        var arr = (myData.sales[c.sku] || []).filter(function (x) {
          return !((x.d || "") === (s.d || "") && x.p === s.p);
        });
        if (arr.length) myData.sales[c.sku] = arr; else delete myData.sales[c.sku];
        touchMyData();
        refreshAfterMyData(c);
      };
    });
    var sync = m.querySelector("#mySync");
    if (sync) sync.onclick = function () {
      flushTyped();
      var q = syncMessage();
      copyText(q);
      window.open("https://claude.ai/new?q=" + encodeURIComponent(q), "_blank", "noopener");
      flashBtn(sync, "✓ Copied — paste in Claude if it’s not pre-filled");
    };
    // one-tap GitHub save + its setup form
    var ghBtn = m.querySelector("#myGhSave");
    if (ghBtn) ghBtn.onclick = function () {
      var label = ghBtn.innerHTML;   // grab the REAL label before overwriting it
      flushTyped();
      ghBtn.disabled = true;
      ghBtn.textContent = "Saving…";
      ghSaveMyNumbers(function (err) {
        ghBtn.disabled = false;
        ghBtn.innerHTML = label;     // never leave it stuck reading "Saving…"
        if (err) flashBtn(ghBtn, "⚠ Couldn’t save — check the key, or ask Claude");
        else refreshAfterMyData(c);  // repaints the box as "✓ Saved to your sheet"
      });
    };
    var ghAgain = m.querySelector("#myGhAgain");
    if (ghAgain) ghAgain.onclick = function (e) {
      e.preventDefault();
      flushTyped();
      touchMyData();
      refreshAfterMyData(c);
    };
    var setup = m.querySelector("#mdSetup");
    if (setup) setup.onclick = function (e) {
      e.preventDefault();
      var f = m.querySelector("#mdTokenForm");
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector("input").focus();
    };
    var tokSave = m.querySelector("#ghTokenSave");
    if (tokSave) tokSave.onclick = function () {
      var v = (m.querySelector("#ghTokenInput").value || "").trim();
      if (!v) { flashBtn(tokSave, "Paste it first"); return; }
      try { localStorage.setItem(GHTOKEN_KEY, v); } catch (e) {}
      refreshAfterMyData(c);
    };
    var tokDrop = m.querySelector("#ghTokenDrop");
    if (tokDrop) tokDrop.onclick = function (e) {
      e.preventDefault();
      try { localStorage.removeItem(GHTOKEN_KEY); } catch (err) {}
      refreshAfterMyData(c);
    };
  }

  // after any My-numbers edit: re-merge, repaint the view behind the popup
  // (profit tiles, Sales Map chips), and repaint the popup itself.
  function refreshAfterMyData(c) {
    recalcMyData();
    render();
    openModal(c);
  }

  // Per-card price-over-time box for the modal — a sparkline of the SKU's
  // re-price snapshots, with first→latest change. Hidden until 2+ snapshots.
  function priceHistoryBox(c) {
    var pts = (c.price_series || []).filter(function (p) { return p && typeof p.p === "number"; });
    if (pts.length < 2) return "";
    var first = pts[0].p, last = pts[pts.length - 1].p;
    var pct = first ? (last - first) / first * 100 : 0;
    var up = last >= first;
    // A ▼71% here would be a lie on any card we re-based: the line moved
    // because we corrected the price, not because the card lost value. Where
    // the series spans a correction, show the range without a change chip.
    var corr = null;
    pts.forEach(function (p, i) { if (p.c && i > 0) corr = p; });
    var chg = corr ? '<span class="muted">re-priced</span>'
      : (Math.abs(pct) < 0.5) ? '<span class="muted">flat</span>'
      : '<span class="chg ' + (up ? "up" : "down") + '">' + (up ? "▲" : "▼") + Math.abs(pct).toFixed(pct >= 10 ? 0 : 1) + "%</span>";
    var foot = corr
      ? esc(pts[0].d) + " → " + esc(pts[pts.length - 1].d) + " · the step on " + esc(corr.d) +
        " is a <b>re-pricing onto better data</b>, not a market move"
      : esc(pts[0].d) + " → " + esc(pts[pts.length - 1].d) + " · from weekly eBay re-price";
    return '<div class="compsbox phist"><div class="lab">Price history · ' + pts.length + " snapshots</div>" +
      '<div class="phrow">' + sparkline(pts, 200, 44) +
      '<div class="phmeta"><span class="tnum">' + money0(first) + " → " + money0(last) + "</span>" + chg + "</div></div>" +
      '<div class="cfoot">' + foot + "</div></div>";
  }

  function openModal(c) {
    modalFocus=document.activeElement;
    var m = document.getElementById("modal");
    m.className="modal card-detail-modal";m.removeAttribute("aria-labelledby");m.setAttribute("aria-label",c.player+" card details");
    var rows = [
      ["Item type", c.is_merch ? c.item_type : ""],
      ["Player", c.player], ["Year", c.year], ["Brand", c.brand], ["Set", c.set],
      ["Card #", c.card_number], ["Parallel", c.parallel], ["Insert", c.insert],
      ["Team", c.team], ["Grade", c.graded ? (c.grader + " " + c.grade) : ""],
      ["Authentication", c.is_merch ? c.authentication : ""],
      ["Condition", c.graded ? "" : c.condition], ["Serial", c.serial_run ? "/" + c.serial_run : ""],
      ["Sport", c.sport], ["SKU", c.sku],
      ["Notes", c.notes]
    ].filter(function (r) { return r[1]; });
    var kv = rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
    m.innerHTML =
      '<button class="close" id="mClose">✕</button>' +
      '<div class="mgrid">' +
        '<div class="mhero">' + thumb(c, "big") + "</div>" +
        '<div class="mbody">' +
          "<h3>" + esc(c.player) + badges(c) + basisPill(c) + "</h3>" +
          '<div class="muted" style="font-size:13px">' + esc(c.line || "") + "</div>" +
          // MONEY FIRST — what it's worth, what you paid, profit, history.
          moneyHero(c) +
          ownerListingBox(c) +
          (!c.sold ? '<button class="button full-width" id="cardSellPlan">Open selling plan →</button>' : "") +
          marketBox(c) +
          priceHistoryBox(c) +
          myNumbersBox(c) +
          compsBox(c) +
          '<div class="listbar"><div class="lblab">🏷️ List this card</div>' +
            '<div class="lbbtns">' +
              '<button class="mbtn prime" id="mListEbay">List on eBay</button>' +
              '<button class="mbtn" id="mListClaude">✨ Draft in Claude</button>' +
            "</div>" +
            '<div class="lbfoot">eBay opens the sell page (title copied to paste). Claude opens a chat to draft the title, specifics &amp; description.</div>' +
          "</div>" +
          '<div class="mbtns">' +
            '<a class="mbtn" href="' + ebaySearchUrl(c, false) + '" target="_blank" rel="noopener">🛒 Live listings</a>' +
            '<a class="mbtn" href="' + ebaySearchUrl(c, true) + '" target="_blank" rel="noopener">✅ Sold on eBay</a>' +
            '<button class="mbtn" id="mShare">🔗 Share card</button>' +
            (c.cert && /psa/i.test(c.grader || "") ?
              '<a class="mbtn" href="https://www.psacard.com/cert/' + esc(c.cert) +
              '" target="_blank" rel="noopener">🔍 PSA cert ' + esc(c.cert) + "</a>" : "") +
          "</div>" +
          // Card details last, folded away — the owner knows their own cards.
          '<details class="cardspecs"><summary>Card details &amp; eBay title</summary>' +
            '<dl class="kv">' + kv + "</dl>" +
            '<div class="titlebox"><div class="lab">eBay title</div><div class="val">' + esc(c.title) + "</div></div>" +
          "</details>" +
        "</div>" +
      "</div>";
    m.querySelector("#mClose").onclick = closeModal;
    wireMyNumbers(m, c);
    var sellPlanButton=m.querySelector("#cardSellPlan");if(sellPlanButton)sellPlanButton.onclick=function(){openSellPlan(c);};
    // quick-list widget: eBay sell page (title on clipboard) or draft in Claude
    var listEbay = m.querySelector("#mListEbay");
    listEbay.onclick = function () {
      copyText(c.title);
      window.open("https://www.ebay.com/sl/sell", "_blank", "noopener");
      flashBtn(listEbay, "✓ Title copied — paste on eBay");
    };
    var listClaude = m.querySelector("#mListClaude");
    listClaude.onclick = function () {
      var q = listPrompt(c);
      copyText(q);
      window.open("https://claude.ai/new?q=" + encodeURIComponent(q), "_blank", "noopener");
      flashBtn(listClaude, "✓ Prompt copied — paste in Claude");
    };
    var share = m.querySelector("#mShare");
    share.onclick = function () {
      var url = location.href.split("#")[0] + "#sku=" + encodeURIComponent(c.sku);
      var done = function () { share.textContent = "✓ Link copied"; setTimeout(function () { share.innerHTML = "🔗 Share card"; }, 1600); };
      if (navigator.share) navigator.share({ title: c.title, url: url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done);
      else done();
    };
    // deep-linkable: #sku=CARD-0022 reopens this exact card
    if (history.replaceState) history.replaceState(null, "", "#sku=" + encodeURIComponent(c.sku));
    document.getElementById("modalWrap").classList.add("open");
    document.body.classList.add("sheet-open");m.querySelector("#mClose").focus();
  }
  function closeModal() {
    document.getElementById("modalWrap").classList.remove("open");
    document.body.classList.remove("sheet-open");
    if(modalFocus && document.contains(modalFocus))modalFocus.focus();
    if (history.replaceState) history.replaceState(null, "", "#tab="+state.tab);
  }
  function openFromHash() {
    var m = location.hash.match(/^#sku=(.+)$/);
    if (!m || !state.data) return;
    var sku;try{sku=decodeURIComponent(m[1]);}catch(e){return;}
    var card = state.data.cards.filter(function (c) { return c.sku === sku; })[0];
    if (card) openModal(card);
  }

  // ---------- theme ----------
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  }
  function syncThemeIcon() {
    var b = document.getElementById("themebtn");
    if (b) b.innerHTML = icon("sun");
  }
  function toggleTheme() {
    var next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("cv-theme", next); } catch (e) {}
    syncThemeIcon();
  }

  // ---------- boot ----------
  // A shipped fix is worthless if the phone keeps serving the old build. The
  // service worker is network-first for data.json, so even a stale shell gets
  // the fresh file — and the version baked into it tells us the running app.js
  // is behind. One tap then clears every cache, drops the old service worker
  // and reloads, which is the thing that actually works on an installed iOS
  // PWA (a plain reload often doesn't).
  function updateBanner(want) {
    var bar = el('<div class="updbar" role="button" tabindex="0">' +
      "🔄 Update ready (" + esc(want) + ") — tap to load it" +
      '<span class="updsub">You’re on ' + APP_VERSION + "</span></div>");
    function go() {
      bar.textContent = "Updating…";
      var jobs = [];
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (ks) {
          return Promise.all(ks.map(function (k) { return caches.delete(k); }));
        }));
      }
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        }));
      }
      Promise.all(jobs).catch(function () {}).then(function () {
        location.replace(location.pathname + "?u=" + Date.now() + location.hash);
      });
    }
    bar.onclick = go;
    bar.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") go(); };
    document.body.appendChild(bar);
    // Sit clear of the tab bar, whose height varies (it wraps to two rows on
    // narrow phones and becomes a side rail on desktop) — measure, don't guess.
    function place() {
      var nav = document.querySelector(".nav");
      // offsetHeight already includes the nav's safe-area padding — adding
      // env() again would float the bar a home-indicator's height too high.
      var h = nav && window.innerWidth < 1000 ? nav.offsetHeight : 0;
      bar.style.bottom = (h + 12) + "px";
    }
    place();
    window.addEventListener("resize", place);
  }

  function checkVersion(shipped) {
    if (shipped && shipped !== APP_VERSION && !document.querySelector(".updbar")) {
      updateBanner(shipped);
    }
  }

  // The tab bar's height isn't knowable from CSS: 7 tabs in a 4-wide grid wrap
  // to two rows on a phone, one row on a wide screen, and it carries the home
  // indicator inset. Publish the real height so the page can reserve exactly
  // that much room underneath.
  function measureNav() {
    var nav = document.querySelector(".nav");
    if (!nav) return;
    var pos = getComputedStyle(nav).position;
    var overlaysBottom = pos === "sticky" || (pos === "fixed" && window.innerWidth < 1000);   // fixed = the desktop side rail
    document.documentElement.style.setProperty("--navh", (overlaysBottom ? nav.offsetHeight : 0) + "px");
  }

  function boot(data) {
    state.data = data;
    recalcMyData();               // merge this device's costs + sold entries
    shell();
    var held = data.cards.filter(function (c) { return !c.sold; }).length;
    document.getElementById("gen").textContent = held + " cards · " + money0(data.summary.total_value);
    var initialHash=location.hash;
    try{var prefs=JSON.parse(localStorage.getItem("cv-view-v60")||"{}");["sort","inventoryLayout","inventoryStatus","inventorySport","inventoryType"].forEach(function(k){if(typeof prefs[k]==="string")state[k]=prefs[k];});}catch(e){}
    var wanted=initialHash.match(/^#tab=(today|sell|collection|radar|value|about)$/);
    setTab(wanted?wanted[1]:"today");
    if(initialHash.indexOf("#sku=")===0&&history.replaceState)history.replaceState(null,"",initialHash);
    measureNav();
    window.addEventListener("resize", measureNav);
    window.addEventListener("orientationchange", measureNav);
    openFromHash();               // shared link straight to a card
    window.addEventListener("hashchange", function(){var t=location.hash.match(/^#tab=(today|sell|collection|radar|value|about)$/);if(t)setTab(t[1]);else openFromHash();});
    checkVersion(data.app_version);
    // A phone app is resumed far more often than cold-started, and a ship that
    // lands while it sits in the background would otherwise go unnoticed until
    // the next full launch. Re-check whenever it comes back to the foreground.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden || document.querySelector(".updbar")) return;
      fetch("./data.json?v=" + Date.now())
        .then(function (r) { return r.json(); })
        .then(function (d) { checkVersion(d && d.app_version); })
        .catch(function () {});
    });
  }

  try { var t = localStorage.getItem("cv-theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch (e) {}

  if (window.__CARD_DATA__) {
    boot(window.__CARD_DATA__);
  } else {
    fetch("./data.json?v=" + Date.now()).then(function (r) { return r.json(); }).then(boot).catch(function () {
      document.body.innerHTML = '<main style="padding:40px;text-align:center;color:#94a08b">Could not load your collection data. Run <b>python3 build_web.py</b> and reload.</main>';
    });
  }

  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("./sw.js").catch(function () {}); });
  }
})();


