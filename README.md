# Stockpot

An expiry-driven pantry. It tracks what a household holds, what is about to
turn, and — from phase 4 — what to cook with it tonight.

**Phase 1 (ledger) is implemented.** Auth, shared households, the product
catalog, dated inventory lots, search, filters, the stock summary, and an
append-only movement log. Capture, shopping list, planning and library follow.

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

### 2. The app

```bash
cp .env.example .env      # fill in your project URL and anon key
npm install
npx expo start
```

Open it with Expo Go, or press `w` for the browser.

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

Phase 2 is camera capture: receipt and product photos to a draft tray, with
alias learning so the same till line resolves exactly on the next shop. The
`product_alias` table and the search that reads it are already in place.
