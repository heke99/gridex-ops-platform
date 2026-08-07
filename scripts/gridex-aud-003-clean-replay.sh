#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
SEED="$ROOT/supabase/seed.sql"
LEDGER="$ROOT/scripts/gridex-aud-003-main-ledger.json"
HOLD="$(mktemp -d)"
STAGED="$(mktemp -d)"
SEED_BACKUP="$(mktemp)"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

MANIFEST_BOOTSTRAP="$ROOT/supabase/bootstrap/20260802_canonical_migration_manifest_verification_foundation.sql"
MANIFEST_BEFORE="20260803093000"
READINESS_BOOTSTRAP="$ROOT/supabase/bootstrap/20260716_contract_platform_readiness_foundation.sql"
READINESS_BEFORE="20260803131558"

cleanup(){
  set +e
  supabase stop --no-backup >/dev/null 2>&1 || true
  rm -f "$MIGRATIONS"/*.sql
  cp -a "$HOLD"/. "$MIGRATIONS"/ 2>/dev/null || true
  cp "$SEED_BACKUP" "$SEED" 2>/dev/null || true
  rm -rf "$HOLD" "$STAGED" "$SEED_BACKUP"
}
trap cleanup EXIT

command -v supabase >/dev/null
command -v psql >/dev/null
command -v python3 >/dev/null

cp -a "$MIGRATIONS"/. "$HOLD"/
cp "$SEED" "$SEED_BACKUP"
rm -f "$MIGRATIONS"/*.sql
: > "$SEED"

supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector

apply_sql(){
  local file="$1"
  test -f "$file" || { echo "missing replay prerequisite $file" >&2; exit 1; }
  echo "[AUD-003 replay] applying ${file#$ROOT/}"
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$file"
}

foundation=(
 "$HOLD/01_db1_schema_repair_core_helpers_and_canonical_tables.sql"
 "$HOLD/02_db1_operations_ediel_billing_dedupe_and_storage.sql"
 "$HOLD/03_db1_backfill_functions_rls_reports_and_finish.sql"
 "$ROOT/supabase/bootstrap/20260519_user_profiles_foundation.sql"
 "$ROOT/supabase/bootstrap/20260520_metering_permissions_foundation.sql"
 "$ROOT/supabase/bootstrap/20260520_customer_cases_email_outbox_foundation.sql"
 "$ROOT/supabase/bootstrap/20260521_company_ediel_production_profile_foundation.sql"
 "$ROOT/supabase/bootstrap/20260521_actor_test_results_foundation.sql"
 "$ROOT/supabase/bootstrap/20260521_ediel_test_runs_foundation.sql"
 "$ROOT/supabase/bootstrap/20260521_ediel_test_run_messages_foundation.sql"
 "$ROOT/supabase/bootstrap/20260522_admin_users_foundation.sql"
 "$ROOT/supabase/bootstrap/20260523_rbac_permission_helpers_foundation.sql"
 "$ROOT/supabase/bootstrap/20260528_ediel_test_run_steps_foundation.sql"
 "$HOLD/20260528_batch_2_ediel_rulebook_system_tests.sql"
 "$HOLD/20260529_batch_2_rulebook_hardening_sql_fix_v4.sql"
 "$ROOT/supabase/bootstrap/20260529_ediel_test_artifact_message_foundation.sql"
 "$HOLD/ediel_rules.sql"
 "$HOLD/Batch 1+2.sql"
 "$ROOT/supabase/bootstrap/20260528_inbound_email_messages_foundation.sql"
 "$HOLD/batch 3.sql"
 "$HOLD/batch 4+5+6.sql"
 "$ROOT/supabase/bootstrap/20260522_set_updated_at_timestamp_foundation.sql"
 "$ROOT/supabase/bootstrap/20260531_integration_api_clients_foundation.sql"
 "$ROOT/supabase/bootstrap/20260601_ediel_production_readiness_foundation.sql"
 "$ROOT/supabase/bootstrap/20260602_ediel_certificates_foundation.sql"
 "$ROOT/supabase/bootstrap/20260602_ediel_environment_type_foundation.sql"
 "$ROOT/supabase/bootstrap/20260605_ediel_outbox_foundation.sql"
 "$ROOT/supabase/bootstrap/20260609_integration_api_client_origins_foundation.sql"
 "$ROOT/supabase/bootstrap/20260609_webhook_email_readiness_foundation.sql"
 "$ROOT/supabase/bootstrap/20260609_website_customer_applications_foundation.sql"
 "$ROOT/supabase/bootstrap/20260611_grid_owner_information_request_foundation.sql"
 "$ROOT/supabase/bootstrap/20260612_integration_api_client_lifecycle_foundation.sql"
 "$ROOT/supabase/bootstrap/20260613_powers_of_attorney_customer_site_foundation.sql"
 "$ROOT/supabase/bootstrap/20260614_integration_api_client_readiness_foundation.sql"
 "$ROOT/supabase/bootstrap/20260618_customer_operation_jobs_foundation.sql"
 "$ROOT/supabase/bootstrap/20260618_customer_application_workflows_foundation.sql"
 "$ROOT/supabase/bootstrap/20260721_contract_publication_revisions_foundation.sql"
 "$ROOT/supabase/bootstrap/20260722_external_tenant_reference_foundation.sql"
 "$ROOT/supabase/bootstrap/20260724_customer_application_continuation_schema_foundation.sql"
 "$ROOT/supabase/bootstrap/20260801_company_capabilities_foundation.sql"
)

for file in "${foundation[@]}"; do apply_sql "$file"; done

# Build three Supabase-native ledger phases. Historical aliases become no-op
# migrations so the CLI records the official ledger without executing canonical
# SQL twice. Interleaved bootstrap SQL is direct, untracked prerequisite SQL.
python3 - "$LEDGER" "$HOLD" "$STAGED" "$MANIFEST_BEFORE" "$READINESS_BEFORE" <<'PY'
import hashlib,json,pathlib,shutil,sys
ledger_path=pathlib.Path(sys.argv[1])
migrations=pathlib.Path(sys.argv[2])
staged=pathlib.Path(sys.argv[3])
boundary2=sys.argv[4]
boundary3=sys.argv[5]
data=json.loads(ledger_path.read_text())
by={e['version']:e for e in data['entries']}
for phase in ('phase1','phase2','phase3'):
    (staged/phase).mkdir(parents=True,exist_ok=True)

def phase_for(version):
    if version < boundary2: return 'phase1'
    if version < boundary3: return 'phase2'
    return 'phase3'

for e in data['entries']:
    version=e['version']; name=e['name']
    target=staged/phase_for(version)/f"{version}_{name}.sql"
    alias=e.get('ledgerAliasOf')
    if alias:
        canonical=by.get(alias)
        if not canonical: raise SystemExit(f"invalid ledger alias {version} -> {alias}")
        rv=canonical.get('repositoryVersion',alias)
        source=migrations/f"{rv}_{canonical['name']}.sql"
        if not source.exists(): raise SystemExit(f"alias source missing: {source.name}")
        expected=e.get('checksum'); actual=hashlib.sha256(source.read_bytes()).hexdigest()
        if expected and actual != expected:
            raise SystemExit(f"ledger alias checksum mismatch {version}: {actual} != {expected}")
        target.write_text(
            f"-- AUD-003 ledger alias {version} -> {alias}.\n"
            f"-- Canonical SQL executes once at {alias}; this no-op only preserves official ledger provenance.\n"
        )
        continue

    rv=e.get('repositoryVersion')
    exact=migrations/f"{rv}_{name}.sql" if rv else None
    candidates=[exact] if exact and exact.exists() else sorted(migrations.glob(f"*_{name}.sql"))
    if len(candidates) != 1:
        raise SystemExit(f"ledger mapping for {version} {name} expected one file, found {len(candidates)}")
    source=candidates[0]
    expected=e.get('checksum'); actual=hashlib.sha256(source.read_bytes()).hexdigest()
    if expected and actual != expected:
        raise SystemExit(f"ledger source checksum mismatch {version} {name}: {actual} != {expected}")
    shutil.copyfile(source,target)
PY

install_phase(){
  local phase="$1"
  find "$STAGED/$phase" -maxdepth 1 -type f -name '*.sql' -print0 |
    sort -z |
    while IFS= read -r -d '' file; do
      cp "$file" "$MIGRATIONS/$(basename "$file")"
    done
}

install_phase phase1
supabase db push --local --include-all --yes

# canonical_migration_manifest now exists; add only its historical verification
# columns before v3 runtime/governance migrations. No ledger row is inserted.
apply_sql "$MANIFEST_BOOTSTRAP"

install_phase phase2
supabase db push --local --include-all --yes

# The July canonical finalization RPC existed in deployed history but is outside
# the official dev ledger. Restore it immediately before the August hardening
# migration that renames it to _internal_v1.
apply_sql "$READINESS_BOOTSTRAP"

install_phase phase3
supabase db push --local --include-all --yes

python3 - "$LEDGER" "$DB_URL" <<'PY'
import json,subprocess,sys
ledger=json.load(open(sys.argv[1])); db=sys.argv[2]
expected=[(e['version'],e['name']) for e in ledger['entries']]
query="select version::text||E'\\t'||name from supabase_migrations.schema_migrations order by version::text;"
out=subprocess.check_output(['psql',db,'-X','-At','-c',query],text=True)
actual=[tuple(line.split('\t',1)) for line in out.splitlines() if line]
if actual != expected:
    print('official ledger mismatch after Supabase CLI replay',file=sys.stderr)
    print('expected:',expected,file=sys.stderr); print('actual:',actual,file=sys.stderr)
    raise SystemExit(1)
print(f"[AUD-003 replay] Supabase CLI ledger verified: {len(actual)} official rows")
PY

psql "$DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
select
 to_regclass('public.companies') is not null as companies_ok,
 exists(select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='external_tenant_reference') as external_tenant_reference_ok,
 to_regclass('public.user_profiles') is not null as user_profiles_ok,
 to_regclass('public.admin_users') is not null as admin_users_ok,
 to_regprocedure('public.gridex_has_permission(uuid,text)') is not null as permission_helper_ok,
 to_regclass('public.customer_cases') is not null as customer_cases_ok,
 to_regclass('public.tenant_email_outbox') is not null as tenant_email_outbox_ok,
 to_regclass('public.integration_api_clients') is not null as integration_api_clients_ok,
 (select count(*) = 5 from information_schema.columns
    where table_schema='public' and table_name='integration_api_clients'
      and column_name in ('allowed_origins','deleted_at','profile_key','launch_ready','launch_blockers'))
      as integration_api_client_runtime_columns_ok,
 to_regclass('public.website_customer_applications') is not null as website_customer_applications_ok,
 to_regclass('public.customer_operation_jobs') is not null as customer_operation_jobs_ok,
 to_regclass('public.customer_application_workflows') is not null as customer_application_workflows_ok,
 to_regclass('public.customer_application_workflow_events') is not null as customer_application_workflow_events_ok,
 to_regclass('public.contract_publication_revisions') is not null as contract_publication_revisions_ok,
 to_regclass('public.webhook_subscriptions') is not null as webhook_subscriptions_ok,
 to_regclass('public.webhook_deliveries') is not null as webhook_deliveries_ok,
 to_regclass('public.company_email_settings') is not null as company_email_settings_ok,
 to_regclass('public.canonical_migration_manifest') is not null as canonical_migration_manifest_ok,
 (select count(*) = 4 from information_schema.columns
    where table_schema='public' and table_name='canonical_migration_manifest'
      and column_name in ('verified_at','verification_source','release_identifier','schema_fingerprint'))
      as migration_manifest_verification_columns_ok,
 to_regprocedure('public.gridex_contract_platform_readiness(uuid)') is not null as contract_platform_readiness_ok,
 to_regprocedure('public.gridex_contract_platform_readiness_internal_v1(uuid)') is not null as contract_platform_readiness_internal_ok,
 jsonb_typeof(public.gridex_contract_platform_readiness_internal_v1(gen_random_uuid())) = 'object' as contract_platform_readiness_internal_executes_ok,
 to_regclass('public.actor_test_results') is not null as actor_test_results_ok,
 to_regclass('public.ediel_test_runs') is not null as test_runs_ok,
 to_regclass('public.ediel_test_run_messages') is not null as test_run_messages_ok,
 to_regclass('public.ediel_test_run_steps') is not null as test_run_steps_ok,
 exists(select 1 from information_schema.columns where table_schema='public' and table_name='ediel_test_artifacts' and column_name='ediel_message_id') as artifact_message_ok,
 to_regtype('public.ediel_environment_type') is not null as environment_type_ok,
 to_regclass('public.ediel_production_readiness_checks') is not null as readiness_ok,
 to_regclass('public.ediel_certificates') is not null as certificates_ok,
 to_regclass('public.ediel_outbox') is not null as outbox_ok,
 to_regclass('public.grid_owner_information_requests') is not null as grid_owner_requests_ok,
 to_regclass('public.company_capabilities') is not null as capabilities_ok,
 to_regclass('public.ediel_message_intents') is not null as intents_ok;
SQL

echo '[AUD-003 replay] PASS: empty local Supabase -> explicit historical baseline -> Supabase-native official dev ledger replay'
