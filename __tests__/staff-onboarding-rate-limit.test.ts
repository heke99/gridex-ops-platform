import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  apiAccess: vi.fn(),
  logRequest: vi.fn(),
  tenantAuth: vi.fn(),
  verifyProof: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  projectRef: 'abcdefghijklmnopqrst',
}))

vi.mock('@/lib/supabase/service', () => ({
  SUPABASE_SERVICE_URL: `https://${io.projectRef}.supabase.co`,
  supabaseService: { from: io.from, rpc: io.rpc },
}))
vi.mock('@/lib/integrations/apiAuth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/integrations/apiAuth')>(),
  requireIntegrationApiAccess: io.apiAccess,
  logIntegrationApiRequest: io.logRequest,
}))
vi.mock('@/lib/staff-api/tenantAuth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/staff-api/tenantAuth')>(),
  getRegisteredStaffTenantAuthUser: io.tenantAuth,
}))
vi.mock('@/lib/customer-portal/customerAssertion', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/customer-portal/customerAssertion')>(),
  verifyCustomerAssertion: io.verifyProof,
}))

import { POST as acceptInvitation } from '@/app/api/v1/staff-onboarding/invitations/accept/route'
import { POST as resolveIdentity } from '@/app/api/v1/staff-onboarding/identity/resolve/route'

const routes = [
  {
    path: 'invitations/accept',
    post: acceptInvitation,
    scope: 'staff_users.write',
    body: { invitation_token: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
    errorMessage: 'The staff invitation could not be accepted.',
  },
  {
    path: 'identity/resolve',
    post: resolveIdentity,
    scope: 'staff_users.read',
    body: {},
    errorMessage: 'The independent staff identity could not be verified.',
  },
]

function request(route: typeof routes[number]) {
  return new NextRequest(`https://ops.example.test/api/v1/staff-onboarding/${route.path}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer synthetic-machine-credential',
      'x-gridex-expected-project-ref': io.projectRef,
      'x-gridex-support-auth-token': 'synthetic-auth-token',
      'x-gridex-staff-assertion': 'synthetic-staff-proof',
      'idempotency-key': 'synthetic-request-key',
      'content-type': 'application/json',
    },
    body: JSON.stringify(route.body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('mounted Staff Onboarding rate limiting', () => {
  it.each(routes)('forwards the 429 delay and exits before proof work on $path', async route => {
    io.apiAccess.mockResolvedValue({ ok: false, status: 429, errorCode: 'rate_limited', error: 'Internal refusal', retryAfterSeconds: 42 })
    const input = request(route)
    const response = await route.post(input)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('42')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-gridex-project-ref')).toBe(io.projectRef)
    expect(response.headers.get('x-gridex-contract-version')).toBe('2026-10-05.2')
    const requestId = response.headers.get('x-request-id')
    expect(requestId).toBeTruthy()
    expect(await response.json()).toEqual({
      error: { code: 'rate_limited', message: route.errorMessage },
      request_id: requestId,
      contract_schema_version: '2026-10-05.2',
    })
    expect(io.apiAccess).toHaveBeenCalledExactlyOnceWith(input, [route.scope])
    expect(io.tenantAuth).not.toHaveBeenCalled()
    expect(io.verifyProof).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
    expect(io.rpc).not.toHaveBeenCalled()
    expect(io.logRequest).not.toHaveBeenCalled()
  })

  it.each(routes)('omits Retry-After for an unrelated authorization refusal on $path', async route => {
    io.apiAccess.mockResolvedValue({ ok: false, status: 403, errorCode: 'api_scope_missing', error: 'Internal refusal', retryAfterSeconds: 42 })
    const response = await route.post(request(route))
    expect(response.status).toBe(403)
    expect(response.headers.get('retry-after')).toBeNull()
    expect(await response.json()).toMatchObject({ error: { code: 'api_scope_missing', message: route.errorMessage } })
  })

  it.each(routes)('preserves a 429 response without a supplied delay on $path', async route => {
    io.apiAccess.mockResolvedValue({ ok: false, status: 429, errorCode: 'rate_limited', error: 'Internal refusal' })
    const response = await route.post(request(route))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeNull()
  })
})
