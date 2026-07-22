#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const failures = []

function read(rel) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) {
    failures.push(`${rel} saknas`)
    return ''
  }
  return fs.readFileSync(full, 'utf8')
}
function has(rel, needle, message) {
  if (!read(rel).includes(needle)) failures.push(message || `${rel} saknar ${needle}`)
}
function lacks(rel, needle, message) {
  if (read(rel).includes(needle)) failures.push(message || `${rel} innehåller förbjudet ${needle}`)
}
function json(rel) {
  try {
    return JSON.parse(read(rel))
  } catch (error) {
    failures.push(`${rel} är inte giltig JSON: ${error.message}`)
    return {}
  }
}

const previousMigration = 'supabase/migrations/20260722133000_external_tenant_quote_api_completion.sql'
const boundaryMigration = 'supabase/migrations/20260722233000_external_tenant_pricing_boundary.sql'

// Tenant identity remains API-key authoritative.
has(previousMigration, 'external_tenant_reference', 'Opak tenantreferens ska finnas')
has('app/api/v1/integration/context/route.ts', "['integration_context.read']", 'Integration context ska kräva rätt scope')
has('lib/integrations/tenantContext.ts', 'authoritative_identity', 'API-nyckeln ska vara auktoritativ tenantidentitet')
lacks('app/api/v1/integration/context/route.ts', "searchParams.get('company_id')", 'Extern klient får inte välja company_id')

// Public contract is now the complete tenant calculation contract.
for (const needle of [
  'calculation_components',
  'display_components',
  'calculation_inclusion',
  'website_visibility',
  'hidden_components_must_be_calculated',
  'market_price_supplied_by_ops: false',
  'market_price_responsibility',
]) {
  has('lib/website/publicContracts.ts', needle, `Public contract DTO saknar ${needle}`)
}
has('lib/website/publicContracts.ts', 'fixed_price: fixedPrice', 'Fastpris ska alltid projiceras från OPS')
has('lib/website/publicContracts.ts', 'offer.contract_type === "fixed"', 'Fastpris ska alltid vara synligt för fastprisavtal')
has('lib/pricing/contractPricingVersioning.ts', 'websiteVisibility.fixed_price = true', 'Nya fastprisversioner ska låsa fastprisets synlighet')
has('lib/website/publicContracts.ts', 'invoice_fee: invoiceFee', 'Fakturaavgift ska alltid projiceras från OPS')
has('lib/website/publicContracts.ts', 'components: calculationComponents', 'Kompatibilitetsfältet components ska innehålla hela kalkylen')
has('lib/website/publicContracts.ts', 'display_components: displayComponents', 'Separat presentationslista ska finnas')
lacks('lib/website/publicContracts.ts', 'visibleComponents', 'API får inte filtrera bort dolda kalkylkomponenter')
has('lib/website/publicContracts.ts', 'publicComponentMetadata', 'Publik komponentmetadata ska allowlistas')
const publicContractsSource = read('lib/website/publicContracts.ts')
const publicResponseProjection = publicContractsSource.slice(publicContractsSource.indexOf('export function publicContractResponse'), publicContractsSource.indexOf('export type WebsiteLegalBundle'))
if (publicResponseProjection.includes('...(offer.pricing_snapshot ?? {})')) failures.push('API får inte sprida hela interna pricing_snapshot i publicContractResponse')
has('lib/website/publicContracts.ts', 'portfolio_indications: []', 'Interna marknadsindikationer ska inte exponeras')

// Pricing versioning and database distinguish calculation from presentation.
has('lib/pricing/contractPricingVersioning.ts', 'calculation_inclusion: "included"', 'Nya prisversioner ska markera beräkningspåverkan')
has('lib/pricing/contractPricingVersioning.ts', 'website:', 'Nya prisversioner ska markera website visibility')
has(boundaryMigration, 'calculation_inclusion', 'DB ska lagra beräkningspåverkan')
has(boundaryMigration, 'website_summary_visible', 'DB ska stödja sammanställningssynlighet')
has(boundaryMigration, "website_quotes.write", 'Migrationen ska återkalla gammalt quote-scope')
has(boundaryMigration, "website_energy_area.resolve", 'Migrationen ska återkalla gammalt energy-area-scope')

