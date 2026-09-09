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

## Layout

    supabase/migrations/   schema, RLS, ledger functions (source of truth)
    src/lib/               units, expiry, categories, Supabase client, row types
    src/theme/             colour tokens and the useTokens hook
    src/providers/         session and household context
    src/hooks/             data fetching, filtering, summary
    src/components/        UI kit + inventory-specific components
    src/app/               expo-router routes

## Phase status

Phase 1 (ledger) is built. Phases 2-5 — capture, shopping list, plan and cook,
library — are specified but not implemented; their tabs are placeholders.
