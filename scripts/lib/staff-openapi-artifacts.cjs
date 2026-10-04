const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { buildStaffOpenApi, contractDefinitions } = require('./staff-openapi-contract.cjs')

const bytes = (value) => `${JSON.stringify(value, null, 2)}\n`
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function metadata(root) {
  const source = fs.readFileSync(path.join(root, 'lib/staff-api/openApiContract.ts'), 'utf8')
  const constant = (name) => {
    const result = new RegExp(`${name}\\s*=\\s*'([^']+)'`).exec(source)?.[1]
    if (!result) throw new Error(`Missing staff contract constant ${name}`)
    return result
  }
  const version = constant('STAFF_API_CONTRACT_VERSION')
  const name = constant('STAFF_API_CONTRACT_NAME')
  const origin = constant('STAFF_OPENAPI_ORIGIN')
  return {
    version, name, origin, preparedAt: constant('STAFF_OPENAPI_PREPARED_AT'),
    capabilities: [...(/STAFF_API_PROTOCOL_CAPABILITIES\s*=\s*\[([\s\S]*?)\]/.exec(source)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]),
    currentPath: constant('STAFF_OPENAPI_PATH'), manifestPath: constant('STAFF_RELEASE_MANIFEST_PATH'),
    immutablePath: `/api/v1/openapi/${version}/${name}.json`,
  }
}

