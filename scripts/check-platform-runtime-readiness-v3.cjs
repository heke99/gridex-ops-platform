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
assert(runtime.includes("gridex_runtime_schema_capabilities_v3"), 'runtime must read the v3 capability view')
assert(!runtime.includes(".from('platform_schema_state')"), 'runtime must not gate traffic from legacy platform_schema_state')
assert(runtime.includes('EXPECTED_PLATFORM_SCHEMA_FINGERPRINT'), 'runtime must pin the verified schema fingerprint')

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

const reconciliation = read('scripts/reconcile-live-platform-schema-2026-08-03.sql')
assert((reconciliation.match(/'ledger_alias'/g) ?? []).length === 10, 'live reconciliation must contain ten verified ledger aliases')
assert((reconciliation.match(/'ledger'/g) ?? []).length >= 9, 'live reconciliation must contain exact ledger mappings')
assert((reconciliation.match(/'schema_effect'/g) ?? []).length === 7, 'live reconciliation must contain seven schema-effect rows')
assert(reconciliation.includes('20260803093300-gridex-runtime-readiness-v3'), 'live reconciliation release id is stale')

const manifest = JSON.parse(read('scripts/migration-history-manifest.json'))
for (const file of [
  '20260803093000_platform_schema_runtime_columns_v3.sql',
  '20260803093100_gridex_runtime_capabilities_v3.sql',
  '20260803093200_gridex_migration_governance_v3.sql',
  '20260803093300_duplicate_primary_client_audit_contract_v3.sql',
]) {
  assert(manifest.files?.[file] === sha256(`supabase/migrations/${file}`), `checksum manifest mismatch: ${file}`)
}

assert(!fs.existsSync(path.join(root, 'supabase/migrations/20260803093100_platform_schema_runtime_view_v3.sql')), 'abandoned duplicate 20260803093100 migration must not exist')

if (failures.length) {
  console.error(`Platform runtime readiness v3 static check failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('Platform runtime readiness v3 static check passed.')
