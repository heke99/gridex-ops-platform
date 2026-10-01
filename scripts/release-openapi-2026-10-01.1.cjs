#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Contract release 2026-10-01.1 (tenantservice P6).
 *
 * Deterministic, re-runnable preparation of the current specs before
 * `npm run api:materialize`:
 * - bumps the contract version 2026-08-22.2 -> 2026-10-01.1 in both current specs,
 *   keeping the 2026-08-22.2 catalog entry and adding the 2026-10-01.1 entry;
 * - adds the customer support operations (`/api/v1/customer/support/cases*`)
 *   with explicit, closed response schemas that contain only public references.
 *
 * Immutable release artifacts are never edited by hand: they are produced from the
 * current specs by scripts/materialize-openapi-release.cjs.
 */
const fs = require('node:fs')

const PREVIOUS = '2026-08-22.2'
const VERSION = '2026-10-01.1'
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
  // Previously published releases stay catalogued unchanged; each gets a 2026-10-01.1 sibling.
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

const PUBLIC_REFERENCE = { type: 'string', pattern: '^[a-z][a-z0-9_]{1,31}_[A-Za-z0-9_-]{20,64}$' }
const DATE_TIME = { type: 'string', format: 'date-time' }
const NULLABLE_DATE_TIME = { type: ['string', 'null'], format: 'date-time' }

const SUPPORT_SCHEMAS = {
  CustomerSupportCase: {
    type: 'object',
    additionalProperties: false,
    required: ['case_reference', 'title', 'description', 'status', 'channel', 'created_at', 'updated_at', 'resolved_at'],
    properties: {
      case_reference: { ...PUBLIC_REFERENCE, description: 'Opaque public reference. It identifies the case but grants no access on its own.' },
      title: { type: 'string', maxLength: 180 },
      description: { type: ['string', 'null'], description: 'Only text the customer wrote when opening the case; null for staff-created cases.' },
      status: { type: 'string', enum: ['received', 'in_progress', 'resolved', 'closed'], description: 'Customer-visible status. Internal working states are not exposed.' },
      channel: { type: ['string', 'null'], enum: ['api', 'customer_portal', 'admin', 'phone', 'operations_automation', null] },
      created_at: DATE_TIME,
      updated_at: DATE_TIME,
      resolved_at: NULLABLE_DATE_TIME,
    },
  },
  CustomerSupportMessage: {
    type: 'object',
    additionalProperties: false,
    required: ['message_reference', 'author_type', 'kind', 'body', 'created_at'],
    properties: {
      message_reference: PUBLIC_REFERENCE,
      author_type: { type: 'string', enum: ['customer', 'staff'], description: 'staff = a named employee of the organization; the employee identity is not exposed.' },
      kind: { type: 'string', enum: ['message', 'phone_summary'], description: 'phone_summary = a call summary explicitly published by staff; never an authenticated customer message.' },
      body: { type: 'string', maxLength: 8000 },
      created_at: DATE_TIME,
    },
  },
  CustomerSupportCaseDetail: {
    allOf: [
      { $ref: '#/components/schemas/CustomerSupportCase' },
      {
        type: 'object',
        required: ['messages'],
        properties: { messages: { type: 'array', items: { $ref: '#/components/schemas/CustomerSupportMessage' } } },
      },
    ],
  },
  CustomerSupportCaseCreateRequest: {
    type: 'object',
    additionalProperties: true,
    required: ['title', 'message'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 180 },
      message: { type: 'string', minLength: 1, maxLength: 8000 },
      category: { type: 'string', maxLength: 120 },
    },
  },
  CustomerSupportMessageCreateRequest: {
    type: 'object',
    additionalProperties: true,
    required: ['message'],
    properties: { message: { type: 'string', minLength: 1, maxLength: 8000 } },
  },
  PortalPage: {
    type: 'object',
    additionalProperties: false,
    required: ['limit', 'offset', 'returned', 'has_more', 'next_cursor'],
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      offset: { type: 'integer', minimum: 0 },
      returned: { type: 'integer', minimum: 0 },
      has_more: { type: 'boolean' },
      next_cursor: { type: ['string', 'null'] },
    },
  },
}

function envelope(dataSchema, withPage = false) {
  const properties = {
    data: dataSchema,
    request_id: { type: 'string' },
    correlation_id: { type: ['string', 'null'] },
    contract_schema_version: { type: 'string', const: VERSION },
  }
  if (withPage) properties.page = { $ref: '#/components/schemas/PortalPage' }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'request_id', 'contract_schema_version', ...(withPage ? ['page'] : [])],
    properties,
  }
}

