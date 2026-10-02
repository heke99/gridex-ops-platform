#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Backward-compatible schema correction. Business response fields and request
 * requirements stay unchanged; version metadata advances, while .2 and .3 stay immutable.
 * Run this deterministic preparation before `npm run api:materialize`.
 */
const fs = require('node:fs')
const { customerSupportCaseDetail, releaseManifestSchemas, documentVersionedOpenApiHeaders } = require('./lib/openapi-release-schemas.cjs')

const PREVIOUS = '2026-10-02.3'
const VERSION = '2026-10-02.4'
const clone = (value) => structuredClone(value)

function replaceVersion(value) {
  if (typeof value === 'string') return value.split(PREVIOUS).join(VERSION)
  if (Array.isArray(value)) return value.map(replaceVersion)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceVersion(item)]))
  }
  return value
}

function bumpVersion(original) {
  const spec = replaceVersion(original)
  const prefix = `/api/v1/openapi/${PREVIOUS}/`
  for (const [path, item] of Object.entries(original.paths)) {
    if (!path.startsWith(prefix)) continue
    spec.paths[path] = clone(item)
    const next = replaceVersion(item)
    for (const operation of Object.values(next)) {
      if (operation && typeof operation.operationId === 'string') {
        operation.operationId = operation.operationId.replace(PREVIOUS.replace(/\D/g, ''), VERSION.replace(/\D/g, ''))
      }
    }
    spec.paths[path.replace(prefix, `/api/v1/openapi/${VERSION}/`)] = next
  }
  return spec
}

for (const name of ['website-integration-v1', 'customer-portal-v1']) {
  const file = `docs/openapi/${name}.json`
  const original = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (![PREVIOUS, VERSION].includes(original.info.version)) throw new Error(`${file}: unexpected version ${original.info.version}`)
  const spec = original.info.version === PREVIOUS ? bumpVersion(original) : original
  spec['x-gridex-release-version'] = VERSION
  Object.assign(spec.components.schemas, releaseManifestSchemas(VERSION, '2026-10-02.3'))
  documentVersionedOpenApiHeaders(spec)
  if (name === 'customer-portal-v1') {
    const download = spec.paths['/api/v1/customer/support/cases/{reference}/attachments/{attachmentReference}'].get.responses['200']
    if (!download.headers?.['X-Gridex-Contract-Version'] || !download.headers?.['X-Request-ID']) {
      throw new Error('The preceding attachment download header correction must be preserved')
    }
    spec.components.schemas.CustomerSupportCaseDetail = customerSupportCaseDetail(spec.components.schemas.CustomerSupportCase)
    spec.paths['/api/v1/customer-portal/sync'].post.responses['200'].description = 'Tenant- och kundfiltrerad portalsynk med profil, anläggningar, avtal, fakturor, mätvärden, juridik, händelser, dokument, fullmakter och notiser.'
  }
  fs.writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`)
  console.log(`${file}: ${VERSION}, closed support detail and release metadata corrected`)
}

const fixture = JSON.parse(fs.readFileSync(`docs/fixtures/public-contracts-response-${PREVIOUS}.json`, 'utf8'))
fs.writeFileSync(`docs/fixtures/public-contracts-response-${VERSION}.json`, `${JSON.stringify(replaceVersion(fixture), null, 2)}\n`)
