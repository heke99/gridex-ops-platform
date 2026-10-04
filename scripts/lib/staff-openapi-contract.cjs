const { staffSchemas, ref, resourceReference } = require('./staff-openapi-schemas.cjs')

const scope = {
  sessions: 'staff_sessions.write', context: 'staff_context.read', customers: 'staff_customers.read',
  read: 'staff_support.read', write: 'staff_support.write',
}
const definitions = [
  ['POST', '/staff/sessions', scope.sessions, 'Authenticate an eligible staff member.', 'StaffSessionReceiptEnvelope', 'StaffSessionRequest', 200, 'machine'],
  ['POST', '/staff/sessions/refresh', scope.sessions, 'Rotate this API client’s staff session credentials.', 'StaffSessionReceiptEnvelope', 'StaffRefreshRequest', 200, 'refresh', true],
  ['POST', '/staff/sessions/logout', scope.sessions, 'Revoke the staff API session.', 'StaffLogoutReceiptEnvelope', 'StaffLogoutRequest', 200, 'logout', true],
  ['POST', '/staff/sessions/mfa/challenge', scope.sessions, 'Create a challenge for an actor-owned TOTP factor.', 'StaffMfaChallengeEnvelope', 'StaffMfaChallengeRequest', 200, 'dual'],
  ['POST', '/staff/sessions/mfa/verify', scope.sessions, 'Complete the actor-owned TOTP challenge.', 'StaffSessionReceiptEnvelope', 'StaffMfaVerifyRequest', 200, 'dual', true],
  ['POST', '/staff/sessions/password', scope.sessions, 'Change a staff password through the restricted session.', 'StaffSessionReceiptEnvelope', 'StaffPasswordRequest', 200, 'dual', true],
  ['POST', '/staff/sessions/recovery', scope.sessions, 'Request staff recovery without disclosing account existence.', 'StaffRecoveryReceiptEnvelope', 'StaffRecoveryRequest', 202, 'machine'],
  ['POST', '/staff/sessions/recovery/verify', scope.sessions, 'Verify a recovery token and obtain a restricted session.', 'StaffSessionReceiptEnvelope', 'StaffRecoveryVerifyRequest', 200, 'machine'],
  ['GET', '/staff/me', scope.context, 'Read fresh staff permissions and effective capabilities.', 'StaffContextEnvelope', null, 200, 'dual'],
  ['GET', '/staff/customers', scope.customers, 'Search the API-key organization’s customers.', 'StaffCustomerSummaryPage', null, 200, 'dual', false, 'customers.read'],
  ['GET', '/staff/customers/{customerReference}', scope.customers, 'Retrieve an explicitly projected customer profile.', 'StaffCustomerDetailEnvelope', null, 200, 'dual', false, 'customers.read'],
  ['GET', '/staff/customers/{customerReference}/contacts', scope.customers, 'List the customer’s contacts.', 'StaffCustomerContactPage', null, 200, 'dual', false, 'customers.read'],
  ['GET', '/staff/customers/{customerReference}/addresses', scope.customers, 'List the customer’s addresses.', 'StaffCustomerAddressPage', null, 200, 'dual', false, 'customers.read'],
  ['GET', '/staff/customers/{customerReference}/facilities', scope.customers, 'List the customer’s facilities.', 'StaffCustomerFacilityPage', null, 200, 'dual', false, 'customers.read'],
  ['GET', '/staff/support/cases', scope.read, 'List and search support cases in this organization.', 'StaffSupportCasePage', null, 200, 'dual', false, 'cases.read'],
  ['POST', '/staff/support/cases', scope.write, 'Create a support case without stopping operational processes.', 'StaffCaseCreatedReceiptEnvelope', 'StaffCaseCreateRequest', 201, 'dual', true, 'cases.write'],
  ['GET', '/staff/support/cases/{caseReference}', scope.read, 'Retrieve a staff-visible support case.', 'StaffSupportCaseEnvelope', null, 200, 'dual', false, 'cases.read'],
  ['GET', '/staff/support/cases/{caseReference}/entries', scope.read, 'List safe staff conversation and case entries.', 'StaffSupportEntryPage', null, 200, 'dual', false, 'cases.read'],
  ['POST', '/staff/support/cases/{caseReference}/replies', scope.write, 'Publish a staff reply or phone summary for the customer.', 'StaffSupportEntryEnvelope', 'StaffReplyRequest', 201, 'dual', true, 'cases.write'],
  ['POST', '/staff/support/cases/{caseReference}/internal-notes', scope.write, 'Record an internal note that is never customer-visible.', 'StaffSupportEntryEnvelope', 'StaffNoteRequest', 201, 'dual', true, 'cases.write'],
  ['POST', '/staff/support/cases/{caseReference}/status', scope.write, 'Change case status using the current case version.', 'StaffCaseMutationReceiptEnvelope', 'StaffStatusRequest', 200, 'dual', true, 'cases.write'],
  ['POST', '/staff/support/cases/{caseReference}/assignment', scope.write, 'Assign or unassign an eligible tenant staff member.', 'StaffCaseMutationReceiptEnvelope', 'StaffAssignmentRequest', 200, 'dual', true, 'cases.write'],
  ['GET', '/staff/support/assignees', scope.read, 'List currently eligible case assignees.', 'StaffAssigneePage', null, 200, 'dual', false, 'cases.read'],
  ['GET', '/staff/support/cases/{caseReference}/attachments', scope.read, 'List staff-visible attachment outcomes.', 'StaffSupportAttachmentPage', null, 200, 'dual', false, 'cases.read'],
  ['POST', '/staff/support/cases/{caseReference}/attachments', scope.write, 'Upload one attachment and return its persisted scan outcome.', 'StaffSupportAttachmentEnvelope', 'StaffAttachmentUploadRequest', 201, 'dual', true, 'cases.write'],
  ['GET', '/staff/support/cases/{caseReference}/attachments/{attachmentReference}', scope.read, 'Download released bytes after checking the stored SHA-256.', null, null, 200, 'dual', false, 'cases.read'],
]

