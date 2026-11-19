import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/v1/website/energy-area/resolve/route'
import { resolveWebsiteEnergyContext, websiteEnergyResolutionCacheKey } from '@/lib/energy/websiteResolutionCache'
import type { EnergyResolverInput, EnergyResolverResult } from '@/lib/energy/types'

type CacheRow = { lookup_key: string; expires_at: string; result: EnergyResolverResult }

const io = vi.hoisted(() => ({
  resolve: vi.fn<(input: EnergyResolverInput) => Promise<EnergyResolverResult>>(),
  cache: new Map<string, CacheRow>(),
  reads: [] as URLSearchParams[],
  writes: [] as CacheRow[],
}))

vi.mock('@/lib/energy/resolver', async original => ({
  ...await original<typeof import('@/lib/energy/resolver')>(), resolveEnergyContext: io.resolve,
}))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: async () => ({
    ok: true, client: { id: 'synthetic-client' }, context: { companyId: 'synthetic-company' },
  }),
  currentIntegrationApiResponseContext: () => null,
  logIntegrationApiRequest: async () => undefined,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: cacheTransport },
    }),
  }
})

const input: EnergyResolverInput = {
  companyId: 'synthetic-company', street: '  Storgatan 12 ', postalCode: '11122', city: 'Stockholm',
  requestedStartMode: 'specific_date', requestedStartDate: '2026-12-01',
  metadata: { source: 'website_energy_area_api', api_client_id: 'synthetic-client', origin: { label: 'first' } },
}

function resolution(number: number, overrides: Partial<EnergyResolverResult> = {}): EnergyResolverResult {
  return {
    resolutionId: `area-${number}`, lookupKey: 'synthetic-area', priceArea: 'SE3',
    gridAreaCode: null, gridAreaName: null, gridOwnerId: null, gridOwnerName: null,
    priceAreaAssurance: {
      status: 'estimated', priceArea: 'SE3', confidence: 0.9, source: 'postal_consensus',
      candidateCount: 2, uniquePriceAreaCount: 1, sourceVersion: null, evidence: {},
    },
    resolutionStatus: 'postal_suggested', confidence: 0.9, sourceChain: ['postal_code'],
    automationAllowed: false, nextRequiredAction: 'follow_up', warnings: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  }
}

async function cacheTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!url.pathname.endsWith('/platform_energy_lookup_cache')) throw new Error('Unexpected synthetic dependency')
  if (init?.method === 'GET') {
    io.reads.push(url.searchParams)
    const row = io.cache.get((url.searchParams.get('lookup_key') ?? '').slice(3))
    const after = (url.searchParams.get('expires_at') ?? '').slice(3)
    return Response.json(row && row.expires_at > after ? [row] : [])
  }
  if (init?.method === 'POST' && typeof init.body === 'string') {
    const row = JSON.parse(init.body) as CacheRow
    io.writes.push(row)
    io.cache.set(row.lookup_key, row)
    return new Response(null, { status: 201 })
  }
  throw new Error('Unexpected synthetic operation')
}

function holdResolver(finish: (ticket: number) => EnergyResolverResult) {
  const ready = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  io.resolve.mockImplementation(async () => {
    const ticket = io.resolve.mock.calls.length
    ready.resolve()
    await release.promise
    return finish(ticket)
  })
  return async () => {
    await ready.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    release.resolve()
  }
}

async function overlapping(inputs: readonly EnergyResolverInput[], finish = resolution) {
  const release = holdResolver(finish)
  const calls = Promise.allSettled(inputs.map(resolveWebsiteEnergyContext))
  await release()
  return calls
}

function resolvedIds(results: PromiseSettledResult<EnergyResolverResult>[]) {
  return results.map(result => {
    if (result.status === 'rejected') throw result.reason
    return result.value.resolutionId
  })
}

beforeEach(() => {
  io.resolve.mockReset()
  io.cache.clear()
  io.reads = []
  io.writes = []
})