function addSupportOperations(spec) {
  Object.assign(spec.components.schemas, clone(SUPPORT_SCHEMAS))
  const readTemplate = spec.paths['/api/v1/customer/notifications'].get
  const writeTemplate = spec.paths['/api/v1/customer/notifications/read'].post
  const referenceParameter = {
    name: 'reference',
    in: 'path',
    required: true,
    schema: PUBLIC_REFERENCE,
    description: 'Public case reference returned by this API. Lookups are always bounded to the verified customer.',
  }
  const notFound = clone(writeTemplate.responses['409'])
  notFound.description = 'Ärendet hittades inte för den verifierade kunden.'

  function operation({ template, method, path, scope, summary, description, rateLimitClass, idempotent, pathParam, query, requestSchema, status, dataSchema, withPage, withNotFound }) {
    const op = clone(template)
    const token = path.split('/').filter(Boolean)
      .map((segment) => segment.replace(/^\{|\}$/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')).join('')
    op.operationId = `${method}${token}`
    op.summary = summary
    op.description = description
    op.security = [{ bearerAuth: [scope] }, { legacyApiKeyAuth: [] }]
    op['x-required-scopes'] = [scope]
    op['x-idempotency-required'] = idempotent
    op['x-scope-mode'] = 'all'
    op['x-rate-limit-class'] = rateLimitClass
    op['x-cache-policy'] = 'no-store'
    op['x-public-id-policy'] = 'opaque-references'
    if (pathParam) op.parameters = [op.parameters[0], pathParam, ...op.parameters.slice(1)]
    if (query) op.parameters = [...op.parameters, ...query]
    if (requestSchema) op.requestBody = { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${requestSchema}` } } } }
    const success = clone(template.responses['200'])
    success.content = { 'application/json': { schema: envelope(dataSchema, withPage) } }
    delete op.responses['200']
    op.responses = { [status]: success, ...op.responses }
    if (withNotFound) op.responses['404'] = clone(notFound)
    return op
  }

  const caseRef = { $ref: '#/components/schemas/CustomerSupportCase' }
  const messageRef = { $ref: '#/components/schemas/CustomerSupportMessage' }
  const pageQuery = [
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } },
    { name: 'cursor', in: 'query', required: false, schema: { type: 'string' }, description: 'Opaque cursor from page.next_cursor; bound to the customer and resource.' },
  ]
  const shared = 'Requires an actively linked portal user. Internal notes, phone logs and technical case events are never returned.'

  spec.paths['/api/v1/customer/support/cases'] = {
    get: operation({ template: readTemplate, method: 'get', path: '/api/v1/customer/support/cases', scope: 'customer_support.read', summary: 'List the customer’s support cases', description: `Lists support cases of the verified customer, newest first, filtered in the database before pagination. ${shared}`, rateLimitClass: 'read', idempotent: false, query: pageQuery, status: '200', dataSchema: { type: 'array', items: caseRef }, withPage: true }),
    post: operation({ template: writeTemplate, method: 'post', path: '/api/v1/customer/support/cases', scope: 'customer_support.write', summary: 'Open a support case', description: `Opens a support case with the customer’s first message. The same Idempotency-Key and payload replay the same case; a different payload is rejected with 409. ${shared}`, rateLimitClass: 'write', idempotent: true, requestSchema: 'CustomerSupportCaseCreateRequest', status: '201', dataSchema: caseRef }),
  }
  spec.paths['/api/v1/customer/support/cases/{reference}'] = {
    get: operation({ template: readTemplate, method: 'get', path: '/api/v1/customer/support/cases/{reference}', scope: 'customer_support.read', summary: 'Retrieve a support case with its customer-visible messages', description: shared, rateLimitClass: 'read', idempotent: false, pathParam: referenceParameter, status: '200', dataSchema: { $ref: '#/components/schemas/CustomerSupportCaseDetail' }, withNotFound: true }),
  }
  spec.paths['/api/v1/customer/support/cases/{reference}/messages'] = {
    get: operation({ template: readTemplate, method: 'get', path: '/api/v1/customer/support/cases/{reference}/messages', scope: 'customer_support.read', summary: 'List customer-visible messages of a support case', description: shared, rateLimitClass: 'read', idempotent: false, pathParam: referenceParameter, status: '200', dataSchema: { type: 'array', items: messageRef }, withNotFound: true }),
    post: operation({ template: writeTemplate, method: 'post', path: '/api/v1/customer/support/cases/{reference}/messages', scope: 'customer_support.write', summary: 'Add a customer message to an open support case', description: `Closed cases reject new messages with 409. ${shared}`, rateLimitClass: 'write', idempotent: true, pathParam: referenceParameter, requestSchema: 'CustomerSupportMessageCreateRequest', status: '201', dataSchema: messageRef, withNotFound: true }),
  }
}

for (const entry of SPECS) {
  const original = JSON.parse(fs.readFileSync(entry.file, 'utf8'))
  if (original.info.version !== PREVIOUS && original.info.version !== VERSION) {
    throw new Error(`${entry.file}: unexpected version ${original.info.version}`)
  }
  let spec = original.info.version === PREVIOUS ? bumpVersion(original) : original
  if (entry.name === 'customer-portal-v1') addSupportOperations(spec)
  fs.writeFileSync(entry.file, `${JSON.stringify(spec, null, 2)}\n`)
  console.log(`${entry.file}: ${spec.info.version}, ${Object.keys(spec.paths).length} paths`)
}

const fixtureSource = `docs/fixtures/public-contracts-response-${PREVIOUS}.json`
const fixtureTarget = `docs/fixtures/public-contracts-response-${VERSION}.json`
const fixture = JSON.parse(fs.readFileSync(fixtureSource, 'utf8'))
fs.writeFileSync(fixtureTarget, `${JSON.stringify(replaceVersion(fixture), null, 2)}\n`)
console.log(`${fixtureTarget} written`)
