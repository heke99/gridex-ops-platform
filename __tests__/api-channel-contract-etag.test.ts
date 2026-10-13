import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorized: true,
  rpc: vi.fn(),
  auth: vi.fn(),
  revision: vi.fn(),
}))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: mocks.auth,
  logIntegrationApiRequest: vi.fn().mockResolvedValue(undefined),
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/integrations/tenantContext', () => ({
  loadExternalTenantContext: vi.fn().mockResolvedValue({ tenant_reference: 'tenant_etag_test' }),
}))
vi.mock('@/lib/integrations/publicReferences', () => ({ publicOrganizationReference: () => 'organization_abcdefghijklmnopqrstuv' }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: mocks.rpc } }))
vi.mock('@/lib/website/publicContractApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/website/publicContractApi')>(),
  loadPublicationRevision: mocks.revision,
}))
vi.mock('@/lib/external-contracts/publicationDto', () => ({
  API_CONTRACT_RESPONSE_SCHEMA_VERSION: '2026-10-09.1',
  mapContractPublicationToPublicDto: ({ publication }: { publication: unknown }) => publication,
}))
import { GET } from '@/app/api/v1/contracts/route'

function request(customerType: string, etag?: string) {
  return new NextRequest(`https://app.gridex.se/api/v1/contracts?customer_type=${customerType}`, {
    headers: { Authorization: 'Bearer synthetic-unit-test', ...(etag ? { 'If-None-Match': etag } : {}) },
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorized = true
  mocks.auth.mockImplementation(async () => mocks.authorized ? {
    ok: true, client: { id: 'client-unit', company_id: 'company-unit' }, context: { companyId: 'company-unit' },
    rateLimit: { limit: 100, remaining: 99, resetAt: null },
  } : { ok: false, status: 401, errorCode: 'invalid_api_key', error: 'Invalid key', client: null })
  mocks.revision.mockResolvedValue({ revision: 12, token: 'unit-revision', updatedAt: '2026-10-12T12:00:00Z', etag: '"same-db-revision"' })
  mocks.rpc.mockImplementation(async (_name: string, input: { p_customer_type: string }) => ({
    data: [{ offer_reference: `offer-${input.p_customer_type}`, customer_type: input.p_customer_type }], error: null,
  }))
})
describe('mounted API-channel public contract conditional GET', () => {
  it('does not reuse a private feed ETag for the business feed at the same publication revision', async () => {
    const privateResponse = await GET(request('private'))
    expect(privateResponse.status).toBe(200)
    const etag = privateResponse.headers.get('etag')!
    const businessResponse = await GET(request('business', etag))
    expect(businessResponse.status).toBe(200)
    expect(businessResponse.headers.get('etag')).not.toBe(etag)
    expect((await businessResponse.json()).data[0].customer_type).toBe('business')
    expect(mocks.rpc).toHaveBeenLastCalledWith('gridex_list_external_api_contracts', { p_company_id: 'company-unit', p_customer_type: 'business' })
  })
  it('keeps an unchanged filter conditional response cheap', async () => {
    const first = await GET(request('private'))
    const second = await GET(request('private', first.headers.get('etag')!))
    expect(second.status).toBe(304)
    expect(await second.text()).toBe('')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it('authenticates before testing a conditional request', async () => {
    const first = await GET(request('private'))
    mocks.authorized = false
    const second = await GET(request('private', first.headers.get('etag')!))
    expect(second.status).toBe(401)
    expect(mocks.revision).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})
