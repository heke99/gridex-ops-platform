#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Contract release 2026-10-02.2 (documents the verified customer login header).
 *
 * Deterministic, re-runnable preparation of the current specs before
 * `npm run api:materialize`:
 * - bumps the contract version 2026-10-02.1 -> 2026-10-02.2 in both current specs,
 *   keeping the 2026-10-02.1 catalog entry and adding the 2026-10-02.2 entry;
 * - documents the optional `x-gridex-customer-assertion` header (tenantservice P1c), which the
 *   runtime already verifies on every customer API operation, and its 403 outcomes.
 *
 * Immutable release artifacts are never edited by hand: they are produced from the
 * current specs by scripts/materialize-openapi-release.cjs.
 */
const fs = require('node:fs')

const PREVIOUS = '2026-10-02.1'
const VERSION = '2026-10-02.2'
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
  // Previously published releases stay catalogued unchanged; each gets a 2026-10-02.2 sibling.
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

const ASSERTION_PARAMETER = {
  name: 'x-gridex-customer-assertion',
  in: 'header',
  required: false,
  schema: { type: 'string', maxLength: 8192, pattern: '^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$' },
  description: 'Signed proof of the end customer\'s own login, forwarded by the tenant server. Compact JWS signed with RS256, PS256 or ES256 (none and HS* are rejected). Claims: iss and aud as configured for the tenant in OPS (own-login keys use iss=gridex-tenant:<organization> and aud=gridex-customer-api:<organization>), sub = the linked portal user id, exp at most 15 minutes after iat, and a unique jti (each assertion is accepted once). Required only when the tenant has enabled "require verified customer"; in report mode a missing or invalid assertion is logged but the call proceeds; tenants without a configuration are unaffected.',
}

function addAssertionHeader(spec) {
  let operations = 0
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!path.startsWith('/api/v1/customer/')) continue
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method) || !op || typeof op !== 'object') continue
      op.parameters = Array.isArray(op.parameters) ? op.parameters : []
      if (!op.parameters.some((p) => p && p.name === ASSERTION_PARAMETER.name)) op.parameters.push(clone(ASSERTION_PARAMETER))
      const forbidden = op.responses?.['403']
      if (forbidden && typeof forbidden.description === 'string' && !forbidden.description.includes('customer_assertion')) {
        forbidden.description = `${forbidden.description} When the tenant requires a verified customer login: customer_assertion_required (header missing) or customer_assertion_invalid (signature, issuer, audience, subject, lifetime or replay check failed).`
      }
      operations += 1
    }
  }
  if (operations === 0) throw new Error('no customer operations found')
  return operations
}

for (const entry of SPECS) {
  const original = JSON.parse(fs.readFileSync(entry.file, 'utf8'))
  if (original.info.version !== PREVIOUS && original.info.version !== VERSION) {
    throw new Error(`${entry.file}: unexpected version ${original.info.version}`)
  }
  const spec = original.info.version === PREVIOUS ? bumpVersion(original) : original
  const count = entry.name === 'customer-portal-v1' ? addAssertionHeader(spec) : 0
  fs.writeFileSync(entry.file, `${JSON.stringify(spec, null, 2)}\n`)
  console.log(`${entry.file}: ${spec.info.version}, ${Object.keys(spec.paths).length} paths, assertion header on ${count} operations`)
}

const fixtureSource = `docs/fixtures/public-contracts-response-${PREVIOUS}.json`
const fixtureTarget = `docs/fixtures/public-contracts-response-${VERSION}.json`
const fixture = JSON.parse(fs.readFileSync(fixtureSource, 'utf8'))
fs.writeFileSync(fixtureTarget, `${JSON.stringify(replaceVersion(fixture), null, 2)}\n`)
console.log(`${fixtureTarget} written`)
