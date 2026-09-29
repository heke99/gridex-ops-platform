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
const invoiceReference = `invoice_${'e'.repeat(32)}`
const documentReference = `document_${'h'.repeat(32)}`
const notificationReference = `notification_${'j'.repeat(32)}`
const syntheticInvoice = (reference, number, status, amount) => ({
  invoice_reference: reference, invoice_number: number,
  period_start: null, period_end: null, total_kwh: null,
  amount_ex_vat: null, vat_amount: null, amount_inc_vat: amount,
  currency: 'SEK', issued_at: null, due_date: null, paid_at: null,
  status, created_at: '2026-09-29T00:00:00Z',
})

export async function delegatedRequest({ baseUrl, method, path, signAssertion, body, idempotencyKey }) {
  const pathname = new URL(path, baseUrl).pathname
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'x-gridex-customer-number': customerNumber,
      'x-gridex-customer-assertion': await signAssertion(`${method} ${pathname}`),
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
  const state = { revision: 2, phone: '+46111000000', writes: 0, audit: 0, outbox: 0,
    notificationReads: 0, notificationReadAt: null }
  const completions = new Map()
  const notificationCompletions = new Map()

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
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
          payload.action !== `${request.method} ${url.pathname}`) throw new Error('Wrong customer action')
    } catch {
      reply(403, { error: { code: 'customer_delegation_required' } })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/customer/me') {
      reply(200, { data: { customer_number: customerNumber, contact_revision: state.revision, phone: state.phone } })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/customer/contracts') {
      const cursor = url.searchParams.get('cursor')
      if (cursor && cursor !== 'synthetic-next-contract') {
        reply(400, { error: { code: 'invalid_cursor', field: 'cursor' } })
        return
      }
      reply(200, {
        data: [{
          contract_reference: `contract_${(cursor ? 'b' : 'a').repeat(32)}`,
          contract_number: null, offer_reference: null, contract_name: null, contract_type: null,
          energy_direction: 'consumption', status: cursor ? 'active' : null,
          start_date: null, end_date: null, signed_at: null, withdrawal_deadline_at: null,
          signature_snapshot_sha256: null, price_area: null, monthly_fee_sek: null,
          invoice_fee_sek: null, fixed_price_ore_per_kwh: null, markup_ore_per_kwh: null,
          binding_months: null, notice_months: null, auto_renew_enabled: false,
          created_at: '2026-09-28T00:00:00Z',
        }],
        page: { limit: 1, offset: 0, returned: 1, has_more: !cursor,
          next_cursor: cursor ? null : 'synthetic-next-contract' },
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/customer/sites') {
      reply(200, {
        data: {
          sites: [{ facility_reference: `facility_${'c'.repeat(32)}`, facility_id: null,
            status: null, name: 'Synthetic site', facility_type: null,
            address: { street: null, care_of: null, postal_code: null, city: 'Stockholm', country: 'SE' },
            price_area: null, grid_area_code: null, move_in_date: null, move_out_date: null,
            annual_consumption_kwh: null, created_at: '2026-09-28T00:00:00Z' }],
          metering_points: [{ metering_point_reference: `metering_point_${'d'.repeat(32)}`,
            facility_reference: `facility_${'c'.repeat(32)}`, metering_point_id: '735999000000000001',
            facility_id: null, status: null, metering_type: null, resolution: null,
            price_area: null, grid_area_code: null, start_date: null, end_date: null,
            verification_status: null, created_at: null }],
        },
        page: { sites: { limit: 1, offset: 0, returned: 1, has_more: false, next_cursor: null } },
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/customer/metering-values') {
      const cursor = url.searchParams.get('cursor')
      const from = url.searchParams.get('from')
      const facility = url.searchParams.get('facility_id')
      if (cursor && cursor !== 'synthetic-next-metering') {
        reply(400, { error: { code: 'invalid_cursor', field: 'cursor' } })
        return
      }
      if (from !== '2026-09-01T00:00:00Z' || facility !== '735999000000000001') {
        reply(400, { error: { code: 'invalid_time_filter' } })
        return
      }
      reply(200, {
        data: [{
          metering_value_reference: `metering_value_${(cursor ? 'p' : 'q').repeat(32)}`,
          metering_point_reference: `metering_point_${'d'.repeat(32)}`,
          period_start: cursor ? '2026-09-28T23:00:00Z' : '2026-09-29T00:00:00Z',
          period_end: cursor ? '2026-09-29T00:00:00Z' : '2026-09-29T01:00:00Z',
          resolution: 'hourly', quantity_kwh: cursor ? null : 1.25,
          quality_status: null, status: 'stored', created_at: '2026-09-29T01:00:00Z',
        }],
        page: { limit: 1, offset: 0, returned: 1, has_more: !cursor,
          next_cursor: cursor ? null : 'synthetic-next-metering' },
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/customer/legal-acceptances') {
      const cursor = url.searchParams.get('cursor')
      if (cursor && cursor !== 'synthetic-next-legal') {
        reply(400, { error: { code: 'invalid_cursor', field: 'cursor' } })
        return
      }
      reply(200, {
        data: [{ acceptance_reference: `acceptance_${(cursor ? 'r' : 's').repeat(32)}`,
          acceptance_type: 'terms',
          document_reference: cursor ? null : `legal_document_${'t'.repeat(32)}`,
          document_code: cursor ? null : 'terms', document_version: cursor ? null : '1',
          document_hash: cursor ? null : 'a'.repeat(64),
          accepted_at: '2026-09-29T00:00:00Z', source: cursor ? null : 'portal',
          created_at: '2026-09-29T00:00:00Z' }],
        page: { limit: 1, offset: 0, returned: 1, has_more: !cursor,
          next_cursor: cursor ? null : 'synthetic-next-legal' },
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/customer/invoices') {
      const cursor = url.searchParams.get('cursor')
      if (cursor && cursor !== 'synthetic-next-invoice') {
        reply(400, { error: { code: 'invalid_cursor', field: 'cursor' } })
        return
      }
      reply(200, {
        data: [cursor
          ? syntheticInvoice(`invoice_${'f'.repeat(32)}`, 'SYN-INV-2', 'paid', 125)
          : syntheticInvoice(invoiceReference, 'SYN-INV-1', 'issued', null)],
        page: { limit: 1, offset: 0, returned: 1, has_more: !cursor,
          next_cursor: cursor ? null : 'synthetic-next-invoice' },
      })
      return
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/v1/customer/invoices/')) {
      if (url.pathname !== `/api/v1/customer/invoices/${invoiceReference}`) {
        reply(404, { error: { code: 'invoice_not_found' } })
        return
      }
      reply(200, { data: {
        invoice: syntheticInvoice(invoiceReference, 'SYN-INV-1', 'issued', null),
        lines: [{ line_reference: `invoice_line_${'g'.repeat(32)}`,
          description: 'Synthetic energy', quantity: null, unit_price: null,
          amount_ex_vat: null, vat_amount: null, amount_inc_vat: 15,
          created_at: '2026-09-29T00:00:00Z' }],
        documents: [{ document_reference: `document_${'h'.repeat(32)}`,
          document_type: 'invoice', title: 'Synthetic invoice', file_name: null,
          mime_type: null, file_size_bytes: null, status: null,
          secure_url: null, version: null, created_at: '2026-09-29T00:00:00Z' }],
      } })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/customer/documents') {
      const cursor = url.searchParams.get('cursor')
      if (cursor && cursor !== 'synthetic-next-document') {
        reply(400, { error: { code: 'invalid_cursor', field: 'cursor' } })
        return
      }
      reply(200, {
        data: [{
          document_reference: cursor ? `document_${'i'.repeat(32)}` : documentReference,
          document_type: cursor ? 'power_of_attorney' : 'agreement',
          title: cursor ? 'Synthetic authorization' : 'Synthetic agreement',
          file_name: null, mime_type: null, file_size_bytes: null,
          status: cursor ? 'signed' : 'published', secure_url: null, version: null,
          created_at: '2026-09-29T00:00:00Z',
        }],
        page: { limit: 1, offset: 0, returned: 1, has_more: !cursor,
          next_cursor: cursor ? null : 'synthetic-next-document' },
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/customer/events') {
      const cursor = url.searchParams.get('cursor')
      if (cursor && cursor !== 'synthetic-next-event') {
        reply(400, { error: { code: 'invalid_cursor', field: 'cursor' } })
        return
      }
      reply(200, {
        data: [{ event_reference: `event_${(cursor ? 'm' : 'l').repeat(32)}`,
          event_type: cursor ? 'invoice.issued' : 'contact.updated', event_version: null,
          occurred_at: '2026-09-29T00:00:00Z', source: 'tenant' }],
        page: { limit: 1, offset: 0, returned: 1, has_more: !cursor,
          next_cursor: cursor ? null : 'synthetic-next-event' },
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/customer/powers-of-attorney') {
      const cursor = url.searchParams.get('cursor')
      if (cursor && cursor !== 'synthetic-next-authority') {
        reply(400, { error: { code: 'invalid_cursor', field: 'cursor' } })
        return
      }
      reply(200, {
        data: [{ power_of_attorney_reference: `power_of_attorney_${(cursor ? 'o' : 'n').repeat(32)}`,
          contract_reference: null, facility_reference: null,
          scope: 'metering', status: cursor ? 'expired' : 'active',
          signed_at: null, accepted_at: null, valid_from: null,
          valid_to: cursor ? '2026-09-28T00:00:00Z' : '2026-10-29T00:00:00Z',
          created_at: '2026-09-29T00:00:00Z' }],
        page: { limit: 1, offset: 0, returned: 1, has_more: !cursor,
          next_cursor: cursor ? null : 'synthetic-next-authority' },
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/customer/notifications') {
      const cursor = url.searchParams.get('cursor')
      if (cursor && cursor !== 'synthetic-next-notification') {
        reply(400, { error: { code: 'invalid_cursor', field: 'cursor' } })
        return
      }
      reply(200, {
        data: [{
          notification_reference: cursor ? `notification_${'k'.repeat(32)}` : notificationReference,
          type: 'info', title: cursor ? 'Synthetic update' : 'Synthetic notice',
          message: null, status: cursor ? 'unread' : state.notificationReadAt ? 'read' : 'unread',
          read_at: cursor ? null : state.notificationReadAt, created_at: '2026-09-29T00:00:00Z',
        }],
        page: { limit: 1, offset: 0, returned: 1, has_more: !cursor,
          next_cursor: cursor ? null : 'synthetic-next-notification' },
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/customer/notifications/read') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
        reply(400, { error: { code: 'invalid_json' } })
        return
      }
      const refs = body?.notification_references
      const key = request.headers['idempotency-key']
      if (!key || !Array.isArray(refs) || refs.length === 0 || refs.length > 100 ||
          Object.keys(body).some((field) => field !== 'notification_references') ||
          refs.some((ref) => typeof ref !== 'string') || new Set(refs).size !== refs.length) {
        reply(422, { error: { code: 'notification_reference_invalid' } })
        return
      }
      const hash = JSON.stringify(body)
      const previous = notificationCompletions.get(key)
      if (previous) {
        reply(previous.hash === hash ? 200 : 409, previous.hash === hash
          ? previous.result : { error: { code: 'idempotency_conflict' } })
        return
      }
      if (refs.some((ref) => ref !== notificationReference)) {
        reply(404, { error: { code: 'notification_reference_not_found' } })
        return
      }
      const updatedCount = state.notificationReadAt ? 0 : 1
      state.notificationReads += updatedCount
      state.notificationReadAt ??= '2026-09-29T00:00:00Z'
      const result = { data: { updated_count: updatedCount, notification_references: refs,
        read_at: '2026-09-29T00:00:00Z' } }
      notificationCompletions.set(key, { hash, result })
      reply(200, result)
      return
    }
    if (request.method !== 'POST' || url.pathname !== contactPath) {
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
    const contracts = await call('GET', '/api/v1/customer/contracts?limit=1')
    assert.equal(contracts.status, 200)
    assert.equal(contracts.body.data[0].status, null)
    assert.equal(contracts.body.page.has_more, true)
    const nextContracts = await call('GET', `/api/v1/customer/contracts?limit=1&cursor=${contracts.body.page.next_cursor}`)
    assert.equal(nextContracts.status, 200)
    assert.equal(nextContracts.body.data[0].status, 'active')
    assert.equal(nextContracts.body.page.has_more, false)
    const sites = await call('GET', '/api/v1/customer/sites?limit=1')
    assert.equal(sites.status, 200)
    assert.equal(sites.body.data.sites.length, 1)
    assert.equal(sites.body.data.metering_points[0].metering_point_id, '735999000000000001')
    assert.equal(sites.body.page.sites.returned, 1)
    const meteringPath = '/api/v1/customer/metering-values?from=2026-09-01T00%3A00%3A00Z&facility_id=735999000000000001&limit=1'
    const metering = await call('GET', meteringPath)
    assert.equal(metering.status, 200)
    assert.equal(metering.body.data[0].quantity_kwh, 1.25)
    assert.equal(metering.body.page.has_more, true)
    const nextMetering = await call('GET', `${meteringPath}&cursor=${metering.body.page.next_cursor}`)
    assert.equal(nextMetering.status, 200)
    assert.equal(nextMetering.body.data[0].quantity_kwh, null)
    assert.equal(nextMetering.body.page.has_more, false)
    const badMeteringCursor = await call('GET', `${meteringPath}&cursor=foreign-customer-cursor`)
    assert.equal(badMeteringCursor.status, 400)
    assert.equal(badMeteringCursor.body.error.code, 'invalid_cursor')
    const legalPath = '/api/v1/customer/legal-acceptances?limit=1'
    const legalFields = ['acceptance_reference', 'acceptance_type', 'document_reference',
      'document_code', 'document_version', 'document_hash', 'accepted_at', 'source', 'created_at']
    const legal = await call('GET', legalPath)
    assert.equal(legal.status, 200)
    assert.deepEqual(Object.keys(legal.body.data[0]).sort(), [...legalFields].sort())
    assert.match(legal.body.data[0].acceptance_reference, /^acceptance_[A-Za-z0-9_-]{32}$/)
    assert.match(legal.body.data[0].document_reference, /^legal_document_[A-Za-z0-9_-]{32}$/)
    assert.equal(legal.body.data[0].document_code, 'terms')
    assert.equal(legal.body.data[0].document_version, '1')
    assert.equal(legal.body.data[0].document_hash, 'a'.repeat(64))
    assert.equal(legal.body.data[0].source, 'portal')
    assert.equal(legal.body.page.has_more, true)
    const nextLegal = await call('GET', `${legalPath}&cursor=${legal.body.page.next_cursor}`)
    assert.equal(nextLegal.status, 200)
    assert.deepEqual(Object.keys(nextLegal.body.data[0]).sort(), [...legalFields].sort())
    assert.notEqual(nextLegal.body.data[0].acceptance_reference, legal.body.data[0].acceptance_reference)
    for (const field of ['document_reference', 'document_code', 'document_version', 'document_hash', 'source']) {
      assert.equal(nextLegal.body.data[0][field], null)
    }
    assert.equal(nextLegal.body.page.has_more, false)
    assert.equal(nextLegal.body.page.next_cursor, null)
    assert.doesNotMatch(JSON.stringify([legal.body.data, nextLegal.body.data]), /snapshot|metadata|customer_id|company_id|contract_id|signature|request_id|trace_id/)
    const foreignLegalCursor = await call('GET', `${legalPath}&cursor=foreign-customer-cursor`)
    assert.equal(foreignLegalCursor.status, 400)
    assert.equal(foreignLegalCursor.body.error.code, 'invalid_cursor')
    const wrongLegalAction = await delegatedRequest({ baseUrl, method: 'GET', path: legalPath,
      signAssertion: () => signAssertion('GET /api/v1/customer/events') })
    assert.equal(wrongLegalAction.status, 403)
    assert.equal(wrongLegalAction.body.error.code, 'customer_delegation_required')
    const invoices = await call('GET', '/api/v1/customer/invoices?limit=1')
    assert.equal(invoices.status, 200)
    assert.equal(invoices.body.data[0].invoice_reference, invoiceReference)
    assert.equal(invoices.body.data[0].amount_inc_vat, null)
    assert.equal(invoices.body.page.has_more, true)
    const nextInvoices = await call('GET', `/api/v1/customer/invoices?limit=1&cursor=${invoices.body.page.next_cursor}`)
    assert.equal(nextInvoices.status, 200)
    assert.equal(nextInvoices.body.data[0].status, 'paid')
    assert.equal(nextInvoices.body.page.has_more, false)
    const invoice = await call('GET', `/api/v1/customer/invoices/${invoiceReference}`)
    assert.equal(invoice.status, 200)
    assert.equal(invoice.body.data.invoice.invoice_reference, invoices.body.data[0].invoice_reference)
    assert.equal(invoice.body.data.lines.length, 1)
    assert.equal(invoice.body.data.documents.length, 1)
    const foreignInvoice = await call('GET', `/api/v1/customer/invoices/invoice_${'z'.repeat(32)}`)
    assert.equal(foreignInvoice.status, 404)
    assert.equal(foreignInvoice.body.error.code, 'invoice_not_found')
    const documents = await call('GET', '/api/v1/customer/documents?limit=1')
    assert.equal(documents.status, 200)
    assert.equal(documents.body.data[0].document_reference, documentReference)
    assert.equal(documents.body.data[0].secure_url, null)
    assert.equal(documents.body.page.has_more, true)
    const nextDocuments = await call('GET', `/api/v1/customer/documents?limit=1&cursor=${documents.body.page.next_cursor}`)
    assert.equal(nextDocuments.status, 200)
    assert.equal(nextDocuments.body.data[0].document_type, 'power_of_attorney')
    assert.equal(nextDocuments.body.page.has_more, false)
    const events = await call('GET', '/api/v1/customer/events?limit=1')
    assert.equal(events.status, 200)
    assert.match(events.body.data[0].event_reference, /^event_[A-Za-z0-9_-]{32}$/)
    assert.equal(events.body.data[0].event_version, null)
    assert.equal(events.body.page.has_more, true)
    const nextEvents = await call('GET', `/api/v1/customer/events?limit=1&cursor=${events.body.page.next_cursor}`)
    assert.equal(nextEvents.status, 200)
    assert.equal(nextEvents.body.data[0].event_type, 'invoice.issued')
    assert.equal(nextEvents.body.page.has_more, false)
    const authorities = await call('GET', '/api/v1/customer/powers-of-attorney?limit=1')
    assert.equal(authorities.status, 200)
    assert.match(authorities.body.data[0].power_of_attorney_reference, /^power_of_attorney_[A-Za-z0-9_-]{32}$/)
    assert.equal(authorities.body.data[0].contract_reference, null)
    assert.equal(authorities.body.page.has_more, true)
    const nextAuthorities = await call('GET', `/api/v1/customer/powers-of-attorney?limit=1&cursor=${authorities.body.page.next_cursor}`)
    assert.equal(nextAuthorities.status, 200)
    assert.equal(nextAuthorities.body.data[0].status, 'expired')
    assert.equal(nextAuthorities.body.page.has_more, false)
    const foreignEventCursor = await call('GET', '/api/v1/customer/events?cursor=foreign-customer-cursor')
    assert.equal(foreignEventCursor.status, 400)
    assert.equal(foreignEventCursor.body.error.code, 'invalid_cursor')
    const notifications = await call('GET', '/api/v1/customer/notifications?limit=1')
    assert.equal(notifications.status, 200)
    assert.equal(notifications.body.data[0].notification_reference, notificationReference)
    assert.equal(notifications.body.page.has_more, true)
    const nextNotifications = await call('GET', `/api/v1/customer/notifications?limit=1&cursor=${notifications.body.page.next_cursor}`)
    assert.equal(nextNotifications.status, 200)
    assert.equal(nextNotifications.body.page.has_more, false)
    const markRead = await call('POST', '/api/v1/customer/notifications/read',
      { notification_references: [notifications.body.data[0].notification_reference] }, 'synthetic-notification-read-1')
    assert.equal(markRead.status, 200)
    assert.equal(markRead.body.data.updated_count, 1)
    const readReplay = await call('POST', '/api/v1/customer/notifications/read',
      { notification_references: [notifications.body.data[0].notification_reference] }, 'synthetic-notification-read-1')
    assert.deepEqual(readReplay.body, markRead.body)
    const readBack = await call('GET', '/api/v1/customer/notifications?limit=1')
    assert.equal(readBack.body.data[0].status, 'read')
    assert.equal(readBack.body.data[0].read_at, markRead.body.data.read_at)
    const readAgain = await call('POST', '/api/v1/customer/notifications/read',
      { notification_references: [notificationReference] }, 'synthetic-notification-read-again')
    assert.equal(readAgain.status, 200)
    assert.equal(readAgain.body.data.updated_count, 0)
    assert.equal(state.notificationReadAt, readBack.body.data[0].read_at)
    const unknownNotification = await call('POST', '/api/v1/customer/notifications/read',
      { notification_references: [`notification_${'z'.repeat(32)}`] }, 'synthetic-notification-read-2')
    assert.equal(unknownNotification.status, 404)
    assert.equal(unknownNotification.body.error.code, 'notification_reference_not_found')
    const badNotification = await call('POST', '/api/v1/customer/notifications/read',
      { notification_references: [notificationReference, notificationReference] }, 'synthetic-notification-read-3')
    assert.equal(badNotification.status, 422)
    const foreignCursor = await call('GET', '/api/v1/customer/contracts?cursor=foreign-customer-cursor')
    assert.equal(foreignCursor.status, 400)
    assert.equal(foreignCursor.body.error.code, 'invalid_cursor')
    const wrongAction = await delegatedRequest({ baseUrl, method: 'GET', path: '/api/v1/customer/sites',
      signAssertion: () => signAssertion('GET /api/v1/customer/me') })
    assert.equal(wrongAction.status, 403)
    assert.equal(state.notificationReads, 1)
    assert.deepEqual({ writes: state.writes, audit: state.audit, outbox: state.outbox }, {
      writes: 1, audit: 1, outbox: 1,
    })
    return { revisionBefore: revision, revisionAfter: state.revision, stale: stale.status,
      replay: replay.status, changedKey: changedKey.status, writes: state.writes,
      contractPages: 2, sites: sites.body.data.sites.length, meteringPages: 2,
      foreignMeteringCursor: badMeteringCursor.status, legalPages: 2,
      foreignLegalCursor: foreignLegalCursor.status, wrongLegalAction: wrongLegalAction.status,
      invoicePages: 2,
      invoiceDetail: invoice.status, foreignInvoice: foreignInvoice.status,
      documentPages: 2, notificationPages: 2, notificationRead: markRead.status,
      notificationReplay: readReplay.status, readAgainCount: readAgain.body.data.updated_count,
      unknownNotification: unknownNotification.status,
      eventPages: 2, authorityPages: 2, foreignEventCursor: foreignEventCursor.status,
      wrongAction: wrongAction.status }
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
