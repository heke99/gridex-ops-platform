import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  outcome: 'rate_limited' as 'rate_limited' | 'allowed' | 'unavailable' | 'denied',
  reset: null as string | null,
  calls: [] as { name: string; method: string; body: string }[],
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient('https://partner-fixture.invalid', 'synthetic-db-key', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input))
        if (url.origin !== 'https://partner-fixture.invalid') throw new Error('Unexpected synthetic Supabase origin')
        const name = url.pathname.split('/').at(-1) ?? ''
        const method = init?.method ?? 'GET'
        database.calls.push({ name, method, body: String(init?.body ?? '') })
        if (name === 'authenticate_integration_request_v1') {
          return Response.json([{
            auth_outcome: database.outcome,
            error_code: {
              allowed: null,
              rate_limited: 'rate_limited',
              unavailable: 'api_rate_limiter_unavailable',
              denied: 'invalid_api_token',
            }[database.outcome],
            tenant_status: 'active',
            client_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            company_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            client_name: 'Synthetic Partner',
            client_status: 'active',
            key_prefix: 'gx_live_test',
            secret_hash: 'synthetic',
            scopes: ['partner_webhooks.manage'],
            allowed_ips: [],
            allowed_origins: [],
            metadata: {},
            rate_limit_per_minute: 2,
            expires_at: null,
            request_count: 3,
            route_limit: 2,
            reset_at: database.reset,
          }])
        }
        if (name === 'gridex_create_partner_webhook_subscription_v1') {
          return Response.json({ webhook_subscription_reference: 'synthetic-public-webhook', status: 'active' })
        }
        if (name === 'customer_portal_write_idempotency' && (method === 'POST' || method === 'PATCH')) {
          return Response.json({ id: 'synthetic-idempotency-row' })
        }
        if (['integration_api_clients', 'integration_api_requests', 'integration_api_rate_limit_events'].includes(name)) {
          return new Response(null, { status: 204 })
        }
        throw new Error('Unexpected synthetic Supabase operation ' + method + ' ' + name)
      },
    },
  })
  return { supabaseService: client }
})
vi.mock('@/lib/platform/schemaReadiness', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertPlatformSchemaReady: async () => undefined,
}))
vi.mock('@/lib/integrations/publicWebhookTransport', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertPublicWebhookTarget: vi.fn(async (raw: string) => new URL(raw)),
}))

import { POST } from '@/app/api/partner/v1/[[...path]]/route'

const AUTH_RPC = 'authenticate_integration_request_v1'
const CREATE_RPC = 'gridex_create_partner_webhook_subscription_v1'
const REQUEST_ID = 'api19-mounted-inert'
const KNOWN_RESET = '2026-11-20T10:00:41.112245+00:00'
type WebhookFixture = { path: string[]; body: Record<string, unknown> }
const variants: WebhookFixture[] = [
  { path: ['webhook', 'subscription'], body: { webhook_event: 'CUSTOMER_CREATED', target_url: 'https://webhook.invalid/inert' } },
  { path: ['webhooks', 'subscriptions'], body: { name: 'Synthetic legacy webhook', endpoint_url: 'https://webhook.invalid/inert', event_types: ['customer.created'] } },
]

function headers(): HeadersInit {
  return {
    authorization: 'Bearer gx_live_test_' + 's'.repeat(40),
    'content-type': 'application/json',
    'idempotency-key': 'api19-inert-idempotency',
    'x-request-id': REQUEST_ID,
  }
}
function createWebhook({ path, body }: WebhookFixture) {
  return POST(new NextRequest('https://partner.invalid/api/partner/v1/' + path.join('/'), {
    method: 'POST', headers: headers(), body: JSON.stringify({ ...body, signing_secret: 's'.repeat(32) }),
  }), { params: Promise.resolve({ path }) })
}
function count(name: string) {
  return database.calls.filter(call => call.name === name).length
}
function expectNoHints(response: Response) {
  expect(response.headers.has('Retry-After')).toBe(false)
  expect(response.headers.has('X-RateLimit-Reset')).toBe(false)
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T10:00:00Z'))
  database.outcome = 'rate_limited'
  database.reset = KNOWN_RESET
  database.calls.length = 0
})
afterEach(() => vi.useRealTimers())

describe.each(variants)('Partner mounted SDK $path', ({ path, body }) => {
  it('forwards the known reset and computed delay without extra authorization or a write', async () => {
    const response = await createWebhook({ path, body })
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ error: { code: 'rate_limited' }, request_id: REQUEST_ID })
    expect(response.headers.get('X-Request-ID')).toBe(REQUEST_ID)
    expect(response.headers.get('X-Gridex-API-Version')).toBe('2026-08-17.1')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(count(AUTH_RPC)).toBe(1)
    expect(count(CREATE_RPC)).toBe(0)
    expect(count('customer_portal_write_idempotency')).toBe(0)
    expect(count('integration_api_rate_limit_events')).toBe(1)
    expect(database.calls.filter(call => call.name === 'integration_api_requests').map(call => JSON.parse(call.body).status_code)).toEqual([429])
    expect(response.headers.get('Retry-After')).toBe('42')
    expect(response.headers.get('X-RateLimit-Reset')).toBe(KNOWN_RESET)
  })
  it.each([null, '42', '2026-02-30T10:00:41Z', '2026-11-20T10:00:41'])('does not invent a delay or serialize unknown reset %s', async reset => {
    database.reset = reset
    const response = await createWebhook({ path, body })
    expect(response.status).toBe(429)
    expectNoHints(response)
    expect(count(AUTH_RPC)).toBe(1)
    expect(count(CREATE_RPC)).toBe(0)
  })
  it('uses the ordinary auth and idempotent creation and returns no throttle hints', async () => {
    database.outcome = 'allowed'
    const response = await createWebhook({ path, body })
    expect(response.status).toBe(201)
    expect(JSON.stringify(await response.json())).toContain('synthetic-public-webhook')
    expectNoHints(response)
    expect(count(AUTH_RPC)).toBe(1)
    expect(count(CREATE_RPC)).toBe(1)
    expect(database.calls.filter(call => call.name === 'customer_portal_write_idempotency').map(call => call.method)).toEqual(['POST', 'PATCH'])
  })
  it('preserves auth outages and omits retry hints', async () => {
    database.outcome = 'unavailable'
    const response = await createWebhook({ path, body })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'api_rate_limiter_unavailable' } })
    expectNoHints(response)
    expect(count(AUTH_RPC)).toBe(1)
    expect(count(CREATE_RPC)).toBe(0)
  })
  it('keeps ordinary token denial opaque despite a reset carried by the transport', async () => {
    database.outcome = 'denied'
    const response = await createWebhook({ path, body })
    expect(response.status).toBe(401)
    expectNoHints(response)
    expect(count(AUTH_RPC)).toBe(1)
    expect(count(CREATE_RPC)).toBe(0)
  })
})
it('keeps valid reset provenance local to each request', async () => {
  database.reset = '2026-11-20T11:00:41.112245+01:00'
  const first = await createWebhook(variants[0])
  database.reset = null
  const second = await createWebhook(variants[1])

  expect(first.headers.get('Retry-After')).toBe('42')
  expect(first.headers.get('X-RateLimit-Reset')).toBe('2026-11-20T11:00:41.112245+01:00')
  expect(second.status).toBe(429)
  expectNoHints(second)
  expect(count(AUTH_RPC)).toBe(2)
  expect(count(CREATE_RPC)).toBe(0)
})
