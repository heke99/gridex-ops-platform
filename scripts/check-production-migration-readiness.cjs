#!/usr/bin/env node
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

function fail(message) {
  console.error(`PRODUCTION MIGRATION READINESS FAILED: ${message}`)
  process.exitCode = 1
}

execFileSync(process.execPath, ['scripts/check-migration-versions.cjs'], {
  stdio: 'inherit',
})
execFileSync(process.execPath, ['scripts/generate-canonical-migration-inventory.cjs'], {
  stdio: 'inherit',
})
const inventory = JSON.parse(
  fs.readFileSync('artifacts/migration-inventory-2026-08-02.json', 'utf8'),
)
const duplicates = inventory.duplicate_versions ?? []
if (duplicates.length > 0) {
  fail(
    `historical duplicate Supabase migration versions remain: ${duplicates
      .map((item) => `${item.version} (${item.count} files)`)
      .join(', ')}. Do not repair the live ledger until a clean reconstruction proves a canonical alias/normalization plan.`,
  )
}
if ((inventory.summary?.checksum_registered_count ?? 0) !== (inventory.summary?.sql_file_count ?? -1)) {
  fail('not every SQL migration has a registered checksum')
}
if ((inventory.summary?.ledger_eligible_count ?? 0) === 0) {
  fail('no ledger-eligible migration versions were discovered')
}
if (!process.exitCode) {
  console.log('Production migration readiness passed.')
}
