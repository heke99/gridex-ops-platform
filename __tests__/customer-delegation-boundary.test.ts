import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  resolve: vi.fn(),
  auth: vi.fn(),
  log: vi.fn(),
}))
vi.mock('@/lib/customer-portal/customerResolver', () => ({
  portalIdentifiersFromRequest: (request: NextRequest) => ({
    externalCustomerId: null, customerNumber: request.nextUrl.searchParams.get('customer_number'),
    email: null, authUserId: request.headers.get('x-gridex-auth-user-id'), customerPortalUserId: null,
  }),
  resolvePortalCustomer: fixture.resolve,
}))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: fixture.auth,
  logIntegrationApiRequest: fixture.log,
  currentIntegrationApiResponseContext: () => null,
}))

import { requireCustomerPortalApiContext, requireCustomerPortalApiContextForIdentifiers } from '@/lib/customer-portal/externalApi'

const company = '10e4435f-7785-4cb5-9092-ea3c280ed32e'
const customer = '9879f55f-1337-457b-8065-b117813d6195'
const client = '97a0c92e-0683-4997-9a80-41213c511e9e'
const issuer = 'https://identity.example.test/tenant-a'
const subject = 'user-1'

describe('customer portal authorization boundary', () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
  let token: string

  beforeEach(async () => {
    vi.clearAllMocks()
    const keys = await generateKeyPair('RS256', { extractable: true })
    privateKey = keys.privateKey
    const jwk = await exportJWK(keys.publicKey)
    process.env.GRIDEX_CUSTOMER_DELEGATION_TRUST_JSON = JSON.stringify({
      [client]: { issuer, audience: 'gridex-customer-portal', bindings: { [issuer]: { [subject]: customer } }, jwks: { keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] } },
    })
    token = await sign()
    fixture.auth.mockResolvedValue({ ok: true, client: { id: client, company_id: company, scopes: ['customer_profile.read'] } })
    fixture.log.mockResolvedValue(undefined)
    fixture.resolve.mockResolvedValue({
      ok: true, customer: { customer_id: customer, company_id: company, customer_portal_user_id: subject, provider: 'customer_portal_accounts' },
    })
  })

  afterEach(() => { delete process.env.GRIDEX_CUSTOMER_DELEGATION_TRUST_JSON })

  async function sign(customerId = customer) {
    return new SignJWT({ company_id: company, api_client_id: client, customer_id: customerId, action: 'GET /api/v1/customer/me' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience('gridex-customer-portal')
      .setSubject(subject).setIssuedAt().setExpirationTime('2m').sign(privateKey)
  }

  function request(headers: Record<string, string> = {}) {
    return new NextRequest('https://gridex.example.test/api/v1/customer/me?customer_number=C-10', { headers })
  }

  it('rejects a client-selected customer before any customer lookup without platform trust', async () => {
    delete process.env.GRIDEX_CUSTOMER_DELEGATION_TRUST_JSON
    const result = await requireCustomerPortalApiContext(request({ 'x-gridex-customer-assertion': token }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
    expect(fixture.resolve).not.toHaveBeenCalled()
  })

  it('forces the verified subject through the active account lookup', async () => {
    const result = await requireCustomerPortalApiContext(request({ 'x-gridex-customer-assertion': token }))
    expect(result.ok).toBe(true)
    expect(fixture.resolve).toHaveBeenCalledWith(expect.objectContaining({
      identifiers: expect.objectContaining({ authUserId: subject, customerPortalUserId: subject }),
    }))
  })

  it('rejects a revoked account or a customer link changed since proof issuance', async () => {
    fixture.resolve.mockResolvedValueOnce({ ok: false, status: 403, code: 'customer_portal_link_required', error: 'Länken är spärrad.', identifiers: {} })
    const revoked = await requireCustomerPortalApiContext(request({ 'x-gridex-customer-assertion': token }))
    expect(revoked.ok).toBe(false)
    fixture.resolve.mockResolvedValueOnce({
      ok: true, customer: { customer_id: '4c7e2fc7-c7b0-4784-8026-5c722c5a655c', company_id: company, customer_portal_user_id: subject, provider: 'customer_portal_accounts' },
    })
    const moved = await requireCustomerPortalApiContext(request({ 'x-gridex-customer-assertion': token }))
    expect(moved.ok).toBe(false)
    if (!moved.ok) expect(moved.response.status).toBe(403)
  })

  it('rejects a caller-supplied other subject before account lookup', async () => {
    const result = await requireCustomerPortalApiContext(request({
      'x-gridex-customer-assertion': token, 'x-gridex-auth-user-id': 'other-user',
    }))
    expect(result.ok).toBe(false)
    expect(fixture.resolve).not.toHaveBeenCalled()
  })

  it('rejects an assertion signed for another customer even with the same client scope', async () => {
    const result = await requireCustomerPortalApiContext(request({ 'x-gridex-customer-assertion': await sign('4c7e2fc7-c7b0-4784-8026-5c722c5a655c') }))
    expect(result.ok).toBe(false)
    expect(fixture.resolve).not.toHaveBeenCalled()
  })

  it('keeps tenant machine sync separate from delegated customer reads', async () => {
    fixture.auth.mockResolvedValueOnce({ ok: true, client: { id: client, company_id: company, scopes: ['customer_portal.write'] } })
    const denied = await requireCustomerPortalApiContextForIdentifiers(
      new NextRequest('https://gridex.example.test/api/v1/customer/sync', { method: 'POST' }),
      { customerNumber: 'C-10' }, ['customer_sync.write'], 'tenant_machine',
    )
    expect(denied.ok).toBe(false)
    expect(fixture.resolve).not.toHaveBeenCalled()

    fixture.auth.mockResolvedValueOnce({ ok: true, client: { id: client, company_id: company, scopes: ['customer_sync.write'] } })
    const allowed = await requireCustomerPortalApiContextForIdentifiers(
      new NextRequest('https://gridex.example.test/api/v1/customer/sync', { method: 'POST' }),
      { customerNumber: 'C-10' }, ['customer_sync.write'], 'tenant_machine',
    )
    expect(allowed.ok).toBe(true)
  })
})
