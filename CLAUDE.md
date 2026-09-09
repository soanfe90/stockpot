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
  `src/theme/tokens.ts` mean stock state and nothing else.
- **Sort by days-to-expiry first**, everywhere. That is the product's whole idea.
- Every colour is defined for both light and dark in `themes`. A value present in
  only one scheme is a bug.
- **A capture never writes stock.** Scanning fills `draft_line` rows; only
  `commit_capture` writes, and it does so through `add_stock`.
- **Unit tables live in three places and must agree**: `DISPLAY_UNITS` in
  `src/lib/units.ts`, `to_base_qty` / `base_of_display_unit` in the capture
  migration, and the `UNITS` enum in `supabase/functions/scan-capture`. The
  database is the authority — it is where stock is actually written.
- **Model calls run in Edge Functions, never the client.** `ANTHROPIC_API_KEY`
  must not reach the app bundle; `EXPO_PUBLIC_*` vars are inlined into it.
- **`refresh_shopping_list` must never touch a pinned, ticked or manual row.**
  Editing or ticking sets `pinned`. Rewriting the list under someone mid-trip is
  the worst thing this feature can do.
- **`needs_restocking()` is the single definition of what belongs on the list.**
  Both the upsert and the cleanup read it, so they cannot disagree.

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

Phases 1 (ledger), 2 (capture) and 3 (shopping list) are built. Phases 4-5 —
plan and cook, library — are specified but not implemented; their tabs are
placeholders. `reserved_qty` and the `recipe_gap` item source exist in the
schema for phase 4 and are unused until then.
