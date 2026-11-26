#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { currentDocumentationVersion, runtimeContractVersion } = require('./lib/current-api-contract.cjs')

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
  'const fixedComponentAreas = priceAreas.length > 0 ? priceAreas : [null]',
], 'Prisversioneringen ska lagra SE1–SE4 under samma product version')
excludes('lib/pricing/contractPricingVersioning.ts', [
  'Fastpris ska vara samma öre/kWh i alla prisområden',
], 'Olika SE-priser får inte förbjudas eller tvingas till ett gemensamt pris')
includes('components/admin/contracts/ContractOfferAdminForm.tsx', [
  'CommercialPricingEditor',
  'snapshot={offer?.commercial_snapshot ?? null}',
], 'Adminformuläret ska använda den canonicala prisalternativseditorn')
includes('components/admin/contracts/CommercialPricingEditor.tsx', [
  'const AREAS = ["SE1", "SE2", "SE3", "SE4"]',
  'price_options_json',
  'row.price_area',
  'row.price_row_reference',
], 'Admin ska redigera SE1–SE4-rader under samma prisalternativ och avtal')
includes('app/api/v1/website/public-contracts/route.ts', [
  'publication: publicContractResponse(offer)',
], 'Den aktiva publika kontraktsrouten ska använda DTO-byggaren')
includes('lib/website/publicContracts.ts', [
  "export { publicContractResponse, WebsiteLegalBundleError, buildWebsiteLegalBundle } from './publicContracts.part-2'",
], 'Den publika kontraktsfasaden ska exponera den aktiva DTO-byggaren')
includes('lib/website/publicContracts.part-2.ts', [
  'area_pricing: areaPricing',
  'commonFixedPriceOrePerKwh',
  'fixedAreaPricesFromSnapshot',
], 'Public contract DTO ska exponera en områdesprismatris på ett offer')

