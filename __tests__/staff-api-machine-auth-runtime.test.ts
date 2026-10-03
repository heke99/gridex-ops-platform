import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashIntegrationApiSecret } from '@/lib/integrations/apiClientSecrets'

const state = vi.hoisted(() => ({
  rpc: vi.fn(), ready: vi.fn(), denied: null as string | null, unavailable: false,
}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: state.ready }))
vi.mock('@/lib/tenant/context', () => ({ tenantContextForIntegration: (input: unknown) => input }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: state.rpc,
  from: () => ({ insert: async () => ({ error: null }), update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
} }))

import { requireIntegrationApiAccess, requireStaffIntegrationApiAccess } from '@/lib/integrations/apiAuth'

const token = 'staffkey0001-synthetic-private-machine-secret'
const originalProxyTrust = process.env.INTEGRATION_API_TRUST_PROXY_HEADERS
function request(path = '/api/v1/staff/me', method = 'GET', headers: Record<string, string> = { authorization: `Bearer ${token}` }) {
  return new NextRequest(`https://ops.example.invalid${path}`, { method, headers: { ...headers, origin: 'https://support.example.invalid', 'x-forwarded-for': '10.10.5.5' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.denied = null; state.unavailable = false
  process.env.INTEGRATION_API_TRUST_PROXY_HEADERS = 'true'
  state.rpc.mockImplementation(async () => state.unavailable ? { data: null, error: { code: 'PGRST202' } } : { data: [{
    auth_outcome: state.denied === 'rate_limited' ? 'rate_limited' : state.denied ? 'denied' : 'allowed', error_code: state.denied, tenant_status: 'active',
    client_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', company_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', client_name: 'Synthetic Staff', client_status: 'active', key_prefix: token.slice(0, 12),
    scopes: ['staff_context.read', 'staff_support.write'], allowed_ips: ['10.10.0.0/16'], allowed_origins: ['https://support.example.invalid'], metadata: { integration_kind: 'staff_support_v1' },
    rate_limit_per_minute: 6, expires_at: null, request_count: state.denied === 'rate_limited' ? 3 : 1, route_limit: 2, reset_at: new Date(Date.now() + 30_000).toISOString(),
  }], error: null })
})
afterEach(() => {
  if (originalProxyTrust === undefined) delete process.env.INTEGRATION_API_TRUST_PROXY_HEADERS
  else process.env.INTEGRATION_API_TRUST_PROXY_HEADERS = originalProxyTrust
})

describe('staff machine auth transport using actual API auth module', () => {
  // These tests verify dispatch, failure behavior and HTTP projection. Native
  // credential policy is proven independently by rollback-only real SQL tests.
  it('uses the dedicated RPC with method, native hash, IP/origin and original scope requirements', async () => {
    const result = await requireStaffIntegrationApiAccess(request('/api/v1/staff/support/cases', 'POST'), { allOf: ['staff_support.write'], anyOf: ['staff_context.read'] })
    expect(result.ok).toBe(true)
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith('authenticate_staff_integration_request_v1', {
      p_key_prefix: token.slice(0, 12), p_secret_hash: hashIntegrationApiSecret(token), p_method: 'POST', p_route: '/api/v1/staff/support/cases',
      p_required_all: ['staff_support.write'], p_required_any: ['staff_context.read'], p_client_ip: '10.10.5.5', p_origin: 'https://support.example.invalid', p_rate_limit_cost: 3, p_window_seconds: 60,
    })
    expect(JSON.stringify(state.rpc.mock.calls)).not.toContain(token)
    if (result.ok) expect(result.client.secret_hash).toBe('')
  })
  it('keeps generic Website auth on its original RPC with no staff method argument', async () => {
    await requireIntegrationApiAccess(request('/api/v1/website/contracts'), ['website_contracts.read'])
    expect(state.rpc).toHaveBeenCalledOnce()
    expect(state.rpc.mock.calls[0][0]).toBe('authenticate_integration_request_v1')
    expect(state.rpc.mock.calls[0][1]).not.toHaveProperty('p_method')
    expect(state.rpc.mock.calls[0][1].p_required_all).toEqual(['website_contracts.read'])
  })
  it('rejects missing, malformed and legacy staff credentials before schema or RPC access', async () => {
    const credentials: Record<string, string>[] = [{}, { authorization: 'Bearer too many tokens' }, { 'x-api-key': token }]
    for (const headers of credentials) {
      const result = await requireStaffIntegrationApiAccess(request(undefined, undefined, headers), ['staff_context.read'])
      expect(result).toMatchObject({ ok: false, status: 401 })
    }
    expect(state.ready).not.toHaveBeenCalled()
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it('preserves generic legacy key compatibility while rejecting it for staff', async () => {
    await requireIntegrationApiAccess(request('/api/v1/website/contracts', 'GET', { 'x-api-key': token }), ['website_contracts.read'])
    expect(state.rpc.mock.calls[0][0]).toBe('authenticate_integration_request_v1')
    expect(state.rpc.mock.calls[1][0]).toBe('gridex_record_legacy_api_key_use_v1')
  })
  it('projects canonical native rate denial without generic fallback', async () => {
    state.denied = 'rate_limited'
    const result = await requireStaffIntegrationApiAccess(request('/api/v1/staff/sessions', 'POST'), ['staff_sessions.write'])
    expect(result).toMatchObject({ ok: false, status: 429, errorCode: 'rate_limited', rateLimit: { limit: 2, count: 3, remaining: 0 } })
    if (!result.ok) expect(result.retryAfterSeconds).toBeGreaterThan(0)
    expect(state.rpc).toHaveBeenCalledOnce()
    expect(state.rpc.mock.calls[0][0]).toBe('authenticate_staff_integration_request_v1')
  })
  it('fails closed when the dedicated RPC is unavailable and never tries Website auth', async () => {
    state.unavailable = true
    expect(await requireStaffIntegrationApiAccess(request(), [])).toMatchObject({ ok: false, status: 503, errorCode: 'api_auth_unavailable' })
    expect(state.rpc).toHaveBeenCalledOnce()
    expect(state.rpc.mock.calls[0][0]).toBe('authenticate_staff_integration_request_v1')
  })
})