function operationId(method, path) {
  return method.toLowerCase() + path.split('/').filter(Boolean).map((part) => part.replace(/[{}\[\]]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((segment) => segment[0].toUpperCase() + segment.slice(1)).join('')).join('')
}

function contractDefinitions(metadata) {
  return definitions.map(([method, path, apiScope, description, responseSchema, requestSchema, status, authentication, idempotencyRequired = false, staffPermission]) => ({
    method, path: `/api/v1${path}`, apiScope, description, responseSchema, requestSchema, status, authentication, idempotencyRequired, staffPermission,
  })).concat([
    { method: 'GET', path: metadata.currentPath, description: 'Retrieve the current staff OpenAPI specification.', authentication: 'public', status: 200 },
    { method: 'GET', path: metadata.immutablePath, description: 'Retrieve the immutable staff OpenAPI specification.', authentication: 'public', status: 200 },
    { method: 'GET', path: metadata.manifestPath, description: 'Retrieve protocol metadata; this does not confer staff permissions.', responseSchema: 'StaffReleaseManifest', authentication: 'public', status: 200 },
  ])
}

function queryParameters(definition) {
  if (!definition.responseSchema?.endsWith('Page')) return []
  const parameters = [
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
    { name: 'cursor', in: 'query', required: false, schema: { type: 'string', minLength: 1, maxLength: 4096 }, description: 'Opaque continuation bound to tenant, API client, staff, resource and filters; changed or tampered cursors return 400.' },
  ]
  const query = (name, schema) => ({ name, in: 'query', required: false, schema })
  if (['/api/v1/staff/customers', '/api/v1/staff/support/cases', '/api/v1/staff/support/assignees'].includes(definition.path)) parameters.push(query('q', { type: 'string', minLength: 2, maxLength: 120 }))
  if (definition.path === '/api/v1/staff/customers') parameters.push(query('status', { type: 'string', enum: ['draft', 'pending_verification', 'active', 'inactive', 'moved', 'terminated', 'blocked', 'archived'] }), query('customer_type', { type: 'string', enum: ['private', 'business', 'association'] }))
  if (definition.path === '/api/v1/staff/support/cases') parameters.push(...['customer_reference', 'assignee_reference'].map((name) => query(name, resourceReference(name === 'customer_reference' ? 'customer' : 'staff'))), query('status', { type: 'string', enum: ['open', 'action_required', 'awaiting_external_response', 'billing_blocked', 'manual_follow_up', 'resolved', 'cancelled', 'closed'] }), query('priority', { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }))
  return parameters
}

function buildStaffOpenApi(metadata, implemented) {
  const selected = contractDefinitions(metadata).filter((definition) => definition.authentication === 'public' || implemented.has(`${definition.method} ${definition.path}`))
  const paths = {}
  const schemas = staffSchemas(metadata.version, metadata.capabilities)
  const standardHeaders = {
    'X-Gridex-Contract-Version': { schema: { type: 'string', const: metadata.version } },
    'X-Request-ID': { schema: { type: 'string' } },
    'X-Correlation-ID': { schema: { type: 'string' } },
    'X-RateLimit-Limit': { schema: { type: 'integer', minimum: 1 }, description: 'Present when the integration guard has a measured API budget.' },
    'X-RateLimit-Remaining': { schema: { type: 'integer', minimum: 0 } },
    'X-RateLimit-Reset': { schema: { type: 'string', format: 'date-time' } },
  }
  for (const definition of selected) {
    const id = operationId(definition.method, definition.path)
    const parameters = [...definition.path.matchAll(/\{([^}]+)\}/g)].map((match) => ({ name: match[1], in: 'path', required: true, schema: resourceReference({ customerReference: 'customer', caseReference: 'support_case', attachmentReference: 'support_attachment' }[match[1]]) }))
    parameters.push(...queryParameters(definition))
    if (definition.idempotencyRequired) parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' }, description: 'Stable key for this exact actor/client/tenant operation. Preserve it after a lost response; changed content conflicts.' })
    parameters.push(...['X-Request-ID', 'X-Correlation-ID'].map(name => ({ name, in: 'header', required: false, schema: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' } })))
    const dual = { integrationBearerAuth: [], staffAuthorization: [] }
    const security = definition.authentication === 'public' ? [] : definition.authentication === 'dual' ? [dual] : definition.authentication === 'logout' ? [dual, { integrationBearerAuth: [] }] : [{ integrationBearerAuth: [] }]
    const isDocumentation = definition.authentication === 'public'
    const documentHeaders = { 'X-Gridex-Contract-Version': standardHeaders['X-Gridex-Contract-Version'], 'X-Request-ID': standardHeaders['X-Request-ID'], ETag: { schema: { type: 'string' } } }
    const response = { description: definition.description, headers: isDocumentation ? documentHeaders : standardHeaders }
    if (definition.idempotencyRequired && definition.path.startsWith('/api/v1/staff/support/')) response.headers = { ...response.headers, 'Idempotency-Replayed': { schema: { type: 'string', enum: ['true', 'false'] }, description: 'An authorized replay returns the originally persisted command outcome.' } }
    if (definition.responseSchema) response.content = { 'application/json': { schema: ref(definition.responseSchema) } }
    else if (!isDocumentation) response.content = Object.fromEntries(['application/pdf', 'image/png', 'image/jpeg'].map((type) => [type, { schema: { type: 'string', format: 'binary' } }]))
    else response.content = { 'application/json': { schema: { type: 'object', description: 'OpenAPI 3.1 document.' } } }
    if (!isDocumentation && !definition.responseSchema) response.headers = { ...standardHeaders, 'X-Gridex-Sha256': { schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, 'Content-Disposition': { schema: { type: 'string' } }, 'Content-Length': { schema: { type: 'integer', minimum: 1, maximum: 10485760 } }, 'X-Content-Type-Options': { schema: { type: 'string', const: 'nosniff' } }, 'Content-Security-Policy': { schema: { type: 'string' } } }
    const responses = { [definition.status]: response }
    if (isDocumentation) responses['304'] = { description: 'Unchanged document; empty body.', headers: documentHeaders }
    else for (const status of ['400', '401', '403', '404', '409', '410', '413', '415', '422', '423', '429', '503']) responses[status] = { description: status === '410' ? 'Organization closed or inactive.' : status === '423' ? 'Organization paused.' : status === '409' ? 'State/content conflict or short-lived session contention. staff_session_busy is retryable with Retry-After: 1.' : 'Canonical safe error. No provider/SQL/credential details.', headers: { ...standardHeaders, ...(['409', '429'].includes(status) ? { 'Retry-After': { schema: { type: 'integer', minimum: 1 } } } : {}) }, content: { 'application/json': { schema: ref('StaffErrorEnvelope') } } }
    const operation = {
      operationId: id, summary: definition.description, security, parameters, responses,
      'x-required-scopes': definition.apiScope ? [definition.apiScope] : [], 'x-required-staff-permissions': definition.staffPermission ? [definition.staffPermission] : [],
      'x-staff-authentication': definition.authentication, 'x-scope-mode': 'all',
      'x-idempotency-required': definition.idempotencyRequired ?? false,
      'x-rate-limit-class': definition.method === 'POST' ? 'write' : 'read',
      'x-cache-policy': definition.path === metadata.immutablePath ? 'public-immutable' : isDocumentation ? 'private-revalidate' : 'no-store',
      'x-public-id-policy': isDocumentation ? 'none' : 'opaque-references',
      ...(definition.requestSchema && definition.requestSchema !== 'StaffAttachmentUploadRequest' ? { 'x-max-json-bytes': definition.path.startsWith('/api/v1/staff/support/') ? 48000 : 16384 } : {}),
    }
    if (definition.authentication === 'logout') operation.description = 'Either the current staff proof or refresh_token in the JSON body must authenticate a session bound to this exact integration client/organization. The machine key alone cannot identify or revoke a session.'
    if (definition.requestSchema) operation.requestBody = { required: true, content: { [definition.requestSchema === 'StaffAttachmentUploadRequest' ? 'multipart/form-data' : 'application/json']: { schema: ref(definition.requestSchema) } } }
    paths[definition.path] = { ...paths[definition.path], [definition.method.toLowerCase()]: operation }
  }
  const enabled = new Set(selected.map((definition) => `${definition.method} ${definition.path}`))
  const has = (method, path) => enabled.has(`${method} /api/v1/staff${path}`)
  const capabilities = []
  if (definitions.filter((row) => row[1].startsWith('/staff/sessions')).every((row) => enabled.has(`${row[0]} /api/v1${row[1]}`))) capabilities.push('staff.sessions')
  if (has('GET', '/me')) capabilities.push('staff.context')
  if (has('GET', '/customers') && has('GET', '/customers/{customerReference}')) capabilities.push('staff.customers.read')
  if (has('GET', '/support/cases') && has('GET', '/support/cases/{caseReference}') && has('GET', '/support/cases/{caseReference}/entries')) capabilities.push('staff.support.read')
  if (definitions.filter((row) => row[0] === 'POST' && row[1].startsWith('/staff/support/') && !row[1].endsWith('/attachments')).every((row) => enabled.has(`${row[0]} /api/v1${row[1]}`))) capabilities.push('staff.support.write')
  if (has('GET', '/support/cases/{caseReference}/attachments') && has('POST', '/support/cases/{caseReference}/attachments') && has('GET', '/support/cases/{caseReference}/attachments/{attachmentReference}')) capabilities.push('staff.support.attachments')
  return {
    openapi: '3.1.0', info: { title: 'Gridex Staff Support API', version: metadata.version, description: 'API-first staff frontend contract. Tenant integration credential AND OPS-issued personal staff proof are required for resources; fresh native permissions remain authoritative. Native Auth credentials stay inside OPS. Website/Customer Portal .4 is unchanged.' },
    servers: [{ url: metadata.origin }], 'x-contract-schema-version': metadata.version, 'x-gridex-release-version': metadata.version,
    'x-staff-protocol-capabilities': capabilities, paths,
    components: { securitySchemes: { integrationBearerAuth: { type: 'http', scheme: 'bearer', description: 'Server-side tenant integration API key; required staff machine scope.' }, staffAuthorization: { type: 'apiKey', in: 'header', name: 'X-Gridex-Staff-Authorization', description: 'Bearer <OPS staff proof>; independently verified and bound to the same API client/organization. Ordinary customer proof is not valid.' } }, schemas },
  }
}

module.exports = { buildStaffOpenApi, contractDefinitions, operationId }
