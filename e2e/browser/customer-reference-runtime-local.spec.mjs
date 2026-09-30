import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { importJWK, SignJWT } from 'jose'
import { test, expect } from '@playwright/test'
import { delegatedRequest, runConfiguredCustomerRead } from '../../scripts/tenantservice/customer-api-reference.mjs'
import { localProofEnabled, localProofFixture, localProofSql, proofQuote } from '../helpers/customer-api-proof.mjs'

const enabled = localProofEnabled('GRIDEX_REFERENCE_RUNTIME_LOCAL_E2E', 'GRIDEX_REFERENCE_RUNTIME_FIXTURE_PATH')
test.skip(!enabled, 'Requires an independent disposable local database, Auth/client and private signer fixture.')
test.describe.configure({ mode: 'serial', retries: 0 })
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const f = enabled ? localProofFixture('GRIDEX_REFERENCE_RUNTIME_FIXTURE_PATH') : null
const origin = 'http://127.0.0.1:3000'
const version = JSON.parse(readFileSync(new URL('../../docs/openapi/customer-portal-v1.json', import.meta.url))).info.version
const listPath = '/api/v1/customer/notifications', readPath = `${listPath}/read`, profilePath = '/api/v1/customer/profile-update'
let signingKey, contract, committedLostResponse
const actions = []

// Validate the exact four served response schemas used in this bounded journey.
// Unsupported behavioral keywords fail this proof instead of being ignored.
function schemaErrors(schema, value, path = '$') {
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/components/schemas/')) return [`${path}:unsupported_ref`]
    return schemaErrors(contract.components.schemas[schema.$ref.slice('#/components/schemas/'.length)], value, path)
  }
  const supported = new Set(['type', 'properties', 'additionalProperties', 'required', 'items', 'oneOf', 'allOf', 'anyOf',
    'enum', 'const', 'minimum', 'maximum', 'pattern', 'format', 'description', 'title', 'example', 'examples', 'default', 'readOnly', 'deprecated'])
  const errors = Object.keys(schema).filter(key => !supported.has(key)).map(key => `${path}:unsupported_${key}`)
  if (schema.oneOf && schema.oneOf.filter(branch => schemaErrors(branch, value, path).length === 0).length !== 1) errors.push(`${path}:oneOf`)
  if (schema.anyOf && !schema.anyOf.some(branch => schemaErrors(branch, value, path).length === 0)) errors.push(`${path}:anyOf`)
  if (schema.allOf) errors.push(...schema.allOf.flatMap(branch => schemaErrors(branch, value, path)))
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null
  if (types && !types.some(expected => expected === type || expected === 'integer' && Number.isSafeInteger(value))) errors.push(`${path}:type`)
  if (Object.hasOwn(schema, 'const') && value !== schema.const) errors.push(`${path}:const`)
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}:enum`)
  if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) errors.push(`${path}:range`)
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}:pattern`)
  if (typeof value === 'string' && schema.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))) errors.push(`${path}:date-time`)
  if (schema.format && schema.format !== 'date-time') errors.push(`${path}:unsupported_format`)
  if (value && type === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}:required`)
    for (const [key, entry] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...schemaErrors(schema.properties[key], entry, `${path}.${key}`))
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}:additional`)
    }
  }
  if (type === 'array' && schema.items) errors.push(...value.flatMap((item, index) => schemaErrors(schema.items, item, `${path}[${index}]`)))
  return errors
}
function validResponse(method, path, response) {
  expect(response.status).toBe(200)
  const schema = contract.paths[path][method.toLowerCase()].responses['200'].content['application/json'].schema
  expect(schemaErrors(schema, response.body), `${method} ${path} actual served response contract`).toEqual([])
  expect(response.body.contract_schema_version).toBe(version)
  expect(response.body.request_id).toMatch(/^[0-9a-f-]{36}$/i)
  return response.body
}
function options(c, overrides = {}) {
  return { baseUrl: origin, apiKey: c.key, customerNumber: c.customerNumber,
    signAssertion: async action => {
      actions.push(action)
      return new SignJWT({ company_id: c.companyId, api_client_id: c.clientId, customer_id: c.customerId, action })
        .setProtectedHeader({ alg: 'RS256', kid: f.trust[c.clientId].jwks.keys[0].kid })
        .setIssuer(f.proofIssuer).setAudience('gridex-customer-portal').setSubject(c.userId)
        .setIssuedAt().setExpirationTime('5m').sign(signingKey)
    }, ...overrides }
}
async function call(c, method, path, body, key, overrides = {}) {
  try { return await delegatedRequest({ ...options(c, overrides), method, path, body, idempotencyKey: key }) }
  catch { throw new Error('reference_runtime_actual_local_http_failed') }
}
function snapshot() {
  const ids = f.customers.map(c => proofQuote(c.customerId)).join(',')
  return localProofSql(`SELECT jsonb_build_object(
    'customers',(SELECT jsonb_agg(jsonb_build_object('id',id,'email',email,'phone',phone,'revision',contact_revision) ORDER BY id) FROM public.customers WHERE id IN (${ids})),
    'contacts',(SELECT jsonb_agg(jsonb_build_object('id',id,'customer',customer_id,'email',email,'phone',phone) ORDER BY id) FROM public.customer_contacts WHERE customer_id IN (${ids}) AND is_primary),
    'notifications',(SELECT jsonb_agg(jsonb_build_object('id',id,'customer',customer_id,'status',status,'read_at',read_at) ORDER BY id) FROM public.customer_notifications WHERE customer_id IN (${ids})),
    'commands',(SELECT count(*) FROM public.canonical_command_results WHERE request_payload->>'customerId' IN (${ids}) AND command_type='customer.contact.change.v1'),
    'contactAudits',(SELECT count(*) FROM public.canonical_audit_events WHERE aggregate_id IN (${ids}) AND event_type='CUSTOMER_CONTACT_COMMAND'),
    'notificationAudits',(SELECT count(*) FROM public.canonical_audit_events WHERE aggregate_id IN (${ids}) AND event_type='CUSTOMER_NOTIFICATIONS_READ_COMMAND'),
    'contactOutbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE payload->>'customerId' IN (${ids}) AND topic='customer.contact.changed'),
    'emailOutbox',(SELECT count(*) FROM public.tenant_email_outbox WHERE customer_id IN (${ids})));`)
}
function assertPhone(c, expectedPhone, expectedRevision) {
  const state = localProofSql(`SELECT jsonb_build_object('email',c.email,'phone',c.phone,'revision',c.contact_revision,
    'contactEmail',p.email,'contactPhone',p.phone) FROM public.customers c JOIN public.customer_contacts p ON p.customer_id=c.id AND p.company_id=c.company_id AND p.is_primary
    WHERE c.id=${proofQuote(c.customerId)} AND c.company_id=${proofQuote(c.companyId)};`)
  expect(state).toEqual({ email: c.email, phone: expectedPhone, revision: expectedRevision, contactEmail: c.email, contactPhone: expectedPhone })
}
function denied(response) {
  expect([401, 403]).toContain(response.status)
  expect(response.body.data).toBeUndefined()
  expect(typeof response.body.error?.code).toBe('string')
}

