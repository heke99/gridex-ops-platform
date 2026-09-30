'use strict'

/** Called after route scaffolding and before canonical envelope normalization.
 * No existing immutable release is edited by this helper. */
module.exports = function finalizeSupportRelease({ portal, envelope, setRequest, setResponse }) {
  const closed = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
  const ref = (kind) => ({ type: 'string', pattern: `^${kind}_[A-Za-z0-9_-]{32}$` })
  const revision = { type: 'integer', minimum: 0, maximum: 9007199254740991 }
  const dateTime = { type: 'string', format: 'date-time' }
  const title = { type: 'string', minLength: 1, maxLength: 180 }
  const body = { type: 'string', minLength: 1, maxLength: 8000 }
  const status = { type: 'string', enum: ['open', 'waiting_for_customer', 'resolved', 'closed'] }
  const schemas = portal.components.schemas
  schemas.CustomerSupportPage = closed({ limit: { type: 'integer', minimum: 1, maximum: 100 }, returned: { type: 'integer', minimum: 0, maximum: 100 }, has_more: { type: 'boolean' }, next_cursor: { type: ['string', 'null'] } })
  schemas.CustomerSupportCase = closed({ case_reference: ref('case'), title, status, revision, created_at: dateTime, updated_at: dateTime })
  schemas.CustomerSupportMessage = closed({ message_reference: ref('case_message'), body, author_kind: { type: 'string', enum: ['customer', 'staff'] }, channel: { type: 'string', enum: ['ops', 'portal', 'api', 'phone'] }, revision: { type: 'integer', minimum: 1 }, created_at: dateTime })
  schemas.CustomerSupportCreateRequest = closed({ title, body })
  schemas.CustomerSupportMessageRequest = closed({ body, expected_revision: revision })
  schemas.CustomerSupportCreateData = closed({ case_reference: ref('case'), revision: { type: 'integer', minimum: 1 }, status, replayed: { type: 'boolean' } })
  schemas.CustomerSupportMessageData = closed({ case_reference: ref('case'), message_reference: ref('case_message'), revision: { type: 'integer', minimum: 1 }, status, replayed: { type: 'boolean' } })
  for (const [path, itemSchema, requestSchema, resultSchema] of [
    ['/api/v1/customer/cases', 'CustomerSupportCase', 'CustomerSupportCreateRequest', 'CustomerSupportCreateData'],
    ['/api/v1/customer/cases/{reference}/messages', 'CustomerSupportMessage', 'CustomerSupportMessageRequest', 'CustomerSupportMessageData'],
  ]) {
    // The canonical registry's runtime uses [reference], its publicPath uses
    // {reference}; tolerate either scaffolding key before final normalization.
    const key = portal.paths[path] ? path : path.replace('{reference}', '[reference]')
    if (!portal.paths[key]?.get || !portal.paths[key]?.post) throw new Error(`support_routes_not_scaffolded:${path}`)
    const get = portal.paths[key].get
    get.description = path.endsWith('/messages')
      ? 'Read only customer-visible messages for a case belonging to the verified customer. Requires customer_cases.read and a signed assertion for the exact GET path, including the returned case_reference. Internal notes and attachment storage records are never projected. Message revisions can have gaps after internal case activity; retrieve the current case revision from GET /api/v1/customer/cases before posting. Invalid or foreign cursors return 400 invalid_cursor; an unavailable or foreign case returns neutral 404 resource_not_found.'
      : 'Read cases belonging to the verified customer with customer_cases.read and a signed assertion for the exact GET path. Organization and customer filtering occurs before created_at/id descending pagination. Each case includes the current revision to use as expected_revision when posting a message. Only the closed public case projection is returned.'
    get.parameters = [...(get.parameters ?? []).filter(parameter => !['limit', 'cursor'].includes(parameter.name)),
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 }, description: 'Page size; default 25. Missing, non-positive, fractional or non-numeric values use the default; values above 100 return 422.' },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'string' }, description: 'Opaque cursor bound to the current organization, customer and this resource, including the case_reference for messages. Invalid, tampered or foreign cursors return 400 invalid_cursor.' }]
    const list = envelope({ type: 'array', items: { $ref: `#/components/schemas/${itemSchema}` } }, ['page'])
    list.properties.page = { $ref: '#/components/schemas/CustomerSupportPage' }
    setResponse(portal, key, list, 'get')
    setRequest(portal, key, { $ref: `#/components/schemas/${requestSchema}` })
    setResponse(portal, key, envelope({ $ref: `#/components/schemas/${resultSchema}` }), 'post', '201')
    delete portal.paths[key].post.responses['200']
    const post = portal.paths[key].post
    post.description = 'Exact-method/path delegated customer command. Requires customer_cases.write and Idempotency-Key. Current client, customer relationship and role are checked inside the atomic command and again before completed replay. The case mutation, revision, public message, audit, idempotency result and durable intent commit atomically. A same-key identical request returns the persisted resource and revision with replayed=true; a changed payload conflicts. Unknown fields are rejected; staff notes never become public messages. '
      + (path.endsWith('/messages')
        ? 'Send body and expected_revision from the current case. A stale revision or terminal case status returns 409 without a message; read the current case before a new command.'
        : 'Send only title and body. A successful create or replay returns HTTP 201 with case_reference, revision, status and replayed.')
    get.responses['400'] = { description: 'Invalid, tampered or foreign cursor; no resource data returned.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } }
    delete get.responses['409']
    for (const operation of [get, portal.paths[key].post]) {
      for (const [code, description] of [['403', 'Current customer role, relation, client, scope or delegation denied.'], ['404', 'Neutral resource_not_found for unavailable or foreign case references.'], ['422', 'Strict request or page validation failed; no mutation.'], ['503', 'Safe support_unavailable response with retryable=true; missing support schema or invalid persisted result.']]) {
        operation.responses[code] = { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } }
      }
    }
    post.responses['409'] = { description: 'Revision, payload or status conflict; no partial mutation. A support_legacy_idempotency_requires_review response requires review of the existing legacy case; it cannot safely be automatically retried with a new key.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } }
  }

  schemas.CustomerSupportAttachment = closed({ attachment_reference: ref('case_attachment'), file_name: { type: 'string' },
    media_type: { type: 'string', enum: ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'] },
    byte_size: { type: 'integer', minimum: 1, maximum: 5 * 1024 * 1024 }, scan_status: { type: 'string', const: 'quarantined' }, created_at: dateTime })
  schemas.CustomerSupportAttachmentData = closed({ attachment_reference: ref('case_attachment'), revision: { type: 'integer', minimum: 1 },
    scan_status: { type: 'string', const: 'quarantined' }, replayed: { type: 'boolean' } })
  const attachmentPath = '/api/v1/customer/cases/{reference}/attachments'
  const attachmentKey = portal.paths[attachmentPath] ? attachmentPath : attachmentPath.replace('{reference}', '[reference]')
  if (!portal.paths[attachmentKey]?.get || !portal.paths[attachmentKey]?.post) throw new Error(`support_attachment_routes_not_scaffolded:${attachmentPath}`)
  const attachments = portal.paths[attachmentKey]
  attachments.get.description = 'Read private quarantined attachment metadata only for the verified customer’s own case with customer_cases.read and a signed assertion for the exact GET path. No object URL, storage path or download is exposed. A missing scanner keeps every file quarantined; metadata presence does not grant release or download. Current customer and case filtering precedes cursor pagination.'
  attachments.get.parameters = [...(attachments.get.parameters ?? []).filter(parameter => !['limit', 'cursor'].includes(parameter.name)),
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 }, description: 'Default 25; non-positive, fractional or non-numeric values use the default. Values above 100 return 422.' },
    { name: 'cursor', in: 'query', required: false, schema: { type: 'string' }, description: 'Opaque organization/customer/case-bound cursor. Invalid, tampered or foreign cursors return 400 invalid_cursor.' }]
  const attachmentList = envelope({ type: 'array', items: { $ref: '#/components/schemas/CustomerSupportAttachment' } }, ['page'])
  attachmentList.properties.page = { $ref: '#/components/schemas/CustomerSupportPage' }
  setResponse(portal, attachmentKey, attachmentList, 'get')
  attachments.post.description = 'Upload one file into private quarantine with customer_cases.write, exact-method/path signed delegation and Idempotency-Key. The multipart fields are exactly file and expected_revision; unknown or duplicate fields are rejected. PDF, PNG, JPEG and valid UTF-8 plain text are allowed after content checks, up to 5 MiB. Use the current case revision. Metadata, case revision, canonical audit, idempotency result and durable scan request commit in the protected command; storage remains private and quarantined. A same-key identical upload returns the same attachment with replayed=true after current authority checks; changed payload conflicts. A successful 201 never means clean, released or downloadable.'
  attachments.post.requestBody = { required: true, content: { 'multipart/form-data': { schema: { type: 'object', additionalProperties: false,
    required: ['file', 'expected_revision'], properties: { file: { type: 'string', format: 'binary', description: 'One nonempty file, maximum 5 MiB. Declared media type and actual content must agree.' },
      expected_revision: { type: 'string', pattern: '^(0|[1-9][0-9]*)$', description: 'Current case revision as a canonical decimal integer, at most 9007199254740991.' } } } } } }
  setResponse(portal, attachmentKey, envelope({ $ref: '#/components/schemas/CustomerSupportAttachmentData' }), 'post', '201')
  delete attachments.post.responses['200']
  for (const [method, operation] of Object.entries(attachments)) {
    if (!['get', 'post'].includes(method)) continue
    for (const [code, description] of [['400', method === 'get' ? 'invalid_cursor for malformed, tampered or foreign cursors.' : 'idempotency_key_required for a missing Idempotency-Key.'],
      ['403', 'support_actor_forbidden; current client, scope, delegated customer or role denied.'], ['404', 'Neutral resource_not_found for unavailable or foreign cases.'],
      ['422', 'invalid_support_attachment or strict pagination/field validation failed.'], ['503', 'Safe retryable support_attachment_unavailable for unavailable schema, storage or upload capability; no database or storage diagnostics are public.']]) {
      operation.responses[code] = { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } }
    }
  }
  delete attachments.get.responses['409']
  attachments.post.responses['409'] = { description: 'support_revision_conflict, support_idempotency_conflict or support_case_closed; no attachment metadata is committed.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } }
  attachments.post.responses['413'] = { description: 'support_attachment_too_large; file exceeds 5 MiB and remains unavailable for upload.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } }
}
