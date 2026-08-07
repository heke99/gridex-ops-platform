#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
SEED="$ROOT/supabase/seed.sql"
LEDGER="$ROOT/scripts/gridex-aud-003-main-ledger.json"
HOLD="$(mktemp -d)"
SEED_BACKUP="$(mktemp)"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
cleanup(){ set +e; supabase stop --no-backup >/dev/null 2>&1 || true; rm -f "$MIGRATIONS"/*.sql; cp -a "$HOLD"/. "$MIGRATIONS"/ 2>/dev/null || true; cp "$SEED_BACKUP" "$SEED" 2>/dev/null || true; rm -rf "$HOLD" "$SEED_BACKUP"; }
trap cleanup EXIT
command -v supabase >/dev/null; command -v psql >/dev/null; command -v python3 >/dev/null
cp -a "$MIGRATIONS"/. "$HOLD"/; cp "$SEED" "$SEED_BACKUP"; rm -f "$MIGRATIONS"/*.sql; : > "$SEED"
supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector
apply_sql(){ local file="$1"; echo "[AUD-003 replay] applying ${file#$ROOT/}"; psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$file"; }
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
 "$ROOT/supabase/bootstrap/20260724_customer_application_continuation_schema_foundation.sql"
 "$ROOT/supabase/bootstrap/20260801_company_capabilities_foundation.sql"
)
for file in "${foundation[@]}"; do test -f "$file" || { echo "missing foundation $file" >&2; exit 1; }; apply_sql "$file"; done
python3 - "$LEDGER" "$HOLD" <<'PY' > "$HOLD/.aud003-ledger-paths"
import hashlib,json,pathlib,sys
ledger=pathlib.Path(sys.argv[1]); migrations=pathlib.Path(sys.argv[2]); data=json.loads(ledger.read_text()); by={e['version']:e for e in data['entries']}
for e in data['entries']:
 a=e.get('ledgerAliasOf')
 if a:
  t=by.get(a); rv=t.get('repositoryVersion',a); exact=migrations/f"{rv}_{t['name']}.sql"; exp=e.get('checksum')
  if not t or not exact.exists(): raise SystemExit(f"invalid ledger alias {e['version']}")
  if exp and hashlib.sha256(exact.read_bytes()).hexdigest()!=exp: raise SystemExit(f"ledger alias checksum mismatch {e['version']}")
  print(f"[AUD-003 replay] ledger alias {e['version']} -> {a} ({exact.name}); no duplicate SQL execution",file=sys.stderr); continue
 rv=e.get('repositoryVersion'); name=e['name']; exact=migrations/f"{rv}_{name}.sql" if rv else None; candidates=[exact] if exact and exact.exists() else sorted(migrations.glob(f"*_{name}.sql"))
 if len(candidates)!=1: raise SystemExit(f"ledger mapping for {e['version']} {name} expected one file, found {len(candidates)}")
 print(candidates[0])
PY
while IFS= read -r file; do
  if [[ "$(basename "$file")" == "20260803093000_platform_schema_runtime_columns_v3.sql" ]]; then
    apply_sql "$ROOT/supabase/bootstrap/20260802_canonical_migration_manifest_verification_foundation.sql"
  fi
  apply_sql "$file"
done < "$HOLD/.aud003-ledger-paths"
psql "$DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
select to_regclass('public.companies') is not null as companies_ok,
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
 to_regclass('public.webhook_subscriptions') is not null as webhook_subscriptions_ok,
 to_regclass('public.webhook_deliveries') is not null as webhook_deliveries_ok,
 to_regclass('public.company_email_settings') is not null as company_email_settings_ok,
 to_regclass('public.canonical_migration_manifest') is not null as canonical_migration_manifest_ok,
 (select count(*) = 4 from information_schema.columns
    where table_schema='public' and table_name='canonical_migration_manifest'
      and column_name in ('verified_at','verification_source','release_identifier','schema_fingerprint'))
      as migration_manifest_verification_columns_ok,
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
echo '[AUD-003 replay] PASS: empty local Supabase -> explicit historical baseline -> main-aligned official dev ledger'