test.beforeAll(async ({ request, baseURL }) => {
  if (!enabled) return
  expect(baseURL).toBe(origin)
  signingKey = await importJWK(f.proofSigningKey, 'RS256')
  const response = await request.get('/api/v1/openapi/customer-portal-v1.json')
  expect(response.status()).toBe(200)
  contract = await response.json()
  expect(contract.info.version).toBe(version)
})

test('the real configured reference client reads and changes only its own live customer with published DTO parity', async () => {
  test.setTimeout(150_000)
  for (const c of f.customers) {
    const read = await runConfiguredCustomerRead(options(c), listPath)
    expect(read).toMatchObject({ status: 200, resultCount: 1, contractVersion: version, errorCode: null })
    expect(read.requestId).toMatch(/^[0-9a-f-]{36}$/i)
    const body = validResponse('GET', listPath, await call(c, 'GET', listPath))
    expect(body.data.map(row => row.notification_reference)).toEqual([c.notificationReference])
    expect(body.data[0].status).toBe('unread')
  }
  const c = f.customers[0], before = snapshot()
  const readBody = { notification_references: [c.notificationReference] }
  const marked = validResponse('POST', readPath, await call(c, 'POST', readPath, readBody, 'reference-notification-read'))
  const once = snapshot()
  expect(marked.data).toMatchObject({ updated_count: 1, notification_references: [c.notificationReference] })
  const replay = validResponse('POST', readPath, await call(c, 'POST', readPath, readBody, 'reference-notification-read'))
  expect(replay.data).toEqual(marked.data)
  expect(snapshot()).toEqual(once)
  const listed = validResponse('GET', listPath, await call(c, 'GET', listPath))
  expect(listed.data[0]).toMatchObject({ notification_reference: c.notificationReference, status: 'read', read_at: marked.data.read_at })
  expect(snapshot().notificationAudits - before.notificationAudits).toBe(1)

  const payload = { profile: { phone: '+46700006001' }, expected_contact_revision: c.baselineRevision }
  const saved = validResponse('POST', profilePath, await call(c, 'POST', profilePath, payload, 'reference-phone-only'))
  expect(saved.data).toMatchObject({ profile_updated: true, contact_revision: c.baselineRevision + 1 })
  assertPhone(c, '+46700006001', c.baselineRevision + 1)
  const afterSave = snapshot()
  expect(validResponse('POST', profilePath, await call(c, 'POST', profilePath, payload, 'reference-phone-only')).data).toEqual(saved.data)
  expect(snapshot()).toEqual(afterSave)
  const me = validResponse('GET', '/api/v1/customer/me', await call(c, 'GET', '/api/v1/customer/me'))
  expect(me.data).toMatchObject({ email: c.email, phone: '+46700006001', contact_revision: c.baselineRevision + 1 })
  expect(JSON.stringify([listed.data, me.data])).not.toMatch(/company_id|customer_id|auth_user_id|metadata|secret_hash/)
  for (const other of f.customers.slice(1)) assertPhone(other, other.baselinePhone, other.baselineRevision)
  expect(snapshot().emailOutbox).toBe(0)
  console.log(`CUSTOMER_REFERENCE_RUNTIME_HTTP_PASS version=${version} actual_client=true actual_next=true actual_db=true authenticated_read_and_write=true notification_effect=1 profile_effect=1 same_key_replay_exact=true served_schema_dto_parity=true preserved_email=true external_sender=0`)
})

