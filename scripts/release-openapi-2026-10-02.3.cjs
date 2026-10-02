#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Contract release 2026-10-02.3 (documents the contract-version and request-id headers
 * on the customer support-attachment download).
 *
 * Deterministic, re-runnable preparation of the current specs before
 * `npm run api:materialize`:
 * - bumps the contract version 2026-10-02.2 -> 2026-10-02.3 in both current specs,
 *   keeping the 2026-10-02.2 catalog entry and adding the 2026-10-02.3 entry;
 * - documents X-Gridex-Contract-Version and X-Request-ID on the 200 response of the
 *   support-attachment download, which the runtime now sends like every other response.
 *
 * Immutable release artifacts are never edited by hand: they are produced from the
 * current specs by scripts/materialize-openapi-release.cjs.
 */
const fs = require('node:fs')

const PREVIOUS = '2026-10-02.2'
const VERSION = '2026-10-02.3'
const SPECS = [
  { file: 'docs/openapi/website-integration-v1.json', name: 'website-integration-v1', title: 'Website Integration' },
  { file: 'docs/openapi/customer-portal-v1.json', name: 'customer-portal-v1', title: 'Customer Portal' },
]

const clone = (value) => JSON.parse(JSON.stringify(value))

function replaceVersion(value) {
  if (typeof value === 'string') return value.split(PREVIOUS).join(VERSION)
  if (Array.isArray(value)) return value.map(replaceVersion)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceVersion(item)]))
  }
  return value
}

function operationToken(version) {
  return version.replace(/[^0-9]/g, '')
}

function bumpVersion(spec) {
  const previousPrefix = `/api/v1/openapi/${PREVIOUS}/`
  const bumped = replaceVersion(spec)
  // Previously published releases stay catalogued unchanged; each gets a 2026-10-02.3 sibling.
  const paths = {}
  for (const [path, item] of Object.entries(bumped.paths)) {
    if (!path.startsWith(previousPrefix)) {
      paths[path] = item
      continue
    }
    paths[path] = clone(spec.paths[path])
    const nextCatalog = clone(item)
    for (const operation of Object.values(nextCatalog)) {
      if (operation && typeof operation === 'object' && typeof operation.operationId === 'string') {
        operation.operationId = operation.operationId.replace(operationToken(PREVIOUS), operationToken(VERSION))
      }
    }
    paths[path.replace(previousPrefix, `/api/v1/openapi/${VERSION}/`)] = nextCatalog
  }
  bumped.paths = paths
  return bumped
}

const ATTACHMENT_PATH = '/api/v1/customer/support/cases/{reference}/attachments/{attachmentReference}'

function addAttachmentDownloadHeaders(spec) {
  const ok = spec.paths?.[ATTACHMENT_PATH]?.get?.responses?.['200']
  if (!ok) throw new Error('support attachment download 200 response not found')
  ok.headers = ok.headers ?? {}
  ok.headers['X-Gridex-Contract-Version'] = { $ref: '#/components/headers/GridexContractVersion' }
  ok.headers['X-Request-ID'] = { $ref: '#/components/headers/RequestId' }
  return 1
}

for (const entry of SPECS) {
  const original = JSON.parse(fs.readFileSync(entry.file, 'utf8'))
  if (original.info.version !== PREVIOUS && original.info.version !== VERSION) {
    throw new Error(`${entry.file}: unexpected version ${original.info.version}`)
  }
  const spec = original.info.version === PREVIOUS ? bumpVersion(original) : original
  const count = entry.name === 'customer-portal-v1' ? addAttachmentDownloadHeaders(spec) : 0
  fs.writeFileSync(entry.file, `${JSON.stringify(spec, null, 2)}\n`)
  console.log(`${entry.file}: ${spec.info.version}, ${Object.keys(spec.paths).length} paths, attachment download headers on ${count} operation`)
}

const fixtureSource = `docs/fixtures/public-contracts-response-${PREVIOUS}.json`
const fixtureTarget = `docs/fixtures/public-contracts-response-${VERSION}.json`
const fixture = JSON.parse(fs.readFileSync(fixtureSource, 'utf8'))
fs.writeFileSync(fixtureTarget, `${JSON.stringify(replaceVersion(fixture), null, 2)}\n`)
console.log(`${fixtureTarget} written`)
