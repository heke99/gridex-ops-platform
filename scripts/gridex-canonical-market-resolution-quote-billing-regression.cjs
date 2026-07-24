#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const failures = []
let checks = 0
function read(rel) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) { failures.push(`${rel} saknas`); return '' }
  return fs.readFileSync(full, 'utf8')
}
function check(value, message) { checks += 1; if (!value) failures.push(message) }
function includes(rel, needles, message) {
  const value = read(rel)
  check(needles.every((needle) => value.includes(needle)), message)
}
function excludes(rel, needles, message) {
  const value = read(rel)
  check(needles.every((needle) => !value.includes(needle)), message)
}
function json(rel) {
  try { return JSON.parse(read(rel)) } catch (error) { failures.push(`${rel} ogiltig JSON: ${error.message}`); return {} }
}

includes('lib/pricing/spot/intervalCoverage.ts', [
  'stockholmLocalToUtc', 'duplicate_interval', "code: 'gap'", "code: 'overlap'",
  'expectedDurationMinutes', 'coveredDurationMinutes',
], 'Dygnsvalideringen ska använda tidsmässig Stockholm-coverage och hitta luckor/överlapp/dubletter')
includes('__tests__/spot-interval-coverage.test.ts', ['96', '92', '100', 'gap', 'overlap', 'duplicate'], 'DST- och kvalitetsregressioner ska finnas')
includes('lib/pricing/spot/elprisetJustNuClient.ts', ['AbortController', 'retry-after', '429', 'content-type', 'provider_not_published'], 'Providerklienten ska ha timeout, bounded retry och payloadvalidering')
includes('lib/pricing/spot/spotImportJobs.ts', ['gridex_claim_spot_price_import_job', 'retry_wait', 'maxAttempts = 5'], 'Importen ska använda canonical jobb och bounded retries')
includes('lib/pricing/spot/spotPriceImporter.ts', ['validateSpotPriceDay', 'market_price.import.started', 'market_price.period.verified', 'rebuildRollingMarketPreview'], 'Importen ska validera full coverage och skriva audit/preview')
excludes('lib/pricing/spot/spotPriceImporter.ts', ["intervals.length > 0 ? 'complete'"], 'Minst en prisrad får inte markera dygn komplett')

includes('lib/pricing/priceSourceResolver.ts', ["purpose === \"quote_preview\"", ".eq(\"status\", \"locked\")", 'market_price_previews'], 'Preview och settlement ska använda separata datakällor')
includes('lib/pricing/marketPriceSources.ts', ["row.status !== 'locked'", 'is_indicative'], 'Settlementpolicy ska kräva locked och icke-indikativ data')
includes('lib/pricing/spot/settlementLocker.ts', ['gridex_lock_spot_price_month'], 'Explicit settlement-lock wrapper ska finnas')
includes('app/api/internal/spot/lock-month/route.ts', ["requireAdminApiAccess(['pricing.write'])", 'lockSpotSettlementMonth', 'market_price_incomplete'], 'Settlement ska låsas genom en explicit behörighetskontrollerad operatörsrutt')
includes('__tests__/spot-settlement-separation.test.ts', ['locked', 'is_indicative', "dataKind: 'settlement'"], 'Regression ska hindra preview/verified data som settlement')

includes('lib/energy/resolutionBinding.ts', ['resolution_tenant_mismatch', 'resolution_expired', 'resolution_not_automation_ready'], 'Resolution ska valideras tenantbundet, med expiry och automation-readiness')
includes('lib/energy/resolver.ts', ['grid_area_address_mismatch', 'geodataVersion', 'resolverVersion', 'automationAllowed: false'], 'Resolvern ska korsvalidera claims och spara provenance')
includes('lib/pricing/offerQuote.ts', ['resolutionBindingRequired', 'loadBoundEnergyResolution', 'quote_resolution_mismatch', 'market_reference'], 'Quote ska bindas till tenantresolution och marknadsproveniens')
includes('lib/pricing/websiteQuotes.ts', ['quote_hash', 'computedQuoteHash', 'quote_hash_mismatch', 'resolution_snapshot', 'loadBoundEnergyResolution', 'canonicalPriceArea'], 'Quote ska vara hashad, immutable och validera aktuell tenantresolution utan att kräva ett klientvalt price_area')
includes('lib/website/customerApplications.ts', ['quote_reference_required', 'resolution_id', 'billing_price_snapshot.created', 'patchMeteringPointEnergyContext'], 'Ansökan ska kräva quote/resolution och patcha canonical mätpunktskontext')
excludes('lib/website/customerApplications.ts', ['quoteValidation = null'], 'Teckning får inte falla tillbaka till avtal utan canonical quote')

