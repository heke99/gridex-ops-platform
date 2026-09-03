#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPABASE="$ROOT/supabase"
MIGRATIONS="$SUPABASE/migrations"
SEED="$SUPABASE/seed.sql"
LEDGER="$ROOT/scripts/gridex-aud-003-main-ledger.json"
HISTORY="$ROOT/scripts/migration-history-manifest.json"
HISTORY_ADDITIONS="$ROOT/scripts/migration-history-manifest.additions.json"
HISTORY_RUNTIME_ADDITIONS="$ROOT/scripts/migration-history-manifest.runtime.additions.json"
FOUNDATION_PLAN="$ROOT/scripts/gridex-aud-003-legacy-foundation.json"
FOUNDATION_ADDITIONS="$ROOT/scripts/gridex-aud-003-legacy-foundation.additions.json"
FOUNDATION_ORDER="$ROOT/scripts/gridex-aud-003-foundation-order.json"
NONCANONICAL="$ROOT/scripts/gridex-aud-003-noncanonical-artifacts.json"
FINGERPRINT_SQL="$ROOT/scripts/gridex-aud-003-schema-fingerprint.sql"
POA_LIVE_PREREQUISITE="$SUPABASE/bootstrap/20260824_powers_of_attorney_legal_bundle_version_document_prerequisite.sql"
POA_LIVE_PREREQUISITE_SHA256="57a0d0ec161d53ec4c938af7621dac4d23d9cd7c867a32129ee9868f0589e753"
INBOUND_DEDUPE_REPLAY_PREREQUISITE="$SUPABASE/bootstrap/20260902_inbound_email_dedupe_replay_prerequisite.sql"
INBOUND_DEDUPE_REPLAY_PREREQUISITE_SHA256="f41a8afa81c8e8327e89ae6a1a6c57b22d3bc9d0b94ea3af8891fa0cecb23f2a"
INBOUND_EDIEL_PIPELINE_REPLAY_PREREQUISITE="$SUPABASE/bootstrap/20260902_inbound_ediel_pipeline_replay_prerequisite.sql"
INBOUND_EDIEL_PIPELINE_REPLAY_PREREQUISITE_SHA256="9c896c658e924b96e3598b0b103ff74fd01ca24e117f7901707cbf3dfb32b64e"
GRID_OWNER_NAME_KEY_REPLAY_PREREQUISITE="$SUPABASE/bootstrap/20260902_grid_owner_name_key_replay_prerequisite.sql"
GRID_OWNER_NAME_KEY_REPLAY_PREREQUISITE_SHA256="4cedc24155993c8e61616769ec02b712542d69cf5cd91d3aafe4fe016345316d"
WHITE_LABEL_HYGIENE_REPLAY_SHIM="$SUPABASE/bootstrap/20260902_white_label_admin_membership_hygiene_replay_shim.sql"
WHITE_LABEL_HYGIENE_REPLAY_SHIM_SHA256="73db4904c17a721b756dfa56efc4e38005f46ea8d1e40d6d05f2367ce44ccf38"
EXPECTED_FINGERPRINT="c70fa2f017f6ce3af3ff806d948f18b58a3c196e4bf94daa9304629a3926680c"
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
for required in "$FINGERPRINT_SQL" "$FOUNDATION_ORDER" "$NONCANONICAL" "$POA_LIVE_PREREQUISITE" "$INBOUND_DEDUPE_REPLAY_PREREQUISITE" "$INBOUND_EDIEL_PIPELINE_REPLAY_PREREQUISITE" "$GRID_OWNER_NAME_KEY_REPLAY_PREREQUISITE" "$WHITE_LABEL_HYGIENE_REPLAY_SHIM"; do
  test -f "$required" || { echo "missing replay provenance input: $required" >&2; exit 1; }
done
ACTUAL_POA_LIVE_PREREQUISITE_SHA256="$(sha256sum "$POA_LIVE_PREREQUISITE" | awk '{print $1}')"
if [[ "$ACTUAL_POA_LIVE_PREREQUISITE_SHA256" != "$POA_LIVE_PREREQUISITE_SHA256" ]]; then
  echo "verified POA live-schema prerequisite checksum drift: $ACTUAL_POA_LIVE_PREREQUISITE_SHA256 != $POA_LIVE_PREREQUISITE_SHA256" >&2
  exit 1
