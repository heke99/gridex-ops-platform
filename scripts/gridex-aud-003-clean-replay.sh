#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPABASE="$ROOT/supabase"
MIGRATIONS="$SUPABASE/migrations"
SEED="$SUPABASE/seed.sql"
LEDGER="$ROOT/scripts/gridex-aud-003-main-ledger.json"
HISTORY="$ROOT/scripts/migration-history-manifest.json"
HISTORY_ADDITIONS="$ROOT/scripts/migration-history-manifest.additions.json"
FOUNDATION_PLAN="$ROOT/scripts/gridex-aud-003-legacy-foundation.json"
FOUNDATION_ADDITIONS="$ROOT/scripts/gridex-aud-003-legacy-foundation.additions.json"
FOUNDATION_ORDER="$ROOT/scripts/gridex-aud-003-foundation-order.json"
FINGERPRINT_SQL="$ROOT/scripts/gridex-aud-003-schema-fingerprint.sql"
EXPECTED_FINGERPRINT="407b9aed9cc2b58a3e78e587ff0e8a656ca52365a1e1088dc55590d8bcd84209"
HOLD="$(mktemp -d)"
LEDGER_MARKERS="$(mktemp -d)"
SEED_BACKUP="$(mktemp)"
FOUNDATION_EXEC="$(mktemp)"
TIMESTAMP_EXEC="$(mktemp)"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

