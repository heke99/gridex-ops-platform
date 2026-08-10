/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const migrationName = '20260810230000_gridex_ops_o008_public_privilege_hardening.sql'
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName)
const additionsPath = path.join(root, 'scripts', 'migration-history-manifest.additions.json')
const typesManifestPath = path.join(root, 'scripts', 'supabase-types-manifest.json')
const controlsPath = path.join(root, 'scripts', 'gridex-canonical-architecture-57-point-regression.cjs')

function fail(message) {
  console.error(`GRIDEX-OPS-O-008 PUBLIC privilege residual failed: ${message}`)
  process.exit(1)
}
function check(condition, message) {
  if (!condition) fail(message)
}

check(fs.existsSync(migrationPath), `missing migration ${migrationName}`)
const migrationSql = fs.readFileSync(migrationPath, 'utf8')
const checksum = crypto.createHash('sha256').update(fs.readFileSync(migrationPath)).digest('hex')
const additions = JSON.parse(fs.readFileSync(additionsPath, 'utf8'))
const typesManifest = JSON.parse(fs.readFileSync(typesManifestPath, 'utf8'))
const controls = fs.readFileSync(controlsPath, 'utf8')

check(
  migrationSql.includes('revoke all privileges on public.actor_readiness_status from public, anon'),
  'PUBLIC revoke for actor_readiness_status missing',
)
check(
  migrationSql.includes('from public, anon, authenticated'),
  'PUBLIC revoke for dashboard readiness views missing',
)
check(migrationSql.includes('anon_still_has_actor_readiness_status_select'), 'anon fail-closed check missing')
check(
  migrationSql.includes('readiness_dashboard_still_externally_selectable'),
  'dashboard fail-closed check missing',
)
check(
  migrationSql.includes('grant select on public.actor_readiness_status to authenticated, service_role'),
  'authenticated readiness SELECT restore missing',
)
check(
  additions.files?.[migrationName] === checksum,
  'migration checksum missing or mismatched in additions manifest',
)
check(
  typesManifest.latest_migration === migrationName,
  'generated-types migration tip is not pinned to the O-008 PUBLIC residual',
)
check(
  controls.includes(`latest_migration === '${migrationName}'`),
  'C56 still pins the pre-residual migration tip',
)

console.log('GRIDEX-OPS-O-008 PUBLIC privilege residual static regression passed.')
console.log(`Migration: ${migrationName}`)
console.log(`Checksum: ${checksum}`)
