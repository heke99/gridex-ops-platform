#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
let checks = 0

function read(rel) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) throw new Error(`Missing file: ${rel}`)
  return fs.readFileSync(full, 'utf8')
}
function assert(condition, message) {
  checks += 1
  if (!condition) throw new Error(message)
}
function includes(rel, value) {
  const text = read(rel)
  assert(text.includes(value), `${rel} missing: ${value}`)
}
function excludes(rel, value) {
  const text = read(rel)
  assert(!text.includes(value), `${rel} must not contain: ${value}`)
}

const contract = read('lib/integrations/websiteIntegrationContract.ts')
for (const value of [
  "WEBSITE_TENANT_REQUIRED_ENVIRONMENT_VARIABLES = ['GRIDEX_API_KEY']",
  "WEBSITE_APPLICATION_REFERENCE_LOCATION = 'top_level'",
  "WEBSITE_INTEGRATION_ORIGIN = 'https://app.gridex.se'",
  "WEBSITE_INTEGRATION_BASE_PATH = '/api/v1'",
  "WEBSITE_INTEGRATION_OPENAPI_PATH = '/api/v1/openapi/website-integration-v1.json'",
  "CUSTOMER_PORTAL_OPENAPI_PATH = '/api/v1/openapi/customer-portal-v1.json'",
]) assert(contract.includes(value), `Canonical integration contract missing ${value}`)

for (const oldEnv of [
  'GRIDEX_OPS_APPLICATION_QUOTE_REFERENCE_MODE',
  'GRIDEX_EXPECTED_COMPANY_ID',
  'GRIDEX_EXPECTED_TENANT_REFERENCE',
  'GRIDEX_TENANT_ID',
]) {
  for (const rel of [
    'lib/integrations/websiteIntegrationContract.ts',
    'app/developers/customer-portal-api/page.tsx',
    'docs/external-website-api-integration-guide.md',
    'docs/gridex-customer-portal-api.md',
    'docs/single-api-key-tenant-integration.md',
  ]) excludes(rel, oldEnv)
}

for (const rel of [
  'app/api/v1/openapi/website-integration-v1.json/route.ts',
  'app/api/v1/openapi/customer-portal-v1.json/route.ts',
  'lib/integrations/openApiResponse.ts',
]) includes(rel, 'openApiDocumentResponse')

includes('lib/api/publicRouteRegistry.ts', "path: '/api/v1/openapi/website-integration-v1.json'")
includes('lib/api/publicRouteRegistry.ts', "path: '/api/v1/openapi/customer-portal-v1.json'")
includes('lib/integrations/tenantContext.ts', 'required_environment_variables: WEBSITE_TENANT_REQUIRED_ENVIRONMENT_VARIABLES')
includes('lib/integrations/tenantContext.ts', 'application_reference_location: WEBSITE_APPLICATION_REFERENCE_LOCATION')
includes('lib/integrations/tenantContext.ts', 'website_checkout_ready: missingWebsiteScopes.length === 0')
includes('app/admin/platform/api-clients/actions.ts', 'missingIntegrationApiScopes(scopes, TENANT_WEBSITE_RECOMMENDED_SCOPES)')
includes('app/developers/customer-portal-api/page.tsx', '"tenant_id_environment_required": false')
includes('app/developers/customer-portal-api/page.tsx', '"company_id_environment_required": false')
includes('lib/integrations/openApiResponse.ts', "'Access-Control-Allow-Origin': '*'")
includes('lib/integrations/websiteApiContract.ts', 'quote_reference: QuoteReference | string')
includes('lib/integrations/websiteApiContract.ts', 'resolution_id: string')
includes('lib/integrations/websiteApiContract.ts', 'Always top-level')

const websiteSpec = JSON.parse(read('docs/openapi/website-integration-v1.json'))
const portalSpec = JSON.parse(read('docs/openapi/customer-portal-v1.json'))
for (const [name, spec] of [['website', websiteSpec], ['portal', portalSpec]]) {
  const setup = spec['x-gridex-tenant-setup']
  assert(setup && Array.isArray(setup.required_environment_variables), `${name} OpenAPI missing x-gridex-tenant-setup`)
  assert(JSON.stringify(setup.required_environment_variables) === JSON.stringify(['GRIDEX_API_KEY']), `${name} OpenAPI must require only GRIDEX_API_KEY`)
  assert(setup.api_base_url === 'https://app.gridex.se/api/v1', `${name} OpenAPI wrong base URL`)
  assert(setup.application_reference_location === 'top_level', `${name} OpenAPI wrong application reference location`)
  assert(Boolean(spec.paths['/api/v1/openapi/website-integration-v1.json']), `${name} OpenAPI missing public website spec route`)
  assert(Boolean(spec.paths['/api/v1/openapi/customer-portal-v1.json']), `${name} OpenAPI missing public portal spec route`)
}