includes('supabase/migrations/20260724120000_canonical_market_resolution_quote_billing_flow.sql', [
  'spot_price_import_jobs', 'market_price_previews', 'gridex_lock_spot_price_month',
  'gridex_reject_locked_market_price_mutation', 'energy_geodata_versions',
  'canonical_energy_flow_events', 'canonical_energy_remediation_queue',
  'gridex_stuck_spot_import_jobs_v', 'gridex_quotes_without_canonical_resolution_v',
], 'Migrationen ska innehålla jobb, preview, immutable settlement, geodata, audit och diagnostik')
includes('scripts/canonical-energy-flow-backfill.sql', ['never', 'canonical_energy_remediation_queue', 'customer_identity_duplicate_review'], 'Backfill ska vara kontrollerad och köa osäkra kundträffar')
includes('scripts/canonical-energy-flow-readiness.sql', ['begin transaction read only', 'quotes_without_canonical_resolution', 'stuck_spot_import_jobs'], 'Readiness-SQL ska vara read-only och täcka blockerare')

includes('app/api/cron/pricing/spot-prices/route.ts', ['mode: \'preview\'', 'previousStockholmCalendarDate', 'importSpotPricesForDay'], 'Previewcron ska vara separat och importera senaste kompletta svenska dygn')
includes('app/api/cron/pricing/spot-settlement/route.ts', ['settlement_verification', 'settlement_locked: false'], 'Settlementcron ska verifiera men inte automatiskt låsa')
includes('app/api/internal/platform/grid-areas/import/cron/route.ts', ['ENERGY_GEODATA_MAX_AGE_DAYS', 'geodata_missing_or_stale'], 'SVK-cron ska starta ny import när verifierad geodata är gammal')
includes('lib/energy/svkGeometryImport.ts', ['gridex_stage_energy_geodata_feature', 'gridex_promote_energy_geodata_version', 'geodataVersion'], 'SVK-sidor ska staginglagras och publiceras som en verifierad version')
includes('supabase/migrations/20260724120000_canonical_market_resolution_quote_billing_flow.sql', ['energy_geodata_features_staging', 'geodata_version_id', 'gridex_promote_energy_geodata_version', 'is_active=false'], 'Geodata promotion ska byta aktiv polygonversion atomiskt och inaktivera borttagna features')
includes('lib/energy/canonicalEnergyEvents.ts', ['CanonicalEnergyAuditError', 'attempt <= 3', "error.code === '23505'", "remediation_type: 'audit_event_repair'"], 'Applikationsaudit ska vara idempotent, ha bounded retry och eskalera ett bestående fel till remediation')

for (const rel of ['docs/openapi/website-integration-v1.json', 'docs/openapi/customer-portal-v1.json']) {
  const spec = json(rel)
  check(spec.info?.version === '2026-07-24.1', `${rel} ska rapportera 2026-07-24.1`)
  const quoteSchema = spec.components?.schemas?.WebsiteQuoteRequest ?? spec.components?.schemas?.QuoteRequest ?? {}
  check(JSON.stringify(quoteSchema).includes('resolution_id'), `${rel} ska dokumentera resolution_id för quote`)
  check(JSON.stringify(spec).includes('MarketReference'), `${rel} ska dokumentera market_reference`)
}
includes('docs/external-website-api-integration-guide.md', ['Preview är aldrig slutligt settlementpris', 'grid_area_address_mismatch', 'quote_reference'], 'Utvecklardokumentationen ska beskriva det canonicala flödet')
includes('lib/website/publicContractApi.ts', ['2026-07-24.1'], 'Runtime och dokumentation ska ha samma kontraktsversion')

if (failures.length) {
  console.error(`Canonical market/resolution/quote/billing regression failed (${failures.length}/${checks}):`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}
console.log(`Canonical market/resolution/quote/billing regression passed (${checks} controls).`)
