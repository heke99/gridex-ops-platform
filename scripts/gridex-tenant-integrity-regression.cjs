#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const baseMigration = read('supabase/migrations/20260827134553_tenant_integrity_auditor_v1.sql')
const aggregateHotfix = read('supabase/migrations/20260827134617_tenant_integrity_auditor_v1_uuid_aggregate_hotfix.sql')
const latestViews = read('supabase/migrations/20260827134827_tenant_integrity_effective_latest_views.sql')
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
  service.includes("supabaseService.rpc('run_tenant_integrity_audit'"),
  'server service calls canonical audit RPC'
)
assert(
  service.includes("tenant_integrity_company_summary_v") && service.includes("tenant_integrity_latest_findings_v"),
  'server service reads canonical summary/finding views'
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