describe('overlapping website energy resolution', () => {
  it('returns the same fresh receipt through both mounted Website requests', async () => {
    const release = holdResolver(resolution)
    const post = () => POST(new NextRequest('https://synthetic.example.test/api/v1/website/energy-area/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postal_code: '11122', city: 'Stockholm' }),
    }))
    const requests = Promise.all([post(), post()])
    await release()

    const responses = await requests
    expect(responses.map(response => response.status)).toEqual([200, 200])
    const bodies = await Promise.all(responses.map(response => response.json()))
    expect(bodies.map(body => body.data.resolution_id)).toEqual(['area-1', 'area-1'])
    expect(bodies[0].request_id).not.toBe(bodies[1].request_id)
    expect(io.reads).toHaveLength(1)
    expect(io.writes).toHaveLength(1)
  })

  it('uses one cache read, resolver receipt and cache write for concurrent equivalent inputs', async () => {
    const equivalent = { ...input, street: 'Storgatan', streetNumber: '12' }
    expect(websiteEnergyResolutionCacheKey(equivalent)).toBe(websiteEnergyResolutionCacheKey(input))

    expect(resolvedIds(await overlapping([input, equivalent, input]))).toEqual(['area-1', 'area-1', 'area-1'])
    expect(io.resolve).toHaveBeenCalledTimes(1)
    expect(io.reads).toHaveLength(1)
    expect(io.writes).toHaveLength(1)
    expect(io.resolve).toHaveBeenCalledWith({
      ...input, street: null, streetNumber: null,
      metadata: { ...input.metadata, resolution_mode: 'website_price_area_only', exact_address_provider_allowed: false },
    })
  })

  it.each([
    { companyId: 'another-company' },
    { metadata: { ...input.metadata, api_client_id: 'another-client' } },
    { metadata: { ...input.metadata, source: 'another-source' } },
    { metadata: { ...input.metadata, origin: { label: 'changed' } } },
    { requestedStartDate: '2026-12-02' },
    { requestedStartMode: 'earliest_possible' },
    { postalCode: '111 22' },
  ])('keeps distinct pending resolver provenance for %j', async difference => {
    const different = { ...input, ...difference }

    expect(new Set(resolvedIds(await overlapping([input, different]))).size).toBe(2)
    expect(io.reads).toHaveLength(2)
    expect(io.writes).toHaveLength(2)
    expect(io.resolve.mock.calls.map(([value]) => value)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ...input, street: null, metadata: expect.objectContaining(input.metadata!) }),
      expect.objectContaining({ ...different, street: null, metadata: expect.objectContaining(different.metadata!) }),
    ]))
  })

  it.each([
    { customerId: 'synthetic-customer' },
    { customerSiteId: 'synthetic-site' },
    { customerApplicationId: 'synthetic-application' },
    { companyId: null },
  ])('does not share or cache pending client-bound resolution for %j', async scope => {
    const bound = { ...input, ...scope }

    expect(new Set(resolvedIds(await overlapping([bound, bound]))).size).toBe(2)
    expect(io.resolve).toHaveBeenCalledTimes(2)
    expect(io.reads).toEqual([])
    expect(io.writes).toEqual([])
  })

  it('clears a shared rejection so the next lookup can resolve normally', async () => {
    const failure = new Error('synthetic resolver rejection')
    const results = await overlapping([input, input], () => { throw failure })

    expect(results).toEqual([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }])
    expect(io.resolve).toHaveBeenCalledTimes(1)
    expect(io.writes).toEqual([])
    io.resolve.mockResolvedValue(resolution(9))
    expect((await resolveWebsiteEnergyContext(input)).resolutionId).toBe('area-9')
    expect(io.resolve).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a completed needs-review result for a later lookup', async () => {
    const next = await overlapping([input, input], ticket => resolution(ticket, { resolutionStatus: 'needs_review' }))

    expect(resolvedIds(next)).toEqual(['area-1', 'area-1'])
    expect(io.writes).toEqual([])
    io.resolve.mockResolvedValue(resolution(9))
    expect((await resolveWebsiteEnergyContext(input)).resolutionId).toBe('area-9')
    expect(io.resolve).toHaveBeenCalledTimes(2)
  })

  it('reuses the existing durable cache until the resolver receipt expires', async () => {
    const lookupKey = websiteEnergyResolutionCacheKey(input)!
    const stale = resolution(7, { expiresAt: new Date(Date.now() - 1000).toISOString() })
    io.cache.set(lookupKey, { lookup_key: lookupKey, expires_at: stale.expiresAt!, result: stale })
    const fresh = resolution(9)
    io.resolve.mockResolvedValue(fresh)

    expect((await resolveWebsiteEnergyContext(input)).resolutionId).toBe('area-9')
    expect(await resolveWebsiteEnergyContext({ ...input, metadata: { ...input.metadata, api_client_id: 'another-client' } })).toMatchObject({
      resolutionId: 'area-9', diagnostics: { providerStatus: 'resolution_cache_hit' },
    })
    expect(io.resolve).toHaveBeenCalledTimes(1)
    expect(io.writes).toMatchObject([{ lookup_key: lookupKey, expires_at: fresh.expiresAt }])
    expect(io.reads).toHaveLength(2)
  })
})
