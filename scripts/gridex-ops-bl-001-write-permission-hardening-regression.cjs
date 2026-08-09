/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const migrationName = '20260809143000_gridex_ops_bl_001_write_permission_hardening.sql'
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName)
const additionsPath = path.join(root, 'scripts', 'migration-history-manifest.additions.json')
const sqlRegressionPath = path.join(root, 'scripts', 'gridex-ops-bl-001-write-permission-hardening-regression.sql')
const tables = [
  'batch4c_security_checks',
  'customer_duplicate_resolution_events',
  'customer_lifecycle_decisions',
  'customer_merge_events',
  'customer_readiness_snapshots',
  'document_ai_extractions',
  'power_of_attorney_scopes',
]

function fail(message) { console.error(`GRIDEX-OPS-BL-001 static regression failed: ${message}`); process.exit(1) }
function check(condition, message) { if (!condition) fail(message) }

check(fs.existsSync(migrationPath), `missing migration ${migrationName}`)
check(fs.existsSync(sqlRegressionPath), 'missing SQL rollback regression')
const migrationSql = fs.readFileSync(migrationPath, 'utf8')
const checksum = crypto.createHash('sha256').update(fs.readFileSync(migrationPath)).digest('hex')
const additions = JSON.parse(fs.readFileSync(additionsPath, 'utf8'))

for (const table of tables) {
  check(migrationSql.includes(`'${table}'`), `${table} missing from migration inventory`)
  check(migrationSql.includes(`${table}`), `${table} migration coverage missing`)
}
check(migrationSql.includes("p.polcmd in ('*', 'a', 'w', 'd')"), 'write/ALL policy cleanup guard missing')
check(migrationSql.includes("r.rolname in ('anon', 'authenticated', 'authenticator')"), 'external-role cleanup scope missing')
check(migrationSql.includes("ilike '%company_memberships%'"), 'raw membership variant detection missing')
check(migrationSql.includes('public.gridex_can_write_company(company_id)'), 'canonical write helper missing')
check(migrationSql.includes('public.gridex_can_read_company(company_id)'), 'canonical read helper missing')
check(migrationSql.includes('company_id IS NOT NULL'), 'nullable/global company guard missing')
check(migrationSql.includes('bl001_raw_membership_write_policy_residual'), 'fail-closed residual check missing')
check(migrationSql.includes('bl001_canonical_write_policy_count'), 'canonical policy-count gate missing')
check(additions.files?.[migrationName] === checksum, 'migration checksum missing or mismatched in additions manifest')

console.log('GRIDEX-OPS-BL-001 static regression passed.')
console.log(`Migration: ${migrationName}`)
console.log(`Checksum: ${checksum}`)
