#!/usr/bin/env node
const fs = require('node:fs')
const website = JSON.parse(fs.readFileSync('docs/openapi/website-integration-v1.json', 'utf8'))
const failures = []

function resolveSchema(schema) {
  if (!schema?.$ref) return schema
  const prefix = '#/components/schemas/'
  if (!schema.$ref.startsWith(prefix)) return schema
  return website.components.schemas[schema.$ref.slice(prefix.length)]
}

function schemaErrors(value, unresolvedSchema, location) {
  const schema = resolveSchema(unresolvedSchema)
  if (!schema || typeof schema !== 'object') return []
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.flatMap((branch) => schemaErrors(value, branch, location))
  }
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const branches = schema.oneOf ?? schema.anyOf
    if (branches.some((branch) => schemaErrors(value, branch, location).length === 0)) return []
    return [`${location} does not match any documented schema branch.`]
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const typeMatches = types.length === 0 || types.includes(actualType) ||
    (types.includes('integer') && actualType === 'number' && Number.isInteger(value))
  if (!typeMatches) return [`${location} must be ${types.join(' or ')}, got ${actualType}.`]
  if (schema.const !== undefined && value !== schema.const) {
    return [`${location} must equal ${JSON.stringify(schema.const)}.`]
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return [`${location} is outside the documented enum.`]
  }
  if (actualType === 'object') {
    const errors = []
    const properties = schema.properties ?? {}
    for (const field of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${location} missing required field ${field}.`)
    }
    if (schema.additionalProperties === false) {
      for (const field of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, field)) errors.push(`${location} contains undocumented field ${field}.`)
      }
    }
    for (const [field, item] of Object.entries(value)) {
      if (properties[field]) errors.push(...schemaErrors(item, properties[field], `${location}.${field}`))
    }
    return errors
  }
  if (actualType === 'array' && schema.items) {
    return value.flatMap((item, index) => schemaErrors(item, schema.items, `${location}[${index}]`))
  }
  return []
}

function validateExample(example, schema, location) {
  failures.push(...schemaErrors(example, schema, location))
}

const current = website.paths?.['/api/v1/website/market-price/current']?.post
const currentExample = current?.responses?.['200']?.content?.['application/json']?.example
if (!currentExample?.data) failures.push('Current market-price response example is missing.')
for (const field of [
  'provider', 'resolution_id', 'price_area', 'reference_type', 'resolution',
  'selected_resolution', 'available_resolutions', 'time_start', 'time_end',
  'price_sek_per_kwh', 'price_ore_per_kwh', 'price_ex_vat_sek_per_kwh',
  'price_ex_vat_ore_per_kwh', 'fallback_used', 'source_as_of', 'next_update_at',
]) {
  if (!(field in (currentExample?.data ?? {}))) failures.push(`Current market-price example missing ${field}.`)
}
validateExample(currentExample, current?.responses?.['200']?.content?.['application/json']?.schema, 'Current market-price response example')

const quoteExample = website.paths?.['/api/v1/website/quote']?.post?.responses?.['201']?.content?.['application/json']?.example
validateExample(
  quoteExample,
  website.paths['/api/v1/website/quote'].post.responses['201'].content['application/json'].schema,
  'Quote response example',
)
const marketReference = quoteExample?.data?.market_reference
for (const field of [
  'price_sek_per_kwh', 'price_ore_per_kwh', 'requested_days', 'included_days',
  'source_as_of', 'generated_at', 'stale_after', 'effective_stale_at', 'fallback_used',
]) {
  if (!(field in (marketReference ?? {}))) failures.push(`Quote market_reference example missing ${field}.`)
}
if (marketReference && marketReference.price_ore_per_kwh !== marketReference.price_sek_per_kwh * 100) {
  failures.push('Quote market_reference SEK/öre example conversion is inconsistent.')
}
const schema = website.components?.schemas?.MarketReference
for (const field of schema?.required ?? []) {
  if (!(field in (schema.properties ?? {}))) failures.push(`MarketReference required field ${field} has no property schema.`)
}

const publicContractsExample = JSON.parse(
  fs.readFileSync('docs/fixtures/public-contracts-response-2026-08-14.1.json', 'utf8'),
)
const { validateResponse } = require('./lib/openapi-schema-validator.cjs')
failures.push(...validateResponse(website, '/api/v1/website/public-contracts', publicContractsExample))
const documentedPublicContractsExample =
  website.paths?.['/api/v1/website/public-contracts']?.get?.responses?.['200']
    ?.content?.['application/json']?.example
if (JSON.stringify(documentedPublicContractsExample) !== JSON.stringify(publicContractsExample)) {
  failures.push('Published public-contracts example must be generated from the production-like fixture.')
}

// The customer-portal developer URL is now intentionally the canonical supplier
// Partner API guide. Legacy Website API correctness remains protected by its
// OpenAPI schemas/examples above and by the dedicated legacy integration guide.
const partnerDocumentationPage = fs.readFileSync('app/developers/partner-api/page.tsx', 'utf8')
const customerPortalRoute = fs.readFileSync('app/developers/customer-portal-api/page.tsx', 'utf8')
const legacyWebsiteGuide = fs.readFileSync('docs/external-website-api-integration-guide.md', 'utf8')

for (const requiredTerm of [
  'backend-to-backend',
  'Company setup is intentionally outside this API',
  'Authorization: Bearer $GRIDEX_API_KEY',
  'Idempotency-Key',
  '/contract/{contract_reference}/state',
  '/customer/{customer_reference}/site/{site_reference}/invoice',
  '/customer/{customer_reference}/site/{site_reference}/measurement',
  '/webhook/subscription',
  'request_id',
  'api_version',
  'HMAC-SHA256',
  'x-gridex-signature',
]) {
  if (!partnerDocumentationPage.includes(requiredTerm)) {
    failures.push(`Partner developer guide is missing ${requiredTerm}.`)
  }
}
if (!customerPortalRoute.includes("import PartnerApiDocumentationPage from '../partner-api/page'")) {
  failures.push('Customer Portal developer URL must render the canonical Partner API guide.')
}
if (!customerPortalRoute.includes('<PartnerApiDocumentationPage />')) {
  failures.push('Customer Portal developer URL does not render PartnerApiDocumentationPage.')
}

// Keep the canonical Partner guide fully tenant-neutral. The legacy Website
// guide intentionally documents the DX customer-number format with a synthetic
// DX-123456 placeholder, so keep checking it for actual customer/operator data
// without treating that format example as production data.
const sensitiveDocumentationPatterns = [
  ['personal email address', /heke99@live\.se/i],
  ['tenant-specific GRIDEX-WEB external id', /GRIDEX-WEB-[A-Z0-9-]+/],
  ['personal customer name', /Hekmat Hourani/i],
  ['tenant-specific auth placeholder', /gridex-web-supabase-session-user-id/i],
]
for (const [label, pattern] of [
  ...sensitiveDocumentationPatterns,
  ['production-looking DX customer number', /DX-[0-9]{4,}/],
]) {
  if (pattern.test(partnerDocumentationPage)) {
    failures.push(`Canonical Partner documentation contains ${label}; examples must remain tenant-neutral.`)
  }
}
for (const [label, pattern] of sensitiveDocumentationPatterns) {
  if (pattern.test(legacyWebsiteGuide)) {
    failures.push(`Legacy Website integration documentation contains ${label}; examples must remain synthetic.`)
  }
}

if (partnerDocumentationPage.includes('company_id') || partnerDocumentationPage.includes('tenant_id')) {
  failures.push('Canonical Partner developer guide must not expose company_id or tenant_id selection fields.')
}
if (partnerDocumentationPage.includes('tenant_reference')) {
  failures.push('Canonical Partner developer guide must not expose tenant_reference.')
}

// Legacy Website API guide stays available for already-connected website clients.
for (const requiredLegacyTerm of [
  'powerOfAttorney',
  'textVersionId',
  'next_step',
  'automatic_processing',
]) {
  if (!legacyWebsiteGuide.includes(requiredLegacyTerm)) {
    failures.push(`Legacy Website API guide is missing ${requiredLegacyTerm}.`)
  }
}

const canonicalOption = website.components?.schemas?.ContractPriceOption
if (canonicalOption?.properties?.default?.deprecated !== true) {
  failures.push('Website OpenAPI requires default to remain deprecated.')
}
for (const enumValue of canonicalOption?.properties?.resolution?.enum ?? []) {
  if (!['monthly', 'hourly', 'quarterly'].includes(enumValue)) {
    failures.push(`Website OpenAPI contains unexpected contract-price resolution enum ${enumValue}.`)
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log('API documentation examples OK (canonical Partner guide + legacy Website OpenAPI/guide).')