#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Additive documentation release (OPS API remediation Paket 17): preserve all
// prior immutable artifacts and business schemas; publish the OpenAPI text for
// runtime behaviour already shipped under 2026-10-04.1. No request requirement
// or response field is changed, and the minimum supported revision stays
// 2026-10-02.3. Idempotent: running it again on 2026-10-09.1 changes nothing.
const fs = require('node:fs')
const { releaseManifestSchemas, documentVersionedOpenApiHeaders } = require('./lib/openapi-release-schemas.cjs')

const PREVIOUS = '2026-10-04.1'
const VERSION = '2026-10-09.1'
const MINIMUM = '2026-10-02.3'

function replaceVersion(value) {
  if (typeof value === 'string') return value.split(PREVIOUS).join(VERSION)
  if (Array.isArray(value)) return value.map(replaceVersion)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceVersion(item)]))
  return value
}

function bumpRelease(original) {
  if (![PREVIOUS, VERSION].includes(original.info.version)) throw new Error(`unexpected version ${original.info.version}`)
  if (original.info.version === VERSION) return original
  const spec = replaceVersion(original)
  for (const [route, item] of Object.entries(original.paths)) {
    if (!route.startsWith(`/api/v1/openapi/${PREVIOUS}/`)) continue
    spec.paths[route] = structuredClone(item)
    const next = replaceVersion(item)
    for (const operation of Object.values(next)) {
      if (operation && typeof operation.operationId === 'string') operation.operationId = operation.operationId.replace(PREVIOUS.replace(/\D/g, ''), VERSION.replace(/\D/g, ''))
    }
    spec.paths[route.replace(PREVIOUS, VERSION)] = next
  }
  return spec
}

function appendSentence(target, key, sentence) {
  const current = typeof target[key] === 'string' ? target[key] : ''
  if (current.includes(sentence)) return
  target[key] = current ? `${current} ${sentence}` : sentence
}

function operations(spec, predicate) {
  const result = []
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (operation && typeof operation === 'object' && operation.responses && predicate(path, method, operation)) result.push({ path, method, operation })
    }
  }
  return result
}

function hasParameter(operation, matcher) {
  return (operation.parameters ?? []).some(matcher)
}

function addParameter(operation, parameter, matcher) {
  operation.parameters = operation.parameters ?? []
  if (!hasParameter(operation, matcher)) operation.parameters.push(parameter)
}

function isIdempotent(operation) {
  return hasParameter(operation, (p) => p.name === 'Idempotency-Key' || (typeof p.$ref === 'string' && p.$ref.endsWith('/IdempotencyKey')))
}

function errorResponseLike(operation, description) {
  const template = operation.responses['400'] ?? operation.responses['409'] ?? operation.responses['422']
  return { ...structuredClone(template), description }
}

const NEXT_CURSOR_HEADER = {
  description: 'Present only when another page exists. Send the value unchanged as the cursor query parameter to read the next page; absent on the last page.',
  schema: { type: 'string' },
}

