import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { bindAuthenticatedApiResponseProfile } from '@/lib/integrations/apiResponseProfile'
import { CurrentMarketPriceError } from '@/lib/pricing/spot/currentMarketPrice'
import { POST } from '@/app/api/v1/website/market-price/current/route'

type AuditRow = Record<string, unknown>
const io = vi.hoisted(() => ({ audit: [] as AuditRow[], authorize: vi.fn(), price: vi.fn(), failAuditWrite: false }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  requireIntegrationApiAccess: io.authorize,
}))
vi.mock('@/lib/pricing/spot/currentMarketPrice', async original => ({
  ...await original<typeof import('@/lib/pricing/spot/currentMarketPrice')>(),
  loadCurrentMarketPrice: io.price,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'fixture-only', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const request = new Request(input, init)
          expect(request.url).toBe('https://synthetic.example.test/rest/v1/integration_api_requests')
          expect(request.method).toBe('POST')
          io.audit.push(await request.json() as AuditRow)
          if (io.failAuditWrite) return Response.json({ code: '08006', message: 'Synthetic audit failure' }, { status: 503 })
          return new Response(null, { status: 201 })
        },
      },
    }),
  }
})

const client: IntegrationApiClient = {
  id: 'synthetic-client', company_id: 'synthetic-company', name: 'Synthetic website client', status: 'active',
  key_prefix: 'synthetic', secret_hash: 'synthetic-only', scopes: ['website_market_prices.read'],
  allowed_ips: [], rate_limit_per_minute: 30, expires_at: null,
}
const resolutionId = '00000000-0000-4000-8000-000000000001'
const path = '/api/v1/website/market-price/current'
const callerId = 'synthetic-caller-reference'

function priceRequest(body: string, headers: HeadersInit = { 'x-request-id': callerId }) {
  return POST(new NextRequest('https://ops.example.test' + path, { method: 'POST', body, headers }))
}

async function expectLogged(response: Response, status: number, code: string | null) {
  expect(response.status).toBe(status)
  const body = await response.json()
  expect(body.request_id).toEqual(expect.any(String))
  expect(body.request_id).not.toBe(callerId)
  expect(response.headers.get('x-request-id')).toBe(body.request_id)
  expect(io.audit).toHaveLength(1)
  expect(io.audit[0]).toMatchObject({
    request_id: body.request_id, status_code: status, error_code: code,
    company_id: client.company_id, api_client_id: client.id, method: 'POST', route: path,
  })
  return body
}

beforeEach(() => {
  vi.clearAllMocks()
  io.audit = []
  io.failAuditWrite = false
  io.authorize.mockResolvedValue({ ok: true, client })
  io.price.mockResolvedValue({ resolution_id: resolutionId, price_area: 'SE3', provider: 'synthetic-spot',
    time_start: '2026-10-12T00:00:00Z', time_end: '2026-10-12T00:15:00Z' })
})
afterEach(() => vi.restoreAllMocks())

it.each([
  { body: '{', status: 400, code: 'invalid_json' },
  { body: '{}', status: 413, code: 'payload_too_large', headers: { 'content-length': '262145' } },
  { body: '{"unexpected":"synthetic-data"}', status: 400, code: 'unknown_field' },
  { body: '{}', status: 400, code: 'invalid_request' },
  { body: '{"resolution_id":"invalid"}', status: 400, code: 'invalid_request' },
  { body: JSON.stringify({ resolution_id: resolutionId, price_area: 'invalid' }), status: 400, code: 'invalid_request' },
])('logs rejected input as $status $code before any price load', async ({ body, status, code, headers }) => {
  const requestHeaders = new Headers(headers)
  requestHeaders.set('x-request-id', callerId)
  requestHeaders.set('authorization', 'Bearer synthetic-credential')
  const response = await priceRequest(body, requestHeaders)
  expect((await expectLogged(response, status, code)).error.code).toBe(code)
  expect(io.audit[0].metadata).toEqual({})
  expect(JSON.stringify(io.audit[0])).not.toContain('synthetic-data')
  expect(JSON.stringify(io.audit[0])).not.toContain('synthetic-credential')
  expect(io.price).not.toHaveBeenCalled()
})

it('stores the response ID as the indexed request ID for a successful price response', async () => {
  const response = await priceRequest(JSON.stringify({ resolution_id: resolutionId }))
  const body = await expectLogged(response, 200, null)
  expect(body.data).toMatchObject({ resolution_id: resolutionId, price_area: 'SE3', provider: 'synthetic-spot' })
  expect(io.audit[0].metadata).toMatchObject({ request_id: body.request_id, resolution_id: resolutionId })
  expect(io.authorize).toHaveBeenCalledWith(expect.anything(), ['website_market_prices.read'])
  expect(io.price).toHaveBeenCalledOnce()
})

it('logs a verified caller denial with the response ID even when the caller did not send an ID', async () => {
  io.authorize.mockResolvedValue({ ok: false, client, status: 403, errorCode: 'scope_denied', error: 'Synthetic scope denied' })
  const response = await priceRequest('{}', {})
  await expectLogged(response, 403, 'scope_denied')
  expect(io.price).not.toHaveBeenCalled()
})

it('logs a typed price rejection under its existing status and response ID', async () => {
  io.price.mockRejectedValue(new CurrentMarketPriceError({ code: 'price_area_mismatch', status: 409,
    field: 'price_area', message: 'Synthetic mismatch', details: { canonical_price_area: 'SE3' } }))
  const response = await priceRequest(JSON.stringify({ resolution_id: resolutionId, price_area: 'SE1' }))
  const body = await expectLogged(response, 409, 'price_area_mismatch')
  expect(body.error).toMatchObject({ field: 'price_area', details: { canonical_price_area: 'SE3' } })
})

it('logs an unexpected failure once under the public response ID', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  io.price.mockRejectedValue(new Error('Synthetic price failure'))
  await expectLogged(await priceRequest(JSON.stringify({ resolution_id: resolutionId })), 500, 'market_price_provider_unavailable')
})

it('keeps an anonymous denial outside tenant request-log storage', async () => {
  io.authorize.mockResolvedValue({ ok: false, status: 401, errorCode: 'authentication_required', error: 'Synthetic denial' })
  const response = await priceRequest('{}')
  expect(response.status).toBe(401)
  expect(io.audit).toEqual([])
  expect(io.price).not.toHaveBeenCalled()
})

it('retains the older response representation and its server-issued audit identity', async () => {
  const profile = '2026-10-04.1'
  const pinnedClient = { ...client, metadata: { api_contract_profiles: { website: profile } } }
  io.authorize.mockImplementation(async () => {
    bindAuthenticatedApiResponseProfile(pinnedClient)
    return { ok: true, client: pinnedClient }
  })
  const response = await priceRequest('{}')
  expect(response.headers.get('x-gridex-contract-version')).toBe(profile)
  const body = await expectLogged(response, 400, 'invalid_request')
  expect(body).toMatchObject({ contract_schema_version: profile, error: { field: 'resolution_id' } })
  expect(io.price).not.toHaveBeenCalled()
})

it('keeps the price response available when the audit insert fails', async () => {
  io.failAuditWrite = true
  const body = await expectLogged(await priceRequest(JSON.stringify({ resolution_id: resolutionId })), 200, null)
  expect(body.data).toMatchObject({ resolution_id: resolutionId, price_area: 'SE3' })
  expect(JSON.stringify(body)).not.toContain('Synthetic audit failure')
})
