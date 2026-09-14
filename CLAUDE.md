# Stockpot

Expiry-driven pantry and meal planning. React Native (Expo SDK 57) + Supabase.

## Ground rules

- **Every quantity is stored in the product's base unit** (`g`, `ml`, or `unit`).
  Display units are a rendering concern only. Convert with `src/lib/units.ts`;
  never hand-roll a conversion.
- **The client never writes an absolute stock quantity.** All changes go through
  `add_stock`, `adjust_lot`, `set_lot_quantity` or `consume_product`, which apply
  deltas under a row lock and append to `stock_movement`. Two members editing at
  once must not lose each other's writes.
- **Products and lots are different things.** A `product` is the catalog entry;
  an `inventory_lot` is a quantity with a date. Never collapse lots.
- **The freshness ramp is semantic.** `fresh` / `soon` / `urgent` / `gone` in
  `src/theme/tokens.ts` mean stock state and nothing else. It owns green, amber,
  orange and red, which is *why* the brand accent is a berry plum: a brand colour
  drawn from those hues would be permanently ambiguous with a stock state.
- **Appearance is a user choice**, not a reading of the system setting. Colours
  come from `useTokens()`, backed by `ThemeProvider` (light / dark / system,
  persisted). Never call React Native's `useColorScheme` directly.
- **Never set `fontWeight`.** Weight is carried by the family — `fonts.medium`,
  `fonts.semibold`, `fonts.bold` in `src/theme/tokens.ts`. A weight on top of a
  custom family gives synthetic bold on Android.
- **Import `Text` from `@/components/ui/text`**, not from react-native, so a
  screen cannot silently fall back to the system font.
- **Icons are Ionicons via `@expo/vector-icons`**; app icons are drawn by
  `scripts/make-icons.py`, so the mark can be changed without a design tool.
- **Shelf life depends on the shelf.** A product stores one useful life, meaning
  its life in `product.storage`; `useful_life_days()` scales it for any other
  place, so a life someone typed in still travels sensibly. `add_stock` is the
  only door stock comes through, so that is where the rule lives — and an
  explicit `p_expires_on` always wins over anything inferred.
- **A location is never written without the date that follows from it.**
  `move_lot` re-dates a lot (scaling the life it has *left*, since freezing
  arrests decay from the moment it goes in) and `set_product_storage` translates
  `default_useful_life_days`. Never `update` `storage` on `product` or
  `inventory_lot` directly — that is exactly how a shelf and a date come apart.
- **`shelf_life_days()` / `natural_storage()` in SQL and `SHELF_LIFE` /
  `NATURAL_STORAGE` in `src/lib/categories.ts` must agree.** The database is the
  authority; the client copy exists only so a form can pre-fill a date without a
  round trip. A scanned line carries no shelf, so `natural_storage()` is what
  stops frozen food being dated as if it were in a cupboard.
- **A floating bottom bar measures itself.** Use `useFloatingBar()` with
  `<FloatingBar>` from the kit and give the scroll `bar.clearance`; never type a
  number into `paddingBottom` under a pinned bar. Every screen used to guess,
  and every guess went stale the moment a button was added — which is how the
  last meals of a generated plan ended up hidden behind four of them.
- **Sort by days-to-expiry first**, everywhere. That is the product's whole idea.
- Every colour is defined for both light and dark in `themes`. A value present in
  only one scheme is a bug.
- **A capture never writes stock.** Scanning fills `draft_line` rows; only
  `commit_capture` writes, and it does so through `add_stock`.
- **Unit tables live in three places and must agree**: `DISPLAY_UNITS` in
  `src/lib/units.ts`, `to_base_qty` / `base_of_display_unit` in the capture
  migration, and the `UNITS` enum in `supabase/functions/scan-capture`. The
  database is the authority — it is where stock is actually written.
- **Model calls run in Edge Functions, never the client.** A model API key must
  not reach the app bundle; `EXPO_PUBLIC_*` vars are inlined into it.