// ---------------------------------------------------------------- Staff
function documentStaff(spec) {
  spec.components.parameters.RequestId.description =
    'Optional client correlation value (1-128 characters of A-Z, a-z, 0-9, ".", "_", ":" or "-"). It is recorded separately for support as the client correlation id and never replaces the server request id.'
  spec.components.parameters.ExpectedProjectRef = {
    name: 'x-gridex-expected-project-ref',
    in: 'header',
    required: false,
    schema: { type: 'string', pattern: '^[a-z0-9]{20}$' },
    description: 'Optional 20-character storage project reference you expect to serve this call. A malformed value, or a value that differs from the project served by this deployment, returns 412 storage_project_mismatch before authentication, rate limiting, audit or any write; nothing is executed.',
  }
  spec.components.parameters.QueryParsing = {
    name: 'x-gridex-query-parsing',
    in: 'header',
    required: false,
    schema: { type: 'string', enum: ['compatible', 'strict'], default: 'compatible' },
    description: 'List query parsing profile. compatible (default) keeps the parsing each endpoint has always accepted. strict applies one rule to every Staff list endpoint: each query parameter at most once, and page, page_size and limit only as plain decimal digits without sign, whitespace, exponent, fraction, hexadecimal prefix or leading zero. Violations, and unknown profile values, return 422 invalid_field with error.field naming the parameter, before any data is read.',
  }
  spec.components.headers.RequestId.description =
    'Server-issued request id for this call. The same value is returned as request_id in the body (including errors) and recorded in the request log. A client-supplied x-request-id is never echoed here.'
  spec.components.headers.ProjectRef = {
    description: 'Storage project reference that served this call. Present when the deployment serves an identified project; compare it with x-gridex-expected-project-ref.',
    schema: { type: 'string', pattern: '^[a-z0-9]{20}$' },
  }
  const listPaths = new Set(['/api/v1/staff/users', '/api/v1/staff/customers', '/api/v1/staff/cases', '/api/v1/staff/cases/{reference}/events', '/api/v1/staff/cases/{reference}/attachments'])
  for (const { path, method, operation } of operations(spec, (path) => path.startsWith('/api/v1/staff/'))) {
    addParameter(operation, { $ref: '#/components/parameters/ExpectedProjectRef' }, (p) => p.$ref === '#/components/parameters/ExpectedProjectRef')
    if (method === 'get' && listPaths.has(path)) {
      addParameter(operation, { $ref: '#/components/parameters/QueryParsing' }, (p) => p.$ref === '#/components/parameters/QueryParsing')
    }
    if (!operation.responses['412']) {
      const response = errorResponseLike(operation, 'storage_project_mismatch: x-gridex-expected-project-ref is malformed or names another storage project. Nothing was executed; call the deployment that serves the expected project.')
      operation.responses = Object.fromEntries(Object.entries({ ...operation.responses, 412: response }).sort(([a], [b]) => Number(a) - Number(b)))
    }
    for (const [status, response] of Object.entries(operation.responses)) {
      if (status === '412') continue
      response.headers = response.headers ?? {}
      if (!response.headers['X-Gridex-Project-Ref']) response.headers['X-Gridex-Project-Ref'] = { $ref: '#/components/headers/ProjectRef' }
      if (response.headers['Idempotency-Replayed']) {
        response.headers['Idempotency-Replayed'].description =
          'true when the stored result of an earlier identical request (same Idempotency-Key and body) is returned; false for a new execution. Current authentication, scopes, permission and active membership are checked before any stored result is replayed.'
      }
    }
  }
  appendSentence(spec.info, 'description', 'Every response carries a server-issued X-Request-ID equal to request_id in the body. The optional x-gridex-expected-project-ref header pins the storage project (412 storage_project_mismatch otherwise), and list endpoints accept the opt-in x-gridex-query-parsing: strict profile.')
}

// ------------------------------------------------------- Customer portal
function documentCustomerPortal(spec) {
  const supportCase = '/api/v1/customer/support/cases/{reference}'
  const cursorParameter = {
    name: 'cursor',
    in: 'query',
    required: false,
    schema: { type: 'string' },
    description: 'Opaque continuation value from X-Gridex-Next-Cursor of the previous response. Bound to the organization, the verified customer and the case; a modified or foreign cursor returns 400 invalid_cursor. Without cursor the first page is returned, identical to earlier V1 behaviour.',
  }
  for (const [path, pageSize, noun] of [[`${supportCase}/messages`, 500, 'messages'], [`${supportCase}/attachments`, 100, 'attachments']]) {
    const operation = spec.paths[path].get
    addParameter(operation, structuredClone(cursorParameter), (p) => p.name === 'cursor')
    operation.responses['200'].headers = operation.responses['200'].headers ?? {}
    operation.responses['200'].headers['X-Gridex-Next-Cursor'] = structuredClone(NEXT_CURSOR_HEADER)
    appendSentence(operation, 'description', `Returns customer-visible ${noun} oldest first, at most ${pageSize} per response. When more exist the response carries X-Gridex-Next-Cursor; repeat with ?cursor=<value> until the header is absent. The response body shape is unchanged.`)
    appendSentence(operation.responses['400'], 'description', 'invalid_cursor: the cursor was modified, expired or belongs to another case, customer or organization.')
  }
  const detail = spec.paths[supportCase].get
  detail.responses['200'].headers = detail.responses['200'].headers ?? {}
  detail.responses['200'].headers['X-Gridex-Next-Cursor'] = structuredClone(NEXT_CURSOR_HEADER)
  appendSentence(detail, 'description', 'messages contains at most the first 500 customer-visible messages. When later messages exist the response carries X-Gridex-Next-Cursor; continue with GET .../messages?cursor=<value>.')

  const closure = 'Closure versus replay: authentication, scope and case ownership are always checked first. A retry with the same Idempotency-Key and the same payload of a write that already succeeded replays the original result (Idempotency-Replayed: true, nothing new is stored) even if the case was closed in between; a new write on a closed case returns 409 support_case_closed.'
  appendSentence(spec.paths[`${supportCase}/messages`].post, 'description', closure)
  appendSentence(spec.paths[`${supportCase}/attachments`].post, 'description', closure)

  for (const { operation } of operations(spec, (path, method, operation) => path.startsWith('/api/v1/') && !path.startsWith('/api/v1/openapi/') && isIdempotent(operation))) {
    appendSentence(operation.responses['409'], 'description', 'idempotency_reconciliation_required: an earlier attempt with this Idempotency-Key stopped without a confirmed result; check the resource state before using a new key.')
    if (!operation.responses['503']) {
      const response = errorResponseLike(operation, 'idempotency_completion_uncertain: the write may already be saved but its receipt could not be confirmed. Retry with the same Idempotency-Key and payload, never with a new key.')
      operation.responses = Object.fromEntries(Object.entries({ ...operation.responses, 503: response }).sort(([a], [b]) => Number(a) - Number(b)))
    }
  }

  appendSentence(spec.paths['/api/v1/customer/metering-values'].get, 'description', 'The list is a bounded detail list of current interval values; it is not a complete-month aggregate. Do not sum it to show monthly totals: a month can contain more values than one response returns.')
}

