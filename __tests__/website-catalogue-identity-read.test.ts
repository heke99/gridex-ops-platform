import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import fixture from '@/docs/fixtures/public-contracts-response-2026-08-04.3.json'

// Real GET, tenant-reference loader, classifier and response projection. Only
// auth and database/feed I/O are synthetic; no live dependency is contacted.
const io = vi.hoisted(() => ({
  auth: vi.fn(), from: vi.fn(), company: vi.fn(), rpc: vi.fn(), offers: vi.fn(),
  log: vi.fn(async () => undefined), usage: vi.fn(async () => undefined),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: io.from } }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: io.auth, logIntegrationApiRequest: io.log,
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/audit/actionLogger', () => ({ scheduleUsageEvent: io.usage }))
vi.mock('@/lib/website/publicContracts', async original => ({
  ...await original<typeof import('@/lib/website/publicContracts')>(),
  listPublicContractOffers: io.offers,
  publicContractResponse: () => fixture.data[0],
}))
vi.mock('@/lib/website/publicContractApi', async original => ({
  ...await original<typeof import('@/lib/website/publicContractApi')>(),
  loadPublicationRevision: async () => ({ revision: fixture.meta.publication_revision, updatedAt: fixture.meta.publication_updated_at }),
}))
import { GET } from '@/app/api/v1/website/public-contracts/route'
const companyId = '00000000-0000-4000-8000-000000000021'
const request = () => new NextRequest('https://unit.test/api/v1/website/public-contracts?customer_type=private')

beforeEach(() => {
  vi.clearAllMocks()
  io.auth.mockResolvedValue({ ok: true,
    client: { id: '00000000-0000-4000-8000-000000000020', company_id: companyId, scopes: ['website_contracts.read'] },
    context: { companyId }, rateLimit: { limit: 100, remaining: 99, resetAt: null },
  })
  io.rpc.mockResolvedValue({ data: [{ fingerprint: 'a'.repeat(32) }], error: null })
  io.company.mockResolvedValue({ data: { status: 'active', external_tenant_reference: fixture.meta.tenant_reference }, error: null })
  io.from.mockImplementation((table: string) => {
    if (table !== 'companies') throw new Error('Unused readiness read must not run: ' + table)
    return { select: (columns: string) => {
      expect(columns).toBe('external_tenant_reference,status')
      return { eq: (column: string, value: string) => {
        expect(column).toBe('id'); expect(value).toBe(companyId)
        return { single: io.company }
      } }
    } }
  })
  io.offers.mockResolvedValue([{}])
})

describe('website catalogue reads only the tenant identity it uses', () => {
  it('returns the canonical catalogue without unused automation/readiness fan-out', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toHaveLength(1)
    expect(body.meta.organization_reference).toMatch(/^organization_/)
    expect(io.from).toHaveBeenCalledTimes(1)
    expect(io.company).toHaveBeenCalledTimes(1)
    expect(io.auth).toHaveBeenCalledWith(expect.any(NextRequest), ['website_contracts.read'])
    expect(io.offers).toHaveBeenCalledTimes(1)
    expect(io.usage).toHaveBeenCalledTimes(1)
  })

  it.each(['suspended', 'archived'])('still rejects an independently reread %s company', async status => {
    io.company.mockResolvedValueOnce({ data: { status, external_tenant_reference: fixture.meta.tenant_reference }, error: null })
    const response = await GET(request())
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('ORGANIZATION_NOT_OPERATIONALLY_READY')
    expect(io.usage).not.toHaveBeenCalled()
  })

  it('still rejects missing company identity and propagates transient database failure', async () => {
    io.company.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } })
    let response = await GET(request())
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('ORGANIZATION_NOT_FOUND')
    io.company.mockResolvedValueOnce({ data: null, error: { code: '57014' } })
    response = await GET(request())
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('2')
    expect((await response.json()).error.retryable).toBe(true)
    expect(io.usage).not.toHaveBeenCalled()
  })
})
