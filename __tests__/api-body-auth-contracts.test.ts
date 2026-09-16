import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => {
  type DbResult = { data: unknown; error: null | { code?: string; message: string } }
  type DbCall = {
    table: string
    operation: 'select' | 'insert' | 'update' | 'upsert'
    payload: unknown
    filters: Record<string, unknown>
  }
  type Query = PromiseLike<DbResult> & {
    select: (columns?: string) => Query
    insert: (payload: unknown) => Query
    update: (payload: unknown) => Query
    upsert: (payload: unknown, options?: unknown) => Query
    eq: (column: string, value: unknown) => Query
    is: (column: string, value: unknown) => Query
    ilike: (column: string, value: unknown) => Query
    limit: (count: number) => Query
    order: (column: string, options?: unknown) => Query
    maybeSingle: () => Promise<DbResult>
  }

  const state = {
    authOutcome: 'allowed' as 'allowed' | 'denied' | 'rate_limited',
    authCount: 20,
    authLimit: 20,
    dbCalls: [] as DbCall[],
    rpcCalls: [] as Array<{ name: string; input: Record<string, unknown> }>,
    workerCalls: [] as Array<{ worker: string; input: unknown }>,
    inboundCalls: [] as unknown[],
  }

  function resultFor(call: DbCall): DbResult {
    state.dbCalls.push({ ...call, filters: { ...call.filters } })
    if (call.table === 'platform_runtime_readiness') {
      return {
        data: {
          is_ready: true,
          schema_version: '20260803093300-gridex-runtime-readiness-v3',
          schema_fingerprint: 'a'.repeat(64),
          blocking_issues: [],
          capabilities: {},
        },
        error: null,
      }
    }
    if (call.table === 'customer_portal_write_idempotency') {
      return { data: { id: 'idem-1' }, error: null }
    }
    if (call.table === 'invoice_export_items') {
      return {
        data: [{ id: 'item-1', company_id: 'company-A', environment: 'test', provider: 'capway', provider_invoice_guid: 'invoice-guid-1' }],
        error: null,
      }
    }
    if (call.table === 'billing_provider_connections') {
      return {
        data: [{ id: 'connection-1', company_id: 'company-A', environment: 'test', provider: 'capway', status: 'active', secret_reference: { webhook_secret_env: 'TEST_BILLING_WEBHOOK_SECRET' } }],
        error: null,
      }
    }
    if (call.table === 'billing_provider_webhook_events' || call.table === 'invoice_provider_events') {
      return { data: { id: `${call.table}-1` }, error: null }
    }
    if (call.table === 'manual_communication_mailboxes') {
      return { data: [{ id: 'mailbox-1', company_id: 'company-A' }], error: null }
    }
    if (call.table === 'user_profiles') return { data: null, error: null }
    if (call.table === 'company_memberships') return { data: { id: 'membership-1' }, error: null }
    if (call.table === 'communication_logs' || call.table === 'manual_email_outbox') {
      return { data: null, error: null }
    }
    if (call.table === 'communication_log_events' && call.operation === 'select') {
      return { data: null, error: null }
    }
    if (call.table === 'companies') return { data: { id: String(call.filters.id) }, error: null }
    return { data: null, error: null }
  }

  const from = vi.fn((table: string): Query => {
    const call: DbCall = { table, operation: 'select', payload: null, filters: {} }
    const query: Query = {
      select: () => query,
      insert: (payload) => { call.operation = 'insert'; call.payload = payload; return query },
      update: (payload) => { call.operation = 'update'; call.payload = payload; return query },
      upsert: (payload) => { call.operation = 'upsert'; call.payload = payload; return query },
      eq: (column, value) => { call.filters[column] = value; return query },
      is: (column, value) => { call.filters[column] = value; return query },
      ilike: (column, value) => { call.filters[column] = value; return query },
      limit: () => query,
      order: () => query,
      maybeSingle: async () => resultFor(call),
      then: <TResult1 = DbResult, TResult2 = never>(
        onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(resultFor(call)).then(onfulfilled, onrejected),
    }
    return query
  })

  const rpc = vi.fn(async (name: string, input: Record<string, unknown>): Promise<DbResult> => {
    state.rpcCalls.push({ name, input })
    if (name === 'authenticate_integration_request_v1') {
      const allowed = state.authOutcome === 'allowed'
      return {
        data: {
          auth_outcome: allowed ? 'allowed' : state.authOutcome === 'rate_limited' ? 'rate_limited' : 'denied',
          error_code: allowed ? null : state.authOutcome === 'rate_limited' ? 'rate_limited' : 'api_scope_missing',
          tenant_status: 'active', client_id: 'client-A', company_id: 'company-A',
          client_name: 'Client A', client_status: 'active', key_prefix: 'prefix', secret_hash: 'hash',
          scopes: ['partner_webhooks.manage', 'website_quotes.write'], allowed_ips: [], allowed_origins: [],
          metadata: {}, rate_limit_per_minute: state.authLimit, expires_at: null,
          request_count: state.authCount, route_limit: state.authLimit,
          reset_at: new Date(Date.now() + 60_000).toISOString(),
        },
        error: null,
      }
    }
    if (name === 'gridex_create_partner_webhook_subscription_v1') {
      return { data: { webhook_subscription_reference: 'webhook-reference-1' }, error: null }
    }
    return { data: null, error: null }
  })

  const getUserById = vi.fn(async (userId: string) => ({
    data: { user: { id: userId } },
    error: null,
  }))

  function worker(name: string, result: unknown) {
    return vi.fn(async (input: unknown) => {
      state.workerCalls.push({ worker: name, input })
      return result
    })
  }

  return {
    state,
    from,
    rpc,
    getUserById,
    tenantWorker: worker('tenant', { scanned: 0, claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, errors: [] }),
    manualWorker: worker('manual', { scanned: 0, claimed: 0, sent: 0, failed: 0, skipped: 0, errors: [] }),
    edielWorker: worker('ediel', { scanned: 0, claimed: 0, sent: 0, failed: 0, skipped: 0, errors: [] }),
    inbound: vi.fn(async (input: unknown) => { state.inboundCalls.push(input); return { status: 'created' } }),
    pendingEvents: vi.fn(async () => ({ processed: 1 })),
    emitEvent: vi.fn(async () => ({ id: 'event-1' })),
  }
})

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '8.8.8.8', family: 4 }] }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: io.from,
    rpc: io.rpc,
    auth: { admin: { getUserById: io.getUserById } },
  },
}))
vi.mock('@/lib/email/emailOutbox', () => ({ processTenantEmailOutbox: io.tenantWorker }))
vi.mock('@/lib/email/manualEmailOutbox', () => ({ processManualEmailOutbox: io.manualWorker }))
vi.mock('@/lib/ediel/outbox/processEdielOutbox', () => ({ processEdielOutbox: io.edielWorker }))
vi.mock('@/lib/inbound-mail/manualInboundIngestion', () => ({ ingestManualInboundEmail: io.inbound }))
vi.mock('@/lib/billing/providerEventProcessor', () => ({ processPendingInvoiceProviderEvents: io.pendingEvents }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: io.emitEvent }))
vi.mock('@/lib/email/communicationLogs', () => ({
  markCommunicationBounced: async () => undefined,
  markCommunicationDelivered: async () => undefined,
  markCommunicationComplained: async () => undefined,
  markCommunicationFailed: async () => undefined,
  markCommunicationSent: async () => ({ id: 'log-1' }),
}))
vi.mock('@/lib/email/emailDomainEvents', () => ({ emitCommunicationSentDomainEvents: async () => undefined }))

