/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const migrationName = '20260807154500_gridex_ops_bl_006_contacts_and_lookup_cache_read_isolation.sql'
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName)
const additionsPath = path.join(root, 'scripts', 'migration-history-manifest.additions.json')
const pagePath = path.join(root, 'app', 'admin', 'network-owners', 'page.tsx')
const sqlRegressionPath = path.join(
  root,
  'scripts',
  'gridex-ops-bl-006-contacts-and-lookup-cache-read-isolation-regression.sql'
)

function fail(message) {
  console.error(`GRIDEX-OPS-BL-006 static regression failed: ${message}`)
  process.exit(1)
}

function check(condition, message) {
  if (!condition) fail(message)
}

check(fs.existsSync(migrationPath), `missing migration ${migrationName}`)
check(fs.existsSync(sqlRegressionPath), 'missing SQL rollback regression script')
check(fs.existsSync(pagePath), 'missing network-owners page')

const migrationSql = fs.readFileSync(migrationPath, 'utf8')
const checksum = crypto.createHash('sha256').update(fs.readFileSync(migrationPath)).digest('hex')
const additions = JSON.parse(fs.readFileSync(additionsPath, 'utf8'))
const pageSource = fs.readFileSync(pagePath, 'utf8')

const tables = [
  'platform_actor_contacts',
  'platform_address_lookup_cache',
  'platform_energy_lookup_cache',
]

for (const table of tables) {
  check(migrationSql.includes(`alter table public.${table} enable row level security`), `${table} RLS enable missing`)
  check(migrationSql.includes(`${table}_platform_admin_read`), `${table} platform-admin read policy missing`)
  check(migrationSql.includes(`${table}_service_role_read`), `${table} service-role read policy missing`)
  check(
    migrationSql.includes(`drop policy if exists ${table === 'platform_actor_contacts' ? 'platform_actor_contacts_auth_read' : `${table}_read`}`),
    `${table} broad read drop missing`
  )
}

check(migrationSql.includes("revoke select on table"), 'anon revoke missing')
check(migrationSql.includes('gridex_user_is_platform_admin()'), 'platform-admin helper missing')
check(!/auth\.uid\(\)\s+is\s+not\s+null/i.test(migrationSql.replace(/--.*$/gm, '')), 'migration still contains broad auth.uid() IS NOT NULL predicate')
check(additions.files?.[migrationName] === checksum, 'migration checksum missing or mismatched in additions manifest')

check(pageSource.includes("from '@/lib/supabase/service'"), 'network-owners page missing supabaseService import')
check(pageSource.includes('supabaseService'), 'network-owners page does not use supabaseService')
check(
  /supabaseService\s*\n?\s*\.from\('actor_registry_import_runs'\)/.test(pageSource),
  'import history must read actor_registry_import_runs via supabaseService after platform-admin gate'
)
check(
  !/createSupabaseServerClient[\s\S]*supabase\s*\n?\s*\.from\('actor_registry_import_runs'\)/.test(pageSource) ||
    /supabaseService\s*\n?\s*\.from\('actor_registry_import_runs'\)/.test(pageSource),
  'import history must not rely only on authenticated session client'
)

const consumerFiles = [
  'app/admin/ediel/route-readiness/page.tsx',
  'app/admin/ediel/route-readiness/actions.ts',
  'app/api/admin/ediel/supplier-contacts/export/route.ts',
  'lib/energy/resolver.ts',
]

for (const relative of consumerFiles) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  if (relative.includes('resolver')) {
    check(source.includes("from('platform_address_lookup_cache')"), `${relative} address cache consumer missing`)
    check(source.includes('supabaseService'), `${relative} must use service role for lookup cache`)
  } else {
    check(source.includes("from('platform_actor_contacts')"), `${relative} contacts consumer missing`)
    check(source.includes('supabaseService'), `${relative} must use service role for contacts`)
  }
}

console.log('GRIDEX-OPS-BL-006 static regression passed.')
console.log(`Migration: ${migrationName}`)
console.log(`Checksum: ${checksum}`)
