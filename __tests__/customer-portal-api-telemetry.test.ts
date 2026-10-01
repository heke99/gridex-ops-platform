import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'

const fixture = vi.hoisted(() => ({ log: vi.fn(), authorize: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  logIntegrationApiRequest: fixture.log,
  requireIntegrationApiAccess: fixture.authorize,
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/customer-portal/customerResolver', () => ({
  portalIdentifiersFromRequest: () => ({}), resolvePortalCustomer: vi.fn(),
}))
vi.mock('@/lib/customer-portal/delegationAssertion', () => ({ verifyCustomerDelegationAssertion: vi.fn() }))

import { logCustomerPortalSuccess, requireCustomerPortalApiContext, handleCustomerPortalRouteError } from '@/lib/customer-portal/externalApi'
import { ApiInputError } from '@/lib/api/strictRequest'

const request = new NextRequest('https://gridex.example.test/api/v1/customer/notifications/read', { method: 'POST' })
const client: IntegrationApiClient = {
  id: 'synthetic-client', company_id: 'synthetic-tenant', name: 'Synthetic', status: 'active',
  key_prefix: 'test', secret_hash: 'synthetic', scopes: ['customer_notifications.write'],
  allowed_ips: [], rate_limit_per_minute: 60, expires_at: null,
}

describe('ordinary API request telemetry is not the business transaction', () => {
  beforeEach(() => {
    fixture.log.mockReset().mockRejectedValue(new Error('synthetic confidential raw telemetry detail'))
    fixture.authorize.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('keeps a committed success successful when ordinary request logging fails', async () => {
    await expect(logCustomerPortalSuccess({ request, client, startedAt: 1, resultCount: 1 })).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith('[customer-portal-api] request telemetry failed', {
      route: '/api/v1/customer/notifications/read', statusCode: 200,
    })
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('confidential')
  })

  it('keeps a real authorization denial fail-closed when denial telemetry fails', async () => {
    fixture.authorize.mockResolvedValue({ ok: false, status: 403, error: 'Scope required', errorCode: 'api_scope_missing' })
    const result = await requireCustomerPortalApiContext(request, ['customer_notifications.write'])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unexpected authorization')
    expect(result.response.status).toBe(403)
    expect((await result.response.json()).error.code).toBe('api_scope_missing')
  })

  it('returns controlled input failures without an unhandled telemetry rejection', async () => {
    const response = handleCustomerPortalRouteError({ request, client, startedAt: 1,
      error: new ApiInputError('Conflict', 'idempotency_conflict', 409),
    })
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('idempotency_conflict')
    await Promise.resolve()
  })

  it('logs only registered route templates and safe codes for unknown failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const invoiceRequest = new NextRequest('https://gridex.example.test/api/v1/customer/invoices/submitted-secret-reference')
    const response = handleCustomerPortalRouteError({ request: invoiceRequest, client, startedAt: 1,
      error: new Error('raw secret with customer data'),
    })
    expect(response.status).toBe(500)
    expect(console.error).toHaveBeenCalledWith('[customer-portal-api] route failed', {
      route: '/api/v1/customer/invoices/[id]', code: 'customer_portal_internal_error',
    })
    await Promise.resolve()
    const diagnostics = JSON.stringify([...vi.mocked(console.error).mock.calls, ...vi.mocked(console.warn).mock.calls])
    expect(diagnostics).not.toContain('submitted-secret-reference')
    expect(diagnostics).not.toContain('raw secret')
  })
})
