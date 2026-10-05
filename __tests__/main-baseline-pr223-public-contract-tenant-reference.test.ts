import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Execute the real route, error classifier and public error envelope. Replace
// only integration-auth and external feed/tenant/revision persistence ports.
const ports = vi.hoisted(() => ({
  tenant: vi.fn(), offers: vi.fn(), revision: vi.fn(), auth: vi.fn(),
  fingerprint: vi.fn(), log: vi.fn(async () => undefined),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: ports.fingerprint } }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: ports.auth,
  logIntegrationApiRequest: ports.log,
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/integrations/tenantContext', async (original) => ({
  ...await original<typeof import('@/lib/integrations/tenantContext')>(),
  loadExternalTenantContext: ports.tenant,
}))
vi.mock('@/lib/website/publicContracts', async (original) => ({
  ...await original<typeof import('@/lib/website/publicContracts')>(),
  listPublicContractOffers: ports.offers,
}))
vi.mock('@/lib/website/publicContractApi', async (original) => ({
  ...await original<typeof import('@/lib/website/publicContractApi')>(),
  loadPublicationRevision: ports.revision,
}))

import { GET } from '@/app/api/v1/website/public-contracts/route'
import { PublicContractFeedConsistencyError } from '@/lib/website/publicContracts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const consistencyError = () => new PublicContractFeedConsistencyError([{
  canonical_offer_reference: 'offer-test', publication_version_id: null,
  diagnostic_code: 'PUBLICATION_GRAPH_INCOMPLETE',
}])
const request = () => new NextRequest('http://localhost/api/v1/website/public-contracts?customer_type=private')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  ports.auth.mockResolvedValue({
    ok: true, client: { id: 'client-test', company_id: 'company-test', scopes: ['website_contracts.read'] },
    context: { companyId: 'company-test', correlationId: 'correlation-test' },
    rateLimit: { limit: 100, remaining: 99, resetAt: null },
  })
  ports.fingerprint.mockResolvedValue({ data: [{ fingerprint: 'a'.repeat(32) }], error: null })
  ports.revision.mockResolvedValue({ revision: 'revision-test', updatedAt: null })
})
afterEach(() => vi.restoreAllMocks())

describe('public contract error tenant attribution across parallel reads', () => {
  it('retains the resolved tenant in a subsequent offer-load consistency failure', async () => {
    const tenant = deferred<{ tenant_reference: string }>()
    const offers = deferred<never>()
    const started = deferred<void>()
    ports.tenant.mockReturnValue(tenant.promise)
    ports.offers.mockImplementation(() => { started.resolve(); return offers.promise })
    const response = GET(request())
    await started.promise
    tenant.resolve({ tenant_reference: 'tenant-known' })
    await Promise.resolve()
    offers.reject(consistencyError())
    const result = await response
    expect(result.status).toBe(503)
    expect(await result.json()).toMatchObject({ error: {
      code: 'PUBLIC_CONTRACT_FEED_INCONSISTENT', retryable: true,
      details: { tenant_reference: 'tenant-known', affected_contracts: [{ canonical_offer_reference: 'offer-test' }] },
    } })
  })

  it('keeps the reference absent when tenant resolution is still pending at failure', async () => {
    const tenant = deferred<{ tenant_reference: string }>()
    const offers = deferred<never>()
    const started = deferred<void>()
    ports.tenant.mockReturnValue(tenant.promise)
    ports.offers.mockImplementation(() => { started.resolve(); return offers.promise })
    const response = GET(request())
    await started.promise
    offers.reject(consistencyError())
    const result = await response
    expect(result.status).toBe(503)
    expect(await result.json()).toMatchObject({ error: { details: { tenant_reference: null } } })
    tenant.resolve({ tenant_reference: 'tenant-late' })
    await Promise.resolve()
  })

  it('keeps resolved references isolated between concurrently failing requests', async () => {
    const tenants = [deferred<{ tenant_reference: string }>(), deferred<{ tenant_reference: string }>()]
    const offers = [deferred<never>(), deferred<never>()]
    const started = deferred<void>()
    let tenantCalls = 0
    let offerCalls = 0
    ports.tenant.mockImplementation(() => tenants[tenantCalls++].promise)
    ports.offers.mockImplementation(() => {
      const result = offers[offerCalls++].promise
      if (offerCalls === 2) started.resolve()
      return result
    })
    const responses = [GET(request()), GET(request())]
    await started.promise
    tenants[0].resolve({ tenant_reference: 'tenant-first' })
    tenants[1].resolve({ tenant_reference: 'tenant-second' })
    await Promise.resolve()
    offers[1].reject(consistencyError())
    offers[0].reject(consistencyError())
    const results = await Promise.all(responses)
    expect(results.map(result => result.status)).toEqual([503, 503])
    const payloads = await Promise.all(results.map(result => result.json()))
    expect(payloads[0].error.details.tenant_reference).toBe('tenant-first')
    expect(payloads[1].error.details.tenant_reference).toBe('tenant-second')
  })
})
