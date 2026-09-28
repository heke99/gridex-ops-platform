#!/usr/bin/env node
/**
 * Run: node scripts/tenantservice/customer-api-reference.mjs
 *
 * This is an HTTP client journey against a local synthetic contract fixture.
 * It never connects to Gridex or persists its temporary issuer key. The
 * repository's separate clean replay tests exercise the real Gridex route/DB.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { generateKeyPair, exportJWK, createLocalJWKSet, jwtVerify, SignJWT } from 'jose'

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const subject = 'synthetic-portal-account'
const customerNumber = 'SYN-1001'
const issuer = 'https://issuer.example.test'
const audience = 'gridex-customer-portal'
const apiKey = 'synthetic-backend-only-key'
const contactPath = '/api/v1/customer/profile-update'

export async function delegatedRequest({ baseUrl, method, path, signAssertion, body, idempotencyKey }) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'x-gridex-customer-number': customerNumber,
      'x-gridex-customer-assertion': await signAssertion(`${method} ${path}`),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() }
}

async function syntheticServer(publicKey) {
  const jwk = await exportJWK(publicKey)
  jwk.kid = 'synthetic-issuer-key'
  jwk.alg = 'RS256'
  jwk.use = 'sig'
  const keySet = createLocalJWKSet({ keys: [jwk] })
  const state = { revision: 2, phone: '+46111000000', writes: 0, audit: 0, outbox: 0 }
  const completions = new Map()

  const server = createServer(async (request, response) => {
    const reply = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(data))
    }
    if (request.headers.authorization !== `Bearer ${apiKey}` ||
        request.headers['x-gridex-customer-number'] !== customerNumber) {
      reply(403, { error: { code: 'customer_delegation_required' } })
      return
    }
    try {
      const { payload } = await jwtVerify(request.headers['x-gridex-customer-assertion'], keySet, {
        algorithms: ['RS256'], issuer, audience, maxTokenAge: '5m',
      })
      if (payload.sub !== subject || payload.company_id !== tenantId ||
          payload.api_client_id !== clientId || payload.customer_id !== customerId ||
          payload.action !== `${request.method} ${request.url}`) throw new Error('Wrong customer action')
    } catch {
      reply(403, { error: { code: 'customer_delegation_required' } })
      return
    }

    if (request.method === 'GET' && request.url === '/api/v1/customer/me') {
      reply(200, { data: { customer_number: customerNumber, contact_revision: state.revision, phone: state.phone } })
      return
    }
    if (request.method !== 'POST' || request.url !== contactPath) {
      reply(404, { error: { code: 'resource_not_found' } })
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
      reply(400, { error: { code: 'invalid_json' } })
      return
    }
    const key = request.headers['idempotency-key']
    if (!key || !body?.profile?.phone || Object.keys(body.profile).length !== 1 ||
        !Number.isSafeInteger(body.expected_contact_revision)) {
      reply(422, { error: { code: 'validation_failed' } })
      return
    }
    const hash = JSON.stringify(body)
    const previous = completions.get(key)
    if (previous) {
      if (previous.hash !== hash) reply(409, { error: { code: 'contact_idempotency_conflict' } })
      else reply(200, previous.result)
      return
    }
    if (body.expected_contact_revision !== state.revision) {
      reply(409, { error: { code: 'contact_revision_conflict' } })
      return
    }
    state.revision += 1
    state.phone = body.profile.phone
    state.writes += 1
    state.audit += 1
    state.outbox += 1
    const result = { data: {
      completion_reference: 'synthetic-completion-1', status: 'accepted',
      created_at: '2026-09-29T00:00:00.000Z', profile_updated: true,
      contact_revision: state.revision, facility_updated: false, address_result: null,
    } }
    completions.set(key, { hash, result })
    reply(200, result)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, state }
}

export async function runSyntheticCustomerJourney() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const signAssertion = (action) => new SignJWT({
    company_id: tenantId, api_client_id: clientId, customer_id: customerId, action,
  }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic-issuer-key' })
    .setIssuer(issuer).setAudience(audience).setSubject(subject)
    .setIssuedAt().setExpirationTime('2m').sign(privateKey)
  const { server, baseUrl, state } = await syntheticServer(publicKey)
  const call = (method, path, body, idempotencyKey) => delegatedRequest({
    baseUrl, method, path, body, idempotencyKey, signAssertion,
  })
  try {
    const before = await call('GET', '/api/v1/customer/me')
    assert.equal(before.status, 200)
    const revision = before.body.data.contact_revision
    const body = { profile: { phone: '+46123456789' }, expected_contact_revision: revision }
    const first = await call('POST', contactPath, body, 'synthetic-contact-1')
    assert.equal(first.status, 200)
    assert.equal(first.body.data.contact_revision, revision + 1)
    const stale = await call('POST', contactPath, { profile: { phone: '+46123450000' }, expected_contact_revision: revision }, 'synthetic-contact-2')
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error.code, 'contact_revision_conflict')
    const replay = await call('POST', contactPath, body, 'synthetic-contact-1')
    assert.equal(replay.status, 200)
    assert.deepEqual(replay.body.data, first.body.data)
    const changedKey = await call('POST', contactPath, { ...body, profile: { phone: '+46123450000' } }, 'synthetic-contact-1')
    assert.equal(changedKey.status, 409)
    assert.equal(changedKey.body.error.code, 'contact_idempotency_conflict')
    const after = await call('GET', '/api/v1/customer/me')
    assert.equal(after.body.data.phone, '+46123456789')
    assert.equal(after.body.data.contact_revision, revision + 1)
    assert.deepEqual({ writes: state.writes, audit: state.audit, outbox: state.outbox }, {
      writes: 1, audit: 1, outbox: 1,
    })
    return { revisionBefore: revision, revisionAfter: state.revision, stale: stale.status,
      replay: replay.status, changedKey: changedKey.status, writes: state.writes }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runSyntheticCustomerJourney().then((result) => {
    console.log('Synthetic delegated customer journey passed:', JSON.stringify(result))
  }).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
