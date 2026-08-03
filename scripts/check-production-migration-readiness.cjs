#!/usr/bin/env node
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

function fail(message) {
  console.error(`PRODUCTION MIGRATION READINESS FAILED: ${message}`)
  process.exitCode = 1
}

execFileSync(process.execPath, ['scripts/check-migration-versions.cjs'], { stdio: 'inherit' })
execFileSync(process.execPath, ['scripts/generate-canonical-migration-inventory.cjs'], { stdio: 'inherit' })

const inventory = JSON.parse(fs.readFileSync('artifacts/migration-inventory-2026-08-02.json', 'utf8'))
const history = JSON.parse(fs.readFileSync('scripts/migration-history-manifest.json', 'utf8'))
const allowed = history.allowedLegacyCollisions ?? {}
const duplicates = inventory.duplicate_versions ?? []

for (const item of duplicates) {
  const files = (inventory.migrations ?? [])
    .filter((migration) => migration.version === item.version)
    .map((migration) => migration.filename)
    .sort()
  const expected = [...(allowed[item.version] ?? [])].sort()
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    fail(`undocumented migration collision ${item.version}: ${files.join(', ')}`)
  }
}

for (const version of Object.keys(allowed)) {
  if (!duplicates.some((item) => item.version === version)) {
    fail(`legacy collision allowlist is stale: ${version}`)
  }
}

if ((inventory.summary?.checksum_registered_count ?? 0) !== (inventory.summary?.sql_file_count ?? -1)) {
  fail('not every SQL migration has a registered checksum')
}
if ((inventory.summary?.ledger_eligible_count ?? 0) === 0) fail('no ledger-eligible migration versions were discovered')

for (const required of [
  '20260803093000_platform_schema_runtime_columns_v3.sql',
  '20260803093100_gridex_runtime_capabilities_v3.sql',
  '20260803093200_gridex_migration_governance_v3.sql',
  '20260803093300_duplicate_primary_client_audit_contract_v3.sql',
]) {
  const row = (inventory.migrations ?? []).find((migration) => migration.filename === required)
  if (!row?.checksum_registered) fail(`runtime-readiness migration is not checksum registered: ${required}`)
}

if (!fs.existsSync('scripts/reconcile-live-platform-schema-2026-08-03.sql')) {
  fail('controlled live migration/ledger reconciliation script is missing')
}

if (!process.exitCode) {
  const collisionSummary = duplicates.map((item) => `${item.version} (${item.count} documented files)`).join(', ')
  console.log(`Production migration readiness passed. Historical collisions are explicit aliases: ${collisionSummary || 'none'}.`)
}
