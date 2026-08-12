/* eslint-disable @typescript-eslint/no-require-imports */
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const migrationName = '20260811155851_post_108_health_security_residuals.sql'
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName)
const additionsPath = path.join(root, 'scripts', 'migration-history-manifest.additions.json')
const typesManifestPath = path.join(root, 'scripts', 'supabase-types-manifest.json')
const brokenTip = path.join(
  root,
  'supabase/migrations/20260811080000_remaining_masterpoint_convergence.sql',
)

function fail(message) {
  console.error(`GRIDEX post-#108 health residuals failed: ${message}`)
  process.exit(1)
}

function check(condition, message) {
  if (!condition) fail(message)
}

check(fs.existsSync(migrationPath), `missing forward migration ${migrationName}`)
const migrationSql = fs.readFileSync(migrationPath, 'utf8')
const checksum = crypto.createHash('sha256').update(fs.readFileSync(migrationPath)).digest('hex')
const additions = JSON.parse(fs.readFileSync(additionsPath, 'utf8'))
const typesManifest = JSON.parse(fs.readFileSync(typesManifestPath, 'utf8'))
const tipSql = fs.readFileSync(brokenTip, 'utf8')

check(
  tipSql.includes(
    'grant execute on function public.canonical_run_architecture_reconciliation(uuid) to authenticated, service_role',
  ),
  'expected #108 tip grant regression marker missing; residual may be stale',
)

check(
  migrationSql.includes(
    'revoke all on function public.canonical_run_architecture_reconciliation(uuid)\n  from public, anon, authenticated',
  ) ||
    migrationSql.includes(
      'revoke all on function public.canonical_run_architecture_reconciliation(uuid) from public, anon, authenticated',
    ),
  'reconciliation EXECUTE is not revoked from authenticated',
)
check(
  migrationSql.includes(
    'grant execute on function public.canonical_run_architecture_reconciliation(uuid)\n  to service_role',
  ) ||
    migrationSql.includes(
      'grant execute on function public.canonical_run_architecture_reconciliation(uuid) to service_role',
    ),
  'reconciliation EXECUTE is not restored to service_role only',
)
check(
  !/grant execute on function public\.canonical_run_architecture_reconciliation\(uuid\)\s+to authenticated/i.test(
    migrationSql,
  ),
  'residual migration still grants reconciliation EXECUTE to authenticated',
)

const checkErrorKeys = [
  'check-error:active-membership-missing-role',
  'check-error:role-without-auth-identity',
  'check-error:duplicate-active-membership',
  'check-error:duplicate-active-role',
  'check-error:accepted-invite-without-access',
  'check-error:active-api-client-not-launch-ready',
  'check-error:deprecated-canonical-event-bus-backlog',
  'check-error:due-stranded-event-outbox',
  'check-error:provisioning-dead-letter',
  'check-error:stuck-provisioning',
  'check-error:manual-review-over-sla',
  'check-error:manual-review-without-owner-or-sla',
  'check-error:customer-application-without-repair-workflow',
  'check-error:contract-missing-customer-or-site',
  'check-error:contract-without-metering-point',
  'check-error:switch-without-contract',
  'check-error:ediel-live-without-valid-tenant',
  'check-error:invalid-tenant-lifecycle-projection',
]
for (const key of checkErrorKeys) {
  check(migrationSql.split(key).length >= 3, `check-error clears incomplete for ${key}`)
  check(
    migrationSql.includes(`'${key}', 'reconciliation', 'critical',\n      `) ||
      migrationSql.includes(`'${key}','reconciliation','critical',`),
    `check-error key missing structured writes: ${key}`,
  )
}

check(
  migrationSql.includes("'due-stranded-canonical-outbox'") &&
    migrationSql.includes("check-error:due-stranded-canonical-outbox"),
  'legacy due-stranded-canonical-outbox finding key is not drained',
)

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

const latestMigration = typesManifest.latest_migration
check(
  typeof latestMigration === 'string' && /^\d{14}_.+\.sql$/.test(latestMigration),
  'generated-types manifest latest_migration is missing or malformed',
)
check(
  latestMigration.localeCompare(migrationName) >= 0,
  `generated-types migration tip predates the post-#108 residual: ${latestMigration}`,
)
check(
  fs.existsSync(path.join(root, 'supabase', 'migrations', latestMigration)),
  `generated-types migration tip does not exist in canonical migrations: ${latestMigration}`,
)

console.log('GRIDEX post-#108 health residuals static regression passed.')
console.log(`Migration: ${migrationName}`)
console.log(`Generated-types tip: ${latestMigration}`)
console.log(`Checksum: ${checksum}`)
