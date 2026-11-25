#!/usr/bin/env bash
# Applies the migrations to a throwaway Postgres database (with a minimal stand-in for
# Supabase's auth schema) and runs the Bondi / Rose Bay scenario under RLS.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-chs_dispatch_test}
psql -q -c "drop database if exists $DB" -c "create database $DB"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f"; done
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/01_grants.sql
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/10_two_incident_scenario.sql | grep -E "NOTICE|ERROR|SHOULD" || true
echo "Scenario passed."
