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
echo "all checks passed"
