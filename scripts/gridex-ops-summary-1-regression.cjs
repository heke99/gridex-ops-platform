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
  const source = read(rel)
  if (!source.includes(needle)) failures.push(message || `${rel} saknar ${needle}`)
}

function lacks(rel, needle, message) {
  const source = read(rel)
  if (source.includes(needle)) failures.push(message || `${rel} innehåller förbjudet ${needle}`)
}

function json(rel) {
  try {
    return JSON.parse(read(rel))
  } catch (error) {
    failures.push(`${rel} är inte giltig JSON: ${error.message}`)
    return {}
  }
}

const migration = 'supabase/migrations/20260722133000_external_tenant_quote_api_completion.sql'

// 1. Opaque tenant identity and scopes.
has(migration, 'external_tenant_reference', 'Migrationen ska skapa opak tenantreferens')
lacks(migration, 'gen_random_bytes(', 'Tenantreferensen får inte bero på schema-känslig gen_random_bytes')
has(migration, "replace(gen_random_uuid()::text, '-', '')", 'Tenantreferensen ska använda portable UUID-entropi')
has(migration, "'integration_context.read'", 'Migrationen ska registrera integration_context.read')
has('app/api/v1/integration/context/route.ts', "['integration_context.read']", 'Tenant context-route ska kräva rätt scope')
has('lib/integrations/tenantContext.ts', 'authoritative_identity', 'Tenant context ska markera API-nyckeln som auktoritativ')
lacks('app/api/v1/integration/context/route.ts', 'request.nextUrl.searchParams.get(\'company_id\')', 'Extern tenant context får inte välja company_id')

// 2. Customer type normalization.
has('lib/customers/externalCustomerType.ts', "normalized === 'company'", 'company-alias ska normaliseras')
has('lib/customers/externalCustomerType.ts', "value: 'business'", 'company ska mappas till business')
has('lib/website/publicContractApi.ts', 'invalid_query_parameter', 'Ogiltig customer_type-query ska ge strukturerat 400')

// 3-5. Canonical quote and application binding.
has(migration, 'create table if not exists public.website_contract_quotes', 'Quotes ska persisteras canonical')
has('lib/pricing/offerQuote.ts', 'persistWebsiteQuote', 'Quote-motorn ska spara quote')
has('lib/pricing/offerQuote.ts', 'pricing_snapshot_schema_version', 'Quote ska exponera snapshotversion')
has('lib/pricing/offerQuote.ts', 'market_data_timestamp', 'Quote ska exponera marknadsdatatimestamp')
has('lib/pricing/offerQuote.ts', 'valid_until: persisted.validUntil', 'Quote ska exponera giltighetstid')
has('lib/pricing/websiteQuotes.ts', 'quote_already_consumed', 'Quote ska skyddas mot återanvändning')
has('lib/pricing/websiteQuotes.ts', ".eq('status', 'active')", 'Quote-konsumtion ska använda atomisk compare-and-set')
has('lib/pricing/websiteQuotes.ts', 'contract_product_version_id', 'Quote ska bindas till produktversion')
has('lib/pricing/websiteQuotes.ts', 'legal_bundle_version_id', 'Quote ska bindas till juridikversion')
has('lib/website/customerApplications.ts', 'validateWebsiteQuote', 'Kundansökan ska verifiera quote')
has('lib/website/customerApplications.ts', 'markWebsiteQuoteConsumed', 'Kundansökan ska konsumera quote')
has('lib/website/customerApplications.ts', 'await stage("quote_consume"', 'Quote ska reserveras innan kundgrafen skapas')
has('lib/website/customerApplications.ts', 'quote_snapshot', 'Kundansökan ska låsa hela quote-snapshotet')
has('lib/website/customerApplications.ts', 'annual_consumption_kwh', 'Årsförbrukning ska sparas canonical')

// 6. Channel-scoped revision, ETag and 304.
has('app/api/v1/website/public-contracts/route.ts', 'ifNoneMatchMatches', 'Website-feed ska stödja If-None-Match')
has('app/api/v1/website/public-contracts/route.ts', 'status: 304', 'Website-feed ska returnera 304')
has('app/api/v1/contracts/route.ts', "loadPublicationRevision(auth.client.company_id, 'api')", 'API-feed ska ha separat revisionsström')
has('app/api/v1/contracts/route.ts', 'status: 304', 'API-feed ska returnera 304')
has(migration, 'after insert or update or delete on public.contract_publication_versions', 'Alla publication-versionmutationer ska höja revisionen')

// 7. Publication webhook must use the live delivery pipeline.
has(migration, "'contracts.publication.changed'", 'Publication changed-event ska finnas')
has(migration, 'insert into public.webhook_deliveries', 'Publication event ska använda webhook_deliveries')
lacks(migration, 'insert into public.event_outbox', 'Ny publication pipeline får inte skriva till legacy event_outbox')
has('lib/integrations/webhooks.ts', 'tenant_reference', 'Runtime-webhooks ska innehålla tenant_reference')

// 8. Real API channel feed without internal company IDs.
has('app/api/v1/contracts/route.ts', "['api_contracts.read']", 'API-feed ska kräva separat scope')
has(migration, "cp.channel='api'", 'API-feed ska filtrera api-kanalen')
has(migration, "- 'company_id' - 'companyId'", 'API-feed ska ta bort internt company_id')
has(migration, "publication_snapshot->'commercial_snapshot'", 'API-feed ska sanera company_id även i nested commercial_snapshot')
has('lib/api/publicRouteRegistry.ts', "path: '/api/v1/contracts'", 'API-feed ska vara dokumenterad i route-registret')