const requestSchema = websiteSpec.components.schemas.CustomerApplicationRequest
assert(requestSchema, 'Website OpenAPI missing CustomerApplicationRequest')
for (const field of ['offer_reference', 'quote_reference', 'resolution_id']) {
  assert(requestSchema.required.includes(field), `CustomerApplicationRequest must require top-level ${field}`)
  assert(Boolean(requestSchema.properties[field]), `CustomerApplicationRequest missing top-level ${field}`)
}
for (const field of ['offer_reference', 'quote_reference', 'resolution_id']) {
  assert(!requestSchema.properties.contract.properties[field], `contract must not define ${field}`)
}

const portalRequest = portalSpec.components.schemas.WebsiteCustomerApplicationRequest
assert(portalRequest, 'Portal OpenAPI missing WebsiteCustomerApplicationRequest')
for (const field of ['offer_reference', 'quote_reference', 'resolution_id']) {
  assert(portalRequest.required.includes(field), `WebsiteCustomerApplicationRequest must require top-level ${field}`)
  assert(Boolean(portalRequest.properties[field]), `WebsiteCustomerApplicationRequest missing top-level ${field}`)
  assert(!portalRequest.properties.contract.properties[field], `Portal contract must not define ${field}`)
}

for (const rel of [
  'docs/external-website-api-integration-guide.md',
  'docs/gridex-customer-portal-api.md',
  'docs/single-api-key-tenant-integration.md',
]) {
  includes(rel, 'GRIDEX_API_KEY')
  includes(rel, 'https://app.gridex.se/api/v1')
  includes(rel, 'https://app.gridex.se/api/v1/openapi/website-integration-v1.json')
}
includes('app/developers/customer-portal-api/page.tsx', 'GRIDEX_API_KEY')
includes('app/developers/customer-portal-api/page.tsx', 'WEBSITE_INTEGRATION_BASE_URL')
includes('app/developers/customer-portal-api/page.tsx', 'WEBSITE_INTEGRATION_OPENAPI_URL')

const developerPage = read('app/developers/customer-portal-api/page.tsx')
const appExampleStart = developerPage.indexOf('const applicationExample = `')
const appExampleEnd = developerPage.indexOf('`\n\n// Identity aliases', appExampleStart)
assert(appExampleStart >= 0 && appExampleEnd > appExampleStart, 'Developer application example not found')
const appExample = developerPage.slice(appExampleStart, appExampleEnd)
for (const field of ['"offer_reference":', '"quote_reference":', '"resolution_id":']) {
  assert(appExample.includes(field), `Developer application example missing top-level ${field}`)
}
const contractStart = appExample.indexOf('"contract": {')
const contractEnd = appExample.indexOf('},', contractStart)
const contractExample = appExample.slice(contractStart, contractEnd)
for (const field of ['offer_reference', 'quote_reference', 'resolution_id']) {
  assert(!contractExample.includes(field), `Developer contract example must not contain ${field}`)
}

for (const scope of [
  'integration_context.read',
  'website_contracts.read',
  'website_energy_area.resolve',
  'website_quotes.write',
  'website_quotes.validate',
  'website_legal.read',
  'website_applications.write',
  'website_switch_status.read',
]) {
  includes('lib/integrations/apiClientProfiles.ts', `'${scope}'`)
  includes('supabase/migrations/20260724170000_single_api_key_tenant_website_integration.sql', `'${scope}'`)
}
includes('lib/integrations/apiClientProfiles.ts', "key: 'tenant_website'")
includes('supabase/migrations/20260724170000_single_api_key_tenant_website_integration.sql', "'tenant_website'")
includes('scripts/single-api-key-integration-readiness.sql', 'website_checkout_client_missing_scope')
includes('scripts/single-api-key-integration-readiness.sql', 'tenant_website_client_missing_portal_scope')
includes('scripts/single-api-key-integration-readiness.sql', '["GRIDEX_API_KEY"]')
includes('app/admin/platform/api-clients/CreateApiClientForm.tsx', 'GRIDEX_API_KEY')
includes('app/admin/platform/api-clients/actions.ts', 'application_reference_location: WEBSITE_APPLICATION_REFERENCE_LOCATION')

console.log(`Gridex single API-key tenant integration regression OK (${checks} checks)`)
