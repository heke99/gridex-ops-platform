/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const migrationName = '20260802190000_canonical_emergency_access_lockdown.sql'
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName)
const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

assert(fs.existsSync(migrationPath), `Missing ${migrationName}`)
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : ''

for (const owner of ['postgres', 'supabase_admin']) {
  assert(
    sql.includes(`alter default privileges for role ${owner} in schema public`),
    `${owner} default privileges are not handled`,
  )
}

for (const view of [
  'billing_export_readiness_v',
  'contract_publication_readiness_v',
  'gridex_tenant_contract_readiness_v',
  'gridex_tenant_email_dispatch_readiness_v',
]) {
  assert(
    sql.includes(`alter view public.${view}`) && sql.includes('security_invoker = true'),
    `${view} is not converted to security_invoker`,
  )
}

for (const signature of [
  'canonical_seed_company_capabilities(uuid)',
  'gridex_publish_contract_publication_version(uuid, uuid)',
  'gridex_refresh_billing_export_run(uuid, uuid)',
  'gridex_upsert_company_legal_profile_defaults(uuid)',
]) {
  assert(
    sql.includes(`revoke execute on function public.${signature}`),
    `${signature} does not revoke Data API execution`,
  )
}

for (const table of [
  'canonical_migration_manifest',
  'canonical_hardening_preflight_results',
]) {
  assert(sql.includes(`alter table public.${table} enable row level security`), `${table} RLS is not enabled`)
  assert(sql.includes(`alter table public.${table} force row level security`), `${table} RLS is not forced`)
}

assert(/ur\.company_id\s+is\s+null/i.test(sql), 'Global platform admin helper does not require company_id IS NULL')
assert(sql.includes('user_roles_global_platform_scope_guard'), 'Tenant-bound global role trigger is missing')
assert(sql.includes('tenant_bound_global_platform_role_forbidden'), 'Tenant-bound global role rejection is missing')
assert(!/drop\s+policy[\s\S]*for\s+.+pg_policies/i.test(sql), 'Emergency migration must not blindly drop policy inventory')

if (failures.length > 0) {
  console.error(`Canonical emergency access regression failed (${failures.length})`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Canonical emergency access regression passed (views, RPCs, defaults, internal tables and global-role scope).')