import { POST as partnerPost } from '@/app/api/partner/v1/[[...path]]/route'
import { POST as billingPost } from '@/app/api/webhooks/billing/[provider]/route'
import { POST as manualInboundPost } from '@/app/api/webhooks/manual-inbound/route'
import { POST as resendPost } from '@/app/api/webhooks/resend/route'
import { GET as tenantGet, POST as tenantPost } from '@/app/api/internal/email/outbox/process/route'
import { GET as manualGet, POST as manualPost } from '@/app/api/internal/manual-email/outbox/process/route'
import { GET as edielGet, POST as edielPost } from '@/app/api/ediel/outbox/process/route'
import { POST as edielCompanyPost } from '@/app/api/ediel/outbox/process-company/route'
import { PARTNER_API_VERSION } from '@/lib/partner-api/openApi'

const encoder = new TextEncoder()
const EDIEL_ACTOR_ID = '00000000-0000-4000-8000-000000000001'

type Streamed = { request: Request; pulls: () => number; cancels: () => number }

function streamRequest(input: {
  url: string
  raw: string
  headers?: Record<string, string>
  contentLength?: string
  chunkBytes?: number
  firstChunkBytes?: number
}): Streamed {
  const bytes = encoder.encode(input.raw)
  let offset = 0
  let pulls = 0
  let cancels = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1
      if (offset >= bytes.byteLength) return controller.close()
      const nextBytes = offset === 0 && input.firstChunkBytes !== undefined
        ? input.firstChunkBytes
        : input.chunkBytes ?? 1024
      const end = Math.min(offset + nextBytes, bytes.byteLength)
      controller.enqueue(bytes.slice(offset, end))
      offset = end
    },
    cancel() { cancels += 1 },
  }, { highWaterMark: 0 })
  const request = new Request(input.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(input.headers ?? {}),
      ...(input.contentLength === undefined ? {} : { 'content-length': input.contentLength }),
    },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  Object.defineProperty(request, 'nextUrl', { value: new URL(request.url) })
  return { request, pulls: () => pulls, cancels: () => cancels }
}