// 9. Diagnostics from canonical readiness graph.
for (const field of [
  'canonical_graph_consistent',
  'forward_publication_link_valid',
  'reverse_legacy_link_valid',
  'company_chain_valid',
  'tenant_assignment_valid',
  'channel_valid',
  'source_offer_consistent',
  'pricing_ready',
  'legal_ready',
  'invoice_fee_ready',
  'publication_active',
  'application_acceptance_ready',
]) has('lib/website/publicContracts.ts', field, `Diagnostics saknar ${field}`)
has('app/api/v1/website/public-contracts/route.ts', "headers.Deprecation = 'true'", 'diagnostics=1 ska markeras deprecated')
has('app/api/v1/website/public-contracts/route.ts', "headers.Sunset =", 'diagnostics=1 ska ha sunset-header')

// 10. Tenant-admin market source configuration.
has('app/admin/pricing/market-sources/page.tsx', 'Max dataålder', 'Tenantadmin ska kunna ange max dataålder')
has('app/admin/pricing/market-sources/page.tsx', 'Testa anslutning', 'Tenantadmin ska kunna testa provider')
has('app/admin/pricing/market-sources/actions.ts', 'testMarketSourceConnectionAction', 'Backend för anslutningstest ska finnas')
has('app/admin/pricing/market-sources/page.tsx', "requireAdminPageKeyAccess('pricing.engine')", 'Marknadsdatapolicy ska kräva pricing-behörighet')
has('app/admin/pricing/market-sources/actions.ts', "['pricing.write', 'pricing.publish']", 'Marknadsdataåtgärder ska kräva pricing-behörighet')
has('lib/admin/navigation.ts', "href: '/admin/pricing/market-sources'", 'Tenantadmin ska hitta marknadsdatapolicyn i navigationen')
has(migration, 'forecast_policy', 'Forecast-policy ska finnas i DB')
has(migration, 'portfolio_policy', 'Portfolio-policy ska finnas i DB')
has('lib/pricing/priceSourceResolver.ts', 'policySupports', 'Quote-motorn ska använda tenantens område/upplösningspolicy')
has('lib/pricing/priceSourceResolver.ts', 'allowIndicativeLatest', 'Quote-motorn ska tillämpa indikativ fallback-policy')

// 11-12. Canonical routes, OpenAPI, types and public docs.
has('lib/integrations/apiClientScopes.ts', 'website_quotes.validate', 'API-klient-UI ska stödja quote-valideringsscope')
has('lib/integrations/apiClientScopes.ts', 'api_contracts.read', 'API-klient-UI ska stödja api feed-scope')
has('lib/integrations/apiClientScopes.ts', 'website_energy_area.resolve', 'API-klient-UI ska stödja canonical energy-area-scope')
has('lib/integrations/apiClientScopes.ts', 'website_switch_status.read', 'API-klient-UI ska stödja canonical switch-status-scope')
has('app/api/v1/website/energy-area/resolve/route.ts', 'resolveEnergyContext', 'Canonical energy-area-route ska använda OPS resolver')
has('app/api/v1/website/switch-status/route.ts', 'loadWebsiteSwitchStatus', 'Canonical switch-status-route ska finnas')
has('lib/website/switchStatus.ts', 'opaqueSwitchReference', 'Switch-status får inte exponera internt switch-UUID')
has('lib/integrations/websiteApiContract.ts', 'ContractsPublicationChangedWebhook', 'Publika TypeScript-kontrakt ska inkludera webhooken')
has('app/developers/customer-portal-api/page.tsx', '2026-07-22.1', 'Utvecklarsidan ska ha ny kontraktsversion')
has('docs/external-website-api-integration-guide.md', 'Canonical uppdatering 2026-07-22.1', 'Tenantens integrationsguide ska peka på canonical kontrakt')
has('docs/ops-summary-1-api-completion-2026-07-22.md', 'releasekrav', 'Canonical dokumentation ska finnas')

const spec = json('docs/openapi/website-integration-v1.json')
const paths = spec.paths || {}
for (const route of [
  '/api/v1/integration/context',
  '/api/v1/contracts',
  '/api/v1/website/public-contracts',
  '/api/v1/website/public-contracts/diagnostics',
  '/api/v1/website/quote',
  '/api/v1/website/quote/validate',
  '/api/v1/website/energy-area/resolve',
  '/api/v1/website/switch-status',
  '/api/v1/website/customer-applications',
]) {
  if (!paths[route]) failures.push(`OpenAPI saknar ${route}`)
}
const schemas = spec.components?.schemas || {}
const quoteProps = schemas.Quote?.properties || schemas.WebsiteQuote?.properties || schemas.QuoteResponse?.properties || {}
for (const field of ['offer_reference', 'quote_reference', 'pricing_interval', 'market_data_timestamp', 'valid_until']) {
  if (!quoteProps[field]) failures.push(`OpenAPI quote-schema saknar ${field}`)
}
if (quoteProps.source_period?.type !== 'string') failures.push('OpenAPI quote source_period ska vara canonical YYYY-MM-sträng')
const webhook = schemas.ContractsPublicationChangedWebhook || schemas.PublicationChangedWebhook || {}
if (!JSON.stringify(webhook).includes('tenant_reference')) failures.push('OpenAPI webhook-schema saknar tenant_reference')
if (!JSON.stringify(webhook).includes('publication_revision')) failures.push('OpenAPI webhook-schema saknar publication_revision')

if (failures.length) {
  console.error('Gridex OPS summary 1 regression failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Gridex OPS summary 1 regression passed.')
