#!/usr/bin/env node
const fs = require('node:fs')

const registrySource = fs.readFileSync('lib/api/publicRouteRegistry.ts', 'utf8')
const routeRe = /{ method: '(GET|POST)', path: '([^']+)'(?:, publicPath: '([^']+)')?, scopes: \[([^\]]*)\]/g
const registry = []
let match
while ((match = routeRe.exec(registrySource))) {
  const line = registrySource.slice(match.index, registrySource.indexOf('\n', match.index))
  const publicPath = match[3] ?? match[2]
  const operationId = `${match[1].toLowerCase()}${publicPath
    .split('/').filter(Boolean)
    .map((segment) => segment.replace(/^\[|\]$/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('')).join('')}`
  registry.push({
    method: match[1],
    path: publicPath,
    runtimePath: match[2],
    normalizedPath: (match[3] ?? match[2]).replace(/\[[^\]]+\]/g, '{}'),
    scopes: [...match[4].matchAll(/'([^']+)'/g)].map((item) => item[1]),
    operationId,
    scopeMode: ['/api/v1/website/legal-bundle', '/api/v1/customer/profile-update'].includes(match[2]) ? 'any' : 'all',
    rateLimitClass: /rateLimitClass: '(read|write|expensive)'/.exec(line)?.[1],
    idempotencyRequired: line.includes('idempotencyRequired: true'),
    cachePolicy: match[2].includes('/openapi/') ? match[2].includes('/2026-') ? 'public-immutable' : 'private-revalidate' : 'no-store',
    publicIdPolicy: match[2].includes('/openapi/') ? 'none' : 'opaque-references',
  })
}

const specs = [
  JSON.parse(fs.readFileSync('docs/openapi/website-integration-v1.json', 'utf8')),
  JSON.parse(fs.readFileSync('docs/openapi/customer-portal-v1.json', 'utf8')),
]
const failures = []
const operations = []
for (const spec of specs) {
  const specOperationIds = []
  for (const [path, value] of Object.entries(spec.paths ?? {})) {
    if (!path.startsWith('/api/v1')) continue
    for (const method of ['get', 'post']) {
      if (!value[method]) continue
      operations.push({
        method: method.toUpperCase(),
        path,
        normalizedPath: path.replace(/\{[^}]+\}/g, '{}'),
        scopes: value[method]['x-required-scopes'] ?? [],
        operationId: value[method].operationId,
        scopeMode: value[method]['x-scope-mode'],
        rateLimitClass: value[method]['x-rate-limit-class'],
        idempotencyRequired: value[method]['x-idempotency-required'] === true,
        cachePolicy: value[method]['x-cache-policy'],
        publicIdPolicy: value[method]['x-public-id-policy'],
      })
      specOperationIds.push(value[method].operationId)
    }
  }
  const invalid = specOperationIds.filter((id) => typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(id))
  if (invalid.length) failures.push(`${spec.info?.title ?? 'OpenAPI'} has invalid operationIds.`)
  if (new Set(specOperationIds).size !== specOperationIds.length) failures.push(`${spec.info?.title ?? 'OpenAPI'} has duplicate operationIds.`)
}

for (const route of registry) {
  const matches = operations.filter((candidate) =>
    candidate.method === route.method && candidate.normalizedPath === route.normalizedPath)
  if (!matches.length) failures.push(`Registry route missing in OpenAPI: ${route.method} ${route.path}`)
  for (const operation of matches) {
    for (const field of ['operationId', 'scopeMode', 'rateLimitClass', 'idempotencyRequired', 'cachePolicy', 'publicIdPolicy']) {
      if (operation[field] !== route[field]) failures.push(`${route.method} ${route.path} metadata mismatch: ${field}`)
    }
    if (JSON.stringify(operation.scopes) !== JSON.stringify(route.scopes)) {
      failures.push(`${route.method} ${route.path} scope metadata mismatch.`)
    }
  }
}
for (const operation of operations) {
  const route = registry.find((candidate) =>
    candidate.method === operation.method && candidate.normalizedPath === operation.normalizedPath)
  if (!route) failures.push(`OpenAPI operation missing in registry: ${operation.method} ${operation.path}`)
}

