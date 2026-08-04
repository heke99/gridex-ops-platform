#!/usr/bin/env node
const fs = require('node:fs')
const crypto = require('node:crypto')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}
function check(condition, message) {
  if (!condition) throw new Error(message)
}
function includes(path, needles) {
  const value = read(path)
  for (const needle of needles) check(value.includes(needle), `${path} saknar: ${needle}`)
}

const version = '2026-08-04.2'
const migration = 'supabase/migrations/20260804173000_price_area_assurance_and_pricing_readiness.sql'
const migrationName = migration.split('/').at(-1)
const manifest = JSON.parse(read('scripts/migration-history-manifest.json'))
const checksum = crypto.createHash('sha256').update(fs.readFileSync(migration)).digest('hex')
check(manifest.files?.[migrationName] === checksum, 'Migrationens checksum saknas eller är fel.')

includes('lib/energy/resolver.ts', [
  'MIN_POSTAL_PRICE_ASSURANCE_CONFIDENCE = 0.8',
  "status: 'estimated'",
  "conflictCode: mappingConflictCount > 0 ? 'postal_mapping_master_conflict' : 'postal_price_area_ambiguous'",
  'mappingConflictCount',
  'postal_price_area_fallback_used',
  'price_area_assurance_status: resolved.priceAreaAssurance.status',
])
includes('lib/energy/resolutionBinding.ts', [
  'MIN_ESTIMATED_PRICE_ASSURANCE_CONFIDENCE = 0.8',
  'priceAreaEvidenceAccepted',
  "'price_area_ambiguous'",
  "'price_area_evidence_expired'",
  'switch_dispatch_ready: false',
])
includes('app/api/v1/website/energy-area/resolve/route.ts', [
  'price_area_assurance:',
  'priceAreaAssuranceStatus: resolution.priceAreaAssurance.status',
])
includes(migration, [
  'price_area_assurance_status',
  'customer_site_resolution_price_area_assurance_consistency_check',
  'Historical postal suggestions are deliberately',
])

const current = JSON.parse(read('docs/openapi/website-integration-v1.json'))
const released = JSON.parse(read(`docs/openapi/releases/${version}/website-integration-v1.json`))
check(current.info.version === version, 'Current Website OpenAPI har fel version.')
check(current['x-contract-schema-version'] === version, 'Website x-contract version är fel.')
check(JSON.stringify(current) === JSON.stringify(released), 'Immutable Website OpenAPI matchar inte current.')
check(Boolean(current.components.schemas.PriceAreaAssurance), 'PriceAreaAssurance saknas i OpenAPI.')
check(
  current.components.schemas.WebsiteEnergyAreaResolution.required.includes('price_area_assurance'),
  'price_area_assurance är inte obligatoriskt i resolver-svaret.',
)
check(
  Boolean(current.paths[`/api/v1/openapi/${version}/website-integration-v1.json`]),
  'Versionssatt Website OpenAPI-route saknas i kontraktet.',
)

const portalCurrent = JSON.parse(read('docs/openapi/customer-portal-v1.json'))
const portalReleased = JSON.parse(read(`docs/openapi/releases/${version}/customer-portal-v1.json`))
check(portalCurrent.info.version === version, 'Current portal OpenAPI har fel version.')
check(JSON.stringify(portalCurrent) === JSON.stringify(portalReleased), 'Immutable portal OpenAPI matchar inte current.')

console.log('Price-area assurance, database migration and OpenAPI release verified.')
