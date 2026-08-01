#!/usr/bin/env node
const fs = require('node:fs')
const failures = []
let checks = 0
function source(file) { return fs.readFileSync(file, 'utf8') }
function check(value, message) { checks += 1; if (!value) failures.push(message) }
function includes(file, values, message) {
  const value = source(file)
  check(values.every((needle) => value.includes(needle)), message)
}

includes('app/api/v1/website/market-price/current/route.ts', [
  'website_market_prices.read', 'resolution_id', 'loadCurrentMarketPrice', 'Cache-Control', 'contract_schema_version',
], 'Current market-price route must be authenticated, resolution-bound and no-store.')
includes('lib/pricing/spot/spotPriceImporter.ts', ['verifyStoredCompleteDay', ".eq('status', 'complete')", 'ensureSpotPriceCoverage'], 'Canonical importer must verify stored complete evidence before external refetch.')
includes('lib/pricing/spot/currentMarketPrice.ts', [
  "time_start", "time_end", 'source_as_of', 'maxAgeMinutes', 'spot_price_intervals', 'spot_price_daily_summaries',
], 'Current market-price service must use interval and verified provider evidence.')
includes('lib/pricing/spot/marketPreviewBuilder.ts', [
  'requested_days', 'included_days', 'source_as_of', 'generated_at', 'gridex_publish_market_price_preview_v2',
  'latest_complete_day', 'rolling_7_days', 'rolling_30_days', 'month_to_date',
], 'Preview builder must expose complete evidence and all canonical reference periods.')
includes('lib/pricing/priceSourceResolver.ts', [
  'selectMarketPricePreviewRow', 'market_reference_window_incomplete', 'price_sek_per_kwh', 'price_ore_per_kwh',
  'effective_stale_at', 'allowIndicativeLatest',
], 'Quote source resolver must expose price and enforce tenant policy.')
includes('supabase/migrations/20260724223000_market_price_api_documentation_completion.sql', [
  'gridex_publish_market_price_preview_v2', 'source_as_of', 'generated_at', 'requested_days', 'included_days',
  'source_checksum is not distinct from p_source_checksum', 'source_as_of is not distinct from p_source_as_of',
  'gridex_market_price_readiness_v', 'gridex_ops_health_checks_v3',
], 'Migration must be additive, evidence-aware and idempotent.')
includes('lib/integrations/apiClientScopes.ts', [
  "groupKey: 'website_market_prices'", "scopes: ['website_market_prices.read']", 'recommendedDefault: true',
], 'Current market-price scope must be a recommended permission group.')
includes('lib/integrations/apiClientProfiles.ts', [
  "'website_market_prices.read'",
], 'Canonical website API profiles must grant current market-price scope.')
includes('supabase/migrations/20260724223000_market_price_api_documentation_completion.sql', [
  "'website_market_prices'", "'website_market_prices.read'", 'integration_api_clients', 'integration_api_client_profiles',
], 'Migration must backfill the current market-price scope for ordinary website API keys.')
const vercel = JSON.parse(source('vercel.json'))
check(vercel.crons.some((row) => row.path === '/api/cron/pricing/spot-prices' && row.schedule === '15 * * * *'), 'Spot cron must run hourly.')
const website = JSON.parse(source('docs/openapi/website-integration-v1.json'))
const portal = JSON.parse(source('docs/openapi/customer-portal-v1.json'))
check(website.info.version === '2026-08-01.1', 'Website OpenAPI version mismatch.')
check(Boolean(website.paths['/api/v1/website/market-price/current']), 'Website OpenAPI current price endpoint missing.')
check(!portal.paths['/api/v1/website/market-price/current'], 'Customer portal OpenAPI must not duplicate website market route.')
check(website.components.schemas.MarketReference.required.includes('price_sek_per_kwh'), 'MarketReference direct price is not required.')
check(website.components.schemas.MarketReference.properties.reference_type.const === 'preview', 'Website MarketReference must not document internal settlement values.')
check(website.components.schemas.CurrentMarketPriceResponse.required.includes('contract_schema_version'), 'Current market response must expose contract_schema_version.')
includes('app/admin/system-health/page.tsx', ['Marknadspris och tenant-API', "startsWith('spot_')"], 'System Health must surface canonical market-price readiness.')
includes('scripts/backfill-spot-price-coverage.ts', ['validateStoredDay', "action: 'skipped' | 'promoted' | 'imported' | 'busy'", 'gridex_claim_spot_price_import_job'], 'Backfill must validate local evidence first and claim canonical import jobs.')
includes('lib/integrations/openApiResponse.ts', ['ETag', 'if-none-match', '304', 'X-Gridex-Contract-Version'], 'OpenAPI responses must preserve ETag, 304 and contract-version headers.')

if (failures.length) {
  console.error(`Market-price API regression failed (${failures.length}/${checks}):`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}
console.log(`Market-price API regression passed (${checks} controls).`)