const current = operations.find((operation) =>
  operation.method === 'POST' && operation.path === '/api/v1/website/market-price/current')
if (!current) failures.push('Current market-price operation is missing.')
else if (!current.scopes.includes('website_market_prices.read')) {
  failures.push('Current market-price OpenAPI scope must be website_market_prices.read.')
}

const website = specs[0]
const reachableSchemas = new Set()
function collectSchemaRefs(value) {
  if (!value || typeof value !== 'object') return
  if (typeof value.$ref === 'string') {
    const prefix = '#/components/schemas/'
    if (value.$ref.startsWith(prefix)) {
      const name = value.$ref.slice(prefix.length)
      if (!reachableSchemas.has(name)) {
        reachableSchemas.add(name)
        collectSchemaRefs(website.components.schemas[name])
      }
    }
  }
  for (const nested of Object.values(value)) collectSchemaRefs(nested)
}
collectSchemaRefs(website.paths)

const centralStrictSchemas = [
  'PublicContract',
  'ApiPublicContract',
  'ContractPriceOption',
  'ContractPriceOptionAreaPrice',
  'WebsiteQuoteRequest',
  'QuoteValidationRequest',
  'WebsiteQuoteData',
  'WebsiteQuoteValidationData',
  'CustomerApplicationRequest',
  'WebsiteCustomerApplicationData',
  'WebsiteLegalBlock',
  'LegalBundleDocument',
]
for (const name of centralStrictSchemas) {
  const schema = website.components.schemas[name]
  if (!schema) {
    failures.push(`Central schema missing: ${name}`)
    continue
  }
  if (schema.additionalProperties !== false) {
    failures.push(`Central schema must reject unknown fields: ${name}`)
  }
  if (!reachableSchemas.has(name)) {
    failures.push(`Central schema is unreachable from paths: ${name}`)
  }
}

function requireProperties(schemaName, fields) {
  const schema = website.components.schemas[schemaName]
  for (const field of fields) {
    if (!schema?.properties?.[field]) {
      failures.push(`${schemaName} missing property ${field}`)
    }
  }
}
const commercialAssertions = [
  'price_option_reference',
  'invoice_delivery_method',
  'selected_component_references',
  'site_count',
]
requireProperties('WebsiteQuoteRequest', commercialAssertions)
requireProperties('QuoteValidationRequest', commercialAssertions)
requireProperties('CustomerApplicationRequest', commercialAssertions)
requireProperties('WebsiteQuoteData', [
  ...commercialAssertions,
  'area_price_reference',
  'mandatory_component_references',
  'conditional_component_references',
])
requireProperties('PublicContract', ['price_options', 'pricing', 'legal'])
requireProperties('ApiPublicContract', ['price_options', 'pricing', 'legal'])
requireProperties('ContractPriceOption', [
  'customer_type',
  'is_default',
  'default',
  'selection_required',
  'area_prices',
])
requireProperties('LegalBundleDocument', [
  'id',
  'document_reference',
  'legal_bundle_version_id',
])

const priceOptionSchema = website.components.schemas.ContractPriceOption
for (const field of ['is_default', 'default']) {
  if (!priceOptionSchema.required?.includes(field)) {
    failures.push(`ContractPriceOption required list missing ${field}`)
  }
}
if (priceOptionSchema.properties.default?.deprecated !== true) {
  failures.push('ContractPriceOption.default must be a deprecated alias.')
}
const legalSchema = website.components.schemas.WebsiteLegalBlock
const legalModuleSchema = website.components.schemas.LegalBundleDocument
if (!legalSchema.required?.includes('legal_bundle_version_id')) {
  failures.push('WebsiteLegalBlock legal_bundle_version_id must be required.')
}
if (!legalModuleSchema.required?.includes('legal_bundle_version_id')) {
  failures.push('LegalBundleDocument legal_bundle_version_id must be required.')
}
if (legalSchema.additionalProperties !== false || legalModuleSchema.additionalProperties !== false) {
  failures.push('Legal schemas must remain closed to undocumented fields.')
}

