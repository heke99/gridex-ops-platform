#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const failures = []
let checks = 0

function read(rel) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) {
    failures.push(`${rel} saknas`)
    return ''
  }
  return fs.readFileSync(full, 'utf8')
}
function check(condition, message) {
  checks += 1
  if (!condition) failures.push(message)
}
function includes(rel, needles, message) {
  const source = read(rel)
  check(needles.every((needle) => source.includes(needle)), message)
}
function excludes(rel, needles, message) {
  const source = read(rel)
  check(needles.every((needle) => !source.includes(needle)), message)
}
function json(rel) {
  try { return JSON.parse(read(rel)) }
  catch (error) {
    failures.push(`${rel} är inte giltig JSON: ${error.message}`)
    return {}
  }
}

// One product/version with one fixed row per SE area.
includes('lib/pricing/contractPricingVersioning.ts', [
  'fixedPricesByArea',
  'fixedPriceForArea',
  'Fast pris per elområde',
  'fixed_price_sek_per_kwh',
  'const componentAreas = priceAreas.length > 0 ? priceAreas : [null]',
], 'Prisversioneringen ska lagra SE1–SE4 under samma product version')
excludes('lib/pricing/contractPricingVersioning.ts', [
  'Fastpris ska vara samma öre/kWh i alla prisområden',
], 'Olika SE-priser får inte förbjudas eller tvingas till ett gemensamt pris')
includes('components/admin/contracts/ContractOfferAdminForm.tsx', [
  'fixed_prices_by_area',
  'SE1 | 112,00',
  'Ett canonicalt avtal',
], 'Admin ska redigera områdespriser på samma avtal')
includes('lib/website/publicContracts.ts', [
  'area_pricing: areaPricing',
  'commonFixedPriceOrePerKwh',
  'fixedAreaPricesFromSnapshot',
], 'Public contract DTO ska exponera en områdesprismatris på ett offer')

// Canonical area resolution and quote binding.
includes('app/api/v1/website/energy-area/resolve/route.ts', [
  "['website_energy_area.resolve']",
  'resolveEnergyContext',
], 'Tenantautentiserad OPS resolver ska vara aktiv')
const apiAuth = read('lib/integrations/apiAuth.ts')
check(
  apiAuth.indexOf('const token = bearerToken(request)') > -1 &&
    apiAuth.indexOf('const token = bearerToken(request)') < apiAuth.indexOf('await assertPlatformSchemaReady()'),
  'Saknad API-token ska ge 401 före databas- och schemakontroll',
)
includes('app/api/v1/website/quote/route.ts', [
  "['website_quotes.write']",
  'calculateOfferQuote',
  'status: 201',
], 'Canonical quote endpoint ska vara aktiv')
includes('app/api/v1/website/quote/validate/route.ts', [
  "['website_quotes.validate']",
  'validateWebsiteQuote',
  'selected_area_price',
], 'Quote validation ska verifiera och returnera vald områdesprisrad')
includes('lib/pricing/offerQuote.ts', [
  'fixedPriceOreForArea',
  'fixed_area_price_missing',
  'selected_area_price',
], 'Quoten ska använda exakt fastpris för valt SE-område')
includes('lib/pricing/priceSourceResolver.ts', [
  '!component.priceArea || component.priceArea === underlay.priceArea',
], 'Pris- och faktureringsmotorn ska behålla globala komponenter men välja endast kundens SE-rad')
excludes('app/api/v1/website/quote/route.ts', ['status: 410'], 'Canonical quote får inte returnera 410')
excludes('app/api/v1/website/energy-area/resolve/route.ts', ['status: 410'], 'Tenantautentiserad resolver får inte returnera 410')
includes('app/api/public/energy-area/route.ts', ['status: 410', 'public_energy_area_removed'], 'Publik legacyresolver ska fortsatt vara stängd')