fi
ACTUAL_INBOUND_DEDUPE_REPLAY_PREREQUISITE_SHA256="$(sha256sum "$INBOUND_DEDUPE_REPLAY_PREREQUISITE" | awk '{print $1}')"
if [[ "$ACTUAL_INBOUND_DEDUPE_REPLAY_PREREQUISITE_SHA256" != "$INBOUND_DEDUPE_REPLAY_PREREQUISITE_SHA256" ]]; then
  echo "verified inbound dedupe replay prerequisite checksum drift: $ACTUAL_INBOUND_DEDUPE_REPLAY_PREREQUISITE_SHA256 != $INBOUND_DEDUPE_REPLAY_PREREQUISITE_SHA256" >&2
  exit 1
fi
ACTUAL_INBOUND_EDIEL_PIPELINE_REPLAY_PREREQUISITE_SHA256="$(sha256sum "$INBOUND_EDIEL_PIPELINE_REPLAY_PREREQUISITE" | awk '{print $1}')"
if [[ "$ACTUAL_INBOUND_EDIEL_PIPELINE_REPLAY_PREREQUISITE_SHA256" != "$INBOUND_EDIEL_PIPELINE_REPLAY_PREREQUISITE_SHA256" ]]; then
  echo "verified inbound EDIEL pipeline replay prerequisite checksum drift: $ACTUAL_INBOUND_EDIEL_PIPELINE_REPLAY_PREREQUISITE_SHA256 != $INBOUND_EDIEL_PIPELINE_REPLAY_PREREQUISITE_SHA256" >&2
  exit 1
fi
ACTUAL_GRID_OWNER_NAME_KEY_REPLAY_PREREQUISITE_SHA256="$(sha256sum "$GRID_OWNER_NAME_KEY_REPLAY_PREREQUISITE" | awk '{print $1}')"
if [[ "$ACTUAL_GRID_OWNER_NAME_KEY_REPLAY_PREREQUISITE_SHA256" != "$GRID_OWNER_NAME_KEY_REPLAY_PREREQUISITE_SHA256" ]]; then
  echo "verified grid-owner name-key replay prerequisite checksum drift: $ACTUAL_GRID_OWNER_NAME_KEY_REPLAY_PREREQUISITE_SHA256 != $GRID_OWNER_NAME_KEY_REPLAY_PREREQUISITE_SHA256" >&2
  exit 1
fi
ACTUAL_WHITE_LABEL_HYGIENE_REPLAY_SHIM_SHA256="$(sha256sum "$WHITE_LABEL_HYGIENE_REPLAY_SHIM" | awk '{print $1}')"
if [[ "$ACTUAL_WHITE_LABEL_HYGIENE_REPLAY_SHIM_SHA256" != "$WHITE_LABEL_HYGIENE_REPLAY_SHIM_SHA256" ]]; then
  echo "verified white-label hygiene replay shim checksum drift: $ACTUAL_WHITE_LABEL_HYGIENE_REPLAY_SHIM_SHA256 != $WHITE_LABEL_HYGIENE_REPLAY_SHIM_SHA256" >&2
  exit 1
fi

