import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  context: vi.fn(), rpc: vi.fn(), insert: vi.fn(), log: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { rpc: fixture.rpc, from: () => ({ insert: fixture.insert }) },
}))
vi.mock('@/lib/env/supabaseServer', () => ({
  getSupabaseServiceEnv: () => ({ serviceRoleKey: 'synthetic-event-route-cursor-key' }),
}))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn(),
  logIntegrationApiRequest: fixture.log,
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/customer-portal/externalApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/customer-portal/externalApi')>(),
  // Auth/delegation has independent coverage. Keep the real GET, v2 reader,
  // cursor validation, error handler and public envelope for this failure path.
  requireCustomerPortalApiContext: fixture.context,
}))

import { GET } from '@/app/api/v1/customer/events/route'

const companyId = '11111111-1111-4111-8111-111111111111'
const customerId = '22222222-2222-4222-8222-222222222222'
const privateDiagnostic = 'SYNTHETIC_PRIVATE_RPC_DIAGNOSTIC'

describe('actual event GET schema-readiness errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fixture.context.mockResolvedValue({
      ok: true, startedAt: 1,
      client: { id: 'synthetic-event-client', company_id: companyId },
      identity: { customer_id: customerId, external_customer_id: null,
        customer_number: 'SYN-EVENT-A1', provider: 'customer_portal_accounts' },
    })
    fixture.insert.mockResolvedValue({ error: null })
    fixture.log.mockResolvedValue(undefined)
    fixture.rpc.mockResolvedValue({ data: [], error: null })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('returns a safe retryable 503 when the v2 read model is missing', async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: {
      code: 'PGRST202', message: privateDiagnostic, details: { internal_customer_id: customerId },
    } })
    const response = await GET(new NextRequest('https://gridex.example.test/api/v1/customer/events'))
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error).toMatchObject({ code: 'platform_schema_not_ready', retryable: true })
    expect(body.error.details).toBeUndefined()
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.correlation_id).toBe(body.request_id)
    expect(response.headers.get('X-Request-ID')).toBe(body.request_id)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(JSON.stringify(body)).not.toMatch(new RegExp(`${privateDiagnostic}|${customerId}|PGRST202|portal_customer_events_page_v2`))
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('portal_customer_events_page_v2', {
      p_company_id: companyId, p_customer_id: customerId, p_cursor_occurred_at: null,
      p_cursor_source_rank: null, p_cursor_id: null, p_limit: 51,
    })
    expect(fixture.log).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 503, errorCode: 'platform_schema_not_ready',
    }))
  })

  it('keeps unexpected reader failures as a safe generic 500', async () => {
    fixture.rpc.mockRejectedValue(new Error(privateDiagnostic))
    const response = await GET(new NextRequest('https://gridex.example.test/api/v1/customer/events'))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error.code).toBe('customer_portal_internal_error')
    expect(JSON.stringify(body)).not.toContain(privateDiagnostic)
  })

  it('preserves malformed-cursor 400 without querying the v2 reader', async () => {
    const response = await GET(new NextRequest('https://gridex.example.test/api/v1/customer/events?cursor=malformed'))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatchObject({ code: 'invalid_cursor', field: 'cursor' })
    expect(fixture.rpc).not.toHaveBeenCalled()
  })

  it('returns an authorization denial before any event read', async () => {
    fixture.context.mockResolvedValue({ ok: false, startedAt: 1,
      response: Response.json({ error: { code: 'customer_delegation_required' } }, { status: 403 }) })
    const response = await GET(new NextRequest('https://gridex.example.test/api/v1/customer/events'))
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('customer_delegation_required')
    expect(fixture.insert).not.toHaveBeenCalled()
    expect(fixture.rpc).not.toHaveBeenCalled()
  })
})
