#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const root = process.cwd()
let checks = 0
function read(rel) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) throw new Error(`Missing file: ${rel}`)
  return fs.readFileSync(full, 'utf8')
}
function assert(condition, message) { checks += 1; if (!condition) throw new Error(message) }
function includes(rel, value) { assert(read(rel).includes(value), `${rel} missing: ${value}`) }
function excludes(rel, value) { assert(!read(rel).includes(value), `${rel} must not contain: ${value}`) }
function securityRequirements(spec) {
  const requirements = Array.isArray(spec.security) ? [...spec.security] : []
  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = pathItem?.[method]
      if (Array.isArray(operation?.security)) requirements.push(...operation.security)
    }
  }
  return requirements
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

for (const oldEnv of ['GRIDEX_OPS_APPLICATION_QUOTE_REFERENCE_MODE','GRIDEX_EXPECTED_COMPANY_ID','GRIDEX_EXPECTED_TENANT_REFERENCE','GRIDEX_TENANT_ID']) {
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
includes('lib/integrations/tenantContext.ts', 'website_checkout_ready: readiness.website_checkout_ready')
includes('lib/integrations/tenantContext.ts', 'loadTenantWebsiteFlowReadiness')
includes('app/admin/platform/api-clients/actions.ts', 'reconcileAndPersistTenantWebsiteClientReadiness')

const developerPage = read('app/developers/customer-portal-api/page.tsx')
for (const token of ['partnerOpenApi','PARTNER_API_BASE_URL','PARTNER_API_VERSION','Gridex API','Website checkout','Customer Portal','Partner API','Webhooks']) {
  assert(developerPage.includes(token), `unified developer documentation missing ${token}`)
}
for (const token of ['GRIDEX_TENANT_ID', 'GRIDEX_EXPECTED_COMPANY_ID']) assert(!developerPage.includes(token), `developer documentation leaks legacy tenant selector ${token}`)

includes('lib/partner-api/openApi.ts', "PARTNER_API_BASE_URL = 'https://app.gridex.se/api/partner/v1'")
includes('lib/partner-api/openApi.ts', 'Gridex configures the company, API credential, permissions and default published offer outside the API.')
excludes('lib/partner-api/openApi.ts', 'tenant_id_environment_required')
excludes('lib/partner-api/openApi.ts', 'company_id_environment_required')
includes('lib/integrations/openApiResponse.ts', "'Access-Control-Allow-Origin': '*'")
includes('lib/integrations/websiteApiContract.ts', 'quote_reference: QuoteReference | string')
includes('lib/integrations/websiteApiContract.ts', 'resolution_id: string')
includes('lib/integrations/websiteApiContract.ts', 'Always top-level')

const websiteSpec = JSON.parse(read('docs/openapi/website-integration-v1.json'))
const portalSpec = JSON.parse(read('docs/openapi/customer-portal-v1.json'))
for (const [name, spec] of [['website', websiteSpec], ['portal', portalSpec]]) {
  assert(Array.isArray(spec.servers) && spec.servers.some((server) => server.url === 'https://app.gridex.se'), `${name} OpenAPI wrong server origin`)
  const security = securityRequirements(spec)
  assert(security.some((item) => Object.hasOwn(item, 'bearerAuth')), `${name} OpenAPI must support canonical Bearer authentication`)
  assert(security.some((item) => Object.hasOwn(item, 'legacyApiKeyAuth')), `${name} OpenAPI must preserve the documented legacy API-key transport`)
  const schemes = spec.components?.securitySchemes ?? {}
  assert(Boolean(schemes.bearerAuth), `${name} OpenAPI missing bearerAuth security scheme`)
  assert(Boolean(schemes.legacyApiKeyAuth), `${name} OpenAPI missing legacyApiKeyAuth security scheme`)
}

const apiAuth = read('lib/integrations/apiAuth.ts')
assert(apiAuth.includes("/^Bearer ([^\\s]+)$/i") && apiAuth.includes("request.headers.get('x-api-key')"), 'runtime auth must implement both documented credential transports')
assert(apiAuth.includes("rpc('authenticate_integration_request_v1'"), 'runtime auth must resolve tenant/client/scope/rate-limit atomically')

const requestSchema = websiteSpec.components.schemas.CustomerApplicationRequest
assert(requestSchema, 'Website OpenAPI missing CustomerApplicationRequest')
for (const field of ['offer_reference', 'quote_reference', 'resolution_id']) {
  assert(requestSchema.required.includes(field), `CustomerApplicationRequest must require top-level ${field}`)
  assert(Boolean(requestSchema.properties[field]), `CustomerApplicationRequest missing top-level ${field}`)
  assert(!requestSchema.properties.contract.properties[field], `contract must not define ${field}`)
}
assert(!Object.keys(portalSpec.paths ?? {}).some((route) => route.startsWith('/api/v1/website/')), 'Portal OpenAPI must not duplicate website routes')

const externalGuide = 'docs/external-website-api-integration-guide.md'
includes(externalGuide, 'GRIDEX_API_KEY')
includes(externalGuide, 'Base URL: `https://app.gridex.se`')
includes(externalGuide, 'GET /api/v1/website/public-contracts')
includes(externalGuide, 'https://app.gridex.se/api/v1/openapi/website-integration-v1.json')
for (const rel of ['docs/gridex-customer-portal-api.md','docs/single-api-key-tenant-integration.md']) {
  includes(rel, 'GRIDEX_API_KEY')
  includes(rel, 'https://app.gridex.se/api/v1')
  includes(rel, 'https://app.gridex.se/api/v1/openapi/website-integration-v1.json')
}
for (const scope of ['integration_context.read','website_contracts.read','website_energy_area.resolve','website_market_prices.read','website_quotes.write','website_quotes.validate','website_legal.read','website_applications.write','website_switch_status.read']) includes('lib/integrations/apiClientProfiles.ts', `'${scope}'`)
includes('scripts/single-api-key-integration-readiness.sql', '["GRIDEX_API_KEY"]')
includes('app/admin/platform/api-clients/CreateApiClientForm.tsx', 'GRIDEX_API_KEY')

console.log(`Gridex single API-key tenant integration regression OK (${checks} checks)`)