test('actual postcommit response loss retries one approved contact effect without another write', async () => {
  test.setTimeout(120_000)
  const c = f.customers[0], payload = { profile: { phone: '+46700006002' }, expected_contact_revision: c.baselineRevision + 1 }
  const before = snapshot()
  let completed = false, proxyFailure = false
  const proxy = createServer(async (incoming, outgoing) => {
    try {
      if (incoming.method !== 'POST' || incoming.url !== profilePath) throw new Error('reference_loss_proxy_path_invalid')
      let body = ''
      for await (const chunk of incoming) { body += chunk; if (Buffer.byteLength(body) > 16_384) throw new Error('reference_loss_proxy_body_excessive') }
      const headers = Object.fromEntries(['authorization', 'content-type', 'idempotency-key', 'x-gridex-customer-number', 'x-gridex-customer-assertion']
        .map(key => [key, incoming.headers[key]]).filter(([, value]) => typeof value === 'string'))
      const upstream = await fetch(`${origin}${profilePath}`, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(45_000) })
      const actualResponse = { status: upstream.status, body: await upstream.json() }
      committedLostResponse = validResponse('POST', profilePath, actualResponse)
      assertPhone(c, '+46700006002', c.baselineRevision + 2)
      expect(snapshot().commands - before.commands).toBe(1)
      completed = true
      // Commit and complete actual Next response have both been witnessed.
      // Destroy the downstream transport without transferring that response.
      outgoing.destroy()
    } catch { proxyFailure = true; outgoing.destroy() }
  })
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve) })
  try {
    const proxyOrigin = `http://127.0.0.1:${proxy.address().port}`
    let lost = false
    try { await delegatedRequest({ ...options(c, { baseUrl: proxyOrigin }), method: 'POST', path: profilePath,
      body: payload, idempotencyKey: 'reference-postcommit-response-loss' }) }
    catch { lost = true }
    expect(lost).toBe(true); expect(proxyFailure).toBe(false); expect(completed).toBe(true)
    const committed = snapshot()
    const retried = validResponse('POST', profilePath, await call(c, 'POST', profilePath, payload, 'reference-postcommit-response-loss'))
    expect(retried.data).toEqual(committedLostResponse.data)
    expect(snapshot()).toEqual(committed)
    expect(committed.commands - before.commands).toBe(1)
    expect(committed.contactAudits - before.contactAudits).toBe(1)
    expect(committed.contactOutbox - before.contactOutbox).toBe(1)
    assertPhone(c, '+46700006002', c.baselineRevision + 2)
    console.log('CUSTOMER_REFERENCE_POSTCOMMIT_RESPONSE_LOSS_HTTP_PASS actual_completed_upstream_response=true actual_db_commit_before_loss=true downstream_socket_destroyed=true same_key_retry=1 contact_effect=1 audit=1 outbox=1 process_crash_not_claimed=true')
  } finally { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)) }
})