function jsonAtBytes(base: Record<string, unknown>, bytes: number): string {
  const empty = JSON.stringify({ ...base, padding: '' })
  const missing = bytes - encoder.encode(empty).byteLength
  if (missing < 0) throw new Error('fixture base exceeds requested size')
  const raw = JSON.stringify({ ...base, padding: 'x'.repeat(missing) })
  expect(encoder.encode(raw).byteLength).toBe(bytes)
  return raw
}

function noncanonicalResendRawAtBytes(bytes: number): string {
  const prefix = `{
  "type" : "email.sent",
  "created_at" : "2026-09-12T10:00:00.000Z",
  "data" : {
    "email_id" : "email-noncanonical-${bytes}",
    "from" : "ops@example.test",
    "to" : [ "customer@example.test" ],
    "subject" : "Å🙂",
    "padding" : "`
  const suffix = `"
  }
}
`
  const paddingBytes = bytes - encoder.encode(prefix + suffix).byteLength
  if (paddingBytes < 0) throw new Error('fixture base exceeds requested size')
  const raw = `${prefix}${'x'.repeat(paddingBytes)}${suffix}`
  expect(encoder.encode(raw).byteLength).toBe(bytes)
  return raw
}

function splitInsideUtf8(raw: string, marker: string): number {
  const characterIndex = raw.indexOf(marker)
  if (characterIndex < 0) throw new Error(`fixture marker is absent: ${marker}`)
  const byteOffset = encoder.encode(raw.slice(0, characterIndex)).byteLength
  const markerBytes = encoder.encode(marker).byteLength
  expect(markerBytes).toBeGreaterThan(1)
  return byteOffset + 1
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: 'Bearer integration-token', 'idempotency-key': 'idem-key-12345678', ...extra }
}

function authRpcCalls() {
  return io.state.rpcCalls.filter((call) => call.name === 'authenticate_integration_request_v1')
}

function webhookCreateCalls() {
  return io.state.rpcCalls.filter((call) => call.name === 'gridex_create_partner_webhook_subscription_v1')
}

function idempotencyWrites() {
  return io.state.dbCalls.filter((call) =>
    call.table === 'customer_portal_write_idempotency' && call.operation !== 'select')
}

