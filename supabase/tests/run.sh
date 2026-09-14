#!/usr/bin/env bash
# Applies the migrations to a throwaway Postgres and asserts the ledger's
# behaviour: lot separation, expiry inference, oldest-first consumption,
# movement reconciliation, and that RLS actually keeps non-members out.
#
#   PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
#
# Against `npx supabase start`, skip the shim -- the real platform already
# provides auth.uid(), auth.users and the anon/authenticated roles.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "resetting schema"
psql -q -c "drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/00_platform_shim.sql

for f in supabase/migrations/*.sql; do
  printf "  %-38s" "$(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -f "$f" && echo "OK"
done

echo "running ledger smoke test"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/01_ledger_smoke.sql

echo "running capture smoke test"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/02_capture_smoke.sql

echo "running shopping smoke test"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/03_shopping_smoke.sql

echo "running planning smoke test"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/04_planning_smoke.sql

echo "running library smoke test"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/05_library_smoke.sql

echo "running preferences smoke test"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/06_preferences_smoke.sql

echo "running mealtime and editing smoke test"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/07_meal_times_smoke.sql

echo "running shelf life smoke test"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/08_shelf_life_smoke.sql

echo "running leave household smoke test"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/09_leave_household_smoke.sql

echo "running meal swap smoke test"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/10_swap_slot_smoke.sql

echo "running planned products smoke test"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/11_planned_products_smoke.sql

echo "running shopping days smoke test"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/12_shopping_days_smoke.sql
echo "all checks passed"
