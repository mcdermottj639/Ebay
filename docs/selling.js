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
    return !(plan && (plan.action === "hold" || plan.action === "list" || amount(plan.target) > 0 || plan.reviewDate || plan.offer)) && held(c) && !listed(c) && !protectedCard(c, limit, includeSpecial) && reference(c) !== null && reference(c) > 0;
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
  // Every valid recorded sale (newest first), flagged recent when it is inside
  // the same 90-day window soldEvidence counts. Older valid sales are kept for
  // context in charts but never counted as current evidence.
  function soldRows(c, now) {
    var seen = {}, minYear = Number(c.year) || 1900;
    return (c.my_sales_all || c.my_sales || []).map(function (s) {
      var age = daysSince(s.d, now), p = amount(s.p), key = s.d + "|" + p;
      if (age === null || p === null || p <= 0 || Number(String(s.d).slice(0,4)) < minYear || seen[key]) return null;
      seen[key] = true; return {d:s.d, p:p, age:age, recent:age <= 90};
    }).filter(Boolean).sort(function (a,b) { return String(b.d).localeCompare(String(a.d)); });
  }
  function soldEvidence(c, now) {
    var rows = soldRows(c, now).filter(function (s) { return s.recent; });
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
    if (p.offer) {
      var deadline = offerDeadline(p.offer, now);
      return {key:"offer",label:deadline.key === "expired" ? "Offer deadline passed" : "Review private offer",tone:"amber",reason:deadline.label + ". Confirm the live offer before deciding; this plan takes no marketplace action.",score:1200+(ref || 0),evidence:evidence,age:age,deadline:deadline};
    }
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
    }).sort(function(a,b) { var rank=function(x){return {offer:-1,due:0,target:1,list:2,research:4,hold:6}[x.key] ?? (x.age !== null && x.age >= 30 ? 3 : 5);};return rank(a.plan)-rank(b.plan) || (reference(b.card)||0)-(reference(a.card)||0) || String(a.card.sku).localeCompare(String(b.card.sku)); });
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
  // Private, device-only planning data. These helpers never write inventory,
  // fetch email, or perform marketplace actions. Exchange is an explicit review
  // format, separate from the comparison_only pricing research feed.
  var OFFER_FIELDS = ["amount","acquisitionCost","currency","receivedAt","expiresAt","expiryNote","counterAmount","minimumNet","recommendation","rationale","basisNote","assumptions"];
  var OFFER_ASSUMPTIONS = ["shipping","supplies","feeRate","orderFee","promotion","buyerTax","feeThreshold","feeRateAbove"];
  function plainObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error(label + " must be an object.");
  }
  function allowedFields(value, fields, label) {
    plainObject(value, label);
    Object.keys(value).forEach(function (key) { if (fields.indexOf(key) < 0) throw new Error(label + " contains an unsupported field: " + key + "."); });
  }
  function offerNumber(value, label, positive) {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
    if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) throw new Error(label + " must be a nonnegative number or blank.");
    var n = Number(value);
    if (!Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER / 100 || n < 0 || (positive && n === 0)) throw new Error(label + " must be " + (positive ? "positive" : "nonnegative") + " and finite.");
    return n;
  }
  function offerText(value, label, limit) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string" || value.length > limit) throw new Error(label + " must be text of at most " + limit + " characters.");
    return value.trim();
  }
  function instant(value) {
    // A wall-clock time without its offset must remain an unconfirmed note.
    var m = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/);
    if (!m || m[8] === "-00:00") return null;
    var offset = m[8] === "Z" ? 0 : (m[8][0] === "-" ? -1 : 1) * (Number(m[8].slice(1,3)) * 60 + Number(m[8].slice(4,6)));
    if (+m[4] > 23 || +m[5] > 59 || +(m[6] || 0) > 59 || (m[8] !== "Z" && (+m[8].slice(1,3) > 14 || +m[8].slice(4,6) > 59 || (Math.abs(offset) > 840)))) return null;
    var timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return null;
    var wall = new Date(timestamp + offset * 60000);
    if (wall.getUTCFullYear() !== +m[1] || wall.getUTCMonth() + 1 !== +m[2] || wall.getUTCDate() !== +m[3]) return null;
    return timestamp;
  }
  function offerTime(value, label) {
    var text = offerText(value, label, 40);
    if (text && instant(text) === null) throw new Error(label + " needs a valid date and explicit UTC offset (for example 2030-01-15T18:00:00-05:00). Leave it blank if the timezone is unconfirmed.");
    return text;
  }
  function normalizeOffer(input) {
    allowedFields(input, OFFER_FIELDS, "Offer");
    var currency = input.currency === undefined ? "USD" : input.currency;
    if (currency !== "USD") throw new Error("Only USD offer plans are supported.");
    var recommendation = input.recommendation === undefined ? "review" : input.recommendation;
    if (["review","accept","counter","hold"].indexOf(recommendation) < 0) throw new Error("Choose review, accept, counter or hold as the recommendation.");
    var assumptions = input.assumptions === undefined || input.assumptions === null ? {} : input.assumptions;
    allowedFields(assumptions, OFFER_ASSUMPTIONS, "Assumptions");
    var normalized = {};
    OFFER_ASSUMPTIONS.forEach(function (key) {
      var n = offerNumber(assumptions[key], key, key === "feeThreshold");
      if (["feeRate","promotion","buyerTax","feeRateAbove"].indexOf(key) >= 0 && n !== null && n >= 100) throw new Error(key + " must be below 100 percent.");
      normalized[key] = n;
    });
    var out = {amount:offerNumber(input.amount,"Offer amount",true),acquisitionCost:offerNumber(input.acquisitionCost,"Scenario acquisition cost",false),currency:currency,
      receivedAt:offerTime(input.receivedAt,"Received time"),expiresAt:offerTime(input.expiresAt,"Expiration time"),
      expiryNote:offerText(input.expiryNote,"Expiration note",500),counterAmount:offerNumber(input.counterAmount,"Counter amount",true),
      minimumNet:offerNumber(input.minimumNet,"Your minimum net proceeds",false),recommendation:recommendation,
      rationale:offerText(input.rationale,"Recommendation notes",2000),basisNote:offerText(input.basisNote,"Cost or evidence notes",1000),assumptions:normalized};
    if (out.receivedAt && out.expiresAt && instant(out.expiresAt) < instant(out.receivedAt)) throw new Error("Expiration cannot be before the received time. Recheck the timezone.");
    return out;
  }
  function offerDeadline(offer, now) {
    offer = offer || {};
    if (!offer.expiresAt) return {key:offer.expiryNote ? "unconfirmed" : "unknown",label:offer.expiryNote ? "Expiration timezone or exact time unconfirmed" : "Expiration unknown"};
    var at = instant(offer.expiresAt);
    if (at === null) return {key:"unconfirmed",label:"Expiration timezone or exact time unconfirmed"};
    var current = now === undefined || now === null ? Date.now() : typeof now === "number" ? now : new Date(now).getTime();
    if (!Number.isFinite(current)) return {key:"unconfirmed",label:"Current time unavailable; verify the expiration"};
    var label = new Date(at).toISOString().replace("T"," ").replace(/:\d{2}\.\d{3}Z$/, " UTC");
    return {key:at <= current ? "expired" : "upcoming",label:(at <= current ? "Deadline passed: " : "Expires ") + label,at:at};
  }
  function offerQuote(card, offer) {
    var normalized = normalizeOffer(offer), assumptions = normalized.assumptions;
    var scenarioCard = normalized.acquisitionCost === null ? card : Object.assign({}, card, {cost:normalized.acquisitionCost});
    var q = lotQuote([scenarioCard], Object.assign({}, assumptions, {price:normalized.amount}));
    q.costSource = normalized.acquisitionCost === null ? "recorded cost" : "offer scenario";
    // Unlike lot defaults, an imported private scenario may have explicitly
    // unknown tier assumptions. Do not fill those gaps without owner review.
    if (OFFER_ASSUMPTIONS.some(function (key) { return assumptions[key] === null; })) q.fees = q.proceeds = q.profit = null;
    return q;
  }
  function exchangeCard(envelope, cards) {
    if (typeof envelope.sku !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(envelope.sku)) throw new Error("An exact inventory SKU is required.");
    var matches = (cards || []).filter(function (card) { return card.sku === envelope.sku; });
    if (matches.length !== 1) throw new Error("The SKU does not match exactly one card in this inventory.");
    var card = matches[0];
    if (!held(card)) throw new Error("This card is recorded sold. Do not import an active offer plan.");
    if (envelope.listingId !== undefined) {
      if (typeof envelope.listingId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(envelope.listingId) || envelope.listingId !== String((card.owner_listing || {}).item_id || "")) throw new Error("The listing ID does not match this card. Verify the exact listing before importing.");
    }
    return card;
  }
  function parseOfferExchange(text, cards) {
    if (typeof text !== "string" || text.length > 20000) throw new Error("Paste one private offer JSON object (20,000 characters maximum).");
    var envelope;
    try { envelope = JSON.parse(text); } catch (error) { throw new Error("Offer JSON is not valid. Paste the complete private offer object."); }
    allowedFields(envelope,["format","schema","sku","listingId","offer"],"Offer exchange");
    if (envelope.format !== "card-vault-offer-plan" || envelope.schema !== 1) throw new Error("Use card-vault-offer-plan schema 1; pricing comparison feeds cannot import offers.");
    var card = exchangeCard(envelope, cards), offer = normalizeOffer(envelope.offer);
    if (offer.amount === null) throw new Error("The imported offer needs a positive amount.");
    return {card:card,offer:offer};
  }
  function exportOfferExchange(card, offer) {
    var envelope = {format:"card-vault-offer-plan",schema:1,sku:card.sku,offer:normalizeOffer(offer)};
    if ((card.owner_listing || {}).item_id) envelope.listingId = String(card.owner_listing.item_id);
    exchangeCard(envelope,[card]);
    if (envelope.offer.amount === null) throw new Error("Enter a positive offer amount before exporting.");
    return envelope;
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
  return {amount:amount,round:round,held:held,listed:listed,reference:reference,cost:cost,today:today,formatDate:formatDate,daysSince:daysSince,protectedCard:protectedCard,batchEligible:batchEligible,groups:groups,soldEvidence:soldEvidence,soldRows:soldRows,listingAge:listingAge,planFor:planFor,premium:premium,lotQuote:lotQuote,normalizeOffer:normalizeOffer,offerDeadline:offerDeadline,offerQuote:offerQuote,parseOfferExchange:parseOfferExchange,exportOfferExchange:exportOfferExchange,lotTitle:lotTitle,lotDescription:lotDescription,results:results};
}));