// External quote and public energy-area APIs are removed, while internal pricing remains.
for (const [route, code] of [
  ['app/api/v1/website/quote/route.ts', 'tenant_managed_pricing_required'],
  ['app/api/v1/website/quote/validate/route.ts', 'quote_validation_removed'],
  ['app/api/v1/website/energy-area/resolve/route.ts', 'tenant_managed_energy_area_required'],
  ['app/api/public/energy-area/route.ts', 'public_energy_area_removed'],
]) {
  has(route, 'status: 410', `${route} ska returnera 410`)
  has(route, code, `${route} ska returnera stabil felkod ${code}`)
}
lacks('app/api/v1/website/quote/route.ts', 'calculateOfferQuote', 'Extern quote-route får inte anropa OPS prismotor')
lacks('app/api/v1/website/energy-area/resolve/route.ts', 'resolveEnergyContext', 'Extern area-route får inte anropa OPS resolver')
has('lib/pricing/offerQuote.ts', 'calculateOfferQuote', 'Intern prismotor ska finnas kvar för OPS')
has('lib/energy/resolver.ts', 'resolveEnergyContext', 'Intern operativ elområdesresolver ska finnas kvar')

// Removed scopes may not be provisioned in the active API client catalog.
for (const scope of ['website_quotes.write', 'website_quotes.validate', 'website_energy_area.resolve']) {
  lacks('lib/integrations/apiClientScopes.ts', scope, `Aktiv scope-katalog får inte innehålla ${scope}`)
}
has('lib/integrations/apiClientScopes.ts', 'website_contracts.read', 'Public contracts scope ska finnas')
has('lib/integrations/apiClientScopes.ts', 'website_applications.write', 'Application scope ska finnas')

// Application binds directly to offer_reference and ignores legacy quote_reference.
lacks('lib/website/customerApplications.ts', 'validateWebsiteQuote', 'Ansökan får inte kräva quote-validering')
lacks('lib/website/customerApplications.ts', 'markWebsiteQuoteConsumed', 'Ansökan får inte konsumera quote')
has('lib/website/customerApplications.ts', 'quote_reference är deprecated och ignorerades', 'Legacy quote_reference ska uttryckligen ignoreras')
has('lib/website/customerApplications.ts', 'deprecated_quote_reference_ignored', 'Svaret ska diagnostisera ignorerad legacy quote')
has('lib/website/customerApplications.ts', 'runEnergyResolution', 'OPS ska fortsatt verifiera anläggning/elområde operativt')

// Existing publication revision, webhook and API feed protections remain.
has('app/api/v1/website/public-contracts/route.ts', 'ifNoneMatchMatches', 'Website-feed ska stödja If-None-Match')
has('app/api/v1/website/public-contracts/route.ts', 'status: 304', 'Website-feed ska stödja 304')
has('lib/website/publicContractApi.ts', 'PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION', 'ETag ska versionssaltas när DTO-kontraktet ändras')
has('app/api/v1/website/public-contracts/route.ts', 'X-Gridex-Contract-Version', 'Public contract-svaret ska exponera representationsversion')
has('app/api/v1/contracts/route.ts', 'status: 304', 'API-feed ska stödja 304')
has(previousMigration, "'contracts.publication.changed'", 'Publication webhook-event ska finnas')
has(previousMigration, 'insert into public.webhook_deliveries', 'Webhook ska använda delivery pipeline')
has('lib/integrations/webhooks.ts', 'tenant_reference', 'Webhook ska använda opak tenantreferens')

// Public documentation and both OpenAPI specifications describe the new boundary.
has('app/developers/customer-portal-api/page.tsx', '2026-07-22.2', 'Utvecklarsidan ska visa API 2026-07-22.2')
has('app/developers/customer-portal-api/page.tsx', 'hidden_components_must_be_calculated', 'Utvecklarsidan ska dokumentera dolda kalkylkomponenter')
has('docs/external-website-api-integration-guide.md', 'API 2026-07-22.2', 'Integrationsguiden ska vara uppdaterad')
has('docs/ops-summary-1-api-completion-2026-07-22.md', 'market_price_supplied_by_ops', 'Canonical målbild ska dokumentera marknadsprisgränsen')

for (const specFile of ['docs/openapi/website-integration-v1.json', 'docs/openapi/customer-portal-v1.json']) {
  const spec = json(specFile)
  if (spec.info?.version !== '2026-07-22.2') failures.push(`${specFile} har fel version`)
  const quote = spec.paths?.['/api/v1/website/quote']?.post
  if (!quote?.deprecated || !quote?.responses?.['410']) failures.push(`${specFile} ska markera quote som borttagen med 410`)
  const offer = spec.components?.schemas?.PublicContractOffer || spec.components?.schemas?.PublicContract
  const serialized = JSON.stringify({ offer: offer || {}, schemas: spec.components?.schemas || {} })
  for (const field of ['calculation_components', 'display_components', 'calculation_inclusion', 'website_visibility']) {
    if (!serialized.includes(field)) failures.push(`${specFile} saknar ${field} i public contract-schema`)
  }
  if (!serialized.includes('market_price_responsibility')) failures.push(`${specFile} saknar market_price_responsibility`)
}

if (failures.length) {
  console.error('Gridex OPS pricing boundary regression failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('Gridex OPS pricing boundary regression passed.')
