#!/usr/bin/env node

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const readBytes = (file) => fs.readFileSync(path.join(root, file))
const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const migrationPaths = [
  'supabase/migrations/20260827134553_tenant_integrity_auditor_v1.sql',
  'supabase/migrations/20260827134617_tenant_integrity_auditor_v1_uuid_aggregate_hotfix.sql',
  'supabase/migrations/20260827134827_tenant_integrity_effective_latest_views.sql',
  'supabase/migrations/20260827135630_tenant_integrity_requested_by_fk_index.sql',
  'supabase/migrations/20260827161000_tenant_integrity_outbound_schema_safe_v1.sql',
]
const migrationHashes = Object.fromEntries(
  migrationPaths.map((file) => [path.basename(file), crypto.createHash('sha256').update(readBytes(file)).digest('hex')])
)
const migrationManifest = JSON.parse(read('scripts/migration-history-manifest.additions.json'))

console.log('Tenant integrity migration SHA256:')
for (const [file, hash] of Object.entries(migrationHashes)) {
  console.log(`${file} ${hash}`)
}
for (const [file, hash] of Object.entries(migrationHashes)) {
  assert(migrationManifest.files?.[file] === hash, `migration provenance pin matches ${file}`)
}

const baseMigration = read(migrationPaths[0])
const aggregateHotfix = read(migrationPaths[1])
const latestViews = read(migrationPaths[2])
const requesterIndex = read(migrationPaths[3])
const outboundSchemaSafe = read(migrationPaths[4])
const service = read('lib/tenant/integrity.ts')
const page = read('app/admin/system/tenant-integrity/page.tsx')
const actions = read('app/admin/system/tenant-integrity/actions.ts')

for (const table of [
  'tenant_integrity_rule_registry',
  'tenant_integrity_audit_runs',
  'tenant_integrity_findings',
]) {
  assert(baseMigration.includes(`public.${table}`), `migration defines ${table}`)
}

for (const rule of [
  'TENANT-001',
  'ACCESS-001',
  'ACCESS-002',
  'ACCESS-003',
  'ACCESS-004',
  'ACCESS-005',
  'OPS-001',
  'OUTBOUND-001',
  'EDIEL-001',
  'EDIEL-002',
  'EDIEL-003',
  'EDIEL-004',
  'EDIEL-005',
  'EDIEL-006',
]) {
  assert(baseMigration.includes(`'${rule}'`), `rule registry contains ${rule}`)
}

assert(
  /security definer[\s\S]*set search_path = public, auth, pg_temp/i.test(baseMigration),
  'audit RPC uses a fixed search_path'
)
assert(
  /revoke all on function public\.run_tenant_integrity_audit\(uuid,text,uuid\) from public, anon, authenticated/i.test(baseMigration),
  'audit RPC is revoked from public/anon/authenticated'
)
assert(
  /grant execute on function public\.run_tenant_integrity_audit\(uuid,text,uuid\) to service_role/i.test(baseMigration),
  'audit RPC is service-role only'
)

for (const table of [
  'tenant_integrity_rule_registry',
  'tenant_integrity_audit_runs',
  'tenant_integrity_findings',
]) {
  assert(
    baseMigration.includes(`alter table public.${table} enable row level security`),
    `${table} has RLS enabled`
  )
  assert(
    baseMigration.includes(`alter table public.${table} force row level security`),
    `${table} has forced RLS`
  )
}

assert(
  /with \(security_invoker=true\)/i.test(baseMigration) && /with \(security_invoker=true\)/i.test(latestViews),
  'integrity views use security_invoker'
)
assert(
  latestViews.includes('(ar2.company_id=f.company_id or ar2.company_id is null)'),
  'latest findings allow tenant-specific runs to supersede global runs'
)
assert(
  latestViews.includes("where f.run_id=chosen.id and f.company_id=c.id"),
  'company summary counts only findings for the selected tenant'
)
assert(
  aggregateHotfix.includes("min(tep.id::text)::uuid"),
  'UUID aggregate hotfix is persisted'
)
assert(
  requesterIndex.includes('tenant_integrity_runs_requested_by_idx') && requesterIndex.includes('tenant_integrity_audit_runs(requested_by)'),
  'audit requested_by foreign key has a covering index'
)

assert(
  service.includes("supabaseService.rpc('run_tenant_integrity_audit'"),
  'server service calls canonical audit RPC'
)
assert(
  service.includes("tenant_integrity_company_summary_v") && service.includes("tenant_integrity_latest_findings_v"),
  'server service reads canonical summary/finding views'
)
assert(
  /\.from\('tenant_integrity_latest_findings_v'\)[\s\S]*?\.order\('severity',\s*\{\s*ascending:\s*true\s*\}\)[\s\S]*?\.order\('detected_at',\s*\{\s*ascending:\s*false\s*\}\)[\s\S]*?\.limit\(250\)/.test(service),
  'latest findings are severity-first before the UI limit so critical/high are not truncated away'
)
assert(
  page.includes('companies.reduce') && page.includes('critical_count') && page.includes('high_count'),
  'dashboard severity metrics use company summary aggregates instead of the truncated findings page'
)
assert(
  actions.includes('requirePlatformAdminActionAccess'),
  'audit mutation requires platform-admin action access'
)
assert(
  page.includes('requirePlatformAdminAccess'),
  'tenant integrity UI is platform-admin only'
)
assert(
  page.includes('runTenantIntegrityAuditAction'),
  'tenant integrity UI exposes explicit audit execution'
)

const outboundSafeSql = outboundSchemaSafe
assert(outboundSafeSql.includes('tenant_integrity_outbound_schema_safe'), 'OUTBOUND schema-safe migration is marked')
assert(outboundSafeSql.includes("'OUTBOUND-001'"), 'OUTBOUND schema-safe migration rewrites OUTBOUND-001')
assert(
  !/o\.supplier_switch_request_id|o\.switch_request_id|o\.customer_contract_id|o\.contract_id/.test(
    outboundSafeSql.split('$new$')[1] || ''
  ),
  'OUTBOUND-001 no longer references outbound_requests columns absent from the typed schema'
)
assert(
  /left join public\.metering_points mp on mp\.id=o\.metering_point_id/.test(outboundSafeSql),
  'OUTBOUND-001 still validates metering-point tenant linkage'
)

for (const unsafePattern of [
  /update\s+public\.company_memberships/i,
  /update\s+public\.customers/i,
  /update\s+public\.ediel_messages/i,
  /delete\s+from\s+public\.company_memberships/i,
  /delete\s+from\s+public\.customers/i,
]) {
  assert(!unsafePattern.test(baseMigration), 'audit engine never auto-repairs canonical business data')
}

console.log('\n✓ Tenant integrity regression passed.')
