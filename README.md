# Stockpot

An expiry-driven pantry. It tracks what a household holds, what is about to
turn, and — from phase 4 — what to cook with it tonight.

**Phases 1–3 are implemented.** The ledger (auth, shared households, the product
catalog, dated inventory lots, search, filters, the stock summary, an
append-only movement log), capture (photographing a receipt or your groceries
into a reviewable draft tray that learns from every correction), and the
shopping list (which writes itself from the ledger and writes back into it).
Planning and the library follow.

## Setup

### 1. Supabase

Create a project at [supabase.com](https://supabase.com), then apply the
migrations in `supabase/migrations/` in filename order. Either paste them into
the SQL editor, or use the CLI:

```bash
npx supabase link --project-ref <your-ref>
npx supabase db push
```

For local development instead, `npx supabase start` runs the whole stack in
Docker and applies the migrations automatically.

In **Authentication → Providers → Email**, turn *Confirm email* off while
developing, or sign-up will stop at "check your inbox".

In **Database → Replication**, add `inventory_lot` and `product` to the
`supabase_realtime` publication so a second member's edits appear live:

```sql
alter publication supabase_realtime add table inventory_lot;
alter publication supabase_realtime add table product;
```

### 2. The scanner (Edge Function)

Capture calls Claude from a Supabase Edge Function, so the Anthropic key never
ships in the app bundle:

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy scan-capture
```

The `captures` storage bucket and its policies are created by the migrations.

### 3. The app

```bash
cp .env.example .env      # fill in your project URL and anon key
npm install
npx expo start
```

Open it with Expo Go, or press `w` for the browser.

## What capture does

Photograph a till roll or the shopping on the counter. The scan produces a
**draft tray** — an editable list where nothing has touched inventory yet:

- **Least-confident rows sort first.** Those are the ones worth a human's
  attention; a confident row rarely needs a second look.
- **Every row carries a decision**: add to an existing product, create a new
  one, or skip. Bags, deposits, discounts and the total line skip themselves.
- **Corrections are remembered.** Committing writes the till's exact string to
  `product_alias`, so `LCH ENT 1L` resolves to your milk on the next shop
  without the model having to work it out again. Accuracy climbs over the first
  few trips, and that curve is the point.
- **Committing goes through the ledger.** `commit_capture` calls the same
  `add_stock` the manual path uses, so lots, inferred expiry and the movement
  log all behave identically.
- **Units that cannot mean the same thing are refused.** Merging "2 ud" into a
  product tracked by volume raises instead of silently writing 2 ml.

## What the shopping list does

It is assembled from the ledger, not typed:

- **Four reasons put something on it**: it ran out, it fell below its low
  threshold, it is within three days of turning, or someone added it. A fifth —
  a gap in an approved meal plan — is in the schema and waits for phase 4.
- **Suggested quantities come from your own history.** What the household
  actually bought last time beats any default; the low threshold fills in until
  there is a purchase to learn from.
- **Refresh never undoes what a person did.** Ticking or editing a row pins it,
  and pinned, ticked and manual rows survive every recompute — the app must not
  rearrange the list while someone is standing in an aisle.
- **It is live across the household**, so two people in two aisles don't buy the
  same thing twice.
- **Closing a trip goes through `add_stock`**, so bought items get lots and
  inferred expiry like anything else, and the trip is archived with its item
  snapshot and total.
- **Unfound items roll onto the next list** rather than vanishing.

## What phase 1 gives you

- **Households, not users.** Everything belongs to a household; members join
  with a six-character invite code. Access is enforced by Postgres row-level
  security, not by the client.
- **Products vs. lots.** A product is the catalog entry ("whole milk"); a lot is
  a real quantity with a real date. Two cartons bought a week apart stay two
  lots, so the expiry engine has something to work with.
- **One base unit per product.** Grams, millilitres, or countable units. Display
  units are rendering only, which is what keeps recipes, receipts and the ledger
  comparable.
- **Expiry is never blank.** A product's useful life fills the date in whenever
  the caller does not supply one.
- **Atomic stock changes.** `add_stock`, `adjust_lot`, `set_lot_quantity` and
  `consume_product` apply deltas under a row lock and append to
  `stock_movement`. The client never writes a quantity it computed itself.
- **Oldest lot first.** `consume_product` always drains what is closest to
  expiring.

## Tests

The ledger's rules are asserted against a real Postgres — lot separation,
inferred expiry, oldest-first consumption, movement reconciliation, and that
RLS actually keeps non-members out:

```bash
npx supabase start                       # or any throwaway Postgres
PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres npm run test:db
```

It drops and rebuilds `public`, so point it at a scratch database only.

## Layout

```
supabase/migrations/   schema, RLS policies, ledger functions
src/lib/               units, expiry, categories, Supabase client, row types
src/theme/             colour tokens (light + dark) and useTokens
src/providers/         session and household context
src/hooks/             inventory fetching, filtering, summary
src/components/        UI kit and inventory components
src/app/               expo-router routes
```

## Next

Phase 4 is planning and cooking: generating a plan from what is actually in
stock, a schedule with reminders, cook mode, and deduction on finishing. That is
where `reserved_qty` and the `recipe_gap` list source finally get used.