// --------------------------------------------------------------- Website
function documentWebsite(spec) {
  const poa = spec.components.schemas.PowerOfAttorneyInput.properties.textVersionId
  poa.description = 'Use primary_document_id from the power_of_attorney requirement in the exact accepted legal bundle of offer_reference. Any other document id returns 409 power_of_attorney_offer_version_mismatch and nothing is stored. This is the legal document version the customer accepted and must match exactly; it is unrelated to the API documentation revision.'
  appendSentence(spec.paths['/api/v1/website/customer-applications'].post.responses['409'], 'description', 'power_of_attorney_offer_version_mismatch: powerOfAttorney.textVersionId is not the power-of-attorney document of the accepted legal bundle; nothing is stored.')

  const feed = spec.paths['/api/v1/website/public-contracts'].get
  const ifNoneMatch = feed.parameters.find((p) => p.name === 'If-None-Match')
  ifNoneMatch.description = 'ETag from an earlier response of the same credential and customer_type. Evaluated only after authentication and scope checks (RFC 9110 weak comparison; a list or * is accepted). A match returns 304 without a body.'
  const etagDescription = 'Representation token bound to the organization, customer type, channel, contract profile and representation revision. Never reuse it across credentials or customer types.'
  const vary = { description: 'Always Authorization: the representation depends on the credential, so shared caches must not reuse it across credentials.', schema: { type: 'string', const: 'Authorization' } }
  for (const status of ['200', '304']) {
    const headers = feed.responses[status].headers
    headers.ETag.description = etagDescription
    headers.Vary = structuredClone(vary)
  }

  const resolve = spec.paths['/api/v1/website/energy-area/resolve'].post
  appendSentence(resolve, 'description', 'Send a full address (street and city), a postal_code or a grid_area_code; facility_id and metering_point_id are stored references only and never resolve an area on their own. A price area derived only from a postal-code centroid is provisional: it is not facility-level evidence, and a centroid near a price-area boundary or behind stale geodata is never returned as price-ready (send a full address).')
  appendSentence(resolve.responses['422'], 'description', 'energy_area_address_required: the request contained only facility_id/metering_point_id; error.details.required_fields lists the accepted inputs.')
}

const documenters = {
  'website-integration-v1': documentWebsite,
  'customer-portal-v1': documentCustomerPortal,
  'staff-v1': documentStaff,
}
for (const name of ['website-integration-v1', 'customer-portal-v1', 'staff-v1']) {
  const file = `docs/openapi/${name}.json`
  const spec = bumpRelease(JSON.parse(fs.readFileSync(file, 'utf8')))
  documenters[name](spec)
  Object.assign(spec.components.schemas, releaseManifestSchemas(VERSION, MINIMUM, { includeStaff: true }))
  documentVersionedOpenApiHeaders(spec)
  fs.writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`)
}

const fixturePath = `docs/fixtures/public-contracts-response-${VERSION}.json`
if (!fs.existsSync(fixturePath)) {
  const fixture = JSON.parse(fs.readFileSync(`docs/fixtures/public-contracts-response-${PREVIOUS}.json`, 'utf8'))
  fs.writeFileSync(fixturePath, `${JSON.stringify(replaceVersion(fixture), null, 2)}\n`)
}
console.log(`OpenAPI documentation release ${VERSION} prepared; run npm run api:materialize next.`)
