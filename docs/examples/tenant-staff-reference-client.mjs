/** Node 22+ server reference. Import is inert; configuration and secrets are caller supplied. */
import { createPrivateKey, createPublicKey, KeyObject, randomUUID, sign } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CASE = /^support_case_[A-Za-z0-9_-]{32}$/
const CUSTOMER = /^customer_[A-Za-z0-9_-]{32}$/
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/
const RESOLVE_VERSION = '2026-10-05.2'
const STAFF_VERSION = '2026-10-09.1'
const MAX_RESPONSE_BYTES = 256_000
const SAFE_CODES = new Set([
  'storage_project_mismatch', 'invalid_api_token', 'api_scope_missing', 'rate_limited', 'api_rate_limiter_unavailable',
  'staff_identity_binding_invalid', 'staff_identity_registration_removed', 'staff_identity_auth_invalid',
  'staff_identity_assertion_invalid', 'staff_tenant_auth_registration_invalid', 'staff_identity_provider_invalid',
  'staff_membership_inactive', 'staff_permission_denied', 'staff_provider_missing', 'staff_provider_invalid',
  'staff_assertion_missing', 'staff_assertion_purpose_invalid', 'staff_assertion_replayed', 'staff_assertion_expired',
  'staff_assertion_signature_invalid', 'customer_not_found', 'support_case_not_found',
  'idempotency_conflict', 'idempotency_completion_uncertain', 'idempotency_reconciliation_required',
  'idempotency_in_progress', 'idempotency_previous_attempt_failed', 'idempotency_key_required', 'idempotency_key_invalid',
  'invalid_request', 'invalid_field', 'invalid_json', 'invalid_json_object', 'field_not_allowed',
  'api_contract_profile_unavailable', 'internal_error',
])

class StaffReferenceError extends Error {
  constructor(code, status = null, requestId = null, replayed = false) {
    super('The server Staff reference operation could not be confirmed.')
    this.name = 'StaffReferenceError'
    this.code = code
    this.status = status
    this.requestId = requestId
    this.replayed = replayed
  }
}
function fail(code, status, requestId) { throw new StaffReferenceError(code, status, requestId) }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function shortText(value, max) { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) }
function token(value) { return shortText(value, 16_384) && !/\s/.test(value) }
function exactKeys(value, keys) { return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)) }
function validBinding(value) {
  return exactKeys(value, ['actor_user_id', 'binding_id', 'binding_version']) && UUID.test(value.actor_user_id)
    && UUID.test(value.binding_id) && Number.isSafeInteger(value.binding_version) && value.binding_version >= 1
}
function configuration(options) {
  try {
    if (!record(options) || typeof window !== 'undefined' || Number(process.versions.node.split('.')[0]) < 22) throw new Error()
    const origin = new URL(options.apiOrigin)
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
      || !shortText(options.apiOrigin, 512) || !/^https:\/\/[^/?#]+\/?$/.test(options.apiOrigin)) throw new Error()
    if (!/^[a-z0-9]{20}$/.test(options.expectedProjectRef) || !UUID.test(options.companyId)) throw new Error()
    const auth = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/auth\/v1$/.exec(options.tenantAuthIssuer)
    if (!auth || auth[1] === options.expectedProjectRef) throw new Error()
    if (!shortText(options.providerIssuer, 512) || !shortText(options.providerAudience, 512) || !token(options.providerKeyId)
      || !token(options.machineCredential) || typeof options.getVerifiedTenantSession !== 'function') throw new Error()
    const privateKey = options.signingPrivateKey instanceof KeyObject ? options.signingPrivateKey : createPrivateKey(options.signingPrivateKey)
    if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048) throw new Error()
    const published = options.providerPublicJwk, publicKey = createPublicKey(privateKey).export({ format: 'jwk' })
    if (!record(published) || published.kty !== 'RSA' || published.kid !== options.providerKeyId || published.alg !== 'RS256'
      || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some(key => key in published) || published.n !== publicKey.n || published.e !== publicKey.e) throw new Error()
    const timeoutMs = options.timeoutMs ?? 10_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30_000) throw new Error()
    const fetchImpl = options.fetchImpl ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error()
    return { apiOrigin: origin.origin, expectedProjectRef: options.expectedProjectRef, companyId: options.companyId,
      tenantAuthIssuer: options.tenantAuthIssuer, providerIssuer: options.providerIssuer, providerAudience: options.providerAudience,
      providerKeyId: options.providerKeyId, machineCredential: options.machineCredential,
      getVerifiedTenantSession: options.getVerifiedTenantSession, privateKey, timeoutMs, fetchImpl }
  } catch { fail('invalid_configuration') }
}