beforeEach(() => {
  vi.clearAllMocks()
  io.state.authOutcome = 'allowed'
  io.state.authCount = 20
  io.state.authLimit = 20
  io.state.dbCalls = []
  io.state.rpcCalls = []
  io.state.workerCalls = []
  io.state.inboundCalls = []
  process.env.TEST_BILLING_WEBHOOK_SECRET = 'billing-test-secret'
  process.env.MANUAL_INBOUND_WEBHOOK_SECRET = 'manual-inbound-test-secret'
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from('resend-signing-key-material-32b').toString('base64')}`
  process.env.RESEND_API_KEY = 're_test_key'
  process.env.EMAIL_OUTBOX_CRON_SECRET = 'worker-secret'
  process.env.MANUAL_EMAIL_OUTBOX_CRON_SECRET = 'worker-secret'
  process.env.EDIEL_CRON_SECRET = 'worker-secret'
  process.env.EDIEL_PLATFORM_MAINTENANCE_SECRET = 'worker-secret'
  process.env.EDIEL_AUTOMATION_ACTOR_USER_ID = EDIEL_ACTOR_ID
  delete process.env.CRON_SECRET
})

describe('partner webhook and price upper boundaries', () => {
  const webhookCases = [
    {
      path: ['webhook', 'subscription'],
      body: { webhook_event: 'CUSTOMER_CREATED', target_url: 'https://hooks.example.test/events', signing_secret: 'x'.repeat(32) },
    },
    {
      path: ['webhooks', 'subscriptions'],
      body: { name: 'Partner events', endpoint_url: 'https://hooks.example.test/events', event_types: ['customer.created'], signing_secret: 'x'.repeat(32) },
    },
  ]

  it.each(webhookCases)('authenticates $path once at the exact quota boundary and binds the credential company', async ({ path, body }) => {
    const streamed = streamRequest({
      url: `https://app.gridex.se/api/partner/v1/${path.join('/')}`,
      raw: JSON.stringify(body),
      headers: authHeaders(),
      chunkBytes: 1,
    })
    const response = await partnerPost(streamed.request as never, { params: Promise.resolve({ path }) })
    expect(response.status).toBe(201)
    expect(authRpcCalls()).toHaveLength(1)
    expect(authRpcCalls()[0].input).toMatchObject({ p_required_all: ['partner_webhooks.manage'] })
    expect(webhookCreateCalls()).toHaveLength(1)
    expect(webhookCreateCalls()[0].input).toMatchObject({ p_company_id: 'company-A', p_api_client_id: 'client-A' })
  })

  it.each(webhookCases.flatMap(({ path, body }) => [
    { path, body, target: 'http://127.0.0.1/internal' },
    { path, body, target: 'not a URL' },
    { path, body, target: 'https://127.0.0.1/internal' },
  ]))('preserves the exact $path public-target rejection for $target before write effects', async ({ path, body, target }) => {
    const targetField = path[0] === 'webhook' ? 'target_url' : 'endpoint_url'
    const requestId = `target-contract-${path[0]}`
    const streamed = streamRequest({
      url: `https://app.gridex.se/api/partner/v1/${path.join('/')}`,
      raw: JSON.stringify({ ...body, [targetField]: target }),
      headers: authHeaders({ 'x-request-id': requestId }),
    })
    const response = await partnerPost(streamed.request as never, { params: Promise.resolve({ path }) })
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'webhook_target_not_public',
        message: 'target_url must be a publicly routable HTTPS endpoint.',
      },
      request_id: requestId,
    })
    expect(Object.fromEntries(response.headers.entries())).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'x-gridex-api-version': PARTNER_API_VERSION,
      'x-request-id': requestId,
    })
    expect(authRpcCalls()).toHaveLength(1)
    expect(webhookCreateCalls()).toHaveLength(0)
    expect(idempotencyWrites()).toHaveLength(0)
  })

  it.each([undefined, '2'])('stops and cancels an oversized partner webhook with Content-Length %s', async (contentLength) => {
    const raw = jsonAtBytes({ webhook_event: 'CUSTOMER_CREATED', target_url: 'https://hooks.example.test/events', signing_secret: 'x'.repeat(32) }, 256_001)
    const streamed = streamRequest({ url: 'https://app.gridex.se/api/partner/v1/webhook/subscription', raw, headers: authHeaders(), contentLength })
    const response = await partnerPost(streamed.request as never, { params: Promise.resolve({ path: ['webhook', 'subscription'] }) })
    expect(response.status).toBe(413)
    expect(streamed.cancels()).toBe(1)
    expect(streamed.pulls()).toBeLessThan(260)
    expect(authRpcCalls()).toHaveLength(1)
    expect(webhookCreateCalls()).toHaveLength(0)
  })

  it('returns a scope failure after one quota decision without reading the body', async () => {
    io.state.authOutcome = 'denied'
    const streamed = streamRequest({ url: 'https://app.gridex.se/api/partner/v1/webhook/subscription', raw: '{}', headers: authHeaders() })
    const response = await partnerPost(streamed.request as never, { params: Promise.resolve({ path: ['webhook', 'subscription'] }) })
    expect(response.status).toBe(403)
    expect(authRpcCalls()).toHaveLength(1)
    expect(streamed.pulls()).toBe(0)
  })

  it('returns a boundary rate rejection after one quota decision without reading the body', async () => {
    io.state.authOutcome = 'rate_limited'
    io.state.authCount = 21
    const streamed = streamRequest({ url: 'https://app.gridex.se/api/partner/v1/webhooks/subscriptions', raw: '{}', headers: authHeaders() })
    const response = await partnerPost(streamed.request as never, { params: Promise.resolve({ path: ['webhooks', 'subscriptions'] }) })
    expect(response.status).toBe(429)
    expect(authRpcCalls()).toHaveLength(1)
    expect(streamed.pulls()).toBe(0)
  })

  it('caps partner price JSON at 256,000 received bytes', async () => {
    const streamed = streamRequest({
      url: 'https://app.gridex.se/api/partner/v1/price',
      raw: jsonAtBytes({ postal_code: '11122', annual_consumption_kwh: 10_000 }, 256_001),
      headers: authHeaders(),
      contentLength: '2',
    })
    const response = await partnerPost(streamed.request as never, { params: Promise.resolve({ path: ['price'] }) })
    expect(response.status).toBe(413)
    expect(streamed.cancels()).toBe(1)
    expect(authRpcCalls()).toHaveLength(1)
  })
})

