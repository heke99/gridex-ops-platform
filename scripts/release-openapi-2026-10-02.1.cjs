#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Contract release 2026-10-02.1 (tenantservice support attachments, step B).
 *
 * Deterministic, re-runnable preparation of the current specs before
 * `npm run api:materialize`:
 * - bumps the contract version 2026-10-01.1 -> 2026-10-02.1 in both current specs,
 *   keeping the 2026-10-01.1 catalog entry and adding the 2026-10-02.1 entry;
 * - adds the customer support attachment operations
 *   (`/api/v1/customer/support/cases/{reference}/attachments*`) with a closed response
 *   schema that contains only public references.
 *
 * Immutable release artifacts are never edited by hand: they are produced from the
 * current specs by scripts/materialize-openapi-release.cjs.
 */
const fs = require('node:fs')

const PREVIOUS = '2026-10-01.1'
const VERSION = '2026-10-02.1'
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
  // Previously published releases stay catalogued unchanged; each gets a 2026-10-02.1 sibling.
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

const ATTACHMENT_SCHEMAS = {
  CustomerSupportAttachment: {
    type: 'object',
    additionalProperties: false,
    required: ['attachment_reference', 'file_name', 'mime_type', 'byte_size', 'sha256', 'uploaded_by', 'created_at'],
    properties: {
      attachment_reference: { ...PUBLIC_REFERENCE, description: 'Opaque public reference. It identifies the attachment but grants no access on its own.' },
      file_name: { type: 'string', maxLength: 160, description: 'Sanitized file name; the extension always matches the detected type.' },
      mime_type: { type: 'string', enum: ['application/pdf', 'image/png', 'image/jpeg'], description: 'Type detected from the file content, never the declared type.' },
      byte_size: { type: 'integer', minimum: 1, maximum: 10485760 },
      sha256: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'SHA-256 of the stored bytes; re-verified on every download.' },
      uploaded_by: { type: 'string', enum: ['customer', 'staff'] },
      created_at: DATE_TIME,
    },
  },
}

function envelope(dataSchema) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'request_id', 'contract_schema_version'],
    properties: {
      data: dataSchema,
      request_id: { type: 'string' },
      correlation_id: { type: ['string', 'null'] },
      contract_schema_version: { type: 'string', const: VERSION },
    },
  }
}

