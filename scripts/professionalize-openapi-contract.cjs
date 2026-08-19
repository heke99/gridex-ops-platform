#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')

const VERSION = '2026-08-19.2'
const SPEC_FILES = [
  'docs/openapi/website-integration-v1.json',
  'docs/openapi/customer-portal-v1.json',
]

const ORGANIZATION_REFERENCE_SCHEMA = {
  type: 'string',
  pattern: '^organization_[A-Za-z0-9_-]{20,64}$',
  description: 'Stable opaque public reference for the organization associated with the authenticated API credential.',
}

const exactStringRenames = new Map([
  ['tenant_reference', 'organization_reference'],
  ['complete_tenant_website_ready', 'complete_integration_ready'],
  ['market_price_supplied_by_ops', 'market_price_supplied_by_gridex'],
  ['ops_quote', 'gridex_quote'],
])

const omittedPublicSchemaNames = new Set([
  'tenant_id_environment_required',
  'company_id_environment_required',
])

function publicString(value) {
  if (exactStringRenames.has(value)) return exactStringRenames.get(value)
  return value
    .replace(/tenant_reference/gi, 'organization_reference')
    .replace(/complete_tenant_website_ready/gi, 'complete_integration_ready')
    .replace(/market_price_supplied_by_ops/gi, 'market_price_supplied_by_gridex')
    .replace(/ops_quote/gi, 'gridex_quote')
    .replace(/\btenantens\b/gi, "the organization's")
    .replace(/\btenanters\b/gi, 'organizations')
    .replace(/\btenantbundet\b/gi, 'organization-scoped')
    .replace(/\btenantbundna\b/gi, 'organization-scoped')
    .replace(/\btenantbunden\b/gi, 'organization-scoped')
    .replace(/\btenant-skopad\b/gi, 'organization-scoped')
    .replace(/\btenant\b/gi, 'organization')
    .replace(/\bOPS\b/g, 'Gridex')
    .replace(/company_id/g, 'internal organization identifier')
}

function transform(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(typeof item === 'string' && omittedPublicSchemaNames.has(item)))
      .map(transform)
  }
  if (typeof value === 'string') return publicString(value)
  if (!value || typeof value !== 'object') return value

  const output = {}
  for (const [key, child] of Object.entries(value)) {
    if (omittedPublicSchemaNames.has(key)) continue
    const renamedKey = exactStringRenames.get(key) ?? publicString(key)
    output[renamedKey] = transform(child)
  }
  return output
}

function normalizeOrganizationReferenceSchemas(value) {
  if (Array.isArray(value)) {
    for (const item of value) normalizeOrganizationReferenceSchemas(item)
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value)) {
    if (key === 'organization_reference' && child && typeof child === 'object' && !Array.isArray(child)) {
      Object.assign(child, ORGANIZATION_REFERENCE_SCHEMA)
      delete child.const
      delete child.enum
      continue
    }
    normalizeOrganizationReferenceSchemas(child)
  }
}

function normalizedPath(path) {
  return path
    .replace(/\[[^\]]+\]/g, '{}')
    .replace(/\{[^}]+\}/g, '{}')
}

function registryDescriptions() {
  const source = fs.readFileSync('lib/api/publicRouteRegistry.ts', 'utf8')
  const rows = new Map()
  for (const line of source.split('\n')) {
    const method = /method: '(GET|POST)'/.exec(line)?.[1]
    const runtimePath = /path: '([^']+)'/.exec(line)?.[1]
    const publicPath = /publicPath: '([^']+)'/.exec(line)?.[1] ?? runtimePath
    const description = /description: '([^']+)'/.exec(line)?.[1]
    if (!method || !runtimePath || !publicPath || !description) continue
    rows.set(`${method}:${normalizedPath(publicPath)}`, description)
  }
  return rows
}

function titleFromDescription(description) {
  const text = description.replace(/[.]$/, '')
  return text.length <= 90 ? text : `${text.slice(0, 87).trimEnd()}...`
}

const descriptions = registryDescriptions()

for (const file of SPEC_FILES) {
  const original = JSON.parse(fs.readFileSync(file, 'utf8'))
  const document = transform(original)
  normalizeOrganizationReferenceSchemas(document)

  document.info = document.info ?? {}
  document.info.version = VERSION
  document['x-contract-schema-version'] = VERSION
  if (file.includes('website-integration')) {
    document.info.title = 'Gridex Website Integration API'
    document.info.description =
      'Production API for electricity retail websites and backend integrations. Gridex owns published offers, authoritative pricing and quotes, legal document versions, customer and contract lifecycle state, and downstream processing. Integrations provide verified customer input and use public references only.'
  } else {
    document.info.title = 'Gridex Customer Portal API'
    document.info.description =
      'Production API for customer portals. Access is organization-scoped by the server-side API credential and customer data is limited to the verified linked customer identity.'
  }

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of ['get', 'post']) {
      const operation = pathItem?.[method]
      if (!operation) continue
      const description = descriptions.get(`${method.toUpperCase()}:${normalizedPath(path)}`)
      if (description) {
        operation.summary = titleFromDescription(description)
        operation.description = description
      }
    }
  }

  const integrationContext = document.components?.schemas?.IntegrationContext
  if (integrationContext?.properties?.capabilities?.properties?.complete_integration_ready) {
    integrationContext.properties.capabilities.properties.complete_integration_ready.description =
      'True when the configured website checkout and customer portal capabilities are ready for production use.'
  }

  const serialized = JSON.stringify(document, null, 2) + '\n'
  const forbidden = [
    /tenant_reference/i,
    /complete_tenant_website_ready/i,
    /tenant_id_environment_required/i,
    /company_id_environment_required/i,
    /market_price_supplied_by_ops/i,
    /ops_quote/i,
    /\bOPS\b/,
  ]
  for (const pattern of forbidden) {
    if (pattern.test(serialized)) {
      throw new Error(`${file}: public OpenAPI still contains forbidden internal terminology matching ${pattern}`)
    }
  }

  fs.writeFileSync(file, serialized)
}

console.log(`Professional public OpenAPI presentation applied for ${VERSION}.`)