- **All model calls go through `_shared/llm.ts`.** It picks the provider from
  `LLM_PROVIDER` (gemini by default) and validates the reply against the same
  zod schema whichever one answered. Never call a provider SDK from a function
  directly — that is how the two paths drift apart.
- **Edge Functions are type-checked** by `npm run typecheck:functions`, which
  maps each `npm:` specifier to the real package. They sat unchecked for four
  phases and it hid a live type error; keep the versions in that tsconfig in
  step with the imports.
- **`refresh_shopping_list` must never touch a pinned, ticked or manual row.**
  Editing or ticking sets `pinned`. Rewriting the list under someone mid-trip is
  the worst thing this feature can do.
- **`needs_restocking()` is the single definition of what belongs on the list.**
  Both the upsert and the cleanup read it, so they cannot disagree.
- **A generated plan is never trusted.** `enforcePlan` in
  `supabase/functions/_shared/budget.ts` checks it against real quantities
  before it is written. It lives outside the Edge Function so it can be tested
  with `npm run test:budget`; never inline a second copy.
- **An ingredient of no amount is a violation, not a value.** `enforcePlan`
  refuses any ingredient at qty <= 0, optional ones included, and it checks that
  before the optional skip. Told a product was spent, the model would list it at
  zero and the slot would pass — reserving nothing, deducting nothing, and never
  reaching the shopping list. An invisible hole in a plan that looked complete.
- **A plan may reach past the shelf, under bounds.** Every ingredient states its
  `source`: `pantry` (product_id required), `staple` (whitelist only), or `buy`.
  `PlanLimits` keeps `buy` honest — day 0 is always pantry-only so someone can
  cook tonight without shopping, nothing already in the house may be bought, and
  nothing may be needed before the household can actually get to a shop. A day
  or single plan gets no allowance at all; only a week does, and `adapt-recipe`
  is closed entirely.
- **A draft plan is invisible to `product_stock`.** It reserves nothing, so a
  new plan must subtract what every *other* live draft has already spoken for —
  otherwise two drafts plan the same food and whichever is approved second comes
  up short, today included. `nextFreeDay` keeps new plans from landing on an
  existing schedule in the first place.
- **A plan's shopping reaches the list when the plan is written, not when it is
  approved.** Approving is about reserving stock; knowing what to buy is needed
  before that, and a household with an empty pantry has nothing to reserve at
  all. `cancel_plan` takes the unticked rows back off, leaves ticked ones alone,
  and keeps any a second live plan still wants.
- **An empty pantry is a starting point, not an error.** `limitsFor` returns
  `pantryOnlyDays: 0` and a same-day trip when there is nothing in, so the plan
  becomes a shopping list with meals attached — which is the app's most useful
  moment, not a failure case.
- **The Gemini model is a preference**, allowlisted in `_shared/llm.ts` before it
  reaches an API: it arrives from the app and decides what each call costs
  against the household's own key. `GEMINI_MODEL` remains the default.
- **Shopping days are days, not a count.** `user_profile.shopping_days` holds ISO
  weekdays; `limitsFor` turns them into plan-day offsets, and `tripFor` decides
  which trip covers each purchase. Someone who shops Saturdays and someone who
  shops Tuesdays and Fridays must not get the same week — the difference is
  *which* days, and a meal cannot be built on something that cannot be bought in
  time for it. The shopping list length scales with the number of trips, because
  one weekly shop carrying seven days is not the moment to buy eight new things.
  An empty array is a real answer meaning "plan from stock alone".
- **A `buy` ingredient becomes a real product with no stock**, marked
  `product.planned`. That is what lets `plan_shortfalls`, `add_plan_gaps_to_list`,
  `close_purchase` and `finish_cooking` carry it with no new mechanism.
  `needs_restocking` excludes planned products — they reach the list through the
  plan that wants them, never on their own — `add_stock` clears the flag, and
  `prune_planned_products` clears out intentions no live plan, list or lot
  still wants.