// One canonical customer/application/site/contract and immutable billing row.
includes('lib/website/customerApplications.ts', [
  'external_customer_reference',
  'validateWebsiteQuote',
  'markWebsiteQuoteConsumed',
  'selectBaseComponentsForPriceArea',
  'base_price_components_snapshot: frozenBaseComponents',
  'onboardCustomerGraph',
], 'Kundansökan ska binda external reference, quote och vald prisrad till canonical graph')
includes('lib/website/customerApplications.ts', [
  'dispatchInitialWebsiteApplicationEmails',
  'contract.application_received',
  'contract.confirmation_sent',
], 'Kundmail ska gå genom samma idempotenta ansökningskedja')
includes('lib/customer-operations/automation.ts', [
  "case 'customer_application_continuation':",
  'continueWebsiteCustomerApplication',
], 'Den durable workern ska återuppta samma canonical kundansökan')
includes('lib/website/customerApplications.ts', [
  'processWebsiteApplicationIntake',
  'evaluateAndRunNextCustomerStep',
], 'Uppgiftsbegäran, Z01 och leverantörsbyte ska väljas från samma continuation-flöde')
includes('lib/billing/underlayEngine.ts', [
  'contract_price_snapshots',
  'base_price_components_snapshot',
], 'Faktureringen ska läsa immutable contract price snapshot')
includes('lib/customers/canonicalOnboarding.ts', [
  'gridex_onboard_customer_graph',
  'customer_number',
  'canonical_onboarding_incomplete_response',
], 'Kund, kundnummer, site och contract ska skapas atomiskt i canonical RPC')

// Scope and DB migration are additive/minimal.
includes('lib/integrations/apiClientScopes.ts', [
  'website_quotes.write',
  'website_quotes.validate',
  'website_energy_area.resolve',
], 'Aktiv API-scopekatalog ska innehålla canonical quote/resolver')
includes('supabase/migrations/20260723120000_canonical_fixed_area_quote_flow.sql', [
  'contract_fixed_area_prices_v',
  'website_contract_quotes_company_reference_idx',
  'website_quotes.write',
  'website_energy_area.resolve',
], 'Migrationen ska återaktivera endast etablerade scopes och lägga till audit/read model')

// Runtime/API/docs version alignment.
includes('lib/integrations/websiteIntegrationContract.ts', ["WEBSITE_INTEGRATION_CONTRACT_VERSION = '2026-07-30.1'"], 'Canonical runtime contract version ska vara 2026-07-30.1')
includes('lib/website/publicContractApi.ts', ['WEBSITE_INTEGRATION_CONTRACT_VERSION'], 'Public contract runtime ska använda den canonicala kontraktsversionen')
includes('app/developers/customer-portal-api/page.tsx', [
  '2026-07-30.1',
  'area_pricing',
  '/api/v1/website/quote',
], 'Utvecklarsidan ska beskriva canonical area pricing och quote')
for (const rel of ['docs/openapi/website-integration-v1.json']) {
  const spec = json(rel)
  check(spec.info?.version === '2026-07-30.1', `${rel} ska ha version 2026-07-30.1`)
  check(Boolean(spec.paths?.['/api/v1/website/quote']?.post?.responses?.['201']), `${rel} ska dokumentera aktiv quote 201`)
  check(Boolean(spec.paths?.['/api/v1/website/quote/validate']?.post?.responses?.['200']), `${rel} ska dokumentera aktiv quote validation 200`)
  check(Boolean(spec.paths?.['/api/v1/website/energy-area/resolve']?.post?.responses?.['200']), `${rel} ska dokumentera aktiv resolver 200`)
  const serialized = JSON.stringify(spec.components?.schemas ?? {})
  check(serialized.includes('area_pricing') && serialized.includes('FixedAreaPrice'), `${rel} ska dokumentera områdesprismatrisen`)
}

if (failures.length) {
  console.error(`Canonical fixed-area flow regression failed (${failures.length}/${checks}):`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}
console.log(`Canonical fixed-area flow regression passed (${checks} controls).`)