// Canonical area resolution and quote binding.
includes('app/api/v1/website/energy-area/resolve/route.ts', [
  "['website_energy_area.resolve']",
  'await resolveWebsiteEnergyContext({',
], 'Tenantautentiserad OPS resolver ska vara aktiv')
includes('lib/energy/websiteResolutionCache.ts', [
  'export async function resolveWebsiteEnergyContext(',
  'await resolveEnergyContext({',
], 'Website-resolvern ska använda den gemensamma områdesupplösningen')
const apiAuth = read('lib/integrations/apiAuth.ts')
const credentialRejection = apiAuth.match(/const credential = integrationCredential\(request\)\s+if \(!credential\.ok\) return publicError\(\{\s+status: 401,\s+code: credential\.malformedAuthorization \? 'malformed_authorization' : 'missing_api_token'/)
const schemaReady = apiAuth.indexOf('await assertPlatformSchemaReady()')
const databaseAccess = apiAuth.indexOf("await supabaseService.rpc('authenticate_integration_request_v1'")
check(
  credentialRejection && credentialRejection.index < schemaReady && schemaReady < databaseAccess,
  'Saknad API-token ska ge 401 före databas- och schemakontroll',
)
includes('app/api/v1/website/quote/route.ts', [
  'website_quotes.write',
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
  'const baseComponents = filterBaseComponentsForUnderlay(',
  'priceArea: readBaseComponentPriceArea(component.priceArea)',
  'const underlayPriceArea = canonicalSwedishPriceArea(underlay.priceArea)',
  'if (!underlayPriceArea) return [];',
  '.filter(({ priceArea }) => !priceArea || priceArea === underlayPriceArea)',
], 'Pris- och faktureringsmotorn ska behålla globala komponenter men välja endast kundens SE-rad')
excludes('app/api/v1/website/quote/route.ts', ['status: 410'], 'Canonical quote får inte returnera 410')
excludes('app/api/v1/website/energy-area/resolve/route.ts', ['status: 410'], 'Tenantautentiserad resolver får inte returnera 410')
includes('app/api/public/energy-area/route.ts', ['status: 410', 'public_energy_area_removed'], 'Publik legacyresolver ska fortsatt vara stängd')

// One canonical customer/application/site/contract and immutable billing row.
includes('lib/website/customerApplications.ts', [
  "export { processWebsiteCustomerApplication } from './customerApplicationProcess'",
  "export { continueWebsiteCustomerApplication, repairWebsiteCustomerApplication } from './customerApplicationRepair'",
], 'Website-ansökan och dess fortsättning ska nå de aktiva ägarna')
includes('lib/website/customerApplicationProcess.ts', [
  'clean(body.external_customer_reference)',
  'websiteQuote = await validateWebsiteQuote({',
  'onboardCanonicalWebsiteCustomerGraph({',
], 'Kundansökan ska föra validerad quote och extern kundreferens till den canonicala grafen')
includes('lib/website/customerApplicationOnboarding.ts', [
  'external_customer_id: input.externalCustomerId',
  'selectBaseComponentsForPriceArea(',
  'base_price_components_snapshot: frozenBaseComponents',
  'input.websiteQuote.price_option_reference',
  'input.websiteQuote.area_price_reference',
  'await onboardCustomerGraph({',
], 'Den atomiska grafen ska binda extern kundreferens, prisalternativ och vald prisrad')
includes('lib/website/customerApplicationRepair.ts', [
  'await dispatchInitialWebsiteApplicationEmails({',
  'await processWebsiteApplicationIntake({',
  'await evaluateAndRunNextCustomerStep({',
], 'Fortsättningen ska hantera kundmail, uppgiftsbegäran, Z01 och leverantörsbyte')
includes('lib/website/customerApplicationCommunication.ts', [
  'contract.application_received',
  'contract.confirmation_sent',
  'idempotencyKey: `website_application:${input.applicationId}:${eventKey}`',
], 'Kundmail ska gå genom samma idempotenta ansökningskedja')
includes('lib/customer-operations/automation.part-3.ts', [
  "case 'customer_application_continuation':",
  "const { continueWebsiteCustomerApplication } = await import('@/lib/website/customerApplications')",
  'return continueWebsiteCustomerApplication({',
], 'Den durable workern ska återuppta samma canonical kundansökan')
includes('lib/billing/underlayEngine.ts', [
  'contract_price_snapshots',
  'base_price_components_snapshot',
], 'Faktureringen ska läsa immutable contract price snapshot')
includes('lib/customers/canonicalOnboarding.ts', [
  'canonical_onboard_customer_graph',
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
includes('lib/integrations/websiteIntegrationContract.ts', [`WEBSITE_INTEGRATION_CONTRACT_VERSION = '${runtimeContractVersion}'`], `Canonical runtime contract version ska vara ${runtimeContractVersion}`)
includes('lib/website/publicContractApi.ts', ['WEBSITE_INTEGRATION_CONTRACT_VERSION'], 'Public contract runtime ska använda den canonicala kontraktsversionen')
includes('app/developers/customer-portal-api/page.tsx', [
  'const documentationVersion = API_DOCUMENTATION_VERSION',
  'href={WEBSITE_INTEGRATION_OPENAPI_URL}',
  'POST /website/quote',
], 'Utvecklarsidan ska visa canonical version, beskriva quote och länka till OpenAPI')
includes('lib/integrations/websiteIntegrationContract.ts', [
  "WEBSITE_INTEGRATION_OPENAPI_PATH = '/api/v1/openapi/website-integration-v1.json'",
  'WEBSITE_INTEGRATION_OPENAPI_URL = `${WEBSITE_INTEGRATION_ORIGIN}${WEBSITE_INTEGRATION_OPENAPI_PATH}`',
], 'Dokumentationslänken ska peka på aktiv Website OpenAPI')
includes('app/api/v1/openapi/website-integration-v1.json/route.ts', [
  "import websiteIntegrationOpenApi from '@/docs/openapi/website-integration-v1.json'",
  'openApiDocumentResponse(request, websiteIntegrationOpenApi,',
], 'OpenAPI-routen ska servera den kontrollerade områdesprismatrisen')
for (const rel of ['docs/openapi/website-integration-v1.json']) {
  const spec = json(rel)
  check(spec.info?.version === currentDocumentationVersion, `${rel} ska ha version ${currentDocumentationVersion}`)
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
