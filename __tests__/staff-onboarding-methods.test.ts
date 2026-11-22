import { createRequire } from 'node:module'
import { autoImplementMethods } from 'next/dist/server/route-modules/app-route/helpers/auto-implement-methods'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as identity from '@/app/api/v1/staff-onboarding/identity/resolve/route'
import * as invitation from '@/app/api/v1/staff-onboarding/invitations/accept/route'
import document from '@/docs/openapi/staff-onboarding-v1.json'

const io = vi.hoisted(() => ({
  projectRef: 'abcdefghijklmnopqrst',
  apiAccess: vi.fn(),
  logRequest: vi.fn(),
  tenantAuth: vi.fn(),
  proof: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  SUPABASE_SERVICE_URL: `https://${io.projectRef}.supabase.co`,
  supabaseService: { from: io.from, rpc: io.rpc },
}))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  requireIntegrationApiAccess: io.apiAccess,
  logIntegrationApiRequest: io.logRequest,
}))
vi.mock('@/lib/staff-api/tenantAuth', async original => ({
  ...await original<typeof import('@/lib/staff-api/tenantAuth')>(),
  getRegisteredStaffTenantAuthUser: io.tenantAuth,
}))
vi.mock('@/lib/customer-portal/customerAssertion', async original => ({
  ...await original<typeof import('@/lib/customer-portal/customerAssertion')>(),
  verifyCustomerAssertion: io.proof,
}))

const { validateResponse } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs')
const routes = [
  {
    path: '/api/v1/staff-onboarding/identity/resolve',
    userland: identity,
    message: 'Use an explicit POST to resolve the staff identity.',
  },
  {
    path: '/api/v1/staff-onboarding/invitations/accept',
    userland: invitation,
    message: 'Use an explicit POST to accept the invitation.',
  },
]

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  for (const port of [io.apiAccess, io.logRequest, io.tenantAuth, io.proof, io.from, io.rpc]) {
    expect(port).not.toHaveBeenCalled()
  }
})

describe.each(routes)('Next Staff Onboarding method dispatch for $path', ({ path, userland, message }) => {
  const handlers = autoImplementMethods(userland)

  async function dispatch(method: keyof typeof handlers) {
    const response = await handlers[method](new NextRequest(`https://ops.example.test${path}`, { method }), {})
    expect(response).toBeInstanceOf(Response)
    return response as Response
  }

  it.each(['GET', 'PUT', 'PATCH', 'DELETE'] as const)('returns the documented JSON envelope for %s', async method => {
    const response = await dispatch(method)
    expect(response.status).toBe(405)
    expect(response.headers.get('content-type')).toMatch(/^application\/json\b/)
    expect(response.headers.get('allow')).toBe('OPTIONS, POST')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-gridex-project-ref')).toBe(io.projectRef)
    expect(response.headers.get('x-gridex-contract-version')).toBe(document.info.version)
    const requestId = response.headers.get('x-request-id')
    expect(requestId).toBeTruthy()
    const body = await response.json()
    expect(body).toEqual({
      error: { code: 'method_not_allowed', message },
      request_id: requestId,
      contract_schema_version: document.info.version,
    })
    expect(validateResponse(document, path, body, 'post', '405')).toEqual([])
  })

  it('keeps HEAD bodyless with the method-refusal headers', async () => {
    const response = await dispatch('HEAD')
    expect(response.status).toBe(405)
    expect(response.body).toBeNull()
    expect(response.headers.get('allow')).toBe('OPTIONS, POST')
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('keeps OPTIONS at 204 and advertises only the supported operations', async () => {
    const response = await dispatch('OPTIONS')
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
    expect(response.headers.get('allow')).toBe('OPTIONS, POST')
  })

  it('keeps POST on the existing storage project check', async () => {
    const response = await dispatch('POST')
    expect(response.status).toBe(412)
    expect(response.headers.get('allow')).toBeNull()
    const body = await response.json()
    expect(body.error.code).toBe('storage_project_mismatch')
    expect(validateResponse(document, path, body, 'post', '412')).toEqual([])
  })
})
