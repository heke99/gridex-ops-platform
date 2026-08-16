#!/usr/bin/env node
const fs = require('node:fs')

const legacyExpected = '2026-08-14.1'
const partnerExpected = '2026-08-16.2'
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
const legacyGuide = fs.readFileSync('app/developers/customer-portal-api/page.tsx', 'utf8')
const partnerCore = fs.readFileSync('lib/partner-api/core.ts', 'utf8')
const canonical = fs.readFileSync('lib/partner-api/canonical.ts', 'utf8')
const partnerRoute = fs.readFileSync('app/api/partner/v1/[[...path]]/route.ts', 'utf8')
const eventMigration = fs.readFileSync('supabase/migrations/20260816170000_partner_api_v1_canonical_surface_events.sql', 'utf8')

if (!partnerOpenApi.includes(partnerExpected)) {
  failures.push(`lib/partner-api/openApi.ts does not expose Partner API version ${partnerExpected}`)
}
if (!partnerGuide.includes('PARTNER_API_VERSION')) {
  failures.push('Partner developer guide must render the canonical PARTNER_API_VERSION source')
}
if (!partnerGuide.includes('v{PARTNER_API_VERSION}')) {
  failures.push('Partner developer guide must visibly render the canonical Partner API version')
}
if (!legacyGuide.includes('Customer Portal API')) {
  failures.push('Legacy Customer Portal developer guide must remain available as a separate contract')
}

for (const marker of [
  "PARTNER_API_BASE_URL = 'https://app.gridex.se/api/partner/v1'",
  "'/contract'",
  "'/contract/{contract_reference}/state'",
  "'/customer/{customer_reference}/site/{site_reference}/powerofattorney'",
  "'/customer/{customer_reference}/site/{site_reference}/invoice'",
  "'/customer/{customer_reference}/site/{site_reference}/measurement'",
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

for (const event of [
  'customer.created',
  'customer.updated',
  'site.created',
  'site.updated',
  'power_of_attorney.created',
  'contract.created',
  'contract.status_changed',
  'invoice.created',
  'invoice.updated',
]) {
  if (!partnerOpenApi.includes(`'${event}'`)) failures.push(`Partner OpenAPI is missing webhook event ${event}`)
  if (!eventMigration.includes(`'${event}'`)) failures.push(`Partner event migration is missing webhook event ${event}`)
}

for (const marker of [
  'Partner API v1',
  '/api/partner/v1/openapi.json',
  'backend-to-backend',
  'Company onboarding is not part of the Partner API',
  'Existing plural Partner API routes',
]) {
  if (!partnerGuide.includes(marker)) failures.push(`Partner developer guide is missing marker: ${marker}`)
}

if (!partnerCore.includes('assertPublicResponsePayload(envelope)')) {
  failures.push('Partner API success payloads must pass the public payload safety guard')
}
if (!partnerCore.includes('executeIdempotentPortalWrite')) {
  failures.push('Partner API writes must use canonical idempotency')
}
if (!canonical.includes('path_body_reference_mismatch')) {
  failures.push('Canonical nested routes must reject conflicting path/body resource references')
}
if (!canonical.includes(".eq('company_id', access.client.company_id)")) {
  failures.push('Canonical nested routes must enforce credential-bound company ownership')
}
if (!partnerRoute.includes('handleCanonicalPartnerApi') || !partnerRoute.includes('handlePartnerApi')) {
  failures.push('Partner route must serve canonical paths and retain compatibility aliases')
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log(`API documentation parity OK (legacy ${legacyExpected}; Partner API ${partnerExpected}).`)
