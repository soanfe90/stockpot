# Stockpot

An expiry-driven pantry. It tracks what a household holds, what is about to
turn, and — from phase 4 — what to cook with it tonight.

**All five phases are implemented.** The ledger, capture, the shopping list,
planning and cooking, and the library — the loop closes: buy, stock, plan, cook,
deplete, restock.

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

### 2. The Edge Functions

Scanning, planning and recipe adaptation call a model server-side, so the API
key never ships in the app bundle. **Gemini is the default:**

```bash
npx supabase secrets set GEMINI_API_KEY=...
npx supabase functions deploy scan-capture
npx supabase functions deploy generate-plan
npx supabase functions deploy adapt-recipe
```

The model defaults to `gemini-2.5-flash`. If your key cannot use that one, the
function says so and names the variable to change:

```bash
npx supabase secrets set GEMINI_MODEL=<a model your key can use>
```

To run Claude instead — same code, one variable:

```bash
npx supabase secrets set LLM_PROVIDER=anthropic
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Both providers go through `supabase/functions/_shared/llm.ts`, which validates
whatever comes back against the same schema either way. Switching is a secret,
not a rewrite — so you can run the same receipt through both and compare.

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

## What the library does

Everything cooked is kept, so it can be cooked again:

- **Stats come from what was actually cooked**, not what was planned — times
  cooked, average rating, last made. Most-cooked and highest-rated together are
  the household's real taste profile, and both are fed back into generation.
- **Reuse puts a recipe back on the schedule as a draft.** Approving is what
  reserves stock, so anything missing goes through the same shortfall machinery
  and lands on the shopping list.
- **Adapting forks rather than edits.** Refitting a recipe to today's pantry
  creates a new version linked to its parent, so the library always holds the
  version that was really cooked. The adaptation is checked by the same budget
  enforcer the planner uses.
- **A day or a week can be saved as a template.** Applying it to a future date
  produces a *draft* re-checked against the pantry as it is then — same rhythm,
  swapped ingredients where stock has moved on. A recipe deleted since the
  template was saved is skipped rather than failing the whole apply.

## What planning does

A plan is an allocation of stock, not a list of nice ideas:

- **Generation is constrained, and the constraint is enforced here, not hoped
  for.** The model gets the pantry as data and must reference products by id
  from it; every plan is then checked against real quantities server-side before
  anyone sees it. A meal that would overdraw the pantry is dropped, earlier days
  winning, so what survives is a real prefix rather than an arbitrary subset.
- **The whole plan is budgeted together**, not meal by meal. Twenty-one
  independent calls would each reach for the same chicken.
- **Approving reserves.** Ingredients are claimed against specific lots, oldest
  first, so the shopping list stops offering to sell you groceries the plan has
  already spoken for. A shortfall is not an error — it goes to the shopping list
  as a `recipe_gap`, pinned so a list refresh cannot relabel it.
- **Finishing deducts what was actually used.** People substitute, burn things,
  and cook for four when the plan said two; the summary takes the real servings
  and per-ingredient adjustments. Running out mid-recipe clamps at zero and the
  cook log records both what was wanted and what was taken.
- **Skipping or cancelling gives the stock back.**
- **Reminders fire 30 minutes before**, scheduled on the device so they work
  without a network.

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
- **Preferences are personal.** Diet, cuisines and goals are asked once at
  signup and editable any time; two people sharing a pantry can want different
  things from it. A plan can override them without touching what is saved.
- **Low-stock thresholds are per product.** Set one and the product joins the
  shopping list as running low before it runs out; leave it blank and you are
  told only when it is gone.
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

The plan budget enforcer — the guard that stops a generated plan calling for
food you do not have — is tested without a Deno runtime:

```bash
npm test          # typecheck + budget tests
```

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

## Where it stands

The loop is closed end to end, and the database rules are exercised by 60
assertions against real Postgres plus unit tests over the plan budget enforcer.

Three things remain unverified and want a real environment before you trust
them:

- **The Edge Functions have never executed.** They are written against the
  documented SDK surface, but none has run.
- **Nothing has run on a device.** Notifications especially — local reminders
  should work in Expo Go on Android; iOS may need a development build.
- **Prompt quality is unmeasured.** The guards guarantee a scan or a plan will
  not lie about your stock. They guarantee nothing about whether the readings
  are accurate or the meals are any good. Feed it twenty real receipts and a
  week of real planning, and tune the prompts from what comes back.
