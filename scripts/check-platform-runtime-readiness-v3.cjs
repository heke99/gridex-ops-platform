#!/usr/bin/env node
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const failures = []
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const assert = (condition, message) => { if (!condition) failures.push(message) }
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')

const runtime = read('lib/platform/schemaReadiness.ts')
assert(runtime.includes("PLATFORM_RUNTIME_CAPABILITY_VIEW = 'platform_runtime_readiness'"), 'runtime must read the persisted runtime readiness gate')
const resilience = read('supabase/migrations/20260813230000_runtime_readiness_dependency_resilience_v1.sql')
assert(resilience.includes('from public.gridex_runtime_schema_capabilities_v3'), 'persisted runtime readiness must be refreshed from the v3 capability view')
assert(!runtime.includes(".from('platform_schema_state')"), 'runtime must not gate traffic from legacy platform_schema_state')
assert(runtime.includes('PLATFORM_RUNTIME_FINGERPRINT_POLICY'), 'runtime must describe the fingerprint evidence policy')
assert(runtime.includes('evaluatePlatformSchemaReadiness'), 'runtime must evaluate the capability result through one canonical helper')
assert(!runtime.includes('schema_fingerprint_matches_release'), 'runtime must not reject compatible additive schema changes through an exact whole-schema hash pin')
assert(!runtime.includes('expected_schema_fingerprint'), 'runtime error details must not advertise a stale exact fingerprint')

const columns = read('supabase/migrations/20260803093000_platform_schema_runtime_columns_v3.sql')
for (const token of ['applied_ledger_version','applied_ledger_name','verification_kind','effect_verified','effect_evidence']) {
  assert(columns.includes(token), `reconciliation metadata is missing ${token}`)
}

const capabilities = read('supabase/migrations/20260803093100_gridex_runtime_capabilities_v3.sql')
for (const token of [
  'gridex_runtime_schema_catalog_v3','gridex_runtime_operational_integrity_v3','gridex_runtime_schema_capabilities_v3',
  'RUNTIME_COLUMN_MISSING','RUNTIME_RLS_POLICY_MISSING','DUPLICATE_PRIMARY_TENANT_WEBSITE_CLIENT',
  'pg_get_functiondef','security_invoker=true','grant select on public.gridex_runtime_schema_capabilities_v3 to service_role'
]) assert(capabilities.includes(token), `runtime capability migration is missing ${token}`)

const governance = read('supabase/migrations/20260803093200_gridex_migration_governance_v3.sql')
assert(!governance.includes("interval '24 hours'"), 'migration governance must not expire by wall-clock time')
for (const token of ['ledger_alias','schema_effect','MIGRATION_LEDGER_UNMAPPED_VERSION','gridex_migration_governance_v3']) {
  assert(governance.includes(token), `migration governance is missing ${token}`)
}

const repair = read('supabase/migrations/20260803093300_duplicate_primary_client_audit_contract_v3.sql')
for (const token of ['actor_type','request_id','correlation_id','resource_type','resource_id']) {
  assert(repair.includes(token), `duplicate repair audit contract is missing ${token}`)
}

const reconciliationV4File = '20260803212754_canonical_migration_readiness_reconciliation_v4.sql'
const reconciliationV4 = read(`supabase/migrations/${reconciliationV4File}`)
for (const token of [
  '20260803144819_contract_portfolio_area_billing_consistency.sql',
  '20260803145108_portfolio_lock_transition_immutability_fix.sql',
  '20260803145427_portfolio_superadmin_role_alignment.sql',
  '20260803150723_portfolio_mix_share_billing_completion.sql',
  '20260803152014_contract_portfolio_tenant_fk_indexes.sql',
  '20260803152236_portfolio_superadmin_helper_service_role_only.sql',
  'MIGRATION_LEDGER_UNMAPPED_VERSION',
  'MIGRATION_LEDGER_DUPLICATE_MAPPING',
]) assert(reconciliationV4.includes(token), `runtime readiness reconciliation v4 is missing ${token}`)
assert(!reconciliationV4.includes("interval '24 hours'"), 'canonical migration readiness must not expire by wall-clock time')
assert(!fs.existsSync(path.join(root, 'supabase/migrations/20260803152200_contract_portfolio_tenant_fk_indexes.sql')), 'stale local tenant FK migration version must not return')
assert(!fs.existsSync(path.join(root, 'supabase/migrations/20260803153500_portfolio_superadmin_helper_service_role_only.sql')), 'stale local helper privilege migration version must not return')

const postApplyV4 = read('scripts/post-apply-runtime-readiness-v4.sql')
for (const token of [
  '20260803212754',
  'canonical_migration_readiness_reconciliation_v4',
  'RUNTIME_CAPABILITIES_POSTFLIGHT_FAILED',
  'MIGRATION_GOVERNANCE_POSTFLIGHT_FAILED',
  'CANONICAL_READINESS_POSTFLIGHT_FAILED',
  'PLATFORM_SCHEMA_STATE_POSTFLIGHT_FAILED',
]) assert(postApplyV4.includes(token), `runtime readiness v4 post-apply is missing ${token}`)

const reconciliation = read('scripts/reconcile-live-platform-schema-2026-08-03.sql')
assert((reconciliation.match(/'ledger_alias'/g) ?? []).length === 10, 'live reconciliation must contain ten verified ledger aliases')
assert((reconciliation.match(/'ledger'/g) ?? []).length >= 9, 'live reconciliation must contain exact ledger mappings')
assert((reconciliation.match(/'schema_effect'/g) ?? []).length === 8, 'historical live reconciliation must contain eight schema-effect rows')
assert(reconciliation.includes('20260803093300-gridex-runtime-readiness-v3'), 'live reconciliation release id is stale')

const manifest = JSON.parse(read('scripts/migration-history-manifest.json'))
for (const file of [
  '20260803093000_platform_schema_runtime_columns_v3.sql',
  '20260803093100_gridex_runtime_capabilities_v3.sql',
  '20260803093200_gridex_migration_governance_v3.sql',
  '20260803093300_duplicate_primary_client_audit_contract_v3.sql',
  reconciliationV4File,
]) {
  assert(manifest.files?.[file] === sha256(`supabase/migrations/${file}`), `checksum manifest mismatch: ${file}`)
}

assert(!fs.existsSync(path.join(root, 'supabase/migrations/20260803093100_platform_schema_runtime_view_v3.sql')), 'abandoned duplicate 20260803093100 migration must not exist')

if (failures.length) {
  console.error(`Platform runtime readiness v3 static check failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('Platform runtime readiness compatibility static check passed.')
