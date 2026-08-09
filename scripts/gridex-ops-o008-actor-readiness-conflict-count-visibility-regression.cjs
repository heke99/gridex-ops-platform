/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const migrationName = '20260809131500_gridex_ops_o008_actor_readiness_conflict_count_visibility.sql'
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName)
const additionsPath = path.join(root, 'scripts', 'migration-history-manifest.additions.json')
const sqlRegressionPath = path.join(
  root,
  'scripts',
  'gridex-ops-o008-actor-readiness-conflict-count-visibility-regression.sql'
)
const readinessGuardPath = path.join(root, 'lib', 'ediel', 'outbox', 'readinessGuard.ts')
const autoReadinessPath = path.join(root, 'app', 'admin', 'ediel', 'auto-readiness', 'page.tsx')
const listGridOwnersPath = path.join(root, 'lib', 'masterdata', 'db.ts')

function fail(message) {
  console.error(`GRIDEX-OPS-O-008 static regression failed: ${message}`)
  process.exit(1)
}

function check(condition, message) {
  if (!condition) fail(message)
}

check(fs.existsSync(migrationPath), `missing migration ${migrationName}`)
check(fs.existsSync(sqlRegressionPath), 'missing SQL rollback regression script')
check(fs.existsSync(readinessGuardPath), 'missing readinessGuard')
check(fs.existsSync(autoReadinessPath), 'missing auto-readiness page')
check(fs.existsSync(listGridOwnersPath), 'missing masterdata db helper')

const migrationSql = fs.readFileSync(migrationPath, 'utf8')
const checksum = crypto.createHash('sha256').update(fs.readFileSync(migrationPath)).digest('hex')
const additions = JSON.parse(fs.readFileSync(additionsPath, 'utf8'))
const readinessGuard = fs.readFileSync(readinessGuardPath, 'utf8')
const autoReadiness = fs.readFileSync(autoReadinessPath, 'utf8')
const listGridOwners = fs.readFileSync(listGridOwnersPath, 'utf8')

check(
  migrationSql.includes('create or replace function public.gridex_actor_open_blocking_conflict_counts()'),
  'conflict-count helper missing'
)
check(migrationSql.includes('security definer'), 'helper must be SECURITY DEFINER')
check(migrationSql.includes("set search_path = public, pg_temp"), 'helper search_path hardening missing')
check(
  migrationSql.includes('gridex_actor_open_blocking_conflict_counts()'),
  'view patch must call conflict-count helper'
)
check(
  migrationSql.includes('revoke select on') && migrationSql.includes('actor_readiness_by_role_v'),
  'authenticated revoke for role dashboard views missing'
)
check(
  migrationSql.includes('grant select on') && migrationSql.includes('to service_role'),
  'service_role grant for role dashboard views missing'
)
check(
  !/create or replace view public\.actor_readiness_status[\s\S]*security_invoker\s*=\s*false/i.test(migrationSql),
  'must not disable security_invoker on actor_readiness_status'
)
check(
  additions.files?.[migrationName] === checksum,
  'migration checksum missing or mismatched in additions manifest'
)

check(readinessGuard.includes("from('actor_readiness_status')"), 'readinessGuard must read actor_readiness_status')
check(readinessGuard.includes('supabaseService'), 'readinessGuard must use service role')
check(autoReadiness.includes("from('actor_readiness_by_role_v')"), 'auto-readiness role summary consumer missing')
check(autoReadiness.includes('supabaseService'), 'auto-readiness must use service role for readiness views')
check(listGridOwners.includes("from(\"gridex_verified_grid_owners_v\")"), 'listGridOwners verified-view consumer missing')

console.log('GRIDEX-OPS-O-008 static regression passed.')
console.log(`Migration: ${migrationName}`)
console.log(`Checksum: ${checksum}`)