cleanup(){
  set +e
  supabase stop --no-backup >/dev/null 2>&1 || true
  rm -f "$MIGRATIONS"/*.sql
  cp -a "$HOLD"/. "$MIGRATIONS"/ 2>/dev/null || true
  cp "$SEED_BACKUP" "$SEED" 2>/dev/null || true
  rm -rf "$HOLD" "$LEDGER_MARKERS" "$SEED_BACKUP" "$FOUNDATION_EXEC" "$TIMESTAMP_EXEC"
}
trap cleanup EXIT

command -v supabase >/dev/null
command -v psql >/dev/null
command -v python3 >/dev/null

test -f "$FINGERPRINT_SQL" || { echo "missing schema fingerprint query" >&2; exit 1; }
test -f "$FOUNDATION_ORDER" || { echo "missing canonical foundation order" >&2; exit 1; }

cp -a "$MIGRATIONS"/. "$HOLD"/
cp "$SEED" "$SEED_BACKUP"
rm -f "$MIGRATIONS"/*.sql
: > "$SEED"

# AUD-003 replay: apply the canonical ordered foundation; a derived bootstrap
# may substitute only its checksum-pinned historical source. Then apply every
# remaining timestamped repository migration exactly once, and finally rebuild
# the compact dev ledger using Supabase CLI-owned no-op markers.
python3 - "$HISTORY" "$HISTORY_ADDITIONS" "$FOUNDATION_PLAN" "$FOUNDATION_ADDITIONS" "$FOUNDATION_ORDER" "$SUPABASE" "$HOLD" "$FOUNDATION_EXEC" "$TIMESTAMP_EXEC" <<'PY'
import hashlib,json,pathlib,re,sys
history_path=pathlib.Path(sys.argv[1])
history_add_path=pathlib.Path(sys.argv[2])
plan_path=pathlib.Path(sys.argv[3])
plan_add_path=pathlib.Path(sys.argv[4])
order_path=pathlib.Path(sys.argv[5])
supabase=pathlib.Path(sys.argv[6])
hold=pathlib.Path(sys.argv[7])
foundation_out=pathlib.Path(sys.argv[8])
timestamp_out=pathlib.Path(sys.argv[9])

history=json.loads(history_path.read_text())
history_add=json.loads(history_add_path.read_text()) if history_add_path.exists() else {'files':{}}
plan=json.loads(plan_path.read_text())
plan_add=json.loads(plan_add_path.read_text()) if plan_add_path.exists() else {'foundation':[],'derivedBootstrap':{}}
order=json.loads(order_path.read_text())
checksums={**history.get('files',{}),**history_add.get('files',{})}
allowed={k:sorted(v) for k,v in (history.get('allowedLegacyCollisions') or {}).items()}
derived={**(plan.get('derivedBootstrap') or {}),**(plan_add.get('derivedBootstrap') or {})}
declared=set([*(plan.get('foundation') or []),*(plan_add.get('foundation') or [])])
foundation=order.get('foundation') or []
if not foundation or len(set(foundation)) != len(foundation):
    raise SystemExit('canonical foundation order is empty or contains duplicates')
if set(foundation) != declared:
    missing=sorted(declared-set(foundation)); extra=sorted(set(foundation)-declared)
    raise SystemExit(f'canonical foundation order does not match declared foundation; missing={missing}, extra={extra}')

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def pinned_source(path):
    expected=checksums.get(path.name)
    if not expected: raise SystemExit(f'migration source is not checksum-pinned: {path.name}')
    actual=digest(path)
    if actual != expected: raise SystemExit(f'migration checksum mismatch {path.name}: {actual} != {expected}')

foundation_paths=[]; skip_timestamp_names=set()
for rel in foundation:
    logical=supabase/rel
    actual=(hold/pathlib.Path(rel).name) if rel.startswith('migrations/') else logical
    if not actual.exists(): raise SystemExit(f'missing foundation input: {rel}')
    meta=derived.get(rel)
    if meta:
        if not meta.get('artifactSha256') or digest(actual) != meta['artifactSha256']:
            raise SystemExit(f'derived bootstrap checksum drift: {rel}')
        source_rel=meta.get('source')
        source=(hold/pathlib.Path(source_rel).name) if source_rel and source_rel.startswith('migrations/') else supabase/source_rel
        if not source.exists(): raise SystemExit(f'derived bootstrap source missing: {source_rel}')
        pinned_source(source)
        if re.match(r'^\d{14}_.+\.sql$',source.name): skip_timestamp_names.add(source.name)
    else:
        pinned_source(actual)
        if rel.startswith('migrations/') and re.match(r'^\d{14}_.+\.sql$',actual.name):
            skip_timestamp_names.add(actual.name)
    foundation_paths.append(actual)

files=[]; collisions={}
for path in hold.iterdir():
    if path.is_file() and re.match(r'^\d{14}_.+\.sql$',path.name):
        pinned_source(path)
        collisions.setdefault(path.name[:14],[]).append(path.name)
        if path.name not in skip_timestamp_names: files.append(path)
for version,names in collisions.items():
    if len(names)>1 and sorted(names) != allowed.get(version,[]):
        raise SystemExit(f'unapproved migration version collision {version}: {sorted(names)}')
files.sort(key=lambda p:p.name)
foundation_out.write_text(''.join(str(p)+'\n' for p in foundation_paths))
timestamp_out.write_text(''.join(str(p)+'\n' for p in files))
print(f'[AUD-003 replay] preflight: {len(foundation_paths)} foundation inputs, {len(skip_timestamp_names)} substitutions/pre-executions, {len(files)} remaining timestamped files')
PY

supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector

apply_sql(){
  local file="$1"
  test -f "$file" || { echo "missing replay source $file" >&2; exit 1; }
  echo "[AUD-003 replay] applying ${file#$ROOT/}"
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$file"
}
while IFS= read -r file; do apply_sql "$file"; done < "$FOUNDATION_EXEC"
while IFS= read -r file; do apply_sql "$file"; done < "$TIMESTAMP_EXEC"

python3 - "$LEDGER" "$LEDGER_MARKERS" <<'PY'
import json,pathlib,sys
ledger=json.loads(pathlib.Path(sys.argv[1]).read_text()); out=pathlib.Path(sys.argv[2])
entries=ledger.get('entries',[])
if not entries: raise SystemExit('official dev ledger snapshot is empty')
last=None
for e in entries:
    version=str(e['version']); name=e['name']
    if not name or len(version)!=14 or not version.isdigit(): raise SystemExit(f'invalid official ledger entry: {e}')
    if last is not None and version <= last: raise SystemExit(f'official ledger is not strictly ordered: {version} after {last}')
    last=version
    (out/f'{version}_{name}.sql').write_text('-- GRIDEX-AUD-003 local ledger marker.\nselect 1;\n')
PY
cp "$LEDGER_MARKERS"/*.sql "$MIGRATIONS"/
supabase db push --local --include-all --yes

python3 - "$LEDGER" "$DB_URL" <<'PY'
import json,subprocess,sys
ledger=json.load(open(sys.argv[1])); db=sys.argv[2]
expected=[(str(e['version']),e['name']) for e in ledger['entries']]
out=subprocess.check_output(['psql',db,'-X','-At','-c',"select version::text||E'\\t'||name from supabase_migrations.schema_migrations order by version::text;"],text=True)
actual=[tuple(line.split('\t',1)) for line in out.splitlines() if line]
if actual != expected:
    print('official ledger mismatch after Supabase CLI marker replay',file=sys.stderr); print('expected:',expected,file=sys.stderr); print('actual:',actual,file=sys.stderr); raise SystemExit(1)
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
  to_regclass('public.integration_api_clients') is not null as integration_api_clients_ok,
  to_regclass('public.website_customer_applications') is not null as website_customer_applications_ok,
  to_regclass('public.canonical_migration_manifest') is not null as canonical_migration_manifest_ok,
  to_regprocedure('public.gridex_contract_platform_readiness(uuid)') is not null as contract_platform_readiness_ok,
  to_regprocedure('public.gridex_contract_platform_readiness_internal_v1(uuid)') is not null as contract_platform_readiness_internal_ok,
  jsonb_typeof(public.gridex_contract_platform_readiness_internal_v1(gen_random_uuid())) = 'object' as contract_platform_readiness_internal_executes_ok,
  to_regclass('public.ediel_message_intents') is not null as ediel_message_intents_ok,
  to_regclass('public.company_capabilities') is not null as company_capabilities_ok;
SQL
ACTUAL_FINGERPRINT="$(psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 -f "$FINGERPRINT_SQL" | tr -d '[:space:]')"
if [[ "$ACTUAL_FINGERPRINT" != "$EXPECTED_FINGERPRINT" ]]; then
  echo "[AUD-003 replay] schema fingerprint mismatch" >&2; echo "expected=$EXPECTED_FINGERPRINT" >&2; echo "actual=$ACTUAL_FINGERPRINT" >&2; exit 1
fi
echo "[AUD-003 replay] schema fingerprint verified: $ACTUAL_FINGERPRINT"
echo '[AUD-003 replay] PASS: empty local Supabase -> canonical verified foundation -> remaining checksum-pinned history -> CLI-owned compact dev ledger'