describe('signed raw webhook boundaries', () => {
  function billingHeaders(raw: string): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1000))
    return {
      'x-gridex-timestamp': timestamp,
      'x-gridex-signature': createHmac('sha256', process.env.TEST_BILLING_WEBHOOK_SECRET!).update(`${timestamp}.${raw}`).digest('hex'),
    }
  }

  function manualHeaders(raw: string): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1000))
    return {
      'x-manual-inbound-timestamp': timestamp,
      'x-gridex-signature': createHmac('sha256', process.env.MANUAL_INBOUND_WEBHOOK_SECRET!).update(`${timestamp}.${raw}`).digest('hex'),
    }
  }

  function resendHeaders(raw: string): Record<string, string> {
    const id = `msg_${Math.random().toString(16).slice(2)}`
    const timestamp = String(Math.floor(Date.now() / 1000))
    const key = Buffer.from(process.env.RESEND_WEBHOOK_SECRET!.slice('whsec_'.length), 'base64')
    const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest('base64')
    return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` }
  }

  it('passes unchanged multibyte billing body text through the 512,000-byte cap and signature contract', async () => {
    const raw = '{\n  "id":"event-1", "invoiceGuid":"invoice-guid-1", "type":"paid", "note":"Å🙂"\n}'
    const streamed = streamRequest({ url: 'https://app.gridex.se/api/webhooks/billing/capway', raw, headers: billingHeaders(raw), chunkBytes: 1 })
    const response = await billingPost(streamed.request as never, { params: Promise.resolve({ provider: 'capway' }) })
    expect(response.status).toBe(200)
    expect(io.pendingEvents).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, '2'])('accepts billing at exactly 512,000 bytes and rejects/cancels cap+1 with Content-Length %s', async (contentLength) => {
    const base = { id: `billing-${contentLength ?? 'none'}`, invoiceGuid: 'invoice-guid-1', type: 'paid', note: 'Å🙂' }
    const exact = jsonAtBytes(base, 512_000)
    const exactRequest = streamRequest({ url: 'https://app.gridex.se/api/webhooks/billing/capway', raw: exact, headers: billingHeaders(exact), contentLength, chunkBytes: 8192 })
    expect((await billingPost(exactRequest.request as never, { params: Promise.resolve({ provider: 'capway' }) })).status).toBe(200)

    const oversizedRaw = `${exact} `
    const oversized = streamRequest({ url: 'https://app.gridex.se/api/webhooks/billing/capway', raw: oversizedRaw, headers: billingHeaders(oversizedRaw), contentLength })
    expect((await billingPost(oversized.request as never, { params: Promise.resolve({ provider: 'capway' }) })).status).toBe(413)
    expect(oversized.cancels()).toBe(1)
  })

  it.each([undefined, '2'])('accepts manual inbound at exactly 2,000,000 bytes and rejects/cancels cap+1 with Content-Length %s', async (contentLength) => {
    const base = { id: 'mail-1', mailbox: 'ops@example.test', from: 'sender@example.test', text: 'Å🙂' }
    const exact = jsonAtBytes(base, 2_000_000)
    const exactRequest = streamRequest({ url: 'https://app.gridex.se/api/webhooks/manual-inbound', raw: exact, headers: manualHeaders(exact), contentLength, chunkBytes: 8192 })
    expect((await manualInboundPost(exactRequest.request as never)).status).toBe(200)
    expect(io.inbound).toHaveBeenCalledTimes(1)

    const oversized = streamRequest({ url: 'https://app.gridex.se/api/webhooks/manual-inbound', raw: `${exact} `, headers: manualHeaders(`${exact} `), contentLength })
    expect((await manualInboundPost(oversized.request as never)).status).toBe(413)
    expect(oversized.cancels()).toBe(1)
    expect(io.inbound).toHaveBeenCalledTimes(1)
  })

  const resendEvents = [
    { type: 'email.sent', created_at: '2026-09-12T10:00:00.000Z', data: { email_id: 'email-sent', from: 'ops@example.test', to: ['customer@example.test'], subject: 'Sent' } },
    { type: 'email.bounced', created_at: '2026-09-12T10:00:00.000Z', data: { email_id: 'email-bounced', bounce: { message: 'Mailbox unavailable' } } },
    { type: 'email.clicked', created_at: '2026-09-12T10:00:00.000Z', data: { email_id: 'email-clicked', click: { link: 'https://example.test/path', user_agent: 'Fixture' } } },
    { type: 'email.received', created_at: '2026-09-12T10:00:00.000Z', data: { email_id: 'email-received', from: 'sender@example.test', to: ['inbound@example.test'], subject: 'Received metadata', attachments: [{ id: 'attachment-metadata-only', filename: 'invoice.pdf' }] } },
  ]

  it.each(resendEvents)('verifies and retains signed Resend $type metadata through the installed SDK', async (event) => {
    const raw = JSON.stringify(event)
    const streamed = streamRequest({ url: 'https://app.gridex.se/api/webhooks/resend', raw, headers: resendHeaders(raw), chunkBytes: 1 })
    const response = await resendPost(streamed.request as never)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, eventType: event.type })
  })

  it.each([undefined, '2'])('accepts signed noncanonical multibyte Resend raw JSON at exactly 2,000,000 bytes and rejects/cancels 2,000,001 with Content-Length %s', async (contentLength) => {
    const exact = noncanonicalResendRawAtBytes(2_000_000)
    const exactRequest = streamRequest({
      url: 'https://app.gridex.se/api/webhooks/resend',
      raw: exact,
      headers: resendHeaders(exact),
      contentLength,
      firstChunkBytes: splitInsideUtf8(exact, 'Å'),
      chunkBytes: 8192,
    })
    expect((await resendPost(exactRequest.request as never)).status).toBe(200)

    const oversizedRaw = noncanonicalResendRawAtBytes(2_000_001)
    const oversized = streamRequest({ url: 'https://app.gridex.se/api/webhooks/resend', raw: oversizedRaw, headers: resendHeaders(oversizedRaw), contentLength })
    expect((await resendPost(oversized.request as never)).status).toBe(413)
    expect(oversized.cancels()).toBe(1)
  })

  const resendPreReadCases: Array<{
    label: string
    headers: Record<string, string>
    hasSecret: boolean
    expectedStatus: number
  }> = [
    { label: 'missing headers', headers: {}, hasSecret: true, expectedStatus: 400 },
    { label: 'missing secret', headers: { 'svix-id': 'id', 'svix-timestamp': '1', 'svix-signature': 'v1,x' }, hasSecret: false, expectedStatus: 500 },
  ]

  it.each(resendPreReadCases)('rejects Resend $label before reading the body', async ({ headers, hasSecret, expectedStatus }) => {
    if (!hasSecret) delete process.env.RESEND_WEBHOOK_SECRET
    const streamed = streamRequest({ url: 'https://app.gridex.se/api/webhooks/resend', raw: 'x'.repeat(100_000), headers })
    const response = await resendPost(streamed.request as never)
    expect(response.status).toBe(expectedStatus)
    expect(streamed.pulls()).toBe(0)
  })
})

describe('secret worker authentication and optional bounded bodies', () => {
  const routes = [
    { name: 'tenant email', url: 'https://app.gridex.se/api/internal/email/outbox/process', post: tenantPost, get: tenantGet, worker: 'tenant', secretEnvNames: ['EMAIL_OUTBOX_CRON_SECRET', 'CRON_SECRET'] },
    { name: 'manual email', url: 'https://app.gridex.se/api/internal/manual-email/outbox/process', post: manualPost, get: manualGet, worker: 'manual', secretEnvNames: ['MANUAL_EMAIL_OUTBOX_CRON_SECRET', 'EMAIL_OUTBOX_CRON_SECRET', 'CRON_SECRET'] },
    { name: 'generic Ediel', url: 'https://app.gridex.se/api/ediel/outbox/process', post: edielPost, get: edielGet, worker: 'ediel', secretEnvNames: ['EDIEL_CRON_SECRET', 'CRON_SECRET'] },
  ]

  const missingSecretCases = [
    ...routes.map(({ name, url, post, worker, secretEnvNames }) => ({ name, url, post, worker, secretEnvNames })),
    {
      name: 'company-specific Ediel',
      url: 'https://app.gridex.se/api/ediel/outbox/process-company',
      post: edielCompanyPost,
      worker: 'ediel',
      secretEnvNames: ['EDIEL_PLATFORM_MAINTENANCE_SECRET', 'EDIEL_CRON_SECRET'],
    },
  ]

  it.each(missingSecretCases)('$name rejects before body or worker access when every fallback secret is absent', async ({ url, post, worker, secretEnvNames }) => {
    for (const name of secretEnvNames) delete process.env[name]
    const streamed = streamRequest({ url, raw: 'x'.repeat(300_000) })
    expect((await post(streamed.request as never)).status).toBe(503)
    expect(streamed.pulls()).toBe(0)
    expect(io.state.workerCalls.filter((call) => call.worker === worker)).toHaveLength(0)
    expect(io.getUserById).toHaveBeenCalledTimes(0)
  })

  it.each(routes)('$name rejects before touching an unauthorized POST body', async ({ url, post }) => {
    const streamed = streamRequest({ url, raw: 'x'.repeat(300_000), headers: { authorization: 'Bearer wrong-secret' } })
    expect((await post(streamed.request as never)).status).toBe(401)
    expect(streamed.pulls()).toBe(0)
  })

  it.each(routes)('$name returns 413 without default queue execution for an authorized oversized POST', async ({ url, post, worker }) => {
    const streamed = streamRequest({ url, raw: jsonAtBytes({ limit: 1 }, 256_001), headers: { authorization: 'Bearer worker-secret' }, contentLength: '2' })
    expect((await post(streamed.request as never)).status).toBe(413)
    expect(streamed.cancels()).toBe(1)
    expect(io.state.workerCalls.filter((call) => call.worker === worker)).toHaveLength(0)
  })

  it.each(routes)('$name preserves authorized empty POST and GET query/default behavior', async ({ url, post, get, worker }) => {
    const empty = streamRequest({ url, raw: '', headers: { authorization: 'Bearer worker-secret' } })
    expect((await post(empty.request as never)).status).toBe(200)
    const malformed = streamRequest({ url, raw: '{', headers: { authorization: 'Bearer worker-secret' } })
    expect((await post(malformed.request as never)).status).toBe(200)
    const getRequest = new Request(`${url}?limit=7&companyId=company-A`, { headers: { authorization: 'Bearer worker-secret' } })
    Object.defineProperty(getRequest, 'nextUrl', { value: new URL(getRequest.url) })
    const getResponse = await get(getRequest as never)
    expect(getResponse.status).toBe(200)
    const calls = io.state.workerCalls.filter((call) => call.worker === worker)
    expect(calls).toHaveLength(3)
    if (worker === 'ediel') {
      expect(calls.map((call) => call.input)).toEqual([
        { actorUserId: EDIEL_ACTOR_ID, companyId: null, environment: null, limit: 25 },
        { actorUserId: EDIEL_ACTOR_ID, companyId: null, environment: null, limit: 25 },
        { actorUserId: EDIEL_ACTOR_ID, companyId: null, environment: null, limit: 7 },
      ])
      await expect(getResponse.json()).resolves.toMatchObject({ companyId: null, ignoredCompanyOverride: 'blocked_on_generic_cron' })
      expect(io.getUserById).toHaveBeenCalledTimes(3)
    } else {
      expect(calls.map((call) => call.input)).toEqual([
        { companyId: null, limit: 25 },
        { companyId: null, limit: 25 },
        { companyId: 'company-A', limit: 7 },
      ])
    }
  })

  it('company-specific Ediel authenticates before its body, caps authorized bodies, and retains required empty-body errors', async () => {
    const unauthorized = streamRequest({ url: 'https://app.gridex.se/api/ediel/outbox/process-company', raw: 'x'.repeat(300_000), headers: { authorization: 'Bearer wrong-secret' } })
    expect((await edielCompanyPost(unauthorized.request as never)).status).toBe(401)
    expect(unauthorized.pulls()).toBe(0)

    const oversized = streamRequest({ url: 'https://app.gridex.se/api/ediel/outbox/process-company', raw: jsonAtBytes({ companyId: 'company-A', reason: 'maintenance' }, 256_001), headers: { authorization: 'Bearer worker-secret' }, contentLength: '2' })
    expect((await edielCompanyPost(oversized.request as never)).status).toBe(413)
    expect(oversized.cancels()).toBe(1)
    expect(io.state.workerCalls.filter((call) => call.worker === 'ediel')).toHaveLength(0)

    const empty = streamRequest({ url: 'https://app.gridex.se/api/ediel/outbox/process-company', raw: '', headers: { authorization: 'Bearer worker-secret' } })
    expect((await edielCompanyPost(empty.request as never)).status).toBe(400)

    const valid = streamRequest({
      url: 'https://app.gridex.se/api/ediel/outbox/process-company',
      raw: JSON.stringify({ companyId: 'company-A', reason: 'maintenance', environment: 'test', limit: 7 }),
      headers: { authorization: 'Bearer worker-secret' },
    })
    const validResponse = await edielCompanyPost(valid.request as never)
    expect(validResponse.status).toBe(200)
    await expect(validResponse.json()).resolves.toMatchObject({
      ok: true,
      source: 'ediel_outbox_company_maintenance',
      companyId: 'company-A',
      environment: 'test',
    })
    expect(io.state.workerCalls.filter((call) => call.worker === 'ediel')).toEqual([{
      worker: 'ediel',
      input: { actorUserId: EDIEL_ACTOR_ID, companyId: 'company-A', environment: 'test', limit: 7 },
    }])
    expect(io.state.dbCalls).toContainEqual(expect.objectContaining({
      table: 'audit_logs',
      operation: 'insert',
      payload: expect.objectContaining({
        company_id: 'company-A',
        actor_user_id: EDIEL_ACTOR_ID,
        metadata: expect.objectContaining({ reason: 'maintenance', environment: 'test' }),
      }),
    }))
  })
})