function addAttachmentOperations(spec) {
  Object.assign(spec.components.schemas, clone(ATTACHMENT_SCHEMAS))
  const caseItem = spec.paths['/api/v1/customer/support/cases/{reference}/messages']
  if (!caseItem?.get || !caseItem?.post) throw new Error('support message operations missing; release 2026-10-01.1 must be present')
  const readTemplate = caseItem.get
  const writeTemplate = caseItem.post
  const attachmentParameter = {
    name: 'attachmentReference',
    in: 'path',
    required: true,
    schema: PUBLIC_REFERENCE,
    description: 'Public attachment reference returned by this API. Lookups are bounded to the verified customer and case.',
  }
  const shared = 'Requires an actively linked portal user. Only released (content-checked), customer-visible attachments are ever listed or served; internal staff files are never returned.'
  const attachmentRef = { $ref: '#/components/schemas/CustomerSupportAttachment' }

  function fromTemplate(template, { operationId, summary, description, rateLimitClass, idempotent }) {
    const op = clone(template)
    op.operationId = operationId
    op.summary = summary
    op.description = description
    op['x-idempotency-required'] = idempotent
    op['x-rate-limit-class'] = rateLimitClass
    return op
  }

  const list = fromTemplate(readTemplate, {
    operationId: 'getApiV1CustomerSupportCasesReferenceAttachments',
    summary: 'List released attachments of a support case',
    description: shared,
    rateLimitClass: 'read',
    idempotent: false,
  })
  list.responses['200'].content = { 'application/json': { schema: envelope({ type: 'array', items: attachmentRef }) } }

  const upload = fromTemplate(writeTemplate, {
    operationId: 'postApiV1CustomerSupportCasesReferenceAttachments',
    summary: 'Upload an attachment to an open support case',
    description: `Send the raw file as the request body with Content-Type application/pdf, image/png or image/jpeg (at most 4 MB) and an optional URL-encoded X-File-Name header. The file is stored in quarantine and released only after a content check (real type from the bytes, no active PDF content such as JavaScript, launch actions or embedded files). Rejected files return 422 and are never served. Closed cases return 409. At most 20 attachments per customer per 24 hours (429). The same Idempotency-Key with the same bytes replays the result. ${shared}`,
    rateLimitClass: 'write',
    idempotent: true,
  })
  upload.requestBody = {
    required: true,
    content: Object.fromEntries(['application/pdf', 'image/png', 'image/jpeg'].map((type) => [type, { schema: { type: 'string', format: 'binary', maxLength: 4194304 } }])),
  }
  upload.parameters = [
    ...upload.parameters,
    { name: 'X-File-Name', in: 'header', required: false, schema: { type: 'string', maxLength: 200 }, description: 'URL-encoded original file name. Informational only: it is sanitized and its extension is replaced by the detected type.' },
  ]
  const created = upload.responses['201']
  created.content = { 'application/json': { schema: envelope(attachmentRef) } }
  for (const [status, description] of [
    ['413', 'Filen är större än 4 MB.'],
    ['415', 'Content-Type måste vara application/pdf, image/png eller image/jpeg.'],
    ['422', 'Filen är tom eller godkändes inte i innehållskontrollen.'],
    ['429', 'För många bilagor för kunden det senaste dygnet.'],
  ]) {
    if (!upload.responses[status]) {
      const template = upload.responses['409'] ?? upload.responses['400']
      upload.responses[status] = { ...clone(template), description }
    }
  }

  const download = fromTemplate(readTemplate, {
    operationId: 'getApiV1CustomerSupportCasesReferenceAttachmentsAttachmentReference',
    summary: 'Download a released attachment',
    description: `Returns the file bytes as an attachment download (Content-Disposition: attachment, X-Content-Type-Options: nosniff, sandboxing Content-Security-Policy). X-Gridex-Sha256 carries the verified SHA-256. A file whose bytes no longer match its recorded hash, or that is not released, is refused with 409. ${shared}`,
    rateLimitClass: 'read',
    idempotent: false,
  })
  download.parameters = [download.parameters[0], download.parameters[1], attachmentParameter, ...download.parameters.slice(2)]
  download.responses['200'] = {
    description: 'Attachment bytes.',
    headers: {
      'X-Gridex-Sha256': { schema: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
      'Content-Disposition': { schema: { type: 'string' } },
    },
    content: Object.fromEntries(['application/pdf', 'image/png', 'image/jpeg'].map((type) => [type, { schema: { type: 'string', format: 'binary' } }])),
  }
  if (!download.responses['409']) download.responses['409'] = { ...clone(upload.responses['409']), description: 'Bilagan är inte släppt eller dess innehåll stämmer inte med det som laddades upp.' }

  spec.paths['/api/v1/customer/support/cases/{reference}/attachments'] = { get: list, post: upload }
  spec.paths['/api/v1/customer/support/cases/{reference}/attachments/{attachmentReference}'] = { get: download }
}

for (const entry of SPECS) {
  const original = JSON.parse(fs.readFileSync(entry.file, 'utf8'))
  if (original.info.version !== PREVIOUS && original.info.version !== VERSION) {
    throw new Error(`${entry.file}: unexpected version ${original.info.version}`)
  }
  const spec = original.info.version === PREVIOUS ? bumpVersion(original) : original
  if (entry.name === 'customer-portal-v1') addAttachmentOperations(spec)
  fs.writeFileSync(entry.file, `${JSON.stringify(spec, null, 2)}\n`)
  console.log(`${entry.file}: ${spec.info.version}, ${Object.keys(spec.paths).length} paths`)
}

const fixtureSource = `docs/fixtures/public-contracts-response-${PREVIOUS}.json`
const fixtureTarget = `docs/fixtures/public-contracts-response-${VERSION}.json`
const fixture = JSON.parse(fs.readFileSync(fixtureSource, 'utf8'))
fs.writeFileSync(fixtureTarget, `${JSON.stringify(replaceVersion(fixture), null, 2)}\n`)
console.log(`${fixtureTarget} written`)
