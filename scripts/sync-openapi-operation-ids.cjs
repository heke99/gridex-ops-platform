#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')

const files = [
  'docs/openapi/website-integration-v1.json',
  'docs/openapi/customer-portal-v1.json',
]

const registrySource = fs.readFileSync('lib/api/publicRouteRegistry.ts', 'utf8')
const routePattern = /{ method: '(GET|POST)', path: '([^']+)'(?:, publicPath: '([^']+)')?, scopes: \[([^\]]*)\], description: '([^']*)'(?:, idempotencyRequired: true)?, rateLimitClass: '(read|write|expensive)' }/g
const registry = []
let registryMatch
while ((registryMatch = routePattern.exec(registrySource))) {
  const source = registryMatch[0]
  registry.push({
    method: registryMatch[1],
    path: registryMatch[3] ?? registryMatch[2],
    description: registryMatch[5],
    scopes: [...registryMatch[4].matchAll(/'([^']+)'/g)].map((item) => item[1]),
    idempotencyRequired: source.includes('idempotencyRequired: true'),
    rateLimitClass: registryMatch[6],
  })
}

function normalizedPath(path) {
  return path.replace(/\[[^\]]+\]|\{[^}]+\}/g, '{}')
}

function operationId(method, path) {
  const suffix = path
    .split('/')
    .filter(Boolean)
    .map((segment) => segment
      .replace(/^\{|\}$/g, '')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(''))
    .join('')
  return `${method.toLowerCase()}${suffix}`
}

for (const file of files) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'))
  const seen = new Set()
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item[method]
      if (!operation) continue
      const contract = registry.find((route) =>
        route.method === method.toUpperCase() && normalizedPath(route.path) === normalizedPath(path))
      if (!contract) throw new Error(`No registry contract for ${method.toUpperCase()} ${path}`)
      const id = operationId(method, contract.path.replace(/\[([^\]]+)\]/g, '{$1}'))
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(id) || seen.has(id)) {
        throw new Error(`Invalid or duplicate generated operationId ${id} in ${file}`)
      }
      operation.operationId = id
      operation.summary = contract.description.split('.')[0]
      operation.description = contract.description
      operation['x-required-scopes'] = contract.scopes
      operation['x-scope-mode'] = [
        '/api/v1/website/legal-bundle',
        '/api/v1/customer/profile-update',
      ].includes(contract.path) ? 'any' : 'all'
      operation['x-rate-limit-class'] = contract.rateLimitClass
      operation['x-idempotency-required'] = contract.idempotencyRequired
      operation['x-cache-policy'] = contract.path.includes('/openapi/')
        ? contract.path.includes('/2026-') ? 'public-immutable' : 'private-revalidate'
        : 'no-store'
      operation['x-public-id-policy'] = contract.path.includes('/openapi/') ? 'none' : 'opaque-references'
      seen.add(id)
    }
  }
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`)
  console.log(`${file}: ${seen.size} operationIds synchronized`)
}
