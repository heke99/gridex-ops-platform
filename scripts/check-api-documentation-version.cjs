#!/usr/bin/env node
const fs = require('node:fs')

const legacyExpected = '2026-08-14.1'
const partnerExpected = '2026-08-17.1'
const legacyFiles = [
  'lib/integrations/websiteIntegrationContract.ts',
  'docs/openapi/website-integration-v1.json',
  'docs/openapi/customer-portal-v1.json',
  'docs/external-website-api-integration-guide.md',
  'docs/gridex-customer-portal-api.md',
  'docs/single-api-key-tenant-integration.md',
]
const failures = []

for (const file of legacyFiles) {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes(legacyExpected)) failures.push(`${file} does not expose ${legacyExpected}`)
  if (source.includes('2026-07-24.1')) failures.push(`${file} still contains the superseded contract version`)
}

const mapperSource = fs.readFileSync('lib/external-contracts/publicationDto.ts', 'utf8')
if (!mapperSource.includes('WEBSITE_INTEGRATION_CONTRACT_VERSION')) {
  failures.push('API public-contract mapper must reuse the canonical runtime version source')
}
if (/API_CONTRACT_RESPONSE_SCHEMA_VERSION\s*=\s*['"]/.test(mapperSource)) {
  failures.push('API public-contract mapper must not hardcode a second contract version')
}

for (const file of ['docs/openapi/website-integration-v1.json', 'docs/openapi/customer-portal-v1.json']) {
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (spec.info?.version !== legacyExpected) failures.push(`${file} info.version mismatch`)
  if (spec['x-contract-schema-version'] !== legacyExpected) failures.push(`${file} x-contract-schema-version mismatch`)
}

const partnerOpenApi = fs.readFileSync('lib/partner-api/openApi.ts', 'utf8')
const partnerGuide = fs.readFileSync('app/developers/partner-api/page.tsx', 'utf8')
const customerPortalDeveloperRoute = fs.readFileSync('app/developers/customer-portal-api/page.tsx', 'utf8')
const simple = fs.readFileSync('lib/partner-api/simple.ts', 'utf8')
const partnerCore = fs.readFileSync('lib/partner-api/core.ts', 'utf8')
const canonical = fs.readFileSync('lib/partner-api/canonical.ts', 'utf8')
const partnerRoute = fs.readFileSync('app/api/partner/v1/[[...path]]/route.ts', 'utf8')
const eventMigration = fs.readFileSync('supabase/migrations/20260816170000_partner_api_v1_canonical_surface_events.sql', 'utf8')
const webhookTransport = fs.readFileSync('lib/integrations/publicWebhookTransport.ts', 'utf8')
const webhookDispatch = fs.readFileSync('lib/integrations/webhooks.ts', 'utf8')

if (!partnerOpenApi.includes(partnerExpected)) {
  failures.push(`lib/partner-api/openApi.ts does not expose Partner API version ${partnerExpected}`)
}
if (!partnerGuide.includes('PARTNER_API_VERSION')) {
  failures.push('Partner developer guide must render the canonical PARTNER_API_VERSION source')
}
if (!partnerGuide.includes('v{PARTNER_API_VERSION}')) {
  failures.push('Partner developer guide must visibly render the canonical Partner API version')
}
if (!customerPortalDeveloperRoute.includes("import PartnerApiDocumentationPage from '../partner-api/page'")) {
  failures.push('The /developers/customer-portal-api route must render the canonical Partner API guide')
}

for (const marker of [
  "PARTNER_API_BASE_URL = 'https://app.gridex.se/api/partner/v1'",
  "'/contract'",
  "'/contract/{contract_id}/state'",
  "'/customer/{customer_id}/site/{site_id}/powerofattorney'",
  "'/customer/{customer_id}/site/{site_id}/invoice'",
  "'/customer/{customer_id}/site/{site_id}/measurement'",
  "'/webhook/subscription'",
  'Idempotency-Key',
]) {
  if (!partnerOpenApi.includes(marker)) failures.push(`Partner OpenAPI is missing marker: ${marker}`)
}

for (const legacyPath of ["'/contracts'", "'/customers'", "'/sites'", "'/webhooks/subscriptions'"]) {
  if (partnerOpenApi.includes(legacyPath)) {
    failures.push(`Canonical Partner OpenAPI must not expose compatibility alias ${legacyPath}`)
  }
}
if (partnerOpenApi.includes('offer_reference:')) {
  failures.push('Canonical Partner OpenAPI must not require an internal offer_reference')
}
if (partnerOpenApi.includes('company_id:') || partnerOpenApi.includes('tenant_id:')) {
  failures.push('Canonical Partner OpenAPI must not expose tenant selection')
}

for (const event of [
  ['CUSTOMER_CREATED', 'customer.created'],
  ['CUSTOMER_UPDATED', 'customer.updated'],
  ['SITE_CREATED', 'site.created'],
  ['SITE_UPDATED', 'site.updated'],
  ['POWER_OF_ATTORNEY_CREATED', 'power_of_attorney.created'],
  ['CONTRACT_CREATED', 'contract.created'],
  ['CONTRACT_STATUS_CHANGE', 'contract.status_changed'],
  ['INVOICE_CREATED', 'invoice.created'],
  ['INVOICE_UPDATED', 'invoice.updated'],
]) {
  if (!partnerOpenApi.includes(`'${event[0]}'`)) failures.push(`Partner OpenAPI is missing webhook event ${event[0]}`)
  if (!simple.includes(`${event[0]}:`)) failures.push(`Simple Partner handler is missing webhook mapping ${event[0]}`)
  if (!eventMigration.includes(`'${event[1]}'`)) failures.push(`Partner event migration is missing internal webhook event ${event[1]}`)
  if (!webhookDispatch.includes(`'${event[1]}'`)) failures.push(`Webhook dispatcher is missing internal Partner event ${event[1]}`)
}

for (const marker of [
  'Partner API Reference',
  'Registration, Data Retrieval & Webhooks',
  '/api/partner/v1/openapi.json',
  'Gridex determines the company from the API key and resolves the electricity area',
  'published electricity offer server-side',
]) {
  if (!partnerGuide.includes(marker)) failures.push(`Partner developer guide is missing marker: ${marker}`)
}
if (partnerGuide.includes('tenant_reference')) {
  failures.push('Canonical Partner developer guide must not expose tenant_reference')
}
if (partnerGuide.includes('offer_reference')) {
  failures.push('Canonical Partner developer guide must not require partners to select internal offers')
}

if (!webhookTransport.includes("url.protocol !== 'https:'") || !webhookTransport.includes('pinned.address')) {
  failures.push('Partner webhook delivery must validate public HTTPS and pin the resolved address')
}
if (!webhookDispatch.includes('postPublicWebhook')) {
  failures.push('Webhook dispatcher must use the hardened public webhook transport')
}
if (!simple.includes('executeIdempotentPortalWrite')) {
  failures.push('Simple Partner API writes must use canonical idempotency')
}
if (!simple.includes("supabaseService.rpc('gridex_create_partner_contract_v1'")) {
  failures.push('Simple Partner contract registration must reuse the transactional canonical RPC')
}
if (!simple.includes(".from('canonical_public_contract_diagnostics_v')")) {
  failures.push('Simple Partner API must resolve published offers server-side')
}
if (!simple.includes("key === 'company_id' || key === 'tenant_id' || key === 'tenant_reference'")) {
  failures.push('Simple Partner API must reject tenant selectors recursively')
}
if (!simple.includes(".select('file_path,metadata')") || simple.includes(".select('public_url')")) {
  failures.push('Simple Partner invoice PDF must use private storage file paths, not public URL descriptors')
}
if (!partnerCore.includes('assertPublicResponsePayload(envelope)')) {
  failures.push('Compatibility Partner API success payloads must retain the public payload safety guard')
}
if (!canonical.includes('path_body_reference_mismatch')) {
  failures.push('Compatibility canonical nested routes must reject conflicting path/body resource references')
}
if (!partnerRoute.includes('handleSimplePartnerApi') || !partnerRoute.includes('handleCanonicalPartnerApi') || !partnerRoute.includes('handlePartnerApi')) {
  failures.push('Partner route must serve the simple contract first and retain compatibility handlers')
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log(`API documentation parity OK (legacy ${legacyExpected}; simple Partner API ${partnerExpected}).`)
