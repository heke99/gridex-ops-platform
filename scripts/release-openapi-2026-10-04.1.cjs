#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Additive release: preserve all prior immutable artifacts and business schemas.
const fs = require('node:fs')
const { releaseManifestSchemas, documentVersionedOpenApiHeaders } = require('./lib/openapi-release-schemas.cjs')
const PREVIOUS = '2026-10-02.4'
const VERSION = '2026-10-04.1'
function replaceVersion(value) {
  if (typeof value === 'string') return value.split(PREVIOUS).join(VERSION)
  if (Array.isArray(value)) return value.map(replaceVersion)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceVersion(item)]))
  return value
}
for (const name of ['website-integration-v1', 'customer-portal-v1']) {
  const file = `docs/openapi/${name}.json`
  const original = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (![PREVIOUS, VERSION].includes(original.info.version)) throw new Error(`${file}: unexpected version ${original.info.version}`)
  const spec = original.info.version === PREVIOUS ? replaceVersion(original) : original
  if (original.info.version === PREVIOUS) {
    for (const [route, item] of Object.entries(original.paths)) {
      if (!route.startsWith(`/api/v1/openapi/${PREVIOUS}/`)) continue
      spec.paths[route] = structuredClone(item)
      const next = replaceVersion(item)
      for (const operation of Object.values(next)) {
        if (operation && typeof operation.operationId === 'string') operation.operationId = operation.operationId.replace(PREVIOUS.replace(/\D/g, ''), VERSION.replace(/\D/g, ''))
      }
      spec.paths[route.replace(PREVIOUS, VERSION)] = next
    }
  }
  Object.assign(spec.components.schemas, releaseManifestSchemas(VERSION, '2026-10-02.3', { includeStaff: true }))
  documentVersionedOpenApiHeaders(spec)
  fs.writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`)
}
for (const file of ['docs/external-website-api-integration-guide.md', 'docs/gridex-customer-portal-api.md', 'docs/single-api-key-tenant-integration.md']) {
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll(PREVIOUS, VERSION))
}
const fixture = JSON.parse(fs.readFileSync(`docs/fixtures/public-contracts-response-${PREVIOUS}.json`, 'utf8'))
fs.writeFileSync(`docs/fixtures/public-contracts-response-${VERSION}.json`, `${JSON.stringify(replaceVersion(fixture), null, 2)}\n`)