function mountedStaffOperations(root) {
  const found = new Set()
  const directory = path.join(root, 'app/api/v1/staff')
  if (!fs.existsSync(directory)) return found
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.name === 'route.ts') {
        const route = '/' + path.relative(path.join(root, 'app'), file).replaceAll(path.sep, '/').replace(/\/route\.ts$/, '').replace(/\[([^\]]+)\]/g, '{$1}')
        const source = fs.readFileSync(file, 'utf8')
        for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
          if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b|export\\s+(?:const|let)\\s+${method}\\b|export\\s*\\{[^}]*\\bas\\s+${method}\\b`).test(source)) found.add(`${method} ${route}`)
        }
      }
    }
  }
  walk(directory)
  return found
}

function sample(schema, schemas, field = '') {
  if (schema.$ref) return sample(schemas[schema.$ref.split('/').at(-1)], schemas, field)
  if (schema.const !== undefined) return schema.const
  if (schema.enum) return schema.enum[0]
  if (schema.anyOf || schema.oneOf) return sample((schema.anyOf ?? schema.oneOf)[0], schemas, field)
  const type = Array.isArray(schema.type) ? schema.type.find((value) => value !== 'null') : schema.type
  if (type === 'object') return Object.fromEntries((schema.required ?? Object.keys(schema.properties ?? {})).map((name) => [name, sample(schema.properties[name], schemas, name)]))
  if (type === 'array') return []
  if (type === 'boolean') return false
  if (type === 'number' || type === 'integer') return schema.minimum ?? 1
  if (type === 'null') return null
  if (schema.format === 'date-time') return '2026-10-03T21:51:31.000Z'
  if (schema.format === 'date') return '2026-10-03'
  if (schema.format === 'email') return 'synthetic.staff@example.invalid'
  if (schema.format === 'uri') return 'https://app.gridex.se/api/v1/openapi/staff-support-v1.json'
  if (field === 'sha256') return '0'.repeat(64)
  if (field === 'refresh_token') return 'A'.repeat(43)
  if (field === 'token_hash') return 'synthetic_recovery_hash_value'
  if (schema.pattern?.startsWith('^mfa_')) return 'mfa_' + '0'.repeat(32)
  if (schema.pattern?.startsWith('^mch_')) return 'mch_' + '0'.repeat(32)
  const resourceKind = /^\^([a-z_]+)_\[A-Za-z0-9_/.exec(schema.pattern ?? '')?.[1]
  if (resourceKind) return `${resourceKind}_synthetic_documentation`
  if (field === 'code' && schema.pattern) return '123456'
  if (field.endsWith('_reference')) return `${field.replace(/_reference$/, '')}_synthetic_documentation`
  if (field === 'customer_number') return 'SYNTHETIC-001'
  return 'Synthetic documentation example'
}

function schemaType(schema) {
  if (schema.$ref) return `StaffSchemas[${JSON.stringify(schema.$ref.split('/').at(-1))}]`
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
  if (schema.anyOf || schema.oneOf) return (schema.anyOf ?? schema.oneOf).map(schemaType).join(' | ')
  if (schema.allOf) return schema.allOf.map(schemaType).map((type) => `(${type})`).join(' & ')
  if (Array.isArray(schema.type)) return schema.type.map((type) => schemaType({ ...schema, type })).join(' | ')
  if (schema.type === 'string') return schema.format === 'binary' ? 'Blob' : 'string'
  if (schema.type === 'number' || schema.type === 'integer') return 'number'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'null') return 'null'
  if (schema.type === 'array') return `Array<${schemaType(schema.items)}>`
  if (schema.type === 'object') {
    const properties = Object.entries(schema.properties ?? {}).map(([name, value]) => `${JSON.stringify(name)}${schema.required?.includes(name) ? '' : '?'}: ${schemaType(value)};`)
    return properties.length ? `{ ${properties.join(' ')} }` : 'Record<string, unknown>'
  }
  throw new Error(`Unsupported staff schema for type generation: ${JSON.stringify(schema)}`)
}

function artifacts(root, options = {}) {
  const meta = metadata(root)
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(meta.version)) throw new Error('Invalid staff contract version')
  const mounted = mountedStaffOperations(root)
  const known = new Set(contractDefinitions(meta).map((definition) => `${definition.method} ${definition.path}`))
  for (const operation of mounted) if (!known.has(operation)) throw new Error(`Mounted staff operation lacks an explicit contract: ${operation}`)
  const document = buildStaffOpenApi(meta, mounted)
  const releaseReady = options.releaseReady ?? fs.existsSync(path.join(root, `docs/openapi/releases/${meta.version}/${meta.name}.json`))
  if (!releaseReady) document['x-staff-protocol-capabilities'] = []
  for (const item of Object.values(document.paths)) for (const operation of Object.values(item)) {
    for (const [type, content] of Object.entries(operation.requestBody?.content ?? {})) if (type !== 'multipart/form-data') content.example = sample(content.schema, document.components.schemas)
    for (const response of Object.values(operation.responses)) for (const content of Object.values(response.content ?? {})) if (content.schema?.$ref) content.example = sample(content.schema, document.components.schemas)
  }
  const documentBytes = bytes(document)
  const digest = sha256(documentBytes)
  const manifest = {
    schema_version: 1, contract_name: meta.name, contract_version: meta.version,
    minimum_staff_integration_version: meta.version, guide_version: meta.version,
    released_at: meta.preparedAt, build_commit: 'unknown', capabilities: document['x-staff-protocol-capabilities'],
    specification: { url: `${meta.origin}${meta.currentPath}`, immutable_url: `${meta.origin}${meta.immutablePath}`, sha256: digest },
  }
  const registryRows = []
  const operationTypes = []
  for (const [route, item] of Object.entries(document.paths)) for (const [method, operation] of Object.entries(item)) {
    registryRows.push({ method: method.toUpperCase(), path: route.replace(/\{([^}]+)\}/g, '[$1]'), scopes: operation['x-required-scopes'], description: operation.summary, ...(operation['x-idempotency-required'] ? { idempotencyRequired: true } : {}), rateLimitClass: operation['x-rate-limit-class'] })
    const responseTypes = Object.entries(operation.responses).map(([status, response]) => `${JSON.stringify(status)}: ${schemaType(response.content?.['application/json']?.schema ?? Object.values(response.content ?? {})[0]?.schema ?? { type: 'null' })};`).join(' ')
    const requestSchema = Object.values(operation.requestBody?.content ?? {})[0]?.schema
    operationTypes.push(`  ${JSON.stringify(operation.operationId)}: { request: ${requestSchema ? schemaType(requestSchema) : 'never'}; responses: { ${responseTypes} } };`)
  }
  const generatedTypes = `// Generated by scripts/generate-staff-openapi.cjs. Do not edit.\n// Contract version: ${meta.version}; Source SHA-256: ${digest}.\nexport interface StaffSchemas {\n${Object.entries(document.components.schemas).map(([name, schema]) => `  ${JSON.stringify(name)}: ${schemaType(schema)};`).join('\n')}\n}\nexport interface StaffOperations {\n${operationTypes.join('\n')}\n}\n`
  const registry = `// Generated by scripts/generate-staff-openapi.cjs. Do not edit.\n// Contract version: ${meta.version}; Source SHA-256: ${digest}.\nimport type { PublicApiRouteContract } from '@/lib/api/publicRouteRegistry'\nexport const STAFF_API_ROUTE_DEFINITIONS: Array<Omit<PublicApiRouteContract, 'operationId' | 'responseSchema' | 'scopeMode' | 'cachePolicy' | 'publicIdPolicy'>> = ${JSON.stringify(registryRows, null, 2)}\n`
  return { meta, document, documentBytes, manifest, files: {
    'docs/openapi/staff-support-v1.json': documentBytes,
    'docs/openapi/staff-release-manifest.json': bytes(manifest),
    'lib/staff-api/generated/staff-support-v1.d.ts': generatedTypes,
    'lib/staff-api/routeRegistry.ts': registry,
  } }
}

module.exports = { artifacts, metadata, mountedStaffOperations, bytes, sha256 }
