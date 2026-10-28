/* Card Vault selling planner. Pure, offline calculations; never changes inventory. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CardVaultSelling = factory();
}(typeof window === "undefined" ? this : window, function () {
  "use strict";
  function amount(v) {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    var n = Number(String(v).replace(/[$,]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function yes(v) { return v === true || /^(yes|true|1)$/i.test(String(v)); }
  function held(c) { return !yes(c.sold); }
  function listed(c) { return held(c) && (yes(c.listed) || (c.owner_listing || {}).status === "listed"); }
  function reference(c) { return amount(c.asking_price); }
  function cost(c) { return amount(c.cost); }
  function day(s) {
    var m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return new Date(t).toISOString().slice(0, 10) === m[0].slice(0, 10) ? t : null;
  }
  function today() { return new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date()); }
  function formatDate(value, now) {
    if (!value) return "Date unknown";
    var s=String(value).replace(" · "," ");
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += "T12:00:00Z";
    var date=new Date(s);
    if (isNaN(date)) return "Date unknown";
    var opts={month:"short",day:"numeric",timeZone:"America/New_York"};
    if(date.getUTCFullYear()!==Number((now || today()).slice(0,4)))opts.year="numeric";
    return date.toLocaleDateString("en-US",opts);
  }
  function daysSince(s, now) {
    var d = day(s), t = day(now || today());
    return d === null || t === null || d > t ? null : Math.floor((t - d) / 86400000);
  }
  function protectedCard(c, limit, includeSpecial) {
    return !!c.is_merch || (!includeSpecial && (yes(c.graded) || yes(c.auto) || !!c.serial_run)) || (cost(c) !== null && cost(c) > limit) || (reference(c) || 0) > limit;
  }
  function batchEligible(c, limit, includeSpecial, plan) {
    limit = amount(limit) || 25;
    return !(plan && (plan.action === "hold" || plan.action === "list" || amount(plan.target) > 0 || plan.reviewDate)) && held(c) && !listed(c) && !protectedCard(c, limit, includeSpecial) && reference(c) !== null && reference(c) > 0;
  }
  function groups(cards, limit, includeSpecial, plans) {
    var by = {};
    cards.filter(function (c) { return batchEligible(c, limit, includeSpecial, (plans || {})[c.sku]); }).forEach(function (c) {
      var key = [c.sport || "Mixed sport", c.brand, c.set].filter(Boolean).join(" · ");
      (by[key] = by[key] || []).push(c);
    });
    return Object.keys(by).map(function (label) {
      var rows = by[label].slice().sort(function (a, b) { return String(a.player).localeCompare(String(b.player)) || String(a.sku).localeCompare(String(b.sku)); });
      return { label: label, cards: rows, value: round(rows.reduce(function (n, c) { return n + reference(c); }, 0)) };
    }).sort(function (a, b) { return b.cards.length - a.cards.length || b.value - a.value || a.label.localeCompare(b.label); });
  }
  function soldEvidence(c, now) {
    var seen = {}, minYear = Number(c.year) || 1900;
    var rows = (c.my_sales_all || c.my_sales || []).filter(function (s) {
      var age = daysSince(s.d, now), p = amount(s.p), key = s.d + "|" + p;
      if (age === null || age > 90 || p === null || p <= 0 || Number(String(s.d).slice(0,4)) < minYear || seen[key]) return false;
      seen[key] = true; return true;
    }).sort(function (a,b) { return String(b.d).localeCompare(String(a.d)); });
    return {count:rows.length, newest:rows.length ? rows[0].d : null, fresh:rows.length >= 3 && daysSince(rows[0].d, now) <= 30};
  }
  function listingAge(c, now) {
    var o = c.owner_listing || {}, events = (o.events || []).filter(function (e) { return e.type === "listed"; });
    events.sort(function (a,b) { return String(a.occurred_at).localeCompare(String(b.occurred_at)); });
    return events.length ? daysSince(events[0].occurred_at, now) : null;
  }
  function planFor(c, saved, now) {
    var p = saved || {}, ref = reference(c), evidence = soldEvidence(c, now), age = listingAge(c, now);
    var due = p.reviewDate && daysSince(p.reviewDate, now) !== null;
    var target = amount(p.target), met = target !== null && target > 0 && ref !== null && ref >= target;
    if (!held(c)) return {key:"sold", label:"Sold", tone:"muted", reason:"Recorded in your results.", score:-1};
    if (due) return {key:"due",label:"Review due",tone:"amber",reason:"Your planned review date has arrived.",score:1000+(ref || 0),evidence:evidence,age:age};
    if (met) return {key:"target",label:"Check your target",tone:"green",reason:"The saved reference meets your target. Verify exact sold comps before acting.",score:800+(ref || 0),evidence:evidence,age:age};
    if (p.action === "hold") return {key:"hold",label:"Holding for your price",tone:"muted",reason:p.reviewDate ? "Next review " + p.reviewDate + "." : "Set a review date to keep this on your radar.",score:100+(ref || 0),evidence:evidence,age:age};
    if (listed(c)) return {key:"listed",label:age !== null && age >= 30 ? "Listing review" : "Listed · monitor",tone:age !== null && age >= 30 ? "amber" : "muted",reason:age !== null ? "Listed " + age + " day" + (age === 1 ? "" : "s") + ". Check demand before changing price." : "Listing age unknown. Confirm its current status.",score:500+(ref || 0),evidence:evidence,age:age};
    if (p.action === "list") return {key:"list",label:"Prepare your listing",tone:"green",reason:"You marked this for listing. Verify price, condition and photos.",score:700+(ref || 0),evidence:evidence,age:age};
    return {key:"research",label:evidence.fresh ? "Review sold evidence" : "Refresh sold comps",tone:"amber",reason:evidence.fresh ? "Recent recorded sales are available. Confirm the exact card and grade." : "A fresh exact-match sale check is needed before choosing a price.",score:300+(ref || 0),evidence:evidence,age:age};
  }
  function premium(cards, plans, limit, now, includeSpecial) {
    return cards.filter(function(c) { return held(c) && !batchEligible(c,limit,includeSpecial,(plans || {})[c.sku]); }).map(function(c) {
      return {card:c,plan:planFor(c,(plans || {})[c.sku],now)};
    }).sort(function(a,b) { var rank=function(x){return {due:0,target:1,list:2,research:4,hold:6}[x.key] ?? (x.age !== null && x.age >= 30 ? 3 : 5);};return rank(a.plan)-rank(b.plan) || (reference(b.card)||0)-(reference(a.card)||0) || String(a.card.sku).localeCompare(String(b.card.sku)); });
  }
  function lotQuote(cards, input) {
    input = input || {};
    var price = amount(input.price), shipping = amount(input.shipping), supplies = amount(input.supplies), rate = amount(input.feeRate), fixed = amount(input.orderFee), promo = amount(input.promotion), tax = amount(input.buyerTax);
    var knownCosts = cards.filter(function(c) { return cost(c) !== null; });
    var totalCost = round(knownCosts.reduce(function(n,c) { return n + cost(c); }, 0));
    var out = {count:cards.length, costCount:knownCosts.length, knownCost:totalCost, reference:round(cards.reduce(function(n,c) { return n + (reference(c) || 0); },0)), fees:null, proceeds:null, profit:null};
    if (price === null || price <= 0 || [shipping,supplies,rate,fixed,promo,tax].some(function(v) { return v === null; }) || rate >= 100 || promo >= 100 || tax >= 100) return out;
    // Planning model: free buyer shipping, buyer tax allowance in fee basis.
    var base = price * (1 + tax / 100), threshold = amount(input.feeThreshold) || 7500, above = amount(input.feeRateAbove);
    if (above === null) above = rate;
    var fee = Math.min(base,threshold) * rate / 100 + Math.max(0,base-threshold) * above / 100 + fixed;
    out.fees = round(fee + price * promo / 100);
    out.proceeds = round(price - out.fees - shipping - supplies);
    if (cards.length && knownCosts.length === cards.length) out.profit = round(out.proceeds - totalCost);
    return out;
  }
  function lotTitle(cards) {
    var sports = Array.from(new Set(cards.map(function(c) { return c.sport; }).filter(Boolean)));
    var sets = Array.from(new Set(cards.map(function(c) { return c.set; }).filter(Boolean)));
    var title=cards.length + " " + (sports.length === 1 ? sports[0] + " " : "") + "Trading Card Lot" + (sets.length === 1 ? " - " + sets[0] : "");
    if(title.length>55) title=cards.length+" Trading Card Lot";
    var names=Array.from(new Set(cards.slice().sort(function(a,b){return (reference(b)||0)-(reference(a)||0);}).map(function(c){return c.player;}))),added=0;
    names.forEach(function(name){var next=title+(added?" ":" - ")+name;if(next.length<=80){title=next;added++;}});
    return title;
  }
  function lotDescription(cards) {
    return "Lot of " + cards.length + " trading cards.\n\nINCLUDED CARDS\n" + cards.map(function(c,i) { return (i+1) + ". " + c.player + " — " + (c.line || [c.year,c.brand,c.set,c.card_number].filter(Boolean).join(" ")) + (c.graded ? " · " + c.grader + " " + c.grade : ""); }).join("\n") + "\n\nPlease review the photos for the condition of each card. You will receive the exact cards pictured.\n\nSELLER CHECKLIST (remove before publishing)\nPhotograph every included card, front and back. Verify identity and condition. Confirm package weight, shipping, price and return settings. Remove any already-listed or sold card from this lot.";
  }
  function results(cards) {
    var sold=cards.filter(function(c) { return !held(c); }), known=sold.filter(function(c) { return cost(c) !== null; });
    return {held:cards.filter(held).length, listed:cards.filter(listed).length, sold:sold.length, revenue:round(sold.reduce(function(n,c) { return n + (amount(c.sold_price) || 0); },0)), gross:known.length === sold.length && sold.length ? round(known.reduce(function(n,c) { return n + (amount(c.sold_price) || 0) - cost(c); },0)) : null, knownSoldCosts:known.length, heldCostCount:cards.filter(function(c) { return held(c) && cost(c) !== null; }).length, knownCapital:round(cards.filter(held).reduce(function(n,c) { return n + (cost(c) || 0); },0)), net:sold.length && sold.every(function(c) { return typeof (c.owner_listing || {}).net_profit === "number" && Number.isFinite(c.owner_listing.net_profit); }) ? round(sold.reduce(function(n,c) { return n+c.owner_listing.net_profit; },0)) : null};
  }
  return {amount:amount,round:round,held:held,listed:listed,reference:reference,cost:cost,today:today,formatDate:formatDate,daysSince:daysSince,protectedCard:protectedCard,batchEligible:batchEligible,groups:groups,soldEvidence:soldEvidence,listingAge:listingAge,planFor:planFor,premium:premium,lotQuote:lotQuote,lotTitle:lotTitle,lotDescription:lotDescription,results:results};
}));
