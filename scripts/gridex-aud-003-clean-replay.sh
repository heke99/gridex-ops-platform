#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
SEED="$ROOT/supabase/seed.sql"
LEDGER="$ROOT/scripts/gridex-aud-003-main-ledger.json"
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
command -v python3 >/dev/null || { echo 'python3 missing' >&2; exit 1; }

cp -a "$MIGRATIONS"/. "$HOLD"/
cp "$SEED" "$SEED_BACKUP"
rm -f "$MIGRATIONS"/*.sql
: > "$SEED"

# Start a genuinely empty local Supabase stack. Migrations are held aside so
# Supabase cannot apply the incomplete remote-ledger ordering before the
# repository's checksum-pinned historical foundation.
supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector

apply_sql() {
  local file="$1"
  echo "[AUD-003 replay] applying ${file#$ROOT/}"
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$file"
}

foundation=(
  "$HOLD/01_db1_schema_repair_core_helpers_and_canonical_tables.sql"
  "$HOLD/02_db1_operations_ediel_billing_dedupe_and_storage.sql"
  "$HOLD/03_db1_backfill_functions_rls_reports_and_finish.sql"
  "$ROOT/supabase/bootstrap/20260520_metering_permissions_foundation.sql"
  "$ROOT/supabase/bootstrap/20260521_ediel_test_runs_foundation.sql"
  "$HOLD/20260528_batch_2_ediel_rulebook_system_tests.sql"
  "$HOLD/20260529_batch_2_rulebook_hardening_sql_fix_v4.sql"
  "$HOLD/ediel_rules.sql"
  "$HOLD/Batch 1+2.sql"
  "$ROOT/supabase/bootstrap/20260528_inbound_email_messages_foundation.sql"
  "$HOLD/batch 3.sql"
  "$HOLD/batch 4+5+6.sql"
  "$ROOT/supabase/bootstrap/20260522_set_updated_at_timestamp_foundation.sql"
  "$ROOT/supabase/bootstrap/20260605_ediel_outbox_foundation.sql"
)

for file in "${foundation[@]}"; do
  test -f "$file" || { echo "missing foundation $file" >&2; exit 1; }
  apply_sql "$file"
done

# After the historical baseline, replay the official dev ledger only through
# the commit that is actually represented by main. A historical Supabase MCP
# ledger alias is validated against its canonical file but is not executed as a
# second migration. This also intentionally excludes the two AUD-001 rows
# already applied in dev from open PR #87.
python3 - "$LEDGER" "$HOLD" <<'PY' > "$HOLD/.aud003-ledger-paths"
import hashlib, json, pathlib, sys
ledger_path = pathlib.Path(sys.argv[1])
migrations = pathlib.Path(sys.argv[2])
data = json.loads(ledger_path.read_text())
entries_by_version = {entry['version']: entry for entry in data['entries']}

for entry in data['entries']:
    alias_of = entry.get('ledgerAliasOf')
    if alias_of:
        target = entries_by_version.get(alias_of)
        if not target:
            raise SystemExit(f"ledger alias {entry['version']} points to missing canonical version {alias_of}")
        repo_version = target.get('repositoryVersion', alias_of)
        exact = migrations / f"{repo_version}_{target['name']}.sql"
        if not exact.exists():
            raise SystemExit(f"ledger alias {entry['version']} canonical file missing: {exact.name}")
        expected = entry.get('checksum')
        if expected:
            actual = hashlib.sha256(exact.read_bytes()).hexdigest()
            if actual != expected:
                raise SystemExit(
                    f"ledger alias {entry['version']} checksum mismatch for {exact.name}: expected {expected}, got {actual}"
                )
        print(f"[AUD-003 replay] ledger alias {entry['version']} -> {alias_of} ({exact.name}); no duplicate SQL execution", file=sys.stderr)
        continue

    name = entry['name']
    repo_version = entry.get('repositoryVersion')
    if repo_version:
        exact = migrations / f"{repo_version}_{name}.sql"
        candidates = [exact] if exact.exists() else []
    else:
        candidates = sorted(migrations.glob(f"*_{name}.sql"))
    if len(candidates) != 1:
        raise SystemExit(
            f"ledger mapping for {entry['version']} {name} expected exactly one repository file, found {len(candidates)}: "
            + ', '.join(p.name for p in candidates)
        )
    print(candidates[0])
PY

while IFS= read -r file; do
  apply_sql "$file"
done < "$HOLD/.aud003-ledger-paths"

psql "$DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
select case when to_regclass('public.companies') is not null then 1 else 0 end as companies_ok,
       case when to_regclass('public.customers') is not null then 1 else 0 end as customers_ok,
       case when to_regclass('public.customer_sites') is not null then 1 else 0 end as customer_sites_ok,
       case when to_regclass('public.metering_permissions') is not null then 1 else 0 end as metering_permissions_ok,
       case when to_regclass('public.ediel_test_runs') is not null then 1 else 0 end as ediel_test_runs_ok,
       case when to_regclass('public.ediel_field_rules') is not null then 1 else 0 end as ediel_field_rules_ok,
       case when to_regclass('public.ediel_code_rules') is not null then 1 else 0 end as ediel_code_rules_ok,
       case when to_regclass('public.inbound_email_messages') is not null then 1 else 0 end as inbound_email_messages_ok,
       case when to_regprocedure('public.set_updated_at_timestamp()') is not null then 1 else 0 end as updated_at_trigger_ok,
       case when to_regclass('public.ediel_outbox') is not null then 1 else 0 end as ediel_outbox_ok,
       case when to_regclass('public.ediel_message_intents') is not null then 1 else 0 end as ediel_intents_ok;
SQL

echo '[AUD-003 replay] PASS: empty local Supabase -> explicit historical baseline -> main-aligned official dev ledger'