cp -a "$MIGRATIONS"/. "$HOLD"/
cp "$SEED" "$SEED_BACKUP"
rm -f "$MIGRATIONS"/*.sql
: > "$SEED"

# GRIDEX-REM-002 replay model:
# 1) execute the checksum-pinned reconstructed legacy foundation in explicit order;
# 2) substitute only checksum-pinned derived bootstrap artifacts for their exact historical sources;
# 3) allow explicitly marked prerequisite extractions to execute early while preserving full source replay;
# 4) exclude only explicitly classified, checksum-bound noncanonical repository artifacts;
# 5) execute every remaining timestamped repository migration deterministically, inserting declared
#    interleaved bootstrap artifacts at their exact verified boundaries;
# 6) restore the checksum-pinned, verified-live POA document binding immediately before the first
#    timestamped migration that consumes it; this reconciles live schema provenance without rewriting
#    the already-applied 20260824140830 migration;
# 7) reconstruct the checksum-pinned inbound dedupe columns sourced from the historical non-ledger
#    20260615 migration immediately before 20260902093000 consumes raw_message_sha256;
# 8) reconstruct the source-defined Batch 7A inbound parser relations immediately before the recovered
#    20260902096000 tenant-attribution migration carries company ownership down the inbound pipeline;
# 9) reconstruct only gridex_grid_owner_name_key immediately before 20260902100000 hardens it;
#    the full canonical 20260902100045 source still replays later and remains authoritative;
# 10) when canonical clean replay intentionally lacks white_label_platform_memberships, create a
#    fail-closed helper only while 20260902100500 applies privilege hygiene, then remove that shim;
# 11) recreate the observed dev ledger only through Supabase CLI-owned no-op markers.
python3 - "$HISTORY" "$HISTORY_ADDITIONS" "$HISTORY_RUNTIME_ADDITIONS" "$FOUNDATION_PLAN" "$FOUNDATION_ADDITIONS" "$FOUNDATION_ORDER" "$NONCANONICAL" "$SUPABASE" "$HOLD" "$FOUNDATION_EXEC" "$TIMESTAMP_EXEC" <<'PY'
import hashlib,json,pathlib,re,sys
history_path=pathlib.Path(sys.argv[1])
history_add_path=pathlib.Path(sys.argv[2])
history_runtime_add_path=pathlib.Path(sys.argv[3])
plan_path=pathlib.Path(sys.argv[4])
plan_add_path=pathlib.Path(sys.argv[5])
order_path=pathlib.Path(sys.argv[6])
noncanonical_path=pathlib.Path(sys.argv[7])
supabase=pathlib.Path(sys.argv[8])
hold=pathlib.Path(sys.argv[9])
foundation_out=pathlib.Path(sys.argv[10])
timestamp_out=pathlib.Path(sys.argv[11])

history=json.loads(history_path.read_text())
history_add=json.loads(history_add_path.read_text()) if history_add_path.exists() else {'files':{}}
history_runtime_add=json.loads(history_runtime_add_path.read_text()) if history_runtime_add_path.exists() else {'files':{}}
plan=json.loads(plan_path.read_text())
plan_add=json.loads(plan_add_path.read_text()) if plan_add_path.exists() else {'foundation':[],'derivedBootstrap':{},'interleaved':[]}
order=json.loads(order_path.read_text())
noncanonical=json.loads(noncanonical_path.read_text())
checksums={**history.get('files',{}),**history_add.get('files',{}),**history_runtime_add.get('files',{})}
allowed={k:sorted(v) for k,v in (history.get('allowedLegacyCollisions') or {}).items()}
derived={**(plan.get('derivedBootstrap') or {}),**(plan_add.get('derivedBootstrap') or {})}
declared=set([*(plan.get('foundation') or []),*(plan_add.get('foundation') or [])])
foundation=order.get('foundation') or []
interleaved=plan_add.get('interleaved') or []

if not foundation or len(set(foundation)) != len(foundation):
    raise SystemExit('canonical foundation order is empty or contains duplicates')
if set(foundation) != declared:
    missing=sorted(declared-set(foundation)); extra=sorted(set(foundation)-declared)
    raise SystemExit(f'canonical foundation order does not match declared foundation; missing={missing}, extra={extra}')

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def resolve(rel):
    p=pathlib.Path(rel)
    return (hold/p.name) if rel.startswith('migrations/') else (supabase/p)
def pinned_source(path):
    expected=checksums.get(path.name)
    if not expected: raise SystemExit(f'migration source is not checksum-pinned: {path.name}')
    actual=digest(path)
    if actual != expected: raise SystemExit(f'migration checksum mismatch {path.name}: {actual} != {expected}')
def validate_derived(rel):
    actual=resolve(rel)
    if not actual.exists(): raise SystemExit(f'missing derived bootstrap artifact: {rel}')
    meta=derived.get(rel)
    if not meta: raise SystemExit(f'derived bootstrap metadata missing: {rel}')
    if not meta.get('artifactSha256') or digest(actual) != meta['artifactSha256']:
        raise SystemExit(f'derived bootstrap checksum drift: {rel}')
    if meta.get('sourceKind') == 'verified_live_schema':
        if not meta.get('projectId') or not meta.get('capturedAt') or not meta.get('signatures'):
            raise SystemExit(f'verified live-schema evidence is incomplete: {rel}')
        if re.search(r'\$[A-Za-z0-9_]*\$(?!;)[ \t]*\n[ \t]*(?:revoke|grant|create)\b', actual.read_text(), re.I):
            raise SystemExit(f'verified live-schema function is missing a statement terminator: {rel}')
        return actual,None,meta
    source_rel=meta.get('source')
    source=resolve(source_rel) if source_rel else None
    if not source or not source.exists(): raise SystemExit(f'derived bootstrap source missing: {source_rel}')
    pinned_source(source)
    return actual,source,meta

def should_skip_timestamp_source(source,meta):
    return source is not None and re.match(r'^\d{14}_.+\.sql$',source.name) and not bool(meta.get('preserveSourceReplay',False))

foundation_paths=[]
skip_timestamp_names=set()
for rel in foundation:
    actual=resolve(rel)
    if not actual.exists(): raise SystemExit(f'missing foundation input: {rel}')
    if rel in derived:
        actual,source,meta=validate_derived(rel)
        if should_skip_timestamp_source(source,meta): skip_timestamp_names.add(source.name)
    else:
        pinned_source(actual)
        if rel.startswith('migrations/') and re.match(r'^\d{14}_.+\.sql$',actual.name):
            skip_timestamp_names.add(actual.name)
    foundation_paths.append(actual)

interleaved_paths=[]
for item in interleaved:
    rel=item.get('path','')
    after=str(item.get('afterLedgerVersion',''))
    before=str(item.get('beforeLedgerVersion',''))
    if rel in declared: raise SystemExit(f'interleaved artifact is also declared foundation: {rel}')
    if not re.fullmatch(r'\d{14}',after) or not re.fullmatch(r'\d{14}',before) or after >= before:
        raise SystemExit(f'invalid interleaved boundary for {rel}: {after}..{before}')
    actual,source,meta=validate_derived(rel)
    if should_skip_timestamp_source(source,meta): skip_timestamp_names.add(source.name)
    interleaved_paths.append((actual,after,before))

excluded=set()
artifacts=noncanonical.get('artifacts') or []
if not artifacts: raise SystemExit('noncanonical artifact contract is empty')
for item in artifacts:
    rel=item.get('path','')
    expected=item.get('sha256','')
    status=item.get('status','')
    reason=item.get('reason','')
    evidence=item.get('evidence') or []
    if status != 'merged_repository_artifact_not_deployed' or not reason or not evidence:
        raise SystemExit(f'incomplete noncanonical classification: {rel}')
    if not rel.startswith('migrations/'):
        raise SystemExit(f'noncanonical artifact must be a migration path: {rel}')
    actual=resolve(rel)
    if not actual.exists(): raise SystemExit(f'noncanonical artifact missing: {rel}')
    pinned_source(actual)
    if not re.fullmatch(r'[0-9a-f]{64}',expected) or digest(actual) != expected or checksums.get(actual.name) != expected:
        raise SystemExit(f'noncanonical artifact checksum mismatch: {rel}')
    if actual.name in skip_timestamp_names:
        raise SystemExit(f'noncanonical artifact overlaps foundation/substitution: {rel}')
    excluded.add(actual.name)

files=[]; collisions={}
for path in hold.iterdir():
    if path.is_file() and re.match(r'^\d{14}_.+\.sql$',path.name):
        pinned_source(path)
        collisions.setdefault(path.name[:14],[]).append(path.name)
        if path.name not in skip_timestamp_names and path.name not in excluded:
            files.append(path)
for version,names in collisions.items():
    if len(names)>1 and sorted(names) != allowed.get(version,[]):
        raise SystemExit(f'unapproved migration version collision {version}: {sorted(names)}')
files.sort(key=lambda p:p.name)

versions={p.name[:14] for p in files}
execution=list(files)
for actual,after,before in sorted(interleaved_paths,key=lambda row: row[2]):
    if after not in versions or before not in versions:
        raise SystemExit(f'interleaved boundary missing from canonical timestamped history for {actual.name}: {after}..{before}')
    idx=next((i for i,p in enumerate(execution) if re.match(r'^\d{14}_',p.name) and p.name[:14] == before),None)
    if idx is None: raise SystemExit(f'interleaved before-boundary not executable: {before}')
    prior_versions=[p.name[:14] for p in execution[:idx] if re.match(r'^\d{14}_',p.name)]
    if after not in prior_versions: raise SystemExit(f'interleaved after-boundary not reached before {before}: {after}')
    execution.insert(idx,actual)

foundation_out.write_text(''.join(str(p)+'\n' for p in foundation_paths))
timestamp_out.write_text(''.join(str(p)+'\n' for p in execution))
print(f'[GRIDEX-REM-002 replay] preflight: {len(foundation_paths)} foundation inputs, {len(skip_timestamp_names)} substitutions, {len(excluded)} noncanonical exclusions, {len(interleaved_paths)} interleaved artifacts, {len(files)} canonical timestamped files')
PY

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
    (out/f'{version}_{name}.sql').write_text('-- GRIDEX-REM-002 local ledger marker.\nselect 1;\n')
PY
cp "$LEDGER_MARKERS"/*.sql "$MIGRATIONS"/

# Supabase CLI owns the official ledger from the beginning so later governance
# migrations can inspect it. Marker migrations are no-op SQL and carry exactly
# the checksum-pinned dev-ledger versions verified below.
supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector

apply_sql(){
  local file="$1"
  test -f "$file" || { echo "missing replay source $file" >&2; exit 1; }
  echo "[GRIDEX-REM-002 replay] applying ${file#$ROOT/}"
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$file"
}
while IFS= read -r file; do apply_sql "$file"; done < "$FOUNDATION_EXEC"
poa_live_prerequisite_applied=false
inbound_dedupe_replay_prerequisite_applied=false
inbound_ediel_pipeline_replay_prerequisite_applied=false
grid_owner_name_key_replay_prerequisite_applied=false
white_label_hygiene_boundary_reached=false
white_label_hygiene_replay_shim_applied=false
while IFS= read -r file; do
  if [[ "$(basename "$file")" == 20260824140830_* ]]; then
    apply_sql "$POA_LIVE_PREREQUISITE"
    poa_live_prerequisite_applied=true
  fi
  if [[ "$(basename "$file")" == 20260902093000_* ]]; then
    apply_sql "$INBOUND_DEDUPE_REPLAY_PREREQUISITE"
    inbound_dedupe_replay_prerequisite_applied=true
  fi
  if [[ "$(basename "$file")" == 20260902096000_* ]]; then
    apply_sql "$INBOUND_EDIEL_PIPELINE_REPLAY_PREREQUISITE"
    inbound_ediel_pipeline_replay_prerequisite_applied=true
  fi
  if [[ "$(basename "$file")" == 20260902100000_* ]]; then
    apply_sql "$GRID_OWNER_NAME_KEY_REPLAY_PREREQUISITE"
    grid_owner_name_key_replay_prerequisite_applied=true
  fi
  if [[ "$(basename "$file")" == 20260902100500_* ]]; then
    white_label_hygiene_boundary_reached=true
    if [[ "$(psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 -c "select case when to_regclass('public.white_label_platform_memberships') is null and to_regprocedure('public.gridex_user_has_white_label_admin_membership(uuid)') is null then 'yes' else 'no' end")" == "yes" ]]; then
      apply_sql "$WHITE_LABEL_HYGIENE_REPLAY_SHIM"
      white_label_hygiene_replay_shim_applied=true
    fi
    apply_sql "$file"
    if [[ "$white_label_hygiene_replay_shim_applied" == true ]]; then
      psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "drop function if exists public.gridex_user_has_white_label_admin_membership(uuid);"
    fi
    continue
  fi
  apply_sql "$file"
done < "$TIMESTAMP_EXEC"
if [[ "$poa_live_prerequisite_applied" != true ]]; then
  echo "verified POA live-schema prerequisite boundary was not reached before 20260824140830" >&2
  exit 1
fi
if [[ "$inbound_dedupe_replay_prerequisite_applied" != true ]]; then
  echo "verified inbound dedupe replay prerequisite boundary was not reached before 20260902093000" >&2
  exit 1
fi
if [[ "$inbound_ediel_pipeline_replay_prerequisite_applied" != true ]]; then
  echo "verified inbound EDIEL pipeline replay prerequisite boundary was not reached before 20260902096000" >&2
  exit 1
fi
if [[ "$grid_owner_name_key_replay_prerequisite_applied" != true ]]; then
  echo "verified grid-owner name-key replay prerequisite boundary was not reached before 20260902100000" >&2
  exit 1
fi
if [[ "$white_label_hygiene_boundary_reached" != true ]]; then
  echo "verified white-label hygiene replay boundary was not reached at 20260902100500" >&2
  exit 1
fi

python3 - "$LEDGER" "$DB_URL" <<'PY'
import json,subprocess,sys
ledger=json.load(open(sys.argv[1])); db=sys.argv[2]
expected=[(str(e['version']),e['name']) for e in ledger['entries']]
out=subprocess.check_output(['psql',db,'-X','-At','-c',"select version::text||E'\\t'||name from supabase_migrations.schema_migrations order by version::text;"],text=True)
actual=[tuple(line.split('\t',1)) for line in out.splitlines() if line]
if actual != expected:
    print('official ledger mismatch after Supabase CLI marker replay',file=sys.stderr); print('expected:',expected,file=sys.stderr); print('actual:',actual,file=sys.stderr); raise SystemExit(1)
print(f'[GRIDEX-REM-002 replay] Supabase CLI ledger verified: {len(actual)} official rows')
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
  echo "[GRIDEX-REM-002 replay] schema fingerprint mismatch" >&2
  echo "expected=$EXPECTED_FINGERPRINT" >&2
  echo "actual=$ACTUAL_FINGERPRINT" >&2
  exit 1
fi
echo "[GRIDEX-REM-002 replay] schema fingerprint verified: $ACTUAL_FINGERPRINT"
echo '[GRIDEX-REM-002 replay] PASS: empty local Supabase -> verified reconstructed foundation -> canonical checksum-pinned history -> CLI-owned observed dev ledger'
