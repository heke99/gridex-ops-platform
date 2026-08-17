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

assert(/source: 'site'/.test(business) && /source: 'contract'/.test(business), 'site and contract creation both trigger the shared resolver')
assert(/customerSiteId: String\(siteResult\.data\.id\)/.test(business), 'automatic registration resolution binds to canonical customer site')

if (process.exitCode) process.exit(process.exitCode)
