/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

const importer = read('lib/energy/svkGeometryImport.ts')
const cron = read('app/api/internal/platform/grid-areas/import/cron/route.ts')
const migrationName = '20260804190000_svk_geodata_and_billing_price_area_canonicalization.sql'
const migration = read(`supabase/migrations/${migrationName}`)
const guardMigrationName = '20260804193000_contract_price_snapshot_company_guard_fix.sql'
const guardMigration = read(`supabase/migrations/${guardMigrationName}`)
const underlay = read('lib/billing/underlayEngine.ts')
const readiness = read('lib/billing/invoiceReadiness.ts')
const apiDocs = read('docs/gridex-customer-portal-api.md')
const guide = read('docs/external-website-api-integration-guide.md')
const openapi = JSON.parse(read('docs/openapi/website-integration-v1.json'))
const manifest = JSON.parse(read('scripts/migration-history-manifest.json'))

assert.match(importer, /Natomraden_250526\/FeatureServer/)
assert.match(importer, /DEFAULT_SVK_GRID_AREA_LAYER_ID = 3/)
assert.match(importer, /orderByFields', 'OBJECTID ASC'/)
for (const field of ['Natomrade', 'Namn', 'Agare', 'Elomrade']) {
  assert.ok(importer.includes(field), `Importer saknar ${field}`)
  assert.ok(migration.includes(`'${field}'`), `Migration saknar ${field}`)
}
assert.match(cron, /svk_import_source_superseded/)
assert.match(migration, /billing_underlay_price_area_mismatch/)
assert.match(migration, /billing_underlays_price_area_snapshot_guard/)
assert.doesNotMatch(guardMigration, /new\.customer_contract_id/)
assert.match(guardMigration, /new\.contract_id/)
assert.match(guardMigration, /contract_price_snapshot_contract_not_found/)
assert.match(underlay, /snapshotArea \?\? contractArea/)
assert.match(underlay, /Låst prisområde saknas i avtalets prissnapshot/)
assert.match(underlay, /price_area: priceArea/)
assert.match(underlay, /source_price_area:/)
assert.match(readiness, /resolveCanonicalBillingPriceArea/)
assert.match(readiness, /price_area_snapshot_mismatch/)
assert.match(readiness, /underlay\.price_area/)
assert.match(readiness, /contract_price_snapshot_missing/)
assert.match(readiness, /snapshotsById/)
assert.match(apiDocs, /låsta `price_area` från quote-\/avtalssnapshoten/)
assert.match(guide, /Databasen avvisar även direkt skrivning/)
assert.equal(openapi.info.version, '2026-08-04.2')
assert.equal(typeof manifest.files[migrationName], 'string')
assert.equal(typeof manifest.files[guardMigrationName], 'string')
assert.equal(manifest.files[migrationName].length, 64)
assert.equal(manifest.files[guardMigrationName].length, 64)

console.log('SVK geodata and billing price-area regression passed.')