test('live tenant/customer mandate and expiry are rechecked before read or completed replay', async () => {
  test.setTimeout(150_000)
  const c = f.customers[0], before = snapshot()
  for (const other of f.customers.slice(1)) {
    const headers = await options(c).signAssertion(`GET ${listPath}`)
    const forged = await call(c, 'GET', listPath, undefined, undefined, {
      customerNumber: other.customerNumber,
      signAssertion: async () => headers,
    })
    denied(forged)
    const wrongWrite = await call(c, 'POST', profilePath, { profile: { phone: '+46700006777' }, expected_contact_revision: other.baselineRevision },
      'reference-wrong-customer', { customerNumber: other.customerNumber })
    denied(wrongWrite)
    expect(snapshot()).toEqual(before)
  }
  const deniedReplay = async (code) => {
    const responses = [await call(c, 'GET', listPath),
      await call(c, 'POST', readPath, { notification_references: [c.notificationReference] }, 'reference-notification-read'),
      await call(c, 'POST', profilePath, { profile: { phone: '+46700006002' }, expected_contact_revision: c.baselineRevision + 1 }, 'reference-postcommit-response-loss')]
    for (const response of responses) { denied(response); if (code) expect(response.body.error.code).toBe(code) }
    expect(snapshot()).toEqual(before)
  }
  localProofSql(`UPDATE public.integration_api_clients SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${proofQuote(c.clientId)}; SELECT to_jsonb(true);`)
  try { await deniedReplay('api_token_expired') }
  finally { localProofSql(`UPDATE public.integration_api_clients SET expires_at=NULL WHERE id=${proofQuote(c.clientId)}; SELECT to_jsonb(true);`) }
  const read = await runConfiguredCustomerRead(options(c))
  expect(read).toMatchObject({ status: 200, resultCount: 1, contractVersion: version, errorCode: null })
  // Portal revocation is intentionally irreversible through ordinary updates.
  // Keep it terminal; neither tests nor production bypass the actual guard.
  localProofSql(`UPDATE public.customer_portal_accounts SET is_active=false WHERE company_id=${proofQuote(c.companyId)} AND customer_id=${proofQuote(c.customerId)} AND user_id=${proofQuote(c.userId)}; SELECT to_jsonb(true);`)
  await deniedReplay()
  localProofSql(`DO $proof$ BEGIN BEGIN UPDATE public.customer_portal_accounts SET is_active=true
    WHERE company_id=${proofQuote(c.companyId)} AND customer_id=${proofQuote(c.customerId)} AND user_id=${proofQuote(c.userId)};
    RAISE EXCEPTION 'reference_expected_portal_reactivation_denied';
    EXCEPTION WHEN check_violation THEN IF SQLERRM<>'customer_portal_account_revoked' THEN RAISE; END IF; END; END $proof$;
    SELECT to_jsonb(is_active) FROM public.customer_portal_accounts WHERE company_id=${proofQuote(c.companyId)} AND customer_id=${proofQuote(c.customerId)} AND user_id=${proofQuote(c.userId)};`)
  expect(localProofSql(`SELECT to_jsonb(is_active) FROM public.customer_portal_accounts WHERE company_id=${proofQuote(c.companyId)} AND customer_id=${proofQuote(c.customerId)} AND user_id=${proofQuote(c.userId)};`)).toBe(false)
  // The exact credential-layer code proves revocation itself is checked before
  // the already inactive account; it is not inferred from a generic403.
  localProofSql(`UPDATE public.integration_api_clients SET revoked_at=clock_timestamp() WHERE id=${proofQuote(c.clientId)}; SELECT to_jsonb(true);`)
  await deniedReplay('api_client_inactive')
  expect(snapshot()).toEqual(before)
  expect(actions).toContain(`POST ${profilePath}`)
  console.log('CUSTOMER_REFERENCE_CURRENT_AUTHORITY_HTTP_PASS actual_client=true same_tenant_other_customer=denied foreign_tenant=denied inactive_account=denied forbidden_reactivation=denied expired_client=denied revoked_client=denied completed_replays=denied persisted_effects_unchanged=true')
})
