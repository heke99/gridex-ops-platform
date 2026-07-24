#!/usr/bin/env node
const fs = require('node:fs')

const registrySource = fs.readFileSync('lib/api/publicRouteRegistry.ts', 'utf8')
const routeRe = /{ method: '(GET|POST)', path: '([^']+)', scopes: \[([^\]]*)\]/g
const registry = []
let match
while ((match = routeRe.exec(registrySource))) {
  registry.push({
    method: match[1],
    path: match[2],
    normalizedPath: match[2].replace(/\[[^\]]+\]/g, '{}'),
    scopes: [...match[3].matchAll(/'([^']+)'/g)].map((item) => item[1]),
  })
}

const specs = [
  JSON.parse(fs.readFileSync('docs/openapi/website-integration-v1.json', 'utf8')),
  JSON.parse(fs.readFileSync('docs/openapi/customer-portal-v1.json', 'utf8')),
]
const operations = []
for (const spec of specs) {
  for (const [path, value] of Object.entries(spec.paths ?? {})) {
    if (!path.startsWith('/api/v1')) continue
    for (const method of ['get', 'post']) {
      if (!value[method]) continue
      operations.push({
        method: method.toUpperCase(),
        path,
        normalizedPath: path.replace(/\{[^}]+\}/g, '{}'),
        scopes: value[method]['x-required-scopes'] ?? [],
      })
    }
  }
}

const failures = []
for (const route of registry) {
  const operation = operations.find((candidate) =>
    candidate.method === route.method && candidate.normalizedPath === route.normalizedPath)
  if (!operation) failures.push(`Registry route missing in OpenAPI: ${route.method} ${route.path}`)
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

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log(`OpenAPI/runtime parity OK (${registry.length} registry routes, ${operations.length} OpenAPI operations).`)