const integrationContextSchema = website.components.schemas.IntegrationContext
const integrationContextOperation =
  website.paths['/api/v1/integration/context']?.get
const integrationContextResponse =
  integrationContextOperation?.responses?.['200']?.content?.['application/json']?.schema
const tenantContextSource = fs.readFileSync(
  'lib/integrations/tenantContext.ts',
  'utf8',
)
const integrationContextRouteSource = fs.readFileSync(
  'app/api/v1/integration/context/route.ts',
  'utf8',
)
const projectionStart = tenantContextSource.indexOf(
  'export function projectPublicExternalTenantContext',
)
const projectionEnd = tenantContextSource.indexOf(
  'export async function loadExternalTenantReference',
  projectionStart,
)
const integrationContextProjection =
  projectionStart >= 0 && projectionEnd > projectionStart
    ? tenantContextSource.slice(projectionStart, projectionEnd)
    : ''

if (!integrationContextResponse?.properties?.data?.$ref?.endsWith('/IntegrationContext')) {
  failures.push('Integration context 200 response must use IntegrationContext as data.')
}
if (integrationContextSchema?.additionalProperties === true) {
  failures.push('IntegrationContext must not explicitly allow arbitrary fields.')
}
const publicContextCapabilities = [
  'website_checkout_ready',
  'customer_portal_ready',
  'complete_tenant_website_ready',
  'required_website_scopes',
  'missing_website_scopes',
  'required_customer_portal_scopes',
  'missing_customer_portal_scopes',
  'recommended_scopes',
  'missing_recommended_scopes',
]
for (const field of publicContextCapabilities) {
  if (!integrationContextSchema?.properties?.capabilities?.properties?.[field]) {
    failures.push(`IntegrationContext capabilities missing ${field}.`)
  }
  if (!integrationContextProjection.includes(`${field}:`)) {
    failures.push(`Public integration-context projection missing ${field}.`)
  }
}
for (const internalField of [
  'portal_identity_required',
  'portal_url',
  'webhook_delivery_ready',
  'status_delivery_modes',
  'blockers',
  'warnings',
  'checks',
]) {
  if (integrationContextProjection.includes(`${internalField}:`)) {
    failures.push(
      `Public integration-context projection leaks internal field ${internalField}.`,
    )
  }
}
if (!integrationContextRouteSource.includes('projectPublicExternalTenantContext(')) {
  failures.push(
    'Integration context route must use the explicit public OpenAPI projection.',
  )
}

const runtimeSources = {
  quote: fs.readFileSync('app/api/v1/website/quote/route.ts', 'utf8'),
  validate: fs.readFileSync(
    'app/api/v1/website/quote/validate/route.ts',
    'utf8',
  ),
  application: fs.readFileSync(
    'lib/website/customerApplicationProcess.ts',
    'utf8',
  ),
  publication: fs.readFileSync(
    'lib/external-contracts/publicationDto.ts',
    'utf8',
  ),
}
for (const field of commercialAssertions) {
  for (const [surface, source] of Object.entries(runtimeSources)) {
    if (surface === 'publication') continue
    if (!source.includes(field)) {
      failures.push(`Runtime ${surface} missing commercial assertion ${field}`)
    }
  }
}
if (runtimeSources.publication.includes('pricing.price_options')) {
  failures.push('Publication mapper must expose price_options only at top level.')
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log(
  `OpenAPI/runtime parity OK (${registry.length} registry routes, ${operations.length} OpenAPI operations, ${reachableSchemas.size} reachable schemas).`,
)