- **A plan's status and its slots' statuses are different things, and nothing
  reads the first.** The Meals tab, `plan_shortfalls` and the reminder queue all
  filter on `meal_slot.status`, so `cancel_plan` has to mark the slots too —
  `planned` becomes `skipped`, while `cooking` and `done` are left alone. Leaving
  them made deleting a plan look like it did nothing at all.
- **Only `finish_cooking` removes stock for a meal.** Approving reserves,
  skipping and cancelling release. Every one of those goes through the database
  under a row lock.
- **Adapting a recipe forks it.** Write a new row with `parent_recipe_id`; never
  edit a recipe that has been cooked. The library must keep what was actually
  made.
- **A template is a suggestion, not a copy.** `apply_template` produces a draft
  that is re-checked against the pantry as it is on the day it is applied.
- **Mealtimes belong to the member, not the code.** `user_profile.meal_times`
  holds minutes from local midnight; `meal_offset()` reads it in SQL and the
  client sends it to generate-plan. The defaults in three places —
  `DEFAULT_MEAL_TIMES` in `src/lib/types.ts`, `DEFAULT_MEAL_MINUTES` in
  generate-plan, and the column default — must agree.
- **`tz_offset_minutes` is the household's offset *east* of UTC**, which is the
  negation of `getTimezoneOffset()`. Local time converts to UTC by *subtracting*
  it, in SQL and in the Edge Function alike. Adding it instead is what once put
  a one o'clock lunch at half past five in the morning.
- **Editing a generated recipe is allowed only while nothing rests on it.**
  `assert_recipe_editable` refuses once the recipe has been cooked or a plan
  holding it has left draft — approving reserves stock against those exact
  quantities. Anything later has to fork through `adapt_recipe`.
- **Moving a meal is not a stock operation.** `reschedule_slot` touches no
  reservation, and derives `notify_at` rather than leaving it behind.
- **Swapping a meal moves its claim, never duplicates it.** generate-plan
  writes the replacement unreserved, then `swap_slot` retires the old meal and
  reserves the new one in one transaction — so a failed generation changes
  nothing, and the plan never holds two meals for one sitting. Reading the
  pantry for a swap needs the plan's state: a draft's siblings are invisible to
  `product_stock` and must be subtracted, an approved plan's are already inside
  `qty_reserved` and must not be, and the meal being replaced is holding a claim
  its replacement is entitled to spend.
- **A saved password goes in the device keystore, never AsyncStorage.**
  `src/lib/credentials.ts` keeps the email in AsyncStorage (not a secret) and
  the password only in expo-secure-store, only when asked for. It is
  deliberately *not* cleared on sign-out — surviving that is the whole point;
  unticking the box is what forgets it.
- **Leaving a household is the database's decision to finish.** `leave_household`
  drops the membership, promotes the longest-standing member if that left it
  ownerless, and deletes the household only when nobody is left — an orphaned
  household is unreachable by every policy in the schema.
- **Realtime channels get a unique topic** via `uniqueChannelTopic()`, and their
  effect depends only on the id it is keyed to. `supabase.channel(topic)` hands
  back an existing channel for a repeated topic, and adding listeners to an
  already-subscribed channel throws — which is what happens on every mount in
  development, where React runs effects twice.

## Layout

    supabase/migrations/   schema, RLS, ledger functions (source of truth)
    src/lib/               units, expiry, categories, Supabase client, row types
    src/theme/             colour tokens and the useTokens hook
    src/providers/         session and household context
    src/hooks/             data fetching, filtering, summary
    src/components/        UI kit + inventory-specific components
    src/app/               expo-router routes
    supabase/functions/    Deno Edge Functions (excluded from the app tsconfig)
    supabase/tests/        migrations + behavioural assertions vs real Postgres

## Phase status

All five phases are built: the ledger, capture, the shopping list, planning and
cooking, and the library. The loop closes — buy, stock, plan, cook, deplete,
restock.
