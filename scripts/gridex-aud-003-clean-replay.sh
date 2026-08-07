#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
SEED="$ROOT/supabase/seed.sql"
LEDGER="$ROOT/scripts/gridex-aud-003-main-ledger.json"
HISTORY="$ROOT/scripts/migration-history-manifest.json"
HISTORY_ADDITIONS="$ROOT/scripts/migration-history-manifest.additions.json"
FINGERPRINT_SQL="$ROOT/scripts/gridex-aud-003-schema-fingerprint.sql"
METERING_BOOTSTRAP="$ROOT/supabase/bootstrap/20260520_metering_permissions_foundation.sql"
METERING_BOOTSTRAP_SHA256="04061c107d1f963f2a8d61297d75f81a089cbe930f16138273b798602cec9a41"
METERING_SOURCE_NAME="20260520_batch_3_4_onboarding_pricing_billing_engine.sql"
EXPECTED_FINGERPRINT="407b9aed9cc2b58a3e78e587ff0e8a656ca52365a1e1088dc55590d8bcd84209"
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

test -f "$FINGERPRINT_SQL" || { echo "missing schema fingerprint query" >&2; exit 1; }
test -f "$METERING_BOOTSTRAP" || { echo "missing metering_permissions bootstrap" >&2; exit 1; }

cp -a "$MIGRATIONS"/. "$HOLD"/
cp "$SEED" "$SEED_BACKUP"
rm -f "$MIGRATIONS"/*.sql
: > "$SEED"

# Production runbook contract: DB1 foundation, EDIEL/batch legacy inputs, then
# every timestamped repository migration in deterministic timestamp/filename
# order. AUD-003 proved one pre-EDIEL dependency omitted by the prose runbook:
# metering_permissions must exist before ediel_rules.sql updates it. Restore
# only that table/index prerequisite from a checksum-pinned historical source.
legacy_foundation=(
  "$HOLD/01_db1_schema_repair_core_helpers_and_canonical_tables.sql"
  "$HOLD/02_db1_operations_ediel_billing_dedupe_and_storage.sql"
  "$HOLD/03_db1_backfill_functions_rls_reports_and_finish.sql"
  "$HOLD/ediel_rules.sql"
  "$HOLD/Batch 1+2.sql"
  "$HOLD/batch 3.sql"
  "$HOLD/batch 4+5+6.sql"
)

# Fail before database mutation if any replay source has drifted. The derived
# metering bootstrap is verified both by its own SHA-256 and by the immutable
# source migration checksum in the combined migration-history manifests.
python3 - "$HISTORY" "$HISTORY_ADDITIONS" "$HOLD" "$PLAN" "$METERING_BOOTSTRAP" "$METERING_BOOTSTRAP_SHA256" "$METERING_SOURCE_NAME" "${legacy_foundation[@]}" <<'PY'
import hashlib,json,pathlib,re,sys
history_path=pathlib.Path(sys.argv[1])
additions_path=pathlib.Path(sys.argv[2])
root=pathlib.Path(sys.argv[3])
plan=pathlib.Path(sys.argv[4])
metering_bootstrap=pathlib.Path(sys.argv[5])
metering_bootstrap_sha=sys.argv[6]
metering_source_name=sys.argv[7]
foundation=[pathlib.Path(p) for p in sys.argv[8:]]
history=json.loads(history_path.read_text())
additions=json.loads(additions_path.read_text()) if additions_path.exists() else {'files':{}}
checksums={**history.get('files',{}),**additions.get('files',{})}
allowed={k:sorted(v) for k,v in (history.get('allowedLegacyCollisions') or {}).items()}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def verify(path):
    expected=checksums.get(path.name)
    if not expected:
        raise SystemExit(f'migration source is not checksum-pinned: {path.name}')
    actual=digest(path)
    if actual != expected:
        raise SystemExit(f'migration checksum mismatch {path.name}: {actual} != {expected}')

for path in foundation:
    if not path.exists():
        raise SystemExit(f'missing foundation source: {path.name}')
    verify(path)

if digest(metering_bootstrap) != metering_bootstrap_sha:
    raise SystemExit('metering_permissions derived bootstrap checksum drift')
metering_source=root/metering_source_name
if not metering_source.exists():
    raise SystemExit(f'metering bootstrap source missing: {metering_source_name}')
verify(metering_source)

files=[]
collisions={}
for path in root.iterdir():
    if path.is_file() and re.match(r'^\d{14}_.+\.sql$',path.name):
        verify(path)
        files.append(path)
        collisions.setdefault(path.name[:14],[]).append(path.name)
for version,names in collisions.items():
    if len(names)>1 and sorted(names) != allowed.get(version,[]):
        raise SystemExit(f'unapproved migration version collision {version}: {sorted(names)}')
files.sort(key=lambda p:p.name)
if not files:
    raise SystemExit('no timestamped repository migrations found')
plan.write_text(''.join(str(path)+'\n' for path in files))
print(f'[AUD-003 replay] source preflight verified: {len(foundation)} legacy foundation + 1 derived prerequisite + {len(files)} timestamped files')
PY

supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector

apply_sql(){
  local file="$1"
  test -f "$file" || { echo "missing replay source $file" >&2; exit 1; }
  echo "[AUD-003 replay] applying ${file#$ROOT/}"
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$file"
}

apply_sql "$HOLD/01_db1_schema_repair_core_helpers_and_canonical_tables.sql"
apply_sql "$HOLD/02_db1_operations_ediel_billing_dedupe_and_storage.sql"
apply_sql "$HOLD/03_db1_backfill_functions_rls_reports_and_finish.sql"
apply_sql "$METERING_BOOTSTRAP"
apply_sql "$HOLD/ediel_rules.sql"
apply_sql "$HOLD/Batch 1+2.sql"
apply_sql "$HOLD/batch 3.sql"
apply_sql "$HOLD/batch 4+5+6.sql"

while IFS= read -r file; do
  apply_sql "$file"
done < "$PLAN"

# Repository SQL reconstructs historical schema state. Reproduce the compact
# ledger observed in gridex-ops-dev separately using temporary no-op markers and
# Supabase CLI. This is local verification only; no direct ledger DML is used.
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
    if not name or len(version)!=14 or not version.isdigit():
        raise SystemExit(f'invalid official ledger entry: {e}')
    if last is not None and version <= last:
        raise SystemExit(f'official ledger is not strictly ordered: {version} after {last}')
    last=version
    (out/f'{version}_{name}.sql').write_text(
        '-- GRIDEX-AUD-003 local ledger marker.\n'
        '-- Historical schema effects were reconstructed from checksum-pinned\n'
        '-- repository SQL before this marker is recorded by Supabase CLI.\n'
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

psql "$DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
select
  to_regclass('public.companies') is not null as companies_ok,
  to_regclass('public.metering_permissions') is not null as metering_permissions_ok,
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

ACTUAL_FINGERPRINT="$(psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 -f "$FINGERPRINT_SQL" | tr -d '[:space:]')"
if [[ "$ACTUAL_FINGERPRINT" != "$EXPECTED_FINGERPRINT" ]]; then
  echo "[AUD-003 replay] schema fingerprint mismatch" >&2
  echo "expected=$EXPECTED_FINGERPRINT" >&2
  echo "actual=$ACTUAL_FINGERPRINT" >&2
  exit 1
fi
echo "[AUD-003 replay] schema fingerprint verified: $ACTUAL_FINGERPRINT"
echo '[AUD-003 replay] PASS: empty local Supabase -> evidenced pre-EDIEL prerequisite -> full checksum-pinned timestamped history -> CLI-owned compact dev ledger'
