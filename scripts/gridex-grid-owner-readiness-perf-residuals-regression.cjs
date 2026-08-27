#!/usr/bin/env node
/**
 * Regression: post-#231 grid-owner readiness performance residuals.
 *
 * Guards:
 *  1. Backfill only links platform↔OPS owners when the match set is unique
 *     (match_count = 1 and target_count = 1), matching identifier normalization v3.
 *  2. Verification persistence skips fan-out view rows (count(*) = 1 gate).
 *  3. EXECUTE remains service_role-only after CREATE OR REPLACE.
 *  4. App consumers fail closed / dedupe on verified-view fan-out.
 */
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

let failures = 0
function expect(condition, message) {
  if (!condition) {
    failures += 1
    console.error(`FAIL: ${message}`)
  } else {
    console.log(`OK: ${message}`)
  }
}

const migration = read('supabase/migrations/20260827141000_grid_owner_backfill_unique_ops_link_guard.sql')
const verification = read('lib/grid-owners/verification.ts')
const masterdata = read('lib/masterdata/db.ts')
const normalization = read('supabase/migrations/20260812151500_gridex_ops_grid_owner_identifier_normalization_v3.sql')
const manifest = JSON.parse(read('scripts/migration-history-manifest.json'))
const manifestFiles = manifest.files || {}

for (const name of [
  '20260827111400_add_actor_identifier_ediel_lookup_index.sql',
  '20260827124127_optimize_grid_owner_actor_matching_regression_safe_v2.sql',
  '20260827125003_optimize_platform_grid_owner_sync_join.sql',
  '20260827125221_optimize_grid_owner_backfill_antijoins_v2.sql',
  '20260827130351_skip_noop_grid_owner_link_writes.sql',
  '20260827141000_grid_owner_backfill_unique_ops_link_guard.sql',
]) {
  expect(Boolean(manifestFiles[name]), `checksum manifest registers ${name}`)
}

expect(
  migration.includes('CREATE OR REPLACE FUNCTION public.gridex_backfill_grid_owner_verification'),
  'forward migration replaces gridex_backfill_grid_owner_verification'
)
expect(
  /classified as \([\s\S]*match_count[\s\S]*target_counts as \([\s\S]*unique_matched as \(/m.test(migration),
  'platform sync classifies matches and keeps only unique_matched rows'
)
expect(
  migration.includes('c.match_count = 1') && migration.includes('tc.target_count = 1'),
  'platform sync requires match_count = 1 and target_count = 1'
)
expect(
  normalization.includes('c.candidate_count = 1') && normalization.includes('c.target_count = 1'),
  'unique-match guard mirrors identifier normalization v3 invariants'
)
expect(
  (migration.match(/having count\(\*\) = 1/g) || []).length >= 3,
  'verification link/persist/review paths require a single verified-view row per owner'
)
expect(
  migration.includes('revoke execute on function public.gridex_backfill_grid_owner_verification(text) from public') &&
    migration.includes('revoke execute on function public.gridex_backfill_grid_owner_verification(text) from anon') &&
    migration.includes('revoke execute on function public.gridex_backfill_grid_owner_verification(text) from authenticated') &&
    migration.includes('grant execute on function public.gridex_backfill_grid_owner_verification(text) to service_role'),
  'CREATE OR REPLACE re-asserts service_role-only EXECUTE'
)
expect(
  !/from matched m\s+join public\.grid_owners g on g\.id = m\.grid_owner_id\s+where pgo\.id = m\.pgo_id/m.test(migration),
  'ambiguous matched CTE is not used directly for platform_grid_owners updates'
)

expect(verification.includes(".limit(2)"), 'getGridOwnerVerification loads at most two verified-view rows')
expect(
  verification.includes('grid_owner_verification_ambiguous'),
  'getGridOwnerVerification fails closed on verified-view fan-out'
)
expect(
  /from\('gridex_verified_grid_owners_v'\)[\s\S]*?\.limit\(2\)/.test(verification) &&
    !/from\('gridex_verified_grid_owners_v'\)[\s\S]*?\.maybeSingle\(\)/.test(
      verification.slice(
        verification.indexOf("from('gridex_verified_grid_owners_v')"),
        verification.indexOf("from('grid_owners')"),
      ),
    ),
  'verified-view lookup uses limit(2) and does not use maybeSingle'
)
expect(
  masterdata.includes('dedupedById') && masterdata.includes('readinessScore'),
  'listGridOwners dedupes fan-out rows by grid owner id with readiness preference'
)

if (failures > 0) {
  console.error(`\n${failures} regression check(s) failed`)
  process.exit(1)
}

console.log('\nAll grid-owner readiness residual checks passed')
