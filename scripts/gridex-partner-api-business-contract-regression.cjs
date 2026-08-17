#!/usr/bin/env node
const fs = require('node:fs')
function read(path) { return fs.readFileSync(path, 'utf8') }
function assert(condition, message) {
  if (!condition) { console.error(`✗ ${message}`); process.exitCode = 1 } else { console.log(`✓ ${message}`) }
}

const business = read('lib/partner-api/business.ts')
const openApi = read('lib/partner-api/businessOpenApi.ts')
const route = read('app/api/partner/v1/[[...path]]/route.ts')
const resolver = read('lib/energy/resolver.ts')
const migration = read('supabase/migrations/20260817083859_partner_postal_grid_materialization.sql')
const learningMigration = read('supabase/migrations/20260817094125_papilite_verified_postal_learning.sql')

for (const path of ["'/location'", "'/price/current'", "'/price'"]) {
  assert(openApi.includes(path), `OpenAPI exposes ${path}`)
}
assert(/handleBusinessPartnerApi\(request, method, path\)/.test(route), 'business resolver layer runs before compatibility APIs')
assert(/resolveEnergyContext\(/.test(business), 'Partner API uses canonical Gridex energy resolver')
assert(/loadCurrentMarketPrice\(/.test(business), 'current price uses canonical Gridex market-price loader')
assert(/calculateOfferQuote\(/.test(business), 'customer price uses canonical Gridex offer quote engine')
assert(/monthly_ex_vat: estimate\.monthly_ex_vat/.test(business), 'monthly ex-VAT total is passed through from canonical quote')
assert(/monthly_vat: estimate\.monthly_vat/.test(business), 'monthly VAT is passed through from canonical quote')
assert(/monthly_inc_vat: estimate\.monthly_inc_vat/.test(business), 'monthly inc-VAT total is passed through from canonical quote')
assert(/annual_ex_vat: estimate\.annual_ex_vat/.test(business), 'annual ex-VAT total is passed through from canonical quote')
assert(/annual_vat: estimate\.annual_vat/.test(business), 'annual VAT is passed through from canonical quote')
assert(/annual_inc_vat: estimate\.annual_inc_vat/.test(business), 'annual inc-VAT total is passed through from canonical quote')

const forbidden = [
  'company_id','tenant_id','api_client_id','grid_owner_id','price_area_id','product_id',
  'contract_product_id','contract_product_version_id','publication_version_id','price_plan_id',
  'price_plan_version_id','price_book_id','resolution_id','offer_reference',
]
for (const field of forbidden) {
  assert(business.includes(`'${field}'`), `${field} is explicitly rejected as partner input`)
}
const priceRequestBlock = openApi.match(/PriceRequest:\s*\{[\s\S]*?\n\s*\},\n\s*PriceComponent:/)?.[0] ?? ''
for (const field of forbidden) {
  assert(!priceRequestBlock.includes(`${field}:`), `OpenAPI PriceRequest does not expose ${field}`)
}
assert(/additionalProperties: false/.test(priceRequestBlock), 'PriceRequest rejects undocumented/internal fields')

assert(/resolutionStatus === 'postal_suggested'/.test(business), 'postcode-only grid owner remains suggested in public DTO')
assert(/location_ambiguous/.test(business), 'ambiguous postcodes fail closed instead of guessing')
assert(/uniquePriceAreas\.length > 1/.test(resolver), 'canonical resolver detects postcodes spanning price areas')
assert(/postal_mapping_master_conflict/.test(resolver), 'canonical resolver detects postcode/master-data conflicts')
assert(/st_intersection\(p\.geometry, g\.geometry\)/.test(migration), 'postcode candidates are materialized by spatial grid overlap')
assert(/group by postal_code, city, grid_area_code, price_area/.test(migration), 'materialization preserves multiple grid candidates per postcode')

assert(/lookupPapilitePostalCentroid/.test(resolver), 'Papilite is isolated behind a postal-centroid resolver')
assert(/searchParams\.set\('query', postalCode\)/.test(resolver), 'Papilite Lite uses the documented query parameter')
assert(/searchParams\.set\('format', 'json'\)/.test(resolver), 'Papilite Lite requests JSON explicitly')
assert(/searchParams\.set\('apikey', apiKey\)/.test(resolver), 'Papilite Lite API key is sent using the provider contract')
assert(!/headers\.authorization\s*=/.test(resolver), 'Papilite is not called with the obsolete Bearer contract')
assert(!/searchParams\.set\('street_number'/.test(resolver), 'Papilite is never treated as a house-number geocoder')
assert(/coordinate_scope: 'postal_centroid'/.test(resolver), 'Papilite coordinates are explicitly labelled postal_centroid')
assert(/provider: 'papilite_postal_centroid'/.test(resolver), 'shared cache separates postal centroids from exact address cache rows')
assert(/postal_centroid_not_facility_location/.test(resolver), 'centroid trust warning is preserved in canonical resolution')
assert(/price_area_only/.test(resolver), 'postal centroid polygon lookup is price-area-only')
assert(/priceAreaCanMaterialize/.test(resolver), 'site price-area persistence has an explicit assurance gate')
assert(/confidence >= MIN_POSTAL_PRICE_ASSURANCE_CONFIDENCE/.test(resolver), 'estimated site price areas require the canonical confidence floor')
const postalFirst = resolver.indexOf('const postal = await postalSuggestion(input)')
const papiliteSecond = resolver.indexOf('const centroidLookup = await lookupPapilitePostalCentroid(input)')
assert(postalFirst >= 0 && papiliteSecond > postalFirst, 'shared postcode mapping is checked before any Papilite lookup')

assert(/resolution_status, postal_code, city, grid_area_code, price_area_code/.test(learningMigration), 'verified site state drives shared postcode learning')
assert(/facility_verified/.test(learningMigration) && /manual_verified/.test(learningMigration), 'only verified/manual-verified sites strengthen the shared mapping')
assert(/source = 'verified_customer_site'/.test(learningMigration), 'learned mapping has an explicit verified source')
assert(!/company_id|customer_id|customer_site_id/.test(learningMigration), 'shared learned mapping never copies tenant/customer/site identifiers')

assert(/source: 'site'/.test(business) && /source: 'contract'/.test(business), 'site and contract creation both trigger the shared resolver')
assert(/customerSiteId: String\(siteResult\.data\.id\)/.test(business), 'automatic registration resolution binds to canonical customer site')

if (process.exitCode) process.exit(process.exitCode)
