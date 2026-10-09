// ops-api-review: F4
// Real Partner dispatcher + real simple/core webhook handlers + real
// requireIntegrationApiAccess. Only the database port, schema readiness, DNS
// target check and idempotency store are synthetic. One webhook-create request
// must authenticate once and consume exactly one rate-limit slot; separate
// requests must never share a verified context.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const m = vi.hoisted(() => ({
  budget: 2,
  authCalls: 0,
  createCalls: 0,
  revoked: false,
}))

function authRow(allowed: boolean, count: number, budget: number) {
  return {
    auth_outcome: allowed ? 'allowed' : 'rate_limited',
    error_code: allowed ? null : 'rate_limited',
    tenant_status: 'active',
    client_id: CLIENT,
    company_id: COMPANY,
    client_name: 'Partner',
    client_status: 'active',
    key_prefix: 'gx_live_test',
    secret_hash: 'h',
    scopes: ['partner_webhooks.manage'],
    allowed_ips: [],
    allowed_origins: [],
    metadata: {},
    rate_limit_per_minute: budget,
    expires_at: null,
    request_count: count,
    route_limit: budget,
    reset_at: new Date(Date.now() + 60_000).toISOString(),
  }
}

vi.mock('@/lib/supabase/service', () => {
  const chain: Record<string, unknown> = {}
  for (const key of ['update', 'eq', 'insert', 'select', 'maybeSingle']) chain[key] = () => chain
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve)
  return {
    supabaseService: {
      from: () => chain,
      rpc: async (name: string) => {
        if (name === 'authenticate_integration_request_v1') {
          m.authCalls += 1
          if (m.revoked) return { data: [{ ...authRow(false, 0, m.budget), auth_outcome: 'denied', error_code: 'invalid_api_token' }], error: null }
          return { data: [authRow(m.authCalls <= m.budget, m.authCalls, m.budget)], error: null }
        }
        if (name === 'gridex_create_partner_webhook_subscription_v1') {
          m.createCalls += 1
          return { data: { webhook_subscription_reference: 'webhook_public_reference', id: 'w1' }, error: null }
        }
        return { data: null, error: null }
      },
    },
  }
})
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/integrations/publicWebhookTransport', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertPublicWebhookTarget: vi.fn(async (raw: string) => new URL(raw)),
}))
vi.mock('@/lib/api/strictRequest', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  executeIdempotentPortalWrite: async ({ execute }: { execute: () => Promise<unknown> }) => execute(),
}))
vi.mock('@/lib/partner-api/business', () => ({ handleBusinessPartnerApi: vi.fn(async () => null) }))

import { POST } from '@/app/api/partner/v1/[[...path]]/route'

function createWebhook() {
  return POST(
    new NextRequest('https://example.invalid/api/partner/v1/webhook/subscription', {
      method: 'POST',
      headers: { authorization: `Bearer gx_live_test_${'s'.repeat(40)}`, 'content-type': 'application/json', 'idempotency-key': 'single-auth' },
      body: JSON.stringify({ webhook_event: 'CUSTOMER_CREATED', target_url: 'https://public.example/webhook', signing_secret: 'x'.repeat(32) }),
    }),
    { params: Promise.resolve({ path: ['webhook', 'subscription'] }) },
  )
}

beforeEach(() => {
  m.budget = 2
  m.authCalls = 0
  m.createCalls = 0
  m.revoked = false
})

describe('F4: one authentication and one rate-limit charge per Partner request', () => {
  it('webhook create authenticates exactly once through preflight and handler', async () => {
    const response = await createWebhook()
    expect(response.status).toBe(201)
    expect(m.authCalls).toBe(1)
    expect(m.createCalls).toBe(1)
  })

  it('a client with one remaining slot can create the webhook', async () => {
    m.budget = 1
    const response = await createWebhook()
    expect(response.status).toBe(201)
    expect(m.authCalls).toBe(1)
    expect(m.createCalls).toBe(1)
  })

  it('separate requests never share a verified context', async () => {
    m.budget = 1
    expect((await createWebhook()).status).toBe(201)
    const second = await createWebhook()
    expect(second.status).toBe(429)
    expect(m.authCalls).toBe(2)
    expect(m.createCalls).toBe(1)
  })

  it('a revocation between requests is honoured on the next request', async () => {
    expect((await createWebhook()).status).toBe(201)
    m.revoked = true
    const denied = await createWebhook()
    expect(denied.status).toBe(401)
    expect(m.createCalls).toBe(1)
  })

  it('legacy plural webhooks/subscriptions path also authenticates once', async () => {
    m.budget = 1
    const response = await POST(
      new NextRequest('https://example.invalid/api/partner/v1/webhooks/subscriptions', {
        method: 'POST',
        headers: { authorization: `Bearer gx_live_test_${'s'.repeat(40)}`, 'content-type': 'application/json', 'idempotency-key': 'single-auth-plural' },
        body: JSON.stringify({ name: 'Ops', endpoint_url: 'https://public.example/webhook', event_types: ['customer.created'], signing_secret: 'x'.repeat(32) }),
      }),
      { params: Promise.resolve({ path: ['webhooks', 'subscriptions'] }) },
    )
    expect(m.authCalls).toBe(1)
    expect(response.status).not.toBe(429)
    expect(m.createCalls).toBe(1)
  })
})
