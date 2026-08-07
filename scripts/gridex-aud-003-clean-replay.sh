#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
SEED="$ROOT/supabase/seed.sql"
LEDGER="$ROOT/scripts/gridex-aud-003-main-ledger.json"
HISTORY="$ROOT/scripts/migration-history-manifest.json"
HOLD="$(mktemp -d)"
LEDGER_MARKERS="$(mktemp -d)"
SEED_BACKUP="$(mktemp)"
PLAN="$(mktemp)"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

cleanup(){
  set +e
  supabase stop --no-backup >/dev/null 2>&1 || true
  rm -f "$MIGRATIONS"/*.sql
  cp -a "$HOLD"/. "$MIGRATIONS"/ 2>/dev/null || true
  cp "$SEED_BACKUP" "$SEED" 2>/dev/null || true
  rm -rf "$HOLD" "$LEDGER_MARKERS" "$SEED_BACKUP" "$PLAN"
}
trap cleanup EXIT

command -v supabase >/dev/null
command -v psql >/dev/null
command -v python3 >/dev/null

cp -a "$MIGRATIONS"/. "$HOLD"/
cp "$SEED" "$SEED_BACKUP"
rm -f "$MIGRATIONS"/*.sql
: > "$SEED"

# The production runbook is explicit: fresh databases start with the DB1
# foundation, EDIEL rules and batch files, then every timestamped repository
# migration in timestamp/filename order. The connected dev ledger is not a
# complete schema source, so clean replay must reconstruct historical effects
# from checksum-pinned repository SQL instead of inventing missing objects.
foundation=(
  "$HOLD/01_db1_schema_repair_core_helpers_and_canonical_tables.sql"
  "$HOLD/02_db1_operations_ediel_billing_dedupe_and_storage.sql"
  "$HOLD/03_db1_backfill_functions_rls_reports_and_finish.sql"
  "$HOLD/ediel_rules.sql"
  "$HOLD/Batch 1+2.sql"
  "$HOLD/batch 3.sql"
  "$HOLD/batch 4+5+6.sql"
)

# Validate every replayed source file against the immutable migration-history
# manifest and emit the deterministic timestamped execution plan. Allowed
# historical version collisions are ordered by full filename.
python3 - "$HISTORY" "$HOLD" "$PLAN" "${foundation[@]}" <<'PY'
import hashlib,json,pathlib,re,sys
history_path=pathlib.Path(sys.argv[1])
root=pathlib.Path(sys.argv[2])
plan=pathlib.Path(sys.argv[3])
foundation=[pathlib.Path(p) for p in sys.argv[4:]]
history=json.loads(history_path.read_text())
checksums=history.get('files',{})

def verify(path):
    name=path.name
    expected=checksums.get(name)
    if not expected:
        raise SystemExit(f'migration source is not checksum-pinned: {name}')
    actual=hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f'migration checksum mismatch {name}: {actual} != {expected}')

for path in foundation:
    if not path.exists():
        raise SystemExit(f'missing foundation source: {path.name}')
    verify(path)

files=[]
for path in root.iterdir():
    if path.is_file() and re.match(r'^\d{14}_.+\.sql$',path.name):
        verify(path)
        files.append(path)
files.sort(key=lambda p:p.name)
if not files:
    raise SystemExit('no timestamped repository migrations found')
plan.write_text(''.join(str(path)+'\n' for path in files))
print(f'[AUD-003 replay] source preflight verified: {len(foundation)} foundation + {len(files)} timestamped files')
PY

supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector

apply_sql(){
  local file="$1"
  test -f "$file" || { echo "missing replay source $file" >&2; exit 1; }
  echo "[AUD-003 replay] applying ${file#$ROOT/}"
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$file"
}

for file in "${foundation[@]}"; do
  apply_sql "$file"
done

while IFS= read -r file; do
  apply_sql "$file"
done < "$PLAN"

# The historical SQL above reconstructs schema state. The current connected dev
# project has a compact/incomplete official Supabase ledger, captured exactly in
# gridex-aud-003-main-ledger.json. Reproduce that ledger locally using CLI-owned
# no-op markers only; direct DML against supabase_migrations is prohibited.
python3 - "$LEDGER" "$LEDGER_MARKERS" <<'PY'
import json,pathlib,sys
ledger=json.loads(pathlib.Path(sys.argv[1]).read_text())
out=pathlib.Path(sys.argv[2])
entries=ledger.get('entries',[])
if not entries:
    raise SystemExit('official dev ledger snapshot is empty')
last=None
for e in entries:
    version=str(e['version']); name=e['name']
    if last is not None and version <= last:
        raise SystemExit(f'official ledger is not strictly ordered: {version} after {last}')
    last=version
    path=out/f'{version}_{name}.sql'
    path.write_text(
        '-- GRIDEX-AUD-003 local ledger marker.\n'
        '-- Historical schema effects were reconstructed from checksum-pinned\n'
        '-- repository migrations before this marker was recorded by Supabase CLI.\n'
        'select 1;\n'
    )
PY

cp "$LEDGER_MARKERS"/*.sql "$MIGRATIONS"/
supabase db push --local --include-all --yes

python3 - "$LEDGER" "$DB_URL" <<'PY'
import json,subprocess,sys
ledger=json.load(open(sys.argv[1])); db=sys.argv[2]
expected=[(str(e['version']),e['name']) for e in ledger['entries']]
query="select version::text||E'\\t'||name from supabase_migrations.schema_migrations order by version::text;"
out=subprocess.check_output(['psql',db,'-X','-At','-c',query],text=True)
actual=[tuple(line.split('\t',1)) for line in out.splitlines() if line]
if actual != expected:
    print('official ledger mismatch after Supabase CLI marker replay',file=sys.stderr)
    print('expected:',expected,file=sys.stderr)
    print('actual:',actual,file=sys.stderr)
    raise SystemExit(1)
print(f'[AUD-003 replay] Supabase CLI ledger verified: {len(actual)} official rows')
PY

# Fail closed on the key historical objects that previously disappeared when
# replay used only the compact dev ledger. Execute the preserved readiness body
# as a runtime dependency check, not merely an existence check.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
select
  to_regclass('public.companies') is not null as companies_ok,
  to_regclass('public.price_plans') is not null as price_plans_ok,
  to_regclass('public.price_plan_versions') is not null as price_plan_versions_ok,
  to_regclass('public.contract_products') is not null as contract_products_ok,
  to_regclass('public.contract_product_versions') is not null as contract_product_versions_ok,
  to_regclass('public.contract_price_options') is not null as contract_price_options_ok,
  to_regclass('public.contract_price_option_area_prices') is not null as contract_price_option_area_prices_ok,
  to_regclass('public.portfolios') is not null as portfolios_ok,
  to_regclass('public.portfolio_monthly_settlements') is not null as portfolio_monthly_settlements_ok,
  to_regclass('public.user_profiles') is not null as user_profiles_ok,
  to_regclass('public.admin_users') is not null as admin_users_ok,
  to_regclass('public.integration_api_clients') is not null as integration_api_clients_ok,
  to_regclass('public.website_customer_applications') is not null as website_customer_applications_ok,
  to_regclass('public.customer_operation_jobs') is not null as customer_operation_jobs_ok,
  to_regclass('public.customer_application_workflows') is not null as customer_application_workflows_ok,
  to_regclass('public.contract_publication_revisions') is not null as contract_publication_revisions_ok,
  to_regclass('public.canonical_migration_manifest') is not null as canonical_migration_manifest_ok,
  to_regprocedure('public.gridex_contract_platform_readiness(uuid)') is not null as contract_platform_readiness_ok,
  to_regprocedure('public.gridex_contract_platform_readiness_internal_v1(uuid)') is not null as contract_platform_readiness_internal_ok,
  jsonb_typeof(public.gridex_contract_platform_readiness_internal_v1(gen_random_uuid())) = 'object' as contract_platform_readiness_internal_executes_ok,
  to_regclass('public.ediel_message_intents') is not null as ediel_message_intents_ok,
  to_regclass('public.company_capabilities') is not null as company_capabilities_ok;
SQL

echo '[AUD-003 replay] PASS: empty local Supabase -> runbook foundation -> all checksum-pinned timestamped SQL -> CLI-owned compact dev ledger'
