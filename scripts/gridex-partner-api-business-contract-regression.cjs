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
const resolverCore = read('lib/energy/resolverCore.ts')
const migration = read('supabase/migrations/20260817083859_partner_postal_grid_materialization.sql')
const papiliteLearningMigration = read('supabase/migrations/20260817094125_papilite_verified_postal_learning.sql')

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
assert(/invoiceDeliveryMethod: text\(body\.invoice_delivery_method\)/.test(business), 'invoice delivery method continues into the canonical quote/billing calculation')

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
assert(/uniquePriceAreas\.length > 1/.test(resolverCore), 'canonical resolver core detects postcodes spanning price areas')
assert(/postal_mapping_master_conflict/.test(resolverCore), 'canonical resolver core detects postcode/master-data conflicts')
assert(/st_intersection\(p\.geometry, g\.geometry\)/.test(migration), 'postcode candidates are materialized by spatial grid overlap')
assert(/group by postal_code, city, grid_area_code, price_area/.test(migration), 'materialization preserves multiple grid candidates per postcode')

assert(/source: 'site'/.test(business) && /source: 'contract'/.test(business), 'site and contract creation both trigger the shared resolver')
assert(/customerSiteId: String\(siteResult\.data\.id\)/.test(business), 'automatic registration resolution binds to canonical customer site')

const cacheCheck = resolver.indexOf('if (await hasActivePostalMapping(postalCode))')
const papiliteCall = resolver.indexOf('await fetchPapilitePostcode(input, postalCode)')
assert(cacheCheck >= 0 && papiliteCall > cacheCheck, 'shared postcode cache is checked before PAP/API Lite')
assert(/searchParams\.set\('query', postalCode\)/.test(resolver), 'PAP/API Lite uses the documented query parameter')
assert(/searchParams\.set\('format', 'json'\)/.test(resolver), 'PAP/API Lite requests JSON using the documented format parameter')
assert(/searchParams\.set\('apikey', apiKey\)/.test(resolver), 'PAP/API Lite sends the API key using the documented apikey parameter')
assert(/searchParams\.set\('country', .*\.toLowerCase\(\)\)/.test(resolver), 'PAP/API Lite country parameter is normalized to lower case')
assert(!/authorization\s*=|authorization:|Bearer/.test(resolver), 'PAP/API Lite does not use the obsolete Bearer-header integration')
assert(/grid_area_code: null/.test(resolver), 'PAP/API Lite centroid cache never persists a grid area as operational truth')
assert(/operational_grid_owner_allowed: false/.test(resolver), 'PAP/API Lite centroid evidence explicitly forbids operational grid-owner automation')
assert(/price_area_code: resolved\.priceArea/.test(resolver), 'resolved/estimated price area is persisted on the tenant site for reuse')
assert(/coordinate_precision: 'postal_centroid'/.test(resolver), 'PAP/API Lite coordinate precision is recorded as postcode centroid')
assert(/resolveCoreEnergyContext\(postalOnlyInput\(input\)\)/.test(resolver), 'canonical core is invoked without treating PAP/API Lite as a house-number geocoder')

assert(/facility_verified', 'manual_verified/.test(papiliteLearningMigration), 'global postcode learning only accepts verified/manual-verified tenant sites')
assert(/source = 'verified_customer_site'/.test(papiliteLearningMigration), 'verified site learning has an explicit provenance source')
assert(!/company_id|customer_id|customer_site_id|tenant_id/.test(papiliteLearningMigration.split("jsonb_build_object(").slice(1).join('')), 'shared postcode learning metadata does not copy tenant/customer identifiers')
assert(/set search_path = ''/.test(papiliteLearningMigration), 'private SECURITY DEFINER learning function has an explicit empty search_path')
assert(/revoke all on function private\.gridex_learn_verified_postal_mapping_from_site_v1\(\) from public/.test(papiliteLearningMigration), 'verified postcode learning function is not executable by PUBLIC')

if (process.exitCode) process.exit(process.exitCode)