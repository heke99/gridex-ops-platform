#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
SEED="$ROOT/supabase/seed.sql"
HOLD="$(mktemp -d)"
SEED_BACKUP="$(mktemp)"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

cleanup() {
  set +e
  supabase stop --no-backup >/dev/null 2>&1 || true
  rm -f "$MIGRATIONS"/*.sql
  cp -a "$HOLD"/. "$MIGRATIONS"/ 2>/dev/null || true
  cp "$SEED_BACKUP" "$SEED" 2>/dev/null || true
  rm -rf "$HOLD" "$SEED_BACKUP"
}
trap cleanup EXIT

command -v supabase >/dev/null || { echo 'supabase CLI missing' >&2; exit 1; }
command -v psql >/dev/null || { echo 'psql missing' >&2; exit 1; }

cp -a "$MIGRATIONS"/. "$HOLD"/
cp "$SEED" "$SEED_BACKUP"
rm -f "$MIGRATIONS"/*.sql
: > "$SEED"

# Start a genuinely empty local Supabase stack. Migrations are held aside so
# Supabase cannot apply the incomplete remote-ledger ordering before the
# repository's checksum-pinned historical foundation.
supabase start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector

apply_sql() {
  local file="$1"
  echo "[AUD-003 replay] applying $(basename "$file")"
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$file"
}

foundation=(
  "01_db1_schema_repair_core_helpers_and_canonical_tables.sql"
  "02_db1_operations_ediel_billing_dedupe_and_storage.sql"
  "03_db1_backfill_functions_rls_reports_and_finish.sql"
  "20260520_batch_3_4_onboarding_pricing_billing_engine.sql"
  "ediel_rules.sql"
  "Batch 1+2.sql"
  "batch 3.sql"
  "batch 4+5+6.sql"
)

for name in "${foundation[@]}"; do
  test -f "$HOLD/$name" || { echo "missing foundation $name" >&2; exit 1; }
  apply_sql "$HOLD/$name"
done

# Canonical replay after the explicit historical foundation: only 14-digit
# migrations, in lexical/timestamp order. Other historical/manual artifacts do
# not silently join the replay chain; each prerequisite must be evidenced and
# added to the explicit foundation contract.
while IFS= read -r file; do
  apply_sql "$file"
done < <(find "$HOLD" -maxdepth 1 -type f -regextype posix-extended \
  -regex '.*/[0-9]{14}_.+\.sql' -print | LC_ALL=C sort)

psql "$DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
select case when to_regclass('public.companies') is not null then 1 else 0 end as companies_ok,
       case when to_regclass('public.customers') is not null then 1 else 0 end as customers_ok,
       case when to_regclass('public.customer_sites') is not null then 1 else 0 end as customer_sites_ok,
       case when to_regclass('public.metering_permissions') is not null then 1 else 0 end as metering_permissions_ok,
       case when to_regclass('public.ediel_message_intents') is not null then 1 else 0 end as ediel_intents_ok;
SQL

echo '[AUD-003 replay] PASS: empty local Supabase -> explicit historical foundation -> canonical 14-digit migrations'