async function boundedJson(response, signal) {
  if (!response.body) fail('invalid_response')
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks = []
  let length = 0
  try {
    const declared = response.headers.get('content-length')
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) fail('invalid_response')
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_RESPONSE_BYTES) fail('invalid_response')
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    cancel()
    if (error instanceof StaffReferenceError) throw error
    fail('invalid_response')
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock() }
}

/**
 * Create per backend request/session. Never expose this object, its options or callback to a browser.
 * getVerifiedTenantSession must call registered tenant Auth getUser for EVERY invocation and return
 * { user: the verified record, accessToken: the same bearer, authIssuer: the registered issuer }.
 * No operation automatically resolves, writes, retries or chooses a new idempotency key.
 */
export function createStaffReferenceClient(options) {
  const config = configuration(options)
  let resolved

  async function session() {
    let value
    try { value = await config.getVerifiedTenantSession() } catch { fail('tenant_session_invalid') }
    const user = value?.user
    if (!record(user) || !UUID.test(user.id) || !shortText(user.email, 320) || !shortText(user.email_confirmed_at, 80)
      || !Number.isFinite(Date.parse(user.email_confirmed_at)) || user.deleted_at != null || user.is_anonymous === true
      || (user.banned_until != null && (!Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until) > Date.now()))
      || value.authIssuer !== config.tenantAuthIssuer || !token(value.accessToken)) {
      resolved = undefined
      fail('tenant_session_invalid')
    }
    return { subject: user.id, accessToken: value.accessToken }
  }
  function proof(claims) {
    const iat = Math.floor(Date.now() / 1000)
    const parts = [
      Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: config.providerKeyId })).toString('base64url'),
      Buffer.from(JSON.stringify({ iss: config.providerIssuer, aud: config.providerAudience, ...claims, company_id: config.companyId,
        iat, exp: iat + 60, jti: randomUUID() })).toString('base64url'),
    ]
    try { return `${parts.join('.')}.${sign('RSA-SHA256', Buffer.from(parts.join('.')), config.privateKey).toString('base64url')}` }
    catch { fail('proof_unavailable') }
  }

  async function request(path, method, assertion, body, idempotencyKey, accessToken) {
    const version = accessToken ? RESOLVE_VERSION : STAFF_VERSION
    const headers = { authorization: `Bearer ${config.machineCredential}`, 'x-gridex-expected-project-ref': config.expectedProjectRef,
      'x-gridex-staff-assertion': assertion, accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
    if (accessToken) headers['x-gridex-support-auth-token'] = accessToken
    const controller = new AbortController()
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { reject(new StaffReferenceError('transport_outcome_unknown')); controller.abort() }, config.timeoutMs)
    })
    try {
      return await Promise.race([timeout, (async () => {
        const response = await config.fetchImpl(`${config.apiOrigin}${path}`, { method, headers, redirect: 'error', credentials: 'omit',
          cache: 'no-store', signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
        if (response.status >= 300 && response.status < 400 || response.redirected) fail('invalid_response')
        const value = await boundedJson(response, controller.signal)
        const requestId = response.headers.get('x-request-id')
        if (!record(value) || !REQUEST_ID.test(requestId ?? '') || value.request_id !== requestId
          || value.contract_schema_version !== version || response.headers.get('x-gridex-contract-version') !== version
          || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) fail('invalid_response')
        if (!response.ok) {
          const code = record(value.error) && SAFE_CODES.has(value.error.code) ? value.error.code : 'request_rejected'
          fail(code, response.status, requestId)
        }
        if (response.headers.get('x-gridex-project-ref') !== config.expectedProjectRef
          || !exactKeys(value, ['data', 'request_id', 'contract_schema_version']) || !record(value.data)) fail('invalid_response')
        const replay = response.headers.get('idempotency-replayed')
        if (replay !== null && replay !== 'true' && replay !== 'false') fail('invalid_response')
        if (method === 'POST' && !accessToken && replay === null) fail('invalid_response')
        return { status: response.status, requestId, replayed: replay === 'true', data: value.data }
      })()])
    } catch (error) {
      controller.abort()
      if (error instanceof StaffReferenceError) throw error
      fail('transport_outcome_unknown')
    } finally { clearTimeout(timer) }
  }
  async function access(path, method = 'GET', body, key) {
    const local = await session()
    const authority = resolved
    if (!authority || authority.subject !== local.subject) { resolved = undefined; fail('identity_resolution_required') }
    const assertion = proof({ sub: authority.binding.actor_user_id, token_use: 'staff_access', local_auth_subject: local.subject,
      local_auth_issuer: config.tenantAuthIssuer, staff_binding_id: authority.binding.binding_id, staff_binding_version: authority.binding.binding_version })
    return request(path, method, assertion, body, key)
  }
  return Object.freeze({
    async resolveIdentity() {
      resolved = undefined
      const local = await session()
      const result = await request('/api/v1/staff-onboarding/identity/resolve', 'POST', proof({ sub: local.subject, token_use: 'staff_identity_resolution' }), {}, undefined, local.accessToken)
      if (!validBinding(result.data)) fail('invalid_response')
      // Keep an unshared copy: callers cannot mutate cached authority via the returned DTO.
      resolved = { subject: local.subject, binding: { ...result.data } }
      return result
    },
    async listCustomers() {
      const result = await access('/api/v1/staff/customers')
      const data = result.data
      if (!exactKeys(data, ['customers', 'pagination']) || !Array.isArray(data.customers) || !record(data.pagination)
        || !data.customers.every(customer => record(customer) && CUSTOMER.test(customer.customer_reference))
        || !['page', 'page_size', 'total', 'total_pages'].every(key => Number.isSafeInteger(data.pagination[key]) && data.pagination[key] >= 0)) fail('invalid_response')
      return result
    },
    async createCase(payload, idempotencyKey) {
      if (!token(idempotencyKey) || idempotencyKey.length < 8 || idempotencyKey.length > 200 || !/^[A-Za-z0-9._:+~-]+$/.test(idempotencyKey)
        || !record(payload) || Object.keys(payload).some(key => !['customer_reference', 'title', 'description', 'category', 'priority'].includes(key))
        || !CUSTOMER.test(payload.customer_reference) || !shortText(payload.title, 180) || !payload.title.trim()
        || ['description', 'category'].some(key => payload[key] != null && (typeof payload[key] !== 'string' || payload[key].length > (key === 'description' ? 8000 : 120)))
        || (payload.priority !== undefined && !['low', 'normal', 'high', 'urgent'].includes(payload.priority))) fail('invalid_input')
      const body = Object.fromEntries(Object.entries(payload))
      const result = await access('/api/v1/staff/cases', 'POST', body, idempotencyKey)
      if (!CASE.test(result.data.case_reference) || result.data.customer_reference !== body.customer_reference) fail('invalid_response')
      return result
    },
    async getCase(caseReference) {
      if (typeof caseReference !== 'string' || !CASE.test(caseReference)) fail('invalid_input')
      const result = await access(`/api/v1/staff/cases/${caseReference}`)
      if (result.data.case_reference !== caseReference || !CUSTOMER.test(result.data.customer_reference)
        || !Array.isArray(result.data.events) || !Array.isArray(result.data.attachments)) fail('invalid_response')
      return result
    },
  })
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log('Node 22+ server Staff reference. Import createStaffReferenceClient with explicit server configuration. See docs/staff-api/server-reference-integration.md. This entrypoint only displays help.')
  if (process.argv.length > 3 || (process.argv.length === 3 && process.argv[2] !== '--help')) process.exitCode = 2
}
