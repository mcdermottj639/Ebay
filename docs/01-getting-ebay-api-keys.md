# 01 — Getting your eBay API keys

You already sell on eBay. To let this toolkit pull prices and create listings
for you, eBay needs to know the requests are coming from an approved "app" tied
to your account. This is free. Budget ~15–20 minutes.

You do **not** need any of this just to catalog cards and generate drafts —
only for `get_comps.py` (pricing) and `create_listings.py live` (listing).

---

## Step 1 — Create a developer account

1. Go to **https://developer.ebay.com** and click **Register** (top right).
2. Sign in with the **same eBay account you sell with**, or create a developer
   login linked to it.
3. Accept the API License Agreement.

## Step 2 — Get your application keys

1. In the developer portal, open **Application Keysets** (under your account /
   "Your account" → "Application keysets").
2. You'll see two rows: **Sandbox** and **Production**.
   - **Sandbox** = a fake practice eBay for testing. Use this first.
   - **Production** = the real eBay.
3. For the **Sandbox** row, copy these three values into your `.env` file:
   - **App ID (Client ID)**   → `EBAY_APP_ID`
   - **Cert ID (Client Secret)** → `EBAY_CERT_ID`
   - **Dev ID**               → `EBAY_DEV_ID`
4. Make sure `.env` has `EBAY_ENV=sandbox` while testing.

Your `.env` now looks like:
```
EBAY_ENV=sandbox
EBAY_APP_ID=YourName-cardapp-SBX-abc123...
EBAY_CERT_ID=SBX-abc123...
EBAY_DEV_ID=1111-2222-3333...
```

### Test it
```bash
python3 get_comps.py
```
If your keys are right, it will pull prices. (In sandbox there's little real
data, so counts may be low — that's expected. Real data comes in production.)

---

## Step 3 — Let the app act on YOUR account (only needed to LIST)

Pulling public prices only needs the keys above. **Creating listings** needs a
"user token" that proves you gave the app permission to touch your account.

1. In the developer portal, open **User Tokens** → **Get a User Token**
   (OAuth). Choose your keyset and the **sell.inventory** scope.
2. Sign in as your seller account and click **Agree**.
3. eBay gives you a **Refresh Token**. Paste it into `.env`:
   ```
   EBAY_USER_REFRESH_TOKEN=v^1.1#i^1#...
   ```
   (Refresh tokens last a long time; you regenerate it if it ever expires.)

## Step 4 — Business policy IDs (only needed to LIST)

New-style eBay listings reference your saved **business policies** (how you
ship, get paid, handle returns).

1. In **Seller Hub → Account → Business Policies**, create a Shipping, a
   Payment, and a Return policy if you don't have them.
2. Get their IDs (via the developer portal's **Account API**, or ask Claude to
   fetch them for you once your keys work) and paste into `.env`:
   ```
   EBAY_FULFILLMENT_POLICY_ID=...
   EBAY_PAYMENT_POLICY_ID=...
   EBAY_RETURN_POLICY_ID=...
   EBAY_MERCHANT_LOCATION_KEY=...
   ```
> Tip: once your keys work, just tell Claude "fetch my eBay business policy IDs
> and put them in my .env" — the Account API call can be scripted.

---

## Step 5 — Go to production (when ready for real listings)

1. eBay may require you to **apply for production access** for the Sell APIs.
   Fill out the compliance form in the developer portal. Approval can take a
   few days.
2. Once approved, copy your **Production** keyset values into `.env` and change:
   ```
   EBAY_ENV=production
   ```
3. Redo the user-token step (Step 3) in production.

---

## Safety reminders

- Your `.env` file holds secrets. It's already in `.gitignore`, so it will
  **not** be uploaded to GitHub. Never paste its contents into a chat or email.
- Start in **sandbox**. Only switch to production when you've previewed
  listings and they look right.
- `create_listings.py` is dry-run unless you type `live`. It won't surprise you.

Next: [`02-cataloging-your-cards.md`](02-cataloging-your-cards.md)
